import {createClient} from '@supabase/supabase-js';
import {chromium,expect} from '@playwright/test';
import * as XLSX from 'xlsx';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicit approval only. Never print SDK/CLI/browser error payloads or persist credentials.
const opt=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return[a.slice(0,i),a.slice(i+1)];}));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),ref='kagvxhyvxxypspdxcuxz',url=`https://${ref}.supabase.co`;
const ensure=(ok,label)=>{if(!ok)throw new Error(label);};
ensure(opt['--approval']==='APPROVE_RECIPE_SYNTHETIC_SMOKE'&&opt['--project-ref']===ref,'Explicit target approval required');
const privateDir=realpathSync(opt['--manifest-dir']),cli=opt['--cli'];
ensure(privateDir.replaceAll('\\','/').startsWith('C:/dev/DietBridge-Backups/recipe-smoke-'),'Unexpected private directory');
const manifestPath=join(privateDir,'ownership.json'),recoverOnly=opt['--recover-only']==='true';ensure(recoverOnly?existsSync(manifestPath):!existsSync(manifestPath),'Manifest lifecycle mismatch');
const m=recoverOnly?JSON.parse(readFileSync(manifestPath,'utf8')):{run_id:randomUUID(),approval:opt['--approval'],target_ref:ref,started_at:new Date().toISOString(),status:'STARTED',identity_checks:0,
  caps:{actors:2,jobs:4,recipes:3},actors:['primary','foreign'].map(label=>({label,id:randomUUID(),created:false})),requests:[],jobs:[],objects:[],recipe_ids:[],checks:[],http:[],openai_called:false,feature_flag:'OFF'};
ensure(/^[0-9a-f-]{36}$/.test(m.run_id)&&m.target_ref===ref&&m.approval===opt['--approval']&&m.actors.length===2&&m.actors.every(a=>/^[0-9a-f-]{36}$/.test(a.id))&&m.jobs.length<=4&&m.recipe_ids.length<=3,'Manifest ownership/cap mismatch');
ensure(!recoverOnly||m.cleanup_receipt?.status!=='PASS','Completed cleanup must not be replayed');
const save=()=>{writeFileSync(manifestPath+'.tmp',JSON.stringify(m,null,2));renameSync(manifestPath+'.tmp',manifestPath);};save();
const rawCli=args=>{try{return execFileSync(cli,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}catch{throw new Error('CLI operation failed; raw output suppressed');}};
const verify=()=>{
  ensure(readFileSync(join(root,'supabase/.temp/project-ref'),'utf8').trim()===ref,'Linked target mismatch');
  ensure(rawCli(['--version']).trim()==='2.110.0','CLI version mismatch');
  const data=JSON.parse(rawCli(['projects','list','--output','json']));const p=(Array.isArray(data)?data:data.projects).find(p=>p.id===ref);
  ensure(p?.name==='dietbridge_Production'&&p.region==='eu-central-1'&&p.status==='ACTIVE_HEALTHY'&&p.database?.version==='17.6.1.052','Production identity mismatch');m.identity_checks++;save();
};
const result=(r,label)=>{ensure(!r.error,label);return r.data;};
const mutate=async(label,fn)=>{verify();return result(await fn(),label);};
const pass=label=>{m.checks.push(label);save();process.stdout.write('PASS '+label+'\n');};
const sql=(query,writing=false)=>{if(writing)verify();const file=join(privateDir,'scoped-verification.sql');writeFileSync(file,query);const r=JSON.parse(rawCli(['db','query','--linked','--file',file,'--output','json']));ensure(Array.isArray(r.rows),'Missing SQL result');return r.rows;};
const ids=`ARRAY[${m.actors.map(a=>`'${a.id}'::uuid`).join(',')}]::uuid[]`;
const uuid=id=>/^[0-9a-f-]{36}$/.test(id);
const ownedJob=id=>ensure(m.jobs.some(j=>j.id===id),'Unowned job');
const fetchScoped=(input,init)=>{ensure(new URL(typeof input==='string'?input:input.url??String(input)).origin===url,'Unexpected network target');return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});};
const clientOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetchScoped}};
let admin,anonKey,server,browser,context,failure,cleanupFailure;const actors=[];
const fingerprint=()=>{
  const tables=sql("select tablename from pg_tables where schemaname='public' order by tablename;").map(r=>r.tablename);
  ensure(tables.every(t=>/^[a-z_][a-z0-9_]*$/.test(t)),'Unexpected catalog identifier');
  const ownerFilter=`not exists(select 1 from unnest(${ids}) u(id) where position(u.id::text in to_jsonb(t)::text)>0)`;
  const queries=tables.map(t=>`select '${t}' as relation,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public."${t}" t where ${ownerFilter}`);
  queries.push(`select 'auth.users',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from auth.users t where id<>all(${ids})`);
  queries.push(`select 'storage.objects',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from storage.objects t where ${ownerFilter}`);
  queries.push("select 'cron.job',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by jobid),'')) from cron.job t");
  return sql('begin transaction read only;'+queries.join(' union all ')+';rollback;');
};
const counts=()=>sql(`select jsonb_build_object(
 'auth_users',(select count(*) from auth.users where id=any(${ids})),
 'sessions',(select count(*) from auth.sessions where user_id=any(${ids})),
 'identities',(select count(*) from auth.identities where user_id=any(${ids})),
 'refresh_tokens',(select count(*) from auth.refresh_tokens where user_id::text=any(${ids}::text[])),
 'auth_audit',(select count(*) from auth.audit_log_entries where payload->>'actor_id'=any(${ids}::text[]) or payload::text like '%${m.run_id}%'),
 'profiles',(select count(*) from public.profiles where id=any(${ids})),
 'dietitian_profiles',(select count(*) from public.dietitian_profiles where user_id=any(${ids})),
 'subscriptions',(select count(*) from public.dietitian_subscriptions where dietitian_id=any(${ids})),
 'verification_audit',(select count(*) from public.dietitian_verification_audit where subject_user_id_snapshot=any(${ids})),
 'recipes',(select count(*) from public.recipes where dietitian_id=any(${ids})),
 'jobs',(select count(*) from public.recipe_import_jobs where dietitian_id=any(${ids})),
 'items',(select count(*) from public.recipe_import_items where dietitian_id=any(${ids})),
 'storage',(select count(*) from storage.objects where bucket_id='recipe-imports' and split_part(name,'/',1)=any(${ids}::text[])),
 'relationships',(select count(*) from public.dietitian_clients where client_id=any(${ids}) or dietitian_id=any(${ids})),
 'notifications',(select count(*) from public.notifications where recipient_id=any(${ids}) or actor_id=any(${ids})),
 'invites',(select count(*) from public.dietitian_invite_codes where dietitian_id=any(${ids}))
 ) as remaining;`)[0].remaining;
