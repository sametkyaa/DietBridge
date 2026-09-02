import { createClient } from "npm:@supabase/supabase-js@2.87.0";

const AVATAR_BUCKET = "avatars";
const CHAT_IMAGE_BUCKET = "chat-images";
const COMPLETION_PHOTO_BUCKET = "meal-completion-photos";
const STORAGE_PAGE_SIZE = 1000;
const STORAGE_DELETE_BATCH_SIZE = 100;
const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");
const AVATAR_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i;
const COMPLETION_FILE_PATTERN = new RegExp(`^${UUID_SOURCE}\\.jpg$`, "i");
const CHAT_IMAGE_PATH_PATTERN = new RegExp(
  `^pending/${UUID_SOURCE}/${UUID_SOURCE}\\.jpg$`,
  "i",
);

type LogLevel = "warn" | "error";

export interface DeleteClientAccountLogEvent {
  level: LogLevel;
  code: string;
}

export interface DeleteClientAccountDependencies {
  fetch: typeof fetch;
  getEnv: (name: string) => string | undefined;
  log: (event: DeleteClientAccountLogEvent) => void;
  deleteAuthUser: (
    baseUrl: string,
    serviceRoleKey: string,
    userId: string,
  ) => Promise<void>;
}

interface ServiceConfiguration {
  baseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface StorageObject {
  name: string;
}

interface ChatUploadIntentRow {
  bucket_id: unknown;
  object_path: unknown;
}

interface DeletionStateRow {
  user_id: unknown;
  storage_objects: unknown;
}

interface ProfileRow {
  id: unknown;
  role: unknown;
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const defaultDependencies: DeleteClientAccountDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  getEnv: (name) => Deno.env.get(name),
  log: ({ level, code }) => {
    const event = JSON.stringify({ level, code });
    if (level === "error") console.error(event);
    else console.warn(event);
  },
  deleteAuthUser: async (baseUrl, serviceRoleKey, userId) => {
    const admin = createClient(baseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.deleteUser(userId, false);
    if (error) throw new Error("auth_delete_failed");
  },
};

const jsonResponse = (
  status: number,
  body: Record<string, unknown> | null,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(
    body === null ? null : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...CORS_HEADERS,
        ...extraHeaders,
      },
    },
  );

const errorResponse = (status: number, code: string): Response =>
  jsonResponse(status, { error: { code, retryable: status >= 500 } });

const normalizeBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password || url.pathname !== "/" || url.search ||
      url.hash
    ) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const loadConfiguration = (
  dependencies: DeleteClientAccountDependencies,
): ServiceConfiguration | null => {
  const rawBaseUrl = dependencies.getEnv("SUPABASE_URL");
  const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : null;
  return baseUrl && anonKey && serviceRoleKey
    ? { baseUrl, anonKey, serviceRoleKey }
    : null;
};

const getBearerToken = (request: Request): string | null => {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
};

const serviceHeaders = (serviceRoleKey: string): HeadersInit => ({
  authorization: `Bearer ${serviceRoleKey}`,
  apikey: serviceRoleKey,
  accept: "application/json",
  "content-type": "application/json",
});

const userHeaders = (anonKey: string, token: string): HeadersInit => ({
  authorization: `Bearer ${token}`,
  apikey: anonKey,
  accept: "application/json",
});

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseUserId = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return UUID_PATTERN.test(value.id) ? value.id : null;
};

const authenticateUser = async (
  configuration: ServiceConfiguration,
  token: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<string | null> => {
  try {
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/auth/v1/user`,
      { headers: userHeaders(configuration.anonKey, token) },
    );
    if (!response.ok) return null;
    return parseUserId(await parseJson(response));
  } catch {
    return null;
  }
};

const fetchProfile = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<ProfileRow | null> => {
  const query = new URLSearchParams({
    select: "id,role",
    id: `eq.${userId}`,
    limit: "2",
  });
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/profiles?${query.toString()}`,
    { headers: serviceHeaders(configuration.serviceRoleKey) },
  );
  if (!response.ok) throw new Error("profile_lookup_failed");
  const rows = await parseJson(response);
  if (!Array.isArray(rows)) throw new Error("profile_lookup_malformed");
  if (rows.length === 0) return null;
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new Error("profile_lookup_ambiguous");
  }
  return rows[0] as unknown as ProfileRow;
};

