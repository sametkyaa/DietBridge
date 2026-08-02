const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const repoRoot = path.join(__dirname, '..');
const supabaseClient = require(path.join(buildDir, 'lib', 'supabaseClient.js'));
const chatService = require(path.join(buildDir, 'features', 'chat', 'services', 'chatService.js'));
const readService = require(path.join(buildDir, 'features', 'chat', 'services', 'chatImageReadService.js'));
const preview = require(path.join(buildDir, 'features', 'chat', 'utils', 'conversationPreview.js'));

const ids = {
  conversation: '11111111-1111-4111-8111-111111111111',
  message: '22222222-2222-4222-8222-222222222222',
  sender: '33333333-3333-4333-8333-333333333333',
  clientMessage: '44444444-4444-4444-8444-444444444444',
  attachment: '55555555-5555-4555-8555-555555555555',
  intent: '66666666-6666-4666-8666-666666666666',
  object: '77777777-7777-4777-8777-777777777777',
};

const objectPath = `pending/${ids.intent}/${ids.object}.jpg`;

const attachmentRow = (overrides = {}) => ({
  id: ids.attachment,
  message_id: ids.message,
  bucket_id: 'chat-images',
  object_path: objectPath,
  mime_type: 'image/jpeg',
  byte_size: 128000,
  width: 2048,
  height: 2048,
  deleted_at: null,
  ...overrides,
});

const messageRow = (overrides = {}) => ({
  id: ids.message,
  conversation_id: ids.conversation,
  sender_id: ids.sender,
  client_message_id: ids.clientMessage,
  body: 'Merhaba',
  message_kind: 'text',
  created_at: '2026-07-28T10:00:00.000Z',
  deleted_at: null,
  deleted_by: null,
  attachment: null,
  ...overrides,
});

const imageRow = (overrides = {}) => messageRow({
  body: null,
  message_kind: 'image',
  attachment: attachmentRow(),
  ...overrides,
});

/**
 * Minimal chainable PostgREST stub: every builder method returns itself and the
 * builder resolves to the configured rows.
 */
