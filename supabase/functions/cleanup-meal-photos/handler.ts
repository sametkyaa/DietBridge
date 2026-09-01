const SECRET_HEADER = "x-meal-photo-cleanup-secret";
const BATCH_SIZE = 50;
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);

interface QueueDefinition {
  claimRpc: string;
  completeRpc: string;
  bucket: string;
  pathPattern: RegExp;
}

const QUEUES: readonly QueueDefinition[] = [
  {
    claimRpc: "claim_meal_photo_cleanup_batch",
    completeRpc: "complete_meal_photo_cleanup",
    bucket: "meal-photos",
    pathPattern: new RegExp(
      `^meal-plans/${UUID}/${UUID}/${UUID}\\.(?:jpe?g|png|webp)$`,
    ),
  },
  {
    claimRpc: "claim_meal_completion_photo_cleanup_batch",
    completeRpc: "complete_meal_completion_photo_cleanup",
    bucket: "meal-completion-photos",
    pathPattern: new RegExp(`^${UUID}/${UUID}/${UUID}\\.jpg$`),
  },
];

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
  bucket_id: string;
  object_path: string;
}

interface QueueRun {
  claims: Claim[];
  claimFailed: boolean;
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

function claims(
  value: unknown,
  queue: QueueDefinition,
  seenCleanupIds: ReadonlySet<string>,
  seenObjectPaths: ReadonlySet<string>,
): Claim[] | null {
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
      !UUID_PATTERN.test(record.cleanup_id) ||
      seenCleanupIds.has(record.cleanup_id) ||
      ids.has(record.cleanup_id) ||
      record.bucket_id !== queue.bucket ||
      typeof record.object_path !== "string" ||
      !queue.pathPattern.test(record.object_path) ||
      seenObjectPaths.has(record.object_path) ||
      paths.has(record.object_path)
    ) return null;
    ids.add(record.cleanup_id);
    paths.add(record.object_path);
    result.push({
      cleanup_id: record.cleanup_id,
      bucket_id: queue.bucket,
      object_path: record.object_path,
    });
  }
  return result;
}

async function claimQueue(
  url: string,
  key: string,
  queue: QueueDefinition,
  deps: CleanupDependencies,
  seenCleanupIds: Set<string>,
  seenObjectPaths: Set<string>,
): Promise<QueueRun> {
  let claimResponse: Response;
  try {
    claimResponse = await deps.fetch(
      `${url}/rest/v1/rpc/${queue.claimRpc}`,
      {
        method: "POST",
        headers: serviceHeaders(key),
        body: JSON.stringify({ p_limit: BATCH_SIZE }),
      },
    );
  } catch {
    deps.log({ level: "warn", code: "queue_claim_failed" });
    return { claims: [], claimFailed: true };
  }

  const batch = claimResponse.ok
    ? claims(await responseJson(claimResponse), queue, seenCleanupIds, seenObjectPaths)
    : null;
  if (batch === null) {
    deps.log({ level: "warn", code: "queue_claim_failed" });
    return { claims: [], claimFailed: true };
  }

  batch.forEach((claim) => {
    seenCleanupIds.add(claim.cleanup_id);
    seenObjectPaths.add(claim.object_path);
  });
  return { claims: batch, claimFailed: false };
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

  let completed = 0;
  let failed = 0;
  let claimed = 0;
  let claimFailed = false;
  const seenCleanupIds = new Set<string>();
  const seenObjectPaths = new Set<string>();

  for (const queue of QUEUES) {
    const run = await claimQueue(
      url,
      key,
      queue,
      deps,
      seenCleanupIds,
      seenObjectPaths,
    );
    claimFailed ||= run.claimFailed;
    claimed += run.claims.length;

    for (const claim of run.claims) {
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
          `${url}/rest/v1/rpc/${queue.completeRpc}`,
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
  }

  // Preserve the existing claim-failure response shape while still allowing
  // the healthy queue to be processed in the same scheduled invocation.
  if (claimFailed) {
    return json(503, { error: { code: "cleanup_retryable", retryable: true } });
  }

  const result = { claimed, completed, failed };
  return failed > 0
    ? json(503, { error: { code: "cleanup_partial", retryable: true }, result })
    : json(200, { result });
}
