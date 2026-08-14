import { supabase } from '../../../lib/supabaseClient';
import { Appointment } from '../../../shared/types';
import {
  AppointmentDraft,
  getMondayFirstWeekRange,
  normalizeAppointmentType,
  SLOT_BLOCKING_APPOINTMENT_STATUSES,
  validateAppointmentDraft,
} from '../utils/appointmentContract';

export const APPOINTMENT_LOAD_ERROR = 'Randevular yüklenemedi. Lütfen tekrar deneyin.';
export const APPOINTMENT_SAVE_ERROR = 'Randevu kaydedilemedi. Lütfen tekrar deneyin.';
export const APPOINTMENT_DELETE_ERROR = 'Randevu silinemedi. Lütfen tekrar deneyin.';
export const APPOINTMENT_SLOT_CONFLICT_ERROR = 'Bu tarih ve saatte zaten bir randevunuz bulunuyor.';
export const APPOINTMENT_SLOT_CONFLICT_CONSTRAINT = 'appointments_dietitian_date_time_upcoming_unique';

export interface AppointmentBookingCheck {
  slotConflict: boolean;
  sameWeekCount: number;
  weekStartDate: string;
  weekEndDate: string;
}

interface AppointmentClientRow {
  full_name: string | null;
  avatar_url: string | null;
}

interface AppointmentRow {
  id: string;
  dietitian_id: string;
  client_id: string;
  title: string | null;
  date: string;
  time: string;
  duration: number | null;
  type: string | null;
  status: string | null;
  client: AppointmentClientRow | AppointmentClientRow[] | null;
}

export class AppointmentServiceError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'AppointmentServiceError';
  }
}

const firstClient = (value: AppointmentRow['client']) => (
  Array.isArray(value) ? value[0] ?? null : value
);

const mapStatus = (value: string | null): Appointment['status'] | null => {
  if (value === 'upcoming' || value === 'completed' || value === 'cancelled') return value;
  return null;
};

const mapAppointment = (row: AppointmentRow): Appointment => {
  const type = normalizeAppointmentType(row.type);
  const status = mapStatus(row.status);
  if (
    !type
    || !status
    || !row.id
    || !row.client_id
    || !row.title?.trim()
    || !row.date
    || !row.time
    || !Number.isInteger(row.duration)
    || (row.duration as number) <= 0
  ) {
    throw new AppointmentServiceError(APPOINTMENT_LOAD_ERROR);
  }
  const client = firstClient(row.client);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.full_name?.trim() || 'Bilinmeyen Danışan',
    clientAvatar: client?.avatar_url || undefined,
    title: row.title.trim(),
    date: row.date,
    time: row.time.slice(0, 5),
    duration: row.duration as number,
    type,
    status,
  };
};

const requireCurrentDietitianId = async (userMessage: string) => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) throw new AppointmentServiceError(userMessage, error);
  return user.id;
};

const assertActiveRelationship = async (
  dietitianId: string,
  clientId: string,
  userMessage: string,
) => {
  const { data, error } = await supabase
    .from('dietitian_clients')
    .select('id')
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) throw new AppointmentServiceError(userMessage, error);
};

type DatabaseErrorLike = {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
};

export const isAppointmentSlotConflictError = (error: unknown) => {
  const databaseError = error as DatabaseErrorLike | null;
  return databaseError?.code === '23505'
    && (
      databaseError.constraint === APPOINTMENT_SLOT_CONFLICT_CONSTRAINT
      || databaseError.message?.includes(APPOINTMENT_SLOT_CONFLICT_CONSTRAINT) === true
    );
};

const getSaveError = (cause: unknown) => (
  isAppointmentSlotConflictError(cause)
    ? new AppointmentServiceError(APPOINTMENT_SLOT_CONFLICT_ERROR, cause)
    : new AppointmentServiceError(APPOINTMENT_SAVE_ERROR, cause)
);

const findSlotConflict = async (
  dietitianId: string,
  date: string,
  time: string,
  appointmentId?: string,
) => {
  let query = supabase
    .from('appointments')
    .select('id')
    .eq('dietitian_id', dietitianId)
    .eq('date', date)
    .eq('time', time)
    .eq('status', SLOT_BLOCKING_APPOINTMENT_STATUSES[0])
    .limit(1);
  if (appointmentId) query = query.neq('id', appointmentId);

  const { data, error } = await query;
  if (error) throw new AppointmentServiceError(APPOINTMENT_SAVE_ERROR, error);
  return (data ?? []).length > 0;
};

const assertSlotAvailable = async (
  dietitianId: string,
  date: string,
  time: string,
  appointmentId?: string,
) => {
  if (await findSlotConflict(dietitianId, date, time, appointmentId)) {
    throw new AppointmentServiceError(APPOINTMENT_SLOT_CONFLICT_ERROR);
  }
};

const getExistingAppointmentStatus = async (dietitianId: string, appointmentId: string) => {
  const { data, error } = await supabase
    .from('appointments')
    .select('status')
    .eq('id', appointmentId)
    .eq('dietitian_id', dietitianId)
    .maybeSingle();
  if (error || !data) throw new AppointmentServiceError(APPOINTMENT_SAVE_ERROR, error);
  return data.status as string | null;
};

const APPOINTMENT_SELECT = `
  id,
  dietitian_id,
  client_id,
  title,
  date,
  time,
  duration,
  type,
  status,
  client:client_id (full_name, avatar_url)
`;

