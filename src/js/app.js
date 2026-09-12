'use strict';

// ── Capacitor plugin headers ──
// Custom Java plugins are not in capacitor.plugins.json so the bridge routing
// layer doesn't know about them. Declare them here so nativePromise() is used.
if (window.Capacitor) {
  const _ph = window.Capacitor.PluginHeaders || [];
  const _pm = n => n.map(name => ({ name, rtype: 'promise' }));
  _ph.push(
    { name: 'MemoryBooster',    methods: _pm(['getStorageStats','getMemoryStats','boostMemory','optimizeStorage','getRunningApps','stopApps','getBatteryInfo']) },
    { name: 'FileCleaner',      methods: _pm(['scanJunkFiles','cleanJunkFiles','deleteFiles','scanWAMedia','scanCameraMedia','clearNotifications','requestNotificationAccess','scanRecentlyDeleted','cleanRecentlyDeleted','scanBigFiles','scanApkFiles','scanEmptyFolders','scanDownloadOld','scanScreenRecordings','scanTelegramMedia']) },
    { name: 'DuplicateFinder',  methods: _pm(['scanDuplicates','deleteFiles']) },
    { name: 'AppManager',       methods: _pm(['scanUnusedApps','uninstallApp','openNetworkSettings','openStorageSettings','setKeepScreenOn','getBuildFlavor']) },
    { name: 'Security',         methods: _pm(['setEntitlement','markFeatureUsed','runIntegrityChecks','verifyPurchaseSignature']) },
  );
  window.Capacitor.PluginHeaders = _ph;
}

// ── Capacitor plugin registration ──
const { registerPlugin } = window.Capacitor || {};
const FileCleaner   = registerPlugin ? registerPlugin('FileCleaner')   : null;
const MemoryBooster = registerPlugin ? registerPlugin('MemoryBooster') : null;
const DupFinder     = registerPlugin ? registerPlugin('DuplicateFinder') : null;
const AppManager    = registerPlugin ? registerPlugin('AppManager')    : null;
const Security      = registerPlugin ? registerPlugin('Security')     : null;
const AppPlugin     = registerPlugin ? registerPlugin('App') : null;
let scanProgressActive = false;
let cleanProgressActive = false;
if (FileCleaner) {
  FileCleaner.addListener('scanProgress', (data) => {
    if (data.stage === 'wa') { updateWAScanButtonProgress(data.percent); return; }
    if (!scanProgressActive) return;
    updateScanRingProgress(data.percent);
  });
  FileCleaner.addListener('cleanProgress', (data) => {
    if (!cleanProgressActive) return;
    updateCleanProgressPopup(data.percent);
  });
}
// WhatsApp media scan can recurse a large "Sent"/"Statuses" history with no other
// feedback while running — show live percent on the button so it never reads as stuck.
function updateWAScanButtonProgress(percent) {
  const btn = document.getElementById('btnScanWA');
  if (!btn || !btn.disabled) return;
  const p = Math.max(0, Math.min(100, percent));
  btn.textContent = `${t('scanningEllipsis')} ${p}%`;
}
function updateScanRingProgress(percent) {
  const p = Math.max(0, Math.min(100, percent));
  setRingProgress(document.getElementById('cleanRingArc'), p / 100);
  document.getElementById('cleanSize').textContent = p + '%';
}
function updateCleanProgressPopup(percent) {
  const p = Math.max(0, Math.min(100, percent));
  const offset = 314 - (314 * p / 100);
  document.getElementById('cleanProgressArc').style.strokeDashoffset = offset;
  document.getElementById('cleanProgressPercent').textContent = p + '%';
}
function showCleanProgressPopup() {
  updateCleanProgressPopup(0);
  document.getElementById('cleanProgressModal').classList.remove('hidden');
}
function hideCleanProgressPopup() {
  document.getElementById('cleanProgressModal').classList.add('hidden');
}

// ════════════════════════════════════════
//  PRO / FREEMIUM GATING
//  Full Free/Pro spec: DEVELOP.md Phase 2. SmartClean ships as ONE app with this real
//  Free/Pro split built in — no Google Play Billing wired up yet, so isPro is a local
//  flag, and "Upgrade" just flips it so the free/pro UX is fully testable now (swap
//  purchasePro()/restorePro() below for a real BillingManager call once billing lands).
//  Separately, android/app/build.gradle's "unlocked" flavor is an INTERNAL-ONLY QA build
//  (distinct app name/icon/package, never distributed) that starts fully unlocked —
//  see resolveInitialIsPro() below, which is the only thing that flavor changes.
// ════════════════════════════════════════
const PRO_CACHE_KEY = 'sc_is_pro';
const _proCached = localStorage.getItem(PRO_CACHE_KEY);
let isPro = _proCached === '1'; // real default (false) until resolveInitialIsPro() runs in init()

function setProState(pro) {
  isPro = !!pro;
  localStorage.setItem(PRO_CACHE_KEY, isPro ? '1' : '0');
  document.body.classList.toggle('is-pro', isPro);
  // Mirror to the native EntitlementGuard so Pro-gated plugin methods (deleteFiles,
  // scanTelegramMedia, uninstallApp, cleanRecentlyDeleted) stay in sync even though the
  // actual decision authority now lives natively, not just in this JS flag.
  if (Security) Security.setEntitlement({ isPro }).catch(() => {});
  const upgradeEntry = document.getElementById('btnUpgradeEntry');
  if (upgradeEntry) upgradeEntry.classList.toggle('hidden', isPro);

  // WhatsApp Cleaner — "1 Bulan Terakhir" (most aggressive filter) is Pro-only
  const waOpt1 = document.querySelector('#waMonths option[value="1"]');
  if (waOpt1) waOpt1.disabled = !isPro;

  // Duplicate Finder — free tier locked to "Hanya Foto" scope
  document.querySelectorAll('input[name="dupScope"]').forEach(r => {
    r.disabled = !isPro && r.value !== 'photos';
  });
  if (!isPro) {
    const photosRadio = document.querySelector('input[name="dupScope"][value="photos"]');
    if (photosRadio) photosRadio.checked = true;
  }
  // Re-render an already-scanned list so caps/locks apply immediately after a state change
  if (typeof dupGroups !== 'undefined' && dupGroups.length) renderDupGroups();
}

// Only overrides isPro when no explicit choice has been cached yet (first launch of THIS
// install) — a later manual "Upgrade"/"kembali ke Free" tap always wins from then on, on
// either build, so the testing toggle stays usable even on the internal unlocked build.
async function resolveInitialIsPro() {
  if (_proCached !== null) return isPro;
  if (!AppManager) return isPro;
  try {
    const info = await AppManager.getBuildFlavor();
    return !!(info && info.isUnlockedTestBuild);
  } catch (e) { return isPro; }
}

window.openUpgradeModal = function(reason) {
  const modal = document.getElementById('upgradeModal');
  document.getElementById('upgradeReason').textContent =
    reason || t('upgradeDefaultReason');
  modal.classList.remove('hidden');
};
window.closeUpgradeModal = function() {
  document.getElementById('upgradeModal').classList.add('hidden');
};

// A delete reaching the native EntitlementGuard rejection should be rare in normal use
// (the JS-side gate already blocks it first) — this only fires when something bypassed
// the JS check, so surfacing the upgrade modal instead of a raw error is just a UX nicety,
// not the primary defense.
function handleDeleteRejection(e, fallbackReason) {
  if (e && String(e.message).includes('PRO_REQUIRED')) {
    openUpgradeModal(fallbackReason);
  } else {
    toast(t('deleteErrorPrefix') + (e && e.message), 'error');
  }
}

// Gate helper for Pro-exclusive actions — returns true if allowed to proceed,
// otherwise opens the upsell modal and returns false.
function requirePro(reason) {
  if (isPro) return true;
  openUpgradeModal(reason);
  return false;
}

// Free-tier daily-limit helper (Clean Now / Defrag / Boost — 1x/day each on Free).
function checkDailyLimit(key, reason) {
  if (isPro) return true;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(`sc_daily_${key}`) === today) {
    openUpgradeModal(reason);
    return false;
  }
  return true;
}
function markDailyUsed(key) {
  if (isPro) return;
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem(`sc_daily_${key}`, today);
}

window.purchasePro = function() {
  // Simulated local unlock — no BillingManager plugin on this branch yet.
  setProState(true);
  closeUpgradeModal();
  toast(t('toastProActivated'));
};
window.restorePro = function() {
  setProState(false);
  toast(t('toastBackToFree'));
};

// ════════════════════════════════════════
//  I18N — Bahasa Indonesia / English
//  Every user-facing string in this file and in index.html goes through t(key, vars)
//  (JS) or a [data-i18n] attribute (static HTML). To add a new translatable string:
//    HTML: give the element `data-i18n="myKey"` and put its Indonesian text as the
//          element's literal content (that's what shows before applyStaticI18n() runs,
//          and what falls back to `key` is missing) — then add `myKey` to both I18N.id
//          and I18N.en below. If the string sits next to a non-translatable badge
//          (e.g. .pro-lock), give the translatable text its OWN inline element/span
//          instead of putting data-i18n on the parent — textContent replacement would
//          otherwise wipe out the badge.
//    JS:   replace the literal string with t('myKey') (or t('myKey', {n: 5}) for one
//          with a {n}-style placeholder) and add the key to both dictionaries.
// ════════════════════════════════════════
// Only overrides the default when no explicit choice has been saved yet — matches the
// isPro/build-flavor precedent above (resolveInitialIsPro()): a prior toggle, from either
// the header button or the Advanced-tab language row, always wins after that.
function detectDefaultLang() {
  const sysLang = (navigator.language || (navigator.languages && navigator.languages[0]) || '').toLowerCase();
  return sysLang.startsWith('id') ? 'id' : 'en';
}
const LANG_CACHE_KEY = 'sc_lang';
const _langCached = localStorage.getItem(LANG_CACHE_KEY);
let currentLang = _langCached === 'en' || _langCached === 'id' ? _langCached : detectDefaultLang();

