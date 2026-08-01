import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search } from 'lucide-react';
import { USER_AVATAR } from '../constants';
import ChatComposer from '../features/chat/components/ChatComposer';
import ChatConversationList from '../features/chat/components/ChatConversationList';
import ChatMessagePanel from '../features/chat/components/ChatMessagePanel';
import { useChatComposer } from '../features/chat/hooks/useChatComposer';
import { useChatConversations } from '../features/chat/hooks/useChatConversations';
import { useChatMessages } from '../features/chat/hooks/useChatMessages';
import { useChatReadState } from '../features/chat/hooks/useChatReadState';
import { useChatRealtime } from '../features/chat/hooks/useChatRealtime';
import { deleteChatMessage } from '../features/chat/services/chatService';
import { ChatConversationListItem, ChatMessage, ChatReadState } from '../features/chat/types/chat';
import { useAuth } from '../features/auth/context/AuthContext';

const Messages = () => {
  const navigate = useNavigate();
  const { user, isInitialLoading } = useAuth();
  const {
    conversations,
    isLoading,
    error,
    refetch,
    commitConversationReceipt,
  } = useChatConversations(user?.id);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMessagePanelVisible, setIsMessagePanelVisible] = useState(false);
  const [latestVisibleIncomingMessage, setLatestVisibleIncomingMessage] = useState<ChatMessage | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('tr-TR');
    if (!normalizedQuery) return conversations;
    return conversations.filter((conversation) => (
      conversation.clientName.toLocaleLowerCase('tr-TR').includes(normalizedQuery)
    ));
  }, [conversations, searchQuery]);

  const activeConversation = useMemo(() => (
    conversations.find((conversation) => conversation.relationId === activeRelationId) ?? null
  ), [activeRelationId, conversations]);
  const {
    messages,
    isLoading: isLoadingMessages,
    isLoadingOlder,
    error: messageError,
    loadOlderError,
    hasMore,
    loadOlder,
    refetch: refetchMessages,
    mergeCommittedMessage,
  } = useChatMessages(activeConversation?.conversationId, user?.id);
  const serverClientMessageIds = useMemo(
    () => messages.map((message) => message.clientMessageId),
    [messages],
  );
  const latestIncomingMessage = useMemo(() => (
    [...messages].reverse().find((message) => !message.isOwn) ?? null
  ), [messages]);

  useEffect(() => {
    setLatestVisibleIncomingMessage(null);
    setReceiptError(null);
  }, [activeConversation?.conversationId]);

  const handleMessageCommitted = useCallback(async (
    message: ChatMessage,
    context: { relationId: string; activeConversationId: string | null },
  ) => {
    if (
      context.relationId === activeRelationId
      && context.activeConversationId === message.conversationId
    ) {
      mergeCommittedMessage(message);
    }
    await refetch();
  }, [activeRelationId, mergeCommittedMessage, refetch]);

  const refetchMessagesAfterRealtime = useCallback(
    () => refetchMessages({ preserveMessages: true }),
    [refetchMessages],
  );

  const handleRealtimeMessage = useCallback((message: ChatMessage) => {
    mergeCommittedMessage(message);
  }, [mergeCommittedMessage]);

  useChatRealtime({
    currentUserId: user?.id,
    activeRelationId,
    activeConversationId: activeConversation?.conversationId ?? null,
    onMessage: handleRealtimeMessage,
    refetchConversations: refetch,
    refetchMessages: refetchMessagesAfterRealtime,
  });

  const handleReceiptCommitted = useCallback((result: ChatReadState & { relationId: string }) => {
    if (
      result.relationId !== activeRelationId
      || result.conversationId !== activeConversation?.conversationId
    ) {
      return;
    }
    commitConversationReceipt(result.relationId, result);
  }, [activeConversation?.conversationId, activeRelationId, commitConversationReceipt]);

  const handleReceiptError = useCallback((message: string) => {
    setReceiptError(message);
  }, []);

  const handleVisibleIncomingMessage = useCallback((message: ChatMessage) => {
    if (message.conversationId !== activeConversation?.conversationId || message.isOwn) return;
    setLatestVisibleIncomingMessage((current) => {
      if (!current) return message;
      return current.createdAt.localeCompare(message.createdAt) < 0
        || (current.createdAt === message.createdAt && current.id.localeCompare(message.id) < 0)
        ? message
        : current;
    });
  }, [activeConversation?.conversationId]);

  const handleDeleteMessage = useCallback(async (message: ChatMessage) => {
    if (!message.isOwn || message.deletedAt !== null) return;
    const deletedMessage = await deleteChatMessage({ messageId: message.id });
    mergeCommittedMessage(deletedMessage);
    await refetch();
  }, [mergeCommittedMessage, refetch]);

  useChatReadState({
    currentUserId: user?.id,
    relationId: activeRelationId,
    conversationId: activeConversation?.conversationId ?? null,
    latestIncomingMessage,
    latestVisibleIncomingMessage,
    lastDeliveredMessageId: activeConversation?.lastDeliveredMessageId ?? null,
    lastReadMessageId: activeConversation?.lastReadMessageId ?? null,
    isMessagePanelVisible,
    isMessageHistoryLoading: isLoadingMessages,
    messageHistoryError: messageError,
    onReceiptCommitted: handleReceiptCommitted,
    onReceiptError: handleReceiptError,
  });

  const {
    draft,
    setDraft,
    optimisticMessages,
    isSending,
    composerError,
    send,
    retry,
  } = useChatComposer({
    activeRelationId,
    activeConversationId: activeConversation?.conversationId ?? null,
    currentUserId: user?.id,
    serverClientMessageIds,
    onMessageCommitted: handleMessageCommitted,
  });

  useEffect(() => {
    setActiveRelationId((currentRelationId) => {
      if (currentRelationId && conversations.some((conversation) => conversation.relationId === currentRelationId)) {
        return currentRelationId;
      }
      return conversations[0]?.relationId ?? null;
    });
  }, [conversations]);

  const handleSelectConversation = (conversation: ChatConversationListItem) => {
    setActiveRelationId(conversation.relationId);
    setIsMessagePanelVisible(true);
  };

  const isAuthPreparing = !user && isInitialLoading;
  const isSearchEmpty = !isLoading && !error && conversations.length > 0 && filteredConversations.length === 0;
  const composerDisabled = !activeConversation || !user;

  return (
    <div className="mx-auto flex h-dvh max-h-dvh max-w-7xl flex-col p-4 sm:p-6">
      <header className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-slate-800">Mesajlar</h1>
        <div className="flex w-full items-center gap-3 sm:w-auto sm:gap-6">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Danışan ara..."
              aria-label="Danışan ara"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button className="relative rounded-full border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:bg-slate-50" type="button" aria-label="Bildirimler">
            <Bell className="h-5 w-5" aria-hidden="true" />
            <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full border border-white bg-red-500" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="cursor-pointer rounded-full border-0 bg-transparent p-0 transition-opacity hover:opacity-80 focus:outline-none"
            aria-label="Profil sayfasına git"
          >
            <img
              src={USER_AVATAR}
              alt="Profil"
              className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm"
            />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden sm:gap-6">
        <section
          className={`${isMessagePanelVisible ? 'hidden' : 'flex'} min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:flex md:w-1/3 md:min-w-[18rem]`}
          aria-label="Konuşma listesi"
        >
          <div className="border-b border-slate-100 bg-slate-50/50 p-4">
            <h2 className="font-bold text-slate-700">Son Görüşmeler</h2>
          </div>
          {isAuthPreparing || isLoading ? (
            <div className="space-y-4 p-4" aria-label="Mesajlaşma listesi yükleniyor">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex animate-pulse items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-slate-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-slate-100" />
                    <div className="h-3 w-full rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center" role="alert">
              <h3 className="font-bold text-slate-800">Mesajlaşma listeniz yüklenemedi.</h3>
              <p className="mt-2 text-sm text-slate-500">Lütfen tekrar deneyin.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-4 min-h-11 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Tekrar dene
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500" role="status">
              {user ? 'Mesajlaşabileceğiniz aktif bir danışan bulunmuyor.' : 'Oturum bilgileri hazırlanıyor.'}
            </div>
          ) : isSearchEmpty ? (
            <div className="p-8 text-center text-sm text-slate-500" role="status">
              Aramanızla eşleşen danışan bulunamadı.
            </div>
          ) : (
            <ChatConversationList
              conversations={filteredConversations}
              activeRelationId={activeRelationId}
              onSelect={handleSelectConversation}
            />
          )}
        </section>

        <div className={`${isMessagePanelVisible ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 md:flex`}>
          <ChatMessagePanel
            conversation={activeConversation}
            messages={messages}
            optimisticMessages={optimisticMessages}
            isLoading={isLoadingMessages}
            isLoadingOlder={isLoadingOlder}
            error={messageError}
            loadOlderError={loadOlderError}
            receiptError={receiptError}
            hasMore={hasMore}
            onLoadOlder={() => void loadOlder()}
            onRetry={() => void refetchMessages()}
            onRetryOptimistic={(message) => void retry(message)}
            onDeleteMessage={handleDeleteMessage}
            onVisibleIncomingMessage={handleVisibleIncomingMessage}
            onBack={() => setIsMessagePanelVisible(false)}
            showBackButton={isMessagePanelVisible}
            composer={(
              <ChatComposer
                draft={draft}
                onDraftChange={setDraft}
                onSend={() => void send()}
                isSending={isSending}
                error={composerError}
                disabled={composerDisabled}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
};

export default Messages;
