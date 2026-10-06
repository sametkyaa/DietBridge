import { expect, test } from '@playwright/test';

const gallery = '/tests/browser/design-system-gallery.html';

test('modal traps focus, closes on Escape and returns focus to its trigger', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(gallery);
  const trigger = page.getByRole('button', { name: 'Yeni randevu' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Yeni randevu' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByLabel('Danışan', { exact: true })).toBeFocused();
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('tabs follow the WAI-ARIA keyboard pattern and controls expose state', async ({ page }) => {
  await page.goto(gallery);
  const late = page.getByRole('tab', { name: /Geciken/ });
  await expect(late).toHaveAttribute('aria-selected', 'true');
  await late.focus();
  await page.keyboard.press('ArrowRight');
  const today = page.getByRole('tab', { name: /Bugün/ });
  await expect(today).toBeFocused();
  await expect(today).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await today.getAttribute('id') ?? '');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Tamamlanan' })).toHaveAttribute('aria-selected', 'true');

  const toggle = page.getByRole('switch', { name: 'Yeni bağlantılara açık' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await page.locator('label', { hasText: 'Telefon' }).first().click();
  await expect(page.getByRole('radio', { name: 'Telefon' }).first()).toBeChecked();

  const title = page.getByLabel('Başlık', { exact: false }).first();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Başlık boş bırakılamaz.')).toBeVisible();

  await page.getByRole('button', { name: 'Sayfa 2' }).click();
  await expect(page.getByRole('button', { name: 'Sayfa 2' })).toHaveAttribute('aria-current', 'page');
});

test('error state retry opens a confirm dialog that is dismissable with Vazgeç', async ({ page }) => {
  await page.goto(gallery);
  await expect(page.getByRole('alert').filter({ hasText: 'Veriler yüklenemedi' })).toBeVisible();
  await page.getByRole('button', { name: 'Tekrar dene' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Not silinsin mi?' });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vazgeç' })).toBeFocused();
  await page.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(confirm).toHaveCount(0);
});
