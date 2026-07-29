const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const repoRoot = path.join(__dirname, '..');
const ui = require(path.join(buildDir, 'features', 'chat', 'utils', 'chatImageUiState.js'));

const idle = () => ({
  status: 'idle',
  operationId: 0,
  conversationId: null,
  clientMessageId: null,
  source: null,
  previewUrl: null,
  canonical: null,
  intent: null,
  progress: null,
  error: null,
  retryStage: null,
});

const selected = (overrides = {}) => ({
  ...idle(),
  status: 'selected',
  operationId: 1,
  conversationId: '11111111-1111-4111-8111-111111111111',
  clientMessageId: '22222222-2222-4222-8222-222222222222',
  source: { name: 'olcum.png', mimeType: 'image/png', byteSize: 1200 },
  previewUrl: 'blob:preview',
  ...overrides,
});

const source = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('1. flag false hides the image picker', () => {
  const picker = ui.getChatImagePickerUiState(false, '11111111-1111-4111-8111-111111111111', false);
  assert.equal(picker.visible, false);
  assert.equal(picker.enabled, false);
});

test('2. flag true without conversationId keeps picker visible but disabled', () => {
  const picker = ui.getChatImagePickerUiState(true, null, false);
  assert.equal(picker.visible, true);
  assert.equal(picker.enabled, false);
});

test('3. disabled picker explains that a text message must come first', () => {
  const picker = ui.getChatImagePickerUiState(true, null, false);
  assert.equal(picker.disabledMessage, 'Görsel göndermek için önce bir metin mesajı gönderin.');
});

test('4. file selection stays local and cannot start RPC or Storage work', () => {
  const hook = source('features/chat/hooks/useChatImageUpload.ts');
  const selectStart = hook.indexOf('const selectImage');
  const selectEnd = hook.indexOf('const startUpload', selectStart);
  const selectionBody = hook.slice(selectStart, selectEnd);
  assert.match(selectionBody, /type: 'select'/);
  assert.doesNotMatch(selectionBody, /runStages|createChatImageUploadIntent|uploadCanonicalChatImage|finalizeChatImageMessage/);
  assert.match(hook, /const startUpload/);
});

test('5. picker accept list and MIME guard allow only JPEG, PNG and WebP', () => {
  assert.equal(ui.CHAT_IMAGE_PICKER_ACCEPT, 'image/jpeg,image/png,image/webp');
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(ui.isChatImagePickerFileAccepted(mime), true, mime);
  }
  for (const mime of ['image/heic', 'image/gif', 'image/svg+xml', 'application/pdf', 'image/JPEG']) {
    assert.equal(ui.isChatImagePickerFileAccepted(mime), false, mime);
  }
});

test('6. selected image can send with an empty caption', () => {
  assert.equal(ui.canSendChatComposer('', false, false, selected()), true);
  assert.equal(ui.canSendChatComposer('   ', false, false, selected()), true);
});

test('7. empty text without an image cannot send', () => {
  assert.equal(ui.canSendChatComposer('', false, false, idle()), false);
  assert.equal(ui.canSendChatComposer('   ', false, false, null), false);
  assert.equal(ui.canSendChatComposer('Merhaba', false, false, idle()), true);
});

test('8. captions are trimmed and blank captions become null', () => {
  assert.equal(ui.normalizeChatImageUiCaption('  Ölçüm sonucu  '), 'Ölçüm sonucu');
  assert.equal(ui.normalizeChatImageUiCaption('  \n '), null);
});

test('9. captions beyond 4000 characters are blocked before upload', () => {
  assert.equal(ui.isChatImageUiCaptionValid('a'.repeat(4000)), true);
  assert.equal(ui.isChatImageUiCaptionValid('a'.repeat(4001)), false);
  assert.equal(ui.canSendChatComposer('a'.repeat(4001), false, false, selected()), false);
});

test('10. a second send is blocked while image work is in flight', () => {
  for (const status of ['canonicalizing', 'creating-intent', 'uploading', 'finalizing']) {
    const state = selected({ status });
    assert.equal(ui.isChatImageUploadInFlight(state), true, status);
    assert.equal(ui.canSendChatComposer('', false, false, state), false, status);
  }
});

test('11. upload lifecycle stages use the approved indeterminate labels', () => {
  const labels = new Map([
    ['canonicalizing', 'Görsel hazırlanıyor'],
    ['creating-intent', 'Gönderim hazırlanıyor'],
    ['uploading', 'Görsel yükleniyor'],
    ['finalizing', 'Mesaj tamamlanıyor'],
  ]);
  for (const [status, label] of labels) {
    assert.equal(ui.getChatImageUploadStatusLabel(selected({ status })), label);
  }
  assert.equal(ui.getChatImageUploadStatusLabel(selected()), null);
});

