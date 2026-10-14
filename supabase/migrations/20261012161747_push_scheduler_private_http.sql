-- Correct the hosted pg_net ACL assumption without changing managed objects.
-- HTTP calls execute synchronously in the owner-only cron session. The Vault
-- credential never enters net.http_request_queue or a persistent response table.
-- The rollout flag remains OFF; activation is a separate, guarded operation.
begin;
create extension if not exists http with schema extensions;
do $$ begin
 if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
   where e.extname='http' and n.nspname='extensions') then
  raise exception 'HTTP extension must use the extensions schema';
 end if;
 if to_regprocedure('private.invoke_push_dispatch()') is null then
  raise exception 'Push worker prerequisite missing';
 end if;
 if exists(select 1 from private.push_dispatch_settings where singleton and enabled) then
  raise exception 'Disable dispatch before replacing its transport';
 end if;
end $$;
create or replace function private.invoke_push_dispatch() returns bigint
language plpgsql security definer set search_path=''
as $fn$
declare v_url text; v_secret text; response extensions.http_response;
begin
 if not exists(select 1 from private.push_dispatch_settings where singleton and enabled) then
  return null;
 end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='dietbridge_push_project_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='dietbridge_push_dispatch_secret';
 if v_url is null or v_url !~ '^https://[a-z0-9]{20}[.]supabase[.]co$'
  or v_secret is null or char_length(v_secret) not between 32 and 512 then
  raise exception 'Push scheduler configuration missing or invalid';
 end if;
 begin
  -- The installed http 1.6 exposes C option functions, not newer GUC names.
  if not extensions.http_reset_curlopt()
   or not extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000')
   or not extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5') then
   raise exception 'Push HTTP timeout configuration failed';
  end if;
  select * into response from extensions.http(row('POST',v_url||'/functions/v1/dispatch-push',
   array[row('x-dispatch-secret',v_secret)::extensions.http_header],
   'application/json','{}')::extensions.http_request);
  perform extensions.http_reset_curlopt();
 exception when others then
  perform extensions.http_reset_curlopt();
  -- Do not include libcurl messages, response bodies, headers or credentials.
  raise exception 'Push scheduler HTTP request failed' using errcode='58000';
 end;
 if response.status is distinct from 200 then
  raise exception 'Push scheduler returned an unsuccessful status' using errcode='58000';
 end if;
 return response.status::bigint;
end $fn$;
revoke all on function private.invoke_push_dispatch() from public,anon,authenticated,service_role;
commit;
