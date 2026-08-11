import { supabase } from '../../../lib/supabaseClient';
import { resolveProfilePhotoUrl } from '../../../shared/utils/avatarUrl';
import { isValidUuid } from '../../../shared/utils/uuid';
import type {
  AnalyticsClientOption,
  AnalyticsClientListResult,
  AnalyticsClientProfile,
  AnalyticsDailyLog,
  AnalyticsDateRange,
  AnalyticsDateRangeKey,
  AnalyticsMeal,
  AnalyticsMealPlan,
  AnalyticsMealType,
  AnalyticsMeasurement,
  AnalyticsSourceData,
  ClientAnalyticsReport,
} from '../types/analytics';
import {
  aggregateClientAnalytics,
  ANALYTICS_MAX_MACRO_GRAMS,
  ANALYTICS_MAX_MEAL_CALORIES,
  ANALYTICS_MAX_WATER_ML,
  isAnalyticsDate,
  isAnalyticsDateRangeKey,
  resolveAnalyticsDateRange,
} from '../utils/analyticsContract';

export const ANALYTICS_LOAD_ERROR = 'Analiz verileri y\u00fcklenemedi. L\u00fctfen tekrar deneyin.';
export const ANALYTICS_ACCESS_ERROR = 'Bu dan\u0131\u015fan\u0131n analiz verilerine eri\u015filemiyor.';
export const ANALYTICS_CLIENT_LIST_ERROR = 'Dan\u0131\u015fanlar y\u00fcklenemedi. L\u00fctfen tekrar deneyin.';

const PAGE_SIZE = 500;
const MAX_PAGES = 1_000;
const MEAL_TYPES = new Set<AnalyticsMealType>(['breakfast', 'lunch', 'dinner', 'snack']);

interface ProfileRow {
  user_id: string;
  start_weight: unknown;
  current_weight: unknown;
  target_weight: unknown;
  daily_water_goal_ml: unknown;
}

interface AnalyticsClientRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface AnalyticsRelationshipRow {
  client_id: string;
  status: string;
  client: AnalyticsClientRow | AnalyticsClientRow[] | null;
}

interface MeasurementRow {
  id: string;
  client_id: string;
  measured_at: string;
  weight: unknown;
  waist: unknown;
  hip: unknown;
  arm: unknown;
  right_arm: unknown;
  left_arm: unknown;
  chest: unknown;
  thigh: unknown;
  calf: unknown;
  right_calf: unknown;
  left_calf: unknown;
  neck: unknown;
}

interface DailyLogRow {
  id: string;
  client_id: string;
  date: string;
  water_intake: unknown;
}

interface MealRow {
  id: string;
  plan_id: string;
  type: unknown;
  is_eaten: unknown;
  calories: unknown;
  macros: unknown;
}

interface MealPlanRow {
  id: string;
  client_id: string;
  dietitian_id: string;
  plan_date: string;
  meals: MealRow[] | null;
}

export class AnalyticsServiceError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'AnalyticsServiceError';
  }
}

const nullableFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const nullableBoundedNonNegativeNumber = (value: unknown, maximum: number): number | null => {
  const parsed = nullableFiniteNumber(value);
  return parsed !== null && parsed >= 0 && parsed <= maximum ? parsed : null;
};

const firstNestedRow = <T>(value: T | T[] | null): T | null => (
  Array.isArray(value) ? value[0] ?? null : value
);

const mapAnalyticsClient = async (row: AnalyticsRelationshipRow): Promise<AnalyticsClientOption> => {
  const client = firstNestedRow(row.client);
  if (
    row.status !== 'active'
    || row.client_id !== client?.id
    || !isValidUuid(client.id)
  ) {
    throw new AnalyticsServiceError(ANALYTICS_CLIENT_LIST_ERROR);
  }
  const avatarUrl = await resolveProfilePhotoUrl(client.avatar_url, {
    subjectUserId: client.id,
    allowPrivatePath: true,
  });
  return {
    id: client.id,
    fullName: client.full_name?.trim() || '\u0130simsiz Dan\u0131\u015fan',
    avatarUrl,
  };
};

