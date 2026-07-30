import {
  handleValidateChatImageRequest,
  type ValidateChatImageDependencies,
  type ValidationLogEvent,
} from "./handler.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const INTENT_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const OBJECT_ID = "55555555-5555-4555-8555-555555555555";
const OBJECT_PATH = `pending/${INTENT_ID}/${OBJECT_ID}.jpg`;

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

interface Harness {
  dependencies: ValidateChatImageDependencies;
  calls: RecordedCall[];
  logs: ValidationLogEvent[];
}

interface HarnessOptions {
  responder?: (url: string, init?: RequestInit) => Response | undefined;
  intent?: Record<string, unknown> | null;
  relationship?: unknown[];
  validationResult?: {
    ok: true;
    byteSize: number;
    width: number;
    height: number;
  } | {
    ok: false;
    code: "invalid_image" | "image_too_large" | "image_dimensions_exceeded";
  };
  validatorThrows?: boolean;
}

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, received ${
          JSON.stringify(actual)
        }`,
    );
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function objectResponse(
  status = 200,
  contentType = "image/jpeg",
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    status,
    headers: { "content-type": contentType, ...extraHeaders },
  });
}

function makeIntent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: INTENT_ID,
    conversation_id: CONVERSATION_ID,
    created_by: USER_ID,
    bucket_id: "chat-images",
    object_path: OBJECT_PATH,
    expected_mime: "image/jpeg",
    max_bytes: 4194304,
    status: "pending",
    expires_at: "2030-01-01T00:00:00.000Z",
    validated_mime: null,
    validated_byte_size: null,
    validated_width: null,
    validated_height: null,
    validated_at: null,
    ...overrides,
  };
}

function validatedIntent(): Record<string, unknown> {
  return makeIntent({
    validated_mime: "image/jpeg",
    validated_byte_size: 123,
    validated_width: 2,
    validated_height: 3,
    validated_at: "2029-01-01T00:00:00.000Z",
  });
}

function createHarness(options: HarnessOptions = {}): Harness {
  const calls: RecordedCall[] = [];
  const logs: ValidationLogEvent[] = [];
  const intent = options.intent === undefined ? makeIntent() : options.intent;
  const relationship = options.relationship ?? [{
    id: CONVERSATION_ID,
    dietitian_id: USER_ID,
    client_id: OTHER_USER_ID,
    dietitian_clients: { status: "active" },
  }];

  const dependencies: ValidateChatImageDependencies = {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, init });
      const overridden = options.responder?.(url, init);
      if (overridden) return Promise.resolve(overridden);
      if (url.endsWith("/auth/v1/user")) {
        return Promise.resolve(json({ id: USER_ID }));
      }
      if (url.includes("/rest/v1/chat_upload_intents?")) {
        return Promise.resolve(json(intent === null ? [] : [intent]));
      }
      if (url.includes("/rest/v1/chat_conversations?")) {
        return Promise.resolve(json(relationship));
      }
      if (url.includes("/storage/v1/object/")) {
        return Promise.resolve(objectResponse());
      }
      if (url.endsWith("/rest/v1/rpc/record_chat_image_validation")) {
        return Promise.resolve(json(validatedIntent()));
      }
      throw new Error("unexpected_test_route");
    }) as typeof fetch,
    getEnv: (name) =>
      ({
        SUPABASE_URL: "https://project.example.test",
        SUPABASE_ANON_KEY: "anon-test-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
      })[name],
    log: (event) => logs.push(event),
    now: () => Date.parse("2029-06-01T00:00:00.000Z"),
    validateJpeg: (() => {
      if (options.validatorThrows) throw new Error("sensitive decoder failure");
      return options.validationResult ??
        { ok: true, byteSize: 123, width: 2, height: 3 };
    }) as ValidateChatImageDependencies["validateJpeg"],
  };
  return { dependencies, calls, logs };
}

function request(
  body = JSON.stringify({ intentId: INTENT_ID }),
  authorization = "Bearer valid-jwt",
): Request {
  return new Request("https://function.example.test/validate-chat-image", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body,
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function assertError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  assertEquals(response.status, status);
  const value = await body(response);
  assertEquals((value.error as Record<string, unknown>).code, code);
  assertEquals(response.headers.get("cache-control"), "no-store");
}

Deno.test("handles CORS OPTIONS and rejects other methods", async () => {
  const harness = createHarness();
  const options = await handleValidateChatImageRequest(
    new Request("https://function.example.test/validate-chat-image", {
      method: "OPTIONS",
    }),
    harness.dependencies,
  );
  assertEquals(options.status, 204);
  assertEquals(
    options.headers.get("access-control-allow-methods"),
    "POST, OPTIONS",
  );
  assertEquals(options.headers.get("cache-control"), "no-store");

  await assertError(
    await handleValidateChatImageRequest(
      new Request("https://function.example.test/validate-chat-image", {
        method: "GET",
      }),
      harness.dependencies,
    ),
    405,
    "method_not_allowed",
  );
  assertEquals(harness.calls.length, 0);
});

Deno.test("rejects missing and invalid authentication", async () => {
  const missing = createHarness();
  await assertError(
    await handleValidateChatImageRequest(
      request(JSON.stringify({ intentId: INTENT_ID }), ""),
      missing.dependencies,
    ),
    401,
    "unauthorized",
  );
  assertEquals(missing.calls.length, 0);

  const invalid = createHarness({
    responder: (url) =>
      url.endsWith("/auth/v1/user") ? json({}, 401) : undefined,
  });
  await assertError(
    await handleValidateChatImageRequest(request(), invalid.dependencies),
    401,
    "unauthorized",
  );
  assertEquals(invalid.calls.length, 1);
});

Deno.test("rejects invalid JSON and UUID after authentication", async () => {
  const invalidJson = createHarness();
  await assertError(
    await handleValidateChatImageRequest(
      request("{"),
      invalidJson.dependencies,
    ),
    400,
    "invalid_request",
  );
  assertEquals(invalidJson.calls.length, 1);

  const invalidUuid = createHarness();
  await assertError(
    await handleValidateChatImageRequest(
      request(JSON.stringify({ intentId: "not-a-uuid" })),
      invalidUuid.dependencies,
    ),
    400,
    "invalid_request",
  );
  assertEquals(invalidUuid.calls.length, 1);
});

Deno.test("does not disclose missing or another user's intent", async () => {
  const missing = createHarness({ intent: null });
  await assertError(
    await handleValidateChatImageRequest(request(), missing.dependencies),
    404,
    "not_found",
  );

  const foreign = createHarness({
    intent: makeIntent({ created_by: OTHER_USER_ID }),
  });
  await assertError(
    await handleValidateChatImageRequest(request(), foreign.dependencies),
    404,
    "not_found",
  );
  assertEquals(foreign.calls.length, 2);
});

Deno.test("requires the same active conversation relationship as the upload intent RPC", async () => {
  const harness = createHarness({ relationship: [] });
  await assertError(
    await handleValidateChatImageRequest(request(), harness.dependencies),
    404,
    "not_found",
  );
  assertEquals(harness.calls.length, 3);
});

Deno.test("rejects aborted, finalized, and expired pending intents", async () => {
  for (
    const intent of [
      makeIntent({ status: "aborted" }),
      makeIntent({ status: "finalized" }),
    ]
  ) {
    const harness = createHarness({ intent });
    await assertError(
      await handleValidateChatImageRequest(request(), harness.dependencies),
      409,
      "intent_not_pending",
    );
  }
  const expired = createHarness({
    intent: makeIntent({ expires_at: "2029-01-01T00:00:00.000Z" }),
  });
  await assertError(
    await handleValidateChatImageRequest(request(), expired.dependencies),
    409,
    "intent_expired",
  );
});

Deno.test("fails closed for invalid server-owned bucket, path, MIME, or partial metadata", async () => {
  for (
    const intent of [
      makeIntent({ bucket_id: "other-bucket" }),
      makeIntent({ object_path: "pending/UPPERCASE.jpg" }),
      makeIntent({ expected_mime: "image/png" }),
      makeIntent({ validated_mime: "image/jpeg" }),
    ]
  ) {
    const harness = createHarness({ intent });
    await assertError(
      await handleValidateChatImageRequest(request(), harness.dependencies),
      404,
      "not_found",
    );
  }
});

Deno.test("returns controlled object, MIME, image-size, and dimension failures", async () => {
  const missing = createHarness({
    responder: (url) =>
      url.includes("/storage/v1/object/") ? objectResponse(404) : undefined,
  });
  await assertError(
    await handleValidateChatImageRequest(request(), missing.dependencies),
    404,
    "object_not_found",
  );

  const spoofedMime = createHarness({
    responder: (url) =>
      url.includes("/storage/v1/object/")
        ? objectResponse(200, "image/png")
        : undefined,
  });
  await assertError(
    await handleValidateChatImageRequest(request(), spoofedMime.dependencies),
    422,
    "invalid_image",
  );

  const tooLarge = createHarness({
    validationResult: { ok: false, code: "image_too_large" },
  });
  await assertError(
    await handleValidateChatImageRequest(request(), tooLarge.dependencies),
    422,
    "image_too_large",
  );

  const oversizedObject = createHarness({
    responder: (url) =>
      url.includes("/storage/v1/object/")
        ? objectResponse(200, "image/jpeg", { "content-length": "4194305" })
        : undefined,
  });
  await assertError(
    await handleValidateChatImageRequest(
      request(),
      oversizedObject.dependencies,
    ),
    422,
    "image_too_large",
  );

  const dimensions = createHarness({
    validationResult: { ok: false, code: "image_dimensions_exceeded" },
  });
  await assertError(
    await handleValidateChatImageRequest(request(), dimensions.dependencies),
    422,
    "image_dimensions_exceeded",
  );
});

Deno.test("records exact decoded metadata through the service-role RPC", async () => {
  const harness = createHarness({
    validationResult: { ok: true, byteSize: 321, width: 12, height: 13 },
  });
  const response = await handleValidateChatImageRequest(
    request(),
    harness.dependencies,
  );
  assertEquals(response.status, 200);
  assertEquals(await body(response), {
    data: {
      mimeType: "image/jpeg",
      byteSize: 123,
      width: 2,
      height: 3,
      validatedAt: "2029-01-01T00:00:00.000Z",
      idempotent: false,
    },
  });
  const rpc = harness.calls.find((call) =>
    call.url.endsWith("/rest/v1/rpc/record_chat_image_validation")
  );
  assert(rpc);
  assertEquals(JSON.parse(String(rpc.init?.body)), {
    p_intent_id: INTENT_ID,
    p_validated_mime: "image/jpeg",
    p_validated_byte_size: 321,
    p_validated_width: 12,
    p_validated_height: 13,
  });
  const headers = new Headers(rpc.init?.headers);
  assertEquals(headers.get("authorization"), "Bearer service-role-test-key");
  assertEquals(headers.get("apikey"), "service-role-test-key");
});

Deno.test("returns already-complete validation metadata without Storage or RPC work", async () => {
  const harness = createHarness({ intent: validatedIntent() });
  const response = await handleValidateChatImageRequest(
    request(),
    harness.dependencies,
  );
  assertEquals(response.status, 200);
  const value = await body(response);
  assertEquals((value.data as Record<string, unknown>).idempotent, true);
  assertEquals(harness.calls.length, 3);
});

Deno.test("does not report a successful validation when Storage or validation RPC fails", async () => {
  const storage = createHarness({
    responder: (url) =>
      url.includes("/storage/v1/object/") ? objectResponse(500) : undefined,
  });
  await assertError(
    await handleValidateChatImageRequest(request(), storage.dependencies),
    422,
    "validation_failed",
  );

  const rpc = createHarness({
    responder: (url) =>
      url.endsWith("/rest/v1/rpc/record_chat_image_validation")
        ? json({ message: "database detail" }, 500)
        : undefined,
  });
  await assertError(
    await handleValidateChatImageRequest(request(), rpc.dependencies),
    422,
    "validation_failed",
  );
});

Deno.test("contains unexpected internal errors without exposing raw details", async () => {
  const harness = createHarness({ validatorThrows: true });
  const response = await handleValidateChatImageRequest(
    request(),
    harness.dependencies,
  );
  await assertError(response, 500, "internal_error");
  const text = JSON.stringify(
    await body(
      await handleValidateChatImageRequest(
        request(),
        createHarness({ validatorThrows: true }).dependencies,
      ),
    ),
  );
  assert(!text.includes("sensitive decoder failure"));
});
