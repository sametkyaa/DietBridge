# Production Public Şema Baseline Taslağı

> [!CAUTION]
> Bu klasördeki SQL dosyası production Supabase projesinin yalnızca `public` şemasından alınmış, veri içermeyen ve henüz hiçbir ortama uygulanmamış baseline taslağıdır.

- `dietbridge_production_public_baseline.sql`, `supabase db dump` ile oluşturulmuştur.
- Kaynak production projesidir; proje referansı güvenlik için maskeli tutulur (`kagv…cuxz`).
- Kapsam yalnızca `public` şemasıdır ve dump veri içermez.
- `auth` ve `storage` şemaları kapsam dışıdır. Storage bucket metadata'sı ayrıca yönetilecektir.
- Production migration history değiştirilmemiştir.
- Bu dosya active migration değildir ve `supabase/migrations/` altında yer almaz.
- Baseline staging veya production projesine uygulanmamıştır.
- SHA-256 bütünlük değeri ve 10 public function için yapılan güvenlik incelemesi `docs/SUPABASE_BASELINE_STATIC_REVIEW.md` içinde kayıtlıdır.
- Dosyanın `supabase/migrations/` altına taşınması veya herhangi bir ortama uygulanması için önce açık kullanıcı onayı gerekir.

## Kaynak dosya ve Git index bütünlüğü

Baseline SQL, Supabase CLI tarafından oluşturulan ham `pg_dump` çıktısı olarak byte-for-byte korunmaktadır. Dosyanın CRLF satır sonları ve sonundaki boş satır doğrulanmış SHA-256 bütünlüğünün parçasıdır.

Git'in satır sonlarını index'e eklerken LF biçimine dönüştürmesini engellemek için yalnızca bu baseline dosyasına `.gitattributes` üzerinden `-text` uygulanmıştır. Kaynak dump sonundaki boş satır için yine yalnızca bu dosyada `blank-at-eof` kontrolü kapatılmış; CRLF satır sonundaki CR karakterinin trailing whitespace sayılmaması için `cr-at-eol` tanımlanmıştır.

Dosya binary olarak işaretlenmemiştir. Diğer repository dosyalarının satır sonu ve whitespace kontrolleri değiştirilmemiştir.
