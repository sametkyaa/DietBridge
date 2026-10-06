import { test, expect, type Page } from '@playwright/test';
const actor='11111111-1111-4111-8111-111111111111';
const code='DB-ABCD-2345-EFGH-6789';
async function mockApi(page: Page) {
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
      data={dietitian_id:actor,code:name==='rotate_my_invite_code'?'DB-ABCD-2345-EFGH-6788':code,is_open:open,rotated_at:null};
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
  await page.getByRole('button',{name:'Linki kopyala'}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('https://app.dietbridge.com.tr/davet/DBABCD2345EFGH6789');
  await page.getByRole('button',{name:'QR oluştur'}).click();await expect(page.getByAltText('Diyetisyen davet bağlantısı QR kodu')).toBeVisible();
  await expect(page.getByRole('link',{name:'QR PNG indir'})).toHaveAttribute('download','dietbridge-davet.png');
  await expect(page.getByRole('link',{name:'WhatsApp’ta paylaş'})).toHaveAttribute('href',/wa\.me/);
  await page.getByRole('button',{name:'Yeni bağlantıları durdur'}).click();await expect(page.getByText('Yeni bağlantılar durduruldu',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Yeni bağlantıları aç'})).toBeVisible();
  await page.getByRole('button',{name:'Kodu yenile'}).click();await expect(page.getByText('Geçersiz olacak',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Evet, kodu yenile'}).click();await expect(page.getByText('DB-ABCD-2345-EFGH-6788',{exact:true})).toBeVisible();await expect(page.getByText('Davet kodunuz yenilendi.',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('default legacy client invitation still renders email entry',async({page})=>{
  test.skip(process.env.DIETBRIDGE_TEST_INVITE_MODE==='invite_code','This run verifies the invite-code feature flag.');
  const calls=await mockApi(page);await page.goto('/tests/browser/feature-fixture.html?view=legacy');
  await page.getByRole('button',{name:'Danışan Davet Et'}).click();await expect(page.getByLabel('Danışanın kayıtlı e-posta adresi')).toBeVisible();
  expect(calls).not.toContain('get_my_invite_code');
});
test('invite_code flag switches the actual client modal to code sharing',async({page})=>{
  test.skip(process.env.DIETBRIDGE_TEST_INVITE_MODE!=='invite_code','Run with DIETBRIDGE_TEST_INVITE_MODE=invite_code.');
  const calls=await mockApi(page);await page.goto('/tests/browser/feature-fixture.html?view=legacy');
  await page.getByRole('button',{name:'Danışan Davet Et'}).click();await expect(page.getByText(code,{exact:true})).toBeVisible();
  await expect(page.getByLabel('Danışanın kayıtlı e-posta adresi')).toHaveCount(0);expect(calls).toContain('get_my_invite_code');
  await expect(page.getByText('Kontenjan: 4 / 10 · Kalan: 6',{exact:false})).toBeVisible();
});
