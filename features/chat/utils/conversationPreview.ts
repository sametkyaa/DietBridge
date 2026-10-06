import type { ChatConversationListItem } from '../types/chat';

export const CHAT_IMAGE_PREVIEW_LABEL = 'Görsel';
export const CHAT_EMPTY_CONVERSATION_LABEL = 'Henüz mesajlaşma başlamadı';

type ChatConversationPreviewSource = Pick<
  ChatConversationListItem,
  'lastMessageId' | 'lastMessageBody' | 'lastMessageKind'
>;

/**
 * Builds the conversation-list preview text for the last message.
 *
 * Image messages carry an optional caption, so a caption-less image row would
 * otherwise render as an empty preview. The label is rendered regardless of the
 * chat image feature flag: rows already committed by another client must never
 * disappear silently from the list.
 */
export const getChatConversationPreview = (
  conversation: ChatConversationPreviewSource,
): string => {
  if (!conversation.lastMessageId) return CHAT_EMPTY_CONVERSATION_LABEL;

  const caption = conversation.lastMessageBody?.trim() ?? '';
  if (conversation.lastMessageKind === 'image') {
    return caption || CHAT_IMAGE_PREVIEW_LABEL;
  }

  return caption || CHAT_EMPTY_CONVERSATION_LABEL;
};

/**
 * List preview with the dietitian's own last message marked "Siz: …" so the
 * dietitian can tell at a glance who wrote last. Read receipts and last-seen
 * presence are intentionally not shown here.
 */
export const getChatConversationPreviewLine = (
  conversation: ChatConversationPreviewSource & Pick<ChatConversationListItem, 'lastMessageSenderId'>,
  currentUserId: string | null | undefined,
): string => {
  const preview = getChatConversationPreview(conversation);
  if (!conversation.lastMessageId || !currentUserId || conversation.lastMessageSenderId !== currentUserId) return preview;
  return `Siz: ${preview}`;
};
