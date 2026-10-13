import { test, expect } from '@playwright/test';

const callback = '/mobil/eposta-dogrulama#type=signup&access_token=fixture-access&refresh_token=fixture-refresh';
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud: 'authenticated', role: 'authenticated',
  email: 'fixture@example.test', email_confirmed_at: '2026-10-13T10:00:00Z', app_metadata: {}, user_metadata: { account_type: 'client' } };

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'dietbridge-disposable-test.invalid' && url.pathname === '/auth/v1/user') {
      expect(route.request().method()).toBe('GET');
      expect(route.request().headers().authorization).toBe('Bearer fixture-access');
      return route.fulfill({ json: user });
    }
    return route.abort();
  });
});

test('confirmed mobile email displays mobile instructions without opening the dietitian panel or persisting callback tokens', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET' && !request.url().includes('127.0.0.1')) writes.push(request.url()); });
  await page.goto(callback, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'E-posta adresin doğrulandı', exact: true })).toBeVisible();
  await expect(page.getByText('Hesabın için e-posta doğrulaması tamamlandı.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Giriş yap' })).toHaveCount(0);
  expect(page.url()).toBe('http://127.0.0.1:4187/mobil/eposta-dogrulama');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-access');
  expect(writes).toEqual([]);
});

test('unconfirmed, expired and fabricated success links never display confirmation success', async ({ page }) => {
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: { ...user, email_confirmed_at: null } }));
  await page.goto(callback);
  await expect(page.getByRole('heading', { name: 'Doğrulama bağlantısı geçersiz' })).toBeVisible();
  await page.goto('/mobil/eposta-dogrulama#error_code=otp_expired&error_description=raw-secret');
  await expect(page.getByRole('heading', { name: 'Doğrulama bağlantısının süresi dolmuş' })).toBeVisible();
  await expect(page.getByText('raw-secret')).toHaveCount(0);
  await page.goto('/mobil/eposta-dogrulama?confirmed=true');
  await expect(page.getByRole('heading', { name: 'Doğrulama bağlantısı geçersiz' })).toBeVisible();
});

test('network failure can be retried with the original callback after URL cleanup', async ({ page }) => {
  let calls = 0;
  await page.route('**/auth/v1/user', (route) => {
    calls += 1;
    return calls === 1 ? route.fulfill({ status: 500, json: { message: 'fixture failure' } }) : route.fulfill({ json: user });
  });
  await page.goto(callback);
  await expect(page.getByRole('heading', { name: 'Doğrulama kontrol edilemedi' })).toBeVisible();
  await page.getByRole('button', { name: 'Tekrar dene' }).click();
  await expect(page.getByRole('heading', { name: 'E-posta adresin doğrulandı', exact: true })).toBeVisible();
});

test('confirmation fits a narrow mobile screen and retains an existing browser session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const key = 'sb-dietbridge-disposable-test-auth-token';
  const oldSession = JSON.stringify({ access_token: 'old-dietitian-token', refresh_token: 'old-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { ...user, user_metadata: { account_type: 'dietitian' } } });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key, value: oldSession });
  await page.goto(callback);
  await expect(page.getByRole('heading', { name: 'E-posta adresin doğrulandı', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(oldSession);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-email-confirmation.png', fullPage: true });
});
