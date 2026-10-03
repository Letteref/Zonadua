# PRD — Zonadua
**Personal Cycling Performance, Estimation & Race Assistant**

| | |
|---|---|
| Versi | 1.0 — 30 September 2026 |
| Status | Draft untuk implementasi |
| Platform | PWA (installable, offline-capable) |
| Prinsip teknis | Local-first, zero-cost hosting, snappy & smooth |
| Bahasa UI | Indonesia (dapat dikonfigurasi) |

---

## 1. Latar Belakang & Masalah

Pesepeda yang menargetkan event/gran fondo/ultra (mis. 200–300+ km dengan cut-off waktu) kesulitan menjawab tiga pertanyaan sebelum dan selama race:

1. **"Apa kemampuan saya saat ini?"** — data terfragmentasi di Strava (aktivitas), catatan manual (berat badan, sepeda), dan tidak pernah dihitung menjadi satu angka yang bisa dipakai untuk merencanakan.
2. **"Bisakah saya finis sebelum cut-off di rute ini?"** — tidak ada alat yang menggabungkan profil GPX rute + power profile pribadi + kondisi cuaca + pengalaman berhenti menjadi estimasi waktu yang realistis.
3. **"Saya di KM 87, jam 14:32 — apakah masih aman?"** — selama race tidak ada alat yang menjawab ini secara instan dan offline, hanya dengan input cepat "kilometer sekarang".

Aplikasi yang ada hanya menjawab sebagian: Strava menjawab #1 sebagian, ultraPacer/VectorPace menjawab #2 untuk lari, tidak ada yang menggabungkan semuanya dan gratis, tanpa iklan, dan milik pengguna sendiri.

## 2. Vision Statement

> Zonadua adalah asisten latihan dan race personal yang mengubah data Strava + data tubuh + data sepeda menjadi pengetahuan yang bisa ditindaklanjuti: berapa kemampuan saya, berapa waktu finish saya di rute ini, dan apakah saya aman dari cut-off — semuanya di perangkat saya, tanpa biaya, dan tetap bekerja tanpa internet di tengah perjalanan.

## 3. Target User

**Primary persona — "Andi, 34, pesepeda event":** punya sepeda road/gravel, berlangganan Strava, ikut 2–4 event besar per tahun (gran fondo, brevet, ultra), berlatih 6–10 jam/minggu. Butuh: analitik latihan, estimasi rute, race-day tracker. Punya smartphone + laptop. Tidak mau bayar bulanan lagi untuk aplikasi analitik.

**Secondary persona — "Sarah, 28, rider yang sedang berkembang":** baru serius berlatih 1 tahun, ingin arahan latihan (AI coach), mencatat berat badan dan FTP secara rutin.

**Non-user:** tim profesional dengan multi-atlet, komunitas dengan feed sosial — di luar scope (lihat Non-Goals).

## 4. Non-Goals (Explicit Out of Scope)

- ❌ Feed sosial, komentar, kudos, share publik (Strava sudah ada).
- ❌ Kontrol smart trainer / fitur indoor interaktif (bisa jadi v-later, bukan core).
- ❌ Multi-tenant SaaS dengan akun banyak pengguna; aplikasi ini single-user per perangkat.
- ❌ Menjadi pelacak real-time GPS saat ride biasa (race mode memakai input manual ringan, bukan tracking GPS kontinu).
- ❌ AI yang mengonsumsi data mentah Strava API (dilarang oleh Strava API Policy §5.3).

## 5. Prinsip Produk

1. **Local-first:** semua data di perangkat; app 100% fungsional offline; cloud sync adalah kenyamanan, bukan syarat.
2. **Snappy:** interaksi < 100 ms, chart digambar via canvas (uPlot), tidak ada animasi menghalangi input.
3. **Zero-cost:** tanpa server yang harus dibayar; hosting statis + Worker free tier + BYO AI key.
4. **Hitung transparan:** setiap estimasi menampilkan asumsinya (Crr, CdA, stop time, dsb.) dan bisa diubah pengguna.
5. **Race day = nol friksi:** input dua-tap, font besar, layar menyala, bekerja offline penuh.

