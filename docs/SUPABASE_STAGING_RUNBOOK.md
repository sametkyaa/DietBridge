# DietBridge — Supabase Staging Uygulama ve RLS Test Runbook

> [!WARNING]
> Bu runbook staging/test ortamı içindir. Production’da SQL çalıştırmayın, gerçek kullanıcı veya sağlık verisi kullanmayın ve staging projesini bu görev kapsamında otomatik oluşturmayın.

## 1. Amaç ve sınır

Bu runbook, Aşama 3B/3C taslaklarının izole staging ortamında uygulanması, sentetik hesaplarla doğrulanması ve production karar paketi hazırlanması içindir. Bu görevde runbook uygulanmamıştır.

## 2. Staging durumu

Bağlı Supabase projeleri salt-okunur listelendi. Adı veya metadatası açıkça staging/test olan bir proje bulunmadı. Bu nedenle aşağıdaki çalışmalar blokludur: **Staging projesi mevcut değil.**

### Staging projesi oluşturmak için kullanıcı adımları

1. Supabase Dashboard’da production’dan ayrı yeni bir proje oluşturun.
2. Proje adında açıkça `staging` veya `test` ifadesini kullanın.
3. Production secret, database password, access anahtarı veya connection string’ini tekrar kullanmayın; ayrı staging değerleri üretin.
4. Production verisini, kullanıcılarını, Storage nesnelerini veya secret’larını kopyalamayın.
5. Yalnız gerekli şema/migration temelini ve sentetik test kayıtlarını hazırlayın.
6. Dashboard erişimini üretim erişiminden ayrı yetki grubu ile sınırlandırın.
7. Yedekleme/geri dönüş yeteneğini ve proje sahibini belgeleyin.
8. Auth redirect URL’lerini yalnız staging web/mobil adreslerine ayırın; production callback URL’lerini kullanmayın.
9. Storage bucket’larını production bucket’larından ayrı oluşturun ve yalnız sentetik nesneler kullanın.
10. Web ve mobil için staging environment değerlerini ayrı ve secret paylaşmadan yapılandırın.
11. Test tamamlandığında sentetik kullanıcı, kayıt ve Storage nesnelerini onaylı staging temizleme prosedürüyle kaldırın.
12. Hazır olduğunda proje adını ve staging olduğu bilgisini paylaşın; Codex yalnız açık izinle salt-okunur metadata doğrulaması yapar.

## 3. Ön koşullar

- Açıkça staging/test olarak sınıflandırılmış proje
- Production’dan ayrı URL/key/env değerleri
- Bu runbook, migration planı ve architecture decisions için code review
- Uygulama öncesi schema, policy, function, trigger, grant ve Storage metadata dışa aktarımı
- Geri dönüş sorumlusu ve test penceresi
- Gerçek kişi/veri kullanılmayan sentetik hesap seti

## 4. Sentetik hesap seti

Yalnız test amaçlı, kimlik bilgisi/sağlık verisi içermeyen hesaplar oluşturun:

| Hesap | Rol/durum | İlişki |
|---|---|---|
| Dietitian A | approved | Client A ile active |
| Dietitian B | approved | Client B ile active |
| Dietitian Pending | pending | yok |
| Dietitian Rejected | rejected | yok |
| Client A | client | Dietitian A ile active |
| Client B | client | Dietitian B ile active |
| Unrelated Client | client | hedef kaynakla ilişkisi yok |

Anon testleri oturum olmadan yürütülür. Test hesaplarının parolası, e-postası, UUID’si veya token’ı rapora yazılmaz.

## 5. Schema baseline doğrulaması

Uygulamadan önce metadata ile aşağıdakileri kaydedin:

- hedef tablo/kolon, constraint ve index tanımları;
- RLS flag’leri ve `pg_policies` tanımları;
- `handle_new_user()` ve diğer hedef function signature/config/grant’leri;
- `on_auth_user_created` trigger tanımı;
- Storage bucket/policy metadata’sı;
- aggregate verification ve diğer taslak ön koşulları.

Kullanıcı satırları, `SELECT *`, iletişim bilgileri, mesaj içerikleri veya Storage object yolları okunmaz.

## 6. Taslağı gerçek migration’a dönüştürme

Taslaklar `supabase/migration_drafts/` altındadır; çalıştırılabilir migration geçmişi değildir. Staging uygulaması için:

1. Her taslağı bağımsız code review’dan geçirin.
2. Onaylanan içeriği yeni, sürümlenmiş `supabase/migrations/` dosyasına taşıyın.
3. Her dosyayı yalnız staging proje bağlantısında uygulayın.
4. Her migration sonrası metadata ve negatif test kanıtını kaydedin.
5. Production için aynı dosyayı kullanmadan önce yeniden review ve açık onay alın.

