
import { supabase } from '../../../lib/supabaseClient';
import { Client, ClientLifestyleReadModel } from '../../../shared/types';
import { USER_AVATAR } from '../../../shared/constants';
import { isValidUuid } from '../../../shared/utils/uuid';

export function resolveProfilePhotoUrl(
  storedValue: string | null | undefined
): string | null {
  if (!storedValue) return null;

  if (/^https?:\/\//i.test(storedValue)) {
    return storedValue;
  }

  try {
    const { data } = supabase.storage.from('avatars').getPublicUrl(storedValue);
    if (data?.publicUrl) {
      return data.publicUrl;
    }
  } catch (e) {
    console.error("Error resolving profile photo:", e);
  }
  return null;
}

interface CatalogLabelRow {
  label: string | null;
}

interface BloodTypeCatalogRow {
  code: string | null;
}

type NestedRelation<T> = T | T[] | null;

interface ClientBaseProfileRow {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

interface ClientDetailsProfileRow {
  goal_id: number | null;
  goal: string | null;
  goal_catalog: NestedRelation<CatalogLabelRow>;
  diet_start_date: string | null;
  current_weight: number | null;
  compliance_score: number | null;
  start_weight: number | null;
  target_weight: number | null;
  height_cm: number | null;
  last_lab_date: string | null;
  activity_level_id: number | null;
  activity_level: string | null;
  activity_catalog: NestedRelation<CatalogLabelRow>;
  sleep_hours: number | string | null;
  sleep_hours_min: number | string | null;
  sleep_hours_max: number | string | null;
  smoking_status: boolean | null;
  alcohol_use: boolean | null;
  alcohol_status_id: number | null;
  alcohol_status: string | null;
  alcohol_catalog: NestedRelation<CatalogLabelRow>;
  nutrition_type_id: number | null;
  nutrition_type: string | null;
  nutrition_catalog: NestedRelation<CatalogLabelRow>;
  daily_water_goal_ml: number | null;
  food_intolerances: unknown;
  disliked_foods: unknown;
  chronic_conditions: unknown;
  medications: unknown;
  blood_type_id: number | null;
  blood_type: string | null;
  blood_type_catalog: NestedRelation<BloodTypeCatalogRow>;
}

interface ClientListProfileRow {
  goal_id: number | null;
  goal: string | null;
  goal_catalog: NestedRelation<CatalogLabelRow>;
  diet_start_date: string | null;
  current_weight: number | null;
  compliance_score: number | null;
  start_weight: number | null;
  target_weight: number | null;
  height_cm: number | null;
  last_lab_date: string | null;
  activity_level_id: number | null;
  activity_level: string | null;
  sleep_hours: number | null;
  smoking_status: boolean | null;
  alcohol_use: boolean | null;
  activity_catalog: NestedRelation<CatalogLabelRow>;
  blood_type_id: number | null;
  blood_type: string | null;
  blood_type_catalog: NestedRelation<BloodTypeCatalogRow>;
  chronic_conditions: unknown;
  medications: unknown;
}

interface ClientListRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  client_profiles: ClientListProfileRow | ClientListProfileRow[] | null;
  client_medical_conditions: Array<{
    medical_conditions: { name: string | null } | null;
  }> | null;
  client_medications: Array<{
    medications_catalog: { name: string | null } | null;
  }> | null;
}

interface ClientMedicalConditionRow {
  medical_conditions: NestedRelation<{ name: string | null }>;
}

interface ClientMedicationRow {
  medications_catalog: NestedRelation<{ name: string | null }>;
}

interface DietitianClientListRow {
  status: string;
  client: ClientListRow | ClientListRow[] | null;
}

export interface PendingClientSummary {
  id: string;
  relationId: string;
  name: string;
  email: string;
  profilePhotoUrl: string | null;
}

type ClientLifestyleKeys =
  | 'goal'
  | 'activityLevel'
  | 'bloodType'
  | 'chronicConditions'
  | 'medications'
  | 'foodIntolerances'
  | 'sleepHours'
  | 'smokingStatus'
  | 'alcoholUse';

