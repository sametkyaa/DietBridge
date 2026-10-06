import { expect, test, type Page } from '@playwright/test';

const owner = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

async function mockDashboard(page: Page) {
  await page.addInitScript(({ id }) => {
    localStorage.setItem('sb-dietbridge-disposable-test-auth-token', JSON.stringify({
      access_token: 'fake-test-jwt', refresh_token: 'fake-test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated' },
    }));
  }, { id: owner });
  const state = { preferences: [] as Record<string, unknown>[], failWrite: false, hasPlan: false, writes: [] as string[] };
  await page.route('https://dietbridge-disposable-test.invalid/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.split('/').at(-1);
    let data: unknown = [];
    if (url.pathname.startsWith('/rest/v1/') && !url.pathname.includes('/rpc/')
      && ['POST', 'PATCH', 'DELETE'].includes(request.method())) state.writes.push(name ?? '');
    if (name === 'user') data = { id: owner, email: 'test@example.invalid', aud: 'authenticated', role: 'authenticated' };
    else if (name === 'profiles') data = { role: 'dietitian' };
    else if (name === 'dietitian_profiles') data = { user_id: owner, is_verified: true, verification_status: 'approved', profiles: { full_name: 'Test Diyetisyen', email: 'test@example.invalid' } };
    else if (name === 'dietitian_clients') data = [{ id: '44444444-4444-4444-8444-444444444444', dietitian_id: owner,
      client_id: client, status: 'active', accepted_at: new Date().toISOString(), client: { id: client, full_name: 'Test Danışan', client_profiles: {} } }];
    else if (name === 'daily_tasks') data = [{ id: '33333333-3333-4333-8333-333333333333', dietitian_id: owner, client_id: null,
      title: 'Normal görev', description: null, due_date: today, due_time: null, priority: 'medium', status: 'pending',
      completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), client: null }];
    else if (name === 'meal_plans' && state.hasPlan) data = [{ client_id: client, plan_date: today, meals: [{ is_eaten: true }] }];
    else if (name === 'automatic_task_dismissals') {
      if (request.method() === 'POST') {
        if (state.failWrite) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'test denied' }) });
        const payload = request.postDataJSON();
        const row = Array.isArray(payload) ? payload[0] : payload;
        state.preferences = [row];
        data = row;
      } else data = state.preferences;
    }
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: name === 'appointments' ? { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' } : undefined,
      body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/tests/browser/feature-fixture.html?view=dashboard');
  await expect(page.getByText('Bugün 2 bekleyen göreviniz var, randevunuz yok.', { exact: true })).toBeVisible();
  return state;
}

test('automatic delete confirms, persists on reload and updates total without changing manual tasks', async ({ page }) => {
  const state = await mockDashboard(page);
  const remove = page.getByRole('button', { name: 'Test Danışan için beslenme planı yok otomatik görevini sil' });
  await expect(remove.locator('..').getByRole('checkbox')).toHaveCount(0);
  await remove.click();
  const dialog = page.getByRole('alertdialog', { name: 'Otomatik görev silinsin mi?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
  expect(state.writes).toEqual([]);
  await expect(remove).toBeVisible();
  await remove.click();
  await dialog.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  await expect(page.getByText('Bugün 1 bekleyen göreviniz var, randevunuz yok.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Normal görev görevini sil' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Bugün 1 bekleyen göreviniz var, randevunuz yok.', { exact: true })).toBeVisible();
  await expect(remove).toHaveCount(0);
  expect(state.writes).toEqual(['automatic_task_dismissals']);
});

test('failed automatic deletion keeps the task and count; retry works', async ({ page }) => {
  const state = await mockDashboard(page);
  state.failWrite = true;
  await page.getByRole('button', { name: 'Test Danışan için beslenme planı yok otomatik görevini sil' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Otomatik görev silinsin mi?' });
  await dialog.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Otomatik görev silinemedi');
  await expect(page.getByText('Bugün 2 bekleyen göreviniz var, randevunuz yok.', { exact: true })).toBeVisible();
  state.failWrite = false;
  await dialog.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Bugün 1 bekleyen göreviniz var, randevunuz yok.', { exact: true })).toBeVisible();
});

test('existing automatic resolution still works and nutrition plans belong to client management', async ({ page }) => {
  const state = await mockDashboard(page);
  const group = page.getByText('Danışan yönetimi', { exact: true }).locator('..');
  await expect(group.getByRole('link', { name: 'Beslenme planı', exact: true })).toBeVisible();
  await expect(page.getByText('Kaynaklar', { exact: true }).locator('..').getByRole('link', { name: 'Beslenme planı', exact: true })).toHaveCount(0);
  state.hasPlan = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Test Danışan için beslenme planı yok otomatik görevini sil' })).toHaveCount(0);
  await expect(page.getByText('Bugün 1 bekleyen göreviniz var, randevunuz yok.', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('automatic task action and delete remain usable on a narrow screen', async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Test Danışan için beslenme planı yok otomatik görevini sil' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan oluştur', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
