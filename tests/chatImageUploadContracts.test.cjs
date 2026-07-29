const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const repoRoot = path.join(__dirname, '..');
const compiled = (...segments) => require(path.join(buildDir, ...segments));

const supabaseClient = compiled('lib', 'supabaseClient.js');
const plan = compiled('features', 'chat', 'utils', 'canonicalJpegPlan.js');
const canonicalizer = compiled('features', 'chat', 'utils', 'canonicalizeChatImage.js');
const reducer = compiled('features', 'chat', 'utils', 'chatImageUploadReducer.js');
const uploadTypes = compiled('features', 'chat', 'types', 'chatImageUpload.js');
const imageService = compiled('features', 'chat', 'services', 'chatImageService.js');
const chatService = compiled('features', 'chat', 'services', 'chatService.js');

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

// ---------------------------------------------------------------------------
// 1-8: canonical JPEG plan (pure)
// ---------------------------------------------------------------------------

test('1. JPEG, PNG and WebP sources are accepted', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    const result = plan.planCanonicalJpeg({ sourceMimeType: mime, width: 800, height: 600 });
    assert.equal(result.ok, true, mime);
    assert.equal(result.plan.sourceMimeType, mime);
    assert.equal(result.plan.outputMimeType, 'image/jpeg');
    assert.equal(result.plan.outputExtension, 'jpg');
  }
});

test('2. HEIC, GIF, SVG, PDF and unknown types are rejected', () => {
  const rejected = [
    'image/heic',
    'image/heif',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    '',
    'image/JPEG',
    null,
    undefined,
    7,
  ];
  for (const mime of rejected) {
    const result = plan.planCanonicalJpeg({ sourceMimeType: mime, width: 800, height: 600 });
    assert.equal(result.ok, false, String(mime));
    assert.equal(result.reason, 'unsupported_type');
  }
});

test('3. the 2048 px longest-edge limit is applied', () => {
  const landscape = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: 6000, height: 3000 }).plan;
  assert.equal(landscape.target.width, 2048);
  assert.equal(landscape.target.height, 1024);
  assert.equal(landscape.resizeRequired, true);

  const portrait = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: 1000, height: 5000 }).plan;
  assert.equal(portrait.target.height, 2048);
  assert.ok(portrait.target.width <= 2048);

  const untouched = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: 2048, height: 2048 }).plan;
  assert.deepEqual(untouched.target, { width: 2048, height: 2048 });
  assert.equal(untouched.resizeRequired, false);
});

test('4. the total pixel budget is enforced on top of the edge limit', () => {
  const tall = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: 2048, height: 3000 }).plan;
  assert.ok(tall.target.width <= 2048 && tall.target.height <= 2048);
  assert.ok(tall.target.width * tall.target.height <= 4194304);

  const wide = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: 20000, height: 400 }).plan;
  assert.equal(wide.target.width, 2048);
  assert.ok(wide.target.width * wide.target.height <= 4194304);
});

test('5. the aspect ratio is preserved within a rounding budget', () => {
  const source = { width: 4032, height: 3024 };
  const target = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', ...source }).plan.target;
  const sourceRatio = source.width / source.height;
  const targetRatio = target.width / target.height;
  assert.ok(Math.abs(sourceRatio - targetRatio) < 0.01, `${sourceRatio} vs ${targetRatio}`);
});

test('6. zero, negative, fractional, NaN and Infinity dimensions are rejected', () => {
  const invalid = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '2048',
    null,
    undefined,
    Number.MAX_SAFE_INTEGER + 2,
  ];
  for (const value of invalid) {
    const byWidth = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: value, height: 100 });
    const byHeight = plan.planCanonicalJpeg({ sourceMimeType: 'image/jpeg', width: 100, height: value });
    assert.equal(byWidth.ok, false, `width ${String(value)}`);
    assert.equal(byWidth.reason, 'invalid_dimensions');
    assert.equal(byHeight.ok, false, `height ${String(value)}`);
    assert.equal(byHeight.reason, 'invalid_dimensions');
  }
});

test('7. the quality ladder is finite and ordered', () => {
  assert.deepEqual([...plan.CHAT_IMAGE_JPEG_QUALITY_STEPS], [0.82, 0.74, 0.66, 0.58]);
  assert.equal(plan.CHAT_IMAGE_INITIAL_JPEG_QUALITY, 0.82);
  assert.equal(plan.resolveNextJpegQuality(0.82), 0.74);
  assert.equal(plan.resolveNextJpegQuality(0.74), 0.66);
  assert.equal(plan.resolveNextJpegQuality(0.66), 0.58);
  assert.equal(plan.resolveNextJpegQuality(0.58), null, 'the ladder must terminate');
  assert.equal(plan.resolveNextJpegQuality(0.9), null);
});

