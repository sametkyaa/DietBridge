// Isolated browser fixtures only: every Supabase request is intercepted on .invalid.
// No production account, seed, Storage upload or real database mutation is used.
import { test, expect, type Page } from '@playwright/test';

const owner = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const recipeId = '33333333-3333-4333-8333-333333333333';
const mealId = '44444444-4444-4444-8444-444444444444';
const photo = `recipes/${owner}/${recipeId}/55555555-5555-4555-8555-555555555555.webp`;
const now = new Date().toISOString();
type Row = Record<string, unknown>;
const recipe = (id = recipeId, name = 'Kayıtlı test tarifi', mealType = 'breakfast'): Row => ({
  id, dietitian_id: owner, name, description: 'Kayıtlı tarif açıklaması', meal_type: mealType,
  calories: 320, protein: 16, carbs: 42, fat: 10, image_path: photo, created_at: now, updated_at: now,
});
const monday = () => {
  const date = new Date(); date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dateAt = (start: string, index: number) => new Date(new Date(`${start}T00:00:00Z`).valueOf() + index * 86400000).toISOString().slice(0, 10);
const planId = (index: number) => `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`;
const initialPlans = (eaten = false): Row[] => Array.from({ length: 7 }, (_, index) => ({
  id: planId(index), plan_date: dateAt(monday(), index), notes: index === 0 ? 'Kayıtlı günlük not' : null,
  meals: index === 0 ? [{ id: mealId, plan_id: planId(0), type: 'breakfast', title: 'Kayıtlı öğün', calories: 320,
    macros: { protein: 16, carbs: 42, fat: 10 }, photo_url: photo, description: 'Kayıtlı açıklama',
    is_eaten: eaten, sort_order: 0, time: '08:30', source: 'recipe', recipe_id: recipeId, slot_label: null }] : [],
}));

async function fixture(page: Page, options: { empty?: boolean; eaten?: boolean; noTarget?: boolean; view?: 'recipes' | 'meal-plans' } = {}) {
  const state = { recipes: options.empty ? [] : [recipe()], plans: options.empty ? [] : initialPlans(options.eaten),
    previousPlans: [] as Row[],
    failRecipeWrite: false, failPlanWrite: false, failLoad: false, savedDays: [] as Row[][],
    writes: [] as string[], storageDeletes: [] as unknown[], unexpected: [] as string[] };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ id }) => localStorage.setItem('sb-dietbridge-disposable-test-auth-token', JSON.stringify({
    access_token: 'fixture-jwt', refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated' },
  })), { id: owner });
  await page.route('https://dietbridge-disposable-test.invalid/**', async route => {
    const req = route.request(), url = new URL(req.url()), name = url.pathname.split('/').at(-1), method = req.method();
    let data: unknown = [], status = 200;
    if (name === 'user') data = { id: owner, email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated' };
    else if (name === 'recipes') {
      if (method === 'GET') {
        if (state.failLoad) { status = 503; data = { message: 'private fixture load failure' }; }
        else if (url.searchParams.has('id')) data = state.recipes.filter(row => `eq.${row.id}` === url.searchParams.get('id'));
        else data = state.recipes;
      } else {
        state.writes.push(`recipes:${method}`);
        if (state.failRecipeWrite) { status = 403; data = { code: '42501', message: 'private fixture write denied' }; }
        else if (method === 'DELETE') { state.recipes = state.recipes.filter(row => `eq.${row.id}` !== url.searchParams.get('id')); data = null; }
        else {
          const payload = req.postDataJSON();
          if (method === 'POST') { data = { ...recipe(payload.id, payload.name), ...payload }; state.recipes.push(data as Row); }
          else { state.recipes = state.recipes.map(row => `eq.${row.id}` === url.searchParams.get('id') ? { ...row, ...payload } : row); data = state.recipes.find(row => `eq.${row.id}` === url.searchParams.get('id')); }
        }
      }
    } else if (name === 'dietitian_clients') data = url.searchParams.get('select') === 'status' ? [{ status: 'active' }] : [{
      status: 'active', client: { id: client, full_name: 'Kayıtlı Test Danışan', avatar_url: null, email: null, client_profiles: { goal: 'Kilo yönetimi' } },
    }];
    else if (name === 'profiles') data = [{ id: client, full_name: 'Kayıtlı Test Danışan', avatar_url: null, email: null, phone: null }];
    else if (name === 'client_profiles') data = [{ goal: 'Kilo yönetimi', food_intolerances: ['Süt'], disliked_foods: [] }];
    else if (name === 'measurements') data = []; // This isolated client has no recorded measurement.
    else if (name === 'client_nutrition_targets') data = options.noTarget ? [] : [{ client_id: client, min_kcal: 1500, max_kcal: 1800, updated_at: now }];
    else if (name === 'set_client_nutrition_target') {
      const payload = req.postDataJSON(); state.writes.push('set_client_nutrition_target');
      data = { client_id: client, min_kcal: payload.p_min_kcal, max_kcal: payload.p_max_kcal, updated_at: now };
    }
    else if (name === 'meal_plans') {
      if (state.failLoad) { status = 503; data = { message: 'private fixture plan failure' }; }
      else data = [...state.plans, ...state.previousPlans].filter(row => String(row.plan_date) >= (url.searchParams.get('plan_date') ?? '').replace('gte.', '')
        && String(row.plan_date) <= (url.searchParams.getAll('plan_date').find(value => value.startsWith('lte.')) ?? '').replace('lte.', ''));
    } else if (name === 'save_weekly_meal_plan') {
      state.writes.push('save_weekly_meal_plan');
      const payload = req.postDataJSON(); state.savedDays.push(payload.p_days);
      if (state.failPlanWrite) { status = 400; data = { code: '23514', message: 'private fixture transaction failure' }; }
      else {
        state.plans = payload.p_days.map((day: Row, index: number) => ({ ...day, id: planId(index),
          meals: (day.meals as Row[]).map((meal, j) => ({ ...meal, id: meal.id || `77777777-7777-4777-8777-${String(index * 100 + j + 1).padStart(12, '0')}`, plan_id: planId(index), is_eaten: state.plans.flatMap(plan => plan.meals as Row[]).find(previous => previous.id === meal.id)?.is_eaten ?? false })),
        }));
        data = { client_id: client, dietitian_id: owner, week_start: payload.p_week_start, week_end: dateAt(payload.p_week_start, 6), plans: state.plans };
      }
    } else if (url.pathname.includes('/storage/v1/object/sign/')) {
      if (method === 'POST') data = { signedURL: `/object/sign/recipe-images/${photo}?token=fixture` };
      else return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSUQAAAAASUVORK5CYII=', 'base64') });
    } else if (url.pathname.includes('/storage/') && method === 'DELETE') { state.storageDeletes.push(req.postDataJSON()); data = []; }
    else if (!['client_medical_conditions', 'client_medications'].includes(name ?? '')) state.unexpected.push(`${method} ${url.pathname}`);
    if (req.headers().accept?.includes('application/vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/tests/browser/feature-fixture.html?view=${options.view ?? 'meal-plans'}`);
  await expect(page.getByRole('heading', { level: 1, name: options.view === 'recipes' ? 'Tarifler' : 'Beslenme planı' })).toBeVisible();
  return { state, errors };
}

test('recipe library uses service data, cards only, search and canonical create/update/delete requests', async ({ page }) => {
  const { state, errors } = await fixture(page, { view: 'recipes' });
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/features/nutrition-recipes-desktop.png', fullPage: true });
  await expect(page.locator('.recipe-thumbnail').first()).toHaveAttribute('src', /object\/sign\/recipe-images/);
  await expect(page.locator('.recipe-thumbnail').first()).toHaveJSProperty('naturalWidth', 1);
  await expect(page.getByRole('button', { name: 'Kartlar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Liste', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Kütüphanede tarif ara' }).fill('yok');
  await expect(page.getByText('Aramanızla eşleşen tarif bulunamadı.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
  await page.getByRole('button', { name: 'Yeni tarif', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Yeni tarif', exact: true });
  await dialog.getByRole('textbox', { name: 'Tarif adı', exact: true }).fill('Yeni test tarifi');
  for (const [label, value] of [['Kalori', '400'], ['Protein', '20'], ['Karbonhidrat', '40'], ['Yağ', '15']]) await dialog.getByRole('spinbutton', { name: label, exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Tarifi oluştur' }).click();
  await expect(page.getByRole('status')).toContainText('Tarif oluşturuldu.');
  await expect(page.locator('.recipe-card')).toHaveCount(2);
  await page.locator('.recipe-card').filter({ hasText: 'Yeni test tarifi' }).getByRole('button', { name: 'Düzenle' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Tarif adı', exact: true }).fill('Düzenlenmiş test tarifi');
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await expect(page.locator('.recipe-card').filter({ hasText: 'Düzenlenmiş test tarifi' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Düzenlenmiş test tarifi tarifini sil' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Tarifi sil', exact: true });
  await confirmation.getByRole('button', { name: 'Vazgeç' }).click();
  expect(state.writes).not.toContain('recipes:DELETE');
  await page.getByRole('button', { name: 'Düzenlenmiş test tarifi tarifini sil' }).click();
  await confirmation.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  await page.reload(); await expect(page.locator('.recipe-card')).toHaveCount(1);
  expect(state.writes).toEqual(['recipes:POST', 'recipes:PATCH', 'recipes:DELETE']); expect(errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('failed recipe edit keeps form and image; failed delete keeps the recipe', async ({ page }) => {
  const { state } = await fixture(page, { view: 'recipes' }); state.failRecipeWrite = true;
  await page.getByRole('button', { name: 'Düzenle' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Tarif adı', exact: true }).fill('Kaydedilmeyen değişiklik');
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Tarif işlemi tamamlanamadı.');
  expect(state.storageDeletes).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Vazgeç' }).click();
  await expect(page.locator('.recipe-card')).toContainText('Kayıtlı test tarifi');
  await page.getByRole('button', { name: 'Kayıtlı test tarifi tarifini sil' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('Tarif işlemi tamamlanamadı.');
  expect(state.recipes).toHaveLength(1);
  await expect(page.getByText('private fixture write denied')).toHaveCount(0);
});

test('meal row name/time, saved photos, target, notes and canonical save survive reload', async ({ page }) => {
  const { state, errors } = await fixture(page);
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toBeVisible();
  await expect(page.locator('.plan-kpis > div')).toHaveCount(2);
  await expect(page.locator('.meal-target-card')).toContainText('1.500–1.800 kcal');
  await expect(page.locator('.meal-entry-photo img')).toHaveAttribute('src', /object\/sign\/recipe-images/);
  await expect(page.locator('.meal-entry-photo img')).toHaveJSProperty('naturalWidth', 1);
  await page.screenshot({ path: 'test-results/features/nutrition-plan-desktop.png', fullPage: true });
  await expect(page.getByText('Planlanan öğün', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Öğün satırı ekle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Öğün satırı ekle', exact: true });
  await page.screenshot({ path: 'test-results/features/nutrition-row-form.png' });
  await expect(dialog.locator('select')).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Öğün adı', exact: true }).fill('İkinci ara öğün');
  await dialog.getByLabel(/^Saat/).fill('16:45');
  await dialog.getByRole('button', { name: 'Satır ekle' }).click();
  await page.getByRole('button', { name: 'Salı İkinci ara öğün öğününe içerik ekle', exact: true }).click();
  await page.locator('.meal-plan-rail').getByRole('button', { name: /Tarifi sürükleyin.*Kayıtlı test tarifi/ }).click();
  await page.getByLabel('Pazartesi plan notu', { exact: true }).fill('Kaydedilecek günlük not');
  await page.getByRole('button', { name: 'Planı kaydet', exact: true }).click();
  await expect(page.getByText('Haftalık plan başarıyla kaydedildi.', { exact: true })).toBeVisible();
  expect(state.savedDays).toHaveLength(1);
  expect((state.savedDays[0][1].meals as Row[])[0]).toMatchObject({ slot_label: 'İkinci ara öğün', time: '16:45', source: 'recipe', recipe_id: recipeId, photo_url: photo });
  expect(state.savedDays[0][0].notes).toBe('Kaydedilecek günlük not');
  await page.reload();
  await expect(page.getByLabel('Pazartesi plan notu', { exact: true })).toHaveValue('Kaydedilecek günlük not');
  await expect(page.getByRole('textbox', { name: 'İkinci ara öğün saati (SS:DD)', exact: true })).toHaveValue('16:45');
  expect(errors).toEqual([]);
});

test('failed plan save preserves edits, then explicit retry saves; completed content stays locked', async ({ page }) => {
  const { state } = await fixture(page, { eaten: true });
  await expect(page.getByRole('button', { name: 'Tamamlanmış öğünün içeriği değiştirilemez', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tamamlanmış öğün taşınamaz', exact: true })).toBeDisabled();
  state.failPlanWrite = true;
  await page.getByLabel('Pazartesi plan notu', { exact: true }).fill('Başarısız kayıtta korunacak not');
  await page.getByRole('button', { name: 'Planı kaydet', exact: true }).click();
  await expect(page.getByText('Haftalık plan başarıyla kaydedildi.', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Pazartesi plan notu', { exact: true })).toHaveValue('Başarısız kayıtta korunacak not');
  await expect(page.getByRole('button', { name: 'Planı kaydet', exact: true })).toBeEnabled();
  state.failPlanWrite = false;
  await page.getByRole('button', { name: 'Planı kaydet', exact: true }).click();
  await expect(page.getByText('Haftalık plan başarıyla kaydedildi.', { exact: true })).toBeVisible();
  expect((state.savedDays[1][0].meals as Row[])[0].id).toBe(mealId);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tamamlanmış öğünün içeriği değiştirilemez', exact: true })).toBeDisabled();
});

test('mobile recipe drawer and cards fit the page; empty data never adds demo recipes or targets', async ({ page }) => {
  const { state, errors } = await fixture(page, { noTarget: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Henüz kalori hedefi belirlenmedi.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/features/nutrition-plan-mobile.png' });
  await page.getByRole('button', { name: 'Salı Kahvaltı öğününe içerik ekle', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Öğüne tarif ekle', exact: true });
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: 'test-results/features/nutrition-picker-mobile.png' });
  await drawer.getByRole('button', { name: /Tarifi sürükleyin.*Kayıtlı test tarifi/ }).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]); expect(errors).toEqual([]);
  await page.goto('/tests/browser/feature-fixture.html?view=recipes');
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.recipes = []; await page.reload();
  await expect(page.getByText('Henüz tarif eklenmedi.', { exact: true })).toBeVisible();
  await expect(page.locator('.recipe-card')).toHaveCount(0);
});

test('previous-week copy requires replacement confirmation and writes only on explicit save', async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toBeVisible();
  state.previousPlans = initialPlans().map((plan, index) => ({ ...plan, plan_date: dateAt(monday(), index - 7),
    notes: 'Önceki haftanın notu', meals: (plan.meals as Row[]).map(meal => ({ ...meal, title: 'Önceki haftanın öğünü' })),
  }));
  await page.getByRole('button', { name: 'Geçen haftayı kopyala', exact: true }).click();
  await expect(page.getByText('Mevcut hafta editöründe öğünler var.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toBeVisible();
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Editörde değiştir', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Önceki haftanın öğünü' })).toBeVisible();
  await expect(page.getByLabel('Pazartesi plan notu', { exact: true })).toHaveValue('Önceki haftanın notu');
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Planı kaydet', exact: true }).click();
  await expect(page.getByText('Haftalık plan başarıyla kaydedildi.', { exact: true })).toBeVisible();
  expect(state.writes).toEqual(['save_weekly_meal_plan']);
});

test('manual meal, snapshot edit and keyboard move keep nutrition and source when saved', async ({ page }) => {
  const { state } = await fixture(page);
  await page.getByRole('button', { name: 'Salı Kahvaltı öğününe içerik ekle', exact: true }).click();
  const picker = page.locator('.meal-plan-rail');
  await picker.getByRole('button', { name: 'Manuel öğün ekle', exact: true }).click();
  await picker.getByPlaceholder('Yemek Adı (Örn: 2 Haşlanmış Yumurta...)').fill('Manuel test öğünü');
  for (const [label, value] of [['Kalori (kcal)', '410'], ['Protein (g)', '20'], ['Karb (g)', '40'], ['Yağ (g)', '12']]) await picker.getByPlaceholder(label, { exact: true }).fill(value);
  await picker.getByRole('button', { name: 'Ekle', exact: true }).click();
  await page.getByRole('button', { name: 'Manuel test öğünü öğününü düzenle', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Öğün İçeriğini Düzenle', exact: true });
  await edit.getByLabel('Öğün adı', { exact: true }).fill('Düzenlenen manuel öğün');
  await edit.getByLabel('Kalori', { exact: true }).fill('420');
  await edit.getByRole('button', { name: 'Değişiklikleri Uygula', exact: true }).click();
  const move = page.getByRole('button', { name: 'Düzenlenen manuel öğün öğününü taşı', exact: true });
  await move.focus(); await page.keyboard.press('Enter');
  const moveDialog = page.getByRole('dialog', { name: 'Öğünü Taşı', exact: true });
  await moveDialog.getByLabel('Gün', { exact: true }).selectOption('Çarşamba');
  await moveDialog.getByRole('button', { name: 'Taşı', exact: true }).click();
  await page.getByRole('button', { name: 'Planı kaydet', exact: true }).click();
  await expect(page.getByText('Haftalık plan başarıyla kaydedildi.', { exact: true })).toBeVisible();
  expect(state.savedDays[0][1].meals).toEqual([]);
  expect((state.savedDays[0][2].meals as Row[])[0]).toMatchObject({ title: 'Düzenlenen manuel öğün', calories: 420, source: 'manual', recipe_id: null, macros: { protein: 20, carbs: 40, fat: 12 } });
});

test('target editor saves through existing RPC; plan clear needs confirmation and keeps backend unchanged', async ({ page }) => {
  const { state } = await fixture(page);
  await page.locator('.meal-target-card').getByRole('button', { name: 'Düzenle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Günlük enerji hedefi', exact: true });
  await dialog.getByLabel('Alt sınır (kcal)', { exact: true }).fill('1600');
  await dialog.getByLabel('Üst sınır (kcal)', { exact: true }).fill('1900');
  await dialog.getByRole('button', { name: 'Hedefi kaydet', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.meal-target-card')).toContainText('1.600–1.900 kcal');
  await page.getByRole('button', { name: 'Temizle', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Vazgeç', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toBeVisible();
  await page.getByRole('button', { name: 'Temizle', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Temizle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toHaveCount(0);
  expect(state.writes).toEqual(['set_client_nutrition_target']);
  await page.reload(); await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toBeVisible();
});

test('load failures show controlled errors, keep save disabled and recover through explicit retry', async ({ page }) => {
  const { state, errors } = await fixture(page, { view: 'recipes' });
  state.failLoad = true;
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.recipe-card')).toHaveCount(0);
  await expect(page.getByText('Henüz tarif eklenmedi.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('private fixture load failure')).toHaveCount(0);
  state.failLoad = false;
  await page.getByRole('button', { name: 'Tekrar dene', exact: true }).click();
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  state.failLoad = true;
  await page.goto('/tests/browser/feature-fixture.html?view=meal-plans');
  await expect(page.getByRole('button', { name: 'Aynı haftayı tekrar dene', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Planı kaydet', exact: true })).toBeDisabled();
  await expect(page.getByText('private fixture plan failure')).toHaveCount(0);
  state.failLoad = false;
  await page.getByRole('button', { name: 'Aynı haftayı tekrar dene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Öğün detayını aç: Kayıtlı öğün' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Planı kaydet', exact: true })).toBeEnabled();
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
