import type { ChatMessage } from '../types/chat';
import type { ChatImageUploadState } from '../types/chatImageUpload';
import { isSupportedChatImageSourceMimeType } from './canonicalJpegPlan';

/** UI-only decisions for the optional chat-image surface. No browser, React or Supabase API lives here. */

export const CHAT_IMAGE_PICKER_ACCEPT = 'image/jpeg,image/png,image/webp';
export const CHAT_IMAGE_DISABLED_CONVERSATION_MESSAGE =
  'Görsel göndermek için önce bir metin mesajı gönderin.';
export const CHAT_IMAGE_FEATURE_UNAVAILABLE_MESSAGE =
  'Görsel gönderme özelliği henüz kullanıma açık değil.';
export const CHAT_IMAGE_PLACEHOLDER_LABEL = 'Görsel';
export const CHAT_IMAGE_MISSING_ATTACHMENT_LABEL = 'Görsel kullanılamıyor';

const MAX_CAPTION_LENGTH = 4000;

export interface ChatImagePickerUiState {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly disabledMessage: string | null;
  readonly accept: typeof CHAT_IMAGE_PICKER_ACCEPT;
}

export const getChatImagePickerUiState = (
  featureEnabled: boolean,
  conversationId: string | null | undefined,
  composerDisabled: boolean,
): ChatImagePickerUiState => {
  if (!featureEnabled) {
    return { visible: false, enabled: false, disabledMessage: null, accept: CHAT_IMAGE_PICKER_ACCEPT };
  }
  if (!conversationId) {
    return {
      visible: true,
      enabled: false,
      disabledMessage: CHAT_IMAGE_DISABLED_CONVERSATION_MESSAGE,
      accept: CHAT_IMAGE_PICKER_ACCEPT,
    };
  }
  return {
    visible: true,
    enabled: !composerDisabled,
    disabledMessage: null,
    accept: CHAT_IMAGE_PICKER_ACCEPT,
  };
};

export const isChatImagePickerFileAccepted = (mimeType: unknown): boolean => (
  isSupportedChatImageSourceMimeType(mimeType)
);

export const normalizeChatImageUiCaption = (caption: string): string | null => {
  const trimmed = caption.trim();
  if (!trimmed) return null;
  if (Array.from(trimmed).length > MAX_CAPTION_LENGTH) return null;
  return trimmed;
};

export const isChatImageUiCaptionValid = (caption: string): boolean => (
  Array.from(caption.trim()).length <= MAX_CAPTION_LENGTH
);

export const isChatImageUploadInFlight = (state: ChatImageUploadState): boolean => (
  state.status === 'canonicalizing'
  || state.status === 'creating-intent'
  || state.status === 'uploading'
  || state.status === 'validating'
  || state.status === 'finalizing'
);

export const hasChatImageSelection = (state: ChatImageUploadState): boolean => (
  state.source !== null && state.status !== 'idle' && state.status !== 'cancelled'
);

export const canSendChatComposer = (
  draft: string,
  textSending: boolean,
  composerDisabled: boolean,
  imageState: ChatImageUploadState | null,
): boolean => {
  if (composerDisabled || textSending) return false;
  if (!imageState || !hasChatImageSelection(imageState)) return Boolean(draft.trim());
  return imageState.status === 'selected' && isChatImageUiCaptionValid(draft);
};

export const getChatImageUploadStatusLabel = (state: ChatImageUploadState): string | null => {
  switch (state.status) {
    case 'canonicalizing':
      return 'Görsel hazırlanıyor';
    case 'creating-intent':
      return 'Gönderim hazırlanıyor';
    case 'uploading':
      return 'Görsel yükleniyor';
    case 'validating':
      return 'Görsel doğrulanıyor';
    case 'finalizing':
      return 'Mesaj tamamlanıyor';
    default:
      return null;
  }
};

export const getChatImageUploadErrorMessage = (state: ChatImageUploadState): string | null => {
  if (!state.error) return null;
  return state.error.code === 'feature_unavailable'
    ? CHAT_IMAGE_FEATURE_UNAVAILABLE_MESSAGE
    : state.error.userMessage;
};

export const shouldShowChatImageRetry = (state: ChatImageUploadState): boolean => (
  state.status === 'failed'
  && state.error?.retryable === true
  && state.error.code !== 'feature_unavailable'
  && state.retryStage !== null
);

export const getChatImageBubbleLabel = (
  message: Pick<ChatMessage, 'body' | 'attachment'>,
): string => {
  if (!message.attachment) return CHAT_IMAGE_MISSING_ATTACHMENT_LABEL;
  return normalizeChatImageUiCaption(message.body ?? '') ?? CHAT_IMAGE_PLACEHOLDER_LABEL;
};

export const shouldClearChatImageComposerAfterSuccess = (state: ChatImageUploadState): boolean => (
  state.status === 'succeeded'
  && state.source === null
  && state.previewUrl === null
  && state.canonical === null
  && state.intent === null
);
