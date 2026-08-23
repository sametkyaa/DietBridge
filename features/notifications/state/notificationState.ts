import type { NotificationCursor, NotificationItem, NotificationPage } from '../types/notification';

export interface NotificationCollectionState {
  notifications: NotificationItem[];
  nextCursor: NotificationCursor | null;
  hasMore: boolean;
}

const compareNotifications = (left: NotificationItem, right: NotificationItem): number => {
  const occurredAtDifference = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  if (occurredAtDifference !== 0) return occurredAtDifference;
  return right.id.localeCompare(left.id);
};

export const sortNotifications = (notifications: readonly NotificationItem[]): NotificationItem[] => (
  [...notifications].sort(compareNotifications)
);

export const mergeNotificationItems = (
  current: readonly NotificationItem[],
  incoming: readonly NotificationItem[],
): NotificationItem[] => {
  const byId = new Map(current.map((notification) => [notification.id, notification]));
  for (const notification of incoming) byId.set(notification.id, notification);
  return sortNotifications([...byId.values()]);
};

export const mergeNotificationPage = (
  current: readonly NotificationItem[],
  page: NotificationPage,
): NotificationCollectionState => ({
  notifications: mergeNotificationItems(current, page.notifications),
  nextCursor: page.nextCursor,
  hasMore: page.hasMore,
});

/** Replace only an item already exposed in the current collection. */
export const replaceNotificationById = (
  current: readonly NotificationItem[],
  notification: NotificationItem,
): NotificationItem[] => {
  if (!current.some((item) => item.id === notification.id)) return [...current];
  return sortNotifications(current.map((item) => (
    item.id === notification.id ? notification : item
  )));
};

export const removeNotificationById = (
  current: readonly NotificationItem[],
  notificationId: string,
): NotificationItem[] => current.filter((item) => item.id !== notificationId);

export interface NotificationSessionToken {
  generation: number;
  userId: string | null;
}

export interface NotificationSessionGuard {
  begin: (userId: string | null) => NotificationSessionToken;
  invalidate: () => void;
  current: () => NotificationSessionToken;
  isCurrent: (token: NotificationSessionToken) => boolean;
}

export const createNotificationSessionGuard = (): NotificationSessionGuard => {
  let generation = 0;
  let currentUserId: string | null = null;

  const current = (): NotificationSessionToken => ({
    generation,
    userId: currentUserId,
  });

  return {
    begin: (userId) => {
      generation += 1;
      currentUserId = userId;
      return current();
    },
    invalidate: () => {
      generation += 1;
      currentUserId = null;
    },
    current,
    isCurrent: (token) => token.generation === generation && token.userId === currentUserId,
  };
};
