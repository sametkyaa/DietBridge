import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  AdminDecisionResult,
  AdminErrorCode,
  AdminServiceError,
  AdminStatusFilter,
  AdminSummary,
  AdminVerificationStatus,
  DietitianApplication,
  DietitianApplicationDetail,
  VerificationHistoryEntry,
} from '../types';

export const ADMIN_DIPLOMA_BUCKET = 'dietitian-diplomas';
export const ADMIN_DIPLOMA_SIGNED_URL_SECONDS = 120;
export const ADMIN_PAGE_SIZE = 20;

const DIPLOMA_OBJECT_PATH_PATTERN = /^diplomas\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/diploma\.pdf$/;
const VERIFICATION_STATUSES = new Set<AdminVerificationStatus>(['pending', 'approved', 'rejected']);

type SupabaseErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

const errorMessage = (error: unknown): string => (
  error && typeof error === 'object' && typeof (error as SupabaseErrorLike).message === 'string'
    ? (error as SupabaseErrorLike).message as string
    : ''
);

const errorCode = (error: unknown): string => (
  error && typeof error === 'object' && typeof (error as SupabaseErrorLike).code === 'string'
    ? (error as SupabaseErrorLike).code as string
    : ''
);

const mapAdminErrorCode = (error: unknown): AdminErrorCode => {
  const code = errorCode(error);
  const message = errorMessage(error).toLocaleLowerCase('tr-TR');

  if (code === '42501' || /yönetim erişimi|yetkiniz yok|permission denied/.test(message)) {
    return 'NOT_AUTHORIZED';
  }
  if (code === 'P0002' || /bulunamadı/.test(message)) {
    return 'NOT_FOUND';
  }
  if (code === '23514' && /tamamlanmamış|diploma/.test(message)) {
    return 'INCOMPLETE_APPLICATION';
  }
  if (code === 'P0001' && /durumu|yeniden|reddedilemez|onaylanamaz|kararı/.test(message)) {
    return 'INVALID_TRANSITION';
  }
  if (code === '22023' || /zorunlu|geçersiz|aşamaz|uzun/.test(message)) {
    return 'INVALID_REQUEST';
  }
  return 'UNKNOWN';
};

const getAdminErrorMessage = ({ code }: { code: AdminErrorCode }): string => {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'Oturum doğrulanamadı. Lütfen yeniden giriş yapın.';
    case 'NOT_AUTHORIZED':
      return 'Bu alana erişim yetkiniz bulunmuyor.';
    case 'ACCESS_CHECK_FAILED':
      return 'Yönetim erişimi doğrulanamadı. Lütfen tekrar deneyin.';
    case 'INVALID_REQUEST':
      return 'İstek doğrulanamadı. Lütfen bilgileri kontrol edin.';
    case 'NOT_FOUND':
      return 'Diyetisyen başvurusu bulunamadı.';
    case 'INCOMPLETE_APPLICATION':
      return 'Başvuru bilgileri veya diploma tamamlanmamış.';
    case 'INVALID_TRANSITION':
      return 'Başvuru durumu bu işlem için uygun değil.';
    case 'STORAGE_ACCESS_FAILED':
      return 'Diploma görüntülenemedi. Lütfen tekrar deneyin.';
    case 'INVALID_RESPONSE':
      return 'Yönetim verisi doğrulanamadı. Lütfen tekrar deneyin.';
    case 'UNKNOWN':
    default:
      return 'Yönetim işlemi tamamlanamadı. Lütfen tekrar deneyin.';
  }
};

const toAdminServiceError = (error: unknown, fallbackCode: AdminErrorCode = 'UNKNOWN'): AdminServiceError => {
  if (error instanceof AdminServiceError) return error;

  const mappedCode = mapAdminErrorCode(error);
  const code = mappedCode === 'UNKNOWN' ? fallbackCode : mappedCode;
  return new AdminServiceError(code, getAdminErrorMessage({ code }));
};

const assertValidUuid = (value: string, field: string): void => {
  if (!isValidUuid(value)) {
    throw new AdminServiceError('INVALID_REQUEST', `${field} doğrulanamadı.`);
  }
};

const asNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
};

const asNullableInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
};

const parseStatus = (value: unknown): AdminVerificationStatus => {
  if (typeof value === 'string' && VERIFICATION_STATUSES.has(value as AdminVerificationStatus)) {
    return value as AdminVerificationStatus;
  }
  throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
};

