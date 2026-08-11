import { supabase } from '../../../lib/supabaseClient';
import {
  SUBSCRIPTION_OVERVIEW_ERROR,
  SubscriptionOverview,
  SubscriptionOverviewResult,
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
    planId: row.plan_id ?? 'free',
    planName: row.plan_name ?? row.plan_id ?? 'Ücretsiz',
    status: row.subscription_status ?? 'active',
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
