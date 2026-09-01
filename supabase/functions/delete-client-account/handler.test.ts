import {
  type DeleteClientAccountDependencies,
  type DeleteClientAccountLogEvent,
  handleDeleteClientAccountRequest,
} from "./handler.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OBJECT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INTENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHAT_OBJECT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CHAT_PATH = `pending/${INTENT_ID}/${CHAT_OBJECT_ID}.jpg`;
const TOKEN = "client-jwt-test-value";
const SERVICE_ROLE_KEY = "server-only-service-role-test-value";
const AVATAR_PATH = `${USER_ID}/avatar.jpg`;
const COMPLETION_PATH = `${USER_ID}/${MEAL_ID}/${OBJECT_ID}.jpg`;

interface Call {
  url: string;
  init?: RequestInit;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message = "values differ") {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: expected ${right}, got ${left}`);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(
  method = "POST",
  body?: string,
  token = TOKEN,
): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("http://local.test/functions/v1/delete-client-account", {
    method,
    headers,
    body,
  });
}

function harness(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
  overrides: Record<string, string | undefined> = {},
) {
  const calls: Call[] = [];
  const logs: DeleteClientAccountLogEvent[] = [];
  const deletedAuthUsers: string[] = [];
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: "publishable-test-key",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    ...overrides,
  };
  const dependencies: DeleteClientAccountDependencies = {
    fetch: (async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, init });
      return await responder(url, init);
    }) as typeof fetch,
    getEnv: (name) => env[name],
    log: (event) => logs.push(event),
    deleteAuthUser: async (_baseUrl, serviceRoleKey, userId) => {
      equal(serviceRoleKey, SERVICE_ROLE_KEY, "Auth delete key");
      deletedAuthUsers.push(userId);
    },
  };
  return { calls, logs, deletedAuthUsers, dependencies };
}

function happyResponder(url: string, init?: RequestInit): Response {
  const parsed = new URL(url);
  if (parsed.pathname === "/auth/v1/user") {
    equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
    return json({ id: USER_ID });
  }
  if (parsed.pathname === "/rest/v1/profiles") return json([{ id: USER_ID, role: "client" }]);
  if (parsed.pathname === "/rest/v1/platform_admins") return json([]);
  if (parsed.pathname === "/rest/v1/chat_upload_intents") {
    return json([{ bucket_id: "chat-images", object_path: CHAT_PATH }]);
  }
  if (parsed.pathname === "/storage/v1/object/list/avatars") {
    const body = JSON.parse(String(init?.body)) as { prefix: string };
    equal(body.prefix, `${USER_ID}/`, "avatar list prefix");
    return json([{ name: "avatar.jpg" }]);
  }
  if (parsed.pathname === "/storage/v1/object/list/meal-completion-photos") {
    const body = JSON.parse(String(init?.body)) as { prefix: string };
    if (body.prefix === `${USER_ID}/`) return json([{ name: MEAL_ID }]);
    if (body.prefix === `${USER_ID}/${MEAL_ID}/`) return json([{ name: `${OBJECT_ID}.jpg` }]);
  }
  if (parsed.pathname.startsWith("/storage/v1/object/")) return json([]);
  if (parsed.pathname === "/rest/v1/rpc/delete_client_account_data") {
    equal(JSON.parse(String(init?.body)), { p_client_id: USER_ID }, "cleanup target");
    return json(null);
  }
  throw new Error(`unexpected route ${url}`);
}

Deno.test("deletes only the validated client account and exact owned objects", async () => {
  const state = harness(happyResponder);
  const response = await handleDeleteClientAccountRequest(request("POST", "{}"), state.dependencies);

  equal(response.status, 200);
  equal(await response.json(), { data: { deleted: true } });
  equal(state.deletedAuthUsers, [USER_ID]);

  const storageDeletes = state.calls
    .filter((call) => call.init?.method === "DELETE")
    .map((call) => ({
      bucket: new URL(call.url).pathname.split("/").at(-1),
      paths: (JSON.parse(String(call.init?.body)) as { prefixes: string[] }).prefixes,
    }));
  equal(storageDeletes, [
    { bucket: "avatars", paths: [AVATAR_PATH] },
    { bucket: "meal-completion-photos", paths: [COMPLETION_PATH] },
    { bucket: "chat-images", paths: [CHAT_PATH] },
  ]);
  assert(!state.calls.some((call) => /meal-photos|recipe-images|dietitian-diplomas/.test(call.url)), "unrelated bucket was touched");
});

Deno.test("rejects a target in the request body before any service mutation", async () => {
  const state = harness(() => { throw new Error("request body must not reach a service route"); });
  const response = await handleDeleteClientAccountRequest(
    request("POST", JSON.stringify({ user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" })),
    state.dependencies,
  );
  equal(response.status, 400);
  equal(state.calls.length, 0);
  equal(state.deletedAuthUsers, []);
});

Deno.test("rejects missing or non-POST authentication without mutation", async () => {
  const state = harness(() => { throw new Error("unauthenticated request must not reach a service route"); });
  equal((await handleDeleteClientAccountRequest(request("GET"), state.dependencies)).status, 405);
  equal((await handleDeleteClientAccountRequest(request("POST", undefined, ""), state.dependencies)).status, 401);
  equal(state.calls.length, 0);
});

Deno.test("rejects dietitian targets before Storage, cleanup RPC, or Auth deletion", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/profiles") return json([{ id: USER_ID, role: "dietitian" }]);
    throw new Error("dietitian target must stop before any other route");
  });
  const response = await handleDeleteClientAccountRequest(request("POST"), state.dependencies);
  equal(response.status, 403);
  equal(state.deletedAuthUsers, []);
  assert(!state.calls.some((call) => call.url.includes("/storage/") || call.url.includes("delete_client_account_data")), "dietitian mutation was attempted");
});

Deno.test("rejects active platform-admin entitlements even when the profile role is client", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/profiles") return json([{ id: USER_ID, role: "client" }]);
    if (parsed.pathname === "/rest/v1/platform_admins") return json([{ user_id: USER_ID }]);
    throw new Error("active platform-admin target must stop before Storage");
  });
  const response = await handleDeleteClientAccountRequest(request("POST"), state.dependencies);
  equal(response.status, 403);
  equal(state.deletedAuthUsers, []);
  assert(!state.calls.some((call) => call.url.includes("/storage/") || call.url.includes("delete_client_account_data")), "platform-admin mutation was attempted");
});

Deno.test("stops before relational or Auth deletion when owned Storage cleanup fails", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/profiles") return json([{ id: USER_ID, role: "client" }]);
    if (parsed.pathname === "/rest/v1/platform_admins") return json([]);
    if (parsed.pathname === "/rest/v1/chat_upload_intents") return json([]);
    if (parsed.pathname === "/storage/v1/object/list/avatars") return json([{ name: "avatar.jpg" }]);
    if (parsed.pathname === "/storage/v1/object/list/meal-completion-photos") return json([]);
    if (parsed.pathname === "/storage/v1/object/avatars") return json({ error: "temporary" }, 503);
    throw new Error(`unexpected route ${url}`);
  });
  const response = await handleDeleteClientAccountRequest(request("POST"), state.dependencies);
  equal(response.status, 503);
  equal(state.deletedAuthUsers, []);
  assert(!state.calls.some((call) => call.url.includes("delete_client_account_data")), "relational cleanup continued after Storage failure");
});

Deno.test("never returns secrets or raw identifiers in failure output", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/profiles") return json([{ id: USER_ID, role: "client" }]);
    if (parsed.pathname === "/rest/v1/platform_admins") return json([]);
    throw new Error(`${SERVICE_ROLE_KEY} ${TOKEN} ${USER_ID} ${CHAT_PATH}`);
  });
  const response = await handleDeleteClientAccountRequest(request("POST"), state.dependencies);
  const serialized = JSON.stringify({ body: await response.text(), logs: state.logs });
  equal(response.status, 503);
  for (const sensitive of [SERVICE_ROLE_KEY, TOKEN, USER_ID, CHAT_PATH]) {
    assert(!serialized.includes(sensitive), `sensitive value leaked: ${sensitive}`);
  }
});
