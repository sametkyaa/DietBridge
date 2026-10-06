import { isValidUuid } from '../../../shared/utils/uuid';
import type { NotificationItem } from '../types/notification';

/**
 * Returns only route state. The destination pages still validate the target
 * through their own authenticated data access before rendering protected data.
 */
export const getNotificationNavigationTarget = (
  notification: NotificationItem,
): string | null => {
  if (
    notification.category === 'chat_message'
    && notification.eventType === 'new_message'
    && isValidUuid(notification.conversationId)
  ) {
    return `/messages?conversationId=${encodeURIComponent(notification.conversationId)}`;
  }

  if (notification.category === 'relationship') {
    if (
      notification.eventType === 'accepted'
      && notification.relationshipToStatus === 'active'
      && isValidUuid(notification.dietitianClientId)
    ) {
      return `/clients?notificationRelationshipId=${encodeURIComponent(notification.dietitianClientId)}`;
    }

    return '/clients';
  }

  if (notification.category === 'client_activity' && isValidUuid(notification.actorId)) {
    return `/clients/${encodeURIComponent(notification.actorId)}`;
  }

  if (notification.category === 'appointment' && notification.eventType === 'reminder_30m') {
    return '/appointments';
  }

  return null;
};
