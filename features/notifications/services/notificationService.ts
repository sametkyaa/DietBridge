import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import type {
  NotificationAppointmentStatus,
  NotificationCategory,
  NotificationCursor,
  NotificationEventType,
  NotificationItem,
  NotificationPage,
  NotificationRelationshipStatus,
  NotificationServiceErrorCode,
  NotificationSummaryKey,
} from '../types/notification';

export const NOTIFICATION_DEFAULT_PAGE_SIZE = 25;
export const NOTIFICATION_MAX_PAGE_SIZE = 50;
export const NOTIFICATION_MAX_BATCH_SIZE = 100;

export const NOTIFICATION_SELECT = [
  'id',
  'recipient_id',
  'category',
  'event_type',
  'aggregation_key',
  'actor_id',
  'actor_display_name',
  'conversation_id',
  'appointment_id',
  'dietitian_client_id',
  'summary_key',
  'appointment_title_snapshot',
  'appointment_date',
  'appointment_time',
  'appointment_status',
  'relationship_from_status',
  'relationship_to_status',
  'event_count',
  'occurred_at',
  'seen_at',
  'read_at',
  'created_at',
  'updated_at',
].join(', ');

export type NotificationRealtimeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type NotificationRealtimeEvent = 'INSERT' | 'UPDATE';

export interface NotificationRealtimeChange {
  event: NotificationRealtimeEvent;
  notificationId: string | null;
}

export interface NotificationSubscription {
  unsubscribe: () => Promise<void>;
}

export class NotificationServiceError extends Error {
  constructor(
    public readonly code: NotificationServiceErrorCode,
    public readonly userMessage: string,
    public readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'NotificationServiceError';
  }
}

interface RawNotificationRow {
  [key: string]: unknown;
}

const CATEGORY_EVENTS: Record<NotificationCategory, Partial<Record<NotificationEventType, NotificationSummaryKey>>> = {
  chat_message: { new_message: 'chat_new_message' },
  appointment: {
    created: 'appointment_created',
    updated: 'appointment_updated',
    cancelled: 'appointment_cancelled',
    assigned: 'appointment_assigned',
    removed_from_client: 'appointment_removed_from_client',
    reminder_24h: 'appointment_reminder_24h',
    reminder_1h: 'appointment_reminder_1h',
  },
  relationship: {
    request_pending: 'relationship_request_pending',
    accepted: 'relationship_accepted',
    rejected: 'relationship_rejected',
    removed: 'relationship_removed',
  },
};

const APPOINTMENT_STATUSES = new Set<NotificationAppointmentStatus>([
  'upcoming',
  'completed',
  'cancelled',
]);
const RELATIONSHIP_STATUSES = new Set<NotificationRelationshipStatus>([
  'pending',
  'active',
  'rejected',
  'removed',
]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

const asRecord = (value: unknown): RawNotificationRow | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RawNotificationRow
    : null
);

const getErrorProperty = (error: unknown, key: string): unknown => (
  asRecord(error)?.[key]
);

