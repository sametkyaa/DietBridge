import React, { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, MoreVertical } from 'lucide-react';
import { OptimisticChatMessage } from '../hooks/useChatComposer';
import { ChatConversationListItem, ChatMessage } from '../types/chat';
import { getChatReceiptState } from '../utils/receipts';
import { ChatClientAvatar } from './ChatConversationList';
import ChatImageBubble from './ChatImageBubble';

interface ChatMessagePanelProps {
  conversation: ChatConversationListItem | null;
  messages: ChatMessage[];
  optimisticMessages: OptimisticChatMessage[];
  isLoading: boolean;
  isLoadingOlder: boolean;
  error: string | null;
  loadOlderError: string | null;
  hasMore: boolean;
  onLoadOlder: () => void;
  onRetry: () => void;
  onRetryOptimistic: (message: OptimisticChatMessage) => void;
  onDeleteMessage: (message: ChatMessage) => Promise<void>;
  onVisibleIncomingMessage: (message: ChatMessage) => void;
  onBack: () => void;
  showBackButton: boolean;
  composer: ReactNode;
}

interface ScrollAnchor { scrollHeight: number; scrollTop: number; }

type TimelineMessage =
  | { key: string; createdAt: string; type: 'server'; message: ChatMessage }
  | { key: string; createdAt: string; type: 'optimistic'; message: OptimisticChatMessage };

const formatMessageTime = (value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(timestamp);
};

