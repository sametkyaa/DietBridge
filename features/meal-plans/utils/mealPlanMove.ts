import type { CanonicalMealMacros } from '../services/mealPlanService';

export const RECIPE_DRAG_DATA_TYPE = 'application/x-dietbridge-recipe-id';
export const PLANNED_MEAL_DRAG_DATA_TYPE = 'application/x-dietbridge-planned-meal';

export interface PlannedMealContent {
  id: string;
  mealId?: string;
  name: string;
  image: string | null;
  imagePreview?: string | null;
  pendingPhoto?: File | null;
  calories: number | null;
  description?: string | null;
  macros: CanonicalMealMacros;
  source?: 'manual' | 'recipe';
  recipeId?: string | null;
  snapshotMode?: 'recipe_master' | 'custom';
  isEaten?: boolean;
}

export type PlanCellContent = PlannedMealContent | string | null;
export type PlanState = Record<string, Record<string, PlanCellContent>>;

export interface MealPlanCellRef {
  day: string;
  mealId: string;
}

export type MealPlanMoveStatus = 'moved' | 'swapped' | 'noop' | 'blocked';
export type MealPlanMoveReason = 'SOURCE_NOT_FOUND' | 'SOURCE_COMPLETED' | 'TARGET_COMPLETED';

export interface MealPlanMoveResult {
  status: MealPlanMoveStatus;
  nextPlan: PlanState;
  reason?: MealPlanMoveReason;
}

export const isPlannedMealContent = (value: PlanCellContent | undefined): value is PlannedMealContent => (
  typeof value === 'object' && value !== null
);

export const isCompletedMealContent = (value: PlanCellContent | undefined): boolean => (
  isPlannedMealContent(value) && value.isEaten === true
);

export const serializePlannedMealDragSource = (source: MealPlanCellRef): string => (
  JSON.stringify({ day: source.day, mealId: source.mealId })
);

export const parsePlannedMealDragSource = (value: string): MealPlanCellRef | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || typeof (parsed as { day?: unknown }).day !== 'string'
      || typeof (parsed as { mealId?: unknown }).mealId !== 'string'
      || !(parsed as { day: string }).day
      || !(parsed as { mealId: string }).mealId
    ) return null;

    return {
      day: (parsed as { day: string }).day,
      mealId: (parsed as { mealId: string }).mealId,
    };
  } catch {
    return null;
  }
};

const cloneDay = (plan: PlanState, day: string): Record<string, PlanCellContent> => ({
  ...(plan[day] ?? {}),
});

const result = (
  status: MealPlanMoveStatus,
  nextPlan: PlanState,
  reason?: MealPlanMoveReason,
): MealPlanMoveResult => ({ status, nextPlan, ...(reason ? { reason } : {}) });

/**
 * Moves or swaps the existing editor snapshot at source into target.
 * Cell content references are intentionally preserved so snapshots and
 * pending photo files travel with their card without being reconstructed.
 */
export const moveMealPlanContent = (
  currentPlan: PlanState,
  source: MealPlanCellRef,
  target: MealPlanCellRef,
): MealPlanMoveResult => {
  if (source.day === target.day && source.mealId === target.mealId) {
    return result('noop', currentPlan);
  }

  const sourceContent = currentPlan[source.day]?.[source.mealId];
  if (sourceContent === undefined || sourceContent === null) {
    return result('noop', currentPlan, 'SOURCE_NOT_FOUND');
  }

  if (isCompletedMealContent(sourceContent)) {
    return result('blocked', currentPlan, 'SOURCE_COMPLETED');
  }

  const targetContent = currentPlan[target.day]?.[target.mealId];
  if (isCompletedMealContent(targetContent)) {
    return result('blocked', currentPlan, 'TARGET_COMPLETED');
  }

  const nextPlan: PlanState = { ...currentPlan };
  if (source.day === target.day) {
    const nextDay = cloneDay(currentPlan, source.day);
    if (targetContent === undefined || targetContent === null) {
      delete nextDay[source.mealId];
      nextDay[target.mealId] = sourceContent;
      nextPlan[source.day] = nextDay;
      return result('moved', nextPlan);
    }

    nextDay[source.mealId] = targetContent;
    nextDay[target.mealId] = sourceContent;
    nextPlan[source.day] = nextDay;
    return result('swapped', nextPlan);
  }

  const nextSourceDay = cloneDay(currentPlan, source.day);
  const nextTargetDay = cloneDay(currentPlan, target.day);
  delete nextSourceDay[source.mealId];
  nextTargetDay[target.mealId] = sourceContent;
  nextPlan[source.day] = nextSourceDay;

  if (targetContent === undefined || targetContent === null) {
    nextPlan[target.day] = nextTargetDay;
    return result('moved', nextPlan);
  }

  nextPlan[source.day][source.mealId] = targetContent;
  nextPlan[target.day] = nextTargetDay;
  return result('swapped', nextPlan);
};
