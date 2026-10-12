import { isValidUuid } from '../../../shared/utils/uuid';
import type { ChatImageAttachment } from '../types/chatImage';

const MIB = 1024 * 1024;
export const CHAT_MEDIA_TYPES: Readonly<Record<string, { extension: string; kind: 'video' | 'file'; maxBytes: number }>> = {
  'video/mp4': { extension: 'mp4', kind: 'video', maxBytes: 20 * MIB },
  'video/quicktime': { extension: 'mov', kind: 'video', maxBytes: 20 * MIB },
  'video/webm': { extension: 'webm', kind: 'video', maxBytes: 20 * MIB },
  'application/pdf': { extension: 'pdf', kind: 'file', maxBytes: 10 * MIB },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', kind: 'file', maxBytes: 10 * MIB },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', kind: 'file', maxBytes: 10 * MIB },
  'text/plain': { extension: 'txt', kind: 'file', maxBytes: 10 * MIB },
  'text/csv': { extension: 'csv', kind: 'file', maxBytes: 10 * MIB },
};
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const CHAT_MEDIA_PATH = new RegExp(`^pending/${UUID_SOURCE}/${UUID_SOURCE}\\.(mp4|mov|webm|pdf|docx|xlsx|txt|csv)$`);
export interface ChatMediaDescriptor { fileName: string; mimeType: string; byteSize: number; kind: 'video' | 'file'; maxBytes: number; }
export const normalizeChatMediaFile = ({ name, mimeType, byteSize }: { name: string; mimeType?: string; byteSize: number }): ChatMediaDescriptor => {
  const fileName = Array.from(name, (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '/\\'.includes(char) ? '_' : char).join('').trim();
  const extension = fileName.split('.').pop()?.toLowerCase();
  const inferred = Object.keys(CHAT_MEDIA_TYPES).find((type) => CHAT_MEDIA_TYPES[type].extension === extension);
  const declared = mimeType?.split(';')[0].trim().toLowerCase();
  const mime = (!declared || declared === 'application/octet-stream' ? inferred : declared) ?? '';
  const policy = CHAT_MEDIA_TYPES[mime];
  if (!policy || policy.extension !== extension || fileName.length > 120 || !fileName) throw new Error('MP4, MOV, WebM, PDF, DOCX, XLSX, TXT veya CSV dosyası seçin.');
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > policy.maxBytes) throw new Error(`${policy.kind === 'video' ? 'Video' : 'Dosya'} en fazla ${policy.maxBytes / MIB} MB olabilir.`);
  return { fileName, mimeType: mime, byteSize, kind: policy.kind, maxBytes: policy.maxBytes };
};
export const normalizeChatMediaAttachment = (value: unknown, messageId: string, kind: string): ChatImageAttachment | null => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object' || !['video', 'file'].includes(kind)) return null;
  const row = candidate as Record<string, unknown>;
  const policy = typeof row.mime_type === 'string' ? CHAT_MEDIA_TYPES[row.mime_type] : null;
  if (!isValidUuid(row.id) || row.message_id !== messageId || row.bucket_id !== 'chat-media'
    || typeof row.object_path !== 'string' || !CHAT_MEDIA_PATH.test(row.object_path) || !policy || policy.kind !== kind
    || !row.object_path.endsWith(`.${policy.extension}`) || typeof row.byte_size !== 'number'
    || !Number.isSafeInteger(row.byte_size) || row.byte_size < 1 || row.byte_size > policy.maxBytes
    || row.width !== 0 || row.height !== 0 || row.deleted_at !== null) return null;
  const fileName = typeof row.file_name === 'string' && row.file_name.length <= 120 && !Array.from(row.file_name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '/\\'.includes(char))
    ? row.file_name : `${kind === 'video' ? 'Video' : 'Belge'}.${policy.extension}`;
  return { id: row.id, messageId, bucketId: 'chat-media', objectPath: row.object_path, mimeType: String(row.mime_type),
    byteSize: row.byte_size, width: 0, height: 0, fileName, deletedAt: null };
};
