import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Appointment } from '../../../shared/types';
import { useAuth } from '../../auth/context/AuthContext';
import {
  AppointmentServiceError,
  createAppointment,
  deleteAppointmentService,
  fetchAppointments,
  updateAppointment as updateAppointmentService,
} from '../services/appointmentService';
import { AppointmentDraft } from '../utils/appointmentContract';

interface AppointmentContextType {
  appointments: Appointment[];
  loading: boolean;
  error: string | null;
  mutationError: string | null;
  pendingAction: string | null;
  refreshAppointments: () => Promise<boolean>;
  addAppointment: (draft: AppointmentDraft) => Promise<AppointmentMutationResult>;
  updateAppointment: (id: string, draft: AppointmentDraft) => Promise<AppointmentMutationResult>;
  deleteAppointment: (id: string) => Promise<AppointmentMutationResult>;
  clearMutationError: () => void;
  getAppointmentsByDate: (date: string) => Appointment[];
}

export type AppointmentMutationResult =
  | { success: false }
  | { success: true; refreshSucceeded: boolean };

const AppointmentContext = createContext<AppointmentContextType>({
  appointments: [],
  loading: false,
  error: null,
  mutationError: null,
  pendingAction: null,
  refreshAppointments: async () => false,
  addAppointment: async () => ({ success: false }),
  updateAppointment: async () => ({ success: false }),
  deleteAppointment: async () => ({ success: false }),
  clearMutationError: () => {},
  getAppointmentsByDate: () => [],
});

const getUserMessage = (error: unknown, fallback: string) => (
  error instanceof AppointmentServiceError ? error.userMessage : fallback
);

export const AppointmentProvider = ({ children }: PropsWithChildren) => {
  const { accessState, user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const requestVersion = useRef(0);

  const isAllowed = accessState.status === 'allowed' && Boolean(user?.id);

  const refreshAppointments = useCallback(async () => {
    if (!isAllowed) {
      requestVersion.current += 1;
      setAppointments([]);
      setError(null);
      setLoading(false);
      return false;
    }

    const requestId = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAppointments();
      if (requestId !== requestVersion.current) return false;
      setAppointments(data);
      return true;
    } catch (loadError) {
      if (requestId !== requestVersion.current) return false;
      setAppointments([]);
      setError(getUserMessage(loadError, 'Randevular yüklenemedi. Lütfen tekrar deneyin.'));
      return false;
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  }, [isAllowed]);

  useEffect(() => {
    void refreshAppointments();
    return () => {
      requestVersion.current += 1;
    };
  }, [refreshAppointments, user?.id]);

  const runMutation = useCallback(async (
    actionKey: string,
    mutation: () => Promise<unknown>,
    fallbackMessage: string,
  ) => {
    if (pendingActionRef.current) return { success: false } as AppointmentMutationResult;
    pendingActionRef.current = actionKey;
    setPendingAction(actionKey);
    setMutationError(null);
    try {
      await mutation();
      const refreshSucceeded = await refreshAppointments();
      if (!refreshSucceeded) {
        setMutationError('İşlem tamamlandı ancak liste yenilenemedi. Lütfen tekrar deneyin.');
      }
      return { success: true, refreshSucceeded } as AppointmentMutationResult;
    } catch (mutationFailure) {
      setMutationError(getUserMessage(mutationFailure, fallbackMessage));
      return { success: false } as AppointmentMutationResult;
    } finally {
      if (pendingActionRef.current === actionKey) {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    }
  }, [refreshAppointments]);

  const addAppointment = useCallback((draft: AppointmentDraft) => runMutation(
    'create',
    () => createAppointment(draft),
    'Randevu kaydedilemedi. Lütfen tekrar deneyin.',
  ), [runMutation]);

  const updateAppointment = useCallback((id: string, draft: AppointmentDraft) => runMutation(
    `update:${id}`,
    () => updateAppointmentService(id, draft),
    'Randevu güncellenemedi. Lütfen tekrar deneyin.',
  ), [runMutation]);

  const deleteAppointment = useCallback((id: string) => runMutation(
    `delete:${id}`,
    () => deleteAppointmentService(id),
    'Randevu silinemedi. Lütfen tekrar deneyin.',
  ), [runMutation]);

  const getAppointmentsByDate = useCallback((date: string) => (
    appointments
      .filter((appointment) => appointment.date === date)
      .sort((left, right) => left.time.localeCompare(right.time))
  ), [appointments]);

  const value = useMemo<AppointmentContextType>(() => ({
    appointments,
    loading,
    error,
    mutationError,
    pendingAction,
    refreshAppointments,
    addAppointment,
    updateAppointment,
    deleteAppointment,
    clearMutationError: () => setMutationError(null),
    getAppointmentsByDate,
  }), [
    addAppointment,
    appointments,
    deleteAppointment,
    error,
    getAppointmentsByDate,
    loading,
    mutationError,
    pendingAction,
    refreshAppointments,
    updateAppointment,
  ]);

  return <AppointmentContext.Provider value={value}>{children}</AppointmentContext.Provider>;
};

export const useAppointments = () => useContext(AppointmentContext);
