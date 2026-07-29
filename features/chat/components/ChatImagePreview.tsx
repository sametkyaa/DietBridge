import React from 'react';
import { X } from 'lucide-react';

interface ChatImagePreviewProps {
  previewUrl: string | null;
  onRemove: () => void;
  disabled?: boolean;
  removeLabel?: string;
}

/** Renders only the object URL owned by useChatImageUpload; it never reads Storage. */
const ChatImagePreview: React.FC<ChatImagePreviewProps> = ({
  previewUrl,
  onRemove,
  disabled = false,
  removeLabel = 'Görseli kaldır',
}) => {
  if (!previewUrl) return null;

  return (
    <div className="relative mb-3 w-fit overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1">
      <img
        src={previewUrl}
        alt="Seçilen görsel önizlemesi"
        className="h-28 w-28 rounded-lg object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={removeLabel}
        className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/75 text-white hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export default ChatImagePreview;
