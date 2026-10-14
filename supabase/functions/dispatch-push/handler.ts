type Job = { id: string; claimId: string; notificationId?: string; category?: string; token?: string; ticketId?: string; appVersion?: string; conversationId?: string };
type Result = { status?: string; id?: string; details?: { error?: string } };
type Outcome = 'ticketed' | 'receipt_ok' | 'retryable' | 'permanent' | 'missing';
export type Dependencies = {
  secret: string;
  accessToken?: string;
  claim: (kind: 'send' | 'receipt') => Promise<Job[]>;
  prepare: (job: Job, hash: string) => Promise<boolean>;
  finish: (job: Job, outcome: Outcome, ticket?: string, code?: string) => Promise<boolean>;
  fetch: typeof fetch;
};
const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
async function sameSecret(actual: string, expected: string) {
  const a = await digest(actual), b = await digest(expected);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodies: Record<string, string> = {
  chat_message: 'Yeni bir mesajınız var.',
  appointment: 'Randevunuzla ilgili yeni bir bildirim var.',
  relationship: 'Bağlantınızla ilgili yeni bir bildirim var.',
};
function validJob(job: Job, kind: string) {
  return uuid.test(job.id) && uuid.test(job.claimId) && (kind === 'receipt'
    ? typeof job.ticketId === 'string' && job.ticketId.length > 0 && job.ticketId.length <= 160
    : uuid.test(job.notificationId ?? '') && Object.hasOwn(bodies, job.category ?? '') && /^Expo(nent)?PushToken\[[^\s\]]+\]$/.test(job.token ?? '') && (job.token?.length ?? 513) <= 512);
}
function errorCode(result: Result) {
  const code = result.details?.error;
  return ['DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded', 'InvalidCredentials', 'MismatchSenderId'].includes(code ?? '') ? code : 'provider_error';
}
function supportsChatChannel(version?: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 1 || major === 1 && (minor > 0 || patch >= 4);
}
export async function handleDispatch(request: Request, deps: Dependencies): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (deps.secret.length < 32) return json({ error: 'not_configured' }, 503);
  const supplied = request.headers.get('x-dispatch-secret') ?? '';
  if (supplied.length > 512 || !await sameSecret(supplied, deps.secret)) return json({ error: 'unauthorized' }, 401);
  try {
    let completed = 0;
    const finish = async (job: Job, outcome: Outcome, ticket?: string, code?: string) => {
      if (!await deps.finish(job, outcome, ticket, code)) throw new Error('ledger_update_failed');
      completed++;
    };
    for (const kind of ['receipt', 'send'] as const) {
      const claimed = await deps.claim(kind);
      if (!Array.isArray(claimed) || claimed.length > 25) throw new Error('invalid_claim');
      const jobs: Job[] = [];
      for (const job of claimed) {
        if (!validJob(job, kind)) throw new Error('invalid_claim');
        if (kind === 'receipt' || await deps.prepare(job, await digest(job.token!))) jobs.push(job);
      }
      if (jobs.length === 0) continue;
      let response: Response;
      try {
        response = await deps.fetch(`https://exp.host/--/api/v2/push/${kind === 'send' ? 'send' : 'getReceipts'}`, {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/json', ...(deps.accessToken ? { Authorization: `Bearer ${deps.accessToken}` } : {}) },
          body: JSON.stringify(kind === 'receipt' ? { ids: jobs.map(job => job.ticketId) } : jobs.map(job => ({
            to: job.token, title: 'DietBridge', body: bodies[job.category!],
            data: { notificationId: job.notificationId, version: 1, category: job.category,
              ...(job.category === 'chat_message' && uuid.test(job.conversationId ?? '') ? { conversationId: job.conversationId } : {}) },
            channelId: job.category === 'appointment' ? 'dietbridge-appointments'
              : job.category === 'chat_message' && supportsChatChannel(job.appVersion) ? 'dietbridge-chat-v1' : 'dietbridge-silent',
            ...(job.category === 'chat_message' ? { priority: 'high' } : {}),
            ...(job.category === 'appointment' || job.category === 'chat_message' && supportsChatChannel(job.appVersion) ? { sound: 'default' } : {}), ttl: 3600,
          }))),
        });
      } catch {
        // Unknown send outcome must not cause duplicate messages. Receipt lookup
        // is read-only and can safely be repeated without sending again.
        for (const job of jobs) await finish(job, kind === 'send' ? 'permanent' : 'missing', undefined, kind === 'send' ? 'ambiguous_delivery' : undefined);
        continue;
      }
      if (!response.ok) {
        const retry = response.status === 429 || response.status >= 500;
        for (const job of jobs) await finish(job, kind === 'receipt' && retry ? 'missing' : retry ? 'retryable' : 'permanent', undefined, retry ? 'provider_retry' : 'provider_error');
        continue;
      }
      let payload: { data?: unknown };
      try { payload = await response.json(); } catch { payload = {}; }
      const data = payload?.data;
      const valid = kind === 'send' ? Array.isArray(data) && data.length === jobs.length
        : data !== null && typeof data === 'object' && !Array.isArray(data);
      for (let index = 0; index < jobs.length; index++) {
        const job = jobs[index];
        if (!valid) {
          await finish(job, kind === 'send' ? 'permanent' : 'missing', undefined, 'invalid_provider_response'); continue;
        }
        const result = (kind === 'send' ? (data as Result[])[index] : (data as Record<string, Result>)[job.ticketId!]);
        if (!result && kind === 'receipt') { await finish(job, 'missing'); continue; }
        if (result?.status === 'ok' && (kind === 'receipt' || typeof result.id === 'string' && result.id.length > 0 && result.id.length <= 160)) {
          await finish(job, kind === 'send' ? 'ticketed' : 'receipt_ok', kind === 'send' ? result.id : undefined);
        } else if (result?.status === 'error') {
          const code = errorCode(result);
          await finish(job, code === 'MessageRateExceeded' ? 'retryable' : 'permanent', undefined, code);
        } else await finish(job, kind === 'send' ? 'permanent' : 'missing', undefined, 'invalid_provider_response');
      }
    }
    return json({ completed });
  } catch {
    // No provider response, token, message body or database error is logged.
    return json({ error: 'dispatch_failed' }, 503);
  }
}

