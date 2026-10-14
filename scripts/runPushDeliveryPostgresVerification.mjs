// In-memory real PostgreSQL queue verification, without credentials/network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.argv[2];
if (!runtime) throw new Error('Pass the isolated PGlite directory.');
const { PGlite } = await import(pathToFileURL(join(runtime, 'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(join(runtime, 'dist/contrib/pgcrypto.js')));
const db = await PGlite.create({ extensions: { pgcrypto } });
const migration = name => readFileSync(resolve('supabase/migrations', name), 'utf8');
const rows = async sql => (await db.query(sql)).rows;
try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; create schema extensions; create schema cron;
      create extension pgcrypto with schema extensions;
      -- Transport types only: idle scheduling must return before Vault/HTTP access.
      create type extensions.http_response as (status integer,content_type text,headers text[],content text);
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key,role text);
      create type public.client_status as enum ('active','inactive');
      create table public.dietitian_clients(id uuid primary key,dietitian_id uuid,client_id uuid,status public.client_status);
      create table public.chat_conversations(id uuid primary key,dietitian_client_id uuid,dietitian_id uuid,client_id uuid);
      create function public.chat_has_active_relationship(uuid,uuid) returns boolean language sql as
        'select exists(select 1 from public.dietitian_clients where dietitian_id=$1 and client_id=$2 and status=''active'')';
      create table public.notifications(id uuid primary key,recipient_id uuid,category text,event_type text,summary_key text,
        aggregation_key text,occurred_at timestamptz,event_count integer,read_at timestamptz,conversation_id uuid);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table private.health_fixture(allowed boolean); insert into private.health_fixture values(true);
      create function private.notification_health_allows(public.notifications,boolean) returns boolean language sql as 'select allowed from private.health_fixture';
      create table cron.fixture(jobname text primary key,schedule text,command text);
      create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin
        insert into cron.fixture values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3; return 1; end$$;
    `);
    await db.exec(migration('20260817120000_push_registry_outbox_backend.sql'));
    await db.exec(migration('20261012155048_push_dispatch_worker.sql'));
    await db.exec(migration('20261012162958_push_dispatch_active_pair.sql'));
    const update = migration('20261014080429_chat_push_delivery_latency.sql');
    await db.exec(update); await db.exec(update);
    assert.equal((await rows('select schedule from cron.fixture'))[0].schedule, '10 seconds');
    console.log('PASS repeat migration and 10-second schedule');
    await db.exec('update private.push_dispatch_settings set enabled=true');
    assert.equal((await rows('select private.invoke_push_dispatch() as result'))[0].result, null);
    for (const role of ['anon','authenticated','service_role']) {
        assert.equal((await rows(`select has_function_privilege('${role}','private.invoke_push_dispatch()','execute') as ok`))[0].ok, false);
    }
    console.log('PASS idle scheduler skips Vault/HTTP and transport stays owner-only');
    await db.exec(`
      insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      insert into public.profiles values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','client');
      insert into private.push_installations(user_id,installation_id,expo_push_token,platform,project_id,app_version)
      select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),'ExpoPushToken[fixture]','android',project_id,'1.0.4' from private.push_dispatch_settings;
      update private.push_dispatch_settings set enabled=true;
      insert into public.dietitian_clients values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active');
      insert into public.chat_conversations values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      insert into public.notifications values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','chat_message','new_message','chat_new_message','fixture',now(),1,null,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    `);
    const delivery = (await rows('select * from private.push_deliveries'))[0];
    assert.ok(delivery, 'notification trigger creates delivery');
    assert.equal(Number((await rows('select extract(epoch from (available_at-created_at)) as delay from private.push_deliveries'))[0].delay), 3);
    assert.equal((await rows(`select private.push_dispatch_current('${delivery.id}') as ok`))[0].ok, true);
    console.log('PASS real notification trigger, 3-second coalescing and eligibility');
    assert.deepEqual((await rows("select public.claim_push_dispatch('send',25) as jobs"))[0].jobs, []);
    await db.exec("update private.push_deliveries set available_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second'; update private.push_dispatch_settings set next_dispatch_at=now()-interval '1 second'");
    const job = (await rows("select public.claim_push_dispatch('send',25) as jobs"))[0].jobs[0];
    assert.equal(job.appVersion, '1.0.4'); assert.equal(job.conversationId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    const budget = Number((await rows('select extract(epoch from(next_dispatch_at-now())) as seconds from private.push_dispatch_settings'))[0].seconds);
    assert.ok(budget <= 5 && budget > 0);
    assert.deepEqual((await rows("select public.claim_push_dispatch('send',25) as jobs"))[0].jobs, []);
    console.log('PASS version-aware payload, short budget, duplicate invocation');
    const hash = (await rows("select encode(extensions.digest('ExpoPushToken[fixture]','sha256'),'hex') as value"))[0].value;
    assert.equal((await rows(`select public.prepare_push_dispatch('${job.id}','${job.claimId}','${hash}') as ok`))[0].ok, true);
    await db.exec('update private.health_fixture set allowed=false');
    assert.equal((await rows(`select public.prepare_push_dispatch('${job.id}','${job.claimId}','${hash}') as ok`))[0].ok, false);
    assert.equal((await rows('select status from private.push_deliveries'))[0].status, 'disabled');
    console.log('PASS consent withdrawal before send');
    await db.exec('update private.health_fixture set allowed=true');
    for (const sql of ["update public.notifications set read_at=now()", "update public.notifications set read_at=null,event_count=2", "update public.notifications set event_count=1; update public.dietitian_clients set status='inactive'"]) {
        await db.exec(sql);
        assert.equal((await rows(`select private.push_dispatch_current('${job.id}') as ok`))[0].ok, false);
    }
    console.log('PASS read/superseded/inactive relationship guards');
    for (const role of ['anon','authenticated']) {
        assert.equal((await rows(`select has_function_privilege('${role}','public.claim_push_dispatch(text,integer)','execute') as ok`))[0].ok, false);
        assert.equal((await rows(`select has_table_privilege('${role}','private.push_deliveries','select') as ok`))[0].ok, false);
    }
    console.log('PASS client queue access denied');
    console.log('PUSH_DELIVERY_POSTGRES_PASS');
} catch (error) {
    console.error('PUSH_DELIVERY_POSTGRES_FAIL:', error.message, error.detail || '', error.where || '');
    process.exitCode = 1;
} finally { await db.close(); }
