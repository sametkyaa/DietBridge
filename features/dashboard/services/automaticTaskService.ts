import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { addCalendarDays, getDateKeyInTimeZone, REPORTING_TIME_ZONE } from '../../../shared/utils/dateContract';
import { fetchPendingMealChangeRequests } from '../../meal-change-requests/services/mealChangeRequestService';
import { formatMealChangeSlots } from '../../meal-change-requests/utils/mealChangeRequestContract';
import {
  deriveAutomaticTasks,
  MEASUREMENT_LOOKBACK_DAYS,
  PLAN_LOOKBACK_DAYS,
  type AutomaticTask,
  type AutomaticTaskClient,
  type AutomaticTaskMeasurement,
  type AutomaticTaskPlanDay,
} from '../utils/automaticTaskContract';

export const AUTOMATIC_TASK_LOAD_ERROR = 'Otomatik görevler hesaplanamadı. Lütfen tekrar deneyin.';

export class AutomaticTaskServiceError extends Error {
  constructor(public readonly cause?: unknown) {
    super(AUTOMATIC_TASK_LOAD_ERROR);
    this.name = 'AutomaticTaskServiceError';
  }
}

interface RelationRow {
  client_id: string;
  accepted_at: string | null;
  client: { full_name: string | null } | Array<{ full_name: string | null }> | null;
}

interface PlanRow {
  client_id: string;
  plan_date: string;
  meals: Array<{ is_eaten: boolean | null }> | null;
}

interface MeasurementRow {
  client_id: string;
  measured_at: string;
}

const BATCH = 50;
const chunk = <T,>(values: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

/**
 * Reads the real data automatic tasks are derived from: active relationships,
 * meal plan days (with eaten counts), the latest weight measurement per client
 * and pending meal change requests. Nothing is written.
 */
export const fetchAutomaticTasks = async (now: Date = new Date()): Promise<AutomaticTask[]> => {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id || !isValidUuid(user.id)) throw new AutomaticTaskServiceError(authError);
  const today = getDateKeyInTimeZone(now, REPORTING_TIME_ZONE);

  const { data: relationData, error: relationError } = await supabase
    .from('dietitian_clients')
    .select('client_id, accepted_at, client:client_id (full_name)')
    .eq('dietitian_id', user.id)
    .eq('status', 'active');
  if (relationError || !Array.isArray(relationData)) throw new AutomaticTaskServiceError(relationError);

  const clients: AutomaticTaskClient[] = (relationData as unknown as RelationRow[])
    .filter((row) => isValidUuid(row.client_id))
    .map((row) => {
      const client = Array.isArray(row.client) ? row.client[0] ?? null : row.client;
      return {
        id: row.client_id,
        name: client?.full_name?.trim() || 'Danışan',
        connectedOn: row.accepted_at ? getDateKeyInTimeZone(new Date(row.accepted_at), REPORTING_TIME_ZONE) : null,
      };
    });
  if (clients.length === 0) return [];

  const planDays: AutomaticTaskPlanDay[] = [];
  const latestMeasurements: AutomaticTaskMeasurement[] = [];
  const lookbackStart = addCalendarDays(today, -PLAN_LOOKBACK_DAYS);

  for (const ids of chunk(clients.map((client) => client.id), BATCH)) {
    const [plans, measurements] = await Promise.all([
      supabase
        .from('meal_plans')
        .select('client_id, plan_date, meals (is_eaten)')
        .eq('dietitian_id', user.id)
        .in('client_id', ids)
        .gte('plan_date', lookbackStart),
      supabase
        .from('measurements')
        .select('client_id, measured_at')
        .in('client_id', ids)
        .not('weight', 'is', null)
        .gte('measured_at', addCalendarDays(today, -MEASUREMENT_LOOKBACK_DAYS))
        .order('measured_at', { ascending: false }),
    ]);
    if (plans.error || !Array.isArray(plans.data)) throw new AutomaticTaskServiceError(plans.error);
    if (measurements.error || !Array.isArray(measurements.data)) throw new AutomaticTaskServiceError(measurements.error);

    for (const row of plans.data as unknown as PlanRow[]) {
      const meals = Array.isArray(row.meals) ? row.meals : [];
      planDays.push({
        clientId: row.client_id,
        planDate: row.plan_date,
        mealCount: meals.length,
        eatenCount: meals.filter((meal) => meal?.is_eaten === true).length,
      });
    }
    const seen = new Set<string>();
    for (const row of measurements.data as unknown as MeasurementRow[]) {
      if (seen.has(row.client_id)) continue;
      seen.add(row.client_id);
      latestMeasurements.push({ clientId: row.client_id, measuredAt: row.measured_at });
    }
  }

  const activeIds = new Set(clients.map((client) => client.id));
  const requests = (await fetchPendingMealChangeRequests({ limit: 100 }))
    .filter((request) => activeIds.has(request.clientId))
    .map((request) => ({
      id: request.id,
      clientId: request.clientId,
      planDate: request.planDate,
      createdAt: request.createdAt,
      slotLabel: formatMealChangeSlots(request.requestedSlots),
    }));

  return deriveAutomaticTasks({ today, clients, planDays, pendingRequests: requests, latestMeasurements });
};
