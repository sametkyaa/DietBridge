export const MEAL_ACTIVITY_KIND = 'meal_activity' as const;

export interface MealActivity {
  id: string;
  kind: typeof MEAL_ACTIVITY_KIND;
  relationId: string;
  conversationId: string;
  clientId: string;
  dietitianId: string;
  mealId: string;
  planId: string;
  mealDate: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  mealTitle: string;
  mealTime: string;
  completedAt: string;
  createdAt: string;
  photoPath: string | null;
  isHumanMessage: false;
  requiresRead: false;
}
