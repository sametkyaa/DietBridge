import { isValidUuid } from '../../../shared/utils/uuid';
import { MEAL_ACTIVITY_KIND, MealActivity } from '../types/mealActivity';

export const createMealActivityId = (mealId: string): string => `meal_activity:${mealId}`;

export const isMealActivity = (value: unknown): value is MealActivity => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const activity = value as Partial<MealActivity>;
  return activity.kind === MEAL_ACTIVITY_KIND
    && typeof activity.id === 'string'
    && activity.id === createMealActivityId(activity.mealId ?? '')
    && isValidUuid(activity.relationId)
    && isValidUuid(activity.conversationId)
    && isValidUuid(activity.clientId)
    && isValidUuid(activity.dietitianId)
    && isValidUuid(activity.mealId)
    && isValidUuid(activity.planId)
    && typeof activity.mealDate === 'string'
    && typeof activity.mealType === 'string'
    && typeof activity.mealTitle === 'string'
    && typeof activity.mealTime === 'string'
    && typeof activity.completedAt === 'string'
    && activity.createdAt === activity.completedAt
    && (activity.photoPath === null || typeof activity.photoPath === 'string')
    && activity.isHumanMessage === false
    && activity.requiresRead === false;
};
export const compareMealActivities = (left: MealActivity, right: MealActivity): number => (
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
);

export const mergeMealActivities = (
  current: readonly MealActivity[],
  incoming: readonly MealActivity[],
): MealActivity[] => {
  const byMealId = new Map<string, MealActivity>();
  [...current, ...incoming].forEach((activity) => {
    if (isMealActivity(activity)) byMealId.set(activity.mealId, activity);
  });
  return [...byMealId.values()].sort(compareMealActivities);
};