const toNotificationServiceError = (
  error: unknown,
  fallbackCode: NotificationServiceErrorCode,
  fallbackMessage: string,
): NotificationServiceError => {
  if (error instanceof NotificationServiceError) return error;

  const status = getErrorProperty(error, 'status');
  const databaseCode = getErrorProperty(error, 'code');
  const rawMessage = getErrorProperty(error, 'message');
  const message = typeof rawMessage === 'string' ? rawMessage.toLowerCase() : '';

  if (status === 401 || databaseCode === 'PGRST301') {
    return new NotificationServiceError('UNAUTHENTICATED', 'Oturumunuz doğrulanamadı. Lütfen yeniden giriş yapın.', error);
  }
  if (status === 403 || databaseCode === '42501') {
    return new NotificationServiceError('FORBIDDEN', 'Bildirim kayıtlarına erişim izniniz yok.', error);
  }
  if (databaseCode === '22P02' || databaseCode === '22023' || databaseCode === '23514') {
    return new NotificationServiceError('VALIDATION', 'Bildirim isteği geçersiz.', error);
  }
  if (message.includes('network') || message.includes('failed to fetch')) {
    return new NotificationServiceError('NETWORK', 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.', error);
  }
  return new NotificationServiceError(fallbackCode, fallbackMessage, error);
};

const malformed = (field: string): never => {
  throw new NotificationServiceError(
    'MALFORMED',
    'Bildirim yanıtı beklenen veri sözleşmesine uymuyor.',
    new Error(`Invalid notification field: ${field}`),
  );
};

const requiredUuid = (row: RawNotificationRow, field: string): string => {
  const value = row[field];
  if (!isValidUuid(value)) return malformed(field);
  return value;
};

const nullableUuid = (row: RawNotificationRow, field: string): string | null => {
  const value = row[field];
  if (value === null) return null;
  if (!isValidUuid(value)) return malformed(field);
  return value;
};

const requiredString = (row: RawNotificationRow, field: string): string => {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) return malformed(field);
  return value;
};

const nullableString = (row: RawNotificationRow, field: string): string | null => {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== 'string') return malformed(field);
  return value;
};

const nullableBoundedString = (
  row: RawNotificationRow,
  field: string,
  maximum: number,
  requireNonEmpty = false,
): string | null => {
  const value = nullableString(row, field);
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length > maximum || (requireNonEmpty && trimmed.length === 0)) malformed(field);
  return trimmed;
};

const requiredIsoTimestamp = (row: RawNotificationRow, field: string): string => {
  const value = requiredString(row, field);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) malformed(field);
  return timestamp.toISOString();
};

const nullableIsoTimestamp = (row: RawNotificationRow, field: string): string | null => {
  const value = nullableString(row, field);
  if (value === null) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) malformed(field);
  return timestamp.toISOString();
};

const nullableDate = (row: RawNotificationRow, field: string): string | null => {
  const value = nullableString(row, field);
  if (value === null) return null;
  if (!ISO_DATE_PATTERN.test(value)) malformed(field);
  return value;
};

const nullableTime = (row: RawNotificationRow, field: string): string | null => {
  const value = nullableString(row, field);
  if (value === null) return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) malformed(field);
  return `${match[1]}:${match[2]}`;
};

const nullableAppointmentStatus = (row: RawNotificationRow): NotificationAppointmentStatus | null => {
  const value = nullableString(row, 'appointment_status');
  if (value === null) return null;
  if (!APPOINTMENT_STATUSES.has(value as NotificationAppointmentStatus)) malformed('appointment_status');
  return value as NotificationAppointmentStatus;
};

const nullableRelationshipStatus = (
  row: RawNotificationRow,
  field: string,
): NotificationRelationshipStatus | null => {
  const value = nullableString(row, field);
  if (value === null) return null;
  if (!RELATIONSHIP_STATUSES.has(value as NotificationRelationshipStatus)) malformed(field);
  return value as NotificationRelationshipStatus;
};

