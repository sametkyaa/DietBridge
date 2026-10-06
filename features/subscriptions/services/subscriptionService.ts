import { supabase } from '../../../lib/supabaseClient';
import {
  SUBSCRIPTION_DETAILS_ERROR,
  SUBSCRIPTION_OVERVIEW_ERROR,
  SubscriptionDetailsResult,
  SubscriptionOverview,
  SubscriptionOverviewResult,
  SubscriptionPeriod,
  SubscriptionPlan,
} from '../types/subscription';

interface SubscriptionOverviewRow {
  plan_id: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  plan_limit: number | null;
  effective_limit: number | null;
  active_count: number | null;
  pending_count: number | null;
  used: number | null;
  remaining: number | null;
  limit_reached: boolean | null;
}

const toNonNegativeInt = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
};

const toNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
};

export const mapSubscriptionOverviewRow = (
  row: SubscriptionOverviewRow,
): SubscriptionOverview => {
  const effectiveLimit = toNonNegativeInt(row.effective_limit);
  const activeCount = toNonNegativeInt(row.active_count);
  const pendingCount = toNonNegativeInt(row.pending_count);
  const used = toNonNegativeInt(row.used ?? activeCount + pendingCount);
  const remaining = toNonNegativeInt(
    row.remaining ?? Math.max(effectiveLimit - used, 0),
  );
  const limitReached =
    typeof row.limit_reached === 'boolean'
      ? row.limit_reached
      : used >= effectiveLimit;

  return {
    planId: row.plan_id ?? 'unknown',
    planName: row.plan_name ?? row.plan_id ?? 'Plan bilgisi yok',
    status: row.subscription_status ?? 'no_subscription',
    planLimit: toNullableInt(row.plan_limit),
    effectiveLimit,
    activeCount,
    pendingCount,
    used,
    remaining,
    limitReached,
  };
};

/**
 * Reads the authoritative subscription/usage snapshot for the signed-in
 * dietitian through the canonical RPC. Fails closed: any error surfaces a
 * user-safe message instead of a fabricated plan state.
 */
export const fetchSubscriptionOverview = async (): Promise<SubscriptionOverviewResult> => {
  try {
    const { data, error } = await supabase.rpc('get_dietitian_subscription_overview');

    if (error) {
      console.error('Subscription overview RPC error:', error);
      return { status: 'error', userMessage: SUBSCRIPTION_OVERVIEW_ERROR };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { status: 'error', userMessage: SUBSCRIPTION_OVERVIEW_ERROR };
    }

    return {
      status: 'success',
      overview: mapSubscriptionOverviewRow(row as SubscriptionOverviewRow),
    };
  } catch (cause) {
    console.error('Subscription overview unexpected error:', cause);
    return { status: 'error', userMessage: SUBSCRIPTION_OVERVIEW_ERROR };
  }
};

interface SubscriptionPlanRow {
  id: string | null;
  name: string | null;
  client_limit: number | null;
  sort_order: number | null;
}

interface SubscriptionPeriodRow {
  status: string | null;
  current_period_end: string | null;
}

/** Drops malformed catalog rows instead of inventing names or limits. */
export const mapSubscriptionPlanRows = (rows: unknown): SubscriptionPlan[] => {
  if (!Array.isArray(rows)) return [];
  return (rows as SubscriptionPlanRow[])
    .filter((row) => typeof row?.id === 'string' && typeof row?.name === 'string' && row.name.trim() !== '')
    .map((row) => ({
      id: row.id as string,
      name: (row.name as string).trim(),
      clientLimit: toNonNegativeInt(row.client_limit),
      sortOrder: toNullableInt(row.sort_order) ?? 0,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
};

export const mapSubscriptionPeriodRow = (row: unknown): SubscriptionPeriod | null => {
  if (!row || typeof row !== 'object') return null;
  const { status, current_period_end: periodEnd } = row as SubscriptionPeriodRow;
  const parsed = typeof periodEnd === 'string' ? new Date(periodEnd) : null;
  return {
    status: typeof status === 'string' && status ? status : 'no_subscription',
    currentPeriodEnd: parsed && !Number.isNaN(parsed.getTime()) ? periodEnd : null,
  };
};

/**
 * Reads the active plan catalog and the signed-in dietitian's own billing
 * period. Both tables are RLS-protected and read-only for the browser; a
 * missing subscription row is a real state (period = null), not an error.
 */
export const fetchSubscriptionDetails = async (): Promise<SubscriptionDetailsResult> => {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) {
      if (userError) console.error('Subscription details auth error:', userError);
      return { status: 'error', userMessage: SUBSCRIPTION_DETAILS_ERROR };
    }

    const [plansResult, periodResult] = await Promise.all([
      supabase
        .from('subscription_plans')
        .select('id, name, client_limit, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('dietitian_subscriptions')
        .select('status, current_period_end')
        .eq('dietitian_id', userId)
        .maybeSingle(),
    ]);

    if (plansResult.error || periodResult.error) {
      console.error('Subscription details query error:', plansResult.error ?? periodResult.error);
      return { status: 'error', userMessage: SUBSCRIPTION_DETAILS_ERROR };
    }

    return {
      status: 'success',
      plans: mapSubscriptionPlanRows(plansResult.data),
      period: mapSubscriptionPeriodRow(periodResult.data),
    };
  } catch (cause) {
    console.error('Subscription details unexpected error:', cause);
    return { status: 'error', userMessage: SUBSCRIPTION_DETAILS_ERROR };
  }
};
