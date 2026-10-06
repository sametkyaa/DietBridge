import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import type { MealChangeRequest, MealChangeRequestDecision } from '../types/mealChangeRequest';
import { isMealChangeRequestStatus, readRequestedSlots } from '../utils/mealChangeRequestContract';

export const MEAL_CHANGE_REQUEST_LOAD_ERROR = 'Öğün değişikliği talepleri yüklenemedi. Lütfen tekrar deneyin.';
export const MEAL_CHANGE_REQUEST_REVIEW_ERROR = 'Talep sonuçlandırılamadı. Lütfen tekrar deneyin.';
export const MEAL_CHANGE_REQUEST_STALE_ERROR = 'Bu talep artık beklemede değil. Liste yenilendi.';

export class MealChangeRequestServiceError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'MealChangeRequestServiceError';
  }
}

interface ClientRow {
  full_name: string | null;
  avatar_url: string | null;
}

interface MealChangeRequestRow {
  id: string;
  client_id: string;
  dietitian_id: string | null;
  plan_date: string;
  meal_slot: string;
  requested_meals: unknown;
  notes: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  response_note: string | null;
  client: ClientRow | ClientRow[] | null;
}

const SELECT = `
  id,
  client_id,
  dietitian_id,
  plan_date,
  meal_slot,
  requested_meals,
  notes,
  status,
  created_at,
  reviewed_at,
  response_note,
  client:client_id (full_name, avatar_url)
`;

const mapRow = (row: MealChangeRequestRow, dietitianId: string): MealChangeRequest => {
  if (
    !isValidUuid(row.id)
    || !isValidUuid(row.client_id)
    || row.dietitian_id !== dietitianId
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.plan_date)
    || !isMealChangeRequestStatus(row.status)
  ) {
    throw new MealChangeRequestServiceError(MEAL_CHANGE_REQUEST_LOAD_ERROR);
  }
  const client = Array.isArray(row.client) ? row.client[0] ?? null : row.client;
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.full_name?.trim() || 'Danışan',
    clientAvatarPath: client?.avatar_url || null,
    planDate: row.plan_date,
    mealSlot: row.meal_slot,
    requestedSlots: readRequestedSlots(row.requested_meals, row.meal_slot),
    notes: row.notes?.trim() || null,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    responseNote: row.response_note,
  };
};

const requireDietitianId = async (): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id || !isValidUuid(user.id)) {
    throw new MealChangeRequestServiceError(MEAL_CHANGE_REQUEST_LOAD_ERROR, error);
  }
  return user.id;
};

/**
 * Pending requests addressed to the signed-in dietitian, newest first.
 * Optionally limited to one client (client profile).
 */
export const fetchPendingMealChangeRequests = async (
  options: { clientId?: string; limit?: number } = {},
): Promise<MealChangeRequest[]> => {
  const dietitianId = await requireDietitianId();
  let query = supabase
    .from('meal_change_requests')
    .select(SELECT)
    .eq('dietitian_id', dietitianId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit ?? 50);
  if (options.clientId) {
    if (!isValidUuid(options.clientId)) throw new MealChangeRequestServiceError(MEAL_CHANGE_REQUEST_LOAD_ERROR);
    query = query.eq('client_id', options.clientId);
  }
  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    console.error('Meal change request load failed:', error?.code ?? 'malformed');
    throw new MealChangeRequestServiceError(MEAL_CHANGE_REQUEST_LOAD_ERROR, error);
  }
  return (data as unknown as MealChangeRequestRow[]).map((row) => mapRow(row, dietitianId));
};

/** Approves or rejects through the server-side RPC (status is never written directly). */
export const reviewMealChangeRequest = async (
  requestId: string,
  decision: MealChangeRequestDecision,
  responseNote: string | null = null,
): Promise<MealChangeRequest> => {
  if (!isValidUuid(requestId) || (decision !== 'approved' && decision !== 'rejected')) {
    throw new MealChangeRequestServiceError(MEAL_CHANGE_REQUEST_REVIEW_ERROR);
  }
  const dietitianId = await requireDietitianId();
  const { data, error } = await supabase.rpc('review_meal_change_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_response_note: responseNote?.trim() || null,
  });
  if (error) {
    console.error('Meal change request review failed:', error.code);
    throw new MealChangeRequestServiceError(
      error.code === 'P0001' ? MEAL_CHANGE_REQUEST_STALE_ERROR : MEAL_CHANGE_REQUEST_REVIEW_ERROR,
      error,
    );
  }
  const row = data as Omit<MealChangeRequestRow, 'client'> | null;
  if (!row || row.id !== requestId || row.status !== decision) {
    throw new MealChangeRequestServiceError(MEAL_CHANGE_REQUEST_REVIEW_ERROR);
  }
  return mapRow({ ...row, client: null }, dietitianId);
};