const I18N = {
  id: {
    // ── Splash / shell ──
    splashSub: 'Phone Cleaner & Optimizer',
    scanInfoText: 'Kecepatan proses scan tergantung kepada kapasitas Internal Storage dan banyaknya file junk yang di-scan.',
    adBannerPlaceholder: 'Ad Banner (Placeholder)',
    // ── Privacy Policy gate (first launch) ──
    privacyTitle: 'Kebijakan Privasi',
    privacySub: 'Mohon baca & setujui sebelum melanjutkan',
    privacyWebLink: '🔗 Baca versi lengkap di web',
    privacyCheckLabel: 'Saya sudah membaca dan menyetujui Kebijakan Privasi di atas',
    privacyDecline: 'Tolak & Keluar',
    privacyAccept: 'Setuju & Lanjutkan',
    privacyLoadError: 'Kebijakan Privasi tidak dapat dimuat saat ini. Silakan hubungi ads.dev26@gmail.com.',
    privacyMustAccept: 'Anda perlu menyetujui Kebijakan Privasi untuk menggunakan aplikasi ini.',
    // ── Nav ──
    navClean: 'Clean', navDefrag: 'Defrag', navBattery: 'Battery', navAdvanced: 'Advanced',
    // ── App language row (Advanced tab) ──
    appLanguageLabel: 'Bahasa Aplikasi',
    internalStorageLabel: 'Internal Storage', sdCardLabel: 'SD Card', ramMemoryLabel: 'RAM Memory',
    // ── Common / reused across many cards ──
    selectAll: 'Select All',
    scanningEllipsis: '⏳ Scanning…',
    deleteSelected: '🗑 Delete Selected',
    tapMinSelect: 'Pilih minimal 1 item',
    tapSelectFile: 'Pilih file dulu',
    scanErrorPrefix: 'Scan error: ',
    deleteErrorPrefix: 'Delete error: ',
    integrityWarning: '⚠️ Perangkat atau instalasi ini terdeteksi tidak standar (root/emulator/debugger/signature tidak cocok).',
    proLockPro: '🔒 PRO',
    proLock1PerDay: '🔒 1 file/hari',
    proLockPlain: '🔒',
    // ── Clean section ──
    cleanLabelDefault: 'Junk Found',
    cleanLabelScanning: 'Scanning…',
    btnScanJunkDefault: '🔍 Scan Junk',
    btnCleanNowDefault: '🧹 Clean Now',
    btnCleanNowBusy: '⏳ Cleaning…',
    modalNotifTitle: '🔔 Izin Notifikasi Belum Aktif',
    modalNotifBody: 'SmartClean belum dapat membaca notifikasi.\n\nTap OK untuk membuka Settings dan aktifkan "Notification Access" untuk SmartClean.',
    toastScanDone: 'Scan selesai! Ditemukan {size} junk.',
    modalConfirmCleanTitle: 'Konfirmasi Clean',
    modalConfirmCleanBody: 'Hapus {size} dari: {names}?',
    detailTotalFilesCleaned: 'Total files cleaned',
    toastCleanFailedPrefix: 'Clean gagal: ',
    dailyLimitClean: 'Clean Now di versi Free dibatasi 1x per hari. Upgrade ke Pro untuk clean tanpa batas.',
    cleanItemTmpTitle: 'Temporary Files', cleanItemTmpSub: 'tmp · temp · thumbs',
    cleanItemMsgTitle: 'WA Database (.crypt14)', cleanItemMsgSub: 'Sisakan file terbaru',
    cleanItemJunkTitle: 'Junk & Ad Files', cleanItemJunkSub: 'ads · cache · residual',
    cleanItemNotifTitle: 'Notifications', cleanItemNotifSub: 'Hapus notifikasi tersisa',
    // ── Recently Deleted ──
    advTitleTrash: 'Recently Deleted',
    advSubTrash: 'Foto, video & file di sampah sistem',
    systemTrash: 'Sampah Sistem',
    btnScanTrashDefault: 'Scan Recently Deleted',
    btnCleanTrashDefault: '🧹 Hapus Permanen',
    toastTrashFound: 'Recently Deleted: {size}',
    trashEmpty: 'Sampah sistem kosong',
    trashSubWithItems: '{count} item di sampah · {size}',
    dailyReasonTrashPro: 'Menghapus Recently Deleted secara permanen adalah fitur Pro.',
    modalTrashDeleteTitle: '🗑️ Hapus Permanen',
    modalTrashDeleteBody: 'Hapus {size} dari sampah sistem secara permanen?\n\nFile tidak bisa dikembalikan setelah ini.',
    btnTrashDeleting: '⏳ Menghapus…',
    detailTrashCleaned: 'Recently Deleted dibersihkan',
    detailStorageFreed: 'Storage dibebaskan',
    detailStatus: 'Status',
    statusPermanentlyDeleted: 'Permanen dihapus',
    toastTrashCleaned: '✅ Recently Deleted berhasil dibersihkan!',
    toastFailedPrefix: 'Gagal: ',
    // ── Defrag section ──
    sdCardNotDetected: 'Tidak terdeteksi',
    storagePctUsedSuffix: '% terpakai',
    ramUsedTotalSuffix: ' used / {total} total — {pct}%',
    btnDefragDefault: 'Defrag & Optimize Storage',
    btnDefragBusy: 'Optimizing…',
    btnBoostDefault: 'Boost Memory (RAM)',
    btnBoostBusy: 'Boosting…',
    dailyReasonDefrag: 'Defrag & Optimize Storage di versi Free dibatasi 1x per hari. Upgrade ke Pro untuk tanpa batas.',
    dailyReasonBoost: 'Boost Memory (RAM) di versi Free dibatasi 1x per hari. Upgrade ke Pro untuk tanpa batas.',
    logDefragStart: 'Memulai defrag internal storage…',
    logDefragStep1: 'Scanning file table…',
    logDefragStep2: 'Optimizing block allocation…',
    logDefragStep3: 'Trimming SSD…',
    logDefragStep4: 'Cleaning orphaned entries…',
    logDefragStep2Demo: 'Optimizing inode structure…',
    logDefragStep3Demo: 'Trimming SSD blocks…',
    logDefragStep5Demo: 'Verifying integrity…',
    logDefragDone: '✅ Selesai! Freed: {size}',
    detailStorageTrimmed: 'Storage trimmed',
    detailBlocksLeft: 'Blok tersisa (internal)',
    statusOptimal: 'Optimal',
    toastStorageOptimized: '✅ Storage berhasil dioptimalkan!',
    logDefragErrorPrefix: 'Error: ',
    toastDefragError: 'Defrag error',
    logKillingBg: 'Menghentikan background processes…',
    boostNoteSmall: '⚠️ Android modern mengelola RAM otomatis. Hasil kecil adalah normal.',
    boostNoteBig: '✅ {killed} proses dihentikan, {size} RAM dibebaskan.',
    detailRamFreed: 'RAM dibebaskan',
    detailAppsStopped: 'App dihentikan',
    detailRamAvailNow: 'RAM tersedia kini',
    detailNote: 'Catatan',
    noteRamAuto: 'Android kelola RAM otomatis',
    unitProcesses: ' proses',
    toastRamFreedBig: '✅ {size} RAM dibebaskan!',
    toastBoostOptimal: '✅ Boost selesai (RAM sudah optimal)',
    toastBoostError: 'Boost error',
    // ── Battery section ──
    batteryChecking: 'Checking…',
    batteryCharging: '⚡ Sedang charging',
    batteryNotCharging: '🔋 Tidak charging',
    subtitleBgApps: 'Background Apps',
    emptyBgAppsHint: 'Tap scan to find background apps',
    subtitleInternalMemory: 'Internal Memory',
    labelTotalRam: 'Total RAM', labelUsedRam: 'Used RAM', labelFreeRam: 'Free RAM', labelAppCacheTotal: 'App Cache Total',
    btnScanAppsDefault: '🔍 Scan Apps',
    btnKillAllDefault: '⚡ Kill All',
    emptyNoBgApps: 'Tidak ada background app',
    toastFoundActiveApps: 'Ditemukan {count} app aktif baru-baru ini ({size})',
    toastScanFirst: 'Scan dulu!',
    modalKillBgTitle: 'Kill Background Apps',
    modalKillBgBody: 'Matikan {count} background app ({size} RAM)?',
    allBgAppsStoppedMsg: '✅ Semua background app dihentikan',
    detailBatteryImpact: 'Dampak baterai',
    batteryImpactValue: '+~15% lifetime',
    toastAppsKilled: '✅ {count} app dihentikan, {size} RAM dibebaskan!',
    toastKillErrorPrefix: 'Kill error: ',
    // ── Advanced — groups ──
    groupSocialMedia: 'Social Media Cleaner',
    groupDeepCleaner: 'Deep Cleaner',
    // ── WhatsApp Cleaner ──
    advTitleWA: 'WhatsApp Cleaner',
    advSubWA: 'WhatsApp & WhatsApp Business',
    tabVideo: 'Video', tabPhoto: 'Foto', tabDocument: 'Dokumen', tabAudio: 'Audio', tabScreenshot: 'Screenshot',
    filterKeep: 'Sisakan',
    filter3Months: '3 Bulan Terakhir', filter6Months: '6 Bulan Terakhir', filter1MonthPro: '1 Bulan Terakhir (🔒 Pro)', filter1Month: '1 Bulan Terakhir',
    btnScanWADefault: '🔍 Scan WhatsApp',
    dailyReasonWADocAudio: 'WhatsApp Cleaner untuk Dokumen & Audio adalah fitur Pro. Versi Free hanya Video & Foto.',
    emptyNoOldFiles: 'Tidak ada file lama',
    subOldFilesCount: '{count} file lama · {size}',
    toastWAFound: 'Ditemukan {count} file lama · {kept} file disisakan',
    toastWAScanErrorPrefix: 'WA scan error: ',
    modalDeleteWATitle: 'Hapus File WA',
    modalDeleteWABody: 'Hapus {count} file WhatsApp ({size})?',
    detailFilesDeleted: 'File dihapus',
    detailSource: 'Sumber',
    sourceWAMedia: 'WhatsApp Media',
    toastWADeleted: '✅ {size} WhatsApp media dihapus!',
    // ── Telegram Cleaner ──
    advTitleTelegram: 'Telegram Cleaner',
    advSubTelegram: 'Media & cache Telegram',
    btnScanTgDefault: '🔍 Scan Telegram',
    dailyReasonTelegramPro: 'Telegram Cleaner adalah fitur Pro.',
    toastTgFound: 'Ditemukan {count} file lama',
    toastTgScanErrorPrefix: 'Telegram scan error: ',
    modalDeleteTgTitle: 'Hapus File Telegram',
    modalDeleteTgBody: 'Hapus {count} file Telegram ({size})?',
    sourceTelegramMedia: 'Telegram Media',
    toastTgDeleted: '✅ {size} Telegram media dihapus!',
    // ── Camera / Gallery Cleaner ──
    advTitleCamera: 'Camera & Gallery Cleaner',
    advSubCamera: 'Foto & Video lama',
    dailyReasonCameraPro: 'Camera & Gallery Cleaner adalah fitur Pro.',
    dailyReasonUnusedPro: 'Unused App Cleaner adalah fitur Pro.',
    btnScanCamDefault: '🔍 Scan Camera Roll',
    toastCamFound: '{count} file lama ditemukan',
    modalDeleteCamTitle: 'Hapus File Kamera',
    modalDeleteCamBody: 'Hapus {count} file ({size})?',
    detailCamDeleted: 'File kamera dihapus',
    detailOlderThan: 'Lebih dari',
    monthsAgoSuffix: ' bulan lalu',
    toastCamDeleted: '✅ {size} foto/video lama dihapus!',
    // ── Duplicate Finder ──
    advTitleDup: 'Duplicate Finder',
    advSubDup: 'Temukan & hapus duplikat',
    dupScopeAll: 'Semua Storage', dupScopePhotos: 'Hanya Foto', dupScopeVideos: 'Hanya Video',
    btnScanDupDefault: '🔍 Scan Duplicates',
    dupHashing: 'Hashing files…',
    dupCollecting: 'Mengumpulkan file ({pct}%)…',
    dupHashingPct: 'Menghitung hash MD5 ({pct}%)…',
    dupComparing: 'Membandingkan ({pct}%)…',
    emptyNoDuplicates: 'Tidak ada duplikat ditemukan',
    toastDupFound: '{count} grup duplikat · ~{size} dapat dihapus',
    subDupGroupsFound: '{count} grup duplikat ditemukan',
    unitFilesIdentical: ' file identik',
    dupLockedGroups: '🔒 {count} grup duplikat lainnya',
    dailyReasonDupHidden: 'Lihat & hapus semua grup duplikat — bukan cuma {cap} pertama — adalah fitur Pro.',
    labelPro: 'Pro',
    btnAutoSelectDefault: 'Auto Select',
    toastAutoSelected: '{count} file dipilih otomatis · {size}',
    btnDeleteDuplicatesDefault: '🗑 Delete Duplicates',
    modalDeleteDupTitle: 'Hapus Duplikat',
    modalDeleteDupBody: 'Hapus {count} file duplikat ({size})?',
    detailDupDeleted: 'Duplikat dihapus',
    detailOriginalFiles: 'File asli',
    statusIntact: 'Intact (disimpan)',
    toastDupDeleted: '✅ {size} duplikat dihapus!',
    // ── Big File Cleaner ──
    advTitleBigFile: 'Big File Cleaner',
    advSubBigFile: 'File > 100MB',
    btnScanBigFileDefault: '🔍 Scan File Besar',
    dailyReasonBigFile: 'Versi Free bisa hapus 1 file besar per hari. Upgrade ke Pro untuk hapus semua sekaligus, tanpa batas.',
    emptyNoBigFiles: 'Tidak ada file > 100MB',
    subFilesCountSize: '{count} file · {size}',
    toastFoundItemsSize: 'Ditemukan {count} item · {size}',
    modalDeleteBigFileTitle: 'Hapus File Besar',
    modalDeleteBigFileBody: 'Hapus {count} file ({size})?',
    detailBigFileDeleted: 'File besar dihapus',
    toastBigFileDeleted: '✅ {size} file besar dihapus!',
    // ── APK Installer Cleaner ──
    advTitleApk: 'APK Installer Cleaner',
    advSubApk: 'File installer (.apk)',
    btnScanApkDefault: '🔍 Scan File APK',
    dailyReasonApkPro: 'Menghapus file APK installer adalah fitur Pro. Scan tetap gratis.',
    emptyNoApk: 'Tidak ada file APK ditemukan',
    subApkCountSize: '{count} APK · {size}',
    modalDeleteApkTitle: 'Hapus File APK',
    modalDeleteApkBody: 'Hapus {count} file APK installer ({size})?',
    detailApkDeleted: 'APK dihapus',
    toastApkDeleted: '✅ {size} file APK dihapus!',
    // ── Empty Folder Cleanup ──
    advTitleEmptyFolder: 'Empty Folder Cleanup',
    advSubEmptyFolder: 'Folder kosong',
    btnScanEmptyFolderDefault: '🔍 Scan Folder Kosong',
    emptyNoEmptyFolders: 'Tidak ada folder kosong',
    subEmptyFolderCount: '{count} folder kosong',
    modalDeleteEmptyFolderTitle: 'Hapus Folder Kosong',
    modalDeleteEmptyFolderBody: 'Hapus {count} folder kosong?',
    detailEmptyFolderDeleted: 'Folder kosong dihapus',
    statusNeater: 'Lebih rapi',
    toastEmptyFolderDeleted: '✅ {count} folder kosong dihapus!',
    // ── Download Folder Cleanup ──
    advTitleDownload: 'Download Folder Cleanup',
    advSubDownload: 'File > 90 hari',
    downloadDesc: 'Scan file di folder Download yang berumur lebih dari 90 hari.',
    btnScanDownloadDefault: '🔍 Scan Download',
    dailyReasonDownload: 'Versi Free bisa hapus 1 file Download per hari. Upgrade ke Pro untuk hapus semua sekaligus, tanpa batas.',
    emptyNoDownloadOld: 'Tidak ada file lama di folder Download',
    modalDeleteDownloadTitle: 'Hapus File Download Lama',
    modalDeleteDownloadBody: 'Hapus {count} file Download berumur > 90 hari ({size})?',
    detailDownloadDeleted: 'File Download dihapus',
    toastDownloadDeleted: '✅ {size} file Download lama dihapus!',
    // ── Screen Recording Cleanup ──
    advTitleScreenRec: 'Screen Recording Cleanup',
    advSubScreenRec: 'Rekaman layar',
    btnScanScreenRecDefault: '🔍 Scan Screen Recording',
    dailyReasonScreenRecPro: 'Menghapus Screen Recording adalah fitur Pro. Scan tetap gratis.',
    emptyNoScreenRec: 'Tidak ada rekaman layar ditemukan',
    subScreenRecCountSize: '{count} rekaman · {size}',
    modalDeleteScreenRecTitle: 'Hapus Screen Recording',
    modalDeleteScreenRecBody: 'Hapus {count} rekaman layar ({size})?',
    detailScreenRecDeleted: 'Rekaman dihapus',
    toastScreenRecDeleted: '✅ {size} rekaman layar dihapus!',
    // ── Unused App Cleaner ──
    advTitleUnused: 'Unused App Cleaner',
    advSubUnused: 'App tidak dipakai > 6 bulan',
    btnScanUnusedDefault: '🔍 Scan Aplikasi Jarang Dipakai',
    neverUsed: 'Belum pernah dipakai',
    daysAgoSuffix: ' hari lalu',
    monthsAgoSuffixShort: ' bulan lalu',
    yearsAgoSuffix: ' tahun lalu',
    toastUnusedFound: 'Ditemukan {count} aplikasi jarang dipakai',
    toastAllAppsUsed: 'Semua aplikasi masih aktif dipakai',
    emptyAllAppsActive: 'Semua aplikasi masih aktif dipakai 👍',
    subAppsCountSize: '{count} app · {size}',
    btnUninstallSelectedDefault: '🗑 Uninstall Terpilih',
    toastSelectMinApp: 'Pilih minimal 1 aplikasi',
    modalUninstallTitle: 'Uninstall Aplikasi',
    modalUninstallBody: 'Uninstall {count} aplikasi: {names}?\n\nSistem Android akan meminta konfirmasi terpisah untuk tiap aplikasi.',
    toastUninstallResult: '{done}/{total} aplikasi berhasil di-uninstall',
    toastUninstallErrorPrefix: 'Uninstall error: ',
    // ── Remove Ads ──
    advTitleAds: 'Remove Ads',
    advSubAds: 'Blokir iklan di semua app & browser',
    adsDesc: 'Aktifkan <b>Private DNS</b> bawaan Android dan arahkan ke DNS anti-iklan. Ini memblokir sebagian besar iklan (banner, popup, video ads) di semua aplikasi &amp; browser sekaligus di level jaringan &mdash; tanpa root, tanpa aplikasi VPN tambahan.',
    adsDnsLabel: 'Hostname DNS anti-iklan',
    btnCopy: 'Salin',
    adsStep1: 'Tap <b>Buka Pengaturan Jaringan</b> di bawah',
    adsStep2: 'Masuk ke <b>Network &amp; Internet → Private DNS</b> (nama menu bisa sedikit berbeda tiap merk HP)',
    adsStep3: 'Pilih <b>Hostname penyedia DNS pribadi</b>, tempel hostname di atas, lalu Simpan',
    btnOpenNetworkSettings: '⚙️ Buka Pengaturan Jaringan',
    adsNoteTitle: '⚠️ Kalau setelah Simpan internet malah tidak bisa connect',
    adsNoteBody: 'Beberapa jaringan WiFi (kantor, kampus, WiFi publik) memblokir port khusus yang dipakai Private DNS, sehingga Android menolak semua koneksi sampai pengaturannya diubah lagi. Hostname DNS-nya tidak salah — jaringan itu saja yang tidak mendukung fitur ini. Cara mengatasinya:',
    adsNoteStep1: 'Buka lagi <b>Network &amp; Internet → Private DNS</b>',
    adsNoteStep2: 'Pilih <b>Otomatis</b> (bukan Mati) saat berada di jaringan tersebut &mdash; mode ini otomatis kembali ke DNS biasa kalau DNS anti-iklan tidak didukung, jadi internet tetap jalan (ad-block sementara tidak aktif di jaringan itu)',
    adsNoteStep3: 'Ganti lagi ke <b>Hostname penyedia DNS pribadi</b> saat kembali ke WiFi rumah atau data seluler yang mendukung',
    toastDnsCopied: 'Hostname DNS disalin',
    toastCopyFailedPrefix: 'Gagal menyalin: ',
    toastOpenSettingsManualNetwork: 'Buka Settings > Network & Internet > Private DNS secara manual',
    toastOpenSettingsFailedPrefix: 'Tidak bisa membuka pengaturan: ',
    // ── System Cache Cleaner ──
    advTitleSysCache: 'Bersihkan Cache Semua App',
    advSubSysCache: 'Lewat cleaner bawaan sistem',
    sysCacheDesc: 'Android tidak mengizinkan app pihak ketiga (termasuk SmartClean) menghapus cache internal app lain secara langsung. Satu-satunya cara resmi & aman untuk membersihkan cache semua app sekaligus adalah lewat cleaner bawaan sistem HP kamu.',
    btnOpenBuiltinCleaner: '🧹 Buka Cleaner Bawaan Sistem',
    toastOpenSettingsManualStorage: 'Buka Settings → Storage atau Phone Manager secara manual',
    toastOpenStorageSettingsFailedPrefix: 'Tidak bisa membuka Storage Settings: ',
    // ── Modal generic ──
    modalOk: 'OK', modalUnderstood: 'Mengerti', modalCancel: 'Cancel',
    // ── Storage mismatch info ──
    storageMismatchTitle: 'ℹ️ Kenapa Angka Storage Bisa Beda?',
    storageMismatchBody: 'Angka di SmartClean diambil langsung dari sistem Android (kapasitas nyata partisi penyimpanan), bukan dari kemasan HP.\n\n• Kapasitas "256GB" di kemasan selalu lebih besar dari kapasitas terpakai sebenarnya (hitungan desimal vs biner + ruang sistem) — ini normal di semua HP Android, bukan cuma di SmartClean.\n\n• Aplikasi cleaner bawaan HP (System Clean/Phone Manager) kadang menghitung partisi lain (system/vendor) yang tidak bisa dibersihkan siapa pun, jadi angkanya bisa lebih besar dari SmartClean.\n\nUntuk cek paling akurat, bandingkan dengan Settings → Storage bawaan Android — biasanya lebih dekat ke angka SmartClean.',
    // ── Before/After Result Panel ──
    rpTitle: '📊 Before & After',
    rpFreedTotal: 'Total Dibebaskan',
    rpLockedTeaser: '🔒 Detail Before/After & Optimization Score tersedia di <b>Pro</b>',
    dailyReasonBeforeAfterPro: 'Before/After detail — grafik storage & RAM, Optimization Score — adalah fitur Pro.',
    rpInternalStorage: '💾 Internal Storage',
    rpRamMemory: '🧠 RAM Memory',
    rpBefore: 'Before', rpAfter: 'After',
    rpOptimizationScore: 'Optimization Score',
    scoreExcellent: 'Excellent!', scoreGood: 'Good', scoreFair: 'Fair', scoreMinimal: 'Minimal',
    // ── Upgrade modal ── (title "SmartClean Pro" intentionally not localized — brand+tier name)
    upgradeDefaultReason: 'Upgrade ke Pro untuk membuka semua fitur SmartClean tanpa batas.',
    upgradeReasonGeneric: 'Upgrade untuk membuka semua fitur tanpa batas.',
    upgradeBenefit1: '📥 Hapus file Download > 90 hari',
    upgradeBenefit2: '📲 Hapus file APK installer',
    upgradeBenefit3: '🎥 Hapus Screen Recording',
    upgradeBenefit4: '✈️ Telegram Cleaner — media & cache penuh',
    upgradeBuyLabel: 'Upgrade — Rp 49.999',
    upgradeRestore: 'Mode testing: kembali ke Free',
    cpLabel: '🧹 Membersihkan file…',
    toastProActivated: '🎉 Pro diaktifkan (mode testing lokal, belum lewat Google Play Billing).',
    toastBackToFree: 'Kembali ke mode Free (testing lokal).',
    // ── Back button / exit ──
    toastPressBackAgain: 'Tekan back lagi untuk keluar',
  },
  en: {
    // ── Splash / shell ──
    splashSub: 'Phone Cleaner & Optimizer',
    scanInfoText: 'Scan speed depends on your Internal Storage capacity and how much junk there is to scan.',
    adBannerPlaceholder: 'Ad Banner (Placeholder)',
    // ── Privacy Policy gate (first launch) ──
    privacyTitle: 'Privacy Policy',
    privacySub: 'Please read & agree before continuing',
    privacyWebLink: '🔗 Read the full version on the web',
    privacyCheckLabel: 'I have read and agree to the Privacy Policy above',
    privacyDecline: 'Decline & Exit',
    privacyAccept: 'Agree & Continue',
    privacyLoadError: 'The Privacy Policy could not be loaded right now. Please contact ads.dev26@gmail.com.',
    privacyMustAccept: 'You need to agree to the Privacy Policy to use this app.',
    // ── Nav ──
    navClean: 'Clean', navDefrag: 'Defrag', navBattery: 'Battery', navAdvanced: 'Advanced',
    // ── App language row (Advanced tab) ──
    appLanguageLabel: 'App Language',
    internalStorageLabel: 'Internal Storage', sdCardLabel: 'SD Card', ramMemoryLabel: 'RAM Memory',
    // ── Common ──
    selectAll: 'Select All',
    scanningEllipsis: '⏳ Scanning…',
    deleteSelected: '🗑 Delete Selected',
    tapMinSelect: 'Select at least 1 item',
    tapSelectFile: 'Select a file first',
    scanErrorPrefix: 'Scan error: ',
    deleteErrorPrefix: 'Delete error: ',
    integrityWarning: '⚠️ This device or install looks non-standard (root/emulator/debugger/signature mismatch detected).',
    proLockPro: '🔒 PRO',
    proLock1PerDay: '🔒 1 file/day',
    proLockPlain: '🔒',
    // ── Clean section ──
    cleanLabelDefault: 'Junk Found',
    cleanLabelScanning: 'Scanning…',
    btnScanJunkDefault: '🔍 Scan Junk',
    btnCleanNowDefault: '🧹 Clean Now',
    btnCleanNowBusy: '⏳ Cleaning…',
    modalNotifTitle: '🔔 Notification Access Not Enabled',
    modalNotifBody: 'SmartClean can\'t read notifications yet.\n\nTap OK to open Settings and enable "Notification Access" for SmartClean.',
    toastScanDone: 'Scan complete! Found {size} of junk.',
    modalConfirmCleanTitle: 'Confirm Clean',
    modalConfirmCleanBody: 'Delete {size} from: {names}?',
    detailTotalFilesCleaned: 'Total files cleaned',
    toastCleanFailedPrefix: 'Clean failed: ',
    dailyLimitClean: 'Clean Now on the Free tier is limited to 1x/day. Upgrade to Pro to clean without limits.',
    cleanItemTmpTitle: 'Temporary Files', cleanItemTmpSub: 'tmp · temp · thumbs',
    cleanItemMsgTitle: 'WA Database (.crypt14)', cleanItemMsgSub: 'Keeps the newest file',
    cleanItemJunkTitle: 'Junk & Ad Files', cleanItemJunkSub: 'ads · cache · residual',
    cleanItemNotifTitle: 'Notifications', cleanItemNotifSub: 'Clear leftover notifications',
    // ── Recently Deleted ──
    advTitleTrash: 'Recently Deleted',
    advSubTrash: 'Photos, videos & files in the system trash',
    systemTrash: 'System Trash',
    btnScanTrashDefault: 'Scan Recently Deleted',
    btnCleanTrashDefault: '🧹 Delete Permanently',
    toastTrashFound: 'Recently Deleted: {size}',
    trashEmpty: 'System trash is empty',
    trashSubWithItems: '{count} items in trash · {size}',
    dailyReasonTrashPro: 'Permanently deleting Recently Deleted items is a Pro feature.',
    modalTrashDeleteTitle: '🗑️ Delete Permanently',
    modalTrashDeleteBody: 'Permanently delete {size} from the system trash?\n\nFiles can\'t be recovered after this.',
    btnTrashDeleting: '⏳ Deleting…',
    detailTrashCleaned: 'Recently Deleted cleared',
    detailStorageFreed: 'Storage freed',
    detailStatus: 'Status',
    statusPermanentlyDeleted: 'Permanently deleted',
    toastTrashCleaned: '✅ Recently Deleted cleared successfully!',
    toastFailedPrefix: 'Failed: ',
    // ── Defrag section ──
    sdCardNotDetected: 'Not detected',
    storagePctUsedSuffix: '% used',
    ramUsedTotalSuffix: ' used / {total} total — {pct}%',
    btnDefragDefault: 'Defrag & Optimize Storage',
    btnDefragBusy: 'Optimizing…',
    btnBoostDefault: 'Boost Memory (RAM)',
    btnBoostBusy: 'Boosting…',
    dailyReasonDefrag: 'Defrag & Optimize Storage on the Free tier is limited to 1x/day. Upgrade to Pro for unlimited.',
    dailyReasonBoost: 'Boost Memory (RAM) on the Free tier is limited to 1x/day. Upgrade to Pro for unlimited.',
    logDefragStart: 'Starting internal storage defrag…',
    logDefragStep1: 'Scanning file table…',
    logDefragStep2: 'Optimizing block allocation…',
    logDefragStep3: 'Trimming SSD…',
    logDefragStep4: 'Cleaning orphaned entries…',
    logDefragStep2Demo: 'Optimizing inode structure…',
    logDefragStep3Demo: 'Trimming SSD blocks…',
    logDefragStep5Demo: 'Verifying integrity…',
    logDefragDone: '✅ Done! Freed: {size}',
    detailStorageTrimmed: 'Storage trimmed',
    detailBlocksLeft: 'Blocks remaining (internal)',
    statusOptimal: 'Optimal',
    toastStorageOptimized: '✅ Storage optimized successfully!',
    logDefragErrorPrefix: 'Error: ',
    toastDefragError: 'Defrag error',
    logKillingBg: 'Stopping background processes…',
    boostNoteSmall: '⚠️ Modern Android manages RAM automatically. A small result is normal.',
    boostNoteBig: '✅ {killed} processes stopped, {size} RAM freed.',
    detailRamFreed: 'RAM freed',
    detailAppsStopped: 'Apps stopped',
    detailRamAvailNow: 'RAM available now',
    detailNote: 'Note',
    noteRamAuto: 'Android manages RAM automatically',
    unitProcesses: ' processes',
    toastRamFreedBig: '✅ {size} RAM freed!',
    toastBoostOptimal: '✅ Boost complete (RAM already optimal)',
    toastBoostError: 'Boost error',
    // ── Battery section ──
    batteryChecking: 'Checking…',
    batteryCharging: '⚡ Charging',
    batteryNotCharging: '🔋 Not charging',
    subtitleBgApps: 'Background Apps',
    emptyBgAppsHint: 'Tap scan to find background apps',
    subtitleInternalMemory: 'Internal Memory',
    labelTotalRam: 'Total RAM', labelUsedRam: 'Used RAM', labelFreeRam: 'Free RAM', labelAppCacheTotal: 'App Cache Total',
    btnScanAppsDefault: '🔍 Scan Apps',
    btnKillAllDefault: '⚡ Kill All',
    emptyNoBgApps: 'No background apps',
    toastFoundActiveApps: 'Found {count} recently active apps ({size})',
    toastScanFirst: 'Scan first!',
    modalKillBgTitle: 'Kill Background Apps',
    modalKillBgBody: 'Stop {count} background apps ({size} RAM)?',
    allBgAppsStoppedMsg: '✅ All background apps stopped',
    detailBatteryImpact: 'Battery impact',
    batteryImpactValue: '+~15% lifetime',
    toastAppsKilled: '✅ {count} apps stopped, {size} RAM freed!',
    toastKillErrorPrefix: 'Kill error: ',
    // ── Advanced — groups ──
    groupSocialMedia: 'Social Media Cleaner',
    groupDeepCleaner: 'Deep Cleaner',
    // ── WhatsApp Cleaner ──
    advTitleWA: 'WhatsApp Cleaner',
    advSubWA: 'WhatsApp & WhatsApp Business',
    tabVideo: 'Video', tabPhoto: 'Photo', tabDocument: 'Document', tabAudio: 'Audio', tabScreenshot: 'Screenshot',
    filterKeep: 'Keep',
    filter3Months: 'Last 3 Months', filter6Months: 'Last 6 Months', filter1MonthPro: 'Last 1 Month (🔒 Pro)', filter1Month: 'Last 1 Month',
    btnScanWADefault: '🔍 Scan WhatsApp',
    dailyReasonWADocAudio: 'WhatsApp Cleaner for Documents & Audio is a Pro feature. Free is Video & Photo only.',
    emptyNoOldFiles: 'No old files',
    subOldFilesCount: '{count} old files · {size}',
    toastWAFound: 'Found {count} old files · {kept} files kept',
    toastWAScanErrorPrefix: 'WA scan error: ',
    modalDeleteWATitle: 'Delete WA Files',
    modalDeleteWABody: 'Delete {count} WhatsApp files ({size})?',
    detailFilesDeleted: 'Files deleted',
    detailSource: 'Source',
    sourceWAMedia: 'WhatsApp Media',
    toastWADeleted: '✅ {size} of WhatsApp media deleted!',
    // ── Telegram Cleaner ──
    advTitleTelegram: 'Telegram Cleaner',
    advSubTelegram: 'Telegram media & cache',
    btnScanTgDefault: '🔍 Scan Telegram',
    dailyReasonTelegramPro: 'Telegram Cleaner is a Pro feature.',
    toastTgFound: 'Found {count} old files',
    toastTgScanErrorPrefix: 'Telegram scan error: ',
    modalDeleteTgTitle: 'Delete Telegram Files',
    modalDeleteTgBody: 'Delete {count} Telegram files ({size})?',
    sourceTelegramMedia: 'Telegram Media',
    toastTgDeleted: '✅ {size} of Telegram media deleted!',
    // ── Camera / Gallery Cleaner ──
    advTitleCamera: 'Camera & Gallery Cleaner',
    advSubCamera: 'Old photos & videos',
    dailyReasonCameraPro: 'Camera & Gallery Cleaner is a Pro feature.',
    dailyReasonUnusedPro: 'Unused App Cleaner is a Pro feature.',
    btnScanCamDefault: '🔍 Scan Camera Roll',
    toastCamFound: '{count} old files found',
    modalDeleteCamTitle: 'Delete Camera Files',
    modalDeleteCamBody: 'Delete {count} files ({size})?',
    detailCamDeleted: 'Camera files deleted',
    detailOlderThan: 'Older than',
    monthsAgoSuffix: ' months ago',
    toastCamDeleted: '✅ {size} of old photos/videos deleted!',
    // ── Duplicate Finder ──
    advTitleDup: 'Duplicate Finder',
    advSubDup: 'Find & delete duplicates',
    dupScopeAll: 'All Storage', dupScopePhotos: 'Photos Only', dupScopeVideos: 'Videos Only',
    btnScanDupDefault: '🔍 Scan Duplicates',
    dupHashing: 'Hashing files…',
    dupCollecting: 'Collecting files ({pct}%)…',
    dupHashingPct: 'Computing MD5 hash ({pct}%)…',
    dupComparing: 'Comparing ({pct}%)…',
    emptyNoDuplicates: 'No duplicates found',
    toastDupFound: '{count} duplicate groups · ~{size} can be freed',
    subDupGroupsFound: '{count} duplicate groups found',
    unitFilesIdentical: ' identical files',
    dupLockedGroups: '🔒 {count} more duplicate groups',
    dailyReasonDupHidden: 'Viewing & deleting all duplicate groups — not just the first {cap} — is a Pro feature.',
    labelPro: 'Pro',
    btnAutoSelectDefault: 'Auto Select',
    toastAutoSelected: '{count} files auto-selected · {size}',
    btnDeleteDuplicatesDefault: '🗑 Delete Duplicates',
    modalDeleteDupTitle: 'Delete Duplicates',
    modalDeleteDupBody: 'Delete {count} duplicate files ({size})?',
    detailDupDeleted: 'Duplicates deleted',
    detailOriginalFiles: 'Original files',
    statusIntact: 'Intact (kept)',
    toastDupDeleted: '✅ {size} of duplicates deleted!',
    // ── Big File Cleaner ──
    advTitleBigFile: 'Big File Cleaner',
    advSubBigFile: 'Files > 100MB',
    btnScanBigFileDefault: '🔍 Scan Big Files',
    dailyReasonBigFile: 'The Free tier can delete 1 big file per day. Upgrade to Pro to delete them all at once, unlimited.',
    emptyNoBigFiles: 'No files > 100MB',
    subFilesCountSize: '{count} files · {size}',
    toastFoundItemsSize: 'Found {count} items · {size}',
    modalDeleteBigFileTitle: 'Delete Big Files',
    modalDeleteBigFileBody: 'Delete {count} files ({size})?',
    detailBigFileDeleted: 'Big files deleted',
    toastBigFileDeleted: '✅ {size} of big files deleted!',
    // ── APK Installer Cleaner ──
    advTitleApk: 'APK Installer Cleaner',
    advSubApk: 'Installer files (.apk)',
    btnScanApkDefault: '🔍 Scan APK Files',
    dailyReasonApkPro: 'Deleting APK installer files is a Pro feature. Scanning stays free.',
    emptyNoApk: 'No APK files found',
    subApkCountSize: '{count} APKs · {size}',
    modalDeleteApkTitle: 'Delete APK Files',
    modalDeleteApkBody: 'Delete {count} APK installer files ({size})?',
    detailApkDeleted: 'APKs deleted',
    toastApkDeleted: '✅ {size} of APK files deleted!',
    // ── Empty Folder Cleanup ──
    advTitleEmptyFolder: 'Empty Folder Cleanup',
    advSubEmptyFolder: 'Empty folders',
    btnScanEmptyFolderDefault: '🔍 Scan Empty Folders',
    emptyNoEmptyFolders: 'No empty folders',
    subEmptyFolderCount: '{count} empty folders',
    modalDeleteEmptyFolderTitle: 'Delete Empty Folders',
    modalDeleteEmptyFolderBody: 'Delete {count} empty folders?',
    detailEmptyFolderDeleted: 'Empty folders deleted',
    statusNeater: 'Neater',
    toastEmptyFolderDeleted: '✅ {count} empty folders deleted!',
    // ── Download Folder Cleanup ──
    advTitleDownload: 'Download Folder Cleanup',
    advSubDownload: 'Files > 90 days',
    downloadDesc: 'Scan files in the Download folder older than 90 days.',
    btnScanDownloadDefault: '🔍 Scan Downloads',
    dailyReasonDownload: 'The Free tier can delete 1 Download file per day. Upgrade to Pro to delete them all at once, unlimited.',
    emptyNoDownloadOld: 'No old files in the Download folder',
    modalDeleteDownloadTitle: 'Delete Old Download Files',
    modalDeleteDownloadBody: 'Delete {count} Download files older than 90 days ({size})?',
    detailDownloadDeleted: 'Download files deleted',
    toastDownloadDeleted: '✅ {size} of old Download files deleted!',
    // ── Screen Recording Cleanup ──
    advTitleScreenRec: 'Screen Recording Cleanup',
    advSubScreenRec: 'Screen recordings',
    btnScanScreenRecDefault: '🔍 Scan Screen Recordings',
    dailyReasonScreenRecPro: 'Deleting Screen Recordings is a Pro feature. Scanning stays free.',
    emptyNoScreenRec: 'No screen recordings found',
    subScreenRecCountSize: '{count} recordings · {size}',
    modalDeleteScreenRecTitle: 'Delete Screen Recordings',
    modalDeleteScreenRecBody: 'Delete {count} screen recordings ({size})?',
    detailScreenRecDeleted: 'Recordings deleted',
    toastScreenRecDeleted: '✅ {size} of screen recordings deleted!',
    // ── Unused App Cleaner ──
    advTitleUnused: 'Unused App Cleaner',
    advSubUnused: 'Apps unused > 6 months',
    btnScanUnusedDefault: '🔍 Scan Rarely-Used Apps',
    neverUsed: 'Never used',
    daysAgoSuffix: ' days ago',
    monthsAgoSuffixShort: ' months ago',
    yearsAgoSuffix: ' years ago',
    toastUnusedFound: 'Found {count} rarely-used apps',
    toastAllAppsUsed: 'All apps are still actively used',
    emptyAllAppsActive: 'All apps are still actively used 👍',
    subAppsCountSize: '{count} apps · {size}',
    btnUninstallSelectedDefault: '🗑 Uninstall Selected',
    toastSelectMinApp: 'Select at least 1 app',
    modalUninstallTitle: 'Uninstall Apps',
    modalUninstallBody: 'Uninstall {count} apps: {names}?\n\nAndroid will ask for separate confirmation for each app.',
    toastUninstallResult: '{done}/{total} apps uninstalled successfully',
    toastUninstallErrorPrefix: 'Uninstall error: ',
    // ── Remove Ads ──
    advTitleAds: 'Remove Ads',
    advSubAds: 'Block ads across all apps & browsers',
    adsDesc: 'Turn on Android\'s built-in <b>Private DNS</b> and point it to an ad-blocking DNS. This blocks most ads (banners, popups, video ads) across all apps &amp; browsers at once at the network level &mdash; no root, no extra VPN app.',
    adsDnsLabel: 'Ad-blocking DNS hostname',
    btnCopy: 'Copy',
    adsStep1: 'Tap <b>Open Network Settings</b> below',
    adsStep2: 'Go to <b>Network &amp; Internet → Private DNS</b> (menu name may differ slightly by phone brand)',
    adsStep3: 'Choose <b>Private DNS provider hostname</b>, paste the hostname above, then Save',
    btnOpenNetworkSettings: '⚙️ Open Network Settings',
    adsNoteTitle: '⚠️ If internet stops working after Save',
    adsNoteBody: 'Some WiFi networks (office, campus, public WiFi) block the specific port Private DNS uses, so Android refuses all connections until the setting is changed back. The DNS hostname isn\'t wrong — that network just doesn\'t support this feature. How to fix it:',
    adsNoteStep1: 'Open <b>Network &amp; Internet → Private DNS</b> again',
    adsNoteStep2: 'Choose <b>Automatic</b> (not Off) while on that network &mdash; this mode automatically falls back to regular DNS when the ad-blocking DNS isn\'t supported, so internet keeps working (ad-block is temporarily off on that network)',
    adsNoteStep3: 'Switch back to <b>Private DNS provider hostname</b> once you\'re back on a home WiFi or mobile network that supports it',
    toastDnsCopied: 'DNS hostname copied',
    toastCopyFailedPrefix: 'Copy failed: ',
    toastOpenSettingsManualNetwork: 'Open Settings > Network & Internet > Private DNS manually',
    toastOpenSettingsFailedPrefix: 'Could not open settings: ',
    // ── System Cache Cleaner ──
    advTitleSysCache: 'Clear All App Cache',
    advSubSysCache: 'Via the built-in system cleaner',
    sysCacheDesc: 'Android doesn\'t let third-party apps (SmartClean included) directly clear other apps\' internal cache. The only official, safe way to clear every app\'s cache at once is via your phone\'s built-in system cleaner.',
    btnOpenBuiltinCleaner: '🧹 Open Built-in System Cleaner',
    toastOpenSettingsManualStorage: 'Open Settings → Storage or Phone Manager manually',
    toastOpenStorageSettingsFailedPrefix: 'Could not open Storage Settings: ',
    // ── Modal generic ──
    modalOk: 'OK', modalUnderstood: 'Got it', modalCancel: 'Cancel',
    // ── Storage mismatch info ──
    storageMismatchTitle: 'ℹ️ Why Can Storage Numbers Differ?',
    storageMismatchBody: 'SmartClean\'s numbers come straight from Android\'s system (the real capacity of the storage partition), not from the phone\'s box.\n\n• A "256GB" box capacity is always bigger than the real usable capacity (decimal vs. binary counting + system space) — this is normal on every Android phone, not just SmartClean.\n\n• Your phone\'s built-in cleaner app (System Clean/Phone Manager) sometimes counts other partitions (system/vendor) that nobody can ever clean, so its number can look bigger than SmartClean\'s.\n\nFor the most accurate check, compare with Android\'s own Settings → Storage — it\'s usually closer to SmartClean\'s number.',
    // ── Before/After Result Panel ──
    rpTitle: '📊 Before & After',
    rpFreedTotal: 'Total Freed',
    rpLockedTeaser: '🔒 Before/After detail & Optimization Score are available in <b>Pro</b>',
    dailyReasonBeforeAfterPro: 'Before/After detail — storage & RAM charts, Optimization Score — is a Pro feature.',
    rpInternalStorage: '💾 Internal Storage',
    rpRamMemory: '🧠 RAM Memory',
    rpBefore: 'Before', rpAfter: 'After',
    rpOptimizationScore: 'Optimization Score',
    scoreExcellent: 'Excellent!', scoreGood: 'Good', scoreFair: 'Fair', scoreMinimal: 'Minimal',
    // ── Upgrade modal ── (title "SmartClean Pro" intentionally not localized — brand+tier name)
    upgradeDefaultReason: 'Upgrade to Pro to unlock every SmartClean feature, unlimited.',
    upgradeReasonGeneric: 'Upgrade to unlock every feature, unlimited.',
    upgradeBenefit1: '📥 Delete Download files > 90 days',
    upgradeBenefit2: '📲 Delete APK installer files',
    upgradeBenefit3: '🎥 Delete Screen Recordings',
    upgradeBenefit4: '✈️ Telegram Cleaner — full media & cache',
    upgradeBuyLabel: 'Upgrade — Rp 49.999',
    upgradeRestore: 'Testing mode: back to Free',
    cpLabel: '🧹 Cleaning files…',
    toastProActivated: '🎉 Pro activated (local testing mode, not via Google Play Billing yet).',
    toastBackToFree: 'Back to Free mode (local testing).',
    // ── Back button / exit ──
    toastPressBackAgain: 'Press back again to exit',
  },
};