const hasActivePlatformAdminEntitlement = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<boolean> => {
  const query = new URLSearchParams({
    select: "user_id",
    user_id: `eq.${userId}`,
    revoked_at: "is.null",
    limit: "2",
  });
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/platform_admins?${query.toString()}`,
    { headers: serviceHeaders(configuration.serviceRoleKey) },
  );
  if (!response.ok) throw new Error("admin_entitlement_lookup_failed");
  const rows = await parseJson(response);
  if (!Array.isArray(rows)) {
    throw new Error("admin_entitlement_lookup_malformed");
  }
  return rows.length > 0;
};

const listRestRows = async (
  configuration: ServiceConfiguration,
  resource: string,
  filters: Record<string, string>,
  malformedCode: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<unknown[]> => {
  const rows: unknown[] = [];
  let offset = 0;
  while (true) {
    const query = new URLSearchParams({
      ...filters,
      limit: String(STORAGE_PAGE_SIZE),
      offset: String(offset),
    });
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/rest/v1/${resource}?${query.toString()}`,
      { headers: serviceHeaders(configuration.serviceRoleKey) },
    );
    if (!response.ok) throw new Error(`${malformedCode}_lookup_failed`);
    const page = await parseJson(response);
    if (!Array.isArray(page)) {
      throw new Error(`${malformedCode}_lookup_malformed`);
    }
    rows.push(...page);
    if (page.length < STORAGE_PAGE_SIZE) return rows;
    offset += STORAGE_PAGE_SIZE;
  }
};

