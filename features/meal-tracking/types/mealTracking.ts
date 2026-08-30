export type MealTrackingFilter = 'today' | '7d' | 'date';

export type MealTrackingMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type MealTrackingMealStatus = 'completed' | 'pending' | 'unmarked';

export type MealTrackingOverviewView = 'today' | '7d';

export type MealTrackingOverviewTypeStatus = 'complete' | 'partial' | 'unmarked';

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

export interface MealTrackingOverviewMealEntry {
  kind: 'meal';
  id: string;
  type: MealTrackingMealType;
  label: string;
  time: string;
  title: string;
  status: MealTrackingMealStatus;
}

export interface MealTrackingOverviewTypeEntry {
  kind: 'type';
  type: MealTrackingMealType;
  label: string;
  completedCount: number;
  plannedCount: number;
  status: MealTrackingOverviewTypeStatus;
}

export type MealTrackingOverviewSummaryEntry =
  | MealTrackingOverviewMealEntry
  | MealTrackingOverviewTypeEntry;

export interface MealTrackingOverviewClient {
  clientId: string;
  displayName: string;
  avatar: string;
  completedCount: number;
  plannedCount: number;
  percentage: number | null;
  mealSummary: MealTrackingOverviewSummaryEntry[];
  lastCompletedAt: string | null;
}
