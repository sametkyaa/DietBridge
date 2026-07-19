
import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { isCanonicalMealPhotoPath } from './mealPhotoService';

export type MealPlanValidationErrorCode =
  | 'INVALID_CLIENT_ID'
  | 'INVALID_DIETITIAN_ID'
  | 'INVALID_PLAN_ID'
  | 'INVALID_MEAL_ID'
  | 'INVALID_RECIPE_ID'
  | 'RECIPE_SOURCE_NOT_SUPPORTED'
  | 'INVALID_MEAL_PHOTO_PATH'
  | 'INVALID_MEAL_MACROS'
  | 'INVALID_WEEK_PAYLOAD'
  | 'INVALID_RPC_RESPONSE';

export class MealPlanValidationError extends Error {
  constructor(
    public readonly code: MealPlanValidationErrorCode,
    public readonly field: string
  ) {
    super(code);
    this.name = 'MealPlanValidationError';
  }
}

function assertValidUuid(
  value: unknown,
  code: MealPlanValidationErrorCode,
  field: string
): asserts value is string {
  if (!isValidUuid(value)) {
    console.warn(`[mealPlanService] Geçersiz UUID alanı: ${field}`);
    throw new MealPlanValidationError(code, field);
  }
}

export const getMealPlanUserMessage = (error: unknown): string => {
  if (error instanceof MealPlanValidationError) {
    if (error.code === 'INVALID_CLIENT_ID') {
      return 'Seçili danışan bilgisi geçersiz. Danışanı yeniden seçip tekrar deneyin.';
    }

    if (error.code === 'INVALID_DIETITIAN_ID') {
      return 'Oturum bilgisi doğrulanamadı. Lütfen yeniden giriş yapın.';
    }

    if (error.code === 'INVALID_RECIPE_ID') {
      return 'Seçili tarif bilgisi geçersiz. Tarifi yeniden seçin.';
    }

    if (error.code === 'RECIPE_SOURCE_NOT_SUPPORTED') {
      return 'Tarif kaynaklı öğün kaydı henüz desteklenmiyor.';
    }

    if (error.code === 'INVALID_MEAL_PHOTO_PATH') {
      return 'Öğün görseli geçersiz veya bu plan için yetkili değil.';
    }

    if (error.code === 'INVALID_MEAL_MACROS') {
      return 'Protein, karbonhidrat ve yağ alanları sayısal, sonlu ve sıfır veya daha büyük olmalıdır.';
    }
  }

  return 'Plan kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.';
};

export const getMealPlanErrorLogContext = (
  error: unknown
): { code: string; field?: string } => {
  if (error instanceof MealPlanValidationError) {
    return { code: error.code, field: error.field };
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return { code: error.code };
  }

  return { code: 'UNKNOWN_MEAL_PLAN_ERROR' };
};

export interface CanonicalMealMacros {
  protein: number;
  carbs: number;
  fat: number;
}

export interface WeeklyMealInput {
  id?: string;
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  calories?: number | null;
  macros: CanonicalMealMacros;
  photo_url?: string | null;
  sort_order: number;
  time: string;
  source: 'manual';
  recipe_id?: null;
}

export interface WeeklyMealPlanDayInput {
  plan_date: string;
  notes?: string | null;
  meals: WeeklyMealInput[];
}

export interface CanonicalMeal extends Required<Omit<WeeklyMealInput, 'recipe_id' | 'calories' | 'photo_url'>> {
  id: string;
  plan_id: string;
  calories: number | null;
  photo_url: string | null;
  recipe_id: string | null;
  is_eaten: boolean;
}

export interface CanonicalDailyMealPlan {
  id: string;
  plan_date: string;
  notes: string | null;
  meals: CanonicalMeal[];
}

