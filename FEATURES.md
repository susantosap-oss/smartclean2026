# SmartClean — Dokumentasi Fitur

**Platform:** Android (Capacitor 5 + Native Java Plugins)  
**Min SDK:** Android 5.1 (API 22) | **Target SDK:** Android 14 (API 34)  
**Package:** `com.smartclean.app`

---

## Arsitektur

SmartClean dibangun dengan pendekatan hybrid — UI berbasis web (HTML/CSS/JS) yang berjalan di WebView Capacitor, dikombinasikan dengan **4 plugin Java native** yang mengakses API sistem Android secara langsung.

```
WebView (UI)
    ├── FileCleaner         → FileCleanerPlugin.java
    ├── MemoryBooster       → MemoryBoosterPlugin.java
    ├── DuplicateFinder     → DuplicateFinderPlugin.java
    └── AppManager          → AppManagerPlugin.java
```

---

## Halaman & Fitur

### 1. Clean (Scan Junk)

Halaman utama. Memindai 7 kategori sampah sekaligus, menampilkan ukuran per kategori, lalu user memilih apa yang ingin dibersihkan.

| Kategori | Yang Dipindai | Cara Bersih |
|---|---|---|
| **Temporary Files** | File `.tmp`, `.temp`, `.bak`, `.old`, `.dmp`, `.swp`, `~` + folder thumbnail (`.thumbnails`, `thumbs`, dll.) | Hapus file & isi folder thumbnail |
| **WA Database** | Backup `.db.crypt14` — hanya file backup lama, file terbaru per-folder dipertahankan | Hapus backup lama, simpan 1 terbaru |
| **Junk & Ad Files** | File `.log`, `.trace`, `.crash`, `.ads`, `.hprof`, `.err`, `.stackdump`, `.DS_Store`, `thumbs.db`, `desktop.ini` + folder `Android/data/` dari app yang sudah di-uninstall (orphaned) | Hapus file + bersihkan folder orphan |
| **App Cache** | Cache internal SmartClean sendiri (`getCacheDir`) | Hapus isi cache |
| **Browser Cache** | Chrome, Firefox, Opera, Edge, Brave, UC Browser, Samsung Browser, Browser bawaan — menggunakan `StorageStatsManager` API (akurat, tidak terblokir sandbox) | Clear via `StorageStatsManager` |
| **Notifications** | Jumlah notifikasi aktif via `NotificationListenerService` | Dismiss semua notifikasi |
| **Game Cache & Data** | Deteksi game via `ApplicationInfo.CATEGORY_GAME` (API 26+) + 26 keyword package (pubg, mlbb, freefire, roblox, minecraft, genshin, garena, moonton, dll.) — ukuran via `StorageStatsManager` | Clear cache folder per game |

**Catatan teknis:**
- Browser dan Game cache dibaca via `StorageStatsManager.queryStatsForPackage()` (membutuhkan `PACKAGE_USAGE_STATS`) — satu-satunya cara membaca cache app lain yang akurat di Android 10+.
- Notification count dibaca via `NotificationService.instance.getActiveNotifications()` (bukan `NotificationManager` — yang hanya bisa membaca notif milik app sendiri).
- Jika izin Notification Access belum aktif, muncul dialog otomatis yang mengarahkan user ke Settings → Notification Access.

**Result Panel (Before/After):** Setelah clean, ditampilkan perbandingan storage/RAM sebelum dan sesudah, total bytes dibebaskan, dan Optimization Score (1–5 bintang).

---

### 2. Defrag

Halaman optimasi storage dan RAM.

#### Storage Info
Menampilkan bar progress kapasitas Internal Storage, SD Card (jika ada), dan RAM — diambil dari `StatFs` / `StorageManager`.

#### Defrag & Optimize Storage
- Menjalankan `StorageManager.allocateBytes()` untuk TRIM (Android 8+)
- Membersihkan cache app SmartClean sendiri
- Menampilkan log proses step-by-step

#### Boost Memory (RAM)
- Memanggil `ActivityManager.killBackgroundProcesses()` untuk semua app non-sistem
- GC dua kali (sebelum dan sesudah kill)
- Melaporkan RAM yang berhasil dibebaskan dan jumlah proses yang dihentikan

