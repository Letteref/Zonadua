# Architecture — GowsLab

Dokumen teknis pendamping [PRD.md](PRD.md). Menjelaskan cara fitur F1–F8 diimplementasikan dengan stack yang ringan, local-first, dan zero-cost.

---

## 1. Ringkasan Arsitektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    GowsLab PWA (statis)                         │
│  Svelte 5 + Vite + TS · Tailwind 4 · Dexie (IndexedDB)         │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │  UI      │ │  Domain  │ │  Data    │ │  Infra             │ │
│  │ Svelte   │ │ metrics  │ │ repos    │ │ file import        │ │
│  │ routes   │ │ physics  │ │ dexie    │ │ gpx/tcx/fit        │ │
│  │ charts   │ │ pacing   │ │ exports  │ │ strava client      │ │
│  │ uPlot    │ │ kalman?  │ │ backup   │ │ ai client (BYO)    │ │
│  │ maplibre │ │          │ │          │ │ weather (met.no)   │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘ │
│         Service Worker: offline, cache app shell               │
└──────────────┬──────────────────────────────┬───────────────────┘
               │ HTTPS                        │ HTTPS
      ┌────────▼─────────┐          ┌─────────▼──────────┐
      │ Cloudflare Pages │          │ Cloudflare Worker  │
      │ (host statis,    │          │ /api/strava/*      │
      │  gratis)         │          │ OAuth PKCE proxy   │
      └──────────────────┘          └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │ Cloudflare D1      │
                                    │ (sync & token,     │
                                    │  free tier)        │
                                    └────────────────────┘
                                       ▲
                              ┌────────┴────────┐
                              │  Browser →      │
                              │  Strava API     │
                              │  (data aktivitas│
                              │   langsung)     │
                              └─────────────────┘
```

**Prinsip alur:**
- Data aktivitas dari Strava diambil **langsung oleh browser** ke `api.strava.com` (token di memori browser), bukan lewat server kita. Worker hanya diperlukan untuk menukar authorization code → token karena alur PKCE memerlukan kerahasiaan `client_secret`.
- Semua komputasi metrik (TSS, power curve, PMC, fisika rute) dijalankan **di browser** — tidak ada server komputasi sama sekali.
- D1 hanya menyimpan: token sync (terenkripsi), cursor sync, dan (opsional) backup JSON terenkripsi untuk cloud sync.

## 2. Stack & Versi

| Layer | Pilihan | Alasan |
|---|---|---|
| Framework | **Svelte 5** (runes) | Compile ke vanilla JS, bundle terkecil di kelasnya, reactivity halus |
| Bundler | **Vite** + `vite-plugin-pwa` | HMR cepat, Workbox untuk service worker otomatis |
| Bahasa | **TypeScript strict** | Bebas runtime error tipe |
| Styling | **Tailwind CSS 4** | Utility-first, purge otomatis, hasil CSS kecil |
| Font | `@fontsource-variable/plus-jakarta-sans` | Self-host variable font, tanpa request Google Fonts, offline-ready |
| Icons | **lucide-svelte** | Tree-shakeable per icon |
| Charts | **uPlot** (~45 KB gzip) | Tercepat untuk time-series besar di canvas |
| Map | **MapLibre GL JS** + raster tile OpenStreetMap/OSM-France | Gratis; opsional mode tanpa basemap |
| DB lokal | **Dexie.js 4** (IndexedDB) | API TypeScript-friendly, reactive `liveQuery` |
| ID | **nanoid** | ID pendek unik per record |
| Parse file | `gpx` parser sendiri (DOMParser), TCX mirip, **FIT**: `fit-file-parser` | Mature, tanpa dependency besar |
| Zip GPX batch | `fflate` | Ringan, untuk import batch |
| Timezone | `Intl.DateTimeFormat` native | Tanpa library besar |
| Kompresi stream | `pako` (deflate) untuk activity_streams | Stream GPX 200 km bisa 10+ MB → ~1 MB |
| AI client | fetch langsung ke provider (BYO key) | Tanpa SDK berat |
| Cloud sync | Worker + D1 (opsional) | Free tier Cloudflare |

**Bundle target:** < 250 KB gzip total (Tanpa map & chart ter-load lazy).

## 3. Struktur Proyek

```
src/
├── main.ts
├── app.css                     # Tailwind + theme tokens
├── lib/
│   ├── components/             # UI reusable (Card, Chart, Button, dsb.)
│   ├── routes/                 # Halaman (SvelteKit-like routing manual atau svelte-routing)
│   │   ├── dashboard/          # Snapshot, tren, form reminder
│   │   ├── activities/         # List + detail aktivitas
│   │   ├── body/               # Profil tubuh, berat, FTP
│   │   ├── bikes/              # Sepeda & komponen
│   │   ├── routes/             # GPX library + estimator
│   │   ├── races/              # Setup race + live tracker
│   │   ├── coach/              # AI coach
│   │   └── settings/           # Import/export, sync, tema
│   ├── domain/                 # PURE LOGIC — no Svelte, no DB
│   │   ├── metrics.ts          # NP, IF, TSS, power zones
│   │   ├── power-curve.ts      # mean-max, CP/W' fit (minimal 3-param)
│   │   ├── pmc.ts              # CTL/ATL/TSB incremental
│   │   ├── physics.ts          # power→speed solver per segmen
│   │   ├── pacing.ts           # route → segmen → waktu & checkpoint
│   │   ├── race.ts             # proyeksi, buffer cut-off, required pace
│   │   ├── nutrition.ts        # g/h, gel count
│   │   └── weather-adjust.ts   # koreksi cuaca pada model
│   ├── data/
│   │   ├── db.ts               # Dexie schema + liveQuery helpers
│   │   ├── repo/               # repositori per entitas (activity, bike, dsb.)
│   │   └── backup.ts           # export/import JSON
│   ├── infra/
│   │   ├── gpx/                # parser, smoother (Gaussian/LOESS), grade calc
│   │   ├── fit/                # fit-file-parser wrapper
│   │   ├── strava/             # OAuth PKCE + API client + rate-limit guard
│   │   ├── ai/                 # provider adapters (gemini/openai/anthropic/openrouter)
│   │   ├── weather/            # open-meteo client
│   │   └── geo/                # haversine, point-to-segment, tile helpers
│   └── workers/                # web worker untuk parsing besar (opsional)
└── static/                     # manifest, icons, sw
```

**Aturan arsitektur:**
- `domain/` murni fungsi pure — **harus** bisa dites tanpa browser/DB (unit test target utama).
- `data/repo/` satu-satunya yang boleh menyentuh Dexie; UI tidak pernah query DB langsung.
- `infra/` mengisolasi I/O eksternal (file, network, AI provider).
- Route-based code splitting: modul map/chart/parser hanya di-load saat halaman terkait dibuka.

## 4. Data Model (Dexie / IndexedDB)

> Replikasi ke D1 memakai struktur sama (SQLite). Semua tabel punya `id` (nanoid) dan `updatedAt`.

```ts
// db.ts (skema versi 1)
Dexie: gowslab
├── athlete:        id='me'                        // singleton
├── weight_log:     id, date, kg
├── ftp_history:    id, date, ftp
├── zones:          id, type('hr'|'power'), version, zones[]
├── bikes:          id, name, type, weightKg, crr, cda, odometerKm, photo?, notes
├── components:     id, bikeId, name, kind, installedAtOdoKm, intervalKm, notes
├── activities:     id, date, name, source('strava'|'gpx'|'tcx'|'fit'|'manual'),
│                   bikeId?, distanceKm, movingSec, elapsedSec, elevGainM,
│                   avgPower?, np?, if?, tss?, avgHr?, maxHr?, kcal,
│                   commute?, notes?
├── activity_streams: id (=activityId), compressed(pako), fields[]
│                   // time, lat, lng, alt, watts?, hr?, cad?, temp?
├── routes:         id, name, sourceGpxMeta, distanceKm, elevGainM,
│                   pointsCompressed, segments?, createdAt
├── races:          id, routeId, name, startTime, cutoffFinishMin,
│                   checkpoints[{km, cutoffMin?}], planJson?, status
├── race_logs:      id, raceId, at(epochSec), km, note?
├── ai_notes:       id, kind('review'|'plan'|'chat'), content, contextJson, createdAt
├── sync_state:     id='strava', lastSyncAt, cursor, rateWindow
└── settings:       id='app', unit, theme, lang, aiProvider, aiKey?, weatherOn
```

**Index penting:** `activities.date`, `activities.bikeId`, `race_logs.raceId`, `components.bikeId`.

**Estimasi ukuran:** 500 aktivitas dengan stream (deflated) ≈ 300–600 MB — aman di IndexedDB (limit ~60% disk di Chrome). Stream aktivitas tua dapat di-prune (simpan summary saja) dari Settings.

## 5. Domain Logic — Detail Kunci

### 5.1 Metrik (F1)
- **NP** (Normalized Power): rolling 30 s power → raised to 4th power → avg → 4th root.
- **IF** = NP / FTP (FTP berlaku sesuai tanggal aktivitas dari `ftp_history`).
- **TSS** = (durasi_jam × IF × 100 × IF) — dengan FTP-aware retro-compute saat FTP baru.
- **Power curve:** untuk setiap aktivitas, hitung mean-max per durasi kanonik [1,5,10,15,20,30,45,60,120,180,240,300,390,600 s, 5,8,10,15,20,30,40,60,90,120,180,240,300,360,480,600,720 min]; gabungkan maksimum antar aktivitas per durasi.
- **CP & W′:** fit model 3-parameter (Minimal Model: P = W′/t + CP) dengan nonlinear least squares (implementasi sendiri, ~80 baris, Gauss-Newton). Simpan R² untuk indikator kecocokan.

### 5.2 PMC
- CTL = EMA(rata-rata TSS harian, 42 hari); ATL = EMA(7 hari); TSB = CTL − ATL.
- Dihitung incremental ( hemat CPU): simpan `ctl`,`atl`,`tsb` harian di tabel `pmc_day` (bisa dihitung ulang penuh saat restore).

### 5.3 Fisika power → speed (F6)
Per titik rute (setelah smoothing elevasi & slicing jarak ~10 m):
```
P_total = P_gravity + P_rolling + P_aero + P_drivetrain_loss
P_gravity  = m · g · v · sin(atan(grade))
P_rolling  = Crr · m · g · v · cos(atan(grade))
P_aero     = 0.5 · ρ(h,T) · CdA · (v + v_wind)³ · loss_factor
P_dt       = P_total_before / (1 - dt_loss)   // dt_loss ≈ 0.025 (chain)
m = rider_weight(date) + bike_weight + cargo
```
- **Solver:** binary search `v` agar P_total = P_target (power target per segmen), dengan cap: `v_min` (stall speed, mis. 5 km/j), `v_max` descent (input pengguna, default 65 km/j).
- **ρ** dihitung dari elevasi rute (barometrik) + suhu (weather-adjust bila aktif, default 20°C).
- Output per segmen: `v, t, cumTime, cumDist` → agregasi total + tabel checkpoint.

### 5.4 Race projection (F7)
Input: `race`, `route.points`, `logs[]` (km, epoch), `cutoffs`.
- Ambil log terakhir `(km₀, t₀)`; hitung `avgMovingSpeed` = km₀ / (t₀ − start − totalRestEstimate).
- **Sisa rute** dari GPX: slicing dari km₀ → hitung waktu sisa dengan fisika 5.3 (IF target dari plan) + stop time sisa.
- `projectedFinish = now + remainingTime`.
- `buffer = cutoff − projectedFinish` (finish dan per-checkpoint).
- `requiredAvgSpeed = remainingDist / (cutoff − now)`.
- `feasibility`: bandingkan `requiredPower` (dari solver terbalik) vs `W'bal` & CP — status AMAN/WASPADA/KRITIS.
- Deviasi vs plan: `plan.timeAtKm(km₀)` vs `t₀` aktual.

### 5.5 AI context (F5) — kepatuhan §5.3
Konteks yang dikirim ke LLM **hanya**:
- Snapshot metrik turunan: CTL/ATL/TSB terkini, FTP/W/kg, power curve summary (angka durasi kunci), distribusi zona 4 minggu, TSS mingguan 8 minggu.
- Ringkasan rute/race: jarak, D+, estimasi waktu, checkpoint table.
- Input manual & log race.
**Tidak pernah dikirim:** raw latlng/elevasi/watts dari API Strava, token Strava, API key lain. Semua prompt templates disimpan statis di `lib/infra/ai/prompts.ts`.

## 6. Strava Integration (F1 source)

### 6.1 OAuth (PKCE)
1. App di Strava dashboard (milik pengguna; subscription aktif memenuhi syarat).
2. Frontend generate `code_verifier`+`challenge` → redirect ke `strava.com/oauth/authorize` (scope `activity:read_all`).
3. Callback ke app → POST via Worker `/api/strava/token` (Worker menambahkan `client_secret` yang disimpan sebagai secret Worker, tidak pernah masuk bundle).
4. `access_token` (6 jam) & `refresh_token` disimpan di IndexedDB (access) & D1 (refresh, terenkripsi AES-GCM dengan key derived dari PIN pengguna — opsional) atau cukup di IndexedDB bila cloud sync dimatikan.

### 6.2 Sync
- Pull `/api/v3/activities/list` (per_page=100, after=cursor) → store summary → untuk aktivitas tanpa stream terbaru, pull `streams` (latlng, altitude, time, watts, heartrate, cadence, temp, velocity).
- **Rate-limit guard:** baca header `X-RateLimit-Usage` / `X-RateLimit-Limit`; berhenti + jadwalkan retry bila > 80% kuota window. Batch default 50 aktivitas/sesi sync, resume manual.
- **Kepatuhan:**
  - Data API hanya ditampilkan ke pemiliknya (single-user app — OK).
  - Cache API ≤ 7 hari: stream & summary disimpan sebagai **metrik turunan** jangka panjang; raw stream yang berasal dari API boleh di-cache maksimal 7 hari, setelah itu di-prune otomatis (file import tidak terbatas). Implementasi: kolom `source` di `activity_streams` + pruner di settings.
  - Tidak ada data API yang masuk ke konteks AI (lihat 5.5).
  - Token hanya via header (siap untuk aturan 2027), base URL mudah diganti.

## 7. AI Client (F5)

- Provider adapter interface: `chat(messages, {json?})` — implementasi Gemini (REST), OpenAI-compatible (OpenAI/OpenRouter/Anthropic-compatible), tanpa SDK.
- Key disimpan di `settings` (IndexedDB) — **tidak pernah** dikirim ke server kami (tidak ada server AI kami).
- Timeout, retry 1x, streaming opsional (SSE) untuk chat.
- `coach.ts` menyusun context (5.5) + template prompt per tugas (weekly review, plan, chat, race briefing).

## 8. Weather (F6 P1)
- Open-Meteo forecast: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation` — gratis, tanpa key.
- Sampling: titik rute setiap ~25 km + jam estimasi tiba (iteratif: estimasi → ambil cuaca → koreksi → estimasi ulang, 2 iterasi cukup).

## 9. PWA & Offline
- `vite-plugin-pwa` (Workbox): precache app shell; runtime cache: tile map (stale-while-revalidate, max 500 entries), font, AI responses tidak di-cache.
- **Race mode offline:** semua komputasi lokal; GPX rute race di-precache saat setup (simpan points ke IndexedDB); wake-lock API saat mode live; fullscreen optional.
- Update strategy: `registerType: 'autoUpdate'` + toast "versi baru tersedia".

## 10. Cloud Sync (opsional, P1)
- Worker endpoints: `/sync/push` (batch encrypted JSON), `/sync/pull` (since ts).
- Payload = backup JSON **terenkripsi di klien** (WebCrypto AES-GCM, key dari passphrase pengguna via PBKDF2) → server buta terhadap isi.
- D1 schema: `users(deviceId, encBackup, updatedAt)` — satu baris per device + `last_write_wins` per tabel via `updatedAt`.
- Free tier: D1 5 GB + Worker 100k req/hari — lebih dari cukup untuk 1 pengguna.

## 11. Deploy (zero-cost)
1. `npm run build` → `dist/` → **Cloudflare Pages** (connect GitHub repo, auto-deploy).
2. Worker (strava token + sync) → `wrangler deploy` (free plan).
3. Strava API app settings: callback URL = `https://<app>.pages.dev/oauth/strava`.
4. Domain kustom opsional (gratis via Cloudflare).

## 12. Testing Strategy
- **Unit (vitest):** `domain/` 100% pure — metrics, physics solver, pacing, race projection, PMC. Fixture: GPX kecil + aktivitas sintetis dengan solusi yang diketahui.
- **Property-based (fast-check):** fisika — konsistensi energi (power→speed→power roundtrip), pacing monotonic (FTP naik ⇒ waktu total tidak naik).
- **Component (vitest + svelte testing-library):** form input, race live widget.
- **E2E (Playwright):** import GPX → lihat estimasi; setup race → input checkpoint → buffer muncul.
- **Golden test estimasi:** bandingkan hasil fisika vs aktivitas nyata (rute sama, kondisi serupa) — target deviasi < ±7%.
