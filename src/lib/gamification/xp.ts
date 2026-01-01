
export const XP_PER_CHAPTER = 10;
export const XP_SERIES_COMPLETED = 100;
export const XP_DAILY_STREAK_BONUS = 5;

/**
 * Calculates current level based on total XP
 * Formula: level = floor(sqrt(xp / 100)) + 1
 * Level 1: 0-99 XP
 * Level 2: 100-399 XP
 * Level 3: 400-899 XP
 */
export function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/**
 * Calculates XP required for a specific level
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.pow(level - 1, 2) * 100;
}

/**
 * Calculates progress within the current level (0 to 1)
 */
export function calculateLevelProgress(xp: number): number {
  const currentLevel = calculateLevel(xp);
  const currentLevelXp = xpForLevel(currentLevel);
  const nextLevelXp = xpForLevel(currentLevel + 1);
  
  const xpInCurrentLevel = xp - currentLevelXp;
  const xpNeededForNextLevel = nextLevelXp - currentLevelXp;
  
  return xpInCurrentLevel / xpNeededForNextLevel;
}