## 7. Uygulama sırası

1. Function hardening uyumlu kısmı (`004`)
2. Auth onboarding hardening (`007`)
3. Verification consistency (`006`), gerekirse ayrı onaylı staging onarımı
4. Meal completion RPC (`008`)
5. Web/mobile uyumluluk release’i
6. Kritik RLS (`001`)
7. Relationship/policy hardening (`002`)
8. Storage (`003`), constraint/index (`005`) ve Realtime ayrı kapılarla

Eski geniş completion policy’si, RPC istemci geçişinden önce kaldırılmaz.

## 8. Migration bazında kontroller

| Taslak | Ön kontrol | Son kontrol |
|---|---|---|
| 004 | Signature, trigger bağımlılığı, mevcut grants | Search path/grant metadata ve trigger regresyonu |
| 007 | Gerçek auth trigger adı/signature | Client/pending dietitian signup, bilinmeyen metadata ret, tekrar deneme |
| 006 | Allowed status aggregate, inconsistency aggregate | Mirror/constraint, approval alanı browser ret |
| 008 | Table/FK/policy/function yokluk kontrolü | RPC execute grant, own/unrelated/anon negatif test |
| 001 | RLS/policy baseline, appointment ownership aggregate | Hedef üç tabloda RLS ve policy matrisi |
| 002 | Onboarding ve client lookup uyumluluğu | Relationship, plan ve meal policy negatif matrisi |

## 9. RLS test matrisi

Her satır için izin/ret sonucu, rol ve migration sürümü kaydedilir; gerçek değerler rapora konmaz.

| Kaynak | Denek | İşlem | Beklenen |
|---|---|---|---|
| `dietitian_profiles` | own approved dietitian | SELECT/update izinli başvuru alanı | İzin |
| `dietitian_profiles` | dietitian B/client/anon | başka profil veya verification UPDATE | Ret |
| `profiles` | client | own role UPDATE | Ret |
| `profiles` | client | browser profile role INSERT | Ret |
| `meal_plans`/`meals` | Dietitian A | Client A kaynakları | İzin |
| `meal_plans`/`meals` | Dietitian A | Client B kaynakları | Ret |
| `meals` | Client A | Client A plan read | İzin |
| `meals` | Client A | Client B öğünü | Ret |
| `appointments`/`chat_messages` | ilişkisiz kullanıcı | SELECT/UPDATE/DELETE | Ret |
| Storage | anon/ilişkisiz | private object read/write | Ret |

## 10. Web auth testleri

- Approved dietitian: session restore sonrası korumalı panel erişimi.
- Pending dietitian: dashboard yok, pending ekranı.
- Rejected dietitian: dashboard yok, rejected ekranı.
- Client: sign-out ve yalnız mobil uygulamayı belirten güvenli mesaj; geri tuşu/refresh/doğrudan route ile dashboard yok.
- Bilinmeyen veya eksik role/profile: fail-closed hata/engelleme.
- E-posta onayı etkin ve devre dışı senaryoları: auth profilinin atomik oluşumu ve tekrar deneme.

## 11. Mobil auth testleri

Mobil kaynak ayrı repository’dedir. Staging’de yalnız aşağıdaki işlevsel sonuçlar kanıtlanır:

- Client signup sonucu client profilinin oluşması.
- Restore edilen client session’ın geçerli kalması.
- Client metadata değişikliğinin role yükseltme yaratmaması.
- Pending dietitian’ın mobile client akışına yanlışlıkla erişmemesi.

## 12. Meal completion RPC testleri

- Client A, kendi planındaki öğünün `is_eaten` değerini RPC ile değiştirir.
- Client A, Client B öğününde aynı RPC çağrısını yapamaz.
- Dietitian A ve anon, client completion RPC’sini kullanamaz.
- Null/bozuk boolean veya bulunmayan meal id, güvenli hata verir; kaynak varlığı sızmaz.
- Client doğrudan `meals` UPDATE ile yalnız RPC’ye geçişten sonra ret alır.
- Diyetisyen meal CRUD ve mevcut plan ekranı regresyonsuz kalır.

## 13. Verification testleri

- `approved → true`, `pending → false`, `rejected → false` mirror eşleşmesi.
- Bilinmeyen/null status fail-closed.
- Browser’dan `verification_status`, `is_verified`, `verified_at`, `rejection_reason` değişikliği ret.
- Onaylı yönetim/güvenilir backend yolu staging’de audit edilebilir biçimde test edilir.
- Mevcut tutarsızlık varsa yalnız onaylı staging onarımı sonrası constraint doğrulanır.

