import {
  addAnalyticsDays,
  ANALYTICS_TIME_ZONE,
  getIstanbulDateKey,
  isAnalyticsDate,
} from '../../analytics/utils/analyticsContract';
import { compareOptionalMealTimes, formatOptionalMealTime } from '../../../shared/utils/mealTime';
import type {
  MealTrackingDay,
  MealTrackingFilter,
  MealTrackingMeal,
  MealTrackingMealStatus,
  MealTrackingOverviewClient,
  MealTrackingOverviewMealEntry,
  MealTrackingOverviewSummaryEntry,
  MealTrackingOverviewTypeEntry,
  MealTrackingOverviewTypeStatus,
  MealTrackingOverviewView,
} from '../types/mealTracking';

export { ANALYTICS_TIME_ZONE };

export const MEAL_TYPE_LABELS: Readonly<Record<MealTrackingMeal['type'], string>> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara Öğün',
};

const CANONICAL_MEAL_TYPE_ORDER: readonly MealTrackingMeal['type'][] = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
];

const compareMealOrder = (left: MealTrackingMeal, right: MealTrackingMeal): number => (
  left.sortOrder - right.sortOrder
  || compareOptionalMealTimes(left.time, right.time)
  || left.id.localeCompare(right.id)
);

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

export const formatMealTrackingLastCompletedAt = (
  value: string | null,
  today: string = getIstanbulDateKey(),
): string | null => {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || !isAnalyticsDate(today)) return null;

  const dateKey = getIstanbulDateKey(timestamp);
  const time = formatMealTrackingCompletionTime(value);
  if (!time) return null;
  if (dateKey === today) return `Bugün, ${time}`;
  if (dateKey === addAnalyticsDays(today, -1)) return `Dün, ${time}`;

  const date = new Intl.DateTimeFormat('tr-TR', {
    timeZone: ANALYTICS_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    ...(dateKey.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' as const } : {}),
  }).format(timestamp);
  return `${date}, ${time}`;
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

export const getMealTrackingOverviewTypeStatus = (
  completedCount: number,
  plannedCount: number,
): MealTrackingOverviewTypeStatus => {
  if (plannedCount <= 0 || completedCount === 0) return 'unmarked';
  if (completedCount === plannedCount) return 'complete';
  return 'partial';
};

const getLatestCompletionTimestamp = (
  meals: ReadonlyArray<MealTrackingMeal>,
): string | null => meals.reduce<string | null>((latest, meal) => {
  if (!meal.isCompleted || !meal.completedAt) return latest;
  if (!latest) return meal.completedAt;
  return new Date(meal.completedAt).getTime() > new Date(latest).getTime()
    ? meal.completedAt
    : latest;
}, null);

/** Slot name shown to the dietitian: slot_label when set, otherwise the meal type name. */
export const getMealSlotName = (meal: Pick<MealTrackingMeal, 'type' | 'slotLabel'>): string => (
  meal.slotLabel?.trim() || MEAL_TYPE_LABELS[meal.type]
);

/** A today meal whose planned time has passed and is still unmarked. */
export const isMealPastDue = (
  meal: { status: MealTrackingMealStatus; time: string | null },
  isToday: boolean,
  nowTime: string,
): boolean => meal.status === 'pending' && isToday && meal.time !== null && meal.time < nowTime;

const createTodayMealEntries = (
  meals: ReadonlyArray<MealTrackingMeal>,
  today: string,
): MealTrackingOverviewMealEntry[] => {
  const nameCounts = new Map<string, number>();
  meals.forEach((meal) => nameCounts.set(getMealSlotName(meal), (nameCounts.get(getMealSlotName(meal)) ?? 0) + 1));

  return [...meals]
    .sort(compareMealOrder)
    .map((meal) => ({
      kind: 'meal' as const,
      id: meal.id,
      type: meal.type,
      label: (nameCounts.get(getMealSlotName(meal)) ?? 0) > 1
        ? `${getMealSlotName(meal)} · ${formatOptionalMealTime(meal.time)}`
        : getMealSlotName(meal),
      time: meal.time,
      title: meal.title,
      status: getMealTrackingStatus(meal, meal.date, today),
      completedAt: meal.completedAt,
      hasCompletionPhoto: Boolean(meal.completionPhotoPath),
    }));
};

const createTypeEntries = (
  meals: ReadonlyArray<MealTrackingMeal>,
): MealTrackingOverviewTypeEntry[] => {
  type Aggregate = {
    type: MealTrackingMeal['type'];
    completedCount: number;
    plannedCount: number;
    firstMeal: MealTrackingMeal;
  };

  const byType = new Map<MealTrackingMeal['type'], Aggregate>();
  meals.forEach((meal) => {
    const current = byType.get(meal.type);
    if (!current) {
      byType.set(meal.type, {
        type: meal.type,
        completedCount: meal.isCompleted ? 1 : 0,
        plannedCount: 1,
        firstMeal: meal,
      });
      return;
    }

    current.completedCount += meal.isCompleted ? 1 : 0;
    current.plannedCount += 1;
    if (compareMealOrder(meal, current.firstMeal) < 0) current.firstMeal = meal;
  });

  return [...byType.values()]
    .sort((left, right) => (
      compareMealOrder(left.firstMeal, right.firstMeal)
      || CANONICAL_MEAL_TYPE_ORDER.indexOf(left.type) - CANONICAL_MEAL_TYPE_ORDER.indexOf(right.type)
    ))
    .map((entry) => ({
      kind: 'type' as const,
      type: entry.type,
      label: MEAL_TYPE_LABELS[entry.type],
      completedCount: entry.completedCount,
      plannedCount: entry.plannedCount,
      status: getMealTrackingOverviewTypeStatus(entry.completedCount, entry.plannedCount),
    }));
};

export const summarizeMealTrackingOverview = (
  client: Pick<MealTrackingOverviewClient, 'clientId' | 'displayName' | 'avatar'>,
  days: ReadonlyArray<MealTrackingDay>,
  view: MealTrackingOverviewView,
  today: string,
): MealTrackingOverviewClient => {
  const allMeals = days.flatMap((day) => day.meals);
  const completedCount = allMeals.filter((meal) => meal.isCompleted).length;
  const plannedCount = allMeals.length;
  const todayMeals = days.find((day) => day.date === today)?.meals ?? [];
  const mealSummary: MealTrackingOverviewSummaryEntry[] = view === 'today'
    ? createTodayMealEntries(todayMeals, today)
    : createTypeEntries(allMeals);

  return {
    ...client,
    completedCount,
    plannedCount,
    percentage: plannedCount === 0 ? null : Math.round((completedCount / plannedCount) * 100),
    mealSummary,
    lastCompletedAt: getLatestCompletionTimestamp(allMeals),
  };
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
    .map(([date, meals]) => summarizeMealTrackingDay(date, [...meals].sort(compareMealOrder)));
};

export interface MealTrackingOverviewKpis {
  clientCount: number;
  clientsWithPlan: number;
  plannedCount: number;
  completedCount: number;
  /** Today: unmarked meals whose time has passed. 7d: planned but not completed. */
  missedCount: number;
  missedClientCount: number;
  /** Today only: meals whose time has not come yet. */
  upcomingCount: number;
  nextTime: string | null;
}

/** Whether a client row needs attention: a past-due meal today, or any incomplete meal in 7 days. */
export const hasUnmarkedMeals = (
  client: MealTrackingOverviewClient,
  view: MealTrackingOverviewView,
  nowTime: string,
): boolean => {
  if (client.plannedCount === 0) return false;
  if (view === '7d') return client.completedCount < client.plannedCount;
  return client.mealSummary.some((entry) => entry.kind === 'meal' && isMealPastDue(entry, true, nowTime));
};

export const summarizeMealTrackingOverviewKpis = (
  clients: ReadonlyArray<MealTrackingOverviewClient>,
  view: MealTrackingOverviewView,
  nowTime: string,
): MealTrackingOverviewKpis => {
  let missedCount = 0;
  let upcomingCount = 0;
  let nextTime: string | null = null;
  let missedClientCount = 0;
  for (const client of clients) {
    if (view === '7d') {
      const missed = client.plannedCount - client.completedCount;
      missedCount += missed;
      if (missed > 0) missedClientCount += 1;
      continue;
    }
    let clientMissed = false;
    for (const entry of client.mealSummary) {
      if (entry.kind !== 'meal' || entry.status !== 'pending') continue;
      if (isMealPastDue(entry, true, nowTime)) {
        missedCount += 1;
        clientMissed = true;
      } else {
        upcomingCount += 1;
        if (entry.time && (!nextTime || entry.time < nextTime)) nextTime = entry.time;
      }
    }
    if (clientMissed) missedClientCount += 1;
  }
  return {
    clientCount: clients.length,
    clientsWithPlan: clients.filter((client) => client.plannedCount > 0).length,
    plannedCount: clients.reduce((sum, client) => sum + client.plannedCount, 0),
    completedCount: clients.reduce((sum, client) => sum + client.completedCount, 0),
    missedCount,
    missedClientCount,
    upcomingCount,
    nextTime,
  };
};
