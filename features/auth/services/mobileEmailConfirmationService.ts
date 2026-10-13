import { createClient } from '@supabase/supabase-js';
import { env } from '../../../lib/env';
import type { MobileEmailCallback } from '../utils/mobileEmailConfirmation';

export type MobileEmailConfirmationResult = { status: 'success' | 'expired' | 'invalid' | 'error' };

type VerificationUser = { email_confirmed_at?: string };
type UserLookup = (token: string) => Promise<{
  data: { user: VerificationUser | null };
  error: { code?: string; status?: number } | null;
}>;

export const verifyMobileEmailCallback = async (
  callback: MobileEmailCallback,
  getUser: UserLookup,
): Promise<MobileEmailConfirmationResult> => {
  if (callback.status !== 'ready') return { status: callback.status };
  try {
    const { data, error } = await getUser(callback.accessToken);
    if (error) {
      return { status: error.status === 401 || error.status === 403
        || error.code === 'bad_jwt' || error.code === 'session_not_found' ? 'invalid' : 'error' };
    }
    if (!data.user?.email_confirmed_at || !Number.isFinite(Date.parse(data.user.email_confirmed_at))) {
      return { status: 'invalid' };
    }
    return { status: 'success' };
  } catch {
    return { status: 'error' };
  }
};

export const confirmMobileEmail = async (callback: MobileEmailCallback): Promise<MobileEmailConfirmationResult> => {
  if (callback.status !== 'ready') return { status: callback.status };
  // Read-only token verification. The email link has already been consumed by Supabase.
  // This isolated client never signs the mobile user into the dietitian web panel.
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: 'dietbridge-mobile-email-confirmation' },
  });
  return verifyMobileEmailCallback(callback, (token) => client.auth.getUser(token));
};
