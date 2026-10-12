import { useCallback, useEffect, useRef, useState } from 'react';
import { abortChatMedia, getChatMediaEnabled, sendChatMedia, type ChatMediaOperation } from '../services/chatMediaService';
import { normalizeChatMediaFile, type ChatMediaDescriptor } from '../utils/chatMediaPolicy';

export const useChatMediaUpload = ({ conversationId, onFinalized }: { conversationId: string | null; onFinalized: (result: { messageId: string; conversationId: string }) => void | Promise<void> }) => {
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<{ file: File; descriptor: ChatMediaDescriptor } | null>(null);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<ChatMediaOperation>({});
  const generation = useRef(0);
  const busy = useRef(false);
  const reset = useCallback(() => {
    generation.current += 1; busy.current = false;
    void abortChatMedia(operation.current).catch(() => { /* Expiry cleanup remains the server fallback. */ });
    operation.current = {}; setSelection(null); setError(null); setStage('');
  }, []);
  useEffect(() => { let active = true; void getChatMediaEnabled().then((value) => { if (active) setEnabled(value); }).catch(() => { if (active) setEnabled(false); }); return () => { active = false; }; }, [conversationId]);
  useEffect(() => { reset(); return () => { generation.current += 1; void abortChatMedia(operation.current).catch(() => {}); }; }, [conversationId, reset]);
  const select = (file: File) => {
    if (!enabled || busy.current) return;
    reset();
    try { setSelection({ file, descriptor: normalizeChatMediaFile({ name: file.name, mimeType: file.type, byteSize: file.size }) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Dosya seçilemedi.'); }
  };
  const send = async (caption: string): Promise<boolean> => {
    if (!selection || !conversationId || busy.current) return false;
    busy.current = true; setError(null);
    const token = generation.current;
    const context = operation.current;
    const current = () => token === generation.current;
    try {
      const result = await sendChatMedia({ conversationId, clientMessageId: context.clientMessageId ??= crypto.randomUUID(), descriptor: selection.descriptor, body: selection.file, caption,
        operation: context, isCurrent: current, onStage: (value) => { if (current()) setStage(value); } });
      if (!result || !current()) return false;
      await onFinalized(result);
      if (!current()) return false;
      reset();
      return true;
    } catch (failure) { if (current()) { setError(failure instanceof Error ? failure.message : 'Dosya gönderilemedi.'); setStage(''); } return false; }
    finally { if (current()) busy.current = false; }
  };
  return { enabled, selection, stage, error, select, send, reset, isBusy: Boolean(stage) };
};
export type ChatMediaUploadController = ReturnType<typeof useChatMediaUpload>;
