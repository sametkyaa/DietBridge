# DietBridge Web

Diyetisyenlerin danışan, beslenme planı ve randevu süreçlerini yönettiği React/Vite web uygulaması.

## Gereksinimler

- Node.js 24 LTS
- npm 11 veya üzeri

Windows kullanıcıları, Node.js 24 LTS sürümünün kurulu ve aktif olduğundan emin olmalıdır.

## Kurulum

```bash
npm ci
cp .env.example .env
```

Windows PowerShell kullanıyorsanız environment dosyasını şu komutla kopyalayabilirsiniz:

```powershell
Copy-Item .env.example .env
```

`.env` içinde aşağıdaki değişkenleri kendi geliştirme ortamınıza göre tanımlayın:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

İlk lockfile oluşturma veya bağımlılıkların bilinçli olarak değiştirilmesi sırasında `npm install`; mevcut lockfile ile tekrarlanabilir kurulum için `npm ci` kullanılır.

## Çalıştırma

```bash
npm run dev
```

Development sunucusu varsayılan olarak `http://localhost:3000` adresinde çalışır.

## Kalite kontrolleri

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Typecheck ve lint aktif uygulama zincirini (`index.tsx`, `App.tsx`, `features/`, `pages/`, `shared/`, `lib/` ve bunların kullandığı kök tip/sabitleri) kapsar. Legacy kopyalar ile geçici kontrol/patch betikleri Aşama 10 repository temizliğine kadar kalite kapsamı dışında tutulur.

Disposable backend ve kritik browser E2E kapıları Docker Desktop/Engine gerektirir:

```bash
npm run test:backend
npm run test:e2e:install
npm run test:e2e
```

Komutların kapsamı, Mobile kalite kapısı ve GitHub required-check eşlemesi için [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md) belgesine bakın.

## Environment güvenliği

- `.env` Git'e commit edilmez.
- `.env.example` gerçek URL, anahtar veya token içermez.
- `SUPABASE_SERVICE_ROLE_KEY` veya başka bir yönetici anahtarı istemci koduna konmaz.
- Kök dizindeki araştırma/test betikleri production verisine karşı çalıştırılmaz.
- Otomatik backend/E2E testleri yalnız loopback disposable Supabase kullanır ve bilinen Production project ref'ini fail-closed reddeder.
