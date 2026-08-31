import {
  MealPlanValidationError,
  type CanonicalMealMacros,
  type WeeklyMealInput,
  type WeeklyMealPlanDayInput,
} from '../services/mealPlanService';
import type { PlanState, PlannedMealContent } from './mealPlanMove';

export interface MealPlanEditorRow {
  id: string;
  name: string;
  time: string;
}

export interface BuildWeeklyMealPlanPayloadOptions {
  days: readonly string[];
  weekDates: readonly string[];
  meals: readonly MealPlanEditorRow[];
  weeklyPlan: PlanState;
  planNotes?: Readonly<Record<string, string | null>>;
  mapMealTypeToDb: (uiName: string) => WeeklyMealInput['type'];
  normalizeMealTime: (value: unknown, field?: string) => string;
  normalizeCanonicalMealMacros: (value: unknown, field?: string) => CanonicalMealMacros;
  resolvePhotoUrl?: (content: PlannedMealContent, day: string, mealId: string) => string | null;
}

/**
 * Builds the exact seven-day editor payload from the current cell placement.
 * The content snapshot stays untouched; row/day placement is read from the
 * current target cell so moved and swapped cards save under their new slot.
 */
export const buildWeeklyMealPlanPayload = ({
  days,
  weekDates,
  meals,
  weeklyPlan,
  planNotes,
  mapMealTypeToDb,
  normalizeMealTime,
  normalizeCanonicalMealMacros,
  resolvePhotoUrl,
}: BuildWeeklyMealPlanPayloadOptions): WeeklyMealPlanDayInput[] => {
  if (days.length !== weekDates.length) {
    throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', 'days');
  }

  return weekDates.map((dateStr, index) => {
    const dayName = days[index];
    const dayPlan = weeklyPlan[dayName];
    const dayMeals: WeeklyMealInput[] = [];

    if (dayPlan) {
      for (const mealId of Object.keys(dayPlan)) {
        const content = dayPlan[mealId];
        const mealRow = meals.find((meal) => meal.id === mealId);
        if (!mealRow || content === undefined || content === null) continue;

        if (typeof content === 'string') {
          throw new MealPlanValidationError('INVALID_MEAL_MACROS', `days[${index}].meals[${mealId}].macros`);
        }

        const mealData: WeeklyMealInput = {
          type: mapMealTypeToDb(mealRow.name),
          title: content.name,
          sort_order: meals.findIndex((meal) => meal.id === mealRow.id),
          time: normalizeMealTime(mealRow.time, `days[${index}].meals[${mealId}].time`),
          macros: normalizeCanonicalMealMacros(content.macros, `days[${index}].meals[${mealId}].macros`),
          description: content.description ?? null,
          source: content.source ?? 'manual',
          recipe_id: content.source === 'recipe' ? content.recipeId ?? null : null,
          calories: content.calories,
          photo_url: resolvePhotoUrl?.(content, dayName, mealId) ?? null,
        };

        if (content.mealId) mealData.id = content.mealId;
        if (content.source === 'recipe' && content.snapshotMode) {
          mealData.snapshot_mode = content.snapshotMode;
        }
        dayMeals.push(mealData);
      }
    }

    return {
      plan_date: dateStr,
      notes: planNotes?.[dayName] ?? null,
      meals: dayMeals,
    };
  });
};