function t(key, vars) {
  let str = (I18N[currentLang] && I18N[currentLang][key]) || I18N.id[key] || key;
  if (vars) Object.keys(vars).forEach(k => { str = str.split('{' + k + '}').join(vars[k]); });
  return str;
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = t(key);
    else el.textContent = t(key);
  });
  document.documentElement.lang = currentLang;
}
// Applied immediately (not deferred into init()) so the splash screen and the Privacy
// Policy gate — both visible before init()'s 2.5s timeout ever fires — show the right
// language from the very first frame instead of flashing the default momentarily.
applyStaticI18n();

function setLang(lang) {
  currentLang = (lang === 'en') ? 'en' : 'id';
  localStorage.setItem(LANG_CACHE_KEY, currentLang);
  applyStaticI18n();
  const btn = document.getElementById('btnLangToggle');
  if (btn) btn.textContent = currentLang === 'id' ? 'EN' : 'ID'; // shows the language you'd switch TO
  // Advanced-tab language row (second entry point — see DEVELOP.md) mirrors the same state.
  const idOpt = document.getElementById('langOptId');
  const enOpt = document.getElementById('langOptEn');
  if (idOpt) idOpt.classList.toggle('active', currentLang === 'id');
  if (enOpt) enOpt.classList.toggle('active', currentLang === 'en');
}
window.toggleLang = function() { setLang(currentLang === 'id' ? 'en' : 'id'); };

