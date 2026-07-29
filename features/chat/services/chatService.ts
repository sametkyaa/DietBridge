import { supabase } from '../../../lib/supabaseClient';
import { resolveProfilePhotoUrl } from '../../../shared/utils/avatarUrl';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  CHAT_IMAGE_BUCKET_ID,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_EDGE_PIXELS,
  CHAT_IMAGE_MAX_TOTAL_PIXELS,
  CHAT_IMAGE_MIME_TYPE,
  CHAT_IMAGE_OBJECT_PATH_PATTERN,
  ChatImageAttachment,
  ChatMessageKind,
  isChatMessageKind,
} from '../types/chatImage';
import {
  ChatConversationListItem,
  ChatReadState,
  ChatMessage,
  ChatMessageCursor,
  ChatMessagePage,
  ChatServiceError,
  ChatServiceErrorCode,
  DeleteChatMessageInput,
  MarkConversationDeliveredInput,
  MarkConversationReadInput,
  SendChatMessageInput,
  SendChatMessageResult,
} from '../types/chat';

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_BODY_LENGTH = 4000;

/**
 * Canonical message projection used by every history/list read.
 *
 * `attachment` is an embedded to-one join: `chat_attachments.message_id` is
 * unique in the dormant image schema. Realtime `postgres_changes` payloads
 * cannot carry the join, so image rows arriving over Realtime are reconciled
 * with a refetch instead of being rendered from the raw payload.
 */
const CHAT_MESSAGE_SELECT = [
  'id',
  'conversation_id',
  'sender_id',
  'client_message_id',
  'body',
  'message_kind',
  'created_at',
  'deleted_at',
  'deleted_by',
  'attachment:chat_attachments(id, message_id, bucket_id, object_path, mime_type, byte_size, width, height, deleted_at)',
].join(', ');
const FALLBACK_CLIENT_NAME = 'İsimsiz danışan';

type UnknownRecord = Record<string, unknown>;

export type ChatRealtimeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ChatSubscription {
  unsubscribe: () => Promise<void>;
}

interface SubscribeToChatMessagesOptions {
  conversationId: string;
  currentUserId: string;
  onMessage: (message: ChatMessage) => void;
  /**
   * Called when a Realtime row cannot be trusted from the payload alone and
   * must be re-read with the attachment join.
   */
  onReconcile?: (messageId: string) => void;
  onStatus?: (status: ChatRealtimeStatus) => void;
}

interface SubscribeToChatUserChangesOptions {
  currentUserId: string;
  onChange: () => void;
  onStatus?: (status: ChatRealtimeStatus) => void;
}

interface ActiveRelationship {
  relationId: string;
  clientId: string;
  clientName: string;
  storedAvatarUrl: string | null;
}

interface ChatConversationRow {
  id: string;
  relationId: string;
  lastMessageId: string | null;
  lastMessageAt: string | null;
}

interface ChatReadStateRow {
  conversationId: string;
  userId: string;
  lastDeliveredMessageId: string | null;
  lastDeliveredAt: string | null;
  lastReadMessageId: string | null;
  lastReadAt: string | null;
}

const asRecord = (value: unknown): UnknownRecord | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
);

const asRecords = (value: unknown): UnknownRecord[] => (
  Array.isArray(value)
    ? value.map(asRecord).filter((record): record is UnknownRecord => record !== null)
    : []
);

const firstRecord = (value: unknown): UnknownRecord | null => {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
};

const getNullableString = (record: UnknownRecord, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' ? value : null;
};

const normalizeIsoTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

const createValidationError = (field: string): ChatServiceError => (
  new ChatServiceError(
    'VALIDATION',
    'Mesaj bilgisi geçersiz. Lütfen bilgileri kontrol edip tekrar deneyin.',
    new Error(`Invalid chat field: ${field}`),
  )
);

const assertUuid = (value: unknown, field: string): string => {
  if (!isValidUuid(value)) throw createValidationError(field);
  return value;
};

const getErrorProperty = (error: unknown, key: string): unknown => {
  const record = asRecord(error);
  return record?.[key];
};

