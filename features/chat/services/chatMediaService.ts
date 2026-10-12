import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { CHAT_MEDIA_PATH, normalizeChatMediaAttachment, type ChatMediaDescriptor } from '../utils/chatMediaPolicy';
import type { ChatMessage } from '../types/chat';

export interface ChatMediaOperation { clientMessageId?: string; intentId?: string; objectPath?: string; uploaded?: boolean; validated?: boolean; finalized?: boolean; }
const fail = (error: unknown): Error => {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return new Error(String(record.message ?? '').includes('CHAT_RATE_LIMIT')
    ? 'Çok sık veya çok fazla dosya gönderildi. Biraz bekleyip tekrar deneyin.'
    : record.code === '42501' ? 'Dosya gönderimi için erişim veya sağlık paylaşım izni bulunmuyor.'
    : 'Dosya gönderilemedi. Dosya türünü ve bağlantınızı kontrol edip tekrar deneyin.');
};
export const getChatMediaEnabled = async (): Promise<boolean> => {
  const { data, error } = await supabase.rpc('get_chat_media_capabilities');
  return !error && data?.enabled === true;
};
export const abortChatMedia = async (operation: ChatMediaOperation): Promise<void> => {
  if (!operation.intentId || operation.finalized) return;
  const { error } = await supabase.rpc('abort_chat_image_upload', { p_intent_id: operation.intentId });
  if (error) throw fail(error);
};
export const sendChatMedia = async ({ conversationId, clientMessageId, descriptor, body, caption, operation, isCurrent, onStage }:
  { conversationId: string; clientMessageId: string; descriptor: ChatMediaDescriptor; body: Blob; caption: string;
    operation: ChatMediaOperation; isCurrent: () => boolean; onStage: (stage: string) => void }): Promise<{ messageId: string; conversationId: string } | null> => {
  if (!isValidUuid(conversationId) || !isValidUuid(clientMessageId) || body.size !== descriptor.byteSize || Array.from(caption).length > 4000) throw new Error('Dosya veya açıklama bilgisi geçersiz.');
  if (!operation.intentId) {
    onStage('İzin kontrol ediliyor');
    const { data, error } = await supabase.rpc('create_chat_media_upload_intent', {
      p_conversation_id: conversationId, p_client_message_id: clientMessageId,
      p_mime: descriptor.mimeType, p_file_name: descriptor.fileName, p_byte_size: descriptor.byteSize,
    });
    if (error) throw fail(error);
    const intent = Array.isArray(data) ? data[0] : data;
    if (!intent || !isValidUuid(intent.id) || intent.conversation_id !== conversationId || intent.client_message_id !== clientMessageId
      || intent.bucket_id !== 'chat-media' || !CHAT_MEDIA_PATH.test(intent.object_path || '')
      || !intent.object_path.endsWith(`.${descriptor.fileName.split('.').pop()?.toLowerCase()}`)
      || intent.expected_mime !== descriptor.mimeType || intent.declared_byte_size !== descriptor.byteSize || intent.file_name !== descriptor.fileName) throw new Error('Dosya yükleme izni doğrulanamadı.');
    operation.intentId = intent.id; operation.objectPath = intent.object_path;
  }
  if (!isCurrent()) { await abortChatMedia(operation); return null; }
  if (!operation.uploaded) {
    onStage('Dosya yükleniyor');
    const { data, error } = await supabase.functions.invoke('validate-chat-media', {
      headers: { 'x-chat-media-intent-id': operation.intentId!, 'Content-Type': descriptor.mimeType }, body,
    });
    if (error || data?.data?.validated !== true) throw fail(error);
    operation.uploaded = true; operation.validated = true;
  }
  if (!isCurrent()) return null;
  if (!operation.validated) {
    onStage('Dosya doğrulanıyor');
    const { data, error } = await supabase.functions.invoke('validate-chat-media', { body: { intentId: operation.intentId } });
    if (error || data?.data?.validated !== true) throw fail(error);
    operation.validated = true;
  }
  if (!isCurrent()) return null;
  onStage('Mesaj gönderiliyor');
  const { data, error } = await supabase.rpc('finalize_chat_media_message', { p_intent_id: operation.intentId, p_caption: caption.trim() || null });
  if (error) throw fail(error);
  const message = Array.isArray(data) ? data[0] : data;
  if (!message || !isValidUuid(message.id) || message.conversation_id !== conversationId || message.client_message_id !== clientMessageId) throw new Error('Mesaj sonucu doğrulanamadı.');
  operation.finalized = true;
  return { messageId: message.id, conversationId };
};

/** Extra metadata is requested only when an actual media row exists. Old servers keep the existing JPEG projection. */
export const enrichChatMediaRows = async (rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> => {
  const ids = rows.filter((row) => ['video', 'file'].includes(String(row.message_kind)) && row.deleted_at === null).map((row) => String(row.id));
  if (!ids.length) return rows;
  const { data, error } = await supabase.from('chat_attachments').select('message_id, file_name').in('message_id', ids);
  if (error) throw fail(error);
  const names = new Map((data ?? []).map((row) => [row.message_id, row.file_name]));
  return rows.map((row) => {
    if (!names.has(String(row.id))) return row;
    const attachment = Array.isArray(row.attachment) ? row.attachment[0] : row.attachment;
    return { ...row, attachment: { ...(attachment as Record<string, unknown>), file_name: names.get(String(row.id)) } };
  });
};
export const getChatMediaUrl = async (message: ChatMessage): Promise<string> => {
  const a = message.attachment;
  if (message.deletedAt || !a || !normalizeChatMediaAttachment({ id: a.id, message_id: a.messageId, bucket_id: a.bucketId,
    object_path: a.objectPath, mime_type: a.mimeType, byte_size: a.byteSize, width: a.width, height: a.height, deleted_at: a.deletedAt }, message.id, message.messageKind)) throw new Error('Bu dosya kullanılamıyor.');
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(a.objectPath, 300,
    message.messageKind === 'file' ? { download: a.fileName ?? true } : undefined);
  if (error || !data?.signedUrl) throw new Error('Dosya açılamadı. Erişiminizi kontrol edip tekrar deneyin.');
  return data.signedUrl;
};
