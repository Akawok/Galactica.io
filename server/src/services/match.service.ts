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
}

/**
 * Met à jour les stats d'un gagnant et d'un perdant en parallèle.
 * Si `awardXP` est false (cas abandon : le perdant n'a pas combattu jusqu'au bout),
 * on n'octroie pas d'XP. Retourne un Map socketId → result quand l'XP est attribuée.
 */
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
    tasks.push(updateLoser(opts.loser.userId, opts.awardXP));
  }

  await Promise.all(tasks);
  return results;
}

async function updateWinner(userId: string, awardXP: boolean): Promise<MatchResult | null> {
  const before = await User.findById(userId).select(
    "xp level stats.currentStreak stats.bestStreak",
  );
  if (!before) return null;

  const xpGained = awardXP ? GAME_CONFIG.XP_PER_WIN : 0;
  const { level, xp, levelsGained } = applyXP(before.level, before.xp, xpGained);
  const newStreak = (before.stats.currentStreak ?? 0) + 1;
  const newBest = Math.max(before.stats.bestStreak ?? 0, newStreak);

  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        points: GAME_CONFIG.POINTS_PER_WIN,
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
  ).select("points xp level");

  if (!updated) return null;
  return {
    points: updated.points,
    xp: updated.xp,
    level: updated.level,
    xpGained,
    leveledUp: levelsGained > 0,
  };
}

async function updateLoser(userId: string, awardXP: boolean): Promise<MatchResult | null> {
  const before = await User.findById(userId).select("xp level");
  if (!before) return null;

  const xpGained = awardXP ? GAME_CONFIG.XP_PER_LOSS : 0;
  const { level, xp, levelsGained } = applyXP(before.level, before.xp, xpGained);

  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: { "stats.losses": 1, "stats.totalGames": 1 },
      $set: { xp, level, "stats.currentStreak": 0 },
    },
    { new: true },
  ).select("points xp level");

  if (!updated) return null;
  return {
    points: updated.points,
    xp: updated.xp,
    level: updated.level,
    xpGained,
    leveledUp: levelsGained > 0,
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