const toChatServiceError = (error: unknown): ChatServiceError => {
  if (error instanceof ChatServiceError) return error;

  const databaseCode = getErrorProperty(error, 'code');
  const status = getErrorProperty(error, 'status');
  const message = typeof getErrorProperty(error, 'message') === 'string'
    ? String(getErrorProperty(error, 'message')).toLowerCase()
    : '';

  let code: ChatServiceErrorCode = 'UNKNOWN';
  let userMessage = 'Mesaj işlemi şu anda tamamlanamadı. Lütfen tekrar deneyin.';

  if (status === 401) {
    code = 'UNAUTHENTICATED';
    userMessage = 'Oturumunuz doğrulanamadı. Lütfen yeniden giriş yapın.';
  } else if (status === 403 || databaseCode === '42501') {
    code = 'FORBIDDEN';
    userMessage = 'Bu mesaj işlemine erişim izniniz yok.';
  } else if (status === 404 || databaseCode === 'PGRST116') {
    code = 'NOT_FOUND';
    userMessage = 'İstenen mesaj kaydı bulunamadı.';
  } else if (status === 409 || databaseCode === '23505') {
    code = 'CONFLICT';
    userMessage = 'Mesaj işlemi mevcut kayıtla çakıştı. Lütfen tekrar deneyin.';
  } else if (databaseCode === '22023' || databaseCode === '23514' || databaseCode === '22P02') {
    code = 'VALIDATION';
    userMessage = 'Mesaj bilgisi geçersiz. Lütfen bilgileri kontrol edip tekrar deneyin.';
  } else if (message.includes('network') || message.includes('failed to fetch')) {
    code = 'NETWORK';
    userMessage = 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  }

  return new ChatServiceError(code, userMessage, error);
};

const normalizeActiveRelationships = (
  data: unknown,
  dietitianId: string,
): ActiveRelationship[] => {
  const deduplicated = new Map<string, ActiveRelationship>();

  for (const row of asRecords(data)) {
    const relationId = getNullableString(row, 'id');
    const rowDietitianId = getNullableString(row, 'dietitian_id');
    const clientId = getNullableString(row, 'client_id');
    const status = getNullableString(row, 'status');
    const client = firstRecord(row.client);

    if (
      !isValidUuid(relationId)
      || rowDietitianId !== dietitianId
      || !isValidUuid(clientId)
      || status !== 'active'
      || !client
    ) {
      continue;
    }

    const profileId = getNullableString(client, 'id');
    if (profileId !== clientId) continue;

    const fullName = getNullableString(client, 'full_name')?.trim();
    const avatarUrl = getNullableString(client, 'avatar_url');
    deduplicated.set(relationId, {
      relationId,
      clientId,
      clientName: fullName || FALLBACK_CLIENT_NAME,
      storedAvatarUrl: avatarUrl,
    });
  }

  return [...deduplicated.values()];
};

const normalizeConversationRows = (
  data: unknown,
  relationIds: ReadonlySet<string>,
): ChatConversationRow[] => {
  const deduplicated = new Map<string, ChatConversationRow>();

  for (const row of asRecords(data)) {
    const id = getNullableString(row, 'id');
    const relationId = getNullableString(row, 'dietitian_client_id');
    const lastMessageId = getNullableString(row, 'last_message_id');
    const lastMessageAt = normalizeIsoTimestamp(row.last_message_at);

    if (!isValidUuid(id) || !relationId || !relationIds.has(relationId)) continue;
    if ((lastMessageId === null) !== (lastMessageAt === null)) continue;
    if (lastMessageId !== null && !isValidUuid(lastMessageId)) continue;

    deduplicated.set(relationId, { id, relationId, lastMessageId, lastMessageAt });
  }

  return [...deduplicated.values()];
};

const isPositiveInteger = (value: unknown, maximum: number): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 1
  && value <= maximum
);

/**
 * Validates embedded `chat_attachments` metadata against the canonical
 * JPEG-only contract. Anything outside the contract is rejected fail-closed so
 * a malformed row can never be rendered as a trusted image.
 */
