import type { ChatImageAttachment, ChatMessageKind } from './chatImage';

export type { ChatImageAttachment, ChatMessageKind } from './chatImage';

export type ChatMessageDeliveryState = 'pending' | 'sent' | 'failed';

export interface ChatConversationListItem {
  relationId: string;
  conversationId: string | null;
  clientId: string;
  clientName: string;
  clientAvatarUrl: string | null;
  lastMessageId: string | null;
  lastMessageBody: string | null;
  lastMessageKind: ChatMessageKind | null;
  lastMessageSenderId: string | null;
  lastMessageAt: string | null;
  lastDeliveredMessageId: string | null;
  lastReadMessageId: string | null;
  peerLastDeliveredCursor: ChatMessageCursor | null;
  peerLastReadCursor: ChatMessageCursor | null;
  hasUnread: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  isOwn: boolean;
  deliveryState: ChatMessageDeliveryState;
  messageKind: ChatMessageKind;
  attachment: ChatImageAttachment | null;
}

export interface ChatMessageCursor {
  createdAt: string;
  id: string;
}

export interface ChatMessagePage {
  messages: ChatMessage[];
  nextCursor: ChatMessageCursor | null;
}

export interface SendChatMessageInput {
  relationId: string;
  body: string;
  clientMessageId?: string;
}

export interface MarkConversationReadInput {
  conversationId: string;
  lastReadMessageId: string;
}

export interface MarkConversationDeliveredInput {
  conversationId: string;
  lastDeliveredMessageId: string;
}

export interface DeleteChatMessageInput {
  messageId: string;
}

export interface ChatReadState {
  conversationId: string;
  userId: string;
  lastDeliveredMessageId: string | null;
  lastDeliveredAt: string | null;
  lastReadMessageId: string | null;
  lastReadAt: string | null;
}

export interface SendChatMessageResult {
  message: ChatMessage;
  clientMessageId: string;
}

export type ChatServiceErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NETWORK'
  | 'UNKNOWN';

export class ChatServiceError extends Error {
  constructor(
    public readonly code: ChatServiceErrorCode,
    public readonly userMessage: string,
    public readonly originalError?: unknown,
  ) {
    super(userMessage);
    this.name = 'ChatServiceError';
  }
}
