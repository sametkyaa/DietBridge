import { useEffect, useRef, useState } from 'react';
import { markConversationDelivered, markConversationRead } from '../services/chatService';
import { ChatMessage, ChatReadState } from '../types/chat';
import { isValidUuid } from '../../../shared/utils/uuid';

interface UseChatReadStateOptions {
  currentUserId?: string;
  relationId?: string | null;
  conversationId?: string | null;
  latestIncomingMessage?: ChatMessage | null;
  latestVisibleIncomingMessage?: ChatMessage | null;
  lastDeliveredMessageId?: string | null;
  lastReadMessageId?: string | null;
  isMessagePanelVisible: boolean;
  isMessageHistoryLoading: boolean;
  messageHistoryError: string | null;
  onReceiptCommitted: (result: ChatReadState & { relationId: string }) => void;
}

interface ActiveReceiptContext {
  currentUserId?: string;
  relationId: string | null;
  conversationId: string | null;
}

const getReceiptContextKey = ({
  currentUserId,
  relationId,
  conversationId,
}: ActiveReceiptContext): string | null => (
  isValidUuid(currentUserId)
  && isValidUuid(relationId)
  && isValidUuid(conversationId)
    ? `${currentUserId}:${relationId}:${conversationId}`
    : null
);

export const useChatReadState = ({
  currentUserId,
  relationId = null,
  conversationId = null,
  latestIncomingMessage = null,
  latestVisibleIncomingMessage = null,
  lastDeliveredMessageId = null,
  lastReadMessageId = null,
  isMessagePanelVisible,
  isMessageHistoryLoading,
  messageHistoryError,
  onReceiptCommitted,
}: UseChatReadStateOptions): void => {
  const [isForeground, setIsForeground] = useState(false);
  const mountedRef = useRef(false);
  const contextGenerationRef = useRef(0);
  const lastContextKeyRef = useRef<string | null | undefined>(undefined);
  const activeContextRef = useRef<ActiveReceiptContext>({ currentUserId, relationId, conversationId });
  const onReceiptCommittedRef = useRef(onReceiptCommitted);
  const deliveryInFlightKeysRef = useRef(new Set<string>());
  const readInFlightKeysRef = useRef(new Set<string>());
  const completedKeysRef = useRef(new Set<string>());

  activeContextRef.current = { currentUserId, relationId, conversationId };
  onReceiptCommittedRef.current = onReceiptCommitted;

  const contextKey = getReceiptContextKey(activeContextRef.current);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (lastContextKeyRef.current !== contextKey) {
      lastContextKeyRef.current = contextKey;
      contextGenerationRef.current += 1;
    }
  }, [contextKey]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const updateForegroundState = () => setIsForeground(
      document.visibilityState === 'visible' && document.hasFocus(),
    );
    updateForegroundState();
    document.addEventListener('visibilitychange', updateForegroundState);
    window.addEventListener('focus', updateForegroundState);
    window.addEventListener('blur', updateForegroundState);
    return () => {
      document.removeEventListener('visibilitychange', updateForegroundState);
      window.removeEventListener('focus', updateForegroundState);
      window.removeEventListener('blur', updateForegroundState);
    };
  }, []);

  const canWriteReceipt = (
    contextKey !== null
    && isMessagePanelVisible
    && !isMessageHistoryLoading
    && messageHistoryError === null
  );

  useEffect(() => {
    if (
      !canWriteReceipt
      || !latestIncomingMessage
      || latestIncomingMessage.isOwn
      || latestIncomingMessage.deliveryState !== 'sent'
      || latestIncomingMessage.conversationId !== conversationId
      || latestIncomingMessage.id === lastDeliveredMessageId
    ) return;

    const requestKey = `${conversationId}:delivered:${latestIncomingMessage.id}`;
    if (deliveryInFlightKeysRef.current.has(requestKey) || completedKeysRef.current.has(requestKey)) return;

    const expectedGeneration = contextGenerationRef.current;
    const expectedContextKey = contextKey;
    const expectedRelationId = relationId;
    const expectedConversationId = conversationId;
    deliveryInFlightKeysRef.current.add(requestKey);

    void markConversationDelivered({
      conversationId: expectedConversationId,
      lastDeliveredMessageId: latestIncomingMessage.id,
    }).then((state) => {
      completedKeysRef.current.add(requestKey);
      if (
        !mountedRef.current
        || contextGenerationRef.current !== expectedGeneration
        || getReceiptContextKey(activeContextRef.current) !== expectedContextKey
      ) return;
      onReceiptCommittedRef.current({ ...state, relationId: expectedRelationId });
    }).catch(() => undefined).finally(() => {
      deliveryInFlightKeysRef.current.delete(requestKey);
    });
  }, [
    canWriteReceipt,
    contextKey,
    conversationId,
    lastDeliveredMessageId,
    latestIncomingMessage,
    relationId,
  ]);

  useEffect(() => {
    if (
      !canWriteReceipt
      || !isForeground
      || !latestVisibleIncomingMessage
      || latestVisibleIncomingMessage.isOwn
      || latestVisibleIncomingMessage.deliveryState !== 'sent'
      || latestVisibleIncomingMessage.conversationId !== conversationId
      || latestVisibleIncomingMessage.id === lastReadMessageId
    ) return;

    const requestKey = `${conversationId}:read:${latestVisibleIncomingMessage.id}`;
    if (readInFlightKeysRef.current.has(requestKey) || completedKeysRef.current.has(requestKey)) return;

    const expectedGeneration = contextGenerationRef.current;
    const expectedContextKey = contextKey;
    const expectedRelationId = relationId;
    const expectedConversationId = conversationId;
    readInFlightKeysRef.current.add(requestKey);

    void markConversationRead({
      conversationId: expectedConversationId,
      lastReadMessageId: latestVisibleIncomingMessage.id,
    }).then((state) => {
      completedKeysRef.current.add(requestKey);
      if (
        !mountedRef.current
        || contextGenerationRef.current !== expectedGeneration
        || getReceiptContextKey(activeContextRef.current) !== expectedContextKey
      ) return;
      onReceiptCommittedRef.current({ ...state, relationId: expectedRelationId });
    }).catch(() => undefined).finally(() => {
      readInFlightKeysRef.current.delete(requestKey);
    });
  }, [
    canWriteReceipt,
    contextKey,
    conversationId,
    isForeground,
    lastReadMessageId,
    latestVisibleIncomingMessage,
    relationId,
  ]);
};
