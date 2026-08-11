import type {
  AnalyticsAdherencePoint,
  AnalyticsDateRange,
  AnalyticsDateRangeKey,
  AnalyticsMeal,
  AnalyticsMealPlan,
  AnalyticsMealType,
  AnalyticsMealTypeAdherence,
  AnalyticsSourceData,
  AnalyticsTrendPoint,
  AnalyticsWaterSummary,
  BodyMeasurementField,
  BodyMeasurementTrend,
  ClientAnalyticsReport,
  PlannedNutritionMetric,
} from '../types/analytics';
import { ANALYTICS_DATE_RANGE_KEYS, BODY_MEASUREMENT_FIELDS } from '../types/analytics';

export const ANALYTICS_TIME_ZONE = 'Europe/Istanbul';
export const ANALYTICS_MAX_WATER_ML = 10_000;
export const ANALYTICS_MAX_MEAL_CALORIES = 10_000;
export const ANALYTICS_MAX_MACRO_GRAMS = 1_000;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEIGHT_MIN_KG = 20;
const WEIGHT_MAX_KG = 500;
const BODY_MEASUREMENT_MAX_CM = 500;
const MEAL_TYPES: readonly AnalyticsMealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const isBoundedNonNegativeMetric = (value: number | null, maximum: number): value is number => (
  value !== null && Number.isFinite(value) && value >= 0 && value <= maximum
);

const safeFiniteSum = (values: number[]): number | null => {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
};

const dateFromKey = (value: string): Date => {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new Error('INVALID_ANALYTICS_DATE');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error('INVALID_ANALYTICS_DATE');
  }
  return date;
};

