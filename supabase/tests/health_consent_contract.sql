-- Run only after disposable/health_consent_bootstrap.sql and the consent migration.
create function public.fixture_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function public.fixture_denied(stmt text,label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege then return; end;
  raise exception 'FAIL: expected 42501: %',label;
end $$;
create function public.fixture_invalid(stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when invalid_parameter_value then return; end;
  raise exception 'FAIL: expected invalid_parameter_value';
end $$;
grant execute on function public.fixture_assert(boolean,text), public.fixture_denied(text,text),public.fixture_invalid(text) to authenticated;

select public.fixture_assert(not enabled,'default dormant') from private.health_consent_settings;
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
update public.client_profiles set height_cm=170 where user_id=auth.uid();
select public.fixture_assert((public.get_my_health_consent()->>'storage_granted')::boolean=false,'no inferred consent');
select public.fixture_denied('select * from private.health_consent_state','private state inaccessible');
select public.fixture_denied('insert into private.health_consent_events(user_id) values(auth.uid())','ledger not writable');
reset role;
update private.health_consent_settings set enabled=true;
set role authenticated;
select public.fixture_denied('update public.client_profiles set height_cm=180 where user_id=auth.uid()','legacy direct profile write');
select public.fixture_denied('select public.fixture_definer_write(77)','definer write cannot bypass consent');
select public.fixture_invalid($$select public.set_my_health_consent('wrong',true,false)$$);
select public.fixture_invalid($$select public.set_my_health_consent('health-core-2026-10-11-v1-draft',false,true)$$);
select public.set_my_health_consent('health-core-2026-10-11-v1-draft',true,false);
update public.client_profiles set height_cm=175 where user_id=auth.uid();
select public.fixture_definer_write(78);
insert into public.daily_logs(client_id,water_intake) values(auth.uid(),2);
insert into public.client_medications(client_id,notes) values(auth.uid(),'fixture');
insert into public.client_medical_conditions(client_id,notes) values(auth.uid(),'fixture');
insert into public.body_measurements(client_id,waist_cm) values(auth.uid(),80);
select public.fixture_denied($$insert into public.measurements(client_id,weight) values('22222222-2222-4222-8222-222222222222',78)$$,'cross-client write');
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.fixture_assert((select count(*)=0 from public.client_profiles),'active dietitian needs sharing');
select public.fixture_denied($$select public.set_my_health_consent('health-core-2026-10-11-v1-draft',true,true)$$,'dietitian cannot self-grant');
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.set_my_health_consent('health-core-2026-10-11-v1-draft',true,true);
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.fixture_assert((select count(*)=1 from public.client_profiles),'sharing plus active relation allowed');
set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.fixture_assert((select count(*)=0 from public.client_profiles),'sharing does not authorize foreign dietitian');
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
-- A false choice invalidates future writes/other-party reads; DELETE still works.
select public.set_my_health_consent('obsolete-version',false,false);
select public.fixture_denied('select public.fixture_definer_write(79)','false choice blocks writes');
select public.fixture_denied('insert into public.daily_logs(client_id,water_intake) values(auth.uid(),3)','logs denied');
select public.fixture_denied('insert into public.client_medications(client_id,notes) values(auth.uid(),''x'')','medications denied');
select public.fixture_denied('insert into public.client_medical_conditions(client_id,notes) values(auth.uid(),''x'')','conditions denied');
select public.fixture_denied('insert into public.body_measurements(client_id,waist_cm) values(auth.uid(),81)','legacy measurements denied');
delete from public.measurements where client_id=auth.uid();
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.fixture_assert((select count(*)=0 from public.daily_logs),'sharing cut off');
reset role;
select public.fixture_assert((select count(*)=3 from private.health_consent_events),'separate event history');
select public.fixture_assert((select bool_and(recorded_at is not null and processing_text<>'' and sharing_text<>'' and notice_version<>'') from private.health_consent_events),'server timestamps and text snapshot');
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.set_my_health_consent('health-core-2026-10-11-v1-draft',true,true);
reset role;
update private.health_consent_settings set document_version='v2';
set role authenticated;
select public.fixture_assert((public.get_my_health_consent()->>'storage_granted')::boolean=false,'old version invalidated');
select public.fixture_denied('select public.fixture_definer_write(80)','old version denied');
select public.set_my_health_consent('old',false,false);
set request.jwt.claim.sub='';
select public.fixture_denied('select public.get_my_health_consent()','missing JWT denied');
reset role;
set role anon;
select public.fixture_denied('select public.get_my_health_consent()','anon RPC denied');
reset role;
select 'HEALTH_CONSENT_CORE_CONTRACT_PASS' as result;
