# SmartClean — Development Roadmap (Pre & Post Play Store)

> Dokumen ini dibuat sebagai referensi pengembangan lanjutan setelah app berjalan stabil dan siap naik ke Play Store.
> Status saat ini: **Testing Phase** — semua fitur core sudah berjalan, sedang validasi di device.

---

## Changelog — Privacy Policy Gate Ported dari `master` (2026-09-05)

Branch `unlocked-test` dibuat SEBELUM `master` menambahkan first-launch Privacy Policy gate
(commit billing `2793c14`), jadi fitur ini tidak pernah ada di branch ini sampai sekarang —
bukan regresi dari perubahan sesi ini, cuma belum pernah di-merge.

### Yang diported
- `showPrivacyGate()` (`src/js/app.js`): layar full-screen wajib disetujui sebelum `startApp()`
  jalan, persis pola master — checkbox harus dicentang dulu sebelum tombol "Setuju & Lanjutkan"
  aktif, tombol "Tolak & Keluar" memanggil `AppPlugin.exitApp()`.
- `PRIVACY_KEY = 'sc_privacy_accepted_v1'` di localStorage — sekali disetujui, tidak muncul lagi
  sampai user clear app data / uninstall-reinstall.
- CSS `.privacy-*` (`src/css/style.css`) & markup `#privacyScreen` (`src/index.html`) — di-port
  1:1 dari master.

### Yang DIUBAH dari versi master (bukan copy-paste polos)
- **Isi kebijakan sekarang bilingual** — `src/privacy_policy_id.txt` +
  `src/privacy_policy_en.txt`, dipilih otomatis sesuai `currentLang` saat ini di
  `loadPrivacyPolicyText()`. Semua label statis di layar (judul, checkbox, tombol) pakai
  `data-i18n` seperti bagian app lainnya.
- **Poin 2 (Izin Akses Perangkat) dikoreksi**: teks asli dari master mengklaim app minta izin
  **Kamera** "untuk mengambil foto dan video properti/even/lokasi" — SmartClean tidak pernah
  request permission `CAMERA` sama sekali (cek `AndroidManifest.xml`), ini sepertinya teks
  boilerplate nyasar dari project lain. Diganti dengan daftar izin yang benar-benar dipakai app
  ini (Storage/All Files Access, Notification Access, Usage Access, local storage) — mengklaim
  izin yang tidak diminta di Privacy Policy adalah risiko penolakan review Play Store, bukan
  cuma masalah kerapian teks.
- Tanggal berlaku diperbarui ke tanggal port ini (5 September 2026) karena isinya berubah.

### Boot sequence
`init()` (deteksi flavor Pro, storage stats, integrity check) sekarang dibungkus dalam
`startApp()` — dipanggil langsung kalau `PRIVACY_KEY` sudah `'1'`, atau lewat
`showPrivacyGate()` dulu kalau belum. `applyStaticI18n()` dipanggil sekali lagi secara
**immediate** (bukan cuma di dalam `init()`) supaya splash screen DAN layar privacy policy
sama-sama tampil dengan bahasa yang benar sejak frame pertama, bukan nunggu `init()` jalan
2.5 detik kemudian.

---

## Changelog — Advanced Cleaner Tools & Dashboard Reorg (2026-09-05)

Branch `unlocked-test`. Enam fitur baru ditambahkan ke `FileCleanerPlugin.java` (native scan,
delete lewat `FileCleaner.deleteFiles` generik yang sudah ada) + wiring di `src/js/app.js` dan
`src/index.html`. Detail pembagian Free/Pro tiap fitur ada di tabel Phase 2 di bawah.

