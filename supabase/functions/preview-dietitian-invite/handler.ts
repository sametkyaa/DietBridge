export interface InvitePreview {
  result: string;
  dietitian?: { id: string; display_name: string | null; professional_title: string; avatar_url: string | null };
}
export interface InvitePreviewDependencies {
  preview: (code: string, authorization: string) => Promise<InvitePreview>;
  avatar: (dietitianId: string) => Promise<string | null>;
}
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
  'content-type': 'application/json',
};
export async function handleInvitePreview(request: Request, dependencies: InvitePreviewDependencies): Promise<Response> {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ result: 'error' }, 405);
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/i.test(authorization)) return json({ result: 'error' }, 401);
  try {
    if (!request.body) return json({ result: 'error' }, 400);
    const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();return json({result:'error'},413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body=new TextDecoder().decode(bytes);
    const { code } = JSON.parse(body);
    if (typeof code !== 'string' || code.length > 64) return json({ result: 'error' }, 400);
    const result = await dependencies.preview(code, authorization);
    if (result.result !== 'ready') {
      if (!['not_found', 'closed', 'rate_limited'].includes(result.result)) throw new Error('invalid_response');
      return json({ result: result.result });
    }
    const profile = result.dietitian;
    if (!profile || !/^[0-9a-f-]{36}$/i.test(profile.id)) throw new Error('invalid_response');
    // Optional photo failures never expose a path or backend error. The profile
    // fallback remains visible; only the verified RPC result can be signed.
    const avatarUrl = await dependencies.avatar(profile.id).catch(() => null);
    return json({ result: 'ready', dietitian: {
      id: profile.id, display_name: profile.display_name,
      professional_title: profile.professional_title, avatar_url: avatarUrl,
    } });
  } catch {
    return json({ result: 'error' }, 400);
  }
}