export type ActiveClientDetails = Omit<Client, ClientLifestyleKeys> &
  ClientLifestyleReadModel & { relationId: string };

interface ClientLifestyleReadSource {
  profile: Partial<ClientDetailsProfileRow>;
  canonicalConditions: string[] | null;
  canonicalMedications: string[] | null;
}

export type ClientDetailAccessResult =
  | { status: 'active'; client: ActiveClientDetails }
  | { status: 'pending'; client: PendingClientSummary }
  | { status: 'invalid_id' }
  | { status: 'unavailable' }
  | { status: 'error'; userMessage: string; cause?: unknown };

const CLIENT_DETAIL_LOAD_ERROR =
  'Danışan bilgileri şu anda yüklenemiyor. Lütfen tekrar deneyin.';

const CLIENT_LIST_LOAD_ERROR =
  'Danışanlar yüklenirken bir sorun oluştu. Lütfen tekrar deneyin.';

export type ClientListResult =
  | { status: 'success'; clients: Client[] }
  | { status: 'error'; kind: 'auth' | 'query' | 'unexpected'; userMessage: string };


/**
 * Fetches clients associated with the logged-in dietitian.
 */
export const fetchDietitianClientList = async (): Promise<ClientListResult> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { status: 'error', kind: 'auth', userMessage: CLIENT_LIST_LOAD_ERROR };
    }

    const { data, error } = await supabase
      .from('dietitian_clients')
      .select(`
        status,
        client:client_id (
          id,
          full_name,
          avatar_url,
          email,
          client_profiles (
            goal,
            goal_id,
            goal_catalog:client_goals!client_profiles_goal_id_fkey (label),
            diet_start_date,
            current_weight,
            compliance_score,
            start_weight,
            target_weight,
            height_cm,
            last_lab_date,
            activity_level,
            activity_level_id,
            activity_catalog:activity_levels!client_profiles_activity_level_id_fkey (label),
            sleep_hours,
            smoking_status,
            alcohol_use,
            blood_type,
            blood_type_id,
            blood_type_catalog:blood_types!client_profiles_blood_type_id_fkey (code),
            chronic_conditions,
            medications
          ),
          client_medical_conditions (
            medical_conditions (
              name
            )
          ),
          client_medications (
            medications_catalog (
              name
            )
          )
        )
      `)
      .eq('dietitian_id', user.id)
      .in('status', ['active', 'pending']);

    if (error) {
      return { status: 'error', kind: 'query', userMessage: CLIENT_LIST_LOAD_ERROR };
    }

    const rows = (data ?? []) as unknown as DietitianClientListRow[];
    const clients = rows.flatMap((item): Client[] => {
      if (item.status !== 'active' && item.status !== 'pending') return [];

      const client = Array.isArray(item.client) ? item.client[0] : item.client;
      if (!client || !isValidUuid(client.id)) return [];

      const profile: Partial<ClientListProfileRow> = Array.isArray(client.client_profiles)
        ? client.client_profiles[0] || {}
        : client.client_profiles || {};
      
      const goal = resolveCatalogValue(
        profile.goal_id,
        profile.goal_catalog,
        'label',
        profile.goal,
      );
      const activityLevel = resolveCatalogValue(
        profile.activity_level_id,
        profile.activity_catalog,
        'label',
        profile.activity_level,
      );
      const bloodType = resolveCatalogValue(
        profile.blood_type_id,
        profile.blood_type_catalog,
        'code',
        profile.blood_type,
      );
      
      const canonicalConditions = Array.isArray(client.client_medical_conditions)
        && client.client_medical_conditions.length > 0
        ? client.client_medical_conditions
            .map(condition => condition.medical_conditions?.name)
            .filter((name): name is string => Boolean(name))
        : null;
      const chronicConditions = normalizeJunctionValues(
        canonicalConditions,
        profile.chronic_conditions,
      );

      const canonicalMedications = Array.isArray(client.client_medications)
        && client.client_medications.length > 0
        ? client.client_medications
            .map(medication => medication.medications_catalog?.name)
            .filter((name): name is string => Boolean(name))
        : null;
      const medications = normalizeJunctionValues(canonicalMedications, profile.medications);

      const status: Client['status'] = item.status === 'active' ? 'Aktif' : 'Onay Bekliyor';

      return [{
        id: client.id,
        name: client.full_name || 'İsimsiz Danışan',
        email: client.email || '',
        avatar: resolveProfilePhotoUrl(client.avatar_url) || USER_AVATAR,
        profilePhotoUrl: resolveProfilePhotoUrl(client.avatar_url),
        status,
        goal: goal || 'Yok',
        startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
        duration: '1 Ay', // Calculated or static
        currentWeight: profile.current_weight ? `${profile.current_weight} kg` : '-',
        startWeight: profile.start_weight ? `${profile.start_weight} kg` : undefined,
        targetWeight: profile.target_weight ? `${profile.target_weight} kg` : undefined,
        weeklyChange: 0, // Needs calculation from daily_logs
        compliance: profile.compliance_score || 0,
        bloodType,
        chronicConditions,
        medications,
        heightCm: profile.height_cm,
        lastLabDate: profile.last_lab_date ? new Date(profile.last_lab_date).toLocaleDateString('tr-TR') : undefined,
        activityLevel: activityLevel || undefined,
        sleepHours: profile.sleep_hours,
      }];
    });

    return { status: 'success', clients };
  } catch {
    return { status: 'error', kind: 'unexpected', userMessage: CLIENT_LIST_LOAD_ERROR };
  }
};

