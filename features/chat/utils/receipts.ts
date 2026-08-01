import { ChatMessage, ChatMessageCursor } from '../types/chat';

export type ChatReceiptState = 'sent' | 'delivered' | 'read';

export const compareMessageToCursor = (
  message: Pick<ChatMessage, 'createdAt' | 'id'>,
  cursor: ChatMessageCursor | null,
): number => {
  if (!cursor) return 1;
  const timestampComparison = message.createdAt.localeCompare(cursor.createdAt);
  return timestampComparison !== 0 ? timestampComparison : message.id.localeCompare(cursor.id);
};

export const getChatReceiptState = (
  message: ChatMessage,
  peerLastDeliveredCursor: ChatMessageCursor | null,
  peerLastReadCursor: ChatMessageCursor | null,
): ChatReceiptState => {
  if (peerLastReadCursor && compareMessageToCursor(message, peerLastReadCursor) <= 0) return 'read';
  if (peerLastDeliveredCursor && compareMessageToCursor(message, peerLastDeliveredCursor) <= 0) return 'delivered';
  return 'sent';
};
