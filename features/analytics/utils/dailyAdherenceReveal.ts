import type { AnalyticsAdherencePoint } from '../types/analytics';

export const DAILY_ADHERENCE_REVEAL_STEP = 7;

export interface DailyAdherenceReveal {
  visiblePoints: AnalyticsAdherencePoint[];
  hasMore: boolean;
}

const safeInteger = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
);

export const getDailyAdherenceReveal = (
  points: readonly AnalyticsAdherencePoint[],
  visibleCount = DAILY_ADHERENCE_REVEAL_STEP,
): DailyAdherenceReveal => {
  const count = Math.min(points.length, safeInteger(visibleCount));
  const visiblePoints = count === 0 ? [] : points.slice(-count);
  return {
    visiblePoints,
    hasMore: count < points.length,
  };
};

export const getNextDailyAdherenceVisibleCount = (
  visibleCount: number,
  totalCount: number,
): number => Math.min(
  safeInteger(totalCount),
  safeInteger(visibleCount) + DAILY_ADHERENCE_REVEAL_STEP,
);