## 6. Fitur Inti

> Prioritas: **P0** = MVP wajib, **P1** = penting, **P2** = menyusul. Setiap fitur punya acceptance criteria (AC) yang bisa diuji.

---

### F1 — Performance Statistics dari Strava · P0

Analitik latihan yang dihitung dari aktivitas (hasil sync Strava dan/atau import file GPX/TCX/FIT).

**Sub-fitur:**
- Ringkasan: jarak, waktu bergerak, elevasi, kecepatan rata-rata/max, power rata-rata/NP, HR rata-rata/max, kalori.
- **Power Curve / Mean-Max Power** (1s, 5s, 1min, 5min, 20min, 60min, dst.) — bila power stream tersedia; dari HR+speed bila tidak (estimasi).
- **TSS / IF / NP** per aktivitas (dihitung lokal, tidak mengandalkan Strava).
- **PMC (Performance Management Chart): CTL (fitness), ATL (fatigue), TSB (form)** — grafik tren harian.
- **Zona waktu & zona HR** distribusi per aktivitas dan agregat mingguan/bulanan.
- **Critical Power (CP) & W′** — di-fit dari power curve (model 3-parameter Minimal Model) untuk dipakai F6/F7.
- Deteksi **ride vs commute vs training** berdasarkan kategori manual/otomatis.

**User story:** *"Sebagai pesepeda, saya ingin melihat power curve dan tren fitness saya sehingga saya tahu apakah latihan saya efektif."*

**Acceptance criteria:**
- AC1: Import 1 file GPX → aktivitas muncul di list dengan jarak/elevasi/waktu yang cocok dengan file (±1%).
- AC2: Aktivitas dengan power stream → TSS/IF/NP dihitung dan sesuai definisi (TSS = durasi_jam × IF² × 100).
- AC3: Dengan ≥ 5 aktivitas bermuatan power, power curve gabungan ter-render dan CP/W′ ter-fit dengan R² ≥ 0.95.
- AC4: PMC ter-render dari CTL/ATL/TSB harian dan ter-update otomatis saat aktivitas baru masuk.
- AC5: Semua chart tergambar < 200 ms untuk 500 aktivitas (uPlot, canvas).

---

### F2 — Body Profile · P0

Profil tubuh sebagai input model fisika & personalisasi.

**Sub-fitur:**
- Data dasar: nama, jenis kelamin, tanggal lahir, tinggi badan.
- **Riwayat berat badan** (input manual, timestamped) — dipakai model fisika (massa total) dan tren.
- **Riwayat FTP** (input manual dan/atau hasil auto-detect dari power curve 20min/CP) — dipakai TSS/IF dan zona.
- **Zona HR & Power personal** (template atau custom: 5-zona / 7-zona; editor manual).
- Optional: resting HR, max HR, LTHR, threshold pace cadence preferensi.
- Optional P1: kondisi medis/sleep/soreness log ringan untuk konteks AI coach.

**User story:** *"Sebagai pesepeda, saya ingin mencatat berat badan dan FTP saya dari waktu ke waktu sehingga semua perhitungan memakai nilai terkini."*

**Acceptance criteria:**
- AC1: Input berat badan hari ini → F4/F6/F7 langsung memakai nilai baru.
- AC2: Grafik tren berat & FTP ter-render dengan overlay satu sama lain.
- AC3: FTP baru → TSS/IF aktivitas lama dihitung ulang (pakai FTP berlaku pada tanggal aktivitas — FTP history aware).
- AC4: Editor zona menyimpan template (mis. Coggan 5-zona) dan bisa dikustomisasi per zona.

---

### F3 — Bike & Gear Profile · P0

Profil sepeda lengkap termasuk parameter fisika untuk model estimasi.

