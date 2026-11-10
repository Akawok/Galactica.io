import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Game } from "../models/Game.js";
import { GAME_CONFIG, applyXP } from "./game.service.js";

export type RewardNote = "limit" | "grey" | "upset";

export interface MatchResult {
  points: number;
  pointsGained: number;
  xp: number;
  level: number;
  xpGained: number;
  leveledUp: boolean;
  galactics: number;
  galacticsGained: number;
  rewardNote?: RewardNote;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function greyMultiplier(
  winnerLevel: number,
  loserLevel: number,
): number {
  const gap = winnerLevel - loserLevel;
  if (gap <= GAME_CONFIG.GREY_GAP_START) return 1;
  if (gap >= GAME_CONFIG.GREY_GAP_ZERO) return 0;
  return (
    1 -
    (gap - GAME_CONFIG.GREY_GAP_START) /
      (GAME_CONFIG.GREY_GAP_ZERO - GAME_CONFIG.GREY_GAP_START)
  );
}

export function upsetXpBonus(winnerLevel: number, loserLevel: number): number {
  const gap = loserLevel - winnerLevel;
  if (gap <= 0) return 0;
  return Math.min(
    GAME_CONFIG.UPSET_XP_BONUS_MAX,
    gap * GAME_CONFIG.UPSET_XP_BONUS_PER_LEVEL,
  );
}

// Must run before the current match is saved, otherwise it counts itself
async function rewardedMatchesToday(a: string, b: string): Promise<number> {
  return Game.countDocuments({
    "players.userId": {
      $all: [new mongoose.Types.ObjectId(a), new mongoose.Types.ObjectId(b)],
    },
    endedAt: { $gte: new Date(Date.now() - DAY_MS) },
  });
}

export async function recordMatchResult(opts: {
  winner: { socketId: string; userId: string };
  loser?: { socketId: string; userId: string };
}): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();
  const winnerValid = mongoose.Types.ObjectId.isValid(opts.winner.userId);
  const loserValid =
    !!opts.loser && mongoose.Types.ObjectId.isValid(opts.loser.userId);

  let winnerMultiplier = 1;
  let winnerXpBonus = 0;
  let loserMultiplier = 1;
  let winnerNote: RewardNote | undefined;
  let loserNote: RewardNote | undefined;

  if (winnerValid && loserValid) {
    const [count, w, l] = await Promise.all([
      rewardedMatchesToday(opts.winner.userId, opts.loser!.userId),
      User.findById(opts.winner.userId).select("level").lean(),
      User.findById(opts.loser!.userId).select("level").lean(),
    ]);
    if (count >= GAME_CONFIG.REWARDED_MATCHES_PER_OPPONENT) {
      winnerMultiplier = loserMultiplier = 0;
      winnerNote = loserNote = "limit";
    } else {
      winnerMultiplier = greyMultiplier(w?.level ?? 1, l?.level ?? 1);
      winnerXpBonus = upsetXpBonus(w?.level ?? 1, l?.level ?? 1);
      if (winnerMultiplier < 1) winnerNote = "grey";
      else if (winnerXpBonus > 0) winnerNote = "upset";
    }
  }

  const tasks: Promise<unknown>[] = [];
  if (winnerValid) {
    tasks.push(
      updateWinner(opts.winner.userId, winnerMultiplier, winnerXpBonus).then(
        (res) => {
          if (res)
            results.set(opts.winner.socketId, {
              ...res,
              rewardNote: winnerNote,
            });
        },
      ),
    );
  }
  if (loserValid) {
    const loserSocketId = opts.loser!.socketId;
    tasks.push(
      updateLoser(opts.loser!.userId, loserMultiplier).then((res) => {
        if (res) results.set(loserSocketId, { ...res, rewardNote: loserNote });
      }),
    );
  }

  await Promise.all(tasks);
  return results;
}

async function updateWinner(
  userId: string,
  multiplier: number,
  xpBonus: number,
): Promise<MatchResult | null> {
  const before = await User.findById(userId).select(
    "xp level stats.currentStreak stats.bestStreak",
  );
  if (!before) return null;

  const xpGained = Math.round(
    GAME_CONFIG.XP_PER_WIN * multiplier * (1 + xpBonus),
  );
  const pointsGained = Math.round(GAME_CONFIG.POINTS_PER_WIN * multiplier);
  const { level, xp, levelsGained } = applyXP(
    before.level,
    before.xp,
    xpGained,
  );
  const galacticsGained = levelsGained * GAME_CONFIG.GALACTICS_PER_LEVEL;
  const newStreak = (before.stats.currentStreak ?? 0) + 1;
  const newBest = Math.max(before.stats.bestStreak ?? 0, newStreak);

  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        points: pointsGained,
        galactics: galacticsGained,
        "stats.wins": 1,
        "stats.totalGames": 1,
      },
      $set: {
        xp,
        level,
        "stats.currentStreak": newStreak,
        "stats.bestStreak": newBest,
      },
    },
    { new: true },
  ).select("points xp level galactics");

  if (!updated) return null;
  return {
    points: updated.points,
    pointsGained,
    xp: updated.xp,
    level: updated.level,
    xpGained,
    leveledUp: levelsGained > 0,
    galactics: updated.galactics ?? 0,
    galacticsGained,
  };
}

