import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  normalizeCanonicalMealMacros,
  type CanonicalMealMacros,
} from '../../meal-plans/services/mealPlanService';

export const RECIPE_IMAGE_BUCKET = 'recipe-images';
export const RECIPE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const RECIPE_IMAGE_SIGNED_URL_SECONDS = 5 * 60;

const RECIPE_IMAGE_PATH = /^recipes\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/;
const MIME_TO_EXTENSION: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack'] as const);

export type RecipeMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Recipe {
  id: string;
  dietitianId: string;
  name: string;
  description: string | null;
  mealType: RecipeMealType;
  calories: number;
  macros: CanonicalMealMacros;
  imagePath: string | null;
  imagePreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeInput {
  name: string;
  description?: string | null;
  mealType: RecipeMealType;
  calories: number;
  macros: CanonicalMealMacros;
}

export type RecipeValidationCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_RECIPE_ID'
  | 'INVALID_RECIPE_NAME'
  | 'INVALID_RECIPE_DESCRIPTION'
  | 'INVALID_RECIPE_MEAL_TYPE'
  | 'INVALID_RECIPE_CALORIES'
  | 'INVALID_RECIPE_MACROS'
  | 'INVALID_RECIPE_IMAGE'
  | 'RECIPE_IMAGE_UPLOAD_FAILED'
  | 'INVALID_RECIPE_RESPONSE';

export class RecipeValidationError extends Error {
  constructor(public readonly code: RecipeValidationCode, public readonly field: string) {
    super(code);
    this.name = 'RecipeValidationError';
  }
}

type RecipeRow = {
  id: unknown;
  dietitian_id: unknown;
  name: unknown;
  description: unknown;
  meal_type: unknown;
  calories: unknown;
  protein: unknown;
  carbs: unknown;
  fat: unknown;
  image_path: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const assertAuthenticatedDietitianId = async (): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !isValidUuid(user.id)) {
    throw new RecipeValidationError('AUTH_REQUIRED', 'auth.uid');
  }
  return user.id;
};

const assertFiniteNonNegative = (value: unknown, field: string, code: RecipeValidationCode): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RecipeValidationError(code, field);
  }
  return value;
};

export const normalizeRecipeInput = (input: RecipeInput): RecipeInput => {
  const name = input.name?.trim();
  if (!name || name.length > 160) {
    throw new RecipeValidationError('INVALID_RECIPE_NAME', 'name');
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) {
    throw new RecipeValidationError('INVALID_RECIPE_DESCRIPTION', 'description');
  }
  if (!MEAL_TYPES.has(input.mealType)) {
    throw new RecipeValidationError('INVALID_RECIPE_MEAL_TYPE', 'meal_type');
  }
  const calories = assertFiniteNonNegative(input.calories, 'calories', 'INVALID_RECIPE_CALORIES');
  if (!Number.isInteger(calories) || calories > 10000) {
    throw new RecipeValidationError('INVALID_RECIPE_CALORIES', 'calories');
  }
  let macros: CanonicalMealMacros;
  try {
    macros = normalizeCanonicalMealMacros(input.macros, 'macros');
  } catch {
    throw new RecipeValidationError('INVALID_RECIPE_MACROS', 'macros');
  }
  if (macros.protein > 1000 || macros.carbs > 1000 || macros.fat > 1000) {
    throw new RecipeValidationError('INVALID_RECIPE_MACROS', 'macros');
  }
  return { name, description, mealType: input.mealType, calories, macros };
};

export const isCanonicalRecipeImagePath = (value: unknown): value is string => (
  typeof value === 'string' && RECIPE_IMAGE_PATH.test(value)
);

export const validateRecipeImageFile = (file: File): void => {
  if (!(file instanceof File) || !MIME_TO_EXTENSION[file.type] || file.size <= 0 || file.size > RECIPE_IMAGE_MAX_BYTES) {
    throw new RecipeValidationError('INVALID_RECIPE_IMAGE', 'image');
  }
};

