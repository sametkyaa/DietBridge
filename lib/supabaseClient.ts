
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { isMobileEmailConfirmationPath } from '../features/auth/utils/mobileEmailConfirmation';
import { createReadFetch } from './readFetch';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  global: { fetch: createReadFetch((input, init) => fetch(input, init), new URL(env.supabaseUrl).origin) },
  auth: { detectSessionInUrl: !(typeof window !== 'undefined' && isMobileEmailConfirmationPath(window.location.pathname)) },
});
