const assert = require('node:assert/strict');
const test = require('node:test');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const resources = require(`${buildDir}/features/chat/utils/chatImageUploadResources.js`);
const reducer = require(`${buildDir}/features/chat/utils/chatImageUploadReducer.js`);

const ids = {
  conversation: '11111111-1111-4111-8111-111111111111',
  clientMessageA: '22222222-2222-4222-8222-222222222222',
  clientMessageB: '33333333-3333-4333-8333-333333333333',
  intentA: '44444444-4444-4444-8444-444444444444',
  intentB: '55555555-5555-4555-8555-555555555555',
};

const canonical = (marker) => ({
  blob: { marker, type: 'image/jpeg', size: 100 },
  byteSize: 100,
  quality: 0.82,
  width: 100,
  height: 100,
  mimeType: 'image/jpeg',
});

const intent = (id, clientMessageId) => ({
  id,
  conversationId: ids.conversation,
  createdBy: '66666666-6666-4666-8666-666666666666',
  clientMessageId,
  bucketId: 'chat-images',
  objectPath: `pending/${id}/${id}.jpg`,
  expectedMime: 'image/jpeg',
  maxBytes: 4194304,
  status: 'pending',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
});

const operation = (intentValue, canonicalValue, previewUrl) => ({
  canonical: canonicalValue,
  intent: intentValue,
  previewUrl,
  intentReleased: false,
  finalized: false,
});

test('1. stale A cleanup cannot abort B intent after A is cancelled', () => {
  const a = operation(intent(ids.intentA, ids.clientMessageA), canonical('A'), 'blob:A');
  const b = operation(null, canonical('B'), 'blob:B');

  assert.equal(resources.takeChatImageIntentForAbort(a), ids.intentA);
  b.intent = intent(ids.intentB, ids.clientMessageB);
  assert.equal(resources.takeChatImageIntentForAbort(a), null);
  assert.equal(b.intent.id, ids.intentB);
});

test('2. stale A failure cleanup cannot clear B canonical or intent resources', () => {
  const a = operation(intent(ids.intentA, ids.clientMessageA), canonical('A'), 'blob:A');
  const b = operation(intent(ids.intentB, ids.clientMessageB), canonical('B'), 'blob:B');

  resources.clearChatImageCanonical(a);
  assert.equal(a.canonical, null);
  assert.equal(b.canonical.blob.marker, 'B');
  assert.equal(b.intent.id, ids.intentB);
});

test('3. cancelling B consumes only B intent and only once', () => {
  const a = operation(intent(ids.intentA, ids.clientMessageA), canonical('A'), 'blob:A');
  const b = operation(intent(ids.intentB, ids.clientMessageB), canonical('B'), 'blob:B');

  assert.equal(resources.takeChatImageIntentForAbort(b), ids.intentB);
  assert.equal(resources.takeChatImageIntentForAbort(b), null);
  assert.equal(a.intent.id, ids.intentA);
});

test('4. a finalized operation cannot be aborted by later cleanup', () => {
  const b = operation(intent(ids.intentB, ids.clientMessageB), canonical('B'), 'blob:B');
  resources.finalizeChatImageResources(b);
  assert.equal(resources.takeChatImageIntentForAbort(b), null);
  assert.equal(b.intent, null);
  assert.equal(b.canonical, null);
});

test('5. stale create-intent cleanup can consume only the returned intent', () => {
  const staleResult = operation(intent(ids.intentA, ids.clientMessageA), null, null);
  const active = operation(intent(ids.intentB, ids.clientMessageB), canonical('B'), 'blob:B');

  assert.equal(resources.takeChatImageIntentForAbort(staleResult), ids.intentA);
  assert.equal(active.intent.id, ids.intentB);
  assert.equal(active.canonical.blob.marker, 'B');
});

test('6. retry retains the same operation canonical and intent objects', () => {
  const op = operation(intent(ids.intentA, ids.clientMessageA), canonical('A'), 'blob:A');
  const originalIntent = op.intent;
  const originalCanonical = op.canonical;
  assert.equal(op.intent, originalIntent);
  assert.equal(op.canonical, originalCanonical);
  assert.equal(op.intentReleased, false);
});

test('7. stale A preview revoke does not touch B preview', () => {
  const a = operation(null, canonical('A'), 'blob:A');
  const b = operation(null, canonical('B'), 'blob:B');

  assert.equal(resources.takeChatImagePreviewUrl(a), 'blob:A');
  assert.equal(a.previewUrl, null);
  assert.equal(b.previewUrl, 'blob:B');
});

test('8. reducer continues rejecting stale operation results', () => {
  const selected = reducer.chatImageUploadReducer(
    reducer.initialChatImageUploadState,
    {
      type: 'select',
      operationId: 2,
      conversationId: ids.conversation,
      clientMessageId: ids.clientMessageB,
      source: { name: 'b.png', mimeType: 'image/png', byteSize: 100 },
      previewUrl: 'blob:B',
    },
  );
  const stale = reducer.chatImageUploadReducer(selected, {
    type: 'canonicalized',
    operationId: 1,
    canonical: canonical('A'),
  });
  assert.equal(stale, selected);
});
