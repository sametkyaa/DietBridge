import type { MealChangeRequestStatus } from '../types/mealChangeRequest';

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara öğün',
  all: 'Tüm öğünler',
};

export const MEAL_CHANGE_REQUEST_STATUSES: readonly MealChangeRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export const isMealChangeRequestStatus = (value: unknown): value is MealChangeRequestStatus => (
  typeof value === 'string' && (MEAL_CHANGE_REQUEST_STATUSES as readonly string[]).includes(value)
);

/** Turkish name of a requested slot; unknown values are shown as "Öğün". */
export const formatMealChangeSlot = (slot: string): string => SLOT_LABELS[slot] ?? 'Öğün';

/**
 * Reads the slots the client selected. The store mobile build sends
 * { alternatives: ['lunch', …] }; anything else falls back to meal_slot.
 */
export const readRequestedSlots = (requestedMeals: unknown, mealSlot: string): string[] => {
  if (requestedMeals && typeof requestedMeals === 'object' && !Array.isArray(requestedMeals)) {
    const alternatives = (requestedMeals as { alternatives?: unknown }).alternatives;
    if (Array.isArray(alternatives)) {
      const slots = alternatives.filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (slots.length > 0) return [...new Set(slots)];
    }
  }
  return mealSlot ? [mealSlot] : [];
};

export const formatMealChangeSlots = (slots: readonly string[]): string => (
  slots.length === 0 ? 'Öğün' : slots.map(formatMealChangeSlot).join(', ')
);
