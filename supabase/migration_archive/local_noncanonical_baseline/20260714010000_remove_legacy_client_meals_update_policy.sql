-- Mobile clients now use set_my_meal_completion RPC.
-- No released legacy mobile build requires direct client meals UPDATE access.

do $$
begin
  if to_regclass('public.meals') is null then
    raise exception 'Expected public.meals before removing the legacy client UPDATE policy.';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'meals'
      and policyname = 'Clients can update own meal completion'
      and cmd = 'UPDATE'
      and roles = array['authenticated']::name[]
      and qual is not null
      and with_check is not null
  ) then
    raise exception 'Expected legacy client meals UPDATE policy is missing or does not match its reviewed contract.';
  end if;
end
$$;

drop policy "Clients can update own meal completion" on public.meals;
