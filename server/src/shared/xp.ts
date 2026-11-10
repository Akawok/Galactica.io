export const MAX_LEVEL = 60;

export function xpForLevel(level: number): number {
  // Capped so that even high levels never take more than a handful of wins
  return Math.min(100 + 15 * (level - 1), 600);
}

export function xpPercent(level: number, xp: number): number {
  if (level >= MAX_LEVEL) return 100;
  return Math.min(100, Math.floor((xp / xpForLevel(level)) * 100));
}

export function applyXP(
  currentLevel: number,
  currentXP: number,
  gained: number,
): { level: number; xp: number; levelsGained: number } {
  let level = currentLevel;
  let xp = currentXP + gained;
  let levelsGained = 0;
  while (level < MAX_LEVEL && xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    levelsGained++;
  }
  if (level >= MAX_LEVEL) xp = 0;
  return { level, xp, levelsGained };
}