export interface CanonicalWeeklyMealPlan {
  client_id: string;
  dietitian_id: string;
  week_start: string;
  week_end: string;
  plans: CanonicalDailyMealPlan[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MEAL_TYPES = new Set<WeeklyMealInput['type']>(['breakfast', 'lunch', 'dinner', 'snack']);

const addUtcDays = (isoDate: string, days: number): string => {
  if (!ISO_DATE_PATTERN.test(isoDate)) {
    throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', 'week_start');
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', 'week_start');
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const assertWeeklyPayload = (weekStart: string, days: WeeklyMealPlanDayInput[]): void => {
  const [year, month, day] = weekStart.split('-').map(Number);
  const weekStartDate = new Date(Date.UTC(year, month - 1, day));
  addUtcDays(weekStart, 0);
  if (weekStartDate.getUTCDay() !== 1 || days.length !== 7) {
    throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', 'week_start');
  }

  const seenMealIds = new Set<string>();
  days.forEach((plan, dayIndex) => {
    if (plan.plan_date !== addUtcDays(weekStart, dayIndex) || !Array.isArray(plan.meals)) {
      throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', `days[${dayIndex}]`);
    }

    const seenSortOrders = new Set<number>();
    plan.meals.forEach((meal, mealIndex) => {
      const field = `days[${dayIndex}].meals[${mealIndex}]`;
      if (meal.id != null) {
        assertValidUuid(meal.id, 'INVALID_MEAL_ID', `${field}.id`);
        if (seenMealIds.has(meal.id)) {
          throw new MealPlanValidationError('INVALID_MEAL_ID', `${field}.id`);
        }
        seenMealIds.add(meal.id);
      }
      if (!MEAL_TYPES.has(meal.type) || !meal.title.trim() || !TIME_PATTERN.test(meal.time)) {
        throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', field);
      }
      if (!Number.isInteger(meal.sort_order) || meal.sort_order < 0 || seenSortOrders.has(meal.sort_order)) {
        throw new MealPlanValidationError('INVALID_WEEK_PAYLOAD', `${field}.sort_order`);
      }
      seenSortOrders.add(meal.sort_order);
      if (meal.source !== 'manual') {
        throw new MealPlanValidationError('RECIPE_SOURCE_NOT_SUPPORTED', `${field}.source`);
      }
      if (meal.recipe_id != null) {
        throw new MealPlanValidationError('INVALID_RECIPE_ID', `${field}.recipe_id`);
      }
      if (meal.photo_url != null && !isCanonicalMealPhotoPath(meal.photo_url)) {
        throw new MealPlanValidationError('INVALID_MEAL_PHOTO_PATH', `${field}.photo_url`);
      }
      normalizeCanonicalMealMacros(meal.macros, `${field}.macros`);
    });
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const normalizeCanonicalMealMacros = (
  value: unknown,
  field = 'macros',
): CanonicalMealMacros => {
  if (!isRecord(value)) {
    throw new MealPlanValidationError('INVALID_MEAL_MACROS', field);
  }

  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'carbs'
    || keys[1] !== 'fat'
    || keys[2] !== 'protein'
  ) {
    throw new MealPlanValidationError('INVALID_MEAL_MACROS', field);
  }

  const { protein, carbs, fat } = value;
  if (
    typeof protein !== 'number' || !Number.isFinite(protein) || protein < 0
    || typeof carbs !== 'number' || !Number.isFinite(carbs) || carbs < 0
    || typeof fat !== 'number' || !Number.isFinite(fat) || fat < 0
  ) {
    throw new MealPlanValidationError('INVALID_MEAL_MACROS', field);
  }

  return { protein, carbs, fat };
};

const assertCanonicalResponse = (
  value: unknown,
  expectedClientId: string,
  expectedDietitianId: string,
  expectedWeekStart: string,
): CanonicalWeeklyMealPlan => {
  if (!isRecord(value)
      || value.client_id !== expectedClientId
      || value.dietitian_id !== expectedDietitianId
      || value.week_start !== expectedWeekStart
      || value.week_end !== addUtcDays(expectedWeekStart, 6)
      || !Array.isArray(value.plans)
      || value.plans.length !== 7) {
    throw new MealPlanValidationError('INVALID_RPC_RESPONSE', 'save_weekly_meal_plan');
  }

  const seenMealIds = new Set<string>();
  const plans = value.plans.map((rawPlan, dayIndex): CanonicalDailyMealPlan => {
    if (!isRecord(rawPlan)
        || !isValidUuid(rawPlan.id)
        || rawPlan.plan_date !== addUtcDays(expectedWeekStart, dayIndex)
        || (rawPlan.notes !== null && typeof rawPlan.notes !== 'string')
        || !Array.isArray(rawPlan.meals)) {
      throw new MealPlanValidationError('INVALID_RPC_RESPONSE', `plans[${dayIndex}]`);
    }

    let previousSortOrder = -1;
    let previousId = '';
    const meals = rawPlan.meals.map((rawMeal, mealIndex): CanonicalMeal => {
      if (!isRecord(rawMeal)
          || !isValidUuid(rawMeal.id)
          || rawMeal.plan_id !== rawPlan.id
          || !MEAL_TYPES.has(rawMeal.type as WeeklyMealInput['type'])
          || typeof rawMeal.title !== 'string'
          || typeof rawMeal.is_eaten !== 'boolean'
          || !Number.isInteger(rawMeal.sort_order)
          || (rawMeal.sort_order as number) < 0
          || typeof rawMeal.time !== 'string'
          || !TIME_PATTERN.test(rawMeal.time)
          || rawMeal.source !== 'manual'
          || (rawMeal.calories !== null && typeof rawMeal.calories !== 'number')
          || (rawMeal.photo_url !== null && !isCanonicalMealPhotoPath(rawMeal.photo_url))) {
        throw new MealPlanValidationError('INVALID_RPC_RESPONSE', `plans[${dayIndex}].meals[${mealIndex}]`);
      }

      if (rawMeal.recipe_id !== null || seenMealIds.has(rawMeal.id)) {
        throw new MealPlanValidationError('INVALID_RPC_RESPONSE', `plans[${dayIndex}].meals[${mealIndex}]`);
      }

      const sortOrder = rawMeal.sort_order as number;
      if (sortOrder < previousSortOrder || (sortOrder === previousSortOrder && rawMeal.id <= previousId)) {
        throw new MealPlanValidationError('INVALID_RPC_RESPONSE', `plans[${dayIndex}].meals`);
      }
      let macros: CanonicalMealMacros;
      try {
        macros = normalizeCanonicalMealMacros(rawMeal.macros, `plans[${dayIndex}].meals[${mealIndex}].macros`);
      } catch {
        throw new MealPlanValidationError('INVALID_RPC_RESPONSE', `plans[${dayIndex}].meals[${mealIndex}].macros`);
      }
      previousSortOrder = sortOrder;
      previousId = rawMeal.id;
      seenMealIds.add(rawMeal.id);
      return {
        ...rawMeal,
        macros,
      } as CanonicalMeal;
    });

    return {
      id: rawPlan.id,
      plan_date: rawPlan.plan_date as string,
      notes: rawPlan.notes as string | null,
      meals,
    };
  });

  return {
    client_id: value.client_id,
    dietitian_id: value.dietitian_id,
    week_start: value.week_start,
    week_end: value.week_end,
    plans,
  };
};

export const saveWeeklyMealPlan = async (
  clientId: string,
  weekStart: string,
  days: WeeklyMealPlanDayInput[],
): Promise<CanonicalWeeklyMealPlan> => {
  assertValidUuid(clientId, 'INVALID_CLIENT_ID', 'meal_plans.client_id');
  assertWeeklyPayload(weekStart, days);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new MealPlanValidationError('INVALID_DIETITIAN_ID', 'auth.uid');
  }
  assertValidUuid(user.id, 'INVALID_DIETITIAN_ID', 'auth.uid');

  const { data, error } = await supabase.rpc('save_weekly_meal_plan', {
    p_client_id: clientId,
    p_week_start: weekStart,
    p_days: days,
  });
  if (error) throw error;

  return assertCanonicalResponse(data, clientId, user.id, weekStart);
};

export const fetchWeeklyMealPlan = async (
  clientId: string,
  dietitianId: string,
  startDate: string,
  endDate: string
) => {
  assertValidUuid(clientId, 'INVALID_CLIENT_ID', 'meal_plans.client_id');
  assertValidUuid(dietitianId, 'INVALID_DIETITIAN_ID', 'meal_plans.dietitian_id');

  const { data, error } = await supabase
    .from('meal_plans')
    .select(`
      id,
      plan_date,
      notes,
      meals (
        id,
        type,
        title,
        calories,
        macros,
        photo_url,
        is_eaten,
        sort_order,
        time,
        source,
        recipe_id
      )
    `)
    .eq('client_id', clientId)
    .eq('dietitian_id', dietitianId)
    .gte('plan_date', startDate)
    .lte('plan_date', endDate);

  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new MealPlanValidationError('INVALID_RPC_RESPONSE', 'meal_plans');
  }

  data.forEach((plan, planIndex) => {
    if (!plan || !Array.isArray(plan.meals)) {
      throw new MealPlanValidationError('INVALID_RPC_RESPONSE', `meal_plans[${planIndex}]`);
    }
    plan.meals.forEach((meal, mealIndex) => {
      if (meal.photo_url != null && !isCanonicalMealPhotoPath(meal.photo_url)) {
        throw new MealPlanValidationError(
          'INVALID_MEAL_PHOTO_PATH',
          `meal_plans[${planIndex}].meals[${mealIndex}].photo_url`,
        );
      }
      normalizeCanonicalMealMacros(meal.macros, `meal_plans[${planIndex}].meals[${mealIndex}].macros`);
    });
  });
  return data;
};

/**
 * Helper to map UI meal names to DB enum types
 */
export const mapMealTypeToDb = (uiName: string): 'breakfast' | 'lunch' | 'dinner' | 'snack' => {
  const lower = uiName.toLowerCase();
  if (lower.includes('kahvaltı')) return 'breakfast';
  if (lower.includes('öğle')) return 'lunch';
  if (lower.includes('akşam')) return 'dinner';
  return 'snack'; // Default fallback for Ara Öğün, Antrenman, etc.
};
