# SmartClean — Development Roadmap (Pre & Post Play Store)

> Dokumen ini dibuat sebagai referensi pengembangan lanjutan setelah app berjalan stabil dan siap naik ke Play Store.
> Status saat ini: **Testing Phase** — semua fitur core sudah berjalan, sedang validasi di device.

---

## Phase 1 — Play Store Readiness Checklist

Selesaikan ini sebelum submit ke Play Store:

### Technical
- [ ] Ganti package name jika diperlukan (saat ini `com.smartclean.app`)
- [ ] Buat keystore production & simpan dengan aman (jangan pakai debug keystore)
- [ ] Set `minifyEnabled true` + ProGuard rules untuk release build
- [ ] Hapus semua `Log.e` / `Log.d` debug dari plugin Java sebelum release
- [ ] Test di minimal 3 device berbeda (brand berbeda: OPPO, Xiaomi, Samsung)
- [ ] Test di Android 10, 12, 14 (versi minimum, tengah, terbaru)
- [ ] Handle gracefully jika PACKAGE_USAGE_STATS tidak di-grant (jangan crash)
- [ ] Handle gracefully jika MANAGE_EXTERNAL_STORAGE tidak di-grant
- [ ] Pastikan tidak ada ANR > 5 detik di operasi apapun (semua heavy ops sudah di Thread terpisah ✅)

### Assets Play Store
- [ ] Icon app 512x512 PNG (high res)
- [ ] Feature graphic 1024x500 PNG
- [ ] Screenshot phone minimum 2–8 (portrait, resolusi tinggi)
- [ ] Short description (80 karakter)
- [ ] Full description (4000 karakter) — sertakan keyword: pembersih hp, hapus junk, WhatsApp cleaner, dll.
- [ ] Privacy Policy URL (wajib karena app mengakses storage & notifications)
- [ ] Tentukan target age group & content rating

### Play Store Policy Compliance
- [ ] `MANAGE_EXTERNAL_STORAGE` — wajib isi form deklarasi di Play Console (App content → Sensitive app permissions):
  - Core use case: app ini butuh akses filesystem lintas-app untuk scan Temp/Junk/orphan
    app data & cache semua app — kategori terdekat di form Google adalah **"File
    manager"**, karena tidak ada kategori resmi "cleaner/optimizer".
  - Siapkan **video demo** (device nyata, bukan emulator/mockup) yang menunjukkan Scan
    Junk → Clean Now benar-benar menghapus file di storage, untuk dilampirkan ke form.
  - Jelaskan di form kenapa Storage Access Framework / MediaStore **tidak cukup**: fitur
    ini butuh menghapus cache app lain di `Android/data/<pkg>/cache` yang tidak
    ter-index MediaStore dan tidak bisa diakses lewat SAF picker per-file.
  - Review bisa 1–3 minggu dan **bisa ditolak** — siapkan rencana cadangan (lihat opsi
    "kurangi scope" jika ditolak: batasi ke cache app sendiri + WA media via SAF +
    Recently Deleted via MediaStore, semua tanpa perlu izin ini).
- [ ] Review kebijakan `PACKAGE_USAGE_STATS` — wajib isi form deklarasi
- [ ] Review kebijakan `REQUEST_DELETE_PACKAGES` — wajib isi form deklarasi
- [ ] Pastikan tidak ada klaim "speed boost" atau "RAM cleaner" yang misleading di deskripsi
- [ ] Privacy Policy harus mention data apa yang dikumpulkan (untuk AdMob: device info & ad interaction)

---

## Phase 2 — Freemium & In-App Purchase

### Pembagian Fitur Free vs Pro

#### GRATIS (semua user)
| Fitur | Batasan Free |
|---|---|
| Scan semua kategori junk | Bisa scan, tapi clean dibatasi 1x per hari |
| Storage & RAM stats | Full |
| Battery info | Full |
| Defrag & Boost Memory | 1x per hari |
| WhatsApp Cleaner | Video & Foto saja, filter minimal 3 bulan |
| Duplicate Finder | Foto saja, tampilkan maks. 5 grup |
| Recently Deleted — **scan** | Full (tampilkan ukuran) |
| System Cleaner shortcut | Full |
| Before/After Result Panel | Tidak tersedia |

