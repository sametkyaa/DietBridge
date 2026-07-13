# DietBridge — Güvenlik Migration Manifesti

## Amaç ve başlangıç

Başlangıç commit'i `ed8a564` ve bootstrap zinciri `20260713000000` ile `20260713000001`dir. Bu paket yalnız disposable yerel Supabase ortamında uygulanmıştır.

## Taslak envanteri ve karar

| Taslak | Karar | Gerekçe |
|---|---|---|
| Kritik tablo RLS | Aktif | Üç tablo için policy ile aynı zincirde fail-closed RLS |
| Relationship policy hardening | Ertelendi | Web linking ve mobil ilişki akışında davranış kırma riski |
| Storage policy hardening | Ertelendi | Public baseline bucket/storage şemasını içermez |
| Function security hardening | Aktif | Sabit search_path ve dar execute yüzeyi |
| Constraint/index | Ertelendi | Production veri ve lock kanıtı gerekli |
| Verification consistency | Aktif | Veri düzeltmeden yapısal mirror güvencesi |
| Auth onboarding | Aktif | Allowlist, pending/false başlangıç ve dar execute |
| Meal completion RPC | Aktif | Dar authenticated RPC; legacy policy korunur |

## Aktif migration eşlemesi

| Timestamp | Dosya | Kaynak taslak | Amaç | Bağımlılık | RLS etkisi | Function/grant etkisi | Uygulama riski |
|---|---|---|---|---|---|---|---|
| 20260713010000 | `function_security_hardening.sql` | 004 | Search path ve mevcut execute daraltması | Baseline | Dolaylı | Onaylı diyetisyen helper'ı; trigger execute revoke | Pending diyetisyen linking yapamaz |
| 20260713010100 | `verification_consistency.sql` | 006 | Canonical status/mirror trigger | Baseline | Yok | Verification trigger execute revoke | Tutarsız production veri fail-closed durur |
| 20260713010200 | `auth_onboarding_hardening.sql` | 007 | Allowlist onboarding | Verification | Yok | `handle_new_user()` güvenli tanım, direct execute yok | Auth trigger staging'de doğrulanmalı |
| 20260713010300 | `critical_table_rls.sql` | 001 | Kritik üç tablo policy + RLS | Function, verification, onboarding | +3 tablo | Sistem alanı trigger revoke | Client profile satırı tüm profile alanlarını döndürür |
| 20260713010400 | `meal_completion_rpc.sql` | 008 | Own-meal `is_eaten` RPC | Baseline | Yok | Authenticated execute yalnız RPC'de | Mobil RPC geçişi henüz zorunlu değil |

## Bağımlılık grafiği

`function hardening → verification → onboarding → critical RLS → meal completion RPC`.

## Policy, verification ve onboarding

Kritik tablolarda anonymous policy yoktur. Appointment yazmaları onaylı diyetisyen helper'ı ve aktif `dietitian_clients` ilişkisi ister. Chat sender kimliği `auth.uid()` ile bağlıdır. Verification status kanoniktir; kullanıcı kendi satırında approval alanlarını değiştiremez. Onboarding metadata yalnız `client` veya `dietitian` account type'ını kabul eder; dietitian `pending/false` başlar.

## Execute, Storage ve Realtime sınırı

Tüm SECURITY DEFINER function'larda `search_path=pg_catalog, public` vardır. Trigger/helper function'larda PUBLIC, anon ve authenticated execute kaldırılmıştır; doğrudan RPC/helper ihtiyaçları authenticated ile sınırlıdır. Storage, bucket, Storage policy, Realtime publication ve Auth provider ayarı bu pakette yoktur.

## Legacy ve constraint kararları

Legacy meals UPDATE policy, mobil uygulama `set_my_meal_completion` RPC kullanımına geçirilmeden kaldırılmayacaktır. Yeni NOT NULL, validated CHECK, unique constraint veya index aktif edilmemiştir; production veri/lock kanıtı ayrı aşamadadır.

## Uyumluluk, rollout ve rollback

Web linking davranışını kırma riski taşıyan relationship hardening ertelendi. Mobil için RPC hazırdır ancak zorunlu geçiş bu pakette yapılmadı. Production rollout öncesi staging dry-run, gerçek Auth trigger signature doğrulaması, sentetik negatif RLS/RPC testleri ve rollback envanteri gerekir. Rollback RLS'yi körlemesine kapatmak değildir; hedef policy/function tanımlarını ayrı onayla ileri düzeltme migration'ıyla düzeltmektir.