const stubMessageRows = (rows) => {
  const selected = [];
  const builder = {
    select: (columns) => { selected.push(columns); return builder; },
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  supabaseClient.__setFromHandler((table) => {
    if (table !== 'chat_messages') throw new Error(`Unexpected table: ${table}`);
    return builder;
  });
  return selected;
};

const fetchOne = async (row) => {
  stubMessageRows([row]);
  const page = await chatService.fetchChatMessages(ids.conversation, ids.sender);
  return page.messages;
};

const assertRejected = async (row) => {
  stubMessageRows([row]);
  await assert.rejects(
    () => chatService.fetchChatMessages(ids.conversation, ids.sender),
    (error) => error.name === 'ChatServiceError',
  );
};

test('message projection requests message_kind and attachment metadata', async () => {
  const selected = stubMessageRows([messageRow()]);
  await chatService.fetchChatMessages(ids.conversation, ids.sender);
  assert.equal(selected.length, 1);
  assert.match(selected[0], /\bmessage_kind\b/);
  assert.match(selected[0], /attachment:chat_attachments\(/);
  for (const column of ['bucket_id', 'object_path', 'mime_type', 'byte_size', 'width', 'height']) {
    assert.match(selected[0], new RegExp(`\\b${column}\\b`), column);
  }
});

test('valid live text message normalizes and stays text-kind', async () => {
  const [message] = await fetchOne(messageRow({ body: '  Merhaba  ' }));
  assert.equal(message.body, 'Merhaba');
  assert.equal(message.messageKind, 'text');
  assert.equal(message.attachment, null);
  assert.equal(message.deliveryState, 'sent');
});

test('missing message_kind stays backward compatible as text', async () => {
  const row = messageRow();
  delete row.message_kind;
  const [message] = await fetchOne(row);
  assert.equal(message.messageKind, 'text');
});

test('live text message without a usable body is rejected', async () => {
  await assertRejected(messageRow({ body: null }));
  await assertRejected(messageRow({ body: '   ' }));
});

test('live text message must not carry a live attachment', async () => {
  await assertRejected(messageRow({ attachment: attachmentRow() }));
});

test('live text message with malformed attachment metadata is rejected', async () => {
  await assertRejected(messageRow({
    attachment: attachmentRow({ mime_type: 'image/png' }),
  }));
  await assertRejected(messageRow({ attachment: { bucket_id: 'avatars' } }));
  await assertRejected(messageRow({ attachment: 'malformed-attachment' }));
});

test('caption-less image message normalizes with null body', async () => {
  const [message] = await fetchOne(imageRow());
  assert.equal(message.messageKind, 'image');
  assert.equal(message.body, null);
  assert.equal(message.attachment.objectPath, objectPath);
  assert.equal(message.attachment.mimeType, 'image/jpeg');
  assert.equal(message.attachment.byteSize, 128000);
  assert.equal(message.attachment.width, 2048);
  assert.equal(message.attachment.height, 2048);
});

test('image caption is trimmed and empty captions normalize to null', async () => {
  const [captioned] = await fetchOne(imageRow({ body: '  Ölçüm sonucu  ' }));
  assert.equal(captioned.body, 'Ölçüm sonucu');
  const [blank] = await fetchOne(imageRow({ body: '   ' }));
  assert.equal(blank.body, null);
});

test('image message without attachment metadata is rejected', async () => {
  await assertRejected(imageRow({ attachment: null }));
  await assertRejected(imageRow({ attachment: undefined }));
});

test('image message with a soft-deleted attachment is rejected', async () => {
  await assertRejected(imageRow({ attachment: attachmentRow({ deleted_at: '2026-07-28T11:00:00.000Z' }) }));
});

test('attachment metadata outside the canonical JPEG contract is rejected', async () => {
  const invalidAttachments = [
    { mime_type: 'image/png' },
    { mime_type: 'image/webp' },
    { bucket_id: 'avatars' },
    { object_path: `pending/${ids.intent}/${ids.object}.png` },
    { object_path: objectPath.replace('.jpg', '.JPG') },
    { object_path: objectPath.replace(ids.intent, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA') },
    { object_path: `${ids.intent}/${ids.object}.jpg` },
    { object_path: `pending/${ids.intent}/../${ids.object}.jpg` },
    { byte_size: 0 },
    { byte_size: 4194305 },
    { byte_size: 1024.5 },
    { width: 2049 },
    { height: 2049 },
    { width: 4096, height: 2048 },
    { message_id: ids.conversation },
    { id: 'not-a-uuid' },
  ];
  for (const overrides of invalidAttachments) {
    await assertRejected(imageRow({ attachment: attachmentRow(overrides) }));
  }
});

test('unknown message_kind values are rejected', async () => {
  for (const kind of ['video', 'file', '', 'TEXT', 7]) {
    await assertRejected(messageRow({ message_kind: kind }));
  }
});

test('image tombstones keep the existing deleted-message contract', async () => {
  const [message] = await fetchOne(imageRow({
    body: null,
    deleted_at: '2026-07-28T11:00:00.000Z',
    deleted_by: ids.sender,
    attachment: attachmentRow({ deleted_at: '2026-07-28T11:00:00.000Z' }),
  }));
  assert.equal(message.messageKind, 'image');
  assert.equal(message.body, null);
  assert.equal(message.attachment, null);
  assert.equal(message.deletedBy, ids.sender);
});

test('conversation preview labels caption-less image rows without hiding them', () => {
  const base = { lastMessageId: ids.message, lastMessageBody: null, lastMessageKind: 'image' };
  assert.equal(preview.getChatConversationPreview(base), 'Görsel');
  assert.equal(preview.getChatConversationPreview({ ...base, lastMessageBody: '   ' }), 'Görsel');
  assert.equal(
    preview.getChatConversationPreview({ ...base, lastMessageBody: '  Ölçüm  ' }),
    'Ölçüm',
  );
  assert.equal(
    preview.getChatConversationPreview({ ...base, lastMessageKind: 'text', lastMessageBody: 'Merhaba' }),
    'Merhaba',
  );
  assert.equal(
    preview.getChatConversationPreview({ lastMessageId: null, lastMessageBody: null, lastMessageKind: null }),
    'Henüz mesajlaşma başlamadı',
  );
});

test('chat image feature flag is opt-in and defaults to disabled', () => {
  const envSource = fs.readFileSync(path.join(repoRoot, 'lib', 'env.ts'), 'utf8');
  assert.match(envSource, /enableChatImages:\s*import\.meta\.env\.VITE_ENABLE_CHAT_IMAGES === 'true'/);

  const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  assert.match(envExample, /^VITE_ENABLE_CHAT_IMAGES=false$/m);

  const viteEnvTypes = fs.readFileSync(path.join(repoRoot, 'vite-env.d.ts'), 'utf8');
  assert.match(viteEnvTypes, /readonly VITE_ENABLE_CHAT_IMAGES\?: string;/);
});

test('this slice adds no upload, picker, canonicalizer or signed-URL code', () => {
  const serviceSource = fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'services', 'chatService.ts'),
    'utf8',
  );
  assert.doesNotMatch(serviceSource, /createSignedUrl|storage\s*\.\s*from|\.upload\(/);
  assert.doesNotMatch(serviceSource, /create_chat_image_upload_intent|finalize_chat_image_message|abort_chat_image_upload/);
});

const readableMessage = (overrides = {}) => ({
  id: ids.message,
  messageKind: 'image',
  deletedAt: null,
  attachment: {
    id: ids.attachment,
    messageId: ids.message,
    bucketId: 'chat-images',
    objectPath,
    mimeType: 'image/jpeg',
    byteSize: 128000,
    width: 2048,
    height: 1536,
    deletedAt: null,
  },
  ...overrides,
});

test('private URL resolver rejects malformed, tombstoned, and foreign attachment paths', () => {
  assert.equal(readService.getReadableChatImagePath(readableMessage()), objectPath);
  for (const message of [
    readableMessage({ deletedAt: '2026-07-30T10:00:00.000Z' }),
    readableMessage({ attachment: { ...readableMessage().attachment, objectPath: objectPath.replace('.jpg', '.JPG') } }),
    readableMessage({ attachment: { ...readableMessage().attachment, objectPath: `pending/${ids.intent}/../${ids.object}.jpg` } }),
    readableMessage({ attachment: { ...readableMessage().attachment, bucketId: 'avatars' } }),
    readableMessage({ attachment: { ...readableMessage().attachment, deletedAt: '2026-07-30T10:00:00.000Z' } }),
  ]) assert.equal(readService.getReadableChatImagePath(message), null);
});

test('private URL resolver batches paths, caches them and purges tombstones', async () => {
  readService.clearChatImageSignedUrlCache();
  let calls = 0;
  supabaseClient.__setStorageHandler((bucket) => ({
    createSignedUrls: async (paths, ttl) => {
      calls += 1;
      assert.equal(bucket, 'chat-images');
      assert.equal(ttl, 300);
      return { data: paths.map((item) => ({ path: item, signedUrl: `https://signed.invalid/${calls}` })), error: null };
    },
  }));
  const first = await readService.resolveChatImageSignedUrls([readableMessage()]);
  assert.equal(first.get(objectPath), 'https://signed.invalid/1');
  const second = await readService.resolveChatImageSignedUrls([readableMessage()]);
  assert.equal(second.get(objectPath), 'https://signed.invalid/1');
  assert.equal(calls, 1, 'a fresh URL is served from bounded cache');
  readService.purgeChatImageSignedUrl(objectPath);
  await readService.resolveChatImageSignedUrls([readableMessage()]);
  assert.equal(calls, 2);
});
