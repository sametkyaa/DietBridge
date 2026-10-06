import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Callout,
  Drawer,
  EmptyState,
  Icon,
  LoadingState,
  Tabs,
  cx,
  type IconName,
} from '../../../shared/ui';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { getNotificationNavigationTarget } from '../utils/notificationNavigation';
import {
  formatNotificationRelativeTime,
  formatNotificationSummary,
} from '../utils/notificationFormatter';
import { selectVisibleUnseenNotificationIds } from '../utils/notificationVisibility';
import type { NotificationItem } from '../types/notification';
import type { NotificationTab } from '../context/notificationCenterStore';

const CATEGORY_ICON: Record<NotificationItem['category'], { icon: IconName; tone: string }> = {
  chat_message: { icon: 'chat-circle', tone: 'bg-brand-tint text-brand' },
  appointment: { icon: 'calendar-blank', tone: 'bg-brand-tint text-brand' },
  relationship: { icon: 'user-plus', tone: 'bg-brand-tint text-brand' },
  client_activity: { icon: 'fork-knife', tone: 'bg-warn-bg text-warn' },
};

const iconTone = (notification: NotificationItem): string => (
  notification.category === 'client_activity' && notification.eventType === 'meal_inactivity'
    ? 'bg-bad-bg text-bad'
    : CATEGORY_ICON[notification.category].tone
);

const dayKey = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(value);

/** "Bugün", "Dün" or a date heading, grouping the list like the prototype. */
const groupLabel = (occurredAt: string, now: Date): string => {
  const key = dayKey(new Date(occurredAt));
  if (key === dayKey(now)) return 'Bugün';
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return 'Dün';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' })
    .format(new Date(occurredAt));
};

