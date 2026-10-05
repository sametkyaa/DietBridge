import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseCsv,mapTables } from '../supabase/functions/_shared/recipeSpreadsheet.ts';
import { handleImportCleanup } from '../supabase/functions/cleanup-recipe-imports/handler.ts';
import { OpenAIRecipeExtractionProvider } from '../supabase/functions/_shared/openAIRecipeExtraction.ts';
import { handleRecipeImport } from '../supabase/functions/process-recipe-import/handler.ts';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = '20261005124951_recipe_import_core.sql';
const projectId = `dietbridge-import-${process.pid}-${randomUUID().slice(0,8)}`;
const npxCli = process.env.npm_execpath ? join(dirname(process.env.npm_execpath),'npx-cli.js') : join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(SUPABASE|VITE_SUPABASE|DATABASE_URL|POSTGRES_|PG)/.test(name)));
const password = 'Disposable-Invite-Only-4x!';
let disposable; let local; let admin; let attemptedStart=false; let failure; let checks=0;
const actors=[];
const pass = name => { checks++; process.stdout.write(`PASS ${name}\n`); };
const ok = (result) => { assert.equal(result.error,null); return result.data; };
const cli = args => execFileSync(process.execPath,[npxCli,'--yes','supabase@2.110.0','--workdir',disposable.tempRoot,...args],{
  env:environment,cwd:repoRoot,encoding:'utf8',maxBuffer:16*1024*1024,timeout:600000,windowsHide:true,
});
const freePort = () => new Promise((resolvePort,reject) => {
  const server=createServer(); server.on('error',reject); server.listen(0,'127.0.0.1',() => {
    const port=server.address().port; server.close(error => error?reject(error):resolvePort(port));
  });
});
const actor = async (role,approved=true) => {
  const email=`invite-${randomUUID()}@example.invalid`;
  const {user}=ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{account_type:role,role,full_name:`Disposable ${role}`}}));
  actors.push(user.id);
  if(role==='dietitian') {
    ok(await admin.from('dietitian_profiles').update({verification_status:approved?'approved':'pending',is_verified:approved}).eq('user_id',user.id));
    ok(await admin.from('dietitian_subscriptions').upsert({dietitian_id:user.id,plan_id:'core',status:'active'}));
  }
  const client=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  ok(await client.auth.signInWithPassword({email,password}));
  return {id:user.id,email,client};
};
const rpc = async (a,name,args) => ok(await a.client.rpc(name,args));
try {
  disposable=await runDisposableSupabaseLocalReplay({materializeOnly:true,keepTemp:true});
  addCurrentIsolatedMigrations({repoRoot,tempRoot:disposable.tempRoot});
  const metricsMigration='20261005132107_recipe_import_extraction_metrics.sql';
  // The production controller excludes push. Remove only this disposable copy.
  const disposablePush=resolve(disposable.tempRoot,'supabase/migrations/20260817120000_push_registry_outbox_backend.sql');
  assert.ok(disposablePush.startsWith(resolve(disposable.tempRoot)+sep));
  rmSync(disposablePush);
  copyFileSync(join(repoRoot,'supabase/migrations','20261005120859_dietitian_invite_codes.sql'),join(disposable.tempRoot,'supabase/migrations','20261005120859_dietitian_invite_codes.sql'));
  const ports=await Promise.all(Array.from({length:8},freePort));
  let config=readFileSync(disposable.configPath,'utf8').replace(/^project_id\s*=.*$/m,`project_id = "${projectId}"`);
  [54321,54322,54320,54329,54323,54324,54327,8083].forEach((port,index) => {config=config.replace(new RegExp(`\\b${port}\\b`,'g'),String(ports[index]));});
  writeFileSync(disposable.configPath,config);
  attemptedStart=true;
  cli(['start','--exclude','studio,imgproxy,mailpit,logflare,vector,supavisor,edge-runtime']);
  local=Object.fromEntries(cli(['status','-o','env']).split(/\r?\n/).map(line=>line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(m=>[m[1],m[2]]));
  assert.match(local.API_URL,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  pass('clean canonical migration apply');
  const localSql = input => execFileSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-XqAt','-F','\t','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  const checkSql=(filename,count,statusColumn,expectedPending=false)=>{
    const output=localSql(readFileSync(join(repoRoot,'supabase/preflight',filename),'utf8'));
    const rows=output.trim().split(/\r?\n/).map(line=>line.split('\t')).filter(row=>/^\d\d_/.test(row[0]));
    assert.equal(rows.length,count,output);
    for(const row of rows)assert.equal(row[statusColumn],expectedPending&&/^20_.*_history_receipt$/.test(row[0])?'PASS_WITH_HISTORY_PENDING':'PASS',row.join(' | '));
  };
  // Local avatar prerequisite is retained; only its local-only receipt is removed
  // so this disposable history exactly represents the reviewed production baseline.
  localSql("delete from supabase_migrations.schema_migrations where version='20260728155959';");
  checkSql('recipe_core_preflight.sql',13,2);pass('production-shaped P2 preflight 13/13 with excluded push absent');
  localSql(readFileSync(join(repoRoot,'supabase/migrations',migration),'utf8'));
  checkSql('recipe_core_postflight.sql',20,1,true);pass('core schema postflight 19/19 before history receipt');
  localSql("insert into supabase_migrations.schema_migrations(version,name) values('20261005124951','recipe_import_core');");
  checkSql('recipe_core_postflight.sql',20,1);pass('core exact history receipt postflight 20/20');
  const postflightBody=readFileSync(join(repoRoot,'supabase/preflight/recipe_core_postflight.sql'),'utf8').replace(/^begin transaction read only;\s*$/m,'').replace(/^rollback;\s*$/m,'');
  const deniedPostflight=localSql(`begin;grant select on public.recipe_import_jobs to anon;${postflightBody}rollback;`);
  assert.ok(deniedPostflight.split(/\r?\n/).some(line=>line.startsWith('08_table_grants\tFAIL\t')),deniedPostflight);
  checkSql('recipe_core_postflight.sql',20,1);pass('core postflight detects anonymous grant regression; rollback restores PASS');
  execFileSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync(join(repoRoot,'supabase/migrations',migration)),encoding:'utf8',windowsHide:true});
  pass('repeat apply is idempotent');
  execFileSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync(join(repoRoot,'supabase/migrations',metricsMigration)),encoding:'utf8',windowsHide:true});
  execFileSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync(join(repoRoot,'supabase/migrations',metricsMigration)),encoding:'utf8',windowsHide:true});
  pass('extraction metrics repeat apply and combined feature chain');
  checkSql('recipe_metrics_postflight.sql',21,1,true);pass('metrics schema postflight 20/20 before history receipt');
  localSql("insert into supabase_migrations.schema_migrations(version,name) values('20261005132107','recipe_import_extraction_metrics');");
  checkSql('recipe_metrics_postflight.sql',21,1);pass('metrics exact history receipt postflight 21/21');
  const metricsPostflightBody=readFileSync(join(repoRoot,'supabase/preflight/recipe_metrics_postflight.sql'),'utf8').replace(/^begin transaction read only;\s*$/m,'').replace(/^rollback;\s*$/m,'');
  const badMetrics=localSql(`begin;alter table public.recipe_import_jobs drop constraint recipe_import_jobs_ai_attempt_count_check;${metricsPostflightBody}rollback;`);
  assert.ok(badMetrics.split(/\r?\n/).some(line=>line.startsWith('21_metrics_bounds\tFAIL\t')),badMetrics);
  checkSql('recipe_metrics_postflight.sql',21,1);pass('metrics postflight detects dropped attempt bound; rollback restores PASS');

  const noCron = "do $$ begin if exists(select 1 from cron.job where jobname='recipe-import-cleanup') then raise exception 'Premature cleanup cron'; end if; end $$;";
  localSql(noCron);pass('core and metrics apply never enable cleanup cron');
  const activation = readFileSync(join(repoRoot,'supabase/rollout/enable_recipe_import_cleanup.sql'),'utf8');
  assert.throws(()=>localSql(activation),/Unique cleanup Vault entries required/);pass('separate cron activation fails closed without Vault readiness');
  // Everything below is rolled back. pg_cron cannot see an uncommitted job,
  // so the real production-shaped URL is never dispatched from this test.
  const activationBody = activation.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  localSql(`begin;
    select vault.create_secret('https://kagvxhyvxxypspdxcuxz.supabase.co/functions/v1/cleanup-recipe-imports','recipe_import_cleanup_url');
    select vault.create_secret('disposable-public-placeholder-token','recipe_import_cleanup_token');
    ${activationBody}
    create temporary table expected_cleanup_job as select jobid from cron.job where jobname='recipe-import-cleanup';
    ${activationBody}
    ${readFileSync(join(repoRoot,'supabase/migrations',migration),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
    do $$ begin
      if (select count(*) from cron.job where jobname='recipe-import-cleanup' and active and schedule='*/15 * * * *' and command='select private.dispatch_recipe_import_cleanup();' and jobid=(select jobid from expected_cleanup_job))<>1 then
        raise exception 'Cleanup activation is not idempotent or core reapply changed cron';
      end if;
    end $$;
    rollback;`);
  localSql(noCron);pass('explicit cron activation is idempotent; core reapply preserves job; rolled back with zero dispatch');

  const d=await actor('dietitian'), d2=await actor('dietitian'), unapproved=await actor('dietitian',false), client=await actor('client');
  const limits=await rpc(d,'recipe_import_limits'); assert.equal(limits.maxRecipes,20);
  const bytes=new TextEncoder().encode('Ad,Öğün,Kalori,Protein,Karb,Yağ\nÇorba,Öğle,200,10,30,5\nÇorba,Akşam,250,15,30,8\n');
  const begin=async(a,request=randomUUID(),name='recipes.csv',mime='text/csv',size=bytes.length)=>rpc(a,'begin_recipe_import',{p_request_id:request,p_name:name,p_mime:mime,p_size:size});
  for(const a of [unapproved,client])assert.ok((await a.client.rpc('begin_recipe_import',{p_request_id:randomUUID(),p_name:'a.csv',p_mime:'text/csv',p_size:3})).error);
  const anon=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.ok((await anon.rpc('begin_recipe_import',{p_request_id:randomUUID(),p_name:'a.csv',p_mime:'text/csv',p_size:3})).error);pass('only approved dietitian may start import');
  for(const [name,mime,size] of [['../a.csv','text/csv',3],['a.csv','application/pdf',3],['a.csv','text/csv',0],['a.csv','text/csv',limits.maxBytes+1]])assert.ok((await d.client.rpc('begin_recipe_import',{p_request_id:randomUUID(),p_name:name,p_mime:mime,p_size:size})).error);pass('server metadata MIME path size and empty validation');
  const requestId=randomUUID(),job=await begin(d,requestId);assert.equal((await begin(d,requestId)).id,job.id);pass('upload intent idempotency and random owner path');
  assert.equal(ok(await d2.client.from('recipe_import_jobs').select('*').eq('id',job.id)).length,0);assert.equal(ok(await client.client.from('recipe_import_jobs').select('*')).length,0);pass('cross tenant and client job read denied');
  assert.ok((await d.client.from('recipe_import_jobs').update({status:'ready'}).eq('id',job.id)).error);pass('client cannot manufacture job state');
  assert.ok((await d.client.rpc('claim_recipe_import',{p_job_id:job.id,p_actor:d.id})).error);assert.ok((await d.client.rpc('finish_recipe_import',{p_job_id:job.id,p_actor:d.id,p_items:[],p_error:null})).error);pass('worker completion and claim service role only');
  ok(await d.client.storage.from('recipe-imports').upload(job.source_storage_path,bytes,{contentType:'text/csv',upsert:false}));
  assert.ok((await d2.client.storage.from('recipe-imports').download(job.source_storage_path)).error);assert.ok((await anon.storage.from('recipe-imports').download(job.source_storage_path)).error);
  assert.ok((await d2.client.storage.from('recipe-imports').upload(job.source_storage_path.replace('/source.csv','/other.csv'),bytes,{contentType:'text/csv'})).error);
  assert.ok((await d.client.storage.from('recipe-imports').upload(job.source_storage_path,bytes,{contentType:'text/csv',upsert:true})).error);
  const ownFile=ok(await d.client.storage.from('recipe-imports').download(job.source_storage_path));assert.equal(ownFile.size,bytes.length);pass('real private Storage HTTP owner isolation and overwrite denied');
  const bucket=ok(await admin.storage.getBucket('recipe-imports'));assert.equal(bucket.public,false);assert.equal(bucket.file_size_limit,limits.maxBytes);pass('bucket is private with server limit');
  const claimed=await Promise.all([admin.rpc('claim_recipe_import',{p_job_id:job.id,p_actor:d.id}),admin.rpc('claim_recipe_import',{p_job_id:job.id,p_actor:d.id})]);
  assert.equal(claimed.map(ok).filter(v=>v?.id).length,1);pass('concurrent processing claim exactly one winner');
  assert.equal(ok(await d.client.from('recipes').select('id')).length,0);pass('upload and processing never save a recipe');
  const items=mapTables(parseCsv(bytes,limits),{},limits);assert.equal(ok(await admin.rpc('finish_recipe_import',{p_job_id:job.id,p_actor:d.id,p_items:items,p_error:null})),true);
  assert.equal(ok(await admin.rpc('finish_recipe_import',{p_job_id:job.id,p_actor:d.id,p_items:items,p_error:null})),false);pass('finish transitions once and never saves directly');
  const drafts=ok(await d.client.from('recipe_import_items').select('*').eq('import_job_id',job.id));assert.equal(drafts.length,2);
  assert.equal(ok(await d2.client.from('recipe_import_items').select('*').eq('import_job_id',job.id)).length,0);pass('cross tenant draft read denied');
  assert.ok((await d2.client.rpc('save_recipe_import',{p_job_id:job.id,p_selected:[{id:drafts[0].id,input:items[0].draft}]})).error);pass('cross tenant save denied');
  const selected=[{id:drafts[0].id,input:{...items[0].draft,name:'Düzenlenen çorba'}}];
  const saved=await rpc(d,'save_recipe_import',{p_job_id:job.id,p_selected:selected});assert.equal(saved.length,1);
  const recipes=ok(await d.client.from('recipes').select('*'));assert.equal(recipes.length,1);assert.equal(recipes[0].name,'Düzenlenen çorba');assert.equal(recipes[0].calories,200);pass('selected edited row only saves into canonical recipes');
  assert.deepEqual(await rpc(d,'save_recipe_import',{p_job_id:job.id,p_selected:selected}),saved);assert.equal(ok(await d.client.from('recipes').select('id')).length,1);pass('batch save retry idempotent without duplicates');
  assert.ok((await d.client.rpc('save_recipe_import',{p_job_id:job.id,p_selected:[{id:selected[0].id,input:{...selected[0].input,name:'different retry'}}]})).error);pass('saved selection receipt rejects changed replay payload');
  const second=await begin(d);ok(await admin.rpc('claim_recipe_import',{p_job_id:second.id,p_actor:d.id}));ok(await admin.rpc('finish_recipe_import',{p_job_id:second.id,p_actor:d.id,p_items:items,p_error:null}));
  const rows=ok(await d.client.from('recipe_import_items').select('*').eq('import_job_id',second.id));
  const bad=[{id:rows[0].id,input:items[0].draft},{id:rows[1].id,input:{...items[1].draft,name:''}}];
  assert.ok((await d.client.rpc('save_recipe_import',{p_job_id:second.id,p_selected:bad})).error);
  assert.equal(ok(await d.client.from('recipes').select('id')).length,1);assert.equal(ok(await d.client.from('recipe_import_jobs').select('status').eq('id',second.id))[0].status,'ready');pass('one invalid row rolls back entire batch and preserves preview');
  assert.ok((await d.client.rpc('save_recipe_import',{p_job_id:second.id,p_selected:[{id:rows[0].id,input:{...items[0].draft,calories:null}}]})).error);pass('missing nutrition cannot silently become zero');
  await rpc(d,'save_recipe_import',{p_job_id:second.id,p_selected:rows.map((row,i)=>({id:row.id,input:{...items[i].draft,name:'Düzenlenen çorba'}}))});assert.equal(ok(await d.client.from('recipes').select('id').eq('name','Düzenlenen çorba')).length,3);pass('same-name manual recipe semantics preserved');
  const expired=await begin(d);ok(await d.client.storage.from('recipe-imports').upload(expired.source_storage_path,bytes,{contentType:'text/csv'}));
  ok(await admin.from('recipe_import_jobs').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',expired.id));
  assert.equal(ok(await admin.rpc('claim_recipe_import',{p_job_id:expired.id,p_actor:d.id}))?.id??null,null);pass('expired job cannot process');
  const orphan=`${d.id}/${randomUUID()}/source.csv`;ok(await admin.storage.from('recipe-imports').upload(orphan,bytes,{contentType:'text/csv'}));
  execFileSync('docker',['exec',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`update storage.objects set created_at=now()-interval '2 hours' where bucket_id='recipe-imports' and name='${orphan}';`],{encoding:'utf8',windowsHide:true});
  const cleanupDeps={authorized:()=>true,candidates:async()=>ok(await admin.rpc('recipe_import_cleanup_candidates')),remove:async path=>ok(await admin.storage.from('recipe-imports').remove([path])),acknowledge:async id=>ok(await admin.rpc('ack_recipe_import_cleanup',{p_job_id:id}))};
  assert.equal((await handleImportCleanup(new Request('http://localhost/cleanup',{method:'POST'}),cleanupDeps)).status,200);
  assert.equal((await handleImportCleanup(new Request('http://localhost/cleanup',{method:'POST'}),cleanupDeps)).status,200);
  assert.ok((await admin.storage.from('recipe-imports').download(job.source_storage_path)).error);assert.ok((await admin.storage.from('recipe-imports').download(expired.source_storage_path)).error);assert.ok((await admin.storage.from('recipe-imports').download(orphan)).error);
  assert.equal(ok(await admin.from('recipe_import_jobs').select('status').eq('id',expired.id))[0].status,'expired');pass('real Storage cleanup idempotency expiry and orphan compensation');
  assert.equal(ok(await admin.from('recipe_import_jobs').select('id').eq('cleanup_pending',true)).length,0);pass('cleanup acknowledgement leaves no payload queue residue');
  assert.deepEqual(await rpc(d,'save_recipe_import',{p_job_id:job.id,p_selected:selected}),saved);pass('raw deletion does not affect saved recipe or idempotent receipt');
  const pdfBytes=new TextEncoder().encode('%PDF-1.7\nvisual PDF fixture\n%%EOF'),pdfJob=await begin(d,randomUUID(),'recipes.pdf','application/pdf',pdfBytes.length);
  ok(await d.client.storage.from('recipe-imports').upload(pdfJob.source_storage_path,pdfBytes,{contentType:'application/pdf'}));
  let providerCalls=0;
  const mockProvider=new OpenAIRecipeExtractionProvider({apiKey:'fake-runtime-test-key',model:'gpt-6-luna',fetch:async()=>{providerCalls++;return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({recipes:[{draft:{name:'PDF çorba',description:null,mealType:null,calories:null,macros:{protein:null,carbs:null,fat:null}},source:{page:1,section:null}}]})}]}],usage:{input_tokens:100,output_tokens:50}}),{status:200});}});
  const {data:{session}}=await d.client.auth.getSession();
  const deps={authenticate:async()=>d.id,limits:async()=>limits,claim:async(id,actor)=>ok(await admin.rpc('claim_recipe_import',{p_job_id:id,p_actor:actor})),download:async path=>new Uint8Array(await ok(await admin.storage.from('recipe-imports').download(path)).arrayBuffer()),workbook:async()=>{throw new Error('unexpected workbook');},extract:async(bytes,j,l)=>mockProvider.extract({bytes,mime:j.source_mime_type,extension:'pdf',jobId:j.id,limits:l}),finish:async(id,actor,items,error,metrics)=>ok(await admin.rpc('finish_recipe_import',{p_job_id:id,p_actor:actor,p_items:items,p_error:error,p_metrics:metrics})),cleanup:async j=>{ok(await admin.storage.from('recipe-imports').remove([j.source_storage_path]));ok(await admin.rpc('ack_recipe_import_cleanup',{p_job_id:j.id}));}};
  const req=()=>new Request('http://localhost/process',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({jobId:pdfJob.id})});
  const beforePdf=ok(await d.client.from('recipes').select('id')).length;
  assert.equal((await handleRecipeImport(req(),deps)).status,200);assert.equal((await handleRecipeImport(req(),deps)).status,409);assert.equal(providerCalls,1);
  const metricsRow=ok(await admin.from('recipe_import_jobs').select('ai_model,ai_input_tokens,ai_output_tokens,ai_attempt_count,status').eq('id',pdfJob.id))[0];assert.deepEqual(metricsRow,{ai_model:'gpt-6-luna',ai_input_tokens:100,ai_output_tokens:50,ai_attempt_count:1,status:'ready'});
  const pdfItems=ok(await d.client.from('recipe_import_items').select('*').eq('import_job_id',pdfJob.id));assert.equal(pdfItems[0].recipe_draft.calories,null);assert.equal(ok(await d.client.from('recipes').select('id')).length,beforePdf);assert.ok((await admin.storage.from('recipe-imports').download(pdfJob.source_storage_path)).error);pass('mocked PDF provider full worker Storage and DB path preview only metrics immediate cleanup and duplicate cost guard');
  pass('RECIPE_IMPORT_CORE_RUNTIME_MATRIX');
}catch(error){failure=error;}finally{
  if(admin){
    try{
      ok(await admin.from('dietitian_clients').delete().or(`client_id.in.(${actors.join(',')}),dietitian_id.in.(${actors.join(',')})`));
      for(const id of [...actors].reverse()) ok(await admin.auth.admin.deleteUser(id));
      const remaining=ok(await admin.auth.admin.listUsers({perPage:1000})).users.filter(u=>actors.includes(u.id)); assert.equal(remaining.length,0); pass('fixture Auth residue zero');
    }catch(error){failure??=error;}
  }
  if(disposable?.tempRoot){
    try{
      if(attemptedStart) cli(['stop','--project-id',projectId,'--no-backup']);
      const parent=resolve(dirname(disposable.tempRoot)); const systemTemp=resolve(tmpdir());
      assert.ok(parent.startsWith(systemTemp+sep) && parent!==systemTemp && !repoRoot.startsWith(parent+sep));
      rmSync(parent,{recursive:true,force:true}); assert.equal(existsSync(parent),false);
      assert.equal(execFileSync('docker',['ps','-a','--filter',`name=${projectId}`,'--format','{{.ID}}'],{encoding:'utf8'}).trim(),'');
      assert.equal(execFileSync('docker',['volume','ls','--filter',`name=${projectId}`,'--format','{{.Name}}'],{encoding:'utf8'}).trim(),''); pass('disposable container volume and temp residue zero');
    }catch(error){failure??=error;}
  }
}
if(failure){process.stderr.write(`${failure.stack}\n`);process.exitCode=1;}else process.stdout.write(`RECIPE_IMPORT_RUNTIME_PASS checks=${checks}\n`);