### Fitur baru
| Fitur | Native method | Catatan |
|---|---|---|
| **Big File Cleaner** | `scanBigFiles` | File > 100MB, seluruh storage (skip `Android/`) |
| **APK Installer Cleaner** | `scanApkFiles` | Cari semua `.apk` di storage |
| **Empty Folder Cleanup** | `scanEmptyFolders` | Deteksi bottom-up — folder berisi cuma folder kosong lain ikut kehitung |
| **Download Folder Cleanup** | `scanDownloadOld` | Filter tetap (bukan dropdown): file > 90 hari di folder Download |
| **Screen Recording Cleanup** | `scanScreenRecordings` | Match nama file (`screenrecord`/`screen_recording`/dll) di folder Movies/DCIM |
| **Telegram Cleaner** | `scanTelegramMedia` | Scope: media (Images/Video/Documents/Audio) + cache di shared storage saja — lihat catatan di bawah |

**Kenapa Telegram Cleaner tidak literal "message database":** berbeda dari WhatsApp,
database chat Telegram tersimpan di `Android/data/org.telegram.messenger/...` (private app
storage) yang diblokir scoped storage untuk app pihak ketiga — sama seperti masalah yang
sudah membuat "App/Browser/Game Cache" dihapus dari fitur Scan Junk. Yang bisa diakses cuma
folder media shared-storage Telegram sendiri (termasuk media grup chat), jadi fiturnya di-scope
ke situ saja, bukan janji "hapus database pesan" yang secara teknis tidak bisa dipenuhi.

### Reorganisasi Dashboard Advanced
- Grup baru **Social Media Cleaner**: WhatsApp Cleaner + Telegram Cleaner
- Grup baru **Deep Cleaner**: Download Folder Cleanup (>90 hari) + Recently Deleted + Duplicate
  Finder + Big File Cleaner — Recently Deleted dipindah dari tab Defrag ke sini (accordion card,
  bukan lagi kartu statis)
- **Browser Cleaner card dihapus** — 100% tumpang tindih dengan "Bersihkan Cache Semua App"
  (keduanya cuma deep-link ke cleaner bawaan OS)

### Bug fix — Recently Deleted terdeteksi 0
`scanRecentlyDeleted`/`cleanRecentlyDeleted` sebelumnya cuma query MediaStore `IS_TRASHED`,
yang cuma menangkap trash resmi Android 11+ (mis. dari Google Photos). OEM recycle bin (Samsung
My Files, MIUI Gallery/Security, dll.) sering pakai folder tersembunyi sendiri di shared storage
(`.Trash`, `.trashed`, dll.) yang tidak pernah register ke MediaStore — inilah kemungkinan
penyebab app cleaner OS lain melihat 200MB sementara SmartClean melihat 0. Ditambahkan scan
tambahan atas folder-folder kandidat tersebut (`HIDDEN_TRASH_NAMES` di `FileCleanerPlugin.java`),
digabung ke angka MediaStore. **Perlu divalidasi di device nyata** — kalau masih 0, cek nama
folder recycle bin OEM device tsb (lewat file manager, tampilkan hidden files) dan tambahkan ke
`HIDDEN_TRASH_NAMES`/`HIDDEN_TRASH_PARENTS`.

### Freemium scaffold (sementara, lihat Phase 2)
`isPro` masih flag lokal (`localStorage`), belum tersambung ke Google Play Billing asli di
branch ini — lihat catatan implementasi di tabel Phase 2 di bawah.

---

## Changelog — Full Free/Pro Gating & Dua Build Terpisah untuk Testing (2026-09-05)

Branch `unlocked-test`. Seluruh pembagian Free/Pro dari tabel Phase 2 (termasuk fitur yang
sudah ada dari awal — WA Cleaner, Duplicate Finder, Recently Deleted, Camera/Unused/Ads,
Before/After panel, daily limit Clean/Defrag/Boost) sekarang diterapkan di `src/js/app.js`
(sebelumnya cuma 6 fitur baru sesi ini yang di-gate). Detail per-fitur ada di tabel Phase 2.

### PENTING — SmartClean tetap SATU app, bukan APK Free + APK Pro
Free dan Pro **bukan** dua APK terpisah untuk didistribusikan — keduanya adalah state di
dalam SATU app "SmartClean" yang sama (`isPro` flag + `requirePro()`/`checkDailyLimit()` gate
di `src/js/app.js`), persis seperti yang akan jalan di Play Store nanti setelah Google Play
Billing tersambung.

