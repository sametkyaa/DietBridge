import React, { useEffect, useState } from 'react';
import { ChatConversationListItem } from '../types/chat';
import { getChatConversationPreviewLine } from '../utils/conversationPreview';
import { Avatar, CountPill, cx } from '../../../shared/ui';

interface ChatConversationListProps {
  conversations: ChatConversationListItem[];
  activeRelationId: string | null;
  onSelect: (conversation: ChatConversationListItem) => void;
  /** Signed-in dietitian; the own last message is shown as "Siz: …". */
  currentUserId?: string | null;
  /** Unread messages from the client after the read cursor; null while unknown. */
  unreadCountFor?: (conversationId: string | null) => number | null;
}

interface ChatClientAvatarProps {
  name: string;
  url: string | null;
  className: string;
}

export const ChatClientAvatar: React.FC<ChatClientAvatarProps> = ({ name, url, className }) => {
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    setHasImageError(false);
  }, [url]);

  if (url && !hasImageError) {
    return (
      <img
        src={url}
        alt={`${name} profil fotoğrafı`}
        className={`${className} object-cover`}
        onError={() => setHasImageError(true)}
      />
    );
  }

  return (
    <span role="img" aria-label={`${name} için profil fotoğrafı yok`} className={cx(className, 'inline-flex')}>
      <Avatar name={name} decorative className="!h-full !w-full" />
    </span>
  );
};

const formatChatConversationTime = (value: string | null): string => {
  if (!value) return '';

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';

  const now = new Date();
  const isToday = timestamp.getFullYear() === now.getFullYear()
    && timestamp.getMonth() === now.getMonth()
    && timestamp.getDate() === now.getDate();

  if (isToday) {
    return new Intl.DateTimeFormat('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (timestamp.getFullYear() === yesterday.getFullYear()
    && timestamp.getMonth() === yesterday.getMonth()
    && timestamp.getDate() === yesterday.getDate()) {
    return 'Dün';
  }

  if (timestamp.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: 'short',
    }).format(timestamp);
  }

  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp);
};

const ChatConversationList: React.FC<ChatConversationListProps> = ({
  conversations,
  activeRelationId,
  onSelect,
  currentUserId = null,
  unreadCountFor,
}) => (
  <div className="min-h-0 flex-1 overflow-y-auto">
    {conversations.map((conversation) => {
      const isActive = conversation.relationId === activeRelationId;
      const lastMessageTime = formatChatConversationTime(conversation.lastMessageAt);
      const unreadCount = unreadCountFor?.(conversation.conversationId) ?? null;
      const showUnread = unreadCount !== null ? unreadCount > 0 : conversation.hasUnread;

      return (
        <button
          key={conversation.relationId}
          type="button"
          onClick={() => onSelect(conversation)}
          aria-current={isActive ? 'true' : undefined}
          className={cx(
            'flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
            isActive ? 'bg-brand-tint' : 'hover:bg-surface-hover',
          )}
        >
          <ChatClientAvatar
            name={conversation.clientName}
            url={conversation.clientAvatarUrl}
            className="h-10 w-10 shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className={cx('m-0 min-w-0 flex-1 truncate text-14', showUnread ? 'font-bold text-ink' : 'font-semibold', isActive && 'text-brand')}>
                {conversation.clientName}
              </h3>
              {lastMessageTime && (
                <time className="shrink-0 text-12 text-ink-3" dateTime={conversation.lastMessageAt ?? undefined}>
                  {lastMessageTime}
                </time>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <p className={cx('m-0 min-w-0 flex-1 truncate text-13', showUnread ? 'font-medium text-ink' : 'text-ink-2')}>
                {getChatConversationPreviewLine(conversation, currentUserId)}
              </p>
              {showUnread && (
                unreadCount !== null && unreadCount > 0
                  ? <CountPill count={unreadCount} tone="brand" label={`${unreadCount} okunmamış mesaj`} />
                  : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
              )}
            </div>
            {showUnread && unreadCount === null && <span className="sr-only">Okunmamış mesaj</span>}
          </div>
        </button>
      );
    })}
  </div>
);

export default ChatConversationList;
