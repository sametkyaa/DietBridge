import {
  CHAT_IMAGE_BUCKET,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MIME_TYPE,
  ChatImageIntent,
  ChatImageValidationMetadata,
  isCanonicalChatImagePath,
  parseAuthUserId,
  parseChatImageIntent,
  parseIntentIdRequest,
  parseSingleRow,
} from "./contracts.ts";
import { validateJpeg } from "./jpegValidator.ts";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

type ErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "not_found"
  | "intent_not_pending"
  | "intent_expired"
  | "object_not_found"
  | "invalid_image"
  | "image_too_large"
  | "image_dimensions_exceeded"
  | "validation_failed"
  | "internal_error"
  | "method_not_allowed";

export interface ValidationLogEvent {
  level: "warn" | "error";
  code: string;
}

export interface ValidateChatImageDependencies {
  fetch: typeof fetch;
  getEnv: (name: string) => string | undefined;
  log: (event: ValidationLogEvent) => void;
  now: () => number;
  validateJpeg: typeof validateJpeg;
}

interface AuthenticatedUser {
  id: string;
}

interface ServiceConfiguration {
  baseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

const defaultDependencies: ValidateChatImageDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  getEnv: (name) => Deno.env.get(name),
  log: ({ level, code }) => {
    const event = JSON.stringify({ level, code });
    if (level === "error") console.error(event);
    else console.warn(event);
  },
  now: () => Date.now(),
  validateJpeg,
};

const jsonResponse = (
  status: number,
  body: Record<string, unknown> | null,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });

const errorResponse = (status: number, code: ErrorCode): Response =>
  jsonResponse(status, {
    error: { code, retryable: status >= 500 },
  });

const normalizeBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") || url.username ||
      url.password ||
      url.pathname !== "/" || url.search || url.hash
    ) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
});

const userHeaders = (anonKey: string, token: string): HeadersInit => ({
  authorization: `Bearer ${token}`,
  apikey: anonKey,
  accept: "application/json",
});

const encodeObjectPath = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

const loadConfiguration = (
  dependencies: ValidateChatImageDependencies,
): ServiceConfiguration | null => {
  const rawBaseUrl = dependencies.getEnv("SUPABASE_URL");
  const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : null;
  return baseUrl && anonKey && serviceRoleKey
    ? { baseUrl, anonKey, serviceRoleKey }
    : null;
};

const authenticateUser = async (
  baseUrl: string,
  anonKey: string,
  token: string,
  dependencies: ValidateChatImageDependencies,
): Promise<AuthenticatedUser | null> => {
  try {
    const response = await dependencies.fetch(`${baseUrl}/auth/v1/user`, {
      headers: userHeaders(anonKey, token),
    });
    if (!response.ok) return null;
    const id = parseAuthUserId(await parseJson(response));
    return id ? { id } : null;
  } catch {
    return null;
  }
};

const fetchIntent = async (
  configuration: ServiceConfiguration,
  intentId: string,
  dependencies: ValidateChatImageDependencies,
): Promise<ChatImageIntent | null> => {
  const query = new URLSearchParams({
    select:
      "id,conversation_id,created_by,bucket_id,object_path,expected_mime,max_bytes,status,expires_at,validated_mime,validated_byte_size,validated_width,validated_height,validated_at",
    id: `eq.${intentId}`,
    limit: "1",
  });
  try {
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/rest/v1/chat_upload_intents?${query.toString()}`,
      { headers: serviceHeaders(configuration.serviceRoleKey) },
    );
    if (!response.ok) return null;
    const rows = await parseJson(response);
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    return parseChatImageIntent(rows[0]);
  } catch {
    return null;
  }
};

/** Matches create_chat_image_upload_intent's active relationship predicate exactly. */
const hasActiveConversationRelationship = async (
  configuration: ServiceConfiguration,
  intent: ChatImageIntent,
  userId: string,
  dependencies: ValidateChatImageDependencies,
): Promise<boolean> => {
  const query = new URLSearchParams({
    select: "id,dietitian_id,client_id,dietitian_clients!inner(status)",
    id: `eq.${intent.conversationId}`,
    "dietitian_clients.status": "eq.active",
    or: `(dietitian_id.eq.${userId},client_id.eq.${userId})`,
    limit: "1",
  });
  try {
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/rest/v1/chat_conversations?${query.toString()}`,
      { headers: serviceHeaders(configuration.serviceRoleKey) },
    );
    if (!response.ok) return false;
    const rows = await parseJson(response);
    if (!Array.isArray(rows) || rows.length !== 1) return false;
    const row = parseSingleRow(rows);
    const relation = row?.dietitian_clients;
    return row?.id === intent.conversationId &&
      (row.dietitian_id === userId || row.client_id === userId) &&
      typeof relation === "object" &&
      relation !== null &&
      !Array.isArray(relation) &&
      (relation as Record<string, unknown>).status === "active";
  } catch {
    return false;
  }
};

