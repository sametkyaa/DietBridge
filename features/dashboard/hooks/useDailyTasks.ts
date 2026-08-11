import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import {
  DAILY_TASK_DELETE_ERROR,
  DAILY_TASK_LOAD_ERROR,
  DAILY_TASK_SAVE_ERROR,
  DAILY_TASK_STATUS_ERROR,
  DailyTaskServiceError,
  createDailyTask,
  deleteDailyTask as deleteDailyTaskService,
  fetchDailyTasks,
  setDailyTaskCompletion,
  updateDailyTask as updateDailyTaskService,
} from '../services/dailyTaskService';
import type {
  DailyTask,
  DailyTaskDraft,
  DailyTaskGroups,
  DailyTaskMutationResult,
  DailyTaskViewState,
} from '../types/dailyTask';
import { groupDailyTasks } from '../utils/dailyTaskContract';

export interface UseDailyTasksResult {
  viewState: DailyTaskViewState;
  tasks: DailyTask[];
  groups: DailyTaskGroups;
  mutationError: string | null;
  pendingAction: string | null;
  refreshDailyTasks: () => Promise<boolean>;
  createTask: (draft: DailyTaskDraft) => Promise<DailyTaskMutationResult>;
  updateTask: (id: string, draft: DailyTaskDraft) => Promise<DailyTaskMutationResult>;
  completeTask: (id: string) => Promise<DailyTaskMutationResult>;
  reopenTask: (id: string) => Promise<DailyTaskMutationResult>;
  deleteTask: (id: string) => Promise<DailyTaskMutationResult>;
  clearMutationError: () => void;
}

const getUserMessage = (error: unknown, fallback: string): string => (
  error instanceof DailyTaskServiceError ? error.userMessage : fallback
);

export const useDailyTasks = (): UseDailyTasksResult => {
  const { accessState, user } = useAuth();
  const [viewState, setViewState] = useState<DailyTaskViewState>({ status: 'loading' });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const pendingActionRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [groupingClock, setGroupingClock] = useState(() => new Date());

  const isAllowed = accessState.status === 'allowed' && Boolean(user?.id);

  const refreshDailyTasks = useCallback(async (): Promise<boolean> => {
    if (!isAllowed) {
      requestVersion.current += 1;
      if (isMountedRef.current) {
        const isResolving = accessState.status === 'initializing'
          || accessState.status === 'resolving_access';
        setViewState(isResolving
          ? { status: 'loading' }
          : { status: 'error', message: DAILY_TASK_LOAD_ERROR });
      }
      return false;
    }

    const requestId = ++requestVersion.current;
    setViewState({ status: 'loading' });
    try {
      const tasks = await fetchDailyTasks();
      if (!isMountedRef.current || requestId !== requestVersion.current) return false;
      setViewState({ status: 'success', tasks });
      return true;
    } catch (loadError) {
      if (!isMountedRef.current || requestId !== requestVersion.current) return false;
      setViewState({
        status: 'error',
        message: getUserMessage(loadError, DAILY_TASK_LOAD_ERROR),
      });
      return false;
    }
  }, [accessState.status, isAllowed]);

  useEffect(() => {
    isMountedRef.current = true;
    void refreshDailyTasks();
    return () => {
      isMountedRef.current = false;
      requestVersion.current += 1;
    };
  }, [refreshDailyTasks, user?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setGroupingClock(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const runMutation = useCallback(async (
    actionKey: string,
    mutation: () => Promise<unknown>,
    fallbackMessage: string,
  ): Promise<DailyTaskMutationResult> => {
    if (!isAllowed || pendingActionRef.current !== null) return { success: false };

    pendingActionRef.current = actionKey;
    if (isMountedRef.current) {
      setPendingAction(actionKey);
      setMutationError(null);
    }

    try {
      await mutation();
      const refreshSucceeded = await refreshDailyTasks();
      if (!refreshSucceeded && isMountedRef.current) {
        setMutationError('İşlem tamamlandı ancak görev listesi yenilenemedi. Lütfen tekrar deneyin.');
      }
      return { success: true, refreshSucceeded };
    } catch (mutationFailure) {
      if (isMountedRef.current) {
        setMutationError(getUserMessage(mutationFailure, fallbackMessage));
      }
      return { success: false };
    } finally {
      if (pendingActionRef.current === actionKey) {
        pendingActionRef.current = null;
        if (isMountedRef.current) setPendingAction(null);
      }
    }
  }, [isAllowed, refreshDailyTasks]);

  const createTask = useCallback((draft: DailyTaskDraft) => runMutation(
    'create',
    () => createDailyTask(draft),
    DAILY_TASK_SAVE_ERROR,
  ), [runMutation]);

  const updateTask = useCallback((id: string, draft: DailyTaskDraft) => runMutation(
    `update:${id}`,
    () => updateDailyTaskService(id, draft),
    DAILY_TASK_SAVE_ERROR,
  ), [runMutation]);

  const completeTask = useCallback((id: string) => runMutation(
    `complete:${id}`,
    () => setDailyTaskCompletion(id, true),
    DAILY_TASK_STATUS_ERROR,
  ), [runMutation]);

  const reopenTask = useCallback((id: string) => runMutation(
    `reopen:${id}`,
    () => setDailyTaskCompletion(id, false),
    DAILY_TASK_STATUS_ERROR,
  ), [runMutation]);

  const deleteTask = useCallback((id: string) => runMutation(
    `delete:${id}`,
    () => deleteDailyTaskService(id),
    DAILY_TASK_DELETE_ERROR,
  ), [runMutation]);

  const tasks = viewState.status === 'success' ? viewState.tasks : [];
  const groups = groupDailyTasks(tasks, groupingClock);

  return {
    viewState,
    tasks,
    groups,
    mutationError,
    pendingAction,
    refreshDailyTasks,
    createTask,
    updateTask,
    completeTask,
    reopenTask,
    deleteTask,
    clearMutationError: () => setMutationError(null),
  };
};