// ── Demo state (simulated values for browser preview) ──
const demo = {
  storageUsed:  42 * 1024 * 1024 * 1024,    // 42 GB
  storageTotal: 256 * 1024 * 1024 * 1024,   // 256 GB
  ramUsed:    3.8 * 1024 * 1024 * 1024,     // 3.8 GB
  ramTotal:     6 * 1024 * 1024 * 1024,     // 6 GB
};

// ════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════
function fmt(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}
function toast(msg, type = '', dur = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.add('hiding'); setTimeout(() => el.classList.add('hidden'), 300); }, dur);
}
function showModal(title, body, onOk) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').textContent  = body;
  document.getElementById('modal').classList.remove('hidden');
  const cancelBtn = document.getElementById('modalCancel');
  cancelBtn.style.display = onOk ? '' : 'none';
  document.getElementById('modalOk').textContent = onOk ? t('modalOk') : t('modalUnderstood');
  document.getElementById('modalOk').onclick = () => {
    document.getElementById('modal').classList.add('hidden');
    cancelBtn.style.display = '';
    document.getElementById('modalOk').textContent = t('modalOk');
    if (onOk) onOk();
  };
  cancelBtn.onclick = () => {
    document.getElementById('modal').classList.add('hidden');
  };
}
// Explains a common source of user confusion: SmartClean reads the real /data partition
// via Android's own statvfs-based API, which almost never matches a phone box's marketing
// capacity (e.g. "256GB") or an OEM cleaner widget's own number — both gaps are normal,
// not a SmartClean bug, so this heads off "kenapa beda sama HP saya?" support complaints.
window.showStorageMismatchInfo = function() {
  showModal(t('storageMismatchTitle'), t('storageMismatchBody'));
};

function setRingProgress(arcEl, pct) {
  const offset = 427 - (427 * Math.min(pct, 1));
  arcEl.style.strokeDashoffset = offset;
}

// ════════════════════════════════════════
//  STATS CAPTURE  (for Before/After)
// ════════════════════════════════════════
async function captureStats() {
  try {
    if (MemoryBooster) {
      const [s, m] = await Promise.all([
        MemoryBooster.getStorageStats(),
        MemoryBooster.getMemoryStats()
      ]);
      const stTotal = s.internalTotal > 0 ? s.internalTotal : demo.storageTotal;
      const stUsed  = s.internalTotal > 0 ? s.internalUsed  : demo.storageUsed;
      const rmTotal = m.total > 0 ? m.total : demo.ramTotal;
      const rmUsed  = m.total > 0 ? m.used  : demo.ramUsed;
      return {
        storage: { used: stUsed, total: stTotal,
                   pct: Math.round(stUsed / stTotal * 100) },
        ram:     { used: rmUsed, total: rmTotal,
                   pct: Math.round(rmUsed / rmTotal * 100) }
      };
    }
    // Demo mode
    return {
      storage: { used: demo.storageUsed, total: demo.storageTotal,
                 pct: Math.round(demo.storageUsed / demo.storageTotal * 100) },
      ram:     { used: demo.ramUsed, total: demo.ramTotal,
                 pct: Math.round(demo.ramUsed / demo.ramTotal * 100) }
    };
  } catch(e) {
    // Plugin failed — return demo values (not zeros) so Before/After is still meaningful
    return {
      storage: { used: demo.storageUsed, total: demo.storageTotal,
                 pct: Math.round(demo.storageUsed / demo.storageTotal * 100) },
      ram:     { used: demo.ramUsed, total: demo.ramTotal,
                 pct: Math.round(demo.ramUsed / demo.ramTotal * 100) }
    };
  }
}

// Compute "after" state from "before" by subtracting freed bytes.
// Using math instead of re-reading the plugin prevents the result from
// resetting on repeated cleans when the OS replenishes cache quickly.
function computeAfter(before, storageFreed = 0, ramFreed = 0) {
  const stUsed = Math.max(0, before.storage.used - storageFreed);
  const rmUsed = Math.max(0, before.ram.used - ramFreed);
  return {
    storage: { used: stUsed, total: before.storage.total,
               pct: Math.round(stUsed / before.storage.total * 100) },
    ram:     { used: rmUsed, total: before.ram.total,
               pct: Math.round(rmUsed / before.ram.total * 100) }
  };
}

// ════════════════════════════════════════
//  BEFORE / AFTER RESULT PANEL
// ════════════════════════════════════════
/**
 * @param {object} before  - { storage:{used,total,pct}, ram:{used,total,pct} }
 * @param {object} after   - same shape
 * @param {number} freed   - bytes freed (total)
 * @param {Array}  details - [{ icon, label, value }]
 */
function showResultPanel(before, after, freed, details) {
  const panel = document.getElementById('resultPanel');
  const body  = document.getElementById('resultBody');

  // Free tier: Before/After detail is a Pro feature — still surface the win
  // (bytes freed) as a motivating teaser, without the full stats breakdown.
  if (!isPro) {
    body.innerHTML = `
      <div class="rp-freed">
        <div class="rp-freed-num">${fmt(freed)}</div>
        <div class="rp-freed-sub">${t('rpFreedTotal')}</div>
      </div>
      <div class="rp-locked" onclick="closeResultPanel(); openUpgradeModal(t('dailyReasonBeforeAfterPro'));">
        ${t('rpLockedTeaser')}
      </div>
    `;
    panel.classList.remove('hidden');
    return;
  }

  const sB = before.storage, sA = after.storage;
  const rB = before.ram,     rA = after.ram;
  const sDiff = sB.pct - sA.pct;  // positive = improvement
  const rDiff = rB.pct - rA.pct;

  // Calculate optimization score (0-5 stars)
  const scoreRaw = Math.min(5, Math.round((sDiff + rDiff) / 4));
  const stars = '★'.repeat(Math.max(scoreRaw, 1)) + '☆'.repeat(5 - Math.max(scoreRaw, 1));
  const scoreText = scoreRaw >= 4 ? t('scoreExcellent') : scoreRaw >= 3 ? t('scoreGood') : scoreRaw >= 2 ? t('scoreFair') : t('scoreMinimal');

  body.innerHTML = `
    <div class="ba-section">
      <div class="ba-lbl">${t('rpInternalStorage')}</div>
      <div class="ba-row">
        <span class="ba-tag before">${t('rpBefore')}</span>
        <div class="ba-track"><div class="ba-fill-b" id="baSB" style="width:0%"></div></div>
        <span class="ba-pct">${sB.pct}%</span>
        <span class="ba-badge neutral">—</span>
      </div>
      <div class="ba-row">
        <span class="ba-tag after">${t('rpAfter')}</span>
        <div class="ba-track"><div class="ba-fill-a" id="baSA" style="width:0%"></div></div>
        <span class="ba-pct">${sA.pct}%
          ${sDiff > 0 ? `<span class="ba-arr">↓${sDiff}%</span>` : ''}
        </span>
        <span class="ba-badge${sDiff <= 0 ? ' neutral' : ''}">
          ${sDiff > 0 ? '↓ ' + fmt(sB.used - sA.used) : '—'}
        </span>
      </div>
    </div>

    <div class="ba-section">
      <div class="ba-lbl">${t('rpRamMemory')}</div>
      <div class="ba-row">
        <span class="ba-tag before">${t('rpBefore')}</span>
        <div class="ba-track"><div class="ba-fill-b" id="baRB" style="width:0%"></div></div>
        <span class="ba-pct">${rB.pct}%</span>
        <span class="ba-badge neutral">—</span>
      </div>
      <div class="ba-row">
        <span class="ba-tag after">${t('rpAfter')}</span>
        <div class="ba-track"><div class="ba-fill-a" id="baRA" style="width:0%"></div></div>
        <span class="ba-pct">${rA.pct}%
          ${rDiff > 0 ? `<span class="ba-arr">↓${rDiff}%</span>` : ''}
        </span>
        <span class="ba-badge${rDiff <= 0 ? ' neutral' : ''}">
          ${rDiff > 0 ? '↓ ' + fmt(rB.used - rA.used) : '—'}
        </span>
      </div>
    </div>

    <div class="rp-div"></div>

    <div class="rp-freed">
      <div class="rp-freed-num">${fmt(freed)}</div>
      <div class="rp-freed-sub">${t('rpFreedTotal')}</div>
    </div>

    <div class="rp-details">
      ${details.map(d => `
        <div class="rp-detail">
          <span class="rp-detail-ico">${d.icon}</span>
          <span class="rp-detail-txt">${d.label}</span>
          <span class="rp-detail-val">${d.value}</span>
        </div>`).join('')}
    </div>

    <div class="rp-score">
      <span class="rp-score-label">${t('rpOptimizationScore')}</span>
      <span class="rp-score-stars">${stars}</span>
      <span class="rp-score-text">${scoreText}</span>
    </div>
  `;

  panel.classList.remove('hidden');

  // Animate bars in after DOM settles
  requestAnimationFrame(() => {
    setTimeout(() => {
      const baSB = document.getElementById('baSB');
      const baSA = document.getElementById('baSA');
      const baRB = document.getElementById('baRB');
      const baRA = document.getElementById('baRA');
      if (baSB) baSB.style.width = sB.pct + '%';
      if (baSA) baSA.style.width = sA.pct + '%';
      if (baRB) baRB.style.width = rB.pct + '%';
      if (baRA) baRA.style.width = rA.pct + '%';
    }, 60);
  });
}

window.closeResultPanel = function() {
  document.getElementById('resultPanel').classList.add('hidden');
  resetClean();
};

function setScreenAwake(on) {
  if (AppManager) AppManager.setKeepScreenOn({ enabled: on }).catch(() => {});
}
function showOpProgress() { document.getElementById('opProgress').classList.remove('hidden'); setScreenAwake(true); }
function hideOpProgress() { document.getElementById('opProgress').classList.add('hidden'); setScreenAwake(false); }

function resetClean() {
  cleanSelected.clear();
  cleanData = {};
  document.getElementById('cleanList').innerHTML = '';
  document.getElementById('cleanSize').textContent = '0 MB';
  document.getElementById('cleanLabel').textContent = t('cleanLabelDefault');
  document.getElementById('cleanRingArc').style.strokeDashoffset = '427';
  document.getElementById('cleanActions').style.display = 'none';
}

// ════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sec = btn.dataset.sec;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('sec-' + sec).classList.add('active');
    document.getElementById('btnScanClean').style.display = sec === 'clean' ? 'flex' : 'none';
    closeResultPanel();
    if (sec === 'defrag')  initDefrag();
    if (sec === 'battery') initBattery();
  });
});

// ════════════════════════════════════════
//  CLEAN SECTION
// ════════════════════════════════════════
// "App Cache" / "Browser Cache" / "Game Cache" buckets were removed: Android's scoped
// storage (Android 11+) blocks any third-party app — SmartClean included, regardless of
// permissions granted — from reading or clearing OTHER apps' Android/data/<pkg>/cache.
// Those buckets only ever reported SmartClean's own trivial cache or a permanent 0, which
// looked like a working feature but never was. See the "Browser Cleaner" advance-menu
// card for the honest replacement (deep-links to the OS's own storage cleaner).
// title/sub are getters (not plain strings) so this stays correctly translated after a
// language switch without needing its own re-render hook — each access just re-reads
// the current t() value instead of a value captured once at module load time.
const CLEAN_ITEMS = [
  { id:'tmp',   icon:'🗂️',  get title(){ return t('cleanItemTmpTitle'); },   get sub(){ return t('cleanItemTmpSub'); },   type:'TMP' },
  { id:'msg',   icon:'💬',  get title(){ return t('cleanItemMsgTitle'); },   get sub(){ return t('cleanItemMsgSub'); },   type:'MSG' },
  { id:'junk',  icon:'🗑️',  get title(){ return t('cleanItemJunkTitle'); },  get sub(){ return t('cleanItemJunkSub'); },  type:'JUNK' },
  { id:'notif', icon:'🔔',  get title(){ return t('cleanItemNotifTitle'); }, get sub(){ return t('cleanItemNotifSub'); }, type:'NOTIF' },
];

let cleanData = {};
let cleanSelected = new Set();

