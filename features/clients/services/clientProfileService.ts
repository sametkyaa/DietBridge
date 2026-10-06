import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { isIsoDateKey } from '../../../shared/utils/dateContract';

export const CLIENT_TODAY_MEALS_ERROR = 'Bugünün öğünleri yüklenemedi.';
export const CLIENT_APPOINTMENTS_ERROR = 'Randevular yüklenemedi.';
export const CLIENT_NOTES_ERROR = 'Notlar yüklenemedi.';

export class ClientProfileServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ClientProfileServiceError';
  }
}

export type ProfileMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface ProfileMeal {
  id: string;
  type: ProfileMealType;
  slotLabel: string | null;
  title: string;
  time: string | null;
  sortOrder: number;
  calories: number | null;
  isEaten: boolean;
  completedAt: string | null;
  hasCompletionPhoto: boolean;
}

export interface ProfileAppointment {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  type: string;
  status: 'upcoming' | 'completed' | 'cancelled';
}

export interface ProfileNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const MEAL_TYPES = new Set<ProfileMealType>(['breakfast', 'lunch', 'dinner', 'snack']);

const requireDietitianId = async (message: string): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !isValidUuid(user?.id)) throw new ClientProfileServiceError(message, error);
  return user.id;
};

interface MealRow {
  id: unknown;
  type: unknown;
  slot_label: unknown;
  title: unknown;
  time: unknown;
  sort_order: unknown;
  calories: unknown;
  is_eaten: unknown;
  completed_at: unknown;
  completion_photo_url: unknown;
}

const mapMeal = (row: MealRow): ProfileMeal | null => {
  if (typeof row.id !== 'string' || !MEAL_TYPES.has(row.type as ProfileMealType)) return null;
  return {
    id: row.id,
    type: row.type as ProfileMealType,
    slotLabel: typeof row.slot_label === 'string' && row.slot_label.trim() ? row.slot_label.trim() : null,
    title: typeof row.title === 'string' ? row.title.trim() : '',
    time: typeof row.time === 'string' && /^\d{2}:\d{2}/.test(row.time) ? row.time.slice(0, 5) : null,
    sortOrder: typeof row.sort_order === 'number' && Number.isFinite(row.sort_order) ? row.sort_order : 0,
    calories: typeof row.calories === 'number' && Number.isFinite(row.calories) && row.calories >= 0 ? row.calories : null,
    isEaten: row.is_eaten === true,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    hasCompletionPhoto: typeof row.completion_photo_url === 'string' && row.completion_photo_url.length > 0,
  };
};

/**
 * Meals of the signed-in dietitian's plan for one client and day, in plan
 * order (sort_order, then time). Returns null when no plan exists that day.
 */
export const fetchClientMealsForDate = async (clientId: string, dateKey: string): Promise<ProfileMeal[] | null> => {
  if (!isValidUuid(clientId) || !isIsoDateKey(dateKey)) throw new ClientProfileServiceError(CLIENT_TODAY_MEALS_ERROR);
  const dietitianId = await requireDietitianId(CLIENT_TODAY_MEALS_ERROR);
  const { data, error } = await supabase
    .from('meal_plans')
    .select('id, meals (id, type, slot_label, title, time, sort_order, calories, is_eaten, completed_at, completion_photo_url)')
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .eq('plan_date', dateKey)
    .limit(1);
  if (error || !Array.isArray(data)) throw new ClientProfileServiceError(CLIENT_TODAY_MEALS_ERROR, error);
  const plan = data[0] as { meals?: MealRow[] | null } | undefined;
  if (!plan) return null;
  return (Array.isArray(plan.meals) ? plan.meals : [])
    .map(mapMeal)
    .filter((meal): meal is ProfileMeal => meal !== null)
    .sort((left, right) => (
      left.sortOrder - right.sortOrder
      || (left.time ?? '99:99').localeCompare(right.time ?? '99:99')
      || left.id.localeCompare(right.id)
    ));
};

interface AppointmentRow {
  id: unknown;
  title: unknown;
  date: unknown;
  time: unknown;
  duration: unknown;
  type: unknown;
  status: unknown;
}

const mapAppointment = (row: AppointmentRow): ProfileAppointment | null => {
  if (
    typeof row.id !== 'string'
    || typeof row.title !== 'string'
    || !isIsoDateKey(row.date)
    || typeof row.time !== 'string'
    || !/^\d{2}:\d{2}/.test(row.time)
    || (row.status !== 'upcoming' && row.status !== 'completed' && row.status !== 'cancelled')
  ) return null;
  return {
    id: row.id,
    title: row.title.trim(),
    date: row.date,
    time: row.time.slice(0, 5),
    duration: typeof row.duration === 'number' ? row.duration : 0,
    type: typeof row.type === 'string' ? row.type : '',
    status: row.status,
  };
};

/** Next upcoming appointments and the most recent past ones for one client. */
export const fetchClientAppointmentsOverview = async (
  clientId: string,
  todayKey: string,
): Promise<{ upcoming: ProfileAppointment[]; past: ProfileAppointment[] }> => {
  if (!isValidUuid(clientId) || !isIsoDateKey(todayKey)) throw new ClientProfileServiceError(CLIENT_APPOINTMENTS_ERROR);
  const dietitianId = await requireDietitianId(CLIENT_APPOINTMENTS_ERROR);
  const select = 'id, title, date, time, duration, type, status';
  const [upcoming, past] = await Promise.all([
    supabase.from('appointments').select(select)
      .eq('dietitian_id', dietitianId).eq('client_id', clientId).eq('status', 'upcoming')
      .gte('date', todayKey)
      .order('date', { ascending: true }).order('time', { ascending: true }).limit(3),
    supabase.from('appointments').select(select)
      .eq('dietitian_id', dietitianId).eq('client_id', clientId).neq('status', 'cancelled')
      .lt('date', todayKey)
      .order('date', { ascending: false }).order('time', { ascending: false }).limit(2),
  ]);
  if (upcoming.error || past.error || !Array.isArray(upcoming.data) || !Array.isArray(past.data)) {
    throw new ClientProfileServiceError(CLIENT_APPOINTMENTS_ERROR, upcoming.error ?? past.error);
  }
  const map = (rows: unknown[]) => (rows as AppointmentRow[]).map(mapAppointment).filter((row): row is ProfileAppointment => row !== null);
  return { upcoming: map(upcoming.data), past: map(past.data) };
};

/** Latest dietitian notes that are attached to this client. */
export const fetchClientNotes = async (clientId: string, limit = 3): Promise<{ notes: ProfileNote[]; total: number }> => {
  if (!isValidUuid(clientId)) throw new ClientProfileServiceError(CLIENT_NOTES_ERROR);
  const dietitianId = await requireDietitianId(CLIENT_NOTES_ERROR);
  const { data, error, count } = await supabase
    .from('dietitian_notes')
    .select('id, title, content, updated_at', { count: 'exact' })
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) throw new ClientProfileServiceError(CLIENT_NOTES_ERROR, error);
  const notes = (data as Array<{ id: unknown; title: unknown; content: unknown; updated_at: unknown }>)
    .filter((row) => typeof row.id === 'string' && typeof row.title === 'string' && typeof row.updated_at === 'string')
    .map((row) => ({
      id: row.id as string,
      title: (row.title as string).trim(),
      content: typeof row.content === 'string' ? row.content.trim() : '',
      updatedAt: row.updated_at as string,
    }));
  return { notes, total: typeof count === 'number' ? count : notes.length };
};
