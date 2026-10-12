import { MEDIA_TYPES, validateMediaBytes } from './mediaValidator.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATH = /^pending\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm|pdf|docx|xlsx|txt|csv)$/;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-chat-media-intent-id', 'access-control-allow-methods': 'POST, OPTIONS' };
export interface MediaDependencies { fetch: typeof fetch; getEnv: (name: string) => string | undefined; now: () => number; }
const defaults: MediaDependencies = { fetch: globalThis.fetch.bind(globalThis), getEnv: (name) => Deno.env.get(name), now: Date.now };
const response = (status: number, code: string) => new Response(JSON.stringify(status === 200 ? { data: { validated: true } } : { error: { code, retryable: status >= 500 } }),
  { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const boundedBytes = async (body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> => {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length;
      if (size > max) { await reader.cancel(); return null; } chunks.push(next.value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
};
export const handleValidateChatMediaRequest = async (request: Request, deps: MediaDependencies = defaults): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return response(405, 'method_not_allowed');
  try {
    const rawBase = deps.getEnv('SUPABASE_URL'); const anon = deps.getEnv('SUPABASE_ANON_KEY'); const secret = deps.getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!rawBase || !anon || !secret) return response(503, 'service_unavailable');
    const baseUrl = new URL(rawBase);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.pathname !== '/' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) return response(503, 'service_unavailable');
    const base = baseUrl.origin;
    const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) return response(401, 'unauthorized');
    const caller = { authorization: `Bearer ${token}`, apikey: anon, 'content-type': 'application/json' };
    const admin = { authorization: `Bearer ${secret}`, apikey: secret, 'content-type': 'application/json' };
    const authResponse = await deps.fetch(`${base}/auth/v1/user`, { headers: caller });
    if (!authResponse.ok) return response(401, 'unauthorized');
    const user = await authResponse.json();
    if (!UUID.test(user?.id || '')) return response(401, 'unauthorized');
    const uploadId = request.headers.get('x-chat-media-intent-id');
    let body;
    if (uploadId !== null) body = { intentId: uploadId };
    else {
      const payload = await boundedBytes(request.body, 1024);
      if (!payload) return response(400, 'invalid_request');
      try { body = JSON.parse(new TextDecoder().decode(payload)); } catch { return response(400, 'invalid_request'); }
    }
    if (!body || Object.keys(body).length !== 1 || !UUID.test(body.intentId || '')) return response(400, 'invalid_request');
    const capabilities = await deps.fetch(`${base}/rest/v1/rpc/get_chat_media_capabilities`, { method: 'POST', headers: caller, body: '{}' });
    if (!capabilities.ok || (await capabilities.json())?.enabled !== true) return response(404, 'not_found');
    const consent = await deps.fetch(`${base}/rest/v1/rpc/can_process_my_chat_image`, { method: 'POST', headers: caller, body: JSON.stringify({ p_intent_id: body.intentId }) });
    if (!consent.ok || await consent.json() !== true) return response(404, 'not_found');
    const query = new URLSearchParams({ select: 'id,conversation_id,created_by,bucket_id,object_path,expected_mime,max_bytes,declared_byte_size,status,expires_at,validated_at', id: `eq.${body.intentId}`, limit: '1' });
    const intentResponse = await deps.fetch(`${base}/rest/v1/chat_upload_intents?${query}`, { headers: caller });
    if (!intentResponse.ok) return response(404, 'not_found');
    const intents = await intentResponse.json();
    if (!Array.isArray(intents) || intents.length !== 1) return response(404, 'not_found');
    const intent = intents[0]; const policy = MEDIA_TYPES[intent.expected_mime];
    if (intent.id !== body.intentId || intent.created_by !== user.id || !UUID.test(intent.conversation_id || '') || intent.bucket_id !== 'chat-media'
      || !PATH.test(intent.object_path || '') || !policy || !intent.object_path.endsWith(`.${policy.extension}`) || intent.max_bytes !== policy.maxBytes
      || !Number.isSafeInteger(intent.declared_byte_size) || intent.declared_byte_size < 1 || intent.declared_byte_size > policy.maxBytes) return response(404, 'not_found');
    const relationQuery = new URLSearchParams({ select: 'id,dietitian_id,client_id,dietitian_clients!inner(status)', id: `eq.${intent.conversation_id}`, 'dietitian_clients.status': 'eq.active', limit: '1' });
    const relationResponse = await deps.fetch(`${base}/rest/v1/chat_conversations?${relationQuery}`, { headers: caller });
    if (!relationResponse.ok) return response(404, 'not_found');
    const relations = await relationResponse.json();
    if (!Array.isArray(relations) || relations.length !== 1 || ![relations[0].client_id, relations[0].dietitian_id].includes(user.id)
      || relations[0].dietitian_clients?.status !== 'active') return response(404, 'not_found');
    const expiry = Date.parse(intent.expires_at);
    if (intent.status !== 'pending' || !Number.isFinite(expiry) || expiry <= deps.now()) return response(409, 'intent_expired');
    if (intent.validated_at) { await request.body?.cancel(); return response(200, 'validated'); }
    if (uploadId !== null) {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== intent.expected_mime) return response(422, 'invalid_type');
      const incoming = await boundedBytes(request.body, intent.declared_byte_size);
      if (!incoming || incoming.length !== intent.declared_byte_size || !validateMediaBytes(incoming, intent.expected_mime)) return response(422, 'invalid_media');
      // Only this broker writes objects. Authenticate and validate the complete
      // bounded body first; a caller cannot under-declare size to evade quotas.
      const uploaded = await deps.fetch(`${base}/storage/v1/object/chat-media/${intent.object_path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST', headers: { ...admin, 'content-type': intent.expected_mime, 'x-upsert': 'false', 'cache-control': 'no-store' },
        body: new Uint8Array(incoming).buffer,
      });
      if (!uploaded.ok) {
        const failure = await uploaded.json().catch(() => ({}));
        if (uploaded.status !== 409 && String(failure?.statusCode) !== '409' && failure?.error !== 'Duplicate') return response(422, 'upload_failed');
      }
    }
    // Re-read the persisted object (including retry/conflict cases) before
    // recording validation. Caller headers are never validation evidence.
    const object = await deps.fetch(`${base}/storage/v1/object/chat-media/${intent.object_path.split('/').map(encodeURIComponent).join('/')}`, { headers: admin });
    if (!object.ok) return response(422, 'validation_failed');
    const length = object.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== intent.declared_byte_size)) { await object.body?.cancel(); return response(422, 'invalid_size'); }
    if (object.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== intent.expected_mime) { await object.body?.cancel(); return response(422, 'invalid_type'); }
    const bytes = await boundedBytes(object.body, intent.declared_byte_size);
    if (!bytes || bytes.length !== intent.declared_byte_size || !validateMediaBytes(bytes, intent.expected_mime)) return response(422, 'invalid_media');
    const recorded = await deps.fetch(`${base}/rest/v1/rpc/record_chat_media_validation`, { method: 'POST', headers: admin,
      body: JSON.stringify({ p_intent_id: intent.id, p_mime: intent.expected_mime, p_byte_size: bytes.length }) });
    if (!recorded.ok || await recorded.json() !== true) return response(422, 'validation_failed');
    return response(200, 'validated');
  } catch { return response(500, 'internal_error'); }
};
