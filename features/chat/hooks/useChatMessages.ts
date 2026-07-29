import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchChatMessages } from '../services/chatService';
import { ChatMessage, ChatMessageCursor, ChatServiceError } from '../types/chat';

const CHAT_HISTORY_LOAD_ERROR = 'Mesaj geçmişi yüklenemedi.';
const CHAT_HISTORY_LOAD_OLDER_ERROR = 'Daha eski mesajlar yüklenemedi.';

const getSafeErrorMessage = (error: unknown, fallback: string): string => (
  error instanceof ChatServiceError ? error.userMessage : fallback
);

const compareMessagesChronologically = (left: ChatMessage, right: ChatMessage): number => {
  const timestampComparison = left.createdAt.localeCompare(right.createdAt);
  return timestampComparison !== 0 ? timestampComparison : left.id.localeCompare(right.id);
};

const mergeMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const messagesById = new Map<string, ChatMessage>();
  const messageIdByClientMessageId = new Map<string, string>();

  for (const message of messages) {
    const existingId = messageIdByClientMessageId.get(message.clientMessageId);
    if (existingId && existingId !== message.id) continue;
    messageIdByClientMessageId.set(message.clientMessageId, message.id);
    messagesById.set(message.id, message);
  }

  return [...messagesById.values()].sort(compareMessagesChronologically);
};

const getContextKey = (
  conversationId: string | null | undefined,
  currentUserId: string | undefined,
): string | null => (
  conversationId && currentUserId ? `${conversationId}:${currentUserId}` : null
);

interface ChatMessagesRefetchOptions {
  preserveMessages?: boolean;
}

export const useChatMessages = (
  conversationId?: string | null,
  currentUserId?: string,
) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<ChatMessageCursor | null>(null);
  const [displayContextKey, setDisplayContextKey] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const isLoadingOlderRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      isLoadingOlderRef.current = false;
    };
  }, []);

  const refetch = useCallback(async (options: ChatMessagesRefetchOptions = {}) => {
    const generation = ++requestGenerationRef.current;
    const contextKey = getContextKey(conversationId, currentUserId);
    const preserveMessages = options.preserveMessages === true;
    isLoadingOlderRef.current = false;

    if (!conversationId || !currentUserId || !contextKey) {
      if (mountedRef.current) {
        setMessages([]);
        setIsLoading(false);
        setIsLoadingOlder(false);
        setError(null);
        setLoadOlderError(null);
        setNextCursor(null);
        setDisplayContextKey(null);
      }
      return;
    }

    if (mountedRef.current) {
      if (!preserveMessages) setMessages([]);
      setIsLoading(true);
      setIsLoadingOlder(false);
      setError(null);
      setLoadOlderError(null);
      if (!preserveMessages) setNextCursor(null);
      setDisplayContextKey(contextKey);
    }

    try {
      const page = await fetchChatMessages(conversationId, currentUserId);
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setMessages((currentMessages) => (
        preserveMessages ? mergeMessages([...page.messages, ...currentMessages]) : mergeMessages(page.messages)
      ));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setError(getSafeErrorMessage(cause, CHAT_HISTORY_LOAD_ERROR));
      if (!preserveMessages) setNextCursor(null);
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, [conversationId, currentUserId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const loadOlder = useCallback(async () => {
    if (
      !conversationId
      || !currentUserId
      || !nextCursor
      || isLoadingOlderRef.current
    ) {
      return;
    }

    const generation = requestGenerationRef.current;
    const cursor = nextCursor;
    isLoadingOlderRef.current = true;
    if (mountedRef.current) {
      setIsLoadingOlder(true);
      setLoadOlderError(null);
    }

    try {
      const page = await fetchChatMessages(conversationId, currentUserId, { before: cursor });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setMessages((currentMessages) => mergeMessages([...page.messages, ...currentMessages]));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setLoadOlderError(getSafeErrorMessage(cause, CHAT_HISTORY_LOAD_OLDER_ERROR));
    } finally {
      if (generation === requestGenerationRef.current) {
        isLoadingOlderRef.current = false;
      }
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setIsLoadingOlder(false);
      }
    }
  }, [conversationId, currentUserId, nextCursor]);

  const mergeCommittedMessage = useCallback((message: ChatMessage): void => {
    if (!conversationId || message.conversationId !== conversationId) return;
    setMessages((currentMessages) => mergeMessages([...currentMessages, message]));
  }, [conversationId]);

  const currentContextKey = getContextKey(conversationId, currentUserId);
  const isCurrentContext = currentContextKey === displayContextKey;

  return {
    messages: isCurrentContext ? messages : [],
    isLoading: isCurrentContext ? isLoading : currentContextKey !== null,
    isLoadingOlder: isCurrentContext ? isLoadingOlder : false,
    error: isCurrentContext ? error : null,
    loadOlderError: isCurrentContext ? loadOlderError : null,
    hasMore: isCurrentContext && nextCursor !== null,
    loadOlder,
    refetch,
    mergeCommittedMessage,
  };
};
