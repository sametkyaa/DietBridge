do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Dietitians can view active client avatars'
  ) then
    execute $policy$
      create policy "Dietitians can view active client avatars"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'avatars'
        and exists (
          select 1
          from public.dietitian_clients dc
          where dc.dietitian_id = auth.uid()
            and dc.client_id::text = (storage.foldername(name))[1]
            and dc.status = 'active'::public.client_status
        )
      )
    $policy$;
  end if;
end
$$;
