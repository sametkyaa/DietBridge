import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';

export interface NutritionTarget {
  clientId: string;
  minKcal: number | null;
  maxKcal: number | null;
  updatedAt: string;
}

export const NUTRITION_TARGET_MIN = 500;
export const NUTRITION_TARGET_MAX = 10000;
export const NUTRITION_TARGET_LOAD_ERROR = 'Kalori hedefi yüklenemedi.';
export const NUTRITION_TARGET_SAVE_ERROR = 'Kalori hedefi kaydedilemedi. Lütfen tekrar deneyin.';

export class NutritionTargetServiceError extends Error {
  constructor(public readonly userMessage: string, public readonly cause?: unknown) {
    super(userMessage);
    this.name = 'NutritionTargetServiceError';
  }
}

interface NutritionTargetRow {
  client_id: string;
  min_kcal: number | null;
  max_kcal: number | null;
  updated_at: string;
}

const isKcal = (value: unknown): value is number => (
  Number.isInteger(value) && (value as number) >= NUTRITION_TARGET_MIN && (value as number) <= NUTRITION_TARGET_MAX
);

const mapRow = (row: NutritionTargetRow): NutritionTarget => {
  if (
    !isValidUuid(row.client_id)
    || (row.min_kcal !== null && !isKcal(row.min_kcal))
    || (row.max_kcal !== null && !isKcal(row.max_kcal))
  ) {
    throw new NutritionTargetServiceError(NUTRITION_TARGET_LOAD_ERROR);
  }
  return { clientId: row.client_id, minKcal: row.min_kcal, maxKcal: row.max_kcal, updatedAt: row.updated_at };
};

/** Validation shared by the plan editor and the client profile form. */
export const validateNutritionTarget = (minKcal: number | null, maxKcal: number | null): string | null => {
  if (minKcal !== null && !isKcal(minKcal)) return `Alt hedef ${NUTRITION_TARGET_MIN}–${NUTRITION_TARGET_MAX} kcal arasında olmalı.`;
  if (maxKcal !== null && !isKcal(maxKcal)) return `Üst hedef ${NUTRITION_TARGET_MIN}–${NUTRITION_TARGET_MAX} kcal arasında olmalı.`;
  if (minKcal !== null && maxKcal !== null && minKcal > maxKcal) return 'Alt hedef üst hedeften büyük olamaz.';
  return null;
};

/** Targets the signed-in dietitian set; keyed by client id. */
export const fetchNutritionTargets = async (clientIds: readonly string[]): Promise<Map<string, NutritionTarget>> => {
  const ids = [...new Set(clientIds)].filter(isValidUuid);
  if (ids.length === 0) return new Map();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) throw new NutritionTargetServiceError(NUTRITION_TARGET_LOAD_ERROR, authError);
  const { data, error } = await supabase
    .from('client_nutrition_targets')
    .select('client_id, min_kcal, max_kcal, updated_at')
    .eq('dietitian_id', user.id)
    .in('client_id', ids);
  if (error || !Array.isArray(data)) {
    console.error('Nutrition target load failed:', error?.code ?? 'malformed');
    throw new NutritionTargetServiceError(NUTRITION_TARGET_LOAD_ERROR, error);
  }
  return new Map((data as NutritionTargetRow[]).map((row) => {
    const target = mapRow(row);
    return [target.clientId, target];
  }));
};

export const fetchNutritionTarget = async (clientId: string): Promise<NutritionTarget | null> => (
  (await fetchNutritionTargets([clientId])).get(clientId) ?? null
);

/** Upserts the band; passing two nulls clears it. */
export const saveNutritionTarget = async (
  clientId: string,
  minKcal: number | null,
  maxKcal: number | null,
): Promise<NutritionTarget | null> => {
  const validation = validateNutritionTarget(minKcal, maxKcal);
  if (!isValidUuid(clientId) || validation) {
    throw new NutritionTargetServiceError(validation ?? NUTRITION_TARGET_SAVE_ERROR);
  }
  const { data, error } = await supabase.rpc('set_client_nutrition_target', {
    p_client_id: clientId,
    p_min_kcal: minKcal,
    p_max_kcal: maxKcal,
  });
  if (error) {
    console.error('Nutrition target save failed:', error.code);
    throw new NutritionTargetServiceError(NUTRITION_TARGET_SAVE_ERROR, error);
  }
  if (minKcal === null && maxKcal === null) return null;
  const row = data as NutritionTargetRow | null;
  if (!row || row.client_id !== clientId || row.min_kcal !== minKcal || row.max_kcal !== maxKcal) {
    throw new NutritionTargetServiceError(NUTRITION_TARGET_SAVE_ERROR);
  }
  return mapRow(row);
};

/** "1.500–1.700 kcal", "≥ 1.500 kcal", "≤ 1.700 kcal" or null. */
export const formatNutritionTarget = (target: Pick<NutritionTarget, 'minKcal' | 'maxKcal'> | null): string | null => {
  if (!target) return null;
  const format = (value: number) => new Intl.NumberFormat('tr-TR').format(value);
  if (target.minKcal !== null && target.maxKcal !== null) return `${format(target.minKcal)}–${format(target.maxKcal)} kcal`;
  if (target.minKcal !== null) return `≥ ${format(target.minKcal)} kcal`;
  if (target.maxKcal !== null) return `≤ ${format(target.maxKcal)} kcal`;
  return null;
};
