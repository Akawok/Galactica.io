import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Game } from "../models/Game.js";
import { GAME_CONFIG, applyXP } from "./game.service.js";

export interface MatchResult {
  points: number;
  xp: number;
  level: number;
  xpGained: number;
  leveledUp: boolean;
  galactics: number;
  galacticsGained: number;
}

export async function recordMatchResult(opts: {
  winner: { socketId: string; userId: string };
  loser?: { socketId: string; userId: string };
  awardXP: boolean;
}): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();
  const tasks: Promise<unknown>[] = [];

  if (mongoose.Types.ObjectId.isValid(opts.winner.userId)) {
    tasks.push(
      updateWinner(opts.winner.userId, opts.awardXP).then((res) => {
        if (res) results.set(opts.winner.socketId, res);
      }),
    );
  }

  if (opts.loser && mongoose.Types.ObjectId.isValid(opts.loser.userId)) {
    const loserSocketId = opts.loser.socketId;
    tasks.push(
      updateLoser(opts.loser.userId, opts.awardXP).then((res) => {
        if (res) results.set(loserSocketId, res);
      }),
    );
  }

  await Promise.all(tasks);
  return results;
}

async function updateWinner(
  userId: string,
  awardXP: boolean,
): Promise<MatchResult | null> {
  const before = await User.findById(userId).select(
    "xp level stats.currentStreak stats.bestStreak",
  );
  if (!before) return null;

  const xpGained = awardXP ? GAME_CONFIG.XP_PER_WIN : 0;
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
        points: GAME_CONFIG.POINTS_PER_WIN,
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
  awardXP: boolean,
): Promise<MatchResult | null> {
  const before = await User.findById(userId).select("xp level");
  if (!before) return null;

  const xpGained = awardXP ? GAME_CONFIG.XP_PER_LOSS : 0;
  const { level, xp, levelsGained } = applyXP(
    before.level,
    before.xp,
    xpGained,
  );
  const galacticsGained = levelsGained * GAME_CONFIG.GALACTICS_PER_LEVEL;
  const creditsGained = awardXP ? GAME_CONFIG.CREDITS_PER_LOSS : 0;

  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        points: creditsGained,
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
