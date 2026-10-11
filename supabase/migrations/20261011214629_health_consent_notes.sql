-- Dormant extension: client-linked notes are health content. General notes
-- must not contain client health information; association removal is not a bypass.
begin;
do $preflight$
begin
  if to_regprocedure('private.health_consent_has(uuid,boolean)') is null
     or not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.dietitian_notes')),false)
     or not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.dietitian_notes')
                   and tgname='dietitian_notes_enforce_contract' and not tgisinternal) then
    raise exception 'Notes/consent prerequisites missing';
  end if;
end
$preflight$;

create function private.guard_note_health_write()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
declare v_actor uuid := auth.uid();
begin
  if not private.health_consent_enabled() then return new; end if;
  -- Keep privileged maintenance/account cleanup separate from JWT writers.
  if v_actor is null and current_user in ('postgres','supabase_admin') then return new; end if;
  if tg_op='UPDATE' and old.client_id is not null
     and new.client_id is distinct from old.client_id then
    raise exception 'Client health note association cannot be removed or reassigned' using errcode='42501';
  end if;
  if new.client_id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.client_id::text,8311));
  if v_actor is null then
    if current_user='service_role' and private.health_consent_has(new.client_id,true) then return new; end if;
    raise exception 'Health data sharing consent required' using errcode='42501';
  end if;
  if not private.health_consent_allows(new.client_id,true) then
    raise exception 'Health data sharing consent required' using errcode='42501';
  end if;
  return new;
end;
$fn$;
revoke all on function private.guard_note_health_write() from public,anon,authenticated,service_role;
create trigger trg_guard_note_health_write before insert or update on public.dietitian_notes
for each row execute function private.guard_note_health_write();

-- Existing approved-role/ownership policies remain necessary. When enabled,
-- linked notes additionally require current sharing and an active relationship.
create policy "Note health consent sharing gate" on public.dietitian_notes
as restrictive for select to authenticated using (
  client_id is null or not private.health_consent_enabled() or (
    private.health_consent_allows(client_id,true) and exists (
      select 1 from public.dietitian_clients dc
      where dc.dietitian_id=(select auth.uid()) and dc.client_id=dietitian_notes.client_id
        and dc.status='active'::public.client_status
    )
  )
);
-- No DELETE guard, inferred grant, retention change, or automatic purge.
notify pgrst,'reload schema';
commit;
