import { addCalendarDays, isIsoDateKey } from '../../../shared/utils/dateContract';

/** Rows per page on the Danışanlar table. */
export const CLIENT_LIST_PAGE_SIZE = 10;
/** 7-day meal adherence below this percentage needs the dietitian's attention. */
export const CLIENT_ATTENTION_ADHERENCE_THRESHOLD = 50;
/** A measurement older than this many days is overdue. */
export const CLIENT_MEASUREMENT_OVERDUE_DAYS = 30;
/** Measurements older than this are not looked up for the list. */
export const CLIENT_MEASUREMENT_LOOKBACK_DAYS = 365;

export interface ClientNextAppointment {
  date: string;
  time: string;
  title: string;
}

/** Real per-client list facts that are not part of the base client list query. */
export interface ClientListInsight {
  /** Istanbul date key of the latest measurement inside the lookback window. */
  lastMeasuredAt: string | null;
  nextAppointment: ClientNextAppointment | null;
}

export type ClientAttentionReason = 'low_adherence' | 'measurement_overdue';

export const CLIENT_ATTENTION_LABELS: Record<ClientAttentionReason, string> = {
  low_adherence: `Son 7 gün öğün uyumu %${CLIENT_ATTENTION_ADHERENCE_THRESHOLD}'nin altında`,
  measurement_overdue: `${CLIENT_MEASUREMENT_OVERDUE_DAYS} günden uzun süredir ölçüm yok`,
};

export interface ClientAttentionSubject {
  status: string;
  compliance: number | null;
}

const daysBetween = (fromKey: string, toKey: string): number => (
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000)
);

/**
 * Attention is derived only from real values. Missing data never raises an
 * attention flag by itself: no plan means no adherence value, and a client
 * without any measurement is not "overdue" until one has been recorded.
 */
export const getClientAttentionReasons = (
  client: ClientAttentionSubject,
  insight: ClientListInsight | undefined,
  todayKey: string,
): ClientAttentionReason[] => {
  if (client.status !== 'Aktif') return [];
  const reasons: ClientAttentionReason[] = [];
  if (
    client.compliance !== null
    && Number.isFinite(client.compliance)
    && client.compliance < CLIENT_ATTENTION_ADHERENCE_THRESHOLD
  ) {
    reasons.push('low_adherence');
  }
  const lastMeasuredAt = insight?.lastMeasuredAt ?? null;
  if (
    lastMeasuredAt
    && isIsoDateKey(lastMeasuredAt)
    && isIsoDateKey(todayKey)
    && daysBetween(lastMeasuredAt, todayKey) > CLIENT_MEASUREMENT_OVERDUE_DAYS
  ) {
    reasons.push('measurement_overdue');
  }
  return reasons;
};

/** "Bugün", "Dün", "5 gün önce", "3 hafta önce", "2 ay önce". */
export const formatMeasurementAge = (dateKey: string | null, todayKey: string): string | null => {
  if (!dateKey || !isIsoDateKey(dateKey) || !isIsoDateKey(todayKey)) return null;
  const days = daysBetween(dateKey, todayKey);
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Dün';
  if (days < 14) return `${days} gün önce`;
  if (days < 60) return `${Math.floor(days / 7)} hafta önce`;
  return `${Math.floor(days / 30)} ay önce`;
};

/** "Bugün 14:30", "Yarın 09:00", "Per 12 Eki · 10:00". */
export const formatNextAppointment = (appointment: ClientNextAppointment | null, todayKey: string): string | null => {
  if (!appointment || !isIsoDateKey(appointment.date) || !isIsoDateKey(todayKey)) return null;
  const time = appointment.time.slice(0, 5);
  if (appointment.date === todayKey) return `Bugün ${time}`;
  if (appointment.date === addCalendarDays(todayKey, 1)) return `Yarın ${time}`;
  const label = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${appointment.date}T00:00:00Z`));
  return `${label} · ${time}`;
};

/** Earliest upcoming appointment per client; past same-day slots are skipped. */
export const pickNextAppointments = (
  rows: ReadonlyArray<{ client_id: unknown; date: unknown; time: unknown; title: unknown }>,
  todayKey: string,
  nowTime: string,
): Map<string, ClientNextAppointment> => {
  const result = new Map<string, ClientNextAppointment>();
  const sorted = rows
    .filter((row): row is { client_id: string; date: string; time: string; title: unknown } => (
      typeof row.client_id === 'string'
      && isIsoDateKey(row.date)
      && typeof row.time === 'string'
      && /^\d{2}:\d{2}/.test(row.time)
      && (row.date > todayKey || (row.date === todayKey && row.time.slice(0, 5) >= nowTime))
    ))
    .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  for (const row of sorted) {
    if (result.has(row.client_id)) continue;
    result.set(row.client_id, {
      date: row.date,
      time: row.time.slice(0, 5),
      title: typeof row.title === 'string' ? row.title : '',
    });
  }
  return result;
};

/** Latest measurement date per client. */
export const pickLatestMeasurements = (
  rows: ReadonlyArray<{ client_id: unknown; measured_at: unknown }>,
): Map<string, string> => {
  const result = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.client_id !== 'string' || !isIsoDateKey(row.measured_at)) continue;
    const current = result.get(row.client_id);
    if (!current || row.measured_at > current) result.set(row.client_id, row.measured_at);
  }
  return result;
};

export const getClientMeasurementLookbackStart = (todayKey: string): string => (
  addCalendarDays(todayKey, -CLIENT_MEASUREMENT_LOOKBACK_DAYS)
);

export const paginate = <T>(items: readonly T[], page: number, pageSize = CLIENT_LIST_PAGE_SIZE) => {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    pageCount,
    start: items.length === 0 ? 0 : start + 1,
    end: Math.min(items.length, start + pageSize),
    items: items.slice(start, start + pageSize),
  };
};
