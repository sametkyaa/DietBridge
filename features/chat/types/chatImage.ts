/**
 * Canonical JPEG-only chat image contract shared by the web read path.
 *
 * These values mirror the dormant backend migrations
 * (`20260729090000_chat_image_schema.sql` and
 * `20260729090300_chat_image_storage.sql`). The client never widens them:
 * anything outside this contract is rejected fail-closed while normalizing
 * server rows.
 */
export type ChatMessageKind = 'text' | 'image';

export const CHAT_MESSAGE_KINDS: readonly ChatMessageKind[] = ['text', 'image'];

export const CHAT_IMAGE_BUCKET_ID = 'chat-images';
export const CHAT_IMAGE_MIME_TYPE = 'image/jpeg';
export const CHAT_IMAGE_MAX_BYTES = 4194304;
export const CHAT_IMAGE_MAX_EDGE_PIXELS = 2048;
export const CHAT_IMAGE_MAX_TOTAL_PIXELS = 4194304;

const UUID_PATTERN_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** Server-generated object path: `pending/<intent-uuid>/<object-uuid>.jpg`. */
export const CHAT_IMAGE_OBJECT_PATH_PATTERN = new RegExp(
  `^pending\\/${UUID_PATTERN_SOURCE}\\/${UUID_PATTERN_SOURCE}\\.jpg$`,
);

export const isChatMessageKind = (value: unknown): value is ChatMessageKind => (
  value === 'text' || value === 'image'
);

export interface ChatImageAttachment {
  id: string;
  messageId: string;
  bucketId: string;
  objectPath: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  deletedAt: string | null;
}