**Sub-fitur:**
- Multi-sepeda: nama, tipe (road/gravel/MTB), merek/model, tahun, catatan.
- **Berat sepeda** (kg) — termasuk opsi "berat + aksesori".
- **Parameter fisika:** Crr (rolling resistance, default per tipe ban/permukaan) dan CdA (aero) per sepeda, editable dengan preset (mis. hoods/bars, posisi).
- **Odometer** per sepeda — otomatis bertambah dari aktivitas yang memakai sepeda tersebut.
- **Komponen & maintenance:** daftar komponen (rantai, cassette, ban, brake pads, dll.) dengan umur pakai (km) dan interval servis → pengingat "komponen X sudah melewati N km".
- Foto sepeda (opsional, disimpan lokal).

**User story:** *"Sebagai pesepeda, saya ingin mencatat sepeda dan komponennya sehingga saya tahu kapan harus servis dan model estimasi memakai berat & aerodinamika yang benar."*

**Acceptance criteria:**
- AC1: Menambah sepeda dengan berat + Crr/CdA default → tersimpan dan bisa dipilih saat log aktivitas/import.
- AC2: Aktivitas baru dengan sepeda X → odometer X bertambah sesuai jarak aktivitas.
- AC3: Komponen dengan interval 4.000 km & odometer terkait → badge peringatan muncul di dashboard bila tercapai ≥ 90%.
- AC4: Parameter Crr/CdA bisa diubah per sepeda dan langsung dipakai F6.

---

### F4 — Combined Statistics (Tubuh + Sepeda + Aktivitas) · P0

Statistik gabungan yang hanya bisa dihitung karena kita punya ketiga sumber data.

**Sub-fitur:**
- **Watts/kg** (FTP/w berat tubuh terkini; juga power curve normalized).
- **Kalori & pengeluaran energi** — dihitung dari kJ kerja (bukan formula generik).
- **Efficiency metrics:** efficiency factor (NF/HR), decoupling (HR drift) per aktivitas aerobik panjang.
- **Tren berat badan vs power** — scatter/line overlay (apakah FTP naik saat berat turun?).
- **Gear wear stats** — km per komponen, biaya per km (opsional), sisa umur estimasi.
- **Per-band performa:** perbandingan kecepatan rata-rata di kategori rute sama (flat/hilly) antar bulan.
- Ringkasan "athlete snapshot": satu kartu yang menjawab "di mana saya sekarang" (FTP, W/kg, CTL, TSB, berat, form).

**User story:** *"Sebagai pesepeda, saya ingin melihat watts/kg dan efisiensi saya sehingga saya tahu progres nyata, bukan hanya kecepatan mentah."*

**Acceptance criteria:**
- AC1: Kartu snapshot menampilkan FTP, W/kg, CTL, TSB, berat terkini — semua angka berasal dari data yang benar.
- AC2: Mengubah berat badan → W/kg dan kalori estimasi ter-update.
- AC3: Grafik "FTP vs berat" ter-render dengan rentang waktu yang bisa dipilih (90 hari / 1 tahun / semua).
- AC4: Gear wear ter-update otomatis dari aktivitas; daftar komponen terurut dari yang paling mendekati interval.

---

### F5 — Built-in AI Coach · P1

Asisten latihan berbasis LLM dengan konteks dari data lokal yang dihitung Zonadua.