async function updateLoser(
  userId: string,
  multiplier: number,
): Promise<MatchResult | null> {
  const before = await User.findById(userId).select("xp level");
  if (!before) return null;

  const xpGained = Math.round(GAME_CONFIG.XP_PER_LOSS * multiplier);
  const { level, xp, levelsGained } = applyXP(
    before.level,
    before.xp,
    xpGained,
  );
  const galacticsGained = levelsGained * GAME_CONFIG.GALACTICS_PER_LEVEL;
  const pointsGained = Math.round(GAME_CONFIG.CREDITS_PER_LOSS * multiplier);

  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        points: pointsGained,
        galactics: galacticsGained,
        "stats.losses": 1,
        "stats.totalGames": 1,
      },
      $set: { xp, level, "stats.currentStreak": 0 },
    },
    { new: true },
  ).select("points xp level galactics");

  if (!updated) return null;
  return {
    points: updated.points,
    pointsGained,
    xp: updated.xp,
    level: updated.level,
    xpGained,
    leveledUp: levelsGained > 0,
    galactics: updated.galactics ?? 0,
    galacticsGained,
  };
}

export interface DesertionResult {
  penalty: number;
  desertions: number;
  opponentPoints: number | null;
}

export async function recordDesertion(opts: {
  deserter: { userId: string };
  opponent: { userId: string };
}): Promise<DesertionResult | null> {
  if (!mongoose.Types.ObjectId.isValid(opts.deserter.userId)) return null;

  const deserterBefore = await User.findById(opts.deserter.userId).select(
    "points stats.desertions",
  );
  if (!deserterBefore) return null;

  const desertionNumber = (deserterBefore.stats.desertions ?? 0) + 1;
  const rate = Math.min(
    GAME_CONFIG.DESERTION_PENALTY_RATE * desertionNumber,
    GAME_CONFIG.DESERTION_PENALTY_CAP,
  );
  const penalty = Math.max(0, Math.floor((deserterBefore.points ?? 0) * rate));

  const deserterUpdated = await User.findOneAndUpdate(
    { _id: opts.deserter.userId, points: { $gte: penalty } },
    {
      $inc: {
        points: -penalty,
        "stats.desertions": 1,
        "stats.losses": 1,
        "stats.totalGames": 1,
      },
      $set: { "stats.currentStreak": 0 },
    },
    { new: true },
  ).select("stats.desertions");

  const effectivePenalty = deserterUpdated ? penalty : 0;
  if (!deserterUpdated) {
    await User.findByIdAndUpdate(opts.deserter.userId, {
      $inc: {
        "stats.desertions": 1,
        "stats.losses": 1,
        "stats.totalGames": 1,
      },
      $set: { "stats.currentStreak": 0 },
    });
  }

  let opponentPoints: number | null = null;
  if (mongoose.Types.ObjectId.isValid(opts.opponent.userId)) {
    const opponent = await User.findByIdAndUpdate(
      opts.opponent.userId,
      {
        $inc: { points: effectivePenalty, "stats.totalGames": 1 },
      },
      { new: true },
    ).select("points");
    opponentPoints = opponent?.points ?? null;
  }

  return {
    penalty: effectivePenalty,
    desertions: deserterUpdated?.stats.desertions ?? desertionNumber,
    opponentPoints,
  };
}

export async function saveGameRecord(opts: {
  roomId: string;
  players: { userId: string; username: string; score: number }[];
  winnerUserId: string;
}): Promise<void> {
  try {
    await Game.create({
      roomId: opts.roomId,
      players: opts.players.map((p) => ({
        userId: mongoose.Types.ObjectId.isValid(p.userId)
          ? new mongoose.Types.ObjectId(p.userId)
          : undefined,
        username: p.username,
        score: p.score,
      })),
      winner: mongoose.Types.ObjectId.isValid(opts.winnerUserId)
        ? new mongoose.Types.ObjectId(opts.winnerUserId)
        : undefined,
      rounds: [],
      spectators: [],
      endedAt: new Date(),
    });
  } catch (err) {
    console.error("[saveGameRecord] erreur:", err);
  }
}