function renderCleanList(results) {
  const list = document.getElementById('cleanList');
  list.innerHTML = '';
  let totalBytes = 0;

  CLEAN_ITEMS.forEach(item => {
    const bytes = results[item.id] || 0;
    totalBytes += bytes;
    const card = document.createElement('div');
    card.className = 'clean-card';
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="cc-icon">${item.icon}</div>
      <div class="cc-body">
        <div class="cc-title">${item.title}</div>
        <div class="cc-sub">${item.sub}</div>
      </div>
      <div class="cc-size">${fmt(bytes)}</div>
      <div class="cc-check"></div>`;
    card.addEventListener('click', () => toggleCleanCard(item.id, card));
    list.appendChild(card);
    cleanData[item.id] = bytes;
  });

  document.getElementById('cleanSize').textContent = fmt(totalBytes);
  setRingProgress(document.getElementById('cleanRingArc'), Math.min(totalBytes / (2 * 1024 * 1024 * 1024), 1));
  document.getElementById('cleanActions').style.display = totalBytes > 0 ? 'flex' : 'none';
}

function toggleCleanCard(id, card) {
  if (cleanSelected.has(id)) { cleanSelected.delete(id); card.classList.remove('selected'); }
  else                        { cleanSelected.add(id);   card.classList.add('selected'); }
}

async function scanClean() {
  const btn = document.getElementById('btnScanClean');
  btn.innerHTML = `<span>⏳</span> ${t('cleanLabelScanning')}`;
  btn.disabled = true;
  cleanSelected.clear();
  setScreenAwake(true);
  document.getElementById('cleanRing').classList.add('ring-scanning');
  document.getElementById('cleanLabel').textContent = t('cleanLabelScanning');
  const scanInfoEl = document.querySelector('.scan-info-text');
  if (scanInfoEl) scanInfoEl.classList.add('si-active');
  scanProgressActive = true;
  updateScanRingProgress(0);

  let demoTicker = null;
  try {
    let results = {};
    if (FileCleaner) {
      const res = await FileCleaner.scanJunkFiles();
      results = res.data || {};
      if (!results.notifAccessGranted) {
        setTimeout(() => showModal(
          t('modalNotifTitle'),
          t('modalNotifBody'),
          async () => { try { await FileCleaner.requestNotificationAccess(); } catch(e) {} }
        ), 500);
      }
    } else {
      // No native plugin (browser preview) — simulate a running percentage so the ring is testable.
      let pct = 0;
      demoTicker = setInterval(() => { pct = Math.min(96, pct + 6); updateScanRingProgress(pct); }, 110);
      results = { tmp:45*1024*1024, msg:12*1024*1024, junk:88*1024*1024,
                  appcache:230*1024*1024, browser:67*1024*1024, notif:1024*1024, game:155*1024*1024,
                  notifAccessGranted: true };
      await new Promise(r => setTimeout(r, 1800));
    }
    updateScanRingProgress(100);
    renderCleanList(results);
    const total = Object.values(results).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0);
    toast(t('toastScanDone', { size: fmt(total) }));
  } catch(e) {
    toast(t('scanErrorPrefix') + e.message, 'error');
  } finally {
    if (demoTicker) clearInterval(demoTicker);
    scanProgressActive = false;
    btn.innerHTML = `<span>🔍</span> ${t('btnScanJunkDefault').replace(/^🔍\s*/, '')}`;
    btn.disabled = false;
    setScreenAwake(false);
    document.getElementById('cleanRing').classList.remove('ring-scanning');
    document.getElementById('cleanLabel').textContent = t('cleanLabelDefault');
    if (scanInfoEl) scanInfoEl.classList.remove('si-active');
  }
}

async function cleanNow() {
  if (cleanSelected.size === 0) { toast(t('tapMinSelect'), 'error'); return; }
  if (!checkDailyLimit('clean', t('dailyLimitClean'))) return;
  const types  = [...cleanSelected];
  const totalBytes = types.reduce((s, id) => s + (cleanData[id] || 0), 0);
  const itemNames  = types.map(id => { const it = CLEAN_ITEMS.find(i=>i.id===id); return (it && it.title) || id; }).join(', ');

  showModal(t('modalConfirmCleanTitle'), t('modalConfirmCleanBody', { size: fmt(totalBytes), names: itemNames }), async () => {
    const btn = document.getElementById('btnCleanNow');
    btn.disabled = true;
    btn.textContent = t('btnCleanNowBusy');
    setScreenAwake(true);
    cleanProgressActive = true;
    showCleanProgressPopup();

    let demoTicker = null;
    let succeeded = false;
    try {
      const before = await captureStats();

      if (FileCleaner) {
        await FileCleaner.cleanJunkFiles({ types });
      } else {
        // No native plugin (browser preview) — simulate a running percentage.
        let pct = 0;
        demoTicker = setInterval(() => { pct = Math.min(96, pct + 7); updateCleanProgressPopup(pct); }, 130);
        demo.storageUsed = Math.max(0, demo.storageUsed - totalBytes);
        await new Promise(r => setTimeout(r, 1500));
      }
      updateCleanProgressPopup(100);

      const after = computeAfter(before, totalBytes);
      await loadStorageInfo();

      const details = types.map(id => {
        const item = CLEAN_ITEMS.find(i => i.id === id);
        return { icon: (item && item.icon) || '✅', label: (item && item.title) || id, value: fmt(cleanData[id] || 0) };
      });
      details.push({ icon:'📁', label: t('detailTotalFilesCleaned'), value: fmt(totalBytes) });

      markDailyUsed('clean');
      showResultPanel(before, after, totalBytes, details);
      succeeded = true;
    } catch(e) {
      toast(t('toastCleanFailedPrefix') + e.message, 'error');
    } finally {
      if (demoTicker) clearInterval(demoTicker);
      cleanProgressActive = false;
      hideCleanProgressPopup();
      btn.disabled = false;
      btn.textContent = t('btnCleanNowDefault');
      // Keep the screen on a bit longer so the before/after result panel doesn't get cut
      // off by the OS's own screen timeout right as it appears.
      if (succeeded) setTimeout(() => setScreenAwake(false), 12000);
      else setScreenAwake(false);
    }
  });
}

// ════════════════════════════════════════
//  RECENTLY DELETED (Defrag page)
// ════════════════════════════════════════
let _trashBytes = 0;

async function scanTrash() {
  const btn = document.getElementById('btnScanTrash');
  btn.querySelector('span:last-child').textContent = t('scanningEllipsis');
  btn.disabled = true;
  closeResultPanel();
  try {
    if (FileCleaner) {
      const res = await FileCleaner.scanRecentlyDeleted();
      _trashBytes = res.sizeBytes || 0;
      const count = res.count || 0;
      document.getElementById('trashSize').textContent = fmt(_trashBytes);
      document.getElementById('trashSub').textContent  =
        _trashBytes > 0
          ? t('trashSubWithItems', { count, size: fmt(_trashBytes) })
          : t('trashEmpty');
      document.getElementById('trashBtns').style.display = _trashBytes > 0 ? '' : 'none';
      toast(_trashBytes > 0 ? t('toastTrashFound', { size: fmt(_trashBytes) }) : t('trashEmpty'));
    } else {
      _trashBytes = 320 * 1024 * 1024;
      document.getElementById('trashSize').textContent = fmt(_trashBytes);
      document.getElementById('trashSub').textContent  = t('trashSubWithItems', { count: 47, size: fmt(_trashBytes) });
      document.getElementById('trashBtns').style.display = '';
    }
  } catch(e) {
    toast(t('scanErrorPrefix') + e.message, 'error');
  } finally {
    btn.querySelector('span:last-child').textContent = t('btnScanTrashDefault');
    btn.disabled = false;
  }
}

async function cleanTrash() {
  if (!requirePro(t('dailyReasonTrashPro'))) return;
  showModal(
    t('modalTrashDeleteTitle'),
    t('modalTrashDeleteBody', { size: fmt(_trashBytes) }),
    async () => {
      const btn = document.getElementById('btnCleanTrash');
      // Update only the label span, not the whole button — it has a nested .pro-lock
      // badge span that btn.textContent would silently and permanently wipe out.
      const btnLabel = btn.querySelector('span:first-child') || btn;
      btn.disabled = true;
      btnLabel.textContent = t('btnTrashDeleting');
      showOpProgress();
      try {
        const before = await captureStats();
        let freed = _trashBytes;
        if (FileCleaner) {
          const res = await FileCleaner.cleanRecentlyDeleted();
          freed = res.freedBytes || _trashBytes;
        } else {
          demo.storageUsed = Math.max(0, demo.storageUsed - _trashBytes);
          await new Promise(r => setTimeout(r, 1000));
        }
        _trashBytes = 0;
        document.getElementById('trashSize').textContent = '0 B';
        document.getElementById('trashSub').textContent  = t('trashEmpty');
        document.getElementById('trashBtns').style.display = 'none';
        const after = computeAfter(before, freed);
        await loadStorageInfo();
        showResultPanel(before, after, freed, [
          { icon:'🗑️', label: t('detailTrashCleaned'), value: fmt(freed) },
          { icon:'💾', label: t('detailStorageFreed'), value: fmt(freed) },
          { icon:'✅', label: t('detailStatus'),        value: t('statusPermanentlyDeleted') },
        ]);
        toast(t('toastTrashCleaned'));
      } catch(e) {
        toast(t('toastFailedPrefix') + e.message, 'error');
      } finally {
        hideOpProgress();
        btn.disabled = false;
        btnLabel.textContent = t('btnCleanTrashDefault');
      }
    }
  );
}

document.getElementById('btnScanTrash').addEventListener('click', scanTrash);
document.getElementById('btnCleanTrash').addEventListener('click', cleanTrash);

document.getElementById('btnScanClean').addEventListener('click', scanClean);
document.getElementById('btnCleanNow').addEventListener('click', cleanNow);
document.getElementById('btnSelectAllClean').addEventListener('click', () => {
  const allSel = cleanSelected.size === CLEAN_ITEMS.length;
  if (allSel) {
    cleanSelected.clear();
    document.querySelectorAll('.clean-card').forEach(c => c.classList.remove('selected'));
  } else {
    CLEAN_ITEMS.forEach(i => cleanSelected.add(i.id));
    document.querySelectorAll('.clean-card').forEach(c => c.classList.add('selected'));
  }
});

// ════════════════════════════════════════
//  DEFRAG SECTION
// ════════════════════════════════════════
let defragInit = false;

async function initDefrag() {
  if (defragInit) return;
  defragInit = true;
  try {
    let s = { internalUsed: demo.storageUsed, internalTotal: demo.storageTotal,
               sdUsed:0, sdTotal:0, ramUsed: demo.ramUsed, ramTotal: demo.ramTotal };
    if (MemoryBooster) s = await MemoryBooster.getStorageStats();

    const iPct = Math.round(s.internalUsed / s.internalTotal * 100);
    document.getElementById('internalBar').style.width  = iPct + '%';
    document.getElementById('internalInfo').textContent =
      `${fmt(s.internalUsed)} / ${fmt(s.internalTotal)} — ${iPct}${t('storagePctUsedSuffix')}`;

    if (s.sdTotal > 0) {
      const sPct = Math.round(s.sdUsed / s.sdTotal * 100);
      document.getElementById('sdBar').style.width  = sPct + '%';
      document.getElementById('sdInfo').textContent = `${fmt(s.sdUsed)} / ${fmt(s.sdTotal)} — ${sPct}%`;
    } else {
      document.getElementById('sdInfo').textContent = t('sdCardNotDetected');
    }
    const rPct = Math.round(s.ramUsed / s.ramTotal * 100);
    document.getElementById('ramBar').style.width  = rPct + '%';
    document.getElementById('ramInfo').textContent = fmt(s.ramUsed) + t('ramUsedTotalSuffix', { total: fmt(s.ramTotal), pct: rPct });
  } catch(e) { console.error('initDefrag', e); }
}

function logDefrag(msg, ok = false) {
  const log = document.getElementById('defragLog');
  log.style.display = 'block';
  const line = document.createElement('div');
  line.className = 'log-line' + (ok ? ' log-ok' : '');
  line.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

document.getElementById('btnDefrag').addEventListener('click', async () => {
  if (!checkDailyLimit('defrag', t('dailyReasonDefrag'))) return;
  const btn = document.getElementById('btnDefrag');
  btn.classList.add('active-op');
  btn.querySelector('span:last-child').textContent = t('btnDefragBusy');
  document.getElementById('defragLog').innerHTML = '';
  closeResultPanel();
  showOpProgress();

  logDefrag(t('logDefragStart'));

  const before = await captureStats();
  let freed = 0;

  try {
    if (MemoryBooster) {
      const steps = [t('logDefragStep1'), t('logDefragStep2'), t('logDefragStep3'), t('logDefragStep4')];
      for (const s of steps) { logDefrag(s); await new Promise(r => setTimeout(r, 300)); }
      const res = await MemoryBooster.optimizeStorage();
      freed = res.trimmedBytes || 0;
    } else {
      const steps = [t('logDefragStep1'), t('logDefragStep2Demo'), t('logDefragStep3Demo'), t('logDefragStep4'), t('logDefragStep5Demo')];
      for (const s of steps) { logDefrag(s); await new Promise(r => setTimeout(r, 600)); }
      freed = Math.round(Math.random() * 200 + 80) * 1024 * 1024; // 80–280 MB
      demo.storageUsed = Math.max(0, demo.storageUsed - freed);
    }
    logDefrag(t('logDefragDone', { size: fmt(freed) }), true);

    // ── AFTER ──
    defragInit = false;
    await initDefrag();
    const after = computeAfter(before, freed);

    markDailyUsed('defrag');
    showResultPanel(before, after, freed, [
      { icon:'⚡', label: t('detailStorageTrimmed'), value: fmt(freed) },
      { icon:'💾', label: t('detailBlocksLeft'),     value: fmt(after.storage.total - after.storage.used) },
      { icon:'✅', label: t('detailStatus'),         value: t('statusOptimal') },
    ]);
    toast(t('toastStorageOptimized'));
  } catch(e) {
    logDefrag(t('logDefragErrorPrefix') + e.message);
    toast(t('toastDefragError'), 'error');
  } finally {
    hideOpProgress();
    btn.classList.remove('active-op');
    btn.querySelector('span:last-child').textContent = t('btnDefragDefault');
  }
});

document.getElementById('btnBoost').addEventListener('click', async () => {
  if (!checkDailyLimit('boost', t('dailyReasonBoost'))) return;
  const btn = document.getElementById('btnBoost');
  btn.querySelector('span:last-child').textContent = t('btnBoostBusy');
  btn.disabled = true;
  closeResultPanel();
  showOpProgress();
  logDefrag(t('logKillingBg'));

  const before = await captureStats();

  try {
    let freed = 0, killed = 0;
    if (MemoryBooster) {
      const res = await MemoryBooster.boostMemory();
      freed  = res.freedBytes  || 0;
      killed = res.killedApps  || 0;
    } else {
      await new Promise(r => setTimeout(r, 1200));
      freed  = Math.round((Math.random() * 800 + 400) * 1024 * 1024); // 400–1200 MB
      killed = Math.floor(Math.random() * 6 + 3);
      demo.ramUsed = Math.max(demo.ramTotal * 0.25, demo.ramUsed - freed);
    }
    const note = freed < 10 * 1024 * 1024
      ? t('boostNoteSmall')
      : t('boostNoteBig', { killed, size: fmt(freed) });
    logDefrag(note, freed >= 10 * 1024 * 1024);

    // ── AFTER ──
    defragInit = false;
    await initDefrag();
    const after = computeAfter(before, 0, freed);

    markDailyUsed('boost');
    showResultPanel(before, after, freed, [
      { icon:'🧠', label: t('detailRamFreed'),     value: fmt(freed) },
      { icon:'⚡', label: t('detailAppsStopped'),  value: killed + t('unitProcesses') },
      { icon:'💚', label: t('detailRamAvailNow'),  value: fmt(after.ram.total - after.ram.used) },
      { icon:'ℹ️', label: t('detailNote'),         value: t('noteRamAuto') },
    ]);
    toast(freed >= 10 * 1024 * 1024 ? t('toastRamFreedBig', { size: fmt(freed) }) : t('toastBoostOptimal'));
  } catch(e) {
    logDefrag(t('logDefragErrorPrefix') + e.message);
    toast(t('toastBoostError'), 'error');
  } finally {
    hideOpProgress();
    btn.querySelector('span:last-child').textContent = t('btnBoostDefault');
    btn.disabled = false;
  }
});

// ════════════════════════════════════════
//  BATTERY SECTION
// ════════════════════════════════════════
let batteryInit = false;
let bgApps = [];

async function initBattery() {
  if (batteryInit) return;
  batteryInit = true;
  try {
    let batt = { level:78, charging:false };
    if ('getBattery' in navigator) {
      const b = await navigator.getBattery();
      batt = { level: Math.round(b.level*100), charging: b.charging };
    } else if (MemoryBooster) {
      batt = await MemoryBooster.getBatteryInfo();
    }
    document.getElementById('batteryLevel').style.height = batt.level + '%';
    document.getElementById('batteryPct').textContent    = batt.level + '%';
    document.getElementById('batteryStatus').textContent = batt.charging ? t('batteryCharging') : t('batteryNotCharging');
    const lvl = document.getElementById('batteryLevel');
    if (batt.level > 50)      lvl.style.background = 'linear-gradient(0deg,#00c853,#00e676)';
    else if (batt.level > 20) lvl.style.background = 'linear-gradient(0deg,#ff9800,#ffca28)';
    else                      lvl.style.background = 'linear-gradient(0deg,#c62828,#ff5252)';
  } catch(e) { console.error('battery', e); }
  await loadMemInfo();
}

async function loadMemInfo() {
  try {
    let mem = { total:demo.ramTotal, used:demo.ramUsed, free:demo.ramTotal-demo.ramUsed, cacheTotal:450*1024*1024 };
    if (MemoryBooster) mem = await MemoryBooster.getMemoryStats();
    document.getElementById('memTotal').textContent  = fmt(mem.total);
    document.getElementById('memUsed').textContent   = fmt(mem.used);
    document.getElementById('memFree').textContent   = fmt(mem.free);
    document.getElementById('cacheTotal').textContent = fmt(mem.cacheTotal);
  } catch(e) {}
}

async function scanBatteryApps() {
  const btn = document.getElementById('btnScanBattery');
  btn.textContent = t('scanningEllipsis');
  btn.disabled = true;
  closeResultPanel();
  try {
    if (MemoryBooster) {
      const res = await MemoryBooster.getRunningApps();
      bgApps = res.apps || [];
    } else {
      bgApps = [
        { name:'YouTube',   pkg:'com.google.android.youtube',       memKb:245760, icon:'▶️' },
        { name:'Instagram', pkg:'com.instagram.android',            memKb:189440, icon:'📷' },
        { name:'Facebook',  pkg:'com.facebook.katana',              memKb:312320, icon:'📘' },
        { name:'Maps',      pkg:'com.google.android.apps.maps',     memKb:98304,  icon:'🗺️' },
        { name:'Chrome',    pkg:'com.android.chrome',               memKb:178176, icon:'🌐' },
        { name:'TikTok',    pkg:'com.zhiliaoapp.musically',         memKb:223000, icon:'🎵' },
      ];
      await new Promise(r => setTimeout(r, 800));
    }
    renderBgApps();
    const totalMem = bgApps.reduce((s,a) => s+(a.memKb||0)*1024, 0);
    toast(t('toastFoundActiveApps', { count: bgApps.length, size: fmt(totalMem) }));
  } catch(e) {
    toast(t('scanErrorPrefix') + e.message, 'error');
  } finally {
    btn.textContent = t('btnScanAppsDefault');
    btn.disabled = false;
  }
}

function renderBgApps() {
  const list = document.getElementById('bgAppList');
  if (!bgApps.length) { list.innerHTML = `<div class="empty-state">${t('emptyNoBgApps')}</div>`; return; }
  list.innerHTML = bgApps.map(app => `
    <div class="app-item">
      <div class="app-item-icon">${app.icon || '📱'}</div>
      <div class="app-item-name">${app.name}</div>
      <div class="app-item-mem">${fmt((app.memKb||0)*1024)}</div>
    </div>`).join('');
}

async function killAllApps() {
  if (!bgApps.length) { toast(t('toastScanFirst'), 'error'); return; }
  const totalMem = bgApps.reduce((s,a) => s+(a.memKb||0)*1024, 0);

  showModal(t('modalKillBgTitle'), t('modalKillBgBody', { count: bgApps.length, size: fmt(totalMem) }), async () => {
    // ── BEFORE ──
    const before = await captureStats();

    try {
      if (MemoryBooster) {
        await MemoryBooster.stopApps({ packages: bgApps.map(a => a.pkg) });
      } else {
        await new Promise(r => setTimeout(r, 1000));
        demo.ramUsed = Math.max(demo.ramTotal * 0.25, demo.ramUsed - totalMem);
      }

      const killed = bgApps.length;
      bgApps = [];
      document.getElementById('bgAppList').innerHTML = `<div class="empty-state">${t('allBgAppsStoppedMsg')}</div>`;
      batteryInit = false;
      await loadMemInfo();

      // ── AFTER ──
      const after = computeAfter(before, 0, totalMem);

      showResultPanel(before, after, totalMem, [
        { icon:'⚡', label: t('detailAppsStopped'),    value: killed + ' apps' },
        { icon:'🧠', label: t('detailRamFreed'),       value: fmt(totalMem) },
        { icon:'💚', label: t('detailRamAvailNow'),    value: fmt(after.ram.total - after.ram.used) },
        { icon:'🔋', label: t('detailBatteryImpact'),  value: t('batteryImpactValue') },
      ]);
      toast(t('toastAppsKilled', { count: killed, size: fmt(totalMem) }));
    } catch(e) {
      toast(t('toastKillErrorPrefix') + e.message, 'error');
    }
  });
}

document.getElementById('btnScanBattery').addEventListener('click', scanBatteryApps);
document.getElementById('btnKillApps').addEventListener('click', killAllApps);

// ════════════════════════════════════════
//  ADVANCED — helper
// ════════════════════════════════════════
// Entire card is Pro-only — absent from the Free feature table in DEVELOP.md.
// Remove Ads (Private DNS) stays free for everyone — it's a network-level shortcut, not
// a maintained SmartClean feature, so gating it behind Pro buys nothing.
// Values are FUNCTIONS (like the initFlatFileCleaner cfg reason fields) so a language
// switch is reflected even though this object is only built once at module load time.
const PRO_LOCKED_CARDS = {
  telegram: () => t('dailyReasonTelegramPro'),
  camera:   () => t('dailyReasonCameraPro'),
  unused:   () => t('dailyReasonUnusedPro'),
};

window.toggleAdv = function(key) {
  const body = document.getElementById(key + 'Body');
  const chev = document.getElementById('chev' + key.charAt(0).toUpperCase() + key.slice(1));
  const open = body.classList.contains('hidden');
  if (open && PRO_LOCKED_CARDS[key] && !requirePro(PRO_LOCKED_CARDS[key]())) return;
  body.classList.toggle('hidden');
  if (chev) chev.classList.toggle('open', open);
};

// ── Media file-list rendering (shared: WhatsApp Cleaner + Camera/Gallery Cleaner) ──
// Native-Android-gallery-style rows: real photo/video thumbnails (lazy-loaded via
// IntersectionObserver so a long list doesn't decode every file at once), file-type
// icons for Dokumen/Audio, and a WA/WA Business source badge where applicable.
const FI_TYPE_ICON  = { video:'🎬', image:'🖼️', screenshot:'📸', document:'📄', audio:'🎵', apk:'📲', folder:'📁' };
const FI_DOC_ICON   = { pdf:'📕', doc:'📘', docx:'📘', xls:'📗', xlsx:'📗', ppt:'📙', pptx:'📙', txt:'📄' };
const FI_AUDIO_ICON = { mp3:'🎵', opus:'🎵', ogg:'🎵', aac:'🎵', m4a:'🎵' };
const FI_SOURCE_LABEL = { whatsapp: 'WhatsApp', whatsapp_business: 'WA Business', telegram: 'Telegram' };

// Best-effort type guess from extension — used by scanners that mix file types
// (Download folder, Big File Cleaner) so the shared file-list renderer below still
// picks a sensible thumbnail/icon per row.
const EXT_TYPE_MAP = {
  jpg:'image', jpeg:'image', png:'image', webp:'image', heic:'image', bmp:'image', gif:'image',
  mp4:'video', mkv:'video', avi:'video', '3gp':'video', mov:'video', webm:'video',
  pdf:'document', doc:'document', docx:'document', xls:'document', xlsx:'document', ppt:'document', pptx:'document', txt:'document',
  mp3:'audio', opus:'audio', ogg:'audio', aac:'audio', m4a:'audio',
  apk:'apk',
};
function guessFileType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_TYPE_MAP[ext] || 'document';
}

const _fiThumbObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    _fiThumbObserver.unobserve(el);
    const src = el.dataset.src;
    if (!src) return;
    el.src = src;
    if (el.tagName === 'VIDEO') el.load();
  });
}, { rootMargin: '250px 0px' }) : null;

function fiMediaSrc(path) {
  return (window.Capacitor && Capacitor.convertFileSrc) ? Capacitor.convertFileSrc(path) : path;
}

function fiTypeIcon(f, type) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (type === 'document' && FI_DOC_ICON[ext])   return FI_DOC_ICON[ext];
  if (type === 'audio'    && FI_AUDIO_ICON[ext]) return FI_AUDIO_ICON[ext];
  return FI_TYPE_ICON[type] || '📎';
}

// Tapping the thumbnail opens a full-size preview instead of toggling selection (name
// alone often isn't enough to tell photos/videos apart before deleting) — stopPropagation
// keeps that tap from also bubbling up to the row's select-toggle click handler. Tapping
// anywhere else on the row still selects/deselects as before.
function fiThumbHtml(f, type) {
  const fallback = fiTypeIcon(f, type);
  const previewArgs = `event.stopPropagation(); openPreview('${encodeURIComponent(f.path)}','${type==='video'?'video':'image'}','${encodeURIComponent(f.name)}')`;
  if (type === 'image' || type === 'screenshot') {
    return `<div class="fi-thumb fi-thumb-media" onclick="${previewArgs}">
      <span class="fi-thumb-fallback">${fallback}</span>
      <img class="fi-thumb-img" data-src="${fiMediaSrc(f.path)}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">
      <span class="fi-preview-badge">🔍</span>
    </div>`;
  }
  if (type === 'video') {
    return `<div class="fi-thumb fi-thumb-media" onclick="${previewArgs}">
      <span class="fi-thumb-fallback">${fallback}</span>
      <video class="fi-thumb-img" data-src="${fiMediaSrc(f.path)}" muted preload="none" playsinline onloadeddata="this.classList.add('loaded')" onerror="this.remove()"></video>
      <span class="fi-play-badge">▶</span>
    </div>`;
  }
  return `<div class="fi-thumb fi-icon fi-icon-${type}">${fallback}</div>`;
}

// ── Full-size preview (image/video) — see fiThumbHtml() above for the tap wiring ──
window.openPreview = function(pathEnc, type, nameEnc) {
  const path = decodeURIComponent(pathEnc);
  const name = decodeURIComponent(nameEnc);
  const img  = document.getElementById('previewImg');
  const vid  = document.getElementById('previewVideo');
  vid.pause();
  vid.removeAttribute('src');
  img.classList.add('hidden');
  vid.classList.add('hidden');
  if (type === 'video') {
    vid.src = fiMediaSrc(path);
    vid.classList.remove('hidden');
  } else {
    img.src = fiMediaSrc(path);
    img.classList.remove('hidden');
  }
  document.getElementById('previewCaption').textContent = name;
  document.getElementById('previewModal').classList.remove('hidden');
};
window.closePreview = function() {
  const vid = document.getElementById('previewVideo');
  vid.pause();
  vid.removeAttribute('src');
  document.getElementById('previewModal').classList.add('hidden');
};

function fiItemHtml(f, type, selected) {
  const badge = f.source ? `<span class="fi-source-badge fi-source-${f.source}">${FI_SOURCE_LABEL[f.source] || ''}</span>` : '';
  return `
    <div class="file-item${selected?' selected':''}" data-path="${encodeURIComponent(f.path)}">
      ${fiThumbHtml(f, type)}
      <div class="fi-body">
        <div class="fi-name">${f.name}</div>
        <div class="fi-date">${fmtDate(f.dateMs)}${badge}</div>
      </div>
      <div class="fi-size">${fmt(f.size)}</div>
      <div class="fi-check"></div>
    </div>`;
}

function fiObserveThumbs(container) {
  const thumbs = container.querySelectorAll('.fi-thumb-img[data-src]');
  if (!_fiThumbObserver) {
    thumbs.forEach(el => { el.src = el.dataset.src; if (el.tagName === 'VIDEO') el.load(); });
    return;
  }
  thumbs.forEach(el => _fiThumbObserver.observe(el));
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
let waFiles = [], waSelected = new Set(), waCurrentType = 'video';

document.querySelectorAll('#waBody .wa-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const type = tab.dataset.type;
    if ((type === 'document' || type === 'audio') && !requirePro(t('dailyReasonWADocAudio'))) return;
    document.querySelectorAll('#waBody .wa-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    waCurrentType = type;
    renderWAFiles();
  });
});

async function scanWA() {
  const btn = document.getElementById('btnScanWA');
  btn.textContent = t('scanningEllipsis');
  btn.disabled = true;
  waFiles = []; waSelected.clear();
  closeResultPanel();
  try {
    const months  = parseInt(document.getElementById('waMonths').value);
    const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
    if (FileCleaner) {
      const res = await FileCleaner.scanWAMedia({ type: waCurrentType, cutoffMs: cutoff });
      waFiles = res.files || [];
    } else {
      const exts = { video:'.mp4', image:'.jpg', document:'.pdf', audio:'.opus' };
      const ext  = exts[waCurrentType] || '.bin';
      waFiles = Array.from({length:18}, (_,i) => {
        const source = i % 3 === 0 ? 'whatsapp_business' : 'whatsapp';
        const appDir = source === 'whatsapp_business' ? 'WhatsApp Business' : 'WhatsApp';
        return {
          name: `WA_${waCurrentType}_${String(i+1).padStart(3,'0')}${ext}`,
          path: `/storage/emulated/0/${appDir}/Media/${appDir} ${waCurrentType.charAt(0).toUpperCase()+waCurrentType.slice(1)}/${i+1}${ext}`,
          size: Math.floor(Math.random()*50+1)*1024*1024,
          dateMs: Date.now() - Math.floor(Math.random()*250+1)*24*3600*1000,
          source,
        };
      });
      await new Promise(r => setTimeout(r, 900));
    }
    renderWAFiles();
    const months2  = parseInt(document.getElementById('waMonths').value);
    const cutoff2  = Date.now() - months2 * 30 * 24 * 3600 * 1000;
    const eligible = waFiles.filter(f => f.dateMs < cutoff2);
    const kept     = waFiles.length - eligible.length;
    toast(t('toastWAFound', { count: eligible.length, kept }));
  } catch(e) {
    toast(t('toastWAScanErrorPrefix') + e.message, 'error');
  } finally {
    btn.textContent = t('btnScanWADefault');
    btn.disabled = false;
  }
}

function renderWAFiles() {
  const months  = parseInt(document.getElementById('waMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = waFiles.filter(f => f.dateMs < cutoff);
  const list = document.getElementById('waFileList');

  if (!eligible.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px">${t('emptyNoOldFiles')}</div>`;
    document.getElementById('waActions').style.display = 'none';
    return;
  }
  const totalSz = eligible.reduce((s,f) => s+f.size, 0);
  list.innerHTML = eligible.map(f => fiItemHtml(f, waCurrentType, waSelected.has(f.path))).join('');
  fiObserveThumbs(list);

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = decodeURIComponent(el.dataset.path);
      if (waSelected.has(path)) { waSelected.delete(path); el.classList.remove('selected'); }
      else                      { waSelected.add(path);   el.classList.add('selected'); }
    });
  });
  document.getElementById('waActions').style.display = 'flex';
  document.getElementById('waSub').textContent = t('subOldFilesCount', { count: eligible.length, size: fmt(totalSz) });
}