const normalizeChatImageAttachment = (
  value: unknown,
  expectedMessageId: string,
): ChatImageAttachment | null => {
  const row = firstRecord(value);
  if (!row) return null;

  const id = getNullableString(row, 'id');
  const messageId = getNullableString(row, 'message_id');
  const bucketId = getNullableString(row, 'bucket_id');
  const objectPath = getNullableString(row, 'object_path');
  const mimeType = getNullableString(row, 'mime_type');
  const byteSize = row.byte_size;
  const width = row.width;
  const height = row.height;
  const deletedAt = normalizeIsoTimestamp(row.deleted_at);

  if (
    !isValidUuid(id)
    || !isValidUuid(messageId)
    || messageId !== expectedMessageId
    || bucketId !== CHAT_IMAGE_BUCKET_ID
    || !objectPath
    || !CHAT_IMAGE_OBJECT_PATH_PATTERN.test(objectPath)
    || mimeType !== CHAT_IMAGE_MIME_TYPE
    || !isPositiveInteger(byteSize, CHAT_IMAGE_MAX_BYTES)
    || !isPositiveInteger(width, CHAT_IMAGE_MAX_EDGE_PIXELS)
    || !isPositiveInteger(height, CHAT_IMAGE_MAX_EDGE_PIXELS)
    || width * height > CHAT_IMAGE_MAX_TOTAL_PIXELS
  ) {
    return null;
  }

  return {
    id,
    messageId,
    bucketId,
    objectPath,
    mimeType,
    byteSize,
    width,
    height,
    deletedAt,
  };
};

/**
 * Resolves `message_kind`. A missing value stays backward compatible with rows
 * written before the image schema; any unknown value is rejected.
 */
const resolveMessageKind = (value: unknown): ChatMessageKind | null => {
  if (value === undefined || value === null) return 'text';
  return isChatMessageKind(value) ? value : null;
};

const normalizeChatMessageRow = (
  value: unknown,
  currentUserId: string,
): ChatMessage | null => {
  const row = asRecord(value);
  if (!row) return null;

  const id = getNullableString(row, 'id');
  const conversationId = getNullableString(row, 'conversation_id');
  const senderId = getNullableString(row, 'sender_id');
  const clientMessageId = getNullableString(row, 'client_message_id');
  const rawBody = getNullableString(row, 'body');
  const createdAt = normalizeIsoTimestamp(row.created_at);
  const deletedAt = normalizeIsoTimestamp(row.deleted_at);
  const deletedBy = getNullableString(row, 'deleted_by');
  const messageKind = resolveMessageKind(row.message_kind);

  if (
    !isValidUuid(id)
    || !isValidUuid(conversationId)
    || !isValidUuid(senderId)
    || !isValidUuid(clientMessageId)
    || !createdAt
    || messageKind === null
    || (deletedAt !== null && (rawBody !== null || !isValidUuid(deletedBy)))
  ) {
    return null;
  }

  // Tombstones keep their existing contract for both kinds: no body, no
  // readable attachment, and a recorded deleter.
  if (deletedAt !== null) {
    return {
      id,
      conversationId,
      senderId,
      clientMessageId,
      body: null,
      createdAt,
      deletedAt,
      deletedBy,
      isOwn: senderId === currentUserId,
      deliveryState: 'sent',
      messageKind,
      attachment: null,
    };
  }

  if (deletedBy !== null) return null;

  const trimmedBody = rawBody === null ? null : rawBody.trim();
  if (trimmedBody !== null && Array.from(trimmedBody).length > MAX_MESSAGE_BODY_LENGTH) {
    return null;
  }

  const rawAttachment = row.attachment;
  const attachment = rawAttachment === undefined || rawAttachment === null
    ? null
    : normalizeChatImageAttachment(rawAttachment, id);

  let body: string | null;
  if (messageKind === 'image') {
    // Live image rows require complete, live attachment metadata. The caption
    // is optional and an empty caption normalizes to null.
    if (!attachment || attachment.deletedAt !== null) return null;
    body = trimmedBody ? trimmedBody : null;
  } else {
    // Live text rows keep the mandatory body contract and must not carry a
    // live attachment.
    if (!trimmedBody) return null;
    if (attachment && attachment.deletedAt === null) return null;
    body = trimmedBody;
  }

  return {
    id,
    conversationId,
    senderId,
    clientMessageId,
    body,
    createdAt,
    deletedAt,
    deletedBy,
    isOwn: senderId === currentUserId,
    deliveryState: 'sent',
    messageKind,
    attachment: messageKind === 'image' ? attachment : null,
  };
};

