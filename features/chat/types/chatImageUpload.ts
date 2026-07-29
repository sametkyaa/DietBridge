import type { ChatImageDimensions } from '../utils/canonicalJpegPlan';

/**
 * Error and lifecycle contract for the canonical JPEG upload flow.
 *
 * Every failure surfaced to the UI is one of these categories, with a Turkish
 * user message and an explicit retryability decision. Raw Supabase/Postgres
 * error objects never reach the UI.
 */
export type ChatImageErrorCode =
  | 'unsupported_type'
  | 'decode_failed'
  | 'invalid_dimensions'
  | 'output_too_large'
  | 'invalid_request'
  | 'access_denied'
  | 'quota_exceeded'
  | 'intent_expired'
  | 'validation_pending'
  | 'feature_unavailable'
  | 'storage_upload_failed'
  | 'invalid_response'
  | 'aborted'
  | 'unknown';

export class ChatImageError extends Error {
  constructor(
    public readonly code: ChatImageErrorCode,
    public readonly userMessage: string,
    public readonly retryable: boolean = false,
    public readonly originalError?: unknown,
  ) {
    super(userMessage);
    this.name = 'ChatImageError';
  }
}

export const CHAT_IMAGE_ERROR_MESSAGES: Readonly<Record<ChatImageErrorCode, string>> = {
  unsupported_type: 'Yalnızca JPEG, PNG veya WebP görseller gönderilebilir.',
  decode_failed: 'Görsel okunamadı. Lütfen başka bir dosya deneyin.',
  invalid_dimensions: 'Görsel boyutları geçersiz. Lütfen başka bir dosya deneyin.',
  output_too_large: 'Görsel çok büyük. Lütfen daha küçük bir görsel seçin.',
  invalid_request: 'Görsel bilgisi geçersiz. Lütfen tekrar deneyin.',
  access_denied: 'Bu sohbete görsel gönderme izniniz yok.',
  quota_exceeded: 'Çok fazla bekleyen görsel var. Lütfen biraz sonra tekrar deneyin.',
  intent_expired: 'Görsel gönderim süresi doldu. Lütfen görseli yeniden seçin.',
  validation_pending: 'Görsel doğrulaması tamamlanamadı. Lütfen daha sonra tekrar deneyin.',
  feature_unavailable: 'Görsel gönderimi şu anda kullanılamıyor.',
  storage_upload_failed: 'Görsel yüklenemedi. Lütfen tekrar deneyin.',
  invalid_response: 'Görsel işlemi beklenmeyen bir yanıt döndürdü. Lütfen tekrar deneyin.',
  aborted: 'Görsel gönderimi iptal edildi.',
  unknown: 'Görsel işlemi şu anda tamamlanamadı. Lütfen tekrar deneyin.',
};

export const createChatImageError = (
  code: ChatImageErrorCode,
  options?: { retryable?: boolean; cause?: unknown },
): ChatImageError => new ChatImageError(
  code,
  CHAT_IMAGE_ERROR_MESSAGES[code],
  options?.retryable ?? false,
  options?.cause,
);

/** Canonical JPEG produced by the browser before any intent is created. */
export interface CanonicalChatImage extends ChatImageDimensions {
  readonly blob: Blob;
  readonly byteSize: number;
  readonly quality: number;
  readonly mimeType: 'image/jpeg';
}

/** Server-owned upload intent. The client never invents bucket or path. */
export interface ChatImageUploadIntent {
  readonly id: string;
  readonly conversationId: string;
  readonly createdBy: string;
  readonly clientMessageId: string;
  readonly bucketId: string;
  readonly objectPath: string;
  readonly expectedMime: 'image/jpeg';
  readonly maxBytes: number;
  readonly status: 'pending';
  readonly expiresAt: string;
}

export interface ChatImageSourceSummary {
  readonly name: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export type ChatImageUploadStage =
  | 'canonicalizing'
  | 'creating-intent'
  | 'uploading'
  | 'finalizing';

export type ChatImageUploadStatus =
  | 'idle'
  /** A local file and object URL exist, but no network request has started. */
  | 'selected'
  | ChatImageUploadStage
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ChatImageUploadFailure {
  readonly code: ChatImageErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
}

export interface ChatImageUploadState {
  readonly status: ChatImageUploadStatus;
  /** Monotonic id: results from an older operation are always discarded. */
  readonly operationId: number;
  readonly conversationId: string | null;
  readonly clientMessageId: string | null;
  readonly source: ChatImageSourceSummary | null;
  /** Object URL owned by this state; the owner must revoke it. */
  readonly previewUrl: string | null;
  readonly canonical: CanonicalChatImage | null;
  readonly intent: ChatImageUploadIntent | null;
  /** Only set when the transport actually reports progress. */
  readonly progress: number | null;
  readonly error: ChatImageUploadFailure | null;
  readonly retryStage: ChatImageUploadStage | null;
}

export const toChatImageUploadFailure = (error: unknown): ChatImageUploadFailure => {
  if (error instanceof ChatImageError) {
    return { code: error.code, userMessage: error.userMessage, retryable: error.retryable };
  }
  return {
    code: 'unknown',
    userMessage: CHAT_IMAGE_ERROR_MESSAGES.unknown,
    retryable: true,
  };
};
