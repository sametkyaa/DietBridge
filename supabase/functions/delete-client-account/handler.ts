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
): Response => new Response(
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
  if (!Array.isArray(rows)) throw new Error("admin_entitlement_lookup_malformed");
  return rows.length > 0;
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
      `${configuration.baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
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

const fetchClientChatImagePaths = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<string[]> => {
  const query = new URLSearchParams({
    select: "bucket_id,object_path",
    created_by: `eq.${userId}`,
  });
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/chat_upload_intents?${query.toString()}`,
    { headers: serviceHeaders(configuration.serviceRoleKey) },
  );
  if (!response.ok) throw new Error("chat_intent_lookup_failed");
  const rows = await parseJson(response);
  if (!Array.isArray(rows)) throw new Error("chat_intent_lookup_malformed");
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
        `${configuration.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
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

const invokeRelationalCleanup = async (
  configuration: ServiceConfiguration,
  userId: string,
  dependencies: DeleteClientAccountDependencies,
): Promise<void> => {
  const response = await dependencies.fetch(
    `${configuration.baseUrl}/rest/v1/rpc/delete_client_account_data`,
    {
      method: "POST",
      headers: serviceHeaders(configuration.serviceRoleKey),
      body: JSON.stringify({ p_client_id: userId }),
    },
  );
  if (!response.ok) throw new Error("relational_cleanup_failed");
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

  const profile = await fetchProfile(configuration, userId, dependencies);
  if (
    !profile || profile.id !== userId || profile.role !== "client" ||
    await hasActivePlatformAdminEntitlement(configuration, userId, dependencies)
  ) {
    return errorResponse(403, "forbidden");
  }

  // Collect and validate every owned path before deleting any object. If a
  // lookup or path contract fails, no Storage/Auth mutation is attempted.
  const pathsByBucket = await collectOwnedStoragePaths(
    configuration,
    userId,
    dependencies,
  );
  await removeExactStoragePaths(configuration, pathsByBucket, dependencies);
  await invokeRelationalCleanup(configuration, userId, dependencies);

  // This is intentionally the final side effect. Auth deletion cascades the
  // retained profile row and makes normal login impossible.
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
    dependencies.log({ level: "error", code: "client_account_deletion_failed" });
    return errorResponse(503, "deletion_retryable");
  }
}
