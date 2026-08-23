const SECRET_HEADER = "x-meal-photo-cleanup-secret";
const BATCH_SIZE = 50;
const BUCKET = "meal-photos";
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(
  `^meal-plans/${UUID}/${UUID}/${UUID}\\.(?:jpe?g|png|webp)$`,
);

export interface CleanupLogEvent {
  level: "info" | "warn" | "error";
  code: string;
}
export interface CleanupDependencies {
  fetch: typeof fetch;
  getEnv: (name: string) => string | undefined;
  log: (event: CleanupLogEvent) => void;
}

interface Claim {
  cleanup_id: string;
  bucket_id: typeof BUCKET;
  object_path: string;
}

const dependencies: CleanupDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  getEnv: (name) => Deno.env.get(name),
  log: (event) => console[event.level](JSON.stringify(event)),
};

const json = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

function baseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) || url.username ||
      url.password || url.pathname !== "/" || url.search || url.hash
    ) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function sameSecret(
  candidate: string,
  expected: string,
): Promise<boolean> {
  const encode = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(candidate)),
    crypto.subtle.digest("SHA-256", encode.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

const serviceHeaders = (key: string): HeadersInit => ({
  authorization: `Bearer ${key}`,
  apikey: key,
  accept: "application/json",
  "content-type": "application/json",
});

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function claims(value: unknown): Claim[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = new Set<string>();
  const paths = new Set<string>();
  const result: Claim[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !==
        "bucket_id,cleanup_id,object_path" ||
      typeof record.cleanup_id !== "string" ||
      !new RegExp(`^${UUID}$`).test(record.cleanup_id) ||
      record.bucket_id !== BUCKET ||
      typeof record.object_path !== "string" ||
      !PATH_PATTERN.test(record.object_path) ||
      ids.has(record.cleanup_id) ||
      paths.has(record.object_path)
    ) return null;
    ids.add(record.cleanup_id);
    paths.add(record.object_path);
    result.push({
      cleanup_id: record.cleanup_id,
      bucket_id: BUCKET,
      object_path: record.object_path,
    });
  }
  return result;
}

export async function handleCleanupRequest(
  request: Request,
  deps: CleanupDependencies = dependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, {
      error: { code: "method_not_allowed", retryable: false },
    }, { allow: "POST" });
  }

  const expected = deps.getEnv("MEAL_PHOTO_CLEANUP_SCHEDULER_SECRET");
  if (!expected) {
    deps.log({ level: "error", code: "scheduler_secret_unconfigured" });
    return json(503, {
      error: { code: "service_unavailable", retryable: true },
    });
  }
  if (!(await sameSecret(request.headers.get(SECRET_HEADER) ?? "", expected))) {
    deps.log({ level: "warn", code: "scheduler_auth_rejected" });
    return json(401, { error: { code: "unauthorized", retryable: false } });
  }

  const rawUrl = deps.getEnv("SUPABASE_URL");
  const key = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = rawUrl ? baseUrl(rawUrl) : null;
  if (!url || !key) {
    deps.log({ level: "error", code: "service_configuration_invalid" });
    return json(503, {
      error: { code: "service_unavailable", retryable: true },
    });
  }

  let claimResponse: Response;
  try {
    claimResponse = await deps.fetch(
      `${url}/rest/v1/rpc/claim_meal_photo_cleanup_batch`,
      {
        method: "POST",
        headers: serviceHeaders(key),
        body: JSON.stringify({ p_limit: BATCH_SIZE }),
      },
    );
  } catch {
    deps.log({ level: "warn", code: "queue_claim_failed" });
    return json(503, { error: { code: "cleanup_retryable", retryable: true } });
  }
  const batch = claimResponse.ok
    ? claims(await responseJson(claimResponse))
    : null;
  if (batch === null) {
    deps.log({ level: "warn", code: "queue_claim_failed" });
    return json(503, { error: { code: "cleanup_retryable", retryable: true } });
  }

  let completed = 0;
  let failed = 0;
  for (const claim of batch) {
    let removed = false;
    try {
      const response = await deps.fetch(
        `${url}/storage/v1/object/${encodeURIComponent(claim.bucket_id)}`,
        {
          method: "DELETE",
          headers: serviceHeaders(key),
          body: JSON.stringify({ prefixes: [claim.object_path] }),
        },
      );
      removed = response.ok;
    } catch {
      removed = false;
    }
    if (!removed) {
      failed += 1;
      deps.log({ level: "warn", code: "storage_delete_failed" });
      continue;
    }

    let marked = false;
    try {
      const response = await deps.fetch(
        `${url}/rest/v1/rpc/complete_meal_photo_cleanup`,
        {
          method: "POST",
          headers: serviceHeaders(key),
          body: JSON.stringify({ p_cleanup_id: claim.cleanup_id }),
        },
      );
      marked = response.ok && await responseJson(response) === true;
    } catch {
      marked = false;
    }
    if (!marked) {
      failed += 1;
      deps.log({ level: "warn", code: "queue_complete_failed" });
      continue;
    }
    completed += 1;
  }

  const result = { claimed: batch.length, completed, failed };
  return failed > 0
    ? json(503, { error: { code: "cleanup_partial", retryable: true }, result })
    : json(200, { result });
}