test('8. only sizes within the 4 MiB budget are acceptable', () => {
  assert.equal(plan.isAcceptableCanonicalJpegSize(1), true);
  assert.equal(plan.isAcceptableCanonicalJpegSize(4194304), true);
  assert.equal(plan.isAcceptableCanonicalJpegSize(4194305), false);
  assert.equal(plan.isAcceptableCanonicalJpegSize(0), false);
  assert.equal(plan.isAcceptableCanonicalJpegSize(-1), false);
  assert.equal(plan.isAcceptableCanonicalJpegSize(1024.5), false);
});

// ---------------------------------------------------------------------------
// 9-14: browser canonicalizer adapter (fake browser dependencies)
// ---------------------------------------------------------------------------

const fakeBlob = (size, type = 'image/jpeg') => ({ size, type });

const createFakeDeps = (options = {}) => {
  const log = { closed: [], disposed: 0, drawn: [], qualities: [] };
  const sizes = options.sizes ?? [1000];
  let encodeIndex = 0;

  const deps = {
    decodeImage: async () => {
      if (options.decodeError) throw options.decodeError;
      return {
        width: options.width ?? 4000,
        height: options.height ?? 3000,
        source: 'decoded-bitmap',
        close: () => log.closed.push('decoded'),
      };
    },
    resizeImage: async (image, target) => ({
      width: target.width,
      height: target.height,
      source: 'resized-bitmap',
      close: () => log.closed.push('resized'),
    }),
    createCanvas: (target) => ({
      drawImage: (image, size) => log.drawn.push({ source: image.source, ...size }),
      encodeJpeg: async (quality) => {
        log.qualities.push(quality);
        if (options.encodeHook) await options.encodeHook(quality);
        const size = sizes[Math.min(encodeIndex, sizes.length - 1)];
        encodeIndex += 1;
        if (size === null) return null;
        return fakeBlob(size, options.outputType ?? 'image/jpeg');
      },
      dispose: () => { log.disposed += 1; },
      target,
    }),
  };

  return { deps, log };
};

test('9. the first acceptable quality wins and no further encode is attempted', async () => {
  const { deps, log } = createFakeDeps({ sizes: [1000] });
  const result = await canonicalizer.canonicalizeChatImage(fakeBlob(9000000, 'image/png'), { deps });
  assert.deepEqual(log.qualities, [0.82]);
  assert.equal(result.quality, 0.82);
  assert.equal(result.byteSize, 1000);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.width, 2048);
  assert.equal(result.height, 1536);
});

test('10. an oversized encode falls through to the next quality step', async () => {
  const { deps, log } = createFakeDeps({ sizes: [5000000, 4500000, 4000000] });
  const result = await canonicalizer.canonicalizeChatImage(fakeBlob(9000000, 'image/jpeg'), { deps });
  assert.deepEqual(log.qualities, [0.82, 0.74, 0.66]);
  assert.equal(result.quality, 0.66);
  assert.equal(result.byteSize, 4000000);
});

test('11. exhausting the ladder fails with output_too_large', async () => {
  const { deps, log } = createFakeDeps({ sizes: [9000000] });
  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(9000000, 'image/jpeg'), { deps }),
    (error) => error.name === 'ChatImageError' && error.code === 'output_too_large',
  );
  assert.deepEqual(log.qualities, [0.82, 0.74, 0.66, 0.58], 'the loop must terminate');
});

test('12. an abort discards the late result', async () => {
  const controller = new AbortController();
  const { deps, log } = createFakeDeps({
    sizes: [1000],
    encodeHook: async () => { controller.abort(); },
  });

  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(1000000, 'image/jpeg'), {
      deps,
      signal: controller.signal,
    }),
    (error) => error.name === 'ChatImageError' && error.code === 'aborted',
  );
  assert.ok(log.closed.length > 0, 'cleanup still runs after an abort');

  const preAborted = new AbortController();
  preAborted.abort();
  const fresh = createFakeDeps({ sizes: [1000] });
  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(1000, 'image/jpeg'), {
      deps: fresh.deps,
      signal: preAborted.signal,
    }),
    (error) => error.code === 'aborted',
  );
  assert.deepEqual(fresh.log.qualities, [], 'an aborted signal short-circuits before decoding');
});