const listStorageObjects = async (
  configuration: ServiceConfiguration,
  bucket: string,
  prefix: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<StorageObject[]> => {
  const objects: StorageObject[] = [];
  let offset = 0;
  while (true) {
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/storage/v1/object/list/${
        encodeURIComponent(bucket)
      }`,
      {
        method: "POST",
        headers: serviceHeaders(configuration.serviceRoleKey),
        body: JSON.stringify({
          prefix,
          limit: STORAGE_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      },
    );
    if (!response.ok) throw new Error("storage_list_failed");
    const rows = await parseJson(response);
    if (!Array.isArray(rows)) throw new Error("storage_list_malformed");
    for (const row of rows) {
      if (!isRecord(row) || typeof row.name !== "string") {
        throw new Error("storage_object_malformed");
      }
      objects.push({ name: row.name });
    }
    if (rows.length < STORAGE_PAGE_SIZE) return objects;
    offset += STORAGE_PAGE_SIZE;
  }
};

const collectAvatarPaths = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<string[]> => {
  const objects = await listStorageObjects(
    configuration,
    AVATAR_BUCKET,
    `${userId}/`,
    dependencies,
  );
  return objects.map(({ name }) => {
    if (!AVATAR_FILE_PATTERN.test(name) || name.includes("/")) {
      throw new Error("avatar_path_contract_failed");
    }
    return `${userId}/${name}`;
  });
};

const collectCompletionPhotoPaths = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<string[]> => {
  const mealFolders = await listStorageObjects(
    configuration,
    COMPLETION_PHOTO_BUCKET,
    `${userId}/`,
    dependencies,
  );
  const paths: string[] = [];
  for (const folder of mealFolders) {
    if (!UUID_PATTERN.test(folder.name) || folder.name.includes("/")) {
      throw new Error("completion_folder_contract_failed");
    }
    const files = await listStorageObjects(
      configuration,
      COMPLETION_PHOTO_BUCKET,
      `${userId}/${folder.name}/`,
      dependencies,
    );
    for (const file of files) {
      if (!COMPLETION_FILE_PATTERN.test(file.name) || file.name.includes("/")) {
        throw new Error("completion_path_contract_failed");
      }
      paths.push(`${userId}/${folder.name}/${file.name}`);
    }
  }
  return paths;
};

const validateStorageManifestPath = (
  userId: string,
  bucket: string,
  objectPath: string,
): void => {
  if (bucket === AVATAR_BUCKET) {
    const prefix = `${userId}/`;
    const name = objectPath.startsWith(prefix)
      ? objectPath.slice(prefix.length)
      : null;
    if (!name || name.includes("/") || !AVATAR_FILE_PATTERN.test(name)) {
      throw new Error("avatar_path_contract_failed");
    }
    return;
  }
  if (bucket === COMPLETION_PHOTO_BUCKET) {
    const prefix = `${userId}/`;
    if (!objectPath.startsWith(prefix)) {
      throw new Error("completion_path_contract_failed");
    }
    const remainder = objectPath.slice(prefix.length);
    const parts = remainder.split("/");
    if (
      parts.length !== 2 || !UUID_PATTERN.test(parts[0]) ||
      !COMPLETION_FILE_PATTERN.test(parts[1])
    ) throw new Error("completion_path_contract_failed");
    return;
  }
  if (bucket === CHAT_IMAGE_BUCKET) {
    if (!CHAT_IMAGE_PATH_PATTERN.test(objectPath)) {
      throw new Error("chat_intent_path_contract_failed");
    }
    return;
  }
  throw new Error("storage_manifest_bucket_contract_failed");
};

const toStorageManifestRow = (
  userId: string,
  bucket: string,
  objectPath: string,
): { bucket_id: string; object_path: string } => {
  validateStorageManifestPath(userId, bucket, objectPath);
  return { bucket_id: bucket, object_path: objectPath };
};

const fetchChatUploadIntentPaths = async (
  configuration: ServiceConfiguration,
  filter: Record<string, string>,
  dependencies: DeleteClientAccountDependencies,
): Promise<string[]> => {
  const rows = await listRestRows(
    configuration,
    "chat_upload_intents",
    { select: "bucket_id,object_path", ...filter },
    "chat_intent",
    dependencies,
  );
  return rows.map((row) => {
    if (!isRecord(row)) throw new Error("chat_intent_row_malformed");
    const intent = row as unknown as ChatUploadIntentRow;
    if (
      intent.bucket_id !== CHAT_IMAGE_BUCKET ||
      typeof intent.object_path !== "string" ||
      !CHAT_IMAGE_PATH_PATTERN.test(intent.object_path)
    ) throw new Error("chat_intent_path_contract_failed");
    return intent.object_path;
  });
};

const fetchClientChatImagePaths = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<string[]> => {
  const conversationRows = await listRestRows(
    configuration,
    "chat_conversations",
    { select: "id", client_id: `eq.${userId}` },
    "chat_conversation",
    dependencies,
  );
  const conversationIds = conversationRows.map((row) => {
    if (
      !isRecord(row) || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    ) {
      throw new Error("chat_conversation_row_malformed");
    }
    return row.id;
  });

  const paths = [] as string[];
  for (const conversationId of conversationIds) {
    paths.push(
      ...await fetchChatUploadIntentPaths(
        configuration,
        { conversation_id: `eq.${conversationId}` },
        dependencies,
      ),
    );
  }

  // Keep cleaning client-created orphan intents as well. The conversation
  // queries above are what ensure dietitian-uploaded images in the client's
  // conversations are included too.
  paths.push(
    ...await fetchChatUploadIntentPaths(
      configuration,
      { created_by: `eq.${userId}` },
      dependencies,
    ),
  );
  return [...new Set(paths)];
};

const collectOwnedStoragePaths = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<Map<string, string[]>> => {
  const [avatarPaths, completionPaths, chatPaths] = await Promise.all([
    collectAvatarPaths(configuration, userId, dependencies),
    collectCompletionPhotoPaths(configuration, userId, dependencies),
    fetchClientChatImagePaths(configuration, userId, dependencies),
  ]);
  return new Map([
    [AVATAR_BUCKET, [...new Set(avatarPaths)]],
    [COMPLETION_PHOTO_BUCKET, [...new Set(completionPaths)]],
    [CHAT_IMAGE_BUCKET, [...new Set(chatPaths)]],
  ]);
};

const invokeDeletionState = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<Map<string, string[]> | null> => {
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/rpc/get_client_account_deletion_state`,
    {
      method: "POST",
      headers: serviceHeaders(configuration.serviceRoleKey),
      body: JSON.stringify({ p_client_id: userId }),
    },
  );
  if (!response.ok) throw new Error("deletion_state_lookup_failed");
  const value = await parseJson(response);
  if (!Array.isArray(value)) throw new Error("deletion_state_lookup_malformed");
  if (value.length === 0) return null;
  if (value.length !== 1 || !isRecord(value[0])) {
    throw new Error("deletion_state_lookup_ambiguous");
  }
  const state = value[0] as unknown as DeletionStateRow;
  if (
    typeof state.user_id !== "string" ||
    state.user_id.toLowerCase() !== userId.toLowerCase()
  ) {
    throw new Error("deletion_state_identity_mismatch");
  }
  if (!Array.isArray(state.storage_objects)) {
    throw new Error("deletion_state_manifest_malformed");
  }
  const pathsByBucket = new Map<string, string[]>();
  for (const value of state.storage_objects) {
    if (
      !isRecord(value) || typeof value.bucket_id !== "string" ||
      typeof value.object_path !== "string"
    ) {
      throw new Error("deletion_state_manifest_row_malformed");
    }
    const row = toStorageManifestRow(
      userId,
      value.bucket_id,
      value.object_path,
    );
    const paths = pathsByBucket.get(row.bucket_id) ?? [];
    paths.push(row.object_path);
    pathsByBucket.set(row.bucket_id, paths);
  }
  for (const [bucket, paths] of pathsByBucket) {
    pathsByBucket.set(bucket, [...new Set(paths)]);
  }
  return pathsByBucket;
};

const removeExactStoragePaths = async (
  configuration: ServiceConfiguration,
  pathsByBucket: Map<string, string[]>,
  dependencies: DeleteClientAccountDependencies,
): Promise<void> => {
  for (const [bucket, paths] of pathsByBucket) {
    for (
      let start = 0;
      start < paths.length;
      start += STORAGE_DELETE_BATCH_SIZE
    ) {
      const batch = paths.slice(start, start + STORAGE_DELETE_BATCH_SIZE);
      const response = await dependencies.fetch(
        `${configuration.baseUrl}/storage/v1/object/${
          encodeURIComponent(bucket)
        }`,
        {
          method: "DELETE",
          headers: serviceHeaders(configuration.serviceRoleKey),
          body: JSON.stringify({ prefixes: batch }),
        },
      );
      // Supabase Storage treats already-absent exact objects as a successful
      // no-op, which makes this operation safe to retry.
      if (!response.ok) throw new Error("storage_delete_failed");
    }
  }
};

const invokeTransactionalDeletion = async (
  configuration: ServiceConfiguration,
  userId: string,
  storageObjects: { bucket_id: string; object_path: string }[],
  dependencies: DeleteClientAccountDependencies,
): Promise<void> => {
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/rpc/prepare_client_account_deletion`,
    {
      method: "POST",
      headers: serviceHeaders(configuration.serviceRoleKey),
      body: JSON.stringify({
        p_client_id: userId,
        p_storage_objects: storageObjects,
      }),
    },
  );
  if (!response.ok) throw new Error("transactional_deletion_failed");
};

const markStorageCleanupComplete = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<void> => {
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/rpc/mark_client_account_storage_cleaned`,
    {
      method: "POST",
      headers: serviceHeaders(configuration.serviceRoleKey),
      body: JSON.stringify({ p_client_id: userId }),
    },
  );
  if (!response.ok) throw new Error("storage_cleanup_marker_failed");
};