#### PRO (setelah purchase)
| Fitur | Keterangan |
|---|---|
| **One-tap Clean** semua kategori | Tanpa batas harian |
| **WhatsApp Cleaner full** | Semua tipe, semua rentang waktu, WA Business |
| **Recently Deleted — Clean** | Hapus permanen, fitur killer vs kompetitor |
| **Duplicate Finder full** | Semua tipe file, semua hasil, auto-select |
| **Camera/Gallery Cleaner** | Full akses |
| **Unused App Cleaner** | Full akses |
| ~~Browser Cache Clean~~ | **Dihapus dari tabel ini** — Android scoped storage (11+) memblokir total akses `Android/data/<pkg lain>/cache`, jadi fitur ini tidak pernah benar-benar bisa menghapus apa pun. Sudah di-delock dari Pro & diganti tombol "Buka Cleaner Bawaan Sistem" di menu Advance (gratis untuk semua user, karena tidak ada kapabilitas Pro nyata yang ditahan). App Cache & Game Cache dihapus total dengan alasan sama — lihat komentar di `FileCleanerPlugin.java`. |
| **Before/After Result Panel** | Visualisasi dampak cleaning |
| **Private DNS / Remove Ads** shortcut | Full akses |
| Defrag & Boost | Tanpa batas harian |
| **Bebas iklan (AdMob banner dihide)** | Otomatis setelah purchase |

### Implementasi Google Play Billing
- Library: `com.android.billingclient:billing:7.x`
- Tipe produk: **One-time purchase** (`inapp`, bukan `subs`)
- Product ID: `smartclean_pro` (daftarkan di Play Console → Monetize → Products)
- Flow:
  1. App launch → cek purchase via `BillingClient.queryPurchasesAsync()`
  2. Jika ada purchase aktif → set `isPro = true` → unlock semua fitur, hide ads
  3. Jika belum → tampilkan prompt upgrade saat user tap fitur Pro
  4. Acknowledge purchase wajib dalam 3 hari atau Google otomatis refund

```java
// Pseudocode flow cek Pro status
BillingClient billing = BillingClient.newBuilder(context)...build();
billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
    .setProductType(BillingClient.ProductType.INAPP).build(),
    (result, purchases) -> {
        boolean isPro = purchases.stream()
            .anyMatch(p -> p.getProducts().contains("smartclean_pro")
                       && p.getPurchaseState() == Purchase.PurchaseState.PURCHASED);
        // simpan isPro ke SharedPreferences / singleton
    });
```

---

## Phase 3 — Monetisasi: Banner Ads (AdMob)

### Apakah Perlu Banner Ads?

**Ya, dengan syarat:**
- Hanya tampil untuk user **free**
- Posisi: fixed di paling bawah layar, **di bawah bottom navbar** (bukan di atas, tidak mengganggu UI)
- Size: **Adaptive Banner** (bukan fixed 320x50) — lebih rapi di berbagai ukuran layar
- Hilang otomatis setelah user upgrade ke Pro

Banner kecil di bawah navbar adalah standar industri yang user sudah terima dengan wajar — tidak agresif seperti interstitial/fullscreen ads yang merusak UX.

### Siapa yang Pasang Iklan?

**Jawabannya: Google AdMob** — developer tidak perlu cari advertiser sendiri.