document.getElementById('btnScanWA').addEventListener('click', scanWA);
document.getElementById('btnSelectAllWA').addEventListener('click', () => {
  const months  = parseInt(document.getElementById('waMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = waFiles.filter(f => f.dateMs < cutoff);
  const allSel  = waSelected.size === eligible.length;
  waSelected.clear();
  if (!allSel) eligible.forEach(f => waSelected.add(f.path));
  renderWAFiles();
});
document.getElementById('waMonths').addEventListener('change', renderWAFiles);
document.getElementById('btnDeleteWA').addEventListener('click', async () => {
  if (!waSelected.size) { toast(t('tapSelectFile'), 'error'); return; }
  const paths   = [...waSelected];
  const toDelete = waFiles.filter(f => paths.includes(f.path));
  const totalSz = toDelete.reduce((s,f) => s+f.size, 0);

  showModal(t('modalDeleteWATitle'), t('modalDeleteWABody', { count: paths.length, size: fmt(totalSz) }), async () => {
    const before = await captureStats();
    try {
      // feature:'wa' — native side inspects the paths themselves (Documents/Audio
      // subfolders require Pro, Video/Foto don't) rather than trusting a client-supplied
      // media type, since waCurrentType could be spoofed independently of the JS tab gate.
      if (FileCleaner) await FileCleaner.deleteFiles({ paths, feature: 'wa' });
      else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 700)); }

      waFiles = waFiles.filter(f => !waSelected.has(f.path));
      waSelected.clear();
      renderWAFiles();

      const after = computeAfter(before, totalSz);
      await loadStorageInfo();

      showResultPanel(before, after, totalSz, [
        { icon:'🎬', label: t('detailFilesDeleted'), value: paths.length + ' file' },
        { icon:'💾', label: t('detailStorageFreed'), value: fmt(totalSz) },
        { icon:'💬', label: t('detailSource'),       value: t('sourceWAMedia') },
      ]);
      toast(t('toastWADeleted', { size: fmt(totalSz) }));
    } catch(e) { handleDeleteRejection(e, t('dailyReasonWADocAudio')); }
  });
});

// ── Telegram Cleaner (media + cache — entire card is Pro-gated via toggleAdv) ──
// Telegram's actual chat/message database lives in the app's private storage, which
// scoped storage blocks third-party apps from reading — so this scans/cleans the same
// kind of shared-storage media Telegram itself writes for received photos/videos/docs/
// audio (group chat media included), the WhatsApp Cleaner counterpart above.
let tgFiles = [], tgSelected = new Set(), tgCurrentType = 'video';

document.querySelectorAll('#telegramBody .wa-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#telegramBody .wa-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    tgCurrentType = tab.dataset.type;
    renderTgFiles();
  });
});

async function scanTelegram() {
  const btn = document.getElementById('btnScanTg');
  btn.textContent = t('scanningEllipsis');
  btn.disabled = true;
  tgFiles = []; tgSelected.clear();
  closeResultPanel();
  try {
    const months  = parseInt(document.getElementById('tgMonths').value);
    const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
    if (FileCleaner) {
      const res = await FileCleaner.scanTelegramMedia({ type: tgCurrentType, cutoffMs: cutoff });
      tgFiles = res.files || [];
    } else {
      const exts = { video:'.mp4', image:'.jpg', document:'.pdf', audio:'.opus' };
      const ext  = exts[tgCurrentType] || '.bin';
      tgFiles = Array.from({length:14}, (_,i) => ({
        name: `TG_${tgCurrentType}_${String(i+1).padStart(3,'0')}${ext}`,
        path: `/storage/emulated/0/Telegram/Telegram ${tgCurrentType.charAt(0).toUpperCase()+tgCurrentType.slice(1)}/${i+1}${ext}`,
        size: Math.floor(Math.random()*40+1)*1024*1024,
        dateMs: Date.now() - Math.floor(Math.random()*250+1)*24*3600*1000,
        source: 'telegram',
      }));
      await new Promise(r => setTimeout(r, 900));
    }
    renderTgFiles();
    const cutoff2  = Date.now() - parseInt(document.getElementById('tgMonths').value) * 30 * 24 * 3600 * 1000;
    const eligible = tgFiles.filter(f => f.dateMs < cutoff2);
    toast(t('toastTgFound', { count: eligible.length }));
  } catch(e) {
    toast(t('toastTgScanErrorPrefix') + e.message, 'error');
  } finally {
    btn.textContent = t('btnScanTgDefault');
    btn.disabled = false;
  }
}

function renderTgFiles() {
  const months  = parseInt(document.getElementById('tgMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = tgFiles.filter(f => f.dateMs < cutoff);
  const list = document.getElementById('tgFileList');

  if (!eligible.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px">${t('emptyNoOldFiles')}</div>`;
    document.getElementById('tgActions').style.display = 'none';
    return;
  }
  const totalSz = eligible.reduce((s,f) => s+f.size, 0);
  list.innerHTML = eligible.map(f => fiItemHtml(f, tgCurrentType, tgSelected.has(f.path))).join('');
  fiObserveThumbs(list);

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = decodeURIComponent(el.dataset.path);
      if (tgSelected.has(path)) { tgSelected.delete(path); el.classList.remove('selected'); }
      else                      { tgSelected.add(path);   el.classList.add('selected'); }
    });
  });
  document.getElementById('tgActions').style.display = 'flex';
  document.getElementById('tgSub').textContent = t('subOldFilesCount', { count: eligible.length, size: fmt(totalSz) });
}

document.getElementById('btnScanTg').addEventListener('click', scanTelegram);
document.getElementById('btnSelectAllTg').addEventListener('click', () => {
  const months  = parseInt(document.getElementById('tgMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = tgFiles.filter(f => f.dateMs < cutoff);
  const allSel  = tgSelected.size === eligible.length;
  tgSelected.clear();
  if (!allSel) eligible.forEach(f => tgSelected.add(f.path));
  renderTgFiles();
});
document.getElementById('tgMonths').addEventListener('change', renderTgFiles);
document.getElementById('btnDeleteTg').addEventListener('click', async () => {
  if (!tgSelected.size) { toast(t('tapSelectFile'), 'error'); return; }
  const paths    = [...tgSelected];
  const toDelete = tgFiles.filter(f => paths.includes(f.path));
  const totalSz  = toDelete.reduce((s,f) => s+f.size, 0);

  showModal(t('modalDeleteTgTitle'), t('modalDeleteTgBody', { count: paths.length, size: fmt(totalSz) }), async () => {
    const before = await captureStats();
    try {
      if (FileCleaner) await FileCleaner.deleteFiles({ paths, feature: 'telegram' });
      else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 700)); }

      tgFiles = tgFiles.filter(f => !tgSelected.has(f.path));
      tgSelected.clear();
      renderTgFiles();

      const after = computeAfter(before, totalSz);
      await loadStorageInfo();

      showResultPanel(before, after, totalSz, [
        { icon:'✈️', label: t('detailFilesDeleted'), value: paths.length + ' file' },
        { icon:'💾', label: t('detailStorageFreed'), value: fmt(totalSz) },
        { icon:'💬', label: t('detailSource'),       value: t('sourceTelegramMedia') },
      ]);
      toast(t('toastTgDeleted', { size: fmt(totalSz) }));
    } catch(e) { handleDeleteRejection(e, t('dailyReasonTelegramPro')); }
  });
});

// ── Camera / Gallery Cleaner ───────────────────────────────────────────────────
let camFiles = [], camSelected = new Set(), camCurrentType = 'video';

document.querySelectorAll('#cameraBody .wa-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#cameraBody .wa-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    camCurrentType = tab.dataset.type;
    renderCamFiles();
  });
});
document.getElementById('camMonths').addEventListener('change', renderCamFiles);

async function scanCamera() {
  const btn = document.getElementById('btnScanCam');
  btn.textContent = t('scanningEllipsis');
  btn.disabled = true;
  camFiles = []; camSelected.clear();
  closeResultPanel();
  try {
    const months  = parseInt(document.getElementById('camMonths').value);
    const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
    if (FileCleaner) {
      const res = await FileCleaner.scanCameraMedia({ type: camCurrentType, cutoffMs: cutoff });
      camFiles = res.files || [];
    } else {
      const extMap = { video:'.mp4', image:'.jpg', screenshot:'.png' };
      const ext    = extMap[camCurrentType];
      camFiles = Array.from({length:22}, (_,i) => ({
        name: `${camCurrentType==='screenshot'?'Screenshot':'IMG'}_${20240101+i}${ext}`,
        path: `/storage/emulated/0/DCIM/Camera/${i+1}${ext}`,
        size: Math.floor(Math.random()*80+2)*1024*1024,
        dateMs: Date.now() - Math.floor(Math.random()*300+10)*24*3600*1000,
      }));
      await new Promise(r => setTimeout(r, 800));
    }
    renderCamFiles();
    const months2  = parseInt(document.getElementById('camMonths').value);
    const cutoff2  = Date.now() - months2 * 30 * 24 * 3600 * 1000;
    const eligible = camFiles.filter(f => f.dateMs < cutoff2);
    toast(t('toastCamFound', { count: eligible.length }));
  } catch(e) {
    toast(t('scanErrorPrefix') + e.message, 'error');
  } finally {
    btn.textContent = t('btnScanCamDefault');
    btn.disabled = false;
  }
}

