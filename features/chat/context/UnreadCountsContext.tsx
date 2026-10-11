import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import { subscribeToHealthDataRefresh } from '../../../shared/utils/healthDataRefresh';
import {
  fetchDietitianUnreadCounts,
  subscribeToUnreadCountChanges,
  sumUnreadCounts,
  type ConversationUnreadCount,
} from '../services/unreadCountService';

export type UnreadCountsState =
  | { status: 'loading' }
  | { status: 'success'; counts: ConversationUnreadCount[]; total: number; conversationsWithUnread: number }
  | { status: 'error' };

interface UnreadCountsContextValue {
  state: UnreadCountsState;
  /** Unread count of one conversation; null while unknown. */
  countForConversation: (conversationId: string | null) => number | null;
  refresh: () => Promise<void>;
}

const UnreadCountsContext = createContext<UnreadCountsContextValue>({
  state: { status: 'loading' },
  countForConversation: () => null,
  refresh: async () => undefined,
});

const REFETCH_DEBOUNCE_MS = 250;

export const UnreadCountsProvider = ({ children }: { children: ReactNode }) => {
  const { accessState, user } = useAuth();
  const userId = accessState.status === 'allowed' ? user?.id ?? null : null;
  const [state, setState] = useState<UnreadCountsState>({ status: 'loading' });
  const [stateOwnerId, setStateOwnerId] = useState<string | null>(null);
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCounts = useCallback(() => {
    versionRef.current += 1;
    setState({ status: 'loading' });
    setStateOwnerId(null);
  }, []);

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    setStateOwnerId(userId);
    if (!userId) return;
    const version = ++versionRef.current;
    try {
      const counts = await fetchDietitianUnreadCounts();
      if (version !== versionRef.current) return;
      setState({
        status: 'success',
        counts,
        total: sumUnreadCounts(counts),
        conversationsWithUnread: counts.filter((item) => item.unreadCount > 0).length,
      });
    } catch {
      if (version !== versionRef.current) return;
      setState({ status: 'error' });
    }
  }, [userId]);

  useEffect(() => {
    clearCounts();
    if (!userId) return undefined;
    void refresh();
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void refresh(); }, REFETCH_DEBOUNCE_MS);
    };
    const unsubscribe = subscribeToUnreadCountChanges(userId, schedule);
    const stopRefresh = subscribeToHealthDataRefresh(refresh, clearCounts);
    return () => {
      unsubscribe();
      stopRefresh();
      if (timerRef.current) clearTimeout(timerRef.current);
      versionRef.current += 1;
    };
  }, [clearCounts, refresh, userId]);

  const visibleState = useMemo<UnreadCountsState>(() => (
    userId && stateOwnerId === userId ? state : { status: 'loading' }
  ), [state, stateOwnerId, userId]);
  const value = useMemo<UnreadCountsContextValue>(() => ({
    state: visibleState,
    countForConversation: (conversationId) => {
      if (visibleState.status !== 'success' || !conversationId) return null;
      return visibleState.counts.find((item) => item.conversationId === conversationId)?.unreadCount ?? 0;
    },
    refresh,
  }), [refresh, visibleState]);

  return <UnreadCountsContext.Provider value={value}>{children}</UnreadCountsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useUnreadCounts = () => useContext(UnreadCountsContext);
