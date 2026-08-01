import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendChatMessage } from '../services/chatService';
import { ChatMessage, ChatServiceError } from '../types/chat';
import { isValidUuid } from '../../../shared/utils/uuid';

const MAX_MESSAGE_BODY_LENGTH = 4000;

export interface OptimisticChatMessage {
  relationId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  deliveryState: 'pending' | 'failed';
  errorMessage: string | null;
}

interface CommittedMessageContext {
  relationId: string;
  activeConversationId: string | null;
}

interface UseChatComposerOptions {
  activeRelationId: string | null;
  activeConversationId: string | null;
  currentUserId?: string;
  serverClientMessageIds: string[];
  onMessageCommitted: (message: ChatMessage, context: CommittedMessageContext) => Promise<void> | void;
}

const getSafeComposerError = (error: unknown): string => (
  error instanceof ChatServiceError ? error.userMessage : 'Mesaj gönderilemedi.'
);

const getDraft = (drafts: ReadonlyMap<string, string>, relationId: string | null): string => (
  relationId ? drafts.get(relationId) ?? '' : ''
);

export const useChatComposer = ({
  activeRelationId,
  activeConversationId,
  currentUserId,
  serverClientMessageIds,
  onMessageCommitted,
}: UseChatComposerOptions) => {
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const [optimisticByRelationId, setOptimisticByRelationId] = useState<Map<string, OptimisticChatMessage[]>>(
    () => new Map(),
  );
  const [composerErrors, setComposerErrors] = useState<Map<string, string>>(() => new Map());
  const [sendingRelationIds, setSendingRelationIds] = useState<Set<string>>(() => new Set());
  const sendingRelationIdsRef = useRef(new Set<string>());

  const draft = useMemo(() => getDraft(drafts, activeRelationId), [activeRelationId, drafts]);
  const optimisticMessages = useMemo(() => (
    activeRelationId ? optimisticByRelationId.get(activeRelationId) ?? [] : []
  ), [activeRelationId, optimisticByRelationId]);
  const composerError = useMemo(() => (
    activeRelationId ? composerErrors.get(activeRelationId) ?? null : null
  ), [activeRelationId, composerErrors]);
  const isSending = Boolean(activeRelationId && sendingRelationIds.has(activeRelationId));

  useEffect(() => {
    if (!activeRelationId || serverClientMessageIds.length === 0) return;
    const committedIds = new Set(serverClientMessageIds);
    setOptimisticByRelationId((currentMessages) => {
      const relationMessages = currentMessages.get(activeRelationId) ?? [];
      const remainingMessages = relationMessages.filter((message) => !committedIds.has(message.clientMessageId));
      if (remainingMessages.length === relationMessages.length) return currentMessages;
      const nextMessages = new Map<string, OptimisticChatMessage[]>(currentMessages);
      if (remainingMessages.length === 0) nextMessages.delete(activeRelationId);
      else nextMessages.set(activeRelationId, remainingMessages);
      return nextMessages;
    });
  }, [activeRelationId, serverClientMessageIds]);

  const setDraft = useCallback((value: string) => {
    if (!activeRelationId) return;
    setDrafts((currentDrafts) => {
      const nextDrafts = new Map<string, string>(currentDrafts);
      nextDrafts.set(activeRelationId, value);
      return nextDrafts;
    });
  }, [activeRelationId]);

  const setComposerError = useCallback((relationId: string, message: string | null) => {
    setComposerErrors((currentErrors) => {
      const nextErrors = new Map<string, string>(currentErrors);
      if (message) nextErrors.set(relationId, message);
      else nextErrors.delete(relationId);
      return nextErrors;
    });
  }, []);

  const updateOptimisticMessage = useCallback((message: OptimisticChatMessage) => {
    setOptimisticByRelationId((currentMessages) => {
      const nextMessages = new Map<string, OptimisticChatMessage[]>(currentMessages);
      const relationMessages = nextMessages.get(message.relationId) ?? [];
      nextMessages.set(
        message.relationId,
        relationMessages.map((item) => (
          item.clientMessageId === message.clientMessageId ? message : item
        )),
      );
      return nextMessages;
    });
  }, []);

  const removeOptimisticMessage = useCallback((relationId: string, clientMessageId: string) => {
    setOptimisticByRelationId((currentMessages) => {
      const nextMessages = new Map<string, OptimisticChatMessage[]>(currentMessages);
      const remainingMessages = (nextMessages.get(relationId) ?? []).filter((message) => (
        message.clientMessageId !== clientMessageId
      ));
      if (remainingMessages.length === 0) nextMessages.delete(relationId);
      else nextMessages.set(relationId, remainingMessages);
      return nextMessages;
    });
  }, []);

  const setRelationSending = useCallback((relationId: string, isRelationSending: boolean) => {
    setSendingRelationIds((currentRelations) => {
      const nextRelations = new Set<string>(currentRelations);
      if (isRelationSending) nextRelations.add(relationId);
      else nextRelations.delete(relationId);
      return nextRelations;
    });
  }, []);

  const deliver = useCallback(async (
    optimisticMessage: OptimisticChatMessage,
    conversationIdAtSend: string | null,
  ) => {
    const { relationId, clientMessageId, body } = optimisticMessage;
    if (sendingRelationIdsRef.current.has(relationId)) return;

    sendingRelationIdsRef.current.add(relationId);
    setRelationSending(relationId, true);
    setComposerError(relationId, null);
    updateOptimisticMessage({ ...optimisticMessage, deliveryState: 'pending', errorMessage: null });

    try {
      const result = await sendChatMessage({ relationId, body, clientMessageId });
      if (conversationIdAtSend) removeOptimisticMessage(relationId, clientMessageId);
      try {
        await onMessageCommitted(result.message, {
          relationId,
          activeConversationId: conversationIdAtSend,
        });
      } catch {
        setComposerError(relationId, 'Mesaj gönderildi ancak liste henüz yenilenemedi.');
      }
    } catch (cause) {
      const errorMessage = getSafeComposerError(cause);
      updateOptimisticMessage({
        ...optimisticMessage,
        deliveryState: 'failed',
        errorMessage,
      });
      setComposerError(relationId, errorMessage);
    } finally {
      sendingRelationIdsRef.current.delete(relationId);
      setRelationSending(relationId, false);
    }
  }, [onMessageCommitted, removeOptimisticMessage, setComposerError, setRelationSending, updateOptimisticMessage]);

  const send = useCallback(async () => {
    const relationId = activeRelationId;
    const body = draft.trim();

    if (!relationId || !isValidUuid(relationId)) {
      if (relationId) setComposerError(relationId, 'Mesaj gönderilemedi.');
      return;
    }
    if (!isValidUuid(currentUserId)) {
      setComposerError(relationId, 'Oturumunuz doğrulanamadı. Lütfen yeniden giriş yapın.');
      return;
    }
    if (!body) {
      setComposerError(relationId, 'Mesaj boş olamaz.');
      return;
    }
    if (Array.from(body).length > MAX_MESSAGE_BODY_LENGTH) {
      setComposerError(relationId, 'Mesaj en fazla 4.000 karakter olabilir.');
      return;
    }
    if (sendingRelationIdsRef.current.has(relationId)) return;
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      setComposerError(relationId, 'Mesaj gönderilemedi. Lütfen tekrar deneyin.');
      return;
    }

    const clientMessageId = crypto.randomUUID();
    if (!isValidUuid(clientMessageId)) {
      setComposerError(relationId, 'Mesaj gönderilemedi. Lütfen tekrar deneyin.');
      return;
    }

    const optimisticMessage: OptimisticChatMessage = {
      relationId,
      clientMessageId,
      body,
      createdAt: new Date().toISOString(),
      deliveryState: 'pending',
      errorMessage: null,
    };

    setOptimisticByRelationId((currentMessages) => {
      const nextMessages = new Map<string, OptimisticChatMessage[]>(currentMessages);
      nextMessages.set(relationId, [...(nextMessages.get(relationId) ?? []), optimisticMessage]);
      return nextMessages;
    });
    setDrafts((currentDrafts) => {
      const nextDrafts = new Map<string, string>(currentDrafts);
      nextDrafts.set(relationId, '');
      return nextDrafts;
    });

    await deliver(optimisticMessage, activeConversationId);
  }, [activeConversationId, activeRelationId, currentUserId, deliver, draft, setComposerError]);

  const retry = useCallback(async (optimisticMessage: OptimisticChatMessage) => {
    const { relationId } = optimisticMessage;
    if (sendingRelationIdsRef.current.has(relationId)) return;
    if (!isValidUuid(relationId) || !isValidUuid(optimisticMessage.clientMessageId)) {
      setComposerError(relationId, 'Mesaj gönderilemedi.');
      return;
    }
    if (!isValidUuid(currentUserId)) {
      setComposerError(relationId, 'Oturumunuz doğrulanamadı. Lütfen yeniden giriş yapın.');
      return;
    }
    await deliver(
      optimisticMessage,
      activeRelationId === relationId ? activeConversationId : null,
    );
  }, [activeConversationId, activeRelationId, currentUserId, deliver, setComposerError]);

  const clearComposerError = useCallback(() => {
    if (activeRelationId) setComposerError(activeRelationId, null);
  }, [activeRelationId, setComposerError]);

  return {
    draft,
    setDraft,
    optimisticMessages,
    isSending,
    composerError,
    send,
    retry,
    clearComposerError,
  };
};
