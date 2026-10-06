import type {
  AnalyticsAdherencePoint,
  AnalyticsDateRangeKey,
  AnalyticsMealType,
  BodyMeasurementField,
} from '../types/analytics';

/** Formatting shared by the Analytics page and its XLSX export, so both show identical values. */
export const RANGE_LABELS: Record<AnalyticsDateRangeKey, string> = {
  '7d': '7 Gün',
  '30d': '30 Gün',
  '3m': '3 Ay',
  all: 'Tüm Zamanlar',
};

export const BODY_FIELD_LABELS: Record<BodyMeasurementField, string> = {
  waist: 'Bel',
  hip: 'Kalça',
  arm: 'Kol (eski kayıt)',
  rightArm: 'Sağ kol',
  leftArm: 'Sol kol',
  chest: 'Göğüs',
  thigh: 'Uyluk (eski kayıt)',
  calf: 'Baldır (eski kayıt)',
  rightCalf: 'Sağ baldır',
  leftCalf: 'Sol baldır',
  neck: 'Boyun',
};

export const ANALYTICS_MEAL_TYPE_LABELS: Record<AnalyticsMealType, string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara öğün',
};

const numberFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const percentageFormatter = (maximumFractionDigits: number) => new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits,
});

export const formatNumber = (value: number | null, suffix = ''): string => (
  value === null || !Number.isFinite(value) ? '—' : `${numberFormatter.format(value)}${suffix}`
);

export const formatPercentage = (value: number | null, maximumFractionDigits = 0): string => (
  value === null || !Number.isFinite(value)
    ? '—'
    : `%${percentageFormatter(maximumFractionDigits).format(value)}`
);

export const formatDate = (value: string | null): string => {
  if (value === null) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const formatShortDate = (value: string): string => new Date(`${value}T00:00:00`).toLocaleDateString('tr-TR', {
  day: 'numeric',
  month: 'short',
});

export const formatPeriodLabel = ({ periodStart, periodEnd }: Pick<AnalyticsAdherencePoint, 'periodStart' | 'periodEnd'>): string => (
  periodStart === periodEnd
    ? formatShortDate(periodStart)
    : `${formatShortDate(periodStart)} – ${formatShortDate(periodEnd)}`
);

export const formatSignedWeight = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 kg';
  return `${value > 0 ? '+' : '−'}${numberFormatter.format(Math.abs(value))} kg`;
};

/** Signed percentage-point difference: "+6 puan", "−3 puan", "±0 puan". */
export const formatPointDelta = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '±0 puan';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} puan`;
};

export const formatSignedLiters = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.05) return '±0 L';
  return `${value > 0 ? '+' : '−'}${numberFormatter.format(Math.abs(value))} L`;
};

export const formatRangeLabel = (range: { startDate: string | null; endDate: string }): string => (
  `${range.startDate === null ? 'İlk kayıttan' : formatDate(range.startDate)} – ${formatDate(range.endDate)}`
);
