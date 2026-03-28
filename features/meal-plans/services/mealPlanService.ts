
import { supabase } from '../../../lib/supabaseClient';

export interface MealPlanInput {
  client_id: string;
  dietitian_id: string;
  plan_date: string; // YYYY-MM-DD
  notes?: string;
}

export interface MealInput {
  plan_id: string;
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  calories?: number;
  macros?: any; // JSONB
  photo_url?: string;
  is_eaten?: boolean;
}

/**
 * Creates a meal plan for a specific date and adds meals to it.
 */
export const createDailyMealPlan = async (
  planData: MealPlanInput,
  meals: Omit<MealInput, 'plan_id'>[]
) => {
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
      .select()
      .single();

    if (planError) throw planError;
    planId = newPlan.id;
  }

  if (!planId) throw new Error('Failed to resolve plan ID');

  // 2. Insert meals
  if (meals.length > 0) {
    const mealsPayload = meals.map(m => ({
      plan_id: planId,
      type: m.type,
      title: m.title,
      calories: m.calories || 0,
      macros: m.macros || {},
      is_eaten: false
    }));

    const { error: mealsError } = await supabase
      .from('meals')
      .insert(mealsPayload);

    if (mealsError) throw mealsError;
  }

  return { success: true, planId };
};

export const fetchWeeklyMealPlan = async (
  clientId: string,
  dietitianId: string,
  startDate: string,
  endDate: string
) => {
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
        is_eaten
      )
    `)
    .eq('client_id', clientId)
    .eq('dietitian_id', dietitianId)
    .gte('plan_date', startDate)
    .lte('plan_date', endDate);

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
