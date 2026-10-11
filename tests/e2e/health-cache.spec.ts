import { expect, test, type Page } from '@playwright/test';
const owner = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const other = '44444444-4444-4444-8444-444444444444';
const noteId = '55555555-5555-4555-8555-555555555555';
const secret = 'Danışana bağlı özel not içeriği';

async function mockHealth(page: Page) {
  const state = { sharing: true, currentOwner: owner, writes: [] as string[], defer: false, waiting: [] as (() => Promise<void>)[] };
  await page.addInitScript(({ id }) => {
    localStorage.setItem('sb-dietbridge-disposable-test-auth-token', JSON.stringify({ access_token: 'fake-test-jwt', refresh_token: 'fake-test-refresh',
      expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated' } }));
  }, { id: owner });
  await page.route('https://dietbridge-disposable-test.invalid/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), name = url.pathname.split('/').at(-1);
    if (request.headers().authorization?.includes('fixture')) state.currentOwner = other;
    const permitted = state.sharing && state.currentOwner === owner;
    if (url.pathname.startsWith('/rest/v1/') && ['POST','PATCH','DELETE'].includes(request.method()) && !url.pathname.includes('/rpc/')) state.writes.push(name ?? '');
    let data: unknown = [];
    if (name === 'user') data = { id: state.currentOwner, email: 'test@example.invalid', aud: 'authenticated', role: 'authenticated' };
    else if (name === 'profiles') data = { role: 'dietitian' };
    else if (name === 'dietitian_profiles') data = { user_id: state.currentOwner, is_verified: true, verification_status: 'approved',
      phone: '5550000000', university: 'Test University', graduation_year: 2020, experience_years: 2,
      specialization: 'Nutrition', bio: 'Test profile', diploma_url: `diplomas/${state.currentOwner}/diploma.pdf`,
      profiles: { full_name: 'Test Diyetisyen', email: 'test@example.invalid' } };
    else if (name === 'dietitian_clients') {
      const relation = { id: '33333333-3333-4333-8333-333333333333', dietitian_id: state.currentOwner, client_id: client, status: 'active', client: { id: client, full_name: 'Test Danışan', avatar_url: null } };
      data = url.searchParams.has('client_id') ? relation : [relation];
    }
    else if (name === 'dietitian_notes') data = permitted ? [{ id: noteId, dietitian_id: owner, client_id: client, title: 'Özel not', content: secret,
      created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z', client: { full_name: 'Test Danışan' } }] : [];
    else if (name === 'get_dietitian_unread_counts') data = permitted ? [{ conversation_id: noteId, client_id: client, unread_count: 3 }] : [];
    else if (name === 'client_profiles') data = permitted ? { user_id: client, current_weight: 70, start_weight: 75, target_weight: 65, daily_water_goal_ml: 2000 } : null;
    // A pending response deliberately retains its old payload so generation
    // guards, rather than the mock server, must prevent it from reappearing.
    const finish = () => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (state.defer && ['client_profiles','get_dietitian_unread_counts'].includes(name ?? '')) state.waiting.push(finish);
    else await finish();
  });
  await page.goto('/tests/browser/health-cache-fixture.html');
  await expect(page.getByRole('button', { name: 'Özel not' })).toBeVisible();
  await expect(page.getByTestId('unread')).toHaveText('3');
  await page.getByRole('button', { name: 'Analizi yükle' }).click();
  await expect(page.getByTestId('weight')).toHaveText('70');
  return state;
}

test('focus recheck clears revoked report, unread count and existing note edit draft without a write', async ({ page }) => {
  const state = await mockHealth(page);
  await page.getByRole('button', { name: 'Özel not' }).click();
  await page.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'İçerik' })).toHaveValue(secret);
  state.sharing = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('weight')).toHaveText('empty');
  await expect(page.getByTestId('unread')).toHaveText('0');
  await expect(page.getByRole('textbox', { name: 'İçerik' })).toHaveCount(0);
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('late responses from a hidden page cannot restore prior health projections', async ({ page }) => {
  const state = await mockHealth(page); state.defer = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.waiting.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('weight')).toHaveText('empty');
  await expect(page.getByTestId('unread')).toHaveText('loading');
  await page.evaluate(() => { Object.defineProperty(document,'visibilityState',{ configurable:true,value:'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  state.defer = false; state.sharing = false;
  await Promise.all(state.waiting.splice(0).map((finish) => finish()));
  await expect(page.getByTestId('weight')).toHaveText('empty');
  await expect(page.getByTestId('unread')).toHaveText('loading');
  await page.evaluate(() => { Object.defineProperty(document,'visibilityState',{ configurable:true,value:'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByTestId('unread')).toHaveText('0');
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
});

test('switching accounts remounts protected health screens and does not reuse the prior report or notes', async ({ page }) => {
  const state = await mockHealth(page);
  await page.getByRole('button', { name: 'Test hesabını değiştir' }).click();
  await expect.poll(() => state.currentOwner).toBe(other);
  await expect(page.getByTestId('weight')).toHaveText('empty');
  await expect(page.getByTestId('unread')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Özel not' })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