test('12. retry appears only for retryable failed states', () => {
  assert.equal(ui.shouldShowChatImageRetry(selected({
    status: 'failed',
    error: { code: 'storage_upload_failed', userMessage: 'x', retryable: true },
    retryStage: 'uploading',
  })), true);
  assert.equal(ui.shouldShowChatImageRetry(selected({
    status: 'failed',
    error: { code: 'access_denied', userMessage: 'x', retryable: false },
    retryStage: null,
  })), false);
});

test('13. feature_unavailable never offers retry and uses the safe user message', () => {
  const state = selected({
    status: 'failed',
    error: { code: 'feature_unavailable', userMessage: 'raw function error', retryable: true },
    retryStage: 'creating-intent',
  });
  assert.equal(ui.shouldShowChatImageRetry(state), false);
  assert.equal(ui.getChatImageUploadErrorMessage(state), 'Görsel gönderme özelliği henüz kullanıma açık değil.');
});

test('14. removing a local selection has no abort RPC requirement', () => {
  const hook = source('features/chat/hooks/useChatImageUpload.ts');
  assert.match(hook, /const cancel/);
  assert.match(hook, /const intentId = intentIdRef\.current;/);
  assert.match(hook, /if \(!intentId \|\| operation\?\.finalized\) return;/);
  assert.match(hook, /type: 'select'/);
});

test('15. a cancellation after intent creation preserves best-effort abort', () => {
  const hook = source('features/chat/hooks/useChatImageUpload.ts');
  assert.match(hook, /void abortChatImageUploadQuietly\(intentId\)/);
  assert.match(hook, /releaseIntent\(operation\);\n    disposeOperation\(operation\);/);
});

test('16. a finalized intent is never aborted', () => {
  const hook = source('features/chat/hooks/useChatImageUpload.ts');
  assert.match(hook, /operation\.finalized = true;/);
  assert.match(hook, /if \(!intentId \|\| operation\?\.finalized\) return;/);
  assert.match(hook, /intentIdRef\.current = null;/);
});

test('17. success contract clears preview, source, canonical blob and intent', () => {
  const success = selected({
    status: 'succeeded',
    source: null,
    previewUrl: null,
    canonical: null,
    intent: null,
  });
  assert.equal(ui.shouldClearChatImageComposerAfterSuccess(success), true);
});

test('18. image bubble uses the caption when available', () => {
  const label = ui.getChatImageBubbleLabel({
    body: '  Günlük ölçüm  ',
    attachment: { id: 'safe-metadata' },
  });
  assert.equal(label, 'Günlük ölçüm');
});

test('19. image bubble falls back to Görsel without a caption', () => {
  const label = ui.getChatImageBubbleLabel({ body: null, attachment: { id: 'safe-metadata' } });
  assert.equal(label, 'Görsel');
});

test('20. renderer never turns bucket or object paths into user-facing text', () => {
  const bubble = source('features/chat/components/ChatImageBubble.tsx');
  const uiState = source('features/chat/utils/chatImageUiState.ts');
  assert.doesNotMatch(bubble, /objectPath|bucketId|intentId/);
  assert.match(uiState, /Görsel kullanılamıyor/);
});

test('21. this slice adds no signed URL generation or private Storage download', () => {
  const files = [
    'features/chat/components/ChatComposer.tsx',
    'features/chat/components/ChatImageBubble.tsx',
    'features/chat/hooks/useChatImageUpload.ts',
    'pages/Messages.tsx',
  ].map(source).join('\n');
  assert.doesNotMatch(files, /createSignedUrl|createSignedUploadUrl|\.download\(/);
});

test('22. components and Messages page issue no direct Supabase calls', () => {
  const files = [
    'features/chat/components/ChatComposer.tsx',
    'features/chat/components/ChatImagePreview.tsx',
    'features/chat/components/ChatImageUploadStatus.tsx',
    'features/chat/components/ChatImageBubble.tsx',
    'pages/Messages.tsx',
  ].map(source).join('\n');
  assert.doesNotMatch(files, /supabase\./);
});

test('23. finalize success is reconciled through fetchChatMessageById in Messages', () => {
  const page = source('pages/Messages.tsx');
  assert.match(page, /fetchChatMessageById\(result\.messageId, result\.conversationId, user\.id\)/);
  assert.match(page, /if \(message\) mergeCommittedMessage\(message\);/);
  assert.match(page, /onFinalized: handleImageFinalized/);
});

test('24. failed reconciliation does not create a partial image message', () => {
  const page = source('pages/Messages.tsx');
  const reconciliation = page.slice(
    page.indexOf('const handleImageFinalized'),
    page.indexOf('const imageUpload = useChatImageUpload'),
  );
  assert.match(reconciliation, /\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(reconciliation, /messageKind:\s*'image'|attachment:/);
});

test('25. text-only composer behavior remains a separate onSend branch', () => {
  const composer = source('features/chat/components/ChatComposer.tsx');
  assert.match(composer, /if \(imageSelected\) \{\n      void imageUpload\.startUpload\(draft\);/);
  assert.match(composer, /\n    onSend\(\);/);
  assert.match(composer, /event\.key !== 'Enter' \|\| event\.shiftKey \|\| event\.nativeEvent\.isComposing/);
});