test('13. bitmaps and canvases are released on the success and failure paths', async () => {
  const success = createFakeDeps({ sizes: [1000] });
  await canonicalizer.canonicalizeChatImage(fakeBlob(1000000, 'image/jpeg'), { deps: success.deps });
  assert.deepEqual(success.log.closed, ['resized', 'decoded']);
  assert.equal(success.log.disposed, 1);

  const failure = createFakeDeps({ sizes: [9000000] });
  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(1000000, 'image/jpeg'), { deps: failure.deps }),
  );
  assert.deepEqual(failure.log.closed, ['resized', 'decoded']);
  assert.equal(failure.log.disposed, 1);

  const decodeFailure = createFakeDeps({ decodeError: new Error('broken') });
  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(1000000, 'image/jpeg'), { deps: decodeFailure.deps }),
    (error) => error.code === 'decode_failed',
  );
  assert.deepEqual(decodeFailure.log.closed, []);
});

test('14. a non-JPEG encoder output is rejected instead of being uploaded', async () => {
  const { deps } = createFakeDeps({ sizes: [1000], outputType: 'image/png' });
  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(1000000, 'image/png'), { deps }),
    (error) => error.code === 'decode_failed',
  );

  const nullOutput = createFakeDeps({ sizes: [null] });
  await assert.rejects(
    () => canonicalizer.canonicalizeChatImage(fakeBlob(1000000, 'image/jpeg'), { deps: nullOutput.deps }),
    (error) => error.code === 'decode_failed',
  );
});

// ---------------------------------------------------------------------------
// 15-22: Supabase service layer
// ---------------------------------------------------------------------------

const intentRow = (overrides = {}) => ({
  id: ids.intent,
  conversation_id: ids.conversation,
  created_by: ids.sender,
  client_message_id: ids.clientMessage,
  bucket_id: 'chat-images',
  object_path: objectPath,
  expected_mime: 'image/jpeg',
  max_bytes: 4194304,
  status: 'pending',
  expires_at: new Date(Date.now() + 600000).toISOString(),
  ...overrides,
});

const uploadIntent = {
  id: ids.intent,
  conversationId: ids.conversation,
  createdBy: ids.sender,
  clientMessageId: ids.clientMessage,
  bucketId: 'chat-images',
  objectPath,
  expectedMime: 'image/jpeg',
  maxBytes: 4194304,
  status: 'pending',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
};

const stubRpc = (handler) => {
  const calls = [];
  supabaseClient.__setRpcHandler(async (name, args) => {
    calls.push({ name, args });
    return handler(name, args);
  });
  return calls;
};

const stubStorage = (result = { data: { path: objectPath }, error: null }) => {
  const calls = [];
  supabaseClient.__setStorageHandler((bucket) => ({
    upload: async (uploadPath, body, options) => {
      calls.push({ bucket, uploadPath, body, options });
      return result;
    },
  }));
  return calls;
};

const canonicalImage = (size = 200000) => ({
  blob: fakeBlob(size, 'image/jpeg'),
  byteSize: size,
  quality: 0.82,
  width: 2048,
  height: 1536,
  mimeType: 'image/jpeg',
});

test('15. the intent RPC is called with the exact contract arguments', async () => {
  const calls = stubRpc(() => ({ data: intentRow(), error: null }));
  const intent = await imageService.createChatImageUploadIntent({
    conversationId: ids.conversation,
    clientMessageId: ids.clientMessage,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'create_chat_image_upload_intent');
  assert.deepEqual(calls[0].args, {
    p_conversation_id: ids.conversation,
    p_client_message_id: ids.clientMessage,
    p_expected_mime: 'image/jpeg',
  });
  assert.equal(intent.bucketId, 'chat-images');
  assert.equal(intent.objectPath, objectPath);
  assert.equal(intent.status, 'pending');
});

test('16. an intent outside the canonical contract is rejected fail-closed', async () => {
  const invalidRows = [
    { bucket_id: 'avatars' },
    { object_path: `pending/${ids.intent}/${ids.object}.png` },
    { object_path: `${ids.intent}/${ids.object}.jpg` },
    { object_path: `pending/${ids.intent}/../${ids.object}.jpg` },
    { expected_mime: 'image/png' },
    { max_bytes: 8388608 },
    { status: 'finalized' },
    { conversation_id: ids.message },
    { client_message_id: ids.attachment },
    { id: 'not-a-uuid' },
  ];

  for (const overrides of invalidRows) {
    stubRpc(() => ({ data: intentRow(overrides), error: null }));
    await assert.rejects(
      () => imageService.createChatImageUploadIntent({
        conversationId: ids.conversation,
        clientMessageId: ids.clientMessage,
      }),
      (error) => error.name === 'ChatImageError' && error.code === 'invalid_response',
      JSON.stringify(overrides),
    );
  }

  stubRpc(() => ({
    data: intentRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    error: null,
  }));
  await assert.rejects(
    () => imageService.createChatImageUploadIntent({
      conversationId: ids.conversation,
      clientMessageId: ids.clientMessage,
    }),
    (error) => error.code === 'intent_expired',
  );
});

test('17. the upload targets the server path with upsert disabled and a JPEG content type', async () => {
  const calls = stubStorage();
  await imageService.uploadCanonicalChatImage(uploadIntent, canonicalImage());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bucket, 'chat-images');
  assert.equal(calls[0].uploadPath, objectPath);
  assert.deepEqual(calls[0].options, { contentType: 'image/jpeg', upsert: false });
});

