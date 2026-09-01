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
const DIETITIAN_INTENT_ID = "11111111-1111-4111-8111-111111111111";
const DIETITIAN_CHAT_OBJECT_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const CHAT_PATH = `pending/${INTENT_ID}/${CHAT_OBJECT_ID}.jpg`;
const DIETITIAN_CHAT_PATH =
  `pending/${DIETITIAN_INTENT_ID}/${DIETITIAN_CHAT_OBJECT_ID}.jpg`;
const TOKEN = "client-jwt-test-value";
const SERVICE_ROLE_KEY = "server-only-service-role-test-value";
const AVATAR_PATH = `${USER_ID}/avatar.jpg`;
const COMPLETION_PATH = `${USER_ID}/${MEAL_ID}/${OBJECT_ID}.jpg`;
const PERSISTED_MANIFEST = [
  { bucket_id: "avatars", object_path: AVATAR_PATH },
  { bucket_id: "chat-images", object_path: CHAT_PATH },
  { bucket_id: "chat-images", object_path: DIETITIAN_CHAT_PATH },
  { bucket_id: "meal-completion-photos", object_path: COMPLETION_PATH },
];
const COLLECTED_MANIFEST = [
  { bucket_id: "avatars", object_path: AVATAR_PATH },
  { bucket_id: "meal-completion-photos", object_path: COMPLETION_PATH },
  { bucket_id: "chat-images", object_path: CHAT_PATH },
  { bucket_id: "chat-images", object_path: DIETITIAN_CHAT_PATH },
];

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
  if (left !== right) {
    throw new Error(`${message}: expected ${right}, got ${left}`);
  }
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
  deleteAuthUser?: DeleteClientAccountDependencies["deleteAuthUser"],
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
    deleteAuthUser: deleteAuthUser ??
      (async (_baseUrl, serviceRoleKey, userId) => {
        equal(serviceRoleKey, SERVICE_ROLE_KEY, "Auth delete key");
        deletedAuthUsers.push(userId);
      }),
  };
  return { calls, logs, deletedAuthUsers, dependencies };
}

function stateRow() {
  return [{ user_id: USER_ID, storage_objects: PERSISTED_MANIFEST }];
}

