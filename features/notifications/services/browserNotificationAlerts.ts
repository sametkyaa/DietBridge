import type { NotificationItem } from '../types/notification';
import { isValidUuid } from '../../../shared/utils/uuid';

type AlertKind = 'desktop' | 'sound';
type Claim = { key: string; kind: AlertKind; at: number };
const MAX_AGE_MS = 60_000;
const CLAIM_TTL_MS = 10 * 60_000;

export interface BrowserAlertDependencies {
  userId: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  locks?: Pick<LockManager, 'request'>;
  hasFocus: () => boolean;
  now?: () => number;
}

/** Realtime events only: historical page loads never enter this controller. */
export const createBrowserNotificationAlerts = ({ userId, storage, locks, hasFocus, now = Date.now }: BrowserAlertDependencies) => {
  const startedAt = now();
  const storageKey = `dietbridge:web-alert-claims:v1:${userId}`;
  const observed = new Set<string>();

  const receive = async (
    notification: NotificationItem,
    kind: AlertKind,
    eligible: () => boolean,
    present: () => boolean,
  ): Promise<boolean> => {
    const occurredAt = Date.parse(notification.occurredAt);
    if (!isValidUuid(userId) || !isValidUuid(notification.id) || notification.recipientId !== userId
      || notification.readAt || notification.seenAt || !Number.isFinite(occurredAt)
      || occurredAt < startedAt - MAX_AGE_MS || Math.abs(now() - occurredAt) > MAX_AGE_MS) return false;
    const key = `${notification.id}:${notification.occurredAt}:${notification.eventCount}`;
    const localKey = `${kind}:${key}`;
    if (observed.has(localKey)) return false;
    observed.add(localKey);
    if (observed.size > 200) observed.delete(observed.values().next().value!);
    if (!eligible()) return false;

    const claimAndPresent = (): boolean => {
      // Recheck after waiting for another tab or an account/setting change.
      if (!eligible() || Math.abs(now() - occurredAt) > MAX_AGE_MS) return false;
      let claims: Claim[] = [];
      try {
        const value: unknown = JSON.parse(storage.getItem(storageKey) ?? '[]');
        if (Array.isArray(value)) claims = value.filter((entry): entry is Claim => (
          entry && typeof entry.key === 'string' && ['desktop', 'sound'].includes(entry.kind)
          && typeof entry.at === 'number' && Math.abs(now() - entry.at) < CLAIM_TTL_MS
        ));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (claims.some((entry) => entry.kind === kind && entry.key === key)) return false;
      const throttled = claims.some((entry) => entry.kind === kind && now() - entry.at < 1200);
      // Storage is written first; unavailable persistence must not produce duplicate alerts.
      storage.setItem(storageKey, JSON.stringify([...claims, { key, kind, at: now() }].slice(-100)));
      return !throttled && present();
    };

    if (locks) return locks.request(`dietbridge:web-alert:${userId}`, claimAndPresent);
    // Without cross-tab locks only the focused tab can present an alert.
    return hasFocus() && claimAndPresent();
  };
  const seed = (notifications: readonly NotificationItem[]) => {
    for (const notification of notifications) {
      if (notification.recipientId !== userId) continue;
      const key = `${notification.id}:${notification.occurredAt}:${notification.eventCount}`;
      observed.add(`sound:${key}`);
      observed.add(`desktop:${key}`);
    }
    while (observed.size > 200) observed.delete(observed.values().next().value!);
  };
  return { receive, seed };
};
