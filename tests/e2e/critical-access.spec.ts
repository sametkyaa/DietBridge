import { expect, test, type Page } from '@playwright/test';

type ActorKey = 'client' | 'pending' | 'rejected' | 'approved';

const actor = (key: ActorKey) => ({
  email: process.env[`E2E_${key.toUpperCase()}_EMAIL`] ?? '',
  password: process.env.E2E_PASSWORD ?? '',
});

const login = async (page: Page, key: ActorKey) => {
  const credentials = actor(key);
  expect(credentials.email).not.toBe('');
  expect(credentials.password).not.toBe('');
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(credentials.email);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.getByRole('button', { name: /Giriş Yap/ }).click();
};

test('unauthenticated protected route is blocked by the login route', async ({ page }) => {
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: "DietBridge'e Giriş Yap" })).toBeVisible();
});

test('client role is rejected from the dietitian Web panel', async ({ page }) => {
  await login(page, 'client');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/Bu panel yalnızca diyetisyenler içindir/)).toBeVisible();
});

test('pending and rejected dietitians remain outside protected product routes', async ({ browser }) => {
  for (const [key, message] of [
    ['pending', /Başvurunuz alınmıştır/],
    ['rejected', /Hesabınız Onaylanmadı/],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, key);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Danışanlar' })).toHaveCount(0);
    await context.close();
  }
});

test('approved dietitian restores session, reads a persisted client profile, and logout revokes access', async ({ page }) => {
  const fatalErrors: string[] = [];
  page.on('pageerror', (error) => fatalErrors.push(error.message));

  await login(page, 'approved');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/Danışanlarım/)).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/Danışanlarım/)).toBeVisible();

  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Danışan Listesi' })).toBeVisible();
  const clientName = process.env.E2E_LINKED_CLIENT_NAME ?? '';
  await expect(page.getByText(clientName).first()).toBeVisible();
  await page.getByText(clientName).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
  await expect(page.getByText(clientName).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(clientName).first()).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('button', { name: /Çıkış Yap/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/login$/);
  expect(fatalErrors).toEqual([]);
});

