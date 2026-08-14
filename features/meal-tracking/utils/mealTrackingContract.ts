import {
  addAnalyticsDays,
  ANALYTICS_TIME_ZONE,
  getIstanbulDateKey,
  isAnalyticsDate,
} from '../../analytics/utils/analyticsContract';
import type {
  MealTrackingDay,
  MealTrackingFilter,
  MealTrackingMeal,
  MealTrackingMealStatus,
} from '../types/mealTracking';

export { ANALYTICS_TIME_ZONE };

export const MEAL_TYPE_LABELS: Readonly<Record<MealTrackingMeal['type'], string>> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara Öğün',
};
const formatDateParts = (date: string): { year: number; month: number; day: number } => {
  if (!isAnalyticsDate(date)) throw new Error('INVALID_MEAL_TRACKING_DATE');
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
};

export const formatMealTrackingDate = (date: string): string => {
  const { year, month, day } = formatDateParts(date);
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ANALYTICS_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
};

export const formatMealTrackingCompletionTime = (value: string | null): string | null => {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ANALYTICS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
};

export const getMealTrackingRange = (
  filter: MealTrackingFilter,
  selectedDate?: string,
  now: Date = new Date(),
): { startDate: string; endDate: string } => {
  const today = getIstanbulDateKey(now);
  if (filter === 'today') return { startDate: today, endDate: today };
  if (filter === '7d') return { startDate: addAnalyticsDays(today, -6), endDate: today };

  if (!selectedDate || !isAnalyticsDate(selectedDate)) {
    throw new Error('INVALID_MEAL_TRACKING_DATE');
  }
  return { startDate: selectedDate, endDate: selectedDate };
};

export const getMealTrackingStatus = (
  meal: Pick<MealTrackingMeal, 'isCompleted'>,
  day: string,
  today: string,
): MealTrackingMealStatus => {
  if (meal.isCompleted) return 'completed';
  return day < today ? 'unmarked' : 'pending';
};

export const summarizeMealTrackingDay = (
  date: string,
  meals: MealTrackingMeal[],
): MealTrackingDay => {
  const plannedCount = meals.length;
  const completedCount = meals.filter((meal) => meal.isCompleted).length;
  return {
    date,
    meals,
    completedCount,
    plannedCount,
    percentage: plannedCount === 0 ? null : Math.round((completedCount / plannedCount) * 100),
  };
};

export const groupMealTrackingDays = (
  plans: ReadonlyArray<{ date: string; meals: MealTrackingMeal[] }>,
): MealTrackingDay[] => {
  const byDate = new Map<string, MealTrackingMeal[]>();
  plans.forEach((plan) => {
    const meals = byDate.get(plan.date) ?? [];
    meals.push(...plan.meals);
    byDate.set(plan.date, meals);
  });

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, meals]) => summarizeMealTrackingDay(date, [...meals].sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.time.localeCompare(right.time)
      || left.id.localeCompare(right.id)
    ))));
};
