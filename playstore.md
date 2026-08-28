# Play Store Readiness — SmartClean

> Checklist aksi untuk naik ke Google Play. Untuk detail fitur Free vs Pro dan
> strategi harga, lihat `DEVELOP.md`. Dokumen ini fokus ke **apa yang masih
> perlu dikerjakan** sebelum submit, diurutkan dari yang paling blocking.

Status per migrasi targetSdk 36 (Android 16): `compileSdk`/`targetSdk` = 36,
AGP 8.13.2, Gradle 8.13, Billing Library 8.0.0, product ID `smartclean_pro` @
**Rp 49.999** (one-time purchase).

---

## ✅ Sudah selesai

- Semua fitur core (Clean, Defrag, Boost, WA Cleaner, Duplicate Finder, dst)
- Google Play Billing SDK terpasang & tervalidasi compile (`BillingManagerPlugin.java`)
- Free vs Pro gating sesuai tabel di `DEVELOP.md` Phase 2
- Privacy Policy gate di app (tampil first-launch, wajib accept)
- Launcher icon final
- targetSdk 36 migration + fix edge-to-edge (bottom nav sempat ketutup navbar Android, sudah diperbaiki via inset padding di `MainActivity.java`)
- Keep-screen-on saat scan/clean berjalan

---

## 🔴 1. Release Signing Config (BLOCKER)

Saat ini `android/app/build.gradle` cuma punya `signingConfigs.debug`. Build
**release** (yang di-upload ke Play Console) belum bisa di-generate sama
sekali tanpa ini.

**Yang perlu disiapkan:**
1. Generate upload keystore (**simpan baik-baik, jangan hilang** — kalau
   hilang dan belum pakai Play App Signing, app gak bisa di-update lagi):
   ```
   keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 \
     -validity 10000 -alias smartclean-upload
   ```
2. **Jangan commit file `.jks`/`.keystore` ke git.** Simpan path & password di
   `android/keystore.properties` (buat file baru, sudah harus masuk
   `.gitignore`), lalu baca dari situ di `build.gradle`:
   ```properties
   # android/keystore.properties (JANGAN commit)
   storeFile=/path/absolute/ke/upload-keystore.jks
   storePassword=...
   keyAlias=smartclean-upload
   keyPassword=...
   ```
3. Tambahkan `signingConfigs.release` di `build.gradle` yang baca dari
   `keystore.properties`, lalu `buildTypes.release { signingConfig
   signingConfigs.release }`.
4. **Rekomendasi:** aktifkan **Play App Signing** saat submit pertama kali —
   Google yang simpan signing key final, kamu cuma pegang upload key. Kalau
   upload key hilang/bocor, masih bisa di-reset lewat Play Console tanpa
   kehilangan app.

---

## 🔴 2. Hosting Privacy Policy (BLOCKER)

Play Console **wajib** URL publik (App Content → Privacy Policy) — teks
in-app di `privacy_policy.txt` gak dihitung.

**Rencana: GitHub Pages** (kamu yang siapkan). Langkah singkat:
1. Enable GitHub Pages di repo ini (Settings → Pages → source: branch
   `master`/`gh-pages`, folder `/docs` atau `/root`).
2. Convert `privacy_policy.txt` jadi halaman HTML sederhana (bisa saya
   bantu buatkan `docs/privacy-policy.html` kalau sudah fix mau taruh di
   folder mana).
3. Setelah live, catat URL final-nya (misal
   `https://susantosap-oss.github.io/smartclean2026/privacy-policy.html`).
4. Paste URL itu ke Play Console → App content → Privacy Policy.
5. Opsional: update tombol/link di layar Privacy Policy dalam app supaya
   mengarah ke URL yang sama (biar konsisten in-app vs web).

**Kabari saya kalau GitHub Pages-nya sudah aktif** — saya bikinkan halaman
HTML-nya dan pastikan formatnya sesuai isi `privacy_policy.txt` yang sekarang.

---

## 🟡 3. Play Console Setup

- [ ] Akun Google Play Developer (one-time **$25**) — kalau belum ada, ini
      prasyarat paling awal, gak bisa submit apapun tanpa ini.
- [ ] Buat entry app baru di Play Console, isi `com.smartclean.app`
- [ ] Buat in-app product **`smartclean_pro`** (one-time, bukan subscription)
      di Monetize → Products, harga **Rp 49.999**
- [ ] Content rating questionnaire (diisi langsung di Play Console)
- [ ] Data Safety form — declare data yang dikumpulkan. Karena app ini local-only
      + Play Billing, kemungkinan besar cuma perlu declare "Purchase history"
      (di-handle otomatis oleh Google Play Billing)
- [ ] Deklarasi permission sensitif (App content → Sensitive app permissions):
  - `MANAGE_EXTERNAL_STORAGE` — perlu video demo device asli (lihat catatan
    lengkap di `DEVELOP.md` Phase 1)
  - `PACKAGE_USAGE_STATS`
  - `REQUEST_DELETE_PACKAGES`

---

## 🟡 4. Release Build Hardening

- [ ] `minifyEnabled true` untuk `release` di `build.gradle` + test APK
      hasil minify beneran jalan (semua fitur, khususnya native plugin calls
      lewat Capacitor bridge — reflection-based, rawan ke-strip kalau
      ProGuard rules kurang lengkap)
- [ ] Verifikasi `proguard-rules.pro` — sudah ada `-keep` untuk
      `com.getcapacitor.**` dan `com.smartclean.app.**`, cek lagi setelah
      nambah Billing Library apakah perlu `-keep` tambahan untuk
      `com.android.billingclient.**`
- [ ] Hapus/bungkus 34 pemanggilan `Log.d`/`Log.e` di native plugin
      (`grep -rn "Log\.[de]" android/app/src/main/java/`) — jangan bocorin
      info debug di production

---

## 🟢 5. Aset Store Listing

Belum ada satupun di repo ini:
- [ ] Icon hi-res **512×512 PNG** (beda dari launcher icon — ini khusus buat
      listing Play Store, bisa saya generate dari `assets/smartcleanv1.jpeg`
      begitu diminta)
- [ ] Feature graphic **1024×500 PNG**
- [ ] Screenshot minimal 2 (rekomendasi 4-8), resolusi tinggi, portrait
- [ ] Short description (≤80 karakter)
- [ ] Full description (≤4000 karakter) — sudah ada draft keyword target di
      `DEVELOP.md` Phase 4

---

## 🟢 6. Device & Compatibility Testing

- [x] OPPO CPH2603 (ColorOS) — sudah ditest sepanjang sesi ini, termasuk fix
      edge-to-edge
- [ ] Minimal 1 device Samsung, 1 device Xiaomi (beda vendor skin, biar
      yakin gak ada quirk khusus vendor)
- [ ] Test di rentang Android version yang lebih luas mengingat targetSdk
      sekarang 36 — minimal versi lama yang masih didukung (`minSdk 24`) dan
      versi baru

---

## Urutan Rekomendasi

```
1. Siapkan akun Play Console (prasyarat semuanya)
2. Release signing config (upload keystore + Play App Signing)
3. Hosting Privacy Policy → GitHub Pages
4. Buat in-app product smartclean_pro di Play Console
5. Isi Data Safety + Content Rating + deklarasi permission sensitif
6. minifyEnabled true + bersihkan Log.d/Log.e + retest
7. Aset store listing (icon 512, feature graphic, screenshot, deskripsi)
8. Testing di device tambahan
9. Submit ke Internal Testing track dulu → verifikasi Billing sandbox jalan
   → baru promote ke Production
```
