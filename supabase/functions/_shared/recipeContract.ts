// Canonical manual Recipe create contract, also consumed by import preview and workers.
export type RecipeMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export interface RecipeInput {
  name: string;
  description?: string | null;
  mealType: RecipeMealType;
  calories: number;
  macros: { protein: number; carbs: number; fat: number };
}
export type RecipeValidationCode =
  | 'AUTH_REQUIRED' | 'INVALID_RECIPE_ID' | 'INVALID_RECIPE_NAME'
  | 'INVALID_RECIPE_DESCRIPTION' | 'INVALID_RECIPE_MEAL_TYPE'
  | 'INVALID_RECIPE_CALORIES' | 'INVALID_RECIPE_MACROS' | 'INVALID_RECIPE_IMAGE'
  | 'RECIPE_IMAGE_UPLOAD_FAILED' | 'RECIPE_NOT_FOUND' | 'INVALID_RECIPE_RESPONSE';
export class RecipeValidationError extends Error {
  readonly code: RecipeValidationCode;
  readonly field: string;
  constructor(code: RecipeValidationCode, field: string) {
    super(code); this.name = 'RecipeValidationError'; this.code = code; this.field = field;
  }
}
export const normalizeRecipeInput = (input: RecipeInput): RecipeInput => {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 160) throw new RecipeValidationError('INVALID_RECIPE_NAME', 'name');
  if (input.description != null && typeof input.description !== 'string') throw new RecipeValidationError('INVALID_RECIPE_DESCRIPTION', 'description');
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) throw new RecipeValidationError('INVALID_RECIPE_DESCRIPTION', 'description');
  if (!['breakfast','lunch','dinner','snack'].includes(input.mealType)) throw new RecipeValidationError('INVALID_RECIPE_MEAL_TYPE', 'meal_type');
  if (!Number.isInteger(input.calories) || input.calories < 0 || input.calories > 10000) throw new RecipeValidationError('INVALID_RECIPE_CALORIES', 'calories');
  const macros = input.macros;
  if (!macros || Object.keys(macros).sort().join(',') !== 'carbs,fat,protein'
    || Object.values(macros).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000)) {
    throw new RecipeValidationError('INVALID_RECIPE_MACROS', 'macros');
  }
  return { name, description, mealType: input.mealType, calories: input.calories, macros: { ...macros } };
};
// An incomplete view of the same contract. Missing values remain null until edited.
export type RecipeDraft = Omit<RecipeInput, 'mealType' | 'calories' | 'macros'> & {
  mealType: RecipeMealType | null;
  calories: number | null;
  macros: { protein: number | null; carbs: number | null; fat: number | null };
};
export function draftIssues(draft: RecipeDraft): string[] {
  const issues: string[] = [];
  if (!draft.name?.trim() || draft.name.length > 160) issues.push('Tarif adı gerekli; en fazla 160 karakter.');
  if ((draft.description?.length ?? 0) > 2000) issues.push('Açıklama en fazla 2000 karakter olabilir.');
  if (!draft.mealType || !['breakfast','lunch','dinner','snack'].includes(draft.mealType)) issues.push('Öğün seçin.');
  if (draft.calories == null || !Number.isInteger(draft.calories) || draft.calories < 0 || draft.calories > 10000) issues.push('Kalori: 0–10000 arasında tam sayı gerekli.');
  for (const [key,label] of [['protein','Protein'],['carbs','Karbonhidrat'],['fat','Yağ']] as const) {
    const value = draft.macros[key];
    if (value == null || !Number.isFinite(value) || value < 0 || value > 1000) issues.push(`${label}: 0–1000 arasında değer gerekli.`);
  }
  return issues;
}
export function draftToRecipeInput(draft: RecipeDraft): RecipeInput {
  // No Number(null), default nutrient values, or nutritional estimation.
  if (draftIssues(draft).length) throw new Error('incomplete_recipe');
  return normalizeRecipeInput(draft as RecipeInput);
}
