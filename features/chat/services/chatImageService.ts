import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  CHAT_IMAGE_BUCKET_ID,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MIME_TYPE,
  CHAT_IMAGE_OBJECT_PATH_PATTERN,
} from '../types/chatImage';
import {
  CanonicalChatImage,
  ChatImageError,
  ChatImageErrorCode,
  ChatImageUploadIntent,
  createChatImageError,
} from '../types/chatImageUpload';

/**
 * Supabase access for the canonical JPEG chat image flow.
 *
 * Every RPC and Storage call for image messaging lives here: the hook, the
 * reducer and (later) the composer never touch Supabase directly. The client
 * never chooses a bucket or object path — it only replays what the server
 * returned, after validating it fail-closed.
 *
 * The image RPCs are dormant on purpose: `20260729090200_chat_image_rpc.sql`
 * revokes execute from `authenticated`, so a permission error is the expected
 * production state today and is surfaced as `feature_unavailable`.
 */

const MAX_CAPTION_LENGTH = 4000;

type UnknownRecord = Record<string, unknown>;

export interface CreateChatImageUploadIntentInput {
  conversationId: string;
  clientMessageId: string;
}

export interface ChatImageFinalizeResult {
  messageId: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
}

const asRecord = (value: unknown): UnknownRecord | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
);

const firstRecord = (value: unknown): UnknownRecord | null => (
  Array.isArray(value) ? asRecord(value[0]) : asRecord(value)
);

const getString = (record: UnknownRecord, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' ? value : null;
};

const getErrorText = (error: unknown): string => {
  const record = asRecord(error);
  if (!record) return '';
  return [record.message, record.details, record.hint, record.error]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
};

const getErrorCode = (error: unknown): string | null => {
  const record = asRecord(error);
  const code = record?.code;
  return typeof code === 'string' ? code : null;
};

const getErrorStatus = (error: unknown): number | null => {
  const record = asRecord(error);
  const status = record?.status ?? record?.statusCode;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d+$/.test(status)) return Number(status);
  return null;
};

const RETRYABLE_CODES: ReadonlySet<ChatImageErrorCode> = new Set<ChatImageErrorCode>([
  'storage_upload_failed',
  'validation_failed',
  'internal_error',
  'unknown',
]);

const VALIDATOR_ERROR_CODES: ReadonlySet<ChatImageErrorCode> = new Set<ChatImageErrorCode>([
  'unauthorized', 'invalid_request', 'not_found', 'intent_not_pending',
  'intent_expired', 'object_not_found', 'invalid_image', 'image_too_large',
  'image_dimensions_exceeded', 'validation_failed', 'internal_error',
]);

/**
 * Maps a Supabase/PostgREST failure onto the narrow client error contract.
 * The raw error is kept only as `cause`; it is never shown to the user.
 */
export const mapChatImageError = (
  error: unknown,
  fallback: ChatImageErrorCode = 'unknown',
): ChatImageError => {
  if (error instanceof ChatImageError) return error;

  const code = getErrorCode(error);
  const status = getErrorStatus(error);
  const text = getErrorText(error);

  const resolve = (): ChatImageErrorCode => {
    // Dormant grants: PostgREST reports either a missing function in the schema
    // cache or a plain execute-permission denial on the function itself.
    if (code === 'PGRST202' || text.includes('permission denied for function')) {
      return 'feature_unavailable';
    }
    if (code === '54000' || text.includes('quota exceeded')) return 'quota_exceeded';
    if (text.includes('unsupported chat image type')) return 'unsupported_type';
    if (text.includes('cannot be finalized') || text.includes('does not match validation')) {
      return 'validation_pending';
    }
    if (text.includes('expired')) return 'intent_expired';
    if (code === '42501' || status === 403) return 'access_denied';
    if (status === 401) return 'access_denied';
    if (code === '22023' || code === '23514' || code === '22P02') return 'invalid_request';
    if (status === 413 || text.includes('maximum allowed size')) return 'output_too_large';
    if (text.includes('network') || text.includes('failed to fetch')) return 'unknown';
    return fallback;
  };

  const resolved = resolve();
  return createChatImageError(resolved, {
    retryable: RETRYABLE_CODES.has(resolved),
    cause: error,
  });
};

