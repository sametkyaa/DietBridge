import { Appointment } from '../../../shared/types';

export const APPOINTMENT_TIME_ZONE = 'Europe/Istanbul';
export const DEFAULT_APPOINTMENT_TITLE = 'Haftalık kontrol';
export const CALENDAR_WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;

export const APPOINTMENT_TYPES: Appointment['type'][] = [
  'Görüntülü Görüşme',
  'Yüzyüze',
  'Telefon Görüşmesi',
];

export const APPOINTMENT_DURATIONS = [15, 30, 45, 60] as const;
export const APPOINTMENT_TITLE_MAX_LENGTH = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface AppointmentDraft {
  clientId: string;
  title: string;
  date: string;
  time: string;
  duration: string | number;
  type: Appointment['type'];
}

export interface ValidatedAppointmentDraft extends Omit<AppointmentDraft, 'duration'> {
  duration: (typeof APPOINTMENT_DURATIONS)[number];
}

export type AppointmentValidationResult =
  | { success: true; value: ValidatedAppointmentDraft }
  | { success: false; message: string };

export interface DateKeyParts {
  year: number;
  month: number;
  day: number;
}

export interface CalendarDay {
  date: string;
  day: number;
  isCurrentMonth: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

const DATE_TIME_FORMATTER_OPTIONS = {
  calendar: 'gregory',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: APPOINTMENT_TIME_ZONE,
  year: 'numeric',
} as const;

const getTimeZoneDateParts = (value: Date, timeZone = APPOINTMENT_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...DATE_TIME_FORMATTER_OPTIONS,
    timeZone,
  }).formatToParts(value);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const createUtcDate = (parts: DateKeyParts) => {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
};

const dateKeyFromUtcDate = (date: Date) => (
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
);

export const getDateKeyParts = (value: string): DateKeyParts | null => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const parsed = createUtcDate(parts);
  if (
    parsed.getUTCFullYear() !== parts.year
    || parsed.getUTCMonth() !== parts.month - 1
    || parsed.getUTCDate() !== parts.day
  ) return null;

  return parts;
};

const getMonthKeyParts = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
};

export const getTodayDateKey = (
  value = new Date(),
  timeZone = APPOINTMENT_TIME_ZONE,
) => {
  const parts = getTimeZoneDateParts(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

export const getTimeZoneDateTimeKey = (
  value = new Date(),
  timeZone = APPOINTMENT_TIME_ZONE,
) => {
  const parts = getTimeZoneDateParts(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};

export const getMonthKey = (
  value = new Date(),
  timeZone = APPOINTMENT_TIME_ZONE,
) => getTodayDateKey(value, timeZone).slice(0, 7);

export const getMonthKeyFromDateKey = (value: string) => {
  const parts = getDateKeyParts(value);
  return parts ? `${parts.year}-${pad(parts.month)}` : null;
};

export const addCalendarDays = (value: string, days: number) => {
  const parts = getDateKeyParts(value);
  if (!parts || !Number.isInteger(days)) return null;
  const date = createUtcDate(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromUtcDate(date);
};

export const addCalendarMonths = (value: string, months: number) => {
  const parts = getMonthKeyParts(value);
  if (!parts || !Number.isInteger(months)) return null;
  const absoluteMonth = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12 + 1;
  return `${year}-${pad(month)}`;
};

export const getMonthCalendarDays = (monthKey: string): CalendarDay[] => {
  const parts = getMonthKeyParts(monthKey);
  if (!parts) return [];

  const firstDay = createUtcDate({ ...parts, day: 1 });
  const mondayFirstOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const cellCount = Math.ceil((mondayFirstOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(firstDay);
    date.setUTCDate(date.getUTCDate() + index - mondayFirstOffset);
    return {
      date: dateKeyFromUtcDate(date),
      day: date.getUTCDate(),
      isCurrentMonth: date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1,
    };
  });
};

export const formatDateKey = (
  value: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
) => {
  const parts = getDateKeyParts(value);
  if (!parts) return '';
  return new Intl.DateTimeFormat('tr-TR', { ...options, timeZone: 'UTC' })
    .format(createUtcDate(parts));
};

export const formatMonthKey = (value: string) => {
  const parts = getMonthKeyParts(value);
  if (!parts) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(createUtcDate({ ...parts, day: 1 }));
};

export const createAppointmentDraft = (date = getTodayDateKey()): AppointmentDraft => ({
  clientId: '',
  title: DEFAULT_APPOINTMENT_TITLE,
  date,
  time: '09:00',
  duration: 30,
  type: 'Görüntülü Görüşme',
});

export const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseLocalDate = (value: string) => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;

  return parsed;
};

export const normalizeAppointmentType = (value: unknown): Appointment['type'] | null => {
  if (value === 'Görüntülü Görüşme' || value === 'online' || value === 'video') {
    return 'Görüntülü Görüşme';
  }
  if (value === 'Yüzyüze' || value === 'in_person' || value === 'face_to_face') {
    return 'Yüzyüze';
  }
  if (value === 'Telefon Görüşmesi' || value === 'phone') {
    return 'Telefon Görüşmesi';
  }
  return null;
};

export const validateAppointmentDraft = (
  draft: AppointmentDraft,
  now = new Date(),
): AppointmentValidationResult => {
  if (!UUID_PATTERN.test(draft.clientId)) {
    return { success: false, message: 'Geçerli ve aktif bir danışan seçin.' };
  }

  const title = draft.title.trim();
  if (!title) return { success: false, message: 'Randevu başlığı zorunludur.' };
  if (title.length > APPOINTMENT_TITLE_MAX_LENGTH) {
    return { success: false, message: `Randevu başlığı en fazla ${APPOINTMENT_TITLE_MAX_LENGTH} karakter olabilir.` };
  }

  const date = parseLocalDate(draft.date);
  const timeMatch = TIME_PATTERN.exec(draft.time);
  if (!date || !timeMatch) {
    return { success: false, message: 'Geçerli bir tarih ve saat girin.' };
  }

  const scheduledAtKey = `${draft.date}T${timeMatch[1]}:${timeMatch[2]}`;
  if (scheduledAtKey <= getTimeZoneDateTimeKey(now)) {
    return { success: false, message: 'Randevu tarihi ve saati gelecekte olmalıdır.' };
  }

  const duration = typeof draft.duration === 'number'
    ? draft.duration
    : Number.parseInt(draft.duration, 10);
  if (!APPOINTMENT_DURATIONS.includes(duration as (typeof APPOINTMENT_DURATIONS)[number])) {
    return { success: false, message: 'Geçerli bir randevu süresi seçin.' };
  }

  if (!APPOINTMENT_TYPES.includes(draft.type)) {
    return { success: false, message: 'Geçerli bir görüşme türü seçin.' };
  }

  return {
    success: true,
    value: {
      ...draft,
      title,
      time: `${timeMatch[1]}:${timeMatch[2]}`,
      duration: duration as (typeof APPOINTMENT_DURATIONS)[number],
    },
  };
};
