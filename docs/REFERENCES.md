# References — Zonadua

Kumpulan repo open-source, produk, dan library yang menjadi rujukan fitur, algoritma, dan implementasi. Diperbarui saat riset 30 Sep 2026.

---

## 1. Repositori Fitur (open-source cycling/training apps)

### [GoldenCheetah](https://github.com/GoldenCheetah/GoldenCheetah) — C++
**Gold standard** analitik data bersepeda desktop. **Dipinjam:**
- Definisi & formula metrik: NP, IF, TSS (memang mereka yang populerkan), power profiling, PMC (CTL/ATL/TSB).
- Konsep "performance manager chart" dan mean-max power curve.
- Catatan: arsitektur desktop-nya tidak relevan untuk kita; ambil *pengetahuannya*, bukan kodenya (GPL).

### [VectorPace](https://github.com/busf4ult/vectorpace) — Web, open source
GPX pacing planner berbasis **Critical Power & W′**. **Dipinjam:**
- Pendekatan klasifikasi segmen flat/climb/descent dari GPX lalu estimasi speed per segmen dengan CP/W′.
- Parametrisasi rider: CP, W′, CdA, Crr, massa, wind.
- Referensi UX pacing table.

### [dyfan-davies/cycling-performance-model](https://github.com/dyfan-davies/cycling-performance-model) — Python
Prediksi waktu rute dari power profile + optimasi pacing dengan **genetic algorithm**. **Dipinjam:**
- Validasi model fisika (gravity/rolling/aero) — bandingkan hasil solver kita dengan implementasinya.
- Ide optimasi pacing (untuk backlog: "fastest strategy with same avg power").

### [sekimotosa/ride-time-planner](https://github.com/sekimotosa/ride-time-planner)
Estimasi jadwal ride dari GPX + power profile + **data ride nyata**. **Dipinjam:**
- Konsep kalibrasi estimasi dari riwayat ride — sangat dekat dengan F6 P1 kita.
- Struktur "schedule dari rute" yang menginspirasi race plan/checkpoint table.

### [royceschultz/Cycling-Power-Calculator](https://github.com/royceschultz/Cycling-Power-Calculator) — Python/Gradio
Visualisasi ride data + estimasi power dari fisika. **Dipinjam:**
- Sanity-check arah sebaliknya (speed → power) untuk memvalidasi solver balik kita.

### [Endurain](https://github.com/endurain-project/endurain) — self-hosted Strava-like
**Dipinjam:**
- Data model gear/bikes + body metrics + gear wear.
- Pola integrasi Strava sync di sisi klien.

### [claude-coach](https://github.com/felixrieseberg/claude-coach) — Web, open source
AI training plan generator (tri/marathon) yang menghubungkan Strava. **Dipinjam:**
- Pola prompt coaching yang berbasis data atlet.
- Struktur output rencana latihan mingguan.
- **Perbedaan penting:** mereka mengirim data Strava ke LLM; kita **tidak boleh** (Strava API Policy §5.3) — kita hanya mengirim metrik turunan Zonadua.

### [section-11](https://github.com/CrankAddict/section-11) — protokol coaching AI
"Open protocol for deterministic, auditable AI-powered endurance coaching." **Dipinjam:**
- Prinsip output AI yang **auditabel**: setiap rekomendasi harus merujuk angka/metrik yang bisa diverifikasi.
- Struktur "coaching rules" yang bisa dijadikan system prompt kita.

