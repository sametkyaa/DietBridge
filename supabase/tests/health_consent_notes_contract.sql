reset role;
update private.health_consent_settings set enabled=false,document_version='health-notes-v1';
update public.dietitian_clients set status='active';
create function public.fixture_note_write(p_client uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_current_user_dietitian() then raise exception 'Dietitian required' using errcode='42501'; end if;
  insert into public.dietitian_notes(dietitian_id,client_id,title,content)
  values(auth.uid(),p_client,'Fixture','Fixture health content');
end $$;
revoke all on function public.fixture_note_write(uuid) from public;
grant execute on function public.fixture_note_write(uuid) to authenticated;

set role authenticated;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into public.dietitian_notes(id,dietitian_id,client_id,title,content) values
('55555555-5555-4555-8555-555555555555',auth.uid(),'11111111-1111-4111-8111-111111111111','Dormant linked','Fixture'),
('66666666-6666-4666-8666-666666666666',auth.uid(),null,'General','General task');
select public.fixture_assert((select count(*)=2 from public.dietitian_notes),'notes dormant unchanged');
reset role;
update private.health_consent_settings set enabled=true;
set role authenticated;
select public.fixture_assert((select count(*)=1 from public.dietitian_notes),'only general note without sharing');
select public.fixture_denied($$select public.fixture_note_write('11111111-1111-4111-8111-111111111111')$$,'JWT definer cannot bypass notes consent');
select public.fixture_denied($$insert into public.dietitian_notes(dietitian_id,client_id,title,content)
values(auth.uid(),'11111111-1111-4111-8111-111111111111','Blocked','Blocked')$$,'direct linked note blocked');

set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.set_my_health_consent('health-notes-v1',true,false);
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.fixture_assert((select count(*)=1 from public.dietitian_notes),'storage is not notes sharing');
select public.fixture_denied($$select public.fixture_note_write('11111111-1111-4111-8111-111111111111')$$,'storage-only notes write blocked');
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.set_my_health_consent('health-notes-v1',true,true);
select public.fixture_assert((select count(*)=0 from public.dietitian_notes),'notes stay private to dietitian');
set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.fixture_assert((select count(*)=0 from public.dietitian_notes),'foreign dietitian still denied');
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.fixture_assert((select count(*)=2 from public.dietitian_notes),'sharing makes own linked note readable');
select public.fixture_note_write('11111111-1111-4111-8111-111111111111');
update public.dietitian_notes set content='Allowed update' where id='55555555-5555-4555-8555-555555555555';
select public.fixture_denied($$update public.dietitian_notes set client_id=null where id='55555555-5555-4555-8555-555555555555'$$,'cannot launder linked health note as general');
reset role;
update public.dietitian_clients set status='rejected';
set role authenticated;
select public.fixture_assert((select count(*)=1 from public.dietitian_notes),'stale relationship hides linked notes');
reset role;
update public.dietitian_clients set status='active';
update private.health_consent_settings set document_version='health-notes-v2';
set role authenticated;
select public.fixture_assert((select count(*)=1 from public.dietitian_notes),'new document invalidates note sharing');
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.set_my_health_consent('obsolete',false,false);
reset role;
set role service_role;
set request.jwt.claim.sub='';
select public.fixture_denied($$insert into public.dietitian_notes(dietitian_id,client_id,title,content)
values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Service blocked','Blocked')$$,'service note write blocked');
select public.fixture_denied($$update public.dietitian_notes set client_id=null where id='55555555-5555-4555-8555-555555555555'$$,'service unlink cannot bypass');
reset role;
set role authenticated;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
update public.dietitian_notes set content='Updated general task' where id='66666666-6666-4666-8666-666666666666';
delete from public.dietitian_notes where id='66666666-6666-4666-8666-666666666666';
reset role;
select public.fixture_assert((select count(*)=2 from public.dietitian_notes),'negative choice preserves retained linked records');
-- Existing privileged account deletion performs DELETE, not an unlink UPDATE.
delete from public.dietitian_notes where client_id='11111111-1111-4111-8111-111111111111';
select public.fixture_assert((select count(*)=0 from public.dietitian_notes),'account cleanup DELETE remains possible');
select 'HEALTH_CONSENT_NOTES_CONTRACT_PASS' as result;