export const fetchDietitianClients = async (): Promise<Client[]> => {
  const result = await fetchDietitianClientList();
  if (result.status === 'error') throw new Error(result.userMessage);
  return result.clients;
};

/**
 * Fetch a single client's details
 */
const INVALID_TEXT_VALUES = new Set(['null', 'undefined', 'nan', '[object object]', '[]']);

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || INVALID_TEXT_VALUES.has(normalized.toLocaleLowerCase('tr-TR'))) {
    return null;
  }
  return normalized;
}

function firstRelation<T>(value: NestedRelation<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function resolveCatalogValue<T extends CatalogLabelRow | BloodTypeCatalogRow>(
  canonicalId: number | null | undefined,
  catalog: NestedRelation<T> | undefined,
  displayKey: keyof T,
  legacyValue: unknown,
): string | null {
  if (canonicalId !== null && canonicalId !== undefined) {
    return normalizeText(firstRelation(catalog)?.[displayKey]);
  }
  return normalizeText(legacyValue);
}

export function normalizeMultiValue(value: unknown): string[] {
  let candidates: unknown[] = [];

  if (Array.isArray(value)) {
    candidates = [...value];
  } else if (typeof value === 'string') {
    const normalized = normalizeText(value);
    if (!normalized) return [];

    try {
      const parsedValue: unknown = JSON.parse(normalized);
      candidates = Array.isArray(parsedValue) ? [...parsedValue] : normalized.split(',');
    } catch {
      candidates = normalized.split(',');
    }
  }

  const uniqueValues = new Map<string, string>();
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase('tr-TR');
    if (!uniqueValues.has(key)) uniqueValues.set(key, normalized);
  }

  return [...uniqueValues.values()].sort((left, right) =>
    left.localeCompare(right, 'tr-TR', { sensitivity: 'base' }),
  );
}

function normalizeJunctionValues(canonicalValues: string[] | null, legacyValue: unknown): string[] {
  return canonicalValues !== null
    ? normalizeMultiValue(canonicalValues)
    : normalizeMultiValue(legacyValue);
}

function normalizeSleepValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 24 ? parsed : null;
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value);
}