#### Recently Deleted (Clean Sampah Sistem)
Fitur untuk membaca dan menghapus file yang sudah masuk **sampah sistem Android** (MediaStore trash).

- **Scan:** Membaca `MediaStore` dengan filter `IS_TRASHED = 1` (Android 10) atau `QUERY_ARG_MATCH_TRASHED = MATCH_ONLY` (Android 11+). Mengembalikan jumlah item dan total ukuran.
- **Clean:** Menghapus permanen setiap item via `ContentResolver.delete()`. Tidak memerlukan konfirmasi sistem tambahan jika memiliki `MANAGE_EXTERNAL_STORAGE`.
- Tersedia hanya di Android 10+ (API 29+). File yang dihapus tidak bisa dikembalikan.

#### Clear Cache Semua App (System Cleaner)
Shortcut ke system cleaner bawaan device via `ACTION_INTERNAL_STORAGE_SETTINGS`.

- Mengapa diperlukan: Android sandbox mencegah app pihak ketiga menghapus cache app lain secara langsung tanpa root. Satu-satunya cara resmi dan aman adalah melalui system cleaner OS.
- Intent `ACTION_INTERNAL_STORAGE_SETTINGS` di-*handle* berbeda tiap manufacturer — semuanya membuka tool cleaning system-level yang punya akses penuh ke cache semua app:

  | Manufacturer | Yang Terbuka |
  |---|---|
  | OPPO / ColorOS | Phone Manager → Clean Up |
  | Xiaomi / MIUI | Security → Cleaner |
  | Samsung | Device Care → Storage |
  | Stock Android | Settings → Storage → Cached data |

- Fallback ke `ACTION_SETTINGS` jika intent utama tidak tersedia.
- Implementasi: `AppManagerPlugin.openStorageSettings()` → `Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS)`.

---

### 3. Battery

Halaman monitoring baterai dan kontrol app aktif.

#### Info Baterai
- Level persentase dengan visualisasi ikon baterai (warna hijau/kuning/merah sesuai level)
- Status charging / tidak charging
- Dibaca via `BatteryManager` broadcast intent

#### RAM Info
- Total RAM, RAM terpakai, RAM bebas, total cache semua app

#### Scan & Kill Active Apps
- **Scan:** Menggunakan `UsageStatsManager.queryUsageStats()` untuk mendapatkan app yang aktif dalam 30 menit terakhir. Filter app sistem (FLAG_SYSTEM) dan SmartClean sendiri. Urutkan dari yang paling baru digunakan.
- Estimasi memori tiap app via `StorageStatsManager` (cache + data bytes / 8192, clamp 32MB–500MB) — proxy karena `getProcessMemoryInfo()` dibatasi Android 11+.
- **Kill:** `ActivityManager.killBackgroundProcesses()` per package yang dipilih user.
- Fallback ke `getRunningAppProcesses()` + `getProcessMemoryInfo()` untuk Android lama jika UsageStats kosong.

---

### 4. Advanced

Kumpulan tool pembersih khusus, ditampilkan dalam accordion (expand/collapse).

#### WhatsApp Cleaner
- Memindai media WhatsApp dan WhatsApp Business: Video, Gambar, Dokumen, Audio
- Mendukung dua layout path: legacy (`WhatsApp/Media/...`) dan scoped storage (`Android/media/com.whatsapp/.../`)
- Filter berdasarkan usia file (pilih: 1, 3, 6, 12 bulan)
- Preview thumbnail foto/video (lazy-load via IntersectionObserver)
- Badge sumber: WhatsApp / WA Business
- De-duplikasi path agar file yang sama tidak muncul dua kali (symlink OS)
- Pilih file individual atau Select All, lalu hapus

#### Browser Cache Cleaner
- Scan individual per browser yang terinstall: Chrome, Firefox, Opera, Edge, Brave, UC, Samsung Browser, Browser default
- Tampil nama browser + ikon + ukuran cache
- Hapus semua cache yang ditemukan (history dan cookie tidak ikut dihapus)

#### Camera / Gallery Cleaner
- Memindai folder DCIM/Camera, DCIM, Pictures, Movies, Download
- Tab: Video, Foto, Screenshot
- Filter usia file (1, 3, 6, 12 bulan)
- Preview thumbnail + pilih individual atau Select All

