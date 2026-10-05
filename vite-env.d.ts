/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ENABLE_CHAT_IMAGES?: string;
  readonly VITE_CLIENT_INVITE_MODE?: 'legacy_email' | 'invite_code';
  readonly VITE_RECIPE_IMPORT_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
