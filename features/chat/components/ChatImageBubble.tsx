import React from 'react';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { CHAT_IMAGE_PLACEHOLDER_LABEL, getChatImageBubbleLabel } from '../utils/chatImageUiState';

interface ChatImageBubbleProps {
  message: ChatMessage;
  imageUrl?: string | null;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  onOpen?: () => void;
}

/**
 * Receives only a signed URL and opaque read state; object metadata never
 * reaches the renderer or user-visible text.
 */
const ChatImageBubble: React.FC<ChatImageBubbleProps> = ({ message, imageUrl = null, loading = false, failed = false, onRetry, onOpen }) => {
  const hasAttachment = message.attachment !== null;
  const contentLabel = getChatImageBubbleLabel(message);
  const placeholderLabel = hasAttachment ? CHAT_IMAGE_PLACEHOLDER_LABEL : contentLabel;

  return (
    <div className="space-y-2">
      {imageUrl && hasAttachment ? (
        <button type="button" onClick={onOpen} className="block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current" aria-label={`${contentLabel} görselini büyüt`}>
          <img src={imageUrl} alt={contentLabel} className="aspect-[4/3] max-h-80 w-full object-cover" />
        </button>
      ) : (
        <div className={`flex aspect-[4/3] min-h-36 w-full items-center justify-center rounded-xl border border-current/15 bg-black/10 p-4 text-center ${loading ? 'animate-pulse' : ''}`} aria-live="polite">
          <div className="flex flex-col items-center gap-2 opacity-85">
            <ImageIcon className="h-8 w-8" aria-hidden="true" />
            <span className="text-sm font-medium">{loading ? 'Görsel yükleniyor' : failed ? 'Görsel kullanılamıyor' : placeholderLabel}</span>
            {failed && onRetry && <button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/30 px-3 text-sm font-semibold hover:bg-black/10"><RefreshCw className="h-4 w-4" aria-hidden="true" />Tekrar dene</button>}
          </div>
        </div>
      )}
      {hasAttachment && message.body && <p className="break-words whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>}
    </div>
  );
};

export default ChatImageBubble;
