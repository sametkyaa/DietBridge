/**
 * `meals.time` is a nullable `time` column. Legacy rows may have no planned
 * time; they stay visible, sort after timed meals and render this label.
 */
export const MEAL_TIME_MISSING_LABEL = 'Saat yok';

const hasMealTime = (value: string | null | undefined): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

/** Orders HH:MM times ascending and places meals without a time last. */
export const compareOptionalMealTimes = (
  left: string | null | undefined,
  right: string | null | undefined,
): number => {
  const leftHasTime = hasMealTime(left);
  const rightHasTime = hasMealTime(right);
  if (leftHasTime && rightHasTime) return left.localeCompare(right);
  if (leftHasTime) return -1;
  if (rightHasTime) return 1;
  return 0;
};

export const formatOptionalMealTime = (value: string | null | undefined): string => (
  hasMealTime(value) ? value : MEAL_TIME_MISSING_LABEL
);