const readBoundedResponseBody = async (
  response: Response,
): Promise<Uint8Array | null> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (
      !/^\d+$/.test(contentLength) ||
      Number(contentLength) > CHAT_IMAGE_MAX_BYTES
    ) return null;
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || total + value.byteLength > CHAT_IMAGE_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const downloadExactObject = async (
  configuration: ServiceConfiguration,
  intent: ChatImageIntent,
  dependencies: ValidateChatImageDependencies,
): Promise<
  | { kind: "found"; bytes: Uint8Array; contentType: string | null }
  | { kind: "missing" }
  | { kind: "too_large" }
  | { kind: "failed" }
> => {
  try {
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/storage/v1/object/${
        encodeURIComponent(intent.bucketId)
      }/${encodeObjectPath(intent.objectPath)}`,
      { headers: serviceHeaders(configuration.serviceRoleKey) },
    );
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failed" };
    const bytes = await readBoundedResponseBody(response);
    if (bytes === null) return { kind: "too_large" };
    return {
      kind: "found",
      bytes,
      contentType: response.headers.get("content-type"),
    };
  } catch {
    return { kind: "failed" };
  }
};

const recordValidation = async (
  configuration: ServiceConfiguration,
  intentId: string,
  metadata: Pick<ChatImageValidationMetadata, "byteSize" | "width" | "height">,
  dependencies: ValidateChatImageDependencies,
): Promise<ChatImageValidationMetadata | null> => {
  try {
    const response = await dependencies.fetch(
      `${configuration.baseUrl}/rest/v1/rpc/record_chat_image_validation`,
      {
        method: "POST",
        headers: {
          ...serviceHeaders(configuration.serviceRoleKey),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_intent_id: intentId,
          p_validated_mime: CHAT_IMAGE_MIME_TYPE,
          p_validated_byte_size: metadata.byteSize,
          p_validated_width: metadata.width,
          p_validated_height: metadata.height,
        }),
      },
    );
    if (!response.ok) return null;
    const row = parseSingleRow(await parseJson(response));
    const recorded = row ? parseChatImageIntent(row) : null;
    return recorded?.id === intentId ? recorded.validation : null;
  } catch {
    return null;
  }
};

const isJpegContentType = (value: string | null): boolean => (
  typeof value === "string" &&
  value.split(";", 1)[0].trim().toLowerCase() === CHAT_IMAGE_MIME_TYPE
);

const responseMetadata = (
  metadata: ChatImageValidationMetadata,
  idempotent: boolean,
): Response =>
  jsonResponse(200, {
    data: {
      mimeType: metadata.mimeType,
      byteSize: metadata.byteSize,
      width: metadata.width,
      height: metadata.height,
      validatedAt: metadata.validatedAt,
      idempotent,
    },
  });

async function handleRequest(
  request: Request,
  dependencies: ValidateChatImageDependencies,
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
    return errorResponse(503, "internal_error");
  }

  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "unauthorized");
  const user = await authenticateUser(
    configuration.baseUrl,
    configuration.anonKey,
    token,
    dependencies,
  );
  if (!user) return errorResponse(401, "unauthorized");

  const intentId = parseIntentIdRequest(await request.text());
  if (!intentId) return errorResponse(400, "invalid_request");

  const intent = await fetchIntent(configuration, intentId, dependencies);
  // Missing, malformed, or someone else's intent deliberately share one response.
  if (!intent || intent.createdBy !== user.id) {
    return errorResponse(404, "not_found");
  }

  const activeRelationship = await hasActiveConversationRelationship(
    configuration,
    intent,
    user.id,
    dependencies,
  );
  if (!activeRelationship) return errorResponse(404, "not_found");
  if (intent.status !== "pending") {
    return errorResponse(409, "intent_not_pending");
  }
  if (Date.parse(intent.expiresAt) <= dependencies.now()) {
    return errorResponse(409, "intent_expired");
  }
  if (
    intent.bucketId !== CHAT_IMAGE_BUCKET ||
    intent.expectedMime !== CHAT_IMAGE_MIME_TYPE ||
    !isCanonicalChatImagePath(intent.objectPath)
  ) return errorResponse(422, "validation_failed");
  if (intent.validation) return responseMetadata(intent.validation, true);

  const object = await downloadExactObject(configuration, intent, dependencies);
  if (object.kind === "missing") return errorResponse(404, "object_not_found");
  if (object.kind === "too_large") return errorResponse(422, "image_too_large");
  if (object.kind === "failed") return errorResponse(422, "validation_failed");
  if (!isJpegContentType(object.contentType)) {
    return errorResponse(422, "invalid_image");
  }

  const result = dependencies.validateJpeg(object.bytes);
  if (!result.ok) return errorResponse(422, result.code);

  const recorded = await recordValidation(
    configuration,
    intent.id,
    result,
    dependencies,
  );
  if (!recorded) return errorResponse(422, "validation_failed");
  return responseMetadata(recorded, false);
}

export async function handleValidateChatImageRequest(
  request: Request,
  dependencies: ValidateChatImageDependencies = defaultDependencies,
): Promise<Response> {
  try {
    return await handleRequest(request, dependencies);
  } catch {
    dependencies.log({ level: "error", code: "validate_chat_image_unhandled" });
    return errorResponse(500, "internal_error");
  }
}
