import React, { useEffect, useRef, useState } from 'react';
import { FileText, Play } from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { getChatMediaUrl } from '../services/chatMediaService';
import { subscribeToHealthDataRefresh } from '../../../shared/utils/healthDataRefresh';

const ChatMediaBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setUrl(null); return () => { generation.current += 1; }; }, [message.id, message.deletedAt]);
  useEffect(() => {
    const invalidate = () => { generation.current += 1; setUrl(null); setBusy(false); };
    return subscribeToHealthDataRefresh(invalidate, invalidate);
  }, []);
  const open = async () => {
    if (busy) return;
    const token = generation.current;
    setBusy(true); setError(null);
    try {
      const next = await getChatMediaUrl(message);
      if (token !== generation.current) return;
      if (message.messageKind === 'video') setUrl(next);
      else { const link = document.createElement('a'); link.href = next; link.download = message.attachment?.fileName ?? ''; link.rel = 'noopener noreferrer'; link.click(); }
    } catch (failure) { if (token === generation.current) setError(failure instanceof Error ? failure.message : 'Dosya açılamadı.'); }
    finally { if (token === generation.current) setBusy(false); }
  };
  return <div className="min-w-48 space-y-2">
    <p className="break-all text-sm font-medium">{message.attachment?.fileName ?? (message.messageKind === 'video' ? 'Video' : 'Dosya')}</p>
    <p className="text-xs opacity-80">{((message.attachment?.byteSize ?? 0) / 1048576).toFixed(1)} MB</p>
    {url ? <video src={url} controls preload="none" className="max-h-72 max-w-full rounded-lg" onError={() => { setUrl(null); setError('Video açılamadı. Tekrar deneyin.'); }} /> :
      <button type="button" onClick={() => void open()} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/30 px-3 py-2 text-sm disabled:opacity-50">
        {message.messageKind === 'video' ? <Play size={16} /> : <FileText size={16} />}{busy ? 'Hazırlanıyor…' : message.messageKind === 'video' ? 'Videoyu aç' : 'Dosyayı indir'}
      </button>}
    {message.body && <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}
    {error && <p role="alert" className="text-xs">{error}</p>}
  </div>;
};
export default ChatMediaBubble;