test('18. free-form paths, foreign buckets and oversize blobs never reach Storage', async () => {
  const rejected = [
    [{ objectPath: '../../etc/passwd' }, canonicalImage(), 'invalid_response'],
    [{ objectPath: 'public/anything.jpg' }, canonicalImage(), 'invalid_response'],
    [{ bucketId: 'avatars' }, canonicalImage(), 'invalid_response'],
    [{ expiresAt: new Date(Date.now() - 1000).toISOString() }, canonicalImage(), 'intent_expired'],
    [{}, { ...canonicalImage(), blob: fakeBlob(200000, 'image/png') }, 'unsupported_type'],
    [{}, { ...canonicalImage(4194305), blob: fakeBlob(4194305, 'image/jpeg') }, 'output_too_large'],
    [{}, { ...canonicalImage(0), blob: fakeBlob(0, 'image/jpeg') }, 'output_too_large'],
  ];

  for (const [overrides, canonical, expected] of rejected) {
    const calls = stubStorage();
    await assert.rejects(
      () => imageService.uploadCanonicalChatImage({ ...uploadIntent, ...overrides }, canonical),
      (error) => error.code === expected,
      `${JSON.stringify(overrides)} -> ${expected}`,
    );
    assert.equal(calls.length, 0, 'no Storage call may be issued');
  }
});

test('19. captions are trimmed, emptied to null and capped at 4000 characters', async () => {
  assert.equal(imageService.normalizeChatImageCaption('  Ölçüm  '), 'Ölçüm');
  assert.equal(imageService.normalizeChatImageCaption('   '), null);
  assert.equal(imageService.normalizeChatImageCaption(null), null);
  assert.equal(imageService.normalizeChatImageCaption(undefined), null);
  assert.equal(imageService.normalizeChatImageCaption('a'.repeat(4000)).length, 4000);
  assert.throws(
    () => imageService.normalizeChatImageCaption('a'.repeat(4001)),
    (error) => error.code === 'invalid_request',
  );

  const calls = stubRpc(() => ({
    data: {
      id: ids.message,
      conversation_id: ids.conversation,
      sender_id: ids.sender,
      client_message_id: ids.clientMessage,
      message_kind: 'image',
    },
    error: null,
  }));
  await imageService.finalizeChatImageMessage(ids.intent, '   ');
  assert.equal(calls[0].name, 'finalize_chat_image_message');
  assert.deepEqual(calls[0].args, { p_intent_id: ids.intent, p_caption: null });
});

test('20. a dormant grant error is surfaced as feature_unavailable', async () => {
  const dormantErrors = [
    { code: 'PGRST202', message: 'Could not find the function public.create_chat_image_upload_intent' },
    { code: '42501', message: 'permission denied for function create_chat_image_upload_intent' },
  ];

  for (const error of dormantErrors) {
    stubRpc(() => ({ data: null, error }));
    await assert.rejects(
      () => imageService.createChatImageUploadIntent({
        conversationId: ids.conversation,
        clientMessageId: ids.clientMessage,
      }),
      (thrown) => thrown.code === 'feature_unavailable' && thrown.retryable === false,
      JSON.stringify(error),
    );
  }

  stubRpc(() => ({ data: null, error: { code: '42501', message: 'Chat access denied.' } }));
  await assert.rejects(
    () => imageService.createChatImageUploadIntent({
      conversationId: ids.conversation,
      clientMessageId: ids.clientMessage,
    }),
    (thrown) => thrown.code === 'access_denied',
  );
});

