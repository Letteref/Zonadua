# UI Spec — Zonadua

> **Catatan nama (3 Okt 2026):** aplikasi sebelumnya bernama **GowsLab** dan kini **Zonadua**.
> Dua hal sengaja tidak ditulis ulang menjadi nama baru, karena keduanya mencatat fakta
> historis, bukan keputusan yang masih berlaku:
> - Nama artefak Google Stitch yang sudah dihapus dari repo (`gowslab_dashboard`,
>   `gowslab_rides_split_cockpit_variant`, dst.) dan folder `references/stitch_gowslab_*`.
> - Kunci penyimpanan lama (`gowslab.seeded`, `gowslab.wiped`) yang kini dibaca sebagai
>   *fallback* oleh `zonadua.seeded` / `zonadua.wiped`, plus tag backup `app: "gowslab"` yang
>   masih diterima importer.
>
> Nama database IndexedDB berubah `gowslab` → `zonadua` **tanpa migrasi**: data lama tidak
> ikut terbawa.

> **⚠️ v5.1 — "Crimson Clean" (1 Okt 2026, keputusan user):** aksen diganti dari oranye ke **merah terang sporty `#E8102E`** dan kanvas dari krem ke **netral bersih `#F9F9F9`**. Artefak Google Stitch tetap terhapus dari repo — UI original 100%, siap dipoles Stitch bila diminta. Kartu putih, tile netral `#F1F2F4`, **monolith gelap `#141519`** untuk kartu angka/chart, teks tinta `#17181C`, **nav pil mengambang putih** dengan tombol **+** merah di tengah.

