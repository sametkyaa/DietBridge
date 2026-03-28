
import { createClient } from '@supabase/supabase-js';

// Support both Vite and Create React App environment variables
// FIX: Cast import.meta to any to avoid TypeScript error 'Property env does not exist on type ImportMeta'
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Key is missing. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
