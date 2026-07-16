-- Auth onboarding trigger'ını yalnız eksikse oluşturur; beklenmeyen mevcut tanımı değiştirmez.

do $$
declare
  v_expected_function oid := 'public.handle_new_user()'::regprocedure;
  v_trigger record;
  v_is_row boolean;
  v_is_after boolean;
  v_is_insert_only boolean;
begin
  if to_regprocedure('public.handle_new_user()') is null then
    raise exception 'public.handle_new_user() bulunamadı; auth onboarding trigger oluşturulamaz.';
  end if;

  select t.oid, t.tgfoid, t.tgtype, t.tgenabled
    into v_trigger
  from pg_catalog.pg_trigger as t
  where t.tgrelid = 'auth.users'::regclass
    and t.tgname = 'on_auth_user_created'
    and not t.tgisinternal;

  if not found then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row
      execute function public.handle_new_user();
  else
    -- PostgreSQL tgtype bitleri: ROW=1, BEFORE=2, INSERT=4. Beklenen değer 5'tir.
    v_is_row := (v_trigger.tgtype::integer & 1) = 1;
    v_is_after := (v_trigger.tgtype::integer & 2) = 0;
    v_is_insert_only := (v_trigger.tgtype::integer & 4) = 4
      and (v_trigger.tgtype::integer & (8 | 16 | 32 | 64)) = 0;

    if v_trigger.tgfoid <> v_expected_function then
      raise exception 'auth.users.on_auth_user_created beklenen public.handle_new_user() fonksiyonunu çağırmıyor; mevcut trigger değiştirilmedi.';
    elsif not v_is_row or not v_is_after or not v_is_insert_only then
      raise exception 'auth.users.on_auth_user_created AFTER INSERT FOR EACH ROW değildir; mevcut trigger değiştirilmedi.';
    elsif v_trigger.tgenabled = 'D' then
      raise exception 'auth.users.on_auth_user_created devre dışı; mevcut trigger değiştirilmedi.';
    end if;
  end if;
end
$$;
