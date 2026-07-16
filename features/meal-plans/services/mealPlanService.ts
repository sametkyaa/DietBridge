
import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';

export type MealPlanValidationErrorCode =
  | 'INVALID_CLIENT_ID'
  | 'INVALID_DIETITIAN_ID'
  | 'INVALID_PLAN_ID'
  | 'INVALID_RECIPE_ID';

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

export interface MealPlanInput {
  client_id: string;
  dietitian_id: string;
  plan_date: string; // YYYY-MM-DD
  notes?: string | null;
}

export interface MealInput {
  plan_id: string;
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  calories?: number;
  macros?: Record<string, unknown>; // JSONB
  photo_url?: string | null;
  is_eaten?: boolean;
  sort_order?: number;
  time?: string;
  source?: string;
  recipe_id?: string | null;
}

/**
 * Creates a meal plan for a specific date and adds meals to it.
 */
export const createDailyMealPlan = async (
  planData: MealPlanInput,
  meals: Omit<MealInput, 'plan_id'>[]
) => {
  assertValidUuid(planData.client_id, 'INVALID_CLIENT_ID', 'meal_plans.client_id');
  assertValidUuid(planData.dietitian_id, 'INVALID_DIETITIAN_ID', 'meal_plans.dietitian_id');
  meals.forEach((meal) => {
    if (meal.recipe_id != null) {
      assertValidUuid(meal.recipe_id, 'INVALID_RECIPE_ID', 'meals.recipe_id');
    }
  });

  // 1. Check if a plan already exists for this client/date/dietitian
  const { data: existingPlan, error: fetchError } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('client_id', planData.client_id)
    .eq('dietitian_id', planData.dietitian_id)
    .eq('plan_date', planData.plan_date)
    .maybeSingle();

  if (fetchError) throw fetchError;

  let planId = existingPlan?.id;

  if (planId) {
    assertValidUuid(planId, 'INVALID_PLAN_ID', 'meal_plans.id');

    // Option A: Delete existing meals and update plan notes
    const { error: deleteError } = await supabase.from('meals').delete().eq('plan_id', planId);
    if (deleteError) throw deleteError;

    const { error: updateError } = await supabase
      .from('meal_plans')
      .update({ notes: planData.notes })
      .eq('id', planId);
    if (updateError) throw updateError;
  } else {
    // Option B: Create new plan
    const { data: newPlan, error: planError } = await supabase
      .from('meal_plans')
      .insert([planData])
      .select('id')
      .single();

    if (planError) throw planError;
    assertValidUuid(newPlan?.id, 'INVALID_PLAN_ID', 'meal_plans.id');
    planId = newPlan.id;
  }

  assertValidUuid(planId, 'INVALID_PLAN_ID', 'meal_plans.id');

  // 2. Insert meals
  if (meals.length > 0) {
    const mealsPayload = meals.map(m => ({
      plan_id: planId,
      type: m.type,
      title: m.title,
      calories: m.calories ?? 0,
      macros: m.macros ?? {},
      photo_url: m.photo_url ?? null,
      is_eaten: false,
      sort_order: m.sort_order ?? 0,
      time: m.time || '00:00',
      source: m.source || 'manual',
      recipe_id: m.recipe_id ?? null
    }));

    // For backwards compatibility, if the column doesn't exist, we fallback to macros storage.
    // We'll store it in macros as well to ensure it survives if the DB doesn't have the column yet.
    const safeMealsPayload = mealsPayload.map(m => ({
        ...m,
        macros: { ...m.macros, _sortOrder: m.sort_order, _time: m.time }
    }));

    const { error: mealsError } = await supabase
      .from('meals')
      .insert(safeMealsPayload);

    // If there is an error due to missing columns, try without them
    if (mealsError && (mealsError.code === 'PGRST204' || mealsError.code === '42703')) {
        console.warn("sort_order or time columns not found, using macros fallback.");
        const fallbackPayload = safeMealsPayload.map(m => {
            const { sort_order, time, source, recipe_id, ...rest } = m as any;
            return rest;
        });
        const { error: fallbackError } = await supabase.from('meals').insert(fallbackPayload);
        if (fallbackError) throw fallbackError;
    } else if (mealsError) {
        throw mealsError;
    }
  }

  return { success: true, planId };
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

  // If selecting sort_order fails due to missing column, fallback to query without it
  if (error && (error.code === 'PGRST200' || error.code === '42703')) {
      console.warn("sort_order or time columns not found, fetching without them.");
      const { data: fallbackData, error: fallbackError } = await supabase
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
            is_eaten
          )
        `)
        .eq('client_id', clientId)
        .eq('dietitian_id', dietitianId)
        .gte('plan_date', startDate)
        .lte('plan_date', endDate);
      
      if (fallbackError) throw fallbackError;
      return fallbackData;
  }

  if (error) throw error;
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