const validateSourceContract = (
  category: NotificationCategory,
  eventType: NotificationEventType,
  notification: Pick<
    NotificationItem,
    | 'conversationId'
    | 'appointmentId'
    | 'dietitianClientId'
    | 'appointmentTitleSnapshot'
    | 'appointmentDate'
    | 'appointmentTime'
    | 'appointmentStatus'
    | 'relationshipFromStatus'
    | 'relationshipToStatus'
  >,
): void => {
  const allAppointmentFieldsAreNull = notification.appointmentId === null
    && notification.appointmentTitleSnapshot === null
    && notification.appointmentDate === null
    && notification.appointmentTime === null
    && notification.appointmentStatus === null;
  const allRelationshipFieldsAreNull = notification.dietitianClientId === null
    && notification.relationshipFromStatus === null
    && notification.relationshipToStatus === null;

  if (category === 'chat_message') {
    if (!notification.conversationId || notification.appointmentId !== null || !allRelationshipFieldsAreNull || !allAppointmentFieldsAreNull) malformed('source');
    return;
  }

  if (category === 'appointment') {
    if (notification.conversationId !== null || !notification.appointmentId || !notification.appointmentDate || !notification.appointmentTime || !notification.appointmentStatus || !allRelationshipFieldsAreNull) malformed('source');
    return;
  }

  if (notification.conversationId !== null || notification.appointmentId !== null || !notification.dietitianClientId || !allAppointmentFieldsAreNull) malformed('source');
  const { relationshipFromStatus, relationshipToStatus } = notification;
  if (eventType === 'request_pending' && relationshipToStatus === 'pending' && (relationshipFromStatus === null || relationshipFromStatus === 'rejected' || relationshipFromStatus === 'removed')) return;
  if (eventType === 'accepted' && relationshipFromStatus === 'pending' && relationshipToStatus === 'active') return;
  if (eventType === 'rejected' && relationshipFromStatus === 'pending' && relationshipToStatus === 'rejected') return;
  if (eventType === 'removed' && relationshipFromStatus === 'active' && relationshipToStatus === 'removed') return;
  malformed('relationship_transition');
};

export const normalizeNotificationRow = (value: unknown): NotificationItem => {
  const row = asRecord(value);
  if (!row) malformed('row');

  const categoryValue = requiredString(row, 'category');
  if (!(categoryValue in CATEGORY_EVENTS)) malformed('category');
  const category = categoryValue as NotificationCategory;
  const eventTypeValue = requiredString(row, 'event_type');
  if (!(eventTypeValue in CATEGORY_EVENTS[category])) malformed('event_type');
  const eventType = eventTypeValue as NotificationEventType;
  const summaryKey = requiredString(row, 'summary_key');
  if (CATEGORY_EVENTS[category][eventType] !== summaryKey) malformed('summary_key');

  const seenAt = nullableIsoTimestamp(row, 'seen_at');
  const readAt = nullableIsoTimestamp(row, 'read_at');
  if (readAt !== null && seenAt === null) malformed('read_at');

  const notification: NotificationItem = {
    id: requiredUuid(row, 'id'),
    recipientId: requiredUuid(row, 'recipient_id'),
    category,
    eventType,
    aggregationKey: requiredString(row, 'aggregation_key'),
    actorId: nullableUuid(row, 'actor_id'),
    actorDisplayName: nullableBoundedString(row, 'actor_display_name', 120, true),
    conversationId: nullableUuid(row, 'conversation_id'),
    appointmentId: nullableUuid(row, 'appointment_id'),
    dietitianClientId: nullableUuid(row, 'dietitian_client_id'),
    summaryKey: summaryKey as NotificationSummaryKey,
    appointmentTitleSnapshot: nullableBoundedString(row, 'appointment_title_snapshot', 120),
    appointmentDate: nullableDate(row, 'appointment_date'),
    appointmentTime: nullableTime(row, 'appointment_time'),
    appointmentStatus: nullableAppointmentStatus(row),
    relationshipFromStatus: nullableRelationshipStatus(row, 'relationship_from_status'),
    relationshipToStatus: nullableRelationshipStatus(row, 'relationship_to_status'),
    eventCount: row.event_count as number,
    occurredAt: requiredIsoTimestamp(row, 'occurred_at'),
    seenAt,
    readAt,
    createdAt: requiredIsoTimestamp(row, 'created_at'),
    updatedAt: requiredIsoTimestamp(row, 'updated_at'),
  };

  if (!Number.isInteger(notification.eventCount) || notification.eventCount < 1) malformed('event_count');
  if (notification.aggregationKey.trim().length === 0 || notification.aggregationKey.length > 300) malformed('aggregation_key');
  validateSourceContract(category, eventType, notification);
  return notification;
};

const requireAuthenticatedUser = async (fallbackMessage: string): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id || !isValidUuid(data.user.id)) {
    throw new NotificationServiceError('UNAUTHENTICATED', fallbackMessage, error);
  }
  return data.user.id;
};