function renderCamFiles() {
  const months  = parseInt(document.getElementById('camMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = camFiles.filter(f => f.dateMs < cutoff);
  const list = document.getElementById('camFileList');

  if (!eligible.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px">${t('emptyNoOldFiles')}</div>`;
    document.getElementById('camActions').style.display = 'none';
    return;
  }
  const totalSz = eligible.reduce((s,f) => s+f.size, 0);
  list.innerHTML = eligible.map(f => fiItemHtml(f, camCurrentType, camSelected.has(f.path))).join('');
  fiObserveThumbs(list);

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = decodeURIComponent(el.dataset.path);
      if (camSelected.has(path)) { camSelected.delete(path); el.classList.remove('selected'); }
      else                       { camSelected.add(path);   el.classList.add('selected'); }
    });
  });
  document.getElementById('camActions').style.display = 'flex';
  document.getElementById('camSub').textContent = t('subOldFilesCount', { count: eligible.length, size: fmt(totalSz) });
}

document.getElementById('btnScanCam').addEventListener('click', scanCamera);
document.getElementById('btnSelectAllCam').addEventListener('click', () => {
  const months  = parseInt(document.getElementById('camMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = camFiles.filter(f => f.dateMs < cutoff);
  const allSel  = camSelected.size === eligible.length;
  camSelected.clear();
  if (!allSel) eligible.forEach(f => camSelected.add(f.path));
  renderCamFiles();
});
document.getElementById('btnDeleteCam').addEventListener('click', async () => {
  if (!camSelected.size) { toast(t('tapSelectFile'), 'error'); return; }
  const paths   = [...camSelected];
  const toDelete = camFiles.filter(f => paths.includes(f.path));
  const totalSz  = toDelete.reduce((s,f) => s+f.size, 0);

  showModal(t('modalDeleteCamTitle'), t('modalDeleteCamBody', { count: paths.length, size: fmt(totalSz) }), async () => {
    const before = await captureStats();
    try {
      if (FileCleaner) await FileCleaner.deleteFiles({ paths, feature: 'camera' });
      else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 700)); }

      camFiles = camFiles.filter(f => !camSelected.has(f.path));
      camSelected.clear();
      renderCamFiles();

      const after = computeAfter(before, totalSz);
      await loadStorageInfo();

      showResultPanel(before, after, totalSz, [
        { icon:'📷', label: t('detailCamDeleted'),  value: paths.length + ' file' },
        { icon:'💾', label: t('detailStorageFreed'), value: fmt(totalSz) },
        { icon:'📅', label: t('detailOlderThan'),   value: document.getElementById('camMonths').value + t('monthsAgoSuffix') },
      ]);
      toast(t('toastCamDeleted', { size: fmt(totalSz) }));
    } catch(e) { handleDeleteRejection(e, t('dailyReasonCameraPro')); }
  });
});

// ── Duplicate Finder ───────────────────────────────────────────────────────────
let dupGroups = [], dupSelected = new Set();

async function scanDuplicates() {
  const btn = document.getElementById('btnScanDup');
  btn.textContent = t('scanningEllipsis');
  btn.disabled = true;
  dupGroups = []; dupSelected.clear();
  closeResultPanel();

  const scope    = document.querySelector('input[name="dupScope"]:checked').value;
  const progress = document.getElementById('dupProgress');
  const fill     = document.getElementById('dupBarFill');
  const label    = document.getElementById('dupBarLabel');
  progress.classList.remove('hidden');
  fill.style.width = '0%';

  try {
    if (DupFinder) {
      // Update progress via polling is not natively supported, just show spinner
      label.textContent = t('dupHashing');
      fill.style.width  = '50%';
      const res = await DupFinder.scanDuplicates({ scope });
      dupGroups = res.groups || [];
      fill.style.width = '100%';
    } else {
      for (let i = 0; i <= 100; i += 8) {
        fill.style.width = i + '%';
        label.textContent = i < 30 ? t('dupCollecting', { pct: i }) : i < 70 ? t('dupHashingPct', { pct: i }) : t('dupComparing', { pct: i });
        await new Promise(r => setTimeout(r, 160));
      }
      dupGroups = [
        { hash:'a1b2', totalSize:45*1024*1024, files:[
          { path:'/storage/emulated/0/DCIM/Camera/IMG_001.jpg',        name:'IMG_001.jpg',      size:22*1024*1024, dateMs:Date.now()-10*86400000 },
          { path:'/storage/emulated/0/Download/IMG_001_copy.jpg',      name:'IMG_001_copy.jpg', size:22*1024*1024, dateMs:Date.now()-5*86400000 },
          { path:'/storage/emulated/0/WhatsApp/Media/WhatsApp Images/IMG_001.jpg', name:'IMG_001.jpg', size:22*1024*1024, dateMs:Date.now()-3*86400000 },
        ]},
        { hash:'c3d4', totalSize:180*1024*1024, files:[
          { path:'/storage/emulated/0/Videos/vid1.mp4',         name:'vid1.mp4', size:90*1024*1024, dateMs:Date.now()-30*86400000 },
          { path:'/storage/emulated/0/Download/vid1_dl.mp4',    name:'vid1_dl.mp4', size:90*1024*1024, dateMs:Date.now()-20*86400000 },
        ]},
        { hash:'e5f6', totalSize:12*1024*1024, files:[
          { path:'/storage/emulated/0/Documents/doc.pdf',        name:'doc.pdf',        size:6*1024*1024, dateMs:Date.now()-60*86400000 },
          { path:'/storage/emulated/0/Download/doc_backup.pdf',  name:'doc_backup.pdf', size:6*1024*1024, dateMs:Date.now()-55*86400000 },
        ]},
        { hash:'g7h8', totalSize:8*1024*1024, files:[
          { path:'/storage/emulated/0/Music/song.mp3',           name:'song.mp3',      size:4*1024*1024, dateMs:Date.now()-90*86400000 },
          { path:'/storage/emulated/0/Download/song_copy.mp3',   name:'song_copy.mp3', size:4*1024*1024, dateMs:Date.now()-85*86400000 },
        ]},
      ];
    }

    renderDupGroups();
    const totalDup = dupGroups.reduce((s,g) => s + g.totalSize - ((g.files[0] && g.files[0].size)||0), 0);
    toast(t('toastDupFound', { count: dupGroups.length, size: fmt(totalDup) }));
    document.getElementById('dupSub').textContent = t('subDupGroupsFound', { count: dupGroups.length });
  } catch(e) {
    toast(t('scanErrorPrefix') + e.message, 'error');
  } finally {
    btn.textContent = t('btnScanDupDefault');
    btn.disabled = false;
    progress.classList.add('hidden');
  }
}

// Free tier caps displayed/actionable groups at 5 (DEVELOP.md: "tampilkan maks. 5
// grup"). Render, Auto Select and Delete all read through this so free users can't
// act on hidden groups just because they aren't rendered.
const DUP_FREE_GROUP_CAP = 5;
function visibleDupGroups() {
  return isPro ? dupGroups : dupGroups.slice(0, DUP_FREE_GROUP_CAP);
}

function renderDupGroups() {
  const list = document.getElementById('dupList');
  if (!dupGroups.length) {
    list.innerHTML = `<div class="empty-state">${t('emptyNoDuplicates')}</div>`;
    document.getElementById('dupActions').style.display = 'none';
    return;
  }
  const visible = visibleDupGroups();
  const hiddenCount = dupGroups.length - visible.length;

  list.innerHTML = visible.map((g, gi) => `
    <div class="dup-group">
      <div class="dup-group-header">
        <span>${g.files.length}${t('unitFilesIdentical')}</span>
        <span>${fmt(g.totalSize)}</span>
      </div>
      ${g.files.map((f, fi) => `
        <div class="dup-file-item${dupSelected.has(f.path)?' selected':''}" data-path="${encodeURIComponent(f.path)}" data-gi="${gi}">
          <div class="fi-body">
            <div class="fi-name">${f.name}</div>
            <div class="fi-date">${f.path.replace('/storage/emulated/0/','…/').split('/').slice(0,-1).join('/')} · ${fmtDate(f.dateMs)}</div>
          </div>
          <div class="fi-size">${fmt(f.size)}</div>
          <div class="fi-check"></div>
        </div>`).join('')}
    </div>`).join('')
    + (hiddenCount > 0 ? `
    <div class="dup-group dup-locked" onclick="openUpgradeModal(t('dailyReasonDupHidden', {cap: ${DUP_FREE_GROUP_CAP}}))">
      <div class="dup-group-header">
        <span>${t('dupLockedGroups', { count: hiddenCount })}</span>
        <span>${t('labelPro')}</span>
      </div>
    </div>` : '');

  list.querySelectorAll('.dup-file-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = decodeURIComponent(el.dataset.path);
      if (dupSelected.has(path)) { dupSelected.delete(path); el.classList.remove('selected'); }
      else                       { dupSelected.add(path);   el.classList.add('selected'); }
      document.getElementById('dupActions').style.display = 'flex';
    });
  });
  document.getElementById('dupActions').style.display = 'flex';
}

document.getElementById('btnScanDup').addEventListener('click', scanDuplicates);
document.getElementById('btnAutoSelectDup').addEventListener('click', () => {
  dupSelected.clear();
  visibleDupGroups().forEach(g => {
    const sorted = [...g.files].sort((a,b) => b.dateMs - a.dateMs);
    sorted.slice(1).forEach(f => dupSelected.add(f.path)); // keep newest, select rest
  });
  renderDupGroups();
  const totalSz = visibleDupGroups().reduce((acc,g)=>acc.concat(g.files),[]).filter(f=>dupSelected.has(f.path)).reduce((s,f)=>s+f.size,0);
  toast(t('toastAutoSelected', { count: dupSelected.size, size: fmt(totalSz) }));
});
document.getElementById('btnDeleteDup').addEventListener('click', async () => {
  if (!dupSelected.size) { toast(t('tapSelectFile'), 'error'); return; }
  const paths    = [...dupSelected];
  const allFiles = visibleDupGroups().reduce((acc,g) => acc.concat(g.files), []);
  const toDelete = allFiles.filter(f => paths.includes(f.path));
  const totalSz  = toDelete.reduce((s,f) => s+f.size, 0);

  showModal(t('modalDeleteDupTitle'), t('modalDeleteDupBody', { count: paths.length, size: fmt(totalSz) }), async () => {
    const before = await captureStats();
    try {
      if (DupFinder) await DupFinder.deleteFiles({ paths });
      else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 800)); }

      dupGroups.forEach(g => { g.files = g.files.filter(f => !paths.includes(f.path)); });
      dupGroups = dupGroups.filter(g => g.files.length > 1);
      dupSelected.clear();
      renderDupGroups();

      const after = computeAfter(before, totalSz);
      await loadStorageInfo();

      showResultPanel(before, after, totalSz, [
        { icon:'🔄', label: t('detailDupDeleted'),   value: paths.length + ' file' },
        { icon:'💾', label: t('detailStorageFreed'), value: fmt(totalSz) },
        { icon:'✅', label: t('detailOriginalFiles'),value: t('statusIntact') },
      ]);
      toast(t('toastDupDeleted', { size: fmt(totalSz) }));
    } catch(e) { toast(t('deleteErrorPrefix') + e.message, 'error'); }
  });
});

// ── Shared "flat list" scan/select/delete cleaners ─────────────────────────────
// Big File, APK Installer, Empty Folder, Download >90 hari and Screen Recording all
// follow the same scan→list→select→delete shape as WhatsApp/Camera above, just
// without tabs or a live date filter (server-side cutoff or not applicable) — one
// factory replaces five near-identical blocks. proReason gates the DELETE action
// only (scan always stays free, per the free-scan/paid-delete spec); pass null for
// the two full-access features (Big File, Empty Folder).
// cfg.emptyText/subDefault/confirmTitle/proReason/dailyLimitReason are all FUNCTIONS
// (() => t('key')), not plain strings — they're read every time the UI actually needs
// them (scan click, render, delete click), so a language switch between calls is always
// reflected instead of being frozen at config-definition time (page load).
function initFlatFileCleaner(cfg) {
  let items = [], selected = new Set();
  const btnScan   = document.getElementById(cfg.scanBtnId);
  const listEl    = document.getElementById(cfg.listId);
  const actions   = document.getElementById(cfg.actionsId);
  const btnAll    = document.getElementById(cfg.selectAllBtnId);
  const btnDelete = document.getElementById(cfg.deleteBtnId);
  const subEl     = document.getElementById(cfg.subId);

  function render() {
    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:16px">${cfg.emptyText()}</div>`;
      actions.style.display = 'none';
      subEl.textContent = cfg.subDefault();
      return;
    }
    const totalSz = items.reduce((s,f) => s+(f.size||0), 0);
    listEl.innerHTML = items.map(f => fiItemHtml(f, cfg.typeFn(f), selected.has(f.path))).join('');
    fiObserveThumbs(listEl);
    listEl.querySelectorAll('.file-item').forEach(el => {
      el.addEventListener('click', () => {
        const path = decodeURIComponent(el.dataset.path);
        if (selected.has(path)) {
          selected.delete(path);
        } else {
          // Free-tier quota (Big File / Download Folder): picking a new file while already
          // at the cap swaps it in for whatever was selected before, instead of adding to it —
          // enforces "1 file/day" through the selection UI itself rather than rejecting delete.
          if (!isPro && cfg.freeMaxSelect && selected.size >= cfg.freeMaxSelect) selected.clear();
          selected.add(path);
        }
        render();
      });
    });
    actions.style.display = 'flex';
    subEl.textContent = cfg.subText(items.length, totalSz);
    // "Select All" is meaningless (and misleading) once Free tier is capped to 1 file.
    if (btnAll) btnAll.style.display = (!isPro && cfg.freeMaxSelect) ? 'none' : '';
  }

  btnScan.addEventListener('click', async () => {
    const label = btnScan.textContent;
    btnScan.textContent = t('scanningEllipsis');
    btnScan.disabled = true;
    items = []; selected.clear();
    closeResultPanel();
    try {
      items = await cfg.scanFn();
      render();
      const totalSz = items.reduce((s,f) => s+(f.size||0), 0);
      toast(items.length ? t('toastFoundItemsSize', { count: items.length, size: fmt(totalSz) }) : cfg.emptyText());
    } catch(e) {
      toast(t('scanErrorPrefix') + e.message, 'error');
    } finally {
      btnScan.textContent = label;
      btnScan.disabled = false;
    }
  });

  btnAll.addEventListener('click', () => {
    const allSel = selected.size === items.length;
    selected.clear();
    if (!allSel) items.forEach(f => selected.add(f.path));
    render();
  });

  btnDelete.addEventListener('click', async () => {
    if (!selected.size) { toast(t('tapMinSelect'), 'error'); return; }
    if (cfg.proReason && !requirePro(cfg.proReason())) return;
    if (cfg.dailyLimitKey && !checkDailyLimit(cfg.dailyLimitKey, cfg.dailyLimitReason())) return;
    const paths    = [...selected];
    const toDelete = items.filter(f => paths.includes(f.path));
    const totalSz  = toDelete.reduce((s,f) => s+(f.size||0), 0);

    showModal(cfg.confirmTitle(), cfg.confirmBody(paths.length, totalSz), async () => {
      const before = await captureStats();
      try {
        if (FileCleaner) await FileCleaner.deleteFiles({ paths, feature: cfg.featureKey });
        else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 700)); }

        items = items.filter(f => !selected.has(f.path));
        selected.clear();
        render();

        const after = computeAfter(before, totalSz);
        await loadStorageInfo();
        if (cfg.dailyLimitKey) {
          markDailyUsed(cfg.dailyLimitKey);
          if (Security) Security.markFeatureUsed({ feature: cfg.dailyLimitKey }).catch(() => {});
        }
        showResultPanel(before, after, totalSz, cfg.resultDetails(paths.length, totalSz));
        toast(cfg.successToast(paths.length, totalSz));
      } catch(e) {
        const fallbackReason = cfg.proReason ? cfg.proReason() : (cfg.dailyLimitReason ? cfg.dailyLimitReason() : undefined);
        handleDeleteRejection(e, fallbackReason);
      }
    });
  });
}

// ── Big File Cleaner (> 100MB) — Free: hapus 1 file/hari, Pro: unlimited ──────────
initFlatFileCleaner({
  scanBtnId:'btnScanBigFile', listId:'bigFileList', actionsId:'bigFileActions',
  selectAllBtnId:'btnSelectAllBigFile', deleteBtnId:'btnDeleteBigFile', subId:'bigFileSub',
  subDefault: () => t('advSubBigFile'), proReason: null, featureKey: 'bigfile',
  freeMaxSelect: 1, dailyLimitKey: 'bigfile',
  dailyLimitReason: () => t('dailyReasonBigFile'),
  emptyText: () => t('emptyNoBigFiles'),
  typeFn: f => guessFileType(f.name),
  subText: (n, sz) => t('subFilesCountSize', { count: n, size: fmt(sz) }),
  scanFn: async () => {
    if (FileCleaner) {
      const res = await FileCleaner.scanBigFiles({ minBytes: 100*1024*1024 });
      return (res.files || []).sort((a,b) => b.size - a.size);
    }
    return Array.from({length:9}, (_,i) => ({
      name:`video_${2024+i}.mp4`, path:`/storage/emulated/0/Movies/video_${i+1}.mp4`,
      size:Math.floor(Math.random()*900+100)*1024*1024, dateMs:Date.now()-Math.floor(Math.random()*300)*86400000,
    })).sort((a,b)=>b.size-a.size);
  },
  confirmTitle: () => t('modalDeleteBigFileTitle'),
  confirmBody: (n, sz) => t('modalDeleteBigFileBody', { count: n, size: fmt(sz) }),
  resultDetails: (n, sz) => [
    { icon:'📦', label: t('detailBigFileDeleted'), value: n + ' file' },
    { icon:'💾', label: t('detailStorageFreed'),   value: fmt(sz) },
  ],
  successToast: (n, sz) => t('toastBigFileDeleted', { size: fmt(sz) }),
});

// ── APK Installer Cleaner (free scan, paid delete) ─────────────────────────────
initFlatFileCleaner({
  scanBtnId:'btnScanApk', listId:'apkFileList', actionsId:'apkActions',
  selectAllBtnId:'btnSelectAllApk', deleteBtnId:'btnDeleteApk', subId:'apkSub',
  subDefault: () => t('advSubApk'), featureKey: 'apk',
  proReason: () => t('dailyReasonApkPro'),
  emptyText: () => t('emptyNoApk'),
  typeFn: () => 'apk',
  subText: (n, sz) => t('subApkCountSize', { count: n, size: fmt(sz) }),
  scanFn: async () => {
    if (FileCleaner) { const res = await FileCleaner.scanApkFiles(); return res.files || []; }
    return Array.from({length:5}, (_,i) => ({
      name:`app-release-${i+1}.apk`, path:`/storage/emulated/0/Download/app-release-${i+1}.apk`,
      size:Math.floor(Math.random()*40+5)*1024*1024, dateMs:Date.now()-Math.floor(Math.random()*200)*86400000,
    }));
  },
  confirmTitle: () => t('modalDeleteApkTitle'),
  confirmBody: (n, sz) => t('modalDeleteApkBody', { count: n, size: fmt(sz) }),
  resultDetails: (n, sz) => [
    { icon:'📲', label: t('detailApkDeleted'),   value: n + ' file' },
    { icon:'💾', label: t('detailStorageFreed'), value: fmt(sz) },
  ],
  successToast: (n, sz) => t('toastApkDeleted', { size: fmt(sz) }),
});

