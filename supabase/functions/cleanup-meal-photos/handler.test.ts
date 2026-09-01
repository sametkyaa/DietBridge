import {
  type CleanupDependencies,
  type CleanupLogEvent,
  handleCleanupRequest,
} from "./handler.ts";

const SECRET = "meal-photo-scheduler-secret-at-least-32-bytes";
const KEY = "server-only-service-role-test-key";
const CLEANUP_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_CLEANUP_ID = "11111111-1111-4111-8111-111111111112";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const DIETITIAN_ID = "33333333-3333-4333-8333-333333333333";
const MEAL_ID = "44444444-4444-4444-8444-444444444444";
const OBJECT_ID = "55555555-5555-4555-8555-555555555555";
const SECOND_OBJECT_ID = "66666666-6666-4666-8666-666666666666";
const MEAL_PATH = `meal-plans/${CLIENT_ID}/${DIETITIAN_ID}/${OBJECT_ID}.webp`;
const COMPLETION_PATH = `${CLIENT_ID}/${MEAL_ID}/${OBJECT_ID}.jpg`;
const SECOND_COMPLETION_PATH =
  `${CLIENT_ID}/${MEAL_ID}/${SECOND_OBJECT_ID}.jpg`;

const RPC = {
  mealClaim: "claim_meal_photo_cleanup_batch",
  mealComplete: "complete_meal_photo_cleanup",
  completionClaim: "claim_meal_completion_photo_cleanup_batch",
  completionComplete: "complete_meal_completion_photo_cleanup",
} as const;

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

const request = (secret = SECRET, method = "POST") =>
  new Request("http://local/cleanup-meal-photos", {
    method,
    headers: { "x-meal-photo-cleanup-secret": secret },
  });

const isRpc = (url: string, name: string) =>
  url.endsWith(`/rest/v1/rpc/${name}`);

const storageBucket = (url: string) =>
  url.split("/storage/v1/object/")[1] ?? null;

const storagePath = (init?: RequestInit) =>
  (JSON.parse(String(init?.body)) as { prefixes: string[] }).prefixes[0];

function harness(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
  env: Record<string, string | undefined> = {},
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const logs: CleanupLogEvent[] = [];
  const values: Record<string, string | undefined> = {
    MEAL_PHOTO_CLEANUP_SCHEDULER_SECRET: SECRET,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: KEY,
    ...env,
  };
  const deps: CleanupDependencies = {
    fetch: (async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, init });
      return await responder(url, init);
    }) as typeof fetch,
    getEnv: (name) => values[name],
    log: (event) => logs.push(event),
  };
  return { calls, logs, deps };
}

const emptyQueueResponses = (url: string) => {
  if (isRpc(url, RPC.mealClaim) || isRpc(url, RPC.completionClaim)) {
    return response([]);
  }
  throw new Error(`Unexpected route: ${url}`);
};

Deno.test("rejects wrong scheduler secret before service-role calls", async () => {
  const state = harness(() => response([]));
  const result = await handleCleanupRequest(request("wrong"), state.deps);
  equal(result.status, 401);
  equal(state.calls.length, 0);
});

Deno.test("rejects missing scheduler secret before service-role calls", async () => {
  const state = harness(() => response([]), {
    MEAL_PHOTO_CLEANUP_SCHEDULER_SECRET: undefined,
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 0);
  equal(state.logs, [{ level: "error", code: "scheduler_secret_unconfigured" }]);
});

Deno.test("rejects non-POST requests without service-role calls", async () => {
  const state = harness(() => response([]));
  const result = await handleCleanupRequest(request(SECRET, "GET"), state.deps);
  equal(result.status, 405);
  equal(new Headers(result.headers).get("allow"), "POST");
  equal(state.calls.length, 0);
});

Deno.test("rejects missing service-role configuration", async () => {
  const state = harness(() => response([]), {
    SUPABASE_SERVICE_ROLE_KEY: undefined,
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 0);
  equal(state.logs, [{ level: "error", code: "service_configuration_invalid" }]);
});

Deno.test("keeps the existing meal-photo queue contract intact", async () => {
  const state = harness((url, init) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: MEAL_PATH,
      }]);
    }
    if (isRpc(url, RPC.completionClaim)) return response([]);
    if (storageBucket(url)) {
      equal(storageBucket(url), "meal-photos");
      equal(storagePath(init), MEAL_PATH);
      return response([{ name: MEAL_PATH }]);
    }
    if (isRpc(url, RPC.mealComplete)) return response(true);
    throw new Error(`Unexpected route: ${url}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 200);
  equal(await result.json(), {
    result: { claimed: 1, completed: 1, failed: 0 },
  });
  equal(state.calls.map((call) => call.init?.method), [
    "POST",
    "DELETE",
    "POST",
    "POST",
  ]);
});

Deno.test("processes a completion-photo queue item with its own bucket and RPCs", async () => {
  const state = harness((url, init) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    if (storageBucket(url)) {
      equal(storageBucket(url), "meal-completion-photos");
      equal(storagePath(init), COMPLETION_PATH);
      return response([{ name: COMPLETION_PATH }]);
    }
    if (isRpc(url, RPC.completionComplete)) return response(true);
    throw new Error(`Unexpected route: ${url}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 200);
  equal(await result.json(), {
    result: { claimed: 1, completed: 1, failed: 0 },
  });
});

