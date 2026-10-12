import React, { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import type { ChatImageUploadController } from '../hooks/useChatImageUpload';
import type { ChatMediaUploadController } from '../hooks/useChatMediaUpload';
import { CHAT_MEDIA_TYPES } from '../utils/chatMediaPolicy';
import ChatImagePreview from './ChatImagePreview';
import ChatImageUploadStatus from './ChatImageUploadStatus';
import {
  canSendChatComposer,
  getChatImagePickerUiState,
  hasChatImageSelection,
  isChatImageUploadInFlight,
  shouldClearChatImageComposerAfterSuccess,
} from '../utils/chatImageUiState';

interface ChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  error: string | null;
  disabled: boolean;
  conversationId: string | null;
  imageUpload: ChatImageUploadController;
  mediaUpload: ChatMediaUploadController;
}

const MAX_MESSAGE_BODY_LENGTH = 4000;
const CHARACTER_COUNTER_THRESHOLD = 3500;

const ChatComposer: React.FC<ChatComposerProps> = ({
  draft,
  onDraftChange,
  onSend,
  isSending,
  error,
  disabled,
  conversationId,
  imageUpload,
  mediaUpload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const imageState = imageUpload.state;
  const imageSelected = hasChatImageSelection(imageState);
  const imageUploadInFlight = isChatImageUploadInFlight(imageState);
  const picker = getChatImagePickerUiState(
    imageUpload.isEnabled,
    conversationId,
    disabled || isSending || imageUploadInFlight || Boolean(mediaUpload.selection) || mediaUpload.isBusy,
  );
  const canSend = mediaUpload.selection
    ? !disabled && !isSending && !mediaUpload.isBusy && Array.from(draft).length <= MAX_MESSAGE_BODY_LENGTH
    : canSendChatComposer(draft, isSending, disabled || mediaUpload.isBusy, imageState);
  const characterCount = Array.from(draft).length;
  const textareaPlaceholder = imageSelected
    ? 'Görsele açıklama ekleyin (isteğe bağlı)'
    : 'Mesajınızı yazın';

  useEffect(() => {
    if (!shouldClearChatImageComposerAfterSuccess(imageState)) return;
    onDraftChange('');
    imageUpload.reset();
  }, [imageState, imageUpload, onDraftChange]);

  const submit = (): void => {
    if (!canSend) return;
    if (mediaUpload.selection) {
      void mediaUpload.send(draft).then((success) => { if (success) onDraftChange(''); });
      return;
    }
    if (imageSelected) {
      void imageUpload.startUpload(draft);
      return;
    }
    onSend();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    // Reset immediately so selecting the exact same file opens a new local
    // selection. `selectImage` itself performs the MIME fail-closed check.
    event.currentTarget.value = '';
    if (!file) return;
    setSelectionError(null);
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      if (file.size > 20 * 1048576) { setSelectionError('Seçilen görsel en fazla 20 MB olabilir.'); return; }
      imageUpload.selectImage(file);
    } else mediaUpload.select(file);
  };

  const handlePickerClick = () => {
    if (!picker.enabled || imageSelected) return;
    fileInputRef.current?.click();
  };

  return (
    <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-100 bg-white p-3 sm:p-4">
      {selectionError && <p role="alert" className="mb-2 text-sm text-red-600">{selectionError}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept={[picker.accept, ...(mediaUpload.enabled ? Object.keys(CHAT_MEDIA_TYPES) : [])].join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleImageSelection}
      />
      <ChatImagePreview
        previewUrl={imageState.previewUrl}
        onRemove={imageUpload.cancel}
        disabled={false}
        removeLabel={imageUploadInFlight ? 'Görsel gönderimini iptal et' : 'Görseli kaldır'}
      />
      <ChatImageUploadStatus state={imageState} onRetry={() => void imageUpload.retry()} />
      {mediaUpload.selection && <div className="mb-2 rounded-lg bg-slate-50 p-3 text-sm">
        <p className="break-all">{mediaUpload.selection.descriptor.fileName}</p>
        <p className="text-xs text-slate-500">{mediaUpload.stage || `${(mediaUpload.selection.descriptor.byteSize / 1048576).toFixed(1)} MB`}</p>
        <button type="button" onClick={mediaUpload.reset} className="mt-1 min-h-9 text-rose-700">{mediaUpload.isBusy ? 'İptal et' : 'Kaldır'}</button>
      </div>}
      {picker.disabledMessage && <p className="mb-2 text-xs text-slate-500">{picker.disabledMessage}</p>}
      <label className="sr-only" htmlFor="chat-message-draft">Mesajınız</label>
      <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        {picker.visible && (
          <button
            type="button"
            onClick={handlePickerClick}
            disabled={!picker.enabled || imageSelected}
            aria-label={mediaUpload.enabled ? 'Görsel, video veya dosya seç' : 'Görsel seç'}
            title={picker.disabledMessage ?? undefined}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <textarea
          id="chat-message-draft"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={textareaPlaceholder}
          disabled={disabled || isSending || imageUploadInFlight || mediaUpload.isBusy}
          maxLength={MAX_MESSAGE_BODY_LENGTH}
          rows={2}
          className="min-h-11 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={isSending || imageUploadInFlight || mediaUpload.isBusy ? 'Mesaj gönderiliyor' : 'Mesaj gönder'}
        >
          <Send className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs">
        <div role="alert" aria-live="polite" className="text-rose-700">{error || mediaUpload.error}</div>
        {characterCount >= CHARACTER_COUNTER_THRESHOLD && (
          <span className="shrink-0 text-slate-400">{characterCount}/{MAX_MESSAGE_BODY_LENGTH}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{mediaUpload.enabled
        ? 'Görsel: sıkıştırılmış 4 MB · Video: 20 MB · Belge: 10 MB. Tek seferde bir dosya.'
        : 'Görsel: sıkıştırılmış 4 MB. Tek seferde bir görsel.'}</p>
    </form>
  );
};

export default ChatComposer;
