export interface AvatarPathRow { id: string; avatar_path: string | null }
export interface PublicAvatarDependencies {
  // Runs get_public_dietitian_avatar_paths with the caller's JWT, so only
  // dietitians the client may see are returned.
  paths: (dietitianIds: string[], authorization: string) => Promise<AvatarPathRow[]>;
  sign: (path: string) => Promise<string | null>;
}
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
  'content-type': 'application/json',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDS = 50;
export async function handlePublicDietitianAvatars(request: Request, dependencies: PublicAvatarDependencies): Promise<Response> {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ result: 'error' }, 405);
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/i.test(authorization)) return json({ result: 'error' }, 401);
  try {
    if (!request.body) return json({ result: 'error' }, 400);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); return json({ result: 'error' }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const { dietitianIds } = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(dietitianIds) || dietitianIds.length > MAX_IDS || !dietitianIds.every((id) => typeof id === 'string' && UUID.test(id))) {
      return json({ result: 'error' }, 400);
    }
    const unique = [...new Set(dietitianIds.map((id: string) => id.toLowerCase()))];
    if (unique.length === 0) return json({ result: 'ready', avatars: {} });
    const rows = await dependencies.paths(unique, authorization);
    const avatars: Record<string, string> = {};
    await Promise.all(rows.map(async (row) => {
      const id = String(row?.id || '').toLowerCase();
      // Only rows the RPC returned, for requested ids, with the canonical
      // owner-scoped avatar path are signed. Failures drop to initials.
      if (!unique.includes(id) || typeof row.avatar_path !== 'string') return;
      if (!new RegExp(`^${id}/avatar\\.(jpe?g|png|webp)$`, 'i').test(row.avatar_path)) return;
      const url = await dependencies.sign(row.avatar_path).catch(() => null);
      if (url) avatars[id] = url;
    }));
    return json({ result: 'ready', avatars });
  } catch {
    return json({ result: 'error' }, 400);
  }
}