const parseCompletenessState = (value: unknown): 'complete' | 'incomplete' => {
  if (value === 'complete' || value === 'incomplete') return value;
  throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
};

const asRows = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
};

const requireSingleRow = (data: unknown): Record<string, unknown> => {
  const rows = asRows(data);
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return rows[0] as Record<string, unknown>;
};

const parseSummary = (data: unknown): AdminSummary => {
  const row = requireSingleRow(data);
  const counts = ['pending', 'approved', 'rejected'].map((key) => Number(row[key]));
  if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return {
    pending: counts[0],
    approved: counts[1],
    rejected: counts[2],
  };
};

const parseApplication = (data: unknown): DietitianApplication => {
  if (!data || typeof data !== 'object') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  const row = data as Record<string, unknown>;
  if (typeof row.user_id !== 'string' || !isValidUuid(row.user_id)) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return {
    userId: row.user_id,
    fullName: asNullableString(row.full_name),
    email: asNullableString(row.email),
    createdAt: asNullableString(row.created_at),
    university: asNullableString(row.university),
    specialization: asNullableString(row.specialization),
    experienceYears: asNullableInteger(row.experience_years),
    verificationStatus: parseStatus(row.verification_status),
    completenessState: parseCompletenessState(row.completeness_state),
  };
};

const parseDetail = (data: unknown): DietitianApplicationDetail => {
  if (!data || typeof data !== 'object') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  const row = data as Record<string, unknown>;
  const application = parseApplication(row);
  const missingFields = Array.isArray(row.missing_fields)
    && row.missing_fields.every((field) => typeof field === 'string')
    ? row.missing_fields as string[]
    : null;
  if (!missingFields) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  if (row.is_verified !== null && row.is_verified !== undefined && typeof row.is_verified !== 'boolean') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  if (
    row.diploma_object_path !== null
    && row.diploma_object_path !== undefined
    && !isDiplomaPathForUser(application.userId, row.diploma_object_path)
  ) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return {
    ...application,
    phone: asNullableString(row.phone),
    graduationYear: asNullableInteger(row.graduation_year),
    bio: asNullableString(row.bio),
    isVerified: row.is_verified as boolean | null | undefined ?? null,
    verifiedAt: asNullableString(row.verified_at),
    rejectionReason: asNullableString(row.rejection_reason),
    missingFields,
    diplomaObjectPath: asNullableString(row.diploma_object_path),
  };
};

const parseHistoryEntry = (data: unknown): VerificationHistoryEntry => {
  if (!data || typeof data !== 'object') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  const row = data as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || !isValidUuid(row.id)
    || typeof row.decided_by_snapshot !== 'string'
    || !isValidUuid(row.decided_by_snapshot)
    || typeof row.decided_at !== 'string'
  ) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  const newStatus = parseStatus(row.new_status);
  if (newStatus === 'pending') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return {
    id: row.id,
    previousStatus: parseStatus(row.previous_status),
    newStatus,
    rejectionReason: asNullableString(row.rejection_reason),
    decidedBySnapshot: row.decided_by_snapshot,
    decidedAt: row.decided_at,
  };
};

const parseDecisionResult = (data: unknown): AdminDecisionResult => {
  const row = requireSingleRow(data);
  if (typeof row.user_id !== 'string' || !isValidUuid(row.user_id)) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  if (
    row.audit_id !== null
    && row.audit_id !== undefined
    && (typeof row.audit_id !== 'string' || !isValidUuid(row.audit_id))
  ) {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return {
    userId: row.user_id,
    verificationStatus: parseStatus(row.verification_status),
    isVerified: row.is_verified as boolean | null | undefined ?? null,
    verifiedAt: asNullableString(row.verified_at),
    rejectionReason: asNullableString(row.rejection_reason),
    auditId: asNullableString(row.audit_id),
  };
};

export const isCanonicalDiplomaObjectPath = (value: unknown): value is string => (
  typeof value === 'string' && DIPLOMA_OBJECT_PATH_PATTERN.test(value)
);

export const isDiplomaPathForUser = (userId: string, objectPath: unknown): objectPath is string => (
  isValidUuid(userId)
  && isCanonicalDiplomaObjectPath(objectPath)
  && objectPath === `diplomas/${userId}/diploma.pdf`
);

export const checkCurrentPlatformAdmin = async (): Promise<boolean> => {
  const { data, error } = await supabase.rpc('is_current_user_platform_admin');
  if (error) {
    throw new AdminServiceError('ACCESS_CHECK_FAILED', getAdminErrorMessage({ code: 'ACCESS_CHECK_FAILED' }));
  }
  if (typeof data !== 'boolean') {
    throw new AdminServiceError('INVALID_RESPONSE', getAdminErrorMessage({ code: 'INVALID_RESPONSE' }));
  }
  return data;
};

export const getAdminUserMessage = (error: unknown): string => (
  error instanceof AdminServiceError
    ? error.message
    : getAdminErrorMessage({ code: mapAdminErrorCode(error) })
);

const callAdminRpc = async (rpcName: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) throw toAdminServiceError(error);
  return data;
};

