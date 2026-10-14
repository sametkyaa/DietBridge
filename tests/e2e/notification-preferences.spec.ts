// Actual protected Settings page and notification subscription, with an isolated
// .invalid backend and test-only desktop banners. Never touches production.
import { expect, test, type Page } from '@playwright/test';
const owner = '11111111-1111-4111-8111-111111111111';
const notificationId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const preferenceKey = `dietbridge:web-notifications:v1:${owner}`;
const notificationRow = (changes: Record<string, unknown> = {}) => {
  const now = new Date().toISOString();
  return {
    id: notificationId, recipient_id: owner, category: 'chat_message', event_type: 'new_message',
    aggregation_key: `chat:${conversationId}`, actor_id: conversationId, actor_display_name: 'Özel danışan adı',
    conversation_id: conversationId, appointment_id: null, dietitian_client_id: null,
    summary_key: 'chat_new_message', appointment_title_snapshot: null, appointment_date: null,
    appointment_time: null, appointment_status: null, relationship_from_status: null, relationship_to_status: null,
    event_count: 1, occurred_at: now, seen_at: null, read_at: null, created_at: now, updated_at: now, ...changes,
  };
};

async function fixture(page: Page, initialPermission: 'default' | 'denied' | 'granted' = 'default') {
  const state = { rows: [] as Record<string, unknown>[], writes: [] as string[], errors: [] as string[], send: null as null | ((event: 'INSERT' | 'UPDATE', row: Record<string, unknown>) => void) };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.addInitScript(({ id, initialPermission }) => {
    localStorage.setItem('sb-dietbridge-disposable-test-auth-token', JSON.stringify({
      access_token: 'fixture-jwt', refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated' },
    }));
    const events = { banners: [] as { title: string; body: string; silent: boolean }[], tones: 0, requests: 0 };
    Object.assign(window, { notificationTestEvents: events });
    class TestNotification {
      static permission = localStorage.getItem('fixture-notification-permission') ?? initialPermission;
      static requestPermission = async () => {
        events.requests++; TestNotification.permission = 'granted';
        localStorage.setItem('fixture-notification-permission', 'granted'); return 'granted';
      };
      onclick = null;
      close() {}
      constructor(title: string, options: { body: string; silent: boolean }) { events.banners.push({ title, body: options.body, silent: options.silent }); }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification });
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { events.tones++; return create.call(this); };
  }, { id: owner, initialPermission });
  await page.route('https://dietbridge-disposable-test.invalid/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), name = url.pathname.split('/').at(-1);
    let data: unknown = [];
    if (name === 'user') data = { id: owner, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' };
    else if (name === 'profiles') data = { role: 'dietitian' };
    else if (name === 'dietitian_profiles') data = {
      user_id: owner, is_verified: true, verification_status: 'approved', phone: '5550000000',
      university: 'Test University', graduation_year: 2020, experience_years: 2, specialization: 'Nutrition',
      bio: 'Test profile', diploma_url: `diplomas/${owner}/diploma.pdf`, profiles: { full_name: 'Test Diyetisyen', email: 'fixture@example.invalid' },
    };
    else if (name === 'notifications') data = state.rows;
    else if (name === 'is_current_user_platform_admin') data = false;
    if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && !['get_dietitian_unread_counts', 'is_current_user_platform_admin'].includes(name ?? '')) state.writes.push(url.pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-0/${state.rows.length}` }, body: request.method() === 'HEAD' ? '' : JSON.stringify(data) });
  });
  await page.routeWebSocket(/dietbridge-disposable-test\.invalid\/realtime\//, (socket) => {
    socket.onMessage((message) => {
      const raw = JSON.parse(message.toString());
      const frame = Array.isArray(raw) ? { join_ref: raw[0], ref: raw[1], topic: raw[2], event: raw[3], payload: raw[4] } : raw;
      const send = (event: string, payload: unknown) => socket.send(JSON.stringify(Array.isArray(raw)
        ? [frame.join_ref, frame.ref, frame.topic, event, payload] : { ...frame, event, payload }));
      if (frame.event === 'phx_join') {
        const filters = (frame.payload.config?.postgres_changes ?? []).map((filter: Record<string, unknown>, index: number) => ({ ...filter, id: index + 1 }));
        send('phx_reply', { status: 'ok', response: { postgres_changes: filters } });
        if (frame.topic === `realtime:notifications:${owner}`) state.send = (event, row) => {
          state.rows = [row];
          send('postgres_changes', { ids: [event === 'INSERT' ? 1 : 2], data: {
            schema: 'public', table: 'notifications', type: event, record: row, old_record: {}, errors: null, commit_timestamp: new Date().toISOString(),
            columns: Object.keys(row).map((name) => ({ name, type: name === 'event_count' ? 'int4' : 'text' })),
          } });
        };
      } else if (frame.event === 'heartbeat') send('phx_reply', { status: 'ok', response: {} });
    });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Bildirimler/ }).click();
  await expect(page.getByRole('switch', { name: 'Bildirim sesi' })).toBeVisible();
  await expect.poll(() => Boolean(state.send)).toBe(true);
  return state;
}
const events = (page: Page) => page.evaluate(() => (window as unknown as { notificationTestEvents: { banners: { title: string; body: string; silent: boolean }[]; tones: number; requests: number } }).notificationTestEvents);

test('settings independently persist both switches, request permission on click, and play a test chime', async ({ page }) => {
  const state = await fixture(page);
  const desktop = page.getByRole('switch', { name: 'Masaüstü bildirimleri' });
  const sound = page.getByRole('switch', { name: 'Bildirim sesi' });
  await expect(desktop).toHaveAttribute('aria-checked', 'false');
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  expect((await events(page)).requests).toBe(0);
  await sound.click();
  await page.getByRole('button', { name: 'Sesi dene' }).click();
  await expect.poll(async () => (await events(page)).tones).toBe(2);
  await desktop.click();
  await expect(desktop).toHaveAttribute('aria-checked', 'true');
  expect((await events(page)).requests).toBe(1);
  await sound.click();
  await expect(desktop).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Sesi dene' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: /^Bildirimler/ }).click();
  await expect(desktop).toHaveAttribute('aria-checked', 'true');
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: 'test-results/notification-settings-desktop.png', fullPage: true });
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('new and aggregated events sound once; replay, read updates, refresh and disabled preferences do not', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('switch', { name: 'Bildirim sesi' }).click();
  await page.getByRole('switch', { name: 'Masaüstü bildirimleri' }).click();
  const row = notificationRow();
  state.send!('INSERT', row);
  await expect.poll(async () => (await events(page)).tones).toBe(2);
  await expect.poll(async () => (await events(page)).banners.length).toBe(1);
  const banners = (await events(page)).banners;
  expect(banners[0]).toEqual({ title: 'DietBridge', body: 'Yeni bir mesajınız var.', silent: true });
  state.send!('INSERT', row);
  state.send!('UPDATE', { ...row, read_at: new Date().toISOString() });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await events(page)).tones).toBe(2);
  await page.waitForTimeout(1300); // Exercise the real burst throttle window.
  state.send!('UPDATE', notificationRow({ event_count: 2 }));
  await expect.poll(async () => (await events(page)).tones).toBe(4);
  await expect.poll(async () => (await events(page)).banners.length).toBe(2);
  await page.getByRole('switch', { name: 'Bildirim sesi' }).click();
  await page.getByRole('switch', { name: 'Masaüstü bildirimleri' }).click();
  await page.waitForTimeout(1300);
  state.send!('UPDATE', notificationRow({ event_count: 3 }));
  await expect.poll(async () => (await events(page)).tones).toBe(4);
  expect((await events(page)).banners.length).toBe(2);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('denied desktop permission leaves sound available and renders without horizontal overflow on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, 'denied');
  await expect(page.getByRole('switch', { name: 'Masaüstü bildirimleri' })).toBeDisabled();
  await expect(page.getByText('Tarayıcı izni kapalı', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Bildirim sesi' }).click();
  await page.getByRole('button', { name: 'Sesi dene' }).click();
  await expect.poll(async () => (await events(page)).tones).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/notification-settings-narrow.png', fullPage: true });
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('two tabs synchronize preferences and produce only one banner and one chime for the same event', async ({ page, context }) => {
  const first = await fixture(page, 'granted');
  await page.getByRole('switch', { name: 'Bildirim sesi' }).click();
  await page.getByRole('switch', { name: 'Masaüstü bildirimleri' }).click();
  const secondPage = await context.newPage(); const second = await fixture(secondPage, 'granted');
  await expect(secondPage.getByRole('switch', { name: 'Bildirim sesi' })).toHaveAttribute('aria-checked', 'true');
  await secondPage.getByRole('heading', { name: 'Bildirimler', exact: true }).click();
  const row = notificationRow(); first.send!('INSERT', row); second.send!('INSERT', row);
  await expect.poll(async () => (await events(page)).banners.length + (await events(secondPage)).banners.length).toBe(1);
  await expect.poll(async () => (await events(page)).tones + (await events(secondPage)).tones).toBe(2);
  await secondPage.getByRole('switch', { name: 'Bildirim sesi' }).click();
  await expect(page.getByRole('switch', { name: 'Bildirim sesi' })).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).soundEnabled, preferenceKey)).toBe(false);
  expect(first.writes).toEqual([]); expect(second.writes).toEqual([]);
  expect(first.errors).toEqual([]); expect(second.errors).toEqual([]);
});