**Sub-fitur:**
- **Weekly review otomatis:** ringkasan mingguan (jam, TSS, distribusi zona, form/TSB) + insight teks dari AI.
- **Tanya jawab kontekstual:** chat dengan akses ke ringkasan metrik (bukan raw data) — "Apakah saya cukup siap untuk event X?" dijawab dengan CTL/TSB/CD dalam konteks target.
- **Rencana latihan:** generator rencana mingguan (durasi + intensitas per sesi) berdasarkan hari tersisa ke event, CTL saat ini, dan ketersediaan waktu pengguna; dapat diadjust manual.
- **Pre-race briefing:** rekomendasi pacing (IF target), nutrisi (g/h berdasarkan berat & durasi), dan strategi berhenti untuk event terdekat.
- **BYO API key:** pengguna memasukkan API key sendiri (default provider: Gemini free tier; pilihan lain: OpenAI, Anthropic, OpenRouter, endpoint kompatibel OpenAI apa pun). Key disimpan lokal, request dikirim langsung dari browser.
- **Kepatuhan Strava §5.3:** konteks AI hanya metrik turunan yang dihitung Zonadua (TSS, CTL, power curve summary, dsb.) — bukan raw stream dari Strava API. Data dari file import dan input manual tidak termasuk batasan ini, tetapi kita tetap konsisten pakai metrik ringkas.
- Semua output AI disimpan sebagai "note" yang bisa dihapus.

**User story:** *"Sebagai pesepeda, saya ingin AI yang memahami data saya memberi arahan latihan mingguan sehingga saya tidak perlu coach berbayar untuk progres."*

**Acceptance criteria:**
- AC1: Tanpa API key → fitur AI tidak muncul/tertutup dengan onboarding singkat; app tetap fungsional penuh.
- AC2: Dengan key → weekly review menghasilkan teks yang merujuk angka metrik nyata (tidak boleh menghalusinasi angka yang tidak ada di konteks — prompt di-craft untuk hanya mengutip angka yang diberikan).
- AC3: Chat menjawab pertanyaan "apakah saya siap untuk event tanggal X" dengan merujuk TSB/CTL/rute yang dipilih.
- AC4: Rencana latihan dapat disimpan ke kalender latihan sederhana dan ditandai selesai/tidak.
- AC5: Tidak ada request AI yang berisi raw GPS stream atau data mentah aktivitas Strava.

---

### F6 — Route Estimator (GPX + Performance) · P0

Estimasi waktu & strategi untuk sebuah rute GPX berdasarkan kemampuan pribadi.

**Sub-fitur:**
- Upload/drag-drop file **GPX** (dan TCX/FIT sebagai bonus) → parse track points, elevasi.
- **Smoothing elevasi** + klasifikasi segmen (flat/climb/descent) otomatis.
- **Model fisika power → speed** per titik: gravitasi (m·g·v·grade), rolling (Crr·m·g·v), aero (½·ρ·CdA·v³), drivetrain loss; massa = rider (dari F2, tanggal-valid) + bike (dari F3) + cargo; batas kecepatan descent opsional.
- **Power target input:** pengguna pilih strategi (IF target, mis. 0.70 FTP, atau NP target) → model menghitung kecepatan per segmen → waktu total.
- **Perhitungan berhenti:** parameter "stop time per 50 km" / total stop time estimasi (default dari pengalaman/F4).
- **Elevasi & kecepatan profile chart** interaktif (hover → KM, grade, kecepatan, waktu).
- **Tabel checkpoint** otomatis: setiap X km atau setiap climb utama → waktu tempuh estimasi, waktu hari.
- **Weather-aware (P1):** ambil prakiraan Open-Meteo (free, no key) berdasarkan titik koordinat & jam estimasi → penyesuaian suhu/wind pada model + tampilkan ringkasan cuaca.
- **Kalibrasi (P1):** bandingkan hasil estimasi vs aktivitas nyata di rute sama → koreksi faktor pribadi.

**User story:** *"Sebagai pesepeda, saya ingin upload GPX rute event dan melihat estimasi waktu finish saya dengan IF target tertentu sehingga saya bisa menyusun strategi."*

**Acceptance criteria:**
- AC1: GPX 200 km di-parse < 2 detik, profil elevasi digambar, total jarak & D+ sesuai tool pembanding (±2%).
- AC2: Estimasi waktu finish berubah logis saat parameter diubah (FTP naik → waktu turun; Crr naik → waktu naik; menambah stop time menambah total).
- AC3: Tabel checkpoint menampilkan KM, waktu tempuh, jam lokal (dengan start time input), dan grade rata-rata segmen.
- AC4: Mode cuaca: proyeksi waktu finish menyesuaikan bila ada angin headwind kuat di segmen panjang (perubahan terlihat).
- AC5: Batas descent speed opsional dipatuhi (mis. max 65 km/jam di descent curam).