export const fetchAppointments = async (): Promise<Appointment[]> => {
  const dietitianId = await requireCurrentDietitianId(APPOINTMENT_LOAD_ERROR);
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('dietitian_id', dietitianId)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw new AppointmentServiceError(APPOINTMENT_LOAD_ERROR, error);
  try {
    return ((data ?? []) as unknown as AppointmentRow[]).map(mapAppointment);
  } catch (error) {
    if (error instanceof AppointmentServiceError) throw error;
    throw new AppointmentServiceError(APPOINTMENT_LOAD_ERROR, error);
  }
};

export const checkAppointmentBooking = async (
  draft: AppointmentDraft,
  appointmentId?: string,
): Promise<AppointmentBookingCheck> => {
  const validation = validateAppointmentDraft(draft);
  if (validation.success === false) throw new AppointmentServiceError(validation.message);

  const weekRange = getMondayFirstWeekRange(validation.value.date);
  if (!weekRange) throw new AppointmentServiceError(APPOINTMENT_SAVE_ERROR);

  const dietitianId = await requireCurrentDietitianId(APPOINTMENT_SAVE_ERROR);
  await assertActiveRelationship(dietitianId, validation.value.clientId, APPOINTMENT_SAVE_ERROR);
  const existingStatus = appointmentId
    ? await getExistingAppointmentStatus(dietitianId, appointmentId)
    : SLOT_BLOCKING_APPOINTMENT_STATUSES[0];
  const slotConflict = SLOT_BLOCKING_APPOINTMENT_STATUSES.includes(existingStatus as 'upcoming')
    ? await findSlotConflict(dietitianId, validation.value.date, validation.value.time, appointmentId)
    : false;

  let sameWeekQuery = supabase
    .from('appointments')
    .select('id')
    .eq('dietitian_id', dietitianId)
    .eq('client_id', validation.value.clientId)
    .eq('status', SLOT_BLOCKING_APPOINTMENT_STATUSES[0])
    .gte('date', weekRange.startDate)
    .lte('date', weekRange.endDate);
  if (appointmentId) sameWeekQuery = sameWeekQuery.neq('id', appointmentId);

  const { data, error } = await sameWeekQuery;
  if (error) throw new AppointmentServiceError(APPOINTMENT_SAVE_ERROR, error);

  return {
    slotConflict,
    sameWeekCount: (data ?? []).length,
    weekStartDate: weekRange.startDate,
    weekEndDate: weekRange.endDate,
  };
};

const persistAppointment = async (
  mode: 'create' | 'update',
  draft: AppointmentDraft,
  appointmentId?: string,
): Promise<Appointment> => {
  const validation = validateAppointmentDraft(draft);
  if (validation.success === false) throw new AppointmentServiceError(validation.message);

  const dietitianId = await requireCurrentDietitianId(APPOINTMENT_SAVE_ERROR);
  await assertActiveRelationship(dietitianId, validation.value.clientId, APPOINTMENT_SAVE_ERROR);
  const existingStatus = mode === 'update' && appointmentId
    ? await getExistingAppointmentStatus(dietitianId, appointmentId)
    : SLOT_BLOCKING_APPOINTMENT_STATUSES[0];
  if (SLOT_BLOCKING_APPOINTMENT_STATUSES.includes(existingStatus as 'upcoming')) {
    await assertSlotAvailable(
      dietitianId,
      validation.value.date,
      validation.value.time,
      appointmentId,
    );
  }
  const basePayload = {
    client_id: validation.value.clientId,
    title: validation.value.title,
    date: validation.value.date,
    time: validation.value.time,
    duration: validation.value.duration,
    type: validation.value.type,
    dietitian_id: dietitianId,
  };
  const payload = mode === 'create'
    ? { ...basePayload, status: 'upcoming' as const }
    : basePayload;

  const mutation = mode === 'create'
    ? supabase.from('appointments').insert(payload)
    : supabase
        .from('appointments')
        .update(payload)
        .eq('id', appointmentId as string)
        .eq('dietitian_id', dietitianId);
  const { data, error } = await mutation.select(APPOINTMENT_SELECT).maybeSingle();
  if (error || !data) {
    if (error && isAppointmentSlotConflictError(error)) {
      throw new AppointmentServiceError(APPOINTMENT_SLOT_CONFLICT_ERROR, error);
    }
    throw getSaveError(error);
  }

  try {
    return mapAppointment(data as unknown as AppointmentRow);
  } catch (cause) {
    throw new AppointmentServiceError(APPOINTMENT_SAVE_ERROR, cause);
  }
};

export const createAppointment = (draft: AppointmentDraft) => persistAppointment('create', draft);

export const updateAppointment = (id: string, draft: AppointmentDraft) => {
  if (!id) return Promise.reject(new AppointmentServiceError(APPOINTMENT_SAVE_ERROR));
  return persistAppointment('update', draft, id);
};

export const deleteAppointmentService = async (id: string): Promise<void> => {
  const dietitianId = await requireCurrentDietitianId(APPOINTMENT_DELETE_ERROR);
  const { data, error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('dietitian_id', dietitianId)
    .select('id')
    .maybeSingle();

  if (error || data?.id !== id) {
    throw new AppointmentServiceError(APPOINTMENT_DELETE_ERROR, error);
  }
};