Yang dibuat terpisah cuma untuk KEBUTUHAN TESTING INTERNAL: sebuah kedua Gradle product
flavor **`unlocked`** yang start dalam kondisi full-unlocked (tanpa perlu tap Upgrade
berkali-kali) supaya QA bisa cek UI/UX tiap layar Pro dengan cepat. Flavor ini **tidak pernah
didistribusikan ke publik**.

| | `prod` (dipakai untuk release) | `unlocked` (internal QA only) |
|---|---|---|
| Package | `com.smartclean.app` | `com.smartclean.app.unlocked` |
| Nama app | SmartClean | SmartClean (Unlocked Test) |
| Icon | Icon baru (`android/app/src/prod/res/mipmap-*`, di-cherry-pick dari `master`) | Icon default (`android/app/src/main/res/mipmap-*`, belum diganti) |
| Default `isPro` saat fresh install | `false` (Free tier normal) | `true` (semua fitur Pro terbuka) |
| Cara kerja default | `BuildConfig.IS_UNLOCKED_TEST_BUILD` (`android/app/build.gradle` productFlavors) dibaca lewat `AppManagerPlugin.getBuildFlavor()` di `resolveInitialIsPro()` (`src/js/app.js`) | sama |

Kedua build bisa diinstall SEKALIGUS di HP yang sama (applicationId beda) karena
`applicationIdSuffix ".unlocked"` di flavor `unlocked`. Toggle manual "Upgrade"/"kembali ke
Free" di dalam app tetap jalan di kedua build — default flavor cuma menentukan state AWAL
sebelum ada localStorage tersimpan.

**Build & install:**
```bash
npx cap sync android
cd android
./gradlew.bat assembleProdDebug assembleUnlockedDebug
adb install -r app/build/outputs/apk/prod/debug/app-prod-debug.apk
adb install -r app/build/outputs/apk/unlocked/debug/app-unlocked-debug.apk
```

### Penyesuaian setelah review manual di device
- **Remove Ads dipindah dari Pro ke Free** — ini cuma shortcut ke Private DNS settings OS,
  bukan fitur SmartClean yang di-maintain, jadi menguncinya di belakang Pro tidak menambah
  nilai jual Pro.
- **Big File Cleaner & Download Folder Cleanup**: bukan lagi "scan gratis, hapus Pro" —
  sekarang Free bisa hapus **1 file/hari** (pilih 1 dari hasil scan, `freeMaxSelect:1` bikin
  seleksi jadi single-select di UI saat Free), Pro hapus tanpa batas. Alasan lengkap ada di
  catatan psikologi limit di tabel Pro di atas.
- **Ad banner slot (layout placeholder only)** — `#adBannerSlot` (`src/index.html` +
  `.ad-banner-slot`/`--ad-h` di `src/css/style.css`) reserve posisi banner AdMob adaptif di
  bawah bottom nav (tidak menumpuk — nav dan setiap elemen `position:fixed` lain otomatis naik
  lewat variabel CSS `--ad-h`), muncul cuma utk Free (`body.is-pro` menyembunyikannya). **Belum
  ada SDK AdMob asli** — ini murni placeholder posisi, lihat Phase 3 untuk rencana wiring SDK
  sesungguhnya.
- **Toast "tekan sekali lagi untuk keluar" numpuk dengan tombol Scan Junk** — `.toast`
  (`src/css/style.css`) diubah dari background semi-transparan (`rgba(...,.15)`) jadi solid
  (`var(--bg2)`) + `box-shadow` — sengaja tetap menumpuk di posisi yang sama (bukan dipindah),
  cuma sekarang beneran menutupi tombol di belakangnya jadi teks toast selalu terbaca.

---

## Changelog — i18n: Toggle Bahasa Indonesia / English (2026-09-05)

Branch `unlocked-test`. Cakupan **full** (bukan cuma UI statis) sesuai pilihan eksplisit —
semua toast, judul/isi modal konfirmasi, detail Before/After, alasan upgrade Pro, dll ikut
diterjemahkan, bukan cuma label kartu.

