import type { CanonicalChatImage, ChatImageUploadIntent } from '../types/chatImageUpload';

/**
 * Resources owned by exactly one upload operation.
 *
 * The hook deliberately keeps this object on the operation rather than in a
 * shared ref. A stale promise can therefore only release its own intent,
 * canonical blob and preview URL; it has no handle to a newer operation.
 */
export interface ChatImageOperationResources {
  canonical: CanonicalChatImage | null;
  intent: ChatImageUploadIntent | null;
  previewUrl: string | null;
  intentReleased: boolean;
  finalized: boolean;
}

/** Takes ownership of the preview URL for one cleanup call. */
export const takeChatImagePreviewUrl = (
  resources: ChatImageOperationResources,
): string | null => {
  const previewUrl = resources.previewUrl;
  resources.previewUrl = null;
  return previewUrl;
};

/** Takes ownership of this operation's intent for one best-effort abort. */
export const takeChatImageIntentForAbort = (
  resources: ChatImageOperationResources,
): string | null => {
  if (resources.finalized || resources.intentReleased || !resources.intent) return null;
  const intentId = resources.intent.id;
  resources.intentReleased = true;
  resources.intent = null;
  return intentId;
};

export const clearChatImageCanonical = (
  resources: ChatImageOperationResources,
): void => {
  resources.canonical = null;
};

/** Marks a finalized operation terminal before any later cleanup can run. */
export const finalizeChatImageResources = (
  resources: ChatImageOperationResources,
): void => {
  resources.finalized = true;
  resources.intentReleased = true;
  resources.intent = null;
  resources.canonical = null;
};