Cara kerjanya:
1. Developer daftar di [admob.google.com](https://admob.google.com) (gratis)
2. Daftarkan app SmartClean → dapat **App ID**
3. Buat Ad Unit → dapat **Ad Unit ID**
4. Google secara otomatis mengirim iklan yang relevan ke app (dari Google Ads network)
5. Revenue masuk ke akun AdMob developer setiap bulan (via transfer bank)

Developer tidak perlu hubungi pengiklan. Google yang handle seluruh supply iklan.

### Estimasi Revenue AdMob (Indonesia)
- eCPM Indonesia: **$0.20 – $0.80** per 1000 impresi
- Jika DAU 10.000 free user, tiap user buka app 3x/hari = 30.000 impresi/hari
- Estimasi: 30.000 × $0.50 / 1000 = **$15/hari → ~$450/bulan**
- Naik signifikan seiring growth DAU

### Implementasi AdMob di Capacitor

Plugin yang digunakan: **`@capacitor-community/admob`**

```bash
npm install @capacitor-community/admob
npx cap sync android
```

**`AndroidManifest.xml`** — tambahkan App ID:
```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"/>
```

**`app.js`** — inisialisasi & tampilkan banner:
```javascript
import { AdMob, BannerAdSize, BannerAdPosition } from '@capacitor-community/admob';

async function initAds(isPro) {
  if (isPro) return; // Pro user: tidak ada iklan

  await AdMob.initialize({ testingDevices: ['DEVICE_ID_FOR_TEST'] });

  await AdMob.showBanner({
    adId: 'ca-app-pub-XXXXXXXX/XXXXXXXXXX', // Ad Unit ID dari AdMob console
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 56, // tinggi bottom navbar agar banner muncul di bawahnya
  });
}
```

**Flow lengkap:**
```
App launch
  └─ cek isPro (Google Play Billing)
       ├─ isPro = true  → initAds() tidak dipanggil, banner tidak muncul
       └─ isPro = false → initAds() → AdMob.showBanner() di bawah navbar
```

### Yang Perlu Diperhatikan
- Wajib daftarkan app di AdMob **sebelum** submit ke Play Store (App ID harus sudah ada di manifest)
- Gunakan **test Ad Unit ID** selama development (`ca-app-pub-3940256099942544/6300978111`) — jangan klik iklan real selama testing atau akun AdMob bisa di-suspend
- Privacy Policy harus mention penggunaan AdMob dan data yang dikumpulkan (device info, ad interaction)
- GDPR/consent form tidak wajib untuk pasar Indonesia, tapi wajib jika target pasar Eropa

---

## Phase 4 — Strategi Play Store (ASO)

### Positioning
**Tagline:** *"Pembersih HP yang Jujur — Angka Nyata, Bukan Rekayasa"*

Diferensiasi utama vs CleanMaster/CCleaner:
- Tidak ada angka cache yang dilebih-lebihkan (pakai `StorageStatsManager` — API resmi Android)
- Tidak ada iklan fullscreen / interstitial yang mengganggu
- WhatsApp Cleaner yang proper (support WA Business, scoped storage Android 11+)
- Recently Deleted — fitur yang tidak ada di kompetitor utama
- Dibuat oleh developer Indonesia, mengerti kebutuhan user lokal

### Target Keyword
Keywords utama yang kompetitornya lemah:
- `hapus foto duplikat android`
- `whatsapp cleaner indonesia`
- `bersihkan recently deleted`
- `pembersih hp tanpa iklan`
- `hapus cache semua aplikasi`

### Launch Strategy
1. Harga Pro: **Rp 49.999** one-time purchase (lihat Phase 5)
2. Target review minimum **50 review bintang 4–5** sebelum scale marketing
3. Minta review di dalam app setelah user berhasil clean pertama kali (sweet spot)
4. Share di komunitas: grup Facebook "Tips Android Indonesia", forum Kaskus, Reddit r/indonesia

---

## Phase 5 — Pricing

| Tier | Harga | Keterangan |
|---|---|---|
| **Free** | Rp 0 | Fitur terbatas + AdMob banner |
| **Pro** | Rp 49.999 | One-time purchase, selamanya — product ID `smartclean_pro` |

**Mengapa Rp 49.999:**
- Masih di bawah psychological barrier Rp 50.000
- 3-4x lebih murah dari CCleaner lifetime (Rp ~180.000)
- One-time = nilai jual besar di era subscription fatigue
- Setara 1 cup kopi — mudah dirasionalisasi user

---

## Phase 6 — Fitur Tambahan (Backlog)

Prinsip pemilihan fitur baru setelah insiden App/Browser/Game Cache: **hanya fitur yang
beroperasi di shared/user storage** (DCIM, Download, Movies, Pictures, Documents, atau
folder publik milik app lain seperti Telegram) yang boleh diklaim "bisa dibersihkan" —
apa pun di `Android/data/<pkg lain>/...` tidak bisa diakses SmartClean sama sekali,
berapa pun izin yang di-grant (lihat komentar di `FileCleanerPlugin.java`).

Kandidat, urutan prioritas:

1. **Big Files Finder** (★ rekomendasi utama) — scan file besar (>100MB) di
   DCIM/Download/Movies/Documents, sort by size, user pilih mana yang mau dihapus.
   Dampak besar (1 video 500MB > ratusan file cache kecil), teknis paling simpel (tidak
   perlu whitelist ekstensi), fully accessible tanpa hambatan scoped storage. Tidak
   overlap dengan fitur yang sudah ada.
2. **APK Installer Cleaner** — file `.apk` nyasar di folder Download setelah
   install/sideload manual. Selalu jadi junk begitu instalasi selesai, aman dihapus.
3. **Empty Folder Cleanup** — folder kosong sisa app yang sudah di-uninstall atau file
   yang sudah dipindah/dihapus manual. Size kecil tapi murah diimplementasi — bisa pakai
   ulang `getFolderSize()`/`deleteRecursiveDir()` yang sudah ada.
4. **Download Folder — file lama tak tersentuh** (mis. >90 hari, belum masuk kategori
   lain) — mirip pola WhatsApp Cleaner tapi generik untuk semua file di Download, dengan
   pilihan rentang waktu.
5. **Extend WA Cleaner ke app chat lain** (Telegram, dll) — Telegram sengaja simpan
   media di folder publik (`Telegram/Telegram Images`, `Telegram Video`, dst) supaya
   file manager bisa akses, pola persis WhatsApp — tinggal tambah entry mirip `WA_APPS`.
6. **Screen Recording Cleanup** — video rekaman layar biasanya besar & jarang ditonton
   ulang, menumpuk di `Movies`/`DCIM`.

---

## Phase 7 — Growth: Program Referral via WhatsApp Share

Mekanisme yang diminta: user share link Play Store app ke nomor WA → terkirim → WA
mengirim signal `RESULT_OK` ke SmartClean → counter +1 → di 10x sukses, user dapat
pilihan buka 1 fitur Pro selama 60 hari. Guard: cooldown timer + limit harian + tidak
boleh kirim ke nomor yang sama berulang.

### ⚠️ Catatan teknis penting — cek dulu sebelum implementasi
`startActivityForResult` ke WhatsApp **tidak reliably mengembalikan `RESULT_OK` saat
pesan benar-benar terkirim**. WhatsApp tidak memanggil `setResult(RESULT_OK)` sebelum
activity share/chat-nya `finish()` — default Android kalau activity finish tanpa
`setResult()` eksplisit adalah `RESULT_CANCELED`, bukan `RESULT_OK`. Ini kendala umum
yang bikin banyak app dengan pola "referral via share" serupa gagal total di produksi.
Ini harus dicek/dites ulang di awal sesi berikutnya sebelum bangun fitur di atasnya —
jangan asumsikan `RESULT_OK` = pesan terkirim.

Opsi realistis (pilih salah satu saat implementasi):
- **(a) Heuristik "kembali dari WhatsApp"** — anggap "share dihitung" kalau user
  kembali ke SmartClean dari WhatsApp setelah minimal beberapa detik (bukan langsung
  back instan) — best-effort, bukan bukti pesan terkirim, tapi cukup jujur untuk
  dijelaskan ke user sebagai "berbagi", bukan "terkirim ke X orang".
- **(b) Play Install Referrer API** — cara standar industri untuk referral yang bisa
  dibuktikan: tiap user dapat link unik, install baru dari link itu terbaca oleh
  `com.android.installreferrer` di sisi user baru, lalu dikreditkan ke referrer. Lebih
  akurat tapi butuh infrastruktur (server/Firebase) untuk mencocokkan siapa mereferensi
  siapa — bukan solusi tanpa backend.
- **(c) Trust-based sederhana** — hitung "percobaan share" (intent WA berhasil dibuka),
  bukan "bukti terkirim/diinstall". Paling simpel, selaras dengan guard cooldown+limit
  yang sudah diminta (guard itu baru berguna kalau memang basisnya trust-based, karena
  opsi (b) sudah punya proteksi anti-abuse dari sisi install-nya sendiri).

Guard anti-abuse (berlaku untuk opsi manapun yang dipilih):
- Cooldown timer antar-share (mis. 30–60 detik) supaya tidak spam tap berulang.
- Limit harian jumlah share yang dihitung (mis. maks 3–5/hari) supaya 10x tidak
  dicapai dalam sehari dengan spam ke banyak nomor sekaligus.
- Simpan nomor yang sudah pernah dikirimi (hash, bukan plaintext) supaya submit ke
  nomor yang sama tidak dihitung dua kali.

---

## Phase 8 — Anti-Tamper / App Guard (R8 + Verifikasi Purchase)

**Fase terakhir sebelum submit ke Play Store**, sesuai arahan: pastikan APK/AAB tidak
bisa dimodifikasi jadi `.apk.mod` yang membuka fitur Paid tanpa bayar.

### ⚠️ Temuan penting: R8 saja TIDAK menutup celah utama
R8/ProGuard (sudah jadi checklist item di Phase 1) hanya memproses bytecode Java/Kotlin
— **tidak menyentuh bundle web** (`src/js/app.js`, `src/index.html`, `src/css/style.css`)
yang di-ship Capacitor sebagai file **plaintext, tidak diminify, tidak diobfuscate** di
dalam APK (`android/app/src/main/assets/public/`). Saat ini seluruh logic pengecekan
Pro (`isPro`, `checkDailyLimit()`, `requirePro()`, cache key `sc_is_pro` di
`localStorage`) hidup di JS itu. Artinya siapa pun bisa: unzip APK → edit `app.js` di
text editor (mis. paksa `isPro = true` atau `function checkDailyLimit(){return true}`)
→ re-zip → re-sign pakai key sendiri → jadi APK modded yang buka semua fitur Pro. R8
sama sekali tidak melindungi jalur ini karena R8 tidak pernah menyentuh file JS.

Prioritas perbaikan (urutan dampak, bukan urutan Phase 1's checklist):
1. **Verifikasi purchase signature** — `BillingClient` mengembalikan `purchaseToken` +
   `signature` + `originalJson` per purchase, tapi tidak otomatis memvalidasinya.
   Implementasikan `Security.verifyPurchase()` (RSA-SHA1 terhadap public key Base64 dari
   Play Console → App integrity/Monetization setup) di sisi **native Java**
   (`BillingManagerPlugin.java`), bukan di JS — supaya hasil `isPro` yang dikirim ke JS
   sudah tervalidasi, dan JS tidak pernah jadi satu-satunya sumber kebenaran.
2. **Pindahkan gating logic sensitif ke native** — minimal, native plugin yang
   validasi purchase harus jadi satu-satunya pintu untuk unlock fitur yang benar-benar
   berat (mis. Clean Now tanpa limit) — jangan biarkan JS bisa "memutuskan sendiri" isPro
   tanpa tanya native setiap kali.
3. **Runtime signature check** — di `MainActivity` atau plugin, baca signing
   certificate sendiri (`PackageManager.GET_SIGNING_CERTIFICATES` di API 28+) dan
   bandingkan hash-nya ke hash yang di-hardcode saat build. APK yang di-mod otomatis
   re-signed pakai key lain (attacker tidak punya private key asli) → hash tidak cocok →
   app bisa menolak jalan / diam-diam tetap Free-tier.
4. **Play Integrity API** (pengganti SafetyNet, direkomendasikan Google) — deteksi resmi
   "APK sudah dimodifikasi" / "bukan device asli" / "bukan instalasi dari Play Store".
   Ini pendekatan paling modern & didukung Google, layak jadi lapisan utama, bukan cuma
   pelengkap.
5. **R8 + ProGuard rules** (sudah ada di checklist Phase 1) — tetap perlu, mempersulit
   reverse-engineering native code (termasuk hasil implementasi poin 1–3 di atas), tapi
   posisinya sebagai lapisan tambahan, bukan proteksi utama.

---

## Catatan Prioritas Pengerjaan

```
[Sekarang]        → Testing & bug fixing semua fitur yang ada
[Setelah stabil]  → Implementasi Google Play Billing (in-app purchase)
[Setelah billing] → Implementasi AdMob banner (free user saja)
[Growth]          → Fitur tambahan (Phase 6) & Program Referral (Phase 7)
[Terakhir]        → Anti-Tamper / App Guard (Phase 8) → baru Persiapan aset Play Store & submit
```