### Arsitektur
- Dictionary `I18N = { id: {...}, en: {...} }` di `src/js/app.js` (setelah blok Pro-gating,
  sebelum `demo` state) — **314 key**, sama persis di kedua bahasa (diverifikasi otomatis saat
  sesi ini: 0 key hilang, 0 key tidak terpakai).
- `t(key, vars)` — lookup + `{placeholder}` substitution sederhana (`t('modalDeleteWABody',
  {count: 5, size: '120 MB'})`), fallback ke `I18N.id` lalu ke `key` mentah kalau key tidak ada.
- `applyStaticI18n()` — jalan lewat `[data-i18n]` di HTML (textContent) atau `[data-i18n-html]`
  (innerHTML, dipakai utk teks yang punya `<b>`/`<br>` di dalamnya, mis. section Remove Ads).
  **Penting:** kalau nilai key dipakai via `data-i18n` biasa (textContent), JANGAN taruh HTML
  entity (`&amp;`, `&gt;`) di dictionary — textContent tidak decode entity, hasilnya teks
  `&amp;` mentah muncul di layar (bug nyata yang kejadian & sudah diperbaiki sesi ini, lihat
  `advSubTrash`). Tulis karakter literal (`&`, `>`) langsung.
- `setLang(lang)` / `window.toggleLang()` — simpan pilihan ke `localStorage` (`sc_lang`),
  update kedua entry point UI sekaligus (badge header + baris di Advanced tab).
- **Auto-detect saat install pertama**: `detectDefaultLang()` baca `navigator.language` — HP
  berbahasa Indonesia default ke `id`, selain itu default ke `en`. Sama seperti pola
  `resolveInitialIsPro()` yang sudah ada: cuma berlaku kalau belum ada pilihan tersimpan,
  toggle manual (header ATAU Advanced tab) selalu menang sesudahnya.
- String dengan isi dinamis yang di-generate berulang (label `CLEAN_ITEMS`, `PRO_LOCKED_CARDS`
  reason, config `initFlatFileCleaner`) memakai **getter/fungsi**, bukan string biasa — supaya
  otomatis ikut bahasa terbaru tiap dibaca, bukan beku di bahasa saat modul di-load.

### Cara nambah string baru
- HTML statis: `<span data-i18n="myKey">Teks Indonesia</span>` (kalau bersebelahan dengan badge
  non-translatable spt `.pro-lock`, taruh `data-i18n` di span TERPISAH, bukan di parent —
  textContent parent akan menghapus badge anak).
- JS dinamis: ganti string literal dengan `t('myKey')` atau `t('myKey', {n: 5})`, lalu tambah
  key ke `I18N.id` **dan** `I18N.en`.

### Entry point toggle
- Badge di header (`#btnLangToggle`, sebelah chip storage) — menampilkan bahasa TUJUAN (mis.
  tampil "EN" saat sedang ID).
- Baris "Bahasa Aplikasi" di paling atas tab Advanced (`#langRow`, di luar semua kartu/grup
  Pro) — dua tombol "Indonesia"/"English" (nama bahasa sengaja tidak diterjemahkan, mengikuti
  konvensi umum language picker), keduanya selalu sinkron dengan badge header.

### Bug lain yang ditemukan & diperbaiki saat verifikasi di device
- Storage chip header ("117 GB / 224.5 GB") jadi 2 baris setelah badge bahasa ditambahkan di
  sebelahnya — font-size `.storage-chip`/`.lang-toggle-btn` diperkecil (12px → 10.5px) +
  `white-space: nowrap`.

---

## Changelog — Anti-Modding Security Layer (2026-09-05)

Branch `unlocked-test`. Native (Java only, no NDK/Kotlin) hardening untuk paywall Free/Pro,
memakai apa yang bisa dibangun tanpa backend — Play Integrity API dan verifikasi purchase
server-side sengaja di-skip untuk sesi ini (keduanya butuh Cloud project/service account yang
belum ada), begitu juga native code/NDK (project ini 100% Java, tetap begitu).

