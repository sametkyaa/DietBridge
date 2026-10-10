import { expect, test, type Page } from '@playwright/test';

const owner = '11111111-1111-4111-8111-111111111111';
const requestId = '33333333-3333-4333-8333-333333333333';

async function openReview(page: Page) {
  await page.addInitScript(({ id }) => {
    localStorage.setItem('sb-dietbridge-disposable-test-auth-token', JSON.stringify({
      access_token: 'fake-test-jwt', refresh_token: 'fake-test-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer',
      user: { id, aud: 'authenticated', role: 'authenticated' },
    }));
  }, { id: owner });
  const state = { calls: [] as Record<string, unknown>[], fail: false, release: null as (() => void) | null };
  await page.route('https://dietbridge-disposable-test.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: { id: owner, aud: 'authenticated', role: 'authenticated' } });
    if (url.pathname.endsWith('/rpc/review_meal_change_request')) {
      const payload = route.request().postDataJSON();
      state.calls.push(payload);
      await new Promise<void>((resolve) => { state.release = resolve; });
      if (state.fail) return route.fulfill({ status: 500, json: { code: 'XX000', message: 'Disposable chat failure' } });
      return route.fulfill({ json: { id: requestId, client_id: '22222222-2222-4222-8222-222222222222',
        dietitian_id: owner, plan_date: '2026-10-11', meal_slot: 'breakfast', requested_meals: { alternatives: ['breakfast', 'lunch'] },
        notes: 'Kahvaltıyı değiştirebilir miyiz?', status: payload.p_decision, created_at: '2026-10-10T10:00:00Z',
        reviewed_at: '2026-10-10T11:00:00Z', response_note: payload.p_response_note } });
    }
    throw new Error(`Unexpected review request: ${url.pathname}`);
  });
  await page.goto('/tests/browser/feature-fixture.html?view=meal-request-review');
  await expect(page.getByRole('dialog', { name: 'Öğün değişikliği talebi' })).toBeVisible();
  return state;
}

test('review describes chat delivery and sends one atomic request while buttons are disabled', async ({ page }) => {
  const state = await openReview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByLabel('Danışana yanıt (isteğe bağlı)');
  await expect(input).toHaveAttribute('maxlength', '1000');
  await expect(page.getByText(/yanıtınız danışana sohbet mesajı olarak gönderilir/)).toBeVisible();
  await expect(page.getByText(/Onaylamak planı otomatik değiştirmez/)).toBeVisible();
  await input.fill('  Yumurta tercih edebilirsin.\nPorsiyonu birlikte netleştirelim.  ');
  await page.getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  for (const label of ['Onayla', 'Reddet', 'Vazgeç']) await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  await expect(input).toBeDisabled();
  expect(state.calls[0]).toEqual({ p_request_id: requestId, p_decision: 'approved', p_response_note: 'Yumurta tercih edebilirsin.\nPorsiyonu birlikte netleştirelim.' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  state.release?.();
  await expect(page.getByRole('status')).toHaveText('Talep sonuçlandırıldı.');
});

test('chat failure leaves the dialog and note available for a safe retry', async ({ page }) => {
  const state = await openReview(page);
  state.fail = true;
  const input = page.getByLabel('Danışana yanıt (isteğe bağlı)');
  await input.fill('Mevcut planla devam edelim.');
  await page.getByRole('button', { name: 'Reddet', exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  state.release?.();
  await expect(page.getByRole('alert')).toContainText('Talep sonuçlandırılamadı');
  await expect(input).toHaveValue('Mevcut planla devam edelim.');
  await expect(page.getByRole('button', { name: 'Reddet', exact: true })).toBeEnabled();
  state.fail = false;
  await page.getByRole('button', { name: 'Reddet', exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(2);
  state.release?.();
  await expect(page.getByRole('status')).toHaveText('Talep sonuçlandırıldı.');
  expect(state.calls[1]).toEqual(state.calls[0]);
});

test('a blank note keeps the existing decision-only review', async ({ page }) => {
  const state = await openReview(page);
  await page.getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  expect(state.calls[0].p_response_note).toBeNull();
  state.release?.();
  await expect(page.getByRole('status')).toHaveText('Talep sonuçlandırıldı.');
});