export const fetchAnalyticsClients = async (): Promise<AnalyticsClientListResult> => {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !isValidUuid(user?.id)) {
    return { status: 'error', kind: 'auth', userMessage: ANALYTICS_CLIENT_LIST_ERROR };
  }

  try {
    const rows: AnalyticsRelationshipRow[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await supabase
        .from('dietitian_clients')
        .select(`
          client_id,
          status,
          client:client_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('dietitian_id', user.id)
        .eq('status', 'active')
        .order('client_id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) {
        return { status: 'error', kind: 'query', userMessage: ANALYTICS_CLIENT_LIST_ERROR };
      }
      const pageRows = (data ?? []) as unknown as AnalyticsRelationshipRow[];
      rows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE) {
        const clients = await Promise.all(rows.map(mapAnalyticsClient));
        return { status: 'success', clients };
      }
    }
    return { status: 'error', kind: 'unexpected', userMessage: ANALYTICS_CLIENT_LIST_ERROR };
  } catch {
    return { status: 'error', kind: 'unexpected', userMessage: ANALYTICS_CLIENT_LIST_ERROR };
  }
};

const requireCurrentDietitianId = async (): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !isValidUuid(user?.id)) {
    throw new AnalyticsServiceError(ANALYTICS_ACCESS_ERROR, error);
  }
  return user.id;
};

const assertActiveRelationship = async (dietitianId: string, clientId: string): Promise<void> => {
  const { data, error } = await supabase
    .from('dietitian_clients')
    .select('id, dietitian_id, client_id, status')
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle();

  const relation = data as {
    id?: unknown;
    dietitian_id?: unknown;
    client_id?: unknown;
    status?: unknown;
  } | null;
  if (
    error
    || !relation
    || !isValidUuid(relation.id)
    || relation.dietitian_id !== dietitianId
    || relation.client_id !== clientId
    || relation.status !== 'active'
  ) {
    throw new AnalyticsServiceError(ANALYTICS_ACCESS_ERROR, error);
  }
};

const mapProfile = (row: ProfileRow | null, clientId: string): AnalyticsClientProfile => {
  if (row !== null && row.user_id !== clientId) {
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR);
  }
  return {
    clientId,
    startWeight: nullableFiniteNumber(row?.start_weight),
    currentWeight: nullableFiniteNumber(row?.current_weight),
    targetWeight: nullableFiniteNumber(row?.target_weight),
    waterGoalMl: nullableBoundedNonNegativeNumber(row?.daily_water_goal_ml, ANALYTICS_MAX_WATER_ML),
  };
};

const mapMeasurement = (row: MeasurementRow, clientId: string): AnalyticsMeasurement => {
  if (!isValidUuid(row.id) || row.client_id !== clientId || !isAnalyticsDate(row.measured_at)) {
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR);
  }
  return {
    id: row.id,
    clientId,
    date: row.measured_at,
    weight: nullableFiniteNumber(row.weight),
    waist: nullableFiniteNumber(row.waist),
    hip: nullableFiniteNumber(row.hip),
    arm: nullableFiniteNumber(row.arm),
    rightArm: nullableFiniteNumber(row.right_arm),
    leftArm: nullableFiniteNumber(row.left_arm),
    chest: nullableFiniteNumber(row.chest),
    thigh: nullableFiniteNumber(row.thigh),
    calf: nullableFiniteNumber(row.calf),
    rightCalf: nullableFiniteNumber(row.right_calf),
    leftCalf: nullableFiniteNumber(row.left_calf),
    neck: nullableFiniteNumber(row.neck),
  };
};

const mapDailyLog = (row: DailyLogRow, clientId: string): AnalyticsDailyLog => {
  if (!isValidUuid(row.id) || row.client_id !== clientId || !isAnalyticsDate(row.date)) {
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR);
  }
  const parsed = nullableFiniteNumber(row.water_intake);
  const hasRawValue = row.water_intake !== null && row.water_intake !== undefined && row.water_intake !== '';
  const isValid = parsed !== null && parsed >= 0 && parsed <= ANALYTICS_MAX_WATER_ML;
  return {
    id: row.id,
    clientId,
    date: row.date,
    waterMl: isValid ? parsed : null,
    hasInvalidWaterValue: hasRawValue && !isValid,
  };
};

const mapMeal = (row: MealRow, planId: string): AnalyticsMeal => {
  if (!isValidUuid(row.id) || row.plan_id !== planId || !MEAL_TYPES.has(row.type as AnalyticsMealType)) {
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR);
  }
  const macros = row.macros && typeof row.macros === 'object' && !Array.isArray(row.macros)
    ? row.macros as Record<string, unknown>
    : null;
  return {
    id: row.id,
    type: row.type as AnalyticsMealType,
    isCompleted: row.is_eaten === true,
    hasCompletionValue: typeof row.is_eaten === 'boolean',
    calories: nullableBoundedNonNegativeNumber(row.calories, ANALYTICS_MAX_MEAL_CALORIES),
    protein: nullableBoundedNonNegativeNumber(macros?.protein, ANALYTICS_MAX_MACRO_GRAMS),
    carbs: nullableBoundedNonNegativeNumber(macros?.carbs, ANALYTICS_MAX_MACRO_GRAMS),
    fat: nullableBoundedNonNegativeNumber(macros?.fat, ANALYTICS_MAX_MACRO_GRAMS),
  };
};

const mapMealPlan = (
  row: MealPlanRow,
  clientId: string,
  dietitianId: string,
): AnalyticsMealPlan => {
  if (
    !isValidUuid(row.id)
    || row.client_id !== clientId
    || row.dietitian_id !== dietitianId
    || !isAnalyticsDate(row.plan_date)
    || !Array.isArray(row.meals)
  ) {
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR);
  }
  return {
    id: row.id,
    clientId,
    dietitianId,
    date: row.plan_date,
    meals: row.meals.map((meal) => mapMeal(meal, row.id)),
  };
};

const fetchProfile = async (clientId: string): Promise<AnalyticsClientProfile> => {
  const { data, error } = await supabase
    .from('client_profiles')
    .select('user_id, start_weight, current_weight, target_weight, daily_water_goal_ml')
    .eq('user_id', clientId)
    .maybeSingle();
  if (error) throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, error);
  return mapProfile(data as ProfileRow | null, clientId);
};

const measurementSelect = 'id, client_id, measured_at, weight, waist, hip, arm, right_arm, left_arm, chest, thigh, calf, right_calf, left_calf, neck';

const fetchMeasurements = async (
  clientId: string,
  range: AnalyticsDateRange,
): Promise<AnalyticsMeasurement[]> => {
  const result: AnalyticsMeasurement[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from('measurements')
      .select(measurementSelect)
      .eq('client_id', clientId)
      .lte('measured_at', range.endDate)
      .order('measured_at', { ascending: true })
      .order('id', { ascending: true });
    if (range.startDate !== null) query = query.gte('measured_at', range.startDate);
    const { data, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, error);
    const rows = (data ?? []) as unknown as MeasurementRow[];
    result.push(...rows.map((row) => mapMeasurement(row, clientId)));
    if (rows.length < PAGE_SIZE) return result;
  }
  throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, new Error('ANALYTICS_MEASUREMENT_PAGE_LIMIT'));
};

const fetchLatestMeasurement = async (
  clientId: string,
  endDate: string,
): Promise<AnalyticsMeasurement | null> => {
  const { data, error } = await supabase
    .from('measurements')
    .select(measurementSelect)
    .eq('client_id', clientId)
    .lte('measured_at', endDate)
    .order('measured_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, error);
  return data ? mapMeasurement(data as unknown as MeasurementRow, clientId) : null;
};

const fetchValidWeightBoundary = async (
  clientId: string,
  endDate: string,
  ascending: boolean,
): Promise<AnalyticsMeasurement | null> => {
  const { data, error } = await supabase
    .from('measurements')
    .select(measurementSelect)
    .eq('client_id', clientId)
    .lte('measured_at', endDate)
    .gte('weight', 20)
    .lte('weight', 500)
    .order('measured_at', { ascending })
    .order('id', { ascending })
    .limit(1)
    .maybeSingle();
  if (error) throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, error);
  const measurement = data ? mapMeasurement(data as unknown as MeasurementRow, clientId) : null;
  if (measurement !== null && (measurement.weight === null || measurement.weight < 20 || measurement.weight > 500)) {
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR);
  }
  return measurement;
};

const fetchDailyLogs = async (
  clientId: string,
  range: AnalyticsDateRange,
): Promise<AnalyticsDailyLog[]> => {
  const result: AnalyticsDailyLog[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from('daily_logs')
      .select('id, client_id, date, water_intake')
      .eq('client_id', clientId)
      .lte('date', range.endDate)
      .order('date', { ascending: true })
      .order('id', { ascending: true });
    if (range.startDate !== null) query = query.gte('date', range.startDate);
    const { data, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, error);
    const rows = (data ?? []) as unknown as DailyLogRow[];
    result.push(...rows.map((row) => mapDailyLog(row, clientId)));
    if (rows.length < PAGE_SIZE) return result;
  }
  throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, new Error('ANALYTICS_DAILY_LOG_PAGE_LIMIT'));
};

const fetchMealPlans = async (
  clientId: string,
  dietitianId: string,
  range: AnalyticsDateRange,
): Promise<AnalyticsMealPlan[]> => {
  const result: AnalyticsMealPlan[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from('meal_plans')
      .select(`
        id,
        client_id,
        dietitian_id,
        plan_date,
        meals (id, plan_id, type, is_eaten, calories, macros)
      `)
      .eq('client_id', clientId)
      .eq('dietitian_id', dietitianId)
      .lte('plan_date', range.endDate)
      .order('plan_date', { ascending: true })
      .order('id', { ascending: true });
    if (range.startDate !== null) query = query.gte('plan_date', range.startDate);
    const { data, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, error);
    const rows = (data ?? []) as unknown as MealPlanRow[];
    result.push(...rows.map((row) => mapMealPlan(row, clientId, dietitianId)));
    if (rows.length < PAGE_SIZE) return result;
  }
  throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, new Error('ANALYTICS_MEAL_PLAN_PAGE_LIMIT'));
};

export const fetchClientAnalyticsSource = async (
  clientId: string,
  rangeKey: AnalyticsDateRangeKey,
  now: Date = new Date(),
): Promise<AnalyticsSourceData> => {
  if (!isValidUuid(clientId) || !isAnalyticsDateRangeKey(rangeKey)) {
    throw new AnalyticsServiceError(ANALYTICS_ACCESS_ERROR);
  }

  const dietitianId = await requireCurrentDietitianId();
  await assertActiveRelationship(dietitianId, clientId);
  const range = resolveAnalyticsDateRange(rangeKey, now);

  try {
    const [
      profile,
      measurements,
      latestMeasurement,
      earliestWeightMeasurement,
      latestWeightMeasurement,
      dailyLogs,
      mealPlans,
    ] = await Promise.all([
      fetchProfile(clientId),
      fetchMeasurements(clientId, range),
      fetchLatestMeasurement(clientId, range.endDate),
      fetchValidWeightBoundary(clientId, range.endDate, true),
      fetchValidWeightBoundary(clientId, range.endDate, false),
      fetchDailyLogs(clientId, range),
      fetchMealPlans(clientId, dietitianId, range),
    ]);
    return {
      clientId,
      dietitianId,
      range,
      profile,
      measurements,
      latestMeasurement,
      earliestWeightMeasurement,
      latestWeightMeasurement,
      dailyLogs,
      mealPlans,
    };
  } catch (cause) {
    if (cause instanceof AnalyticsServiceError) throw cause;
    throw new AnalyticsServiceError(ANALYTICS_LOAD_ERROR, cause);
  }
};

export const fetchClientAnalytics = async (
  clientId: string,
  rangeKey: AnalyticsDateRangeKey,
  now: Date = new Date(),
): Promise<ClientAnalyticsReport> => (
  aggregateClientAnalytics(await fetchClientAnalyticsSource(clientId, rangeKey, now))
);