const normalizePageSize = (value: number | undefined): number => {
  const pageSize = value ?? NOTIFICATION_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > NOTIFICATION_MAX_PAGE_SIZE) {
    throw new NotificationServiceError('VALIDATION', `Bildirim sayfa boyutu 1-${NOTIFICATION_MAX_PAGE_SIZE} arasında olmalıdır.`);
  }
  return pageSize;
};

const normalizeCursor = (cursor: NotificationCursor | null | undefined): NotificationCursor | null => {
  if (cursor === undefined || cursor === null) return null;
  if (!isValidUuid(cursor.id) || typeof cursor.occurredAt !== 'string' || Number.isNaN(Date.parse(cursor.occurredAt))) {
    throw new NotificationServiceError('VALIDATION', 'Bildirim sayfalama imleci geçersiz.');
  }
  return { occurredAt: new Date(cursor.occurredAt).toISOString(), id: cursor.id };
};

export interface ListNotificationsOptions {
  cursor?: NotificationCursor | null;
  pageSize?: number;
  unreadOnly?: boolean;
}

export const listNotifications = async (
  options: ListNotificationsOptions = {},
): Promise<NotificationPage> => {
  const userId = await requireAuthenticatedUser('Bildirimler yüklenemedi.');
  const pageSize = normalizePageSize(options.pageSize);
  const cursor = normalizeCursor(options.cursor);

  let query = supabase
    .from('notifications')
    .select(NOTIFICATION_SELECT)
    .eq('recipient_id', userId);

  if (options.unreadOnly) query = query.is('read_at', null);
  if (cursor) {
    query = query.or(
      `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);
  if (error) throw toNotificationServiceError(error, 'FETCH', 'Bildirimler yüklenemedi. Lütfen tekrar deneyin.');
  if (!Array.isArray(data)) {
    throw new NotificationServiceError('MALFORMED', 'Bildirim yanıtı beklenmeyen bir biçimde geldi.');
  }

  let notifications: NotificationItem[];
  try {
    notifications = data.map(normalizeNotificationRow);
  } catch (cause) {
    throw toNotificationServiceError(cause, 'MALFORMED', 'Bildirim yanıtı doğrulanamadı.');
  }

  const hasMore = notifications.length > pageSize;
  const pageNotifications = notifications.slice(0, pageSize);
  const last = pageNotifications[pageNotifications.length - 1];
  return {
    notifications: pageNotifications,
    hasMore,
    nextCursor: hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null,
  };
};

export const getNotificationUnseenCount = async (): Promise<number> => {
  const userId = await requireAuthenticatedUser('Bildirim rozeti yüklenemedi.');
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('seen_at', null);
  if (error) throw toNotificationServiceError(error, 'FETCH', 'Bildirim rozeti yüklenemedi.');
  if (typeof count !== 'number' || count < 0) {
    throw new NotificationServiceError('MALFORMED', 'Bildirim rozeti yanıtı beklenmeyen bir biçimde geldi.');
  }
  return count;
};

const unwrapRpcRow = (value: unknown): unknown => (
  Array.isArray(value) ? value[0] : value
);

const callNotificationMutation = async (
  functionName: 'mark_notification_seen' | 'mark_notification_read',
  notificationId: string,
): Promise<NotificationItem> => {
  if (!isValidUuid(notificationId)) {
    throw new NotificationServiceError('VALIDATION', 'Bildirim kimliği geçersiz.');
  }
  await requireAuthenticatedUser('Bildirim işlemi için oturum açmanız gerekir.');
  const { data, error } = await supabase.rpc(functionName, { p_notification_id: notificationId });
  if (error) throw toNotificationServiceError(error, 'RPC', 'Bildirim işlemi tamamlanamadı.');
  try {
    return normalizeNotificationRow(unwrapRpcRow(data));
  } catch (cause) {
    throw toNotificationServiceError(cause, 'MALFORMED', 'Bildirim işlemi beklenmeyen bir yanıt döndürdü.');
  }
};

export const markNotificationSeen = (notificationId: string): Promise<NotificationItem> => (
  callNotificationMutation('mark_notification_seen', notificationId)
);

export const markNotificationRead = (notificationId: string): Promise<NotificationItem> => (
  callNotificationMutation('mark_notification_read', notificationId)
);

export const markNotificationsSeen = async (notificationIds: readonly string[]): Promise<number> => {
  if (!Array.isArray(notificationIds) || notificationIds.length > NOTIFICATION_MAX_BATCH_SIZE) {
    throw new NotificationServiceError('VALIDATION', `En fazla ${NOTIFICATION_MAX_BATCH_SIZE} bildirim aynı anda görüldü olarak işaretlenebilir.`);
  }
  if (new Set(notificationIds).size !== notificationIds.length || notificationIds.some((id) => !isValidUuid(id))) {
    throw new NotificationServiceError('VALIDATION', 'Bildirim listesi geçersiz veya tekrarlı kimlik içeriyor.');
  }
  await requireAuthenticatedUser('Bildirim işlemi için oturum açmanız gerekir.');
  if (notificationIds.length === 0) return 0;

  const { data, error } = await supabase.rpc('mark_notifications_seen', {
    p_notification_ids: [...notificationIds],
  });
  if (error) throw toNotificationServiceError(error, 'RPC', 'Bildirimler görüldü olarak işaretlenemedi.');
  if (!Number.isInteger(data) || data < 0 || data > notificationIds.length) {
    throw new NotificationServiceError('MALFORMED', 'Toplu bildirim işlemi beklenmeyen bir yanıt döndürdü.');
  }
  return data;
};

export const markAllNotificationsRead = async (): Promise<number> => {
  await requireAuthenticatedUser('Bildirim işlemi için oturum açmanız gerekir.');
  const { data, error } = await supabase.rpc('mark_all_notifications_read');
  if (error) throw toNotificationServiceError(error, 'RPC', 'Tüm bildirimler okundu olarak işaretlenemedi.');
  if (!Number.isInteger(data) || data < 0) {
    throw new NotificationServiceError('MALFORMED', 'Toplu bildirim işlemi beklenmeyen bir yanıt döndürdü.');
  }
  return data;
};

const notifyRealtimeStatus = (
  status: string,
  onStatus?: (status: NotificationRealtimeStatus) => void,
): void => {
  if (!onStatus) return;
  if (status === 'SUBSCRIBED') return onStatus('connected');
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return onStatus('error');
  if (status === 'CLOSED') return onStatus('disconnected');
  onStatus('connecting');
};

export interface SubscribeToNotificationsOptions {
  onChange: (change: NotificationRealtimeChange) => void;
  onStatus?: (status: NotificationRealtimeStatus) => void;
}

export const subscribeToNotifications = (
  options: SubscribeToNotificationsOptions,
): NotificationSubscription => {
  let active = true;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let removal: Promise<void> | null = null;

  const start = async (): Promise<void> => {
    const { data, error } = await supabase.auth.getUser();
    if (!active) return;
    if (error || !data.user?.id || !isValidUuid(data.user.id)) {
      options.onStatus?.('error');
      return;
    }

    const userId = data.user.id;
    channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          if (!active) return;
          const row = asRecord(payload.new);
          options.onChange({ event: 'INSERT', notificationId: row && typeof row.id === 'string' ? row.id : null });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          if (!active) return;
          const row = asRecord(payload.new);
          options.onChange({ event: 'UPDATE', notificationId: row && typeof row.id === 'string' ? row.id : null });
        },
      );

    if (!active) return;
    channel.subscribe((status) => {
      if (active) notifyRealtimeStatus(status, options.onStatus);
    });
  };

  void start().catch(() => {
    if (active) options.onStatus?.('error');
  });

  return {
    unsubscribe: () => {
      active = false;
      if (!channel) return Promise.resolve();
      if (!removal) {
        removal = supabase.removeChannel(channel)
          .then(() => undefined)
          .catch(() => undefined);
      }
      return removal;
    },
  };
};
