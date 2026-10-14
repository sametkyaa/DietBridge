import {
  getMealCompletionPhotoPreviewUrls,
  isCanonicalMealCompletionPhotoPath,
  getMealPhotoPreviewUrls,
  isCanonicalMealPhotoPath,
  isLegacyMealPhotoUrl,
} from './mealPhotoService';
import {
  getRecipeImagePreview,
  isCanonicalRecipeImagePath,
} from '../../recipes/services/recipeService';

/**
 * Resolves persisted meal image references once per load/save cycle. Storage
 * paths are never replaced with signed URLs in the meal-plan data model.
 */
export const getMealImagePreviewUrls = async (
  references: Array<string | null | undefined>,
): Promise<Map<string, string>> => {
  const uniqueReferences = Array.from(new Set(references.filter((value): value is string => typeof value === 'string')));
  const previews = new Map<string, string>();

  uniqueReferences.filter(isLegacyMealPhotoUrl).forEach((url) => previews.set(url, url));

  const [completionPhotoPreviews, mealPhotoPreviews, recipeResults] = await Promise.all([
    getMealCompletionPhotoPreviewUrls(
      uniqueReferences.filter(isCanonicalMealCompletionPhotoPath),
    ),
    getMealPhotoPreviewUrls(uniqueReferences.filter(isCanonicalMealPhotoPath)),
    Promise.allSettled(
      uniqueReferences
        .filter(isCanonicalRecipeImagePath)
        .map(async (path) => [path, await getRecipeImagePreview(path)] as const),
    ),
  ]);
  completionPhotoPreviews.forEach((url, path) => previews.set(path, url));
  mealPhotoPreviews.forEach((url, path) => previews.set(path, url));
  recipeResults.forEach((result) => {
    if (result.status === 'fulfilled') previews.set(result.value[0], result.value[1]);
  });

  return previews;
};