function createHappyResponder({
  prepareStatus = 200,
  storageDeleteStatus = 200,
}: { prepareStatus?: number; storageDeleteStatus?: number } = {}) {
  let stateCalls = 0;
  return (url: string, init?: RequestInit): Response => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") {
      equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
      return json({ id: USER_ID });
    }
    if (parsed.pathname === "/rest/v1/rpc/get_client_account_deletion_state") {
      stateCalls += 1;
      return json(stateCalls === 1 ? [] : stateRow());
    }
    if (parsed.pathname === "/rest/v1/profiles") {
      return json([{ id: USER_ID, role: "client" }]);
    }
    if (parsed.pathname === "/rest/v1/platform_admins") return json([]);
    if (parsed.pathname === "/rest/v1/chat_conversations") {
      equal(
        parsed.searchParams.get("client_id"),
        `eq.${USER_ID}`,
        "chat conversation client filter",
      );
      return json([{ id: CONVERSATION_ID }]);
    }
    if (parsed.pathname === "/rest/v1/chat_upload_intents") {
      const conversationFilter = parsed.searchParams.get("conversation_id");
      const creatorFilter = parsed.searchParams.get("created_by");
      if (conversationFilter === `eq.${CONVERSATION_ID}`) {
        return json([
          { bucket_id: "chat-images", object_path: CHAT_PATH },
          { bucket_id: "chat-images", object_path: DIETITIAN_CHAT_PATH },
        ]);
      }
      if (creatorFilter === `eq.${USER_ID}`) {
        return json([{ bucket_id: "chat-images", object_path: CHAT_PATH }]);
      }
      throw new Error("unexpected chat intent filter");
    }
    if (parsed.pathname === "/storage/v1/object/list/avatars") {
      const body = JSON.parse(String(init?.body)) as { prefix: string };
      equal(body.prefix, `${USER_ID}/`, "avatar list prefix");
      return json([{ name: "avatar.jpg" }]);
    }
    if (parsed.pathname === "/storage/v1/object/list/meal-completion-photos") {
      const body = JSON.parse(String(init?.body)) as { prefix: string };
      if (body.prefix === `${USER_ID}/`) return json([{ name: MEAL_ID }]);
      if (body.prefix === `${USER_ID}/${MEAL_ID}/`) {
        return json([{ name: `${OBJECT_ID}.jpg` }]);
      }
    }
    if (parsed.pathname === "/rest/v1/rpc/prepare_client_account_deletion") {
      const body = JSON.parse(String(init?.body)) as {
        p_client_id: string;
        p_storage_objects: unknown;
      };
      equal(body.p_client_id, USER_ID, "transaction target");
      if (
        Array.isArray(body.p_storage_objects) &&
        body.p_storage_objects.length > 0
      ) {
        equal(
          body.p_storage_objects,
          COLLECTED_MANIFEST,
          "first-attempt exact manifest",
        );
      } else {
        equal(body.p_storage_objects, [], "retry uses persisted manifest");
      }
      return json(null, prepareStatus);
    }
    if (
      parsed.pathname === "/rest/v1/rpc/mark_client_account_storage_cleaned"
    ) {
      equal(
        JSON.parse(String(init?.body)),
        { p_client_id: USER_ID },
        "Storage completion marker target",
      );
      return json(null);
    }
    if (parsed.pathname.startsWith("/storage/v1/object/")) {
      const body = JSON.parse(String(init?.body)) as { prefixes: string[] };
      if (parsed.pathname.endsWith("/chat-images")) {
        equal(
          body.prefixes,
          [CHAT_PATH, DIETITIAN_CHAT_PATH],
          "all conversation chat images",
        );
      }
      return json([], storageDeleteStatus);
    }
    throw new Error(`unexpected route ${url}`);
  };
}

Deno.test("uses persisted manifest and removes client plus dietitian chat images in target conversations", async () => {
  const state = harness(createHappyResponder());
  const response = await handleDeleteClientAccountRequest(
    request("POST", "{}"),
    state.dependencies,
  );

  equal(response.status, 200);
  equal(await response.json(), { data: { deleted: true } });
  equal(state.deletedAuthUsers, [USER_ID]);

  const storageDeletes = state.calls
    .filter((call) => call.init?.method === "DELETE")
    .map((call) => ({
      bucket: new URL(call.url).pathname.split("/").at(-1),
      paths: (JSON.parse(String(call.init?.body)) as { prefixes: string[] })
        .prefixes,
    }));
  equal(storageDeletes, [
    { bucket: "avatars", paths: [AVATAR_PATH] },
    { bucket: "chat-images", paths: [CHAT_PATH, DIETITIAN_CHAT_PATH] },
    { bucket: "meal-completion-photos", paths: [COMPLETION_PATH] },
  ]);
  assert(
    state.calls.some((call) =>
      call.url.includes("/chat_conversations?") &&
      call.url.includes(`client_id=eq.${USER_ID}`)
    ),
    "conversation-scoped chat lookup was used",
  );
  assert(
    state.calls.some((call) =>
      call.url.includes(`conversation_id=eq.${CONVERSATION_ID}`)
    ),
    "conversation intent lookup was used",
  );
  assert(
    !state.calls.some((call) =>
      /meal-photos|recipe-images|dietitian-diplomas/.test(call.url)
    ),
    "unrelated bucket was untouched",
  );
});