const ChatMessageSkeleton = () => (
  <div className="space-y-4 p-6" aria-label="Mesaj geçmişi yükleniyor" role="status">
    {[0, 1, 2, 3].map((index) => <div key={index} className={`flex animate-pulse ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}><div className="h-16 w-2/3 rounded-2xl bg-slate-100" /></div>)}
  </div>
);

const ChatReceiptIcon: React.FC<{
  message: ChatMessage;
  peerLastDeliveredCursor: ChatConversationListItem['peerLastDeliveredCursor'];
  peerLastReadCursor: ChatConversationListItem['peerLastReadCursor'];
}> = ({ message, peerLastDeliveredCursor, peerLastReadCursor }) => {
  const state = getChatReceiptState(message, peerLastDeliveredCursor, peerLastReadCursor);
  if (state === 'read') return <CheckCheck className="h-3.5 w-3.5 text-sky-200" aria-label="Okundu" />;
  if (state === 'delivered') return <CheckCheck className="h-3.5 w-3.5 text-emerald-100" aria-label="Teslim edildi" />;
  return <Check className="h-3.5 w-3.5 text-emerald-100" aria-label="Sunucuya gönderildi" />;
};

const ChatMessageBubble: React.FC<{
  message: ChatMessage;
  clientName: string;
  peerLastDeliveredCursor: ChatConversationListItem['peerLastDeliveredCursor'];
  peerLastReadCursor: ChatConversationListItem['peerLastReadCursor'];
  onRequestDelete: (message: ChatMessage) => void;
}> = ({ message, clientName, peerLastDeliveredCursor, peerLastReadCursor, onRequestDelete }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const time = formatMessageTime(message.createdAt);
  const senderLabel = message.isOwn ? 'Siz' : clientName;
  const canDelete = message.isOwn && message.deletedAt === null;

  return (
    <article data-chat-message-id={message.id} data-chat-incoming={message.isOwn ? undefined : 'true'} className={`flex ${message.isOwn ? 'justify-end' : 'justify-start'}`} aria-label={`${senderLabel} mesajı`}>
      <div className={`max-w-[85%] rounded-2xl p-4 sm:max-w-[70%] ${message.isOwn ? 'rounded-tr-none bg-primary text-white' : 'rounded-tl-none border border-slate-100 bg-white text-slate-700 shadow-sm'}`}>
        {message.deletedAt ? (
          <p className="text-sm italic leading-relaxed opacity-80">Bu mesaj silindi</p>
        ) : message.messageKind === 'image' ? (
          <ChatImageBubble message={message} />
        ) : (
          <p className="break-words whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
        )}
        <div className={`mt-2 flex items-center justify-end gap-1.5 text-[10px] ${message.isOwn ? 'text-emerald-100' : 'text-slate-400'}`}>
          {time && <time dateTime={message.createdAt}>{time}</time>}
          {message.isOwn && <ChatReceiptIcon message={message} peerLastDeliveredCursor={peerLastDeliveredCursor} peerLastReadCursor={peerLastReadCursor} />}
          {canDelete && <div className="relative">
            <button type="button" onClick={() => setIsMenuOpen((current) => !current)} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-emerald-100 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Mesaj işlemleri" aria-expanded={isMenuOpen}><MoreVertical className="h-4 w-4" aria-hidden="true" /></button>
            {isMenuOpen && <div className="absolute bottom-8 right-0 z-10 w-32 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg"><button type="button" onClick={() => { setIsMenuOpen(false); onRequestDelete(message); }} className="min-h-10 w-full rounded-md px-3 text-left text-sm font-medium text-rose-700 hover:bg-rose-50">Mesajı sil</button></div>}
          </div>}
        </div>
      </div>
    </article>
  );
};

const OptimisticChatMessageBubble: React.FC<{ message: OptimisticChatMessage; onRetry: () => void }> = ({ message, onRetry }) => {
  const time = formatMessageTime(message.createdAt);
  const isFailed = message.deliveryState === 'failed';
  return <article className="flex justify-end" aria-label={isFailed ? 'Gönderilemeyen mesajınız' : 'Gönderilmekte olan mesajınız'}><div className={`max-w-[85%] rounded-2xl rounded-tr-none p-4 sm:max-w-[70%] ${isFailed ? 'border border-rose-200 bg-rose-50 text-slate-700' : 'bg-primary text-white'}`}><p className="break-words whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p><div className="mt-2 flex items-center justify-end gap-2 text-[10px]">{time && <time className={isFailed ? 'text-slate-400' : 'text-emerald-100'} dateTime={message.createdAt}>{time}</time>}<span className={isFailed ? 'font-semibold text-rose-700' : 'text-emerald-100'}>{isFailed ? 'Gönderilemedi' : 'Gönderiliyor…'}</span></div>{isFailed && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-100">Tekrar dene</button>}</div></article>;
};

const ChatMessagePanel: React.FC<ChatMessagePanelProps> = ({ conversation, messages, optimisticMessages, isLoading, isLoadingOlder, error, loadOlderError, hasMore, onLoadOlder, onRetry, onRetryOptimistic, onDeleteMessage, onVisibleIncomingMessage, onBack, showBackButton, composer }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingOlderAnchorRef = useRef<ScrollAnchor | null>(null);
  const lastTimelineKeyRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const [messagePendingDeletion, setMessagePendingDeletion] = useState<ChatMessage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const conversationId = conversation?.conversationId ?? null;
  const timeline = useMemo<TimelineMessage[]>(() => {
    const serverClientMessageIds = new Set(messages.map((message) => message.clientMessageId));
    const items: TimelineMessage[] = messages.map((message) => ({ key: `server:${message.id}`, createdAt: message.createdAt, type: 'server', message }));
    for (const message of optimisticMessages) if (!serverClientMessageIds.has(message.clientMessageId)) items.push({ key: `optimistic:${message.clientMessageId}`, createdAt: message.createdAt, type: 'optimistic', message });
    return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key));
  }, [messages, optimisticMessages]);
  const latestTimelineKey = timeline.at(-1)?.key ?? null;
  const incomingMessagesById = useMemo(() => new Map(messages.filter((message) => !message.isOwn).map((message) => [message.id, message])), [messages]);

  useEffect(() => { pendingOlderAnchorRef.current = null; lastTimelineKeyRef.current = null; isNearBottomRef.current = true; }, [conversationId]);
  useLayoutEffect(() => { const container = scrollContainerRef.current; const anchor = pendingOlderAnchorRef.current; if (!container || !anchor || isLoadingOlder) return; container.scrollTop = anchor.scrollTop + (container.scrollHeight - anchor.scrollHeight); pendingOlderAnchorRef.current = null; }, [isLoadingOlder, timeline]);
  useEffect(() => { const container = scrollContainerRef.current; if (!container || isLoading || !latestTimelineKey || pendingOlderAnchorRef.current) return; if (lastTimelineKeyRef.current === null || (lastTimelineKeyRef.current !== latestTimelineKey && isNearBottomRef.current)) container.scrollTop = container.scrollHeight; lastTimelineKeyRef.current = latestTimelineKey; }, [isLoading, latestTimelineKey]);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).map((entry) => incomingMessagesById.get(entry.target.getAttribute('data-chat-message-id') ?? '')).filter((message): message is ChatMessage => message !== undefined).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      const latestVisible = visible.at(-1);
      if (latestVisible) onVisibleIncomingMessage(latestVisible);
    }, { root: container, threshold: 0.65 });
    container.querySelectorAll<HTMLElement>('[data-chat-incoming="true"]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [incomingMessagesById, onVisibleIncomingMessage, timeline]);

  const handleScroll = () => { const container = scrollContainerRef.current; if (container) isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80; };
  const handleLoadOlder = () => { const container = scrollContainerRef.current; if (container) pendingOlderAnchorRef.current = { scrollHeight: container.scrollHeight, scrollTop: container.scrollTop }; onLoadOlder(); };
  const confirmDelete = async () => { if (!messagePendingDeletion || isDeleting) return; setIsDeleting(true); setDeleteError(null); try { await onDeleteMessage(messagePendingDeletion); setMessagePendingDeletion(null); } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : 'Mesaj silinemedi. Lütfen tekrar deneyin.'); } finally { setIsDeleting(false); } };
  const showHistorySkeleton = Boolean(conversation && conversationId && isLoading && timeline.length === 0);
  const showHistoryError = Boolean(conversation && conversationId && error && timeline.length === 0);
  const showEmptyHistory = Boolean(conversation && conversationId && !isLoading && !error && timeline.length === 0);

  return <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Mesaj geçmişi">
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white p-4">{showBackButton && <button type="button" onClick={onBack} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden" aria-label="Konuşma listesine dön"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>}{conversation && <><ChatClientAvatar name={conversation.clientName} url={conversation.clientAvatarUrl} className="h-10 w-10 shrink-0 rounded-full" /><h2 className="min-w-0 truncate font-bold text-slate-800">{conversation.clientName}</h2></>}</header>
    {!conversation ? <div className="flex flex-1 items-center justify-center bg-slate-50/30 p-6 text-center text-sm text-slate-500">Mesajları görüntülemek için bir danışan seçin.</div> : showHistorySkeleton ? <ChatMessageSkeleton /> : showHistoryError ? <div className="flex flex-1 items-center justify-center bg-slate-50/30 p-6 text-center" role="alert"><div><p className="font-semibold text-slate-800">Mesaj geçmişi yüklenemedi.</p><button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">Tekrar dene</button></div></div> : !conversationId && timeline.length === 0 ? <div className="flex flex-1 items-center justify-center bg-slate-50/30 p-6 text-center text-sm text-slate-500">Henüz mesajlaşma başlamadı.</div> : showEmptyHistory ? <div className="flex flex-1 items-center justify-center bg-slate-50/30 p-6 text-center text-sm text-slate-500">Henüz mesaj bulunmuyor.</div> : <div ref={scrollContainerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-slate-50/30 p-4 sm:p-6" aria-live="polite"><div className="space-y-3">{hasMore && <div className="text-center"><button type="button" onClick={handleLoadOlder} disabled={isLoadingOlder} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">{isLoadingOlder ? 'Daha eski mesajlar yükleniyor...' : 'Daha eski mesajları yükle'}</button></div>}{loadOlderError && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-center text-sm text-rose-800" role="alert"><p>Daha eski mesajlar yüklenemedi.</p><button type="button" onClick={handleLoadOlder} disabled={isLoadingOlder} className="mt-2 min-h-11 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold">Tekrar dene</button></div>}{timeline.map((item) => item.type === 'server' ? <ChatMessageBubble key={item.key} message={item.message} clientName={conversation.clientName} peerLastDeliveredCursor={conversation.peerLastDeliveredCursor} peerLastReadCursor={conversation.peerLastReadCursor} onRequestDelete={setMessagePendingDeletion} /> : <OptimisticChatMessageBubble key={item.key} message={item.message} onRetry={() => onRetryOptimistic(item.message)} />)}</div></div>}
    {conversation && composer}
    {messagePendingDeletion && <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" role="presentation"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="delete-chat-message-title"><h3 id="delete-chat-message-title" className="text-lg font-bold text-slate-800">Mesaj silinsin mi?</h3><p className="mt-2 text-sm text-slate-600">Bu mesaj konuşmadaki herkes için silinecek.</p>{deleteError && <p className="mt-3 text-sm text-rose-700" role="alert">{deleteError}</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={isDeleting} onClick={() => { setMessagePendingDeletion(null); setDeleteError(null); }} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">Vazgeç</button><button type="button" disabled={isDeleting} onClick={() => void confirmDelete()} className="min-h-11 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{isDeleting ? 'Siliniyor...' : 'Mesajı sil'}</button></div></div></div>}
  </section>;
};

export default ChatMessagePanel;
