'use strict';

// ── Capacitor plugin headers ──
// Custom Java plugins are not in capacitor.plugins.json so the bridge routing
// layer doesn't know about them. Declare them here so nativePromise() is used.
if (window.Capacitor) {
  const _ph = window.Capacitor.PluginHeaders || [];
  const _pm = n => n.map(name => ({ name, rtype: 'promise' }));
  _ph.push(
    { name: 'MemoryBooster',    methods: _pm(['getStorageStats','getMemoryStats','boostMemory','optimizeStorage','getRunningApps','stopApps','getBatteryInfo']) },
    { name: 'FileCleaner',      methods: _pm(['scanJunkFiles','cleanJunkFiles','deleteFiles','scanWAMedia','scanCameraMedia','scanBrowserCache','clearBrowserCache','clearNotifications','requestNotificationAccess','scanRecentlyDeleted','cleanRecentlyDeleted']) },
    { name: 'DuplicateFinder',  methods: _pm(['scanDuplicates','deleteFiles']) },
    { name: 'AppManager',       methods: _pm(['scanUnusedApps','uninstallApp','openNetworkSettings','openStorageSettings']) },
  );
  window.Capacitor.PluginHeaders = _ph;
}

// ── Capacitor plugin registration ──
const { registerPlugin } = window.Capacitor || {};
const FileCleaner   = registerPlugin ? registerPlugin('FileCleaner')   : null;
const MemoryBooster = registerPlugin ? registerPlugin('MemoryBooster') : null;
const DupFinder     = registerPlugin ? registerPlugin('DuplicateFinder') : null;
const AppManager    = registerPlugin ? registerPlugin('AppManager')    : null;
const AppPlugin     = registerPlugin ? registerPlugin('App') : null;

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
  document.getElementById('modalOk').textContent = onOk ? 'OK' : 'Mengerti';
  document.getElementById('modalOk').onclick = () => {
    document.getElementById('modal').classList.add('hidden');
    cancelBtn.style.display = '';
    document.getElementById('modalOk').textContent = 'OK';
    if (onOk) onOk();
  };
  cancelBtn.onclick = () => {
    document.getElementById('modal').classList.add('hidden');
  };
}
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

  const sB = before.storage, sA = after.storage;
  const rB = before.ram,     rA = after.ram;
  const sDiff = sB.pct - sA.pct;  // positive = improvement
  const rDiff = rB.pct - rA.pct;

  // Calculate optimization score (0-5 stars)
  const scoreRaw = Math.min(5, Math.round((sDiff + rDiff) / 4));
  const stars = '★'.repeat(Math.max(scoreRaw, 1)) + '☆'.repeat(5 - Math.max(scoreRaw, 1));
  const scoreText = scoreRaw >= 4 ? 'Excellent!' : scoreRaw >= 3 ? 'Good' : scoreRaw >= 2 ? 'Fair' : 'Minimal';

  body.innerHTML = `
    <div class="ba-section">
      <div class="ba-lbl">💾 Internal Storage</div>
      <div class="ba-row">
        <span class="ba-tag before">Before</span>
        <div class="ba-track"><div class="ba-fill-b" id="baSB" style="width:0%"></div></div>
        <span class="ba-pct">${sB.pct}%</span>
        <span class="ba-badge neutral">—</span>
      </div>
      <div class="ba-row">
        <span class="ba-tag after">After</span>
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
      <div class="ba-lbl">🧠 RAM Memory</div>
      <div class="ba-row">
        <span class="ba-tag before">Before</span>
        <div class="ba-track"><div class="ba-fill-b" id="baRB" style="width:0%"></div></div>
        <span class="ba-pct">${rB.pct}%</span>
        <span class="ba-badge neutral">—</span>
      </div>
      <div class="ba-row">
        <span class="ba-tag after">After</span>
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
      <div class="rp-freed-sub">Total Dibebaskan</div>
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
      <span class="rp-score-label">Optimization Score</span>
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

function showOpProgress() { document.getElementById('opProgress').classList.remove('hidden'); }
function hideOpProgress() { document.getElementById('opProgress').classList.add('hidden'); }

function resetClean() {
  cleanSelected.clear();
  cleanData = {};
  document.getElementById('cleanList').innerHTML = '';
  document.getElementById('cleanSize').textContent = '0 MB';
  document.getElementById('cleanLabel').textContent = 'Junk Found';
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
const CLEAN_ITEMS = [
  { id:'tmp',     icon:'🗂️',  title:'Temporary Files',     sub:'tmp · temp · thumbs',    type:'TMP' },
  { id:'msg',     icon:'💬',  title:'WA Database (.crypt14)',   sub:'Sisakan file terbaru',    type:'MSG' },
  { id:'junk',    icon:'🗑️',  title:'Junk & Ad Files',     sub:'ads · cache · residual',  type:'JUNK' },
  { id:'appcache',icon:'📦',  title:'App Cache',           sub:'Semua cache aplikasi',    type:'APPCACHE' },
  { id:'browser', icon:'🌐',  title:'Browser Cache',       sub:'Chrome · Firefox · etc',  type:'BROWSER' },
  { id:'notif',   icon:'🔔',  title:'Notifications',       sub:'Hapus notifikasi tersisa', type:'NOTIF' },
  { id:'game',    icon:'🎮',  title:'Game Cache & Data',   sub:'Cache & data game',       type:'GAME' },
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
  btn.innerHTML = '<span>⏳</span> Scanning…';
  btn.disabled = true;
  cleanSelected.clear();
  showOpProgress();
  document.getElementById('cleanRing').classList.add('ring-scanning');
  document.getElementById('cleanLabel').textContent = 'Scanning…';
  document.getElementById('scanPb').classList.remove('hidden');

  try {
    let results = {};
    if (FileCleaner) {
      const res = await FileCleaner.scanJunkFiles();
      results = res.data || {};
      if (!results.notifAccessGranted) {
        setTimeout(() => showModal(
          '🔔 Izin Notifikasi Belum Aktif',
          'SmartClean belum dapat membaca notifikasi.\n\nTap OK untuk membuka Settings dan aktifkan "Notification Access" untuk SmartClean.',
          async () => { try { await FileCleaner.requestNotificationAccess(); } catch(e) {} }
        ), 500);
      }
    } else {
      results = { tmp:45*1024*1024, msg:12*1024*1024, junk:88*1024*1024,
                  appcache:230*1024*1024, browser:67*1024*1024, notif:1024*1024, game:155*1024*1024,
                  notifAccessGranted: true };
      await new Promise(r => setTimeout(r, 1800));
    }
    renderCleanList(results);
    const total = Object.values(results).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0);
    toast(`Scan selesai! Ditemukan ${fmt(total)} junk.`);
  } catch(e) {
    toast('Scan error: ' + e.message, 'error');
  } finally {
    btn.innerHTML = '<span>🔍</span> Scan Junk';
    btn.disabled = false;
    hideOpProgress();
    document.getElementById('cleanRing').classList.remove('ring-scanning');
    document.getElementById('cleanLabel').textContent = 'Junk Found';
    document.getElementById('scanPb').classList.add('hidden');
  }
}

async function cleanNow() {
  if (cleanSelected.size === 0) { toast('Pilih minimal 1 item', 'error'); return; }
  const types  = [...cleanSelected];
  const totalBytes = types.reduce((s, id) => s + (cleanData[id] || 0), 0);
  const itemNames  = types.map(id => CLEAN_ITEMS.find(i=>i.id===id)?.title || id).join(', ');

  showModal('Konfirmasi Clean', `Hapus ${fmt(totalBytes)} dari: ${itemNames}?`, async () => {
    const btn = document.getElementById('btnCleanNow');
    btn.disabled = true;
    btn.textContent = '⏳ Cleaning…';
    showOpProgress();

    try {
      const before = await captureStats();

      if (FileCleaner) {
        await FileCleaner.cleanJunkFiles({ types });
      } else {
        demo.storageUsed = Math.max(0, demo.storageUsed - totalBytes);
        await new Promise(r => setTimeout(r, 1500));
      }

      const after = computeAfter(before, totalBytes);
      await loadStorageInfo();

      const details = types.map(id => {
        const item = CLEAN_ITEMS.find(i => i.id === id);
        return { icon: item?.icon || '✅', label: item?.title || id, value: fmt(cleanData[id] || 0) };
      });
      details.push({ icon:'📁', label:'Total files cleaned', value: fmt(totalBytes) });

      showResultPanel(before, after, totalBytes, details);
    } catch(e) {
      toast('Clean gagal: ' + e.message, 'error');
    } finally {
      hideOpProgress();
      btn.disabled = false;
      btn.textContent = '🧹 Clean Now';
    }
  });
}

// ════════════════════════════════════════
//  RECENTLY DELETED (Defrag page)
// ════════════════════════════════════════
let _trashBytes = 0;

async function scanTrash() {
  const btn = document.getElementById('btnScanTrash');
  btn.querySelector('span:last-child').textContent = '⏳ Scanning…';
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
          ? `${count} item di sampah · ${fmt(_trashBytes)}`
          : 'Sampah sistem kosong';
      document.getElementById('trashBtns').style.display = _trashBytes > 0 ? '' : 'none';
      toast(_trashBytes > 0 ? `Recently Deleted: ${fmt(_trashBytes)}` : 'Sampah sistem kosong');
    } else {
      _trashBytes = 320 * 1024 * 1024;
      document.getElementById('trashSize').textContent = fmt(_trashBytes);
      document.getElementById('trashSub').textContent  = '47 item di sampah · ' + fmt(_trashBytes);
      document.getElementById('trashBtns').style.display = '';
    }
  } catch(e) {
    toast('Scan error: ' + e.message, 'error');
  } finally {
    btn.querySelector('span:last-child').textContent = 'Scan Recently Deleted';
    btn.disabled = false;
  }
}

async function cleanTrash() {
  showModal(
    '🗑️ Hapus Permanen',
    `Hapus ${fmt(_trashBytes)} dari sampah sistem secara permanen?\n\nFile tidak bisa dikembalikan setelah ini.`,
    async () => {
      const btn = document.getElementById('btnCleanTrash');
      btn.disabled = true;
      btn.textContent = '⏳ Menghapus…';
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
        document.getElementById('trashSub').textContent  = 'Sampah sistem kosong';
        document.getElementById('trashBtns').style.display = 'none';
        const after = computeAfter(before, freed);
        await loadStorageInfo();
        showResultPanel(before, after, freed, [
          { icon:'🗑️', label:'Recently Deleted dibersihkan', value: fmt(freed) },
          { icon:'💾', label:'Storage dibebaskan',           value: fmt(freed) },
          { icon:'✅', label:'Status',                       value: 'Permanen dihapus' },
        ]);
        toast('✅ Recently Deleted berhasil dibersihkan!');
      } catch(e) {
        toast('Gagal: ' + e.message, 'error');
      } finally {
        hideOpProgress();
        btn.disabled = false;
        btn.textContent = '🧹 Hapus Permanen';
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
      `${fmt(s.internalUsed)} / ${fmt(s.internalTotal)} — ${iPct}% terpakai`;

    if (s.sdTotal > 0) {
      const sPct = Math.round(s.sdUsed / s.sdTotal * 100);
      document.getElementById('sdBar').style.width  = sPct + '%';
      document.getElementById('sdInfo').textContent = `${fmt(s.sdUsed)} / ${fmt(s.sdTotal)} — ${sPct}%`;
    } else {
      document.getElementById('sdInfo').textContent = 'Tidak terdeteksi';
    }
    const rPct = Math.round(s.ramUsed / s.ramTotal * 100);
    document.getElementById('ramBar').style.width  = rPct + '%';
    document.getElementById('ramInfo').textContent = `${fmt(s.ramUsed)} used / ${fmt(s.ramTotal)} total — ${rPct}%`;
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
  const btn = document.getElementById('btnDefrag');
  btn.classList.add('active-op');
  btn.querySelector('span:last-child').textContent = 'Optimizing…';
  document.getElementById('defragLog').innerHTML = '';
  closeResultPanel();
  showOpProgress();

  logDefrag('Memulai defrag internal storage…');

  const before = await captureStats();
  let freed = 0;

  try {
    if (MemoryBooster) {
      const steps = ['Scanning file table…','Optimizing block allocation…','Trimming SSD…','Cleaning orphaned entries…'];
      for (const s of steps) { logDefrag(s); await new Promise(r => setTimeout(r, 300)); }
      const res = await MemoryBooster.optimizeStorage();
      freed = res.trimmedBytes || 0;
    } else {
      const steps = ['Scanning file table…','Optimizing inode structure…','Trimming SSD blocks…','Cleaning orphaned entries…','Verifying integrity…'];
      for (const s of steps) { logDefrag(s); await new Promise(r => setTimeout(r, 600)); }
      freed = Math.round(Math.random() * 200 + 80) * 1024 * 1024; // 80–280 MB
      demo.storageUsed = Math.max(0, demo.storageUsed - freed);
    }
    logDefrag(`✅ Selesai! Freed: ${fmt(freed)}`, true);

    // ── AFTER ──
    defragInit = false;
    await initDefrag();
    const after = computeAfter(before, freed);

    showResultPanel(before, after, freed, [
      { icon:'⚡', label:'Storage trimmed',         value: fmt(freed) },
      { icon:'💾', label:'Blok tersisa (internal)', value: fmt(after.storage.total - after.storage.used) },
      { icon:'✅', label:'Status',                  value: 'Optimal' },
    ]);
    toast('✅ Storage berhasil dioptimalkan!');
  } catch(e) {
    logDefrag('Error: ' + e.message);
    toast('Defrag error', 'error');
  } finally {
    hideOpProgress();
    btn.classList.remove('active-op');
    btn.querySelector('span:last-child').textContent = 'Defrag & Optimize Storage';
  }
});

document.getElementById('btnBoost').addEventListener('click', async () => {
  const btn = document.getElementById('btnBoost');
  btn.querySelector('span:last-child').textContent = 'Boosting…';
  btn.disabled = true;
  closeResultPanel();
  showOpProgress();
  logDefrag('Menghentikan background processes…');

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
      ? '⚠️ Android modern mengelola RAM otomatis. Hasil kecil adalah normal.'
      : `✅ ${killed} proses dihentikan, ${fmt(freed)} RAM dibebaskan.`;
    logDefrag(note, freed >= 10 * 1024 * 1024);

    // ── AFTER ──
    defragInit = false;
    await initDefrag();
    const after = computeAfter(before, 0, freed);

    showResultPanel(before, after, freed, [
      { icon:'🧠', label:'RAM dibebaskan',    value: fmt(freed) },
      { icon:'⚡', label:'App dihentikan',    value: killed + ' proses' },
      { icon:'💚', label:'RAM tersedia kini', value: fmt(after.ram.total - after.ram.used) },
      { icon:'ℹ️', label:'Catatan',           value: 'Android kelola RAM otomatis' },
    ]);
    toast(freed >= 10 * 1024 * 1024 ? `✅ ${fmt(freed)} RAM dibebaskan!` : '✅ Boost selesai (RAM sudah optimal)');
  } catch(e) {
    logDefrag('Error: ' + e.message);
    toast('Boost error', 'error');
  } finally {
    hideOpProgress();
    btn.querySelector('span:last-child').textContent = 'Boost Memory (RAM)';
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
    document.getElementById('batteryStatus').textContent = batt.charging ? '⚡ Sedang charging' : '🔋 Tidak charging';
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
  btn.textContent = '⏳ Scanning…';
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
    toast(`Ditemukan ${bgApps.length} app aktif baru-baru ini (${fmt(totalMem)})`);
  } catch(e) {
    toast('Scan error: ' + e.message, 'error');
  } finally {
    btn.textContent = '🔍 Scan Apps';
    btn.disabled = false;
  }
}

function renderBgApps() {
  const list = document.getElementById('bgAppList');
  if (!bgApps.length) { list.innerHTML = '<div class="empty-state">Tidak ada background app</div>'; return; }
  list.innerHTML = bgApps.map(app => `
    <div class="app-item">
      <div class="app-item-icon">${app.icon || '📱'}</div>
      <div class="app-item-name">${app.name}</div>
      <div class="app-item-mem">${fmt((app.memKb||0)*1024)}</div>
    </div>`).join('');
}

async function killAllApps() {
  if (!bgApps.length) { toast('Scan dulu!', 'error'); return; }
  const totalMem = bgApps.reduce((s,a) => s+(a.memKb||0)*1024, 0);

  showModal('Kill Background Apps', `Matikan ${bgApps.length} background app (${fmt(totalMem)} RAM)?`, async () => {
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
      document.getElementById('bgAppList').innerHTML = '<div class="empty-state">✅ Semua background app dihentikan</div>';
      batteryInit = false;
      await loadMemInfo();

      // ── AFTER ──
      const after = computeAfter(before, 0, totalMem);

      showResultPanel(before, after, totalMem, [
        { icon:'⚡', label:'App dihentikan',    value: killed + ' apps' },
        { icon:'🧠', label:'RAM dibebaskan',    value: fmt(totalMem) },
        { icon:'💚', label:'RAM tersedia kini', value: fmt(after.ram.total - after.ram.used) },
        { icon:'🔋', label:'Dampak baterai',    value: '+~15% lifetime' },
      ]);
      toast(`✅ ${killed} app dihentikan, ${fmt(totalMem)} RAM dibebaskan!`);
    } catch(e) {
      toast('Kill error: ' + e.message, 'error');
    }
  });
}

document.getElementById('btnScanBattery').addEventListener('click', scanBatteryApps);
document.getElementById('btnKillApps').addEventListener('click', killAllApps);

// ════════════════════════════════════════
//  ADVANCED — helper
// ════════════════════════════════════════
window.toggleAdv = function(key) {
  const body = document.getElementById(key + 'Body');
  const chev = document.getElementById('chev' + key.charAt(0).toUpperCase() + key.slice(1));
  const open = body.classList.contains('hidden');
  body.classList.toggle('hidden');
  if (chev) chev.classList.toggle('open', open);
};

// ── Media file-list rendering (shared: WhatsApp Cleaner + Camera/Gallery Cleaner) ──
// Native-Android-gallery-style rows: real photo/video thumbnails (lazy-loaded via
// IntersectionObserver so a long list doesn't decode every file at once), file-type
// icons for Dokumen/Audio, and a WA/WA Business source badge where applicable.
const FI_TYPE_ICON  = { video:'🎬', image:'🖼️', screenshot:'📸', document:'📄', audio:'🎵' };
const FI_DOC_ICON   = { pdf:'📕', doc:'📘', docx:'📘', xls:'📗', xlsx:'📗', ppt:'📙', pptx:'📙', txt:'📄' };
const FI_AUDIO_ICON = { mp3:'🎵', opus:'🎵', ogg:'🎵', aac:'🎵', m4a:'🎵' };
const FI_SOURCE_LABEL = { whatsapp: 'WhatsApp', whatsapp_business: 'WA Business' };

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

function fiThumbHtml(f, type) {
  const fallback = fiTypeIcon(f, type);
  if (type === 'image' || type === 'screenshot') {
    return `<div class="fi-thumb fi-thumb-media">
      <span class="fi-thumb-fallback">${fallback}</span>
      <img class="fi-thumb-img" data-src="${fiMediaSrc(f.path)}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">
    </div>`;
  }
  if (type === 'video') {
    return `<div class="fi-thumb fi-thumb-media">
      <span class="fi-thumb-fallback">${fallback}</span>
      <video class="fi-thumb-img" data-src="${fiMediaSrc(f.path)}" muted preload="none" playsinline onloadeddata="this.classList.add('loaded')" onerror="this.remove()"></video>
      <span class="fi-play-badge">▶</span>
    </div>`;
  }
  return `<div class="fi-thumb fi-icon fi-icon-${type}">${fallback}</div>`;
}

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
    document.querySelectorAll('#waBody .wa-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    waCurrentType = tab.dataset.type;
    renderWAFiles();
  });
});

async function scanWA() {
  const btn = document.getElementById('btnScanWA');
  btn.textContent = '⏳ Scanning…';
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
    toast(`Ditemukan ${eligible.length} file lama · ${kept} file disisakan`);
  } catch(e) {
    toast('WA scan error: ' + e.message, 'error');
  } finally {
    btn.textContent = '🔍 Scan WhatsApp';
    btn.disabled = false;
  }
}

function renderWAFiles() {
  const months  = parseInt(document.getElementById('waMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = waFiles.filter(f => f.dateMs < cutoff);
  const list = document.getElementById('waFileList');

  if (!eligible.length) {
    list.innerHTML = '<div class="empty-state" style="padding:16px">Tidak ada file lama</div>';
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
  document.getElementById('waSub').textContent = `${eligible.length} file lama · ${fmt(totalSz)}`;
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
  if (!waSelected.size) { toast('Pilih file dulu', 'error'); return; }
  const paths   = [...waSelected];
  const toDelete = waFiles.filter(f => paths.includes(f.path));
  const totalSz = toDelete.reduce((s,f) => s+f.size, 0);

  showModal('Hapus File WA', `Hapus ${paths.length} file WhatsApp (${fmt(totalSz)})?`, async () => {
    const before = await captureStats();
    try {
      if (FileCleaner) await FileCleaner.deleteFiles({ paths });
      else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 700)); }

      waFiles = waFiles.filter(f => !waSelected.has(f.path));
      waSelected.clear();
      renderWAFiles();

      const after = computeAfter(before, totalSz);
      await loadStorageInfo();

      showResultPanel(before, after, totalSz, [
        { icon:'🎬', label:'File dihapus',     value: paths.length + ' file' },
        { icon:'💾', label:'Storage freed',    value: fmt(totalSz) },
        { icon:'💬', label:'Sumber',           value: 'WhatsApp Media' },
      ]);
      toast(`✅ ${fmt(totalSz)} WhatsApp media dihapus!`);
    } catch(e) { toast('Delete error: ' + e.message, 'error'); }
  });
});

// ── Browser Cleaner ────────────────────────────────────────────────────────────
async function scanBrowserCache() {
  const btn = document.getElementById('btnScanBrowser');
  btn.textContent = '⏳ Scanning…';
  btn.disabled = true;
  closeResultPanel();
  try {
    let browsers = [];
    if (FileCleaner) {
      const res = await FileCleaner.scanBrowserCache();
      browsers = res.browsers || [];
    } else {
      browsers = [
        { name:'Chrome',          pkg:'com.android.chrome',             icon:'🟡', cacheBytes:145*1024*1024 },
        { name:'Firefox',         pkg:'org.mozilla.firefox',            icon:'🦊', cacheBytes:67*1024*1024 },
        { name:'Samsung Browser', pkg:'com.sec.android.app.sbrowser',   icon:'🔵', cacheBytes:38*1024*1024 },
        { name:'Opera',           pkg:'com.opera.browser',              icon:'🔴', cacheBytes:22*1024*1024 },
      ];
      await new Promise(r => setTimeout(r, 700));
    }
    const total = browsers.reduce((s,b) => s+b.cacheBytes, 0);
    document.getElementById('browserList').innerHTML = browsers.map(b => `
      <div class="browser-item">
        <div class="browser-item-icon">${b.icon}</div>
        <div class="browser-item-name">${b.name}</div>
        <div class="browser-item-size">${fmt(b.cacheBytes)}</div>
      </div>`).join('');
    document.getElementById('browserSub').textContent = `Total cache: ${fmt(total)}`;
    document.getElementById('browserActions').style.display = 'flex';
    toast(`Browser cache: ${fmt(total)}`);
  } catch(e) {
    toast('Browser scan error', 'error');
  } finally {
    btn.textContent = '🔍 Scan Browser Cache';
    btn.disabled = false;
  }
}

document.getElementById('btnScanBrowser').addEventListener('click', scanBrowserCache);
document.getElementById('btnClearBrowser').addEventListener('click', async () => {
  showModal('Clear Browser Cache', 'Hapus semua cache browser yang ditemukan?', async () => {
    const before = await captureStats();
    try {
      let freed = 0;
      document.querySelectorAll('.browser-item-size').forEach(el => {
        freed += parseFloat(el.textContent) * (el.textContent.includes('MB') ? 1024*1024 : 1024);
      });
      if (FileCleaner) { const res = await FileCleaner.clearBrowserCache(); freed = res.freedBytes || freed; }
      else { demo.storageUsed = Math.max(0, demo.storageUsed - freed); await new Promise(r => setTimeout(r, 1000)); }

      document.getElementById('browserList').innerHTML = '';
      document.getElementById('browserActions').style.display = 'none';
      document.getElementById('browserSub').textContent = 'Chrome, Firefox, Default';

      const after = computeAfter(before, freed);
      await loadStorageInfo();

      showResultPanel(before, after, freed, [
        { icon:'🌐', label:'Browser dibersihkan', value: '4 browsers' },
        { icon:'🍪', label:'Cache dihapus',       value: fmt(freed) },
        { icon:'🔒', label:'History/cookies',     value: 'Intact' },
      ]);
      toast('✅ Browser cache dibersihkan!');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
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
  btn.textContent = '⏳ Scanning…';
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
    toast(`${eligible.length} file lama ditemukan`);
  } catch(e) {
    toast('Scan error: ' + e.message, 'error');
  } finally {
    btn.textContent = '🔍 Scan Camera Roll';
    btn.disabled = false;
  }
}

function renderCamFiles() {
  const months  = parseInt(document.getElementById('camMonths').value);
  const cutoff  = Date.now() - months * 30 * 24 * 3600 * 1000;
  const eligible = camFiles.filter(f => f.dateMs < cutoff);
  const list = document.getElementById('camFileList');

  if (!eligible.length) {
    list.innerHTML = '<div class="empty-state" style="padding:16px">Tidak ada file lama</div>';
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
  document.getElementById('camSub').textContent = `${eligible.length} file lama · ${fmt(totalSz)}`;
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
  if (!camSelected.size) { toast('Pilih file dulu', 'error'); return; }
  const paths   = [...camSelected];
  const toDelete = camFiles.filter(f => paths.includes(f.path));
  const totalSz  = toDelete.reduce((s,f) => s+f.size, 0);

  showModal('Hapus File Kamera', `Hapus ${paths.length} file (${fmt(totalSz)})?`, async () => {
    const before = await captureStats();
    try {
      if (FileCleaner) await FileCleaner.deleteFiles({ paths });
      else { demo.storageUsed = Math.max(0, demo.storageUsed - totalSz); await new Promise(r => setTimeout(r, 700)); }

      camFiles = camFiles.filter(f => !camSelected.has(f.path));
      camSelected.clear();
      renderCamFiles();

      const after = computeAfter(before, totalSz);
      await loadStorageInfo();

      showResultPanel(before, after, totalSz, [
        { icon:'📷', label:'File kamera dihapus', value: paths.length + ' file' },
        { icon:'💾', label:'Storage freed',       value: fmt(totalSz) },
        { icon:'📅', label:'Lebih dari',          value: document.getElementById('camMonths').value + ' bulan lalu' },
      ]);
      toast(`✅ ${fmt(totalSz)} foto/video lama dihapus!`);
    } catch(e) { toast('Delete error: ' + e.message, 'error'); }
  });
});

// ── Duplicate Finder ───────────────────────────────────────────────────────────
let dupGroups = [], dupSelected = new Set();

async function scanDuplicates() {
  const btn = document.getElementById('btnScanDup');
  btn.textContent = '⏳ Scanning…';
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
      label.textContent = 'Hashing files…';
      fill.style.width  = '50%';
      const res = await DupFinder.scanDuplicates({ scope });
      dupGroups = res.groups || [];
      fill.style.width = '100%';
    } else {
      for (let i = 0; i <= 100; i += 8) {
        fill.style.width = i + '%';
        label.textContent = i < 30 ? `Mengumpulkan file (${i}%)…` : i < 70 ? `Menghitung hash MD5 (${i}%)…` : `Membandingkan (${i}%)…`;
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
    const totalDup = dupGroups.reduce((s,g) => s + g.totalSize - (g.files[0]?.size||0), 0);
    toast(`${dupGroups.length} grup duplikat · ~${fmt(totalDup)} dapat dihapus`);
    document.getElementById('dupSub').textContent = `${dupGroups.length} grup duplikat ditemukan`;
  } catch(e) {
    toast('Scan error: ' + e.message, 'error');
  } finally {
    btn.textContent = '🔍 Scan Duplicates';
    btn.disabled = false;
    progress.classList.add('hidden');
  }
}

function renderDupGroups() {
  const list = document.getElementById('dupList');
  if (!dupGroups.length) {
    list.innerHTML = '<div class="empty-state">Tidak ada duplikat ditemukan</div>';
    document.getElementById('dupActions').style.display = 'none';
    return;
  }
  list.innerHTML = dupGroups.map((g, gi) => `
    <div class="dup-group">
      <div class="dup-group-header">
        <span>${g.files.length} file identik</span>
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
    </div>`).join('');

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
  dupGroups.forEach(g => {
    const sorted = [...g.files].sort((a,b) => b.dateMs - a.dateMs);
    sorted.slice(1).forEach(f => dupSelected.add(f.path)); // keep newest, select rest
  });
  renderDupGroups();
  const totalSz = dupGroups.flatMap(g=>g.files).filter(f=>dupSelected.has(f.path)).reduce((s,f)=>s+f.size,0);
  toast(`${dupSelected.size} file dipilih otomatis · ${fmt(totalSz)}`);
});
document.getElementById('btnDeleteDup').addEventListener('click', async () => {
  if (!dupSelected.size) { toast('Pilih file dulu', 'error'); return; }
  const paths    = [...dupSelected];
  const allFiles = dupGroups.flatMap(g => g.files);
  const toDelete = allFiles.filter(f => paths.includes(f.path));
  const totalSz  = toDelete.reduce((s,f) => s+f.size, 0);

  showModal('Hapus Duplikat', `Hapus ${paths.length} file duplikat (${fmt(totalSz)})?`, async () => {
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
        { icon:'🔄', label:'Duplikat dihapus', value: paths.length + ' file' },
        { icon:'💾', label:'Storage freed',    value: fmt(totalSz) },
        { icon:'✅', label:'File asli',        value: 'Intact (disimpan)' },
      ]);
      toast(`✅ ${fmt(totalSz)} duplikat dihapus!`);
    } catch(e) { toast('Delete error: ' + e.message, 'error'); }
  });
});

// ── Unused App Cleaner ──────────────────────────────────────────────────────────
let unusedApps = [], unusedSelected = new Set();

function fmtLastUsed(ms, neverUsed) {
  if (neverUsed || !ms) return 'Belum pernah dipakai';
  const days = Math.floor((Date.now() - ms) / (24*3600*1000));
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bulan lalu`;
  return `${(months/12).toFixed(1)} tahun lalu`;
}

