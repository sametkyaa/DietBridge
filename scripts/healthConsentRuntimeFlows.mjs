import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

// Only called with the throwaway stack created by the Faz 2 runtime harness.
// This exercises real repository RPC bodies and Storage/Edge HTTP, never the
// deliberately minimal SQL core fixtures. Test identities are generated here.
const JPEG_FIXTURE = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC/RRRXzJwH/9k=', 'base64');

export const runHealthConsentRuntimeFlows = async (context) => {
  const { admin, local, runSql, createActor, signIn, approveDietitian,
    bootstrapDietitian, activateRelationship, assert, assertNoError, expectDenied } = context;
  assertCiSafeEnvironment({ SUPABASE_URL: local.API_URL }, { requireLoopback: true });
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const anonymous = createClient(local.API_URL, local.ANON_KEY, options);
  const diety = await createActor('health-dietitian', 'dietitian');
  const foreignDiety = await createActor('health-foreign-dietitian', 'dietitian');
  const client = await createActor('health-client', 'client');
  await approveDietitian(diety);
  await approveDietitian(foreignDiety);
  await bootstrapDietitian(diety);
  await bootstrapDietitian(foreignDiety);
  await activateRelationship(diety, client);
  const clientApi = await signIn(client);
  const dietyApi = await signIn(diety);
  const foreignApi = await signIn(foreignDiety);
  const relation = assertNoError(await admin.from('dietitian_clients').select('id')
    .eq('dietitian_id', diety.id).eq('client_id', client.id).single(), 'health relation');
  const today = runSql("select ((now() at time zone 'Europe/Istanbul')::date)::text");
  const planId = randomUUID();
  const mealId = randomUUID();
  assertNoError(await admin.from('meal_plans').insert({ id: planId, client_id: client.id,
    dietitian_id: diety.id, plan_date: today, notes: 'Disposable health test' }), 'health plan fixture');
  assertNoError(await admin.from('meals').insert({ id: mealId, plan_id: planId,
    type: 'breakfast', title: 'Disposable meal', source: 'manual', calories: 400,
    macros: { protein: 20, carbs: 50, fat: 13 }, sort_order: 0 }), 'health meal fixture');
  assertNoError(await clientApi.rpc('save_my_current_weight', { p_weight: 70 }), 'dormant legacy weight');
  const messageInput = { p_dietitian_client_id: relation.id, p_client_message_id: randomUUID(), p_body: 'Disposable health message' };
  const message = assertNoError(await clientApi.rpc('send_chat_message', messageInput), 'dormant message');
  const imageInput = { p_conversation_id: message.conversation_id, p_client_message_id: randomUUID(), p_expected_mime: 'image/jpeg' };
  const intent = assertNoError(await clientApi.rpc('create_chat_image_upload_intent', imageInput), 'dormant image intent');
  assertNoError(await clientApi.storage.from(intent.bucket_id).upload(intent.object_path,
    JPEG_FIXTURE, { contentType: 'image/jpeg', upsert: false }), 'dormant image upload');
  const request = assertNoError(await clientApi.from('meal_change_requests').insert({
    client_id: client.id, dietitian_id: diety.id, plan_date: today, meal_slot: 'lunch',
    requested_meals: { alternatives: ['lunch'] }, notes: 'Disposable change request', status: 'pending',
  }).select().single(), 'dormant request');
  const reviewInput = { p_request_id: request.id, p_decision: 'approved', p_response_note: null };
  assertNoError(await dietyApi.rpc('review_meal_change_request', reviewInput), 'dormant reviewed request');
  const note = assertNoError(await dietyApi.from('dietitian_notes').insert({
    dietitian_id: diety.id, client_id: client.id, title: 'Disposable linked note', content: 'Disposable health note',
  }).select().single(), 'dormant linked note');
  const generalNote = assertNoError(await dietyApi.from('dietitian_notes').insert({
    dietitian_id: diety.id, client_id: null, title: 'General task', content: 'General task without client health content',
  }).select().single(), 'dormant general note');

  runSql('update private.health_consent_settings set enabled=true where singleton;');
  const state = assertNoError(await clientApi.rpc('get_my_health_consent'), 'health state');
  assert(state.enabled === true && state.storage_granted === false && state.sharing_granted === false,
    'HEALTH_HTTP_NO_LEGACY_AUTO_CONSENT');
  const version = state.document_version;
  const consent = async (storage, sharing, documentVersion = version) => assertNoError(
    await clientApi.rpc('set_my_health_consent', { p_document_version: documentVersion,
      p_storage: storage, p_sharing: sharing }), 'save health preference');
  const assertHidden = async (api, table, column, id, label) => {
    const rows = assertNoError(await api.from(table).select('*').eq(column, id), label);
    assert(rows.length === 0, label);
  };
  const expectStorageDenied = (result, label) => assert(Boolean(result.error), label);
  const validate = (api, id = intent.id) => api.functions.invoke('validate-chat-image', { body: { intentId: id } });
  const expectValidatorDenied = async (result, label) => {
    assert(Boolean(result.error), label);
    const response = result.error?.context;
    assert(response instanceof Response && response.status === 404, label + '_GENERIC_404');
    const payload = await response.json();
    assert(payload.error?.code === 'not_found' && Object.keys(payload).length === 1, label + '_NO_PAYLOAD');
  };
  expectDenied(await anonymous.rpc('get_my_health_consent'), 'HEALTH_HTTP_ANON_DENIED');
  expectDenied(await dietyApi.rpc('set_my_health_consent', { p_document_version: version, p_storage: true, p_sharing: true }),
    'HEALTH_HTTP_DIETITIAN_CANNOT_GRANT_FOR_CLIENT');
  expectDenied(await clientApi.from('client_profiles').update({ current_weight: 71 }).eq('user_id', client.id),
    'HEALTH_HTTP_PROFILE_WRITE_NO_CONSENT');
  expectDenied(await clientApi.rpc('save_my_current_weight', { p_weight: 71 }), 'HEALTH_HTTP_DEFINER_WEIGHT_NO_CONSENT');
  expectDenied(await clientApi.rpc('set_my_meal_completion', { p_meal_id: mealId, p_is_eaten: true }),
    'HEALTH_HTTP_COMPLETION_NO_CONSENT');
  expectDenied(await clientApi.rpc('send_chat_message', messageInput), 'HEALTH_HTTP_TEXT_REPLAY_NO_CONSENT');
  expectDenied(await clientApi.rpc('create_chat_image_upload_intent', imageInput), 'HEALTH_HTTP_INTENT_REPLAY_NO_CONSENT');
  expectDenied(await dietyApi.rpc('review_meal_change_request', reviewInput), 'HEALTH_HTTP_REVIEW_REPLAY_NO_CONSENT');
  assertNoError(await clientApi.from('chat_messages').select('id').eq('id', message.id).single(), 'own old message');
  await assertHidden(dietyApi, 'chat_messages', 'id', message.id, 'HEALTH_HTTP_DIETITIAN_OLD_MESSAGE_HIDDEN');
  await assertHidden(dietyApi, 'measurements', 'client_id', client.id, 'HEALTH_HTTP_DIETITIAN_WEIGHT_HIDDEN');
  await assertHidden(dietyApi, 'dietitian_notes', 'id', note.id, 'HEALTH_HTTP_LINKED_NOTE_NO_CONSENT_HIDDEN');
  assertNoError(await dietyApi.from('dietitian_notes').select('id').eq('id', generalNote.id).single(), 'general note without consent');
  expectDenied(await dietyApi.from('dietitian_notes').insert({ dietitian_id: diety.id,
    client_id: client.id, title: 'Denied', content: 'Denied' }), 'HEALTH_HTTP_LINKED_NOTE_INSERT_NO_CONSENT');
  await expectValidatorDenied(await validate(clientApi), 'HEALTH_EDGE_NO_CONSENT');
  const intentUnchanged = assertNoError(await admin.from('chat_upload_intents').select('validated_at').eq('id', intent.id).single(), 'intent unchanged');
  assert(intentUnchanged.validated_at === null, 'HEALTH_EDGE_DENY_DID_NOT_VALIDATE');

  await consent(true, false);
  assertNoError(await clientApi.rpc('save_my_current_weight', { p_weight: 72 }), 'personal weight with storage');
  assertNoError(await clientApi.rpc('set_my_meal_completion', { p_meal_id: mealId, p_is_eaten: true }), 'personal completion with storage');
  const photoPath = `${client.id}/${mealId}/${randomUUID()}.jpg`;
  assertNoError(await clientApi.storage.from('meal-completion-photos').upload(photoPath,
    JPEG_FIXTURE, { contentType: 'image/jpeg', upsert: false }), 'personal completion photo');
  assertNoError(await clientApi.rpc('set_my_meal_completion_with_photo', { p_meal_id: mealId,
    p_is_eaten: true, p_completion_photo_url: photoPath }), 'personal completion with photo');
  await assertHidden(dietyApi, 'meals', 'id', mealId, 'HEALTH_HTTP_PERSONAL_TRACKING_NOT_SHARED');
  await assertHidden(dietyApi, 'dietitian_notes', 'id', note.id, 'HEALTH_HTTP_STORAGE_ONLY_NOT_NOTE_SHARING');
  expectStorageDenied(await dietyApi.storage.from('meal-completion-photos').download(photoPath), 'HEALTH_STORAGE_COMPLETION_NOT_SHARED');
  expectDenied(await clientApi.rpc('send_chat_message', messageInput), 'HEALTH_HTTP_STORAGE_ONLY_TEXT_REPLAY_DENIED');
  await expectValidatorDenied(await validate(clientApi), 'HEALTH_EDGE_STORAGE_ONLY_DENIED');

  await consent(true, true);
  assertNoError(await dietyApi.from('meals').select('id').eq('id', mealId).single(), 'dietitian meal with sharing');
  assertNoError(await dietyApi.from('dietitian_notes').update({ content: 'Sharing permits update' }).eq('id', note.id).select().single(), 'linked note update with sharing');
  expectDenied(await dietyApi.from('dietitian_notes').update({ client_id: null }).eq('id', note.id),
    'HEALTH_HTTP_LINKED_NOTE_CANNOT_BECOME_GENERAL');
  await assertHidden(foreignApi, 'dietitian_notes', 'id', note.id, 'HEALTH_HTTP_FOREIGN_NOTE_STILL_DENIED');
  await assertHidden(clientApi, 'dietitian_notes', 'id', note.id, 'HEALTH_HTTP_NOTE_STAYS_DIETITIAN_PRIVATE');
  const repeated = assertNoError(await clientApi.rpc('send_chat_message', messageInput), 'text replay with sharing');
  assert(repeated.id === message.id, 'HEALTH_HTTP_REAL_TEXT_REPLAY_WITH_SHARING');
  const imageValidation = assertNoError(await validate(clientApi), 'real Edge JPEG validation');
  assert(imageValidation.data?.width === 2 && imageValidation.data?.height === 3, 'HEALTH_EDGE_REAL_JPEG_DECODE');
  const imageMessage = assertNoError(await clientApi.rpc('finalize_chat_image_message', {
    p_intent_id: intent.id, p_caption: 'Disposable image' }), 'real image finalization');
  assert(imageMessage.message_kind === 'image', 'HEALTH_HTTP_REAL_IMAGE_FINALIZATION');
  assertNoError(await dietyApi.storage.from('chat-images').download(intent.object_path), 'dietitian image with sharing');
  expectStorageDenied(await foreignApi.storage.from('chat-images').download(intent.object_path), 'HEALTH_STORAGE_FOREIGN_STILL_DENIED');
  const signed = assertNoError(await dietyApi.storage.from('chat-images').createSignedUrl(intent.object_path, 300), 'new signed URL with sharing');
  assert(typeof signed.signedUrl === 'string', 'HEALTH_STORAGE_SIGNED_URL_WITH_SHARING');
  const counts = assertNoError(await dietyApi.rpc('get_dietitian_unread_counts'), 'real unread counts');
  assert(counts.some((row) => row.conversation_id === message.conversation_id), 'HEALTH_HTTP_UNREAD_WITH_SHARING');
  const notification = assertNoError(await dietyApi.from('notifications').select('id').eq('conversation_id', message.conversation_id).single(), 'health chat notification');
  const target = assertNoError(await dietyApi.rpc('set_client_nutrition_target', { p_client_id: client.id,
    p_min_kcal: 1500, p_max_kcal: 1700 }), 'nutrition target with sharing');
  assert(target.min_kcal === 1500, 'HEALTH_HTTP_TARGET_WITH_SHARING');
  // No sender worker exists; a fake installation only exercises the local outbox.
  assertNoError(await dietyApi.rpc('register_push_installation', { p_installation_id: randomUUID(),
    p_expo_push_token: `ExpoPushToken[health-local-${randomUUID()}]`, p_platform: 'android', p_project_id: randomUUID() }), 'local push registration');
  const newMessage = assertNoError(await clientApi.rpc('send_chat_message', { ...messageInput,
    p_client_message_id: randomUUID(), p_body: 'Disposable push eligibility' }), 'push source message');
  const deliveryId = runSql(`select id::text from private.push_deliveries where notification_id='${notification.id}' order by created_at desc limit 1`);
  assert(Boolean(deliveryId), 'HEALTH_RUNTIME_REAL_PUSH_DELIVERY_CREATED');
  const pendingIntent = assertNoError(await clientApi.rpc('create_chat_image_upload_intent', {
    ...imageInput, p_client_message_id: randomUUID() }), 'second image intent with sharing');
  assertNoError(await clientApi.storage.from(pendingIntent.bucket_id).upload(pendingIntent.object_path,
    JPEG_FIXTURE, { contentType: 'image/jpeg', upsert: false }), 'second real image upload');

  await consent(false, false);
  await assertHidden(dietyApi, 'dietitian_notes', 'id', note.id, 'HEALTH_HTTP_LINKED_NOTE_HIDDEN_AFTER_NEGATIVE');
  expectDenied(await admin.from('dietitian_notes').update({ content: 'Denied service update' }).eq('id', note.id),
    'HEALTH_HTTP_SERVICE_NOTE_WRITE_DENIED');
  expectDenied(await admin.from('dietitian_notes').update({ client_id: null }).eq('id', note.id),
    'HEALTH_HTTP_SERVICE_NOTE_UNLINK_DENIED');
  assertNoError(await admin.from('dietitian_notes').select('id').eq('id', note.id).single(), 'linked note retention is separate');
  assertNoError(await dietyApi.from('dietitian_notes').delete().eq('id', generalNote.id).select().single(), 'general note delete without consent');
  await expectValidatorDenied(await validate(clientApi, pendingIntent.id), 'HEALTH_EDGE_PENDING_AFTER_NEGATIVE');
  expectDenied(await admin.rpc('record_chat_image_validation', { p_intent_id: pendingIntent.id,
    p_validated_mime: 'image/jpeg', p_validated_byte_size: JPEG_FIXTURE.length,
    p_validated_width: 2, p_validated_height: 3 }), 'HEALTH_HTTP_SERVICE_VALIDATION_WRITE_DENIED');
  const aborted = assertNoError(await clientApi.rpc('abort_chat_image_upload', { p_intent_id: pendingIntent.id }),
    'own pending image abort after negative');
  assert(aborted.status === 'aborted', 'HEALTH_HTTP_REAL_UPLOAD_ABORT_PRESERVED');
  await assertHidden(dietyApi, 'chat_attachments', 'message_id', imageMessage.id, 'HEALTH_HTTP_ATTACHMENT_HIDDEN_AFTER_NEGATIVE');
  await assertHidden(dietyApi, 'notifications', 'id', notification.id, 'HEALTH_HTTP_NOTIFICATION_HIDDEN_AFTER_NEGATIVE');
  const hiddenCounts = assertNoError(await dietyApi.rpc('get_dietitian_unread_counts'), 'hidden unread counts');
  assert(!hiddenCounts.some((row) => row.conversation_id === message.conversation_id), 'HEALTH_HTTP_UNREAD_HIDDEN_AFTER_NEGATIVE');
  expectDenied(await dietyApi.rpc('mark_notification_read', { p_notification_id: notification.id }), 'HEALTH_HTTP_NOTIFICATION_RPC_PAYLOAD_DENIED');
  expectDenied(await clientApi.rpc('finalize_chat_image_message', { p_intent_id: intent.id, p_caption: 'Disposable image' }),
    'HEALTH_HTTP_REAL_FINALIZED_REPLAY_DENIED');
  const cleared = assertNoError(await dietyApi.rpc('set_client_nutrition_target', { p_client_id: client.id,
    p_min_kcal: null, p_max_kcal: null }), 'nutrition cleanup without sharing');
  // PostgREST serializes SQL NULL composite results as an all-null object.
  // Assert no target field survives, rather than requiring a JS scalar null.
  assert(cleared === null || (typeof cleared === 'object' && !Array.isArray(cleared)
    && Object.values(cleared).every((value) => value === null)),
  'HEALTH_HTTP_CLEANUP_DOES_NOT_RETURN_OLD_TARGET', JSON.stringify(cleared));
  const targets = assertNoError(await admin.from('client_nutrition_targets').select('client_id').eq('client_id', client.id), 'target cleanup result');
  assert(targets.length === 0, 'HEALTH_HTTP_TARGET_CLEANUP_REALLY_REMOVED');
  expectStorageDenied(await dietyApi.storage.from('chat-images').createSignedUrl(intent.object_path, 300),
    'HEALTH_STORAGE_NEW_SIGNED_URL_DENIED_AFTER_NEGATIVE');
  // Already-issued capabilities are not recalled: this is an explicit bounded
  // limitation, not a false instant-revocation guarantee.
  const previousDownload = await fetch(signed.signedUrl);
  assert(previousDownload.ok, 'HEALTH_STORAGE_PRIOR_SIGNED_URL_REMAINS_BOUNDED');
  expectStorageDenied(await dietyApi.storage.from('meal-completion-photos').download(photoPath), 'HEALTH_STORAGE_DIETITIAN_AFTER_NEGATIVE');
  assertNoError(await clientApi.storage.from('meal-completion-photos').download(photoPath), 'own past photo after negative');
  const deleted = assertNoError(await clientApi.rpc('delete_chat_message', { p_message_id: message.id }), 'own message soft delete after negative');
  assert(deleted.deleted_at && deleted.body === null, 'HEALTH_HTTP_REAL_SOFT_DELETE_PRESERVED');
  const deletedImage = assertNoError(await clientApi.rpc('delete_chat_message', { p_message_id: imageMessage.id }), 'own image delete after negative');
  assert(deletedImage.deleted_at, 'HEALTH_HTTP_IMAGE_SOFT_DELETE_PRESERVED');
  const validatorRetry = await validate(clientApi);
  await expectValidatorDenied(validatorRetry, 'HEALTH_EDGE_AFTER_NEGATIVE');
  expectDenied(await admin.from('measurements').insert({ client_id: client.id, measured_at: today,
    weight: 80 }), 'HEALTH_HTTP_SERVICE_CORE_WRITE_DENIED');
  expectDenied(await admin.from('meals').update({ is_eaten: false }).eq('id', mealId), 'HEALTH_HTTP_SERVICE_MEAL_WRITE_DENIED');
  runSql(`update private.push_deliveries set status='claimed' where id='${deliveryId}';`);
  assert(runSql(`select status from private.push_deliveries where id='${deliveryId}'`) === 'disabled', 'HEALTH_RUNTIME_REAL_PUSH_STOPPED');
  const occurrencesBefore = runSql(`select count(*) from private.push_occurrences where notification_id='${notification.id}'`);
  const skipped = runSql(`select (private.upsert_notification_aggregate('${diety.id}','chat_message','new_message',
    'chat:${message.conversation_id}','chat_new_message','${client.id}','${message.conversation_id}')).id is null`);
  assert(skipped === 't', 'HEALTH_RUNTIME_REAL_AGGREGATE_PRODUCER_SKIPPED');
  assert(runSql(`select count(*) from private.push_occurrences where notification_id='${notification.id}'`) === occurrencesBefore,
    'HEALTH_RUNTIME_NO_NEW_PUSH_WITHOUT_CONSENT');

  // Enabling consent must not block empty Auth bootstrap for a new client.
  const newClient = await createActor('health-new-after-enabled', 'client');
  const newApi = await signIn(newClient);
  const newState = assertNoError(await newApi.rpc('get_my_health_consent'), 'new client state');
  assert(newState.storage_granted === false, 'HEALTH_HTTP_NEW_AUTH_BOOTSTRAP_WITHOUT_CONSENT');
  await consent(true, true);
  runSql("update private.health_consent_settings set document_version='health-runtime-v2' where singleton;");
  await assertHidden(dietyApi, 'dietitian_notes', 'id', note.id, 'HEALTH_HTTP_NOTE_DOCUMENT_VERSION_INVALIDATES');
  assertNoError(await admin.from('dietitian_notes').delete().eq('id', note.id).select().single(), 'privileged account-note cleanup remains possible');
  expectDenied(await clientApi.rpc('send_chat_message', { ...messageInput, p_client_message_id: randomUUID() }),
    'HEALTH_HTTP_NEW_DOCUMENT_VERSION_BLOCKS_OLD_CONSENT');
  assert(runSql(`select count(*) from private.health_consent_events where user_id='${client.id}'`) === '4',
    'HEALTH_RUNTIME_SERVER_LEDGER_EVENTS');
  // Keep explicit ownership of test records; the enclosing stack is discarded.
  assertNoError(await clientApi.storage.from('meal-completion-photos').download(photoPath), 'own past photo after version change');
  assertNoError(await clientApi.from('chat_messages').select('id').eq('id', newMessage.id).single(), 'own past records after version change');
};
