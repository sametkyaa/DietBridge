import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';

export interface ConversationUnreadCount {
  conversationId: string;
  clientId: string;
  unreadCount: number;
}

export class UnreadCountServiceError extends Error {
  constructor(public readonly cause?: unknown) {
    super('Okunmamış mesaj sayısı alınamadı.');
    this.name = 'UnreadCountServiceError';
  }
}

interface UnreadCountRow {
  conversation_id: string;
  client_id: string;
  unread_count: number;
}

/**
 * Server-side unread counts (get_dietitian_unread_counts): non-deleted client
 * messages after the dietitian's read cursor, active relationships only.
 */
export const fetchDietitianUnreadCounts = async (): Promise<ConversationUnreadCount[]> => {
  const { data, error } = await supabase.rpc('get_dietitian_unread_counts');
  if (error || !Array.isArray(data)) {
    console.error('Unread count load failed:', error?.code ?? 'malformed');
    throw new UnreadCountServiceError(error);
  }
  return (data as UnreadCountRow[]).map((row) => {
    if (
      !isValidUuid(row.conversation_id)
      || !isValidUuid(row.client_id)
      || !Number.isInteger(row.unread_count)
      || row.unread_count < 0
    ) {
      throw new UnreadCountServiceError();
    }
    return { conversationId: row.conversation_id, clientId: row.client_id, unreadCount: row.unread_count };
  });
};

export const sumUnreadCounts = (counts: readonly ConversationUnreadCount[]): number => (
  counts.reduce((total, item) => total + item.unreadCount, 0)
);

/**
 * Realtime hint for unread count changes: a new client message moves the
 * conversation's last_message pointer, and opening a conversation writes the
 * read state. RLS limits both streams to the signed-in dietitian.
 */
export const subscribeToUnreadCountChanges = (
  currentUserId: string,
  onChange: () => void,
): (() => void) => {
  if (!isValidUuid(currentUserId)) return () => undefined;
  const channel = supabase
    .channel(`unread-counts:${currentUserId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'chat_conversations',
      filter: `dietitian_id=eq.${currentUserId}`,
    }, onChange)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'chat_read_states',
      filter: `user_id=eq.${currentUserId}`,
    }, onChange);
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
};