Deno.test("rejects a target in the request body before any service mutation", async () => {
  const state = harness(() => {
    throw new Error("request body must not reach a service route");
  });
  const response = await handleDeleteClientAccountRequest(
    request(
      "POST",
      JSON.stringify({ user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    ),
    state.dependencies,
  );
  equal(response.status, 400);
  equal(state.calls.length, 0);
  equal(state.deletedAuthUsers, []);
});

Deno.test("rejects missing or non-POST authentication without mutation", async () => {
  const state = harness(() => {
    throw new Error("unauthenticated request must not reach a service route");
  });
  equal(
    (await handleDeleteClientAccountRequest(request("GET"), state.dependencies))
      .status,
    405,
  );
  equal(
    (await handleDeleteClientAccountRequest(
      request("POST", undefined, ""),
      state.dependencies,
    )).status,
    401,
  );
  equal(state.calls.length, 0);
});

Deno.test("rejects dietitian targets before Storage, cleanup RPC, or Auth deletion", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/rpc/get_client_account_deletion_state") {
      return json([]);
    }
    if (parsed.pathname === "/rest/v1/profiles") {
      return json([{ id: USER_ID, role: "dietitian" }]);
    }
    throw new Error("dietitian target must stop before any other route");
  });
  const response = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(response.status, 403);
  equal(state.deletedAuthUsers, []);
  assert(
    !state.calls.some((call) =>
      call.url.includes("/storage/") ||
      call.url.includes("prepare_client_account_deletion")
    ),
    "dietitian mutation was attempted",
  );
});

Deno.test("rejects active platform-admin entitlements even when the profile role is client", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/rpc/get_client_account_deletion_state") {
      return json([]);
    }
    if (parsed.pathname === "/rest/v1/profiles") {
      return json([{ id: USER_ID, role: "client" }]);
    }
    if (parsed.pathname === "/rest/v1/platform_admins") {
      return json([{ user_id: USER_ID }]);
    }
    throw new Error("active platform-admin target must stop before Storage");
  });
  const response = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(response.status, 403);
  equal(state.deletedAuthUsers, []);
  assert(
    !state.calls.some((call) =>
      call.url.includes("/storage/") ||
      call.url.includes("prepare_client_account_deletion")
    ),
    "platform-admin mutation was attempted",
  );
});

Deno.test("commits relational cleanup before a later Storage failure and keeps the retry state", async () => {
  const state = harness(createHappyResponder({ storageDeleteStatus: 503 }));
  const response = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(response.status, 503);
  equal(state.deletedAuthUsers, []);
  assert(
    state.calls.some((call) =>
      call.url.includes("prepare_client_account_deletion")
    ),
    "transactional cleanup ran before Storage",
  );
  assert(
    !state.calls.some((call) =>
      call.url.includes("mark_client_account_storage_cleaned")
    ),
    "Storage marker continued after failure",
  );
});

Deno.test("stops before Storage or Auth when the transactional database step fails", async () => {
  const state = harness(createHappyResponder({ prepareStatus: 503 }));
  const response = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(response.status, 503);
  equal(state.deletedAuthUsers, []);
  assert(
    !state.calls.some((call) => call.init?.method === "DELETE"),
    "Storage continued after transaction failure",
  );
  assert(
    !state.calls.some((call) =>
      call.url.includes("mark_client_account_storage_cleaned")
    ),
    "marker continued after transaction failure",
  );
});

