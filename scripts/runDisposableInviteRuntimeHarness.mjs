import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = '20261005120859_dietitian_invite_codes.sql';
const projectId = `dietbridge-invite-${process.pid}-${randomUUID().slice(0,8)}`;
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
const connect = (a,code) => rpc(a,'redeem_dietitian_invite_code',{p_code:code});
const preview = (a,code) => rpc(a,'preview_dietitian_invite_code',{p_code:code});
try {
  disposable=await runDisposableSupabaseLocalReplay({materializeOnly:true,keepTemp:true});
  addCurrentIsolatedMigrations({repoRoot,tempRoot:disposable.tempRoot});
  copyFileSync(join(repoRoot,'supabase/migrations',migration),join(disposable.tempRoot,'supabase/migrations',migration));
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
  execFileSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync(join(repoRoot,'supabase/migrations',migration)),encoding:'utf8',windowsHide:true});
  pass('repeat apply is idempotent');
  const d=await actor('dietitian'); const d2=await actor('dietitian'); const unapproved=await actor('dietitian',false);
  const a=await actor('client'); const b=await actor('client');
  const code=await rpc(d,'get_my_invite_code'); const code2=await rpc(d2,'get_my_invite_code');
  assert.notEqual(code.code,code2.code); assert.match(code.code,/^DB(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}$/); pass('unique server generated code and entropy alphabet');
  assert.equal((await rpc(d,'get_my_invite_code')).code,code.code); pass('get is idempotent');
  assert.ok((await unapproved.client.rpc('get_my_invite_code')).error); pass('unapproved dietitian denied');
  assert.ok((await a.client.rpc('get_my_invite_code')).error); pass('client cannot manage code');
  assert.ok((await d.client.rpc('leave_my_dietitian')).error); pass('dietitian cannot call client leave');
  await admin.from('dietitian_profiles').update({verification_status:'approved',is_verified:true}).eq('user_id',unapproved.id);
  const unapprovedCode=await rpc(unapproved,'get_my_invite_code');
  ok(await admin.from('dietitian_profiles').update({verification_status:'pending',is_verified:false}).eq('user_id',unapproved.id));
  assert.equal(await connect(b,unapprovedCode.code),'not_found'); pass('revoked approval invalidates redeem');
  const anon=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.ok((await anon.rpc('preview_dietitian_invite_code',{p_code:code.code})).error); pass('anonymous preview denied');
  assert.ok((await d.client.rpc('preview_dietitian_invite_code',{p_code:code.code})).error); pass('dietitian preview denied');
  const p=await preview(a,code.code.toLowerCase().replaceAll('-',''));
  assert.equal(p.result,'ready'); assert.equal(p.dietitian.id,d.id); assert.deepEqual(Object.keys(p.dietitian).sort(),['avatar_url','display_name','id','professional_title']);
  assert.equal(ok(await admin.from('dietitian_clients').select('id').eq('client_id',a.id)).length,0); pass('normalized safe preview never creates relationship');
  assert.equal(ok(await a.client.from('dietitian_invite_codes').select('*')).length,0); pass('client cannot enumerate invite codes');
  assert.ok((await a.client.from('dietitian_clients').insert({dietitian_id:d.id,client_id:a.id,status:'active'})).error); pass('direct active insert denied');
  assert.equal(await connect(a,code.code),'connected'); pass('valid client connects');
  assert.equal(ok(await admin.from('notifications').select('id').eq('recipient_id',a.id).eq('event_type','request_pending')).length,0); pass('direct redeem does not emit obsolete pending approval notification');
  assert.equal(await connect(a,code.code),'already_connected'); pass('repeat redeem idempotent');
  assert.equal(await connect(a,code2.code),'has_other_dietitian'); pass('other active dietitian denied');
  const denied=await b.client.from('dietitian_clients').update({status:'removed'}).eq('client_id',a.id).select('id');
  assert.equal(ok(denied).length,0); pass('cross tenant relationship update denied');
  assert.equal(await rpc(a,'leave_my_dietitian'),'left'); assert.equal(await rpc(a,'leave_my_dietitian'),'not_connected');
  assert.equal(ok(await admin.from('notifications').select('actor_id,recipient_id,event_type').eq('recipient_id',d.id).eq('event_type','removed')).some(n=>n.actor_id===a.id),true); pass('leave is scoped idempotent and notifies dietitian');
  assert.equal(ok(await admin.from('notifications').select('id').eq('recipient_id',a.id).eq('event_type','removed')).length,0); pass('client leave does not emit a dietitian initiated removal to client');
  assert.equal(await connect(a,code.code),'connected'); pass('removed pair reactivates');
  const rotated=await rpc(d,'rotate_my_invite_code'); assert.notEqual(rotated.code,code.code);
  assert.equal((await preview(b,code.code)).result,'not_found'); pass('rotated old code invalid');
  await rpc(d,'set_my_invite_code_open',{p_is_open:false}); assert.equal((await preview(b,rotated.code)).result,'closed');
  assert.equal(await connect(b,rotated.code),'closed'); pass('closed code redeem denied');
  assert.equal(ok(await admin.from('dietitian_clients').select('status').eq('client_id',a.id))[0].status,'active'); pass('pause preserves active relationships');
  await rpc(d,'set_my_invite_code_open',{p_is_open:true});
  const limited=await actor('client');
  for(let i=0;i<5;i++) assert.equal(i%2?(await preview(limited,'BAD-CODE')).result:await connect(limited,'BAD-CODE'),'not_found');
  assert.equal((await preview(limited,rotated.code)).result,'rate_limited'); assert.equal(await connect(limited,rotated.code),'rate_limited'); pass('five combined failures block sixth preview and redeem');
  const legacy=await actor('client');
  assert.equal(await rpc(d2,'request_client_connection_by_email',{p_email:legacy.email}),'requested');
  const pending=ok(await legacy.client.from('dietitian_clients').select('id,dietitian_id').eq('status','pending'))[0];
  const moved=await legacy.client.from('dietitian_clients').update({status:'active',dietitian_id:d.id}).eq('id',pending.id); assert.ok(moved.error); pass('pending approval cannot reassign tenant');
  assert.equal(await connect(legacy,rotated.code),'connected');
  assert.equal(ok(await admin.from('dietitian_clients').select('status').eq('id',pending.id))[0].status,'removed'); pass('successful redeem closes caller old pending');
  const reject=await actor('client'); await rpc(d2,'request_client_connection_by_email',{p_email:reject.email});
  ok(await reject.client.from('dietitian_clients').update({status:'rejected'}).eq('client_id',reject.id).eq('status','pending'));
  assert.equal(await connect(reject,code2.code),'connected'); pass('rejected pair reactivates');
  const approve=await actor('client'); await rpc(d2,'request_client_connection_by_email',{p_email:approve.email});
  ok(await approve.client.from('dietitian_clients').update({status:'active'}).eq('client_id',approve.id).eq('status','pending'));
  assert.equal(await connect(approve,code2.code),'already_connected'); pass('legacy direct approve remains supported');
  // Fill Core's remaining slots using the canonical new RPC, then race the final slot.
  const used=ok(await admin.from('dietitian_clients').select('id').eq('dietitian_id',d.id).in('status',['active','pending'])).length;
  for(let i=used;i<9;i++){const filler=await actor('client'); assert.equal(await connect(filler,rotated.code),'connected');}
  const raceA=await actor('client'); const raceB=await actor('client');
  assert.deepEqual((await Promise.all([connect(raceA,rotated.code),connect(raceB,rotated.code)])).sort(),['connected','limit_reached']);
  assert.equal(ok(await admin.from('dietitian_clients').select('id').eq('dietitian_id',d.id).in('status',['active','pending'])).length,10); pass('last capacity slot race has exactly one winner');
  const fullPending=await actor('client');
  await rpc(d2,'request_client_connection_by_email',{p_email:fullPending.email});
  assert.equal(await connect(fullPending,rotated.code),'limit_reached');
  assert.equal(ok(await fullPending.client.from('dietitian_clients').select('status').eq('status','pending')).length,1); pass('failed capacity check preserves legacy pending');
  const expired=await actor('client');
  for(let i=0;i<5;i++) assert.equal(await connect(expired,'INVALID'),'not_found');
  execFileSync('docker',['exec',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`update private.invite_code_attempts set attempted_at=now()-interval '25 hours' where client_id='${expired.id}'; select private.cleanup_invite_code_attempts(); select private.cleanup_invite_code_attempts();`],{encoding:'utf8',windowsHide:true});
  assert.equal((await preview(expired,code2.code)).result,'ready'); pass('attempt expiry and cleanup idempotency');
  pass('INVITE_BACKEND_RUNTIME_MATRIX');
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
if(failure){process.stderr.write(`${failure.stack}\n`);process.exitCode=1;}else process.stdout.write(`INVITE_BACKEND_RUNTIME_PASS checks=${checks}\n`);
