begin;

do $$
begin
  if to_regclass('storage.objects') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null then
    raise exception 'Planned recipe-image access prerequisites are missing.';
  end if;
end
$$;

-- A client can read only a canonical recipe image retained by a recipe-sourced
-- meal snapshot in that client's own plan. The meal and plan SELECT policies
-- are already fail-closed for authenticated clients, so no SECURITY DEFINER
-- helper is required here.
drop policy if exists recipe_images_select_planned_client on storage.objects;
create policy recipe_images_select_planned_client
on storage.objects
for select
to authenticated
using (
  storage.objects.bucket_id = 'recipe-images'
  and storage.objects.name ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and exists (
    select 1
    from public.meals as meal
    join public.meal_plans as plan
      on plan.id = meal.plan_id
    where meal.photo_url = storage.objects.name
      and meal.source = 'recipe'
      and plan.client_id = (select auth.uid())
      and split_part(storage.objects.name, '/', 2) = plan.dietitian_id::text
  )
);

notify pgrst, 'reload schema';

commit;
