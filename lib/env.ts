const getRequiredEnv = (
  name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY',
): string => {
  const value = import.meta.env[name]?.trim();

  if (!value) {
    throw new Error(
      `[DietBridge] ${name} tanımlı değil. .env.example dosyasını .env olarak kopyalayıp gerekli değeri girin.`,
    );
  }

  return value;
};

export const env = {
  supabaseUrl: getRequiredEnv('VITE_SUPABASE_URL'),
  supabaseAnonKey: getRequiredEnv('VITE_SUPABASE_ANON_KEY'),
  /**
   * Chat image messaging stays disabled unless the flag is explicitly 'true'.
   * The visual RPCs are dormant (no `authenticated` grant), so the composer
   * picker must not be reachable by default.
   */
  enableChatImages: import.meta.env.VITE_ENABLE_CHAT_IMAGES === 'true',
} as const;
