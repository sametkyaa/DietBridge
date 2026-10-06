import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import { AUTOMATIC_TASK_LOAD_ERROR, fetchAutomaticTasks } from '../services/automaticTaskService';
import type { AutomaticTask } from '../utils/automaticTaskContract';

export type AutomaticTaskViewState =
  | { status: 'loading' }
  | { status: 'success'; tasks: AutomaticTask[] }
  | { status: 'error'; message: string };

const REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * Derived tasks are recomputed from real data on mount, on window focus and
 * every 5 minutes, so a resolved condition (new plan, new completion, decided
 * request) disappears without any user action.
 */
export const useAutomaticTasks = () => {
  const { accessState, user } = useAuth();
  const isAllowed = accessState.status === 'allowed' && Boolean(user?.id);
  const [state, setState] = useState<AutomaticTaskViewState>({ status: 'loading' });
  const versionRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!isAllowed) return;
    const version = ++versionRef.current;
    try {
      const tasks = await fetchAutomaticTasks();
      if (version === versionRef.current) setState({ status: 'success', tasks });
    } catch {
      if (version === versionRef.current) setState({ status: 'error', message: AUTOMATIC_TASK_LOAD_ERROR });
    }
  }, [isAllowed]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      versionRef.current += 1;
    };
  }, [refresh]);

  return { state, refresh };
};
