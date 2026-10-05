import { test,expect,type Page } from '@playwright/test';
const actor='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';
const itemId='33333333-3333-4333-8333-333333333333',item2='44444444-4444-4444-8444-444444444444';
async function mockImport(page:Page,{extractionFailure=false,saveFailure=false}={}) {
  const saved:unknown[][]=[];let status='uploaded';
  const job=()=>({id:jobId,dietitian_id:actor,status,source_file_name:'tarifler.csv',source_storage_path:`${actor}/${jobId}/source.csv`,error_code:status==='failed'?'invalid_output':null,expires_at:new Date(Date.now()+86400000).toISOString()});
  await page.addInitScript(({id})=>{localStorage.setItem('sb-dietbridge-disposable-test-auth-token',JSON.stringify({access_token:'fake-test-jwt',refresh_token:'fake-test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated'}}));},{id:actor});
  await page.route('https://dietbridge-disposable-test.invalid/**',async route=>{
    const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').at(-1)!;let data:unknown=[];let code=200;
    if(name==='user')data={id:actor,email:'disposable@example.invalid',aud:'authenticated',role:'authenticated'};
    else if(name==='recipe_import_limits')data={maxBytes:5242880,maxRecipes:20,maxRows:200,maxColumns:50,maxExpandedBytes:20971520,retentionHours:24};
    else if(name==='begin_recipe_import')data=job();
    else if(url.pathname.includes('/storage/'))data={Key:`recipe-imports/${job().source_storage_path}`};
    else if(name==='process-recipe-import'){status=extractionFailure?'failed':'ready';data=extractionFailure?{error:'invalid_output'}:{status:'ready',jobId};code=extractionFailure?422:200;}
    else if(name==='recipe_import_jobs')data=url.searchParams.has('id')?job():[];
    else if(name==='recipe_import_items')data=[{id:itemId,recipe_draft:{name:'Çorba',description:'Mercimek',mealType:'lunch',calories:null,macros:{protein:10,carbs:30,fat:5}},source_reference:{sheet:'CSV',row:2},warnings:[]},{id:item2,recipe_draft:{name:'Salata',description:null,mealType:'dinner',calories:200,macros:{protein:5,carbs:10,fat:12}},source_reference:{sheet:'CSV',row:3},warnings:[]}];
    else if(name==='save_recipe_import'){saved.push(request.postDataJSON().p_selected);data=saveFailure?{code:'23514',message:'private raw SQL should never display'}:['55555555-5555-4555-8555-555555555555'];code=saveFailure?400:200;status=saveFailure?'ready':'saved';}
    await route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(data)});
  });return saved;
}
const csv={name:'tarifler.csv',mimeType:'text/csv',buffer:Buffer.from('Tarif Adı,Öğün,Kalori,Protein,Karb,Yağ\nÇorba,Öğle,,10,30,5\nSalata,Akşam,200,5,10,12\n')};
test('single-file drag and drop follows the same validated preview flow',async({page})=>{
  const saved=await mockImport(page);await page.goto('/tests/browser/feature-fixture.html?view=import');
  await expect(page.getByLabel(/Tarif dosyası/)).toBeEnabled();
  const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['Ad,Kalori\nÇorba,200\n'],'tarifler.csv',{type:'text/csv'}));return data;});
  await page.getByText('Bir dosyayı buraya sürükleyin veya seçin.').dispatchEvent('drop',{dataTransfer:transfer});
  await page.getByRole('button',{name:'Tarifleri oku'}).click();await expect(page.getByLabel('Tarif 1 adı',{exact:true})).toHaveValue('Çorba');expect(saved).toHaveLength(0);
});
test('upload → preview → edit → selected explicit save uses canonical nutrition',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const saved=await mockImport(page);
  await page.goto('/tests/browser/feature-fixture.html?view=import');await expect(page.getByText('Danışanlara ait kişisel veya sağlık bilgilerini içeren dosyaları yüklemeyin.')).toBeVisible();
  await page.getByLabel(/Tarif dosyası/).setInputFiles(csv);await page.getByRole('button',{name:'Tarifleri oku'}).click();
  await expect(page.getByLabel('Tarif 1 adı',{exact:true})).toHaveValue('Çorba');expect(saved).toHaveLength(0);
  await page.screenshot({path:'test-results/features/recipe-preview-desktop.png',fullPage:true});
  await page.getByLabel('Tarif 2 seç',{exact:true}).uncheck();await page.getByLabel('Tarif 1 seç',{exact:true}).check();
  await expect(page.getByRole('button',{name:/Seçilenleri kaydet/})).toBeDisabled();
  await page.getByLabel('Tarif 1 calories',{exact:true}).fill('250');await page.getByLabel('Tarif 1 adı',{exact:true}).fill('Düzenlenen çorba');
  await page.getByRole('button',{name:/Seçilenleri kaydet/}).click();expect(saved).toHaveLength(0);await page.getByRole('button',{name:'Onayla ve kaydet'}).click();
  await expect(page.getByRole('status')).toHaveText('1 tarif kaydedildi.');expect(saved).toHaveLength(1);expect(saved[0]).toEqual([{id:itemId,input:{name:'Düzenlenen çorba',description:'Mercimek',mealType:'lunch',calories:250,macros:{protein:10,carbs:30,fat:5}}}]);expect(errors).toEqual([]);
});
test('preview remains usable at a narrow viewport without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:375,height:812});await mockImport(page);await page.goto('/tests/browser/feature-fixture.html?view=import');await page.getByLabel(/Tarif dosyası/).setInputFiles(csv);await page.getByRole('button',{name:'Tarifleri oku'}).click();
  await expect(page.getByLabel('Tarif 1 adı',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/features/recipe-preview-narrow.png',fullPage:true});
});
test('extraction errors create no recipe and show controlled error',async({page})=>{
  const saved=await mockImport(page,{extractionFailure:true});await page.goto('/tests/browser/feature-fixture.html?view=import');await page.getByLabel(/Tarif dosyası/).setInputFiles(csv);await page.getByRole('button',{name:'Tarifleri oku'}).click();
  await expect(page.getByRole('alert')).toHaveText(/güvenilir biçimde okunamadı/);expect(saved).toHaveLength(0);await expect(page.getByRole('button',{name:/Seçilenleri kaydet/})).toHaveCount(0);
});
test('failed transaction preserves editable preview and never shows success',async({page})=>{
  await mockImport(page,{saveFailure:true});await page.goto('/tests/browser/feature-fixture.html?view=import');await page.getByLabel(/Tarif dosyası/).setInputFiles(csv);await page.getByRole('button',{name:'Tarifleri oku'}).click();
  await page.getByRole('button',{name:/Seçilenleri kaydet/}).click();await page.getByRole('button',{name:'Onayla ve kaydet'}).click();
  await expect(page.getByRole('alert')).toHaveText(/kaydedilemedi/);await expect(page.getByLabel('Tarif 2 adı',{exact:true})).toHaveValue('Salata');await expect(page.getByText('private raw SQL should never display')).toHaveCount(0);await expect(page.getByText('1 tarif kaydedildi.')).toHaveCount(0);
});
