# DietBridge — Staging Güvenlik Migration Hazırlık Raporu

> [!IMPORTANT]
> Bu rapordaki güvenlik migration’ları yalnızca repository dışındaki disposable yerel Supabase ortamında uygulanmıştır. Staging, production ve GROUNDLESS projeleri değiştirilmemiştir.

## Amaç, zincir ve envanter

Başlangıç commit'i `ed8a564`tır. Başlangıç zincirinin ardından beş migration aktifleştirildi: function hardening, verification consistency, onboarding, kritik RLS ve meal completion RPC. Storage, Realtime, relationship hardening ve constraint/index taslakları ertelendi.

## Bağımlılık, replay ve lint

Sıra: function hardening → verification → onboarding → kritik RLS → meal RPC. `supabase start` ve `db reset --local --no-seed` tüm yedi migration için başarılıdır. `db lint --local --schema public --level warning --fail-on error` exit code 0 ile schema error/warning olmadan tamamlandı.

## Metadata önce/sonra

| Ölçüm | Baseline | Sonuç | Delta |
|---|---:|---:|---:|
| Public tablo | 21 | 21 | 0 |
| RLS tablo | 18 | 21 | +3 |
| Policy | 51 | 62 | +11 |
| Public function | 10 | 13 | +3 |
| Trigger | 7 | 9 | +2 |
| Public satır | 0 | 0 | 0 |

Kritik `dietitian_profiles`, `appointments` ve `chat_messages` RLS açıktır. Policy'ler yalnız `authenticated` rolünü hedefler; anonymous policy yoktur. Appointment yazmaları onaylı dietitian helper ve aktif ilişki ister; chat insert sender eşitliğini ve aktif ilişkiyi doğrular.

## Function, verification, onboarding ve meal RPC

Altı SECURITY DEFINER function sabit `pg_catalog, public` search path taşır. Trigger helper'lar direct istemci execute yüzeyine sahip değildir. `set_my_meal_completion(uuid, boolean)` SECURITY DEFINER, authenticated execute, `auth.uid()` ve plan sahipliği kontrolüyle yalnız `is_eaten` günceller. Legacy meals UPDATE policy korunmuştur.

Verification modelinde `verification_status` kanonik, `is_verified` aynadır; yapısal trigger/constraint veri backfill'i olmadan uygulanır. `handle_new_user()` allowlist kullanır ve dietitian'ı pending/false başlatır. Public-schema baseline `auth.users` trigger'ını içermediğinden yerel ortamda gerçek trigger eşleşmesi doğrulanamadı; staging dry-run ön koşuludur.

## Ertelenenler ve riskler

Storage/bucket/policy, Realtime, relationship policy hardening ve production veri kanıtı gerektiren constraint/index değişiklikleri aktif değildir. Client'ın aktif diyetisyen profilini okuma policy'si satır bazlıdır; gerekli alanların client tarafında daraltılması ileriki sözleşme değerlendirmesidir. Negatif RLS/Auth/RPC testleri sentetik staging hesaplarıyla 3D-4B sonrası yapılacaktır.

## DML, secret, uyumluluk ve rollout

Top-level kullanıcı verisi DML'i yoktur; yalnız meal RPC function gövdesinde kontrollü `UPDATE` bulunur. Yeni migration/dokümanlarda secret, gerçek kullanıcı veya bağlantı değeri bulunmadı. Web/mobile uygulama kodu değişmedi. Staging uygulaması öncesi dry-run, Auth trigger signature, policy/RPC negatif senaryoları ve rollback tanımları gerekir; production için ayrıca veri uyumluluğu ve ayrı onay gerekir.

## Sonuç

Paket yalnız local ortamda doğrulandı. Production, staging ve GROUNDLESS'a bağlanılmadı; remote migration history, Storage, Realtime ve Auth kullanıcıları değiştirilmedi.
