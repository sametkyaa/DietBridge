-- Gerekli policy'ler aynı migration içinde kurulduktan sonra kritik tablolarda RLS açılır.

do $$
begin
  if to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.chat_messages') is null then
    raise exception 'Kritik RLS için beklenen tablo bulunamadı; migration durduruldu.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('dietitian_profiles', 'appointments', 'chat_messages')) then
    raise exception 'Kritik tabloda mevcut policy var; üzerine yazılmaz.';
  end if;
  if exists (select 1 from public.appointments where dietitian_id is null or client_id is null) then
    raise exception 'Appointments sahiplik verisi eksik; otomatik düzeltme yapılmayacak.';
  end if;
end
$$;

create function public.protect_dietitian_profile_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is not null and auth.uid() = new.user_id then
    if tg_op = 'INSERT' then
      if new.is_verified is distinct from false or new.verification_status is distinct from 'pending' or new.verified_at is not null or new.rejection_reason is not null then
        raise exception 'Diyetisyen sistem alanları kullanıcı tarafından atanamaz.' using errcode = '42501';
      end if;
    elsif new.user_id is distinct from old.user_id
       or new.is_verified is distinct from old.is_verified
       or new.verification_status is distinct from old.verification_status
       or new.verified_at is distinct from old.verified_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Diyetisyen sistem alanları kullanıcı tarafından değiştirilemez.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;
create trigger trg_protect_dietitian_profile_system_fields
before insert or update on public.dietitian_profiles
for each row execute function public.protect_dietitian_profile_system_fields();
revoke execute on function public.protect_dietitian_profile_system_fields() from public, anon, authenticated;

create policy "Dietitians can select own profile" on public.dietitian_profiles for select to authenticated
using (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'dietitian'));
create policy "Clients can select active dietitian profile" on public.dietitian_profiles for select to authenticated
using (exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = dietitian_profiles.user_id and dc.client_id = auth.uid() and dc.status = 'active'));
create policy "Dietitians can create own pending profile" on public.dietitian_profiles for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'dietitian'));
create policy "Dietitians can update own non-system profile fields" on public.dietitian_profiles for update to authenticated
using (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'dietitian'))
with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'dietitian'));

create policy "Dietitians can select active client appointments" on public.appointments for select to authenticated
using (dietitian_id = auth.uid() and public.is_current_user_dietitian() and exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = appointments.dietitian_id and dc.client_id = appointments.client_id and dc.status = 'active'));
create policy "Clients can select own active appointments" on public.appointments for select to authenticated
using (client_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client') and exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = appointments.dietitian_id and dc.client_id = appointments.client_id and dc.status = 'active'));
create policy "Dietitians can create active client appointments" on public.appointments for insert to authenticated
with check (dietitian_id = auth.uid() and public.is_current_user_dietitian() and exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = appointments.dietitian_id and dc.client_id = appointments.client_id and dc.status = 'active'));
create policy "Dietitians can update active client appointments" on public.appointments for update to authenticated
using (dietitian_id = auth.uid() and public.is_current_user_dietitian() and exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = appointments.dietitian_id and dc.client_id = appointments.client_id and dc.status = 'active'))
with check (dietitian_id = auth.uid() and public.is_current_user_dietitian() and exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = appointments.dietitian_id and dc.client_id = appointments.client_id and dc.status = 'active'));
create policy "Dietitians can delete active client appointments" on public.appointments for delete to authenticated
using (dietitian_id = auth.uid() and public.is_current_user_dietitian() and exists (select 1 from public.dietitian_clients dc where dc.dietitian_id = appointments.dietitian_id and dc.client_id = appointments.client_id and dc.status = 'active'));

create policy "Participants can select active relationship messages" on public.chat_messages for select to authenticated
using ((sender_id = auth.uid() or receiver_id = auth.uid()) and exists (select 1 from public.dietitian_clients dc where dc.status = 'active' and ((dc.dietitian_id = chat_messages.sender_id and dc.client_id = chat_messages.receiver_id) or (dc.dietitian_id = chat_messages.receiver_id and dc.client_id = chat_messages.sender_id))));
create policy "Participants can send active relationship messages" on public.chat_messages for insert to authenticated
with check (sender_id = auth.uid() and exists (select 1 from public.dietitian_clients dc where dc.status = 'active' and ((dc.dietitian_id = chat_messages.sender_id and dc.client_id = chat_messages.receiver_id) or (dc.dietitian_id = chat_messages.receiver_id and dc.client_id = chat_messages.sender_id))));

alter table public.dietitian_profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.chat_messages enable row level security;
