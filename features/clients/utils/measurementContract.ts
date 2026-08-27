export type MeasurementInputError = 'invalid' | 'out_of_range';

export type MeasurementInputResult = {
  value: number | null;
  error: MeasurementInputError | null;
};

export const MEASUREMENT_MAX_CM = 500;
export const WEIGHT_MIN_KG = 20;
export const WEIGHT_MAX_KG = 500;

/**
 * Parses the same decimal input contract used by the mobile measurement form.
 * Empty input is nullable; zero, negative and non-finite values are invalid.
 */
export const parseMeasurementInput = (rawValue: string): MeasurementInputResult => {
  const normalizedValue = rawValue.trim().replace(',', '.');
  if (!normalizedValue) return { value: null, error: null };
  if (!/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return { value: null, error: 'invalid' };
  }

  const value = Number(normalizedValue);
  if (!Number.isFinite(value) || value <= 0 || value > MEASUREMENT_MAX_CM) {
    return { value: null, error: 'out_of_range' };
  }

  return { value, error: null };
};

export const isValidMeasurementValue = (value: number | null): boolean => (
  value === null
  || (Number.isFinite(value) && value > 0 && value <= MEASUREMENT_MAX_CM)
);

export const isValidWeightMeasurementValue = (value: number | null): value is number => (
  value !== null
  && Number.isFinite(value)
  && value >= WEIGHT_MIN_KG
  && value <= WEIGHT_MAX_KG
);
