/**
 * Canonical subscription / client-limit contract shared by the service layer
 * and the UI. The authoritative values are produced by the
 * `get_dietitian_subscription_overview` RPC; the front end never derives plan
 * limits or usage on its own.
 */

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'inactive';

export interface SubscriptionOverview {
  planId: string;
  planName: string;
  status: SubscriptionStatus | string;
  /** Nominal client limit of the mapped plan (may be null if plan is unknown). */
  planLimit: number | null;
  /** Fail-closed entitlement actually enforced by the backend. */
  effectiveLimit: number;
  activeCount: number;
  pendingCount: number;
  /** active + pending relationships; the canonical consumed capacity. */
  used: number;
  remaining: number;
  limitReached: boolean;
}

export type SubscriptionOverviewResult =
  | { status: 'success'; overview: SubscriptionOverview }
  | { status: 'error'; userMessage: string };

export const SUBSCRIPTION_OVERVIEW_ERROR =
  'Abonelik bilgileri yüklenirken bir hata oluştu. Lütfen tekrar deneyin.';

/** Row of the active plan catalog (`subscription_plans`). No price is stored. */
export interface SubscriptionPlan {
  id: string;
  name: string;
  clientLimit: number;
  sortOrder: number;
}

/** Own billing period snapshot read from `dietitian_subscriptions`. */
export interface SubscriptionPeriod {
  status: string;
  currentPeriodEnd: string | null;
}

export type SubscriptionDetailsResult =
  | { status: 'success'; plans: SubscriptionPlan[]; period: SubscriptionPeriod | null }
  | { status: 'error'; userMessage: string };

export const SUBSCRIPTION_DETAILS_ERROR =
  'Plan kataloğu yüklenemedi. Lütfen tekrar deneyin.';
