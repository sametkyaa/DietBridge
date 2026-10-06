import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: ['invite-sharing.spec.ts','recipe-import.spec.ts','design-system.spec.ts'], workers:1,
  timeout:30000, expect:{timeout:10000}, reporter:'line', outputDir:'test-results/features',
  use:{baseURL:'http://127.0.0.1:4187',channel:'chrome',screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort',url:'http://127.0.0.1:4187',reuseExistingServer:false,
    env:{VITE_SUPABASE_URL:'https://dietbridge-disposable-test.invalid',VITE_SUPABASE_ANON_KEY:'disposable-publishable-placeholder',VITE_CLIENT_INVITE_MODE:process.env.DIETBRIDGE_TEST_INVITE_MODE==='invite_code'?'invite_code':'legacy_email'},timeout:60000},
});
