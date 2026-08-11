import { supabase } from '../../../lib/supabaseClient';
import { Appointment } from '../../../shared/types';
import {
  AppointmentDraft,
  normalizeAppointmentType,
  validateAppointmentDraft,
} from '../utils/appointmentContract';

export const APPOINTMENT_LOAD_ERROR = 'Randevular yüklenemedi. Lütfen tekrar deneyin.';
export const APPOINTMENT_SAVE_ERROR = 'Randevu kaydedilemedi. Lütfen tekrar deneyin.';
export const APPOINTMENT_DELETE_ERROR = 'Randevu silinemedi. Lütfen tekrar deneyin.';

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

const persistAppointment = async (
  mode: 'create' | 'update',
  draft: AppointmentDraft,
  appointmentId?: string,
): Promise<Appointment> => {
  const validation = validateAppointmentDraft(draft);
  if (validation.success === false) throw new AppointmentServiceError(validation.message);

  const dietitianId = await requireCurrentDietitianId(APPOINTMENT_SAVE_ERROR);
  await assertActiveRelationship(dietitianId, validation.value.clientId, APPOINTMENT_SAVE_ERROR);
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
  if (error || !data) throw new AppointmentServiceError(APPOINTMENT_SAVE_ERROR, error);

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