const normalizeReadStateRows = (data: unknown): ChatReadStateRow[] => {
  const deduplicated = new Map<string, ChatReadStateRow>();

  for (const row of asRecords(data)) {
    const conversationId = getNullableString(row, 'conversation_id');
    const userId = getNullableString(row, 'user_id');
    const lastDeliveredMessageId = getNullableString(row, 'last_delivered_message_id');
    const lastDeliveredAt = normalizeIsoTimestamp(row.last_delivered_at);
    const lastReadMessageId = getNullableString(row, 'last_read_message_id');
    const lastReadAt = normalizeIsoTimestamp(row.last_read_at);

    if (!isValidUuid(conversationId) || !isValidUuid(userId)) continue;
    if ((lastDeliveredMessageId === null) !== (lastDeliveredAt === null)) continue;
    if (lastDeliveredMessageId !== null && !isValidUuid(lastDeliveredMessageId)) continue;
    if ((lastReadMessageId === null) !== (lastReadAt === null)) continue;
    if (lastReadMessageId !== null && !isValidUuid(lastReadMessageId)) continue;
    deduplicated.set(`${conversationId}:${userId}`, {
      conversationId,
      userId,
      lastDeliveredMessageId,
      lastDeliveredAt,
      lastReadMessageId,
      lastReadAt,
    });
  }

  return [...deduplicated.values()];
};

const compareConversationListItems = (
  left: ChatConversationListItem,
  right: ChatConversationListItem,
): number => {
  if (left.lastMessageAt && right.lastMessageAt) {
    const timestampDifference = Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt);
    if (timestampDifference !== 0) return timestampDifference;
    return (left.conversationId ?? left.relationId).localeCompare(right.conversationId ?? right.relationId);
  }

  if (left.lastMessageAt) return -1;
  if (right.lastMessageAt) return 1;

  const nameDifference = left.clientName.localeCompare(right.clientName, 'tr');
  return nameDifference !== 0 ? nameDifference : left.relationId.localeCompare(right.relationId);
};

const throwUnexpectedPayload = (resource: string): never => {
  throw new ChatServiceError(
    'UNKNOWN',
    'Mesaj işlemi beklenmeyen bir yanıt döndürdü. Lütfen tekrar deneyin.',
    new Error(`Unexpected ${resource} payload`),
  );
};

const notifyRealtimeStatus = (
  status: string,
  onStatus?: (status: ChatRealtimeStatus) => void,
): void => {
  if (!onStatus) return;

  switch (status) {
    case 'SUBSCRIBED':
      onStatus('connected');
      return;
    case 'CHANNEL_ERROR':
    case 'TIMED_OUT':
      onStatus('error');
      return;
    case 'CLOSED':
      onStatus('disconnected');
      return;
    default:
      onStatus('connecting');
  }
};

const createNoopSubscription = (): ChatSubscription => ({
  unsubscribe: async () => undefined,
});

const createChatSubscription = (
  channel: ReturnType<typeof supabase.channel>,
): ChatSubscription => {
  let removal: Promise<void> | null = null;

  return {
    unsubscribe: () => {
      if (!removal) {
        removal = supabase.removeChannel(channel)
          .then(() => undefined)
          .catch(() => undefined);
      }
      return removal;
    },
  };
};

const fetchLastMessages = async (
  messageIds: string[],
  currentUserId: string,
): Promise<ChatMessage[]> => {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase
    .from('chat_messages')
    .select(CHAT_MESSAGE_SELECT)
    .in('id', messageIds)
    .not('conversation_id', 'is', null);

  if (error) throw toChatServiceError(error);

  return asRecords(data)
    .map((row) => normalizeChatMessageRow(row, currentUserId))
    .filter((message): message is ChatMessage => message !== null);
};

const fetchChatReadStates = async (
  conversationIds: string[],
): Promise<ChatReadStateRow[]> => {
  if (conversationIds.length === 0) return [];

  const { data, error } = await supabase
    .from('chat_read_states')
    .select('conversation_id, user_id, last_delivered_message_id, last_delivered_at, last_read_message_id, last_read_at')
    .in('conversation_id', conversationIds);

  if (error) throw toChatServiceError(error);

  return normalizeReadStateRows(data);
};

/**
 * Re-reads a single message with its attachment join.
 *
 * Realtime `postgres_changes` payloads carry only the `chat_messages` row, so
 * an image INSERT arrives without the embedded `chat_attachments` metadata and
 * cannot be normalized fail-closed. This targeted read resolves the canonical
 * row without waiting for a reconnect-driven full refetch.
 *
 * `null` means "not readable yet": the caller must not synthesize a partial
 * message from the Realtime payload.
 */
