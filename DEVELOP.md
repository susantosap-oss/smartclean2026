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
| **Browser Cache Clean** | Hapus, bukan hanya scan |
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
1. **Early Bird Pricing** — 3 bulan pertama Pro di Rp 19.000 (lalu naik ke Rp 39.000)
2. Target review minimum **50 review bintang 4–5** sebelum scale marketing
3. Minta review di dalam app setelah user berhasil clean pertama kali (sweet spot)
4. Share di komunitas: grup Facebook "Tips Android Indonesia", forum Kaskus, Reddit r/indonesia

---

## Phase 5 — Pricing

| Tier | Harga | Keterangan |
|---|---|---|
| **Free** | Rp 0 | Fitur terbatas + AdMob banner |
| **Pro — Early Bird** | Rp 19.000 | 3–6 bulan pertama setelah launch |
| **Pro — Regular** | Rp 39.000 | One-time, selamanya |

**Mengapa Rp 39.000:**
- Di bawah psychological barrier Rp 50.000
- 4x lebih murah dari CCleaner lifetime (Rp ~180.000)
- One-time = nilai jual besar di era subscription fatigue
- Setara 1 cup kopi — mudah dirasionalisasi user

---

## Catatan Prioritas Pengerjaan

```
[Sekarang]     → Testing & bug fixing semua fitur yang ada
[Setelah stabil] → Implementasi Google Play Billing (in-app purchase)
[Setelah billing] → Implementasi AdMob banner (free user saja)
[Terakhir]     → Persiapan aset Play Store & submit
```
