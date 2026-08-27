import { calculateAdherencePercentage } from '../../../shared/utils/adherenceContract';
import {
  addCalendarDays,
  getDateKeyInTimeZone,
  isIsoDateKey,
  REPORTING_TIME_ZONE,
} from '../../../shared/utils/dateContract';
import { isValidWeightMeasurementValue } from './measurementContract';

export const CLIENT_METRICS_TIME_ZONE = REPORTING_TIME_ZONE;

export interface ClientMetricDateWindow {
  startDate: string;
  endDate: string;
}

export interface ClientMetricWindows {
  current: ClientMetricDateWindow;
  previous: ClientMetricDateWindow;
}

export const getClientMetricWindows = (now: Date = new Date()): ClientMetricWindows => {
  const endDate = getDateKeyInTimeZone(now, CLIENT_METRICS_TIME_ZONE);
  return {
    current: {
      startDate: addCalendarDays(endDate, -6),
      endDate,
    },
    previous: {
      startDate: addCalendarDays(endDate, -13),
      endDate: addCalendarDays(endDate, -7),
    },
  };
};

export const calculateClientMealAdherence = (
  completed: number,
  planned: number,
): number | null => calculateAdherencePercentage(completed, planned);

export interface ClientWeightMeasurement {
  id: string;
  measuredAt: string;
  weight: unknown;
}

const normalizeWeight = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return isValidWeightMeasurementValue(parsed) ? parsed : null;
};

const latestValidWeightInWindow = (
  measurements: readonly ClientWeightMeasurement[],
  window: ClientMetricDateWindow,
): number | null => {
  const candidates = measurements
    .filter((measurement) => (
      isIsoDateKey(measurement.measuredAt)
      && measurement.measuredAt >= window.startDate
      && measurement.measuredAt <= window.endDate
      && normalizeWeight(measurement.weight) !== null
    ))
    .sort((left, right) => (
      right.measuredAt.localeCompare(left.measuredAt)
      || right.id.localeCompare(left.id)
    ));

  return candidates.length > 0 ? normalizeWeight(candidates[0].weight) : null;
};

export const calculateWeeklyWeightChange = (
  measurements: readonly ClientWeightMeasurement[],
  now: Date = new Date(),
): number | null => {
  if (!Array.isArray(measurements)) return null;

  try {
    const windows = getClientMetricWindows(now);
    const currentWeight = latestValidWeightInWindow(measurements, windows.current);
    const previousWeight = latestValidWeightInWindow(measurements, windows.previous);
    if (currentWeight === null || previousWeight === null) return null;

    const rounded = Number((currentWeight - previousWeight).toFixed(1));
    return rounded === 0 ? 0 : rounded;
  } catch {
    return null;
  }
};