const keyFromDate = (value: Date): string => (
  `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
);

export const isAnalyticsDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    dateFromKey(value);
    return true;
  } catch {
    return false;
  }
};

export const isAnalyticsDateRangeKey = (value: unknown): value is AnalyticsDateRangeKey => (
  typeof value === 'string'
  && (ANALYTICS_DATE_RANGE_KEYS as readonly string[]).includes(value)
);

export const getIstanbulDateKey = (now: Date = new Date()): string => {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_ANALYTICS_NOW');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const addAnalyticsDays = (date: string, amount: number): string => {
  if (!Number.isInteger(amount)) throw new Error('INVALID_ANALYTICS_DAY_OFFSET');
  const parsed = dateFromKey(date);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return keyFromDate(parsed);
};

const subtractCalendarMonths = (date: string, amount: number): string => {
  const parsed = dateFromKey(date);
  const originalDay = parsed.getUTCDate();
  const target = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() - amount, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(originalDay, lastDay));
  return keyFromDate(target);
};

export const resolveAnalyticsDateRange = (
  key: AnalyticsDateRangeKey,
  now: Date = new Date(),
): AnalyticsDateRange => {
  const endDate = getIstanbulDateKey(now);
  switch (key) {
    case '7d':
      return { key, startDate: addAnalyticsDays(endDate, -6), endDate };
    case '30d':
      return { key, startDate: addAnalyticsDays(endDate, -29), endDate };
    case '3m':
      return { key, startDate: addAnalyticsDays(subtractCalendarMonths(endDate, 3), 1), endDate };
    case 'all':
      return { key, startDate: null, endDate };
  }
};

export const countAnalyticsRangeDays = (range: AnalyticsDateRange): number | null => {
  if (range.startDate === null) return null;
  const start = dateFromKey(range.startDate).getTime();
  const end = dateFromKey(range.endDate).getTime();
  if (end < start) throw new Error('INVALID_ANALYTICS_RANGE');
  return Math.floor((end - start) / 86_400_000) + 1;
};

const percentage = (completed: number, planned: number): number | null => (
  planned === 0 ? null : (completed / planned) * 100
);

const validWeight = (value: number | null): value is number => (
  value !== null && Number.isFinite(value) && value >= WEIGHT_MIN_KG && value <= WEIGHT_MAX_KG
);

const validBodyMeasurement = (value: number | null): value is number => (
  value !== null && Number.isFinite(value) && value > 0 && value <= BODY_MEASUREMENT_MAX_CM
);

const startOfAnalyticsWeek = (date: string): string => {
  const parsed = dateFromKey(date);
  const day = parsed.getUTCDay();
  return addAnalyticsDays(date, -(day === 0 ? 6 : day - 1));
};

const aggregateAdherence = (
  mealPlans: AnalyticsMealPlan[],
  periodStart: (date: string) => string,
  periodEnd: (start: string) => string,
): AnalyticsAdherencePoint[] => {
  const buckets = new Map<string, { planned: number; completed: number }>();
  for (const plan of mealPlans) {
    const start = periodStart(plan.date);
    const bucket = buckets.get(start) ?? { planned: 0, completed: 0 };
    bucket.planned += plan.meals.length;
    bucket.completed += plan.meals.filter((meal) => meal.isCompleted).length;
    buckets.set(start, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, bucket]) => ({
      periodStart: period,
      periodEnd: periodEnd(period),
      planned: bucket.planned,
      completed: bucket.completed,
      percentage: percentage(bucket.completed, bucket.planned),
    }));
};

const clampAdherencePointsToRange = (
  points: AnalyticsAdherencePoint[],
  range: AnalyticsDateRange,
): AnalyticsAdherencePoint[] => points.map((point) => ({
  ...point,
  periodStart: range.startDate !== null && point.periodStart < range.startDate
    ? range.startDate
    : point.periodStart,
  periodEnd: point.periodEnd > range.endDate ? range.endDate : point.periodEnd,
}));

const aggregateMealTypeAdherence = (mealPlans: AnalyticsMealPlan[]): AnalyticsMealTypeAdherence[] => (
  MEAL_TYPES.map((type) => {
    const meals = mealPlans.flatMap((plan) => plan.meals).filter((meal) => meal.type === type);
    const completed = meals.filter((meal) => meal.isCompleted).length;
    return { type, planned: meals.length, completed, percentage: percentage(completed, meals.length) };
  })
);

const plannedMetric = (
  meals: AnalyticsMeal[],
  value: (meal: AnalyticsMeal) => number | null,
  maximum: number,
): PlannedNutritionMetric => {
  const covered = meals.map(value).filter((item): item is number => isBoundedNonNegativeMetric(item, maximum));
  const total = covered.length === 0 ? null : safeFiniteSum(covered);
  return {
    total,
    coveredMeals: covered.length,
    totalMeals: meals.length,
    isComplete: meals.length > 0 && covered.length === meals.length && total !== null,
  };
};

const waterSummary = (
  logs: AnalyticsSourceData['dailyLogs'],
  goalMl: number | null,
  range: AnalyticsDateRange,
): AnalyticsWaterSummary => {
  const tracked = logs.filter((log) => isBoundedNonNegativeMetric(log.waterMl, ANALYTICS_MAX_WATER_ML));
  const values = tracked.map((log) => log.waterMl as number);
  const goalIsValid = isBoundedNonNegativeMetric(goalMl, ANALYTICS_MAX_WATER_ML) && goalMl > 0;
  const achievedGoalDays = goalIsValid ? values.filter((value) => value >= goalMl).length : 0;
  const totalWaterMl = safeFiniteSum(values);
  return {
    averageMl: values.length === 0 || totalWaterMl === null ? null : totalWaterMl / values.length,
    latestMl: tracked.length === 0 ? null : tracked[tracked.length - 1].waterMl,
    goalMl: goalIsValid ? goalMl : null,
    trackedDays: tracked.length,
    periodDays: countAnalyticsRangeDays(range),
    achievedGoalDays,
    goalEligibleDays: goalIsValid ? tracked.length : 0,
    goalAchievementPercentage: goalIsValid ? percentage(achievedGoalDays, tracked.length) : null,
  };
};

export const aggregateClientAnalytics = (source: AnalyticsSourceData): ClientAnalyticsReport => {
  const measurements = [...source.measurements].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const logs = [...source.dailyLogs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const plans = [...source.mealPlans].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const latestWeightRow = source.latestWeightMeasurement;
  const latestWeight = validWeight(latestWeightRow?.weight ?? null)
    ? latestWeightRow?.weight ?? null
    : null;
  const currentWeight = latestWeight ?? (validWeight(source.profile.currentWeight) ? source.profile.currentWeight : null);
  const earliestMeasuredWeight = validWeight(source.earliestWeightMeasurement?.weight ?? null)
    ? source.earliestWeightMeasurement?.weight ?? null
    : null;
  const startWeight = validWeight(source.profile.startWeight) ? source.profile.startWeight : earliestMeasuredWeight;
  const targetWeight = validWeight(source.profile.targetWeight) ? source.profile.targetWeight : null;
  const allMeals = plans.flatMap((plan) => plan.meals);
  const completedMeals = allMeals.filter((meal) => meal.isCompleted).length;

  const weightTrend: AnalyticsTrendPoint[] = measurements
    .filter((measurement) => validWeight(measurement.weight))
    .map((measurement) => ({ date: measurement.date, value: measurement.weight as number }));
  const bodyMeasurementTrends: BodyMeasurementTrend[] = BODY_MEASUREMENT_FIELDS.map((field: BodyMeasurementField) => ({
    field,
    points: measurements
      .filter((measurement) => validBodyMeasurement(measurement[field]))
      .map((measurement) => ({ date: measurement.date, value: measurement[field] as number })),
  }));
  const nutrition = {
    calories: plannedMetric(allMeals, (meal) => meal.calories, ANALYTICS_MAX_MEAL_CALORIES),
    protein: plannedMetric(allMeals, (meal) => meal.protein, ANALYTICS_MAX_MACRO_GRAMS),
    carbs: plannedMetric(allMeals, (meal) => meal.carbs, ANALYTICS_MAX_MACRO_GRAMS),
    fat: plannedMetric(allMeals, (meal) => meal.fat, ANALYTICS_MAX_MACRO_GRAMS),
  };

  return {
    clientId: source.clientId,
    dietitianId: source.dietitianId,
    range: source.range,
    kpis: {
      currentWeight,
      startWeight,
      weightChange: currentWeight !== null && startWeight !== null ? currentWeight - startWeight : null,
      targetWeight,
      targetGap: currentWeight !== null && targetWeight !== null ? currentWeight - targetWeight : null,
      lastMeasurementDate: source.latestMeasurement?.date ?? null,
      plannedMeals: allMeals.length,
      completedMeals,
      mealAdherencePercentage: percentage(completedMeals, allMeals.length),
      water: waterSummary(logs, source.profile.waterGoalMl, source.range),
    },
    weightTrend,
    bodyMeasurementTrends,
    waterTrend: logs
      .filter((log) => isBoundedNonNegativeMetric(log.waterMl, ANALYTICS_MAX_WATER_ML))
      .map((log) => ({ date: log.date, value: log.waterMl as number })),
    dailyAdherence: aggregateAdherence(plans, (date) => date, (date) => date),
    weeklyAdherence: clampAdherencePointsToRange(
      aggregateAdherence(plans, startOfAnalyticsWeek, (start) => addAnalyticsDays(start, 6)),
      source.range,
    ),
    mealTypeAdherence: aggregateMealTypeAdherence(plans),
    plannedNutrition: nutrition,
    dataQuality: {
      invalidWaterRows: logs.filter((log) => (
        log.hasInvalidWaterValue
        || (log.waterMl !== null && !isBoundedNonNegativeMetric(log.waterMl, ANALYTICS_MAX_WATER_ML))
      )).length,
      invalidCompletionRows: allMeals.filter((meal) => !meal.hasCompletionValue).length,
      incompleteCalorieMeals: allMeals.length - nutrition.calories.coveredMeals,
      incompleteMacroMeals: allMeals.filter((meal) => (
        !isBoundedNonNegativeMetric(meal.protein, ANALYTICS_MAX_MACRO_GRAMS)
        || !isBoundedNonNegativeMetric(meal.carbs, ANALYTICS_MAX_MACRO_GRAMS)
        || !isBoundedNonNegativeMetric(meal.fat, ANALYTICS_MAX_MACRO_GRAMS)
      )).length,
    },
  };
};