Deno.test("returns 200 when both queues are empty", async () => {
  const state = harness(emptyQueueResponses);
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 200);
  equal(await result.json(), {
    result: { claimed: 0, completed: 0, failed: 0 },
  });
  equal(state.calls.map((call) => call.url), [
    "http://127.0.0.1:54321/rest/v1/rpc/claim_meal_photo_cleanup_batch",
    "http://127.0.0.1:54321/rest/v1/rpc/claim_meal_completion_photo_cleanup_batch",
  ]);
});

Deno.test("processes valid items from both queues in one invocation", async () => {
  const state = harness((url, init) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: MEAL_PATH,
      }]);
    }
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: SECOND_CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    if (storageBucket(url)) return response([{ name: storagePath(init) }]);
    if (isRpc(url, RPC.mealComplete) || isRpc(url, RPC.completionComplete)) {
      return response(true);
    }
    throw new Error(`Unexpected route: ${url}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 200);
  equal(await result.json(), {
    result: { claimed: 2, completed: 2, failed: 0 },
  });
  equal(state.calls.filter((call) => storageBucket(call.url)).map((call) => ({
    bucket: storageBucket(call.url),
    path: storagePath(call.init),
  })), [
    { bucket: "meal-photos", path: MEAL_PATH },
    { bucket: "meal-completion-photos", path: COMPLETION_PATH },
  ]);
});

Deno.test("rejects a completion claim with the meal-photo bucket", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    throw new Error("Storage must not be called for a wrong bucket claim");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(await result.json(), {
    error: { code: "cleanup_retryable", retryable: true },
  });
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects malformed completion-photo paths before Storage", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: `${CLIENT_ID}/${MEAL_ID}/not-a-uuid.png`,
      }]);
    }
    throw new Error("Storage must not be called for a malformed path");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects non-JPEG completion-photo paths before Storage", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: `${CLIENT_ID}/${MEAL_ID}/${OBJECT_ID}.webp`,
      }]);
    }
    throw new Error("Storage must not be called for a non-JPEG path");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects duplicate completion cleanup IDs", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([
        {
          cleanup_id: CLEANUP_ID,
          bucket_id: "meal-completion-photos",
          object_path: COMPLETION_PATH,
        },
        {
          cleanup_id: CLEANUP_ID,
          bucket_id: "meal-completion-photos",
          object_path: SECOND_COMPLETION_PATH,
        },
      ]);
    }
    throw new Error("Storage must not be called for duplicate cleanup IDs");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects duplicate completion cleanup paths", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([
        {
          cleanup_id: CLEANUP_ID,
          bucket_id: "meal-completion-photos",
          object_path: COMPLETION_PATH,
        },
        {
          cleanup_id: SECOND_CLEANUP_ID,
          bucket_id: "meal-completion-photos",
          object_path: COMPLETION_PATH,
        },
      ]);
    }
    throw new Error("Storage must not be called for duplicate paths");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("does not complete a completion queue row after Storage delete failure", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    if (storageBucket(url)) return response({ error: "failed" }, 500);
    throw new Error("Completion must not be called after delete failure");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(await result.json(), {
    error: { code: "cleanup_partial", retryable: true },
    result: { claimed: 1, completed: 0, failed: 1 },
  });
  equal(state.logs, [{ level: "warn", code: "storage_delete_failed" }]);
});

Deno.test("keeps a completion queue row retryable when its complete RPC fails", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response([]);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    if (storageBucket(url)) return response([{ name: COMPLETION_PATH }]);
    if (isRpc(url, RPC.completionComplete)) return response(false);
    throw new Error(`Unexpected route: ${url}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(await result.json(), {
    error: { code: "cleanup_partial", retryable: true },
    result: { claimed: 1, completed: 0, failed: 1 },
  });
  equal(state.logs, [{ level: "warn", code: "queue_complete_failed" }]);
});

