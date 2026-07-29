import React, { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { ChatConversationListItem } from '../types/chat';

interface ChatConversationListProps {
  conversations: ChatConversationListItem[];
  activeRelationId: string | null;
  onSelect: (conversation: ChatConversationListItem) => void;
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
    <div
      className={`${className} flex items-center justify-center bg-emerald-50 text-emerald-700`}
      aria-label={`${name} için profil fotoğrafı yok`}
      role="img"
    >
      <UserRound className="h-5 w-5" aria-hidden="true" />
    </div>
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
}) => (
  <div className="min-h-0 flex-1 overflow-y-auto">
    {conversations.map((conversation) => {
      const isActive = conversation.relationId === activeRelationId;
      const lastMessageTime = formatChatConversationTime(conversation.lastMessageAt);

      return (
        <button
          key={conversation.relationId}
          type="button"
          onClick={() => onSelect(conversation)}
          aria-current={isActive ? 'true' : undefined}
          className={`flex w-full items-center gap-4 border-b border-slate-50 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
            isActive ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
          }`}
        >
          <div className="relative shrink-0">
            <ChatClientAvatar
              name={conversation.clientName}
              url={conversation.clientAvatarUrl}
              className="h-12 w-12 rounded-full"
            />
            {conversation.hasUnread && (
              <span
                className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
                aria-hidden="true"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className={`min-w-0 flex-1 truncate text-sm font-semibold ${isActive ? 'text-primary' : 'text-slate-800'}`}>
                {conversation.clientName}
              </h3>
              {lastMessageTime && (
                <time className="shrink-0 text-xs text-slate-400" dateTime={conversation.lastMessageAt ?? undefined}>
                  {lastMessageTime}
                </time>
              )}
            </div>
            <p className="truncate text-sm text-slate-500">
              {conversation.lastMessageBody || 'Henüz mesajlaşma başlamadı'}
            </p>
            {conversation.hasUnread && <span className="sr-only">Okunmamış mesaj</span>}
          </div>
        </button>
      );
    })}
  </div>
);

export default ChatConversationList;
