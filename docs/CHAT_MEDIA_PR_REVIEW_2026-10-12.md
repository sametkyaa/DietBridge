# Web #67 ve mobil #36 PR incelemesi

12 Ekim 2026. Branch: her iki repository'de `codex/chat-media-20261012`.

İncelenen ilk head'ler: web `984682be487e31a9b2ca443dd9593be339f4403f`, mobil `aa1f1a9258b89def408438b99ddbdaeab39aedb5`. Her iki PR'ın o head'lerdeki GitHub kontrolleri başarılıydı. Aşağıdaki düzeltmeler aynı PR'lara eklenir; son head için GitHub kontrolleri ayrıca çalışır.

- Web: https://github.com/sametkyaa/DietBridge/pull/67
- Mobil: https://github.com/sametkyaa/DietBridge-Mobile/pull/36

## Düzeltilen bulgular

1. **Mobil picker açıkken composer kilidi eksikti.** Hook, busy bilgisini yalnız yükleme aşaması metninden türetiyordu; native seçim sırasında bu metin boştu. Gerçek async kilit state'e bağlandı. İptal edilen eski seçici yeni seçicinin kilidini veya seçimini değiştiremez.
2. **Mobil geçmişte gerçek dosya adı okunmuyordu.** Ek metadata zenginleştirmesi yanlışlıkla conversation okumasına eklenmişti; history/page okumasında yoktu. Doğru message page akışına taşındı. Metin ve eski JPEG sayfaları yeni kolon sorgusu gerektirmez; metadata erişim hatası eksik geçmişi tam başarı gibi sunmaz.
3. **Medya tamamlanması reconciliation'ı beklemiyordu.** ViewModel'in hedefli fetch callback'i Promise döndürmüyordu; `await` hemen tamamlanıyordu. Yeni mesaj timeline'a katılmadan kaydırma olabiliyordu. Aynı mesaj için mevcut request yeniden kullanılır ve döndürülür; sohbet/generation değişince eski tamamlanma yeni sohbeti kaydırmaz.
4. **Yeni sunucu medya akışı GitHub kontrollerinde çalışmıyordu.** Mevcut başarılı testler yeni migration'ı bağımsız medya harness'ine erteliyordu. Workflow'a 50 gerçek Edge/format/temizlik/hesap silme testi ve yeni migration + gerçek belge/video/JPEG/receipt/kota testini çalıştıran iki job eklendi. Handler, runtime betikleri, preflight/postflight ve fixture değişimleri workflow'u tetikler.

## Kanıt ve kapsam

Yeni mobil testler gerçek kaynak hook, service ve ViewModel callback'lerini çalıştırır. Eski kodda picker testleri 4/4, history testleri 2/3 ve reconciliation testleri 3/3 başarısızdı. Düzeltmelerden sonra 10/10 başarılı; tüm mobil `npm run quality` kapısı 511 başarılı test, typecheck, lint (0 hata/41 mevcut uyarı), Expo config ve Android/iOS export ile geçti.

Web kaynak davranışı ayrıca incelendi: canonical metadata, optional caption, özel URL, mevcut JPEG uyumu, health/session geçersiz kılma, mesaj/ek sayfalama ve receipt görünümü. Sunucu tarafında auth/aktif ilişki/sağlık kontrolü, immutable intent/attachment, servis upload broker'ı, byte/adet kotası, RLS, hesap silme ve temizlik sözleşmeleri takip edildi. Bu işlevsel PR incelemesi ayrı bir kapsamlı repository güvenlik taraması veya antivirüs incelemesi değildir.

Workflow YAML parse edildi. Yeni workflow'un Edge komutları yerelde aynı config ve izolasyon seçenekleriyle çalıştırıldı: üç giriş typecheck ve 50 test/2 alt adım başarılı. Web lint (0 hata/5 mevcut uyarı) ve production build başarılı; önceki 609 test kanıtı ve ilk head'in GitHub Web Quality/Backend/E2E/health kontrolleri korunuyor. Yeni migration'ın önceki gerçek yerel runtime kanıtı `chat-backend-runtime.log` dosyasında; aynı komut yeni `media-runtime` job'unda tekrar çalışır.

Yerel kanıt klasörü: `C:\dev\DietBridge-Release-Audit\2026-10-12`. Yeni loglar: `chat-review-mobile-quality.log`, `chat-review-web-lint.log`, `chat-review-web-build.log`, `chat-review-edge-check.log`, `chat-review-edge-tests.log`, `chat-review-busy-before.log`, `chat-review-history-before.log`, `chat-review-reconcile-before.log`.

## Yayın durumu ve takip

İnceleme production verisine veya Storage'a yazmadı. Yeni migration değiştirilmedi, production'da uygulanmadı; Edge deploy ve feature flag açma yapılmadı. İmzalı yeni APK/IPA ve fiziksel cihaz kabulü henüz yok. Npm'in 45 bağımlılık bildirimi ve mevcut lint/chunk uyarıları ayrı değerlendirme gerektiriyor.

Kullanıcının önceki GitHub onayı ve bu PR'larda devam talimatı kapsamında düzeltmeler commit/push edilir. Merge için proje `AGENTS.md` açık talimat istiyor; production migration da ayrıca açık onay gerektiriyor. Sonraki somut adım iki PR'ın son head kontrolleri sonrası birleştirme kararıdır. Sunucu dağıtımı, önceki mobil uyumluluk hazırlığını koruyan yeni native paket ve cihaz kabulü `CHAT_MEDIA_RELEASE_2026-10-12.md` sırasıyla yürütülür.

Tam değişen dosya envanteri: `CHAT_MEDIA_CHANGED_FILES_2026-10-12.md`. Başlangıç web/mobil çalışma ağaçları korunmuştur; bu inceleme ayrı görev veya başka branch'in değişikliklerini birleştirmemiştir.
