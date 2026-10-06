import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ChatComposer from '../features/chat/components/ChatComposer';
import ChatConversationList from '../features/chat/components/ChatConversationList';
import ChatMessagePanel from '../features/chat/components/ChatMessagePanel';
import { useChatComposer } from '../features/chat/hooks/useChatComposer';
import { useChatConversations } from '../features/chat/hooks/useChatConversations';
import { useChatMessages } from '../features/chat/hooks/useChatMessages';
import { useChatImageUpload } from '../features/chat/hooks/useChatImageUpload';
import { useChatReadState } from '../features/chat/hooks/useChatReadState';
import { useChatRealtime } from '../features/chat/hooks/useChatRealtime';
import { deleteChatMessage, fetchChatMessageById } from '../features/chat/services/chatService';
import type { ChatImageFinalizeResult } from '../features/chat/services/chatImageService';
import { ChatConversationListItem, ChatMessage, ChatReadState } from '../features/chat/types/chat';
import { useAuth } from '../features/auth/context/AuthContext';
import DietitianAvatar from '../shared/components/DietitianAvatar';
import { resolveConversationSelection } from '../features/chat/utils/messageDeepLink';
import { env } from '../lib/env';
import NotificationBell from '../features/notifications/components/NotificationBell';
import { useUnreadCounts } from '../features/chat/context/UnreadCountsContext';
import { ChatClientSummaryPanel } from '../features/chat/components/ChatClientSummaryPanel';
import { EmptyState, ErrorState, SearchInput, SegmentedControl } from '../shared/ui';

type ConversationFilter = 'all' | 'unread';

