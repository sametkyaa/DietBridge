# DietBridge Web — Codex Çalışma Kuralları

## 1. Amaç ve temel yaklaşım

Bu repository, diyetisyenlerin kullandığı DietBridge Web uygulamasıdır. Proje sıfırdan yeniden yazılmaz; mevcut çalışan mimari, sayfalar ve kullanıcı deneyimi korunur. Değişiklikler küçük, kontrollü, doğrulanabilir ve geri alınabilir tutulur.

Codex her görevde önce mevcut uygulama akışını ve aktif import zincirini anlamalıdır. Belirsizlik halinde destructive işlem yapılmaz; daha güvenli ve daha dar kapsamlı yaklaşım seçilir. Kullanıcı onayı gerektiren işlemler kendiliğinden uygulanmaz.

Temel kurallar:

- Büyük ve toplu refactor yapılmaz.
- Mimari temizlik, mock veri temizliği ve özellik geliştirme ayrı görevlerdir.
- Eski görünen dosyalar kullanılmadığı doğrulanmadan silinmez.
- Bir aşama kabul kriterlerini karşılamadan sonraki aşama başlatılmaz.
- Her geliştirme aşaması ayrı `codex/` branch’i ve ayrı görev olarak yürütülür.
- `main` her zaman build alınabilir ve yayınlanabilir durumda tutulur.
- Production verisine veya Storage’a açık kullanıcı onayı olmadan yazılmaz.

## 2. Proje kimliği ve kapsamı

- Proje adı: DietBridge Web
- Hedef kullanıcı: Diyetisyen
- Uygulama tipi: React/Vite tabanlı web paneli
- Temel teknoloji yığını: React, TypeScript, Vite, React Router, Supabase, Lucide React ve mevcut Tailwind CDN tabanlı stil sistemi
- Aktif başlangıç zinciri: `index.html` → `index.tsx` → `App.tsx`

Mevcut ve hedeflenen ana iş alanları:

- diyetisyen kayıt, giriş, şifre sıfırlama ve profil yönetimi;
- diyetisyen rolü ve onay durumu kontrolü;
- danışan listesi, ilişkilendirme, profil, ölçüm ve yaşam tarzı bilgileri;
- haftalık beslenme planı ve öğün yönetimi;
- randevu yönetimi;
- diyetisyen–danışan mesajlaşması ve görsel gönderimi;
- abonelik, paket ve danışan limitleri;
- temel dashboard.

Repository şu anda mobil uygulama değildir; `android/`, `ios/`, Expo ve React Native uygulama yapısı içermez. Mobil uygulama repository’si veya mobil koda bu repository’den değişiklik yapılmaz. Web ve mobil aynı Supabase veri modelini kullanabileceği için tablo, kolon, enum, constraint, Storage yolu veya RLS değişikliği öncesinde mobil uyumluluk değerlendirilir.

## 3. Mevcut mimarinin korunması

Yeni geliştirmelerde öncelikli aktif yapı:

- `features/`: özellik bazlı sayfa, context ve servisler;
- `pages/`: henüz feature dizinine taşınmamış aktif route ekranları;
- `shared/`: ortak bileşenler, tipler ve sabitler;
- `lib/`: ortak altyapı; aktif Supabase client burada bulunur.

`src/`, kök `components/`, kök `context/` ve kök `services/` eski, alternatif veya tekrar eden kod içerebilir. Bununla birlikte bir dosya yalnızca klasör adına bakılarak kullanılmıyor kabul edilmez.

- Dosya silmeden veya taşımadan önce `rg` ile import ve kullanım analizi yapılır.
- Aktif zincir `index.tsx`, `App.tsx`, route importları ve transitif importlarla doğrulanır.
- Mimari sadeleştirme ayrı görevde yapılır.
- Özellik geliştirme sırasında ilgisiz dosya taşıma, isim değiştirme veya formatlama yapılmaz.
- Çalışan bileşenler görev kapsamı dışında yeniden yazılmaz.
- Mevcut tasarım, Türkçe dil ve kullanıcı deneyimi görev kapsamı dışında değiştirilmez.
- Tüm sayfayı yeniden yazmak yerine hedefli düzeltme yapılır.
- Büyük refactor yalnızca açık kullanıcı onayıyla ve ayrı branch’te yapılır.