Deno.test("retries from tombstone and persisted manifest without profile or live ownership lookups", async () => {
  let stateCalls = 0;
  const state = harness((url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/rpc/get_client_account_deletion_state") {
      stateCalls += 1;
      return json(stateRow());
    }
    if (parsed.pathname === "/rest/v1/rpc/prepare_client_account_deletion") {
      equal(JSON.parse(String(init?.body)), {
        p_client_id: USER_ID,
        p_storage_objects: [],
      }, "retry transaction input");
      return json(null);
    }
    if (
      parsed.pathname === "/rest/v1/rpc/mark_client_account_storage_cleaned"
    ) return json(null);
    if (parsed.pathname.endsWith("/avatars")) {
      equal(
        JSON.parse(String(init?.body)).prefixes,
        [AVATAR_PATH],
        "retry avatar manifest",
      );
      return json(null);
    }
    if (parsed.pathname.endsWith("/chat-images")) {
      equal(JSON.parse(String(init?.body)).prefixes, [
        CHAT_PATH,
        DIETITIAN_CHAT_PATH,
      ], "retry chat manifest");
      return json(null);
    }
    if (parsed.pathname.endsWith("/meal-completion-photos")) {
      equal(
        JSON.parse(String(init?.body)).prefixes,
        [COMPLETION_PATH],
        "retry completion manifest",
      );
      return json(null);
    }
    throw new Error(`retry must not reach live ownership route: ${url}`);
  });
  const firstResponse = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(firstResponse.status, 200);
  const callsBeforeSecondAttempt = state.calls.length;
  const secondResponse = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(secondResponse.status, 200);
  equal(stateCalls, 4);
  assert(
    !state.calls.slice(callsBeforeSecondAttempt).some((call) =>
      call.url.includes("/profiles") ||
      call.url.includes("/platform_admins") ||
      call.url.includes("/chat_conversations") ||
      call.url.includes("/chat_upload_intents") ||
      call.url.includes("/storage/v1/object/list/")
    ),
    "retry skipped profile and live ownership discovery",
  );
  equal(state.deletedAuthUsers, [USER_ID, USER_ID]);
});

Deno.test("keeps the profile-free tombstone state retryable when Auth deletion fails", async () => {
  let failAuth = true;
  const state = harness(
    createHappyResponder(),
    {},
    async (_baseUrl, serviceRoleKey, userId) => {
      equal(serviceRoleKey, SERVICE_ROLE_KEY, "Auth failure service key");
      equal(userId, USER_ID, "Auth failure target");
      if (failAuth) {
        failAuth = false;
        throw new Error("temporary auth failure");
      }
      state.deletedAuthUsers.push(userId);
    },
  );
  equal(
    (await handleDeleteClientAccountRequest(
      request("POST"),
      state.dependencies,
    )).status,
    503,
  );
  const callsBeforeRetry = state.calls.length;
  equal(
    (await handleDeleteClientAccountRequest(
      request("POST"),
      state.dependencies,
    )).status,
    200,
  );
  assert(
    !state.calls.slice(callsBeforeRetry).some((call) =>
      call.url.includes("/profiles") ||
      call.url.includes("/storage/v1/object/list/")
    ),
    "Auth retry used tombstone manifest",
  );
  equal(state.deletedAuthUsers, [USER_ID]);
});

Deno.test("rejects a cross-account state response before Storage or Auth", async () => {
  const otherUser = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    if (parsed.pathname === "/rest/v1/rpc/get_client_account_deletion_state") {
      return json([{
        user_id: otherUser,
        storage_objects: PERSISTED_MANIFEST,
      }]);
    }
    throw new Error("cross-account state must stop before any other route");
  });
  const response = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  equal(response.status, 503);
  equal(state.deletedAuthUsers, []);
  assert(
    !state.calls.some((call) => call.init?.method === "DELETE"),
    "cross-account Storage mutation was attempted",
  );
});

Deno.test("never returns secrets or raw identifiers in failure output", async () => {
  const state = harness((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return json({ id: USER_ID });
    throw new Error(`${SERVICE_ROLE_KEY} ${TOKEN} ${USER_ID} ${CHAT_PATH}`);
  });
  const response = await handleDeleteClientAccountRequest(
    request("POST"),
    state.dependencies,
  );
  const serialized = JSON.stringify({
    body: await response.text(),
    logs: state.logs,
  });
  equal(response.status, 503);
  for (const sensitive of [SERVICE_ROLE_KEY, TOKEN, USER_ID, CHAT_PATH]) {
    assert(
      !serialized.includes(sensitive),
      `sensitive value leaked: ${sensitive}`,
    );
  }
});
