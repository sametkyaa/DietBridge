import {
  type CleanupDependencies,
  type CleanupLogEvent,
  handleCleanupRequest,
} from "./handler.ts";

const SCHEDULER_SECRET = "scheduler-secret-with-at-least-thirty-two-bytes";
const SERVICE_ROLE_KEY = "server-only-service-role-test-value";
const CLEANUP_ID_A = "11111111-1111-4111-8111-111111111111";
const CLEANUP_ID_B = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OBJECT_ID_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OBJECT_ID_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PATH_A = `pending/${OWNER_ID}/${OBJECT_ID_A}.jpg`;
const PATH_B = `pending/${OWNER_ID}/${OBJECT_ID_B}.png`;

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

interface Harness {
  dependencies: CleanupDependencies;
  calls: RecordedCall[];
  logs: CleanupLogEvent[];
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
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ?? `Expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function claim(cleanupId: string, objectPath: string): Record<string, string> {
  return {
    cleanup_id: cleanupId,
    bucket_id: "chat-images",
    object_path: objectPath,
  };
}

function createHarness(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
  environment: Record<string, string | undefined> = {},
): Harness {
  const calls: RecordedCall[] = [];
  const logs: CleanupLogEvent[] = [];
  const env: Record<string, string | undefined> = {
    CHAT_IMAGE_CLEANUP_SCHEDULER_SECRET: SCHEDULER_SECRET,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    ...environment,
  };

  const dependencies: CleanupDependencies = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, init });
      return await responder(url, init);
    }) as typeof fetch,
    getEnv: (name) => env[name],
    log: (event) => logs.push(event),
  };
  return { dependencies, calls, logs };
}

function schedulerRequest(
  secret = SCHEDULER_SECRET,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://local.test/cleanup-chat-images", {
    method: "POST",
    headers: {
      "x-chat-image-cleanup-secret": secret,
      ...extraHeaders,
    },
  });
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("cleanup accepts POST only", async () => {
  const harness = createHarness(() => json([]));
  const response = await handleCleanupRequest(
    new Request("http://local.test/cleanup-chat-images", { method: "GET" }),
    harness.dependencies,
  );

  assertEquals(response.status, 405);
  assertEquals(response.headers.get("allow"), "POST");
  assertEquals(harness.calls.length, 0);
});

Deno.test("cleanup requires only the dedicated scheduler secret", async () => {
  const harness = createHarness(() => json([]));

  const noSecret = await handleCleanupRequest(
    new Request("http://local.test/cleanup-chat-images", {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }),
    harness.dependencies,
  );
  const wrongSecret = await handleCleanupRequest(
    schedulerRequest("wrong-secret"),
    harness.dependencies,
  );

  assertEquals(noSecret.status, 401);
  assertEquals(wrongSecret.status, 401);
  assertEquals(harness.calls.length, 0);
});

Deno.test("cleanup fails closed when scheduler secret is not configured", async () => {
  const harness = createHarness(() => json([]), {
    CHAT_IMAGE_CLEANUP_SCHEDULER_SECRET: undefined,
  });
  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 503);
  assertEquals(harness.calls.length, 0);
  assertEquals(harness.logs, [
    { level: "error", code: "scheduler_secret_unconfigured" },
  ]);
});

Deno.test("cleanup calls claim with service role and a fixed batch size", async () => {
  const harness = createHarness(() => json([]));
  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(harness.calls.length, 1);
  const [call] = harness.calls;
  assert(call.url.endsWith("/rest/v1/rpc/claim_chat_image_cleanup_batch"));
  assertEquals(call.init?.method, "POST");
  assertEquals(JSON.parse(String(call.init?.body)), { p_limit: 50 });
  const headers = new Headers(call.init?.headers);
  assertEquals(headers.get("authorization"), `Bearer ${SERVICE_ROLE_KEY}`);
  assertEquals(headers.get("apikey"), SERVICE_ROLE_KEY);
});

Deno.test("missing Storage object is idempotent and queue row completes", async () => {
  const harness = createHarness((url) => {
    if (url.includes("claim_chat_image_cleanup_batch")) {
      return json([claim(CLEANUP_ID_A, PATH_A)]);
    }
    if (url.includes("/storage/v1/object/")) {
      return json([]);
    }
    if (url.includes("complete_chat_image_cleanup")) return json(true);
    throw new Error("unexpected test route");
  });

  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), {
    result: { claimed: 1, completed: 1, failed: 0 },
  });
  assertEquals(harness.calls.length, 3);
});

Deno.test("each claimed row deletes exactly one matching object before completion", async () => {
  const completed: string[] = [];
  const deleted: string[] = [];
  const harness = createHarness((url, init) => {
    if (url.includes("claim_chat_image_cleanup_batch")) {
      return json([
        claim(CLEANUP_ID_A, PATH_A),
        claim(CLEANUP_ID_B, PATH_B),
      ]);
    }
    if (url.includes("/storage/v1/object/")) {
      const body = JSON.parse(String(init?.body)) as { prefixes: string[] };
      assertEquals(body.prefixes.length, 1);
      deleted.push(body.prefixes[0]);
      return json([{ name: body.prefixes[0] }]);
    }
    if (url.includes("complete_chat_image_cleanup")) {
      const body = JSON.parse(String(init?.body)) as { p_cleanup_id: string };
      completed.push(body.p_cleanup_id);
      return json(true);
    }
    throw new Error("unexpected test route");
  });

  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(deleted, [PATH_A, PATH_B]);
  assertEquals(completed, [CLEANUP_ID_A, CLEANUP_ID_B]);
  const methods = harness.calls.map((call) => call.init?.method);
  assertEquals(methods, ["POST", "DELETE", "POST", "DELETE", "POST"]);
});

Deno.test("partial Storage failure leaves that queue row uncompleted", async () => {
  const completed: string[] = [];
  const harness = createHarness((url, init) => {
    if (url.includes("claim_chat_image_cleanup_batch")) {
      return json([
        claim(CLEANUP_ID_A, PATH_A),
        claim(CLEANUP_ID_B, PATH_B),
      ]);
    }
    if (url.includes("/storage/v1/object/")) {
      const body = JSON.parse(String(init?.body)) as { prefixes: string[] };
      return body.prefixes[0] === PATH_A
        ? json({ code: "storage_failure" }, 500)
        : json([{ name: PATH_B }]);
    }
    if (url.includes("complete_chat_image_cleanup")) {
      const body = JSON.parse(String(init?.body)) as { p_cleanup_id: string };
      completed.push(body.p_cleanup_id);
      return json(true);
    }
    throw new Error("unexpected test route");
  });

  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error: { code: "cleanup_partial", retryable: true },
    result: { claimed: 2, completed: 1, failed: 1 },
  });
  assertEquals(completed, [CLEANUP_ID_B]);
  assertEquals(harness.logs, [
    { level: "warn", code: "storage_delete_failed" },
  ]);
});

Deno.test("complete failure remains retryable after successful exact delete", async () => {
  let completeCalls = 0;
  const harness = createHarness((url) => {
    if (url.includes("claim_chat_image_cleanup_batch")) {
      return json([claim(CLEANUP_ID_A, PATH_A)]);
    }
    if (url.includes("/storage/v1/object/")) return json([{ name: PATH_A }]);
    if (url.includes("complete_chat_image_cleanup")) {
      completeCalls += 1;
      return json(false);
    }
    throw new Error("unexpected test route");
  });

  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 503);
  assertEquals(completeCalls, 1);
  assertEquals(harness.logs, [
    { level: "warn", code: "queue_complete_failed" },
  ]);
});

Deno.test("malformed or non-canonical claims fail closed before Storage", async () => {
  const harness = createHarness(() =>
    json([{
      cleanup_id: CLEANUP_ID_A,
      bucket_id: "chat-images",
      object_path: `pending/${OWNER_ID}/../unrelated.jpg`,
    }])
  );

  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );

  assertEquals(response.status, 503);
  assertEquals(harness.calls.length, 1);
  assertEquals(harness.logs, [
    { level: "warn", code: "queue_claim_failed" },
  ]);
});

Deno.test("logs and responses never contain secrets, object paths, ids, or raw errors", async () => {
  const rawError =
    `failure ${SERVICE_ROLE_KEY} ${SCHEDULER_SECRET} ${CLEANUP_ID_A} ${PATH_A}`;
  const harness = createHarness(() => {
    throw new Error(rawError);
  });

  const response = await handleCleanupRequest(
    schedulerRequest(),
    harness.dependencies,
  );
  const serialized = JSON.stringify({
    logs: harness.logs,
    body: await response.text(),
  });

  assertEquals(response.status, 503);
  for (
    const sensitive of [
      SERVICE_ROLE_KEY,
      SCHEDULER_SECRET,
      CLEANUP_ID_A,
      PATH_A,
      rawError,
    ]
  ) {
    assert(!serialized.includes(sensitive), "Sensitive value was emitted");
  }
  assert(!serialized.toLowerCase().includes("stack"));
});
