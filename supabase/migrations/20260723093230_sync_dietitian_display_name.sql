begin;

with registered_names as (
    select
        users.id,
        nullif(
            btrim(
                coalesce(
                    nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
                    nullif(
                        btrim(
                            concat_ws(
                                ' ',
                                nullif(btrim(users.raw_user_meta_data ->> 'first_name'), ''),
                                nullif(btrim(users.raw_user_meta_data ->> 'last_name'), '')
                            )
                        ),
                        ''
                    )
                )
            ),
            ''
        ) as full_name
    from auth.users
)
update public.profiles as profiles
set full_name = registered_names.full_name,
    updated_at = now()
from registered_names
where profiles.id = registered_names.id
  and profiles.role = 'dietitian'
  and nullif(btrim(profiles.full_name), '') is null
  and registered_names.full_name is not null;

create or replace function public.get_dietitian_display_name(p_dietitian_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile_name text;
    v_meta_name text;
begin
    if not exists (
        select 1
        from public.dietitian_clients
        where client_id = auth.uid()
          and dietitian_id = p_dietitian_id
          and status in ('active', 'pending')
    ) then
        return null;
    end if;

    select nullif(btrim(profiles.full_name), '')
    into v_profile_name
    from public.profiles
    where profiles.id = p_dietitian_id
      and profiles.role = 'dietitian';

    if v_profile_name is not null then
        return v_profile_name;
    end if;

    select nullif(
        btrim(
            coalesce(
                nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
                nullif(
                    btrim(
                        concat_ws(
                            ' ',
                            nullif(btrim(raw_user_meta_data ->> 'first_name'), ''),
                            nullif(btrim(raw_user_meta_data ->> 'last_name'), '')
                        )
                    ),
                    ''
                )
            )
        ),
        ''
    )
    into v_meta_name
    from auth.users
    where auth.users.id = p_dietitian_id;

    if v_meta_name is not null then
        return v_meta_name;
    end if;

    return null;
end;
$$;

comment on function public.get_dietitian_display_name(uuid) is
    'Returns the dietitian display name from profiles.full_name, falling back to auth metadata. SECURITY DEFINER so clients can read auth-side name data.';

grant execute on function public.get_dietitian_display_name(uuid) to authenticated;
revoke execute on function public.get_dietitian_display_name(uuid) from public;

commit;
