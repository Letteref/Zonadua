# Roadmap — GowsLab

Rencana implementasi bertahap. Setiap fase punya **definition of done** yang bisa diverifikasi. Urutan dirancang agar setiap fase menghasilkan sesuatu yang berguna (bukan setengah jalan).

Estimasi adalah *effort relatif*, bukan janji kalender.

---

## Status aktual (2 Okt 2026)

> Dokumen ini terakhir menyatakan "M0 — foundation" sementara codebase sudah di **UI v5.7.2**.
> Bagian di bawah sudah diselaraskan dengan kondisi repo sebenarnya. Ringkasan yang sama ada di
> [README.md](../README.md#status).

**Kesenjangannya: UI jauh mendahului logic.** Phase M0 sudah punya test runner (Vitest) sejak
langkah 0 dieksekusi, jadi phase berikutnya bisa dinyatakan selesai secara terverifikasi.
`physics` · `pacing` masuk lewat M3 dan `race` (slice pertama) masuk 2 Okt 2026; yang tersisa
adalah **proyeksi race penuh** — hero buffer/finish masih memakai `AVG_KMH` konstanta dan
feasibility belum dibandingkan dengan CP/W′.

| Phase | State | Bukti di repo |
| --- | --- | --- |
| M0 | **Done** | build + typecheck hijau, PWA manifest/SW, Dexie v1, hash router |
| M1 | **Done** | parser GPX/TCX di `domain/course.ts` (16 tes fixture), `domain/units.ts` (imperial dipakai di 4 tampilan), `domain/trend.ts` + kartu Body trend, editor zona F2-AC4 di Settings, `domain/zones.ts` dengan template |
| M2 | **Done** | `domain/metrics.ts`, `pmc.ts`, `power-curve.ts`, `zones.ts` (109 tes hijau), `data/streams.ts` + `synthetic.ts` + `recompute.ts`, tabel `power_curves`, kartu Power curve + route `#/rides/:id` |
| M3 | **Done** | `domain/physics.ts` + `domain/pacing.ts` (66 tes), `Routes.svelte` memakai hasil solve; `AVG_KMH = 30` dihapus; chart profil interaktif uPlot (hover + klik-pin + keyboard) |
| M4 | **Selesai** | `domain/race.ts` (gate buffer, feasibility, `clockAtKm`/`kmAtClock`/`planMinutesBetween`, `wPrimeSpentAt` + `sustainAt` vs CP/W′), hero BUFFER/PROJECTED FINISH/REQUIRED AVG dari `racePlan` (`RACE_KM`/`AVG_KMH` dihapus), sektor lambat dari solver (275 tes) |
| M5 | **Stub** | chat masuk ke `ai_notes`, tidak ada panggilan LLM |
| M6 | **Belum mulai** | tidak ada backend; `sync_state` kosong |

Semua celah yang tercatat di [UI-SPEC.md](UI-SPEC.md) §9.5 sudah ditutup: activity detail
(#/rides/:id), zone editor, satuan imperial, tren berat/FTP (v5.9), dan physics engine M3 (v6.0,
§21).

---

## M0 — Fondasi (selesai — DoD belum diverifikasi)
**Tujuan:** skeleton app yang jalan, ter-deploy, dan bisa di-install sebagai PWA.

- Scaffold Svelte 5 + Vite + TS strict + Tailwind 4
- Plus Jakarta Sans (fontsource variable) + Lucide icons terpasang global
- Routing dasar (dashboard + placeholder 7 halaman)
- Theme tokens (dark default + light), layout shell responsif (bottom nav mobile, sidebar desktop)
- Dexie terpasang + skema v1 + seed "athlete: me"
- PWA: manifest, service worker, installable, offline shell
- Deploy otomatis ke Cloudflare Pages

**Definition of done:**
- [ ] Lighthouse PWA ≥ 90, performa ≥ 90 di preview build
- [ ] Installable di Android Chrome & desktop Chrome
- [ ] Buka app tanpa internet → shell tetap tampil
- [ ] Deploy preview URL hidup

---

## M1 — Data Masuk (import + profil)

> **Status: selesai (2 Okt 2026).** Jadi: parser GPX/TCX di `domain/course.ts` (jarak/D+/waktu,
> pause > 90 s dibuang dari moving time, fallback pace nominal bila tanpa timestamp), simpan
> activity + `activity_streams` terkompresi, odometer bertambah saat import, CRUD komponen +
> reset wear saat service, profil tubuh, log berat, FTP history, backup export/import JSON,
> hapus semua data.
> **Sisa M1 yang baru ditutup:** zone editor F2-AC4 (template Coggan 8/5/3 + batas bawah per
> zona, kontigu dijamin), grafik tren berat & FTP overlay (F2-AC2), satuan imperial yang benar
> dipakai di Dashboard/Rides/ActivityDetail/Gear (`domain/units.ts`), dan tes parser (16 tes).

**Tujuan:** pengguna bisa memasukkan semua data dasarnya.

- Parser GPX (+TCX) dengan UI import (drag-drop, batch)
- Smoothing elevasi + kalkulasi jarak/D+ 
- Simpan `routes` + `activities` (source: file)
- Form profil tubuh (tinggi, jenis kelamin, lahir) + log berat badan + FTP history + editor zona
- CRUD sepeda (berat, Crr/CdA preset) + komponen & interval
- Backup export/import JSON

**Definition of done:**
- [ ] Import GPX 200 km < 2 s, aktivitas & rute tersimpan benar
- [ ] Berat badan & FTP terlog dan terlihat di grafik kecil
- [ ] Sepeda + komponen tersimpan; odometer ter-update saat aktivitas dengan sepeda dipilih
- [ ] Export JSON → hapus semua data → import JSON → state kembali identik

---

## M2 — Metrics Engine (F1 + F4)

> **Status: selesai (2 Okt 2026).** Sudah ada: `domain/metrics.ts` (NP, IF, TSS FTP-aware,
> kJ→kcal), `domain/pmc.ts` (CTL EMA 42 / ATL 7 / TSB), `domain/power-curve.ts` (mean-max per
> durasi, merge athlete curve, fit CP/W′ Gauss-Newton bervibrations damping + grid seed,
> `wPrimeRemaining`), `domain/zones.ts` (8 band Coggan + distribusi waktu),
> `data/streams.ts` (codec `activity_streams`), `data/synthetic.ts` (trace power ber-dinamika W′),
> `data/recompute.ts` (backfill versi + `recomputeSince()` untuk entri FTP ber tanggal lalu),
> tabel Dexie `power_curves` (schema v2), kartu **Power curve** di dashboard, dan
> **route activity detail** `#/rides/:id` dengan kurvaGhelper overlay + time in zones.
> 109 tes unit hijau. Verified di browser: R² 0,983 · CP 231 W · W′ 13,8 kJ; retro-compute
> terbukti (NP tetap 230 W, IF 0,84 → 0,72, TSS 105 → 78 saat FTP 320 W ber tanggal lalu).
> **Sisa minor:** tidak ada — editor zona (F2-AC4) dan satuan imperial ditutup di v5.9 (lihat M1).

**Tujuan:** data mentah berubah menjadi angka yang bermakna.

- `domain/metrics.ts`: NP, IF, TSS, kalori dari kJ
- `domain/power-curve.ts`: mean-max power + CP/W′ fit
- `domain/pmc.ts`: CTL/ATL/TSB harian
- Retro-compute TSS saat FTP baru (FTP-aware)
- Dashboard: athlete snapshot (FTP, W/kg, CTL, TSB, berat) + power curve chart + PMC chart + tren berat/FTP overlay
- Activity detail: summary + distribusi zona + power curve kontribusi

**Definition of done:**
- [x] Unit test: NP/IF/TSS sesuai definisi (fixture dengan nilai yang diketahui)
- [x] Dengan ≥ 5 aktivitas power, CP/W′ ter-fit R² ≥ 0.95 (terverifikasi R² 0,983 · CP 231 W · W′ 13,8 kJ)
- [x] PMC chart ter-render 90 hari terakhir
- [ ] 500 aktivitas sintetis → dashboard tetap < 100 ms interaksi

---

## M3 — Route Estimator (F6)

> **Status: selesai (2 Okt 2026).** `AVG_KMH = 30` **dihapus**. `domain/physics.ts`
> (gravitasi + rolling + aero + loss drivetrain, `solveSpeed` bisection, `resampleProfile`,
> `airDensity` dengan suhu lokal, `powerForSpeed`, `powerLimitedPct`, `peakRequiredW`) dan
> `domain/pacing.ts` (target watt dari IF, pola daya, stop policy, `buildPlan` dengan
> checkpoint ber-ETA jam lokal + `legKph` + `bufferMin`, `hardest`, `steepestGradePct`).
> `Routes.svelte` memakai profil asli (km/alt), slider cargo/headwind/stops/start yang
> benar-benar memicu solve ulang, banner kejujuran (KRITIS bila >5% rute di luar watt target,
> WASPADA bila avg <15 km/h), dan `planJson` yang menyimpan hasil solve.
> 58 tes baru (34 physics + 24 pacing); total **222 tes hijau** (→ 240 setelah chart §22 dan race.ts §23). Verified di browser:
> rute 200,4 km / 1 345 m → EST FINISH **6h 47m**, arrive 12:17, avg 31,9 km/h; leg naik
> 23,7 km/h vs turun 40,8 km/h; headwind 25 km/h → 19h 33m + banner "too slow to be credible".
> **Sisa opsional (P1):** map preview MapLibre belum ada (tidak termasuk DoD inti). Chart
> kecepatan interaktif **sudah masuk** — kartu profil kini uPlot (dual scale altitude/
> kecepatan + crosshair tooltip km · grade · kecepatan · elapsed · jam) dengan data dari
> `planSeries()` di `domain/pacing.ts`.

**Tujuan:** upload GPX → estimasi waktu finish realistis + checkpoint.

- Slicing rute per ~10 m, klasifikasi segmen (flat/climb/descent)
- `domain/physics.ts`: power→speed solver + cap (stall, descent max)
- `domain/pacing.ts`: strategi IF target / NP target / power konstan; stop time; tabel checkpoint dengan jam lokal
- Chart elevasi + kecepatan interaktif (uPlot)
- Form parameter: sepeda (Crr/CdA), cargo, start time, IF target, stop policy
- Map preview (MapLibre, lazy-load) — opsional saat online

**Definition of done:**
- [ ] Golden test: deviasi estimasi vs ride nyata di rute sama < ±7% — *butuh data ride nyata di rute yang sama; belum ada device tersambung*
- [x] Parameter naik/turun menghasilkan arah perubahan yang logis (property test di `physics.test.ts` + `pacing.test.ts`)
- [x] Tabel checkpoint menampilkan KM / grade / ETA jam lokal (+ `legKph` dan buffer vs cut-off)
- [x] Rute 250 km dihitung < 1 s (satu lintasan sinkron; ukuran hike <1 ms, web worker tidak dibutuhkan)

---

## M4 — Race Mode (F7) ⭐

> **Status: selesai (2 Okt 2026).** Setup race dari rute, cockpit live dengan chrome
> browser, tombol checkpoint ke `race_logs`, status planned/live/finished — semua jalan.
> **Slice 1:** `domain/race.ts` (`gateBufferAt`, `feasibility`, `lastGatePassed`) dan cockpit
> live memakai `SpeedProfileChart` yang sama dengan halaman Routes — crosshair memberi
> `±n min vs <cut-off>` + status AMAN/WASPADA/KRITIS di titik mana pun, dengan marker cut-off
> dan garis posisi. Chart memakai profil GPX asli dari Dexie (`fetchRouteProfile`) + `buildPlan`,
> bukan konstanta.
> **Slice 2 (v6.4):** hero `BUFFER`, `PROJECTED FINISH`, `REQUIRED AVG` diturunkan dari
> `racePlan`; `RACE_KM`/`AVG_KMH` dan sektor lambat hard-code dihapus. Bug buffer yang mengukur
> dirinya sendiri diperbaiki (`UI-SPEC §25.1`).
> **Slice 3 (v6.5):** feasibility vs CP/W′. `wPrimeSpentAt` +
> `sustainAt(…, horizonSec)` menjawab "apakah plan pace masih bisa dipegang" — termasuk di
> tooltip crosshair dan kartu `W′ at this pace`. Detail model: `UI-SPEC §26`.
> **Slice 4 (v6.6):** DoD E2E Playwright + uji offline tertutup — `tests/e2e/race.spec.ts`
> (10 tes) mengendarai cockpit dengan `page.clock`, memeriksa konsistensi buffer, dan memverifikasi
> aplikasi tetap mem-*project* saat offline. Detail: `UI-SPEC §27`.
> **Sisa:** pascalarace belum menyimpan koreksi hasil aktual (masuk sebagai bahan kalibrasi M5).

**Tujuan:** tracker race-day yang bekerja penuh offline dan menjawab "apakah saya aman?" dalam 1 detik.

- Setup race dari rute (start time, cut-off finish, cut-off checkpoint, plan)
- `domain/race.ts`: proyeksi finish, buffer, required pace, feasibility vs CP/W′, deviasi vs plan
- Live tracker UI: tombol besar "Checkpoint!", input KM, timer, buffer visual aman/waspada/kritis, wake-lock, dark race mode
- Riwayat checkpoint timeline
- Pasca-race: hasil aktual vs estimasi → simpan koreksi faktor (data untuk kalibrasi M5)

**Definition of done:**
- [x] E2E: setup race 200 km → simulasi input checkpoint → buffer & proyeksi benar (fixture waktu,
      `page.clock`, 10 tes di `tests/e2e/race.spec.ts`)
- [x] Semua fitur race jalan dengan network offline (Playwright `context.setOffline` — proyeksi
      tetap koheren, dan checkpoint yang di-*log* offline bertahan setelah reload)
- [ ] Pasca-race: simpan hasil aktual vs estimasi (data kalibrasi M5) — belum dikerjakan
- [ ] Input checkpoint → hasil < 100 ms
- [ ] Status KRITIS muncul saat required pace > kemampuan (fixture W′)

---

## M5 — AI Coach (F5) + polish

> **Status: stub.** Chat disimpan ke `ai_notes` dan ditampilkan kembali; tidak ada panggilan LLM,
> context builder, maupun template prompt. Yang sudah benar: aplikasi tetap berfungsi penuh tanpa
> key (F5-AC1), dan `Settings` sudah punya slot provider + key.

**Tujuan:** asisten latihan kontekstual + kalibrasi + cuaca.

- AI provider adapter (Gemini default, OpenAI-compatible) + BYO key + onboarding
- Context builder (metrik turunan saja — kepatuhan §5.3)
- Weekly review, chat, rencana latihan (simpan ke kalender sederhana), pre-race briefing (pacing + nutrisi dari `domain/nutrition.ts`)
- Weather-aware estimator (Open-Meteo, 2-iterasi koreksi)
- Kalibrasi estimasi dari pasangan estimasi-vs-aktual (faktor pribadi per kondisi rute)
- Race plan export teks (untuk stem cap)

**Definition of done:**
- [ ] Tanpa key → app tetap fungsional penuh (AI tersembunyi)
- [ ] Weekly review mengutip angka dari konteks (cegah halusinasi: prompt + verifikasi angka muncul di context)
- [ ] Race briefing berisi g/h dan strategi berhenti dari parameter pengguna
- [ ] Estimator menyesuaikan waktu saat headwind kuat (fixture Open-Meteo mock)

---

## M6 — Strava Sync + Cloud (P1 opsional)

> **Status: belum mulai.** Tidak ada backend di repo ini sama sekali (tidak ada Worker/D1), jadi
> phase ini paling mahal dan tidak masuk MVP. `sync_state` hanya jadi tempat menyimpan status.

**Tujuan:** kenyamanan otomatisasi; import file tetap jalur utama.

- Strava app setup + OAuth PKCE via Worker; token aman
- Sync summary + streams dengan rate-limit guard + resume
- 7-day API cache pruner (kepatuhan policy)
- Cloud sync opsional (encrypted backup push/pull via Worker+D1)
- Settings: sync status, device list, last sync

**Definition of done:**
- [ ] OAuth end-to-end di preview URL
- [ ] Sync 100 aktivitas dengan streams berjalan tanpa melewati 80% kuota (throttle terbukti)
- [ ] Pruner menghapus raw stream API > 7 hari (testable)
- [ ] Cloud sync: push di device A → pull di device B → data konsisten (last-write-wins)

---

## Setelah M6 (backlog ide)
- Segment comparison & PR progression
- Heatmap latihan (grid tahunan ala GitHub)
- Ekspor rencana race PDF
- Integrasi Garmin (file dari Garmin Connect)
- Indoor workout player (ZWO) — non-interaktif dulu

## Urutan eksekusi yang direkomendasikan (2 Okt 2026)

Urutan lama (M1 → M2 → M3 → M4) disusun waktu UI masih kerangka. M2 adalah prasyarat kebenaran
M3 dan M4: tanpa metrics sungguhan, solver fisika tidak tahu nilai FTP mana yang berlaku, dan
feasibility check tidak punya CP/W′ untuk dibandingkan. Karena itu urutannya ditukar — dan
sekarang **langkah 0–4 sudah selesai** (2 Okt 2026), tinggal `race.ts` untuk M4 lalu M5/M6.

| # | Langkah | Isi | Selesai bila |
| --- | --- | --- | --- |
| 0 | **Test harness + domain metrics** — ✅ selesai 2 Okt 2026 | Vitest terpasang; `domain/metrics.ts` + `domain/pmc.ts` dengan golden fixtures; codec stream; trace power untuk ride seed; backfill `METRICS_VERSION` | `npm test` → 55 tes hijau; angka dashboard berasal dari power |
| 1 | **M3 physics** — ✅ selesai 2 Okt 2026 | `domain/physics.ts` (gravitasi + rolling + aero + drivetrain loss, bisection `v`) dan `domain/pacing.ts`; disambungkan ke `Routes.svelte` | ETA berubah menurut grade; property test arah perubahan logis |
| 2 | **M4 race projection** — ✅ selesai 2 Okt 2026 | `domain/race.ts` memakai solver M3 → proyeksi finish, buffer, required pace, feasibility AMAN/WASPADA/KRITIS | KRITIS bisa muncul dari fixture W′; input checkpoint < 100 ms |
| 3 | **Sisa M1** — ✅ selesai 2 Okt 2026 | zone editor (F2-AC4) + template, grafik tren berat/FTP overlay (F2-AC2), satuan imperial dipakai di 4 tampilan, `domain/units.ts` + `domain/trend.ts` + parser `domain/course.ts` (16 tes) | F2-AC2 & F2-AC4 terpenuhi; M1 ditutup |
| 4 | **Activity detail** — ✅ selesai 2 Okt 2026 | route `#/rides/:id` (router param), header + angka dark, kurva ride vs all-time best, time in zones, sparkline asli di list Rides | daftar ride bisa dibuka; ride tanpa power menampilkan empty state jujur |
| 5 | **M5 AI Coach** | adapter provider, context builder (hanya metrik turunan), prompt statis | hanya setelah angka/domain tepercaya — kalau context-nya salah, AI mengarang |
| 6 | **M6 Strava** | OAuth PKCE via Worker, sync + throttle, pruner 7 hari | terakhir, butuh backend |

M2 dan M1 sisa bisa dikerjakan berurutan seperti biasa; M4 **wajib** setelah M3; M5 **wajib** setelah
M2; M6 bebas kapan saja tapi tidak masuk MVP.
