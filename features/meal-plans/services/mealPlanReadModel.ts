const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MEAL_PLAN_WEEKDAY_LABELS = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
] as const;

export type MealPlanWeekdayLabel = (typeof MEAL_PLAN_WEEKDAY_LABELS)[number];

export class MealPlanReadModelError extends Error {
  public readonly field: string;

  constructor(field: string) {
    super('INVALID_PLAN_READ_MODEL');
    this.name = 'MealPlanReadModelError';
    this.field = field;
  }
}

export interface ReadModelMeal {
  id: string;
  sort_order: number;
  time: string;
}

export interface ReadModelPlan<TMeal extends ReadModelMeal = ReadModelMeal> {
  id: string;
  plan_date: string;
  meals: TMeal[];
}

const parseLocalDate = (value: string): Date => {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new MealPlanReadModelError('plan_date');
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    throw new MealPlanReadModelError('plan_date');
  }
  return parsed;
};

const toLocalIsoDate = (value: Date): string => (
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
);

export const normalizeMealPlanWeekStart = (value: string): string => {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toLocalIsoDate(date);
};

export const getMealPlanWeekDates = (weekStart: string): string[] => {
  const monday = parseLocalDate(normalizeMealPlanWeekStart(weekStart));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return toLocalIsoDate(date);
  });
};

export const shiftMealPlanWeek = (weekStart: string, offsetWeeks: number): string => {
  if (!Number.isInteger(offsetWeeks)) {
    throw new MealPlanReadModelError('week_offset');
  }
  const monday = parseLocalDate(normalizeMealPlanWeekStart(weekStart));
  monday.setDate(monday.getDate() + (offsetWeeks * 7));
  return toLocalIsoDate(monday);
};

export const sortReadModelMeals = <TMeal extends ReadModelMeal>(meals: TMeal[]): TMeal[] => {
  const seenSortOrders = new Set<number>();
  for (const meal of meals) {
    if (
      !Number.isInteger(meal.sort_order)
      || meal.sort_order < 0
      || seenSortOrders.has(meal.sort_order)
    ) {
      throw new MealPlanReadModelError('meals.sort_order');
    }
    seenSortOrders.add(meal.sort_order);
  }

  return [...meals].sort((left, right) => (
    left.sort_order - right.sort_order
    || left.time.localeCompare(right.time)
    || left.id.localeCompare(right.id)
  ));
};

export const mapWeeklyPlansByDate = <TMeal extends ReadModelMeal, TPlan extends ReadModelPlan<TMeal>>(
  plans: TPlan[],
  weekStart: string,
): Map<string, TPlan & { meals: TMeal[] }> => {
  const expectedDates = new Set(getMealPlanWeekDates(weekStart));
  const result = new Map<string, TPlan & { meals: TMeal[] }>();

  for (const plan of plans) {
    if (!expectedDates.has(plan.plan_date) || result.has(plan.plan_date)) {
      throw new MealPlanReadModelError('meal_plans.plan_date');
    }
    result.set(plan.plan_date, { ...plan, meals: sortReadModelMeals(plan.meals) });
  }

  return result;
};
