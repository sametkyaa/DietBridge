# DietBridge – Web AI Code Assistant Prompt (Dietitian Web Panel)

Bu prompt, DietBridge’in **web paneli** (diyetisyen tarafı) için kod üreten AI aracı tarafından kullanılacaktır.  
Lütfen aşağıdaki mimari ve kurallara **kesin olarak uy**.

---

## 1. Proje Özeti

- Proje adı: **DietBridge**
- Amaç: Diyetisyenlerin danışanlarını takip etmesi, beslenme planı oluşturması, analiz ve rapor ekranlarını yönetmesi.
- Bu prompt: **Sadece web uygulaması (diyetisyen paneli)** için geçerlidir.
- Backend: **Supabase** (Auth, Postgres, Storage, opsiyonel Edge Functions).

Detaylı mimari, projedeki `ARCHITECTURE.md` dosyasında tanımlıdır.  
Bu prompt, o dokümanla **tutarlı olmak zorundadır**.

---

## 2. Teknoloji ve Temel Kurallar (WEB)

- Framework: **React** (veya Next.js – proje ne kullanıyorsa ona uy).
- Dil:
  - Tercihen **TypeScript** (Projede TS yoksa JavaScript de kabul edilebilir; aksi belirtilmedikçe TS tercih et).
- Mimari: **Feature-based** yapı + servis katmanı.
- State yönetimi:
  - React hooks
  - Gerekirse Context / Redux Toolkit / Zustand (projede hangisi seçilmişse)
- Supabase erişimi:
  - **Sadece `services/` katmanından** veya ortak `packages/shared/services/` içinden yapılır.
  - Page/route component’leri içinde doğrudan `supabase.from(...).select(...)` yazma.

---

## 3. Klasör Yapısı (WEB)

Tüm kodu şu yapıya göre yaz:

```text
src/ (Root)
  features/
    auth/
      pages/
      components/
      services/
      hooks/
    clients/
      pages/
      components/
      services/
      hooks/
    meals/
      pages/
      components/
      services/
      hooks/
    analytics/
      pages/
      components/
      services/
      hooks/
  shared/
    components/
    hooks/
    utils/
    theme/
  lib/
    supabaseClient.(ts|js)
  router/ or pages/   # Proje yapısına göre
```

### 3.1. Responsibilities

**features/*/pages/**
Route’a bağlı container bileşenleri.
Örnek: `features/clients/pages/ClientsPage.tsx`, `features/clients/pages/ClientDetailPage.tsx`
Görevleri:
- URL parametrelerini okumak
- Feature-level hook’ları çağırmak (useClientList, useClientDetail vb.)
- UI bileşenlerini compose etmek (tablo, filtre, kartlar)

**features/*/hooks/**
Feature’a özel iş mantığı ve state yönetimi.
MVVM benzeri bir yapı gibi düşünülebilir (ViewModel rolü).
Örnek: `useClientList.ts`, `useMealPlansForClient.ts`
Sadece services/ katmanı ile konuşur, Supabase’e doğrudan erişmez.

**features/*/services/**
Supabase erişim/CRUD fonksiyonları.
Fonksiyon isimleri:
- Okuma: getXxx, fetchXxx
- Yazma: createXxx, updateXxx, deleteXxx, saveXxx
Örnek: `getClientsByDietitian(dietitianId)`, `getClientMeasurements(clientId)`

**features/*/components/**
Web arayüzüne özgü UI bileşenleri (tablo, card, filter bar, modal vb.)
Örnek: `ClientsTable`, `MealPlanTable`

**shared/**
Ortak bileşenler ve yardımcılar:
`shared/components/Button.tsx`, `shared/theme/colors.ts`

**lib/supabaseClient.(ts|js)**
Supabase client tanımı.

---

## 4. Supabase Erişim Kuralları

- `lib/supabaseClient.(ts|js)` içinde Supabase client tanımlanır.
- Environment değişkenleri: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Tüm Supabase çağrıları: `features/*/services/*.ts` içinden yapılır.
- Page/hook/component içinde `supabase.from(...)` yazma.

---

## 5. Domain Model ve Tablo İsimleri

Database modeli ARCHITECTURE.md ile uyumlu olmalı. Örnek tablolar: `dietitians`, `clients`, `meal_plans`, `recipes`, `appointments`.

---

## 6. Kodlama Kuralları (WEB)

- Dil: dosya, değişken, fonksiyon isimleri İngilizce.
- Yorumlar: Tercihen İngilizce; UI metinleri (label, placeholder vb.) Türkçe olabilir.
- Dosya isimleri:
  - Component & Page: PascalCase → `ClientsPage.tsx`
  - Servisler: camelCase → `clientService.ts`

---

## 10. TASK (BURAYI KULLANICI DOLDURACAK)

Aşağıda sana verilecek görevleri, yukarıdaki tüm kurallara uyarak gerçekleştir:

TASK: [Kullanıcı görevi buraya]
