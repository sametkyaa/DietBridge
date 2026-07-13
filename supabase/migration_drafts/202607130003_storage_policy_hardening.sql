-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: meal-photos private bucket'ındaki public-role SELECT/INSERT
-- policy'lerini authenticated ve aktif ilişki doğrulamasına geçirmek.
--
-- Ön koşullar:
-- 1. Web istemcisi private bucket için getPublicUrl yerine signed URL veya
--    yetkili download kullanmalıdır.
-- 2. Doğrulanmış path sözleşmesi: meal-plans/client-id/dosya-adı.
-- 3. avatars ve dietitian-diplomas policy'leri mevcut UI sözleşmesi
--    doğrulanmadan değiştirilmez.
-- 4. Bucket public flag, MIME ve boyut ayarları bu SQL ile değişmez.

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'meal-photos' and public is false
  ) then
    raise exception 'meal-photos private bucket beklenen durumda değil; taslak yeniden incelenmelidir.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Give users access to own folder 1o5iea3_0'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Give users access to own folder 1o5iea3_1'
  ) then
    raise exception 'meal-photos için doğrulanan public-role policy isimleri bulunamadı; güncel metadata ile taslak yenilenmelidir.';
  end if;
end
$$;

-- Mevcut path'in ikinci bölümü client_id'dir. Tek başına path içindeki
-- client_id güvenilir kabul edilmez; aktif dietitian_clients ilişkisi ile
-- doğrulanır.
drop policy "Give users access to own folder 1o5iea3_0" on storage.objects;
drop policy "Give users access to own folder 1o5iea3_1" on storage.objects;

create policy "Dietitians can upload meal photos for active clients"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meal-photos'
  and owner = auth.uid()
  and cardinality(storage.foldername(name)) >= 3
  and (storage.foldername(name))[1] = 'meal-plans'
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = auth.uid()
      and dc.client_id::text = (storage.foldername(name))[2]
      and dc.status = 'active'
  )
);

create policy "Active relation users can view meal photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meal-photos'
  and cardinality(storage.foldername(name)) >= 3
  and (storage.foldername(name))[1] = 'meal-plans'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or exists (
      select 1 from public.dietitian_clients dc
      where dc.dietitian_id = auth.uid()
        and dc.client_id::text = (storage.foldername(name))[2]
        and dc.status = 'active'
    )
  )
);

-- Bilinçli olarak UPDATE/DELETE policy'si eklenmez. Mevcut web akışında
-- meal photo overwrite veya silme kullanılmıyor. Böyle bir ihtiyaç çıkarsa
-- nesne sahipliği ve aktif ilişki ile ayrı tasarım yapılmalıdır.

-- avatars: private bucket, authenticated own-folder policy'leri korunur.
-- Mevcut isimler: Users can view own avatars, Users can upload own avatars,
-- Users can update own avatars, Users can delete own avatars.
--
-- dietitian-diplomas: private bucket, authenticated owner/path policy'leri
-- korunur. Mevcut isimler: Dietitians can view own diplomas,
-- Dietitians can upload own diplomas, Dietitians can update own diplomas,
-- Dietitians can delete own diplomas.
--
-- meal-photos için MIME ve file size limit metadata'sı boş. Bu bucket
-- ayarlarının değişikliği ayrı, açık onaylı Storage ayarı görevidir; burada
-- bucket update SQL'i yoktur.

-- Uygulama sonrası metadata kontrolü:
-- select policyname, roles, cmd from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- order by policyname;

-- Rollback: Yalnızca yukarıda kaldırılan iki policy'nin uygulama öncesi
-- saklanan tam tanımını geri oluşturun. Bucket'ı public yapmayın.
