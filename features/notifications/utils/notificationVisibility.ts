import type { NotificationItem } from '../types/notification';

export interface NotificationVisibilityEntry {
  id: string | null;
  isIntersecting: boolean;
  intersectionRatio: number;
}

/**
 * Selects only meaningfully visible, currently unseen cards for one bounded
 * mark-seen request. This pure boundary keeps IntersectionObserver behavior
 * deterministic in focused tests.
 */
export const selectVisibleUnseenNotificationIds = (
  entries: readonly NotificationVisibilityEntry[],
  notifications: readonly Pick<NotificationItem, 'id' | 'seenAt'>[],
  alreadySubmitted: ReadonlySet<string>,
  maximumBatchSize = 100,
): string[] => {
  const unseenIds = new Set(
    notifications
      .filter((notification) => notification.seenAt === null)
      .map((notification) => notification.id),
  );

  return [...new Set(entries
    .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)
    .map((entry) => entry.id)
    .filter((id): id is string => Boolean(id)))]
    .filter((id) => unseenIds.has(id) && !alreadySubmitted.has(id))
    .slice(0, maximumBatchSize);
};
