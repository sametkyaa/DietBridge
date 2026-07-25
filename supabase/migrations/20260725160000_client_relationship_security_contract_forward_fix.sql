-- DietBridge Production forward fix:
-- danışan-diyetisyen bağlantı isteğini güvenli RPC üzerinden oluşturur,
-- geniş profil lookup erişimini daraltır ve ilişki durum geçişlerini korur.
--
-- Bu migration veri backfill'i veya Auth kullanıcısı oluşturmaz.
-- Tüm değişiklikler tek transaction içindedir; bir doğrulama başarısız olursa rollback olur.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('public.one_pending_or_active_dietitian_per_client') is null
     or to_regclass('public.dietitian_clients_dietitian_client_unique') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null then
    raise exception 'Danışan ilişkilendirme sözleşmesi için beklenen şema nesneleri bulunamadı; migration durduruldu.';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in ('id', 'email', 'role')
  ) <> 3 then
    raise exception 'profiles ilişkilendirme kolonları eksik; migration durduruldu.';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_clients'
      and column_name in (
        'dietitian_id',
        'client_id',
        'status',
        'requested_at',
        'accepted_at',
        'rejected_at',
        'removed_at',
        'updated_at'
      )
  ) <> 8 then
    raise exception 'dietitian_clients sözleşme kolonları eksik; migration durduruldu.';
  end if;
end
$$;

-- İlişkisiz diyetisyenlerin client temel profilini aramasına izin veren geniş
-- lookup policy kaldırılır. Self erişim policy'leri korunur; karşı taraf erişimi
-- yalnız pending/active ilişki üzerinden verilir.
drop policy if exists "Dietitians can view client profiles for linking" on public.profiles;
drop policy if exists "Relationship parties can view counterpart profiles" on public.profiles;

create policy "Relationship parties can view counterpart profiles"
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.dietitian_clients as dc
    where dc.status in ('pending'::public.client_status, 'active'::public.client_status)
      and (
        (dc.dietitian_id = (select auth.uid()) and dc.client_id = profiles.id)
        or (dc.client_id = (select auth.uid()) and dc.dietitian_id = profiles.id)
      )
  )
);

-- Browser tarafından client UUID bilinerek yapılan doğrudan INSERT yolu kapatılır.
-- Bağlantı isteği aşağıdaki SECURITY DEFINER RPC üzerinden oluşturulur.
drop policy if exists "dietitians_create_pending_client_request" on public.dietitian_clients;