const isFutureTimestamp = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
};

/**
 * Fail-closed validation of the server-owned intent. A response that does not
 * match the canonical contract is never used to build an upload target.
 */
const normalizeUploadIntent = (
  value: unknown,
  expected: CreateChatImageUploadIntentInput,
): ChatImageUploadIntent => {
  const row = firstRecord(value);
  if (!row) throw createChatImageError('invalid_response');

  const id = getString(row, 'id');
  const conversationId = getString(row, 'conversation_id');
  const createdBy = getString(row, 'created_by');
  const clientMessageId = getString(row, 'client_message_id');
  const bucketId = getString(row, 'bucket_id');
  const objectPath = getString(row, 'object_path');
  const expectedMime = getString(row, 'expected_mime');
  const maxBytes = row.max_bytes;
  const status = getString(row, 'status');
  const expiresAt = getString(row, 'expires_at');

  if (
    !isValidUuid(id)
    || !isValidUuid(conversationId)
    || conversationId !== expected.conversationId
    || !isValidUuid(createdBy)
    || !isValidUuid(clientMessageId)
    || clientMessageId !== expected.clientMessageId
    || bucketId !== CHAT_IMAGE_BUCKET_ID
    || !objectPath
    || !CHAT_IMAGE_OBJECT_PATH_PATTERN.test(objectPath)
    || expectedMime !== CHAT_IMAGE_MIME_TYPE
    || maxBytes !== CHAT_IMAGE_MAX_BYTES
    || status !== 'pending'
    || !expiresAt
  ) {
    throw createChatImageError('invalid_response');
  }

  if (!isFutureTimestamp(expiresAt)) throw createChatImageError('intent_expired');

  return {
    id,
    conversationId,
    createdBy,
    clientMessageId,
    bucketId,
    objectPath,
    expectedMime: CHAT_IMAGE_MIME_TYPE,
    maxBytes: CHAT_IMAGE_MAX_BYTES,
    status: 'pending',
    expiresAt,
  };
};

export const createChatImageUploadIntent = async (
  input: CreateChatImageUploadIntentInput,
): Promise<ChatImageUploadIntent> => {
  if (!isValidUuid(input.conversationId) || !isValidUuid(input.clientMessageId)) {
    throw createChatImageError('invalid_request');
  }

  try {
    const { data, error } = await supabase.rpc('create_chat_image_upload_intent', {
      p_conversation_id: input.conversationId,
      p_client_message_id: input.clientMessageId,
      p_expected_mime: CHAT_IMAGE_MIME_TYPE,
    });
    if (error) throw mapChatImageError(error, 'access_denied');
    return normalizeUploadIntent(data, input);
  } catch (error) {
    throw mapChatImageError(error, 'access_denied');
  }
};

/**
 * Uploads the canonical JPEG to the exact bucket/path the server issued.
 * `upsert: false` keeps a pending object immutable; a free-form path from the
 * UI is never accepted.
 */
export const uploadCanonicalChatImage = async (
  intent: ChatImageUploadIntent,
  canonical: CanonicalChatImage,
): Promise<void> => {
  if (
    intent.bucketId !== CHAT_IMAGE_BUCKET_ID
    || !CHAT_IMAGE_OBJECT_PATH_PATTERN.test(intent.objectPath)
  ) {
    throw createChatImageError('invalid_response');
  }
  if (!isFutureTimestamp(intent.expiresAt)) throw createChatImageError('intent_expired');
  if (canonical.mimeType !== CHAT_IMAGE_MIME_TYPE || canonical.blob.type !== CHAT_IMAGE_MIME_TYPE) {
    throw createChatImageError('unsupported_type');
  }

  const byteSize = canonical.blob.size;
  if (
    !Number.isSafeInteger(byteSize)
    || byteSize < 1
    || byteSize > intent.maxBytes
    || byteSize !== canonical.byteSize
  ) {
    throw createChatImageError('output_too_large');
  }

  try {
    const { error } = await supabase.storage
      .from(intent.bucketId)
      .upload(intent.objectPath, canonical.blob, {
        contentType: CHAT_IMAGE_MIME_TYPE,
        upsert: false,
      });
    if (error) throw mapChatImageError(error, 'storage_upload_failed');
  } catch (error) {
    throw mapChatImageError(error, 'storage_upload_failed');
  }
};