function normalizeSleepRange(
  rawMin: unknown,
  rawMax: unknown,
  rawLegacy: unknown,
): Pick<ClientLifestyleReadModel, 'sleepHoursMin' | 'sleepHoursMax' | 'sleepHoursLabel'> {
  const hasCanonicalValue = (rawMin !== null && rawMin !== undefined)
    || (rawMax !== null && rawMax !== undefined);

  if (hasCanonicalValue) {
    const min = rawMin === null || rawMin === undefined ? null : normalizeSleepValue(rawMin);
    const max = rawMax === null || rawMax === undefined ? null : normalizeSleepValue(rawMax);
    const invalidMin = rawMin !== null && rawMin !== undefined && min === null;
    const invalidMax = rawMax !== null && rawMax !== undefined && max === null;

    if (invalidMin || invalidMax || (min !== null && max !== null && min > max)) {
      return { sleepHoursMin: null, sleepHoursMax: null, sleepHoursLabel: null };
    }

    const label = min !== null && max !== null
      ? min === max
        ? `${formatHours(min)} saat`
        : `${formatHours(min)}–${formatHours(max)} saat`
      : min !== null
        ? `En az ${formatHours(min)} saat`
        : max !== null
          ? `En fazla ${formatHours(max)} saat`
          : null;

    return { sleepHoursMin: min, sleepHoursMax: max, sleepHoursLabel: label };
  }

  const legacy = normalizeSleepValue(rawLegacy);
  return {
    sleepHoursMin: null,
    sleepHoursMax: null,
    sleepHoursLabel: legacy === null ? null : `${formatHours(legacy)} saat`,
  };
}

export function createClientLifestyleReadModel({
  profile,
  canonicalConditions,
  canonicalMedications,
}: ClientLifestyleReadSource): ClientLifestyleReadModel {
  const sleep = normalizeSleepRange(
    profile.sleep_hours_min,
    profile.sleep_hours_max,
    profile.sleep_hours,
  );

  return {
    goal: resolveCatalogValue(profile.goal_id, profile.goal_catalog, 'label', profile.goal),
    activityLevel: resolveCatalogValue(
      profile.activity_level_id,
      profile.activity_catalog,
      'label',
      profile.activity_level,
    ),
    bloodType: resolveCatalogValue(
      profile.blood_type_id,
      profile.blood_type_catalog,
      'code',
      profile.blood_type,
    ),
    alcoholStatus: resolveCatalogValue(
      profile.alcohol_status_id,
      profile.alcohol_catalog,
      'label',
      profile.alcohol_status,
    ),
    nutritionType: resolveCatalogValue(
      profile.nutrition_type_id,
      profile.nutrition_catalog,
      'label',
      profile.nutrition_type,
    ),
    smokingStatus: typeof profile.smoking_status === 'boolean' ? profile.smoking_status : null,
    alcoholUse: typeof profile.alcohol_use === 'boolean' ? profile.alcohol_use : null,
    ...sleep,
    dislikedFoods: normalizeMultiValue(profile.disliked_foods),
    chronicConditions: normalizeJunctionValues(canonicalConditions, profile.chronic_conditions),
    medications: normalizeJunctionValues(canonicalMedications, profile.medications),
    foodIntolerances: normalizeMultiValue(profile.food_intolerances),
  };
}


