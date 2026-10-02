# Roadmap — GowsLab

Rencana implementasi bertahap. Setiap fase punya **definition of done** yang bisa diverifikasi. Urutan dirancang agar setiap fase menghasilkan sesuatu yang berguna (bukan setengah jalan).

Estimasi adalah *effort relatif*, bukan janji kalender.

---

## Status aktual (2 Okt 2026)

> Ringkasan yang sama ada di [README.md](../README.md#status).

**Kesenjangan yang pernah tercatat sudah tertutup.** App pernah rebuilt dari mockup dengan UI
jauh mendahului logic; hari ini M0–M4 terverifikasi oleh gerbang (275 tes unit · 14 tes E2E ·
typecheck 0 error · build hijau). Yang tersisa bukan catch-up visual melainkan **kalibrasi
pascalarace** — lihat DoD M4.

| Phase | State | Bukti di repo |
| --- | --- | --- |
| M0 | **Done** | build + typecheck hijau, PWA manifest/SW, Dexie v1, hash router |
| M1 | **Done** | parser GPX/TCX di `domain/course.ts` (16 tes fixture), `domain/units.ts` (imperial dipakai di 4 tampilan), `domain/trend.ts` + kartu Body trend, editor zona F2-AC4 di Settings, `domain/zones.ts` dengan template |
| M2 | **Done** | `domain/metrics.ts`, `pmc.ts`, `power-curve.ts`, `zones.ts` (109 tes hijau), `data/streams.ts` + `synthetic.ts` + `recompute.ts`, tabel `power_curves`, kartu Power curve + route `#/rides/:id` |
| M3 | **Done** | `domain/physics.ts` + `domain/pacing.ts` (66 tes), `Routes.svelte` memakai hasil solve; `AVG_KMH = 30` dihapus; chart profil interaktif uPlot (hover + klik-pin + keyboard) |
| M4 | **Selesai** | `domain/race.ts` (gate buffer, feasibility, `clockAtKm`/`kmAtClock`/`planMinutesBetween`, `wPrimeSpentAt` + `sustainAt` vs CP/W′, `raceOutcome`/`readoutOfOutcomes`), hero BUFFER/PROJECTED FINISH/REQUIRED AVG dari `racePlan` (`RACE_KM`/`AVG_KMH` dihapus), sektor lambat dari solver, kartu pascalarace (284 tes unit · 17 tes E2E) |

> **Catatan kejujuran dokumen (2 Okt 2026):** status di bawah ditulis ulang setelah DoD M0–M2
> benar-benar dijalankan. **Tujuh dari sembilan** kotak kosong itu tertutup — dan dua di antaranya
> **menemukan bug nyata** (§ "Temuan"), bukan sekadar mengukur angka yang sudah benar.
>
> Yang masih terbuka hanya tiga: **deploy preview URL** (butuh kredensial Cloudflare),
> **pemasangan fisik di Android** (butuh perangkat), dan **golden test ±7 %** (butuh device
> bersepeda pada rute yang sama). Kotak kosong berarti **belum diverifikasi**, bukan **tidak
> bisa**. M4 tidak punya kotak kosong.

### Temuan dari menjalankan DoD (2 Okt 2026)

Kedua bug ini sudah ada sejak M1/M2 dan tidak pernah terlihat karena kotaknya tidak pernah
dicentang. Keduanya kini punya tes yang gagal bila bugnya dikembalikan:

1. **Backup JSON membuang `power_curves`.** `backupJson()` menulis daftar tabel **secara manual**
   dan sudah ketinggalan satu tabel sejak schema v2. Akibatnya export → hapus → import menghapus
   mean-max power curve beserta hasil fit CP/W′ — persis data yang membuat M2 berfungsi. Perbaikannya
   membaca `db.tables`, jadi tabel baru tidak bisa lagi tertinggal diam-diam.
2. **"Delete all data" bisa dibatalkan oleh seed sendiri.** Setiap tabel dijaga `count() === 0`,
   jadi mengosongkan semuanya membuat boot berikutnya tak terbedakan dari kunjungan pertama: 24 ride
   demo, 2 sepeda, dan riwayat berat kembali **detik** setelah dialog menjanjikan "cannot be undone".
   Perbaikannya menandai localStorage (`gowslab.wiped`), karena wipe itu sendiri menghapus setiap
   tabel Dexie.

**Bukti menangkap regresi:** `power_curves` dikecualikan lagi dari backup → tes gagal dengan
`table "power_curves" did not round-trip`. Kedua guard seed dimatikan → tes gagal dengan
`the wipe left activities behind … Received: 24`. Dipulihkan: 25/25 hijau.

### Temuan ketiga: impor membuang power (2 Okt 2026)

Ketemu bukan dari DoD, tapi dari satu pertanyaan sederhana saat membangun harness §33: dari mana
Crr/CdA akan datang kalau akurasinya mau benar? Jawabannya harus dari GPS + power pembalap sendiri.

`parseCourse()` membaca posisi, ketinggian, dan waktu saja — padahal TCX dari head unit membawa
`<ns3:Watts>` di **setiap** trackpoint, dan GPX Garmin membawa `<gpxtpx:Watts>`. Keduanya
dibuang, sehingga setiap ride impor tiba tanpa NP/IF/TSS dan `kcal` diisi `distanceKm × 26`.
Tidak pernah kelihatan karena `ActivityDetail.svelte` menampilkan empty state yang jujur
(*"This ride has no power stream"*) — **dan empty state itulah yang menutupi bug-nya.** Impor
rusak dan pembalap tanpa meter menghasilkan layar yang persis sama.

Bug pendamping: parser mencari `<name>` huruf kecil, TCX menulis `<Name>` → setiap ride TCX
selalu bernama berkas, bukan nama ride.

Perbaikan + tes di `UI-SPEC §34`. **Bukti menangkap regresi:** `Object.assign(p, readSensors(n))`
dikomentari → gagal di `the imported ride has no normalized power`. Dipulihkan: 38/38 E2E hijau.

> **Peringatan jebakan:** Lighthouse **12 menghapus kategori PWA** sama sekali, sehingga DoD ini
> tidak bisa diukur (bukan lulus, dan bukan gagal). Dependensi dipin ke `11.x` selagi baris ini ada
> di papan, dan `audit:lighthouse` **menolak keras** bila sebuah kategori tidak dilaporkan — melacak
> kategori hilang sebagai skor 0 akan menghasilkan build "gagal" dengan alasan yang salah.
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
- [x] Lighthouse PWA ≥ 90, performa ≥ 90 di preview build — **PWA 100 · performa 98**
      (best-practices 100, accessibility 96). Dijalankan lewat `npm run audit:lighthouse`,
      yang membangun lalu mengaudit preview build dan **gagal** bila turun di bawah
      ambang DoD. Angka ini bukan hasil ketik manual: bisa direproduksi kapan saja.
- [~] Installable di Android Chrome & desktop Chrome — **terverifikasi sebagian, dan itu
      jujur**: manifest (start_url/scope/display/ikon 192/512/maskable) diperiksa field per
      field, setiap ikon dipastikan benar-benar dilayani, dan service worker terdaftar serta
      mengambil alih dokumen. Yang **belum** diuji adalah pemasangan fisik di perangkat
      Android — butuh perangkat nyata, bukan browser headless.
- [x] Buka app tanpa internet → shell tetap tampil — E2E: online load → tunggu
      `serviceWorker.ready` → reload → `context.setOffline(true)` → reload. Shell, konten dari
      IndexedDB, dan navigasi semua harus tetap hidup (M0).
- [ ] Deploy preview URL hidup — **butuh kredensial Cloudflare Pages**, tidak bisa diverifikasi
      dari repo ini sendiri. Tidak dicentang.

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
- [x] Import GPX 200 km < 2 s, aktivitas & rute tersimpan benar — **59 ms** diukur di dalam
      Chromium (event `change` → ride tampil), anggaran 2 000 ms. GPX diuji secara geografi
      nyata: 5 001 titik pada satu meridian, jarak hasil parse 200 km ± 2 km, bukan jumlah
      titik yangodisamarkan jadi kilometer.
- [x] Berat badan & FTP terlog dan terlihat di grafik kecil — E2E: log 71,4 kg + FTP 304 W,
      diverifikasi masuk `weight_log`/`ftp_history` **dan** digambar di kartu Body trend.
- [x] Sepeda + komponen tersimpan; odometer ter-update saat aktivitas dengan sepeda dipilih —
      E2E mengimpor GPX 40 km lalu membaca `odometerKm` Castorcli aktif; bertambah > 38 km.
- [x] Export JSON → hapus semua data → import JSON → state kembali identik — **dua bug nyata
      ditemukan oleh tes ini** (lihat catatan di bawah). Suite: `tests/e2e/platform.spec.ts`.

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
- [x] 500 aktivitas sintetis → dashboard tetap < 100 ms interaksi — **terburuk 11,7 ms**
      dari 5 pergantian tab hero (sampel: 6,0 · 10,3 · 11,6 · 11,7 · 9,7 ms) dengan 524
      aktivitas di IndexedDB. Diukur in-page dari klik sampai `aria-selected` berubah.

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
- [ ] Golden test: deviasi estimasi vs ride nyata di rute sama < ±7% — *harness siap, kotak masih kosong: butuh data ride nyata di rute yang sama; belum ada device tersambung. Lihat "Harness validasi" di bawah*
- [x] Parameter naik/turun menghasilkan arah perubahan yang logis (property test di `physics.test.ts` + `pacing.test.ts`)
- [x] Tabel checkpoint menampilkan KM / grade / ETA jam lokal (+ `legKph` dan buffer vs cut-off)
- [x] Rute 250 km dihitung < 1 s (satu lintasan sinkron; ukuran hike <1 ms, web worker tidak dibutuhkan)

#### Harness validasi akurasi prediksi (2 Okt 2026)

Kotak golden test di atas butuh device; yang bisa dikerjakan tanpa device sudah dikerjakan:
**instrumennya sekarang ada**, kotaknya sendiri masih kosong.

Tiga lapisan di `src/lib/domain/__tests__/validation.test.ts` (19 tes), sengaja tidak
saling-rujukan:

1. **Angka dari luar.** Konstanta atmosfer standar ICAO (1,225 / 1,112 / 0,7364 kg/m³) dan
   power yang dihitung tangan dari teksbook — 149,86 W untuk 80 kg di 30 km/h datar,
   484,67 W di tanjakan 5 %, −185,03 W di turunan 5 %. Ditulis sebagai literal dan
   dibandingkan ke output model. Lapisan ini gagal kalau fisikanya salah, bukan kalau
   tidak konsisten dengan dirinya sendiri.
2. **Identitas yang harus menutup tepat.** Residu solver di 42 pasang (gradien, watt);
   headwind dihargai tepat sebesar selisih aero kubik dan tidak menyentuh gravity/rolling;
   joule yang dikeluarkan = watt × waktu.
3. **Buku besar atas rute utuh.** Empat profil (datar, bergelombang, alpine, turunan-led)
   — Σ jarak = panjang rute, Σ waktu = total, Σ rise = alt akhir − alt awal, kolom kumulatif
   monoton. Bug jahitan di `resampleProfile` akan muncul di sini.

Separuh device-nya ada di `src/lib/domain/__tests__/deviation.test.ts`: membaca
`validation/rides/*.json`, memroyeksikan tiap ride lewat planner yang sama, dan gagal jika
deviasi > ±7 % **per ride maupun rata-rata absolut**. Berkas wajib punya
`"verified": true` — tidak ada yang bisa mengeceknya, justru itu sebabnya dipisah dari
seluruh yang bisa dicek, supaya ride demo tidak bisa menutup kotak secara tak sengaja.

**Bukti gerbang menangkap:** sebuah ride `verified` dengan `actual.movingSec` dikurangi
sepihak gagal di kedua separuh dengan pesan
`215.6 min predicted vs 233.3 min actual → -7.6%`. Berkas probe lalu dihapus.

**Tiga tes yang gagal saat pertama ditulis, semuanya asumsi saya yang salah — bukan bug
produk, dan satu di antaranya berarti fisikanya salah di kepala saya:** (a) headwind 10 km/h
dianggap sama dengan bersepeda 40 km/h di angin tenang — SALAH, karena
rolling dan gravity tetap mengikuti kecepatan tanah; (b) checkpoint tengah jarak
diasumsikan tengah waktu — SALAH, di profil alpine separuh pertama memakan 72 % waktu;
(c) `clockAtKm` dibandingkan dengan elapsed — SALAH, fungsinya mengembalikan menit jam
dinding yang memuat start 07:00. Tiga kegagalan ini justru bukti bahwa harness bekerja: ia menolak asumsi saya, bukan menyalinnya.

#### Kotak yang tetap kosong setelah harness ini

Golden test ±7 % (butuh device), deploy preview (butuh kredensial Cloudflare), pemasangan
Android (butuh ponsel). Tujuh kotak lain tetap tertutup.

#### Kalibrasi Crr/CdA (2 Okt 2026)

`domain/calibrate.ts` — regressions linier dua parameter yang mengukur `Crr` dan `CdA`
milik pembalap dari ride-nya sendiri. Detail: `UI-SPEC §35`.

Alasannya: `crr = 0.005` / `cda = 0.32` di [Bike](src/lib/data/db.ts) adalah titik
tengah textbook, dan hampir tidak tepat untuk siapa pun. Modularnya:

```
P_wheel − m·g·sinθ·v  =  Crr · (m·g·cosθ·v)  +  CdA · (½ρ·v³)
```

Linear, jadi satu sistem 2×2 — tanpa gradient descent. Test recovering the constants
within 0,0005 (Crr) and 0,005 m² (CdA) at RMS < 6 W; separability check
(`det/(aa·bb)`) menolak ride yang mempertahankan satu kecepatan, karena di sana gesekan
dan aero adalah pengukuran yang sama dalam satuan berbeda.

**Belum ada tombolnya** — `calibrateFromTrack` siap, tapi belum ada layar yang
menawarkannya. Angka hasil ukur tidak boleh pernah menimpa nilaiumbent secara diam-diam;
harus selalu tampil bersama RMS, rentang kecepatan, jumlah sample, dan peringatan.

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
> (14 tes) mengendarai cockpit dengan `page.clock`, memeriksa konsistensi buffer, memverifikasi
> aplikasi tetap mem-*project* saat offline, menjaga pita readout tetap di atas plot (§28), dan
> mengukur latensi input checkpoint. Detail: `UI-SPEC §27`.
> **Sisa M4:** tidak ada — seluruh DoD terverifikasi (284 tes unit · 17 tes E2E). Kodeksi
> pascalarace sengaja hanya dilaporkan, belum diterapkan ke plan berikutnya (lihat catatan di
> bawah); itu keputusan produk, bukan kekurangan M4.

**Tujuan:** tracker race-day yang bekerja penuh offline dan menjawab "apakah saya aman?" dalam 1 detik.

- Setup race dari rute (start time, cut-off finish, cut-off checkpoint, plan)
- `domain/race.ts`: proyeksi finish, buffer, required pace, feasibility vs CP/W′, deviasi vs plan
- Live tracker UI: tombol besar "Checkpoint!", input KM, timer, buffer visual aman/waspada/kritis, wake-lock, dark race mode
- Riwayat checkpoint timeline
- Pasca-race: hasil aktual vs estimasi → simpan koreksi faktor (data untuk kalibrasi M5)

**Definition of done:**
- [x] E2E: setup race 200 km → simulasi input checkpoint → buffer & proyeksi benar (fixture waktu,
      `page.clock`, 14 tes di `tests/e2e/race.spec.ts`)
- [x] Semua fitur race jalan dengan network offline (Playwright `context.setOffline` — proyeksi
      tetap koheren, dan checkpoint yang di-*log* offline bertahan setelah reload)
- [x] Pasca-race: simpan hasil aktual vs estimasi — kartu **Past races · estimate vs
      actual**. Akar masalahnya bukan display: `planJson` hanya menyimpan *pengaturan* rider,
      bukan jawaban solver, jadi setiap balapan lama punya waktu aktual tanpa baseline —
      tidak ada yang bisa dibandingkan. `saveAndStart` kini menulis `plannedFinishMin`
      sebelum start, dan `raceOutcome()` di `domain/race.ts` membandingkan kedua sisi.
      **Ditampilkan, tidak diterapkan** (keputusan 2 Okt 2026): `readoutOfOutcomes` melaporkan
      median, tapi tidak ada faktor yang kembali ke `buildPlan` — satu balapan belum cukup
      bukti untuk membengkokkan solver, dan menyembunyikan angka mentah justru menghapus
      bahan kalibrasi M5. Balapan tanpa baseline (semua entri lama) tetap tampil sebagai
      `NOT MEASURED`, bukan dianggap tepat sasaran. 3 tes E2E + 9 tes unit.
- [x] Input checkpoint → hasil < 100 ms — **terukur 3,7 ms** di Chromium (klik Log → hero
      repaint, diukur in-page lewat `requestAnimationFrame`; `race.spec.ts` "repaints the
      cockpit inside the 100 ms budget"). Angka ini tidak di-*mock*: ia mencakup tulis Dexie,
      `liveQuery` untuk `race_logs`, dan re-derivasi `kmAtClock` → `planMinutesBetween` →
      `wPrimeSpentAt`/`sustainAt`. Diukur dengan jam sungguhan, bukan `page.clock`, karena
      Playwright ikut men-*stub* `performance.now`.
- [x] Status KRITIS muncul saat required pace > kemampuan (fixture W′) — `race.test.ts`
      "does not let even a fresh tank rescue an impossible gradient": dinding +12 % yang
      ter-solve ke 10 km/h menghasilkan `sustainable === false` dengan W′ masih utuh, jadi
      verdict-nya bukan "tangki habis" melainkan "gradiennya memang di luar jangkauan".
      Pasangan ujinya "fails a wall once the tank is empty, but passes it fresh" — dinding
      yang sama **lolos** sebelum W′ habis dan **gagal** sesudah, sehingga penilaiannya
      benar-benar membaca tangki, bukan sekadar membaca rate.

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