const NotificationCard = ({
  notification,
  disabled,
  onActivate,
}: {
  notification: NotificationItem;
  disabled: boolean;
  onActivate: (notification: NotificationItem) => void;
}) => {
  const isUnread = notification.readAt === null;
  const summary = formatNotificationSummary(notification);
  const secondaryContext = notification.category === 'appointment'
    ? notification.appointmentTitleSnapshot?.trim() || null
    : null;

  return (
    <button
      type="button"
      data-notification-id={notification.id}
      data-seen-at={notification.seenAt ?? ''}
      disabled={disabled}
      onClick={() => onActivate(notification)}
      className="flex w-full items-start gap-3.5 border-t border-line px-6 py-3.5 text-left transition-colors hover:bg-surface-alt focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-70"
      aria-label={`${summary}${isUnread ? ' Okunmamış.' : ''}`}
    >
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-[9px]', iconTone(notification))} aria-hidden="true">
        <Icon name={CATEGORY_ICON[notification.category].icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block text-14', isUnread ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>{summary}</span>
        {secondaryContext && <span className="block truncate text-12.5 text-ink-3">{secondaryContext}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5 text-12 text-ink-3">
        <time dateTime={notification.occurredAt}>{formatNotificationRelativeTime(notification.occurredAt)}</time>
        {isUnread && <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />}
      </span>
    </button>
  );
};

const NotificationDrawer = () => {
  const navigate = useNavigate();
  const {
    activeTab,
    close,
    error,
    hasMore,
    isLoading,
    isOpen,
    isRefreshing,
    loadMore,
    markAllRead,
    markRead,
    markVisibleSeen,
    notifications,
    refresh,
    setActiveTab,
    unseenCount,
  } = useNotificationCenter();
  const notificationListRef = useRef<HTMLDivElement>(null);
  const pendingSeenIdsRef = useRef<Set<string>>(new Set());
  const submittedSeenIdsRef = useRef<Set<string>>(new Set());
  const seenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingReadId, setPendingReadId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const groupedNotifications = useMemo(() => {
    const now = new Date();
    const groups: Array<{ label: string; items: NotificationItem[] }> = [];
    for (const notification of notifications) {
      const label = groupLabel(notification.occurredAt, now);
      const last = groups.at(-1);
      if (last && last.label === label) last.items.push(notification);
      else groups.push({ label, items: [notification] });
    }
    return groups;
  }, [notifications]);

  const flushVisibleSeen = useCallback((): void => {
    if (seenFlushTimerRef.current) {
      clearTimeout(seenFlushTimerRef.current);
      seenFlushTimerRef.current = null;
    }

    const queuedIds = [...pendingSeenIdsRef.current];
    pendingSeenIdsRef.current.clear();
    const ids = queuedIds.slice(0, 100);
    queuedIds.slice(100).forEach((id) => pendingSeenIdsRef.current.add(id));
    if (ids.length === 0) return;

    ids.forEach((id) => submittedSeenIdsRef.current.add(id));
    void markVisibleSeen(ids).then((success) => {
      if (!success) ids.forEach((id) => submittedSeenIdsRef.current.delete(id));
    });
  }, [markVisibleSeen]);

  const scheduleVisibleSeen = useCallback((): void => {
    if (seenFlushTimerRef.current || pendingSeenIdsRef.current.size === 0) return;
    seenFlushTimerRef.current = setTimeout(() => {
      seenFlushTimerRef.current = null;
      flushVisibleSeen();
    }, 80);
  }, [flushVisibleSeen]);

  useEffect(() => {
    for (const id of submittedSeenIdsRef.current) {
      const item = notifications.find((notification) => notification.id === id);
      if (!item || item.seenAt !== null) submittedSeenIdsRef.current.delete(id);
    }
  }, [notifications]);

  useEffect(() => {
    if (!isOpen || !notificationListRef.current || typeof IntersectionObserver === 'undefined') return undefined;

    const list = notificationListRef.current;
    const pendingSeenIds = pendingSeenIdsRef.current;
    const observer = new IntersectionObserver((entries) => {
      const visibleIds = selectVisibleUnseenNotificationIds(
        entries.map((entry) => ({
          id: (entry.target as HTMLElement).dataset.notificationId ?? null,
          isIntersecting: entry.isIntersecting,
          intersectionRatio: entry.intersectionRatio,
        })),
        notifications,
        submittedSeenIdsRef.current,
      );
      visibleIds.forEach((id) => pendingSeenIdsRef.current.add(id));
      scheduleVisibleSeen();
    }, { root: list, threshold: [0.5] });

    list.querySelectorAll<HTMLElement>('[data-notification-id]').forEach((card) => observer.observe(card));
    return () => {
      observer.disconnect();
      if (seenFlushTimerRef.current) {
        clearTimeout(seenFlushTimerRef.current);
        seenFlushTimerRef.current = null;
      }
      pendingSeenIds.clear();
    };
  }, [isOpen, notifications, scheduleVisibleSeen]);

  const handleNotificationActivate = useCallback(async (notification: NotificationItem): Promise<void> => {
    if (pendingReadId || isMarkingAll) return;
    const target = getNotificationNavigationTarget(notification);
    setPendingReadId(notification.id);
    const success = await markRead(notification.id);
    setPendingReadId(null);
    if (!success) return;

    close();
    if (target) navigate(target);
  }, [close, isMarkingAll, markRead, navigate, pendingReadId]);

  const handleMarkAllRead = useCallback(async (): Promise<void> => {
    if (isMarkingAll) return;
    setIsMarkingAll(true);
    await markAllRead();
    setIsMarkingAll(false);
  }, [isMarkingAll, markAllRead]);

  if (!isOpen) return null;

  const hasUnreadInLoadedState = notifications.some((notification) => notification.readAt === null);
  const markAllDisabled = isMarkingAll || (!hasUnreadInLoadedState && !hasMore);
  const errorMessage = error?.message || 'Lütfen tekrar deneyin.';

  return (
    <Drawer open={isOpen} onClose={close} title="Bildirimler">
      <div id="notification-center-drawer" data-testid="notification-drawer" className="flex h-full flex-col">
        <Tabs<NotificationTab>
          items={[
            { value: 'all', label: 'Tümü' },
            { value: 'unread', label: 'Okunmamış', count: unseenCount > 0 ? unseenCount : undefined },
          ]}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Bildirim filtresi"
          idBase="notification-tabs"
          className="px-6"
          trailing={(
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={markAllDisabled}
              className="ml-auto inline-flex items-center gap-1.5 rounded-tag px-1 text-13 font-semibold text-brand hover:text-brand-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:text-ink-3"
              data-testid="notification-mark-all-read"
            >
              <Icon name="check" size={15} />
              {isMarkingAll ? 'İşleniyor…' : 'Tümünü okundu say'}
            </button>
          )}
        />

        {error && (
          <Callout tone="bad" role="alert" className="mx-6 mt-3">
            <span data-testid="notification-error" className="flex flex-col gap-2">
              <span><b>Bildirimler yüklenemedi.</b> {errorMessage}</span>
              <Button size="sm" className="self-start" onClick={() => void refresh()}>Tekrar dene</Button>
            </span>
          </Callout>
        )}

        <div ref={notificationListRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="notification-list-viewport">
          {isLoading ? (
            <div data-testid="notification-loading">
              <LoadingState label="Bildirimler yükleniyor…" variant="skeleton" rows={4} />
            </div>
          ) : notifications.length === 0 ? (
            error ? null : (
              <div data-testid="notification-empty">
                <EmptyState
                  icon="bell"
                  title={activeTab === 'unread' ? 'Okunmamış bildiriminiz yok.' : 'Henüz bildiriminiz yok.'}
                  description={activeTab === 'unread' ? undefined : 'Yeni bildirimler burada görünecek.'}
                />
              </div>
            )
          ) : (
            <div role="list" aria-label="Bildirim listesi">
              {groupedNotifications.map((group) => (
                <Fragment key={group.label}>
                  <p className="m-0 px-6 pb-1.5 pt-3.5 text-12 font-semibold uppercase tracking-[0.06em] text-ink-3">{group.label}</p>
                  {group.items.map((notification) => (
                    <div role="listitem" key={notification.id}>
                      <NotificationCard
                        notification={notification}
                        disabled={pendingReadId === notification.id || isMarkingAll}
                        onActivate={(item) => void handleNotificationActivate(item)}
                      />
                    </div>
                  ))}
                </Fragment>
              ))}
              {hasMore && (
                <div className="flex justify-center px-6 py-4">
                  <Button
                    size="sm"
                    leftIcon="caret-down"
                    loading={isRefreshing}
                    onClick={() => void loadMore()}
                    data-testid="notification-load-more"
                  >
                    {isRefreshing ? 'Yükleniyor…' : 'Daha fazla yükle'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        {isRefreshing && !isLoading && (
          <p className="m-0 border-t border-line px-6 py-2 text-center text-12 text-ink-3" aria-live="polite">Güncelleniyor…</p>
        )}
      </div>
    </Drawer>
  );
};

export default NotificationDrawer;