## Gaya v5.1 — ringkas
- **Kanvas:** netral bersih `#F9F9F9`; kartu `#FFFFFF` radius 24px shadow sangat lembut; tile `#F1F2F4`.
- **Monolith:** kartu `#141519→#1B1C22` untuk angka besar & chart (readiness, projected time, buffer) — satu momen gelap per layar.
- **Aksen:** merah terang `#E8102E` untuk grafis/fill/angka besar; **`#D50F26` (`crimson-fill`)** untuk tombol berteks putih; **`#A80C21` (`crimson-deep`)** untuk teks aksen kecil di latar terang.
- **Nav:** pil **monolith gelap** mengambang (ember-lit `bg-mono-gradient`, border `#2B2D33`, `glow-mono`) — **5 tab berlabel** (Today, Rides, Routes, Race, Coach); item aktif `rose` `#FF4D5E`, nonaktif `on-mono-dim`. **Gear di luar nav** (keputusan 1 Okt: frekuensi mingguan — bukan tab): dijangkau via ikon sepeda di header Today + kartu wear di Dashboard ("Manage gear →").
- **Gear page (#/gear):** summary trio (jumlah sepeda, total odometer, due soon) · primary bike = hero monolith ember-lit dengan odometer besar · sepeda lain = kartu putih chip Standby · komponen dengan wear bar `HatchTrack` + `StatusChip`, sort terburuk dulu — model wear: WASPADA ≥90%, KRITIS ≥100%.
- **Gear actions (persist ke Dexie):** tambah/edit komponen via bottom-sheet form (nama, kind chip, installed-at, interval) · **service** ⟳ mereset wear ke odometer sepeda saat ini · hapus dengan konfirmasi 2-langkah (klik → baris konfirmasi merah → klik lagi) · **Set as active bike** dengan transaksi Dexie (tepat satu sepeda aktif). Semua reaktif via liveQuery — hero, wear, dan summary ikut berubah otomatis.
- **Status:** AMAN `#0A7450`, WASPADA `#B8620A`, KRITIS `#C8102E`, signal `#A80C21` (teks) / `#E8102E` (grafis) — chip tinted di kartu putih, versi soft di monolith.
- **Header:** greeting bar (avatar ink `bg-mono` + bell putih) atau kicker + headline uppercase + aksen italic `crimson-deep`.

### Poles visual v5.1.1 — ember & glow (1 Okt 2026)
- **Monolith ember-lit:** `bg-mono-gradient` kini dua lapis — radial merah `rgba(232,16,46,.4)` naik dari sudut kanan-bawah (pudar di 68%) di atas grafite `#17181D→#1A1218`. Enerjik tanpa gaduh: satu sumber cahaya per kartu.
- **Red fills tercahaya:** `bg-crimson-gradient` diberi highlight putih 16% di kiri-atas (flare tile, tombol +) agar tidak datar; kontras teks putih tetap ≥4.6:1.
- **Skala glow baru:** `glow-mono` (kartu hero: bayangan gelap + ambient merah 2 lapis) · `glow-signal/crimson/peak` (2 lapis merah rapat) · `glow-soft` (tile kecil) · ring readiness pakai `drop-shadow` merah.
- **Aturan:** satu momen gradien per kartu, glow hanya pada elemen aktif/sinyal — bukan dekorasi statis.

### Audit aksesibilitas v5.1 (1 Okt 2026)
Setiap halaman diaudit terukur (WCAG kontras via computed styles):
- Teks kecil di putih/netral ≥ 4.5:1 — `ink-dim` `#62656C` (5.3–5.6:1), `aman` `#0A7450`, teks merah kecil memakai `crimson-deep` (7.6:1).
- Tombol putih-di-merah memakai `bg-crimson-fill` `#D50F26` (5.3:1); gradien signature `#D50F26→#A80C21` agar teks putih tetap AA.
- **Radius terkunci:** kartu seksi 24 (`rounded-card`) · tile/baris/input dalam 16 (`rounded-2xl`) · kontrol kompak ≤ 40px 12 (`rounded-xl`) · badge mikro 8 (`rounded-lg`) · pill penuh.
- **Shadow terkunci:** hanya `elevation-card` / `elevation-raised` / `glow-*` (tanpa `shadow-lg/2xl` bawaan Tailwind).
- **Container seragam:** `mx-auto max-w-md px-5 pt-8` + `gap-5` di kelima halaman.

---

# Arsip v3 — Crimson Light

> **v3 (30 Sep 2026):** tema light (canvas `#F4F5F7`, kartu putih, aksen crimson `#D7143A`), dark monolith hero, nav iOS putih. Digantikan v4; arsip di bawah — token lama tidak berlaku lagi.

## Gaya v3 (arsip) — ringkas
- **Header:** NRC greeting bar (avatar monolith + "Welcome back, {nama}!" + bell) atau kicker+headline solid 30px + sub-line dengan aksen italic — konsisten semua halaman.
- **Monolith hero:** satu kartu gelap per layar (Dashboard = readiness ring + stats; Rides = week summary; Routes = projected deck; Race live = buffer card; Coach tanpa hero).
- **Highlight tile:** `variant="flare"` — kartu mono dengan angka crimson + glow lembut.
- **Nav:** iOS tab bar putih dengan hairline atas, item aktif crimson.
- **CTA:** solid crimson + `glow-crimson`; gradien `bg-crimson-gradient` hanya untuk fill progress/puncak chart.
- **Status:** AMAN hijau `#0F9D6A`, WASPADA amber `#B8620A`, KRITIS crimson — versi terang di kartu putih, versi soft di kartu mono (`onDark`).
- **Race Live tetap dark monolith** (kokpit), kini menyatu dengan bahasa v3.

---

# Arsip v2 — Veloce Nocturne

**Dokumen arsip v2.** Referensi eksternal hasil Google Stitch yang dulu dipakai sudah dihapus dari repo (1 Okt 2026) — semua pola layar kini didefinisikan langsung di dokumen ini dan token `src/app.css`.

> Hierarki pertanyaan saat implementasi UI:
> 1. **PRD.md** — fitur, data, acceptance criteria (sumber kebenaran tertinggi)
> 2. **DESIGN.md (Veloce Nocturne)** — token: warna, tipografi, spacing, elevation
> 3. **Dokumen ini** — hierarki zona per layar, pola komponen, strategi copy
> 4. **Hasil Stitch** — inspirasi komposisi & pemakaian warna (filtered oleh §2)

---

## 1. Fondasi (terkunci dari DESIGN.md)

> **RESTYLE v2 — Refined Nocturne (30 Sep 2026, disepakati user):**
> 1. **Header seragam** — `EditorialHeader` satu pola di semua halaman: kicker dot + headline uppercase solid 30px/34px + **aksen italic pindah ke sub-line** (bukan di headline, tanpa gradien).
> 2. **Aurora Edge** menggantikan gradient-flood sebagai perlakuan kartu highlight: kartu near-black, border gradien 1.5px (`aurora-edge` / `aurora-edge-solid`), glow lembut `0 0 24px -6px rgba(255,77,0,.35)`, angka hero memakai `text-aurora`. Satu kartu aurora per layar.
> 3. **Gradien dipatok satu momen/layar** — CTA memakai solid `#FF4D00` (`bg-signal`), bukan gradien; gradien hanya di border kartu aurora & teks angka hero.
> 4. **Badge diet** — chip hanya dari state nyata; badge dekoratif ("LIVE PROFILE", "RACE SIMULATION", "MODEL v4.8", dsb.) dihapus; `animate-pulse` hanya untuk dot kicker header.
> 5. **Konsistensi container** — `mx-auto max-w-md px-5 pt-8 pb-10 gap-5/7`, radius terkunci (kartu 24px, kontrol 12–16px), tracking kicker 0.12em.
> Komponen baru: `AuroraCard.svelte`; `StatTile` variant `gradient` → `aurora`.

- **Palet:** canvas `#0A0A0B` · card `#141416` · raised `#1F1F23` · border `#2A2A2E` / `#333338` (interaktif) · teks `#F5F5F7` / `#8E8E93` · aksi `#FF4D00` · gradien signature `135deg #FF4D00 → #FF0000 → #FF9F2E` (1 momen/layar, teks `#0A0A0B`) · status **AMAN `#FF9F2E` / WASPADA `#FF4D00` / KRITIS `#FF0000`**.
- **Skala teks (pakai skala ini, bukan ukuran mentah Stitch):** display 40/800/-0.03em (32 mobile) · metric-hero 56/800/-0.04em (44 mobile) · metric-lg 32/700 · metric-md 20/700 · body 16/14 · kicker 11/700/0.12em uppercase · label 12/600.
- **Bentuk:** kartu 24px, kontrol 12–16px, pill/lingkaran 9999px. Bottom clearance 88px di bawah nav kapsul.
- **Chart (uPlot):** stroke 2px `#FF4D00` + area fade `rgba(255,77,0,0.25)→0`, garis pembanding dotted hairline, axis label kecil abu — angka detail per layar mengikuti blueprint §4.
- **Icons:** Hugeicons, stroke 1.5px (lihat §36 untuk poundsnya).

## 2. Aturan Adopsi Hasil Stitch

**ADOPT (pola yang terbukti bagus — implementasikan):**
1. Bento cluster tile dengan **tepat 1 tile gradien per layar** di titik data paling penting.
2. Editorial header: kicker abu + headline 2 baris dengan 1 kata *italic* beraksen.
3. Pasangan pill **filled vs outline** untuk komparasi angka (est finish vs arrive; NP vs avg).
4. Hatch progress track 45° untuk wear/buffer/progress komponen.
5. Race checkpoint: **bottom sheet keypad numerik** raksasa + tombol log tinggi + Cancel ghost.
6. Tabel checkpoint dengan **baris bernama** (nama sektor + grade) dan baris CP dengan lock + cut-off.
7. Bike selector **selected (border #FF4D00) vs standby** + stepper cargo/stop inline.
8. Race setup: "3 slowest sectors" dengan target watt per sektor.
9. Body profile: chip delta ("−0.4 kg vs last week") dan chip kategori (W/kg · cat).
10. Komponen sepeda: wear bar + **chip status AMAN/WASPADA/KRITIS** per komponen.
11. Settings: theme picker dengan ring aksen + **banner "all computation on-device"**.
12. AI coach: insight bullets **mengutip angka** sebagai teks aksen di dalam kalimat + pill metrik inline di bubble chat.

**KOREKSI (deviasi Stitch dari rancangan — jangan ditiru):**
1. ❌ Chip pseudo-aviation tanpa makna data: "PROJECTED FLIGHT TIME", "MODEL V4.8 OPTIMIZED", "VERTICAL EXPEDITION ARCHITECTURE", "SANCTIONED", "TEL-ID #8824", "COCKPIT", "VI 1.17". → Ganti dengan **state data nyata** (lihat §3) atau hilangkan.
2. ❌ Istilah domain salah: "flight", "altitude architecture", "watts benchmark 260 W" (hardcode) → benchmark/skala chart **selalu dari data** (`ftp_history`, `power_curve`), tidak pernah angka statis di mockup.
3. ❌ Teks yang tidak sesuai fitur kita (contoh "Criterium racers", "PLM calibration tag") → ikuti copy inventory §3.
4. ❌ Ukuran/densitas mentah Stitch (kicker 9px, tile terlalu padat, kartu bertumpuk >6 zona tanpa collapse) → gunakan skala §1 + aturan progressive disclosure §5.
5. ❌ Double timer di Race Cockpit (header "02:44:18" + hero "09:02:14") → **satu timer saja** (elapsed race di hero); header cukup kicker + status chip.
6. ❌ Kepadatan chart axis Stitch (grid terlalu ramai) → default max 4–5 tick per axis (uPlot default), tanpa vertical gridlines.
7. ❌ Foto texture hero (carbon/aspal) → opsional & jangan sampai menurunkan kontras teks; prioritas: tanpa foto (bundle kecil, offline-first).

## 3. Strategi Copy (Editorial, Bukan Kosmetik)

- **Kicker = konteks data nyata**, bukan dekorasi: "TRAINING · WEEK 38" (minggu berjalan), "RIDE · SEP 28 · STAGE LOG" (tanggal + sumber), "RACE MODE · KM 118". Jika tidak ada data → kicker generik ("TRAINING", "GARAGE", "APP").
- **Headline = afirmasi pendek** dengan 1 kata *italic*: "READY TO / *ride* ?", "Every watt / *counts*.", "Your / *machine*.", "Set your / *battle*.", "Your data, / *coached*.", "Settings & / *data*."
- **Badge/chip hanya dari state nyata:** "STRAVA SYNCED" / "GPX" (source), "LIVE SYNC ACTIVE" (sync status), "AMAN/WASPADA/KRITIS" (threshold), "PEAK" (nilai tertinggi periode), "TODAY", "ACTIVE BIKE", "SELECTED/STANDBY", "VERIFIED" (AI key test sukses), "AUTO TIME: 14:32" (clock race).
- **Bahasa:** Inggris untuk display/copy UI (konsisten dengan Stitch & design system); istilah domain selalu domain sepeda (ride, sector, checkpoint, cut-off, buffer, IF, TSS, NP). i18n ID menyusul via settings (PRD F8).
- **Angka:** selalu tabular-nums; satuan kecil abu (W, KM/H, BPM, RPM, KCAL, KG, MIN) mengikuti angka, tidak pernah lebih besar dari angka.

## 4. Blueprint Layar (Hierarki Zona)

> Urutan zona = urutan visual atas→bawah. [G] = satu-satunya momen gradien layar. (S#) = pola Stitch yang diadopsi, lihat §2. Ketebalan interaksi = perilaku implementasi, bukan mockup.

### 4.1 Dashboard — [referensi: gowslab_dashboard]
1. Header: kicker "GOOD MORNING, {nama}" + headline "READY TO / *ride* ?" + bell circle (badge reminder).
2. Athlete snapshot: 2×2 tile — FTP · W/kg · CTL · **TSB [G]** dengan warna status; sparkline TSB 30 hari + baseline dotted 0.
3. "LAST 7 DAYS": stats 8h 32m · 184 km · 512 TSS + bar TSS harian, target line dotted, hari terbaik `#FF4D00`.
4. "FITNESS & FATIGUE": CTL line + area fade, ATL dotted; legend pill filled/outline.
5. "REMINDERS": wear chain hatch bar (WASPADA bila ≥90%) + countdown event (arrow-in-circle).
6. Nav kapsul: Home aktif.

### 4.2 Rides — [gowslab_rides_split_cockpit_variant]
1. Header editorial "Every watt / *counts*." + circle search / file-up / refresh-cw (dot sync).
2. Summary strip: angka besar bulan berjalan + 2 stat sekunder.
3. Filter chips: All (filled `#FF4D00`) · Rides · Commutes · With power · Flagged.
4. Kartu aktivitas: icon tile + nama + meta gray + **TSS besar + IF kecil + sparkline** (S: layout tiga kolom). Chip source "STRAVA"/"GPX".
5. Empty state dashed → aksi import/sync.
6. Nav kapsul: Rides aktif.

### 4.3 Activity Detail — [gowslab_activity_detail_bento_cockpit_variant]
1. Header: kicker "RIDE · {tgl}" + headline "Sunday / *long* ride." + chips: source, bike, cuaca (bila ada).
2. Stat bento: Distance & duration (tile gabungan besar) · **TSS tile [G]** + chip "PEAK" bila tertinggi periode · IF · Avg speed · Avg HR.
3. "POWER DYNAMICS": NP pill filled + avg pill outline + variabilitas (deviasi avg, %) — **bukan "% vs benchmark" hardcoded**.
4. "PHYSIOLOGY & CADENCE": collapsible — avg/max HR · kcal (dari kJ) · cadence avg.
5. Chart utama segmented Power/HR/Elev/Speed; area fade; **garis referensi FTP dari `ftp_history`** (label "FTP 275 W" dinamis); peak terlabeli pill.
6. "MEAN-MAX POWER": kurva + dot "BEST 20min · {nilai}" (dinamis); % vs season best dihitung lokal.
7. "TIME IN ZONES": stacked bar ramp abu→`#FF9F2E` + legend menit/persentase.
8. (Opsional, P1) Map/sector preview statis — lazy load, abaikan bila offline.
9. Footer: flag race rehearsal toggle + note + meta perangkat (imported-from).
10. Nav kapsul: Rides.

### 4.4 Body — [gowslab_body_profile_bento_cockpit_variant]
1. Header: kicker "ATHLETE" + "Your / *machine*."
2. Dual hero: Weight + chip delta vs minggu lalu + mini chart · FTP + chip "W/KG {x} · CAT {y}" (kategori dari tabel Coggan, dihitung) + delta FTP 12 bulan.
3. "FTP VS WEIGHT": dual-axis, FTP solid `#FF4D00` vs weight dotted.
4. "PERSONAL ZONES": segmented Power(7)/HR(5); bar ramp + baris zona dengan rentang **dihitung dari FTP/LTHR aktif**; edit via pencil circle → sheet.
5. "BASICS": height · DOB · RHR · MHR · units toggle.
6. Footer: shield note "All data stays on your device."

### 4.5 Bikes — [gowslab_bikes_gear]
1. Header: kicker "GARAGE" + "Your / *machines*." + plus circle.
2. Kartu sepeda: nama + type chip + spec line + 4 tile (weight · CdA · Crr · **odometer [G]** "ACTIVE BIKE") — gradien pindah ke odometer hanya pada sepeda aktif.
3. "COMPONENTS": baris = nama + wear hatch bar + chip status + "x km left/overdue" (overdue = KRITIS, ≥90% = WASPADA).
4. FAB `#FF4D00` (add component).
5. Kartu sepeda kedua collapsed: odometer + arrow-in-circle.
6. Footer info: "Weight, CdA and Crr feed the route estimator."
7. Tanpa nav (sub-halaman), back circle.

### 4.6 Route Estimator — [gowslab_route_estimator_bento_cockpit_variant]
1. Header: kicker "ROUTE" + "{nama rute}" dengan kata aksen; chips: jarak · elevasi · "GPX".
2. Hasil hero: **pill pair [G]** "EST FINISH {t}" vs outline "ARRIVE {jam}" + sub-line avg speed · kcal · NP target.
3. Parameter chips row: bike · cargo · stops · start.
4. Chart profil: area fade, crosshair tooltip (KM · grade · speed · elapsed) — angka dari engine; **tanpa label dekoratif**, legend minimal (altitude/speed).
5. "TARGET INTENSITY": segmented Endurance/Steady/Custom + slider + **Normalized Power Target besar (W)** dengan skala min(60% FTP)→FTP (dinamis, bukan angka mati) + 3 label bawah (persen IF).
6. "EXPEDITION SETUP" → rename **"SETUP"**: 4 chip parameter (S: grid 2×2).
7. "CHECKPOINTS": baris bernama sektor (nama dihasilkan dari puncak/segmentasi — generik "Sector 3 · 6.2%" bila tak terdeteksi) + ETA + elapsed; baris CP: lock + "CUTOFF {jam}"; highlight `#FF4D00`.
8. "FORECAST": strip cuaca Open-Meteo per 3 jam (P1; sembunyikan offline).
9. CTA: "SAVE AS RACE PLAN" gradien capsule.

### 4.7 Race Setup — [gowslab_race_setup_bento_cockpit_variant]
1. Header: kicker "NEW RACE" + "Set your / *battle*." + save circle.
2. Race name input (48px).
3. Route card: thumb mini (garis rute `#FF4D00` di atas `#0A0A0B`) + jarak/elev + "CHANGE >".
4. Start time & finish cut-off: stepper besar; helper "13h 00m hard limit" + chip hitungan "must beat {jam}" (dihitung).
5. "TARGET INTENSITY (IF)": slider + chip nilai + watt target (dihitung).
6. "BIKE & CARGO": selected vs standby (S#7) + stepper cargo & stop.
7. "INTERMEDIATE CUT-OFFS": baris CP + add dashed.
8. "YOUR PLAN" [G]: est finish besar + buffer chip + ETA/avg/kcal + **"3 SLOWEST SECTORS" dengan target watt** (S#8).
9. CTA: "START RACE MODE" gradien.

### 4.8 Race Mode — [gowslab_race_cockpit_hud_rail_variant]
1. Header: back + chip "LIVE" (dot pulse) + **kicker race name saja** (tanpa timer duplikat — koreksi S#5) + profile circle.
2. Hero buffer card: kicker "BUFFER VS CUT-OFF" + chip status ("AHEAD OF TARGET"/AMAN dsb.) + **metric-hero "+47 MIN"** berwarna status + glow + hatch track NOW→CUT-OFF dengan marker.
3. Grid: PROJECTED FINISH (+ sub delta vs limit) · REQUIRED AVG SPEED (+ sub current avg).
4. Status strip: 3 pill AMAN/WASPADA/KRITIS + satu kalimat penjelas.
5. "LOG CHECKPOINT": card **Instant Position Update** — input KM besar (metric-lg) + "AUTO TIME: {jam}" + keypad grid 1–9, 0, backspace (S#5) + tombol "LOG CHECKPOINT ({km})" `#FF4D00` + Cancel ghost.
6. Timeline "LOGGED": dotted connector + dot `#FF4D00` + deviation pills (±min, warna status).
7. Cut-off checkpoint card: "KM 120 — BEFORE 15:00" + mini buffer + countdown bar.
8. Ghost "End race". Tanpa nav.

### 4.9 AI Coach — [gowslab_ai_coach]
1. Header: kicker "AI COACH" + "Your data, / *coached*." + history circle.
2. Onboarding BYO key card (bila belum ada key): sparkles tile + privacy line + gradien "ADD API KEY" + provider chips (Gemini selected outline).
3. "WEEK 38 · REVIEW": 4 mini stats + 3 insight bullets — **setiap bullet wajib mengutip angka dari konteks** (S#12); tanpa bullet tanpa angka.
4. Action row: "ASK COACH" gradien + "BUILD NEXT WEEK" outline.
5. Chat: user bubble gradien teks hitam; coach bubble card + inline metric chips; input pill + send circle.
6. "NEXT WEEK": day chips + 7 baris sesi (chip tipe + durasi + TSS) + checkbox; target TSS chip.

### 4.10 Settings — [gowslab_settings_bento_grid_variant]
1. Header: kicker "APP" + "Settings & / *data*."
2. "UNITS & FORMAT": unit toggle · time format · week start.
3. "APPEARANCE": theme cards Dark (ring `#FF4D00` + check) / Light (preview cream) / Auto + note "Race mode is always dark."
4. "STRAVA": connected card — avatar chip, "@handle", "LAST SYNCED {t} · {n} RIDES", tombol SYNC NOW `#FF4D00` / DISCONNECT ghost + note kebijakan 7 hari.
5. "AI PROVIDER": chip model + masked key + VERIFIED chip + "TEST CONNECTION".
6. "DATA & STORAGE": export · import · clear streams ("est. {MB} saved", dihitung) · **Erase all data = satu-satunya blok merah `#FF0000` + "DOUBLE-CONFIRM" chip**.
7. "ABOUT": ZONADUA + version + tagline + Privacy/Licenses links + **banner "ALL PERFORMANCE COMPUTATIONS OCCUR ON-DEVICE. NO TELEMETRY IS TRACKED OR SOLD."** (S#11 — identitas produk, wajib ada).

## 5. Aturan Cross-Cutting

- **Progressive disclosure:** maksimal 2 level per layar. Zona sekunder (physiology, zones detail, riwayat checkpoint lama) → collapsible / "show all".
- **Nol angka statis:** setiap angka contoh di blueprint adalah data dari store (fixtures saat dev). Komponen dilarang hardcode metric.
- **Loading & empty:** skeleton = permukaan `#141416` dengan shimmer tipis; empty state = dashed card + 1 kalimat + 1 aksi (jangan kosong mentah).
- **Error/warning:** pesan satu kalimat + chip status; never modal untuk info non-blocking.
- **Aksesibilitas:** kontras teks di atas gradien = `#0A0A0B` (bukan putih); area sentuh ≥44px; keypad race = angka ≥32px.
- **Performa:** chart dirender uPlot canvas; tanpa shadow besar berulang; nav kapsul backdrop-blur 16px boleh (satu layer), tidak bertumpuk.
- **i18n:** string display dipisahkan (svelte-i18n-ready) — copy Inggris jadi default locale `en`, `id` menyusul.

## 6. Pemetaan ke Implementasi (M0)

> Diperbarui setelah paritas visual dengan hasil Stitch (§2): kicker section berada **di luar kartu**, tile dalam memakai `#1A1A1D` rounded-2xl dengan angka 30px bold, kata italic headline berwarna putih (weight 400), nav kapsul memakai ikon 22px + label 10px uppercase (aktif = teks signal), dan surface token `--color-tile: #1A1A1D` ditambahkan.

- `lib/components/`: `AppNav.svelte` (kapsul max-w-340px, ikon+label), `StatTile.svelte` (variant: default `#1A1A1D` | raised | gradient + delta chip), `StatTrio.svelte` (3 statistik dengan divider), `TssBars.svelte` (bar netral `#201F20`, puncak signal+glow, target dashed, label hari), `FitnessChart.svelte` (SVG CTL area-fade + ATL dotted + end dots + axis bulan), `LegendPill.svelte` (legend CTL/ATL filled vs outline), `EditorialHeader.svelte`, `PillCompare.svelte`, `HatchTrack.svelte`, `StatusChip.svelte`, `CircleButton.svelte`, `SectionCard.svelte` (kicker luar kartu), `Sparkline.svelte`, `ChartStub.svelte` (placeholder uPlot M2).
- Tema via CSS custom properties dari token §1 (satu sumber: `app.css`), class semantic (`bg-surface`, `bg-tile`, `text-ink-dim`, `shadow-signal-tile`, `glow-peak`).
- Setiap layar §4.1–4.10 = satu route di `lib/routes/`; nav kapsul tampil hanya di 5 route utama.

## 7. Poles v5.2 — Paritas Fitur & Header Global (1 Okt 2026)

Hasil audit UI vs PRD F1–F8: semua page kini memakai token v5.1 dan fungsi nyata. Keputusan:

### 7.1 Header global (EditorialHeader)
- **Aksi header konsisten di SEMUA page** (tidak perlu pindah page untuk akses): trio global `Bike → #/gear` · `Bell` · `Settings → #/settings`, lalu aksi spesifik page lewat snippet `children`.
- Self-link disembunyikan otomatis: ikon Bike tidak tampil di `#/gear`, ikon Settings tidak tampil di `#/settings` (props `showGear/showBell/showSettings` untuk pengecualian manual).
- Mode greeting (Dashboard) dan mode kicker (Rides/Routes/Race/Coach/Gear) memakai trio yang sama.
- Entry point Gear tetap 2: ikon Bike di header (kini semua page) + blok wear Dashboard.

### 7.2 Route baru: Settings (F8)
- `#/settings` ditambahkan ke router & App.svelte. **Tidak ada di nav** — akses lewat ikon Settings di header semua page.
- Urutan section: Athlete profile (nama/tinggi + log Weight & FTP ke `weight_log`/`ftp_history`) → Preferences (unit, bahasa, weather toggle) → AI coach key (provider chips, `type=password`, format-check per provider, clear) → Strava sync status → Data management (backup JSON semua tabel, restore merge `bulkPut`, wipe 2-langkah + ketik DELETE).
- Theme disimpan di `settings.theme` (record saja); switch UI menyusul dengan race-day theming.

### 7.3 Fungsi yang diselaraskan (dari dekoratif → hidup)
- **Rides:** search filter nama, import GPX/TCX nyata (DOMParser + haversine → `activities` + `activity_streams` deflate-raw + odometer sepeda aktif bertambah, F1-AC1/F3-AC2), sync button → Settings.
- **Routes:** container seragam `max-w-md px-5`; pacing model satu sumber (ETA/kcal/NP/waypoint selalu monoton & sinkron); import GPX → `routes` (profil elevasi dinormalisasi, downsampling ~500pt); Export GPX dari titik ter-parse; "Save as race plan" → `races` (status planned) → navigasi Race.
- **Race live:** buffer/proyeksi/required-pace dihitung dari log checkpoint (`race_logs`) + jam berjalan (30s tick); tanpa log → proyeksi mengikuti rencana; checkpoint cut-off dihitung per CP (buffer terkecil menentukan status); log KM dua-tap tersimpan; timeline; Finish & save menulis `actualFinishMin/actualKm/actualBufferMin` ke `planJson` + status finished; wake-lock saat live; "Change route" → `#/routes`.
- **Coach:** tombol key → Settings (label berubah "Manage API key in Settings" saat key ada); chat send menyimpan `ai_notes` (kind chat, maks 5 ditampilkan, bisa dihapus) — LLM call M5.
- **Gear:** header memakai trio global; sub headline dinamis sesuai jumlah sepeda.

### 7.4 Aturan toast
- Toast pill monokrom gelap di atas nav (`bottom: nav + 8px`), auto-hide 3–4 dtk, ikon status (check/hijau, spinner/rose). Dipakai Rides, Routes, Settings.

### 7.5 Reminder bell (keputusan 1 Okt 2026 — tindak lanjut audit)
- Pertanyaan "perlu notification panel?" → keputusan produk: **panel reminder ringan**, bukan notification center (PRD tidak punya push/feed; app local-first single-user) dan bell tidak boleh mati (prinsip tanpa tombol dekoratif).
- `ReminderBell.svelte` menggantikan bell statis di EditorialHeader (tampil di semua page). Semua item **di-derive dari Dexie saat render** — tanpa tabel/state baru:
  - Komponen wear ≥90% (F3-AC3) semua sepeda, maks 3 terburuk → `#/gear`.
  - Race `planned`/`live` terdekat → countdown ≤14 hari urgent → `#/race` (liveQuery `nextRace` baru di queries.svelte.ts).
  - Backup JSON >30 hari / belum pernah (PRD §10) → `#/settings`. Field baru `settings.lastBackupAt` ditulis tombol "Backup JSON".
  - AI key belum diset (F5-AC1) → `#/settings`.
- Dot crimson di bell hanya saat ada item non-`aman`. Panel: popover 320px (mobile: sheet lebar), close via X / Escape / klik-luar / navigasi. Row = link langsung ke tujuan.
- Pola: reminder = derived state, bukan data tersimpan; tidak ada read/unread.

## 8. v5.3 — Nav FAB + Routes empty-state (1 Okt 2026)

### 8.1 Navigasi (keputusan user)
- **Nav bar 4 tab + FAB tengah**: Today · Rides · **[FAB]** · Gear · Coach. Gear pindah dari header ke nav (keputusan v5.3); Routes & Race digabung dalam FAB crimson (`bg-crimson-gradient`, + yang berputar 45° saat terbuka).
- FAB = speed-dial: scrim `bg-ink/30`, dua pill "Routes" dan "Race" (elevation-raised), close via tap-luar / Escape / navigasi. FAB memakai `ring-2 ring-rose/60` + dot saat Routes/Race aktif.
- **Header kini hanya: ReminderBell + Settings** (di semua page, kedua mode). Ikon Bike dihapus dari header — entry Gear tinggal nav; ReminderBell tetap tampil di page gear & settings.
- FAB theme = momen crimson `bg-crimson-gradient` (highlight putih 16%) — dipindah dari CTA save-plan sebagai identitas "plan & compete".

### 8.2 Routes: estimator & empty state
- **Cara kerja estimator** (narasi user-facing): parse GPX (haversine antar trkpt → jarak; delta elevasi positif → D+; downsampling ~500 pt) → profil elevasi digambar → proyeksi = jarak ÷ kecepatan model (30 km/j placeholder M3) + stop time → ETA jam, kcal dari NP×waktu, NP target dari IF×FTP. Semua angka dari satu sumber (pacing model) sehingga waypoint selalu monoton. — **Catatan: deskripsi ini digantikan §21; kecepatan model bukan lagi konstanta, tetapi hasil solver fisika.**
- **Belum ada GPX:** dropzone dashed card (klik/Enter/drag-drop) + headline "Sample plan" di monolith + chip "Sample" di kartu profil. Data sample tetap tampil sebagai contoh (fallback M0), bukan angka palsu yang menyaru data nyata.
- Drag-drop synthetic GPX teruji E2E: 30 trkpt → 9.4 km / 300 m ↑ / estimasi 0h 49m — dropzone hilang, header & chip beralih ke mode loaded.

## 9. Audit data & visualisasi (1 Okt 2026) — dashboard & antar page

Temuan & perbaikan (prinsip: nol angka statis §5, kejujuran visual):

### 9.1 Dashboard (F1/F4/F7)
- **FTP delta** kini dihitung dari `ftp_history` (±W vs N hari lalu) — menggantikan "+17W vs 4 mo" hardcoded.
- **TSS target** TssBars = rata-rata beban 4 minggu terakhir (dibulatkan 25, min 50, default 450 saat kosong) — bukan 450 statis.
- **Race card memakai race `planned`/`live` terdekat dari Dexie** (sama dengan sumber bell): countdown hari + cut-off, jarak dari tabel routes, animasi pulse saat live, progress bar menuju hari-H (horizon 6 minggu). Kartu "Bukit Barisan 200 · 42 days · sub 7h30m" + bar 68% hardcoded dihapus; ada empty state "No race planned yet → Import a route".
- **Worst wear card mencakup semua sepeda** (F3-AC3), bukan hanya sepeda aktif.
- Kartu section kini berjudul "Reminders & race" (isi memang reminder + race).
- Snapshot tiles (FTP, W/kg, CTL, TSB) sudah sesuai F4-AC1 — W/kg dari berat terkini ✓.

### 9.2 Coach (F5-AC1)
- **Gate konten AI di belakang key**: tanpa API key, weekly review + quick actions + chat + next-week plan disembunyikan, diganti onboarding card dengan CTA ke Settings. App tetap fungsional penuh (AC).
- Provider chips statis dihapus (duplikat Settings); tombol "Conversation history" dekoratif dihapus.
- Semua konten AI (review/insight/chat sample/plan) sekarang secara eksplisit hanya tampil saat key diset — di M5 konten mock ini diganti output LLM dengan struktur yang sama.

### 9.3 Rides
- Sparkline deterministik diberi label jujur: aria "Decorative ride accent" + tooltip — menunggu stream parsing M2 untuk kurva power nyata. Sisanya (list, filter, search, import, week monolith) sudah data nyata.

### 9.4 Status page lain
- **Gear**: seluruhnya data hidup (liveQuery bikes×components, CRUD teruji) — optima.
- **Routes**: pacing model satu sumber + empty state GPX (v5.3) — optima; upgrade berikutnya = physics engine M3.
- **Race**: setup & live tracker data nyata; physics M3 akan menggantikan asumsi 30 km/j.
- **Settings**: semua kontrol menulis ke Dexie — optima.

### 9.5 Rekomendasi berikutnya (belum dieksekusi)
1. Activity detail route (#/rides/:id) — list rides belum bisa dibuka.
2. Zones editor (F2-AC4) + unit imperial belum dipakai komponen manapun.
3. Weight & FTP trend chart (F2-AC2/F4-AC3) di Settings atau dashboard.
4. TssBars: tampilkan angka targetnya di UI, bukan hanya garis.
5. Physics engine M3 per segmen (gravitasi+rolling+aero) — upgrade estimator Routes/Race.

## 10. v5.4 — Header editorial & nav icon-only (1 Okt 2026)

- **Dashboard header tanpa avatar** (hapus monogram): kicker editorial `Today · {hari, tanggal}` + headline dua baris `Good {morning|afternoon|evening},` + **nama depan italic crimson** (accent-italic, normal-case) — bahasa visual majalah, greeting adaptif jam lokal.
- **Nav icon-only**: 4 tab (Home · Rides · Gear · Coach) hanya ikon; **label muncul hanya di tab aktif** (fly 140ms). "Today" diganti "Home". `title` attr sebagai fallback hover.
- **Mockup FAB** (mockups/fab-nav.html, 5 varian + baseline): 1 Split Crescent · 2 Notch Monolith · 3 Square Hero · 4 Ink Pulse · 5 Stacked Label. Eksekusi menunggu pilihan user.

## 11. v5.5 — Tab aktif = pill accent (1 Okt 2026)

- **Tab aktif nav** diganti dari "ikon rose + label bawah" menjadi **pill accent penuh**: `rounded-pill bg-crimson-fill` (#D50F26) + teks putih, **ikon + title horizontal** di dalam pill (h-11, gap-1.5, label uppercase 10px extrabold) — mengikuti referensi user (pill oranye di nav putih/gelap).
- Tab non-aktif tetap **icon-only** centered (on-mono-dim, hover ke on-mono). Layout `flex-1` + slot FAB `w-16` tidak berubah.
- Ikon aktif 19px strokeWidth 2.2, non-aktif 21px/1.5 — proporsi pill. Label memakai transisi `fly` 140ms yang sama.
- Terverifikasi DOM: pill hanya di tab aktif, pindah mengikuti rute (Home→Rides→Gear→Home), bg `rgb(213,15,38)` + teks `rgb(255,255,255)`, radius 9999px; FAB speed-dial + Escape + klik-luar tetap utuh.

## 12. Mockup FAB × pill aktif (1 Okt 2026) — menunggu pilihan

- **Masalah**: sejak v5.5, FAB crimson lama + pill aktif crimson = "blob merah ketiga", terburuk saat Rides/Gear aktif (pill tepat di samping FAB) — melanggar aturan 1 momen aksen/kartu.
- **Mockup**: [mockups/fab-curved.html](../mockups/fab-curved.html) — baseline + 3 strategi, tiap varian dalam 2 kondisi kritis (Rides & Gear aktif):
  - **1 Curved Crest**: nav menumbuhkan lengkungan di tengah (96px, bg mono, bulat atas), FAB mengambang di puncaknya (−42px) — jawaban harfiah idemu "mengambang + curved bar".
  - **2 Floating Halo**: tanpa ubah nav; FAB naik −28px + ring canvas 6px memotong bar. Perubahan minimal.
  - **3 Ink Crest**: lengkungan varian 1 + FAB monokrom (plus rose) — crimson eksklusif milik pill aktif.
- **Status**: menunggu nomor varian user. Varian FAB lama (§10, fab-nav.html) digantikan konteks ini.

## 13. Mockup notch dock × rounded-rect marker (1 Okt 2026) — DIGANTIKAN §13b

> **Ditolak user**: potongan sudut (corner box-shadow hack) dinilai jauh dari referensi dan "konyol". Digantikan pendekatan §13b (mask mulus + dot indicator).

- **Referensi user kedua**: FAB ter-dock di lekukan melengkung (concave notch) + penanda aktif rounded-rectangle (bukan pill fill).
- **Mockup**: [mockups/fab-notch.html](../mockups/fab-notch.html) — geometri terverifikasi (pusat FAB −2px dari tepi bar = setengah tenggelam di notch 92×32px berwarna canvas, sudut inward membulat):
  - **1A Notch dock + marker outline**: bar gelap monolith, tab aktif = rounded-rect outline crimson 16px + ikon rose — tanpa fill merah di tab, crimson FAB tak bersaing.
  - **1B Notch dock + marker tile**: sama, marker = soft fill rgba(crimson, .16) — lebih halus.
  - **2 Light bar**: nav putih ala referensi + underbar crimson — paling jujur ke gambar tapi kehilangan identitas monolith.
- ~~**Rekomendasi**: 1A~~ — dibatalkan, lihat §13b.

## 13b. Notch dock v2 (CSS mask) + dot indicator (1 Okt 2026) — menunggu eksekusi

- **User menolak v13** dan meminta: potongan melengkung mulus ala referensi + penanda aktif diganti **dot crimson di bawah ikon tab aktif** (bukan pill, bukan kotak).
- **Mockup dirombak total**: [mockups/fab-notch.html](../mockups/fab-notch.html) — potongan dibuat dengan **CSS mask radial-gradient yang konsentris dengan FAB**: pusat mask = pusat FAB (−14px di atas tepi bar), radius mask = FAB/2 + gap 7px → **gap ring 7px konstan di semua arah** (terverifikasi matematis; versi lama menipis ±1.6px di sisi karena tak konsentris). Bayangan via `filter: drop-shadow` pada layer terpisah agar mengikuti siluet ter-mask.
- **Varian 1**: bar gelap + FAB crimson + dot. **Varian 2**: bar gelap + FAB ink monokrom (plus rose) + dot — satu-satunya merah "berat" adalah dot aktif.
- **Dot indikator**: 4.5px, crimson #E8102E, glow halus, transisi scale/opacity saat pindah tab; hanya tampil di tab aktif.
- **Status**: menunggu perintah "eksekusi" (varian 1 atau 2) untuk AppNav.svelte. → **DIGANTIKAN §14** (notch dock versi 2 juga tidak memuaskan user).

## 14. Capsule dock & monolith browser-chrome (1 Okt 2026) — menunggu pilihan

- **User memberi file referensi VeloClub** (club_feed_modern_editorial_suite/code.html) dan meminta nav bar-nya dijadikan acuan + monolith browser-chrome sebagai referensi hero card, dengan warna disesuaikan ke token Zonadua.
- **Mockup baru**: [mockups/fab-notch.html](../mockups/fab-notch.html) — struktur 1:1 dari referensi, diverifikasi DOM:
  - **A — Capsule dock**: bar kapsul gelap; **pill aktif = ikon + label dengan bg putih-transparan rgba(255,255,255,.14)** (bukan fill crimson); tab lain ikon redup 50%; **tombol + solid crimson (glow) di UJUNG KANAN** bar — bukan FAB tengah. Dua kondisi: Home & Rides aktif. Bentrokan pill × FAB hilang total karena + pindah ke kanan dan hanya ada satu momen crimson.
  - **B — Varian sporty**: pill aktif fill crimson `#D50F26` + glow, tombol + jadi **ink monokrom** (plus rose) — tetap satu momen aksen.
  - **C — Monolith hero browser-chrome**: kartu gelap dengan chrome atas (lampu crimson/kuning/hijau + address pill `zonadua.app/weekly-load` + dot LIVE pulse), 3 metrik mini (CTL/TSB/TSS), spline area crimson + badge peak `#D50F26`, axis labels. Kandidat hero Dashboard & live cockpit Race.
- **Interaksi tetap**: tombol + membuka speed-dial Routes/Race; Escape/klik-luar utuh.
- **Status**: menunggu pilihan "eksekusi A/B/C" (bisa kombinasi, mis. A + C).

## 15. v5.6 — Capsule dock A+B dieksekusi (1 Okt 2026)

- **Keputusan user**: kombinasi varian A + B dari §14 — pill aktif putih-transparan, plus monokrom ink di ujung kanan.
- **AppNav.svelte ditulis ulang** sebagai capsule dock ala referensi VeloClub:
  - **Tab aktif** = pill `bg-white/15` (putih-transparan) dengan **ikon (20px/2) + title 12px bold keduanya berwarna rose** (#FF4D5E) — highlight color pada icon & title.
  - **Tab non-aktif** = ikon 22px/1.5 `on-mono/50`, hover ke on-mono; tanpa label.
  - **Quick action di ujung kanan** (bukan FAB tengah): tombol 44px `bg-mono-gradient border-[#2b2d33]` dengan plus **rose** saat idle; berubah **crimson penuh** (`bg-crimson-gradient glow-signal text-white`) saat **aktif** (Routes/Race) **atau ditekan/dibuka** (`active:bg-crimson-gradient active:text-white`); plus **berputar 45° jadi ×** saat dial terbuka.
  - Speed-dial Routes/Race kini melayang dari **pojok kanan** (bottom-right) di atas tombol +; scrim, Escape, klik-luar tetap. Slot FAB tengah dihapus — 4 tab merata + plus.
- Terverifikasi DOM: pill aktif oklab putih 15% + teks rose + title "Home"; plus ink/rose saat idle, kelas crimson+white+rotate-45 saat terbuka, kembali ink setelah tutup; dial tersembunyi benar saat tertutup (opacity 0 / y+8 — artefak rAF-throttle webview preview membuat node transisi tertinggal di DOM, di browser nyata terhapus).
- Baris angka nav tak berubah: h-16, rounded-full, bg-mono-gradient, border white/10.

## 15b. v5.6.2 — lebar nav stabil + halo socket (1 Okt 2026)

- **Bug lebar nav**: dock 341px saat Rides/Gear vs 358px saat Coach — penyebabnya **scrollbar klasik 17px** pada halaman panjang yang menyusutkan layout viewport. **Fix**: scrollbar disembunyikan app-like (ref VeloClub `::-webkit-scrollbar{display:none}` + `scrollbar-width:none`) → dock stabil **358px di semua rute** (terverifikasi).
- **Highlight aktif diubah jadi PUTIH** (ikon + title) sesuai permintaan — pill tetap putih-transparan `bg-white/15`.
- **Cutout mask di-ROMBAK lalu DIBATALK**: v1 corner box-shadow (ditolak user), v2 mask radial konsentris + `filter: drop-shadow` (geometris benar, gap ring 7px konstan, klik tembus via rantai `pointer-events-none`) — tapi user memutuskan **cutout terlalu berisiko bocor**. Utilitas `dock-cut`/`dock-shadow` dihapus dari app.css; bar kembali satu layer solid.
- **Separasi final = halo socket**: tombol + dibungkus ring `bg-white/12 p-[3px] rounded-full` (+`ring-1 ring-white/20` saat hot) — bahasa visual sama dengan pill aktif, tanpa mask, klik tidak mungkin bocor, glow crimson utuh. Terverifikasi: halo oklab putih 12% padding 3px membungkus tombol; hit-test ring & permukaan bar tertahan; state plus (ink idle / crimson+rotate saat open, Escape) tetap utuh.

## 15c. v5.6.3 — scrim dihapus + panel plan menu (2 Okt 2026)

- **Bug "layer opacity"**: saat dial terbuka muncul overlay gelap layar penuh — itu **scrim `bg-ink/30`** yang sengaja dibuat sejak nav FAB tengah. Dianggap bug oleh user (konteks hilang saat panel terbuka). **Dihapus**: click-outside (`onDocPointer`) + Escape sudah menutup dial, scrim tak diperlukan. Terverifikasi: 0 overlay gelap saat panel terbuka.
- **Panel plan menu baru** menggantikan speed-dial pill berjejer (posisi lama: tengah; kini tombol + di kanan):
  - Panel `w-[248px] rounded-card bg-surface border p-1.5 elevation-raised`, melayang dari **pojok kanan** (`right-0`, `origin-bottom-right`) 14px di atas tombol +, fly 160ms.
  - Kicker row: "PLAN" (9px uppercase tracking lebar) + "2 destinations".
  - Item = baris menu card: icon tile 36px rounded-xl (tile / **crimson-fill putih** saat aktif) + label bold + sub-label ("Route library & GPX plans" / "Live tracker & pacing") + `ArrowUpRight` yang bergeser saat hover; item aktif diberi `bg-crimson/10` + teks crimson-deep.
  - Anchoring terverifikasi: tepi kanan panel = tepi kanan halo tombol + (selisih 0), flush dengan sisi kanan dock.

## 15d. v5.6.4 — sliding highlight pill (2 Okt 2026)

- **Pill aktif kini elemen terpisah yang bergeser mulus** antar tab (bukan class muncul-hilang): satu `div absolute` di dalam bar, diposisikan via `transform: translateX(offset) translateY(-50%)` + `width` hasil pengukuran `offsetLeft/offsetWidth` anchor tab aktif; transisi `300ms cubic-bezier(0.22,1,0.36,1)` pada transform/width/opacity.
- **Pengukuran**: `$effect` pada tab aktif → `tick()` lalu ukur; re-measure saat `document.fonts.ready` (lebar label berubah setelah webfont) & `onresize` (rotasi). Penempatan pertama **tanpa transisi** (`measured=false`) + `opacity-0` sampai terukur → pill tidak "terbang" saat load.
- Tab aktif & non-aktif kini `relative z-[1]` di atas slider; pill tetap `bg-white/15`, highlight putih pada icon+title tak berubah.
- Terverifikasi: x slider = offsetLeft tab aktif di Home(8)/Rides(69)/Gear(177)/kembali Home; lebar tertangkap mid-flight 92→91→(89) membuktikan animasi berjalan; `prefers-reduced-motion` otomatis dipatuhi (global rule app.css).

## 16. Mockup hero browser-chrome + stat tiles (2 Okt 2026) — menunggu pilihan

- **Permintaan**: adaptasi monolith hero dashboard ke bahasa browser-chrome kartu "Statistik Klub" (referensi VeloClub) + penyesuaian kartu statistik putih.
- **Mockup**: [mockups/hero-chrome.html](../mockups/hero-chrome.html) — data sample dari dashboard nyata (readiness 40%, TSB −11, CTL 22 · ATL 33, 5.8h · 124km · 313 TSS):
  - **H1 — Address bar**: hero saat ini + baris chrome 32px (lampu crimson/kuning/hijau + address pill `zonadua.app/today` + dot LIVE). Risiko terendah.
  - **H2 — Window tabs fungsional**: chrome berisi tab Today/Form/Load (aktif dot crimson) yang mengganti isi kartu; address pill berisi konteks pekan. Butuh state kartu — cocok saat M2.
  - **S1 — Chrome dots**: tiga dot mini di sudut tiles putih (crimson + hairline) memanggil chrome di skala mikro; tile flare memakai dots putih.
  - **S2 — URL-pill label**: label tiles jadi pill "alamat" (`ftp / threshold`, `power / kg`, …) dengan ikon gembok mini; di tile flare versi putih-transparan.
- **Rekomendasi**: H1 + S1 untuk langkah ini; H2 saat M2; S2 sebagai upgrade naratif. **Status**: **H2 DIPILIH & DIEKSEKUSI (2 Okt 2026)** — lihat §17. S1/S2 belum dipilih (kandidat lanjutan).

## 17. v5.7 — H2 hero chrome tabs fungsional (2 Okt 2026)

- **Keputusan user**: eksekusi H2 — chrome dengan **tab fungsional Today/Form/Load** yang mengganti isi monolith hero Dashboard (bukan varian dekoratif H1, bukan S1/S2).
- **SectionCard.svelte** dapat snippet opsional `chrome`: dirender **full-bleed di atas body** (kartu kini `overflow-hidden`, body dibungkus `p-5` sendiri) — chrome menyatu ke sudut rounded card tanpa padding. Kartu lain tak berubah (chrome opsional).
- **Chrome row (Dashboard hero)**: `h-9 bg-black/40 border-b border-white/10` — lampu 10px (crimson / #EAB308 85% / #22C55E 85%) · tab mini Today/Form/Load di tengah (pill aktif `bg-white/12` + **dot crimson 5px** + teks on-mono; non-aktif `on-mono/55`, hover on-mono) · dot **LIVE** di kanan yang **menyala + pulse hanya saat raceCard.live** (selain itu `opacity-30`, tetap ada sebagai bagian chrome — elemen dekoratif chrome, bukan state palsu).
- **State kartu**: `heroTab = $state<'today'|'form'|'load'>('today')`; body = **grid-stack** (v5.7.1, lihat bawah). Tab asli `role="tab" aria-selected aria-controls`, pane `role="tabpanel" id="hero-pane" aria-labelledby="hero-tab-{heroTab}"`. Tanpa record snippet (Svelte 5 memperlakukan snippet dalam tag komponen sebagai props → error `$$ComponentProps`); snippet handles via `$state` juga dihapus.
- **Isi tab** (semua data derived yang sama, nol angka statis):
  - **Today** (default) = ring readiness 112×112 + form TSB + trio pekan — persis hero lama.
  - **Form** = Sparkline `tsbSpark` 30 hari (352×96, `onDark`, showBaseline) + `taperDelta` "±pts / 7d" + trio CTL / ATL / TSB.
  - **Load** = TssBars `week.dailyTss` vs `tssTarget` + header "{week.tss} TSS / wk".
- **TssBars.svelte** dapat prop `onDark`: bar netral `#23252c` border `#2b2d33`, target dashed `#3a3d45` + label `on-mono-dim`, label puncak `rose` (crimson-deep kontras buruk di gelap). Peak bar tetap `bg-signature-gradient glow-crimson`.
- **Snippet `right()` hero dihapus** — label "Today" sekarang hidup sebagai tab chrome (tidak ada duplikat).
- **v5.7.1 — tinggi kartu konstan antar tab** (permintaan user): ketiga pane selalu ada di DOM dalam **satu sel grid** (`#hero-pane` = `class="grid"`; tiap pane `col-start-1 row-start-1`), hanya tab aktif terlihat — yang lain `opacity-0` + atribut `inert` (crossfade CSS 150ms; transisi `in:fly` dihapus karena justifikasi tinggi hilang saat node keluar). Tinggi kartu = pane tertinggi → **tidak pernah lompat** saat ganti tab (terverifikasi: 246px konstan di Today/Form/Load, ketiga layer top & height identik). Bonus: tidak ada re-mount SVG/ring saat pindah-pindah tab.
- Terverifikasi DOM (vite preview): tab switch Today→Form→Load→Today mengganti konten benar (sparkline path ada; 7 bar `rgb(35,37,44)` + target 275 dari data; ring dasharray kembali), `aria-selected` bergeser, `aria-labelledby` pane mengikuti, layer tersembunyi `inert`, LIVE `opacity-30` tanpa pulse saat tak ada race live, chrome full-bleed h-36px + padding body 20px, dot tab aktif `rgb(232,16,46)`. `svelte-check` 0 error, build ±3s. Screenshot: chrome identik mockup H2 dengan ember gradient tetap satu momen.

## 18. v5.7.2 — Race live cockpit chrome (varian C, 2 Okt 2026)

- **Keputusan user**: terapkan bahasa browser-chrome §17 ke Race live cockpit (varian C dari §14): address pill dinamis berisi nama race + LIVE menyala otomatis.
- **Struktur**: buffer hero (`SectionCard dark kicker="Buffer vs cut-off"`) kini membuka **chrome row** `h-9 bg-black/40 border-b border-white/10`:
  - **Back button** di dalam chrome (ChevronLeft 18px, `aria-label="Back to setup"`) — header row live terpisah dihapus; satu baris chrome = back · address pill · LIVE.
  - **Address pill dinamis**: `rounded-pill bg-white/10 px-3 py-1` + ikon Lock 10px + **nama race dari Dexie** (`{name}`, `truncate` + `title` tooltip) — konteks jendela telemetri, bukan hiasan.
  - **LIVE menyala otomatis**: dot crimson `animate-pulse` + label — di cockpit `liveMode` selalu true sehingga LIVE selalu hidup (berbeda dari Dashboard yang bergantung `raceCard.live`). Chrome hanya ada di kartu live; mode setup tidak berubah.
- StatusChip status (Ahead of target / Watch the clock / Behind cut-off) tetap di pojok kanan atas kartu via snippet `right()`.
- Terverifikasi DOM: start race dari setup → chrome muncul, pill = "Bukit Barisan 200" (data Dexie, text-overflow ellipsis), dot LIVE `rgb(232,16,46)` + pulse, kicker "Buffer vs cut-off" tetap, back aria benar. Record race uji dibersihkan dari Dexie (tabel `races` clear — dev only) sehingga Dashboard kembali tanpa race (LIVE redup). `svelte-check` 0 error, build hijau.

## 19. v5.8 — Activity detail + Power curve (2 Okt 2026)

Celah §9.5 nomor 1 (activity detail belum bisa dibuka) ditutup, sekaligus kartu Power curve masuk Dashboard.

- **Router param**: `router.svelte.ts` kini menyimpan segmen kedua (`#/rides/<activityId>`) sebagai `route.detailParam` + helper `navigateTo(name, param)`. `#/rides` tetap list; `App.svelte` memilih `ActivityDetail` bila param ada.
- **List Rides**: tiap baris jadi `<a href="#/rides/:id">` dengan `aria-label="Open ride detail — {name}"`. Sparkline dekoratif (yang dulu diberi catatan "power curves land with M2") **diganti kurva mean-maks asli** per ride, diambil dari tabel `power_curves`.
- **ActivityDetail** (`routes/rides/ActivityDetail.svelte`), urutan kartu:
  1. Back pill + kicker tanggal + chip `source`/commute + judul `text-metric-hero`.
  2. **Dark monolith** dengan chrome row (`SectionCard dark` + snippet `chrome`): 3 angka — jarak, waktu bergerak, NP (watt).
  3. Grid 2×2 StatTile: IF (dengan sub `NP x W / FTP y W`), TSS, elevasi, energi (kcal + avg watt).
  4. **Power curve** — `PowerCurveChart` diberi prop `compare` untuk kurva all-time best di belakang kurva ride; StatTrio Best 5 min / Best 20 min / Ride W'.
  5. **Time in zones** — stacked bar + daftar 8 band dengan waktu/persen, warna ramp abu→crimson; legenda "x% ≥ sweet spot".
  6. Footer jujur: "IF dan TSS dinilai terhadap FTP n W, diukur tanggalnya".
- **Kegagalan yang jujur, bukan placeholder**: ride tanpa power (GPX/TCX) menampilkan empty state "No power in this file — GPX and TCX carry no watt data, so IF, TSS, zones and the curve stay blank rather than guessed." ID yang tidak ada → kartu "Ride not found" + link balik.
- **Honesty note pada grafik kurva**: kurva hanya diukur sampai durasi terpanjang yang pernah tercatat di database; teks di bawah grafik menyebut durasi itu eksplisit ("Longest measured effort: 1h 30m — the curve is flat past that point because it was never measured there"), bukan teks hardcode.
- **Kartu Power curve di Dashboard** (v5.7.3): kurva crimson + area, asimpot CP putus-putus dengan label `CP n W`, model `W'/t + CP` abu putus-putus, sumbu waktu logaritmik (1s…3h), StatTrio CP · W' · time-to-empty, dan legenda di `right()` berisi R².

## 20. v5.9 — M1 close-out: tren tubuh & editor zona (2 Okt 2026)

Empat celah M1 ditutup; semuanya di Settings kecuali satuan yang juga invade empat tampilan.

- **Body trend (F2-AC2)**: satu kartu dengan dua seri overlay — berat (crimson, **segmen lurus** antar-timbangan karena interpolasi adalah klaim yang tidak pernah dibuat atlet) dan FTP (abu, **digambar sebagai step** karena FTP berlaku berdasarkan tanggal dan berpindah saat dites). Sumbu Y kiri kg, kanan W; chip ringkasan `kg/wk` dan `+n W FTP` di header kartu. Sumber data: `domain/trend.ts`.
- **Power zones (F2-AC4)**: tiga template (Coggan 8 / 5 / 3-zone) sebagai pill, lalu tabel zona yang bisa diedit (nama + batas bawah % FTP) dengan ekuivalen watt yang dihitung live dari FTP saat ini. Batas bawah **tidak boleh duplikat dan harus mulai dari 0%** — karena batas atas selalu diambil dari batas bawah zona berikutnya, band selalu kontigu sehingga tidak ada daya yang jatuh di luar semua zona. Tombol Simpan (nonaktif bila tidak berubah / tidak valid), tambah zona, Reset.
- **Zona jadi milik-atlet**: `db.zones` menyimpan `ZoneSet` berversi; `queries.powerZones` membaca versi tertinggi, jatuh ke default bila belum ada. ActivityDetail dan Coach memakai hasil yang sama — mengubah template langsung mengubah angka "time in zones" tanpa restart.
- **Satuan imperial benar-benar dipakai** (`domain/units.ts`): convert hanya di sisi tampilan, data tersimpan tetap metrik. Dashboard (jarak 7 hari, W/kg → W/lb, ukuran komponen), Rides (baris daftar + kartu minggu), ActivityDetail (jarak, elevasi), Gear (odometer, wear). Elevasi imperial memakai separator ribuan spasi (`2 205 ft`).
- **Parser GPX/TCX dipindah ke domain** (`domain/course.ts`) agar bisa diuji: 16 tes fixture menutup GPX & TCX, pause > 90 s, fallback pace nominal, titik tanpa koordinat, dan penolakan file rusak. `Rides.svelte` sekarang hanya mengurus file picking + transaksi DB.

## 21. v6.0 — M3 physics: estimator Routes jadi ter-solve (2 Okt 2026)

Celah §9.5 nomor 5 ditutup. `AVG_KMH = 30` **dihapus**; hero "EST FINISH" sekarang hasil solver,
bukan pembagian jarak dengan konstanta. Tidak ada angka di layar Routes yang tidak berasal dari
`domain/physics.ts` + `domain/pacing.ts`.

### 21.1 Model di domain (pure, unit-tested)

- **`domain/physics.ts`** — `requiredPower` (gravitasi `m·g·sinθ` + rolling `Crr·m·g·cosθ` + aero
  `½ρCdA(v+w)²` + loss drivetrain), `solveSpeed` (bisection `v ∈ [vMin, vMax]`, mengembalikan
  `powerLimited` saat amplitudo daya melebihi watt target), `resampleProfile` (potong rute jadi
  segmen tetap, **termasuk titik interior** — berhenti di titik pertama yang melewati batas akan
  membuang separuh profil), `solveRide` (gabungan per segmen), `airDensity` (suhu **lokal**
  `tLocal = tSea − 0.0065·alt`, bukan suhu laut), `powerForSpeed` (kebalikan, untuk "berapa watt
  yang dibutuhkan untuk bertahan 15 km/h"), `totalMass`, `kilojoulesForRide`.
  Output `RideSolution` membawa `powerLimitedPct` + `peakRequiredW`.
- **`domain/pacing.ts`** — `resolveTargetWatts` (Endurance / Steady / Attack / Custom → watt
  dari IF × FTP), `totalStopSec`, `buildPlan` (pola daya: IF target ramping, NP konstan, atau
  power konstan), `clockOf`/`durationOf` (ETA jam lokal + durasi, tanpa konversi ganda).
  `RidePlan` membawa `powerLimitedPct`, `peakRequiredW`, `steepestGradePct`, `hardest`,
  dan `checkpoints[]` yang tiap barisnya punya `legKph` + `bufferMin` terhadap cut-off.
- **Konvensi yang diuji dan tidak boleh diregresi:** km/h → km/s harus `/3600` (bukan `/3.6` —
  dulu membuat ETA meleset 1000×), densitas udara pakai suhu lokal, `resampleProfile` tidak boleh
  `break` saat `f >= 1`. 58 tes baru (34 physics + 24 pacing).

### 21.2 Yang berubah di layar Routes

- **Profil asli, bukan ternormalisasi**: `rawProfile` (km & alt meter asli) menggantikan
  `profilePts` — grade di UI kini sama dengan grade di dunia, sehingga "km 118,4 · 6,2%" benar.
- **Panel SETUP jadi slider yang menggerakkan fisika**: cargo (kg), headwind (km/h), jumlah stop
  × menit, dan jam start. Setiap perubahan memicu `solveRide` ulang; tidak ada lagi slider
  dekoratif yang hanya mengubah label.
- **Checkpoint dari plan, bukan dari jarak/30**: setiap baris menampilkan grade, **kecepatan
  leg** (`legKph` — climb 23,7 km/h vs descent 40,8 km/h pada rute yang sama), ETA jam lokal,
  elapsed, dan untuk baris cut-off **buffer ± menit** dengan warna status. Baris finish
  (`isFinish`) dan baris CP (`isCp`) dibedakan secara visual.
- **Panel "hardest at km X"**: grade + kecepatan yang ditahan di titik tersulit rute, supaya
  angka hero bisa ditelusuri ke penyebabnya.
- **Banner kejujuran (dua kondisi, dua warna)**:
  - **KRITIS** bila `powerLimitedPct > 5` → "n% of the route is beyond n W … not rideable",
    menyebut ramp tercuram dan `peakRequiredW` yang dibutuhkan hanya untuk bertahan 15 km/h.
  - **WASPADA** bila `avgKph < 15` → "plan averages n km/h — too slow to be credible", dengan
    kalimat "the maths is solvable, but nobody rides this at n km/h". Banner ini menyoroti batas
    model dengan jujur alih-alih menampilkan angka presisi yang tidak percaya diri.
- **`planJson` yang disimpan** ikut membawa hasil solve (`powerLimitedPct`, `peakRequiredW`,
  `hardest`), sehingga M4 bisa baca buffer race tanpa menghitung ulang.

### 21.3 Verifikasi browser (2 Okt 2026)

Rute sample 200,4 km / 1 345 m D+ → **EST FINISH 6h 47m**, arrive **12:17**, avg **31,9 km/h**,
1 070 kkal, 198 W NP. Leg checkpoint benar-benar berbeda-beda (turun 40,8 km/h vs naik 23,7 km/h).
Headwind 25 km/h → proyeksi **19h 33m** + banner "too slow to be credible" muncul. Gerbang:
`npm test` 222 hijau, `npm run check` 0 error, `npm run build` hijau.

### 21.4 Yang sengaja belum ada

Chart kecepatan interaktif (uPlot) dan map preview MapLibre masih opsional/P1 — M3 ditutup
atas DoD intinya (ETA bergantung grade, arah perubahan logis, checkpoint dengan grade + ETA,
hitung < 1 s). `routes/race/Race.svelte` masih memakai `RACE_KM / AVG_KMH`; penggantiannya
adalah **M4** (`domain/race.ts` di atas solver ini).

## 22. v6.1 — Chart profil interaktif di Routes (uPlot) (2 Okt 2026)

Sisa opsional M3 (§21.4) yang paling terasa: chart kecepatan interaktif. SVG statis di kartu profil
diganti **uPlot** (`uplot` 1.6.32, satu-satunya dependensi chart di repo).

- **Dua seri dari satu sumber**: `domain/pacing.ts` menambah `planSeries(plan, maxPoints?)`
  yang mengubah solusi fisika menjadi baris chart — `km · altM · gradePct · kph · elapsedSec ·
  clockMin · powerLimited`. Baris pertama pada `km 0` dengan alt yang direkonstruksi dari
  `riseM` segmen pertama, karena segmen pertama hanya menyimpan alt *akhir*; tanpa itu chart
  mulai satu langkah terlambat dan hasil finis terlihat kurang.
- **Stop dihitung dengan jarak, sama persis seperti tabel checkpoint**, jadi `elapsedSec` baris
  terakhir identik dengan `plan.elapsedSec` — tooltip tidak boleh berbeda dengan angka hero
  (diuji, bukan asumsi).
- **Decimation jujur**: rute panjang ditipiskan dengan stride yang pas di budget **tanpa
  melewatkan indeks terakhir** (`ceil((n−1)/(max−1))`, bukan `ceil(n/max)` yang meleset satu).
  Titik `powerLimited` **selalu dipertahankan** selama muat di budget — KRITIS tidak boleh
  hilang hanya karena chart-nya diipis. Bila tembok saja melampaui budget, stride menang dan banner
  kejujuran tetap melaporkan persentase yang hilang.
- **Crosshair tooltip** (DOM, bukan canvas, supaya bisa pakai token desain): `KM x.x`,
  `±y.y% grade · zzz m`, `w.w km/h`, `hh:mm in · HH:MM`. Needle ke titik terdekat
  (`focus.prox: -1`), draggable hanya di sumbu x (`setScale: false`) supaya menggarap chart
  tidak mengubah skala. Tooltip membalik sisi di 55% lebar supaya tidak keluar kartu.
- **Skala ganda jujur**: altitude kiri, kecepatan kanan (`side: 1` — tanpa itu uPlot menumpuk
  dua label sumbu di kiri dan terbaca sebagai satu angka rusak). Sumbu x menampilkan KM
  apa adanya. Legenda hanya tiga butir nyata: Altitude · Speed · **Beyond target**
  (hanya muncul saat ada tembok), plus "Drag or hover".
- **Rute tanpa profil** → empty state, bukan sumbu kosong.

Verifikasi browser: hover KM 100,0 → `+0.0% grade · 128 m · 33,8 km/h · 3h 11m in · 08:41`;
hover KM 160,0 → `+2.0% grade · 1200 m · 23,5 km/h · 5h 58m in · 11:28` — turunan di km 200
turun ke ~40 km/h sesuai hasil checkpoint tabel di bawahnya. Beralih ke Endurance (IF 0.65) → hero
**7h 06m / arrive 12:36 / avg 30,4 km/h**, chart menyolve ulang. Gerbang: `npm test` **230 hijau**,
`npm run check` 0 error, `npm run build` hijau.

## 23. v6.2 — SpeedProfileChart dipakai ulang di live cockpit (2 Okt 2026)

Chart profil §22 tidak dipfork untuk race mode. `SpeedProfileChart` mendapat tiga prop opsional
dan satu snippet, semua defaults-nya mempertahankan tampilan Routes persis.

- **`markers: ChartMarker[]`** — garis vertikal putus-putus per cut-off, **dengan label jam
  cut-off** (bukan nama gate — nama & buffer-nya sudah ada di chip dan tooltip). Warna marker
  mengikuti tone status. Label digambar di atas **pill putih** supaya tetap terbaca di atas
  area altitude dan tidak menabrak sumbu kecepatan kanan; membalik sisi otomatis bila dekat
  tepi kanan.
- **`positionKm`** — garis merah solid + **dot putih di atas garis speed**, supaya posisi
  terbaca sebagai *tempat di rute*, bukan sekadar garis potong. Legenda otomatis menambah
  butir `Cut-off` dan `You` hanya bila keduanya memang ada.
- **`tooltip` snippet** — mengganti readout default. Cockpit memakai: `KM x.x` ·
  `±y.y% · zzz m · w.w km/h` · `±n min vs <gate>` (warna status) · `HH:MM · n.n km to gate`.
- **`onhover`** — callback `(row | null)`; Race menyimpan `probeKm`, lalu
  `gateBufferAt(rows, gates, km)` menghitung buffer terhadap gate. Crosshair jadi sumber
  angka, bukan cuma tampilan.

### 23.1 `domain/race.ts` (slice 1 M4)

- `gateBufferAt(rows, gates, km)` — gate yang diukur adalah **cut-off pertama di depan
  posisi** (duduk 5 km sebelum cut-off justru saat orang paling mau tahu sisa waktu); kalau
  semua gate sudah terlewat, gate terakhir yang menang karena finish cut-off yang berlaku.
  Posisi **diinterpolasi** antar-baris supaya jam_clock kontinu, dan **di-clamp** di luar
  rute — bukan diekstrapolasi jadi angka fiksi. Mengembalikan `null` bila tidak ada gate
  sama sekali: "tidak ada gate" tidak boleh terbaca sebagai "aman".
- `feasibility(bufferMin)` — AMAN ≥ 20 m · WASPADA ≥ 0 · KRITIS < 0, ambang sama dengan
  status strip cockpit agar chip dan tooltip tidak pernah beda bahasa.
- `lastGatePassed` — gate terakhir yang terlewat.
- 10 tes, termasuk kasus "plan-nya sendiri telat 15 menit → KRITIS".

### 23.2 Race cockpit

- **Profil rute nyata dimuat dari Dexie** (`fetchRouteProfile` di `queries.svelte.ts`,
  inflate `routes.pointsCompressed`) lalu `buildPlan` dengan parameter yang sama seperti
  halaman Routes: berat TERKINI dari `weight_log`, bike aktif (CdA/Crr), cargo, IF × FTP,
  stop policy, dan `vMaxKph: 55` — turunan diambil dengan kecepatan kendali, bukan cap
  free-ride.
- **Bug nyata yang ketemu saat verifikasi**: `saveAndStart` hanya menulis `routeId` saat
  race **baru** dibuat. Race yang sudah ada lalu di-restart tetap menunjuk `stub-route`,
  sehingga chart kosong padahal GPX-nya sudah ada. Fix: `db.races.update` sekarang juga
  menulis `routeId`, `checkpoints`, dan `planJson`.
- **Chart kosong tidak pernah berarti rute palsu**: tanpa profil tersimpan, kartu
  meng-empty dengan instruksi ("import a GPX on the Routes page") dan chip `NO GPX`.
- **`RACE_KM` diganti `raceKm`** (jarak rute sebenarnya) di `kmAtClock`, `reqPace`, dan
  `progressPct` — sebelumnya halaman live memakai 200,4 km apa pun rute yang dipilih.
- Chip status di header kartu ikut crosshair: `+62m CP2 PAYAKUMBUH` (AMAN) →
  `FINISH MISSED` (KRITIS), mengikuti probe terbaru.
- Catatan jujur di bawah chart: "Position follows your plan until you log a checkpoint."

Verifikasi browser (GPX 200,4 km diimpor): crosshair KM 76,4 → `+1,6% · 1144 m · 26,3 km/h ·
+62 min vs CP2 Payakumbuh · 08:28 · 43,6 km to gate`; KM 131,4 → `−107 min vs Finish`
(KRITIS); KM 202,1 → `−217 min` dengan chip `FINISH MISSED`. Gerbang: `npm test`
**240 hijau** (10 tes baru), `npm run check` 0 error, `npm run build` hijau 2,60 s.

## 24. v6.3 — Chart bisa di-pin (klik / ketuk) (2 Okt 2026)

Hover saja tidak cukup: begitu pointer keluar dari plot, readout hilang — padahal justru saat
itu orang sedang **membaca** angka, bukan sedang menyorot hover-nya. Klik/tap sekarang
**menancapkan** readout sampai dilepas.
- **Dua sumber readout, satu tooltip**: `active = pinned ?? hover`. Pin menang sampai
  dibatalkan; crosshair boleh bergerak bebas di bawahnya tanpa mengubah isi tooltip.
- **Tiga cara melepas**: klik lagi di titik yang sama (toggle), tombol **✕** di pojok tooltip,
  atau **Esc**. Legenda juga berubah jadi `Clear pin` yang bisa diklik — hint dan aksi di
  tempat yang sama.
- **Penanda di canvas** (bukan cuma DOM): garis vertikal ink + **cincin kosong** di titik
  speed + **panah kecil** di atas. Cincin kosong dipilih dengan sengaja — berbeda dari dot
  **penuh** yang menandai posisi=live, jadi "sedang melihat" vs "sedang rides" tidak tertukar.
  Pin digambar **paling akhir** agar tidak tertutupi garis posisi.
- **Tooltip tetap tembus-klik**: container `pointer-events-none`, hanya tombol ✕ yang
  `pointer-events-auto`. Versi pertama memakai `pointer-events-auto` pada seluruh card
  sehingga tooltip **menutupi klik berikutnya** dan pin tidak bisa digeser.
- **Aksesibilitas chart canvas** — tanpa ini, chart adalah area mati bagi keyboard:
  - Host=`role="slider"` + `tabindex=0` + `aria-valuenow/valuetext` (slider, bukan
    `application`: memang menyeleksi satu nilai di sepanjang rentang).
  - `←/→` memindahkan pin satu baris, **Shift** melompat sepersepuluh rute, `Home/End` ke
    ujung, `Esc` melepas. Panah pertama tanpa pin akan menancapkan crosshair yang sedang aktif.
  - Focal ring `focus-visible` crimson, sesuai token app.

### 24.1 Readout pindah ke pita di atas chart (tidak menutupi pointer)

Readout **bukan** kartu melayang di dalam plot. uPlot meletus di dalam canvas, dan
apa pun yang diletuskan di dalam plot **menutupi sesuatu yang Sedang ditanyakan** — di atas
puncak justru menutupi pendakian yang sedang dibaca, di atas garis cut-off menutupi label
cut-off. Sekarang readout duduk di **pita 62px di atas canvas** (`absolute inset-x-2`,
tinggi tetap), jadi chart tidak pernah reflow dan tidak ada yang tertutup.
- **Caret** kecil di bawah pita yang mengikuti pointer: `left` di-clamp `0..hostWidth−8` +
  `translate-x-1/2`, jadi tidak pernah keluar dari host. Datarinya deshalb pita masih terasa
  "terhubung" ke titik yang sedang dibaca meski tidak ada yang tertutup.
- **Placeholder** — saat tidak ada hover/pin, pita menampilkan kartu dashed
  `Hover or click the profile for details`, sehingga tinggi band tidak berubah-ubah.
- Container pita tetap `pointer-events-none`, hanya tombol ✕ `pointer-events-auto`.

### 24.2 Dua jebakan uPlot yang harus diketahui

1. **`stopImmediatePropagation` saat drag.** uPlot memasang handler `click` di fase *capture*
   pada `.u-wrap` dan memanggil `stopPropagation()` + `stopImmediatePropagation()` kalau ia
   mendeteksi drag (`mouseLeft1 != mouseLeft0`). Akibatnya handler `click` di `.u-over`
   **hanya berjalan sekali** — klik kedua hilang. Fix: listener dipasang di **capture pada
   elemen host** (melewati `.u-wrap` uPlot), dengan guard `e.target === plot.over`.
2. **Chart boleh kosongnya `scales.x`.** uPlot menghitung auto-range saat konstruksi; kalau
   kontainer **belum selesai di-layout** (chart di dalam live layout yang berubah), `scales.x`
   tetap `null`, semua seri runtuh ke `idxs [0,0]`, dan chart **merender kosong** padahal DOM
   sehat. Terlihat hanya di Race cockpit; Routes normal. `plot.setData(data, true)` tidak
   menolong. Fix: bangun array data secara sinkron di `$effect`, lalu **konstruk uPlot di
   `requestAnimationFrame` berikutnya** (`cancelAnimationFrame` di cleanup).
3. **`posToIdx` bukan indeks array kita.** Ia mengembalikan indeks ke array data *uPlot*,
   yang hanya sama dengan `points` bila tidak ada decimation. Setelah `planSeries`
   menipiskan baris, indeksnya bergeser. Fix: baca **nilai** lewat `posToVal(..., 'x')` lalu
   cari baris terdekat sendiri — tahan terhadap perubahan skema data.

Verifikasi browser: pita readout overlap dengan chart **−25 px** di Routes dan di Race (caret
bottom 388 < chart top 411) — tidak ada yang tertutup; chart Race merender 18953 px merah
sebelumnya 0. Klik 30% → `KM 60.0`; klik 70% → `KM 140.0`; crosshair bergerak ke pojok
kiri → tooltip tetap `KM 140.0`; klik lagi di titik sama → tooltip hilang; ✕ → bersih;
`Shift+→` melompat; `End` → `KM 200.4`; `Esc` → bersih. Di Race cockpit: klik 55% →
`KM 0.0 · 33.5 km/h · +240 min vs CP2 Payakumbuh · 05:30 · 120.0 km to gate`, chip header
ikut `+240M CP2 PAYAKUMBUH`. Gerbang: `npm test` 240 hijau, `npm run check` 0 error,
`npm run build` hijau.

## 25. v6.4 — Hero Race membaca plan, bukan konstanta (2 Okt 2026)

`RACE_KM = 200.4` dan `AVG_KMH = 30` dihapus. Semua angka di halaman Race — durasi plan,
ETA, buffer, projected finish, required avg, sektor terlambat — sekarang diturunkan dari
`buildPlan` atas profil GPX yang sama dengan chart di bawahnya.

### 25.1 Bug: buffer hero yang mengukur dirinya sendiri

Buffer live sebelumnya **selalu `+0h 00m`**, di setiap race, tanpa kecuali. Sebabnya tautologi:

```
reqPace   = sisaKm / jamSisa   ← jamSisa = waktu menuju cut-off
finishMin = sekarang + sisaKm / reqPace   ← = sekarang + jamSisa = cut-off
buffer    = cut-off − finishMin = 0
```

`finishMin` diturunkan dari `reqPace`, dan `reqPace` sendiri diturunkan dari waktu ke
cut-off — jadi keduanya saling meniadakan. Buffer yang diukur terhadap dirinya sendiri bukan
pengukuran. **Fix:** proyeksi finis memakai *sisa plan* dari posisi aktual —
`planMinutesBetween(rows, kmAtClock, raceKm)` — sehingga buffer jadi perbedaan antara dua
hal yang benar-benar berbeda: tempat kamu sekarang, dan waktu cut-off.

Konsekuensi: `required avg` kini **benar-benar** berarti "yang harus kamu tahan sekarang",
sesuai labelnya, bukan lagi kebalikan dari definisi finish.

### 25.2 Helper domain baru (`race.ts`)

- `clockAtKm(rows, km)` — jam plan di jarak tertentu (interpolasi, clamp di luar rute).
- `kmAtClock(rows, clockMin)` — kebalikannya. Ini yang menggantikan asumsi "kecepatan
  konstan" di penanda live: sebelum checkpoint pertama di-log, penanda ditempatkan **tepat di
  kurva hasil solve**, bukan di interpolasi kecepatan rata-rata.
- `planMinutesBetween(rows, from, to)` — sisa menit plan, sudah termasuk stop. Directional:
  tujuan yang sudah terlewat mengembalikan `0`, bukan negatif.

### 25.3 `slowestWindows(solution, count, windowKm)` — dan Jebakan `Segment.distKm`

Tiga sektor "Col de Barisan / 6.2% / 48m / 210 W" sebelumnya **dihard-code** dan tidak pernah
di-solve; kartu "where it hurts" bisa seenaknya bertentangan dengan estimasi finis di
kartunya sendiri. Sekarang diturunkan dari solusi solver yang sama.

Jebakan yang ditemukan saat implementasi: **`Segment.distKm` adalah jarak di *akhir* segmen,
bukan panjang segmen itu sendiri** (diisi `b.distKm` oleh `solveRide`). Menjumlahkan
`distKm` untuk mengukur panjang window mengompound total jarak dan mengarang turunan
**251 km/h** pada rute yang di-cap 55 km/h. Panjang segmen harus dari selisih `cumDistKm`.
Ada tes regresi yang mengunci `kph <= cap`.

Jendela non-overlapping, diambil paling lambat lebih dulu, lalu dilaporkan **urutan rute**.
Gradien dibobot jarak (`riseM / km`), bukan rata-rata per segmen.

### 25.4 "Tidak diketahui" adalah jawaban yang sah

Sebelumnya `raceKm` jatuh ke `RACE_KM` bila profil kosong — jadi halaman tanpa GPX tetap
menampilkan angka seolah-olah plan-nya ada. Sekarang semua proyeksi nullable dan `null`
dirender sebagai state jujur:

- Hero: `—` + label `NO PLAN`, chip `No plan` (netral — bukan hijau).
- Cut-off CP: chip `no projection`.
- Sektor: pesan "import a GPX".
- `status` mendapat nilai `unknown`, dan `statusMsg` menjelaskan kenapa: tidak ada verdict
  tanpa plan.

**Jangan** pernah merender "Ahead of target" di atas plan yang gagal di-solve: hijau tanpa
bukti adalah kebohongan yang lebih berbahaya daripada kosong.

Verifikasi browser: setup → `7h 10m`, buffer `+5H 50M`, ETA `12:40`, avg `33.0 km/h`
(react ke profil & power); sektor `KM 40–50` @ `25.4 km/h`, `KM 50–60` @ `24.9 km/h`,
`KM 60–71` @ `25.2 km/h`. Live → projected finish `23:08`, buffer `−278m` (`−4h 38m`),
required avg `100.8 km/h`. Gerbang: `npm test` 256 hijau, `npm run check` 0 error 0 warning,
`npm run build` hijau 3.28 s.

## 26. v6.5 — M4: feasibility vs CP/W′ (2 Okt 2026)

`powerForSpeed` dan `wPrimeRemaining` sudah ada sejak M2/M3 tapi **tidak pernah tersambung ke
apa pun** di halaman Race. Itu gap M4 yang tersisa: model pacing menjawab "berapa lama power
ini menyelesaikan profil", dan itu selalu mengasumsikan target bisa dipertahankan dari tangki
penuh. Menyelesaikan M4 berarti bertanya *"apa yang masih tersisa?"*.

### 26.1 Dua koreksi model — keduanya kacau di percobaan pertama

**W′ bukan fungsi waktu tempuh.** `wPrimeRemaining(fit, seconds)` adalah hubungan **kurva
model** `P(t) = W′/t + CP` — total kerja yang dicadangkan model minimal — bukan aturan
deplesi. Memberinya elapsed time memperlakukan setiap detik seolah menempel di asimtot, dan
menguras tangki dalam hitungan menit di ride mana pun. Di browser, versi pertama langsung
tampil `W′ 0% · 0.0 KJ` bahkan di posisi start, yang jelas salah: W′ habis karena **kerja di
atas CP**, dan justru **pulih** di bawahnya.

Fix: `wPrimeSpentAt(segments, fit, km)` mengintegralkan plan — surplus daya di atas CP
menguras tangki, defisit di bawah CP mengisinya kembali, dan daya yang tepat di CP itu
gratis. Inilah kenapa ultra delapan jam berakhir dengan W′ utuh, sementara race yang
berulang di atas CP tidak. Nilai di-clamp ke `[0, wPrime]`: turunan panjang tidak bisa membuat
W′ negatif, dan pembalap tidak bisa menabung melebihi tangki.

**Cadangan tanpa durasi runtuh ke tepat CP.** `availableW = cp + wPrimeLeft / t_lim`, dengan
`t_lim = W′/CP`, secara matematika **selalu** mengembalikan tepat `cp` — untuk **ukuran tangki
apapun**. Tangki 2 kJ akan meminjam sebanyak tangki 20 kJ, yang tidak masuk akal.
Penyebabnya: cadangan daya hanya bermakna relatif terhadap **berapa lama** harus dipertahankan.
5 kJ memberi sekitar 167 W di atas CP selama 30 detik, tapi hanya sekitar 8 W bila harus
bertahan 600 detik.

Fix: `sustainAt(..., horizonSec)` — horizon itu adalah **ruas yang harus dilalui**, dalam
cockpit = jarak ke cut-off berikutnya (bukan sisa seluruh race). Pinjaman tetap di-cap `W′/CP`,
jadi tangki tak terbatas tidak menjanjikan daya tak terbatas.

### 26.2 Yang ditampilkan

- **Tooltip crosshair**: `{requiredW} W needed · {availableW} W left at CP/W′` +
  `W′ {persen}%` + alasan singkat. Di atas CP, persentasenya benar-benar turun seiring perjalanan.
- **Kartu "W′ at this pace"** di blok Status: chip persentase + kJ tersisa, dan baris
  `{requiredW} W needed here · CP {cp} W · {availableW} W available · {reason}`.
- Tanpa CP fit: chip `No CP fit` netral plus ajakan ride dengan power — **bukan** hijau default.

Verifikasi browser dua arah (CP fit 231 W dari data seed): pada IF 0,70 (195 W) →
`W′ 100% · 13.8 kJ`, `Pace sits below CP — sustainable indefinitely`; pada IF 0,95 (261 W) →
`W′ 0%`, `271 W needed · 231 W left`, `W′ is spent`. Kesimpulan berubah sesuai power yang
dibutuhkan. Gerbang: `npm test` 275 hijau, `npm run check` 0 error 0 warning, `npm run build`
hijau 2.82 s.

## 27. v6.6 — E2E race cockpit dengan clock simulasi (2 Okt 2026)

Item terakhir DoD M4: suite E2E yang mengendarai cockpit dengan jam palsu dan memeriksa
buffer — termasuk dalam kondisi offline.

### 27.1 Kenapa E2E ini meng-*assert hubungan*, bukan angka

Bug yang harus ditangkap suite ini adalah §25.1: hero buffer yang selalu `+0h 00m` karena
projected finish diturunkan dari required pace, dan required pace diturunkan dari sisa waktu
ke cut-off — keduanya saling meniadakan. Tes yang menulis *"BUFFER harus +0h 00m"* akan
**lulus** terhadap build yang rusak itu. Jadi assertion berbebannya adalah klaim
konsistensi:

- `buffer` = `cut-off − projected finish` (selisih ≤ 1 menit),
- `buffer` bukan nol,
- jam maju → `km done` naik, `km to go` turun, `required avg` turun,
- logged checkpoint benar-benar menggerakkan proyeksi.

Nilai literal hanya muncul di tempat form setup sendiri yang mengaturnya (roll-out 05:30).

**Bukti bahwa suite ini benar-benar menangkap regresi:** tautologi lama diinjeksi balik ke
`Race.svelte` dan suite dijalankan — **5 dari 10 tes gagal**, termasuk "buffer equals the gap".
Setelah dikembalikan: 10/10 hijau. Tes yang tidak pernah gagal tidak membuktikan apa pun.

### 27.2 Clock palsu, dan jebakan `startTimeMs`

Race cockpit membaca `Date.now()` saat init, jadi jam harus dipasang **sebelum** navigasi —
`page.clock.install()` di `page.goto` sesudahnya akan diabaikan diam-diam dan setiap
assertion akan mengukur waktu dinding. `timezoneId` di-*pin* ke Asia/Jakarta karena
"roll-out 05:30" harus berarti instant yang sama di setiap mesin.

Temuan yang harus dicatat: **projected finish sengaja INVARIAN** ketika rider persis
mengikuti plan. Jam 10:00 dan 11:30 sama-sama proyeksi 12:49, karena datang lebih awal dan
menempuh lebih jauh saling meniadakan — itu benar secara fisika, bukan clock beku. Yang
harus bergerak adalah `km done` / `km to go` / `required avg`. Tes pertama kali gagal karena
menganggap sebaliknya; ini dicatat di `§27.1` supaya tidak diulang.

### 27.3 Fixture menyemai IndexedDB, bukan `seed.ts`

`seed.ts` mengisi athlete, bikes, components, activities, streams — **tidak** `routes`
atau `races`. Seluruh nilai cockpit bergantung pada profil yang ter-solve, jadi suite yang
memakai seed hanya akan menguji state "No GPX". Daripada memperluas seed produksi (yang akan
meletakkan rute palsu di layar pertama setiap pengguna), tes menyemai persis baris yang
dibutuhkan:

- store **tidak** dibuat di fixture — skema milik Dexie di `db.ts`; membuatnya dengan
  indeks berbeda akan membuat aplikasi melempar `SchemaError` saat dibuka,
- profil adalah sinusoid 200 km dengan pendakian nyata, bukan garis datar —
  `powerForSpeed` menilai *gradien*, dan di rute datar semua jawaban feasibility jadi
  "sustainable" secara trivial,
- kompresi memakai `CompressionStream('deflate-raw')` yang sama dengan `deflateJson`,
  sehingga byte-nya benar-benar lewat `inflateJson`, bukan jalur fallback JSON biasa.

### 27.4 Gate baru

`npm run test:e2e` (butuh `npm run test:e2e:install` sekali). `npm run test:all` menjalankan
unit + E2E. E2E berjalan terhadap **build preview**, bukan dev server: klaim offline hanya
bermakna untuk output build dengan service worker dan bundel ter-minify-nya.

`vitest.config.ts` dipisah dari `vite.config.ts` karena file E2E memakai sufiks `.spec.ts`
konvensi Playwright; tanpa `include` eksplisit, Vitest akan mengoleksinya dan gagal di
runner yang salah.

## 28. v6.7 — Readout course: pita tumbuh, isi dirapatkan (2 Okt 2026)

Pita readout diperbaiki agar tidak pernah menutupi chart **dan** tidak lagi meluber sendiri.

### 28.1 Akar masalahnya: tinggi tetap plus kartu absolut

§24.1 memindahkan popup ke pita 62 px di atas canvas dengan **tinggi tetap**, supaya chart tidak
pernah reflow. Prinsipnya benar, tapi implementasinya rapuh: kartu di dalam pita memakai
`absolute`, sehingga **kartu bisa tumbuh tanpa membatasi pita**. Ketika §26 menambah dua baris
CP/W′ ke tooltip, isinya menjadi **118 px di pita 62 px** — overflow 56 px, dan baris
terakhir `W′ 100% · Pace sits below CP — sustainable indefinitely` jatuh tepat **menimpa
legenda chart**.

Yang membuat ini lolos begitu lama: **semua teksnya tetap ada dan terbaca**. Tidak ada error,
tidak ada elemen hilang — hanya berantakan. Bug visual bukan bug fungsional, jadi tidak pernah
muncul di tes teks.

Aturan yang dipakai: *apa pun yang bisa berubah ukuran harus diukur oleh layout yang memiliki
itu.* Pita sekarang `min-h-[62px]` (tinggi saat collapsed tetap) dan kartunya **in normal
flow**, bukan `absolute`. Chart tetap tidak reflow saat collapsed, dan pita melebar justru
ketika readout butuh ruang.

### 28.2 Readout dirapatkan dari enam baris jadi tiga

Enam baris (KM / grade-alt-kph / buffer / jam / gate / W′ plus alasan) terasa berantakan di
pita selebar kartu. Sekarang tiga baris, masing-masing menjawab satu pertanyaan:

1. **Baris identitas** — `KM 131.4` · `+163 min` (berwarna menurut feasibilitas) · `10:17`
2. **Baris medan** — `-1.2% · 1316 m · 41.1 km/h · 88.6 km to Finish`
3. **Baris W′** — chip `W′ 100%` + `227 W needed · 233 W left`

Alasan lengkap (`Pace sits below CP…`) **dihapus dari tooltip** — ia sudah ada di kartu
`W′ at this pace`, jadi mengulangnya di sini hanya menggandakan isi. `truncate` dipakai pada
baris jam dan W′ supaya label cut-off yang panjang tidak memaksa pita melebar.

### 28.3 Tes geometri, bukan tes teks

Tiga tes E2E baru mengukur piksel: `card.bottom` tidak boleh melewati `plot.top` di tiga posisi
horizontal, caret tidak keluar host di tepi kiri dan kanan, dan tombol ✕ saat pin tetap di
dalam kartu. Selector memakai **struktur** (`div.relative > div`), bukan index.

**Bukti menangkap regresi:** pita dikembalikan ke `h-[62px]` lalu suite dijalankan — tes gagal
dengan pesan `readout overflows its band at 0.15`. Dikembalikan: 13/13 hijau.

**Jebakan yang ditemukan saat menulis tes:** di viewport ponsel, kotak `.u-over` melaporkan
**y negatif** (−524) karena chart berada di bawah lipatan. `page.mouse.move` tidak akan pernah
menyentuh koordinat yang tidak ada di layar, sehingga crosshair tidak pernah bergerak dan tes
gagal untuk alasan yang sama sekali tidak terkait. Hover karena itu di-*dispatch* langsung ke
`.u-over` dengan koordinat yang sama — persis cara komponen berperilaku di bawah touch, di
mana hover memang tidak ada.

---
## §29 — Pascalarace: hasil aktual vs estimasi (v6.8)

DoD terakhir M4, dan yang paling sering dianggap "tinggal tampilkan angka".

### 29.1 Akar masalahnya bukan display

`planJson` menyimpan **pengaturan** rider (`ifTarget`, `cargoKg`, `stopsMin`, `bikeId`) —
bukan **jawaban solver**. `Finish & save` menulis `actualFinishMin`/`actualKm`/
`actualBufferMin`, tapi tidak ada pernah ada sisi lain untuk dibandingkan. Jadi item DoD
ini bukan sekadar belum ditampilkan: secara harfiah **tidak bisa diukur** oleh data yang
tersimpan.

Perbaikannya di dua tempat:

- `saveAndStart()` menulis `plannedFinishMin` (jam selesai yang disetujui) **sebelum
  start**, Plus `plannedKm` untuk konteks. Inilah satu-satunya baseline yang sah.
- `raceOutcome()` di `domain/race.ts` membandingkan `plannedFinishMin − startMin` dengan
  `actualFinishMin`, mengembalikan `deltaMin` dan `deltaPct`.

### 29.2 Keputusan: ditampilkan, **tidak** diterapkan

`readoutOfOutcomes` melaporkan median antar-balapan, tapi **tidak ada faktor yang
kembali ke `buildPlan`**. Alasannya bukan conservatism belaka:

1. Satu balapan bukan sampel. Menerapkan faktor dari satu finish akan membengkokkan
   setiap proyeksi berikutnya berdasarkan satu hari yang bisa sajacket, mechanically, atau
   cacat.
2. Menyembunyikan angka mentah menghapus bahan yang justru dibutuhkan M5 untuk
   mengkalibrasi dengan benar.
3. Proyeksi yang sudah hijau dan teruji E2E tidak boleh dirusak oleh kalibrasi yang belum
   terbukti.

Jadi median dibacakan sebagai **laporan**, dengan kalimat yang menyatakannya eksplisit di
kartu: *"reported, not applied — your next plan still uses the same solver."*

### 29.3 `null` berarti tidak terukur, bukan tepat sasaran

`raceOutcome()` mengembalikan `null` bila salah satu sisi tidak ada, atau bila plan
bernilai ≤ 0 (persentase jadi 0/0). Balaman yang selesai **sebelum** fitur ini ada punya
aktual tanpa baseline — persis keadaan semua entri lama. Baris itu tetap tampil dengan
chip netral **`NOT MEASURED`**, bukan disembunyikan dan bukan diberi skor.

Menyembunyikannya akan membuat celah data tampak seperti ruang kosong, yaitu persis
tampilan yang membuat checkbox kosong kehilangan makna.

### 29.4 Kartu dan tes

Kartu **Past races · estimate vs actual** muncul di halaman setup, sebelum CTA. Badge
`MEDIAN +6%` di kanan kicker; tiap baris menampilkan `plan 7h 19m → actual 7h 45m` dan
chip delta bertanda._netral|aman|waspada sesuai arah.

Tiga tes E2E (`post-race record`): perbandingan terhadap baseline tersimpan, race yang
baru saja di-*finish* mendarat dengan waktu tempuh yang benar, dan **koreksi tidak pernah
dilipat balik** ke kartu plan berikutnya.

Fixture menyemai **dua** balapan lampau — satu ber-baseline, satu legacy tanpa baseline —
supaya fallback `NOT MEASURED` diuji oleh data tersimpan sungguhan, bukan nilai yang
dijejikkan saat test berjalan. Keduanya disemai lewat IndexedDB mentah **sebelum** app
memuatnya: `liveQuery` Dexie hanyaariah melihat mutasi pada koneksi itself, jadi tulis
mentah dari koneksi kedua tidak akan pernah sampai ke UI.

**Bukti menangkap regresi:** `plannedFinishMin` di `saveAndStart` diganti `null` lalu
suite dijalankan — tes *"a race finished now lands on the card"* gagal. Dikembalikan: 17/17
hijau.

**Jebakan yang ditemukan:** `StatusChip` meng-uppercase label via CSS, jadi `innerText`
membaca `+26M`, bukan `+26m`. Assertion teks harus mengikuti apa yang benar-benar
dirender.
## §30 — Menjalankan DoD yang tidak pernah dijalankan (v6.9)

Bukan perubahan visual, tapi mengubah apa yang boleh diklaim aplikasi.

### 30.1 Tujuh dari sembilan kotak DoD M0–M2 ditutup — dua di antaranya menemukan bug

Sembilan kotak M0–M2 sudah kosong sejak fase itu ditandai *Done*. Menjalankannya bukan
ritual: dua di antaranya **rusak**.

| Kotak | Hasil |
|---|---|
| Lighthouse PWA ≥ 90 · performa ≥ 90 | **PWA 100 · performa 98** |
| Shell tetap tampil offline | ✅ E2E |
| Import GPX 200 km < 2 s | **59 ms** |
| Berat & FTP terlog + terlihat di grafik | ✅ E2E |
| Sepeda/komponen + odometer bertambah | ✅ E2E |
| Export → hapus → import identik | ✅ E2E — **menemukan 2 bug** |
| 500 aktivitas → dashboard < 100 ms | **terburuk 11,7 ms** |

### 30.2 Bug 1 — backup membuang `power_curves`

`backupJson()` menulis daftar tabel **secara manual** (14 nama) dan sudah ketinggalan
`power_curves` sejak schema v2. Jadi export → hapus → import menghapus mean-max power curve
beserta fit CP/W′ — datanya sendiri yang membuat M2 berfungsi.

Daftar ditulis tangan gagal **tepat saat ada yang diperluas**, dan itulah occasion-nya: v2
datang, seseorang menambah tabel, tidak ada yang Thinking perlu menambah nama tabel itu juga.
Sekarang daftar diambil dari `db.tables`, sehingga tabel baru tidak bisa lagi tertinggal.

### 30.3 Bug 2 — "Delete all data" dibatalkan oleh seed sendiri

Setiap tabel dijaga `count() === 0`, jadi mengosongkan semuanya membuat boot berikutnya tak
terbedakan dari kunjungan pertama. Hasilnya: 24 ride demo, 2 sepeda, dan riwayat berat
kembali **detik** setelah dialog menjanjikan *"this cannot be undone"*.

Perbaikannya adalah penanda `localStorage` (`zonadua.wiped`), **bukan** di Dexie — karena wipe
itu sendiri menghapus setiap tabel, termasuk tempat penandanya akan tinggal. `localStorage`
bertahan, jadi "hapus semua" sekarang benar-benar berarti semua.

Penanda `zonadua.seeded` ditambahkan sekaligus: boot berikutnya melewati `ensureSeeded()` dan
`backfillMetrics()` sepenuhnya, yang juga menghapus pekerjaan startup yang berulang.

### 30.4 Lighthouse 12 menghapus kategori PWA

DoD ini menulis "Lighthouse PWA ≥ 90". Di Lighthouse 12 kategori PWA **sudah tidak ada**,
sehingga baris itu berubah dari *belum diverifikasi* menjadi *tidak bisa diukur* — dan jalan
paling murah untuk "menutupnya" adalah melaporkan 0, yang sama sekali berbeda artinya.

Dependensi dipin ke `11.x` selagi baris ini ada di papan, dan `scripts/audit-lighthouse.mjs`
**menolak keras** bila sebuah kategori tidak dilaporkan. Ambang di skrip itu menyalin kata-kata
DoD apa adanya; menurunkannya agar build hijau akan menggeser gawang tanpa menggeser aplikasi.

Audit berjalan di atas build produksi (`vite preview`), bukan dev server — apa pun yang
diklaim tentang PWA tidak ada di `vite dev`.

### 30.5 Tiga jebakan saat menulis tes ini

1. **Toast di-uppercase lewat CSS.** `getByText(/weight 71\.4 kg logged/i)` gagal karena
   `innerText` membaca `WEIGHT 71.4 KG LOGGED`. Assertion harus mengikuti apa yang benar-benar
   dirender.
2. **IndexedDB accept 5000 baris.** Di menu Settings, `input[type=number]` berurutan
   Height, Weight, FTP — mengisi `nth(0)` dengan 71,4 diam-diam menulis **tinggi** dan
   memunculkan toast "Weight 68.2 kg logged".
3. **Lintasan GPX diagonal.** Majukan latitude *dan* longitude sebesar nilai yang sama dan
   jaraknya jadi ~1,41× yang dimaksud — 200 km terukur 283 km. Longitude harus dikunci.

Ditambah satu jebakan non-obvious: `navigator.serviceWorker.ready` harus ditunggu **sebelum**
reload. Tanpa itu, reload terjadi sebelum worker selesai dipasang, sehingga tesnya lulus sendiri tapi gagal di dalam suite.

## §31 — Strip statistik hero Routes: satu baris, selalu (v7.0)

Permintaan: AVG · KCAL · W NP · MOVING tidak boleh berubah jadi dua baris saat angkanya panjang.

### 31.1 Geometri, bukan teks

Markup lama memakai `flex-wrap`, dan tiap metrik berupa inline text longgar (`AVG` lalu
`31.9 KM/H`). Akibatnya dua hal berbeda bisa terjadi: satu statistik **pecah jadi dua
baris**, dan strip-nya sendiri **wrap**. Di kedua keadaan semua angka tetap terbaca — itu
justru sebabnya bug ini tidak pernah terlihat.

Diukur langsung di browser pada kondisi terburuk (IF Attack, headwind 40 km/h, cargo
10 kg → `5.0 KM/H · 12,977 KCAL · 223 W NP · MOVING 40h 05m`):

| | tinggi strip |
|---|---|
| Layout lama | **46 px** (dua baris) |
| Sesudah | **21 px** (satu baris) |

### 31.2 Satu baris vs terbaca — datanya bertentangan

`whitespace-nowrap` saja tidak cukup. Strip ini membutuhkan **~30 px lebar per px font**,
dan hampir semua lebar itu dipakai *label*, bukan angkanya: kasus realistik (32,1 km/h,
1.063 kkal, 6j14m) punya rasio 29,99, sedangkan kasus terburuk hanya 31,07. Selisihnya
4 % — artinya makin banyak effort tidak akan menolong; yang mendominasi justru labelnya.

Artinya "selalu satu baris" dan "selalu terbaca" tidak bisa dua-duanya di ponsel kecil:

| Lebar layar | Font terbesar agar muat 1 baris |
|---|---|
| 420 px | 11,6 px → **11 px penuh** |
| 390 px | 10,6 px |
| 360 px | 9,6 px |
| 320 px | **8,3 px** — tidak terbaca di sepeda |

### 31.3 Yang dipilih: MOVING pindah ke tile EST FINISH

Empat metrik tidak akan pernah muat satu baris pada 11 px di layar 320 px. Solusinya
bukan mengecilkan font, tapi **mengurangi isinya**: `MOVING` dipindah ke bawah tile
`EST FINISH` sebagai baris ketiga.

Ini bukan pemindahan asal — `estFinish` adalah waktu tempuh **termasuk** berhenti, dan
`movingSec` adalah ride yang sama **tanpa** berhenti. Pasangan itu sudah enak dibaca sebagai
satu angka dengan rinciannya, dan sekarang selisih antara keduanya terlihat langsung sebagai
 durasi berhenti.

Sisa strip jadi tiga metrik: rasio turun ke **21,29 px per px font**, sehingga **11 px penuh
muat di 320 px** (231 px konten di ruang 248 px). Tidak ada font yang mengecil, tidak ada
teks yang terpotong.

### 31.4 Bullet separator mengalah di layar tersempit

Bullet tidak membawa informasi apa pun dan memakan ~28 px. Pada lebar < 340 px bullet
 disembunyikan (`hidden min-[340px]:inline`); tiap metrik tetap punya label sendiri, jadi
 tidak ada yang menjadi ambigu. Di 360 px ke atas bullet kembali muncul.

### 31.5 Tes geometri

Lima tes E2E baru di `routes hero stat strip`, pada 320/360/390/420 px dengan angka
terpanjang: tinggi strip tidak boleh melebihi satu line box + 8 px, tinggi tiap metrik harus
sama, tidak boleh ada overflow pada strip maupun di antar metrik, dan font tidak boleh turun
di bawah 10 px — supaya "cocok" tidak diselesaikan denganmengecil sampai tidak terbaca.

Elemennya dicari **secara struktural** (hero section → baris yang anaknya berisi metrik AVG),
bukan lewat kelas `whitespace-nowrap`. Mencari kelas perbaikannya sendiri akan membuat tes
lolos dan gagal karena alasan yang salah: mencabut kelas membuat baris tidak ditemukan,
alih-alih mengukur wrap.

**Bukti menangkap regresi:** markup `flex-wrap` + `whitespace-nowrap` dilepas dan font
dinaikkan ke 16 px — keempat lebar gagal dengan `the strip is 61px tall for 24px of text — it
wrapped`. Dikembalikan: 30/30 hijau.

## §32 — Hierarki hero Routes: satu komponen, bukan dua (v7.1)

Tindak lanjut §31. Memindahkan `MOVING` ke tile `EST FINISH` memperbaiki satu masalah dan
menciptakan dua baru, keduanya karena perubahan itu sendiri.

### 32.1 Strip statistik mendadak tidak center

`justify-between` dipakai saat strip masih punya dua anak. Setelah `MOVING` pindah ke tile,
strip hanya menyisakan satu anak — dan `justify-between` dengan satu anak **menempelkan baris itu ke
kiri**. Di bawah dua tile yang rata-rata tengah, baris yang nyempil ke kiri itu terbaca
sebagai label nyasar, bukan sebagai bagian dari hierarki.

Diganti `justify-center`. Diukur: simpul baris terhadap kotak konten hero = **0 px** di
320 px maupun 420 px.

### 32.2 Dua tile yang sebelumnya bukan satu komponen

| | EST FINISH | TARGET ARRIVE |
|---|---|---|
| Latar | `#23252c` | `#1b1c22` |
| Border | `#2b2d33` | `#2b2d33` |
| Isi | 3 baris | 2 baris |
| Suffix | — | `WIB` inline di baseline 26 px |

Empat perbedaan sekaligus. Yang membuat keduanya terasa "tidak harmonis" bukan satu pun
perbedaan tunggal, melainkan gabungan: satu primary dan satu secondary, tapi perbedaan itu
disampaikan lewat bentuk, bukan lewat hierarki.

**Keputusan: kotaknya harus identik; hierarki dibawa warna angka saja.** Latar, border,
padding, radius, tinggi, dan ritme baris dalam kini sama persis pada keduanya
(terukur `rgb(35,37,44)` / `rgb(43,45,51)` / `10px 12px` / `16px` / tinggi sama).
Yang berbeda hanya warna: `EST FINISH` rose (primer), `TARGET ARRIVE` putih (sekunder).

Membuat kotaknya berbeda untuk menyatakan hierarki justru akan membangun kembali masalah
yang sama — bentuk yang berbeda akan terbaca sebagai komponen yang berbeda.

### 32.3 Keduanya tiga baris

`EST FINISH` mendapat baris ketiga saat `MOVING` pindah, dan membiarkan tetangganya dua
baris membuat satu kotak terlihat lebih dalam dari pasangannya. Karena itu `WIB` —
yang tadinya menempel inline di ujung angka 26 px dan ikut memenuhi baseline itu —
dipindah ke baris sendiri dengan style yang sama persis dengan baris `MOVING`.

Tiap tile kini juga koheren secara internal: satu pasang **durasi** (`estFinish` termasuk
berhenti, `MOVING` tidak) dan satu pasang **jam** (`12:17` + `WIB`).

### 32.4 Tes

Dua tes E2E baru, `routes hero hierarchy`:

- **Satu komponen** — setiap properti permukaan kedua tile harus sama, jumlah baris harus
  sama, tinggi tiap baris harus sama, dan warna angka harus tetap **berbeda**. Itu
  Kombinasi yang benar: kotak identik, hierarki tetap ada.
- **Strip terpusat** — `justify-content` harus `center` dan simpul baris harus dalam 1 px
  dari pusat kotak konten hero, diuji di 320 px.

**Bukti menangkap regresi:** `justify-between` dikembalikan → gagal dengan `strip sits
-104px off centre`. Latar/border tile kedua dikembalikan → gagal dengan `tiles disagree on
borderColor: rgb(43, 45, 51) vs rgb(51, 51, 56)`. Dipulihkan: 32/32 hijau.

## §33 — Audit hierarki: Dashboard, Rides, dan slot yang tidak pernah kanan (v7.2)

Audit yang diminta: *"kotak yang berbeda padahal seharusnya satu komponen, dan baris yang
tidak center"* — di Dashboard dan Rides. Dijalankan sebagai pengukuran di browser, bukan
dengan membaca markup, karena ketiga kelas bug itu tidak terlihat dari kode.

### 33.1 Cara mengaudit

Dua sapuan in-page, lalu setiap temuan dikonfirmasi satu per satu:

1. **Baris yang menempel** — setiap elemen `display:flex` dengan `justify-content:
   space-between` tapi **satu anak**. suspiciously, `space-between` dengan satu anak
   selalu resolve ke kiri; kalau baris itu memang dimaksudkan rata kiri, kelasnya
  sefbenarnya tidak melakukan apa pun.
2. **Grup bersaudara yang tidak cocok** — setiap `div`/`section` dengan 2–6 anak yang
   permukaannya (bg, border, radius, padding) tidak seragam.

Sapuan ke-2 menghasilkan banyak **false positive** — ia mencocokkan orang tua yang anak-anaknya
memang bukan kartu-kartu bersaudara (mis. pembungkus halaman). Karena itu tidak ada temuan
yang langsung acted upon; semuanya diukur ulang satu per satu.

### 33.2 Temuan: slot `right` di `SectionCard` tidak pernah kanan

Ini yang paling|ISBN pekerjaan, karena bukan per halaman — tapi di komponen yang dipakai
seluruh aplikasi.

```svelte
{#if right}
  <div class="flex items-center justify-between mb-4">{@render right()}</div>
{/if}
```

**Setiap** pemanggil mengirim **satu** elemen ke slot itu — `LegendPill`, `StatusChip`,
`ShieldAlert`, sebuah `<span>`. Dan `justify-between` dengan satu anak selalu resolve ke
**kiri**. Jadi prop yang namanya `right` **tidak pernah sekali pun** meratakan apa pun ke
kanan, sejak komponen itu dibuat.

Terukur: kartu *Fitness & fatigue* meninggalkan **192 px** ruang kosong di sebelah kanan
kontennya, *Power curve* **61 px**.

Yang membuatnya tidak terlihat: legenda rata kiri membaca sebagai "legenda ada di sini",
di dekat chart yang dijelaskannya — jadi terasa disengaja, padahal tidak ada yang disengaja.

Diubah ke `justify-end`, yang memang sudah dijanjikan prop tersebut. Ini memperbaiki
Dashboard, Rides, Race, dan ActivityDetail sekaligus.

### 33.3 Temuan: hero Rides tidak punya ritme

Kanan hero Rides adalah `5.8h · 313 TSS` — **dua pengukuran berbeda** yang disambung
tanda titik, tanpa label, sebaris dengan tombol pengaturan. Jadi angka primer punya label
dan angka 28px, sementara dua lainnya berupa teks 11px tanpa keterangan apa pun. Ketiganya
juga tidak sharing baseline: teks itu mulai **19 px di bawah** label primer.

Terukur setelah perbaikan: ketiga kolom punya `valueBottom` yang sama, ukuran label sama
(10 px), dan angka primer tetap 28px — hierarki dibawa **ukuran**, bukan oleh
ketidaksejajaran.

Ini persis susunan yang sudah dipakai hero Dashboard (Time · Distance · Stress), jadi
perbaikannya menyelaraskan Rides dengan bahasa visual yang sudah ada, bukan menciptakan
yang baru. Tombol pengaturan tetap di ujung dan tetap tombol — itu sebuah **aksi**, dan
menggambarnya seolah data adalah bagian dari masalahnya.

### 33.4 Yang **bukan** bug: empat tile Snapshot

Sapuan melaporkan keempat tile Snapshot berbeda: yang keempat (`Form (TSB)`) tidak punya
background dan border, tapi punya `box-shadow` merah.

Diukur ulang: keempatnya memakai komponen `StatTile` yang sama, radius `16px`, padding
`16px`, lebar `184px`, tinggi `111/111/110/110`. Yang berbeda hanya perlakuan permukaan,
karena yang keempat diberi `variant="flare"` — **aksen hierarki yang disengaja**, bukan
inkonsistensi. Tidak diubah.

### 33.5 Tes

Lima tes E2E di `audit — hierarchy`:

- **Slot kanan** — diuji di empat halaman (Dashboard, Rides, Race, ActivityDetail):
  setiap isi slot harus rata kanan dalam 1 px. Slot kosong dilewati; snippet yang satu-
  cabangnya `false` merender apa pun, jadi tidak ada yang bisa diukur.
- **Baseline hero Rides** — tiga kolom, tiga label, satu ukuran label, satu baseline angka,
  dan angka primer harus lebih besar dari dua angka lainnya.

Elemen slot dicari lewat `data-slot="right"`, yaitu **kontrak komponennya sendiri** — bukan
`justify-end` yang memperbaiki bug itu. Memilih berdasarkan kelas perbaikannya sendiri akan
membuat tes gagal karena alasan yang salah, persis seperti di §31.

**Bukti menangkap regresi:** `justify-between` dikembalikan → gagal dengan `"CTL 23 ATL 39"
sits 220px from the right edge`. Kolom Time dikembalikan menjadi string run-on → gagal di
assertion label. Dipulihkan: 37/37 hijau.
---

## §34 — Impor membuang power yang sudah ada di dalam file

**Trigger.** Membangun harness validasi (§33) memunculkan pertanyaan sederhana: dari mana
Crr dan CdA akan datang kalau akurasinya mau benar? Jawabannya — dari GPS + power milik
pembalap sendiri. Menelusuri jalurnya, ternyata power itu **tidak pernah masuk ke aplikasi**.

### Temuan

`parseCourse()` di `domain/course.ts` membaca tiga hal dari tiap trackpoint: posisi,
ketinggian, dan waktu. Itu semua. Sementara berkas yang diimpor justru membawa:

- **TCX** — `<ns3:Watts>`, `<ns3:HeartRateBpm>`, `<ns3:Cadence>` di **setiap** trackpoint;
- **GPX Garmin** — `<gpxtpx:Watts>`, `<gpxtpx:hr>`, `<gpxtpx:cad>` di dalam
  `<gpxtpx:TrackPointExtension>`.

Keduanya dibuang. Akibatnya setiap ride hasil impor tiba tanpa power: NP, IF, dan TSS
kosong, dan `kcal` diisi karangan `distanceKm × 26` yang dikomentari sendiri sebagai
"coarse fallback until power streams are parsed".

### Kenapa tidak pernah kelihatan

Karena aplikasi **tampil benar**. `ActivityDetail.svelte` punya empty state yang jujur —
*"This ride has no power stream"* — dan empty state itulah yang menutupi bug-nya.
Importer rusak dan pembalap tanpa power meter menghasilkan layar yang **persis sama**.

Ini pola kedua di proyek ini setelah `power_curves` hilang dari backup JSON: kemampuan
yang didokumentasikan diam-diam tidak melakukan apa-apa, dan custodinya sendiri
menutupi bug-nya. Bedanya, di §30 yang ditemukan dengan menjalankan DoD; yang ini
ditemukan dengan menelusuri satu pertanyaan "datanya bisa datang dari mana".

Bug ketiga yang menyertainya, ketemu karena tes E2E pertama gagal mencari nama ride yang
saya karang sendiri: parser mencari elemen `<name>` huruf kecil, sedangkan TCX menulis
**`<Name>`**. XML bersifat case-sensitive, jadi setiap ride TCX selalu tercatat di bawah
nama berkasnya — bukan nama ride-nya.

### Perbaikan

1. **`domain/course.ts`** membaca sensor berdasarkan **local name**, satu kali penyapuan
   per trackpoint. Local name dipilih karena prefiks vendor vary (`ns3:`, `gpxtpx:`), dan
   type selector yang mengabaikan namespace tidak diimplementasikan konsisten — happy-dom
   menolaknya, dan satu yang bisa relied on di browser saja tidak cukup untuk parser yang
   jadi tempat data hilang. Pencocokan `localName` bersifat case-sensitive dengan benar
   dan tidak peduli vendor.
2. **Sensor hanya ditulis bila ada.** Meter yang terpasang di kilometer 20 menghasilkan
   trackpoint awal tanpa `watts` — bukan `0`. `0` berarti "mengayun", tidak ada berarti
   "tidak terbaca".
3. **`rides/Rides.svelte`** menurunkan NP/IF/TSS dari trace-nya sendiri saat impor
   (ARCHITECTURE §5.1), dan `kcal` dihitung dari energy trace — bukan dari jarak.
   `fields` pada `activity_streams` kini **union** kunci seluruh trackpoint, bukan kunci
   trackpoint pertama: sensor yang menyala di tengah ride membuat trackpoint pertama tidak
   punya `watts`, dan kunci pertama akan menyembunyikan field yang justru dicari decoder.
4. **IF dan TSS tidak ditulis sebagai 0** saat FTP belum ada. `0` dibaca sebagai
   "mengebut intensitas nol"; tidak ada clarté lebih jujur.
5. **Nama TCX** kini dibaca dari `<Name>`.

### Tes

- **Unit** (`course.test.ts`, 5 tes baru): sensor TCX terbaca; sensor GPX extension
  terbaca; sensor yang menyala di tengah ride menghasilkan `undefined`, bukan nol; GPX
  polos tetap tanpa field sensor; `<Name>` kapital dibaca.
- **E2E** (`platform.spec.ts`, 1 tes baru): impor TCX 24 km dengan power, lalu memeriksa
  baris di IndexedDB **dan** isi layar — NP dan TSS harus muncul sebagai angka, dan tile
  tidak boleh lagi berbunyi "Needs power".

**Bukti menangkap regresi:** baris `Object.assign(p, readSensors(n))` dikomentari →
gagal di `the imported ride has no normalized power`. Dipulihkan.

### Yang belum selesai

Sekarang data power **masuk**, tapi belum dipakai untuk apa pun yang besar: kalibrasi
`Crr`/`CdA` per-pembalap masih belum ada, dan harness ±7 % (§33) masih kosong. Yang
perubahan ini lakukan adalah menghapus satu alasan kenapa keduanya tidak bisa.keyword —
dulu, bekanya tidak ada di mana pun.---

## §35 — Mengukur Crr dan CdA milik pembalap sendiri

**Trigger.** §33 membangun gerbang akurasi prediksi dan summarised honestly: modelnya
benar, parameternya asumsi. `crr = 0.005` dan `cda = 0.32` di [Bike](src/lib/data/db.ts)
adalah titik tengah textbook, dan hampir tidak tepat untuk siapa pun. tekanan ban, kedalaman
pelek, dan postur tubuh memindahkan `CdA` ±10 %; jenis ban memindahkan `Crr` sampai
sepertiga. Kotak ±7 % tidak bisa ditutup selama model berjalan di konstanta yang tidak
 pernah diukur.

§34 menghapus alasan why data itu tidak ada. Sekarang jalurnya ada.

### Matematika, dan kenapa ia mudah

Pada keadaan tunak, daya di roda adalah jumlah dua suku yang berkuasa di rezim berbeda:

```
P_wheel = Crr·m·g·cosθ·v  +  m·g·sinθ·v  +  ½ρ·CdA·(v+w)³
             gesekan, lambat        gravitasi, sudah diketahui dari profil     aero, cepat
```

Suku gravitasi dikurangi karena profil sudah mengetahuinya. Yang tersisa:

```
P_wheel − m·g·sinθ·v  =  Crr · (m·g·cosθ·v)  +  CdA · (½ρ·v³)
```

**Linear terhadap Crr dan CdA.** Jadi seluruh kalibrasi adalah regresi linier dua
parameter — tanpa gradient descent, tanpa tebakan awal, satu sistem 2×2.

### `domain/calibrate.ts`

1. **`buildCalibSamples`** mengubah track tersimpan menjadi sample siap-fit. Ini hanya
   mungkin sekarang karena §34: track harus membawa `lat`/`lng`/`alt`/`t` **dan** `watts`.
   Power dihaluskan rata-rata bergerak 30 s — trace mentah menghasilkan `CdA` yang
   terlihat buruk untuk orang yang sama.
2. **Filter keadaan tunak** membuang start dari diam, menuruni, dan zona perubahan gradien.
   Semua punya power yang tidak sesuai kecepatan yang dipegang; fit yang menelan semuanya
   mengembalikan koefisien untuk ride yang tidak pernah Permalink.
3. **Least squares** dengan pembetulan roda: watt diukur di pedal, model bekerja di roda.
4. **Penolakan yang jujur.** Ini bagian yang menentukan. Empat hal mengembalikan
   kegagalan, bukan angka:
   - **terlalu sedikit sample** (< 20 keadaan tunak);
   - **tidak bisa dipisahkan** — `det/(aa·bb)` adalah cos² sudut antara dua regressor.
     Pada ride yang mempertahankan satu kecepatan, gesekan dan aero adalah pengukuran
     yang sama dalam satuan berbeda, dan pembagiannya sembarang>;
   - **tidak mungkin secara fisis** — `Crr` di luar 0,002–0,012, `CdA` di luar 0,15–0,60.
     Ini yang menangkap stream power yang salah sinkron dengan track>;
   - **sisa besar** — di atas 25 W RMS, hasilnya dilaporkan dengan peringatan, bukan
    presented sebagai ukuran.

   Setiap penolakan membawa **alasan yang bisa ditindaklanjuti**, karena "kalibrasi gagal"
   bukan sesuatu yang bisa ditindaklanjuti pembalap.

5. **`calibrateFromTrack`** adalah pintu masuk satu baris: sample dari `activity_streams`
   plus angka pembalap, keluarannya pengukuran atau alasannya.

### Yang dibuktikan tes, dan yang tidak

**Membuktikan:** [calibrate.test.ts](src/lib/domain/__tests__/calibrate.test.ts) membangun
ride dari model yang sama secara terbalik, lalu memastikan fit mengembalikan konstanta
pembuatnya — `Crr` dalam 0,0005, `CdA` dalam 0,005 m², RMS < 6 W. Ini membuktikan
**penyelesai least squares-nya benar**: pengurangan gravitasi dan pembetulan roda benar
saling meniadakan dan mengembalikan apa yang masuk.

**Tidak membuktikan:** fisika dasarnya benar. Itu tetap milik `validation.test.ts` §33
terhadap angka dari luar. Keduanya klaim terpisah — penyelesai yang salah rusak apa pun
modelnya, dan penyelesai yang benar di atas model yang salah tetap mengembalikan angka
yang salah dengan yakin. Karena itulah separuh dari file ini adalah penolakan.

### Status: mesin siap, belum ada tombolnya

`calibrate.ts` dipanggil dari mana saja lewat `calibrateFromTrack`, tetapi **belum ada
layar yang menawarkannya**. Itu disengaja untuk commit ini: logika-nya teruji, dan
menyambungkannya ke UI adalah pekerjaan tersendiri dengan konsekuensi E2E sendiri.

Yang **tidak boleh** terjadi saat disambungkan: menimpa `Crr`/`CdA` milik pembalap
secara diam-diam. Angka hasil ukur harus selalu disertai RMS, rentang
kecepatan, jumlah sample, dan peringatan — persis seperti yang dikembalikan fungsi ini.

### Yang ini tidak memperbaiki

Kotak golden test ±7 % **tetap kosong**. Kalibrasi menghapus asumsi yang paling kabur,
tetapi masih ada yang tidak bisa diukur dari satu ride: ftp orang berubah, cuaca berubah,
dan Constant Power adalah model yang tidak pernah tepat untuk manusia. Harness di
[validation/rides](validation/rides/README.md) sekarang punya alasan yang jauh lebih baik
untuk menyimpan `rider.crr`/`rider.cda` hasil ukur — dan itu sebabnya.
## §36 — Zonadua, Hugeicons, dan nama yang dihapus dari greeting

Tiga perubahan yang satu sumber: **apa yang disebut aplikasi ini, dan apa yang digambarnya.**

### 1. GowsLab → Zonadua

Nama yang dilihat user berubah total: judul dokumen, `manifest.webmanifest` (PWA),
`package.json`, mockup, dan dokumen. Yang **tidak** ikut, karena bukan branding:

- **Nama database IndexedDB berubah `gowslab` → `zonadua`, tanpa migrasi.** Data lama tidak
  terbawa. Ini konsekuensi yang harus disadari, bukan sampingan.
- **Kunci localStorage dibaca dua-duanya.** `zonadua.wiped` dan `zonadua.seeded` jadi nama
  baru, tapi `flag()` di [seed.ts](../src/lib/data/seed.ts) masih membaca `gowslab.wiped` /
  `gowslab.seeded` sebagai fallback. Tanpa ini, setiap pembalap yang sudah pernah menekan
  "Delete all data" akan kehilangan penandanya — dan karena semua tabel dijaga `count() === 0`,
  seeder akan melihat database kosong sebagai luncuran pertama dan **24 ride demo akan
  kembali diam-diam**, persis bug §30. Sekadar mengganti nama konstanta tanpa fallback
  akan menghidupkan lagi bug yang sudah ditutup.

  Karena itu fallback itu **diuji**, di `seed-flags.test.ts` — termasuk kasus yang paling
  mudah salah: `gowslab.seeded` **tidak** boleh dianggap sebagai persetujuan untuk
  mengisi ulang database yang dikosongkan; hanya `wiped` yang bisa menahan seeding.
  Bukti menangkap regresi: `LEGACY_WIPE_FLAG` dicabut dari pemanggilan `flag()` → tes
  *"still honours a wipe recorded under the pre-rename key"* gagal dengan
  `expected false to be true`, sementara empat tes lain tetap hijau. Dipulihkan.
- **Backup JSON menerima tag `app` lama maupun baru** ([Settings.svelte](../src/lib/routes/settings/Settings.svelte)),
  supaya file ekspor versi sebelumnya masih bisa diimpor.

### 2. Lucide → Hugeicons

Hugeicons (MIT), bukan Lucide (ISC). Keduanya viewBox 24px garis putus-putus, jadi `size` dan
`strokeWidth` tidak berubah artinya — `strokeWidth` tetap satuan viewBox, jadi `1.8` masih
setebal yang sama.

Tiga hal yang menentukan bentuk migrasinya:

- **`strokeWidth` harus selalu diteruskan.** Data Hugeicons menyematkan `stroke-width="1.5"`
  ke setiap path, dan renderer **hanya** menimpanya kalau prop `strokeWidth` ada. Kalau
  prop itu dilewatkan, seluruh ikon terkunci di 1.5 dan hierarki bobot yang dipakai UI
  (1.5 chrome · 1.8 konten · 2 peringatan) ikut rata. [Icon.svelte](../src/lib/components/Icon.svelte)
  selalu mengirimnya; itulah alasannya ia ada.
- **Ikon dipanggil dengan nama, bukan import.** `CircleButton` dan `StatusChip` sudah
  menerima `icon` sebagai nama; ini melanjutkan konvensi itu. 53 nama tinggal di satu file
  ([icons.ts](../src/lib/icons.ts)) — inventaris lengkapnya terbaca dalam satu layar, bukan
  tersebar di empat belas file.
- **Tree-shaking tetap aman** karena setiap ikon diimpor lewat subpath
  (`@hugeicons/core-free-icons/Calendar03Icon`), bukan lewat barrel. Paketnya berisi 12.145
  ikon; bundle hanya membawa 52 glif.

`'alert-triangle'` dan `'triangle-alert'` sengaja berbagi satu glif. Lucide mengirim keduanya sebagai
alias dari satu segitiga, jadi memberi mereka bentuk berbeda di sini berarti mengarang
pembedaan yang tidak pernah ada.

Audit: 53 nama terdaftar → **52 glif unik**, pasangan di atas satu-satunya duplikasi. Tujuh
halaman dirender satu per satu: **0 SVG ikon kosong**, semua ikon tepat pada ukuran atributnya.
Bundle 461 kB / 154 kB gzip.

### 3. Nama dihapus dari greeting Dashboard

Greeting pernah jadi dua baris: `GOOD MORNING,` lalu nama pembalap dalam aksen crimson italic.
Baris kedua itu mengisi teks terbesar di aplikasi — dan **nilainya tidak bisa diedit di
mana pun**. `athlete.name` di-seed sebagai `Andi`, tidak ada field Settings yang menulisnya,
dan tidak ada layar lain yang membacanya.

Artinya setiap pembalap aplikasi ini melihat **nama orang lain** di layar pembuka. Itu bukan
pilihan gaya; itu kebohongan di posisi paling terlihat, dan satu-satunya jalan memperbaikinya
adalah kolom nama di Settings.

Keputusan user: **hapus**. Headline jadi satu baris `GOOD MORNING`, prop `name` dibuang dari
`EditorialHeader`. Yang hilang: aksen crimson di header itu. Yang hilang juga: satu kebohongan.

Diukur di 320 px: lebar judul tersedia **176 px** (280 px konten dikurangi 88 px ikon aksi),
`GOOD MORNING` butuh **248 px** → membungkus ke `GOOD` / `MORNING`, dua baris, tanpa overflow
horizontal. Bentuk sebelum ini wrap pada `GOOD MORNING,` (259 px) — jadi bentuknya tidak
memburuk.

**Catatan:** `athlete.name` kini tidak dibaca layar mana pun. Kolomnya masih ada di skema dan
masih diisi seed, tapi tidak terlihat. Kalau nama suatu saat dikembalikan, jalurnya harus lewat
field Settings lebih dulu — menaruh teks nama kembali sebelum ada yang bisa menuliskannya
hanya mengulang kesalahan yang sama.

### Yang tidak diubah

Nama artefak Google Stitch yang sudah dihapus (`gowslab_dashboard`,
`gowslab_rides_split_cockpit_variant`, `references/stitch_gowslab_*`) tetap tertulis di §4.
Itu nama file yang benar-benar pernah ada, dan menuliskannya ulang jadi "zonadua" akan
memalsukan catatan keputusan.

## §37 — Hero Dashboard: ring jadi gauge, kolom form jadi satu blok

Laporan: *"round chart dan detail fitness & detraining terlihat tidak center / kurang enak
dilihat."* Dua keluhan, satu sebab yang sama — **baris atas hero monolith tidak terbaca
sebagai satu kesatuan.**

### Yang diukur dulu, bukan ditebak

`preview_screenshot` gagal terus ("no frames"), jadi semua di bawah diukur lewat
`getBoundingClientRect` di halaman. Pada 390 px (kartu 350, konten 310):

| Yang diukur | Angka |
|---|---|
| Pusat cincin | x **96**, y **273** |
| Kotak kolom kanan | x 172, w 178, y 224, h 97 |
| Pusat kolom kanan | y **273** |
| Arc nilai | `stroke-dasharray` **82.94 / 276.46** → **30%** dari lingkaran penuh |
| Baris trio | pusat kolom di 92 / 195 / 298 |

Jadi kotak kolom memang sudah rata tengah — `items-center` bekerja. Yang tidak rata tengah
adalah **isi**nya.

### 1. Cincin: dari lingkaran penuh jadi gauge 240°

Arc 30% pada lingkaran tertutup dimulai dari 12 jam dan berputar searah jarum jam, jadi
seluruh massanya mengumpul di kuadran kanan-atas sementara angka −16 duduk di pusat persis.
Mata membaca **angka** sebagai pihak yang meleset, bukan arc-nya.

Diganti jadi **busur 240° dengan bagian bawah terbuka**:

- Dua ujung terbuka = TSB **−40** dan **+40**.
- Puncak busur (12 jam) = TSB **0**, ditandai garis tick.
- Simetris terhadap sumbu vertikal **secara konstruksi**, bukan kebetulan.

Ini juga satu-satunya cara jujur menggambar skala ±40 yang jadi acuan angkanya. Lingkaran
penuh tidak punya tempat untuk tick, sehingga skalanya tak terlihat — dan itulah cara arc 30%
terbaca sebagai "readiness 30%", persis metrik rekaan yang §36 cabut dari bawahnya.

Diketahui ulang di layar: track `184.31 / 276.46` (tepat 240°) diputar `rotate(150 56 56)`,
arc nilai `55.29` = 30% × 240° = 72°, berakhir di 222° — berhenti sebelum 270° (puncak)
karena TSB-nya negatif, dan itu memang yang benar.

`stroke-linecap="round"` tetap menggambar sebuah titik untuk dash panjang nol, jadi busur nilai
**dikosongkan sepenuhnya** saat `ringFrac === 0`. Tanpa itu gauge terbaca "sedikit form" ketika
jawaban jujurnya "belum ada".

### 2. Kolom kanan: satu ritme, bukan dua fragmen

Sebelumnya dua potongan yang tidak berhubungan: label 10px di atas angka 28px, lalu baris
11px uppercase di atas kalimat 11px — dengan **nama pita ("DETRAINING") berbobot sama dengan
ukurannya** ("ATL 39"). Pita itulah yang acted-on; ATL adalah konteks.

- Kedua label kini 10px / `tracking-wider`, satu ukuran.
- Pita form diberi warna per pita (`FORM_TONES`) dan weight `font-extrabold`; angka ATL turun
  ke `text-on-mono-dim` 11px sebagai baris pendukung.
- Garis rambut `border-t` memisahkannya, jadi kolom terbaca sebagai satu kesatuan yang terbagi
  dua, bukan teks yang kebetulan berdekatan.

**Warna status di monolith:** `text-aman` / `text-warn` / `text-kritis` adalah token permukaan
**terang** (`#0a7450` dan sejenisnya) dan hilang di atas `#141519`. Hero memakai hex yang sama
dengan palet `dark` milik `StatusChip`, bukan membuat set ketiga.

### 3. "24 rides with power" dikeluarkan dari hero

Bukan informasi form, pecah jadi dua baris yang berantakan di 320 px, dan kartu Power curve sudah
menyebutkannya di bawah fit yang memang dikuatkan oleh angka itu. Hero adalah form dan beban;
provenance tinggal bersama datanya.

Dampak terukur di 320 px: kolom 108px, **nol baris terbungkus**, `doc.scrollWidth ==
clientWidth`, dan tinggi kartu tetap konstan antar ketiga tab hero (170 / 170 / 170).

### Tes

Dua tes E2E baru (`dashboard hero form gauge`):

1. Sweep track harus 240° (bukan 360°), rotasi track dan arc harus sama-sama
   `rotate(150 56 56)`, ada tick, dan tick tegak di sumbu vertikal serta tepat membentang dari
   tepi dalam ke tepi luar pita cincin (`r ± strokeWidth/2`).
2. Pusat baris ring dan pusat kolom fitness harus sama dalam 1 px.

**Bukti menangkap regresi:** `GAUGE_ARC` dikembalikan jadi `CIRC` dan `GAUGE_START` jadi
`-90` → tes pertama gagal dengan pesan *"the gauge is a closed ring again"*, `Expected: 240`,
`Received: 360`. Tes kedua tetap hijau, karena memang tidak menyangkut busur — keduanya jujur
tentang apa yang mereka awasi. Dipulihkan.

### Catatan

Dua dari tiga assertion tick sempat ditulis dengan penalaran yang salah (salah tangkap
`match(/\d+/g)` pada `"rotate(150 56 56)"`, lalu membalik arah perbandingan y karena tepi luar
cincin justru punya y lebih kecil). Semuanya tertangkap tes, tapi suspeito: yang pertama akan
lolos sebagai assertion yang selalu benar.

## §38 — Sisi kanan hero jadi kartu, dan audit centring trio

Dua permintaan. Yang pertama mengubah tampilan, yang kedua **tidak mengubah apa pun** —
dan itu hasil yang layak dicatat, karena "sudah center?" adalah pertanyaan yang jawabannya
tidak boleh diasumsikan.

### 1. Kolom longgar di sebelah ring → dua kartu

Keluhan: sisi kanan hero "kosong dan kurang dinamis". Penyebabnya terukur — kontennya
menempel di tepi kiri kotak yang **dua kali lebih lebar dari yang dibutuhkannya**, jadi
separuh lebar hero jadi ruang mati.

Kartu mengikuti bentuk blok statistik yang sudah dipakai di app ini (label → angka → satuan,
dalam tile gelap yang sedikit terangkat), sehingga hero memakai bahasa visual yang sama
dengan halaman lain. Yang berubah secara nyata:

- **Pita form pindah ke bawah ring, jadi jadi pil.** Ring sudah memegang pembacaan form;
  nama pita milik sana, bukan di kolom beban. Ini juga yang memberi ruang bagi kartu untuk
  memuat angka saja — dan itulah yang membuat separuh kanan hero finally punya isi.
- **`unit` dipisah dari `value`**, bukan digabung jadi "CTL 23". Di 320 px kolomnya 108 px
  dan string gabungan membungkus.
- **`content-center`, bukan `items-stretch`**: kartu tetap tinggi alaminya dan duduk di
  garis tengah ring, supaya barisnya tidak terlihat seperti ring 112 px di samping dua
  balok pendek dengan ukuran berbeda.

### 2. Yang tidak muat, lalu harus turun

Tile pertama memotong label di 320 px. Angkanya: tile 50 px, konten **36 px**, dan "FITNESS"
saja terukur **39 px** di ukuran itu — jadi ikon + label memang tidak mungkin muat, bukan
hanya perlu diperkecil.

Perbaikannya berjenjang, bukan diperkecil seragam:

| Lebar | Label | Ikon | Terpotong |
|---|---|---|---|
| 320 px | 8px, tracking mati | disembunyikan | 0 |
| 360 px | 9px, `tracking-wider` | 11 px | 0 |
| 430 px | 9px, `tracking-wider` | 11 px | 0 |

Memotong label akan lebih buruk daripada kolom kosong yang digantikannya, karena pembalap
lagi tidak bisa tahu angka itu apa.

### 3. Audit centring: trio sudah benar, keduanya

Diperiksa dengan `Range.getBoundingClientRect()` pada **teks**nya, bukan pada kotaknya —
`text-center` yang menocentangkan kotak akan selalu terlihat benar, sementara yang perlu
dibuktikan adalah teksnya ikut ke tengah.

| | Lebar baris | Titik tengah baris | Offset label vs pusat kolom |
|---|---|---|---|
| **Today** — Time / Distance / Stress | 310 | 195 | **0 / 0 / 0** |
| **Form** — Fitness / Fatigue / Form | 310 | 195 | **0 / 0 / 0** |

Nilai dan label punya pusat yang sama persis dengan pusat kolomnya di keenam sel. Jadi
**tidak ada yang perlu diubah di sana**, dan tidak saya ubah. Menempelkan kartu pada trio
yang sudah benar justru akan meminta pekerjaan yang tidak dibenarkan.

### Tes

Tiga tes E2E baru (`the load tiles read in full at 320 / 360 / 430 px`): label tidak
terpotong (`scrollWidth - clientWidth <= 0`), tile tidak meluber, tinggi kedua tile sama,
pusat grid sama dengan pusat ring dalam 1 px, dan dokumen tidak overflow.

**Bukti menangkap regresi:** label dipaksa kembali ke `text-[9px] tracking-wider` dengan
ikon selalu tampil → tes 320 px gagal dengan pesan *"Fitness is clipped to 21px of the 39px
it needs"*. Tes 360 dan 430 tetap hijau, karena di kedua lebar itu memang tidak ada yang
terpotong — tes itu jujur soal apa yang mereka awasi, bukan sekadar gagal bersama. Dipulihkan.

## §39 — "FATIGUE" bukan pengganti "DETRAINING", dan pita form jadi keterangan

Laporan: *"kenapa muncul fatigue pada monolith? karena sebelumnya yang saya lihat adalah
detraining. dan sekarang posisi peletakan detraining menjadi sangat aneh."*

Dua tuduhan, dan hanya satu yang benar — tapi yang benar itu fundamental.

### 1. Kata baru itu bukan penggantian

`FATIGUE` **tidak** menggantikan `DETRAINING`. Keduanya memang berbeda dan keduanya sudah ada
sebelum §38, keduanya menempel jadi satu blok:

| | apa itu | sumber | sudah ada di mana |
|---|---|---|---|
| `FATIGUE` / `ATL` | **angka** beban akut | `pmc.ts` | sudah tertulis di tab Form sebagai "Fatigue ATL" |
| `DETRAINING` | **pita**, interpretasi dari TSB | `formState(tsb)` | sudah tertulis di hero sebelum §38 |

Jadi tidak ada metrik baru. Yang berubah pada §38 adalah bahwa keduanya dipisah agar jelas
mana angka dan mana tafsirnya — dan pemisahan itulah yang membuat `DETRAINING` samar, karena
ia dijadikan pil kecil bertuliskan hal yang sama dalam warna berbeda.

### 2. Yang benar: penempatan pita form

Aturan dasarnya: **label menempel pada bendanya.** Pita form menafsirkan angka TSB, jadi ia
harus menempel pada angka itu. Versi §38 meletakkannya sebagai **pil berborder dan ber-fill**
di bawah ring — dan chrome itulah yang membuatnya terasa melayang. Border + fill mengubah
keterangan menjadi benda tersendiri, sehingga baris hero terbaca sebagai *empat* objek, bukan
ring, dua kartu, dan keterangan dari ring.

Diperbaiki dengan menghapus chrome-nya, bukan dengan memindahkannya:

- Di dalam ring, label `FORM TSB` menjadi `TSB` saja. Sekarang anatomi ring sama persis dengan
  kartu di sebelahnya: **angka + satuan** (`−16` / `TSB`). Nama metriknya hidup di keterangan
  di bawah dan di `aria-label` gauge.
- Pita jadi **teks polos berwarna** di garis tengah ring, menempel 4px di bawah lingkaran.

**Pil tidak bisa masuk ke dalam ring.** Dihitung: nama pita terpanjang `RECOVER FIRST`-lebar
**93 px** pada tipe keterangan, sedangkan tali dalam ring (chord) adalah 78 px di titik
tengah dan hanya **61 px** di tempat baris ketiga harus duduk. Jadi keterangan memang harus
di luar — tapi harus tetap muat di kolom ring 112 px, dan 93 < 112, jadi muat di semua lebar
tanpa menyentuh kartu.

### 3. Audit centring: strip bawah memang sudah benar, dan dikunci tes

Diperiksa dengan `Range` pada **teksnya**. Tiga lebar, dua tab, dua elemen per sel (label dan
nilai):

| Lebar | Today (Time/Distance/Stress) | Form (Fitness/Fatigue/Form) |
|---|---|---|
| 320 px | **0 / 0 / 0** | **0 / 0 / 0** |
| 390 px | **0 / 0 / 0** | **0 / 0 / 0** |
| 430 px | **0 / 0 / 0** | **0 / 0 / 0** |

Offset 0 berarti pusat teks = pusat selnya, persis. **Tidak ada yang diubah di sana.** Yang
perubahan adalah sekarang ada tes yang menjaganya, supaya tidak bisa melenceng diam-diam.

### Tes

Empat tes E2E baru:

1. **Keterangan, bukan chip** — harus tidak terpotong, harus di garis tengah gauge dalam 1 px,
   `border-width` harus `0px` dan `background` harus transparan. Border dan fill diassert
   eksplisit karena itulah yang membuat versi sebelumnya terasa salah tempat.
2. **Nama pita terpanjang muat** — `RECOVER FIRST` diukur dengan tipe keterangan yang sungguhan,
   karena data seed hanya pernah menghasilkan `DETRAINING`, yaitu satu-satunya pita yang lolos.
3–4. **Centring strip** di tab Today dan tab Form, toleransi 1 px.

**Bukti menangkap regresi:** pil `rounded-pill border` + fill dikembalikan → tes pertama
gagal dengan pesan *"the caption has a border again — it is a chip, not a caption"*.
Dipulihkan.

### Catatan arsitektur yang ditemukan sambil menulis tes

Ketiga panel tab berbagi **satu** `#hero-pane`; `aria-labelledby`-nya menunjuk tab yang
aktif, dan ketiga isinya ditumpuk dalam satu sel grid dengan `opacity-0` + `inert`. Itu pola
tabpanel yang sah, tapi panel-panel itu tidak punya identitas sendiri — satu-satunya
handle struktural mereka adalah urutan tab. Tes memakai urutan itu, bukan selector, karena
selector akan gagal untuk alasan yang salah. Kalau panel dibersihkan terpisah nanti, tesnya
perlu ditulis ulang; itu konsekuensi yang perlu dicatat.

## §40 — Baris atas hero jadi satu grid (digantikan oleh §41)

Laporan: *"posisi peletak detraining masih janggal."* Kali ketiga, dan kali ini saya berhenti
menambal posisinya.

### Dua penempatan yang sudah ditolak, dan kenapa keduanya salah

| Versi | Bentuk | Kenapa gagal |
|---|---|---|
| §38 | pil `border` + `fill` di bawah ring | chrome membuatnya jadi benda tersendiri, bukan keterangan |
| §39 | teks polos berwarna di bawah ring | tetap baris yatim: tidak ada kolom yang memuatnya |

> **Dikoreksi oleh §41 (bagian terakhir dokumen ini) — baca itu sebelum memakai tabel ini.** Baris §38 di atas **tidak lagi berlaku**: pita ber-border yang dicatat sebagai gagal di sini justru **dipakai kembali**, dengan dua perbedaan yang memperbaiki sebab kegagalannya alih-alih mengulanginya — hanya **nama pita** yang diwarnai (chrome-nya netral, sama persis dengan dua kartu di sebelahnya), dan lebarnya mengikuti garis di bawahnya sehingga ia punya tepi yang jelas alih-alih mengambang di tengah kartu. Grid tiga kolom yang §40 pasang di bawah ini juga sudah ditinggalkan; §41 mencatat kenapa.

Keduanya salah karena satu sebab yang sama: **sebaris teks berwarna dengan sendirian di
sebelah dan lingkaran 112 px di atasnya tidak punya kolom.** Menempelkannya ke lingkaran
bukan memperbaikinya — justru itulah yang membuat pembalap membacanya sebagai anotasi yang
menggantung, bukan sebagai label.

### Yang diukur sebelum mengubah struktur

Pita **tidak bisa** masuk ke dalam ring, dan ini dihitung, bukan diasumsikan — tiga skenario
diuji langsung di DOM dengan menyuntikkan baris dan membandingkannya dengan tali dalam:

| Skenario | Yang dibutuhkan | Ruang tersedia | Hasil |
|---|---|---|---|
| nilai 26 / unit / pita 8 | `RECOVER FIRST` **71 px** | **59 px** | gagal −11 |
| nilai 22 / unit / pita 8 | 71 px | **62 px** | gagal −8 |
| dua baris saja | 71 px | 59–62 px | gagal −11 |

Jadi pita tidak bisa pindah ke dalam. Tapi yang sebenarnya perlu berubah bukan **posisinya**,
melainkan **strukturnya**.

### Barisnya sekarang satu grid

Tiga kolom, masing-masing membawa **baris label di atas dan figur di bawah**, dan ketiga
kolom berbagi tepi atas serta tepi bawah yang sama:

```
DETRAINING      FITNESS        FATIGUE      ← baris label, satu garis
   ╭────╮       ┌──────┐       ┌──────┐
   │ −16 │       │  23  │       │  39  │     ← baris figur, satu garis
   │ TSB │       │ CTL  │       │ ATL  │
   ╰────╯       └──────┘       └──────┘
```

Pita naik ke baris label karena di sana ia **punya rekan**: `DETRAINING`, `FITNESS`, dan
`FATIGUE` sebaris, dan tiga figur — gauge, 23, 39 — sebaris. Dengan begitu baris hero bukan lagi
"ring, dua kartu, dan sesuatu yang menempel pada ring."

Kartu juga diregangkan setinggi baris (`items-stretch`) dengan isinya didorong ke dua ujung
(`justify-between`): label di atas, angka+satuan di bawah. Tanpa itu kartu tetap 75px di
tengah kolom 147px, dan itu yang menghasilkan diagonal yang terasa canggung.

**Detail yang menentukan:** kolom ring memakai `py-2.5` yang sama persis dengan kartu. Tanpa
itu baris label meleset **9 px** (pusat pita 224,5 vs pusat label 233,5) — satu piksel
padding sudah cukup untuk membuat dua baris itu tidak lurus.

### Terukur

| Lebar | tinggi kolom | sebaris label (spread) | sebaris figur (spread) |
|---|---|---|---|
| 320 px | 147 / 147 / 147 | **≤ 1 px** | **≤ 1 px** |
| 390 px | 147 / 147 / 147 | **≤ 1 px** | **≤ 1 px** |
| 430 px | 147 / 147 / 147 | **≤ 1 px** | **≤ 1 px** |

`RECOVER FIRST` (lebar 93 px) tetap muat di kolom 112 px dan tidak menyentuh kartu di semua
lebar. Strip bawah tetap **0 / 0 / 0**. Tinggi kartu hero tetap konstan antar ketiga tab.

### Tes

Tiga tes E2E baru (`the hero row is one grid at 320 / 390 / 430 px`): ketiga kolom sama
tinggi, berbagi tepi atas dan tepi bawah, tiga label dalam toleransi 1 px, tiga figur dalam
toleransi 1 px.

Tes pita juga **diperbaiki**, bukan hanya lulus: namanya dan argumentasinya masih
mendeskripsikan "keterangan di bawah gauge" — tata letak yang sudah tidak ada — sementara
assertions-nya tetap hijau karena kebetulan. Menghrename assertion tanpa accompanying
argumentasi akan meninggalkan tes yang mengunci sesuatu yang tidak lagi ada.

### Jebakan yang menyesatkan

Pengukuran pertama setelah restrukturisasi melaporkan label terpotong 3–4 px di 320 px, dan
computed style menunjukkan 9 px bukan 8 px. Dua kemungkinan salah tangkap muncul sebelum
benar: breakpoint `min-[360px]` dituduh tidak aktif (padahal Tailwind 4 menulisnya sebagai
`@media (width >= 360px)`, bukan `min-width`), lalu CSS basi dari HMR dituduh sebagai penyebab
sebenarnya — yang memang benar, tapi setelah satu jalur falsehood.

Pelajaran: CSS basi membuat pengukuran DOM berbohong, dan mengarang penjelasan yang masuk akal
untuk itu lebih berbahaya daripada tidak punya penjelasan.

---

## §41 — Pita form jadi pil selebar garis, dan ketiga pane berhenti di satu baris

Laporan: *"pasang pill DETRAINING selebar garis di bawahnya"*, lalu *"turunkan baris
fitness-fatigue-form agar tidak menyisakan ruang"*, lalu satu pertanyaan yang tidak meminta
perubahan apa pun: *"apakah istilah datanya sudah ramah untuk cyclist pemula?"*

Bagian ini menggantikan §40. Tiga hal berubah bersamaan karena ketiganya soal satu hal yang
sama — apa yang sebenarnya diukur pembalap di layar, bukan apa yang diukur kode.

### §40 ditinggalkan: pita bukan kolom ketiga

§40 menjawab keluhan "posisi pita janggal" dengan menaruh pita sebagai baris label kolom
pertama pada grid tiga kolom. Itu menjawab pertanyaan yang salah. Pita adalah **keterangan
tentang seluruh kartu** — bagaimana bentuk bergerak minggu ini — bukan label milik satu kolom,
dan menempelkannya ke kolom pertama justru menegaskan bahwa ia milik ring.

Yang dipakai sekarang: barisnya berdiri sendiri, selebar kartu, dengan pita di dalamnya dan
perubahan 7 hari di sebelahnya, lalu **garis penutup di bawahnya**, baru trio mingguan.

### Pil: ukurannya diambil dari garis, bukan dari isinya

Pita jadi pil `w-full` dengan `px-4 py-[5px]` dan `rounded-pill`. Dibuat selebar teksnya
sendiri (versi pertama), ia jadi chip sempit yang mengambang di kartu lebar — dan dua hal yang
harus dibaca menyilang, nama pita dan perubahan 7 hari, duduk di tengah kekosongan. Garis di
bawahnya sudah persis selebar ini, jadi pil mengambil ukurannya dari garis itu, dan keduanya
bertumpuk sebagai satu blok.

Chrome-nya **netral dan identik dengan dua kartu di atasnya** — `border-[#2b2d33]`,
`bg-[#23252c]/60`. Yang diwarnai hanya **nama pitanya**, dari `FORM_TONES`. Pil berwarna pita
adalah kesalahan §38, dan warna di chrome-nya itulah yang membuatnya terbaca sebagai benda
asing alih-alih keterangan. Terukur di 320, 390 dan 430 px: `leftGap 0`, `rightGap 0`, lebar
pil sama dengan lebar garis, tinggi 24 px, chrome identik dengan kartu (`chromeMatchesCards:
true`).

### Kartu berdiri di sumbu busur, bukan di sumbu kotaknya

Busur 240° tidak mengisi kotak 112 px-nya. Bentuk yang tercetak membentang dari **y 7** (49 px
di atas sumbu, yaitu radius ditambah setengah stroke) sampai **y 83** (titik di 30° dan 150°,
22 px di bawah sumbu, ditambah kepala bulat). Pusat massanya di **y 45**, sedangkan pusat kotak
di **y 56**.

Apa pun yang diletakkan di sebelah ring dan diukur terhadap kotaknya akan terbaca 11 px terlalu
rendah, karena pembalap melihat busurnya, bukan kotaknya. `ARC_RISE` (11 px) adalah selisih itu,
dan ia **diturunkan dari geometri**, bukan diketik, supaya tidak bisa melenceng dari ring yang
dijelaskannya. Terukur: pusat kartu **227,5**, tengah busur tercetak **227,6** → selisih
**0,1 px**.

### Baris status diukur dari kartu, bukan dari kotak ring

Baris status dulu mengikuti kotak 112 px dan mendarat **46,5 px** di bawah kartu, dengan garis
ring masih berjalan di sisi kiri celah itu. Sekarang ia mengikuti kartu, pada jarak tetap
`STATUS_GAP` = **20 px**. Terukur: kartu → pita = 20 px.

### Ketiga pane berhenti di satu baris

Ketiga pane berbagi satu sel grid, jadi kartu setinggi pane tertingginya — pane Today. Pane Form
dan Load lebih pendek, dan selisihnya jatuh **ke bawah**, bukan ke dalam chart:

| Pane | Chart sebelum | Sisa udara mati | Chart sesudah |
|---|---|---|---|
| Form (sparkline) | 96 px (dirender 86,7) | **22,3 px** | **109 px** |
| Load (bar + label hari) | 112 px | **59 px** | **171 px** |

Chart-nya sekarang menyerap sisa itu (`flex-1`), dan tingginya dibaca balik dari elemen
(`bind:clientWidth`/`bind:clientHeight`) alih-alih ditulis 191,5 px — tinggi itu ditentukan pane
tertinggi, yang ikut bergerak bersama pembungkusan label dan skala tipografi.

Pane Today awalnya **tidak** ikut mengisi sel, dan itu bug laten: selama ia kebetulan jadi yang
tertinggi, tidak ada yang terlihat. Begitu pane lain tumbuh melewatinya lewat `h-full`, kartu
bertambah tinggi dan baris terakhir pane Today tertinggal **4–5 px** di atas tepi bawah sementara
dua tab lain sudah di garis. Ia kini `h-full flex flex-col` dengan penyangga `flex-1` sebelum
trio, sehingga invariannya tidak lagi bergantung pada siapa yang tertinggi.

### Pita tidak diklaim kalau tidak ada beban

`computePmc` sengaja menelusuri jendelanya dari CTL=ATL=0, jadi pembalap yang belum pernah
bersepeda tetap mendapat kurva penuh berisi nol — dan `formState(0)` adalah `balanced`. Kartu
itu karena itu memberi tahu orang yang belum pernah latihan bahwa fitness dan fatigue-nya
**seimbang sempurna**, lengkap dengan `+0 pts / 7d`. Zeronya aritmetika yang benar; cara
membacanya yang tidak.

`hasPmcLoad()` menguji **serinya**, bukan daftar aktivitasnya, sehingga tidak mungkin berbeda
pendapat dengan kurva yang digambar di sebelahnya, dan ride yang lebih tua dari jendela tidak
bisa membuatnya mengaku ada beban yang tidak ditampilkan chart. Hasilnya di 320 px: pita
`NO DATA` dengan tone netral `rgb(155, 161, 170)`, ring dan kedua kartu berisi `—`, dan tidak ada
klaim 7 hari. `formState` sendiri **tidak disentuh** — tesnya masih menegaskan
`formState(0) === 'balanced'`, karena nol yang terukur adalah bacaan yang sah. Hanya nol yang
**tidak ada** yang salah.

### Jebakan: datum yang salah membuat tes berbohong selama beberapa iterasi

Tujuh assertion mengukur **pusat kotak 112 px** (`tier1.children[0]`) dan melaporkan
*"a tile sits -11px off the ring's centre line"*. Angka itu tidak ada di layar. Karena tesnya
merah, ia dilaporkan sebagai "tes usang" dan dibiarkan — dan justru itu biayanya: suite yang
merah permanen di pane yang sedang diperiksa membuat setiap klaim visual berikutnya diragukan,
termasuk yang benar, dan saya sempat meragukan `ARC_RISE` yang ternyata bekerja.

Perbaikannya bukan menurunkan ambang, melainkan **mengukur benda yang benar**: `gaugeArcMid()`
dan `gaugeArcBottom()` menyampel rentang `stroke-dasharray` yang tercetak, termasuk kepala bulat
`stroke-linecap="round"` yang menambah setengah lebar stroke di luar setiap ujung terbuka.

Dua kesalahan pengukuran saya sendiri, dicatat supaya tidak diulang:

1. **`getPointAtLength` menelusuri seluruh lingkaran, termasuk celah bawah yang tidak dicat.**
   Sampling seluruh path melaporkan pusat **lingkaran** (238,5) dan diam-diam merusak hal yang
   sedang diuji. Harus dibatasi ke panjang dash.
2. **Beberapa tes hero tidak menunggu seeder** (`waitForSeed`) dan membaca hero yang dibangun
   dari jendela nol — persis keadaan yang sekarang **ditolak** untuk digambar. Tes-tes itu lulus
   karena alasan yang salah; satu di antaranya bahkan lulus hanya karena busurnya masih digambar
   dari nol rekaan. Ketika data layer berhenti menggambarnya, tes itu gagal dan menyingkap
   balapan yang selama itu diam.

### Bukti menangkap regresi

Mengembalikan `hasLoad` ke `true` (bug aslinya) → gagal dengan
`a rider with no rides was given a form band` · `Expected: "NO DATA"` · `Received: "BALANCED +0
pts / 7d"`. Melepas `h-full` dari pane Form → gagal dengan `the Form pane's last row stops 46px
short` (320 px), `28px` (390 px), `18px` (430 px). Keduanya dipulihkan setelah terbukti.

Satu assertion **diganti, bukan dilunakkan**: tes yang menuntut pita tidak punya border sama
sekali bertentangan dengan pil yang diminta, dan tidak bisa dipenuhi bersamaan. Penggantinya
lebih ketat — chrome pil harus **sama persis** dengan dua kartu di sebelahnya, dan jaraknya
diukur dari **dasar busur tercetak**, bukan dari kotak 112 px yang menjulur ~17 px melewatinya.

Suite E2E: **56 tes hijau**, dari 8 merah yang semuanya berada di pane ini.

> **Koreksi:** geometri busur di §41 (`rotate(150 56 56)`, kotak 112 px, `ARC_RISE` 11 px) dan
> pita status selebar kartu **digantikan oleh §42**, yang mengganti ring dan memindahkan pita ke
> mulut busur. Cacah suite turun ke **55** setelah strip `today` dihapus bersama stripnya.

## §42 — Pita pindah ke mulut busur: ring 150 px, tiga baris jadi dua

Laporan: *"saya merasa masih kurang cocok dengan visual layout pada hero monolith dashboard"*,
lalu — setelah empat arah alternatif disiapkan di `mockups/hero-dashboard-variants.html` sebagai
perbandingan setara dengan keadaan sekarang — pilihan jatuh ke **V3 "Mulut Busur"**.

Bagian ini menggantikan §41 pada dua hal: geometri busur dan tempat pita. Yang **bertahan** dari
§41 adalah temuan yang tidak berubah — nol yang tak ada tetap harus jadi `NO DATA`, dan ketiga
pane tetap harus berhenti di satu garis.

### Keluhan dirumuskan dulu, supaya perubahannya bisa dinilai

Tiga masalah hero lama, dan yang pertama justru yang menghalangi yang lain:

1. **Pita tidak bisa tinggal di dalam busur 112 px.** `RECOVER FIRST` butuh ≈77 px pada 9 px,
sedangkan celah bersih antar dua kepala bulat busur 112 px hanya **66 px**. Pita terdorong
keluar dan harus mengarang barisnya sendiri — akar dari "baris yatim" yang dikejar §38–§41.
2. **Angka −16 duduk di busur yang panjangnya mengikuti nilainya sendiri**, jadi busur itu tidak
menjelaskan apa pun: penanda 0 di puncak sudah ada, tetapi ujung ±40 tidak.
3. **Mulut busur terbuang** — celah terbuka 240° di bawah justru ruang paling longgar di kartu.

### Yang berubah

- **Ring 112 → 150 px.** `GAUGE_BOX = 150`, `R = 59`, `STROKE = 10`, pusat `GAUGE_C = 75`.
- **Pita pindah ke dalam mulut busur**, tepat setinggi kepala bulat — `top = GAUGE_C + R/2`,
yaitu **R/2 = 29,5 px** di bawah pusat, titik **terlebar** mulut. `ARC_RISE` naik 11 → **14,75 px**
(massa tercetak membentang y 11..109,5 dari kotak 150 px, pusatnya 60,25 versus pusat kotak 75),
sehingga angka TSB ikut terangkat ke sumbu busur, bukan sumbu kotak.
- **Pil status lenyap** bersama barisnya. Pita bukan lagi garis di bawah angka; ia tempat angka
itu tinggal.
- **Dua kartu fitness/fatigue jadi satu pasangan** di bawah ring, tanpa chrome kartu, di sumbu
kartu — bentuk yang sama dengan trio pane Form.
- **Trio mingguan Today dihapus.** Kartu *Last 7 days* persis di bawah hero sudah menyatakan
Time/Distance/Stress yang sama; trio itu adalah pengulangan.

### Batas yang diukur, bukan diperkirakan

Mockup versi pertama menaksir celah dalam ring 150 px sebagai "≈79 px secara proporsional" dan
menyebutnya cukup. Arahnya salah: yang menentukan adalah celah **bersih antar kepala bulat**,
`2·(R·cos 30° − STROKE/2)`:

| Ring | Celah bersih antar kepala | `RECOVER FIRST` @9,5 px/.06em | Muat? |
| --- | --- | --- | --- |
| 112 px (lama) | 66 px | 81 px | tidak — §40/§41 benar menolaknya |
| 150 px (sekarang) | **92,2 px** | **81,3 px** | ya, sisa ≈5 px per sisi |

Diukur langsung di DOM aplikasi yang berjalan (bukan di mockup, bukan dari skala): pada 320,
360, 390 dan 430 px semuanya melaporkan ring 150 px, celah 92,2 px, dan pita `DETRAINING`
64 px dengan pusat **29,5 px** di bawah pusat ring; `RECOVER FIRST` 81,3 px. Menaruh pita ~13 px
lebih dalam menyempitkan celah mengikuti siluet ring sampai label terpanjang mulai terpotong —
karena itu `top` **diturunkan dari radius** (`R/2`), bukan angka yang diketik.

### Tes: yang berubah, dan satu yang sengaja dihapus

| Grup | Perubahan |
| --- | --- |
| `240-degree gauge` | hanya literal rotasi `rotate(150 56 56)` → `rotate(150 75 75)`; cx/cy/r tetap dibaca dari DOM |
| `figure rides the arc's centre line` | dulu mengukur kolom kartu di samping ring; sekarang angka TSB versus `gaugeArcMid`, **plus** ring terpusat pada kartu |
| `load figures read in full` | selector pindah ke pasangan di bawah ring; tuntutan tak-kliping dan sel setara tetap |
| `form band sits inside the gauge mouth` (**baru**) | pita ≤ celah antar kepala, pusat tepat di kedalaman kepala, terpusat pada ring |
| `form band name carries its own tone` | tabel `BAND_TONE` dipertahankan utuh; geometri pil dibuang bersama pilnya |
| `load figures stay compact under the ring` | tinggi dan rhythm sama; datum bergeser dari sumbu busur ke *clearance* terhadap `gaugeArcBottom` |
| strip `today` **dihapus**, strip `form` tetap | strip yang diuji sudah tidak ada, jadi satu kasus tesnya ikut hilang — **56 → 55 tes E2E** |

Satu grup baru (geometri mulut) ditambahkan dan satu grup lama (`BAND_TONE`) dipertahankan utuh;
yang hilang satu kasus, dan hilang karena **fitur yang diukurnya dihapus**, bukan karena gagal.

### Bukti menangkap regresi

Menggeser `top` pita 6 px lebih dalam dari `R/2` → tes baru gagal persis di situ:
`Math.abs(centreBelowRingCentre − capDepth)` · `Expected: <= 1` · `Received: 6`. Dipulihkan
setelah terbukti.

Tentang pola tiga-baris di pasangan itu: versi pertama menaruh unitnya sebagai `<span>` inline
di dalam baris nilai, dan empat tes pane gagal dengan
`the Today pane's last row stops 5px short` — kotak inline tidak mencapai dasar sel. Dipisah jadi
baris ketiga (label · angka · unit, pola yang sudah dipakai seluruh app) → 0 px.

### Trade-off yang jujur

- **Trio mingguan Today hilang.** Ia memang duplikat kartu *Last 7 days*, tetapi pembalap yang
melihat hero tanpa menggulir kini kehilangan jam/kilometer/TSS minggu itu di dalam kartu.
- **Pasangan fitness/fatigue kehilangan chrome kartunya.** Bobot visualnya berkurang dengan
sengaja, supaya busur kembali jadi fokus tunggal tier 1 — tetapi ia juga jadi kurang menonjol
daripada kartu-kartu lain di halaman saat dipindai cepat.

## §43 — Kluster hero dinaikkan skalanya: ring 180 px, angka 42 px, pita 12 px

Laporan: *"sesuaikan ukuran dan layout content didalam monolith agar tidak terlihat terlalu
kecil, dan juga sizing agar terlihat enak untuk dilihat. karena layout -16, form tsb, dan
detraining terlihat kurang enak dilihat"*.

§42 menyelesaikan **tempat** ketiga elemen itu; §43 menyelesaikan **ukurannya**. Ring 150 px
dengan angka 29 px dan pita 9,5 px ternyata proporsinya salah arah: makin besar kotaknya,
makin kecil terasa isinya, dan `DETRAINING` pada 9,5 px terbaca sebagai kaki lalat di
mulut busur — bukan sebagai jawaban atas pertanyaan yang diajak grafik itu.

### Yang diubah, dan ukuran lamanya

| Elemen | §42 | §43 | Alasan |
| --- | --- | --- | --- |
| `GAUGE_BOX` | 150 | **180** | lebar kartu di 320 px adalah 240 px; 180 masih menyisakan 30 px per sisi |
| `R` | 59 | **75** | dipilih supaya `R + STROKE/2 = 81` muat di 180 dengan margin 9 px |
| `STROKE` | 10 | **12** | tebal ikut naik, kalau tidak busur terasa tipis di ukuran baru |
| Angka TSB | 29 px | **42 px** | dari 20% jadi 30% diameter dalam — angkanya kini yang pertama terlihat |
| Caption `Form TSB` | 9 px | **10,5 px** | mengikuti angka, tetapi tetap di bawahnya secara hierarki |
| Nama pita | 9,5 px | **12 px** | 12 px membuat pita jadi label, bukan keterangan kecil |
| Pasangan load | 9/17/9 | **10/21/10** | dipertahankan rata pada 21 px — tesnya menuntut sel tinggi ≤80 px |
| Trio pane Form | 10/16 | **10,5/18** | 20 px sempat dicoba; `−16 TSB` butuh 78 dari 80 px di 320, sisa 2 px |
| Header tab & `LIVE` | 9,5/9 | **10,5/10** | chrome ikut naik seperlunya supaya tidak terbaca sebagai baris tua |

### Batas yang diukur, bukan diperkirakan

Celah bersih antar kepala busur tetap `2·(R·cos 30° − STROKE/2)`, sekarang dengan `R = 75`,
`STROKE = 12`:

`2·(75·0,866 − 6) = ` **117,9 px**, sedangkan `RECOVER FIRST` pada 12 px / .06em butuh
**102,7 px** — sisa **7,6 px per sisi**, dua kali lipat sisa §42 (5 px).

Diukur langsung di DOM aplikasi yang berjalan, di 320 dan 430 px: pita `DETRAINING`
**81 px**, pusatnya **37–38 px** di bawah pusat ring (target `R/2 = 37,5`), lebar celah
117,9 px; angka `-16` **77 px**; tidak ada overflow horizontal di 320/360/390/430.

Angka dan pita sama-sama berpusat: selisih pusat blok teks terhadap `gaugeArcMid` **0 px**
pada lebar mana pun, karena `ARC_RISE` masih diturunkan dari geometri — naik 14,75 →
**18,75 px**, persis `R/4` (massa tercetak 9..133,5 dari kotak 180, pusat 71,25 versus
pusat kotak 90).

### Kenapa trio Form berhenti di 18 px, bukan 20 px

Skala pertama menaikkan ketiganya ke 20 px agar menyamai pasangan `21px` di pane Today.
Pengukuran di 320 px membuktikan itu keputusan yang salah: `−16 TSB` butuh **78 px** dari sel
yang lebarnya **80 px**, sisa **2 px** — dan sel yang membungkus (`border-x`) menyisakan
lebih sedikit lagi. Sel sempit ke titik itu akan *membungkus* diam-diam, bukan meluap, jadi
tidak ada tes yang menangkapnya; yang terjadi di layar adalah baris ketiga yang tiba-tiba
jadi dua baris. Turun ke **18 px** memberi sisa 10 px (`−16 TSB` 70 px) dan tetap terbaca.

Ini trade-off yang disengaja: pane Today memakai 21 px dan pane Form memakai 18 px. Keduanya
tidak pernah terlihat bersamaan, dan selisih 3 px lebih kecil daripada risiko baris yang
bungkus di layar terkecil yang didukung.

### Tes: tidak ada kasus yang berubah jumlahnya

| Grup | Perubahan |
| --- | --- |
| `240-degree gauge` | literal rotasi `rotate(150 75 75)` → **`rotate(150 90 90)`**; cx/cy/r/stroke tetap dibaca dari DOM |
| sisanya | **tidak diubah sama sekali** — celah, kedalaman kepala, ketinggian sel, dan garis akhir ketiga pane semuanya diturunkan dari atribut SVG |

Suite tetap **55 tes hijau**. Angka di doc-comment `gaugeArcMid`/`gaugeArcBottom`
diperbarui (150 → 180, massa 11..109,5 → 9..133,5, 14,75 → 18,75) karena keduanya
membaca geometri dari DOM — komentar itu penjelasan, bukan batasan.

### Gerbang, dijalankan ulang setelah perubahan terakhir

`svelte-check` 0 error 0 warning · `npm test` **335 passed, 2 skipped (337)** ·
`npm run build` sukses · `npx playwright test` **55 passed**.

## §44 · Rebalancing pane Today: rongga 46,5 px hilang, pasangan naik ke 28 px

Tanggal: 4 Okt 2026 · Berkas: `src/lib/routes/dashboard/Dashboard.svelte`

### Keluhan & diagnosis

Rider melaporkan dua hal pada tab Today: "fitness dan fatigue terlihat terlalu kecil
 dibanding dengan gauge" dan "jarak antara objek terlihat ada gap yang jauh". Pengukuran
 DOM menemukan penyebabnya — dan tambahan ketiga yang tidak terlihat:

1. **Rongga 46,5 px yang tidak pernah dirancang.** Box SVG gauge 180 px hanya terpin sampai
   `ARC_BOTTOM` = 133,5 px; sisa box di bawah paint adalah ruang kosong murni yang
   dihitung layout sebagai bagian dari tier 1. Pasangan CTL/ATL yang duduk "tepat di bawah
   box" sebenarnya duduk 70 px di bawah paint — keluhan gap itu real,-causa nyata, bukan
   persepsi.
2. **Angka 21 px di bawah figur 42 px.** Piramida 42 / 21 / 18 membuat tier kedua nyaris
   tenggelam di bawah figur gauge yang empat kali derenannya untuk label yang sama
   (pasangan Fitness/Fatigue vs trio form yang 18 px — selisih 3 px tidak terbaca).
3. **Sisa eksperimen yang bocor ke produksi** dari sesi perancangan yang terputus:
   `style="height:{279 - (LOAD_PANE_H + 8)}px"` pada baris pasangan (tinggi tetap 226 px
   untuk konten 56 px), kelas Tailwind dinamis `mt-{LOAD_ROW_GAP}` yang tidak pernah
   tergenerate scanner Tailwind, dan `aria-hidden` pada angka yang hidup.

### Perubahan

- **Margin pintas tercetak**: wrapper gauge membawa
  `margin-bottom:-{GAUGE_BOX - ARC_BOTTOM}px` = **−46,5 px**, diturunkan dari dua konstanta
  geometri, bukan huruf. Layout sekarang mengikuti arc terpin, bukan box. Overlay figur dan
  nama band tetap absolute terhadap box 180 px — posisinya tidak tersentuh.
- **Pasangan 21 → 28 px**, `leading-none`, putih netral (`text-on-mono`). Piramida tipografi
  kini **42 gauge / 28 pasangan / 18 trio** — putra, 11 / 21 / 28, dan tidak lebih besar
  dari figur CP/W' di bawah dashboard.
- **Kembali ke `mt-3 pt-3` + `mt-1` statis**: satu gap 12 px antara gauge dan hairline, 4 px
  antarbaris dalam sel; tinggi sel mengikuti konten (66 px) sehingga spacer `flex-1` kembali
  bekerja dan ketiga pane tetap berakhir pada satu garis.
- **Chrome LIVE** dibereskan dari konflik `class:opacity-30` vs `class:opacity-0` yang
  tersisa.

### Terverifikasi dari DOM (vw 448 / 430 / 320)

| Properti | Nilai |
| --- | --- |
| clearance busur → pasangan | **11–12 px** (tes butuh ≥ 8) |
| tinggi sel pasangan | **66 px** di semua lebar, unik (protes "92 px") |
| jarak antarbaris cell | 4 px (≤ 8, tidak ada lubang) |
| tinggi kartu | 319 → **229 px** |
| `docOverflow` | 0 (tidak meluap sempit sekali pun) |
| `formChartH` / `loadChartH` | 141 / **207 px** (≥ 100 / ≥ 130) |

### Gerbang

`svelte-check` 0 err/0 warn · `npm test` **335 passed, 2 skipped** · `build` sukses ·
`playwright` **55 passed** (termasuk 6 kasus yang merah oleh hack tinggi tetap).

---

## §45 — Tab Today: “Tile Cerita” (M3)

**Permintaan.** Hero Today dinilai kurang menarik. Dibuatlah lima mockup di
`mockups/today-hero-refresh.html` — K0 (reproduksi kondisi §43) plus empat arah visual
(M1 Nadi, M2 Panel Lebar, **M3 Tile Cerita**, M4 Segmen) — dan **M3** yang dipilih untuk
dipasang.

**Perubahan.** Pasangan Fitness/Fatigue di bawah gauge — dua figur telanjang di bawah
garis rambut — menjadi dua **tile kaca**: latar `#1b1c22`, hairline `#2b2d33`, radius 14 px,
dan tiap tile diberi **bar 4 px** (76 % lebar tile) yang menaruh nilainya pada skala bersama
**0–60**, dengan kapsi `Bar = position on a 0–60 scale` di bawahnya.

- Angka **28 → 26 px**; piramida kini 42 gauge / 26 pasangan / 18 trio. Bar netral
  `on-mono/85` — busur tetap satu-satunya aksen rose pada kartu.
- `pct` di `HERO_LOAD_TILES` = `round(clamp(v, 0, 60) / 60 × 100)`; nilai di atas skala
  mengisi penuh track, dan tanpa data bilahnya 0. Kapsi menyebut skalanya — tanpa itu bar
  adalah angka yang tidak terbaca, kegagalan yang justru diperbaiki tile ini.
- Jarak gauge → tile `mt-5` (20 px terukur); hairline atas dan `border-l` antar sel dihapus
  karena tile menggambar tepinya sendiri.

### Terverifikasi (DOM di preview, vw 448 & 320; Playwright di 320/390/430)

| Properti | Nilai |
| --- | --- |
| tinggi grid hero | 229 → **283 px** (jejak pasangan 90 → 146 px) |
| tinggi tile | **104 px** di semua lebar, unik (batas tes ≤ 112) |
| label → figure / figure → unit | **4 px** (≤ 8, tanpa lubang) |
| bar Fitness / Fatigue | **37 % / 55 %** = `round(22/60×100)` / `round(33/60×100)` |
| kapsi skala | ada, menyebut “0–60”, tidak terpotong |
| clearance gauge → tile | **20 px** (tes butuh ≥ 8) |
| `docOverflow` | 0 di 320 & 448 |

### Gerbang (dijalankan setelah perubahan kode terakhir)

`svelte-check` 0 err/0 warn · `npm test` **335 passed, 2 skipped** · `build` sukses ·
`playwright` **55 passed** — termasuk “load tiles stay compact” yang kini juga mengunci
aritmetika bar terhadap figure-nya sendiri dan keberadaan kapsi skala.

---

## §46 · Satu pil untuk satu aplikasi, dan kegagalan tidak pernah menyamar jadi keberhasilan

Tiga rute masing-masing tumbuh dengan `showToast` sendiri: Rides 3400 ms, Routes 3400 ms
+ flag `sticky`, Settings 3000 ms. Tiga salinan satu ide yang tidak pernah bertemu. Yang
lebih buruk, ketiganya **menggambar centang hijau yang sama untuk tulisan yang gagal** —
`Backup failed` muncul dengan tampalan yang persis sama seperti `Zones saved`.

Dua puluh tujuh `catch` di kode non-test hanya `console.error` lalu `return`. Dalam aplikasi
local-first itu bukan detail: satu-satunya catatan bahwa data tidak tersimpan adalah baris
konsol yang tidak akan pernah dibuka pemiliknya.

### Yang berubah

| | Sebelum | Sesudah |
| --- | --- | --- |
| implementasi toast | 3, masing-masing dengan duranya | 1 di `lib/toast.svelte.ts` |
| centang untuk kegagalan | centang hijau yang sama | `octagon-alert` rose |
| `saveComponent` gagal | sheet tetap tertutup, nilai hilang | sheet tetap terbuka, nilai tertahan |
| `finishRace` gagal | wake lock dilepas, live mode mati | tetap live, bisa diulang |
| `logCheckpoint` gagal | field dikosongkan | field tertahan |
| `catch` senyap | 27 | 0 |
| rejections tak tertangani | hanya konsol | pil + konsol |

Nada menentukan glif **dan** warnanya; tidak ada komponen yang boleh memilihnya sendiri.
`busy` lengket secara sengaja — spinner yang hilang sendiri di tengah tugas memberi tahu
pekali tugasnya selesai, padahal belum. Durasi: konfirmasi 3,4 s, kegagalan 6 s (sekitar
dua kali, karena harus dibaca sekali).

### Batas yang digaris

- `main.ts` menyaring dua hal dan alasannya tercatat di kode: kegagalan *resource* (`<img>`
  404, font gagal) bukan kegagalan aplikasi, dan `ResizeObserver loop completed with
  undelivered notifications` adalah housekeeping peramban yang datang terus-menerus saat
  chart di-resize — tanpa saringan itu ia menimpa pesan sebenarnya dengan pesan yang lebih
  buruk.
- Satu kegagalan bisa sampai ke dua listener (Chromium melaporkan rejection yang sama ke
  `unhandledrejection` **dan** `error`). Bendera yang dibersihkan di macrotask berikutnya
  yang dipasangkan, karena kedua event membawa objek berbeda — identitas tidak bisa
  keduanya.

### Verifikasi

Di DOM preview (produksi build, `vite preview`): kegagalan → `COULD NOT SAVE CASSETTE`
dengan `text-rose`, sheet tetap terbuka, `Cassette` tertahan; setelahnya → `CASSETTE SAVED`
dengan `text-aman`, sheet tertutup. Kegagalan disuntik di `IDBObjectStore.prototype.put`,
**bukan** di `IDBDatabase.transaction` — Dexie mengikat `transaction` sekali saat koneksi
dibuka (`createDBCore` → `transaction: db.transaction.bind(db)`), jadi patch di database
tertangkap sebelum tes berjalan dan tidak pernah melihat satu pun tulisan.

### Gerbang (dijalankan setelah perubahan kode terakhir)

`svelte-check` 0 err/0 warn · `npm test` **343 passed, 2 skipped** · `build` sukses ·
`playwright` **58 passed** — termasuk "a component that fails to save keeps the sheet open
and says why", yang mengunci kegagalan pada jalur tulis sungguhan, bukan pada mock.
