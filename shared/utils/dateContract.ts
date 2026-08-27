export const REPORTING_TIME_ZONE = 'Europe/Istanbul';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDateKey = (value: string): Date => {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new Error('INVALID_DATE_KEY');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error('INVALID_DATE_KEY');
  }
  return date;
};

const keyFromDate = (date: Date): string => (
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
);

export const isIsoDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    parseDateKey(value);
    return true;
  } catch {
    return false;
  }
};

export const getDateKeyInTimeZone = (
  now: Date = new Date(),
  timeZone: string = REPORTING_TIME_ZONE,
): string => {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_DATE_NOW');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateKey = `${values.year}-${values.month}-${values.day}`;
  if (!isIsoDateKey(dateKey)) throw new Error('INVALID_DATE_KEY');
  return dateKey;
};

export const addCalendarDays = (dateKey: string, amount: number): string => {
  if (!Number.isInteger(amount)) throw new Error('INVALID_DAY_OFFSET');
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromDate(date);
};