### Temuan kritis yang mengubah prioritas: celah bypass lewat WebView
`isPro` dan semua gating (`requirePro()`/`checkDailyLimit()`/`PRO_LOCKED_CARDS`) sebelumnya
HANYA hidup di `src/js/app.js` (JavaScript di WebView) — plugin native (`FileCleanerPlugin`,
`DuplicateFinderPlugin`, `AppManagerPlugin`) yang benar-benar mengeksekusi aksi sensitif (hapus
file, scan Telegram, uninstall app) sama sekali tidak tahu status Pro, tinggal menjalankan
apapun yang diminta JS. Artinya jalan termudah modder BUKAN membongkar signature/Play Integrity
sama sekali — cukup patch/hook `app.js` (tanpa menyentuh APK sedikit pun) untuk melewati cek
JS, lalu panggil method plugin native langsung. Ini kelemahan spesifik arsitektur Capacitor/
hybrid-WebView, dan jadi prioritas utama sebelum lapisan proteksi lain berarti apa-apa.

### Yang dibangun
| Lapisan | File | Status |
|---|---|---|
| **Native entitlement gate** (perbaikan utama) | `security/EntitlementGuard.java` + gating di `FileCleanerPlugin`/`AppManagerPlugin` | ✅ Aktif, mirror aturan Free/Pro tabel Phase 2 |
| Anti-debugger / anti-emulator / root detection | `security/IntegrityGuard.java` | ✅ Aktif, reporting-only (lihat catatan enforcement) |
| APK signature self-check | `IntegrityGuard.verifyAppSignature()` | ✅ Aktif, tapi pakai **hash keystore debug** — lihat TODO Phase 1 |
| ProGuard/R8 + resource shrinking | `build.gradle` release buildType | ✅ Aktif — `assembleProdRelease` terbukti berhasil (APK unsigned 1.5MB vs debug 4.2MB) |
| Verifikasi signature Play Billing lokal | `security/LicenseVerifier.java` | ⏸️ Utility siap pakai, TIDAK disambung ke flow apapun (belum ada Billing asli di branch ini) |
| String/constant obfuscation | `security/Obfuscated.java` | ✅ Dipakai untuk 2 constant di atas (speed bump, bukan kriptografi — lihat komentar di file) |
| Google Play Integrity API | — | ❌ Di-skip sesi ini (butuh backend verifikasi token, lihat diskusi) |
| Native code / NDK | — | ❌ Di-skip sesi ini (tetap 100% Java) |

### Cara kerja native entitlement gate
`EntitlementGuard` (SharedPreferences terpisah dari storage WebView, `"sc_security"`) mem-mirror
`isPro` + status "sudah dipakai hari ini" per fitur. `setProState()` di `app.js` sekarang juga
memanggil `Security.setEntitlement({isPro})` setiap kali berubah (termasuk saat resolve dari
build-flavor default & toggle manual Upgrade/kembali ke Free) — jadi native selalu sinkron
dengan state JS tanpa perlu restart app. Setiap `FileCleaner.deleteFiles`/`scanTelegramMedia`/
`cleanRecentlyDeleted` dan `AppManager.uninstallApp` sekarang mengirim/mengecek param `feature`
(`bigfile`/`apk`/`download`/`screenrec`/`telegram`/`camera`/`unused`/`recentlyDeleted`/`wa`) dan
menolak (`call.reject("PRO_REQUIRED")`) kalau `EntitlementGuard.isFeatureAllowed()` bilang tidak
— aturan per key persis meniru tabel Free/Pro Phase 2 (WA Documents/Audio dicek dari PATH file
yang mau dihapus, bukan tipe yang dikirim client, supaya `waCurrentType` tidak bisa dipalsukan
lepas dari gate tab JS).

