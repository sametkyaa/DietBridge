export type MealTrackingFilter = 'today' | '7d' | 'date';

export type MealTrackingMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type MealTrackingMealStatus = 'completed' | 'pending' | 'unmarked';

export interface MealTrackingMeal {
  id: string;
  planId: string;
  date: string;
  type: MealTrackingMealType;
  title: string;
  time: string;
  sortOrder: number;
  isCompleted: boolean;
  completedAt: string | null;
  photoPath: string | null;
}
export interface MealTrackingDay {
  date: string;
  meals: MealTrackingMeal[];
  completedCount: number;
  plannedCount: number;
  percentage: number | null;
}
