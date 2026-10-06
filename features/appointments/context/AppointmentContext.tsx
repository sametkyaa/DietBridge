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
  AppointmentBookingCheck,
  AppointmentServiceError,
  checkAppointmentBooking as checkAppointmentBookingService,
  createAppointment,
  deleteAppointmentService,
  fetchAppointmentsAfterDate,
  fetchAppointmentsInRange,
  setAppointmentStatus,
  updateAppointment as updateAppointmentService,
} from '../services/appointmentService';
import {
  AppointmentDateRange,
  AppointmentDraft,
  appointmentRangeCovers,
  getAppointmentRangeForDate,
  getTodayDateKey,
  sortAppointmentsChronologically,
  UPCOMING_APPOINTMENT_PREVIEW_LIMIT,
} from '../utils/appointmentContract';

interface AppointmentContextType {
  /** Every appointment inside `loadedRange` (complete, date-bounded). */
  appointments: Appointment[];
  /** First appointments after `loadedRange`, for "next appointments" previews. */
  appointmentsAfterRange: Appointment[];
  loadedRange: AppointmentDateRange | null;
  requestAppointmentRange: (range: AppointmentDateRange) => void;
  loading: boolean;
  error: string | null;
  mutationError: string | null;
  pendingAction: string | null;
  refreshAppointments: () => Promise<boolean>;
  addAppointment: (draft: AppointmentDraft) => Promise<AppointmentMutationResult>;
  updateAppointment: (id: string, draft: AppointmentDraft) => Promise<AppointmentMutationResult>;
  deleteAppointment: (id: string) => Promise<AppointmentMutationResult>;
  /** Marks an upcoming appointment completed or cancelled. */
  changeAppointmentStatus: (id: string, status: 'completed' | 'cancelled') => Promise<AppointmentMutationResult>;
  checkAppointmentBooking: (
    draft: AppointmentDraft,
    appointmentId?: string,
  ) => Promise<AppointmentBookingCheckResult>;
  clearMutationError: () => void;
  getAppointmentsByDate: (date: string) => Appointment[];
}

export type AppointmentMutationResult =
  | { success: false }
  | { success: true; refreshSucceeded: boolean };

export type AppointmentBookingCheckResult =
  | { success: true; value: AppointmentBookingCheck }
  | { success: false; message: string };

const AppointmentContext = createContext<AppointmentContextType>({
  appointments: [],
  appointmentsAfterRange: [],
  loadedRange: null,
  requestAppointmentRange: () => {},
  loading: false,
  error: null,
  mutationError: null,
  pendingAction: null,
  refreshAppointments: async () => false,
  addAppointment: async () => ({ success: false }),
  updateAppointment: async () => ({ success: false }),
  deleteAppointment: async () => ({ success: false }),
  changeAppointmentStatus: async () => ({ success: false }),
  checkAppointmentBooking: async () => ({
    success: false,
    message: 'Randevu kaydedilemedi. Lütfen tekrar deneyin.',
  }),
  clearMutationError: () => {},
  getAppointmentsByDate: () => [],
});

const getInitialAppointmentRange = (): AppointmentDateRange => {
  const today = getTodayDateKey();
  return getAppointmentRangeForDate(today) ?? { startDate: today, endDate: today };
};

const getUserMessage = (error: unknown, fallback: string) => (
  error instanceof AppointmentServiceError ? error.userMessage : fallback
);

export const AppointmentProvider = ({ children }: PropsWithChildren) => {
  const { accessState, user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsAfterRange, setAppointmentsAfterRange] = useState<Appointment[]>([]);
  const [range, setRange] = useState<AppointmentDateRange>(getInitialAppointmentRange);
  const [loadedRange, setLoadedRange] = useState<AppointmentDateRange | null>(null);
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
      setAppointmentsAfterRange([]);
      setLoadedRange(null);
      setError(null);
      setLoading(false);
      return false;
    }

    const requestId = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [data, afterRange] = await Promise.all([
        fetchAppointmentsInRange(range),
        fetchAppointmentsAfterDate(range.endDate, UPCOMING_APPOINTMENT_PREVIEW_LIMIT),
      ]);
      if (requestId !== requestVersion.current) return false;
      setAppointments(data);
      setAppointmentsAfterRange(afterRange);
      setLoadedRange(range);
      return true;
    } catch (loadError) {
      if (requestId !== requestVersion.current) return false;
      setAppointments([]);
      setAppointmentsAfterRange([]);
      setLoadedRange(null);
      setError(getUserMessage(loadError, 'Randevular yüklenemedi. Lütfen tekrar deneyin.'));
      return false;
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  }, [isAllowed, range]);

  const requestAppointmentRange = useCallback((nextRange: AppointmentDateRange) => {
    setRange((current) => (
      appointmentRangeCovers(current, nextRange)
        ? current
        : { startDate: nextRange.startDate, endDate: nextRange.endDate }
    ));
  }, []);

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

  const changeAppointmentStatus = useCallback((id: string, status: 'completed' | 'cancelled') => runMutation(
    `status:${id}`,
    () => setAppointmentStatus(id, status),
    'Randevu durumu güncellenemedi. Lütfen tekrar deneyin.',
  ), [runMutation]);

  const checkAppointmentBooking = useCallback(async (
    draft: AppointmentDraft,
    appointmentId?: string,
  ): Promise<AppointmentBookingCheckResult> => {
    try {
      const value = await checkAppointmentBookingService(draft, appointmentId);
      return { success: true, value };
    } catch (checkError) {
      return {
        success: false,
        message: getUserMessage(checkError, 'Randevu kaydedilemedi. Lütfen tekrar deneyin.'),
      };
    }
  }, []);

  const getAppointmentsByDate = useCallback((date: string) => (
    sortAppointmentsChronologically(
      appointments.filter((appointment) => appointment.date === date),
    )
  ), [appointments]);

  const value = useMemo<AppointmentContextType>(() => ({
    appointments,
    appointmentsAfterRange,
    loadedRange,
    requestAppointmentRange,
    loading,
    error,
    mutationError,
    pendingAction,
    refreshAppointments,
    addAppointment,
    updateAppointment,
    deleteAppointment,
    changeAppointmentStatus,
    checkAppointmentBooking,
    clearMutationError: () => setMutationError(null),
    getAppointmentsByDate,
  }), [
    addAppointment,
    appointments,
    appointmentsAfterRange,
    changeAppointmentStatus,
    checkAppointmentBooking,
    deleteAppointment,
    error,
    getAppointmentsByDate,
    loadedRange,
    loading,
    mutationError,
    pendingAction,
    refreshAppointments,
    requestAppointmentRange,
    updateAppointment,
  ]);

  return <AppointmentContext.Provider value={value}>{children}</AppointmentContext.Provider>;
};

export const useAppointments = () => useContext(AppointmentContext);
