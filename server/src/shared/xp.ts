export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

export function xpPercent(level: number, xp: number): number {
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
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    levelsGained++;
  }
  return { level, xp, levelsGained };
}
