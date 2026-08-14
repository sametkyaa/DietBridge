import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  isCanonicalRecipeImagePath,
} from '../../recipes/services/recipeService';
import { isReadableMealPhotoReference } from '../../meal-plans/services/mealPhotoService';
import { MEAL_ACTIVITY_KIND, MealActivity } from '../types/mealActivity';
import { createMealActivityId, mergeMealActivities } from '../utils/mealActivity';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
const MEAL_TYPES = new Set<MealActivity['mealType']>(['breakfast', 'lunch', 'dinner', 'snack']);

const ACTIVITY_SELECT = `
  id,
  client_id,
  dietitian_id,
  plan_date,
  meals (
    id,
    plan_id,
    type,
    title,
    time,
    sort_order,
    is_eaten,
    completed_at,
    photo_url
  )
`;

export type MealActivityServiceErrorCode = 'AUTHORIZATION' | 'FORBIDDEN' | 'FETCH' | 'CONTRACT';

export class MealActivityServiceError extends Error {
  public readonly code: MealActivityServiceErrorCode;

  constructor(code: MealActivityServiceErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MealActivityServiceError';
    this.code = code;
    this.cause = cause;
  }

  public readonly cause?: unknown;
}

const invalidPayload = (field: string): MealActivityServiceError => (
  new MealActivityServiceError('CONTRACT', `Geçersiz öğün aktivitesi alanı: ${field}`)
);

const normalizeIsoTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

const normalizeMealTime = (value: unknown): string => {
  if (typeof value !== 'string') throw invalidPayload('meal.time');
  const match = TIME_PATTERN.exec(value);
  if (!match) throw invalidPayload('meal.time');
  return `${match[1]}:${match[2]}`;
};

const normalizePhotoPath = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalidPayload('meal.photo_url');
  if (!isReadableMealPhotoReference(value) && !isCanonicalRecipeImagePath(value)) {
    throw invalidPayload('meal.photo_url');
  }
  return value;
};

const normalizeActivities = (
  data: unknown,
  relationId: string,
  conversationId: string,
  clientId: string,
  dietitianId: string,
): MealActivity[] => {
  if (!Array.isArray(data)) throw invalidPayload('meal_plans');
  const activities: MealActivity[] = [];

  data.forEach((rawPlan) => {
    if (typeof rawPlan !== 'object' || rawPlan === null || Array.isArray(rawPlan)) {
      throw invalidPayload('meal_plan');
    }
    const plan = rawPlan as Record<string, unknown>;
    if (
      !isValidUuid(plan.id)
      || plan.client_id !== clientId
      || plan.dietitian_id !== dietitianId
      || typeof plan.plan_date !== 'string'
      || !ISO_DATE_PATTERN.test(plan.plan_date)
      || !Array.isArray(plan.meals)
    ) throw invalidPayload('meal_plan');

    plan.meals.forEach((rawMeal) => {
      if (typeof rawMeal !== 'object' || rawMeal === null || Array.isArray(rawMeal)) {
        throw invalidPayload('meal');
      }
      const meal = rawMeal as Record<string, unknown>;
      if (!meal.is_eaten) return;
      if (
        !isValidUuid(meal.id)
        || !isValidUuid(meal.plan_id)
        || meal.plan_id !== plan.id
        || !MEAL_TYPES.has(meal.type as MealActivity['mealType'])
        || typeof meal.title !== 'string'
        || !meal.title.trim()
        || !Number.isInteger(meal.sort_order)
        || (meal.sort_order as number) < 0
      ) throw invalidPayload('meal');

      const completedAt = normalizeIsoTimestamp(meal.completed_at);
      // Rows created before the completion-timestamp migration cannot provide
      // a truthful event instant and are therefore excluded fail-closed from
      // the activity projection. Tracking still shows their is_eaten state.
      if (!completedAt) return;

      const mealId = meal.id as string;
      const planId = plan.id as string;
      const planDate = plan.plan_date as string;
      activities.push({
        id: createMealActivityId(mealId),
        kind: MEAL_ACTIVITY_KIND,
        relationId,
        conversationId,
        clientId,
        dietitianId,
        mealId,
        planId,
        mealDate: planDate,
        mealType: meal.type as MealActivity['mealType'],
        mealTitle: meal.title.trim(),
        mealTime: normalizeMealTime(meal.time),
        completedAt,
        createdAt: completedAt,
        photoPath: normalizePhotoPath(meal.photo_url),
        isHumanMessage: false,
        requiresRead: false,
      });
    });
  });

  return mergeMealActivities([], activities);
};

export const getMealActivityUserMessage = (error: unknown): string => {
  if (error instanceof MealActivityServiceError && error.code === 'FORBIDDEN') {
    return 'Bu danışanın öğün aktivitelerine erişim izniniz yok.';
  }
  return 'Öğün aktiviteleri şu anda yüklenemiyor.';
};

export const fetchMealActivities = async ({
  relationId,
  conversationId,
  clientId,
  dietitianId,
  currentUserId,
}: {
  relationId: string;
  conversationId: string;
  clientId: string;
  dietitianId: string;
  currentUserId: string;
}): Promise<MealActivity[]> => {
  if (![relationId, conversationId, clientId, dietitianId, currentUserId].every(isValidUuid)) {
    throw new MealActivityServiceError('CONTRACT', 'Geçersiz öğün aktivitesi kimliği.');
  }
  if (currentUserId !== dietitianId) {
    throw new MealActivityServiceError('FORBIDDEN', 'Öğün aktiviteleri yalnızca yetkili diyetisyen içindir.');
  }

  const { data: relationship, error: relationshipError } = await supabase
    .from('dietitian_clients')
    .select('id, dietitian_id, client_id, status')
    .eq('id', relationId)
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle();
  if (relationshipError) {
    throw new MealActivityServiceError('FETCH', 'Danışan bağlantısı alınamadı.', relationshipError);
  }
  if (
    !relationship
    || relationship.id !== relationId
    || relationship.dietitian_id !== dietitianId
    || relationship.client_id !== clientId
    || relationship.status !== 'active'
  ) {
    throw new MealActivityServiceError('FORBIDDEN', 'Öğün aktiviteleri yalnızca aktif danışan bağlantısı için görüntülenebilir.');
  }

  const { data, error } = await supabase
    .from('meal_plans')
    .select(ACTIVITY_SELECT)
    .eq('client_id', clientId)
    .eq('dietitian_id', dietitianId)
    .order('plan_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw new MealActivityServiceError('FETCH', 'Öğün aktiviteleri alınamadı.', error);
  }

  try {
    return normalizeActivities(data, relationId, conversationId, clientId, dietitianId);
  } catch (cause) {
    if (cause instanceof MealActivityServiceError) throw cause;
    throw new MealActivityServiceError('CONTRACT', 'Öğün aktivitesi yanıtı doğrulanamadı.', cause);
  }
};

export interface MealActivitySubscription {
  unsubscribe: () => Promise<void>;
}

export const subscribeToMealActivityChanges = ({
  clientId,
  dietitianId,
  onChange,
}: {
  clientId: string;
  dietitianId: string;
  onChange: () => void;
}): MealActivitySubscription => {
  if (!isValidUuid(clientId) || !isValidUuid(dietitianId)) {
    return { unsubscribe: async () => undefined };
  }

  const channel = supabase
    .channel(`meal-activities:${clientId}:${dietitianId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, onChange)
    .subscribe();

  return {
    unsubscribe: async () => {
      await supabase.removeChannel(channel);
    },
  };
};
