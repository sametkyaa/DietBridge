import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { CHAT_IMAGE_PLACEHOLDER_LABEL, getChatImageBubbleLabel } from '../utils/chatImageUiState';

interface ChatImageBubbleProps {
  message: ChatMessage;
  /** Reserved for the later signed-URL read path. Undefined means no network request. */
  imageUrl?: string | null;
}

/**
 * Safe image-message presentation for the dormant private Storage contract.
 * It intentionally receives no object path and does not create signed URLs.
 */
const ChatImageBubble: React.FC<ChatImageBubbleProps> = ({ message, imageUrl = null }) => {
  const hasAttachment = message.attachment !== null;
  const contentLabel = getChatImageBubbleLabel(message);
  const placeholderLabel = hasAttachment ? CHAT_IMAGE_PLACEHOLDER_LABEL : contentLabel;

  return (
    <div className="space-y-2">
      {imageUrl && hasAttachment ? (
        <img
          src={imageUrl}
          alt={contentLabel}
          className="max-h-80 w-full rounded-xl object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] min-h-36 w-full items-center justify-center rounded-xl border border-current/15 bg-black/10 p-4 text-center">
          <div className="flex flex-col items-center gap-2 opacity-85">
            <ImageIcon className="h-8 w-8" aria-hidden="true" />
            <span className="text-sm font-medium">{placeholderLabel}</span>
          </div>
        </div>
      )}
      {hasAttachment && message.body && <p className="break-words whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>}
    </div>
  );
};

export default ChatImageBubble;
