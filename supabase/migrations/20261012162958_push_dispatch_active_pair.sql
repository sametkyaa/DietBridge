-- A service worker has no auth.uid(). Keep the relationship restriction while
-- using an owner-only predicate that does not impersonate a client session.
begin;
do $$ begin
 if exists(select 1 from private.push_dispatch_settings where singleton and enabled) then
  raise exception 'Disable dispatch before correcting its eligibility predicate';
 end if;
 if to_regprocedure('private.push_dispatch_current(uuid)') is null then
  raise exception 'Push eligibility prerequisite missing'; end if;
end $$;
create or replace function private.push_dispatch_current(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from private.push_deliveries d
  join private.push_installations i on i.id=d.installation_id
  join private.push_occurrences o on o.id=d.occurrence_id
  join public.notifications n on n.id=d.notification_id
  join private.push_dispatch_settings cfg on cfg.singleton
  where d.id=p_id and cfg.enabled and i.enabled and i.user_id=d.recipient_id
   and i.project_id=cfg.project_id and n.recipient_id=d.recipient_id
   and n.read_at is null and n.occurred_at=o.occurred_at and n.event_count=o.event_count
   and o.created_at>=now()-interval '1 hour'
   and n.event_type=o.event_type and private.notification_health_allows(n,false)
   and (n.category<>'chat_message' or exists (
    select 1 from public.chat_conversations c
    join public.dietitian_clients dc on dc.id=c.dietitian_client_id
     and dc.dietitian_id=c.dietitian_id and dc.client_id=c.client_id
    where c.id=n.conversation_id and d.recipient_id in (c.client_id,c.dietitian_id)
     and dc.status='active'::public.client_status))
 );
$$;
revoke all on function private.push_dispatch_current(uuid) from public,anon,authenticated,service_role;
commit;
