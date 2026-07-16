# Tarihsel Supabase migration arşivi

Bu klasördeki dosyalar aktif Supabase migration zincirinin parçası değildir.

- `20260706_add_sort_order.sql`, production veya staging remote migration history içinde bulunmamaktadır.
- Dosyanın kalıcı şema etkileri (`public.meals.sort_order` ve `public.meals.time`) production public baseline tarafından kapsanmaktadır.
- Dosya, tarihsel izlenebilirlik için içeriği değiştirilmeden arşivlenmiştir.
- Bu klasördeki SQL dosyaları Supabase CLI tarafından uygulanmamalı ve production rollout sırasında doğrudan kullanılmamalıdır.
- Arşivleme işlemi remote migration history üzerinde değişiklik yapmaz.
