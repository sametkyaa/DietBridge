
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { isMobileEmailConfirmationPath } from '../features/auth/utils/mobileEmailConfirmation';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { detectSessionInUrl: !(typeof window !== 'undefined' && isMobileEmailConfirmationPath(window.location.pathname)) },
});
