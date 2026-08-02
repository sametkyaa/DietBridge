const CLEANUP_SECRET_HEADER = "x-chat-image-cleanup-secret";
const CLEANUP_BATCH_SIZE = 50;
const CHAT_IMAGE_BUCKET = "chat-images";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBJECT_PATH_PATTERN =
  /^pending\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

type LogLevel = "info" | "warn" | "error";

export interface CleanupLogEvent {
  level: LogLevel;
  code: string;
}

export interface CleanupDependencies {
  fetch: typeof fetch;
  getEnv: (name: string) => string | undefined;
  log: (event: CleanupLogEvent) => void;
}

interface CleanupClaim {
  cleanup_id: string;
  bucket_id: typeof CHAT_IMAGE_BUCKET;
  object_path: string;
}

interface CleanupResult {
  claimed: number;
  completed: number;
  failed: number;
}

const defaultDependencies: CleanupDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  getEnv: (name) => Deno.env.get(name),
  log: ({ level, code }) => {
    const record = JSON.stringify({ level, code });
    if (level === "error") {
      console.error(record);
    } else if (level === "warn") {
      console.warn(record);
    } else {
      console.info(record);
    }
  },
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function secretMatches(
  candidate: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [candidateDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function serviceHeaders(serviceRoleKey: string): HeadersInit {
  return {
    authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    accept: "application/json",
    "content-type": "application/json",
  };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseClaims(value: unknown): CleanupClaim[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;

  const cleanupIds = new Set<string>();
  const objectKeys = new Set<string>();
  const claims: CleanupClaim[] = [];

  for (const candidate of value) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) return null;

    const keys = Object.keys(candidate);
    if (
      keys.length !== 3 ||
      !keys.includes("cleanup_id") ||
      !keys.includes("bucket_id") ||
      !keys.includes("object_path")
    ) return null;

    const record = candidate as Record<string, unknown>;
    if (
      typeof record.cleanup_id !== "string" ||
      !UUID_PATTERN.test(record.cleanup_id) ||
      record.bucket_id !== CHAT_IMAGE_BUCKET ||
      typeof record.object_path !== "string" ||
      !OBJECT_PATH_PATTERN.test(record.object_path)
    ) return null;

    const objectKey = `${record.bucket_id}\n${record.object_path}`;
    if (cleanupIds.has(record.cleanup_id) || objectKeys.has(objectKey)) {
      return null;
    }

    cleanupIds.add(record.cleanup_id);
    objectKeys.add(objectKey);
    claims.push({
      cleanup_id: record.cleanup_id,
      bucket_id: CHAT_IMAGE_BUCKET,
      object_path: record.object_path,
    });
  }

  return claims;
}

async function claimBatch(
  baseUrl: string,
  serviceRoleKey: string,
  dependencies: CleanupDependencies,
): Promise<CleanupClaim[] | null> {
  let response: Response;
  try {
    response = await dependencies.fetch(
      `${baseUrl}/rest/v1/rpc/claim_chat_image_cleanup_batch`,
      {
        method: "POST",
        headers: serviceHeaders(serviceRoleKey),
        body: JSON.stringify({ p_limit: CLEANUP_BATCH_SIZE }),
      },
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;
  return parseClaims(await parseJson(response));
}

async function deleteExactObject(
  baseUrl: string,
  serviceRoleKey: string,
  claim: CleanupClaim,
  dependencies: CleanupDependencies,
): Promise<boolean> {
  let response: Response;
  try {
    response = await dependencies.fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(claim.bucket_id)}`,
      {
        method: "DELETE",
        headers: serviceHeaders(serviceRoleKey),
        body: JSON.stringify({ prefixes: [claim.object_path] }),
      },
    );
  } catch {
    return false;
  }

  // Storage remove is idempotent and returns success with an empty result when
  // the exact object is already absent. Other statuses remain retryable.
  return response.ok;
}

async function completeClaim(
  baseUrl: string,
  serviceRoleKey: string,
  cleanupId: string,
  dependencies: CleanupDependencies,
): Promise<boolean> {
  let response: Response;
  try {
    response = await dependencies.fetch(
      `${baseUrl}/rest/v1/rpc/complete_chat_image_cleanup`,
      {
        method: "POST",
        headers: serviceHeaders(serviceRoleKey),
        body: JSON.stringify({ p_cleanup_id: cleanupId }),
      },
    );
  } catch {
    return false;
  }

  if (!response.ok) return false;
  return (await parseJson(response)) === true;
}

async function processClaims(
  claims: CleanupClaim[],
  baseUrl: string,
  serviceRoleKey: string,
  dependencies: CleanupDependencies,
): Promise<CleanupResult> {
  let completed = 0;
  let failed = 0;

  for (const claim of claims) {
    const deleted = await deleteExactObject(
      baseUrl,
      serviceRoleKey,
      claim,
      dependencies,
    );
    if (!deleted) {
      failed += 1;
      dependencies.log({ level: "warn", code: "storage_delete_failed" });
      continue;
    }

    const markedComplete = await completeClaim(
      baseUrl,
      serviceRoleKey,
      claim.cleanup_id,
      dependencies,
    );
    if (!markedComplete) {
      failed += 1;
      dependencies.log({ level: "warn", code: "queue_complete_failed" });
      continue;
    }

    completed += 1;
  }

  return { claimed: claims.length, completed, failed };
}

export async function handleCleanupRequest(
  request: Request,
  dependencies: CleanupDependencies = defaultDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(
      405,
      { error: { code: "method_not_allowed", retryable: false } },
      { allow: "POST" },
    );
  }

  const schedulerSecret = dependencies.getEnv(
    "CHAT_IMAGE_CLEANUP_SCHEDULER_SECRET",
  );
  if (!schedulerSecret) {
    dependencies.log({ level: "error", code: "scheduler_secret_unconfigured" });
    return jsonResponse(503, {
      error: { code: "service_unavailable", retryable: true },
    });
  }

  const candidateSecret = request.headers.get(CLEANUP_SECRET_HEADER) ?? "";
  if (!(await secretMatches(candidateSecret, schedulerSecret))) {
    dependencies.log({ level: "warn", code: "scheduler_auth_rejected" });
    return jsonResponse(401, {
      error: { code: "unauthorized", retryable: false },
    });
  }

  const rawBaseUrl = dependencies.getEnv("SUPABASE_URL");
  const serviceRoleKey = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : null;
  if (!baseUrl || !serviceRoleKey) {
    dependencies.log({ level: "error", code: "service_configuration_invalid" });
    return jsonResponse(503, {
      error: { code: "service_unavailable", retryable: true },
    });
  }

  const claims = await claimBatch(baseUrl, serviceRoleKey, dependencies);
  if (claims === null) {
    dependencies.log({ level: "warn", code: "queue_claim_failed" });
    return jsonResponse(503, {
      error: { code: "cleanup_retryable", retryable: true },
    });
  }

  const result = await processClaims(
    claims,
    baseUrl,
    serviceRoleKey,
    dependencies,
  );
  if (result.failed > 0) {
    return jsonResponse(503, {
      error: { code: "cleanup_partial", retryable: true },
      result,
    });
  }

  return jsonResponse(200, { result });
}
