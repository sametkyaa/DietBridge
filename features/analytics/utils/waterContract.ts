export const DAILY_WATER_MAX_LITERS = 10;
export const DAILY_WATER_GOAL_MAX_ML = DAILY_WATER_MAX_LITERS * 1000;

const NUMERIC_PATTERN = /^-?\d+(?:\.\d+)?$/;

export const hasRawDailyWaterValue = (value: unknown): boolean => (
  value !== null && value !== undefined && value !== ''
);

export const parseDailyWaterLiters = (value: unknown): number | null => {
  if (!hasRawDailyWaterValue(value)) return null;

  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && NUMERIC_PATTERN.test(value.trim())
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
};

export const isValidDailyWaterLiters = (value: unknown): value is number => {
  const parsed = parseDailyWaterLiters(value);
  return parsed !== null
    && parsed >= 0
    && parsed <= DAILY_WATER_MAX_LITERS;
};