test('21. the best-effort abort never masks the original failure', async () => {
  const calls = stubRpc(() => ({ data: null, error: { code: '42501', message: 'Chat access denied.' } }));
  const aborted = await imageService.abortChatImageUploadQuietly(ids.intent);
  assert.equal(aborted, false, 'a failing abort resolves instead of throwing');
  assert.equal(calls[0].name, 'abort_chat_image_upload');
  assert.deepEqual(calls[0].args, { p_intent_id: ids.intent });

  const okCalls = stubRpc(() => ({ data: intentRow({ status: 'aborted' }), error: null }));
  assert.equal(await imageService.abortChatImageUploadQuietly(ids.intent), true);
  assert.equal(okCalls[0].name, 'abort_chat_image_upload');
});

test('22. the upload lifecycle never aborts a finalized intent', () => {
  const hookSource = fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'hooks', 'useChatImageUpload.ts'),
    'utf8',
  );
  assert.match(hookSource, /takeChatImageIntentForAbort/);
  assert.match(hookSource, /operation\.finalized = true;/);
  assert.doesNotMatch(hookSource, /[^y]\babortChatImageUpload\(/, 'only the quiet variant may be used');
});

// ---------------------------------------------------------------------------
// 23-28: upload state machine
// ---------------------------------------------------------------------------

const sourceSummary = { name: 'olcum.png', mimeType: 'image/png', byteSize: 900000 };

const selectAction = (operationId = 1) => ({
  type: 'select',
  operationId,
  conversationId: ids.conversation,
  clientMessageId: ids.clientMessage,
  source: sourceSummary,
  previewUrl: 'blob:preview',
});

test('23. the happy path walks idle to succeeded through every stage', () => {
  let state = reducer.initialChatImageUploadState;
  assert.equal(state.status, 'idle');

  state = reducer.chatImageUploadReducer(state, selectAction(1));
  assert.equal(state.status, 'selected', 'local selection must not start network work');
  assert.equal(state.clientMessageId, ids.clientMessage);
  assert.equal(state.previewUrl, 'blob:preview');

  state = reducer.chatImageUploadReducer(state, { type: 'start', operationId: 1 });
  assert.equal(state.status, 'canonicalizing');

  state = reducer.chatImageUploadReducer(state, {
    type: 'canonicalized',
    operationId: 1,
    canonical: canonicalImage(),
  });
  assert.equal(state.status, 'creating-intent');

  state = reducer.chatImageUploadReducer(state, {
    type: 'intent-created',
    operationId: 1,
    intent: uploadIntent,
  });
  assert.equal(state.status, 'uploading');
  assert.equal(state.intent.objectPath, objectPath);

  state = reducer.chatImageUploadReducer(state, { type: 'progress', operationId: 1, progress: 0.5 });
  assert.equal(state.progress, 0.5);

  state = reducer.chatImageUploadReducer(state, { type: 'uploaded', operationId: 1 });
  assert.equal(state.status, 'finalizing');
  assert.equal(state.progress, null);

  state = reducer.chatImageUploadReducer(state, { type: 'finalized', operationId: 1 });
  assert.equal(state.status, 'succeeded');
  assert.equal(state.previewUrl, null, 'the object URL is cleared after success');
  assert.equal(state.source, null);
});

test('24. stale and out-of-order async results are ignored', () => {
  let state = reducer.chatImageUploadReducer(reducer.initialChatImageUploadState, selectAction(1));
  state = reducer.chatImageUploadReducer(state, selectAction(2));
  assert.equal(state.operationId, 2);

  const stale = reducer.chatImageUploadReducer(state, {
    type: 'canonicalized',
    operationId: 1,
    canonical: canonicalImage(),
  });
  assert.equal(stale, state, 'a result from operation 1 must not mutate operation 2');

  const outOfOrder = reducer.chatImageUploadReducer(state, { type: 'uploaded', operationId: 2 });
  assert.equal(outOfOrder, state);

  let done = reducer.chatImageUploadReducer(reducer.initialChatImageUploadState, selectAction(3));
  done = reducer.chatImageUploadReducer(done, { type: 'start', operationId: 3 });
  done = reducer.chatImageUploadReducer(done, {
    type: 'canonicalized',
    operationId: 3,
    canonical: canonicalImage(),
  });
  done = reducer.chatImageUploadReducer(done, {
    type: 'intent-created',
    operationId: 3,
    intent: uploadIntent,
  });
  done = reducer.chatImageUploadReducer(done, { type: 'uploaded', operationId: 3 });
  done = reducer.chatImageUploadReducer(done, {
    type: 'finalized',
    operationId: 3,
  });
  assert.equal(
    reducer.chatImageUploadReducer(done, { type: 'cancelled', operationId: 3 }),
    done,
    'a succeeded upload is never rolled back into cancelled',
  );
});