Deno.test("continues Queue B when Queue A claim fails", async () => {
  const state = harness((url, init) => {
    if (isRpc(url, RPC.mealClaim)) return response({ error: "unavailable" }, 500);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    if (storageBucket(url)) {
      equal(storageBucket(url), "meal-completion-photos");
      equal(storagePath(init), COMPLETION_PATH);
      return response([{ name: COMPLETION_PATH }]);
    }
    if (isRpc(url, RPC.completionComplete)) return response(true);
    throw new Error(`Unexpected route: ${url}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.filter((call) => storageBucket(call.url)).length, 1);
  equal(await result.json(), {
    error: { code: "cleanup_retryable", retryable: true },
  });
});

Deno.test("rejects an unsafe Queue B path even when Queue A failed", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) return response({ error: "unavailable" }, 500);
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    throw new Error("Unsafe Queue B claim must not reach Storage");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
  equal(state.logs, [
    { level: "warn", code: "queue_claim_failed" },
    { level: "warn", code: "queue_claim_failed" },
  ]);
});

Deno.test("keeps Queue A safe when Queue B claim fails", async () => {
  const state = harness((url, init) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: MEAL_PATH,
      }]);
    }
    if (storageBucket(url)) {
      equal(storageBucket(url), "meal-photos");
      equal(storagePath(init), MEAL_PATH);
      return response([{ name: MEAL_PATH }]);
    }
    if (isRpc(url, RPC.mealComplete)) return response(true);
    if (isRpc(url, RPC.completionClaim)) return response({ invalid: true });
    throw new Error(`Unexpected route: ${url}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.filter((call) => storageBucket(call.url)).map((call) => ({
    bucket: storageBucket(call.url),
    path: storagePath(call.init),
  })), [{ bucket: "meal-photos", path: MEAL_PATH }]);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects unknown buckets without issuing a delete", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "unknown-bucket",
        object_path: MEAL_PATH,
      }]);
    }
    if (isRpc(url, RPC.completionClaim)) return response([]);
    throw new Error("Unknown bucket must not reach Storage");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects arbitrary prefixes without issuing a delete", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: `meal-plans/${CLIENT_ID}/../../${OBJECT_ID}.webp`,
      }]);
    }
    if (isRpc(url, RPC.completionClaim)) return response([]);
    throw new Error("Arbitrary prefix must not reach Storage");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("rejects extra claim response fields", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: MEAL_PATH,
        extra: "must-reject",
      }]);
    }
    if (isRpc(url, RPC.completionClaim)) return response([]);
    throw new Error("Extra response fields must not reach Storage");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
});

Deno.test("rejects duplicate cleanup identity across queues", async () => {
  const state = harness((url) => {
    if (isRpc(url, RPC.mealClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: MEAL_PATH,
      }]);
    }
    if (isRpc(url, RPC.completionClaim)) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-completion-photos",
        object_path: COMPLETION_PATH,
      }]);
    }
    throw new Error("Duplicate cross-queue identity must not reach Storage");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 3);
  equal(state.calls.filter((call) => storageBucket(call.url)).length, 1);
});

Deno.test("does not leak secrets or raw claim data in responses or logs", async () => {
  const state = harness(() => {
    throw new Error(`${SECRET} ${KEY} ${CLEANUP_ID} ${MEAL_PATH}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  const output = JSON.stringify({
    logs: state.logs,
    body: await result.text(),
  });
  for (const secret of [SECRET, KEY, CLEANUP_ID, MEAL_PATH]) {
    if (output.includes(secret)) throw new Error("Sensitive value was emitted");
  }
});
