import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchChatConversations } from '../services/chatService';
import { ChatConversationListItem, ChatReadState, ChatServiceError } from '../types/chat';
import { isValidUuid } from '../../../shared/utils/uuid';

const CHAT_LIST_LOAD_ERROR = 'Mesajlaşma listeniz yüklenemedi.';

const getSafeChatListErrorMessage = (error: unknown): string => (
  error instanceof ChatServiceError ? error.userMessage : CHAT_LIST_LOAD_ERROR
);

export const useChatConversations = (dietitianId?: string) => {
  const [conversations, setConversations] = useState<ChatConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
    };
  }, []);

  const refetch = useCallback(async () => {
    const normalizedDietitianId = dietitianId?.trim();
    const requestVersion = ++requestVersionRef.current;

    if (!normalizedDietitianId) {
      if (mountedRef.current) {
        setConversations([]);
        setError(null);
        setIsLoading(false);
        setHasLoaded(false);
      }
      return;
    }

    setIsLoading(true);
    setHasLoaded(false);
    setError(null);

    try {
      const nextConversations = await fetchChatConversations(normalizedDietitianId);
      if (!mountedRef.current || requestVersion !== requestVersionRef.current) return;
      setConversations(nextConversations);
      setHasLoaded(true);
    } catch (cause) {
      if (!mountedRef.current || requestVersion !== requestVersionRef.current) return;
      setError(getSafeChatListErrorMessage(cause));
    } finally {
      if (mountedRef.current && requestVersion === requestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [dietitianId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const commitConversationReceipt = useCallback((relationId: string, receipt: ChatReadState): void => {
    if (!isValidUuid(relationId) || !isValidUuid(receipt.conversationId)) return;

    setConversations((currentConversations) => currentConversations.map((conversation) => {
      if (
        conversation.relationId !== relationId
        || conversation.conversationId !== receipt.conversationId
      ) {
        return conversation;
      }

      return {
        ...conversation,
        lastDeliveredMessageId: receipt.lastDeliveredMessageId,
        lastReadMessageId: receipt.lastReadMessageId,
        hasUnread: receipt.lastReadMessageId === conversation.lastMessageId ? false : conversation.hasUnread,
      };
    }));
  }, []);

  return { conversations, isLoading, hasLoaded, error, refetch, commitConversationReceipt };
};
