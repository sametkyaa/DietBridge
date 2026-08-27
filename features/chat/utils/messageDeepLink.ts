import { isValidUuid } from '../../../shared/utils/uuid';
import type { ChatConversationListItem } from '../types/chat';

export type ConversationSelectionSource = 'conversationId' | 'clientId';

export type ConversationSelection =
  | { status: 'pending'; hasQuery: boolean }
  | { status: 'resolved'; source: ConversationSelectionSource; conversation: ChatConversationListItem }
  | { status: 'fallback'; hasQuery: boolean; conversation: ChatConversationListItem | null };

interface ConversationSelectionOptions {
  isLoading: boolean;
  hasLoaded: boolean;
}

export const resolveConversationSelection = (
  conversations: readonly ChatConversationListItem[],
  requestedConversationId: string | null,
  requestedClientId: string | null,
  { isLoading, hasLoaded }: ConversationSelectionOptions,
): ConversationSelection => {
  const hasQuery = Boolean(requestedConversationId || requestedClientId);
  const hasValidRequest = Boolean(
    (requestedConversationId && isValidUuid(requestedConversationId))
    || (requestedClientId && isValidUuid(requestedClientId)),
  );

  // The first render can happen before the conversation hook starts its
  // request. Keep every query-driven selection pending until that request has
  // completed, including an initially empty list.
  if (isLoading || !hasLoaded) return { status: 'pending', hasQuery: hasValidRequest || hasQuery };

  if (requestedConversationId && isValidUuid(requestedConversationId)) {
    const conversation = conversations.find(
      (item) => item.conversationId === requestedConversationId,
    );
    if (conversation) return { status: 'resolved', source: 'conversationId', conversation };
  }

  if (requestedClientId && isValidUuid(requestedClientId)) {
    const conversation = conversations.find((item) => item.clientId === requestedClientId);
    if (conversation) return { status: 'resolved', source: 'clientId', conversation };
  }

  return {
    status: 'fallback',
    hasQuery,
    conversation: conversations[0] ?? null,
  };
};

export const resolveConversationFromQuery = (
  conversations: readonly ChatConversationListItem[],
  requestedConversationId: string | null,
  requestedClientId: string | null,
): ChatConversationListItem | null => {
  const selection = resolveConversationSelection(
    conversations,
    requestedConversationId,
    requestedClientId,
    { isLoading: false, hasLoaded: true },
  );
  return selection.status === 'resolved' ? selection.conversation : null;
};
