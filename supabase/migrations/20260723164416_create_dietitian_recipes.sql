begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null
     or to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise exception 'Recipe prerequisites are missing.';
  end if;
end
$$;

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  meal_type text not null,
  calories integer not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_name_not_blank_check check (btrim(name) <> ''),
  constraint recipes_name_length_check check (char_length(name) <= 160),
  constraint recipes_description_length_check check (description is null or char_length(description) <= 2000),
  constraint recipes_meal_type_check check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  constraint recipes_calories_range_check check (calories >= 0 and calories <= 10000),
  constraint recipes_protein_range_check check (protein >= 0 and protein <= 1000),
  constraint recipes_carbs_range_check check (carbs >= 0 and carbs <= 1000),
  constraint recipes_fat_range_check check (fat >= 0 and fat <= 1000),
  constraint recipes_image_path_canonical_check check (
    image_path is null
    or image_path ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  ),
  constraint recipes_image_path_matches_owner_check check (
    image_path is null or split_part(image_path, '/', 2) = dietitian_id::text
  ),
  constraint recipes_image_path_matches_recipe_check check (
    image_path is null or split_part(image_path, '/', 3) = id::text
  )
);

-- Product behavior permits a dietitian to keep similarly named variations;
-- no dietitian_id/name UNIQUE constraint is added deliberately.
create index if not exists recipes_dietitian_id_idx
  on public.recipes (dietitian_id);
create index if not exists recipes_dietitian_created_at_idx
  on public.recipes (dietitian_id, created_at desc);

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

alter table public.recipes enable row level security;
revoke all on table public.recipes from public, anon;
grant select, insert, update, delete on table public.recipes to authenticated;

drop policy if exists recipes_select_own on public.recipes;
create policy recipes_select_own
on public.recipes
for select
to authenticated
using (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

drop policy if exists recipes_insert_own on public.recipes;
create policy recipes_insert_own
on public.recipes
for insert
to authenticated
with check (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

drop policy if exists recipes_update_own on public.recipes;
create policy recipes_update_own
on public.recipes
for update
to authenticated
using (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
)
with check (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

drop policy if exists recipes_delete_own on public.recipes;
create policy recipes_delete_own
on public.recipes
for delete
to authenticated
using (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recipe_images_select_own on storage.objects;
create policy recipe_images_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'recipe-images'
  and name ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

drop policy if exists recipe_images_insert_own on storage.objects;
create policy recipe_images_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recipe-images'
  and name ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

drop policy if exists recipe_images_delete_own on storage.objects;
create policy recipe_images_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'recipe-images'
  and name ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.is_verified is true
      and dp.verification_status = 'approved'
  )
);

commit;
