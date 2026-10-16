import { createClient } from 'npm:@supabase/supabase-js@2.87.0';
import { handlePublicDietitianAvatars, type AvatarPathRow } from './handler.ts';

Deno.serve((request) => handlePublicDietitianAvatars(request, {
  paths: async (dietitianIds, authorization) => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) throw new Error('auth_required');
    const { data, error } = await client.rpc('get_public_dietitian_avatar_paths', { p_dietitian_ids: dietitianIds });
    if (error || !Array.isArray(data)) throw new Error('paths_failed');
    return data as AvatarPathRow[];
  },
  sign: async (path) => {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.storage.from('avatars').createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  },
}));
