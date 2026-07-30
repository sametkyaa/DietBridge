import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ChatImageViewerProps { url: string; caption: string; onClose: () => void; }

const ChatImageViewer: React.FC<ChatImageViewerProps> = ({ url, caption, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-label={caption} onMouseDown={onClose}>
      <div className="relative flex max-h-full max-w-5xl flex-col gap-3" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" onClick={onClose} className="absolute right-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Görseli kapat"><X aria-hidden="true" /></button>
        <img src={url} alt={caption} className="max-h-[80vh] max-w-full rounded-xl object-contain" />
        {caption !== 'Görsel' && <p className="rounded-lg bg-black/60 px-3 py-2 text-sm text-white">{caption}</p>}
      </div>
    </div>
  );
};

export default ChatImageViewer;