export const fetchChatMessageById = async (
  messageId: string,
  conversationId: string,
  currentUserId: string,
): Promise<ChatMessage | null> => {
  const normalizedMessageId = assertUuid(messageId, 'messageId');
  const normalizedConversationId = assertUuid(conversationId, 'conversationId');
  const normalizedCurrentUserId = assertUuid(currentUserId, 'currentUserId');

  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_SELECT)
      .eq('id', normalizedMessageId)
      .eq('conversation_id', normalizedConversationId)
      .limit(1);

    if (error) throw toChatServiceError(error);

    const row = asRecords(data)[0];
    if (!row) return null;

    const message = normalizeChatMessageRow(row, normalizedCurrentUserId);
    if (!message || message.id !== normalizedMessageId) return null;
    if (message.conversationId !== normalizedConversationId) return null;
    return message;
  } catch (error) {
    throw toChatServiceError(error);
  }
};

const toCursor = (id: string | null, createdAt: string | null): ChatMessageCursor | null => (
  id && createdAt ? { id, createdAt } : null
);

export const fetchChatConversations = async (
  dietitianId: string,
): Promise<ChatConversationListItem[]> => {
  const normalizedDietitianId = assertUuid(dietitianId, 'dietitianId');

  try {
    const { data: relationData, error: relationError } = await supabase
      .from('dietitian_clients')
      .select(`
        id,
        dietitian_id,
        client_id,
        status,
        client:client_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .eq('dietitian_id', normalizedDietitianId)
      .eq('status', 'active');

    if (relationError) throw toChatServiceError(relationError);

    const relationships = normalizeActiveRelationships(relationData, normalizedDietitianId);
    if (relationships.length === 0) return [];

    const relationIds = relationships.map((relationship) => relationship.relationId);
    const relationIdSet = new Set(relationIds);
    const { data: conversationData, error: conversationError } = await supabase
      .from('chat_conversations')
      .select('id, dietitian_client_id, last_message_id, last_message_at')
      .eq('dietitian_id', normalizedDietitianId)
      .in('dietitian_client_id', relationIds);

    if (conversationError) throw toChatServiceError(conversationError);

    const conversations = normalizeConversationRows(conversationData, relationIdSet);
    const conversationByRelationId = new Map(
      conversations.map((conversation) => [conversation.relationId, conversation]),
    );
    const lastMessageIds = conversations
      .map((conversation) => conversation.lastMessageId)
      .filter((id): id is string => id !== null);
    const conversationIds = conversations.map((conversation) => conversation.id);

    const [lastMessages, readStates] = await Promise.all([
      fetchLastMessages(lastMessageIds, normalizedDietitianId),
      fetchChatReadStates(conversationIds),
    ]);
    const lastMessageById = new Map(lastMessages.map((message) => [message.id, message]));
    const readStateByConversationAndUserId = new Map(
      readStates.map((readState) => [`${readState.conversationId}:${readState.userId}`, readState]),
    );

    const listItems = await Promise.all(relationships.map(async (relationship) => {
      const conversation = conversationByRelationId.get(relationship.relationId);
      const resolvedLastMessage = conversation?.lastMessageId
        ? lastMessageById.get(conversation.lastMessageId) ?? null
        : null;
      const lastMessage = resolvedLastMessage?.conversationId === conversation?.id
        ? resolvedLastMessage
        : null;
      const ownReadState = conversation
        ? readStateByConversationAndUserId.get(`${conversation.id}:${normalizedDietitianId}`) ?? null
        : null;
      const peerReadState = conversation
        ? readStateByConversationAndUserId.get(`${conversation.id}:${relationship.clientId}`) ?? null
        : null;
      const clientAvatarUrl = await resolveProfilePhotoUrl(relationship.storedAvatarUrl, {
        subjectUserId: relationship.clientId,
        allowPrivatePath: true,
      });

      return {
        relationId: relationship.relationId,
        conversationId: conversation?.id ?? null,
        clientId: relationship.clientId,
        clientName: relationship.clientName,
        clientAvatarUrl,
        lastMessageId: lastMessage?.id ?? null,
        lastMessageBody: lastMessage?.body ?? null,
        lastMessageKind: lastMessage?.messageKind ?? null,
        lastMessageSenderId: lastMessage?.senderId ?? null,
        lastMessageAt: lastMessage?.createdAt ?? null,
        lastDeliveredMessageId: ownReadState?.lastDeliveredMessageId ?? null,
        lastReadMessageId: ownReadState?.lastReadMessageId ?? null,
        peerLastDeliveredCursor: toCursor(
          peerReadState?.lastDeliveredMessageId ?? null,
          peerReadState?.lastDeliveredAt ?? null,
        ),
        peerLastReadCursor: toCursor(
          peerReadState?.lastReadMessageId ?? null,
          peerReadState?.lastReadAt ?? null,
        ),
        hasUnread: Boolean(
          lastMessage
          && lastMessage.senderId !== normalizedDietitianId
           && ownReadState?.lastReadMessageId !== lastMessage.id,
        ),
      } satisfies ChatConversationListItem;
    }));

    return listItems.sort(compareConversationListItems);
  } catch (error) {
    throw toChatServiceError(error);
  }
};

export const fetchChatMessages = async (
  conversationId: string,
  currentUserId: string,
  options?: { before?: ChatMessageCursor; limit?: number },
): Promise<ChatMessagePage> => {
  const normalizedConversationId = assertUuid(conversationId, 'conversationId');
  const normalizedCurrentUserId = assertUuid(currentUserId, 'currentUserId');
  const requestedLimit = options?.limit ?? DEFAULT_MESSAGE_PAGE_SIZE;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_MESSAGE_PAGE_SIZE) {
    throw createValidationError('limit');
  }

  let before: ChatMessageCursor | undefined;
  if (options?.before) {
    const createdAt = normalizeIsoTimestamp(options.before.createdAt);
    const id = options.before.id;
    if (!createdAt || !isValidUuid(id)) throw createValidationError('before');
    before = { createdAt, id };
  }

  try {
    const baseQuery = supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_SELECT)
      .eq('conversation_id', normalizedConversationId)
      .not('conversation_id', 'is', null);
    const filteredQuery = before
      ? baseQuery.or(
        `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
      )
      : baseQuery;
    const { data, error } = await filteredQuery
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(requestedLimit + 1);

    if (error) throw toChatServiceError(error);

    const uniqueMessages = new Map<string, ChatMessage>();
    const clientMessageIds = new Set<string>();
    for (const row of asRecords(data)) {
      const message = normalizeChatMessageRow(row, normalizedCurrentUserId);
      if (!message) throwUnexpectedPayload('chat message');
      if (uniqueMessages.has(message.id) || clientMessageIds.has(message.clientMessageId)) continue;
      uniqueMessages.set(message.id, message);
      clientMessageIds.add(message.clientMessageId);
    }

    const messagesDescending = [...uniqueMessages.values()];
    const hasMore = messagesDescending.length > requestedLimit;
    const pageMessages = messagesDescending.slice(0, requestedLimit);
    const oldestMessage = pageMessages.at(-1) ?? null;

    return {
      messages: [...pageMessages].reverse(),
      nextCursor: hasMore && oldestMessage
        ? { createdAt: oldestMessage.createdAt, id: oldestMessage.id }
        : null,
    };
  } catch (error) {
    throw toChatServiceError(error);
  }
};

