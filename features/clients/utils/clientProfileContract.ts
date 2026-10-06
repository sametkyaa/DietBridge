export type ProfileMeasurementField = 'weight' | 'waist' | 'hip';

export interface ProfileMeasurementPoint {
  measured_at: string;
  weight: number | null;
  waist: number | null;
  hip: number | null;
}

export interface MeasurementDelta {
  value: number;
  measuredAt: string;
  /** Difference to the previous recorded value of the same field; null when there is none. */
  diff: number | null;
}

const KG_PATTERN = /-?\d+(?:[.,]\d+)?/;

/** "68.4 kg" / "68,4" → 68.4; anything else → null. */
export const parseWeightLabel = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const match = KG_PATTERN.exec(value);
  if (!match) return null;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const calculateBmi = (weightKg: number | null, heightCm: number | null | undefined): number | null => {
  if (weightKg === null || !heightCm || heightCm <= 0) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  return Number.isFinite(bmi) ? Math.round(bmi * 10) / 10 : null;
};

/**
 * Latest recorded value of a field and its change against the previous record
 * of the same field. Input order does not matter.
 */
export const latestMeasurementDelta = (
  measurements: readonly ProfileMeasurementPoint[],
  field: ProfileMeasurementField,
): MeasurementDelta | null => {
  const recorded = measurements
    .filter((measurement) => typeof measurement[field] === 'number' && Number.isFinite(measurement[field]))
    .sort((left, right) => right.measured_at.localeCompare(left.measured_at));
  if (recorded.length === 0) return null;
  const latest = recorded[0][field] as number;
  const previous = recorded[1]?.[field] ?? null;
  return {
    value: latest,
    measuredAt: recorded[0].measured_at,
    diff: previous === null ? null : Math.round((latest - previous) * 10) / 10,
  };
};

const decimalFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

export const formatDecimal = (value: number): string => decimalFormatter.format(value);

/** Signed change with a real minus sign: "−1,2", "+0,4", "±0". */
export const formatSignedDecimal = (value: number): string => {
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : '−'}${decimalFormatter.format(Math.abs(value))}`;
};

/** Whole weeks since the diet start (1-based), or null without a valid start. */
export const dietWeekNumber = (dietStartKey: string | null, todayKey: string): number | null => {
  if (!dietStartKey || !/^\d{4}-\d{2}-\d{2}$/.test(dietStartKey)) return null;
  const days = Math.floor((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${dietStartKey}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.floor(days / 7) + 1;
};