**Known gap yang sengaja dibiarkan**: `DuplicateFinderPlugin.deleteFiles()` TIDAK digating
secara native — Free tier Duplicate Finder itu windowed (scope foto-saja + maks 5 grup pertama,
lihat `DUP_FREE_GROUP_CAP`/`visibleDupGroups()`), bukan all-or-nothing seperti fitur lain, jadi
replikasi native-nya butuh duplikasi seluruh hasil scan duplikat juga — di luar scope sesi ini.
Modder yang widen `dupSelected` lepas dari `visibleDupGroups()` masih bisa hapus duplikat ekstra
di Free — severity lebih rendah dari celah lain (cuma menghapus duplikat asli milik user, tidak
membuka fitur yang seharusnya terkunci total), tapi tetap gap nyata.

### Kebijakan enforcement anti-debug/emulator/root
`Security.runIntegrityChecks()` SELALU mengembalikan nilai apa adanya (reporting only) — hanya
`runIntegrityCheckSoftWarning()` di `app.js` (dipanggil sekali di `init()`, fire-and-forget) yang
memutuskan tindakan, dan itu cuma toast peringatan lembut (bisa di-dismiss), BUKAN blok keras —
dan cuma muncul kalau BUKAN debug build DAN BUKAN flavor `unlocked` (kedua flag dikirim balik
oleh native sendiri, `BuildConfig.DEBUG`/`BuildConfig.IS_UNLOCKED_TEST_BUILD`, supaya tidak
bisa ke-trigger tanpa sengaja saat development). Diverifikasi langsung di device (log native):
`{"debuggerAttached":false,"emulator":false,"rooted":false,"signatureValid":true,
"isDebugBuild":true,"isUnlockedTestBuild":false}` — semua benar untuk device fisik yang dipakai
testing, dan toast tidak muncul karena `isDebugBuild=true` (sesuai desain).

### Yang TERBUKTI, dan yang TIDAK
✅ Terbukti: kedua flavor compile+build+install+launch bersih (tanpa crash), `assembleProdRelease`
berhasil packaging dengan R8+shrinkResources aktif, plugin `Security` terbukti merespons benar
end-to-end (log native di atas), setiap titik panggil delete di `app.js` sudah mengirim `feature`
yang benar (diverifikasi lewat pembacaan kode langsung, cross-check ke tabel Phase 2).

⚠️ Tidak terverifikasi langsung di UI: skenario live "toggle Free↔Pro lalu coba delete" tidak
berhasil di-demonstrasikan lewat tap otomatis (device yang dipakai testing sesi ini punya lag
input yang signifikan — tap terdeteksi terlambat beberapa aksi, layar sempat tertidur di tengah
percobaan — bukan masalah kode, tapi genuinely tidak berhasil direproduksi live). Verifikasi
bergantung pada review kode cermat + bukti tidak langsung (modal Upgrade dengan daftar benefit
yang cocok persis dengan fitur yang di-gate tampil & berfungsi normal). **Rekomendasi**: lakukan
tes manual toggle Free↔Pro + coba hapus di Big File Cleaner/Download Folder saat sempat, untuk
konfirmasi visual yang sesi ini tidak berhasil dapatkan.

⚠️ Ini bukan proteksi sempurna: signature check masih pakai hash keystore DEBUG (lihat TODO
Phase 1), root/emulator detection best-effort (Magisk Hide/Zygisk bisa mengelabui), string
obfuscation cuma speed bump bukan kriptografi, dan tanpa Play Integrity + verifikasi
server-side, modder dengan skill tinggi (root + Frida + waktu) masih bisa membongkar proteksi
ini — tujuannya menaikkan biaya crack di atas "sekadar decompile & flip boolean", bukan membuat
app 100% tidak bisa dibajak.

---

## Phase 1 — Play Store Readiness Checklist

Selesaikan ini sebelum submit ke Play Store:

### Technical
- [ ] Ganti package name jika diperlukan (saat ini `com.smartclean.app`)
- [ ] Buat keystore production & simpan dengan aman (jangan pakai debug keystore)
- [x] Set `minifyEnabled true` + ProGuard rules untuk release build — lihat changelog anti-modding
      di bawah. `assembleProdRelease` sudah terverifikasi berhasil packaging (unsigned, karena belum
      ada release signingConfig — item di atas).
