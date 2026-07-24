import type { Recipe, RecipeMealType } from '../services/recipeService';

export type RecipeCategoryFilter = 'all' | RecipeMealType;

export interface RecipeCategoryOption {
  value: RecipeCategoryFilter;
  label: string;
}

export const RECIPE_CATEGORY_OPTIONS: RecipeCategoryOption[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'breakfast', label: 'Kahvaltı' },
  { value: 'lunch', label: 'Öğle' },
  { value: 'snack', label: 'Ara Öğün' },
  { value: 'dinner', label: 'Akşam' },
];

export const getRecipeCategoryLabel = (mealType: RecipeMealType): string => {
  if (mealType === 'breakfast') return 'Kahvaltı';
  if (mealType === 'lunch') return 'Öğle';
  if (mealType === 'dinner') return 'Akşam';
  return 'Ara Öğün';
};

export const filterRecipesByCategoryAndSearch = (
  recipes: readonly Recipe[],
  categoryFilter: RecipeCategoryFilter,
  search: string,
): Recipe[] => {
  const normalizedSearch = search.trim().toLocaleLowerCase('tr-TR');
  return recipes.filter((recipe) => {
    if (categoryFilter !== 'all' && recipe.mealType !== categoryFilter) {
      return false;
    }
    if (normalizedSearch && !recipe.name.toLocaleLowerCase('tr-TR').includes(normalizedSearch)) {
      return false;
    }
    return true;
  });
};

export const countRecipesByCategory = (
  recipes: readonly Recipe[],
): Record<RecipeMealType, number> => {
  const counts: Record<RecipeMealType, number> = {
    breakfast: 0,
    lunch: 0,
    dinner: 0,
    snack: 0,
  };
  recipes.forEach((recipe) => {
    counts[recipe.mealType] = (counts[recipe.mealType] ?? 0) + 1;
  });
  return counts;
};
