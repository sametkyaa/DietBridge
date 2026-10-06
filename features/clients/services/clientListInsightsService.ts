import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { getDateKeyInTimeZone, REPORTING_TIME_ZONE } from '../../../shared/utils/dateContract';
import {
  getClientMeasurementLookbackStart,
  pickLatestMeasurements,
  pickNextAppointments,
  type ClientListInsight,
} from '../utils/clientListContract';

export const CLIENT_LIST_INSIGHTS_ERROR = 'Son ölçüm ve randevu bilgileri yüklenemedi.';
const BATCH_SIZE = 50;
/** Upcoming appointments read for the list; more than enough to find each client's next one. */
const APPOINTMENT_LIMIT = 500;

export class ClientListInsightsError extends Error {
  constructor(public readonly cause?: unknown) {
    super(CLIENT_LIST_INSIGHTS_ERROR);
    this.name = 'ClientListInsightsError';
  }
}

const istanbulTime = (now: Date): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORTING_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(now);

/**
 * Latest measurement date and next upcoming appointment for the given active
 * clients of the signed-in dietitian. Read-only; RLS still limits both tables
 * to clients with an active relationship.
 */
export const fetchClientListInsights = async (
  clientIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, ClientListInsight>> => {
  const ids = [...new Set(clientIds.filter(isValidUuid))];
  const insights = new Map<string, ClientListInsight>(
    ids.map((id) => [id, { lastMeasuredAt: null, nextAppointment: null }]),
  );
  if (ids.length === 0) return insights;

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !isValidUuid(user?.id)) throw new ClientListInsightsError(authError);

  const todayKey = getDateKeyInTimeZone(now);
  const measurementRows: Array<{ client_id: unknown; measured_at: unknown }> = [];
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const { data, error } = await supabase
      .from('measurements')
      .select('client_id, measured_at')
      .in('client_id', batch)
      .gte('measured_at', getClientMeasurementLookbackStart(todayKey))
      .lte('measured_at', todayKey)
      .order('measured_at', { ascending: false });
    if (error || !Array.isArray(data)) throw new ClientListInsightsError(error);
    measurementRows.push(...data);
  }

  const { data: appointmentRows, error: appointmentError } = await supabase
    .from('appointments')
    .select('client_id, date, time, title')
    .eq('dietitian_id', user.id)
    .eq('status', 'upcoming')
    .gte('date', todayKey)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(APPOINTMENT_LIMIT);
  if (appointmentError || !Array.isArray(appointmentRows)) throw new ClientListInsightsError(appointmentError);

  const latest = pickLatestMeasurements(measurementRows);
  const next = pickNextAppointments(appointmentRows, todayKey, istanbulTime(now));
  for (const id of ids) {
    insights.set(id, {
      lastMeasuredAt: latest.get(id) ?? null,
      nextAppointment: next.get(id) ?? null,
    });
  }
  return insights;
};