- [ ] **Ganti `EXPECTED_SIGNATURE_SHA256_DEBUG` di `SecurityPlugin.java`** dengan SHA-256 sertifikat
      App Signing Play Console yang SEBENARNYA (Play Console → App integrity → App signing key
      certificate) — nilai saat ini cuma hash keystore debug lokal, placeholder yang HARUS diganti
      sebelum release atau `runIntegrityChecks().signatureValid` akan selalu `false` di build asli.
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

> Browser Cleaner card dihapus (branch `unlocked-test`): fungsinya sudah 100% tumpang
> tindih dengan "Bersihkan Cache Semua App" (System Cleaner shortcut) — keduanya cuma
> deep-link ke cleaner bawaan OS karena scoped storage memblokir akses langsung ke cache
> browser lain.

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
| **Private DNS / Remove Ads** shortcut | Full akses |
| Before/After Result Panel | Tidak tersedia |
| **Big File Cleaner** (> 100MB) | Scan full, hapus maks. 1 file/hari |
| **Empty Folder Cleanup** | Full akses — scan & hapus |
| **APK Installer Cleaner** | Scan gratis, hapus Pro |
| **Download Folder Cleanup** (> 90 hari) | Scan full, hapus maks. 1 file/hari |
| **Screen Recording Cleanup** | Scan gratis, hapus Pro |

#### PRO (setelah purchase)
| Fitur | Keterangan |
|---|---|
| **One-tap Clean** semua kategori | Tanpa batas harian |
| **WhatsApp Cleaner full** | Semua tipe, semua rentang waktu, WA Business |
| **Recently Deleted — Clean** | Hapus permanen, fitur killer vs kompetitor |
| **Duplicate Finder full** | Semua tipe file, semua hasil, auto-select |
| **Camera/Gallery Cleaner** | Full akses |
| **Unused App Cleaner** | Full akses |
| **Before/After Result Panel** | Visualisasi dampak cleaning |
| Defrag & Boost | Tanpa batas harian |
| **Telegram Cleaner** | Seluruh fitur (media + cache) — Pro-only, tidak ada tier gratis |
| **APK Installer Cleaner — hapus** | Scan tetap gratis untuk semua user |
| **Big File Cleaner — hapus tanpa batas 1/hari** | Free dibatasi 1 file/hari (lihat catatan psikologi limit di bawah) |
| **Download Folder Cleanup — hapus tanpa batas 1/hari** | Free dibatasi 1 file/hari |
| **Screen Recording Cleanup — hapus** | Scan tetap gratis untuk semua user |
| **Bebas iklan (AdMob banner dihide)** | Otomatis setelah purchase |

> **Kenapa Big File & Download Folder pakai "1 file/hari" bukan "1x clean/hari":** limit
> per-OPERASI (spt Clean Now/Defrag/Boost) gagal memicu upgrade untuk dua fitur ini karena
> user jarang butuh clean berkali-kali sehari — batasnya tidak pernah terasa. Limit per-FILE
> (pilih 1 file dari hasil scan, cuma bisa hapus 1/hari) justru terasa nyata kalau hasil scan
> menemukan banyak file besar sekaligus (mis. 10 file = 10 hari nunggu vs instant di Pro),
> sambil tetap jujur: user LIHAT semua file yang ditemukan (tidak disembunyikan), cuma
> dibatasi berapa yang bisa dihapus per hari. Diimplementasikan di `initFlatFileCleaner()`
> (`src/js/app.js`) via `cfg.freeMaxSelect` (memaksa single-select di UI) + `cfg.dailyLimitKey`
> (pakai `checkDailyLimit()` yang sama dengan Clean Now/Defrag/Boost).

> Catatan implementasi (branch `unlocked-test`): Google Play Billing belum di-wire di branch
> ini — `isPro` masih flag lokal (`localStorage`) yang di-toggle oleh tombol "Upgrade" untuk
> keperluan testing UX free/pro. Saat billing asli (Phase 2 di bawah) siap, tinggal ganti
> `purchasePro()`/`restorePro()` di `src/js/app.js` supaya memanggil `BillingManager` alih-alih
> men-set `isPro` secara langsung.

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