#### Duplicate Finder
- Deteksi duplikat via MD5 hash (hashing 64KB pertama file sebagai fast-hash, dilengkapi suffix ukuran file untuk mengurangi false positive)
- Pre-filter berdasarkan ukuran file (lewati file < 10KB)
- Scope: All, Photos Only, Videos Only
- Tampil grup duplikat dengan path dan tanggal
- Auto-select: otomatis memilih semua kecuali file terbaru di tiap grup
- Hapus file yang dipilih, file asli/terbaru tetap aman

#### Unused App Cleaner
- Memindai app yang tidak dipakai selama **6 bulan atau lebih** menggunakan `UsageStatsManager`
- App yang baru diinstall (< 7 hari) dikecualikan
- Tampil nama app, ikon (Base64), ukuran (via `StorageStatsManager`), dan kapan terakhir dipakai
- Uninstall via system dialog (`ACTION_DELETE`) — satu per satu, user harus konfirmasi di setiap app
- Setelah uninstall, list di-refresh otomatis

#### Remove Ads (Private DNS)
- Menyediakan hostname ad-blocker DNS yang bisa disalin ke clipboard
- Tombol langsung membuka Settings → Network (via `ACTION_WIRELESS_SETTINGS`)
- Cara kerja: memblokir domain iklan di level DNS, tanpa root

---

## Permissions

| Permission | Digunakan untuk |
|---|---|
| `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` | Baca/hapus file di storage (Android ≤ 12) |
| `MANAGE_EXTERNAL_STORAGE` | Akses penuh storage (Android 11+), wajib untuk clean Recently Deleted dan orphaned folders |
| `READ_MEDIA_IMAGES/VIDEO/AUDIO` | Akses media di Android 13+ |
| `PACKAGE_USAGE_STATS` | Baca usage stats app (browser cache, game cache, battery scan, unused apps) |
| `KILL_BACKGROUND_PROCESSES` | Kill background process di battery boost |
| `QUERY_ALL_PACKAGES` | List semua app terinstall |
| `REQUEST_DELETE_PACKAGES` | Trigger uninstall dialog |
| `BIND_NOTIFICATION_LISTENER_SERVICE` | Baca dan dismiss notifikasi via NotificationListenerService |
| `POST_NOTIFICATIONS` | Menampilkan notifikasi dari SmartClean |
| `FOREGROUND_SERVICE` | Jalankan service di foreground |
| `RECEIVE_BOOT_COMPLETED` | (Untuk service otomatis saat boot) |
| `BATTERY_STATS` | Info baterai detail |
| `INTERNET` / `ACCESS_NETWORK_STATE` | Akses jaringan (WebView) |

---

## UX & Navigasi

- **Splash screen** → fade ke app setelah 2.5 detik
- **Bottom navigation** dengan 4 tab: Clean, Defrag, Battery, Advanced
- **Android Back Button** ditangani bertingkat: tutup result panel → tutup modal → collapse accordion → kembali ke tab Clean → double-press untuk keluar
- **Result Panel (Before/After):** Tampil setiap kali ada operasi clean/boost, dengan animasi bar storage/RAM dan Optimization Score
- **Toast notification** untuk feedback singkat (berhasil, error)
- **Modal konfirmasi** sebelum operasi destruktif (clean, hapus file, uninstall)
- **Demo mode:** Jika plugin native tidak tersedia (misal di browser desktop), semua fitur berjalan dengan data simulasi

---

## Kompatibilitas Android

| Fitur | Min Android |
|---|---|
| Semua fitur dasar | Android 5.1 (API 22) |
| Browser/Game cache via StorageStatsManager | Android 8.0 (API 26) |
| SD Card info via StorageVolume | Android 11 (API 30) |
| Recently Deleted scan | Android 10 (API 29) |
| Recently Deleted clean (QUERY_ARG_MATCH_TRASHED) | Android 11 (API 30) |
| Battery scan via UsageStatsManager | Android 5.1 (API 22) — wajib grant PACKAGE_USAGE_STATS |
| Unused App scan via UsageStatsManager | Android 5.1 (API 22) — wajib grant PACKAGE_USAGE_STATS |