export const fetchAdminSummary = async (): Promise<AdminSummary> => (
  parseSummary(await callAdminRpc('admin_get_verification_summary'))
);

export const fetchDietitianApplications = async ({
  status,
  search,
  limit = ADMIN_PAGE_SIZE,
  offset = 0,
}: {
  status: AdminStatusFilter;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<DietitianApplication[]> => {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const boundedOffset = Math.max(Math.trunc(offset), 0);
  const data = await callAdminRpc('admin_list_dietitian_applications', {
    p_status: status === 'all' ? null : status,
    p_search: search?.trim() || null,
    p_limit: boundedLimit,
    p_offset: boundedOffset,
  });
  return asRows(data).map(parseApplication);
};

export const fetchDietitianApplication = async (userId: string): Promise<DietitianApplicationDetail> => {
  assertValidUuid(userId, 'Diyetisyen kimliği');
  const data = await callAdminRpc('admin_get_dietitian_application', { p_user_id: userId });
  const rows = asRows(data);
  if (rows.length === 0) {
    throw new AdminServiceError('NOT_FOUND', getAdminErrorMessage({ code: 'NOT_FOUND' }));
  }
  return parseDetail(rows[0]);
};

export const fetchDietitianVerificationHistory = async (userId: string): Promise<VerificationHistoryEntry[]> => {
  assertValidUuid(userId, 'Diyetisyen kimliği');
  const data = await callAdminRpc('admin_get_dietitian_verification_history', { p_user_id: userId });
  return asRows(data).map(parseHistoryEntry);
};

const callDecisionRpc = async (rpcName: string, args: Record<string, unknown>): Promise<AdminDecisionResult> => (
  parseDecisionResult(await callAdminRpc(rpcName, args))
);

export const approveDietitian = async (userId: string): Promise<AdminDecisionResult> => {
  assertValidUuid(userId, 'Diyetisyen kimliği');
  return callDecisionRpc('admin_approve_dietitian', { p_user_id: userId });
};

export const rejectDietitian = async (userId: string, reason: string): Promise<AdminDecisionResult> => {
  assertValidUuid(userId, 'Diyetisyen kimliği');
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 1000) {
    throw new AdminServiceError('INVALID_REQUEST', getAdminErrorMessage({ code: 'INVALID_REQUEST' }));
  }
  return callDecisionRpc('admin_reject_dietitian', {
    p_user_id: userId,
    p_reason: normalizedReason,
  });
};

export const createAdminDiplomaSignedUrl = async (userId: string, objectPath: string): Promise<string> => {
  if (!isDiplomaPathForUser(userId, objectPath)) {
    throw new AdminServiceError('INVALID_REQUEST', getAdminErrorMessage({ code: 'INVALID_REQUEST' }));
  }
  const { data, error } = await supabase.storage
    .from(ADMIN_DIPLOMA_BUCKET)
    .createSignedUrl(objectPath, ADMIN_DIPLOMA_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new AdminServiceError('STORAGE_ACCESS_FAILED', getAdminErrorMessage({ code: 'STORAGE_ACCESS_FAILED' }));
  }
  return data.signedUrl;
};

export const ADMIN_COMPLETENESS_LABELS: Record<string, string> = {
  full_name: 'Ad soyad',
  email: 'E-posta',
  phone: 'Telefon',
  university: 'Üniversite',
  graduation_year: 'Mezuniyet yılı',
  experience_years: 'Deneyim',
  specialization: 'Uzmanlık alanı',
  bio: 'Biyografi',
  diploma: 'Diploma',
};

export const completenessStateLabel = (state: 'complete' | 'incomplete'): string => (
  state === 'complete' ? 'Tam Başvuru' : 'Eksik Başvuru'
);
