import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { isCanonicalRecipeImagePath } from '../../recipes/services/recipeService';
import { isReadableMealPhotoReference } from '../../meal-plans/services/mealPhotoService';
import { fetchActiveDietitianClientListForUser } from '../../clients/services/clientService';
import {
  groupMealTrackingDays,
  summarizeMealTrackingOverview,
} from '../utils/mealTrackingContract';
import type {
  MealTrackingDay,
  MealTrackingMeal,
  MealTrackingMealType,
  MealTrackingOverviewClient,
  MealTrackingOverviewView,
} from '../types/mealTracking';
import {
  getIstanbulDateKey,
  isAnalyticsDate,
} from '../../analytics/utils/analyticsContract';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
const MEAL_TYPES = new Set<MealTrackingMealType>(['breakfast', 'lunch', 'dinner', 'snack']);

const MEAL_TRACKING_SELECT = `
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

export type MealTrackingServiceErrorCode = 'AUTHORIZATION' | 'FORBIDDEN' | 'FETCH' | 'CONTRACT';

export class MealTrackingServiceError extends Error {
  public readonly code: MealTrackingServiceErrorCode;

  constructor(code: MealTrackingServiceErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MealTrackingServiceError';
    this.code = code;
    this.cause = cause;
  }

  public readonly cause?: unknown;
}

const createContractError = (field: string): MealTrackingServiceError => (
  new MealTrackingServiceError('CONTRACT', `Geçersiz öğün takip alanı: ${field}`)
);

const normalizeIsoTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

const normalizeMealTime = (value: unknown): string => {
  if (typeof value !== 'string') throw createContractError('time');
  const match = TIME_PATTERN.exec(value);
  if (!match) throw createContractError('time');
  return `${match[1]}:${match[2]}`;
};

const normalizePhotoPath = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw createContractError('photo_url');
  if (!isReadableMealPhotoReference(value) && !isCanonicalRecipeImagePath(value)) {
    throw createContractError('photo_url');
  }
  return value;
};

const normalizeMeal = (
  rawMeal: unknown,
  planId: string,
  date: string,
): MealTrackingMeal => {
  if (typeof rawMeal !== 'object' || rawMeal === null || Array.isArray(rawMeal)) {
    throw createContractError('meals');
  }
  const meal = rawMeal as Record<string, unknown>;
  if (!isValidUuid(meal.id) || !isValidUuid(meal.plan_id) || meal.plan_id !== planId) {
    throw createContractError('meal.id');
  }
  if (!MEAL_TYPES.has(meal.type as MealTrackingMealType)) throw createContractError('meal.type');
  if (typeof meal.title !== 'string' || !meal.title.trim()) throw createContractError('meal.title');
  if (typeof meal.is_eaten !== 'boolean') throw createContractError('meal.is_eaten');
  if (!Number.isInteger(meal.sort_order) || (meal.sort_order as number) < 0) {
    throw createContractError('meal.sort_order');
  }

  const completedAt = meal.completed_at === null || meal.completed_at === undefined
    ? null
    : normalizeIsoTimestamp(meal.completed_at);
  if (meal.completed_at !== null && meal.completed_at !== undefined && completedAt === null) {
    throw createContractError('meal.completed_at');
  }

  return {
    id: meal.id,
    planId,
    date,
    type: meal.type as MealTrackingMealType,
    title: meal.title.trim(),
    time: normalizeMealTime(meal.time),
    sortOrder: meal.sort_order as number,
    isCompleted: meal.is_eaten,
    completedAt,
    photoPath: normalizePhotoPath(meal.photo_url),
  };
};

interface NormalizedMealTrackingPlan {
  clientId: string;
  date: string;
  meals: MealTrackingMeal[];
}

const normalizePlanRows = (
  data: unknown,
  dietitianId: string,
  allowedClientIds: ReadonlySet<string>,
): NormalizedMealTrackingPlan[] => {
  if (!Array.isArray(data)) throw createContractError('meal_plans');
  if (!isValidUuid(dietitianId)) throw createContractError('dietitian_id');

  return data.map((rawPlan) => {
    if (typeof rawPlan !== 'object' || rawPlan === null || Array.isArray(rawPlan)) {
      throw createContractError('meal_plan');
    }
    const plan = rawPlan as Record<string, unknown>;
    const clientId = plan.client_id;
    if (
      !isValidUuid(plan.id)
      || !isValidUuid(clientId)
      || !allowedClientIds.has(clientId)
      || plan.dietitian_id !== dietitianId
      || typeof plan.plan_date !== 'string'
      || !isAnalyticsDate(plan.plan_date)
      || !Array.isArray(plan.meals)
    ) {
      throw createContractError('meal_plan');
    }

    const planId = plan.id as string;
    const planDate = plan.plan_date as string;
    return {
      clientId,
      date: planDate,
      meals: plan.meals.map((meal) => normalizeMeal(meal, planId, planDate)),
    };
  });
};

const normalizePlans = (
  data: unknown,
  clientId: string,
  dietitianId: string,
): MealTrackingDay[] => {
  const plans = normalizePlanRows(data, dietitianId, new Set([clientId]));
  return groupMealTrackingDays(plans.map(({ date, meals }) => ({ date, meals })));
};

export const normalizeMealTrackingOverviewPlans = (
  data: unknown,
  clientIds: readonly string[],
  dietitianId: string,
): Map<string, MealTrackingDay[]> => {
  if (clientIds.some((clientId) => !isValidUuid(clientId))) {
    throw createContractError('client_ids');
  }

  const uniqueClientIds = [...new Set(clientIds)];
  const plansByClient = new Map<string, Array<{ date: string; meals: MealTrackingMeal[] }>>(
    uniqueClientIds.map((clientId) => [clientId, []]),
  );
  const plans = normalizePlanRows(data, dietitianId, new Set(uniqueClientIds));
  plans.forEach(({ clientId, date, meals }) => {
    plansByClient.get(clientId)?.push({ date, meals });
  });

  return new Map(
    [...plansByClient.entries()].map(([clientId, clientPlans]) => [
      clientId,
      groupMealTrackingDays(clientPlans),
    ]),
  );
};

export const getMealTrackingUserMessage = (error: unknown): string => {
  if (error instanceof MealTrackingServiceError) {
    if (error.code === 'AUTHORIZATION') return 'Oturumunuz doğrulanamadı. Lütfen yeniden giriş yapın.';
    if (error.code === 'FORBIDDEN') return 'Bu danışanın öğün takibine erişim izniniz yok.';
  }
  return 'Öğün takip kayıtları şu anda yüklenemiyor. Lütfen tekrar deneyin.';
};

export const fetchMealTracking = async (
  clientId: string,
  startDate: string,
  endDate: string,
): Promise<MealTrackingDay[]> => {
  if (!isValidUuid(clientId)) throw new MealTrackingServiceError('CONTRACT', 'Geçersiz danışan kimliği.');
  if (!isAnalyticsDate(startDate) || !isAnalyticsDate(endDate) || startDate > endDate) {
    throw new MealTrackingServiceError('CONTRACT', 'Geçersiz öğün takip tarih aralığı.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user?.id || !isValidUuid(authData.user.id)) {
    throw new MealTrackingServiceError('AUTHORIZATION', 'Oturum doğrulanamadı.', authError);
  }
  const dietitianId = authData.user.id;

  const { data: relationships, error: relationshipError } = await supabase
    .from('dietitian_clients')
    .select('id, status')
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .limit(2);
  if (relationshipError) {
    throw new MealTrackingServiceError('FETCH', 'Danışan bağlantısı alınamadı.', relationshipError);
  }
  if (!Array.isArray(relationships) || relationships.length !== 1) {
    throw new MealTrackingServiceError('FORBIDDEN', 'Aktif danışan bağlantısı bulunamadı.');
  }

  const { data, error } = await supabase
    .from('meal_plans')
    .select(MEAL_TRACKING_SELECT)
    .eq('client_id', clientId)
    .eq('dietitian_id', dietitianId)
    .gte('plan_date', startDate)
    .lte('plan_date', endDate)
    .order('plan_date', { ascending: false })
    .order('id', { ascending: false });
  if (error) {
    throw new MealTrackingServiceError('FETCH', 'Öğün takip kayıtları alınamadı.', error);
  }

  try {
    return normalizePlans(data, clientId, dietitianId);
  } catch (cause) {
    if (cause instanceof MealTrackingServiceError) throw cause;
    throw new MealTrackingServiceError('CONTRACT', 'Öğün takip yanıtı doğrulanamadı.', cause);
  }
};

export const fetchMealTrackingOverview = async (
  startDate: string,
  endDate: string,
  view: MealTrackingOverviewView = startDate === endDate ? 'today' : '7d',
): Promise<MealTrackingOverviewClient[]> => {
  if (
    !isAnalyticsDate(startDate)
    || !isAnalyticsDate(endDate)
    || startDate > endDate
    || (view === 'today' && startDate !== endDate)
  ) {
    throw new MealTrackingServiceError('CONTRACT', 'Geçersiz öğün takip tarih aralığı.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user?.id || !isValidUuid(authData.user.id)) {
    throw new MealTrackingServiceError('AUTHORIZATION', 'Oturum doğrulanamadı.', authError);
  }
  const dietitianId = authData.user.id;

  const clientResult = await fetchActiveDietitianClientListForUser(dietitianId);
  if (clientResult.status === 'error') {
    throw new MealTrackingServiceError('FETCH', 'Aktif danışanlar alınamadı.', clientResult.userMessage);
  }

  const activeClients = clientResult.clients.filter((client) => client.status === 'Aktif');
  const clientIds = activeClients.map((client) => client.id);
  if (clientIds.length === 0) return [];

  const { data, error } = await supabase
    .from('meal_plans')
    .select(MEAL_TRACKING_SELECT)
    .eq('dietitian_id', dietitianId)
    .in('client_id', clientIds)
    .gte('plan_date', startDate)
    .lte('plan_date', endDate)
    .order('plan_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw new MealTrackingServiceError('FETCH', 'Öğün takip kayıtları alınamadı.', error);
  }

  try {
    const plansByClient = normalizeMealTrackingOverviewPlans(data, clientIds, dietitianId);
    const today = getIstanbulDateKey();
    return activeClients.map((client) => summarizeMealTrackingOverview(
      {
        clientId: client.id,
        displayName: client.name,
        avatar: client.avatar,
      },
      plansByClient.get(client.id) ?? [],
      view,
      today,
    ));
  } catch (cause) {
    if (cause instanceof MealTrackingServiceError) throw cause;
    throw new MealTrackingServiceError('CONTRACT', 'Öğün takip yanıtı doğrulanamadı.', cause);
  }
};