test('25. cancellation clears all UI resources and rejects late results', () => {
  const selectedState = reducer.chatImageUploadReducer(
    reducer.initialChatImageUploadState,
    selectAction(1),
  );
  let uploadingState = reducer.chatImageUploadReducer(selectedState, { type: 'start', operationId: 1 });
  uploadingState = reducer.chatImageUploadReducer(uploadingState, {
    type: 'canonicalized',
    operationId: 1,
    canonical: canonicalImage(),
  });
  uploadingState = reducer.chatImageUploadReducer(uploadingState, {
    type: 'intent-created',
    operationId: 1,
    intent: uploadIntent,
  });
  const failedState = reducer.chatImageUploadReducer(uploadingState, {
    type: 'failed',
    operationId: 1,
    error: { code: 'storage_upload_failed', userMessage: 'x', retryable: true },
    retryStage: 'uploading',
  });

  const assertCancelled = (state, label) => {
    const cancelled = reducer.chatImageUploadReducer(state, { type: 'cancelled', operationId: 1 });
    assert.equal(cancelled.status, 'cancelled', `${label} status`);
    assert.equal(cancelled.operationId, 1, `${label} operation id is preserved`);
    for (const field of [
      'conversationId',
      'clientMessageId',
      'source',
      'previewUrl',
      'canonical',
      'intent',
      'progress',
      'error',
      'retryStage',
    ]) {
      assert.equal(cancelled[field], null, `${label}: ${field} must be cleared on cancellation`);
    }
    return cancelled;
  };

  assertCancelled(selectedState, 'selected');
  assertCancelled(uploadingState, 'uploading');
  const cancelled = assertCancelled(failedState, 'retryable failed');

  for (const action of [
    { type: 'canonicalized', operationId: 1, canonical: canonicalImage() },
    { type: 'intent-created', operationId: 1, intent: uploadIntent },
    { type: 'uploaded', operationId: 1 },
    { type: 'finalized', operationId: 1 },
  ]) {
    assert.equal(
      reducer.chatImageUploadReducer(cancelled, action),
      cancelled,
      `${action.type} must not revive a cancelled operation`,
    );
  }

  const next = reducer.chatImageUploadReducer(cancelled, selectAction(2));
  assert.equal(next.status, 'selected');
  assert.equal(next.operationId, 2);
  assert.equal(next.previewUrl, 'blob:preview');
});

test('25. a new selection supersedes the previous operation id', () => {
  let state = reducer.chatImageUploadReducer(reducer.initialChatImageUploadState, selectAction(1));
  state = reducer.chatImageUploadReducer(state, { type: 'start', operationId: 1 });
  state = reducer.chatImageUploadReducer(state, {
    type: 'canonicalized',
    operationId: 1,
    canonical: canonicalImage(),
  });
  state = reducer.chatImageUploadReducer(state, {
    type: 'intent-created',
    operationId: 1,
    intent: uploadIntent,
  });

  const replaced = reducer.chatImageUploadReducer(state, selectAction(2));
  assert.equal(replaced.operationId, 2);
  assert.equal(replaced.status, 'selected');
  assert.equal(replaced.intent, null, 'the previous intent must not leak into the new operation');
  assert.equal(replaced.canonical, null);
  assert.equal(replaced.error, null);

  assert.equal(reducer.chatImageUploadReducer(replaced, selectAction(1)), replaced);
});

test('26. the disabled feature flag stops the flow before any RPC or Storage call', () => {
  const decision = reducer.evaluateChatImageUploadStart({
    featureEnabled: false,
    conversationId: ids.conversation,
    sourceMimeType: 'image/jpeg',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'feature_unavailable');

  const hookSource = fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'hooks', 'useChatImageUpload.ts'),
    'utf8',
  );
  const guardIndex = hookSource.indexOf('evaluateChatImageUploadStart');
  const runStagesIndex = hookSource.indexOf('await runStages(operation');
  assert.ok(guardIndex > 0);
  assert.ok(runStagesIndex > guardIndex, 'the guard runs before the staged pipeline');
  assert.match(hookSource, /if \(!decision\.allowed \|\| !decision\.conversationId\)/);
});

