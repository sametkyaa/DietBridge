import type { PlanState } from './mealPlanMove';
import { isPlannedMealContent } from './mealPlanMove';

export type DailyCalorieStatus = 'none' | 'below' | 'within' | 'above';

export interface DailyCalorieTotal {
  day: string;
  calories: number;
  mealCount: number;
  /** Meals in the day without a positive calorie value; they are not estimated. */
  missingCalories: number;
  status: DailyCalorieStatus;
}

export interface CalorieTargetBand {
  minKcal: number | null;
  maxKcal: number | null;
}

/**
 * Planned kcal per day from the meals currently in the editor (saved or not).
 * Missing calories are counted, never guessed; the target band comes from
 * client_nutrition_targets and is compared only when one exists.
 */
export const summarizeDailyCalories = (
  days: readonly string[],
  rowIds: readonly string[],
  weeklyPlan: PlanState,
  target: CalorieTargetBand | null,
): DailyCalorieTotal[] => days.map((day) => {
  const dayPlan = weeklyPlan[day] ?? {};
  let calories = 0;
  let mealCount = 0;
  let missingCalories = 0;
  for (const rowId of rowIds) {
    const content = dayPlan[rowId];
    if (!isPlannedMealContent(content)) continue;
    mealCount += 1;
    if (typeof content.calories === 'number' && Number.isFinite(content.calories) && content.calories > 0) {
      calories += content.calories;
    } else {
      missingCalories += 1;
    }
  }
  let status: DailyCalorieStatus = 'none';
  if (target && mealCount > 0 && (target.minKcal !== null || target.maxKcal !== null)) {
    if (target.minKcal !== null && calories < target.minKcal) status = 'below';
    else if (target.maxKcal !== null && calories > target.maxKcal) status = 'above';
    else status = 'within';
  }
  return { day, calories: Math.round(calories), mealCount, missingCalories, status };
});

const normalizeTerm = (value: string): string => value.trim().toLocaleLowerCase('tr-TR');

/**
 * Intolerances / disliked foods the client entered that literally appear in a
 * meal's title or description. Plain text match only (min. 3 letters); it is
 * a reminder for the dietitian, not a clinical check.
 */
export const findDietaryConflicts = (
  text: string,
  intolerances: readonly string[],
  dislikedFoods: readonly string[],
): { intolerances: string[]; dislikes: string[] } => {
  const haystack = normalizeTerm(text);
  if (!haystack) return { intolerances: [], dislikes: [] };
  const matches = (terms: readonly string[]) => terms.filter((term) => {
    const needle = normalizeTerm(term);
    return needle.length >= 3 && haystack.includes(needle);
  });
  return { intolerances: matches(intolerances), dislikes: matches(dislikedFoods) };
};
