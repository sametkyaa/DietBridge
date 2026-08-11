import { Appointment } from '../../../shared/types';

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

  const scheduledAt = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  if (scheduledAt.getTime() <= now.getTime()) {
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
