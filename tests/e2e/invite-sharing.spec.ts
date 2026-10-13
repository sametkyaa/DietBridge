import { test, expect, type Page } from '@playwright/test';
const actor='11111111-1111-4111-8111-111111111111';
const code='ABCD-2345';
const legacyCode='DB-ABCD-2345-EFGH-6789';
async function mockApi(page: Page, shortCode: string | null = code) {
  await page.addInitScript(({id})=>{
    localStorage.setItem('sb-dietbridge-disposable-test-auth-token',JSON.stringify({access_token:'fake-test-jwt',refresh_token:'fake-test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated'}}));
  },{id:actor});
  const calls:string[]=[];let open=true;
  await page.route('https://dietbridge-disposable-test.invalid/**',async route=>{
    const url=new URL(route.request().url());const name=url.pathname.split('/').at(-1)!;calls.push(name);
    let data:unknown=[];
    if(name==='user') data={id:actor,email:'disposable@example.invalid',aud:'authenticated',role:'authenticated'};
    else if(['get_my_invite_code','rotate_my_invite_code','set_my_invite_code_open'].includes(name)){
      if(name==='set_my_invite_code_open') open=route.request().postDataJSON().p_is_open;
      data={dietitian_id:actor,code:name==='rotate_my_invite_code'?'DB-ABCD-2345-EFGH-6788':legacyCode,
        ...(shortCode === null ? {} : {short_code:name==='rotate_my_invite_code'?'EFGH-6788':shortCode}),is_open:open,rotated_at:null};
    }else if(name==='get_dietitian_subscription_overview') data=[{plan_id:'core',plan_name:'Core',subscription_status:'active',plan_limit:10,effective_limit:10,active_count:3,pending_count:1,used:4,remaining:6,limit_reached:false}];
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  return calls;
}
test('code copy, HTTPS link, QR PNG, WhatsApp and pause controls render without backend writes',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await mockApi(page);await page.goto('/tests/browser/feature-fixture.html');
  await expect(page.getByText(code,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Kodu kopyala',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
  await page.getByRole('button',{name:'Linki kopyala'}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('https://app.dietbridge.com.tr/davet/ABCD2345');
  await page.getByRole('button',{name:'QR oluştur'}).click();await expect(page.getByAltText('Diyetisyen davet bağlantısı QR kodu')).toBeVisible();
  await expect(page.getByRole('link',{name:'QR PNG indir'})).toHaveAttribute('download','dietbridge-davet.png');
  await expect(page.getByRole('link',{name:'WhatsApp’ta paylaş'})).toHaveAttribute('href',/wa\.me/);
  await page.getByRole('button',{name:'Yeni bağlantıları durdur'}).click();await expect(page.getByText('Yeni bağlantılar durduruldu',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Yeni bağlantıları aç'})).toBeVisible();
  await page.getByRole('button',{name:'Kodu yenile'}).click();await expect(page.getByText('Geçersiz olacak',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Evet, kodu yenile'}).click();await expect(page.getByText('EFGH-6788',{exact:true})).toBeVisible();await expect(page.getByText('Davet kodunuz yenilendi.',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('a backend without short aliases still shows the complete existing code', async ({page}) => {
  await mockApi(page, null);
  await page.goto('/tests/browser/feature-fixture.html');
  await expect(page.getByText(legacyCode, {exact:true})).toBeVisible();
});

test('an invalid short alias never becomes a misleading shareable invitation', async ({page}) => {
  await mockApi(page, 'ABCD-234I');
  await page.goto('/tests/browser/feature-fixture.html');
  await expect(page.getByRole('alert')).toHaveText('İşlem tamamlanamadı. Lütfen tekrar deneyin.');
  await expect(page.getByRole('button', {name:'Kodu kopyala', exact:true})).toHaveCount(0);
});

test('short and previously shared long URLs open the mobile landing page', async ({page}) => {
  for (const [path, display, native] of [
    ['ABCD2345', 'ABCD-2345', 'ABCD2345'],
    ['DBABCD2345EFGH6789', legacyCode, 'DBABCD2345EFGH6789'],
  ]) {
    await page.goto(`/davet/${path}`);
    await expect(page.getByRole('heading', {name:'DietBridge daveti'})).toBeVisible();
    await expect(page.getByText(display, {exact:true})).toBeVisible();
    await expect(page.getByRole('link', {name:'Mobil uygulamada aç'})).toHaveAttribute('href', `dietbridge://davet/${native}`);
  }
});
test('default legacy client invitation still renders email entry',async({page})=>{
  test.skip(process.env.DIETBRIDGE_TEST_INVITE_MODE==='invite_code','This run verifies the invite-code feature flag.');
  const calls=await mockApi(page);await page.goto('/tests/browser/feature-fixture.html?view=legacy');
  await page.getByRole('button',{name:'Danışan Davet Et'}).click();await expect(page.getByLabel('Danışanın kayıtlı e-posta adresi')).toBeVisible();
  expect(calls).not.toContain('get_my_invite_code');
});

test('client notification icon stays centered on desktop and hidden on mobile', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/tests/browser/feature-fixture.html?view=legacy');
  const bell = page.getByTestId('notification-bell');
  await expect(bell).toBeVisible();
  const button = await bell.boundingBox();
  const icon = await bell.locator('svg').boundingBox();
  expect(button).not.toBeNull();
  expect(icon).not.toBeNull();
  expect(Math.abs((button!.x + button!.width / 2) - (icon!.x + icon!.width / 2))).toBeLessThan(1);
  expect(Math.abs((button!.y + button!.height / 2) - (icon!.y + icon!.height / 2))).toBeLessThan(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(bell).toBeHidden();
});
test('invite_code flag switches the actual client modal to code sharing',async({page})=>{
  test.skip(process.env.DIETBRIDGE_TEST_INVITE_MODE!=='invite_code','Run with DIETBRIDGE_TEST_INVITE_MODE=invite_code.');
  const calls=await mockApi(page);await page.goto('/tests/browser/feature-fixture.html?view=legacy');
  await page.getByRole('button',{name:'Danışan Davet Et'}).click();await expect(page.getByText(code,{exact:true})).toBeVisible();
  await expect(page.getByLabel('Danışanın kayıtlı e-posta adresi')).toHaveCount(0);expect(calls).toContain('get_my_invite_code');
  await expect(page.getByText('Kontenjan: 4 / 10 · Kalan: 6',{exact:false})).toBeVisible();
});