---

### F7 — Race Mode (Live Tracker) · P0 ⭐ *Fitur pembeda utama*

Tracker race-day yang menjawab "apakah saya aman dari cut-off?" dengan input minimal di jalan.

**Sub-fitur:**
- **Setup race** dari GPX (dipakai bersama F6): jarak, start time, **cut-off waktu finish** (dan cut-off antara bila ada — bisa dari titik GPX), checkpoint definisi.
- **Live tracking sederhana:** pengguna menekan tombol besar → "KM sekarang: [input]" pada jam tertentu → Zonadua menghitung:
  - Kecepatan rata-rata aktual & kecepatan bergerak (setelah koreksi berhenti bila diisi).
  - **Proyeksi waktu finish** (dari sisa jarak × pace model + stop time).
  - **Buffer terhadap cut-off** — dalam menit dan dalam % — dengan visual aman/waspada/kritis.
  - **Required pace** untuk sisa rute agar finis tepat pada cut-off (dan apakah itu realistis vs CP/W′).
  - Deviasi vs rencana (dari F6): ahead/behind schedule.
- **Riwayat checkpoint** (jam & KM tiap input) — timeline vertikal.
- **Cut-off antara** (bila race punya cut-off di checkpoint tertentu, mis. KM 120 max jam 15:00) → buffer dihitung per checkpoint, bukan hanya finish.
- **Work offline penuh** (service worker; race di pegunungan tanpa sinyal tetap jalan).
- **Race day UI:** dark mode, tombol besar, waktu & buffer jadi elemen dominan, wake-lock (layar tidak mati).
- **Pasca-race:** simpan hasil aktual (waktu finish, catatan) dan bandingkan vs estimasi → melatih koreksi faktor.

**User story:** *"Sebagai pesepeda, saat race saya ingin menekan tombol dan input KM sekarang sehingga dalam 1 detik saya tahu apakah saya masih aman terhadap cut-off dan berapa pace yang dibutuhkan."*

**Acceptance criteria:**
- AC1: Setup race 250 km dengan cut-off 13 jam → mode live bisa dibuka, tombol input besar terlihat, timer jalan.
- AC2: Input "KM 87 pada 14:32" → dalam < 1 detik muncul: proyeksi finish, buffer cut-off (menit), required pace, deviasi vs rencana.
- AC3: Bila required pace melebihi kemampuan (dari CP/W′) → status berubah kritis dengan pesan yang jelas.
- AC4: Cut-off antara di KM 120 jam 15:00 → buffer terhadap checkpoint ini juga tampil dan jadi acuan status.
- AC5: Mode airplane (offline penuh) → semua fungsi race live tetap jalan.
- AC6: Setelah race, hasil aktual tersimpan dan muncul di perbandingan estimasi vs aktual.

---

### F8 — Data Management & Settings · P0

- Import: GPX/TCX/FIT (batch), backup/restore **JSON penuh** (semua data lokal).
- Strava sync status & re-sync manual; hapus data sync.
- Unit: metrik/imperial; format waktu; bahasa UI.
- Tema: dark/light (dark = default untuk race day), aksen warna.
- Kelola AI key (F5) — uji koneksi, hapus.
- **Cloud sync opsional (P1):** enable/disable, device list, last sync timestamp.
- Hapus semua data (dengan konfirmasi ganda).

---

## 7. Fitur Rekomendasi Tambahan (dari riset, bukan permintaan awal)

