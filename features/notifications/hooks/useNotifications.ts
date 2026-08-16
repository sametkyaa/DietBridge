import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  getNotificationUnseenCount,
  listNotifications,
  markNotificationRead,
  markNotificationsSeen,
  markNotificationSeen,
  NotificationServiceError,
  subscribeToNotifications,
  type NotificationRealtimeStatus,
} from '../services/notificationService';
import {
  createNotificationSessionGuard,
  mergeNotificationPage,
  removeNotificationById,
  replaceNotificationById,
  type NotificationSessionToken,
} from '../state/notificationState';
import type {
  NotificationErrorState,
  NotificationItem,
  NotificationPage,
} from '../types/notification';

const REFRESH_DEBOUNCE_MS = 150;
const UNAUTHENTICATED_MESSAGE = 'Bildirimleri görmek için oturum açmanız gerekir.';
const FORBIDDEN_MESSAGE = 'Bildirim kayıtlarına erişim izniniz yok.';
const GENERIC_REFRESH_MESSAGE = 'Bildirimler yüklenemedi. Lütfen tekrar deneyin.';

export interface UseNotificationsOptions {
  unreadOnly?: boolean;
  pageSize?: number;
}

export interface UseNotificationsResult {
  notifications: NotificationItem[];
  unseenCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  error: NotificationErrorState | null;
  hasMore: boolean;
  loadMore: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
  markSeen: (id: string) => Promise<boolean>;
  markRead: (id: string) => Promise<boolean>;
  markVisibleSeen: (ids: readonly string[]) => Promise<boolean>;
}

const toErrorState = (cause: unknown, fallback = GENERIC_REFRESH_MESSAGE): NotificationErrorState => {
  if (cause instanceof NotificationServiceError) {
    return { code: cause.code, message: cause.userMessage };
  }
  return { code: 'UNKNOWN', message: fallback };
};

const authErrorState = (hasUser: boolean): NotificationErrorState => ({
  code: hasUser ? 'FORBIDDEN' : 'UNAUTHENTICATED',
  message: hasUser ? FORBIDDEN_MESSAGE : UNAUTHENTICATED_MESSAGE,
});

