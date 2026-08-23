import type { NotificationItem } from '../types/notification';

const FALLBACK_SUMMARY = 'Yeni bir bildiriminiz var.';

const safeActorName = (notification: NotificationItem): string | null => {
  const actorName = notification.actorDisplayName?.trim();
  return actorName || null;
};

const safeEventCount = (notification: NotificationItem): number => (
  Number.isInteger(notification.eventCount) && notification.eventCount > 0
    ? notification.eventCount
    : 1
);

/**
 * Builds user-facing notification copy from bounded Notification Core
 * metadata only. Chat bodies are deliberately not part of this formatter.
 */
export const formatNotificationSummary = (notification: NotificationItem): string => {
  switch (notification.category) {
    case 'chat_message': {
      const actorName = safeActorName(notification);
      if (!actorName) return 'Yeni mesajınız var.';

      const eventCount = safeEventCount(notification);
      return eventCount === 1
        ? `${actorName} size yeni bir mesaj gönderdi.`
        : `${actorName} size ${eventCount} yeni mesaj gönderdi.`;
    }

    case 'relationship':
      switch (notification.eventType) {
        case 'request_pending':
          return 'Yeni bir diyetisyen bağlantı isteğiniz var.';
        case 'accepted':
          return safeActorName(notification)
            ? `${safeActorName(notification)} bağlantı isteğinizi kabul etti.`
            : 'Bağlantı isteğiniz kabul edildi.';
        case 'rejected':
          return safeActorName(notification)
            ? `${safeActorName(notification)} bağlantı isteğinizi reddetti.`
            : 'Bağlantı isteğiniz reddedildi.';
        case 'removed':
          return 'Diyetisyen bağlantınız sonlandırıldı.';
        default:
          return FALLBACK_SUMMARY;
      }

    case 'appointment':
      switch (notification.eventType) {
        case 'created':
          return 'Yeni bir randevu bildiriminiz var.';
        case 'updated':
          return 'Randevunuz güncellendi.';
        case 'cancelled':
          return 'Randevunuz iptal edildi.';
        case 'assigned':
          return 'Yeni bir randevu atandı.';
        case 'removed_from_client':
          return 'Randevu bildiriminiz var.';
        case 'reminder_24h':
          return 'Randevuya 24 saat kaldı';
        case 'reminder_1h':
          return 'Randevuya 1 saat kaldı';
        default:
          return 'Randevu bildiriminiz var.';
      }

    default:
      return FALLBACK_SUMMARY;
  }
};

export const formatNotificationRelativeTime = (
  occurredAt: string,
  now = new Date(),
): string => {
  const timestamp = new Date(occurredAt);
  if (Number.isNaN(timestamp.getTime())) return '';

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 1000));
  if (elapsedSeconds < 60) return 'Şimdi';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} dk önce`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} sa önce`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return 'Dün';
  if (elapsedDays < 7) return `${elapsedDays} gün önce`;

  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: timestamp.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(timestamp);
};
