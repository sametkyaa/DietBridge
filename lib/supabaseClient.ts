
import { createClient } from '@supabase/supabase-js';

// Fallback credentials from your provided values
const FALLBACK_URL = 'https://kagvxhyvxxypspdxcuxz.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw';

const getEnvVar = (key: string): string | undefined => {
  const value = process.env[key] || (import.meta as any).env?.[key];
  // Check if it's a real value and not the literal placeholder text from a template
  if (!value || value.includes('your_') || value === 'placeholder') {
    return undefined;
  }
  return value;
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('EXPO_PUBLIC_SUPABASE_URL') || FALLBACK_URL;
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('EXPO_PUBLIC_SUPABASE_ANON_KEY') || FALLBACK_KEY;

// Use the determined values to create the client. 
// If both are missing, we use a dummy domain that won't throw 'Failed to fetch' 
// until an actual request is made, but we've added resilience in services too.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