create or replace function public.request_client_connection_by_email(p_email text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid := auth.uid();
  v_client_id uuid;
  v_existing_status public.client_status;
  v_normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_dietitian_id is null or not public.is_current_user_dietitian() then
    raise exception 'Diyetisyen yetkisi gerekli.' using errcode = '42501';
  end if;

  if v_normalized_email = '' then
    return 'unavailable';
  end if;

  select p.id
    into v_client_id
  from public.profiles as p
  where p.role = 'client'::public.user_role
    and lower(btrim(p.email)) = v_normalized_email
  order by p.id
  limit 1;

  -- Bulunmayan, client olmayan veya başka aktif/pending ilişkiye sahip hedefler
  -- aynı dar sonuçla döner; e-posta hesabı enumeration'ı yapılmaz.
  if v_client_id is null then
    return 'unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_client_id::text));

  select dc.status
    into v_existing_status
  from public.dietitian_clients as dc
  where dc.dietitian_id = v_dietitian_id
    and dc.client_id = v_client_id
  for update;

  if found then
    if v_existing_status = 'active'::public.client_status then
      return 'already_active';
    end if;

    if v_existing_status = 'pending'::public.client_status then
      return 'already_pending';
    end if;

    update public.dietitian_clients
       set status = 'pending'::public.client_status
     where dietitian_id = v_dietitian_id
       and client_id = v_client_id;

    return 'requested';
  end if;

  if exists (
    select 1
    from public.dietitian_clients as dc
    where dc.client_id = v_client_id
      and dc.status in ('pending'::public.client_status, 'active'::public.client_status)
  ) then
    return 'unavailable';
  end if;

  begin
    insert into public.dietitian_clients (dietitian_id, client_id, status)
    values (v_dietitian_id, v_client_id, 'pending'::public.client_status);
  exception
    when unique_violation then
      return 'unavailable';
  end;

  return 'requested';
end;
$function$;

alter function public.request_client_connection_by_email(text) owner to postgres;
revoke all on function public.request_client_connection_by_email(text) from public;
revoke all on function public.request_client_connection_by_email(text) from anon;
grant execute on function public.request_client_connection_by_email(text) to authenticated;

create or replace function public.enforce_dietitian_client_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'::public.client_status then
      raise exception 'Yeni danışan ilişkisi pending olarak oluşturulmalıdır.' using errcode = '23514';
    end if;

    new.requested_at := now();
    new.accepted_at := null;
    new.rejected_at := null;
    new.removed_at := null;
    new.updated_at := now();
    return new;
  end if;

  if new.status is not distinct from old.status then
    new.requested_at := old.requested_at;
    new.accepted_at := old.accepted_at;
    new.rejected_at := old.rejected_at;
    new.removed_at := old.removed_at;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'pending'::public.client_status
     and new.status = 'active'::public.client_status then
    new.requested_at := old.requested_at;
    new.accepted_at := now();
    new.rejected_at := null;
    new.removed_at := null;
  elsif old.status = 'pending'::public.client_status
     and new.status = 'rejected'::public.client_status then
    new.requested_at := old.requested_at;
    new.accepted_at := null;
    new.rejected_at := now();
    new.removed_at := null;
  elsif old.status = 'pending'::public.client_status
     and new.status = 'removed'::public.client_status then
    new.requested_at := old.requested_at;
    new.accepted_at := null;
    new.rejected_at := null;
    new.removed_at := now();
  elsif old.status = 'active'::public.client_status
     and new.status = 'removed'::public.client_status then
    new.requested_at := old.requested_at;
    new.accepted_at := old.accepted_at;
    new.rejected_at := null;
    new.removed_at := now();
  elsif old.status in ('rejected'::public.client_status, 'removed'::public.client_status)
     and new.status = 'pending'::public.client_status then
    new.requested_at := now();
    new.accepted_at := null;
    new.rejected_at := null;
    new.removed_at := null;
  else
    raise exception 'Geçersiz danışan ilişki geçişi: % -> %', old.status, new.status using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

alter function public.enforce_dietitian_client_transition() owner to postgres;
revoke all on function public.enforce_dietitian_client_transition() from public;
revoke all on function public.enforce_dietitian_client_transition() from anon;
revoke all on function public.enforce_dietitian_client_transition() from authenticated;

drop trigger if exists trg_enforce_dietitian_client_transition on public.dietitian_clients;
create trigger trg_enforce_dietitian_client_transition
before insert or update on public.dietitian_clients
for each row execute function public.enforce_dietitian_client_transition();

-- Transaction commit edilmeden önce hedef sözleşmeyi fail-fast doğrula.
do $$
begin
  if to_regprocedure('public.request_client_connection_by_email(text)') is null then
    raise exception 'Bağlantı RPC postcondition doğrulaması başarısız.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.dietitian_clients'::regclass
      and tgname = 'trg_enforce_dietitian_client_transition'
      and not tgisinternal
  ) then
    raise exception 'İlişki lifecycle trigger postcondition doğrulaması başarısız.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Dietitians can view client profiles for linking'
  ) then
    raise exception 'Legacy profil lookup policy kaldırılmadı.';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Relationship parties can view counterpart profiles'
  ) then
    raise exception 'Karşı taraf profil erişim policy postcondition doğrulaması başarısız.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'dietitian_clients'
      and policyname = 'dietitians_create_pending_client_request'
  ) then
    raise exception 'Legacy doğrudan ilişki INSERT policy kaldırılmadı.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.request_client_connection_by_email(text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated rolü bağlantı RPC EXECUTE yetkisine sahip değil.';
  end if;

  if has_function_privilege(
    'anon',
    'public.request_client_connection_by_email(text)',
    'EXECUTE'
  ) then
    raise exception 'anon rolü bağlantı RPC EXECUTE yetkisine sahip olmamalı.';
  end if;
end
$$;

commit;