export const fetchClientDetails = async (clientId: string): Promise<ClientDetailAccessResult> => {
  if (!isValidUuid(clientId)) {
    return { status: 'invalid_id' };
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      return { status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR, cause: authError };
    }
    if (!user) return { status: 'unavailable' };

    // 1. Verify dietitian-client relationship
    const { data: relation, error: relationError } = await supabase
      .from('dietitian_clients')
      .select('id, status')
      .eq('dietitian_id', user.id)
      .eq('client_id', clientId)
      .maybeSingle();

    if (relationError) {
      return { status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR, cause: relationError };
    }
    if (!relation || (relation.status !== 'active' && relation.status !== 'pending')) {
      return { status: 'unavailable' };
    }

    if (relation.status === 'pending') {
      const { data: pendingProfile, error: pendingProfileError } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, email')
        .eq('id', clientId)
        .maybeSingle();

      if (pendingProfileError) {
        return {
          status: 'error',
          userMessage: CLIENT_DETAIL_LOAD_ERROR,
          cause: pendingProfileError,
        };
      }
      if (!pendingProfile) return { status: 'unavailable' };

      const profilePhotoUrl = resolveProfilePhotoUrl(pendingProfile.avatar_url);

      return {
        status: 'pending',
        client: {
          id: clientId,
          relationId: relation.id,
          name: pendingProfile.full_name || 'İsimsiz Danışan',
          email: pendingProfile.email || '',
          profilePhotoUrl,
        },
      };
    }

    // 2. Fetch profile data
    const { data: userProfile, error: userProfileError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, email, phone')
      .eq('id', clientId)
      .maybeSingle();

    if (userProfileError) {
      return { status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR, cause: userProfileError };
    }
    if (!userProfile) return { status: 'unavailable' };

    // 3. Fetch active-only profile and canonical health data.
    const [clientProfileResult, conditionsResult, medicationsResult] = await Promise.all([
      supabase
        .from('client_profiles')
        .select(`
          goal,
          goal_id,
          goal_catalog:client_goals!client_profiles_goal_id_fkey (label),
          diet_start_date,
          current_weight,
          compliance_score,
          start_weight,
          target_weight,
          height_cm,
          last_lab_date,
          activity_level,
          activity_level_id,
          activity_catalog:activity_levels!client_profiles_activity_level_id_fkey (label),
          sleep_hours,
          sleep_hours_min,
          sleep_hours_max,
          smoking_status,
          alcohol_use,
          alcohol_status,
          alcohol_status_id,
          alcohol_catalog:alcohol_statuses!client_profiles_alcohol_status_id_fkey (label),
          nutrition_type,
          nutrition_type_id,
          nutrition_catalog:nutrition_types!client_profiles_nutrition_type_id_fkey (label),
          daily_water_goal_ml,
          food_intolerances,
          disliked_foods,
          chronic_conditions,
          medications,
          blood_type,
          blood_type_id,
          blood_type_catalog:blood_types!client_profiles_blood_type_id_fkey (code)
        `)
        .eq('user_id', clientId)
        .maybeSingle(),
      supabase
        .from('client_medical_conditions')
        .select(`
          medical_conditions!client_medical_conditions_condition_id_fkey (name)
        `)
        .eq('client_id', clientId),
      supabase
        .from('client_medications')
        .select(`
          medications_catalog!client_medications_medication_id_fkey (name)
        `)
        .eq('client_id', clientId),
    ]);

    const activeReadError = clientProfileResult.error
      || conditionsResult.error
      || medicationsResult.error;
    if (activeReadError) {
      return { status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR, cause: activeReadError };
    }

    const clientData = (userProfile ?? {}) as Partial<ClientBaseProfileRow>;
    const profile = (clientProfileResult.data ?? {}) as Partial<ClientDetailsProfileRow>;
    const conditionRows = (conditionsResult.data ?? []) as unknown as ClientMedicalConditionRow[];
    const medicationRows = (medicationsResult.data ?? []) as unknown as ClientMedicationRow[];
    const canonicalConditions = conditionRows.length > 0
      ? conditionRows.flatMap((row) => {
          const name = normalizeText(firstRelation(row.medical_conditions)?.name);
          return name ? [name] : [];
        })
      : null;
    const canonicalMedications = medicationRows.length > 0
      ? medicationRows.flatMap((row) => {
          const name = normalizeText(firstRelation(row.medications_catalog)?.name);
          return name ? [name] : [];
        })
      : null;
    const lifestyle = createClientLifestyleReadModel({
      profile,
      canonicalConditions,
      canonicalMedications,
    });
    const waterGoalLiters = profile.daily_water_goal_ml ? profile.daily_water_goal_ml / 1000 : undefined;

    const profilePhotoUrl = resolveProfilePhotoUrl(clientData.avatar_url);

    return {
      status: 'active',
      client: {
        id: clientId,
        relationId: relation.id,
        name: clientData.full_name || 'İsimsiz Danışan',
        email: clientData.email || '',
        phone: clientData.phone || '',
        avatar: profilePhotoUrl || USER_AVATAR,
        profilePhotoUrl,
        status: 'Aktif',
        ...lifestyle,
        startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
        duration: '1 Ay',
        currentWeight: profile.current_weight ? `${profile.current_weight}` : '-',
        startWeight: profile.start_weight ? `${profile.start_weight}` : undefined,
        targetWeight: profile.target_weight ? `${profile.target_weight}` : undefined,
        weeklyChange: 0,
        compliance: profile.compliance_score || 0,
        waterGoalLiters,
        heightCm: profile.height_cm,
        lastLabDate: profile.last_lab_date ? new Date(profile.last_lab_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
      },
    };
  } catch (cause) {
    return { status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR, cause };
  }
};

export interface Measurement {
  id: string;
  client_id: string;
  measured_at: string;
  weight: number | null;
  waist: number | null;
  hip: number | null;
  arm: number | null;
  chest: number | null;
  thigh: number | null;
  calf: number | null;
  neck: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveClientMeasurementInput {
  clientId: string;
  measuredAt: string;
  weight: number | null;
  waist: number | null;
  hip: number | null;
  arm: number | null;
  chest: number | null;
  thigh: number | null;
  calf: number | null;
  neck: number | null;
  notes: string | null;
}

export const CLIENT_MEASUREMENT_SAVE_ERROR =
  'Ölçüm şu anda kaydedilemiyor. Lütfen bilgileri kontrol edip tekrar deneyin.';

const measurementNumericKeys = [
  'weight',
  'waist',
  'hip',
  'arm',
  'chest',
  'thigh',
  'calf',
  'neck',
] as const satisfies ReadonlyArray<keyof SaveClientMeasurementInput>;

type MeasurementNumericKey = (typeof measurementNumericKeys)[number];

const isValidMeasurementDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const createMeasurementSaveError = (cause: unknown): Error => {
  const error = new Error(CLIENT_MEASUREMENT_SAVE_ERROR);
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  return error;
};

const normalizeMeasurementNotes = (notes: string | null): string | null => {
  if (notes === null) return null;
  const normalized = notes.trim();
  return normalized.length > 0 ? normalized : null;
};

const isCanonicalMeasurementRow = (
  value: unknown,
  input: SaveClientMeasurementInput,
  normalizedNotes: string | null
): value is Measurement => {
  if (!value || typeof value !== 'object') return false;

  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !isValidUuid(row.id)) return false;
  if (row.client_id !== input.clientId || row.measured_at !== input.measuredAt) return false;
  if (row.notes !== normalizedNotes) return false;
  if (typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') return false;

  return measurementNumericKeys.every((key) => {
    const expected = input[key];
    const actual = row[key];
    return expected === null
      ? actual === null
      : typeof actual === 'number' && Number.isFinite(actual) && actual === expected;
  });
};

export const saveClientMeasurement = async (
  input: SaveClientMeasurementInput
): Promise<Measurement> => {
  try {
    if (!isValidUuid(input.clientId) || !isValidMeasurementDate(input.measuredAt)) {
      throw new Error('Invalid measurement identity or date');
    }

    const values = measurementNumericKeys.map((key) => input[key]);
    if (!values.some((value) => value !== null)) {
      throw new Error('At least one measurement value is required');
    }
    if (values.some((value) => value !== null && !Number.isFinite(value))) {
      throw new Error('Measurement values must be finite numbers');
    }
    if (input.weight !== null && (input.weight < 20 || input.weight > 500)) {
      throw new Error('Weight is outside the supported range');
    }

    const circumferenceKeys: MeasurementNumericKey[] = [
      'waist', 'hip', 'arm', 'chest', 'thigh', 'calf', 'neck',
    ];
    if (circumferenceKeys.some((key) => {
      const value = input[key];
      return value !== null && (value <= 0 || value > 500);
    })) {
      throw new Error('Circumference is outside the supported range');
    }

    const normalizedNotes = normalizeMeasurementNotes(input.notes);
    if (normalizedNotes !== null && normalizedNotes.length > 1000) {
      throw new Error('Measurement notes are too long');
    }

    const { data, error } = await supabase.rpc('save_active_client_measurement', {
      p_client_id: input.clientId,
      p_measured_at: input.measuredAt,
      p_weight: input.weight,
      p_waist: input.waist,
      p_hip: input.hip,
      p_arm: input.arm,
      p_chest: input.chest,
      p_thigh: input.thigh,
      p_calf: input.calf,
      p_neck: input.neck,
      p_notes: normalizedNotes,
    });

    if (error) throw error;

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length !== 1 || !isCanonicalMeasurementRow(rows[0], input, normalizedNotes)) {
      throw new Error('Measurement RPC returned an invalid canonical row');
    }

    return rows[0];
  } catch (cause) {
    throw createMeasurementSaveError(cause);
  }
};

export interface DailyLog {
  id: string;
  date: string;
  water_intake: number | null;
}

export const fetchClientMeasurements = async (clientId: string): Promise<Measurement[]> => {
  if (!isValidUuid(clientId)) {
    throw new Error('Invalid client identifier');
  }

  const { data, error } = await supabase
    .from('measurements')
    .select('id, client_id, measured_at, weight, waist, hip, arm, chest, thigh, calf, neck, notes, created_at, updated_at')
    .eq('client_id', clientId)
    .order('measured_at', { ascending: true });

  if (error) throw error;
  return data || [];
};

export const fetchClientDailyLogs = async (clientId: string): Promise<DailyLog[]> => {
  if (!isValidUuid(clientId)) {
    throw new Error('Invalid client identifier');
  }

  const { data, error } = await supabase
    .from('daily_logs')
    .select('id, date, water_intake')
    .eq('client_id', clientId)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
};

export type ClientConnectionRequestStatus =
  | 'requested'
  | 'already_pending'
  | 'already_active'
  | 'unavailable';

export type AddClientResult =
  | { status: ClientConnectionRequestStatus }
  | { status: 'error' };

export type RemoveClientResult =
  | { status: 'removed' }
  | { status: 'unavailable' }
  | { status: 'error' };

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const parseClientConnectionRequestStatus = (
  value: unknown
): ClientConnectionRequestStatus | null => {
  switch (value) {
    case 'requested':
    case 'already_pending':
    case 'already_active':
    case 'unavailable':
      return value;
    default:
      return null;
  }
};

/**
 * Requests a connection to an eligible mobile client through the security-definer RPC.
 */
export const addClientByEmail = async (email: string): Promise<AddClientResult> => {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return { status: 'error' };
  }

  try {
    const { data, error } = await supabase.rpc('request_client_connection_by_email', {
      p_email: normalizedEmail,
    });

    if (error) return { status: 'error' };

    const status = parseClientConnectionRequestStatus(data);
    return status ? { status } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
};

/**
 * Sets an owned pending or active relationship to removed.
 */
export const removeClient = async (relationId: string): Promise<RemoveClientResult> => {
  if (!isValidUuid(relationId)) return { status: 'unavailable' };

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { status: 'error' };

    const { data, error } = await supabase
      .from('dietitian_clients')
      .update({ status: 'removed' })
      .eq('id', relationId)
      .eq('dietitian_id', user.id)
      .in('status', ['pending', 'active'])
      .select('id')
      .maybeSingle();

    if (error) return { status: 'error' };
    if (!data || data.id !== relationId) return { status: 'unavailable' };

    return { status: 'removed' };
  } catch {
    return { status: 'error' };
  }
};