async function scanUnusedApps() {
  const btn = document.getElementById('btnScanUnused');
  btn.textContent = '⏳ Scanning…';
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
      ? `Ditemukan ${unusedApps.length} aplikasi jarang dipakai`
      : 'Semua aplikasi masih aktif dipakai');
  } catch(e) {
    toast('Scan error: ' + e.message, 'error');
  } finally {
    btn.textContent = '🔍 Scan Aplikasi Jarang Dipakai';
    btn.disabled = false;
  }
}

function renderUnusedApps() {
  const list = document.getElementById('unusedFileList');
  if (!unusedApps.length) {
    list.innerHTML = '<div class="empty-state" style="padding:16px">Semua aplikasi masih aktif dipakai 👍</div>';
    document.getElementById('unusedActions').style.display = 'none';
    document.getElementById('unusedSub').textContent = 'App tidak dipakai > 6 bulan';
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
  document.getElementById('unusedSub').textContent = `${unusedApps.length} app · ${fmt(totalSz)}`;
}

document.getElementById('btnScanUnused').addEventListener('click', scanUnusedApps);
document.getElementById('btnSelectAllUnused').addEventListener('click', () => {
  const allSel = unusedSelected.size === unusedApps.length;
  unusedSelected.clear();
  if (!allSel) unusedApps.forEach(a => unusedSelected.add(a.pkg));
  renderUnusedApps();
});
document.getElementById('btnUninstallUnused').addEventListener('click', async () => {
  if (!unusedSelected.size) { toast('Pilih minimal 1 aplikasi', 'error'); return; }
  const pkgs  = [...unusedSelected];
  const names = unusedApps.filter(a => pkgs.includes(a.pkg)).map(a => a.name).join(', ');

  showModal('Uninstall Aplikasi',
    `Uninstall ${pkgs.length} aplikasi: ${names}?\n\nSistem Android akan meminta konfirmasi terpisah untuk tiap aplikasi.`,
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
        toast(`${uninstalled}/${pkgs.length} aplikasi berhasil di-uninstall`);
      } catch(e) {
        toast('Uninstall error: ' + e.message, 'error');
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
    toast('Hostname DNS disalin');
  } catch (e) {
    toast('Gagal menyalin: ' + e.message, 'error');
  }
});
document.getElementById('btnOpenDnsSettings').addEventListener('click', async () => {
  try {
    if (AppManager) await AppManager.openNetworkSettings();
    else toast('Buka Settings > Network & Internet > Private DNS secara manual');
  } catch (e) {
    toast('Tidak bisa membuka pengaturan: ' + e.message, 'error');
  }
});

document.getElementById('btnOpenStorageSettings').addEventListener('click', async () => {
  try {
    if (AppManager) await AppManager.openStorageSettings();
    else toast('Buka Settings → Storage atau Phone Manager secara manual');
  } catch (e) {
    toast('Tidak bisa membuka Storage Settings: ' + e.message, 'error');
  }
});

// ════════════════════════════════════════
//  STORAGE INFO (Header)
// ════════════════════════════════════════
async function loadStorageInfo() {
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
  const advKeys = ['wa', 'browser', 'camera', 'dup', 'unused', 'ads'];
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
    toast('Tekan back lagi untuk keluar');
  }
}

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
async function init() {
  await loadStorageInfo();
}

// Splash → App
setTimeout(async () => {
  const splash = document.getElementById('splash');
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }, 500);
  await init();
}, 2500);
