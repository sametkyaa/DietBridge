import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
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
const FALLBACK_POLL_MS = 60_000;

export const UnreadCountsProvider = ({ children }: { children: ReactNode }) => {
  const { accessState, user } = useAuth();
  const userId = accessState.status === 'allowed' ? user?.id ?? null : null;
  const [state, setState] = useState<UnreadCountsState>({ status: 'loading' });
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
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
    if (!userId) return undefined;
    void refresh();
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void refresh(); }, REFETCH_DEBOUNCE_MS);
    };
    const unsubscribe = subscribeToUnreadCountChanges(userId, schedule);
    const poll = setInterval(() => { void refresh(); }, FALLBACK_POLL_MS);
    const onFocus = () => schedule();
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe();
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      if (timerRef.current) clearTimeout(timerRef.current);
      versionRef.current += 1;
    };
  }, [refresh, userId]);

  const value = useMemo<UnreadCountsContextValue>(() => ({
    state,
    countForConversation: (conversationId) => {
      if (state.status !== 'success' || !conversationId) return null;
      return state.counts.find((item) => item.conversationId === conversationId)?.unreadCount ?? 0;
    },
    refresh,
  }), [refresh, state]);

  return <UnreadCountsContext.Provider value={value}>{children}</UnreadCountsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useUnreadCounts = () => useContext(UnreadCountsContext);