export const useNotifications = (
  options: UseNotificationsOptions = {},
): UseNotificationsResult => {
  const { accessState, user } = useAuth();
  const unreadOnly = options.unreadOnly === true;
  const pageSize = options.pageSize;
  const currentUserId = isValidUuid(user?.id) ? user.id : null;
  const isResolvingAccess = accessState.status === 'initializing' || accessState.status === 'resolving_access';
  const isReady = accessState.status === 'allowed' && currentUserId !== null;

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<NotificationErrorState | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const mountedRef = useRef(true);
  const guardRef = useRef(createNotificationSessionGuard());
  const requestVersionRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const pageRef = useRef<{ nextCursor: NotificationPage['nextCursor']; hasMore: boolean }>({
    nextCursor: null,
    hasMore: false,
  });
  const scheduleRefreshRef = useRef<() => void>(() => undefined);

  const isCurrentToken = useCallback((token: NotificationSessionToken): boolean => (
    mountedRef.current && guardRef.current.isCurrent(token)
  ), []);

  const executeRefresh = useCallback(async (): Promise<boolean> => {
    if (!isReady || !currentUserId) return false;
    const token = guardRef.current.current();
    if (token.userId !== currentUserId) return false;
    const requestId = ++requestVersionRef.current;
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      const [page, nextUnseenCount] = await Promise.all([
        listNotifications({ pageSize, unreadOnly }),
        getNotificationUnseenCount(),
      ]);
      if (!isCurrentToken(token) || requestId !== requestVersionRef.current) return false;
      setNotifications(page.notifications);
      setUnseenCount(nextUnseenCount);
      setHasMore(page.hasMore);
      pageRef.current = { nextCursor: page.nextCursor, hasMore: page.hasMore };
      hasLoadedRef.current = true;
      return true;
    } catch (cause) {
      if (!isCurrentToken(token) || requestId !== requestVersionRef.current) return false;
      setError(toErrorState(cause));
      return false;
    } finally {
      if (isCurrentToken(token) && requestId === requestVersionRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [currentUserId, isCurrentToken, isReady, pageSize, unreadOnly]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      return false;
    }
    refreshInFlightRef.current = true;
    try {
      return await executeRefresh();
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current && mountedRef.current) {
        refreshPendingRef.current = false;
        scheduleRefreshRef.current();
      }
    }
  }, [executeRefresh]);

  const scheduleRefresh = useCallback((): void => {
    if (!isReady || !mountedRef.current) return;
    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [isReady, refresh]);
  scheduleRefreshRef.current = scheduleRefresh;

  useEffect(() => {
    mountedRef.current = true;
    const updateForeground = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      scheduleRefreshRef.current();
    };
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      window.addEventListener('focus', updateForeground);
      document.addEventListener('visibilitychange', updateForeground);
    }
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      refreshPendingRef.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        window.removeEventListener('focus', updateForeground);
        document.removeEventListener('visibilitychange', updateForeground);
      }
    };
  }, []);

  useEffect(() => {
    const sessionGuard = guardRef.current;
    const token = sessionGuard.begin(isReady ? currentUserId : null);
    requestVersionRef.current += 1;
    hasLoadedRef.current = false;
    pageRef.current = { nextCursor: null, hasMore: false };
    setNotifications([]);
    setUnseenCount(0);
    setHasMore(false);
    setError(isResolvingAccess ? null : (isReady ? null : authErrorState(Boolean(user?.id))));
    setIsLoading(isResolvingAccess || isReady);
    setIsRefreshing(false);

    if (!isReady || !currentUserId) {
      return () => { sessionGuard.invalidate(); };
    }

    const subscription = subscribeToNotifications({
      onChange: () => {
        if (isCurrentToken(token)) scheduleRefreshRef.current();
      },
      onStatus: (status: NotificationRealtimeStatus) => {
        if (!isCurrentToken(token)) return;
        if (status === 'connected') scheduleRefreshRef.current();
        if (status === 'error' || status === 'disconnected') {
          setError({ code: 'REALTIME', message: 'Bildirim güncellemeleri bağlanamadı.' });
        }
      },
    });
    void refresh();

    return () => {
      sessionGuard.invalidate();
      requestVersionRef.current += 1;
      void subscription.unsubscribe();
    };
  }, [
    currentUserId,
    isCurrentToken,
    isReady,
    isResolvingAccess,
    refresh,
    scheduleRefreshRef,
    unreadOnly,
    pageSize,
    user?.id,
  ]);

  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!isReady || !currentUserId || loadMoreInFlightRef.current || !pageRef.current.hasMore) return false;
    const cursor = pageRef.current.nextCursor;
    if (!cursor) return false;
    const token = guardRef.current.current();
    if (token.userId !== currentUserId) return false;
    const requestId = ++requestVersionRef.current;
    loadMoreInFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);
    try {
      const page = await listNotifications({ cursor, pageSize, unreadOnly });
      if (!isCurrentToken(token) || requestId !== requestVersionRef.current) return false;
      setNotifications((current) => mergeNotificationPage(current, page).notifications);
      setHasMore(page.hasMore);
      pageRef.current = { nextCursor: page.nextCursor, hasMore: page.hasMore };
      return true;
    } catch (cause) {
      if (!isCurrentToken(token) || requestId !== requestVersionRef.current) return false;
      setError(toErrorState(cause));
      return false;
    } finally {
      if (isCurrentToken(token) && requestId === requestVersionRef.current) setIsRefreshing(false);
      loadMoreInFlightRef.current = false;
    }
  }, [currentUserId, isCurrentToken, isReady, pageSize, unreadOnly]);

  const runSingleMutation = useCallback(async (
    id: string,
    mutation: (notificationId: string) => Promise<NotificationItem>,
  ): Promise<boolean> => {
    if (!isReady || !currentUserId || !isValidUuid(id)) {
      setError({ code: 'VALIDATION', message: 'Bildirim kimliği geçersiz.' });
      return false;
    }
    const token = guardRef.current.current();
    try {
      const notification = await mutation(id);
      if (!isCurrentToken(token)) return false;
      setNotifications((current) => (
        unreadOnly && notification.readAt !== null
          ? removeNotificationById(current, notification.id)
          : replaceNotificationById(current, notification)
      ));
      try {
        const nextCount = await getNotificationUnseenCount();
        if (isCurrentToken(token)) setUnseenCount(nextCount);
      } catch (countError) {
        if (isCurrentToken(token)) setError(toErrorState(countError, 'Bildirim rozeti yenilenemedi.'));
      }
      return true;
    } catch (cause) {
      if (isCurrentToken(token)) setError(toErrorState(cause, 'Bildirim işlemi tamamlanamadı.'));
      return false;
    }
  }, [currentUserId, isCurrentToken, isReady, unreadOnly]);

  const markSeen = useCallback((id: string) => runSingleMutation(id, markNotificationSeen), [runSingleMutation]);
  const markRead = useCallback((id: string) => runSingleMutation(id, markNotificationRead), [runSingleMutation]);

  const markVisibleSeen = useCallback(async (ids: readonly string[]): Promise<boolean> => {
    if (!isReady || !currentUserId) {
      setError(authErrorState(Boolean(user?.id)));
      return false;
    }
    const token = guardRef.current.current();
    try {
      await markNotificationsSeen(ids);
      if (!isCurrentToken(token)) return false;
      return await refresh();
    } catch (cause) {
      if (isCurrentToken(token)) setError(toErrorState(cause, 'Bildirimler görüldü olarak işaretlenemedi.'));
      return false;
    }
  }, [currentUserId, isCurrentToken, isReady, refresh, user?.id]);

  return {
    notifications,
    unseenCount,
    isLoading,
    isRefreshing,
    error,
    hasMore,
    loadMore,
    refresh,
    markSeen,
    markRead,
    markVisibleSeen,
  };
};
