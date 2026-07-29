import React from 'react';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import type { ChatImageUploadState } from '../types/chatImageUpload';
import {
  getChatImageUploadErrorMessage,
  getChatImageUploadStatusLabel,
  isChatImageUploadInFlight,
  shouldShowChatImageRetry,
} from '../utils/chatImageUiState';

interface ChatImageUploadStatusProps {
  state: ChatImageUploadState;
  onRetry: () => void;
}

/** Text-only upload feedback. Progress stays indeterminate because Storage exposes no reliable byte progress here. */
const ChatImageUploadStatus: React.FC<ChatImageUploadStatusProps> = ({ state, onRetry }) => {
  const statusLabel = getChatImageUploadStatusLabel(state);
  const errorMessage = getChatImageUploadErrorMessage(state);
  const retryVisible = shouldShowChatImageRetry(state);

  if (!statusLabel && !errorMessage) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
      {statusLabel && (
        <span className="inline-flex items-center gap-2 text-slate-600" role="status">
          {isChatImageUploadInFlight(state) && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {statusLabel}
        </span>
      )}
      {errorMessage && <span className="text-rose-700" role="alert">{errorMessage}</span>}
      {retryVisible && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Tekrar dene
        </button>
      )}
    </div>
  );
};

export default ChatImageUploadStatus;
