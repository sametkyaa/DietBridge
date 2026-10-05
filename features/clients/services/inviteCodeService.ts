import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { normalizeInviteCode } from '../utils/inviteCode';

export interface DietitianInviteCode { code: string; isOpen: boolean; rotatedAt: string | null }
const ERROR = 'Davet kodu işlemi tamamlanamadı. Lütfen tekrar deneyin.';
async function callInviteRpc(name: 'get_my_invite_code' | 'rotate_my_invite_code' | 'set_my_invite_code_open', args?: { p_is_open: boolean }): Promise<DietitianInviteCode> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) throw new Error(ERROR);
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) throw new Error(ERROR);
  const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${token}`);
  if (error || !data || !isValidUuid(data.dietitian_id) || data.dietitian_id !== auth.user.id
    || !normalizeInviteCode(data.code) || typeof data.is_open !== 'boolean'
    || (data.rotated_at !== null && typeof data.rotated_at !== 'string')) throw new Error(ERROR);
  return { code: data.code, isOpen: data.is_open, rotatedAt: data.rotated_at };
}
export const getMyInviteCode = () => callInviteRpc('get_my_invite_code');
export const rotateMyInviteCode = () => callInviteRpc('rotate_my_invite_code');
export const setMyInviteCodeOpen = (isOpen: boolean) => callInviteRpc('set_my_invite_code_open', { p_is_open: isOpen });
