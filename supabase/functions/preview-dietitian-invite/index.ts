import { createClient } from 'npm:@supabase/supabase-js@2.87.0';
import { handleInvitePreview, type InvitePreview } from './handler.ts';

Deno.serve((request) => handleInvitePreview(request, {
  preview: async (code, authorization) => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) throw new Error('auth_required');
    const { data, error } = await client.rpc('preview_dietitian_invite_code', { p_code: code });
    if (error || !data) throw new Error('preview_failed');
    return data as InvitePreview;
  },
  avatar: async (dietitianId) => {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.from('profiles').select('avatar_url').eq('id', dietitianId).single();
    if (error) throw new Error('avatar_failed');
    const path = data.avatar_url;
    if (typeof path !== 'string' || !new RegExp(`^${dietitianId}/avatar\\.(jpe?g|png|webp)$`, 'i').test(path)) return null;
    const { data: signed, error: signError } = await admin.storage.from('avatars').createSignedUrl(path, 120);
    if (signError || !signed?.signedUrl) throw new Error('avatar_failed');
    return signed.signedUrl;
  },
}));
