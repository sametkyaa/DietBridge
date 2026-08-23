import {
  type CleanupDependencies,
  type CleanupLogEvent,
  handleCleanupRequest,
} from "./handler.ts";

const SECRET = "meal-photo-scheduler-secret-at-least-32-bytes";
const KEY = "server-only-service-role-test-key";
const CLEANUP_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const DIETITIAN_ID = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `meal-plans/${CLIENT_ID}/${DIETITIAN_ID}/${OBJECT_ID}.webp`;

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const request = (secret = SECRET) =>
  new Request("http://local/cleanup-meal-photos", {
    method: "POST",
    headers: { "x-meal-photo-cleanup-secret": secret },
  });

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

Deno.test("rejects missing scheduler secret before service-role calls", async () => {
  const state = harness(() => response([]));
  const result = await handleCleanupRequest(request("wrong"), state.deps);
  equal(result.status, 401);
  equal(state.calls.length, 0);
});

Deno.test("claims, deletes exact path, then completes with service role", async () => {
  const state = harness((url, init) => {
    if (url.includes("claim_meal_photo_cleanup_batch")) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: PATH,
      }]);
    }
    if (url.includes("/storage/v1/object/")) {
      equal(JSON.parse(String(init?.body)), { prefixes: [PATH] });
      return response([{ name: PATH }]);
    }
    if (url.includes("complete_meal_photo_cleanup")) return response(true);
    throw new Error("Unexpected route");
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
  ]);
  for (const call of state.calls) {
    const headers = new Headers(call.init?.headers);
    equal(headers.get("authorization"), `Bearer ${KEY}`);
    equal(headers.get("apikey"), KEY);
  }
});

Deno.test("failed delete remains retryable and is never completed", async () => {
  const state = harness((url) => {
    if (url.includes("claim_meal_photo_cleanup_batch")) {
      return response([{
        cleanup_id: CLEANUP_ID,
        bucket_id: "meal-photos",
        object_path: PATH,
      }]);
    }
    if (url.includes("/storage/v1/object/")) {
      return response({ error: "failed" }, 500);
    }
    throw new Error("Completion must not be called");
  });
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 2);
  equal(state.logs, [{ level: "warn", code: "storage_delete_failed" }]);
});

Deno.test("malformed or foreign-bucket claims fail closed before Storage", async () => {
  const state = harness(() =>
    response([{
      cleanup_id: CLEANUP_ID,
      bucket_id: "recipe-images",
      object_path: PATH,
    }])
  );
  const result = await handleCleanupRequest(request(), state.deps);
  equal(result.status, 503);
  equal(state.calls.length, 1);
  equal(state.logs, [{ level: "warn", code: "queue_claim_failed" }]);
});

Deno.test("responses and logs never expose secrets, ids, paths, or raw errors", async () => {
  const state = harness(() => {
    throw new Error(`${SECRET} ${KEY} ${CLEANUP_ID} ${PATH}`);
  });
  const result = await handleCleanupRequest(request(), state.deps);
  const output = JSON.stringify({
    logs: state.logs,
    body: await result.text(),
  });
  for (const secret of [SECRET, KEY, CLEANUP_ID, PATH]) {
    if (output.includes(secret)) throw new Error("Sensitive value was emitted");
  }
});