| Fitur | Prioritas | Alasan |
|---|---|---|
| Pelacakan berat badan historis & tren | P0 (sudah di F2) | Memperbaiki akurasi model fisika + tren |
| Weather-aware pacing (Open-Meteo) | P1 | Signifikan untuk race 10+ jam; gratis tanpa key |
| Rencana nutrisi & pacing otomatis (g/h, gel per jam) | P1 | Pasangan natural race mode; dihitung dari berat & durasi |
| Race-day dark mode + wake-lock | P0 (bagian F7) | Kebutuhan nyata race start 04:00 |
| Odometer & pengingat maintenance sepeda | P1 (bagian F3) | Menjaga app relevan harian, bukan hanya saat race |
| Kalibrasi estimasi dari riwayat ride | P2 | Semakin dipakai, semakin akurat |
| Segment/TSM comparison vs attempt sebelumnya | P2 | Motivasi jangka panjang |
| Ekspor rencana race ke PDF/teks (untuk cetak ditempel di stem cap) | P2 | Detail yang dicintai ultra rider |

## 8. Data Model (ringkas)

> Skema teknis lengkap ada di ARCHITECTURE.md.

- `athlete` — profil tubuh + settings (1 record).
- `weight_log` — { date, kg }.
- `ftp_history` — { date, ftp }.
- `bikes` — { name, type, weight, crr, cda, odometer, ... }.
- `components` — { bikeId, name, installOdo, intervalKm, ... }.
- `activities` — { date, source(strava|file), distance, movingTime, elevGain, avgPower, np, tss, if, hr, ... }.
- `activity_streams` — { activityId, time, latlng, alt, watts, hr, cad, ... } (dikompresi).
- `routes` — { name, gpxMeta, points, elevStats }.
- `races` — { routeId, name, startTime, cutoffAtFinish, cutoffsAtCheckpoints, plan }.
- `race_logs` — { raceId, at, km }.
- `ai_notes` — { type(review|plan|chat), content, createdAt }.
- `sync_state` — cursor Strava per tipe data.

## 9. Metrik Sukses (Produk)

1. **Accuracy:** estimasi waktu finish vs waktu aktual race aktual deviasi < ±7% (target v1) — diukur lewat fitur pasca-race F7.
2. **Reliability race-day:** 100% fitur race live bekerja offline.
3. **Snappiness:** interaksi utama (buka app, input checkpoint, hover chart) < 100 ms; app size (JS gzip) < 250 KB.
4. **Adoption nyata:** pengguna (Andi) memakai race mode di ≥ 1 race tanpa fallback ke alat lain.
5. **Zero-cost:** biaya hosting & infrastruktur = Rp 0; biaya AI = API key pengguna sendiri (free tier memenuhi).

## 10. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Strava mengubah policy lagi | Sync rusak | Import file tetap jalur utama yang bebas policy; sync opsional |
| File FIT parsing rumit | Import gagal | Pakai library mature (fit-file-parser); mulai dari GPX yang lebih sederhana |
| Estimasi fisika tidak akurat untuk semua orang | Kepercayaan turun | Tampilkan asumsi, koreksi faktor pribadi via kalibrasi (F6 P1) |
| AI menghalusinasi angka | Rekomendasi salah | Prompt ketat: hanya boleh mengutip angka dari konteks; tampilkan sumber angka |
| IndexedDB terhapus (clear site data) | Kehilangan data | Reminder backup otomatis + ekspor JSON 1-klik; cloud sync opsional |
| uPlot custom styling berat | Dev time | Mulai dari config default; bungkus komponen chart reusable |

## 11. MVP (Minimum Viable Product)

MVP = **M0 + M1 + M2 + M3 + M4** (lihat ROADMAP.md):
- Import GPX/TCX + Strava sync (F1 dasar)
- Profil tubuh & sepeda (F2, F3)
- Statistik: TSS/IF/NP, power curve, PMC, snapshot (F1, F4)
- Route estimator (F6)
- Race mode live (F7)
- Backup/restore JSON (F8)

AI Coach (F5) + weather + cloud sync masuk setelah MVP.
