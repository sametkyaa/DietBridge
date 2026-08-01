import React, { FormEvent, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

interface ChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  error: string | null;
  disabled: boolean;
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
}) => {
  const canSend = !disabled && !isSending && draft.trim().length > 0;
  const characterCount = Array.from(draft).length;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-100 bg-white p-3 sm:p-4">
      <label className="sr-only" htmlFor="chat-message-draft">Mesajınız</label>
      <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        <textarea
          id="chat-message-draft"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Mesajınızı yazın"
          disabled={disabled || isSending}
          maxLength={MAX_MESSAGE_BODY_LENGTH}
          rows={2}
          className="min-h-11 max-h-32 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={isSending ? 'Mesaj gönderiliyor' : 'Mesaj gönder'}
        >
          <Send className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs">
        <div aria-live="polite" className="text-rose-700">{error}</div>
        {characterCount >= CHARACTER_COUNTER_THRESHOLD && (
          <span className="shrink-0 text-slate-400">{characterCount}/{MAX_MESSAGE_BODY_LENGTH}</span>
        )}
      </div>
    </form>
  );
};

export default ChatComposer;
