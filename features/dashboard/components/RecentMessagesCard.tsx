import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Card, CardHeader, EmptyState, ErrorState, LoadingState } from '../../../shared/ui';
import type { ChatConversationListItem } from '../../chat/types/chat';
import { getChatConversationPreview } from '../../chat/utils/conversationPreview';

export type RecentMessagesState =
  | { status: 'loading' }
  | { status: 'success'; conversations: ChatConversationListItem[] }
  | { status: 'error' };

const formatMessageTime = (value: string, now = new Date()): string => {
  const date = new Date(value);
  const dayKey = (input: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(input);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  if (dayKey(date) === today) {
    return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(date);
  }
  if (dayKey(date) === yesterday) return 'Dün';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' }).format(date);
};

export interface RecentMessagesCardProps {
  state: RecentMessagesState;
  currentUserId: string | null;
  unreadCountFor: (conversationId: string | null) => number | null;
  onRetry: () => void;
}

/** Last three conversations with a real last message; "Siz:" marks own messages. */
export const RecentMessagesCard = ({ state, currentUserId, unreadCountFor, onRetry }: RecentMessagesCardProps) => {
  const recent = state.status === 'success'
    ? state.conversations
      .filter((conversation) => conversation.lastMessageAt !== null)
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
      .slice(0, 3)
    : [];
  return (
    <Card as="section" aria-labelledby="recent-messages-title">
      <CardHeader id="recent-messages-title" title="Son mesajlar" link={{ to: '/messages', label: 'Tümü' }} />
      {state.status === 'loading' ? (
        <LoadingState label="Mesajlar yükleniyor…" className="py-6" />
      ) : state.status === 'error' ? (
        <ErrorState compact description="Mesajlar yüklenemedi." onRetry={onRetry} />
      ) : recent.length === 0 ? (
        <EmptyState compact icon="chat-circle" title="Henüz mesaj yok." />
      ) : (
        <ul className="m-0 list-none p-0">
          {recent.map((conversation) => {
            const unread = (unreadCountFor(conversation.conversationId) ?? (conversation.hasUnread ? 1 : 0)) > 0;
            const own = currentUserId !== null && conversation.lastMessageSenderId === currentUserId;
            return (
              <Fragment key={conversation.relationId}>
                <li className="border-t border-line first:border-t-0">
                  <Link
                    to={conversation.conversationId
                      ? `/messages?conversationId=${encodeURIComponent(conversation.conversationId)}`
                      : `/messages?clientId=${encodeURIComponent(conversation.clientId)}`}
                    className="flex items-center gap-3 rounded-tag py-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <Avatar name={conversation.clientName} src={conversation.clientAvatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <b className={unread ? 'min-w-0 flex-1 truncate text-13 font-semibold' : 'min-w-0 flex-1 truncate text-13 font-medium'}>
                          {conversation.clientName}
                        </b>
                        {conversation.lastMessageAt && (
                          <span className="shrink-0 text-12 text-ink-3">{formatMessageTime(conversation.lastMessageAt)}</span>
                        )}
                      </div>
                      <p className="m-0 truncate text-13 text-ink-2">
                        {own ? 'Siz: ' : ''}{getChatConversationPreview(conversation)}
                      </p>
                    </div>
                    {unread && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-brand" role="img" aria-label="Okunmamış mesaj" />
                    )}
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
