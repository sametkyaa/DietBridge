import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  calculateClientMealAdherence,
  calculateWeeklyWeightChange,
  getClientMetricWindows,
  type ClientWeightMeasurement,
} from '../utils/clientMetricsContract';
import { isIsoDateKey } from '../../../shared/utils/dateContract';

export const CLIENT_PROGRESS_BATCH_SIZE = 50;

export interface ClientProgressMetrics {
  compliance: number | null;
  weeklyChange: number | null;
}

export class ClientProgressServiceError extends Error {
  constructor(public readonly cause?: unknown) {
    super('Danışan ilerleme verileri yüklenemedi.');
    this.name = 'ClientProgressServiceError';
  }
}

interface MealPlanProgressRow {
  client_id: unknown;
  plan_date: unknown;
  meals: Array<{ is_eaten: unknown }> | null;
}

interface MeasurementProgressRow {
  id: string;
  client_id: unknown;
  measured_at: unknown;
  weight: unknown;
}

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const isWithinWindow = (
  value: unknown,
  startDate: string,
  endDate: string,
): value is string => (
  typeof value === 'string'
  && isIsoDateKey(value)
  && value >= startDate
  && value <= endDate
);

export const fetchClientProgressMetrics = async (
  clientIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, ClientProgressMetrics>> => {
  const uniqueClientIds = [...new Set(clientIds.filter(isValidUuid))];
  const metrics = new Map<string, ClientProgressMetrics>(
    uniqueClientIds.map((clientId) => [clientId, { compliance: null, weeklyChange: null }]),
  );
  if (uniqueClientIds.length === 0) return metrics;

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !isValidUuid(user?.id)) {
    throw new ClientProgressServiceError(authError);
  }

  let windows;
  try {
    windows = getClientMetricWindows(now);
  } catch (cause) {
    throw new ClientProgressServiceError(cause);
  }

  const mealCounts = new Map<string, { planned: number; completed: number }>(
    uniqueClientIds.map((clientId) => [clientId, { planned: 0, completed: 0 }]),
  );
  const measurementsByClientId = new Map<string, ClientWeightMeasurement[]>(
    uniqueClientIds.map((clientId) => [clientId, []]),
  );

  try {
    for (const clientIdBatch of chunk(uniqueClientIds, CLIENT_PROGRESS_BATCH_SIZE)) {
      const [mealPlansResult, measurementsResult] = await Promise.all([
        supabase
          .from('meal_plans')
          .select('client_id, plan_date, meals (is_eaten)')
          .eq('dietitian_id', user.id)
          .in('client_id', clientIdBatch)
          .gte('plan_date', windows.current.startDate)
          .lte('plan_date', windows.current.endDate),
        supabase
          .from('measurements')
          .select('id, client_id, measured_at, weight')
          .in('client_id', clientIdBatch)
          .gte('measured_at', windows.previous.startDate)
          .lte('measured_at', windows.current.endDate),
      ]);

      if (mealPlansResult.error) throw new ClientProgressServiceError(mealPlansResult.error);
      if (measurementsResult.error) throw new ClientProgressServiceError(measurementsResult.error);

      for (const row of (mealPlansResult.data ?? []) as unknown as MealPlanProgressRow[]) {
        if (!isValidUuid(row.client_id) || !mealCounts.has(row.client_id)) continue;
        if (!isWithinWindow(row.plan_date, windows.current.startDate, windows.current.endDate)) continue;

        const meals = Array.isArray(row.meals) ? row.meals : [];
        const count = mealCounts.get(row.client_id);
        if (!count) continue;
        count.planned += meals.length;
        count.completed += meals.filter((meal) => meal?.is_eaten === true).length;
      }

      for (const row of (measurementsResult.data ?? []) as unknown as MeasurementProgressRow[]) {
        if (
          !isValidUuid(row.client_id)
          || !measurementsByClientId.has(row.client_id)
          || typeof row.id !== 'string'
          || typeof row.measured_at !== 'string'
        ) {
          continue;
        }
        measurementsByClientId.get(row.client_id)?.push({
          id: row.id,
          measuredAt: row.measured_at,
          weight: row.weight,
        });
      }
    }
  } catch (cause) {
    if (cause instanceof ClientProgressServiceError) throw cause;
    throw new ClientProgressServiceError(cause);
  }

  for (const clientId of uniqueClientIds) {
    const count = mealCounts.get(clientId);
    const measurements = measurementsByClientId.get(clientId) ?? [];
    metrics.set(clientId, {
      compliance: count
        ? calculateClientMealAdherence(count.completed, count.planned)
        : null,
      weeklyChange: calculateWeeklyWeightChange(measurements, now),
    });
  }

  return metrics;
};
