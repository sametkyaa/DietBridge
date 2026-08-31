import {
  MealPlanValidationError,
  normalizeCanonicalMealMacros,
  type CanonicalMealMacros,
} from '../services/mealPlanService';
import {
  isCompletedMealContent,
  isPlannedMealContent,
  type MealPlanCellRef,
  type PlanState,
  type PlannedMealContent,
} from './mealPlanMove';

export interface MealPlanSnapshotDraft {
  name: string;
  description: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  image: string | null;
  imagePreview: string | null;
  pendingPhoto: File | null;
}

interface NormalizedSnapshotFields {
  name: string;
  description: string | null;
  calories: number | null;
  macros: CanonicalMealMacros;
}

export type MealPlanSnapshotEditResult =
  | { status: 'applied'; nextPlan: PlanState }
  | { status: 'stale'; nextPlan: PlanState; message: string }
  | { status: 'blocked'; nextPlan: PlanState; message: string }
  | { status: 'invalid'; nextPlan: PlanState; error: unknown };

const SNAPSHOT_DESCRIPTION_MAX_LENGTH = 2000;
const SNAPSHOT_CALORIES_MAX = 100000;
const SNAPSHOT_MACRO_MAX = 10000;

const invalidSnapshot = (field: string): MealPlanValidationError => (
  new MealPlanValidationError('INVALID_WEEK_PAYLOAD', field)
);

const invalidMacros = (field: string): MealPlanValidationError => (
  new MealPlanValidationError('INVALID_MEAL_MACROS', field)
);

const parseNullableCalories = (value: string): number | null => {
  const normalized = value.trim();
  if (!normalized) return null;

  const calories = Number(normalized);
  if (!Number.isFinite(calories)
    || !Number.isInteger(calories)
    || calories < 0
    || calories > SNAPSHOT_CALORIES_MAX) {
    throw invalidSnapshot('calories');
  }
  return calories;
};

const parseMacro = (value: string, field: string): number => {
  const normalized = value.trim();
  if (!normalized) throw invalidMacros(field);

  const macro = Number(normalized);
  if (!Number.isFinite(macro) || macro < 0 || macro > SNAPSHOT_MACRO_MAX) {
    throw invalidMacros(field);
  }
  return macro;
};

export const createMealPlanSnapshotDraft = (
  content: PlannedMealContent,
): MealPlanSnapshotDraft => ({
  name: content.name,
  description: content.description ?? '',
  calories: content.calories == null ? '' : String(content.calories),
  protein: String(content.macros.protein),
  carbs: String(content.macros.carbs),
  fat: String(content.macros.fat),
  image: content.image ?? null,
  imagePreview: content.imagePreview ?? null,
  pendingPhoto: content.pendingPhoto ?? null,
});

export const normalizeMealPlanSnapshotDraft = (
  draft: MealPlanSnapshotDraft,
): NormalizedSnapshotFields => {
  const name = draft.name.trim();
  if (!name) throw invalidSnapshot('name');

  const description = draft.description.trim();
  if (description.length > SNAPSHOT_DESCRIPTION_MAX_LENGTH) {
    throw invalidSnapshot('description');
  }

  const macros = normalizeCanonicalMealMacros({
    protein: parseMacro(draft.protein, 'protein'),
    carbs: parseMacro(draft.carbs, 'carbs'),
    fat: parseMacro(draft.fat, 'fat'),
  }, 'macros');

  return {
    name,
    description: description || null,
    calories: parseNullableCalories(draft.calories),
    macros,
  };
};

export const getMealPlanSnapshotEditUserMessage = (error: unknown): string => {
  if (error instanceof MealPlanValidationError) {
    if (error.code === 'INVALID_MEAL_MACROS') {
      return 'Protein, karbonhidrat ve yağ değerleri 0 ile 10000 arasında sonlu sayılar olmalıdır.';
    }
    if (error.field === 'name') return 'Öğün adı boş bırakılamaz.';
    if (error.field === 'description') return 'Açıklama en fazla 2000 karakter olabilir.';
    if (error.field === 'calories') return 'Kalori 0 ile 100000 arasında tam sayı veya boş olmalıdır.';
  }
  return 'Öğün bilgileri geçersiz. Lütfen alanları kontrol edin.';
};

/**
 * Applies only editable snapshot fields to the current cell. Identity,
 * provenance, placement and completion metadata stay on the existing object.
 */
export const applyMealPlanSnapshotEdit = (
  currentPlan: PlanState,
  cell: MealPlanCellRef,
  draft: MealPlanSnapshotDraft,
): MealPlanSnapshotEditResult => {
  const currentContent = currentPlan[cell.day]?.[cell.mealId];
  if (!isPlannedMealContent(currentContent)) {
    return {
      status: 'stale',
      nextPlan: currentPlan,
      message: 'Bu öğün artık planda değil. Lütfen öğünü yeniden açın.',
    };
  }

  if (isCompletedMealContent(currentContent)) {
    return {
      status: 'blocked',
      nextPlan: currentPlan,
      message: 'Tamamlanmış bir öğünün içeriği değiştirilemez.',
    };
  }

  let normalized: NormalizedSnapshotFields;
  try {
    normalized = normalizeMealPlanSnapshotDraft(draft);
  } catch (error) {
    return { status: 'invalid', nextPlan: currentPlan, error };
  }

  const nextContent: PlannedMealContent = {
    ...currentContent,
    name: normalized.name,
    description: normalized.description,
    calories: normalized.calories,
    macros: normalized.macros,
    image: draft.image ?? null,
    imagePreview: draft.imagePreview ?? null,
    pendingPhoto: draft.pendingPhoto ?? null,
  };

  if (currentContent.source === 'recipe' && !currentContent.mealId) {
    nextContent.snapshotMode = 'custom';
  } else if (currentContent.source !== 'recipe') {
    delete nextContent.snapshotMode;
  }

  return {
    status: 'applied',
    nextPlan: {
      ...currentPlan,
      [cell.day]: {
        ...(currentPlan[cell.day] ?? {}),
        [cell.mealId]: nextContent,
      },
    },
  };
};