const reconcile=async()=>{
  const rows=result(await admin.from('recipe_import_jobs').select('*').in('dietitian_id',m.actors.map(a=>a.id)),'Owned jobs inventory failed');
  ensure(rows.length<=m.caps.jobs,'Owned job cap exceeded');
  for(const j of rows){ensure(m.requests.some(r=>r.id===j.request_id&&r.actor===j.dietitian_id),'Job intent mismatch');ensure(j.source_storage_path===`${j.dietitian_id}/${j.id}/source.${j.source_file_name.split('.').at(-1)}`,'Owned path mismatch');if(!m.jobs.some(x=>x.id===j.id))m.jobs.push({id:j.id,actor:j.dietitian_id,path:j.source_storage_path,request_id:j.request_id});}
  const recipes=result(await admin.from('recipes').select('id').in('dietitian_id',m.actors.map(a=>a.id)),'Owned recipe inventory failed');ensure(recipes.length<=m.caps.recipes,'Recipe cap exceeded');m.recipe_ids=recipes.map(r=>r.id);
  const derived=result(await admin.from('recipe_import_items').select('id,import_job_id,dietitian_id,saved_recipe_id').in('dietitian_id',m.actors.map(a=>a.id)),'Owned item inventory failed');ensure(derived.length<=80&&derived.every(i=>m.jobs.some(j=>j.id===i.import_job_id&&j.actor===i.dietitian_id)),'Item ownership/cap mismatch');m.items=derived;
  m.job_receipts=rows.map(j=>({id:j.id,status:j.status,error_code:j.error_code,cleanup_pending:j.cleanup_pending,raw_deleted_at:j.raw_deleted_at,ai_model:j.ai_model,ai_attempt_count:j.ai_attempt_count}));save();return rows;
};
const canonical=async a=>result(await admin.from('recipes').select('id,name,description,meal_type,calories,protein,carbs,fat,image_path').eq('dietitian_id',a.id),'Owned canonical read failed');
const job=async id=>{ownedJob(id);return result(await admin.from('recipe_import_jobs').select('*').eq('id',id).single(),'Owned receipt read failed');};
const items=async id=>{ownedJob(id);return result(await admin.from('recipe_import_items').select('*').eq('import_job_id',id),'Owned drafts read failed').sort((a,b)=>a.source_reference.row-b.source_reference.row);};
const sourceGone=async j=>{
  const row=await job(j.id);ensure(!row.cleanup_pending&&row.raw_deleted_at,'Cleanup acknowledgement missing');
  ensure((await admin.storage.from('recipe-imports').download(j.path??j.source_storage_path)).error,'Source remains readable');
  ensure(sql(`select count(*)::int as n from storage.objects where bucket_id='recipe-imports' and name='${j.path??j.source_storage_path}';`)[0].n===0,'Source object residue');
};
const createActor=async intent=>{
  intent.email=`db-recipe-${m.run_id}-${intent.label}@example.invalid`;save();const password='DbSm0ke!'+randomUUID();
  const data=await mutate('Owned Auth creation failed',()=>admin.auth.admin.createUser({id:intent.id,email:intent.email,password,email_confirm:true,user_metadata:{account_type:'dietitian',role:'dietitian',full_name:'Synthetic Recipe '+intent.label,recipe_smoke_run:m.run_id}}));
  ensure(data.user?.id===intent.id&&data.user.user_metadata?.recipe_smoke_run===m.run_id,'Owned Auth identity mismatch');intent.created=true;save();
  const rows=await mutate('Owned verification setup failed',()=>admin.from('dietitian_profiles').update({verification_status:'approved',is_verified:true}).eq('user_id',intent.id).select('user_id'));ensure(rows.length===1,'Verification setup count mismatch');
  const client=createClient(url,anonKey,clientOptions),session=await mutate('Owned login failed',()=>client.auth.signInWithPassword({email:intent.email,password}));ensure(session.user.id===intent.id,'Login identity mismatch');
  const a={id:intent.id,client,session:session.session};actors.push(a);return a;
};
const begin=async(a,file)=>{
  ensure(m.requests.length<m.caps.jobs,'Job intent cap exceeded');const request={id:randomUUID(),actor:a.id,file:file.name};m.requests.push(request);save();
  const j=await mutate('Owned begin failed',()=>a.client.rpc('begin_recipe_import',{p_request_id:request.id,p_name:file.name,p_mime:file.mimeType,p_size:file.buffer.length}));await reconcile();ownedJob(j.id);return j;
};
const upload=async(a,j,file)=>{ownedJob(j.id);m.objects.push({path:j.source_storage_path,job_id:j.id,actor:a.id,sha256:createHash('sha256').update(file.buffer).digest('hex')});save();await mutate('Owned upload failed',()=>a.client.storage.from('recipe-imports').upload(j.source_storage_path,file.buffer,{contentType:file.mimeType,upsert:false}));};
const invokeProcess=async(a,j)=>{ownedJob(j.id);verify();const r=await fetchScoped(url+'/functions/v1/process-recipe-import',{method:'POST',headers:{apikey:anonKey,Authorization:'Bearer '+a.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({jobId:j.id})});m.http.push({function:'process-recipe-import',job_id:j.id,status:r.status,request_id:r.headers.get('sb-request-id'),execution_id:r.headers.get('x-deno-execution-id')});save();return {status:r.status,data:await r.json()};};
try{
 verify();
 if(recoverOnly){const keys=JSON.parse(rawCli(['projects','api-keys','--project-ref',ref,'--reveal','--output','json']));const service=keys.find(k=>k.name==='service_role')?.api_key;anonKey=keys.find(k=>k.name==='anon')?.api_key;ensure(service&&anonKey,'Recovery API keys unavailable');for(const[k,role]of[[service,'service_role'],[anonKey,'anon']]){const c=JSON.parse(Buffer.from(k.split('.')[1],'base64url'));ensure(c.ref===ref&&c.role===role,'Recovery key target mismatch');}admin=createClient(url,service,clientOptions);throw new Error('Prior XLSX extraction_failed; recover owned fixtures only');}
 const e=JSON.parse(readFileSync(join(root,'docs/INVITE_RECIPE_ROLLOUT_EVIDENCE.json'),'utf8'));
 ensure(['RECIPE_CLEANUP_CRON_LIVE_PASS','RECIPE_PROCESS_EDGE_REDEPLOYED_PASS'].includes(e.phase),'Prior gate is not PASS');
 ensure(opt['--storage-approval']==='APPROVE_RECIPE_STORAGE_NEGATIVE_SMOKE','Storage negative approval required');
 const flight=sql(readFileSync(join(root,'supabase/preflight/recipe_metrics_postflight.sql'),'utf8'));ensure(flight.length===21&&flight.filter(x=>x.check_id!=='17_cron_not_enabled').every(x=>x.status==='PASS'),'Recipe schema preflight failed');
 const cron=sql(readFileSync(join(root,'supabase/preflight/recipe_cleanup_cron_postflight.sql'),'utf8'));ensure(cron.length===8&&cron.every(x=>x.status==='PASS'),'Cleanup operational preflight failed');
 const existing=sql("select count(*)::int as jobs,(select count(*) from storage.objects where bucket_id='recipe-imports')::int as objects from public.recipe_import_jobs;")[0];ensure(existing.jobs===0&&existing.objects===0,'Existing import resources; stop before fixtures');
 for(const source of e.recipeEdgeDeployment.sourceManifest.sources)ensure(createHash('sha256').update(readFileSync(join(root,source.file))).digest('hex').toUpperCase()===source.sha256.toUpperCase(),'Reviewed Edge source drift');
 const keys=JSON.parse(rawCli(['projects','api-keys','--project-ref',ref,'--reveal','--output','json']));const service=keys.find(k=>k.name==='service_role')?.api_key;anonKey=keys.find(k=>k.name==='anon')?.api_key;ensure(service&&anonKey,'API keys unavailable');
 for(const[k,role]of[[service,'service_role'],[anonKey,'anon']]){const c=JSON.parse(Buffer.from(k.split('.')[1],'base64url'));ensure(c.ref===ref&&c.role===role,'Key target mismatch');}
 admin=createClient(url,service,clientOptions);m.baseline=fingerprint();save();pass('schema, Edge prerequisites and unrelated baseline');
 // Credentials remain in browser memory; no storage-state files, traces or HAR.
 const {createServer}=await import('vite');server=await createServer({root,envDir:privateDir,logLevel:'silent',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(url),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(anonKey),'import.meta.env.VITE_RECIPE_IMPORT_ENABLED':'false','import.meta.env.VITE_CLIENT_INVITE_MODE':JSON.stringify('legacy_email')},server:{host:'127.0.0.1',port:0}});await server.listen();
 browser=await chromium.launch({headless:true});context=await browser.newContext();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const health=await context.newPage();await health.goto(origin+'/tests/browser/feature-fixture.html?view=import');await expect(health.getByRole('dialog')).toBeVisible();ensure(await health.locator('vite-error-overlay').count()===0,'Vite overlay');await health.close();pass('local dialog renders with import flag OFF');
 const primary=await createActor(m.actors[0]),foreign=await createActor(m.actors[1]);
 const rows=[['Tarif Adı','Öğün','Kalori','Protein','Karb','Yağ','Malzemeler','Yapılış'],['Sentetik çorba','Öğle',200,10,30,5,'mercimek','pişir'],['Sentetik çorba','Akşam',180,8,25,4,'sebze','karıştır'],['Sentetik eksik','Ara Öğün','','','','','yoğurt','karıştır']];
 const csv={name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(rows.map(r=>r.join(';')).join('\n')+'\n')};
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Sentetik');const xlsx={name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})};
 // Before each browser mutation recheck exact full production identity and persist its ownership intent.
 context=await browser.newContext();await context.addInitScript(({session,ref})=>localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify(session)),{session:primary.session,ref});
 let browserFailure=false;const pageErrors=[];
 await context.route('**/*',async route=>{try{
  const req=route.request(),u=new URL(req.url());if(u.origin===origin)return await route.continue();if(u.origin!==url)return await route.abort();
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){
   const endpoint=u.pathname.split('/').at(-1),body=u.pathname.startsWith('/storage/')?null:req.postDataJSON();
   if(endpoint==='recipe_import_limits')return await route.continue();
   if(endpoint==='begin_recipe_import'){ensure(m.requests.length<m.caps.jobs&&uuid(body.p_request_id)&&['synthetic.csv','synthetic.xlsx'].includes(body.p_name),'Unexpected browser import intent');m.requests.push({id:body.p_request_id,actor:primary.id,file:body.p_name});save();}
   else if(u.pathname.startsWith('/storage/v1/object/recipe-imports/')){const path=decodeURIComponent(u.pathname.split('/recipe-imports/')[1]);ensure(path.startsWith(primary.id+'/')&&/\/source\.(csv|xlsx)$/.test(path),'Unexpected browser Storage write');await reconcile();ensure(m.jobs.some(j=>j.path===path),'Storage intent missing');m.objects.push({path,actor:primary.id,job_id:m.jobs.find(j=>j.path===path).id});save();}
   else if(endpoint==='process-recipe-import'){await reconcile();ownedJob(body.jobId);}
   else if(endpoint==='save_recipe_import'){ownedJob(body.p_job_id);ensure(body.p_selected.length>=1&&body.p_selected.length<=2,'Unexpected browser save size');}
   else throw new Error('Unexpected browser mutation');
   verify();
  }await route.continue();
 }catch{browserFailure=true;m.browser_guard_rejected=true;save();await route.abort();}});
 const sameName='Sentetik düzenlenen '+m.run_id;
 for(const [kind,file]of[['CSV',csv],['XLSX',xlsx]]){
  m.stage=kind+' dialog initialization';save();const page=await context.newPage();page.on('pageerror',()=>pageErrors.push('Browser page error'));
  await page.goto(origin+'/tests/browser/feature-fixture.html?view=import');await expect(page.getByLabel(/Tarif dosyası/)).toBeEnabled({timeout:30000});
  m.stage=kind+' local file inspection';save();await page.getByLabel(/Tarif dosyası/).setInputFiles(file);await expect(page.getByRole('button',{name:'Tarifleri oku'})).toBeEnabled();
  m.stage=kind+' live upload and process';save();const before=(await canonical(primary)).length;await page.getByRole('button',{name:'Tarifleri oku'}).click();await expect(page.getByLabel('Tarif 1 adı',{exact:true})).toBeVisible({timeout:60000});
  ensure(!browserFailure,'Browser mutation guard rejected action');const allJobs=await reconcile(),j=allJobs.find(j=>j.source_file_name===file.name);ownedJob(j.id);const drafts=await items(j.id);
  ensure(drafts.length===3&&drafts[2].recipe_draft.calories===null&&Object.values(drafts[2].recipe_draft.macros).every(v=>v===null),'Missing nutrition was fabricated');
  await expect(page.getByLabel('Tarif 3 calories',{exact:true})).toHaveValue('');await expect(page.getByLabel('Tarif 3 seç',{exact:true})).not.toBeChecked();
  ensure(drafts[1].warnings.some(w=>w.startsWith('Aynı adlı')),'Duplicate warning missing');
  ensure((await canonical(primary)).length===before,'Preview created canonical recipe');await sourceGone(j);
  ensure([j.ai_model,j.ai_input_tokens,j.ai_output_tokens,j.ai_attempt_count,j.ai_duration_ms].every(v=>v===null),'Unexpected AI metrics');
  // RLS, private source read and cross-owner save/worker cannot expose or mutate this import.
  ensure(result(await foreign.client.from('recipe_import_jobs').select('id').eq('id',j.id),'Foreign job read error').length===0,'Cross-owner job exposed');
  ensure(result(await foreign.client.from('recipe_import_items').select('id').eq('import_job_id',j.id),'Foreign item read error').length===0,'Cross-owner item exposed');
  verify();ensure((await foreign.client.rpc('save_recipe_import',{p_job_id:j.id,p_selected:[{id:drafts[0].id,input:{name:'Denied',description:null,mealType:'lunch',calories:200,macros:{protein:10,carbs:30,fat:5}}}]})).error,'Cross-owner save allowed');
  await page.getByLabel('Tarif 1 adı',{exact:true}).fill(sameName);await page.getByLabel('Tarif 1 açıklama',{exact:true}).fill('Sentetik düzenleme');await page.getByLabel('Tarif 1 öğün',{exact:true}).selectOption('dinner');await page.getByLabel('Tarif 1 calories',{exact:true}).fill('245');await page.getByLabel('Tarif 1 protein',{exact:true}).fill('12.5');
  if(kind==='CSV')await page.getByLabel('Tarif 2 seç',{exact:true}).uncheck();else await page.getByLabel('Tarif 2 adı',{exact:true}).fill(sameName);
  await page.getByLabel('Tarif 3 seç',{exact:true}).check();await expect(page.getByRole('button',{name:/Seçilenleri kaydet/})).toBeDisabled();await page.getByLabel('Tarif 3 seç',{exact:true}).uncheck();
  await page.getByRole('button',{name:/Seçilenleri kaydet/}).click();ensure((await canonical(primary)).length===before,'Confirmation produced premature save');
  m.stage=kind+' explicit save and receipt';save();
  if(kind==='CSV'){
   const deniedProfile=await mutate('Owned negative verification setup failed',()=>admin.from('dietitian_profiles').update({verification_status:'pending',is_verified:false}).eq('user_id',primary.id).select('user_id,verification_status,is_verified'));ensure(deniedProfile.length===1&&deniedProfile[0].verification_status==='pending'&&!deniedProfile[0].is_verified,'Negative fixture must be unapproved');
   await page.getByRole('button',{name:'Onayla ve kaydet'}).click();await expect(page.getByRole('alert')).toHaveText(/kaydedilemedi/);await expect(page.getByLabel('Tarif 1 adı',{exact:true})).toHaveValue(sameName);ensure(await page.getByText('1 tarif kaydedildi.').count()===0,'Failed save showed fake success');ensure((await canonical(primary)).length===before&&(await job(j.id)).status==='ready','Failed save changed state');
   const restored=await mutate('Owned verification restore failed',()=>admin.from('dietitian_profiles').update({verification_status:'approved',is_verified:true}).eq('user_id',primary.id).select('user_id,verification_status,is_verified'));ensure(restored.length===1&&restored[0].is_verified&&restored[0].verification_status==='approved','Negative fixture approval restore failed');pass('real rejected save preserves editable preview and has no fake success');
  }
  const n=kind==='CSV'?1:2;await page.getByRole('button',{name:'Onayla ve kaydet'}).click();await expect(page.getByRole('status')).toHaveText(`${n} tarif kaydedildi.`,{timeout:30000});
  const receipt=await job(j.id),after=await canonical(primary),savedDrafts=await items(j.id);ensure(receipt.status==='saved'&&receipt.saved_recipe_ids.length===n&&receipt.save_selection_hash,'Import save receipt missing');ensure(after.length===before+n,'Canonical save count mismatch');
  const edited=after.find(r=>r.id===savedDrafts[0].saved_recipe_id);ensure(edited.name===sameName&&edited.description==='Sentetik düzenleme'&&edited.meal_type==='dinner'&&edited.calories===245&&edited.protein===12.5&&edited.carbs===30&&edited.fat===5&&edited.image_path===null,'Canonical edited fields mismatch');ensure(savedDrafts[2].saved_recipe_id===null,'Unselected incomplete recipe saved');if(kind==='CSV')ensure(savedDrafts[1].saved_recipe_id===null,'Unselected complete recipe saved');
  const selection=savedDrafts.filter(d=>d.saved_recipe_id).map(d=>({id:d.id,input:d.recipe_draft}));const retry=await mutate('Owned save retry failed',()=>primary.client.rpc('save_recipe_import',{p_job_id:j.id,p_selected:selection}));ensure(JSON.stringify(retry)===JSON.stringify(receipt.saved_recipe_ids)&&(await canonical(primary)).length===after.length,'Save retry duplicated canonical rows');
  await sourceGone(j);await reconcile();m[kind.toLowerCase()]={status:'PASS',job_id:j.id,drafts:3,selected:n,canonical:n,ai_metrics_null:true,cleanup_ack:true};save();await page.screenshot({path:join(privateDir,kind.toLowerCase()+'-saved.png')});await page.close();pass(kind+' real UI → deterministic Edge → canonical save → receipt → source cleanup');
 }
 ensure((await canonical(primary)).filter(r=>r.name===sameName).length===3,'Same-name canonical semantics broken');ensure(pageErrors.length===0&&!browserFailure,'Browser errors detected');pass('selection, missing values, same-name duplicates and idempotent save');
 // Oversize metadata denial without allocating/uploading a large production object.
 verify();ensure((await primary.client.rpc('begin_recipe_import',{p_request_id:randomUUID(),p_name:'oversized.csv',p_mime:'text/csv',p_size:5242881})).error,'Oversized metadata accepted');
 m.stage='safe negative file scenarios';save();const invalid={name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('Tarif Adı;Kalori\n"unterminated;200\n')};const bad=await begin(primary,invalid);await upload(primary,bad,invalid);const failed=await invokeProcess(primary,bad);ensure(failed.status===422&&failed.data.error==='invalid_file','Malformed CSV did not fail closed');ensure((await items(bad.id)).length===0&&(await canonical(primary)).length===3,'Invalid file created recipes');await sourceGone(bad);pass('oversize metadata and actual malformed CSV worker denial');
 // Nonempty private source access checks, then cancellation and real Vault-backed reconciler dispatch.
 m.stage='private source access and canceled-source cleanup';save();const canceled=await begin(primary,{...csv,name:'cancelled.csv'});await upload(primary,canceled,csv);ensure(!(await primary.client.storage.from('recipe-imports').download(canceled.source_storage_path)).error,'Owner source not readable');ensure((await foreign.client.storage.from('recipe-imports').download(canceled.source_storage_path)).error,'Cross-owner source exposed');
 const anon=createClient(url,anonKey,clientOptions);ensure((await anon.storage.from('recipe-imports').download(canceled.source_storage_path)).error,'Anonymous source exposed');const publicRead=await fetchScoped(url+'/storage/v1/object/public/recipe-imports/'+canceled.source_storage_path);ensure(!publicRead.ok,'Private source publicly exposed');
 // Write/delete negatives. Storage remove() reports success with an empty list when RLS filters rows, so prove the object survives.
 const sourceSha=()=>sql(`select count(*)::int as n,max(metadata->>'size') as size from storage.objects where bucket_id='recipe-imports' and name='${canceled.source_storage_path}';`)[0];
 const intact=async label=>{const s=sourceSha();ensure(s.n===1&&Number(s.size)===csv.buffer.length,label);const own=await primary.client.storage.from('recipe-imports').download(canceled.source_storage_path);ensure(!own.error&&Buffer.from(await own.data.arrayBuffer()).equals(csv.buffer),label);};
 verify();ensure((await foreign.client.storage.from('recipe-imports').upload(canceled.source_storage_path,Buffer.from('Ad\nX\n'),{contentType:'text/csv',upsert:true})).error,'Cross-owner overwrite accepted');await intact('Cross-owner overwrite changed source');
 verify();await foreign.client.storage.from('recipe-imports').remove([canceled.source_storage_path]);await intact('Cross-owner delete removed source');
 verify();await primary.client.storage.from('recipe-imports').remove([canceled.source_storage_path]);await intact('Owner end-user delete removed source');
 verify();ensure((await primary.client.storage.from('recipe-imports').upload(canceled.source_storage_path,Buffer.from('Ad\nX\n'),{contentType:'text/csv',upsert:true})).error,'Owner overwrite accepted');await intact('Owner overwrite changed source');
 ensure((await foreign.client.storage.from('recipe-imports').createSignedUrl(canceled.source_storage_path,60)).error,'Cross-owner signed URL issued');
 ensure((await anon.storage.from('recipe-imports').createSignedUrl(canceled.source_storage_path,60)).error,'Anonymous signed URL issued');
 m.storage_negatives={foreign_read:'DENIED',anonymous_read:'DENIED',public_url:'DENIED',foreign_overwrite:'DENIED',foreign_delete:'NO_EFFECT',owner_delete:'NO_EFFECT',owner_overwrite:'DENIED',foreign_signed_url:'DENIED',anonymous_signed_url:'DENIED',owner_read:'ALLOWED'};save();
 const denied=await invokeProcess(foreign,canceled);ensure([403,409].includes(denied.status)&&(await job(canceled.id)).status==='uploaded','Cross-owner worker changed import');
 await mutate('Owned cancel failed',()=>primary.client.rpc('cancel_recipe_import',{p_job_id:canceled.id}));ensure((await job(canceled.id)).cleanup_pending,'Cancellation cleanup intent missing');pass('private Storage owner-only access and cross-dietitian worker denial');
 ensure(sql(`select count(*)::int as n from public.recipe_import_jobs where cleanup_pending and dietitian_id<>all(${ids});`)[0].n===0,'Unrelated cleanup candidates; do not dispatch');
 const queued=sql(`begin;select private.dispatch_recipe_import_cleanup() as dispatched;select id as request_id from net.http_request_queue where url='${url}/functions/v1/cleanup-recipe-imports' order by id desc limit 1;commit;`,true);const requestId=queued.at(-1)?.request_id;ensure(Number.isSafeInteger(Number(requestId))&&Number(requestId)>0,'Vault-backed dispatch queue receipt missing');
 let dispatch;for(let attempt=0;attempt<20;attempt++){const receipts=sql(`select id,status_code,timed_out,error_msg is null as no_error,content::jsonb->>'removed' as removed,content::jsonb->>'failed' as failed,headers->>'sb-request-id' as edge_request_id,headers->>'x-deno-execution-id' as execution_id from net._http_response where id=${Number(requestId)};`);dispatch=receipts.find(r=>r.status_code===200&&r.no_error&&!r.timed_out&&Number(r.removed)>=1&&Number(r.failed)===0);if(dispatch)break;await new Promise(r=>setTimeout(r,1000));}
 ensure(dispatch,'Nonempty cleanup HTTP success unproven');await sourceGone(canceled);m.cleanup_dispatch={request_id:dispatch.id,status:dispatch.status_code,removed:Number(dispatch.removed),failed:0,vault_backed:true,edge_request_id:dispatch.edge_request_id,execution_id:dispatch.execution_id};save();
 ensure(sql('select count(*) filter(where cleanup_pending)::int as pending,count(*) filter(where cleanup_pending and expires_at<now())::int as overdue from public.recipe_import_jobs;')[0].pending===0,'Cleanup pending remains');pass('nonempty Vault-backed cleanup endpoint HTTP200, Storage deletion and acknowledgement');
 m.status='SMOKE_PASS_CLEANUP_PENDING';save();
}catch(e){failure=e;m.failure=e instanceof Error&&e.message.length<180&&!e.message.includes('https:')?e.message:'Smoke check failed; raw diagnostics suppressed';m.status='SMOKE_FAILED_CLEANUP_PENDING';save();process.stdout.write('SMOKE_FAILED; owned fixture cleanup starting\n');}
finally{
 if(browser)await browser.close().catch(()=>{});if(server)await server.close().catch(()=>{});
 if(admin){try{
  await reconcile();m.before_cleanup=counts();save();
  // Reconcile uncertain create responses only by pre-recorded UUID, email and ownership marker.
  const found=sql(`select id::text,email,raw_user_meta_data->>'recipe_smoke_run' as marker from auth.users where id=any(${ids});`);
  for(const u of found){const intent=m.actors.find(a=>a.id===u.id);ensure(intent&&intent.email===u.email&&u.marker===m.run_id,'Cleanup actor marker mismatch');intent.created=true;}
  for(const a of m.actors.filter(a=>a.created)){
   const prefixes=result(await admin.storage.from('recipe-imports').list(a.id),'Owned Storage listing failed');for(const folder of prefixes){ensure(uuid(folder.name)&&m.jobs.some(j=>j.id===folder.name),'Unexpected owned source folder');const files=result(await admin.storage.from('recipe-imports').list(a.id+'/'+folder.name),'Owned source inventory failed');for(const f of files){const path=a.id+'/'+folder.name+'/'+f.name;ensure(m.jobs.some(j=>j.path===path),'Unmanifested source path');await mutate('Owned source cleanup failed',()=>admin.storage.from('recipe-imports').remove([path]));}}
   await mutate('Owned import cleanup failed',()=>admin.from('recipe_import_jobs').delete().eq('dietitian_id',a.id));
   await mutate('Owned recipe cleanup failed',()=>admin.from('recipes').delete().eq('dietitian_id',a.id));
  }
  for(const a of actors)await mutate('Owned signout failed',()=>admin.auth.admin.signOut(a.session.access_token,'global'));
  for(const a of m.actors.filter(a=>a.created).reverse()){const u=result(await admin.auth.admin.getUserById(a.id),'Cleanup actor recheck failed').user;ensure(u?.user_metadata?.recipe_smoke_run===m.run_id&&u.email===a.email,'Cleanup ownership changed');await mutate('Owned Auth cleanup failed',()=>admin.auth.admin.deleteUser(a.id));}
  sql(`delete from public.dietitian_verification_audit where subject_user_id_snapshot=any(${ids});delete from auth.audit_log_entries where payload->>'actor_id'=any(${ids}::text[]) or payload::text like '%${m.run_id}%';select true as owned_audit_cleanup;`,true);
  const remaining=counts();ensure(Object.values(remaining).every(n=>n===0),'Fixture residue remains');m.cleanup_receipt={status:'PASS',finished_at:new Date().toISOString(),remaining,residue:0};
  m.after=fingerprint();ensure(JSON.stringify(m.baseline)===JSON.stringify(m.after),'Unrelated production row fingerprint changed');m.unrelated_data_changed=false;m.status=failure?'SMOKE_FAILED_CLEANUP_PASS':'PASS';save();pass('all owned DB/Auth/Storage fixtures removed; unrelated rows and cron unchanged');
 }catch(e){cleanupFailure=e;m.cleanup_receipt={status:'FAIL',safe_error:e instanceof Error&&e.message.length<180?e.message:'Cleanup failed; raw diagnostics suppressed'};m.status='CLEANUP_FAILED';save();process.stdout.write('CLEANUP_FAILED; preserve manifest and stop rollout\n');}}
}
if(failure||cleanupFailure)process.exitCode=1;else process.stdout.write(`RECIPE_PRODUCTION_SYNTHETIC_SMOKE_PASS checks=${m.checks.length} residue=0 openai=NO flag=OFF\n`);