export const sendChatMessage = async (
  input: SendChatMessageInput,
): Promise<SendChatMessageResult> => {
  const relationId = assertUuid(input.relationId, 'relationId');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || Array.from(body).length > MAX_MESSAGE_BODY_LENGTH) {
    throw createValidationError('body');
  }

  const clientMessageId = input.clientMessageId === undefined
    ? crypto.randomUUID()
    : assertUuid(input.clientMessageId, 'clientMessageId');

  try {
    const { data, error } = await supabase.rpc('send_chat_message', {
      p_dietitian_client_id: relationId,
      p_client_message_id: clientMessageId,
      p_body: body,
    });

    if (error) throw toChatServiceError(error);

    const rawMessage = asRecord(data);
    const senderId = rawMessage ? getNullableString(rawMessage, 'sender_id') : null;
    const message = normalizeChatMessageRow(data, senderId ?? '');
    if (!message || message.clientMessageId !== clientMessageId) {
      throwUnexpectedPayload('send_chat_message');
    }

    return { message, clientMessageId };
  } catch (error) {
    throw toChatServiceError(error);
  }
};

const toChatReadState = (value: unknown, expectedConversationId: string): ChatReadState => {
  const readState = normalizeReadStateRows([value])[0] ?? null;
  if (!readState || readState.conversationId !== expectedConversationId) {
    throwUnexpectedPayload('chat read-state');
  }
  return readState;
};

