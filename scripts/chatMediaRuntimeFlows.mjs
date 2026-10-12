import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { readFileSync } from 'node:fs';
import { JPEG_FIXTURE } from './healthConsentRuntimeFlows.mjs';

// Runs only inside the disposable loopback Supabase harness.
export const runChatMediaRuntimeFlows = async (context) => {
  const { admin, local, runSql, createActor, signIn, approveDietitian, bootstrapDietitian,
    activateRelationship, assert, assertNoError, expectDenied } = context;
  assertCiSafeEnvironment({ SUPABASE_URL: local.API_URL }, { requireLoopback: true });
  const diety = await createActor('media-dietitian', 'dietitian');
  const client = await createActor('media-client', 'client');
  const foreign = await createActor('media-foreign', 'client');
  await approveDietitian(diety); await bootstrapDietitian(diety); await activateRelationship(diety, client);
  const api = await signIn(client); const peer = await signIn(diety); const outsider = await signIn(foreign);
  const anonymous = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  const state = assertNoError(await api.rpc('get_my_health_consent'), 'media health state');
  const consent = (sharing) => api.rpc('set_my_health_consent', { p_document_version: state.document_version, p_storage: true, p_sharing: sharing });
  assertNoError(await consent(true), 'media consent');
  const relation = assertNoError(await admin.from('dietitian_clients').select('id').eq('client_id', client.id).eq('dietitian_id', diety.id).single(), 'media relation');
  const seed = assertNoError(await api.rpc('send_chat_message', { p_dietitian_client_id: relation.id, p_client_message_id: randomUUID(), p_body: 'Disposable media test' }), 'media seed text');
  const bytes = new TextEncoder().encode('DietBridge disposable document\n');
  const input = { p_conversation_id: seed.conversation_id, p_client_message_id: randomUUID(), p_mime: 'text/plain', p_file_name: 'not.txt', p_byte_size: bytes.length };
  assert(assertNoError(await api.rpc('get_chat_media_capabilities'), 'media caps').enabled === false, 'MEDIA_DORMANT_DEFAULT');
  expectDenied(await api.rpc('create_chat_media_upload_intent', input), 'MEDIA_DISABLED_CREATE_DENIED');
  runSql('update private.chat_media_settings set enabled=true where singleton;');
  expectDenied(await anonymous.rpc('create_chat_media_upload_intent', input), 'MEDIA_ANONYMOUS_DENIED');
  expectDenied(await outsider.rpc('create_chat_media_upload_intent', input), 'MEDIA_FOREIGN_INTENT_DENIED');
  expectDenied(await api.rpc('create_chat_media_upload_intent', { ...input, p_mime: 'application/zip', p_file_name: 'bad.zip' }), 'MEDIA_ARCHIVE_DENIED', ['22023']);
  expectDenied(await api.rpc('create_chat_media_upload_intent', { ...input, p_byte_size: 10485761 }), 'MEDIA_OVERSIZE_DENIED', ['22023']);
  const intent = assertNoError(await api.rpc('create_chat_media_upload_intent', input), 'media intent');
  assert(intent.bucket_id === 'chat-media' && intent.media_kind === 'file', 'MEDIA_CANONICAL_INTENT');
  assert(assertNoError(await api.rpc('create_chat_media_upload_intent', input), 'media replay').id === intent.id, 'MEDIA_INTENT_IDEMPOTENT');
  expectDenied(await api.rpc('record_chat_media_validation', { p_intent_id: intent.id, p_mime: 'text/plain', p_byte_size: bytes.length }), 'MEDIA_CLIENT_CANNOT_VALIDATE');
  expectDenied(await api.rpc('finalize_chat_media_message', { p_intent_id: intent.id, p_caption: null }), 'MEDIA_UNVALIDATED_CANNOT_FINALIZE', ['22023']);
  assert(Boolean((await outsider.storage.from('chat-media').upload(intent.object_path, bytes, { contentType: 'text/plain' })).error), 'MEDIA_FOREIGN_UPLOAD_DENIED');
  assert(Boolean((await api.storage.from('chat-media').upload(intent.object_path, bytes.slice(1), { contentType: 'text/plain' })).error), 'MEDIA_STORAGE_SIZE_MISMATCH_DENIED');
  assert(Boolean((await api.storage.from('chat-media').upload(intent.object_path, bytes, { contentType: 'text/plain', upsert: false })).error), 'MEDIA_DIRECT_STORAGE_UPLOAD_DENIED');
  assert(Boolean((await peer.storage.from('chat-media').download(intent.object_path)).error), 'MEDIA_PENDING_DOWNLOAD_DENIED');
  assert(Boolean((await api.functions.invoke('validate-chat-media', { headers: { 'x-chat-media-intent-id': intent.id, 'Content-Type': 'text/plain' }, body: new Uint8Array(bytes.length + 1).buffer })).error), 'MEDIA_BROKER_REAL_SIZE_MISMATCH_DENIED');
  assertNoError(await api.functions.invoke('validate-chat-media', { headers: { 'x-chat-media-intent-id': intent.id, 'Content-Type': 'text/plain' }, body: bytes.buffer }), 'media edge real bytes');
  const message = assertNoError(await api.rpc('finalize_chat_media_message', { p_intent_id: intent.id, p_caption: 'Ek belge' }), 'media finalizer');
  assert(message.message_kind === 'file' && message.body === 'Ek belge', 'MEDIA_CANONICAL_MESSAGE');
  assertNoError(await peer.rpc('mark_chat_conversation_delivered', { p_conversation_id: seed.conversation_id, p_last_delivered_message_id: message.id }), 'media delivery');
  assertNoError(await peer.rpc('mark_chat_conversation_read', { p_conversation_id: seed.conversation_id, p_last_read_message_id: message.id }), 'media read');
  const receipt = assertNoError(await api.from('chat_read_states').select('*').eq('conversation_id', seed.conversation_id).eq('user_id', diety.id).single(), 'media receipt');
  assert(receipt.last_delivered_message_id === message.id && receipt.last_read_message_id === message.id, 'MEDIA_SHARED_RECEIPTS_PERSISTED');
  assert(assertNoError(await outsider.from('chat_read_states').select('user_id').eq('conversation_id', seed.conversation_id), 'foreign receipts').length === 0, 'MEDIA_FOREIGN_RECEIPTS_HIDDEN');
  const attachment = assertNoError(await peer.from('chat_attachments').select('*').eq('message_id', message.id).single(), 'media attachment');
  assert(attachment.file_name === 'not.txt' && attachment.width === 0 && attachment.byte_size === bytes.length, 'MEDIA_ATTACHMENT_EXACT_METADATA');
  const downloaded = assertNoError(await peer.storage.from('chat-media').download(intent.object_path), 'peer media download');
  assert(await downloaded.text() === new TextDecoder().decode(bytes), 'MEDIA_PEER_DOWNLOAD_MATCHES');
  const video = readFileSync(new URL('../tests/fixtures/chat-media-video.webm', import.meta.url));
  const videoIntent = assertNoError(await peer.rpc('create_chat_media_upload_intent', { ...input,
    p_client_message_id: randomUUID(), p_mime: 'video/webm', p_file_name: 'video.webm', p_byte_size: video.length }), 'reverse video intent');
  assertNoError(await peer.functions.invoke('validate-chat-media', { headers: { 'x-chat-media-intent-id': videoIntent.id, 'Content-Type': 'video/webm' }, body: new Uint8Array(video).buffer }), 'real video broker');
  const videoMessage = assertNoError(await peer.rpc('finalize_chat_media_message', { p_intent_id: videoIntent.id, p_caption: null }), 'real video finalizer');
  assert(videoMessage.message_kind === 'video' && videoMessage.body === null, 'MEDIA_REAL_VIDEO_WITHOUT_CAPTION_REVERSE_DIRECTION');
  assertNoError(await api.storage.from('chat-media').download(videoIntent.object_path), 'client video download');
  const jpegIntent = assertNoError(await peer.rpc('create_chat_image_upload_intent', {
    p_conversation_id: seed.conversation_id, p_client_message_id: randomUUID(), p_expected_mime: 'image/jpeg' }), 'JPEG compatibility intent');
  assertNoError(await peer.storage.from('chat-images').upload(jpegIntent.object_path, JPEG_FIXTURE, { contentType: 'image/jpeg', upsert: false }), 'JPEG compatibility storage');
  assertNoError(await peer.functions.invoke('validate-chat-image', { body: { intentId: jpegIntent.id } }), 'JPEG compatibility validator');
  const jpegMessage = assertNoError(await peer.rpc('finalize_chat_image_message', { p_intent_id: jpegIntent.id, p_caption: null }), 'JPEG compatibility finalizer');
  assert(jpegMessage.message_kind === 'image', 'MEDIA_EXISTING_REAL_JPEG_FLOW_PRESERVED');
  assert(Boolean((await outsider.storage.from('chat-media').download(intent.object_path)).error), 'MEDIA_FOREIGN_DOWNLOAD_DENIED');
  assert(assertNoError(await api.rpc('finalize_chat_media_message', { p_intent_id: intent.id, p_caption: 'Ek belge' }), 'final replay').id === message.id, 'MEDIA_FINALIZE_IDEMPOTENT');
  assertNoError(await consent(false), 'revoke media sharing');
  assert(Boolean((await peer.storage.from('chat-media').download(intent.object_path)).error), 'MEDIA_REVOKED_SHARING_DENIED');
  assertNoError(await consent(true), 'restore media sharing');
  assertNoError(await api.rpc('delete_chat_message', { p_message_id: message.id }), 'delete media');
  assert(Boolean((await peer.storage.from('chat-media').download(intent.object_path)).error), 'MEDIA_DELETED_DOWNLOAD_DENIED');
  assert(runSql(`select count(*) from public.chat_image_cleanup_queue where bucket_id='chat-media' and object_path='${intent.object_path}'`) === '1', 'MEDIA_DELETE_QUEUED');
  // Rejected/aborted upload reservations still consume the per-actor rate window.
  for (let i = 0; i < 4; i++) {
    const next = assertNoError(await api.rpc('create_chat_media_upload_intent', { ...input, p_client_message_id: randomUUID() }), 'rate fixture');
    assertNoError(await api.rpc('abort_chat_image_upload', { p_intent_id: next.id }), 'rate abort');
  }
  expectDenied(await api.rpc('create_chat_media_upload_intent', { ...input, p_client_message_id: randomUUID() }), 'MEDIA_RATE_LIMIT_AFTER_ABORT', ['22023']);
  const ageReservations = () => runSql(`select set_config('request.jwt.claims','{"role":"service_role"}',true); update public.chat_upload_intents set created_at=now()-interval '70 minutes' where created_by='${client.id}';`);
  // Keep rows and reservations, changing time only in this disposable fixture.
  runSql(`select set_config('request.jwt.claims','{"role":"service_role"}',true); update public.chat_upload_intents set created_at=now()-interval '6 minutes' where created_by='${client.id}';`);
  const videoInput = { ...input, p_mime: 'video/mp4', p_file_name: 'video.mp4', p_byte_size: 20971520 };
  for (let i=0;i<4;i++) assertNoError(await api.rpc('create_chat_media_upload_intent', { ...videoInput, p_client_message_id: randomUUID() }), 'hour bytes fixture');
  expectDenied(await api.rpc('create_chat_media_upload_intent', { ...videoInput, p_client_message_id: randomUUID() }), 'MEDIA_HOURLY_BYTE_LIMIT', ['22023']);
  ageReservations();
  for (let group=0;group<2;group++) {
    for (let i=0;i<5;i++) assertNoError(await api.rpc('create_chat_media_upload_intent', { ...videoInput, p_client_message_id: randomUUID() }), 'daily bytes fixture');
    ageReservations();
  }
  expectDenied(await api.rpc('create_chat_media_upload_intent', { ...videoInput, p_client_message_id: randomUUID() }), 'MEDIA_DAILY_BYTE_LIMIT', ['22023']);
  const sentCount = Number(runSql(`select count(*) from public.chat_messages where sender_id='${client.id}' and created_at>now()-interval '1 minute';`));
  for (let i=sentCount;i<30;i++) assertNoError(await api.rpc('send_chat_message', { p_dietitian_client_id: relation.id, p_client_message_id: randomUUID(), p_body: 'Disposable message rate fixture' }), 'message rate fixture');
  expectDenied(await api.rpc('send_chat_message', { p_dietitian_client_id: relation.id, p_client_message_id: randomUUID(), p_body: 'Must be throttled' }), 'MEDIA_TEXT_MESSAGE_RATE_LIMIT', ['22023']);
  // Verify the existing JPEG finalizer cannot be used for a generic intent.
  expectDenied(await api.rpc('finalize_chat_image_message', { p_intent_id: intent.id, p_caption: null }), 'MEDIA_JPEG_ENDPOINT_REJECTS_GENERIC');
  assert(runSql("select pg_get_functiondef('public.prepare_client_account_deletion(uuid,jsonb)'::regprocedure) like '%chat-media%'") === 't', 'MEDIA_ACCOUNT_DELETION_MANIFEST_SUPPORTED');
};
