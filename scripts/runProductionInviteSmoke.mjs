import {createClient} from '@supabase/supabase-js';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicitly authorized, bounded production smoke. No keys, passwords, JWTs or codes persisted/logged.
const options=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)];}));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ref='kagvxhyvxxypspdxcuxz';
const ensure=(ok,label)=>{if(!ok)throw new Error(label);};
ensure(options['--approval']==='APPROVE_INVITE_SYNTHETIC_SMOKE','Explicit smoke approval required');
ensure(options['--project-ref']===ref,'Unexpected project ref');
const cli=options['--cli'];
const privateDir=realpathSync(options['--manifest-dir']);
ensure(privateDir.replaceAll('\\','/').startsWith('C:/dev/DietBridge-Backups/invite-smoke-'),'Unexpected private manifest directory');
const manifestPath=join(privateDir,'ownership.json');
ensure(!existsSync(manifestPath),'Do not overwrite a previous smoke manifest');
const rawCli=(args)=>{try{return execFileSync(cli,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}catch{throw new Error('CLI operation failed; no raw output logged');}};
ensure(rawCli(['--version']).trim()==='2.110.0','Unexpected CLI version');
ensure(readFileSync(join(root,'supabase/.temp/project-ref'),'utf8').trim()===ref,'Linked target mismatch');
const manifest={run_id:randomUUID(),target_ref:ref,started_at:new Date().toISOString(),approval:'APPROVE_INVITE_SYNTHETIC_SMOKE',maximum_auth_fixtures:17,status:'STARTED',identity_checks:0,creation_intents:[],owned_auth_user_ids:[],owned_profile_ids:[],owned_subscription_ids:[],owned_relationship_ids:[],owned_notification_ids:[],owned_invite_code_owner_ids:[],completed_checks:[],cleanup_receipt:null};
const save=()=>{writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest,null,2));renameSync(manifestPath+'.tmp',manifestPath);};
save();
const verify=()=>{
 const response=JSON.parse(rawCli(['projects','list','--output','json']));
 const projects=Array.isArray(response)?response:response.projects;
 const p=projects?.find(x=>(x.id??x.ref)===ref);
 ensure(p?.name==='dietbridge_Production'&&p?.region==='eu-central-1'&&p?.status==='ACTIVE_HEALTHY'&&p?.database?.version==='17.6.1.052','Project identity check failed');
 manifest.identity_checks++;manifest.last_identity_verified_at=new Date().toISOString();save();
};
const result=(r,label)=>{ensure(!r.error,label);return r.data;};
const mutate=async(label,fn)=>{verify();return result(await fn(),label);};
const pass=(label)=>{manifest.completed_checks.push(label);save();process.stdout.write('PASS '+label+'\n');};
const own=(id)=>ensure(manifest.owned_auth_user_ids.includes(id),'Unowned fixture ID');
const url='https://'+ref+'.supabase.co';
const fetchScoped=(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url??String(input));
 ensure(u.origin===url,'Unexpected request origin');
 return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});
};
const clientOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetchScoped}};
let admin,anonKey,failure,cleanupFailure;
const actors=[];
const sql=(query)=>{
 const file=join(privateDir,'scoped-verification.sql');writeFileSync(file,query);
 const r=JSON.parse(rawCli(['db','query','--linked','--file',file,'--output','json']));
 ensure(Array.isArray(r.rows),'Missing SQL verification result');return r.rows;
};
const ownedUuidSql=()=>{
 const ids=[...new Set(manifest.creation_intents.map(x=>x.requested_id).concat(manifest.owned_auth_user_ids))];
 ensure(ids.every(id=>/^[0-9a-f-]{36}$/.test(id)),'Invalid fixture UUID');
 return ids.length?'ARRAY['+ids.map(id=>"'"+id+"'::uuid").join(',')+']::uuid[]':'ARRAY[]::uuid[]';
};
const counts=()=>{
 const ids=ownedUuidSql();
 return sql(`begin transaction read only;select jsonb_build_object(
 'auth_users',(select count(*) from auth.users where id=any(${ids})),
 'auth_sessions',(select count(*) from auth.sessions where user_id=any(${ids})),
 'auth_identities',(select count(*) from auth.identities where user_id=any(${ids})),
 'auth_refresh_tokens',(select count(*) from auth.refresh_tokens where user_id::text=any(${ids}::text[])),
 'profiles',(select count(*) from public.profiles where id=any(${ids})),
 'client_profiles',(select count(*) from public.client_profiles where user_id=any(${ids})),
 'dietitian_profiles',(select count(*) from public.dietitian_profiles where user_id=any(${ids})),
 'subscriptions',(select count(*) from public.dietitian_subscriptions where dietitian_id=any(${ids})),
 'relationships',(select count(*) from public.dietitian_clients where client_id=any(${ids}) or dietitian_id=any(${ids})),
 'notifications',(select count(*) from public.notifications where recipient_id=any(${ids}) or actor_id=any(${ids})),
 'invite_codes',(select count(*) from public.dietitian_invite_codes where dietitian_id=any(${ids})),
 'attempts',(select count(*) from private.invite_code_attempts where client_id=any(${ids})),
 'verification_audit',(select count(*) from public.dietitian_verification_audit where subject_user_id_snapshot=any(${ids}))
 ) as m;rollback;`)[0].m;
};
const actor=async(label,role,approved=false)=>{
 ensure(manifest.creation_intents.length<17,'Fixture cap exceeded');
 const id=randomUUID(),email=`db-smoke-${manifest.run_id}-${label}@example.invalid`,password='DbSm0ke!'+randomUUID();
 manifest.creation_intents.push({label,role,requested_id:id,email,approved,created:false});save();
 const data=await mutate('Synthetic Auth create failed',()=>admin.auth.admin.createUser({id,email,password,email_confirm:true,user_metadata:{account_type:role,role,full_name:'Synthetic Invite '+label,invite_smoke_run:manifest.run_id}}));
 ensure(data?.user?.id===id&&data.user.user_metadata?.invite_smoke_run===manifest.run_id,'Synthetic Auth identity mismatch');
 manifest.creation_intents.at(-1).created=true;manifest.owned_auth_user_ids.push(id);manifest.owned_profile_ids.push(id);save();
 const profile=result(await admin.from('profiles').select('id,role').eq('id',id).single(),'Synthetic profile read failed');
 ensure(profile.role===role,'Synthetic onboarding role mismatch');
 if(role==='dietitian'&&approved){
  own(id);
  const rows=await mutate('Owned dietitian approval setup failed',()=>admin.from('dietitian_profiles').update({verification_status:'approved',is_verified:true}).eq('user_id',id).select('user_id'));
  ensure(rows?.length===1,'Owned dietitian approval setup affected unexpected count');
  await mutate('Owned Core subscription setup failed',()=>admin.from('dietitian_subscriptions').upsert({dietitian_id:id,plan_id:'core',status:'active'}));
  manifest.owned_subscription_ids.push(id);save();
 }
 const client=createClient(url,anonKey,clientOptions);
 const session=await mutate('Synthetic login failed',()=>client.auth.signInWithPassword({email,password}));
 ensure(session?.user?.id===id&&session.session?.access_token,'Synthetic login identity mismatch');
 const a={id,role,client,token:session.session.access_token};actors.push(a);return a;
};
const rpc=async(a,name,args)=>{own(a.id);return mutate('Owned RPC '+name+' failed',()=>a.client.rpc(name,args));};
const connect=(a,code)=>rpc(a,'redeem_dietitian_invite_code',{p_code:code});
const preview=(a,code)=>rpc(a,'preview_dietitian_invite_code',{p_code:code});
const capture=async()=>{
 const ids=manifest.owned_auth_user_ids;if(!ids.length)return;
 const rows=result(await admin.from('dietitian_clients').select('id,dietitian_id,client_id,status').or(`client_id.in.(${ids.join(',')}),dietitian_id.in.(${ids.join(',')})`),'Owned relationship inventory failed');
 ensure(rows.every(r=>ids.includes(r.dietitian_id)&&ids.includes(r.client_id)),'Unexpected relationship with non-fixture user; do not cascade delete');
 manifest.owned_relationship_ids=rows.map(r=>r.id);
 const notes=result(await admin.from('notifications').select('id,actor_id,recipient_id,event_type').or(`recipient_id.in.(${ids.join(',')}),actor_id.in.(${ids.join(',')})`),'Owned notification inventory failed');
 ensure(notes.every(n=>ids.includes(n.recipient_id)&&(!n.actor_id||ids.includes(n.actor_id))),'Unexpected non-fixture notification recipient; do not cascade delete');
 manifest.owned_notification_ids=notes.map(n=>n.id);save();return {rows,notes};
};
try{
 verify();
 const keys=JSON.parse(rawCli(['projects','api-keys','--project-ref',ref,'--reveal','--output','json']));
 const service=keys.find(k=>k.name==='service_role')?.api_key;anonKey=keys.find(k=>k.name==='anon')?.api_key;
 ensure(service&&anonKey,'Required existing API keys missing');
 for(const [key,role] of [[service,'service_role'],[anonKey,'anon']]){
  const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());ensure(claims.ref===ref&&claims.role===role,'Key target/role mismatch');
 }
 admin=createClient(url,service,clientOptions);
 const flight=sql(readFileSync(join(root,'supabase/preflight/invite_postflight.sql'),'utf8'));
 ensure(flight.length===21&&flight.every(x=>x.status==='PASS'),'Production catalog preflight failed');
 const core=result(await admin.from('subscription_plans').select('id,client_limit,is_active').eq('id','core').single(),'Core readiness read failed');
 ensure(core.client_limit===10&&core.is_active,'Unexpected Core plan; never modify shared plan');pass('preflight and target readiness');
 const d=await actor('diet-a','dietitian',true),d2=await actor('diet-b','dietitian',true),pending=await actor('pending','dietitian');
 const a=await actor('main','client'),limited=await actor('rate','client'),closed=await actor('closed','client');
 const code=await rpc(d,'get_my_invite_code'),code2=await rpc(d2,'get_my_invite_code');
 manifest.owned_invite_code_owner_ids=[d.id,d2.id];save();
 ensure(code.code!==code2.code&&/^DB(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}$/.test(code.code),'Server code contract failed');
 verify();ensure((await pending.client.rpc('get_my_invite_code')).error,'Unapproved dietitian unexpectedly allowed');pass('unapproved dietitian denial and server code generation');
 const p=await preview(a,code.code.toLowerCase().replaceAll('-',''));
 ensure(p.result==='ready'&&p.dietitian.id===d.id,'Valid normalized preview failed');
 ensure(result(await admin.from('dietitian_clients').select('id').eq('client_id',a.id),'Preview relationship check failed').length===0,'Preview created relationship');pass('valid preview has no relationship side effect');
 ensure(await connect(a,code.code)==='connected','Connect failed');
 ensure(await connect(a,code.code)==='already_connected','Same code idempotency failed');
 ensure(await connect(a,code2.code)==='has_other_dietitian','Other dietitian denial failed');pass('connect, idempotency and other-dietitian denial');
 const first=await capture();
 ensure(first.notes.some(n=>n.actor_id===a.id&&n.recipient_id===d.id&&n.event_type==='accepted'),'Acceptance recipient failed');
 ensure(!first.notes.some(n=>n.recipient_id===a.id&&n.event_type==='request_pending'),'Unexpected obsolete pending notification');
 ensure(await rpc(a,'leave_my_dietitian')==='left'&&await rpc(a,'leave_my_dietitian')==='not_connected','Leave idempotency failed');
 const left=await capture();ensure(left.notes.some(n=>n.actor_id===a.id&&n.recipient_id===d.id&&n.event_type==='removed'),'Leave notification recipient failed');pass('leave and exact notification recipients');
 await rpc(d,'set_my_invite_code_open',{p_is_open:false});
 ensure((await preview(closed,code.code)).result==='closed'&&await connect(closed,code.code)==='closed','Closed code denial failed');
 await rpc(d,'set_my_invite_code_open',{p_is_open:true});pass('closed code preview/redeem and reopen');
 for(let i=0;i<5;i++)ensure((i%2?(await preview(limited,'BAD-CODE')).result:await connect(limited,'BAD-CODE'))==='not_found','Invalid code result failed');
 ensure((await preview(limited,code.code)).result==='rate_limited'&&await connect(limited,code.code)==='rate_limited','Combined preview/redeem rate limit failed');pass('invalid code and combined failure rate limit');
 for(let i=0;i<9;i++){const c=await actor('capacity-'+i,'client');ensure(await connect(c,code.code)==='connected','Capacity filler failed');}
 const raceA=await actor('race-a','client'),raceB=await actor('race-b','client');
 const outcomes=await Promise.all([connect(raceA,code.code),connect(raceB,code.code)]);
 ensure(outcomes.sort().join(',')==='connected,limit_reached','Last capacity slot race failed');
 const final=await capture();ensure(final.rows.filter(r=>r.dietitian_id===d.id&&['active','pending'].includes(r.status)).length===10,'Capacity exceeded');pass('capacity: two-client final-slot race has one winner');
 manifest.before_cleanup=counts();manifest.status='SMOKE_PASS_CLEANUP_PENDING';save();
}catch(e){failure=e;manifest.failure=e instanceof Error?e.message:'Smoke failure';manifest.status='SMOKE_FAILED_CLEANUP_PENDING';save();process.stdout.write('SMOKE_FAILED; cleanup starting; no raw error payload logged\n');}
finally{
 if(admin){try{
  // Reconcile uncertain create responses using exact pre-recorded UUID+marker+email, never list real users.
  const ids=ownedUuidSql();
  const found=sql(`begin transaction read only;select id::text,email,raw_user_meta_data->>'invite_smoke_run' as run_marker from auth.users where id=any(${ids});rollback;`);
  for(const u of found){const intent=manifest.creation_intents.find(i=>i.requested_id===u.id);ensure(intent&&u.run_marker===manifest.run_id&&u.email===intent.email,'Cleanup ownership marker mismatch');if(!manifest.owned_auth_user_ids.includes(u.id))manifest.owned_auth_user_ids.push(u.id);}
  save();await capture();
  for(const a of actors)await mutate('Owned global signout failed',()=>admin.auth.admin.signOut(a.token,'global'));
  if(manifest.owned_relationship_ids.length)await mutate('Owned relationship cleanup failed',()=>admin.from('dietitian_clients').delete().in('id',manifest.owned_relationship_ids));
  if(manifest.owned_notification_ids.length)await mutate('Owned notification cleanup failed',()=>admin.from('notifications').delete().in('id',manifest.owned_notification_ids));
  for(const id of [...manifest.owned_auth_user_ids].reverse()){
   own(id);const user=result(await admin.auth.admin.getUserById(id),'Cleanup owned user verification failed').user;
   const intent=manifest.creation_intents.find(i=>i.requested_id===id);
   ensure(user?.user_metadata?.invite_smoke_run===manifest.run_id&&user.email===intent?.email,'Cleanup user identity changed');
   await mutate('Owned Auth cleanup failed',()=>admin.auth.admin.deleteUser(id));
  }
  const residue=counts();ensure(Object.values(residue).every(n=>n===0),'Owned fixture residue remains');
  manifest.cleanup_receipt={status:'PASS',finished_at:new Date().toISOString(),remaining:residue};
  manifest.status=failure?'SMOKE_FAILED_CLEANUP_PASS':'PASS';save();pass('remaining fixture rows = 0');
 }catch(e){cleanupFailure=e;manifest.cleanup_receipt={status:'FAIL',safe_error:e instanceof Error?e.message:'Cleanup failure'};manifest.status='CLEANUP_FAILED';save();process.stdout.write('CLEANUP_FAILED; retain private ownership manifest; stop rollout\n');}}
}
if(failure||cleanupFailure)process.exitCode=1;
else process.stdout.write('INVITE_PRODUCTION_SMOKE_PASS checks='+manifest.completed_checks.length+' fixtures='+manifest.owned_auth_user_ids.length+' residue=0 identityChecks='+manifest.identity_checks+'\n');
