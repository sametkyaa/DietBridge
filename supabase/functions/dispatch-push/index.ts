import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.87.0';
import { handleDispatch } from './handler.ts';

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Unavailable', { status: 503 });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('Push ledger request failed');
    return data;
  };
  return handleDispatch(request, {
    secret: Deno.env.get('PUSH_DISPATCH_SECRET') ?? '',
    accessToken: Deno.env.get('EXPO_ACCESS_TOKEN'), fetch,
    claim: kind => rpc('claim_push_dispatch', { p_kind: kind, p_limit: 25 }),
    prepare: (job, hash) => rpc('prepare_push_dispatch', { p_id: job.id, p_claim_id: job.claimId, p_token_sha256: hash }),
    finish: (job, outcome, ticket, code) => rpc('finish_push_dispatch', {
      p_id: job.id, p_claim_id: job.claimId, p_outcome: outcome, p_ticket_id: ticket ?? null, p_error_code: code ?? null,
    }),
  });
});

