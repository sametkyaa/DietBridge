export type NotificationCategory = 'chat_message' | 'appointment' | 'relationship';

export type NotificationEventType =
  | 'new_message'
  | 'created'
  | 'updated'
  | 'cancelled'
  | 'assigned'
  | 'removed_from_client'
  | 'request_pending'
  | 'accepted'
  | 'rejected'
  | 'removed';

export type NotificationSummaryKey =
  | 'chat_new_message'
  | 'appointment_created'
  | 'appointment_updated'
  | 'appointment_cancelled'
  | 'appointment_assigned'
  | 'appointment_removed_from_client'
  | 'relationship_request_pending'
  | 'relationship_accepted'
  | 'relationship_rejected'
  | 'relationship_removed';

export type NotificationAppointmentStatus = 'upcoming' | 'completed' | 'cancelled';
export type NotificationRelationshipStatus = 'pending' | 'active' | 'rejected' | 'removed';

export type NotificationServiceErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'MALFORMED'
  | 'FETCH'
  | 'RPC'
  | 'REALTIME'
  | 'NETWORK'
  | 'UNKNOWN';

export interface NotificationErrorState {
  code: NotificationServiceErrorCode;
  message: string;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  category: NotificationCategory;
  eventType: NotificationEventType;
  aggregationKey: string;
  actorId: string | null;
  actorDisplayName: string | null;
  conversationId: string | null;
  appointmentId: string | null;
  dietitianClientId: string | null;
  summaryKey: NotificationSummaryKey;
  appointmentTitleSnapshot: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  appointmentStatus: NotificationAppointmentStatus | null;
  relationshipFromStatus: NotificationRelationshipStatus | null;
  relationshipToStatus: NotificationRelationshipStatus | null;
  eventCount: number;
  occurredAt: string;
  seenAt: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationCursor {
  occurredAt: string;
  id: string;
}

export interface NotificationPage {
  notifications: NotificationItem[];
  nextCursor: NotificationCursor | null;
  hasMore: boolean;
}