export const deleteChatMessage = async (
  input: DeleteChatMessageInput,
): Promise<ChatMessage> => {
  const messageId = assertUuid(input.messageId, 'messageId');

  try {
    const { data, error } = await supabase.rpc('delete_chat_message', { p_message_id: messageId });
    if (error) throw toChatServiceError(error);

    const rawMessage = asRecord(data);
    const senderId = rawMessage ? getNullableString(rawMessage, 'sender_id') : null;
    const message = normalizeChatMessageRow(data, senderId ?? '');
    if (!message || message.id !== messageId || message.deletedAt === null) {
      throwUnexpectedPayload('delete_chat_message');
    }
    return message;
  } catch (error) {
    throw toChatServiceError(error);
  }
};

export const markConversationDelivered = async (
  input: MarkConversationDeliveredInput,
): Promise<ChatReadState> => {
  const conversationId = assertUuid(input.conversationId, 'conversationId');
  const lastDeliveredMessageId = assertUuid(input.lastDeliveredMessageId, 'lastDeliveredMessageId');

  try {
    const { data, error } = await supabase.rpc('mark_chat_conversation_delivered', {
      p_conversation_id: conversationId,
      p_last_delivered_message_id: lastDeliveredMessageId,
    });
    if (error) throw toChatServiceError(error);
    return toChatReadState(data, conversationId);
  } catch (error) {
    throw toChatServiceError(error);
  }
};

export const markConversationRead = async (
  input: MarkConversationReadInput,
): Promise<ChatReadState> => {
  const conversationId = assertUuid(input.conversationId, 'conversationId');
  const lastReadMessageId = assertUuid(input.lastReadMessageId, 'lastReadMessageId');

  try {
    const { data, error } = await supabase.rpc('mark_chat_conversation_read', {
      p_conversation_id: conversationId,
      p_last_read_message_id: lastReadMessageId,
    });

    if (error) throw toChatServiceError(error);

    const readState = toChatReadState(data, conversationId);
    if (!readState.lastReadMessageId) {
      throwUnexpectedPayload('mark_chat_conversation_read');
    }
    return readState;
  } catch (error) {
    throw toChatServiceError(error);
  }
};

export const subscribeToChatMessages = (
  options: SubscribeToChatMessagesOptions,
): ChatSubscription => {
  const { conversationId, currentUserId, onMessage, onReconcile, onStatus } = options;
  if (!isValidUuid(conversationId) || !isValidUuid(currentUserId)) {
    return createNoopSubscription();
  }

  /**
   * Realtime payloads never contain the embedded attachment join, so an image
   * row (or any row the normalizer rejects) is handed to the reconciler
   * instead of being rendered from the raw payload. Text rows keep the
   * existing fast path.
   */
  const handleRealtimeRow = (row: unknown): void => {
    const record = asRecord(row);
    const rowConversationId = record ? getNullableString(record, 'conversation_id') : null;
    if (rowConversationId !== conversationId) return;

    const message = normalizeChatMessageRow(row, currentUserId);
    if (message && message.conversationId === conversationId) {
      onMessage(message);
      return;
    }

    const rowId = record ? getNullableString(record, 'id') : null;
    if (onReconcile && isValidUuid(rowId)) onReconcile(rowId);
  };

  const channel = supabase
    .channel(`chat-messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => handleRealtimeRow(payload.new),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => handleRealtimeRow(payload.new),
    );

  channel.subscribe((status) => notifyRealtimeStatus(status, onStatus));
  return createChatSubscription(channel);
};

export const subscribeToChatConversations = (
  options: SubscribeToChatUserChangesOptions,
): ChatSubscription => {
  const { currentUserId, onChange, onStatus } = options;
  if (!isValidUuid(currentUserId)) return createNoopSubscription();

  const channel = supabase
    .channel(`chat-conversations:${currentUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_conversations',
        filter: `dietitian_id=eq.${currentUserId}`,
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_conversations',
        filter: `dietitian_id=eq.${currentUserId}`,
      },
      onChange,
    );

  channel.subscribe((status) => notifyRealtimeStatus(status, onStatus));
  return createChatSubscription(channel);
};

export const subscribeToChatReadStates = (
  options: SubscribeToChatUserChangesOptions,
): ChatSubscription => {
  const { currentUserId, onChange, onStatus } = options;
  if (!isValidUuid(currentUserId)) return createNoopSubscription();

  const channel = supabase
    .channel(`chat-read-states:${currentUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_read_states',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_read_states',
      },
      onChange,
    );

  channel.subscribe((status) => notifyRealtimeStatus(status, onStatus));
  return createChatSubscription(channel);
};