## 4. Görev kapsamı yönetimi

Her görevde şu sıra izlenir:

1. `AGENTS.md` ve kullanıcı talimatları okunur.
2. Git branch’i ve çalışma ağacı kontrol edilir.
3. İlgili uygulama akışı ve dosyalar belirlenir.
4. Kısa bir değişiklik ve doğrulama planı oluşturulur.
5. Kapsam tek bir mantıksal konu ile sınırlandırılır.
6. Yalnızca gerekli dosyalar değiştirilir.
7. İlgisiz sorunlar sessizce düzeltilmez; görev sonunda risk olarak raporlanır.
8. Kullanıcının istemediği özellik veya UI davranışı eklenmez.
9. Kapsam genişlemesi gerekiyorsa önce kullanıcı onayı alınır.
10. Sonuç gerçek çalışma ağacı, komut çıktıları ve görünür uygulama davranışıyla doğrulanır.

## 5. Git çalışma kuralları

- Doğrudan `main` üzerinde geliştirme yapılmaz.
- Her görev için `codex/` önekli ayrı branch kullanılır.
- Görev öncesinde ve sonunda `git status --short --branch` çalıştırılır.
- Kullanıcının mevcut değişiklikleri korunur; silinmez, geri alınmaz, stash edilmez ve üzerine yazılmaz.
- Kullanıcı açıkça istemeden commit, push, merge, rebase, force push, pull veya pull request yapılmaz.
- Başka branch’lerdeki değişiklikler kendiliğinden birleştirilmez.
- İlgisiz değişiklikler aynı görev veya commit altında toplanmaz.
- Görev sonunda branch adı ve değişen dosyalar açıkça raporlanır.

Önerilen aşama branch’leri:

```text
codex/project-governance
codex/project-foundation
codex/auth-hardening
codex/supabase-security
codex/client-management
codex/meal-plans
codex/chat
codex/appointments
codex/subscriptions
codex/mock-cleanup
codex/repository-cleanup
codex/quality-baseline
codex/release-preparation
codex/post-release-validation
```

## 6. Supabase veri erişim kuralları

- Yeni Supabase sorguları ilgili `features/*/services/` katmanına konur.
- Sayfa bileşenlerine yeni doğrudan Supabase sorgusu eklenmez.
- Mevcut sayfa seviyesindeki sorgular yalnızca ilgili görev kapsamında kontrollü biçimde servis katmanına taşınır.
- UI, veri erişimi ve hata yönetimi gereksiz şekilde tek bileşende birleştirilmez.
- Her sorgunun `data` ve `error` sonucu kontrol edilir; hata sessizce yutulmaz.
- Başarısız DB işlemi kullanıcıya başarılı gösterilmez.
- DB yazması başarısızken local state fallback ile kalıcı kayıt izlenimi verilmez.
- Frontend filtresi veya route guard güvenlik mekanizması kabul edilmez; RLS ayrıca doğrulanır.
- `insert`, `update`, `delete`, RPC, upload ve download işlemlerinde kullanıcı yetkisi varsayılmaz.
- Veri erişimi authenticated kullanıcı ve diyetisyen–danışan ilişkisine göre sınırlandırılır.
- Sorgularda sahiplik filtresi kullanılsa bile RLS zorunlu savunma katmanıdır.

Kullanıcı açıkça onaylamadan şunlar yapılmaz:

- production `INSERT`, `UPDATE`, `DELETE` veya RPC;
- migration veya seed çalıştırma;
- gerçek ya da sahte kullanıcı, danışan veya diyetisyen oluşturma;
- ilişki, randevu, beslenme planı, öğün veya mesaj oluşturma;
- Storage dosyası yükleme, değiştirme veya silme;
- RLS veya Storage policy değiştirme.

Salt okunur inceleme ile yazma işlemleri her raporda açıkça ayrılır.

## 7. Veritabanı ve migration kuralları

