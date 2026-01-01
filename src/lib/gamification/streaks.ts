
import { differenceInDays, isSameDay, subDays } from 'date-fns';

/**
 * Calculates the new streak count based on current streak and last activity date
 */
export function calculateNewStreak(currentStreak: number, lastReadAt: Date | null): number {
  const now = new Date();
  
  if (!lastReadAt) {
    return 1;
  }

  // If already read today, streak remains the same
  if (isSameDay(lastReadAt, now)) {
    return currentStreak || 1;
  }

  // If read yesterday, increment streak
  const yesterday = subDays(now, 1);
  if (isSameDay(lastReadAt, yesterday)) {
    return (currentStreak || 0) + 1;
  }

  // Otherwise, streak reset to 1
  return 1;
}

/**
 * Calculates XP bonus based on current streak
 * e.g., +5 XP per day of streak, capped at 50
 */
export function calculateStreakBonus(streak: number): number {
  return Math.min(streak * 5, 50);
}
