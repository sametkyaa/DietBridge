import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import { AUTOMATIC_TASK_LOAD_ERROR, fetchAutomaticTasks } from '../services/automaticTaskService';
import type { AutomaticTask } from '../utils/automaticTaskContract';
import { automaticTaskRevision, filterDismissedAutomaticTasks } from '../utils/automaticTaskContract';
import { AUTOMATIC_TASK_DELETE_ERROR, dismissAutomaticTask, fetchAutomaticTaskDismissals } from '../services/automaticTaskDismissalService';

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
  const ownerId = isAllowed ? user?.id ?? null : null;
  const [state, setState] = useState<AutomaticTaskViewState>({ status: 'loading' });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const actionRef = useRef(false);
  const generationRef = useRef(0);
  const versionRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    const version = ++versionRef.current;
    try {
      const [tasks, dismissals] = await Promise.all([fetchAutomaticTasks(), fetchAutomaticTaskDismissals(ownerId)]);
      if (version === versionRef.current) setState({ status: 'success', tasks: filterDismissedAutomaticTasks(tasks, dismissals) });
    } catch {
      if (version === versionRef.current) setState({ status: 'error', message: AUTOMATIC_TASK_LOAD_ERROR });
    }
  }, [ownerId]);

  const deleteTask = async (task: AutomaticTask): Promise<boolean> => {
    if (!ownerId || actionRef.current) return false;
    actionRef.current = true;
    const generation = generationRef.current;
    setPendingAction(task.key);
    setMutationError(null);
    try {
      await dismissAutomaticTask(task, ownerId);
      if (generation !== generationRef.current) return false;
      versionRef.current += 1;
      setState((current) => current.status === 'success' ? {
        status: 'success',
        tasks: current.tasks.filter((item) => item.key !== task.key || automaticTaskRevision(item) !== automaticTaskRevision(task)),
      } : current);
      return true;
    } catch {
      if (generation === generationRef.current) setMutationError(AUTOMATIC_TASK_DELETE_ERROR);
      return false;
    } finally {
      if (generation === generationRef.current) {
        actionRef.current = false;
        setPendingAction(null);
      }
    }
  };

  useEffect(() => {
    generationRef.current += 1;
    actionRef.current = false;
    setPendingAction(null);
    setMutationError(null);
    setState({ status: 'loading' });
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      versionRef.current += 1;
      generationRef.current += 1;
    };
  }, [refresh]);

  return { state, refresh, deleteTask, pendingAction, mutationError, clearMutationError: () => setMutationError(null) };
};