- Şema değişiklikleri sürümlenmiş migration dosyalarıyla yönetilir.
- Supabase panelinde rastgele veya belgesiz SQL uygulanmaz.
- Migration dosyası oluşturmak ve migration’ı çalıştırmak ayrı yetkilendirme gerektiren işlemlerdir.
- Production migration açık kullanıcı onayı olmadan çalıştırılmaz.
- Migration öncesinde mevcut kolonlar, tipler, foreign key’ler, unique/check constraint’ler, index’ler, trigger’lar ve RLS politikaları doğrulanır.
- Destructive tablo/kolon silme ve veri dönüşümü açık kullanıcı onayı gerektirir.
- Migration küçük, hedefli, idempotency beklentisi açık ve açıklanabilir olmalıdır.
- Web ve mobil veri modeli uyumluluğu değerlendirilir.
- Uygulama sonrası doğrulama sorguları ile geri dönüş/düzeltme stratejisi önceden planlanır.

## 8. Authentication ve yetkilendirme kuralları

Auth kontrolleri fail-closed çalışmalıdır:

```text
Oturum yok → Giriş ekranı
Oturum var, rol yükleniyor → Yükleme durumu
Rol okunamadı veya sorgu hata verdi → Erişim engellenir
Rol client → Web erişimi engellenir ve oturum kapatılır
Rol dietitian → Profil ve onay durumu kontrol edilir
Diyetisyen profili eksik → Kontrollü hata/tamamlanmamış profil ekranı
Diyetisyen onaysız → Onay bekleme veya red ekranı
Diyetisyen onaylı → Korumalı uygulamaya erişim
```

- `null`, `undefined`, timeout veya sorgu hatası erişim izni sayılmaz.
- Route guard tek güvenlik katmanı değildir; Supabase RLS zorunludur.
- Yetki kontrolü yalnızca menü gizleme ile yapılmaz.
- Client rolündeki kullanıcı web paneline erişemez.
- Kayıt sırasında profil insert/upsert hataları yutulmaz.
- Auth kullanıcısı oluşup profil kaydı oluşmadıysa tam başarı gösterilmez; kullanıcıya kontrollü durum sunulur.
- Session restore, auth state değişimi, logout ve password recovery akışları ayrı ayrı doğrulanır.

## 9. Gerçek veri ve mock veri kuralları

- Mock, demo, sabit, local-only ve gerçek veriler kodda ve UI’da açıkça ayrılır.
- Mock veri gerçek DB kaydı gibi gösterilmez.
- Sayfa yenilemesinde kaybolan işlem kalıcıymış gibi sunulmaz.
- Kullanıcı açıkça istemedikçe yeni mock veri eklenmez.
- Production’a hazır olmayan modül gerçek veriye bağlanır, MVP dışında bırakılır veya menüden gizlenir.
- Sahte loading veya sahte başarı production davranışı kabul edilmez.
- Mock temizliği ayrı görevde yapılır.
- Mesajlaşma, tarifler, analiz, notlar, görevler, ayarlar ve randevu fallback’i değiştirilmeden önce mevcut veri akışı incelenir.
- Test verisi yalnızca açıkça tanımlanmış test ortamında ve onaylı kapsamda oluşturulur.

## 10. Environment ve secret kuralları

- Vite istemci değişkenleri `import.meta.env` üzerinden okunur; yeni `process.env` kullanımı eklenmez.
- Temel istemci değişkenleri `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` olarak standardize edilir.
- Supabase URL veya anahtarı kaynak koda hardcoded fallback olarak eklenmez.
- `.env` dosyaları Git’e commit edilmez; `.env.example` yalnızca isim ve güvenli örnek içerir.
- `SUPABASE_SERVICE_ROLE_KEY`, veritabanı şifresi, yönetici anahtarı veya ödeme secret’ı istemci koduna eklenmez.
- Secret, token ve anahtarlar loglarda, ekran görüntülerinde veya görev raporlarında açık gösterilmez.
- Repository’de mevcut açık değerler kullanıcı onayı olmadan döndürülmez; risk olarak raporlanır. Rotasyon ayrı görevdir.

## 11. Storage ve dosya yükleme kuralları

- Bucket erişimi uygun Storage policy ile sınırlandırılır.
- Kullanıcı yalnızca yetkili olduğu dosyalara erişebilir.
- Upload öncesinde MIME türü, uzantı, maksimum boyut, dosya adı/yolu ve yetkilendirme kontrol edilir.
- Saklanan dosya yolu ile public/signed URL birbirine karıştırılmaz.
- Upload başarısızsa DB’ye başarılı dosya kaydı yazılmaz.
- DB kaydı başarısızsa yetim dosya temizliği veya telafi stratejisi uygulanır.
- Production Storage’a kullanıcı onayı olmadan test dosyası yüklenmez.

