import { useCallback, useEffect, useRef } from 'react';
import {
  fetchChatMessageById,
  subscribeToChatConversations,
  subscribeToChatMessages,
  subscribeToChatReadStates,
} from '../services/chatService';
import { ChatMessage } from '../types/chat';
import { isValidUuid } from '../../../shared/utils/uuid';

const CONVERSATION_REFETCH_DEBOUNCE_MS = 150;
/** Guards against unbounded fan-out if a burst of rows needs reconciliation. */
const MAX_PENDING_MESSAGE_RECONCILIATIONS = 20;

interface UseChatRealtimeOptions {
  currentUserId?: string;
  activeRelationId?: string | null;
  activeConversationId?: string | null;
  onMessage: (message: ChatMessage) => void;
  refetchConversations: () => Promise<unknown> | void;
  refetchMessages: () => Promise<unknown> | void;
}

interface ActiveChatContext {
  currentUserId?: string;
  activeRelationId: string | null;
  activeConversationId: string | null;
}

export const useChatRealtime = ({
  currentUserId,
  activeRelationId = null,
  activeConversationId = null,
  onMessage,
  refetchConversations,
  refetchMessages,
}: UseChatRealtimeOptions): void => {
  const mountedRef = useRef(false);
  const activeContextRef = useRef<ActiveChatContext>({
    currentUserId,
    activeRelationId,
    activeConversationId,
  });
  const onMessageRef = useRef(onMessage);
  const refetchConversationsRef = useRef(refetchConversations);
  const refetchMessagesRef = useRef(refetchMessages);
  const conversationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationRefetchInFlightRef = useRef(false);
  const conversationRefetchPendingRef = useRef(false);
  const messageRefetchInFlightRef = useRef(false);
  const messageRefetchPendingRef = useRef(false);
  const scheduleConversationRefetchRef = useRef<() => void>(() => undefined);
  const requestMessageRefetchRef = useRef<() => void>(() => undefined);

  activeContextRef.current = {
    currentUserId,
    activeRelationId,
    activeConversationId,
  };
  onMessageRef.current = onMessage;
  refetchConversationsRef.current = refetchConversations;
  refetchMessagesRef.current = refetchMessages;

  const scheduleConversationRefetch = useCallback(() => {
    if (!mountedRef.current) return;

    if (conversationRefetchInFlightRef.current) {
      conversationRefetchPendingRef.current = true;
      return;
    }

    if (conversationTimerRef.current) return;

    conversationTimerRef.current = setTimeout(() => {
      conversationTimerRef.current = null;
      if (!mountedRef.current || conversationRefetchInFlightRef.current) return;

      conversationRefetchInFlightRef.current = true;
      void Promise.resolve(refetchConversationsRef.current())
        .catch(() => undefined)
        .finally(() => {
          conversationRefetchInFlightRef.current = false;
          if (!mountedRef.current || !conversationRefetchPendingRef.current) return;
          conversationRefetchPendingRef.current = false;
          scheduleConversationRefetchRef.current();
        });
    }, CONVERSATION_REFETCH_DEBOUNCE_MS);
  }, []);

  scheduleConversationRefetchRef.current = scheduleConversationRefetch;

  const requestMessageRefetch = useCallback(() => {
    const { activeConversationId } = activeContextRef.current;
    if (!mountedRef.current || !isValidUuid(activeConversationId)) return;

    if (messageRefetchInFlightRef.current) {
      messageRefetchPendingRef.current = true;
      return;
    }

    messageRefetchInFlightRef.current = true;
    void Promise.resolve(refetchMessagesRef.current())
      .catch(() => undefined)
      .finally(() => {
        messageRefetchInFlightRef.current = false;
        if (!mountedRef.current || !messageRefetchPendingRef.current) return;
        messageRefetchPendingRef.current = false;
        requestMessageRefetchRef.current();
      });
  }, []);

  requestMessageRefetchRef.current = requestMessageRefetch;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversationRefetchPendingRef.current = false;
      messageRefetchPendingRef.current = false;
      if (conversationTimerRef.current) {
        clearTimeout(conversationTimerRef.current);
        conversationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isValidUuid(currentUserId)) return undefined;

    let isCurrentSubscription = true;
    const requestConversationRefresh = () => {
      if (isCurrentSubscription) scheduleConversationRefetchRef.current();
    };
    const onStatus = (status: 'connecting' | 'connected' | 'disconnected' | 'error') => {
      if (status === 'connected') requestConversationRefresh();
    };
    const conversationSubscription = subscribeToChatConversations({
      currentUserId,
      onChange: requestConversationRefresh,
      onStatus,
    });
    const readStateSubscription = subscribeToChatReadStates({
      currentUserId,
      onChange: requestConversationRefresh,
      onStatus,
    });

    return () => {
      isCurrentSubscription = false;
      void conversationSubscription.unsubscribe();
      void readStateSubscription.unsubscribe();
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!isValidUuid(currentUserId) || !isValidUuid(activeConversationId)) {
      return undefined;
    }

    const subscribedConversationId = activeConversationId;
    const subscribedUserId = currentUserId;
    let isCurrentSubscription = true;
    // Owned by this subscription generation: a resubscribe starts with an
    // empty queue and the previous one can never leak into it.
    const pendingReconciliations = new Set<string>();
    const isCurrentContext = (): boolean => {
      const context = activeContextRef.current;
      return isCurrentSubscription
        && mountedRef.current
        && context.currentUserId === subscribedUserId
        && context.activeConversationId === subscribedConversationId
        && context.activeRelationId !== null;
    };
    const deliverMessage = (message: ChatMessage): void => {
      if (!isCurrentContext() || message.conversationId !== subscribedConversationId) return;
      onMessageRef.current(message);
    };
    /**
     * Realtime payloads cannot carry the embedded attachment join, so image
     * rows are resolved with a targeted read instead of waiting for the
     * reconnect refetch. A failed read never synthesizes a partial message:
     * the existing reconnect/refetch safety net still applies.
     */
    const reconcileMessage = (messageId: string): void => {
      if (!isCurrentContext()) return;
      if (pendingReconciliations.has(messageId)) return;
      if (pendingReconciliations.size >= MAX_PENDING_MESSAGE_RECONCILIATIONS) {
        requestMessageRefetchRef.current();
        return;
      }

      pendingReconciliations.add(messageId);
      void fetchChatMessageById(messageId, subscribedConversationId, subscribedUserId)
        .then((message) => {
          if (message) deliverMessage(message);
        })
        .catch(() => undefined)
        .finally(() => {
          pendingReconciliations.delete(messageId);
        });
    };
    const subscription = subscribeToChatMessages({
      conversationId: subscribedConversationId,
      currentUserId: subscribedUserId,
      onMessage: deliverMessage,
      onReconcile: reconcileMessage,
      onStatus: (status) => {
        if (isCurrentSubscription && status === 'connected') {
          requestMessageRefetchRef.current();
        }
      },
    });

    return () => {
      isCurrentSubscription = false;
      pendingReconciliations.clear();
      void subscription.unsubscribe();
    };
  }, [activeConversationId, currentUserId]);
};
