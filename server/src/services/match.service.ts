import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Game } from "../models/Game.js";
import { GAME_CONFIG, applyXP } from "./game.service.js";

export type RewardNote =
  | { kind: "repeat"; matchNumber: number; percent: number }
  | { kind: "grey"; percent: number }
  | { kind: "upset"; bonusPercent: number }
  | { kind: "noFight"; self: boolean };

export interface MatchResult {
  points: number;
  pointsGained: number;
  xp: number;
  level: number;
  xpGained: number;
  leveledUp: boolean;
  galactics: number;
  galacticsGained: number;
  rewardNotes: RewardNote[];
}

// Offset (ms) between wall-clock time in timeZone and UTC at the given instant
function zoneOffset(at: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, Number(x.value)]),
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at / 1000) * 1000;
}

// Last midnight in timeZone, as a UTC instant. The offset is re-read at the candidate
// midnight so days where the clocks change (DST) still land on 00:00 local time
export function startOfDay(
  now = Date.now(),
  timeZone = GAME_CONFIG.DAILY_RESET_TIMEZONE,
): Date {
  const local = new Date(now + zoneOffset(now, timeZone));
  const midnightWall = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const guess = midnightWall - zoneOffset(now, timeZone);
  return new Date(midnightWall - zoneOffset(guess, timeZone));
}

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

// matchNumber is 1 for the first win of the day over this opponent
export function repeatMultiplier(matchNumber: number): number {
  const extra = matchNumber - GAME_CONFIG.FULL_REWARD_MATCHES_PER_OPPONENT;
  if (extra <= 0) return 1;
  return Math.max(
    GAME_CONFIG.REPEAT_REWARD_FLOOR,
    1 - extra * GAME_CONFIG.REPEAT_REWARD_STEP,
  );
}

const toPercent = (m: number) => Math.round(m * 100);

// Only wins of this winner over this loser count, so a player who keeps losing to someone
// still earns full rewards the first times they finally win.
// Must run before the current match is saved, otherwise it counts itself
async function winsToday(winnerId: string, loserId: string): Promise<number> {
  const winner = new mongoose.Types.ObjectId(winnerId);
  return Game.countDocuments({
    "players.userId": { $all: [winner, new mongoose.Types.ObjectId(loserId)] },
    winner,
    endedAt: { $gte: startOfDay() },
  });
}

export async function recordMatchResult(opts: {
  winner: { socketId: string; userId: string };
  loser?: { socketId: string; userId: string };
  loserFought: boolean;
}): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();
  const winnerValid = mongoose.Types.ObjectId.isValid(opts.winner.userId);
  const loserValid =
    !!opts.loser && mongoose.Types.ObjectId.isValid(opts.loser.userId);

  let winnerMultiplier = 1;
  let winnerXpBonus = 0;
  let loserMultiplier = 1;
  const winnerNotes: RewardNote[] = [];
  const loserNotes: RewardNote[] = [];

  if (!opts.loserFought) {
    winnerMultiplier = loserMultiplier = 0;
    winnerNotes.push({ kind: "noFight", self: false });
    loserNotes.push({ kind: "noFight", self: true });
  } else if (winnerValid && loserValid) {
    const [count, w, l] = await Promise.all([
      winsToday(opts.winner.userId, opts.loser!.userId),
      User.findById(opts.winner.userId).select("level").lean(),
      User.findById(opts.loser!.userId).select("level").lean(),
    ]);
    const matchNumber = count + 1;
    const repeat = repeatMultiplier(matchNumber);
    if (repeat < 1) {
      const note: RewardNote = {
        kind: "repeat",
        matchNumber,
        percent: toPercent(repeat),
      };
      winnerNotes.push(note);
      loserNotes.push(note);
    }
    const grey = greyMultiplier(w?.level ?? 1, l?.level ?? 1);
    if (grey < 1) winnerNotes.push({ kind: "grey", percent: toPercent(grey) });
    winnerXpBonus = upsetXpBonus(w?.level ?? 1, l?.level ?? 1);
    if (winnerXpBonus > 0)
      winnerNotes.push({ kind: "upset", bonusPercent: toPercent(winnerXpBonus) });
    winnerMultiplier = repeat * grey;
    loserMultiplier = repeat;
  }

  const tasks: Promise<unknown>[] = [];
  if (winnerValid) {
    tasks.push(
      updateWinner(opts.winner.userId, winnerMultiplier, winnerXpBonus).then(
        (res) => {
          if (res)
            results.set(opts.winner.socketId, {
              ...res,
              rewardNotes: winnerNotes,
            });
        },
      ),
    );
  }
  if (loserValid) {
    const loserSocketId = opts.loser!.socketId;
    tasks.push(
      updateLoser(opts.loser!.userId, loserMultiplier).then((res) => {
        if (res) results.set(loserSocketId, { ...res, rewardNotes: loserNotes });
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
): Promise<Omit<MatchResult, "rewardNotes"> | null> {
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
): Promise<Omit<MatchResult, "rewardNotes"> | null> {
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

  // A win by forfeit is a real win (stats and streak), but earns no XP so two
  // accounts cannot farm levels by deserting on purpose
  let opponentPoints: number | null = null;
  if (mongoose.Types.ObjectId.isValid(opts.opponent.userId)) {
    const before = await User.findById(opts.opponent.userId).select(
      "stats.currentStreak stats.bestStreak",
    );
    if (before) {
      const newStreak = (before.stats.currentStreak ?? 0) + 1;
      const opponent = await User.findByIdAndUpdate(
        opts.opponent.userId,
        {
          $inc: {
            points: effectivePenalty,
            "stats.wins": 1,
            "stats.totalGames": 1,
          },
          $set: {
            "stats.currentStreak": newStreak,
            "stats.bestStreak": Math.max(before.stats.bestStreak ?? 0, newStreak),
          },
        },
        { new: true },
      ).select("points");
      opponentPoints = opponent?.points ?? null;
    }
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
      endedAt: new Date(),
    });
  } catch (err) {
    console.error("[saveGameRecord] erreur:", err);
  }
}
