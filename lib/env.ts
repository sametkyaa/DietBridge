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
  enableMockData: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',
} as const;