test('27. a missing conversationId is rejected before the flow starts', () => {
  for (const conversationId of [null, undefined, '', 'not-a-uuid']) {
    const decision = reducer.evaluateChatImageUploadStart({
      featureEnabled: true,
      conversationId,
      sourceMimeType: 'image/jpeg',
    });
    assert.equal(decision.allowed, false, String(conversationId));
    assert.equal(decision.reason, 'invalid_request');
  }

  const unsupported = reducer.evaluateChatImageUploadStart({
    featureEnabled: true,
    conversationId: ids.conversation,
    sourceMimeType: 'image/heic',
  });
  assert.equal(unsupported.reason, 'unsupported_type');

  const allowed = reducer.evaluateChatImageUploadStart({
    featureEnabled: true,
    conversationId: ids.conversation,
    sourceMimeType: 'image/webp',
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.conversationId, ids.conversation);
});

test('28. a retry resumes the same stage and keeps the idempotency key', () => {
  let state = reducer.chatImageUploadReducer(reducer.initialChatImageUploadState, selectAction(1));
  state = reducer.chatImageUploadReducer(state, { type: 'start', operationId: 1 });
  state = reducer.chatImageUploadReducer(state, {
    type: 'canonicalized',
    operationId: 1,
    canonical: canonicalImage(),
  });
  state = reducer.chatImageUploadReducer(state, {
    type: 'intent-created',
    operationId: 1,
    intent: uploadIntent,
  });

  const failure = { code: 'storage_upload_failed', userMessage: 'x', retryable: true };
  const retryStage = reducer.resolveRetryStage(state, 'uploading', true);
  assert.equal(retryStage, 'uploading');

  state = reducer.chatImageUploadReducer(state, {
    type: 'failed',
    operationId: 1,
    error: failure,
    retryStage,
  });
  assert.equal(state.status, 'failed');

  const resumed = reducer.chatImageUploadReducer(state, {
    type: 'retry',
    operationId: 1,
    stage: 'uploading',
  });
  assert.equal(resumed.status, 'uploading');
  assert.equal(resumed.error, null);
  assert.equal(resumed.clientMessageId, ids.clientMessage, 'the idempotency key survives a retry');
  assert.equal(resumed.intent.id, ids.intent, 'the same intent is reused');
  assert.equal(resumed.operationId, 1);

  assert.equal(reducer.resolveRetryStage(state, 'uploading', false), null);
  assert.equal(
    reducer.chatImageUploadReducer(state, { type: 'retry', operationId: 1, stage: 'finalizing' }),
    state,
  );
});

// ---------------------------------------------------------------------------
// 29-32: Realtime reconciliation
// ---------------------------------------------------------------------------

const realtimeRow = (overrides = {}) => ({
  id: ids.message,
  conversation_id: ids.conversation,
  sender_id: ids.sender,
  client_message_id: ids.clientMessage,
  body: 'Merhaba',
  message_kind: 'text',
  created_at: '2026-07-28T10:00:00.000Z',
  deleted_at: null,
  deleted_by: null,
  ...overrides,
});

const subscribeWithStub = () => {
  const handlers = [];
  supabaseClient.__setChannelHandler(() => {
    const channel = {
      on: (event, config, handler) => {
        handlers.push({ event: config.event, handler });
        return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  });

  const delivered = [];
  const reconciled = [];
  chatService.subscribeToChatMessages({
    conversationId: ids.conversation,
    currentUserId: ids.sender,
    onMessage: (message) => delivered.push(message),
    onReconcile: (messageId) => reconciled.push(messageId),
  });

  const insert = handlers.find((entry) => entry.event === 'INSERT');
  return { delivered, reconciled, emitInsert: (row) => insert.handler({ new: row }) };
};

test('29. a text INSERT keeps the existing fast path', () => {
  const { delivered, reconciled, emitInsert } = subscribeWithStub();
  emitInsert(realtimeRow());
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, ids.message);
  assert.equal(delivered[0].messageKind, 'text');
  assert.equal(reconciled.length, 0, 'no extra read for text messages');
});

test('30. an image INSERT triggers a targeted reconciliation instead of a partial render', () => {
  const { delivered, reconciled, emitInsert } = subscribeWithStub();
  emitInsert(realtimeRow({ message_kind: 'image', body: null }));
  assert.equal(delivered.length, 0, 'an unresolvable payload must not be rendered');
  assert.deepEqual(reconciled, [ids.message]);

  const foreign = subscribeWithStub();
  foreign.emitInsert(realtimeRow({ conversation_id: ids.message }));
  assert.equal(foreign.delivered.length, 0);
  assert.equal(foreign.reconciled.length, 0, 'foreign conversations are ignored entirely');
});

test('31. the reconciled image row carries the ids the dedupe path needs', async () => {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (column, value) => { filters.push([column, value]); return builder; },
    limit: () => builder,
    then: (resolve, reject) => Promise.resolve({
      data: [realtimeRow({
        message_kind: 'image',
        body: null,
        attachment: {
          id: ids.attachment,
          message_id: ids.message,
          bucket_id: 'chat-images',
          object_path: objectPath,
          mime_type: 'image/jpeg',
          byte_size: 128000,
          width: 2048,
          height: 1536,
          deleted_at: null,
        },
      })],
      error: null,
    }).then(resolve, reject),
  };
  supabaseClient.__setFromHandler((table) => {
    assert.equal(table, 'chat_messages');
    return builder;
  });

  const message = await chatService.fetchChatMessageById(ids.message, ids.conversation, ids.sender);
  assert.deepEqual(filters, [['id', ids.message], ['conversation_id', ids.conversation]]);
  assert.equal(message.id, ids.message);
  assert.equal(message.clientMessageId, ids.clientMessage);
  assert.equal(message.messageKind, 'image');
  assert.equal(message.attachment.objectPath, objectPath);
});

test('32. a failed or empty targeted read never fabricates a message', async () => {
  const emptyBuilder = {
    select: () => emptyBuilder,
    eq: () => emptyBuilder,
    limit: () => emptyBuilder,
    then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
  };
  supabaseClient.__setFromHandler(() => emptyBuilder);
  assert.equal(await chatService.fetchChatMessageById(ids.message, ids.conversation, ids.sender), null);

  const partialBuilder = {
    select: () => partialBuilder,
    eq: () => partialBuilder,
    limit: () => partialBuilder,
    then: (resolve, reject) => Promise.resolve({
      data: [realtimeRow({ message_kind: 'image', body: null, attachment: null })],
      error: null,
    }).then(resolve, reject),
  };
  supabaseClient.__setFromHandler(() => partialBuilder);
  assert.equal(await chatService.fetchChatMessageById(ids.message, ids.conversation, ids.sender), null);

  const errorBuilder = {
    select: () => errorBuilder,
    eq: () => errorBuilder,
    limit: () => errorBuilder,
    then: (resolve, reject) => Promise.resolve({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }).then(resolve, reject),
  };
  supabaseClient.__setFromHandler(() => errorBuilder);
  await assert.rejects(
    () => chatService.fetchChatMessageById(ids.message, ids.conversation, ids.sender),
    (error) => error.name === 'ChatServiceError',
  );
});

test('the reconnect refetch safety net remains in place', () => {
  const hookSource = fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'hooks', 'useChatRealtime.ts'),
    'utf8',
  );
  assert.match(hookSource, /status === 'connected'/);
  assert.match(hookSource, /requestMessageRefetchRef\.current\(\)/);
  assert.match(hookSource, /fetchChatMessageById\(/);
  assert.doesNotMatch(hookSource, /supabase\./, 'Realtime callbacks must go through the service layer');
});

test('this slice adds no picker, renderer or signed-URL code', () => {
  const serviceSource = fs.readFileSync(
    path.join(repoRoot, 'features', 'chat', 'services', 'chatImageService.ts'),
    'utf8',
  );
  assert.doesNotMatch(serviceSource, /createSignedUrl|getPublicUrl|\.download\(/);
  assert.match(serviceSource, /upsert: false/);

  const errorCodes = Object.keys(uploadTypes.CHAT_IMAGE_ERROR_MESSAGES);
  for (const code of [
    'unsupported_type',
    'decode_failed',
    'invalid_dimensions',
    'output_too_large',
    'access_denied',
    'quota_exceeded',
    'intent_expired',
    'validation_pending',
    'feature_unavailable',
    'storage_upload_failed',
    'aborted',
    'unknown',
  ]) {
    assert.ok(errorCodes.includes(code), code);
  }
});
