export interface InitialChatPositionInput {
  conversationId: string | null;
  isLoading: boolean;
  latestTimelineKey: string | null;
  hasPendingImageLayout: boolean;
  hasPendingOlderLoad: boolean;
  positionedConversationId: string | null;
}

export const shouldPositionInitialChat = ({
  conversationId,
  isLoading,
  latestTimelineKey,
  hasPendingImageLayout,
  hasPendingOlderLoad,
  positionedConversationId,
}: InitialChatPositionInput): boolean => Boolean(
  conversationId
  && !isLoading
  && latestTimelineKey
  && !hasPendingImageLayout
  && !hasPendingOlderLoad
  && positionedConversationId !== conversationId,
);

export interface FollowLatestChatInput {
  conversationId: string | null;
  latestTimelineKey: string | null;
  previousTimelineKey: string | null;
  isNearBottom: boolean;
  hasPendingOlderLoad: boolean;
  positionedConversationId: string | null;
}

export const shouldFollowLatestChat = ({
  conversationId,
  latestTimelineKey,
  previousTimelineKey,
  isNearBottom,
  hasPendingOlderLoad,
  positionedConversationId,
}: FollowLatestChatInput): boolean => Boolean(
  conversationId
  && latestTimelineKey
  && previousTimelineKey
  && previousTimelineKey !== latestTimelineKey
  && isNearBottom
  && !hasPendingOlderLoad
  && positionedConversationId === conversationId,
);

export interface InitialChatLayoutAdjustmentInput {
  conversationId: string | null;
  positionedConversationId: string | null;
  distanceFromBottom: number;
  adjustedConversationId: string | null;
  isNearBottom: boolean;
}

export const shouldAdjustInitialChatLayout = ({
  conversationId,
  positionedConversationId,
  distanceFromBottom,
  adjustedConversationId,
  isNearBottom,
}: InitialChatLayoutAdjustmentInput): boolean => Boolean(
  conversationId
  && positionedConversationId === conversationId
  && distanceFromBottom > 1
  && adjustedConversationId !== conversationId
  && isNearBottom,
);
