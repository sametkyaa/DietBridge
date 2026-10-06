export type MealChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type MealChangeRequestDecision = 'approved' | 'rejected';

export interface MealChangeRequest {
  id: string;
  clientId: string;
  clientName: string;
  clientAvatarPath: string | null;
  planDate: string;
  /** Raw meal_type value sent by the mobile app ("breakfast", "lunch", … or "all"). */
  mealSlot: string;
  /** meal_type values the client selected; empty when the payload is unknown. */
  requestedSlots: string[];
  notes: string | null;
  status: MealChangeRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
  responseNote: string | null;
}