const mapRecipeRow = (row: RecipeRow, expectedDietitianId: string, imagePreview: string | null): Recipe => {
  if (
    !isValidUuid(row.id)
    || row.dietitian_id !== expectedDietitianId
    || typeof row.name !== 'string'
    || !row.name.trim()
    || (row.description !== null && typeof row.description !== 'string')
    || !MEAL_TYPES.has(row.meal_type as RecipeMealType)
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
    || (row.image_path !== null && !isCanonicalRecipeImagePath(row.image_path))
  ) {
    throw new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes');
  }

  const calories = assertFiniteNonNegative(row.calories, 'recipes.calories', 'INVALID_RECIPE_RESPONSE');
  if (!Number.isInteger(calories) || calories > 10000) {
    throw new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes.calories');
  }
  let macros: CanonicalMealMacros;
  try {
    macros = normalizeCanonicalMealMacros({ protein: row.protein, carbs: row.carbs, fat: row.fat }, 'recipes.macros');
  } catch {
    throw new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes.macros');
  }
  if (macros.protein > 1000 || macros.carbs > 1000 || macros.fat > 1000) {
    throw new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes.macros');
  }

  return {
    id: row.id as string,
    dietitianId: row.dietitian_id as string,
    name: row.name as string,
    description: row.description as string | null,
    mealType: row.meal_type as RecipeMealType,
    calories,
    macros,
    imagePath: row.image_path as string | null,
    imagePreview,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
};

export const getRecipeImagePreview = async (imagePath: string): Promise<string> => {
  if (!isCanonicalRecipeImagePath(imagePath)) {
    throw new RecipeValidationError('INVALID_RECIPE_IMAGE', 'image_path');
  }
  const { data, error } = await supabase.storage
    .from(RECIPE_IMAGE_BUCKET)
    .createSignedUrl(imagePath, RECIPE_IMAGE_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new RecipeValidationError('INVALID_RECIPE_IMAGE', 'image_path');
  }
  return data.signedUrl;
};

const getRecipeImagePreviews = async (imagePaths: Array<string | null>): Promise<Map<string, string>> => {
  const paths = Array.from(new Set(imagePaths.filter(isCanonicalRecipeImagePath)));
  const results = await Promise.allSettled(paths.map(async (path) => [path, await getRecipeImagePreview(path)] as const));
  return new Map(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
};

export const fetchRecipes = async (): Promise<Recipe[]> => {
  const dietitianId = await assertAuthenticatedDietitianId();
  const { data, error } = await supabase
    .from('recipes')
    .select('id, dietitian_id, name, description, meal_type, calories, protein, carbs, fat, image_path, created_at, updated_at')
    .eq('dietitian_id', dietitianId)
    .order('created_at', { ascending: false });
  if (error || !Array.isArray(data)) {
    throw error ?? new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes');
  }
  const previews = await getRecipeImagePreviews(data.map((recipe) => recipe.image_path));
  return (data as RecipeRow[]).map((recipe) => mapRecipeRow(
    recipe,
    dietitianId,
    isCanonicalRecipeImagePath(recipe.image_path) ? previews.get(recipe.image_path) ?? null : null,
  ));
};

const toRecipePayload = (dietitianId: string, input: RecipeInput, imagePath: string | null, id?: string) => ({
  ...(id ? { id } : {}),
  dietitian_id: dietitianId,
  name: input.name,
  description: input.description ?? null,
  meal_type: input.mealType,
  calories: input.calories,
  protein: input.macros.protein,
  carbs: input.macros.carbs,
  fat: input.macros.fat,
  image_path: imagePath,
});

export const uploadRecipeImage = async ({ file, dietitianId, recipeId }: { file: File; dietitianId: string; recipeId: string }): Promise<string> => {
  if (!isValidUuid(dietitianId) || !isValidUuid(recipeId)) {
    throw new RecipeValidationError('INVALID_RECIPE_ID', 'recipe_id');
  }
  validateRecipeImageFile(file);
  const imagePath = `recipes/${dietitianId}/${recipeId}/${crypto.randomUUID()}.${MIME_TO_EXTENSION[file.type]}`;
  const { error } = await supabase.storage
    .from(RECIPE_IMAGE_BUCKET)
    .upload(imagePath, file, { contentType: file.type, upsert: false });
  if (error) {
    throw new RecipeValidationError('RECIPE_IMAGE_UPLOAD_FAILED', 'image');
  }
  return imagePath;
};

export const createRecipe = async (input: RecipeInput, imageFile?: File | null): Promise<Recipe> => {
  const dietitianId = await assertAuthenticatedDietitianId();
  const normalized = normalizeRecipeInput(input);
  const recipeId = crypto.randomUUID();
  let imagePath: string | null = null;
  try {
    if (imageFile) imagePath = await uploadRecipeImage({ file: imageFile, dietitianId, recipeId });
    const { data, error } = await supabase
      .from('recipes')
      .insert(toRecipePayload(dietitianId, normalized, imagePath, recipeId))
      .select('id, dietitian_id, name, description, meal_type, calories, protein, carbs, fat, image_path, created_at, updated_at')
      .single();
    if (error || !data) throw error ?? new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes');
    const imagePreview = imagePath ? await getRecipeImagePreview(imagePath).catch(() => null) : null;
    return mapRecipeRow(data as RecipeRow, dietitianId, imagePreview);
  } catch (error) {
    if (imagePath) await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([imagePath]);
    throw error;
  }
};

export const updateRecipe = async (recipeId: string, input: RecipeInput, imageFile?: File | null): Promise<Recipe> => {
  if (!isValidUuid(recipeId)) throw new RecipeValidationError('INVALID_RECIPE_ID', 'recipe_id');
  const dietitianId = await assertAuthenticatedDietitianId();
  const normalized = normalizeRecipeInput(input);
  const { data: existing, error: existingError } = await supabase
    .from('recipes')
    .select('image_path')
    .eq('id', recipeId)
    .eq('dietitian_id', dietitianId)
    .maybeSingle();
  if (existingError || !existing || (existing.image_path !== null && !isCanonicalRecipeImagePath(existing.image_path))) {
    throw existingError ?? new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipe_id');
  }
  const previousImagePath = existing.image_path;
  let imagePath: string | null = previousImagePath;
  if (imageFile) imagePath = await uploadRecipeImage({ file: imageFile, dietitianId, recipeId });
  const { data, error } = await supabase
    .from('recipes')
    .update(toRecipePayload(dietitianId, normalized, imagePath))
    .eq('id', recipeId)
    .eq('dietitian_id', dietitianId)
    .select('id, dietitian_id, name, description, meal_type, calories, protein, carbs, fat, image_path, created_at, updated_at')
    .single();
  if (error || !data) {
    if (imagePath) await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([imagePath]);
    throw error ?? new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipes');
  }
  const imagePreview = imagePath ? await getRecipeImagePreview(imagePath).catch(() => null) : null;
  if (imageFile && previousImagePath && previousImagePath !== imagePath) {
    await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([previousImagePath]);
  }
  return mapRecipeRow(data as RecipeRow, dietitianId, imagePreview);
};

export const deleteRecipe = async (recipeId: string): Promise<void> => {
  if (!isValidUuid(recipeId)) throw new RecipeValidationError('INVALID_RECIPE_ID', 'recipe_id');
  const dietitianId = await assertAuthenticatedDietitianId();
  const { data: existing, error: existingError } = await supabase
    .from('recipes')
    .select('image_path')
    .eq('id', recipeId)
    .eq('dietitian_id', dietitianId)
    .maybeSingle();
  if (existingError || !existing) throw existingError ?? new RecipeValidationError('INVALID_RECIPE_RESPONSE', 'recipe_id');
  const { error } = await supabase.from('recipes').delete().eq('id', recipeId).eq('dietitian_id', dietitianId);
  if (error) throw error;
  if (isCanonicalRecipeImagePath(existing.image_path)) {
    await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([existing.image_path]);
  }
};

export const getRecipeUserMessage = (error: unknown): string => {
  if (error instanceof RecipeValidationError) {
    if (error.code === 'AUTH_REQUIRED') return 'Oturum doğrulanamadı. Lütfen yeniden giriş yapın.';
    if (error.code === 'INVALID_RECIPE_NAME') return 'Tarif adı boş olamaz ve en fazla 160 karakter olmalıdır.';
    if (error.code === 'INVALID_RECIPE_DESCRIPTION') return 'Tarif açıklaması en fazla 2000 karakter olabilir.';
    if (error.code === 'INVALID_RECIPE_MEAL_TYPE') return 'Geçerli bir öğün tipi seçin.';
    if (error.code === 'INVALID_RECIPE_CALORIES' || error.code === 'INVALID_RECIPE_MACROS') return 'Kalori ve makrolar sıfır veya daha büyük geçerli sayılar olmalıdır.';
    if (error.code === 'INVALID_RECIPE_IMAGE' || error.code === 'RECIPE_IMAGE_UPLOAD_FAILED') return 'Görsel JPEG, PNG veya WebP olmalı ve 5 MiB sınırını aşmamalıdır.';
  }
  return 'Tarif işlemi tamamlanamadı. Lütfen tekrar deneyin.';
};