### Lainnya yang layak dilihat
- [brospi/gpx-bike-simulator](https://github.com/brospi/gpx-bike-simulator): simulator kecepatan fisika dari GPX + param rider — referensi ringkas implementasi.
- FitTrackee (cari di GitHub, self-hosted activity tracker): referensi data model import & gear; Python/Vue.

## 2. Produk Pembanding (bukan open source, dipakai sebagai referensi UX)

| Produk | Yang dipelajari | Yang kita bedakan |
|---|---|---|
| **intervals.icu** | Fitur & terminologi metrik (power curve, PMC, fitness & freshness) terbaik; dasar-dasar zona | Kita local-first + AI coach + race mode; mereka server-centric |
| **ultraPacer** | **Race tracker dengan cut-off & pacing berbasis terrain** — paling dekat dengan F7 kita (dari dunia ultrarunning) | Kita spesifik sepeda + fisika power + integrasi Strava |
| **TrainingPeaks** | Konsep CTL/ATL/TSB, race readiness, "Performance Management" | Kita gratis, AI-driven, GPX-first |
| **Strava** | sumber data + race heatmap & segment | Kita tidak menyaingi fitur sosialnya |
| **Golden Cheetah** | kedalaman analitik | Kita ringan, web, AI |
| **Komoot/ridewithgps** | UX estimator rute & cue sheet | Kita fokus estimasi waktu pribadi, bukan navigasi |

### Referensi internal proyek
- (dihapus 1 Okt 2026) artefak Google Stitch (`references/stitch_gowslab_cycling_dashboard/`, `docs/STITCH-PROMPTS.md`) dibuang dari proyek — UI kini dibangun original; Stitch akan dipakai lagi nanti hanya untuk poles yang diminta user.

## 3. Library & Data Sources

### 3a. Yang benar-benar terpasang vs yang masih rencana

Tabel di bawah mencantumkan kandidat. Hanya baris bertanda **✅ terpasang** yang benar-benar
ada di `package.json`; sisanya **belum di-*install*** — jangan dibaca sebagai "sudah dipakai".

| Library | Peran | Lisensi | Catatan |
|---|---|---|---|
| ✅ [Svelte 5](https://github.com/sveltejs/svelte) | UI framework | MIT | Runes API |
| ✅ [Vite](https://github.com/vitejs/vite) + [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | Build + PWA | MIT | Workbox di bawah kap |
| ✅ [Tailwind CSS 4](https://github.com/tailwindlabs/tailwindcss) | Styling | MIT | |
| ✅ [@fontsource-variable/plus-jakarta-sans](https://github.com/fontsource/fontsource) | Font | OFL-1.1 | Self-host variable font — **lisensi ikut di-_ship_** |
| ✅ [Hugeicons](https://github.com/hugeicons/hugeicons) | Icons | MIT | Subpath per ikon — tree-shakeable |
| ✅ [uPlot](https://github.com/leeoniya/uPlot) | Charts | MIT | ~45 KB, canvas, sangat cepat |
| 📋 [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | Map | BSD-3 | **Belum terpasang** — butuh Peta/M6 |
| ✅ [Dexie.js 4](https://github.com/dexie/Dexie.js) | IndexedDB wrapper | Apache-2.0 | liveQuery reaktif |
| ✅ [Vitest](https://github.com/vitest-dev/vitest) | Unit testing | MIT | 256 tes |
| 📋 [fit-file-parser](https://github.com/peterwjohnson/fit-file-parser-js) | FIT parser | MIT | **Belum** — sekarang parser sendiri di `course.ts` |
| 📋 [fflate](https://github.com/101arrowz/fflate) | Zip/deflate | MIT | **Belum** — untuk GPX batch import |
| 📋 [pako](https://github.com/nodeca/pako) | Deflate untuk stream | MIT | **Belum** — alternatif native |
| 📋 [nanoid](https://github.com/ai/nanoid) | ID | MIT | **Belum** — sekarang `newId()` sendiri |
| 📋 [fast-check](https://github.com/dubzzz/fast-check) | Property testing | MIT | **Belum** — kandidat bagus untuk fisika |
| ✅ [Playwright](https://github.com/microsoft/playwright) | E2E | Apache-2.0 | Terpasang — race cockpit + simulasi offline (`UI-SPEC §27`) |
| 📋 [Open-Meteo](https://open-meteo.com/) | Weather API | Free, no key | **Belum** — headwind masih input manual |
| 📋 [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) | Basemap | ODbL | **Belum** — max 1 req/s, cache agresif |
| 📋 [OSM France tiles](https://wiki.openstreetmap.org/wiki/Tile_servers) | Basemap alt | ODbL | **Belum** — untuk style topo |

Legenda: ✅ terpasang · 📋 direncanakan/kandidat.

## 4. Spesifikasi & Dokumen Teknis

- [Strava API v3 docs](https://developers.strava.com/docs/reference/) — activities, streams, oauth
- [Strava API Policy (Juni 2026)](https://www.strava.com/legal/api) — **baca wajib**: §5.3 (no AI on API data), §6.2 (7-day cache), §2.3 (data-to-owner only)
- [Strava rate limits](https://developers.strava.com/docs/rate-limits/) — 200/15min, 2000/hari (Standard 1–10 atlet)
- [GPX 1.1 schema](https://www.topografix.com/gpx.asp) — format rute
- [Coggan power profiling](https://www.trainingpeaks.com/blog/power-profiling/) — tabel W/kg untuk klasifikasi rider
- [Minimal Model CP-W′ (Morton)](https://en.wikipedia.org/wiki/Critical_power_model) — model CP/W′
- [Martin et al. cycling power model](https://www.researchgate.net/publication/12845421_Martin_J_C_et_al_1998) — sumber koefisien fisika
- [PMA/PMC reference](https://www.trainingpeaks.com/blog/the-science-of-the-performance-manager/) — CTL/ATL/TSB
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — enkripsi backup
- [Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Wake_Lock_API) — race day screen

## 5. Catatan Lisensi untuk Kita

> **Status 2 Okt 2026.** Zonadua memakai **MIT** ([LICENSE](../LICENSE)). Ketentuannya:
> referensi di bawah ini dipakai untuk **fitur, algoritma, dan formula** — **tidak ada kode
> yang disalin** dari satu pun repo. Verifikasi: tidak ada identifier khas GoldenCheetah
> (`PLT_`, `peakTorque`, `best5s`, `reverseMetric`) di `src/`. Font Plus Jakarta Sans
> (OFL-1.1) di-*bundle*, jadi teks lisensinya ikut dik-_ship_ di
> `public/licenses/Plus-Jakarta-Sans-OFL-1.1.txt` — kewajiban OFL, bukan formalitas.
> Ringkasan atribusi untuk pengguna ada di bagian "License & attribution" README.

- **Jangan copy kode** dari GoldenCheetah (GPL-2.0) — hanya ambil formula & konsep (formula metrik adalah pengetahuan umum, publikasi TrainingPeaks/Coggan). **Sudah diverifikasi:** hanya formula yang diambil.
- Library yang dipilih semuanya MIT/BSD/Apache/OFL — aman untuk proyek pribadi dan open-source.
- Jika Zonadua akan open-source: pilih MIT atau Apache-2.0, hindari dependency GPL di bundle klien.
- Data pengguna tetap milik pengguna: local-first memastikan itu; tanpa tracking analitik pihak ketiga.

## 6. Prioritas Belajar (kalau waktu terbatas)

1. **VectorPace source** — cara mereka smoothing elevasi + segmentasi + solver speed (paling dekat dengan core M3).
2. **GoldenCheetah metrics documentation / kode `RideMetric`** — memastikan implementasi NP/IF/TSS/PMC benar.
3. **ultraPacer UX** — bagaimana mereka menampilkan cut-off buffer dan pacing table (untuk M4).
4. **Strava API Policy** — supaya desain sync M6 tidak melanggar sejak awal.
