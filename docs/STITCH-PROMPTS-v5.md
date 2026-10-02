# Stitch Prompts — GowsLab (v5.1 "Crimson Clean", 1 Okt 2026)

> Cara pakai: tempel satu prompt ke Google Stitch, hasilnya dipakai sebagai **inspirasi poles** —
> implementasi tetap lewat sistem token di `src/app.css`. Sengaja **tanpa aturan ukuran & layout**
> supaya Stitch bisa mengeksplorasi komposisi lebih dalam; yang dikunci hanya identitas visual, data, dan maksud tiap layar.

---

## 0. Sistem visual (tempelkan di awal setiap prompt / jadikan style reference)

> GowsLab — aplikasi performa bersepeda local-first. Tema "Crimson Clean": kanvas abu netral sangat terang (#F9F9F9), kartu putih bersudut membulat dengan bayangan lembut, aksen merah terang sporty (#E8102E) yang energik tapi terkendali. Satu momen "monolith" gelap per layar: kartu grafite (#141519) dengan semburat merah ember yang naik dari satu sudut — dipakai untuk kartu paling penting di layar itu (readiness, angka besar, rencana balapan). Tipografi Plus Jakarta Sans tegas dan atletik; angka besar tabular; label kecil uppercase dengan letter-spacing. Chip status tinted: AMAN hijau, WASPADA amber, KRITIS merah. Navigasi bawah: pil gelap mengambang, ikon-only, tab aktif berupa pill merah dengan label. Nuansa keseluruhan: kokpit atlet yang bersih — data intens, tidak gaduh.

---

## 1. Dashboard — Today

> Rancang ulang layar "Today" GowsLab dengan sistem visual di atas. Konten wajib tersedia: sapaan personal untuk atlet Andi, satu kartu monolith gelap berisi **readiness 40%** berbentuk ring merah dengan label "RECOVER FIRST", form (TSB) −11, CTL 22 · ATL 33, serta baris ringkas waktu 5.8h / jarak 124 km / stres 313 TSS minggu ini. Di bawahnya: metrik FTP 275 W (+17 W dari 4 bulan lalu), power-to-weight 4.0 W/kg, fitness 22, kartu form −11 TSB yang menonjol dengan gradasi merah, grafik TSS harian 7 hari dengan garis target 450, tren CTL vs ATL 90 hari dengan sparkline form 30 hari, dan pengingat: chain wear 100% KRITIS serta balapan "Bukit Barisan 200" 42 hari lagi. Eksplorasi bebas cara mengomposisi semua ini — kandidat ide: bento asimetris, satu kolom dengan monolith dominan, atau kartu ring yang memimpin hierarki.

## 2. Rides

> Layar "Rides": ringkasan minggu berjalan di kartu monolith gelap (124 km · 5.8h · 313 TSS), chip filter (All / Rides / Commutes / With power), dan daftar aktivitas terbaru — tiap baris berisi nama, tanggal, jarak, elevasi, durasi, TSS, IF, dan sparkline power mini. Contoh data: "Sunday Long Ride — 29 Sept · 42.0 km · 672 m ↑ · 1h 30m · TSS 132 · IF 0.84 (Strava)". Eksplorasi: daftar kartu, daftar editorial bergaris, atau hybrid dengan angka TSS sebagai elemen paling kuat di tiap baris.

## 3. Routes

> Layar "Routes" untuk rute balapan Bukit Barisan 200 (200.4 km, 3,150 m naik, GPX). Wajib ada: kartu monolith proyeksi hasil (estimasi selesai 6h 41m, target tiba 12:11 WIB, avg 30 km/h, 2,840 kcal, NP 198 W), profil elevasi dengan penanda pendakian tertinggi "Koto Tinggi Climb 87 km +6.2%", pemilih strategi intensitas (Endurance IF 0.65 / Steady 0.72 / Attack 0.81) dengan target power 198 W pada skala FTP 275 W, setup (bike Domane SL6, cargo 3 kg, berhenti 30 min, start 05:30), dan daftar 6 checkpoint dengan cut-off. Eksplorasi bebas: profil elevasi boleh jadi hero, split-screen, atau bento.

## 4. Race — setup & live

> Dua keadaan layar "Race". **Setup**: nama balapan, profil rute, start time 05:30 WIB dengan stepper, cut-off finis 13:00, slider target IF dengan zona deskripsi (Recovery → Sweetspot) dan watt target, pemilihan sepeda (Domane SL6 aktif, Grizl cadangan), cargo & waktu berhenti, checkpoint dengan cut-off per titik, kartu monolith "Your plan" (total 6h 41m, buffer +5h 19m, ETA, watt NP). **Live**: kartu monolith buffer vs cut-off (+47 MIN, progress merah), proyeksi finis 17:43, rata-rata yang dibutuhkan 24.1 km/h vs aktual 26.3, status AMAN/WASPADA/KRITIS, tombol log checkpoint. Rencanakan keduanya sebagai satu identitas yang utuh.

## 5. Gear — Bikes & components

> Layar "Gear": kartu monolith sepeda utama Domane SL6 (Road · 9.4 kg, odometer 8,412 km) di dekat atas, ringkasan ringkas (2 sepeda · 11,602 km total · 2 komponen due), lalu daftar komponen dengan wear bar merah/hijau: GP5000 Tires 144% KRITIS, Chain 100% KRITIS, Brake Pads 81% AMAN, Cassette 50% AMAN — masing-masing dengan aksi service (⟳), edit, hapus; kartu putih sepeda kedua Grizl (Standby) dengan tombol "set as active". Ada bottom-sheet form tambah/edit komponen. Eksplorasi: seberapa jelas wear bisa dibaca sekilas, dan bagaimana aksi tidak mengganggu ritme daftar.

## 6. Coach

> Layar "Coach" (AI, bring-your-own-key): kartu BYO key dengan pemilih provider (Gemini/OpenAI/OpenRouter/Anthropic), review mingguan (Time 8h 32m, Stress 512 TSS, Polarity 82% Z1-Z2, Form TSB +8 AMAN) dengan insight berbasis metrik, aksi cepat (Ask coach, Build next week), contoh percakapan dengan jawaban yang merujuk angka (IF 0.68, 300 TSS), dan rencana minggu depan per hari dengan centang sesi selesai. Nada: pelatih yang kredibel — setiap saran mengutip metrik, bukan gema kosong.

---

## Catatan poles (untuk saya, bukan untuk Stitch)

- Ambil **komposisi & hierarki** dari hasil Stitch; warna/tokokenya dipetakan kembali ke `src/app.css` (jangan biarkan Stitch memaksa palet lain).
- Satu monolith per layar tetap berlaku saat implementasi meski Stitch memakai lebih banyak blok gelap.
- Kontras AA yang sudah diaudit tidak boleh diregres: teks kecil ≥4.5:1 di latar terang, putih di atas merah hanya pada fill `#D50F26`.
- Radius: kartu 24 / tile-baris-input 16 / kontrol kompak 12 / badge 8 / pill penuh.