// ── Empty Folder Cleanup (full access) ─────────────────────────────────────────
initFlatFileCleaner({
  scanBtnId:'btnScanEmptyFolder', listId:'emptyFolderList', actionsId:'emptyFolderActions',
  selectAllBtnId:'btnSelectAllEmptyFolder', deleteBtnId:'btnDeleteEmptyFolder', subId:'emptyFolderSub',
  subDefault: () => t('advSubEmptyFolder'), proReason: null, featureKey: 'emptyfolder',
  emptyText: () => t('emptyNoEmptyFolders'),
  typeFn: () => 'folder',
  subText: (n) => t('subEmptyFolderCount', { count: n }),
  scanFn: async () => {
    if (FileCleaner) { const res = await FileCleaner.scanEmptyFolders(); return res.folders || []; }
    return Array.from({length:7}, (_,i) => ({
      name:`old_folder_${i+1}`, path:`/storage/emulated/0/Documents/old_folder_${i+1}`,
      size:0, dateMs:Date.now()-Math.floor(Math.random()*400)*86400000,
    }));
  },
  confirmTitle: () => t('modalDeleteEmptyFolderTitle'),
  confirmBody: (n) => t('modalDeleteEmptyFolderBody', { count: n }),
  resultDetails: (n) => [
    { icon:'📁', label: t('detailEmptyFolderDeleted'), value: n + ' folder' },
    { icon:'✅', label: t('detailStatus'),              value: t('statusNeater') },
  ],
  successToast: (n) => t('toastEmptyFolderDeleted', { count: n }),
});

// ── Download Folder Cleanup (>90 hari) — Free: hapus 1 file/hari, Pro: unlimited ─
initFlatFileCleaner({
  scanBtnId:'btnScanDownload', listId:'downloadFileList', actionsId:'downloadActions',
  selectAllBtnId:'btnSelectAllDownload', deleteBtnId:'btnDeleteDownload', subId:'downloadSub',
  subDefault: () => t('advSubDownload'), proReason: null, featureKey: 'download',
  freeMaxSelect: 1, dailyLimitKey: 'download',
  dailyLimitReason: () => t('dailyReasonDownload'),
  emptyText: () => t('emptyNoDownloadOld'),
  typeFn: f => guessFileType(f.name),
  subText: (n, sz) => t('subFilesCountSize', { count: n, size: fmt(sz) }),
  scanFn: async () => {
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    if (FileCleaner) { const res = await FileCleaner.scanDownloadOld({ cutoffMs: cutoff }); return res.files || []; }
    return Array.from({length:11}, (_,i) => ({
      name:`file_download_${i+1}.pdf`, path:`/storage/emulated/0/Download/file_download_${i+1}.pdf`,
      size:Math.floor(Math.random()*20+1)*1024*1024, dateMs:Date.now()-Math.floor(Math.random()*300+91)*86400000,
    }));
  },
  confirmTitle: () => t('modalDeleteDownloadTitle'),
  confirmBody: (n, sz) => t('modalDeleteDownloadBody', { count: n, size: fmt(sz) }),
  resultDetails: (n, sz) => [
    { icon:'📥', label: t('detailDownloadDeleted'), value: n + ' file' },
    { icon:'💾', label: t('detailStorageFreed'),    value: fmt(sz) },
  ],
  successToast: (n, sz) => t('toastDownloadDeleted', { size: fmt(sz) }),
});

// ── Screen Recording Cleanup (free scan, paid delete) ──────────────────────────
initFlatFileCleaner({
  scanBtnId:'btnScanScreenRec', listId:'screenRecFileList', actionsId:'screenRecActions',
  selectAllBtnId:'btnSelectAllScreenRec', deleteBtnId:'btnDeleteScreenRec', subId:'screenRecSub',
  subDefault: () => t('advSubScreenRec'), featureKey: 'screenrec',
  proReason: () => t('dailyReasonScreenRecPro'),
  emptyText: () => t('emptyNoScreenRec'),
  typeFn: () => 'video',
  subText: (n, sz) => t('subScreenRecCountSize', { count: n, size: fmt(sz) }),
  scanFn: async () => {
    if (FileCleaner) { const res = await FileCleaner.scanScreenRecordings(); return res.files || []; }
    return Array.from({length:6}, (_,i) => ({
      name:`Screenrecorder-2026-0${i+1}.mp4`, path:`/storage/emulated/0/Movies/Screen Recordings/rec_${i+1}.mp4`,
      size:Math.floor(Math.random()*300+50)*1024*1024, dateMs:Date.now()-Math.floor(Math.random()*200)*86400000,
    }));
  },
  confirmTitle: () => t('modalDeleteScreenRecTitle'),
  confirmBody: (n, sz) => t('modalDeleteScreenRecBody', { count: n, size: fmt(sz) }),
  resultDetails: (n, sz) => [
    { icon:'🎥', label: t('detailScreenRecDeleted'), value: n + ' file' },
    { icon:'💾', label: t('detailStorageFreed'),     value: fmt(sz) },
  ],
  successToast: (n, sz) => t('toastScreenRecDeleted', { size: fmt(sz) }),
});

// ── Unused App Cleaner ──────────────────────────────────────────────────────────
let unusedApps = [], unusedSelected = new Set();

function fmtLastUsed(ms, neverUsed) {
  if (neverUsed || !ms) return t('neverUsed');
  const days = Math.floor((Date.now() - ms) / (24*3600*1000));
  if (days < 30) return days + t('daysAgoSuffix');
  const months = Math.floor(days / 30);
  if (months < 12) return months + t('monthsAgoSuffixShort');
  return (months/12).toFixed(1) + t('yearsAgoSuffix');
}

async function scanUnusedApps() {
  const btn = document.getElementById('btnScanUnused');
  btn.textContent = t('scanningEllipsis');
  btn.disabled = true;
  unusedApps = []; unusedSelected.clear();
  closeResultPanel();
  try {
    if (AppManager) {
      const res = await AppManager.scanUnusedApps();
      unusedApps = res.apps || [];
    } else {
      unusedApps = Array.from({length:6}, (_,i) => ({
        pkg: `com.demo.unused${i}`,
        name: `Demo App ${i+1}`,
        iconBase64: '',
        sizeBytes: Math.floor(Math.random()*300+20)*1024*1024,
        lastUsedMs: i % 2 === 0 ? Date.now() - (200+i*40)*24*3600*1000 : 0,
        neverUsed: i % 2 !== 0,
      }));
      await new Promise(r => setTimeout(r, 900));
    }
    unusedApps.sort((a,b) => (a.lastUsedMs||0) - (b.lastUsedMs||0));
    renderUnusedApps();
    toast(unusedApps.length
      ? t('toastUnusedFound', { count: unusedApps.length })
      : t('toastAllAppsUsed'));
  } catch(e) {
    toast(t('scanErrorPrefix') + e.message, 'error');
  } finally {
    btn.textContent = t('btnScanUnusedDefault');
    btn.disabled = false;
  }
}

function renderUnusedApps() {
  const list = document.getElementById('unusedFileList');
  if (!unusedApps.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px">${t('emptyAllAppsActive')}</div>`;
    document.getElementById('unusedActions').style.display = 'none';
    document.getElementById('unusedSub').textContent = t('advSubUnused');
    return;
  }
  const totalSz = unusedApps.reduce((s,a) => s+a.sizeBytes, 0);
  list.innerHTML = unusedApps.map(a => `
    <div class="file-item${unusedSelected.has(a.pkg)?' selected':''}" data-pkg="${encodeURIComponent(a.pkg)}">
      <div class="fi-thumb fi-thumb-app">
        ${a.iconBase64
          ? `<img class="fi-thumb-img loaded" src="${a.iconBase64}" alt="">`
          : '<span class="fi-thumb-fallback">📱</span>'}
      </div>
      <div class="fi-body">
        <div class="fi-name">${a.name}</div>
        <div class="fi-date">${fmtLastUsed(a.lastUsedMs, a.neverUsed)}</div>
      </div>
      <div class="fi-size">${fmt(a.sizeBytes)}</div>
      <div class="fi-check"></div>
    </div>`).join('');

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', () => {
      const pkg = decodeURIComponent(el.dataset.pkg);
      if (unusedSelected.has(pkg)) { unusedSelected.delete(pkg); el.classList.remove('selected'); }
      else                          { unusedSelected.add(pkg);   el.classList.add('selected'); }
    });
  });
  document.getElementById('unusedActions').style.display = 'flex';
  document.getElementById('unusedSub').textContent = t('subAppsCountSize', { count: unusedApps.length, size: fmt(totalSz) });
}

document.getElementById('btnScanUnused').addEventListener('click', scanUnusedApps);
document.getElementById('btnSelectAllUnused').addEventListener('click', () => {
  const allSel = unusedSelected.size === unusedApps.length;
  unusedSelected.clear();
  if (!allSel) unusedApps.forEach(a => unusedSelected.add(a.pkg));
  renderUnusedApps();
});
document.getElementById('btnUninstallUnused').addEventListener('click', async () => {
  if (!unusedSelected.size) { toast(t('toastSelectMinApp'), 'error'); return; }
  const pkgs  = [...unusedSelected];
  const names = unusedApps.filter(a => pkgs.includes(a.pkg)).map(a => a.name).join(', ');

  showModal(t('modalUninstallTitle'),
    t('modalUninstallBody', { count: pkgs.length, names }),
    async () => {
      const btn = document.getElementById('btnUninstallUnused');
      btn.disabled = true;
      let uninstalled = 0;
      try {
        for (const pkg of pkgs) {
          if (AppManager) {
            try {
              const res = await AppManager.uninstallApp({ packageName: pkg });
              if (res.success) uninstalled++;
            } catch (e) { /* user membatalkan dialog uninstall untuk app ini, lanjut ke berikutnya */ }
          } else {
            uninstalled++;
            await new Promise(r => setTimeout(r, 400));
          }
        }
        unusedSelected.clear();
        await scanUnusedApps(); // re-scan supaya list mencerminkan state OS sebenarnya
        toast(t('toastUninstallResult', { done: uninstalled, total: pkgs.length }));
      } catch(e) {
        toast(t('toastUninstallErrorPrefix') + e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
});

// ── Remove Ads (Private DNS ad-block shortcut) ────────────────────────────────
document.getElementById('btnCopyDns').addEventListener('click', async () => {
  const host = document.getElementById('adsDnsHost').textContent.trim();
  try {
    await navigator.clipboard.writeText(host);
    toast(t('toastDnsCopied'));
  } catch (e) {
    toast(t('toastCopyFailedPrefix') + e.message, 'error');
  }
});
document.getElementById('btnOpenDnsSettings').addEventListener('click', async () => {
  try {
    if (AppManager) await AppManager.openNetworkSettings();
    else toast(t('toastOpenSettingsManualNetwork'));
  } catch (e) {
    toast(t('toastOpenSettingsFailedPrefix') + e.message, 'error');
  }
});

document.getElementById('btnOpenStorageSettings').addEventListener('click', async () => {
  try {
    if (AppManager) await AppManager.openStorageSettings();
    else toast(t('toastOpenSettingsManualStorage'));
  } catch (e) {
    toast(t('toastOpenStorageSettingsFailedPrefix') + e.message, 'error');
  }
});

// ════════════════════════════════════════
//  STORAGE INFO (Header)
// ════════════════════════════════════════
async function loadStorageInfo() {
  // Invalidate the Defrag tab's cached Internal Storage/RAM bars — every clean/delete flow
  // in the app calls loadStorageInfo() to refresh the header chip, but initDefrag() only
  // re-fetches once per visit (defragInit guard) unless told otherwise, so without this the
  // Defrag tab kept showing pre-clean numbers after cleaning from anywhere else.
  defragInit = false;
  let used = demo.storageUsed, total = demo.storageTotal;
  try {
    if (MemoryBooster) {
      const s = await MemoryBooster.getStorageStats();
      if (s.internalTotal > 0) { used = s.internalUsed; total = s.internalTotal; }
    }
  } catch(e) {}
  document.getElementById('storageUsed').textContent  = fmt(used);
  document.getElementById('storageTotal').textContent = fmt(total);
  const pct = Math.round(used / total * 100);
  document.getElementById('storageBar').style.width     = pct + '%';
  document.getElementById('storagePercent').textContent = pct + '%';
  const bar = document.getElementById('storageBar');
  if (pct > 85)      bar.style.background = 'linear-gradient(90deg,#c62828,#ff5252)';
  else if (pct > 70) bar.style.background = 'linear-gradient(90deg,#f57f17,#ffca28)';
  else               bar.style.background = 'linear-gradient(90deg,var(--green2),var(--blue))';
}

// ════════════════════════════════════════
//  ANDROID BACK BUTTON
// ════════════════════════════════════════
let _lastBackPress = 0;

window.handleBackButton = function handleBackButton() {
  // Priority 0 — tutup preview foto/video full-size
  const previewModal = document.getElementById('previewModal');
  if (!previewModal.classList.contains('hidden')) {
    closePreview();
    return;
  }

  // Priority 1 — tutup result panel (Before/After)
  const panel = document.getElementById('resultPanel');
  if (!panel.classList.contains('hidden')) {
    closeResultPanel();
    return;
  }

  // Priority 2 — tutup modal konfirmasi
  const modal = document.getElementById('modal');
  if (!modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    return;
  }

  // Priority 3 — collapse accordion Advanced yang terbuka
  const advKeys = ['wa', 'telegram', 'camera', 'dup', 'unused', 'ads',
                   'bigFile', 'apk', 'emptyFolder', 'download', 'screenRec', 'trash'];
  for (const key of advKeys) {
    const body = document.getElementById(key + 'Body');
    if (body && !body.classList.contains('hidden')) {
      toggleAdv(key);
      return;
    }
  }

  // Priority 4 — kembali ke tab Clean jika sedang di tab lain
  const active = document.querySelector('.section.active');
  if (active && active.id !== 'sec-clean') {
    document.querySelector('[data-sec="clean"]').click();
    return;
  }

  // Priority 5 — sudah di root → double-press untuk keluar
  const now = Date.now();
  if (now - _lastBackPress < 2000) {
    if (AppPlugin) AppPlugin.exitApp();
  } else {
    _lastBackPress = now;
    toast(t('toastPressBackAgain'));
  }
}

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
// Reporting-only per IntegrityGuard's design — a soft, dismissable warning, never a hard
// block, and only when this is neither a debug build nor the internal `unlocked` QA flavor
// (both flags come back from the native side itself so this can't accidentally fire during
// your own testing regardless of which build you're iterating on). No enforcement action
// beyond this toast exists yet — see DEVELOP.md for why going further needs a product
// decision, not just more code.
async function runIntegrityCheckSoftWarning() {
  if (!Security) return;
  try {
    const r = await Security.runIntegrityChecks();
    if (r.isDebugBuild || r.isUnlockedTestBuild) return;
    if (r.debuggerAttached || r.rooted || r.emulator || !r.signatureValid) {
      toast(t('integrityWarning'), 'error', 6000);
    }
  } catch (e) { /* best-effort — never block app usage over this */ }
}

// Cosmetic only — the real enforcement (block screen + self-uninstall prompt after the
// 14-day deadline) lives natively in MainActivity/TrialGuard and runs regardless of
// whether this ever gets to draw. This just gives testers a visible countdown.
async function showTrialBadge() {
  const badge = document.getElementById('trialExpiryBadge');
  if (!badge || !AppManager) return;
  try {
    const info = await AppManager.getBuildFlavor();
    if (!info || !info.isTimeLimitedBuild) return;
    badge.textContent = `BETA · ${info.trialDaysRemaining}h lagi`;
    badge.classList.remove('hidden');
  } catch (e) { /* not a time-limited build, or native call unavailable — leave hidden */ }
}

async function init() {
  setLang(currentLang); // applies static translations + syncs both toggle entry points
  isPro = await resolveInitialIsPro();
  setProState(isPro);
  await loadStorageInfo();
  runIntegrityCheckSoftWarning(); // fire-and-forget, must never delay init()
  showTrialBadge(); // fire-and-forget, must never delay init()
}

// Splash → App
function startApp() {
  setTimeout(async () => {
    // init() (incl. resolveInitialIsPro()'s native round-trip) runs BEFORE the splash starts
    // fading — otherwise the app could flash its default Free-tier lock state for a moment on
    // a fresh Pro-flavor install before the real flavor default lands.
    await init();
    const splash = document.getElementById('splash');
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
    }, 500);
  }, 2500);
}

// ════════════════════════════════════════
//  PRIVACY POLICY GATE (first launch — must accept before entering app)
// ════════════════════════════════════════
const PRIVACY_KEY = 'sc_privacy_accepted_v1';

async function loadPrivacyPolicyText() {
  const file = currentLang === 'en' ? 'privacy_policy_en.txt' : 'privacy_policy_id.txt';
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error('fetch failed');
    return await res.text();
  } catch (e) {
    return t('privacyLoadError');
  }
}

function renderPrivacyText(raw) {
  const body = document.getElementById('privacyBody');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  body.innerHTML = raw
    .trim()
    .split(/\n{2,}/)
    .map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function showPrivacyGate() {
  const screen = document.getElementById('privacyScreen');
  const check  = document.getElementById('privacyCheck');
  const btnOk  = document.getElementById('btnPrivacyAccept');
  const btnNo  = document.getElementById('btnPrivacyDecline');

  screen.classList.remove('hidden');
  renderPrivacyText(await loadPrivacyPolicyText());

  check.onchange = () => { btnOk.disabled = !check.checked; };

  btnNo.onclick = () => {
    if (AppPlugin) {
      AppPlugin.exitApp();
    } else {
      toast(t('privacyMustAccept'));
    }
  };

  btnOk.onclick = () => {
    if (!check.checked) return;
    localStorage.setItem(PRIVACY_KEY, '1');
    screen.classList.add('hidden');
    startApp();
  };
}

// ── Boot sequence ──
if (localStorage.getItem(PRIVACY_KEY) === '1') {
  startApp();
} else {
  showPrivacyGate();
}