const requestBodyIsEmptyObject = async (request: Request): Promise<boolean> => {
  const body = (await request.text()).trim();
  if (!body) return true;
  try {
    const value = JSON.parse(body) as unknown;
    return isRecord(value) && Object.keys(value).length === 0;
  } catch {
    return false;
  }
};

async function handleRequest(
  request: Request,
  dependencies: DeleteClientAccountDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return jsonResponse(204, null, { allow: "POST, OPTIONS" });
  }
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed");
  }

  const configuration = loadConfiguration(dependencies);
  if (!configuration) {
    dependencies.log({ level: "error", code: "service_configuration_invalid" });
    return errorResponse(503, "service_unavailable");
  }

  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "unauthorized");
  if (!(await requestBodyIsEmptyObject(request))) {
    return errorResponse(400, "invalid_request");
  }

  const userId = await authenticateUser(configuration, token, dependencies);
  if (!userId) return errorResponse(401, "unauthorized");

  // A service-created tombstone is the retry discriminator. A retry never
  // re-reads profile/relationship rows or reconstructs ownership from live
  // data; it uses only the exact manifest committed by the first transaction.
  const existingManifest = await invokeDeletionState(
    configuration,
    userId,
    dependencies,
  );
  if (existingManifest === null) {
    const profile = await fetchProfile(configuration, userId, dependencies);
    if (
      !profile || profile.id !== userId || profile.role !== "client" ||
      await hasActivePlatformAdminEntitlement(
        configuration,
        userId,
        dependencies,
      )
    ) {
      return errorResponse(403, "forbidden");
    }

    // Collect and validate every owned path before the transaction. If a
    // lookup or path contract fails, no Storage/Auth mutation is attempted.
    const collectedPaths = await collectOwnedStoragePaths(
      configuration,
      userId,
      dependencies,
    );
    const storageObjects = [...collectedPaths.entries()].flatMap((
      [bucket, paths],
    ) =>
      paths.map((objectPath) =>
        toStorageManifestRow(userId, bucket, objectPath)
      )
    );
    await invokeTransactionalDeletion(
      configuration,
      userId,
      storageObjects,
      dependencies,
    );
  } else {
    await invokeTransactionalDeletion(configuration, userId, [], dependencies);
  }

  const persistedManifest = await invokeDeletionState(
    configuration,
    userId,
    dependencies,
  );
  if (persistedManifest === null) {
    throw new Error("deletion_state_missing_after_transaction");
  }
  await removeExactStoragePaths(configuration, persistedManifest, dependencies);
  await markStorageCleanupComplete(configuration, userId, dependencies);

  // This is intentionally the final side effect. Auth deletion cascades the
  // tombstone, manifest, and any remaining Auth-owned state.
  await dependencies.deleteAuthUser(
    configuration.baseUrl,
    configuration.serviceRoleKey,
    userId,
  );

  return jsonResponse(200, { data: { deleted: true } });
}

export async function handleDeleteClientAccountRequest(
  request: Request,
  dependencies: DeleteClientAccountDependencies = defaultDependencies,
): Promise<Response> {
  try {
    return await handleRequest(request, dependencies);
  } catch {
    dependencies.log({
      level: "error",
      code: "client_account_deletion_failed",
    });
    return errorResponse(503, "deletion_retryable");
  }
}