export const normalizeChatImageCaption = (caption: string | null | undefined): string | null => {
  if (caption === null || caption === undefined) return null;
  if (typeof caption !== 'string') throw createChatImageError('invalid_request');

  const trimmed = caption.trim();
  if (!trimmed) return null;
  if (Array.from(trimmed).length > MAX_CAPTION_LENGTH) {
    throw createChatImageError('invalid_request');
  }
  return trimmed;
};

const getValidatorErrorCode = async (error: unknown): Promise<ChatImageErrorCode | null> => {
  const record = asRecord(error);
  const context = record?.context;
  if (!context || typeof context !== 'object' || !('json' in context)) return null;
  const json = (context as { json?: unknown }).json;
  if (typeof json !== 'function') return null;
  try {
    const payload = await (json as () => Promise<unknown>)();
    const code = asRecord(payload)?.code;
    return typeof code === 'string' && VALIDATOR_ERROR_CODES.has(code as ChatImageErrorCode)
      ? code as ChatImageErrorCode
      : null;
  } catch {
    return null;
  }
};

/** Invokes the bounded JPEG validator between Storage upload and finalization. */
export const validateChatImageUpload = async (intentId: string): Promise<void> => {
  if (!isValidUuid(intentId)) throw createChatImageError('invalid_request');
  try {
    const { error } = await supabase.functions.invoke('validate-chat-image', { body: { intentId } });
    if (!error) return;
    const code = await getValidatorErrorCode(error);
    throw createChatImageError(code ?? 'internal_error', {
      retryable: code === 'validation_failed' || code === 'internal_error',
      cause: error,
    });
  } catch (error) {
    if (error instanceof ChatImageError) throw error;
    throw mapChatImageError(error, 'internal_error');
  }
};

export const finalizeChatImageMessage = async (
  intentId: string,
  caption: string | null,
): Promise<ChatImageFinalizeResult> => {
  if (!isValidUuid(intentId)) throw createChatImageError('invalid_request');
  const normalizedCaption = normalizeChatImageCaption(caption);

  try {
    const { data, error } = await supabase.rpc('finalize_chat_image_message', {
      p_intent_id: intentId,
      p_caption: normalizedCaption,
    });
    if (error) throw mapChatImageError(error, 'validation_pending');

    const row = firstRecord(data);
    if (!row) throw createChatImageError('invalid_response');

    const messageId = getString(row, 'id');
    const conversationId = getString(row, 'conversation_id');
    const senderId = getString(row, 'sender_id');
    const clientMessageId = getString(row, 'client_message_id');
    const messageKind = getString(row, 'message_kind');

    if (
      !isValidUuid(messageId)
      || !isValidUuid(conversationId)
      || !isValidUuid(senderId)
      || !isValidUuid(clientMessageId)
      || messageKind !== 'image'
    ) {
      throw createChatImageError('invalid_response');
    }

    return { messageId, conversationId, senderId, clientMessageId };
  } catch (error) {
    throw mapChatImageError(error, 'validation_pending');
  }
};

export const abortChatImageUpload = async (intentId: string): Promise<void> => {
  if (!isValidUuid(intentId)) throw createChatImageError('invalid_request');

  try {
    const { error } = await supabase.rpc('abort_chat_image_upload', { p_intent_id: intentId });
    if (error) throw mapChatImageError(error, 'unknown');
  } catch (error) {
    throw mapChatImageError(error, 'unknown');
  }
};

/**
 * Best-effort abort used on the failure/cancel paths. It never throws: the
 * original upload error must stay visible, and the expiry-driven cleanup queue
 * remains the safety net when the abort itself fails.
 */
export const abortChatImageUploadQuietly = async (intentId: string): Promise<boolean> => {
  try {
    await abortChatImageUpload(intentId);
    return true;
  } catch {
    return false;
  }
};
