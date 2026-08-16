import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { getNotificationNavigationTarget } from '../utils/notificationNavigation';
import {
  formatNotificationRelativeTime,
  formatNotificationSummary,
} from '../utils/notificationFormatter';
import { selectVisibleUnseenNotificationIds } from '../utils/notificationVisibility';
import type { NotificationItem } from '../types/notification';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const NotificationCategoryIcon: React.FC<{ category: NotificationItem['category'] }> = ({ category }) => {
  if (category === 'chat_message') return <MessageCircle className="h-5 w-5" aria-hidden="true" />;
  if (category === 'relationship') return <Users className="h-5 w-5" aria-hidden="true" />;
  return <CalendarDays className="h-5 w-5" aria-hidden="true" />;
};

const NotificationCard: React.FC<{
  notification: NotificationItem;
  disabled: boolean;
  onActivate: (notification: NotificationItem) => void;
}> = ({ notification, disabled, onActivate }) => {
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
      className={`group flex w-full items-start gap-3 border-b border-slate-100 px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70 ${isUnread ? 'bg-emerald-50/60 hover:bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}
      aria-label={`${summary}${isUnread ? ' Okunmamış.' : ''}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isUnread ? 'bg-emerald-100 text-primary' : 'bg-slate-100 text-slate-500'}`}>
        <NotificationCategoryIcon category={notification.category} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm leading-5 ${isUnread ? 'font-semibold text-slate-800' : 'font-medium text-slate-700'}`}>
          {summary}
        </span>
        {secondaryContext && (
          <span className="mt-1 block truncate text-xs text-slate-500">{secondaryContext}</span>
        )}
        <span className="mt-2 block text-xs text-slate-400">
          <time dateTime={notification.occurredAt}>
            {formatNotificationRelativeTime(notification.occurredAt)}
          </time>
        </span>
      </span>
      {isUnread && (
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      )}
    </button>
  );
};

const NotificationLoadingState: React.FC = () => (
  <div className="space-y-3 px-5 py-5" aria-label="Bildirimler yükleniyor" data-testid="notification-loading">
    {[0, 1, 2].map((item) => (
      <div key={item} className="flex animate-pulse items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-slate-100" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <div className="h-3 w-11/12 rounded bg-slate-100" />
          <div className="h-3 w-2/5 rounded bg-slate-100" />
        </div>
      </div>
    ))}
  </div>
);

const NotificationEmptyState: React.FC<{ unreadOnly: boolean }> = ({ unreadOnly }) => (
  <div className="flex min-h-56 flex-col items-center justify-center px-8 text-center" data-testid="notification-empty">
    <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
      <Inbox className="h-5 w-5" aria-hidden="true" />
    </span>
    <p className="font-semibold text-slate-700">
      {unreadOnly ? 'Okunmamış bildiriminiz yok.' : 'Henüz bildiriminiz yok.'}
    </p>
    {!unreadOnly && <p className="mt-1 text-sm text-slate-500">Yeni bildirimler burada görünecek.</p>}
  </div>
);

const NotificationErrorState: React.FC<{
  message: string;
  onRetry: () => void;
}> = ({ message, onRetry }) => (
  <div className="mx-5 my-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3" role="alert" data-testid="notification-error">
    <div className="flex items-start gap-3">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-rose-800">Bildirimler yüklenemedi.</p>
        <p className="mt-1 text-sm text-rose-700">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Tekrar dene
        </button>
      </div>
    </div>
  </div>
);

const NotificationDrawer: React.FC = () => {
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
  } = useNotificationCenter();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const notificationListRef = useRef<HTMLDivElement>(null);
  const pendingSeenIdsRef = useRef<Set<string>>(new Set());
  const submittedSeenIdsRef = useRef<Set<string>>(new Set());
  const seenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingReadId, setPendingReadId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return undefined;

    closeButtonRef.current?.focus();
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;

      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDrawerKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDrawerKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [close, isOpen]);

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
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/20"
        aria-label="Bildirim merkezini kapat"
        onClick={close}
        data-testid="notification-drawer-overlay"
      />
      <aside
        ref={drawerRef}
        id="notification-center-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-center-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[416px] flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[min(100vw,416px)]"
        data-testid="notification-drawer"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="notification-center-title" className="text-lg font-bold text-slate-800">Bildirimler</h2>
            <p className="mt-1 text-xs text-slate-500">Güncel bildirimleriniz</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={markAllDisabled}
              className="rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="notification-mark-all-read"
            >
              {isMarkingAll ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  İşleniyor...
                </span>
              ) : 'Tümünü okundu işaretle'}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={close}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Bildirimleri kapat"
              data-testid="notification-drawer-close"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="shrink-0 border-b border-slate-100 px-5 pt-3" role="tablist" aria-label="Bildirim filtresi">
          <div className="flex gap-5">
            {([
              ['all', 'Tümü'],
              ['unread', 'Okunmamış'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-0 pb-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                data-testid={`notification-tab-${tab}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <NotificationErrorState message={errorMessage} onRetry={() => void refresh()} />}

        <div
          ref={notificationListRef}
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="notification-list-viewport"
        >
          {isLoading ? (
            <NotificationLoadingState />
          ) : notifications.length === 0 ? (
            error ? null : <NotificationEmptyState unreadOnly={activeTab === 'unread'} />
          ) : (
            <div role="list" aria-label="Bildirim listesi">
              {notifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  disabled={pendingReadId === notification.id || isMarkingAll}
                  onActivate={(item) => void handleNotificationActivate(item)}
                />
              ))}
              {hasMore && (
                <div className="flex justify-center px-5 py-4">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={isRefreshing}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60"
                    data-testid="notification-load-more"
                  >
                    {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {isRefreshing ? 'Yükleniyor...' : 'Daha fazla yükle'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {isRefreshing && !isLoading && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-slate-100 px-5 py-2 text-xs text-slate-400" aria-live="polite">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Güncelleniyor...
          </div>
        )}
      </aside>
    </>
  );
};

export default NotificationDrawer;