## 12. Kod kalitesi kuralları

- TypeScript tipleri açık ve anlamlı tutulur; gereksiz `any` kullanılmaz.
- Ortak tipler ve servisler yeniden kullanılır; aynı işlev farklı yerlerde çoğaltılmaz.
- Hatalar sessizce yutulmaz; kullanıcı mesajı anlaşılır, geliştirici logu tanı koydurucu olur.
- Teknik Supabase hata nesnesi doğrudan kullanıcıya gösterilmez.
- Kullanılmayan import, ölü kod veya kapsam dışı refactor eklenmez.
- Production’a bırakılacak `console` çağrıları değerlendirilir.
- Kod değişikliği mümkün olduğunca küçük tutulur.
- Tasarım ve davranış görev kapsamı dışında değiştirilmez.

## 13. Bağımlılık kuralları

- Yeni paket eklemeden önce mevcut bağımlılıklarla çözüm değerlendirilir.
- Paket gerekliyse gerekçe, bundle boyutu, bakım durumu, lisans ve güvenlik etkisi raporlanır.
- Major sürüm yükseltmeleri ayrı görevde yapılır.
- Lockfile gereksiz şekilde yenilenmez.
- Lockfile mevcut olduğunda temiz kurulum için `npm ci`, bağımlılık değişikliği gerektiğinde kontrollü `npm install` kullanılır.
- Paket kurulumu veya çözümlemesi başarısızsa hata gizlenmez.

## 14. Build, typecheck, lint ve test kuralları

Repository’nin başlangıçta doğrulanan scriptleri:

```bash
npm install
npm run dev
npm run build
npm run preview
```

Başlangıç durumunda `typecheck`, `lint` ve otomatik `test` scriptleri yoktur. Kalite altyapısından sonra hedef kapı:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

- Kod değişikliği sonrasında en az production build çalıştırılır.
- Mevcutsa typecheck, lint ve ilgili testler çalıştırılır.
- Olmayan veya çalıştırılmayan kontrol başarılı gibi raporlanmaz.
- Çalıştırılamayan kontrol ve nedeni görev sonunda belirtilir.
- Gerçek DB’ye yazabilen kök betikler otomatik test değildir ve kullanıcı onayı olmadan çalıştırılmaz.
- Özellikle `test_insert.js` çalıştırılmaz.
- Build için gerekli environment eksikse açıkça raporlanır.

## 15. UI ve kullanıcı deneyimi kuralları

- Mevcut DietBridge görsel dili ve Türkçe kullanıcı metinleri korunur.
- Loading, empty, error ve success durumları birbirinden ayrılır.
- Butonlar işlem sürerken tekrar gönderimi engeller.
- Form validasyonları anlaşılır ve alanla ilişkili olur.
- Başarı mesajı yalnızca işlem gerçekten tamamlandığında gösterilir.
- Responsive davranış görev kapsamına uygun cihaz genişliklerinde kontrol edilir.
- Klavye erişimi, etiketler, odak ve temel erişilebilirlik göz ardı edilmez.
- Kullanıcı verisi silme işlemleri açık onay gerektirir.
- Tasarım yenilemesi işlevsel düzeltmeye sessizce eklenmez.

## 16. Görev sonu rapor standardı

Her görev sonunda aşağıdakiler raporlanır:

1. Görevin amacı
2. Kullanılan branch
3. Değiştirilen dosyalar
4. Yapılan değişikliklerin özeti
5. Çalıştırılan komutlar
6. Build sonucu
7. Typecheck sonucu
8. Lint sonucu
9. Test sonucu
10. Çalıştırılamayan kontroller ve nedenleri
11. Supabase veya production verisine yazılıp yazılmadığı
12. Migration oluşturulup oluşturulmadığı
13. Migration çalıştırılıp çalıştırılmadığı
14. Git çalışma ağacı durumu
15. Kalan riskler
16. Manuel kontrol gereken noktalar
17. Önerilen sonraki yol haritası aşaması

Rapor, yalnızca gerçekten çalıştırılan kontrolleri başarılı sayar; tahminleri doğrulanmış sonuç gibi sunmaz.