## 14. Signup/onboarding testleri

- `client` signup: profile + client profile atomik oluşur.
- `dietitian` signup: profile role dietitian, pending dietitian profile ve false mirror atomik oluşur.
- Bilinmeyen metadata: güvenli hata; yarım profile/role oluşmaz.
- Mevcut client session/metadata değişikliği dietitian yükseltmesi yapmaz.
- Trigger aynı kullanıcı için ikinci profile üretmez; tekrar deneme kontrol edilir.
- Browser doğrudan `profiles.role` veya verification alanı yazamaz.

## 15. Storage testleri

Storage taslağı ancak signed URL/yetkili download istemci sözleşmesi hazırsa çalıştırılır. Sentetik dosya ile MIME, boyut, own/related/unrelated/anon erişimi ve update/delete davranışı test edilir. Production bucket’a test dosyası yüklenmez.

## 16. Function ve trigger testleri

- Her function’ın exact signature, `proconfig` ve execute grant metadata’sı doğrulanır.
- SECURITY DEFINER function’larda sabit search path, `auth.uid()` kontrolü ve PUBLIC/anon execute revoke kontrol edilir.
- Trigger function’ları doğrudan RPC olarak çağrılamaz.
- `handle_new_user()` auth insert akışında çalışır; ikinci trigger oluşturulmaz.
- Anon, `current_user_role`, `is_current_user_dietitian`, `handle_new_user` ve `set_my_meal_completion` için doğrudan execute/RPC izni alamaz.
- Authenticated fakat sahip olmayan kullanıcı, `set_my_meal_completion` ile başka kullanıcının öğününü değiştiremez.

## 17. Constraint ve index testleri

- Ön koşul aggregate’leri sadece sayısal sonuç üretir.
- Constraint önce `NOT VALID`, sonra ayrı aşamada validation ile doğrulanır.
- Index/unique adımlarında lock etkisi staging’de ölçülür.
- Constraint veya index hatasında veri silme yapılmaz.

## 18. Realtime kararı

Realtime bu runbook’un varsayılan uygulama kapsamı dışındadır. RLS/policy kanıtı ve aktif istemci subscription ihtiyacı olmadan publication değiştirilmez. Chat web tarafında mock olduğu için ayrıca ürün kararı gerekir.

## 19. Performans kontrolü

Policy join’leri, meal plan/meal sorguları ve auth resolution için staging’de query plan/latency gözlemi alınır. Gereksiz index oluşturulmaz; production lock penceresi ayrı onay ister.

## 20. Rollback provası

1. Uygulama öncesi policy/function/trigger/grant metadata kaydı alınır.
2. Her migration için hedefli rollback script’i hazırlanır.
3. Sentetik hesaplarla rollback sonrası en az auth ve meal read akışı doğrulanır.
4. RLS kapatılmaz, kullanıcı/veri silinmez ve production rollback uygulanmaz.

## 21. Kabul kriterleri

- Tüm pozitif/negatif testler beklenen sonuç verir.
- Client role escalation, verification write, ilişkisiz veri erişimi ve direct meal UPDATE ret alır.
- Approved dietitian akışı, client mobile-only engeli ve pending/rejected fail-closed davranış korunur.
- RPC yalnız own meal completion alanını değiştirir.
- Rollback provası, metadata kanıtı ve uygulama uyumluluk kaydı tamamdır.

## 22. Production onay kanıt paketi

- Staging proje sınıflandırması ve sentetik veri bildirimi
- Her migration için review, checksum/commit ve metadata öncesi-sonrası çıktısı
- Negatif RLS/auth/RPC/Storage test özeti
- Rollback prova sonucu
- Lock/maintenance değerlendirmesi
- Web ve mobil release uyumluluk kanıtı
- Açık kullanıcı production onayı

## 23. Kayıt şablonu

| Alan | Kaydedilecek bilgi |
|---|---|
| Ortam | staging/test proje sınıflandırması, tarih, sorumlu |
| Taslak/migration | sürüm, review kararı, uygulama sonucu |
| Test | senaryo, rol, beklenen/gerçek sonuç |
| Metadata | RLS/policy/function/trigger/grant doğrulama özeti |
| Rollback | prova sonucu ve kalan risk |
| Secret/veri | kaydedilmez |

## 24. Bu görevin sonucu

Staging testleri çalıştırılmadı, sentetik hesap oluşturulmadı ve hiçbir migration uygulanmadı. Staging projesi kullanıcı tarafından oluşturulduktan ve açık test izni verildikten sonra bu runbook uygulanabilir.