const Messages = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConversationId = searchParams.get('conversationId');
  const requestedClientId = searchParams.get('clientId');
  const { user, isInitialLoading } = useAuth();
  const {
    conversations,
    isLoading,
    hasLoaded,
    error,
    refetch,
    commitConversationReceipt,
  } = useChatConversations(user?.id);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const unreadCounts = useUnreadCounts();
  const { countForConversation, refresh: refreshUnreadCounts } = unreadCounts;
  const hasUnreadMessages = useCallback((conversation: ChatConversationListItem): boolean => {
    const count = countForConversation(conversation.conversationId);
    return count !== null ? count > 0 : conversation.hasUnread;
  }, [countForConversation]);
  const [isMessagePanelVisible, setIsMessagePanelVisible] = useState(false);
  const [latestVisibleIncomingMessage, setLatestVisibleIncomingMessage] = useState<ChatMessage | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const unreadConversationCount = useMemo(
    () => conversations.filter(hasUnreadMessages).length,
    [conversations, hasUnreadMessages],
  );

  const filteredConversations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('tr-TR');
    return conversations.filter((conversation) => (
      (!normalizedQuery || conversation.clientName.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
      && (conversationFilter === 'all' || hasUnreadMessages(conversation) || conversation.relationId === activeRelationId)
    ));
  }, [activeRelationId, conversationFilter, conversations, hasUnreadMessages, searchQuery]);

  const activeConversation = useMemo(() => (
    conversations.find((conversation) => conversation.relationId === activeRelationId) ?? null
  ), [activeRelationId, conversations]);
  const conversationSelection = useMemo(
    () => resolveConversationSelection(
      conversations,
      requestedConversationId,
      requestedClientId,
      { isLoading, hasLoaded },
    ),
    [conversations, hasLoaded, isLoading, requestedClientId, requestedConversationId],
  );
  const {
    messages,
    mealActivities,
    mealActivityError,
    isLoading: isLoadingMessages,
    isLoadingOlder,
    error: messageError,
    loadOlderError,
    hasMore,
    loadOlder,
    refetch: refetchMessages,
    mergeCommittedMessage,
  } = useChatMessages(activeConversation?.conversationId, user?.id, {
    relationId: activeConversation?.relationId,
    clientId: activeConversation?.clientId,
    dietitianId: user?.id,
  });
  const serverClientMessageIds = useMemo(
    () => messages.map((message) => message.clientMessageId),
    [messages],
  );
  const latestIncomingMessage = useMemo(() => (
    [...messages].reverse().find((message) => !message.isOwn) ?? null
  ), [messages]);

  /**
   * Finalization only proves that the image message was committed. Re-read the
   * exact row with its attachment join before it enters the existing id +
   * clientMessageId dedupe path. A failed read adds no partial message; the
   * Realtime/reconnect refetch safety nets remain active.
   */
  const handleImageFinalized = useCallback((result: ChatImageFinalizeResult): void => {
    if (!user?.id) return;
    void fetchChatMessageById(result.messageId, result.conversationId, user.id)
      .then((message) => {
        if (message) mergeCommittedMessage(message);
      })
      .catch(() => undefined);
    void refetch();
  }, [mergeCommittedMessage, refetch, user?.id]);

  const imageUpload = useChatImageUpload({
    conversationId: activeConversation?.conversationId ?? null,
    featureEnabled: env.enableChatImages,
    onFinalized: handleImageFinalized,
  });

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
    // The sidebar and list counters follow the committed read cursor.
    void refreshUnreadCounts();
  }, [activeConversation?.conversationId, activeRelationId, commitConversationReceipt, refreshUnreadCounts]);

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
    if (isInitialLoading || !user || error) return;

    if (conversationSelection.status === 'pending') {
      if (conversationSelection.hasQuery) {
        setActiveRelationId(null);
        setIsMessagePanelVisible(false);
      }
      return;
    }

    if (conversationSelection.status === 'resolved') {
      setActiveRelationId(conversationSelection.conversation.relationId);
      setIsMessagePanelVisible(true);
      if (requestedConversationId || requestedClientId) setSearchParams({}, { replace: true });
      return;
    }

    if (conversationSelection.hasQuery) {
      setActiveRelationId(null);
      setIsMessagePanelVisible(false);
      setSearchParams({}, { replace: true });
      return;
    }

    setActiveRelationId((currentRelationId) => {
      if (currentRelationId && conversations.some((conversation) => conversation.relationId === currentRelationId)) {
        return currentRelationId;
      }
      return conversationSelection.conversation?.relationId ?? null;
    });
  }, [conversationSelection, conversations, error, isInitialLoading, requestedClientId, requestedConversationId, setSearchParams, user]);

  const handleSelectConversation = (conversation: ChatConversationListItem) => {
    setActiveRelationId(conversation.relationId);
    setIsMessagePanelVisible(true);
    if (requestedConversationId || requestedClientId) setSearchParams({}, { replace: true });
  };

  const isAuthPreparing = !user && isInitialLoading;
  const isSearchEmpty = !isLoading && !error && conversations.length > 0 && filteredConversations.length === 0;
  const composerDisabled = !activeConversation || !user;

  return (
    <div className="mx-auto flex h-dvh max-h-dvh w-full max-w-[1500px] flex-col px-4 pb-4 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-26 font-bold tracking-[-0.3px] text-ink">Mesajlar</h1>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <SearchInput
            label="Danışan ara"
            placeholder="Danışan ara..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            containerClassName="min-w-0 flex-1 sm:w-64 sm:flex-none"
          />
          <NotificationBell />
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="cursor-pointer rounded-full border-0 bg-transparent p-0 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            aria-label="Profil sayfasına git"
          >
            <DietitianAvatar
              alt="Profil"
              className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm"
            />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <section
          className={`${isMessagePanelVisible ? 'hidden' : 'flex'} min-h-0 w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card md:flex md:w-[320px] md:shrink-0`}
          aria-label="Konuşma listesi"
        >
          <div className="border-b border-line px-4 py-3">
            <SegmentedControl<ConversationFilter>
              ariaLabel="Konuşma filtresi"
              value={conversationFilter}
              onChange={setConversationFilter}
              options={[
                { value: 'all', label: 'Tümü' },
                { value: 'unread', label: 'Okunmamış', count: unreadConversationCount },
              ]}
            />
          </div>
          {isAuthPreparing || isLoading ? (
            <div className="space-y-4 p-4" aria-label="Mesajlaşma listesi yükleniyor">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex animate-pulse items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-sunk" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-sunk" />
                    <div className="h-3 w-full rounded bg-sunk" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorState compact title="Mesajlaşma listeniz yüklenemedi." description="Lütfen tekrar deneyin." onRetry={() => void refetch()} retryLabel="Tekrar dene" />
          ) : conversations.length === 0 ? (
            <div role="status">
              <EmptyState compact icon="chat-circle" title={user ? 'Mesajlaşabileceğiniz aktif bir danışan bulunmuyor.' : 'Oturum bilgileri hazırlanıyor.'} />
            </div>
          ) : isSearchEmpty ? (
            <div role="status">
              <EmptyState
                compact
                icon={conversationFilter === 'unread' && !searchQuery.trim() ? 'check-circle' : 'magnifying-glass'}
                title={conversationFilter === 'unread' && !searchQuery.trim() ? 'Okunmamış mesaj yok.' : 'Aramanızla eşleşen danışan bulunamadı.'}
              />
            </div>
          ) : (
            <ChatConversationList
              conversations={filteredConversations}
              activeRelationId={activeRelationId}
              onSelect={handleSelectConversation}
              currentUserId={user?.id ?? null}
              unreadCountFor={countForConversation}
            />
          )}
        </section>

        <div className={`${isMessagePanelVisible ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 md:flex`}>
          <ChatMessagePanel
            conversation={activeConversation}
            messages={messages}
            mealActivities={mealActivities}
            mealActivityError={mealActivityError}
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
                conversationId={activeConversation?.conversationId ?? null}
                imageUpload={imageUpload}
              />
            )}
          />
        </div>

        {activeConversation && (
          <div key={activeConversation.clientId} className="hidden min-h-0 xl:flex">
            <ChatClientSummaryPanel
              clientId={activeConversation.clientId}
              clientName={activeConversation.clientName}
              avatarUrl={activeConversation.clientAvatarUrl}
              refreshToken={mealActivities.length}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Messages;
