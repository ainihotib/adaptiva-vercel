/**
 * ============================================================
 * ADAPTIVA — Frontend JavaScript (SPA)
 * Dipindah dari GAS HtmlService ke static site (GitHub Pages) — backend
 * ADAPTIVA sekarang dipanggil sebagai REST API lewat fetch(), bukan lagi
 * google.script.run. Lihat gsRun() di bawah.
 * ============================================================
 */

// Backend utama ADAPTIVA sekarang di Vercel (Node.js) — data tetap di Google Sheets yang sama,
// login lewat Google OAuth. GAS_URL lama disimpan sebagai GAS_LEGACY_URL khusus untuk fitur
// unduh Word/PDF Modul Ajar (eksporModulAjarKeDokumenPublic), yang tetap di Apps Script karena
// memakai DocumentApp yang tidak ada di Node.
const GAS_URL = '/api/rpc';
const GAS_LEGACY_URL = 'https://script.google.com/macros/s/AKfycbwT2qPQjm7YJVSAwwZ9IAJ_-emMXOgrQy-aaJDN0aSf3p-gqGNbCh6iyI7GckcQpdpI/exec';
// Client ID OAuth 2.0 Google untuk tombol "Login dengan Google" (lihat initGoogleSignIn()).
const GOOGLE_OAUTH_CLIENT_ID = '62768273455-6o47bioni469rc6nin0542pegni9prga.apps.googleusercontent.com';

const AppState = {
  profile: null,
  sessionToken: null,
  kelasId: null,
  asesmenId: null,
  chartInstances: {},
  bankCPTPCache: {},
  cptpListCache: []
};

const TIER_LABEL = { Mahir: 'Mahir (Paham Utuh)', Berkembang: 'Berkembang (Paham Sebagian)', PerluPendampingan: 'Perlu Pendampingan (Belum Paham)' };
const TIER_CLASS = { Mahir: 'tinggi', Berkembang: 'sedang', PerluPendampingan: 'rendah' };
const STATUS_CLASS = { Draft: 'draft', Diajukan: 'diajukan', Tervalidasi: 'tervalidasi', Dikembalikan: 'dikembalikan' };

// ════════════════════════════════════════════════════════
// MODE DEMO PUBLIK — dibuka lewat deployment terpisah (akses "Anyone",
// tanpa wajib akun Google), ditandai window.ADAPTIVA_MODE === 'demo'.
// Semua panggilan ke backend (gsRun) dicegat di sini dan dijawab dari data
// contoh (DEMO_FIXTURES) di sisi client — TIDAK PERNAH menyentuh Sheets asli.
// ════════════════════════════════════════════════════════
const DEMO_MODE = (typeof window !== 'undefined' && window.ADAPTIVA_MODE === 'demo');

const DEMO_FIXTURES = {
  getCurrentUserProfile: {
    ID: 'demo', Email: 'demo@adaptiva.my.id', Nama: 'Guru', Peran: 'Guru', PeranAsli: 'Guru',
    Sekolah: 'SD/MI Contoh', Status: 'Aktif', Sapaan: 'Bapak/Ibu'
  },
  getDashboardData: {
    jumlahSiswa: 20, jumlahKelas: 2, asesmenTerakhir: '2026-09-28', jumlahKelompok: 3, jumlahModul: 6,
    profilKesiapan: { Mahir: 7, Berkembang: 9, PerluPendampingan: 4 },
    distribusiMinat: { Tinggi: 11, Sedang: 6, Rendah: 3 },
    distribusiGaya: { Visual: 8, Auditori: 5, 'Baca-Tulis': 3, Kinestetik: 4 },
    statusModul: { Draft: 2, Diajukan: 1, Tervalidasi: 3 },
    insights: [
      'Total 20 siswa terdaftar di 2 kelas.',
      '4 siswa berada di kelompok Perlu Pendampingan — pertimbangkan scaffolding Level 1 (Environmental Provisions).',
      'Mayoritas siswa memiliki minat belajar IPAS kategori "Tinggi" (11 siswa).',
      'Gaya belajar dominan di kelas Anda: Visual (8 siswa).'
    ]
  }
};

function gsRunDemo_(fnName, args, onSuccess) {
  if (DEMO_FIXTURES.hasOwnProperty(fnName)) {
    setTimeout(() => (onSuccess || function(){})({ success: true, data: DEMO_FIXTURES[fnName], message: 'OK (mode demo)' }), 180);
    return;
  }
  // Fitur di luar daftar contoh (tambah/ubah/hapus data, generate AI, dll) dinonaktifkan di mode demo.
  showToast('Mode Demo', 'Fitur ini memakai data sungguhan sehingga dinonaktifkan pada tampilan demo publik. Hubungi Admin sekolah/madrasah Anda untuk akses penuh.', 'warning');
  setTimeout(() => (onSuccess || function(){})({ success: false, data: null, message: 'Bagian ini belum tersedia di tampilan demo.', _demo: true }), 180);
}

// Mode demo TETAP menampilkan halaman muka (landing) seperti biasa — pengunjung bisa baca-baca
// dulu (Tentang, Landasan Teori, Fitur, dst) sebelum masuk. Form email/password disembunyikan
// dan diganti satu tombol langsung ke Dashboard contoh — gsRun() sudah dicegat lewat DEMO_MODE
// di atas sehingga getCurrentUserProfile() otomatis menjawab dari DEMO_FIXTURES.
function initDemoMode() {
  const bar = document.createElement('div');
  bar.className = 'demo-mode-banner';
  bar.innerHTML = '<i class="bi bi-eye"></i> <b>Mode Demo</b> — Anda sedang melihat tampilan contoh ADAPTIVA dengan data dummy (bukan data sekolah sungguhan). Klik "Lihat Contoh Dashboard" untuk masuk.';
  document.body.prepend(bar);

  const form = document.querySelector('.login-form');
  if (form) form.style.display = 'none';
  const loginInfo = document.querySelector('.login-info');
  if (loginInfo) loginInfo.textContent = 'Ini mode demo publik — klik tombol di bawah untuk melihat contoh tampilan Dashboard dengan data dummy. Tidak perlu login.';
  const loginNote = document.querySelector('.login-note');
  if (loginNote) loginNote.innerHTML = '<i class="bi bi-info-circle"></i> Data contoh, tidak tersimpan';

  const card = document.querySelector('.login-card');
  const backLink = card ? card.querySelector('.login-back') : null;
  if (card && backLink) {
    const demoBtn = document.createElement('button');
    demoBtn.className = 'btn-adaptiva-primary login-submit-btn';
    demoBtn.innerHTML = '<i class="bi bi-eye"></i> Lihat Contoh Dashboard';
    demoBtn.onclick = enterDemoDashboard;
    card.insertBefore(demoBtn, backLink);
  }
}

function enterDemoDashboard() {
  gsRun('getCurrentUserProfile', [], res => {
    AppState.profile = res.data;
    enterAppAfterLogin();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('adaptiva_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const footerYearEl = document.getElementById('footerYear');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  if (window.ADAPTIVA_MODE === 'public') {
    initPublicForm();
  } else if (window.ADAPTIVA_MODE === 'demo') {
    initDemoMode();
  } else {
    // Mode 'app': kalau ada sesi login tersimpan (belum 6 jam, belum logout), lanjut
    // langsung ke Dashboard tanpa perlu login ulang setiap refresh halaman.
    let savedToken = null;
    try { savedToken = sessionStorage.getItem('adaptiva_session'); } catch (e) {}
    if (savedToken) {
      AppState.sessionToken = savedToken;
      gsRun('getCurrentUserProfile', [], res => {
        if (res.success) { AppState.profile = res.data; enterAppAfterLogin(); }
        else { AppState.sessionToken = null; try { sessionStorage.removeItem('adaptiva_session'); } catch (e2) {} }
      }, () => { AppState.sessionToken = null; });
    }
    // Kalau tidak ada sesi tersimpan, tetap di halaman muka (landing) — form Login
    // dijalankan lewat submitLogin() setelah pengguna isi email & password.
  }
});

// Google Identity Services memanggil fungsi ini otomatis setelah pengguna memilih akun Google
// di tombol "Sign in with Google" (lihat initGoogleSignIn() & markup tombol di index.html).
function handleGoogleCredentialResponse(response) {
  hideLoginError();
  const btnWrap = document.getElementById('googleSignInBtn');
  if (btnWrap) btnWrap.style.opacity = '0.6';

  gsRun('loginWithGoogle', [response.credential], res => {
    if (btnWrap) btnWrap.style.opacity = '1';
    if (!res.success) { showLoginError(res.message); return; }
    AppState.sessionToken = res.data.sessionToken;
    AppState.profile = res.data.user || res.data.profile;
    try { sessionStorage.setItem('adaptiva_session', res.data.sessionToken); } catch (e) {}
    enterAppAfterLogin();
  }, err => {
    if (btnWrap) btnWrap.style.opacity = '1';
    showLoginError((err && err.message) || 'Terjadi kesalahan. Coba lagi.');
  });
}

// Memuat & merender tombol Google Sign-In di dalam kartu login. Dipanggil saat kartu login
// ditampilkan (showLoginScreen) — library Google Identity Services (gsi/client) sudah dimuat
// lewat <script> di index.html.
function initGoogleSignIn() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    callback: handleGoogleCredentialResponse
  });
  const el = document.getElementById('googleSignInBtn');
  if (el) {
    el.innerHTML = '';
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 280, text: 'signin_with', locale: 'id' });
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginErrorMsg');
  if (!el) { showToast('Gagal', msg, 'danger'); return; }
  el.textContent = msg;
  el.style.display = 'block';
}
function hideLoginError() {
  const el = document.getElementById('loginErrorMsg');
  if (el) el.style.display = 'none';
}

// Dipanggil setelah login (akun sungguhan atau mode demo) berhasil — menyembunyikan
// halaman muka/login dan menampilkan SPA utama (sidebar + dashboard).
function enterAppAfterLogin() {
  const landing = document.getElementById('landingScreen');
  if (landing) landing.style.display = 'none';
  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'none';
  hideLoadingOverlay();
  document.getElementById('sidebar').style.display = 'flex';
  document.getElementById('mainContent').style.display = 'block';
  renderUserChip();
  renderSidebarNav();
  const savedTheme = localStorage.getItem('adaptiva_theme') || 'light';
  document.getElementById('darkModeToggle').checked = savedTheme === 'dark';
  navigateTo('dashboard');
}

// Dipanggil dari tombol "Keluar" di sidebar.
function logoutApp() {
  const token = AppState.sessionToken;
  AppState.sessionToken = null;
  AppState.profile = null;
  try { sessionStorage.removeItem('adaptiva_session'); } catch (e) {}
  if (!DEMO_MODE && token) gsRun('logoutUser', [token], () => {}, () => {});
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('mainContent').style.display = 'none';
  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'none';
  const landing = document.getElementById('landingScreen');
  if (landing) landing.style.display = '';
  showToast('Berhasil', 'Anda telah keluar.', 'success');
}

// Dipanggil dari tombol "Masuk" di navbar/hero halaman muka — menampilkan kartu login.
function showLoginScreen() {
  const landing = document.getElementById('landingScreen');
  if (landing) landing.style.display = 'none';
  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'flex';
  initGoogleSignIn();
}

// Dipanggil dari tautan "Kembali ke Halaman Beranda" pada kartu login.
function backToLandingFromLogin() {
  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'none';
  const landing = document.getElementById('landingScreen');
  if (landing) landing.style.display = '';
}

// Dipanggil dari halaman "Akses Ditolak" untuk kembali ke halaman muka.
function backToLanding() {
  document.getElementById('accessDeniedWrap').style.display = 'none';
  document.getElementById('accessDeniedWrap').innerHTML = '';
  const landing = document.getElementById('landingScreen');
  if (landing) landing.style.display = '';
}

// ── Halaman muka: tab "Alur Kerja" (Guru / Kepala Sekolah-Pengawas) ──
function switchAlurTab(role) {
  const guru = document.getElementById('alurStepsGuru');
  const kepsek = document.getElementById('alurStepsKepsek');
  if (guru) guru.style.display = role === 'guru' ? '' : 'none';
  if (kepsek) kepsek.style.display = role === 'kepsek' ? '' : 'none';
  document.querySelectorAll('.alur-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-role') === role);
  });
}

// ── Halaman muka: accordion "Panduan Penggunaan" ──
function toggleAccordion(headEl) {
  const item = headEl.closest('.landing-accordion-item');
  if (item) item.classList.toggle('open');
}

// ════════════════════════════════════════════════════════
// UTILITAS UMUM
// ════════════════════════════════════════════════════════

// Semua panggilan ke backend lewat satu dispatcher REST (fetch) ke GAS_URL (Vercel). Backend
// Vercel sudah menjawab preflight OPTIONS dengan header CORS yang benar, jadi Content-Type
// application/json aman dipakai di sini (beda dari versi GAS lama yang terpaksa pakai text/plain).
function gsRun(fnName, args, onSuccess, onError) {
  if (DEMO_MODE) { gsRunDemo_(fnName, args, onSuccess); return; }
  const onOk = onSuccess || function(){};
  const onErr = onError || function(err){ showToast('Error', (err && err.message) || String(err), 'danger'); };

  fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fnName: fnName, argsArray: args || [], sessionToken: AppState.sessionToken || '' })
  })
    .then(res => res.json())
    .then(res => onOk(res))
    .catch(err => onErr(err));
}

// Khusus fitur yang TETAP di GAS lama (unduh Word/PDF Modul Ajar) — sistem sesi berbeda
// dari backend Vercel, jadi dipanggil lewat email guru yang sedang login, bukan sessionToken.
function gsRunLegacy(fnName, args, onSuccess, onError) {
  const onOk = onSuccess || function(){};
  const onErr = onError || function(err){ showToast('Error', (err && err.message) || String(err), 'danger'); };
  fetch(GAS_LEGACY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fnName: fnName, argsArray: args || [] })
  })
    .then(res => res.json())
    .then(res => onOk(res))
    .catch(err => onErr(err));
}

function showToast(title, message, type) {
  type = type || 'info';
  const el = document.getElementById('appToast');
  if (!el) { alert(title + ': ' + message); return; }
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastBody').textContent = message;
  el.style.borderLeft = '4px solid ' + (type === 'danger' ? '#EF4444' : type === 'success' ? '#10B981' : '#00A896');
  new bootstrap.Toast(el, { delay: 4200 }).show();
}

function showLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="text-center py-5"><div class="spinner-border" style="color:#0F2942" role="status"></div><p class="mt-2 text-muted">Memuat data...</p></div>';
}

function esc(str) {
  return (str === null || str === undefined) ? '' : String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Aman disisipkan di dalam literal string JS ber-tanda-kutip-satu ('...')
// yang berada di dalam atribut HTML ber-tanda-kutip-dua (onclick="...").
function escJsAttr(str) {
  return (str === null || str === undefined) ? '' : String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function fmtDate(str) { return str || '-'; }

function openModal(title, bodyHtml, footerHtml) {
  document.getElementById('genericModalTitle').textContent = title;
  document.getElementById('genericModalBody').innerHTML = bodyHtml;
  document.getElementById('genericModalFooter').innerHTML = footerHtml || '';
  new bootstrap.Modal(document.getElementById('genericModal')).show();
}
function closeModal() {
  const m = bootstrap.Modal.getInstance(document.getElementById('genericModal'));
  if (m) m.hide();
}

function confirmDelete(fnName, id, afterFn, customMessage) {
  const modal = new bootstrap.Modal(document.getElementById('deleteModal'));
  const bodyEl = document.querySelector('#deleteModal .modal-body p');
  if (bodyEl) bodyEl.textContent = customMessage || 'Apakah Anda yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan.';
  document.getElementById('confirmDeleteBtn').onclick = () => {
    gsRun(fnName, [id], res => {
      modal.hide();
      if (res.success) { showToast('Berhasil', res.message, 'success'); if (afterFn) afterFn(); }
      else showToast('Gagal', res.message, 'danger');
    });
  };
  modal.show();
}

function toggleDarkMode() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('adaptiva_theme', next);
  const chk = document.getElementById('darkModeToggle');
  if (chk) chk.checked = next === 'dark';
  updateChartsTheme(next);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('show');
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.onclick = () => { document.getElementById('sidebar').classList.remove('show'); overlay.classList.remove('show'); };
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('show');
}

function toggleSubmenu(id) {
  document.getElementById(id).classList.toggle('open');
}

// ════════════════════════════════════════════════════════
// INISIALISASI APLIKASI (login email/password — lihat submitLogin/enterAppAfterLogin di atas)
// ════════════════════════════════════════════════════════

function hideLoadingOverlay() {
  const ov = document.getElementById('loadingOverlay');
  if (ov) { ov.style.opacity = '0'; setTimeout(() => ov.style.display = 'none', 250); }
}

function renderAccessDenied(message) {
  const wrap = document.getElementById('accessDeniedWrap');
  wrap.style.display = 'block';
  wrap.innerHTML = `
    <div class="access-denied">
      <div class="brand-icon mx-auto mb-3" style="width:56px;height:56px;border-radius:16px;background:#FF7A00;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.5rem;"><i class="bi bi-shield-lock"></i></div>
      <h5 class="fw-bold">Akses Ditolak</h5>
      <p class="text-muted">${esc(message)}</p>
      <button class="btn-adaptiva-secondary mt-2" onclick="backToLanding()"><i class="bi bi-arrow-left"></i> Kembali ke Halaman Utama</button>
    </div>`;
}

function renderUserChip() {
  const p = AppState.profile;
  document.getElementById('userAvatar').textContent = (p.Nama || '?').charAt(0).toUpperCase();
  document.getElementById('userNama').textContent = p.Nama;
  document.getElementById('userPeran').textContent = p.Peran + (p.Sekolah ? ' • ' + p.Sekolah : '');
  renderRoleSwitcher();
}

// Widget "Ganti Tampilan Role" — hanya muncul untuk akun Superadmin ASLI
// (dicek dari PeranAsli, bukan Peran yang sedang di-preview), supaya selalu
// bisa dipakai untuk kembali ke tampilan Superadmin kapan pun.
const ROLE_SWITCH_OPTIONS = [
  { value: '', label: 'Superadmin (asli)' },
  { value: 'Superadmin', label: 'Superadmin' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Guru', label: 'Guru' },
  { value: 'KepalaSekolah', label: 'Kepala Sekolah' }
];

function renderRoleSwitcher() {
  const wrap = document.getElementById('roleSwitcherWrap');
  if (!wrap) return;
  const p = AppState.profile;
  if (p.PeranAsli !== 'Superadmin') { wrap.innerHTML = ''; return; }

  const current = p.PeranPreview || '';
  const options = ROLE_SWITCH_OPTIONS.map(o =>
    `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`).join('');

  wrap.innerHTML = `
    <div class="mt-3">
      <label style="color:#8FA3BB; font-size:.72rem;"><i class="bi bi-person-gear"></i> Ganti Tampilan Role</label>
      <select class="form-select form-select-sm mt-1" onchange="gantiRolePreview(this.value)">${options}</select>
    </div>`;
}

function gantiRolePreview(roleBaru) {
  gsRun('setPeranPreview', [roleBaru], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    showToast('Berhasil', 'Tampilan role diganti. Memuat ulang...', 'success');
    setTimeout(() => location.reload(), 600);
  });
}

function renderSidebarNav() {
  const role = AppState.profile.Peran;
  let html = `<li><a href="javascript:void(0)" onclick="navigateTo('dashboard')" class="nav-link" data-section="dashboard"><i class="bi bi-speedometer2"></i><span>Dashboard</span></a></li>`;

  if (role === 'Guru') {
    html += navItem('kelasSaya', 'bi-mortarboard', 'Kelas Saya');
    html += navItem('asesmen', 'bi-clipboard-check', 'Asesmen Diagnostik');
    html += navItem('profilSiswa', 'bi-person-lines-fill', 'Profil Siswa');
    html += navItem('kelompokBelajar', 'bi-people', 'Kelompok Belajar');
    html += `<li>
      <a href="javascript:void(0)" onclick="toggleSubmenu('submenuPerencanaan')" class="nav-toggle">
        <i class="bi bi-diagram-3"></i><span>Perencanaan</span> <i class="bi bi-chevron-down ms-auto" style="font-size:.7rem"></i>
      </a>
      <ul class="sidebar-submenu" id="submenuPerencanaan">
        ${navItem('cpTp', '', 'CP & TP')}
        ${navItem('diferensiasi', '', 'Diferensiasi')}
        ${navItem('scaffolding', '', 'Scaffolding Planner')}
      </ul>
    </li>`;
    html += navItem('modulAjar', 'bi-file-earmark-richtext', 'Modul Ajar Saya');
    html += navItem('laporan', 'bi-bar-chart', 'Laporan & Monitoring');
  }
  if (role === 'KepalaSekolah') {
    html += navItem('validasi', 'bi-patch-check', 'Validasi Modul Ajar');
    html += navItem('laporan', 'bi-bar-chart', 'Laporan & Monitoring');
  }
  if (role === 'Admin' || role === 'Superadmin') {
    html += navItem('akun', 'bi-people', 'Kelola Akun');
    html += navItem('bankReferensi', 'bi-bank', 'Bank Referensi');
    html += navItem('laporan', 'bi-bar-chart', 'Laporan & Monitoring');
    html += navItem('pengaturan', 'bi-gear', 'Pengaturan');
  }
  document.getElementById('sidebarNav').innerHTML = html;
}

function navItem(section, icon, label) {
  return `<li><a href="javascript:void(0)" onclick="navigateTo('${section}')" class="nav-link" data-section="${section}">${icon ? '<i class="bi ' + icon + '"></i>' : ''}<span>${label}</span></a></li>`;
}

function navigateTo(sectionId) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('section-' + sectionId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.toggle('active', l.dataset.section === sectionId));
  document.getElementById('pageTitleMobile').textContent = sectionId;
  document.getElementById('sidebar').classList.remove('show');
  const overlay = document.querySelector('.sidebar-overlay'); if (overlay) overlay.classList.remove('show');

  const loaders = {
    dashboard: loadDashboard, kelasSaya: loadKelasSaya, asesmen: loadAsesmenSection,
    profilSiswa: loadProfilSiswaSection, kelompokBelajar: loadKelompokBelajarSection,
    cpTp: loadCPTPSection, diferensiasi: loadDiferensiasiSection, scaffolding: loadScaffoldingSection,
    modulAjar: loadModulAjarSection, validasi: loadValidasiSection, bankReferensi: loadBankReferensiSection,
    laporan: loadLaporan, akun: loadAkunSection, pengaturan: loadPengaturanSection
  };
  if (loaders[sectionId]) loaders[sectionId]();
  updateLanjutkanButton(sectionId);
}

// ════════════════════════════════════════════════════════
// TOMBOL "LANJUTKAN" (revisi masukan promotor, 20 Okt 2026)
// Jalur navigasi tambahan di samping sidebar bebas: tombol mengambang di pojok
// kanan bawah yang membawa Guru maju mengikuti urutan alur kerja ADAPTIVA, dengan
// gerbang konfirmasi "Apakah Anda yakin ingin menyimpan hasil ini?" sebelum pindah
// ke bagian berikutnya. Sidebar tetap bisa diklik bebas seperti biasa — ini jalur
// tambahan, bukan pengganti.
// ════════════════════════════════════════════════════════
const PIPELINE_ORDER = ['kelasSaya', 'asesmen', 'profilSiswa', 'kelompokBelajar', 'cpTp', 'diferensiasi', 'scaffolding', 'modulAjar'];
const PIPELINE_LABEL = {
  kelasSaya: 'Kelas Saya', asesmen: 'Asesmen Diagnostik', profilSiswa: 'Profil Siswa',
  kelompokBelajar: 'Kelompok Belajar', cpTp: 'CP & TP', diferensiasi: 'Diferensiasi',
  scaffolding: 'Scaffolding Planner', modulAjar: 'Modul Ajar Saya'
};

function updateLanjutkanButton(sectionId) {
  const btn = document.getElementById('btnLanjutkanFloating');
  if (!btn) return;
  const role = AppState.profile ? AppState.profile.Peran : null;
  const idx = PIPELINE_ORDER.indexOf(sectionId);
  if (role !== 'Guru' || idx === -1 || idx === PIPELINE_ORDER.length - 1) {
    btn.style.display = 'none';
    return;
  }
  const next = PIPELINE_ORDER[idx + 1];
  btn.dataset.next = next;
  btn.innerHTML = 'Lanjutkan ke ' + esc(PIPELINE_LABEL[next]) + ' <i class="bi bi-arrow-right ms-1"></i>';
  btn.style.display = '';
}

function klikLanjutkan() {
  const btn = document.getElementById('btnLanjutkanFloating');
  if (!btn || !btn.dataset.next) return;
  new bootstrap.Modal(document.getElementById('lanjutModal')).show();
}

function konfirmasiLanjutkanYa() {
  const modalEl = document.getElementById('lanjutModal');
  const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
  modal.hide();
  const btn = document.getElementById('btnLanjutkanFloating');
  const next = btn ? btn.dataset.next : null;
  if (next) {
    showToast('Tersimpan', 'Hasil pada bagian ini sudah disimpan. Melanjutkan ke ' + PIPELINE_LABEL[next] + '.', 'success');
    navigateTo(next);
  }
}
// Tombol "Tidak" di modal konfirmasi tidak perlu fungsi khusus — cukup tutup modal
// (data-bs-dismiss="modal" di Index.html), pengguna otomatis tetap di bagian yang
// belum disetujui karena belum ada perpindahan section yang terjadi.

// ════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════

function loadDashboard() {
  showLoading('section-dashboard');
  gsRun('getDashboardData', [], res => {
    if (!res.success) { showToast('Error', res.message, 'danger'); return; }
    renderDashboard(res.data);
  });
}

function loadLaporan() {
  showLoading('section-laporan');
  gsRun('getLaporanData', [], res => {
    if (!res.success) { showToast('Error', res.message, 'danger'); return; }
    renderLaporan(res.data);
  });
}

function renderDashboard(data) {
  const role = AppState.profile.Peran;
  let statCards = '', chartBlock = '', insightBlock = `
    <div class="insight-card"><h6><i class="bi bi-lightbulb"></i> Analisis ADAPTIVA</h6>
      <ul>${(data.insights || []).map(i => '<li>' + esc(i) + '</li>').join('')}</ul>
    </div>`;

  if (role === 'Guru') {
    statCards = [
      statCard('bi-people', data.jumlahSiswa, 'Total Siswa'),
      statCard('bi-clipboard-check', data.asesmenTerakhir, 'Asesmen Terakhir'),
      statCard('bi-diagram-3', data.jumlahKelompok, 'Kelompok Belajar'),
      statCard('bi-file-earmark-richtext', data.jumlahModul, 'Modul Ajar')
    ].join('');
    chartBlock = `
      <div class="col-12"><div class="page-eyebrow mb-0">Hasil asesmen diagnostik</div><div style="font-weight:800;color:var(--primary);font-size:1.05rem;margin-bottom:.25rem;">Profil Kesiapan, Minat &amp; Gaya Belajar Siswa</div></div>
      <div class="col-md-4">
        <div class="card chart-card"><h6 class="mb-1"><i class="bi bi-speedometer2 text-accent"></i> Kesiapan Belajar</h6><p class="text-muted small mb-2">Hasil asesmen kognitif</p>
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartKesiapan"></canvas></div></div>
      </div>
      <div class="col-md-4">
        <div class="card chart-card"><h6 class="mb-1"><i class="bi bi-heart text-accent"></i> Minat Belajar IPAS</h6><p class="text-muted small mb-2">Hasil asesmen minat</p>
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartMinat"></canvas></div></div>
      </div>
      <div class="col-md-4">
        <div class="card chart-card"><h6 class="mb-1"><i class="bi bi-palette text-accent"></i> Gaya Belajar Dominan</h6><p class="text-muted small mb-2">Hasil asesmen gaya belajar (VARK)</p>
        <div class="chart-wrap chart-wrap-sm"><canvas id="chartGaya"></canvas></div></div>
      </div>
      <div class="col-12">${insightBlock}</div>`;
  } else if (role === 'KepalaSekolah') {
    statCards = [
      statCard('bi-inbox', data.totalDiajukan, 'Total Diajukan'),
      statCard('bi-hourglass-split', data.menungguValidasi, 'Menunggu Validasi')
    ].join('');
    chartBlock = `<div class="col-md-7"><div class="card"><h6 class="mb-3">Status Modul Ajar</h6><div class="chart-wrap"><canvas id="chartKelompok"></canvas></div></div></div><div class="col-md-5">${insightBlock}</div>`;
    data._chartSource = data.statusCount;
  } else {
    statCards = [
      statCard('bi-person-workspace', data.totalGuru, 'Guru Terdaftar (maks. 100)'),
      statCard('bi-building', data.totalKepsek, 'Kepala Sekolah/Pengawas'),
      statCard('bi-file-earmark-richtext', data.totalModul, 'Total Modul Ajar')
    ].join('');
    chartBlock = `<div class="col-md-7"><div class="card"><h6 class="mb-3">Status Modul Ajar (Semua Guru)</h6><div class="chart-wrap"><canvas id="chartKelompok"></canvas></div></div></div><div class="col-md-5">${insightBlock}</div>`;
    data._chartSource = data.statusCount;
  }

  const sapaanNama = (AppState.profile.Sapaan ? esc(AppState.profile.Sapaan) + ' ' : '') + esc(AppState.profile.Nama);
  const heroDashboard = `
    <div class="hero-banner">
      <div class="page-eyebrow">Selamat datang</div>
      <div class="page-title">Halo, ${sapaanNama} 👋</div>
      <div class="page-subtitle">Ringkasan perencanaan pembelajaran adaptif Anda hari ini.</div>
    </div>`;
  const body = `
    <div class="row g-3 mb-3">${statCards.split('').length ? statCards : ''}</div>
    <div class="row g-3">${chartBlock}</div>`;

  document.getElementById('section-dashboard').innerHTML = heroDashboard + body;

  if (role === 'Guru') {
    renderChart('chartKesiapan', data.profilKesiapan, 'doughnut');
    renderChart('chartMinat', data.distribusiMinat, 'bar');
    renderChart('chartGaya', data.distribusiGaya, 'pie');
  } else {
    renderChart('chartKelompok', data.statusCount, 'doughnut');
  }
}

// ════════════════════════════════════════════════════════
// LAPORAN & MONITORING — beda dari Dashboard: ini riwayat/progres dari waktu
// ke waktu (kelengkapan asesmen, riwayat Modul Ajar) dan status proses
// validasi, bukan sekadar potret kondisi terkini.
// ════════════════════════════════════════════════════════

function renderLaporan(data) {
  const role = AppState.profile.Peran;
  const sapaanNama = (AppState.profile.Sapaan ? esc(AppState.profile.Sapaan) + ' ' : '') + esc(AppState.profile.Nama);
  const headerLaporan = `
    <div class="page-eyebrow">Laporan &amp; monitoring</div>
    <div class="page-title">Halo, ${sapaanNama} 👋</div>
    <div class="page-subtitle">Riwayat progres dan status validasi — pelengkap Dashboard yang menampilkan kondisi terkini.</div>`;

  let body = '';
  if (role === 'Guru') body = renderLaporanGuru(data);
  else if (role === 'KepalaSekolah') body = renderLaporanKepsek(data);
  else body = renderLaporanAdmin(data);

  document.getElementById('section-laporan').innerHTML = headerLaporan + body;
}

function renderLaporanGuru(data) {
  const kelasBlocks = (data.kelasReport || []).map(kelas => {
    const rows = (kelas.asesmenReport || []).map(a => {
      const tierBadges = ['Mahir', 'Berkembang', 'PerluPendampingan'].map(t =>
        `<span class="badge-tier ${TIER_CLASS[t]} me-1">${TIER_LABEL[t].split(' ')[0]}: ${a.tierCount[t] || 0}</span>`).join('');
      return `<tr>
        <td>${esc(a.judul)}<br><small class="text-muted">${esc(a.tanggal)}</small></td>
        <td style="min-width:160px;">
          <div class="progress" style="height:8px;"><div class="progress-bar" role="progressbar" style="width:${a.persenLengkap}%;background:var(--teal);"></div></div>
          <small class="text-muted">${a.jumlahSudahIsi}/${a.totalSiswa} siswa (${a.persenLengkap}%)</small>
        </td>
        <td>${tierBadges || '<span class="text-muted small">Belum ada kelompok</span>'}</td>
      </tr>`;
    }).join('');
    return `<div class="card mb-3"><div class="card-body">
      <h6 class="mb-3"><i class="bi bi-people"></i> ${esc(kelas.namaKelas)} <small class="text-muted">(${esc(kelas.fase)} · ${kelas.totalSiswa} siswa)</small></h6>
      ${rows ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Asesmen</th><th>Kelengkapan Pengisian</th><th>Distribusi Kelompok</th></tr></thead><tbody>${rows}</tbody></table></div>`
             : '<p class="text-muted small mb-0">Belum ada asesmen diagnostik di kelas ini.</p>'}
    </div></div>`;
  }).join('') || '<p class="text-muted">Belum ada kelas.</p>';

  const modulRows = (data.riwayatModul || []).map(m => `<tr>
      <td>${esc(m.namaKelas)}</td><td>${esc(m.materi)}</td>
      <td><span class="badge-status ${STATUS_CLASS[m.status] || 'draft'}">${esc(m.status)}</span></td>
      <td>${esc(m.tanggal)}</td>
      <td class="small text-muted">${esc(m.catatanValidasi || '-')}</td>
    </tr>`).join('');

  return `
    <div class="page-eyebrow mt-2 mb-2">Kelengkapan asesmen &amp; riwayat kelompok belajar</div>
    ${kelasBlocks}
    <div class="page-eyebrow mt-4 mb-2">Riwayat Modul Ajar</div>
    <div class="card"><div class="card-body">
      ${modulRows ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Kelas</th><th>Materi</th><th>Status</th><th>Tanggal</th><th>Catatan Validator</th></tr></thead><tbody>${modulRows}</tbody></table></div>`
                  : '<p class="text-muted small mb-0">Belum ada Modul Ajar yang dibuat.</p>'}
    </div></div>`;
}

function renderLaporanKepsek(data) {
  const sc = data.statusCount || {};
  const statCards = [
    statCard('bi-hourglass-split', sc['Diajukan'] || 0, 'Menunggu Validasi'),
    statCard('bi-check-circle', sc['Tervalidasi'] || 0, 'Tervalidasi'),
    statCard('bi-arrow-counterclockwise', sc['Dikembalikan'] || 0, 'Dikembalikan'),
    statCard('bi-stopwatch', data.rataWaktuValidasiJam !== null && data.rataWaktuValidasiJam !== undefined ? data.rataWaktuValidasiJam + ' jam' : '-', 'Rata-rata Waktu Validasi')
  ].join('');

  const perGuruRows = (data.perGuru || []).map(g => `<tr>
      <td>${esc(g.namaGuru)}</td><td>${g.total}</td>
      <td><span class="badge-status diajukan">${g.menunggu}</span></td>
      <td><span class="badge-status tervalidasi">${g.tervalidasi}</span></td>
      <td><span class="badge-status dikembalikan">${g.dikembalikan}</span></td>
    </tr>`).join('');

  const menungguRows = (data.menungguLama || []).map(m => `<tr>
      <td>${esc(m.namaGuru)}</td><td>${esc(m.materi)}</td><td>${esc(m.tanggal)}</td>
      <td>${m.hariMenunggu <= 2 ? m.hariMenunggu : `<b class="text-danger">${m.hariMenunggu}</b>`} hari</td>
    </tr>`).join('');

  return `
    <div class="row g-3 mb-3">${statCards}</div>
    <div class="page-eyebrow mt-2 mb-2">Rekap per guru</div>
    <div class="card mb-3"><div class="card-body">
      ${perGuruRows ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Guru</th><th>Total Diajukan</th><th>Menunggu</th><th>Tervalidasi</th><th>Dikembalikan</th></tr></thead><tbody>${perGuruRows}</tbody></table></div>`
                    : '<p class="text-muted small mb-0">Belum ada Modul Ajar yang diajukan ke Anda.</p>'}
    </div></div>
    <div class="page-eyebrow mt-4 mb-2">Menunggu validasi terlama</div>
    <div class="card"><div class="card-body">
      ${menungguRows ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Guru</th><th>Materi</th><th>Tanggal Diajukan</th><th>Lama Menunggu</th></tr></thead><tbody>${menungguRows}</tbody></table></div>`
                     : '<p class="text-muted small mb-0">Tidak ada Modul Ajar yang sedang menunggu validasi.</p>'}
    </div></div>`;
}

function renderLaporanAdmin(data) {
  const statCards = [
    statCard('bi-person-workspace', data.totalGuru, 'Total Guru'),
    statCard('bi-person-check', data.guruAktif, 'Guru Aktif'),
    statCard('bi-clipboard-check', data.totalAsesmen, 'Total Asesmen Dibuat'),
    statCard('bi-file-earmark-richtext', data.totalModul, 'Total Modul Ajar')
  ].join('');

  const sekolahRows = (data.perSekolah || []).map(s => `<tr>
      <td>${esc(s.sekolah)}</td><td>${s.jumlahGuru}</td><td>${s.jumlahAsesmen}</td><td>${s.jumlahModul}</td>
    </tr>`).join('');

  const guruRows = (data.perGuru || []).map(g => `<tr>
      <td>${esc(g.nama)}</td><td class="small text-muted">${esc(g.sekolah || '-')}</td>
      <td>${g.jumlahKelas}</td><td>${g.jumlahAsesmen}</td><td>${g.jumlahModul}</td>
      <td class="small">${esc(g.aktivitasTerakhir)}</td>
      <td>${g.aktif ? '<span class="badge-status tervalidasi">Aktif</span>' : '<span class="badge-status draft">Belum aktif</span>'}</td>
    </tr>`).join('');

  return `
    <div class="row g-3 mb-3">${statCards}</div>
    <div class="page-eyebrow mt-2 mb-2">Rekap per sekolah/madrasah</div>
    <div class="card mb-3"><div class="card-body">
      ${sekolahRows ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Sekolah/Madrasah</th><th>Jumlah Guru</th><th>Asesmen Dibuat</th><th>Modul Ajar</th></tr></thead><tbody>${sekolahRows}</tbody></table></div>`
                    : '<p class="text-muted small mb-0">Belum ada data sekolah.</p>'}
    </div></div>
    <div class="page-eyebrow mt-4 mb-2">Rekap pemakaian per guru</div>
    <div class="card"><div class="card-body">
      ${guruRows ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Nama</th><th>Sekolah</th><th>Kelas</th><th>Asesmen</th><th>Modul</th><th>Aktivitas Terakhir</th><th>Status</th></tr></thead><tbody>${guruRows}</tbody></table></div>`
                 : '<p class="text-muted small mb-0">Belum ada guru terdaftar.</p>'}
    </div></div>`;
}

function statCard(icon, value, label) {
  return `<div class="col-6 col-md-3"><div class="stat-card"><div class="stat-icon"><i class="bi ${icon}"></i></div><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div></div>`;
}

// type: 'doughnut' | 'pie' | 'bar' — dipilih sesuai karakter data (lihat pemanggilan di renderDashboard).
function renderChart(canvasId, dataObj, type) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (AppState.chartInstances[canvasId]) AppState.chartInstances[canvasId].destroy();
  const labels = Object.keys(dataObj || {});
  const values = Object.values(dataObj || {});
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const palette = ['#00A896', '#F59E0B', '#EF4444', '#0F2942', '#6366F1', '#EC4899'];
  const isBar = type === 'bar';
  const textColor = isDark ? '#E9EEF3' : '#181C1F';
  const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(15,41,66,.08)';

  if (!labels.length) {
    ctx.parentElement.insertAdjacentHTML('beforeend', '<p class="text-muted small text-center mt-4 chart-empty-note">Belum ada data asesmen.</p>');
    return;
  }

  AppState.chartInstances[canvasId] = new Chart(ctx, {
    type: isBar ? 'bar' : type,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: isBar ? palette[0] : palette,
        borderWidth: 0,
        borderRadius: isBar ? 8 : 0,
        maxBarThickness: 40
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: type === 'doughnut' ? '62%' : undefined,
      indexAxis: isBar ? 'y' : 'x',
      plugins: {
        legend: { display: !isBar, position: 'bottom', labels: { color: textColor, boxWidth: 12, padding: 12, font: { size: 11 } } }
      },
      scales: isBar ? {
        x: { beginAtZero: true, ticks: { color: textColor, precision: 0, font: { size: 11 } }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } }
      } : undefined
    }
  });
}

function updateChartsTheme(theme) {
  const color = theme === 'dark' ? '#E9EEF3' : '#181C1F';
  const grid = theme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(15,41,66,.08)';
  Object.values(AppState.chartInstances).forEach(c => {
    if (c.options.plugins && c.options.plugins.legend && c.options.plugins.legend.labels) c.options.plugins.legend.labels.color = color;
    if (c.options.scales) {
      if (c.options.scales.x) { c.options.scales.x.ticks.color = color; if (c.options.scales.x.grid) c.options.scales.x.grid.color = grid; }
      if (c.options.scales.y) c.options.scales.y.ticks.color = color;
    }
    c.update();
  });
}

// ════════════════════════════════════════════════════════
// SELECTOR KELAS (dipakai di banyak section)
// ════════════════════════════════════════════════════════

function renderKelasSelectorInto(containerId, onChangeFn) {
  gsRun('getKelasSaya', [], res => {
    const kelasList = res.data || [];
    if (!kelasList.find(k => k.ID === AppState.kelasId)) AppState.kelasId = kelasList.length ? kelasList[0].ID : null;
    const options = kelasList.map(k => `<option value="${k.ID}" ${k.ID === AppState.kelasId ? 'selected' : ''}>${esc(k.NamaKelas)} (${esc(k.Fase)})</option>`).join('');
    document.getElementById(containerId).innerHTML = kelasList.length
      ? `<select class="form-select" style="max-width:280px;display:inline-block;" onchange="AppState.kelasId=this.value; (${onChangeFn})()">${options}</select>`
      : `<span class="text-muted small">Belum ada kelas. Buat dulu di menu <b>Kelas Saya</b>.</span>`;
    // Panggil langsung agar konten section termuat tanpa menunggu perubahan manual
    if (onChangeFn && typeof window[onChangeFn] === 'function') window[onChangeFn]();
  });
}

// ════════════════════════════════════════════════════════
// KELAS SAYA
// ════════════════════════════════════════════════════════

function loadKelasSaya() {
  showLoading('section-kelasSaya');
  gsRun('getKelasSaya', [], res => renderKelasSaya(res.data || []));
}

function renderKelasSaya(list) {
  const rows = list.map(k => `
    <tr>
      <td>${esc(k.NamaKelas)}</td><td>${esc(k.Fase)}</td><td>${esc(k.TahunAjaran)}</td>
      <td>
        <button class="btn btn-sm btn-adaptiva-ghost" onclick="openSiswaManager('${k.ID}','${esc(k.NamaKelas)}')"><i class="bi bi-people"></i> Siswa</button>
        <button class="btn btn-sm btn-adaptiva-ghost" onclick="editKelas('${k.ID}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm text-danger" onclick="confirmDelete('hapusKelas','${k.ID}', loadKelasSaya)"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('');

  document.getElementById('section-kelasSaya').innerHTML = `
    <div class="card-header-flex">
      <div><div class="page-eyebrow">Master Data</div><div class="page-title" style="margin-bottom:0">Kelas Saya</div></div>
      <button class="btn btn-adaptiva-primary" onclick="editKelas(null)"><i class="bi bi-plus-lg"></i> Tambah Kelas</button>
    </div>
    <div class="table-responsive"><table class="table">
      <thead><tr><th>Nama Kelas</th><th>Fase</th><th>Tahun Ajaran</th><th>Aksi</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="text-center text-muted py-4">Belum ada kelas.</td></tr>'}</tbody>
    </table></div>`;
}

function editKelas(id) {
  const isEdit = !!id;
  const data = isEdit ? (getAllDataCacheFind('Kelas', id) || {}) : {};
  const body = `
    <input type="hidden" id="fKelasId" value="${esc(id || '')}">
    <div class="mb-3"><label class="form-label">Nama Kelas</label><input class="form-control" id="fNamaKelas" value="${esc(data.NamaKelas)}" placeholder="Contoh: Kelas 4A"></div>
    <div class="mb-3"><label class="form-label">Fase</label>
      <select class="form-select" id="fFase">
        ${['A','B','C'].map(f => `<option value="Fase ${f}" ${data.Fase === 'Fase ' + f ? 'selected' : ''}>Fase ${f}</option>`).join('')}
      </select></div>
    <div class="mb-3"><label class="form-label">Tahun Ajaran</label><input class="form-control" id="fTahunAjaran" value="${esc(data.TahunAjaran || '2025/2026')}"></div>`;
  openModal(isEdit ? 'Edit Kelas' : 'Tambah Kelas', body, `
    <button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button>
    <button class="btn btn-adaptiva-primary" onclick="saveKelas()">Simpan</button>`);
}

function saveKelas() {
  const obj = { ID: document.getElementById('fKelasId').value || undefined, NamaKelas: document.getElementById('fNamaKelas').value,
    Fase: document.getElementById('fFase').value, TahunAjaran: document.getElementById('fTahunAjaran').value };
  if (!obj.NamaKelas) { showToast('Peringatan', 'Nama kelas wajib diisi.', 'warning'); return; }
  gsRun('simpanKelas', [obj], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); closeModal(); loadKelasSaya(); }
    else showToast('Gagal', res.message, 'danger');
  });
}

let _kelasCache = [];
function getAllDataCacheFind(sheet, id) { return (_kelasCache.find(k => k.ID === id)) || null; }

function openSiswaManager(kelasId, namaKelas) {
  gsRun('getSiswaByKelas', [kelasId], res => {
    const list = res.data || [];
    const rows = list.map(s => `<tr><td>${esc(s.NoAbsen)}</td><td>${esc(s.NIS)}</td><td>${esc(s.Nama)}</td><td>${esc(s.JenisKelamin)}</td>
      <td><button class="btn btn-sm text-danger" onclick="hapusSiswaInline('${s.ID}','${kelasId}','${esc(namaKelas)}')"><i class="bi bi-trash"></i></button></td></tr>`).join('');
    const body = `
      <div class="d-flex gap-2 mb-2 flex-wrap">
        <input class="form-control" id="fSiswaNama" placeholder="Nama siswa" style="max-width:220px;">
        <input class="form-control" id="fSiswaAbsen" placeholder="No. Absen" style="max-width:100px;">
        <input class="form-control" id="fSiswaNis" placeholder="NIS" style="max-width:140px;">
        <select class="form-select" id="fSiswaJK" style="max-width:130px;"><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
        <button class="btn btn-adaptiva-primary" onclick="tambahSiswaInline('${kelasId}','${esc(namaKelas)}')"><i class="bi bi-plus-lg"></i></button>
      </div>
      <div class="mb-3">
        <button class="btn btn-adaptiva-ghost btn-sm" onclick="importSiswaModal('${kelasId}','${esc(namaKelas)}')">
          <i class="bi bi-upload"></i> Impor dari Excel/Word
        </button>
      </div>
      <div class="table-responsive"><table class="table"><thead><tr><th>No</th><th>NIS</th><th>Nama</th><th>JK</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="text-center text-muted py-3">Belum ada siswa.</td></tr>'}</tbody></table></div>`;
    openModal('Data Siswa — ' + namaKelas, body, `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>`);
  });
}
function tambahSiswaInline(kelasId, namaKelas) {
  const nama = document.getElementById('fSiswaNama').value;
  if (!nama) return;
  gsRun('simpanSiswa', [{
    KelasID: kelasId, Nama: nama,
    NoAbsen: document.getElementById('fSiswaAbsen').value,
    NIS: document.getElementById('fSiswaNis').value,
    JenisKelamin: document.getElementById('fSiswaJK').value
  }], res => {
    if (res.success) openSiswaManager(kelasId, namaKelas); else showToast('Gagal', res.message, 'danger');
  });
}
function hapusSiswaInline(id, kelasId, namaKelas) {
  gsRun('hapusSiswa', [id], res => { if (res.success) openSiswaManager(kelasId, namaKelas); });
}

function importSiswaModal(kelasId, namaKelas) {
  openModal('Impor Data Siswa (Excel/Word)', `
    <p class="text-muted small">
      Baris/tabel pertama harus <b>header kolom</b>. Kolom yang dikenali (urutan bebas, boleh sebagian):
      <b>No Absen</b>, <b>NIS</b>, <b>Nama Siswa</b> (wajib diisi), <b>JK</b>.<br>
      • File Excel (.xlsx/.xls): data biasa per baris.<br>
      • File Word (.docx): data harus berbentuk <b>tabel</b>.
    </p>
    <input type="file" class="form-control" id="fSiswaFile" accept=".xlsx,.xls,.docx,.doc">`,
    `<button class="btn btn-adaptiva-secondary" onclick="openSiswaManager('${kelasId}','${esc(namaKelas)}')">Batal</button>
     <button class="btn btn-adaptiva-primary" onclick="uploadSiswaFileNow('${kelasId}','${esc(namaKelas)}')">Impor</button>`);
}
function uploadSiswaFileNow(kelasId, namaKelas) {
  const input = document.getElementById('fSiswaFile');
  const file = input.files[0];
  if (!file) { showToast('Peringatan', 'Pilih file terlebih dahulu.', 'warning'); return; }
  const isWord = /\.docx?$/i.test(file.name);
  const fnName = isWord ? 'importSiswaWord' : 'importSiswaExcel';
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    gsRun(fnName, [base64, file.name, kelasId], res => {
      if (res.success) { showToast('Berhasil', res.message, 'success'); openSiswaManager(kelasId, namaKelas); }
      else showToast('Gagal', res.message, 'danger');
    });
  };
  reader.readAsDataURL(file);
}

// ════════════════════════════════════════════════════════
// ASESMEN DIAGNOSTIK
// ════════════════════════════════════════════════════════

function loadAsesmenSection() {
  document.getElementById('section-asesmen').innerHTML = `
    <div class="page-eyebrow">Langkah 1</div>
    <div class="page-title">Asesmen Diagnostik</div>
    <div class="page-subtitle">Buat asesmen kesiapan, minat, dan gaya belajar. Siswa mengisi lewat tautan publik, atau unggah hasil yang sudah ada.</div>
    <div class="mb-3" id="asesmenKelasSelector"></div>
    <div id="asesmenContent"></div>`;
  renderKelasSelectorInto('asesmenKelasSelector', 'renderAsesmenList');
  setTimeout(renderAsesmenList, 400);
}

function renderAsesmenList() {
  if (!AppState.kelasId) return;
  showLoading('asesmenContent');
  gsRun('getAsesmenByKelas', [AppState.kelasId], res => {
    const list = res.data || [];
    const cards = list.map(a => `
      <div class="card">
        <div class="card-header-flex">
          <div><h6>${esc(a.Judul)}</h6><span class="badge-status ${a.StatusAktif === 'Aktif' ? 'tervalidasi' : 'draft'}">${esc(a.StatusAktif)}</span></div>
          <div>
            <button class="btn btn-sm btn-adaptiva-ghost" onclick="manageSoal('${a.ID}','${esc(a.Judul)}')"><i class="bi bi-list-check"></i> Kelola Soal</button>
            ${a.StatusAktif !== 'Aktif' ? `<button class="btn btn-sm btn-adaptiva-primary" onclick="aktifkanAsesmenNow('${a.ID}')">Aktifkan</button>` :
              `<button class="btn btn-sm btn-adaptiva-secondary" onclick="lihatLinkPublik('${a.ID}')"><i class="bi bi-link-45deg"></i> Link Publik</button>`}
            <button class="btn btn-sm btn-adaptiva-ghost" onclick="lihatHasilAsesmen('${a.ID}')"><i class="bi bi-bar-chart"></i> Hasil</button>
            <button class="btn btn-sm btn-adaptiva-ghost" onclick="importExcelModal('${a.ID}')"><i class="bi bi-upload"></i> Impor Excel</button>
            <button class="btn btn-sm text-danger" onclick="confirmDelete('hapusAsesmen','${a.ID}', loadAsesmenSection)"><i class="bi bi-trash"></i></button>
          </div>
        </div>
        <div class="text-muted small mt-1">Dibuat: ${esc(a.Tanggal || '-')}</div>
      </div>`).join('');
    document.getElementById('asesmenContent').innerHTML = `
      <button class="btn btn-adaptiva-primary mb-3" onclick="buatAsesmenModal()"><i class="bi bi-plus-lg"></i> Buat Asesmen Baru</button>
      ${cards || '<p class="text-muted">Belum ada asesmen untuk kelas ini.</p>'}`;
  });
}

function buatAsesmenModal() {
  openModal('Buat Asesmen Diagnostik', `<div class="mb-3"><label class="form-label">Judul Asesmen</label><input class="form-control" id="fJudulAsesmen" placeholder="Contoh: Asesmen Diagnostik IPAS - Ekosistem"></div>`,
    `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="simpanAsesmenBaru()">Simpan</button>`);
}
function simpanAsesmenBaru() {
  const judul = document.getElementById('fJudulAsesmen').value;
  if (!judul) return;
  gsRun('buatAsesmen', [AppState.kelasId, judul], res => { if (res.success) { closeModal(); renderAsesmenList(); } else showToast('Gagal', res.message, 'danger'); });
}

// Instrumen mengikuti "Angket_Preferensi_Belajar_Siswa_v4": minat & gaya_belajar pakai
// skala Likert baku (1-5), kognitif pakai pilihan ganda A-D + kunci jawaban per Bagian.
const LIKERT_OPSI = [
  { label: 'Tidak Pernah', skor: 1 }, { label: 'Jarang', skor: 2 }, { label: 'Kadang-kadang', skor: 3 },
  { label: 'Sering', skor: 4 }, { label: 'Selalu', skor: 5 }
];
const JENIS_INSTRUMEN_LABEL = { kognitif: 'Readiness (Kognitif)', minat: 'Minat Belajar', gaya_belajar: 'Gaya Belajar (VARK)' };
const DIMENSI_MINAT = ['Interest_Material', 'Curiosity', 'Engagement'];
const DIMENSI_GAYA = ['Visual', 'Auditory', 'Kinesthetic'];

function manageSoal(asesmenId, judul) {
  gsRun('getSoalByAsesmen', [asesmenId], res => {
    const list = res.data || [];
    const rows = list.map(s => `<tr>
        <td>${esc(s.ButirSoal)}</td>
        <td>${esc(JENIS_INSTRUMEN_LABEL[s.JenisInstrumen] || s.JenisInstrumen)}</td>
        <td>${esc(s.Bagian || s.Dimensi || '-')}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-danger" onclick="hapusSoalNow('${s.ID}','${asesmenId}','${esc(judul)}')" title="Hapus soal ini"><i class="bi bi-trash"></i></button></td>
      </tr>`).join('');
    const body = `
      <div class="d-flex flex-wrap gap-2 mb-3">
        <button class="btn btn-adaptiva-primary btn-sm" onclick="bankSoalModal('${asesmenId}','${esc(judul)}')"><i class="bi bi-collection"></i> Muat dari Bank Soal</button>
        ${list.length ? `<button class="btn btn-outline-danger btn-sm ms-auto" onclick="hapusSemuaSoalNow('${asesmenId}','${esc(judul)}')"><i class="bi bi-trash3"></i> Hapus Semua Soal</button>` : ''}
      </div>
      <div class="table-responsive"><table class="table"><thead><tr><th>Butir Soal</th><th>Jenis</th><th>Bagian/Dimensi</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="text-center text-muted py-3">Belum ada butir soal.</td></tr>'}</tbody></table></div>`;
    openModal('Kelola Soal — ' + judul, body, `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>`);
  });
}
// CATATAN (revisi masukan promotor, 20 Okt 2026): opsi "Buat Soal Readiness dengan AI" dan
// "Tambah Soal Manual" sengaja TIDAK ditampilkan lagi di modal Kelola Soal — guru hanya boleh
// memuat butir dari Bank Soal yang sudah divalidasi. Fungsi aiKognitifModal(), toggleTambahManual(),
// tambahSoalInline(), dan onJenisSoalChange() di bawah ini SENGAJA dibiarkan (tidak dihapus) sebagai
// kode cadangan, karena sudah tidak ada lagi tombol di UI yang memanggilnya.
function toggleTambahManual() {
  const el = document.getElementById('tambahManualWrap');
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
function hapusSoalNow(soalId, asesmenId, judul) {
  confirmDelete('hapusSoalAsesmen', soalId, () => manageSoal(asesmenId, judul),
    'Hapus butir soal ini dari asesmen? Tindakan ini tidak bisa dibatalkan.');
}
function hapusSemuaSoalNow(asesmenId, judul) {
  confirmDelete('hapusSemuaSoalAsesmen', asesmenId, () => manageSoal(asesmenId, judul),
    'Hapus SEMUA butir soal pada asesmen "' + judul + '"? Seluruh soal yang sudah ditambahkan akan hilang dan tindakan ini tidak bisa dibatalkan.');
}
function onJenisSoalChange() {
  const jenis = document.getElementById('fJenisSoal').value;
  const el = document.getElementById('fSoalExtra');
  if (jenis === 'kognitif') {
    el.innerHTML = `
      <label class="form-label">Bagian</label>
      <select class="form-select mb-2" id="fBagianSoal">
        <option value="A">A - Materi Baru</option><option value="B">B - Prasyarat</option><option value="C">C - Dasar/Umum</option>
      </select>
      <label class="form-label">Opsi A-D</label>
      <input class="form-control mb-1" id="fOpsiA" placeholder="A. ...">
      <input class="form-control mb-1" id="fOpsiB" placeholder="B. ...">
      <input class="form-control mb-1" id="fOpsiC" placeholder="C. ...">
      <input class="form-control mb-2" id="fOpsiD" placeholder="D. ...">
      <label class="form-label">Kunci Jawaban</label>
      <select class="form-select" id="fKunciSoal"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select>`;
  } else {
    const dims = jenis === 'minat' ? DIMENSI_MINAT : DIMENSI_GAYA;
    el.innerHTML = `<label class="form-label">Dimensi</label>
      <select class="form-select" id="fDimensiSoal">${dims.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
      <div class="form-text">Opsi jawaban otomatis skala Likert 1-5 (Tidak Pernah–Selalu).</div>`;
  }
}
function tambahSoalInline(asesmenId, judul) {
  const butir = document.getElementById('fButirSoal').value;
  const jenis = document.getElementById('fJenisSoal').value;
  if (!butir) { showToast('Peringatan', 'Butir soal wajib diisi.', 'warning'); return; }
  let opsi, bagian = '', dimensi = '', kunci = '';
  if (jenis === 'kognitif') {
    bagian = document.getElementById('fBagianSoal').value;
    const labels = ['fOpsiA', 'fOpsiB', 'fOpsiC', 'fOpsiD'].map(id => document.getElementById(id).value.trim());
    if (labels.some(l => !l)) { showToast('Peringatan', 'Isi semua opsi A-D.', 'warning'); return; }
    opsi = labels.map(l => ({ label: l, value: l.charAt(0).toUpperCase() }));
    kunci = document.getElementById('fKunciSoal').value;
  } else {
    dimensi = document.getElementById('fDimensiSoal').value;
    opsi = LIKERT_OPSI;
  }
  gsRun('tambahSoalAsesmen', [asesmenId, butir, jenis, opsi, bagian, dimensi, kunci], res => {
    if (res.success) manageSoal(asesmenId, judul); else showToast('Gagal', res.message, 'danger');
  });
}

// ── Muat dari Bank Soal (Gaya Belajar VARK & Minat Belajar IPAS siap pakai) ──
function bankSoalModal(asesmenId, judul) {
  openModal('Muat dari Bank Soal', `
    <p class="text-muted small">Instrumen tervalidasi, siap pakai tanpa perlu diketik ulang atau generate AI.</p>
    <div class="form-check"><input class="form-check-input" type="checkbox" id="bankKognitif" checked onchange="onBankKognitifToggle()"><label class="form-check-label" for="bankKognitif">Readiness / Kognitif (10 soal)</label></div>
    <div id="bankKognitifMateriWrap" class="ms-4 mb-2">
      <label class="form-label small mb-1">Pilih materi</label>
      <select class="form-select form-select-sm" id="bankKognitifMateri"><option value="">Memuat daftar materi...</option></select>
    </div>
    <div class="form-check"><input class="form-check-input" type="checkbox" id="bankGaya" checked><label class="form-check-label" for="bankGaya">Angket Gaya Belajar / VARK (9 soal)</label></div>
    <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="bankMinat" checked><label class="form-check-label" for="bankMinat">Angket Minat Belajar IPAS (9 soal)</label></div>`,
    `<button class="btn btn-adaptiva-secondary" onclick="manageSoal('${asesmenId}','${esc(judul)}')">Batal</button>
     <button class="btn btn-adaptiva-primary" onclick="muatBankSoalNow('${asesmenId}','${esc(judul)}')">Muat Soal</button>`);
  gsRun('getMateriBankKognitif', [], res => {
    const list = res.data || [];
    const sel = document.getElementById('bankKognitifMateri');
    if (!sel) return;
    sel.innerHTML = list.length ? list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('') : '<option value="">Belum ada materi di Bank Soal</option>';
  });
}
function onBankKognitifToggle() {
  const checked = document.getElementById('bankKognitif').checked;
  document.getElementById('bankKognitifMateriWrap').style.display = checked ? '' : 'none';
}
function muatBankSoalNow(asesmenId, judul) {
  const jenisList = [];
  const pakaiKognitif = document.getElementById('bankKognitif').checked;
  let materi = null;
  if (pakaiKognitif) {
    materi = document.getElementById('bankKognitifMateri').value;
    if (!materi) { showToast('Peringatan', 'Pilih materi untuk soal Readiness/Kognitif.', 'warning'); return; }
    jenisList.push('kognitif');
  }
  if (document.getElementById('bankGaya').checked) jenisList.push('gaya_belajar');
  if (document.getElementById('bankMinat').checked) jenisList.push('minat');
  if (!jenisList.length) { showToast('Peringatan', 'Pilih minimal satu instrumen.', 'warning'); return; }
  gsRun('importSoalDariBank', [asesmenId, jenisList, materi], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); manageSoal(asesmenId, judul); }
    else showToast('Gagal', res.message, 'danger');
  });
}

// ── Buat Soal Readiness (Kognitif) dengan bantuan AI, menyesuaikan materi/topik ──
function aiKognitifModal(asesmenId, judul) {
  openModal('Buat Soal Readiness dengan AI', `
    <p class="text-muted small">AI akan membuat draf soal pilihan ganda sesuai topik dan jumlah yang Anda tentukan. Anda tetap bisa meninjau, mengedit, dan memilih mana yang akan dimasukkan ke asesmen sebelum disimpan.</p>
    <label class="form-label">Materi / Topik</label>
    <input class="form-control mb-3" id="fMateriAI" placeholder="Contoh: Bentuk dan Sumber Energi">
    <label class="form-label mb-1">Jumlah soal per bagian</label>
    <div class="row g-2 mb-2">
      <div class="col-4"><div class="form-text mb-1">A - Materi Baru</div><input type="number" min="0" max="10" class="form-control form-control-sm" id="fJumlahA" value="2"></div>
      <div class="col-4"><div class="form-text mb-1">B - Prasyarat</div><input type="number" min="0" max="10" class="form-control form-control-sm" id="fJumlahB" value="6"></div>
      <div class="col-4"><div class="form-text mb-1">C - Dasar/Umum</div><input type="number" min="0" max="10" class="form-control form-control-sm" id="fJumlahC" value="2"></div>
    </div>
    <p class="form-text">Default 10 soal (2 Materi Baru + 6 Prasyarat + 2 Dasar/Umum). Ubah angkanya kalau perlu, lalu tetap bisa pilih/uncheck tiap soal sebelum disimpan.</p>
    <div id="aiKognitifStatus" class="mt-2"></div>`,
    `<button class="btn btn-adaptiva-secondary" onclick="manageSoal('${asesmenId}','${esc(judul)}')">Batal</button>
     <button class="btn btn-adaptiva-primary" id="btnGenerateAI" onclick="generateSoalAINow('${asesmenId}','${esc(judul)}')"><i class="bi bi-stars"></i> Buat dengan AI</button>`);
}
function generateSoalAINow(asesmenId, judul) {
  const materi = document.getElementById('fMateriAI').value.trim();
  if (!materi) { showToast('Peringatan', 'Materi/topik wajib diisi.', 'warning'); return; }
  const jA = document.getElementById('fJumlahA').value;
  const jB = document.getElementById('fJumlahB').value;
  const jC = document.getElementById('fJumlahC').value;
  document.getElementById('aiKognitifStatus').innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Membuat soal dengan AI, mohon tunggu...</div>';
  gsRun('generateAsesmenKognitifAI', [asesmenId, materi, jA, jB, jC], res => {
    if (!res.success) { document.getElementById('aiKognitifStatus').innerHTML = ''; showToast('Gagal', res.message, 'danger'); return; }
    renderDraftSoalAI(asesmenId, judul, res.data);
  });
}
function renderDraftSoalAI(asesmenId, judul, draftList) {
  window._draftSoalAI = draftList.map(s => Object.assign({ _pilih: true }, s));
  const bagianNama = { A: 'A - Materi Baru', B: 'B - Prasyarat', C: 'C - Dasar/Umum' };
  const rows = window._draftSoalAI.map((s, i) => `
    <div class="card mb-2 p-2" style="${s._pilih ? '' : 'opacity:.55;'}">
      <div class="d-flex justify-content-between align-items-start">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="pilihSoal${i}" ${s._pilih ? 'checked' : ''} onchange="toggleDraftSoalAI(${i},'${asesmenId}','${esc(judul)}')">
          <label class="form-check-label small fw-bold" for="pilihSoal${i}">Masukkan ke asesmen</label>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge-status draft">${esc(bagianNama[s.Bagian] || s.Bagian)}</span>
          <button class="btn btn-sm text-danger" onclick="hapusDraftSoalAI(${i},'${asesmenId}','${esc(judul)}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>
      <textarea class="form-control form-control-sm my-2" rows="2" onchange="updateDraftSoalAI(${i},'ButirSoal',this.value)">${esc(s.ButirSoal)}</textarea>
      ${(s.Opsi || []).map((o, oi) => `<input class="form-control form-control-sm mb-1" value="${esc(o)}" onchange="updateDraftOpsiAI(${i},${oi},this.value)">`).join('')}
      <label class="form-label small mb-0 mt-1">Kunci Jawaban</label>
      <select class="form-select form-select-sm" style="max-width:100px" onchange="updateDraftSoalAI(${i},'KunciJawaban',this.value)">
        ${['A','B','C','D'].map(k => `<option value="${k}" ${s.KunciJawaban === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
    </div>`).join('');
  const jumlahDipilih = window._draftSoalAI.filter(s => s._pilih).length;
  document.getElementById('genericModalBody').innerHTML = `
    <p class="text-muted small">Periksa/edit draf soal berikut. Centang soal yang ingin dimasukkan ke asesmen, lalu klik "Simpan ke Asesmen" (<b>${jumlahDipilih}</b> dari ${window._draftSoalAI.length} soal terpilih).</p>
    <div id="draftSoalAIList" style="max-height:420px; overflow:auto;">${rows}</div>`;
  document.getElementById('genericModalFooter').innerHTML = `
    <button class="btn btn-adaptiva-secondary" onclick="manageSoal('${asesmenId}','${esc(judul)}')">Batal</button>
    <button class="btn btn-adaptiva-primary" onclick="simpanDraftSoalAINow('${asesmenId}','${esc(judul)}')"><i class="bi bi-check-lg"></i> Simpan Soal Terpilih</button>`;
}
function toggleDraftSoalAI(i, asesmenId, judul) {
  window._draftSoalAI[i]._pilih = !window._draftSoalAI[i]._pilih;
  renderDraftSoalAI(asesmenId, judul, window._draftSoalAI);
}
function updateDraftSoalAI(i, field, value) { window._draftSoalAI[i][field] = value; }
function updateDraftOpsiAI(i, oi, value) { window._draftSoalAI[i].Opsi[oi] = value; }
function hapusDraftSoalAI(i, asesmenId, judul) {
  window._draftSoalAI.splice(i, 1);
  renderDraftSoalAI(asesmenId, judul, window._draftSoalAI);
}
function simpanDraftSoalAINow(asesmenId, judul) {
  const terpilih = window._draftSoalAI.filter(s => s._pilih);
  if (!terpilih.length) { showToast('Peringatan', 'Centang minimal 1 soal untuk disimpan.', 'warning'); return; }
  gsRun('simpanSoalKognitifBatch', [asesmenId, terpilih], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); manageSoal(asesmenId, judul); }
    else showToast('Gagal', res.message, 'danger');
  });
}
function aktifkanAsesmenNow(id) {
  gsRun('aktifkanAsesmen', [id], res => { if (res.success) { showToast('Berhasil', 'Asesmen diaktifkan.', 'success'); renderAsesmenList(); } });
}
function lihatLinkPublik(id) {
  gsRun('getPublicFormLink', [id], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    openModal('Tautan Publik Asesmen', `<p>Bagikan tautan ini ke siswa untuk mengisi asesmen (tanpa perlu login):</p>
      <div class="input-group"><input class="form-control" id="publicLinkInput" value="${esc(res.data.url)}" readonly>
      <button class="btn btn-adaptiva-primary" onclick="navigator.clipboard.writeText(document.getElementById('publicLinkInput').value); showToast('Disalin','Tautan disalin ke clipboard','success')">Salin</button></div>`,
      `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>`);
  });
}
function importExcelModal(asesmenId) {
  openModal('Impor Hasil Asesmen (Excel)', `
    <p class="text-muted small">Format: kolom pertama "Nama Siswa", kolom berikutnya header = teks butir soal, isi = jawaban siswa.</p>
    <input type="file" class="form-control" id="fExcelFile" accept=".xlsx,.xls">`,
    `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="uploadExcelNow('${asesmenId}')">Impor</button>`);
}
function uploadExcelNow(asesmenId) {
  const input = document.getElementById('fExcelFile');
  const file = input.files[0];
  if (!file) { showToast('Peringatan', 'Pilih file terlebih dahulu.', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    gsRun('importAsesmenExcel', [base64, file.name, asesmenId], res => {
      if (res.success) { showToast('Berhasil', res.message, 'success'); closeModal(); }
      else showToast('Gagal', res.message, 'danger');
    });
  };
  reader.readAsDataURL(file);
}
function lihatHasilAsesmen(asesmenId) {
  gsRun('getHasilAsesmen', [asesmenId], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    const d = res.data;
    const rows = d.profil.map(p => `<tr>
        <td>${esc(p.Nama)}</td>
        <td>${esc(p.SkorKesiapan || 0)}/10 <span class="badge-tier ${p.KategoriKesiapan === 'Paham Utuh' ? 'tinggi' : p.KategoriKesiapan === 'Paham Sebagian' ? 'sedang' : 'rendah'}">${esc(p.KategoriKesiapan || '-')}</span></td>
        <td>${esc(p.SkorMinatTotal || 0)} <small class="text-muted">(${esc(p.KategoriMinat || '-')})</small></td>
        <td>${esc(p.GayaDominan || '-')}${p.GayaPendukung && p.GayaPendukung !== '-' ? ' / ' + esc(p.GayaPendukung) : ''}</td>
      </tr>`).join('');
    openModal('Hasil Asesmen', `<p>${d.totalRespon} dari ${d.totalSiswa} siswa telah mengisi.</p>
      <div class="table-responsive"><table class="table"><thead><tr><th>Nama</th><th>Readiness</th><th>Minat</th><th>Gaya Belajar</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>`);
  });
}

// ════════════════════════════════════════════════════════
// PROFIL SISWA
// ════════════════════════════════════════════════════════

function loadProfilSiswaSection() {
  document.getElementById('section-profilSiswa').innerHTML = `
    <div class="page-eyebrow">Langkah 2</div><div class="page-title">Profil Siswa & Pemetaan Diagnostik</div>
    <div class="page-subtitle">Analisis kesiapan, minat, dan gaya belajar hasil asesmen diagnostik.</div>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <div id="profilKelasSelector"></div>
      <button class="btn btn-outline-secondary btn-sm ms-auto" onclick="hitungUlangSemuaProfil()">
        <i class="bi bi-arrow-repeat"></i> Hitung Ulang Semua Profil
      </button>
    </div>
    <div id="profilSiswaContent"></div>`;
  renderKelasSelectorInto('profilKelasSelector', 'renderProfilSiswaContent');
  setTimeout(renderProfilSiswaContent, 400);
}
function renderProfilSiswaContent() {
  if (!AppState.kelasId) return;
  showLoading('profilSiswaContent');
  gsRun('getSiswaByKelas', [AppState.kelasId], res => {
    const siswaList = res.data || [];
    gsRun('getAllProfilSiswa', [], profilRes => {
      const profilMap = {}; (profilRes.data || []).forEach(p => profilMap[p.SiswaID] = p);
      const tierByKategori = { 'Paham Utuh': 'Mahir', 'Paham Sebagian': 'Berkembang', 'Belum Paham': 'PerluPendampingan' };
      const rows = siswaList.map(s => {
        const p = profilMap[s.ID] || {};
        const tier = tierByKategori[p.KategoriKesiapan] || null;
        return `<tr><td>${esc(s.Nama)}</td><td>${esc(p.SkorKesiapan != null ? p.SkorKesiapan : 0)}/10</td>
          <td>${tier ? `<span class="badge-tier ${TIER_CLASS[tier]}"><span class="dot"></span>${TIER_LABEL[tier]}</span>` : '<span class="text-muted small">Belum ada data</span>'}</td>
          <td>${esc(p.KategoriMinat || '-')}</td>
          <td>${esc(p.GayaDominan || '-')}${p.GayaPendukung && p.GayaPendukung !== '-' ? ' / ' + esc(p.GayaPendukung) : ''}</td></tr>`;
      }).join('');
      document.getElementById('profilSiswaContent').innerHTML = `
        <div class="table-responsive"><table class="table">
          <thead><tr><th>Nama Siswa</th><th>Skor Readiness</th><th>Kelompok Readiness</th><th>Minat</th><th>Gaya Belajar (Dominan/Pendukung)</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="text-center text-muted py-4">Belum ada data profil. Pastikan asesmen sudah diisi siswa.</td></tr>'}</tbody>
        </table></div>`;
    });
  });
}

function hitungUlangSemuaProfil() {
  openModal('Hitung Ulang Semua Profil', `
    <p>Hitung ulang profil (Skor &amp; Kelompok Readiness, Minat, Gaya Belajar) untuk <b>semua siswa</b> berdasarkan jawaban yang sudah tersimpan?</p>
    <p class="text-muted small mb-0">Gunakan ini setelah memperbaiki data soal (kolom Bagian/Dimensi/Kunci Jawaban) di Bank Soal / Google Sheet, supaya profil siswa ikut terkoreksi tanpa perlu mengerjakan ulang asesmen. Proses ini tidak menghapus data apa pun.</p>`,
    `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button>
     <button class="btn btn-adaptiva-primary" id="btnJalankanHitungUlang" onclick="jalankanHitungUlangSemuaProfil()">
       <i class="bi bi-arrow-repeat"></i> Ya, Hitung Ulang
     </button>`);
}
function jalankanHitungUlangSemuaProfil() {
  const btn = document.getElementById('btnJalankanHitungUlang');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Memproses...'; }
  gsRun('recomputeSemuaProfilSiswa', [], res => {
    closeModal();
    if (res.success) { showToast('Berhasil', res.message, 'success'); renderProfilSiswaContent(); }
    else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// KELOMPOK BELAJAR
// ════════════════════════════════════════════════════════

function loadKelompokBelajarSection() {
  document.getElementById('section-kelompokBelajar').innerHTML = `
    <div class="page-eyebrow">Langkah 3</div><div class="page-title">Kelompok Belajar Adaptif</div>
    <div class="page-subtitle">Pengelompokan otomatis berbasis Readiness (kesiapan). Minat &amp; gaya belajar tampil sebagai opsi diferensiasi di dalam tiap kelompok.</div>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <div id="kelompokKelasSelector"></div>
      <div id="kelompokAsesmenSelector"></div>
      <button class="btn btn-adaptiva-primary" onclick="generateKelompokNow()"><i class="bi bi-magic"></i> Buat/Perbarui Pengelompokan</button>
    </div>
    <div id="kelompokContent"></div>`;
  renderKelasSelectorInto('kelompokKelasSelector', 'onKelasChangeKelompok');
  setTimeout(onKelasChangeKelompok, 400);
}
function onKelasChangeKelompok() {
  if (!AppState.kelasId) return;
  gsRun('getAsesmenByKelas', [AppState.kelasId], res => {
    const list = (res.data || []).filter(a => a.StatusAktif === 'Aktif');
    if (!AppState.asesmenId || !list.find(a => a.ID === AppState.asesmenId)) AppState.asesmenId = list.length ? list[0].ID : null;
    document.getElementById('kelompokAsesmenSelector').innerHTML = list.length
      ? `<select class="form-select" style="max-width:280px" onchange="AppState.asesmenId=this.value; renderKelompokContent()">${list.map(a => `<option value="${a.ID}" ${a.ID === AppState.asesmenId ? 'selected' : ''}>${esc(a.Judul)} — ${esc(a.Tanggal || '')}</option>`).join('')}</select>`
      : `<span class="text-muted small">Belum ada asesmen aktif untuk kelas ini.</span>`;
    renderKelompokContent();
  });
}
function generateKelompokNow() {
  if (!AppState.kelasId || !AppState.asesmenId) { showToast('Peringatan', 'Pilih kelas dan asesmen aktif dahulu.', 'warning'); return; }
  gsRun('generateKelompokBelajar', [AppState.kelasId, AppState.asesmenId], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); renderKelompokContent(); }
    else showToast('Gagal', res.message, 'danger');
  });
}
function renderKelompokContent() {
  if (!AppState.kelasId) return;
  showLoading('kelompokContent');
  gsRun('getKelompokBelajar', [AppState.kelasId, AppState.asesmenId], res => {
    const list = res.data || [];
    if (!list.length) { document.getElementById('kelompokContent').innerHTML = '<p class="text-muted">Belum ada kelompok. Klik "Buat/Perbarui Pengelompokan".</p>'; return; }
    const cols = list.map(k => {
      const cls = TIER_CLASS[k.NamaKelompok];
      const rek = k.rekomendasi || {};
      const opsi = k.opsiDiferensiasi || [];
      const anggota = k.anggota.map(a => `<div class="d-flex justify-content-between align-items-center py-1 border-bottom">
        <span>${esc(a.Nama)} <small class="text-muted">(${esc(a.SkorKesiapan != null ? a.SkorKesiapan : 0)}/10)</small></span>
        </div>`).join('');
      const opsiHtml = opsi.map((o, oi) => `
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="opsi_${k.ID}_${oi}" ${o.checked ? 'checked' : ''}>
          <label class="form-check-label small" for="opsi_${k.ID}_${oi}">${esc(o.label)} <span class="text-muted">(${esc(o.keterangan)})</span></label>
        </div>`).join('');
      return `<div class="col-md-4">
        <div class="kelompok-card ${cls}">
          <div class="d-flex justify-content-between mb-2"><h6 class="mb-0">${TIER_LABEL[k.NamaKelompok]}</h6><span class="badge-tier ${cls}">${k.anggota.length} siswa</span></div>
          <p class="small text-muted mb-2">${esc(k.Karakteristik)}</p>
          <p class="small mb-1"><b>Konten:</b> ${esc(rek.kontenGuru || k.StrategiUmum || '')}</p>
          <p class="small mb-1"><b>Proses:</b> ${esc(rek.prosesGuru || '')}</p>
          <p class="small mb-2"><b>Produk:</b> ${esc(rek.produkGuru || '')}</p>
          <p class="small mb-2"><b>Pendampingan (Scaffolding):</b> ${esc(rek.scaffoldingGuru || '')}</p>
          ${rek.scaffoldingTeori ? `<details class="mb-2"><summary class="small text-muted" style="cursor:pointer;">Lihat dasar teori</summary>
            <p class="small text-muted mt-1 mb-0">${esc(rek.scaffoldingTeori)}</p></details>` : ''}
          ${opsi.length ? `<div class="mb-2"><b class="small">Opsi diferensiasi (bisa dimatikan):</b>${opsiHtml}</div>` : ''}
          <details><summary class="small text-muted" style="cursor:pointer;">Lihat daftar siswa (${k.anggota.length})</summary>
            <div style="max-height:220px; overflow:auto;">${anggota || '<span class="text-muted small">Tidak ada anggota</span>'}</div>
          </details>
        </div></div>`;
    }).join('');
    document.getElementById('kelompokContent').innerHTML = `<div class="row g-3">${cols}</div>`;
  });
}
function pindahSiswaNow(siswaId, asalId, tujuanId) {
  if (!tujuanId) return;
  gsRun('pindahkanSiswaKelompok', [siswaId, asalId, tujuanId], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); renderKelompokContent(); }
  });
}

// ════════════════════════════════════════════════════════
// CP & TP
// ════════════════════════════════════════════════════════

function loadCPTPSection() {
  document.getElementById('section-cpTp').innerHTML = `
    <div class="page-eyebrow">Langkah 4</div><div class="page-title">CP &amp; Tujuan Pembelajaran</div>
    <div class="page-subtitle">Pilih Capaian Pembelajaran (CP) sesuai fase, lalu turunkan maksimal 2–3 Tujuan Pembelajaran (TP).</div>
    <div class="mb-3" id="cptpKelasSelector"></div>
    <div id="cptpContent"></div>`;
  renderKelasSelectorInto('cptpKelasSelector', 'renderCPTPContent');
  setTimeout(renderCPTPContent, 400);
}
function renderCPTPContent() {
  if (!AppState.kelasId) return;
  gsRun('getCPTPByKelas', [AppState.kelasId], res => {
    const list = res.data || [];
    const rows = list.map(c => `<div class="card">
      <div class="d-flex justify-content-between align-items-start">
        <div><b>CP:</b> ${esc(c.TeksCP)}</div>
        <button class="btn btn-sm btn-outline-danger ms-2" title="Hapus CP &amp; TP ini" onclick="hapusCPTPNow('${c.ID}')"><i class="bi bi-trash3"></i></button>
      </div>
      <hr><b>Tujuan Pembelajaran:</b><ol>${c.TPJson.map(t => `<li>${esc(t.teks)}</li>`).join('')}</ol></div>`).join('');
    document.getElementById('cptpContent').innerHTML = `
      <button class="btn btn-adaptiva-primary mb-3" onclick="tambahCPTPModal()"><i class="bi bi-plus-lg"></i> Tambah CP &amp; TP</button>
      ${rows || '<p class="text-muted">Belum ada CP &amp; TP untuk kelas ini.</p>'}`;
  });
}
function hapusCPTPNow(cptpId) {
  confirmDelete('hapusCPTP', cptpId, renderCPTPContent,
    'Hapus CP & TP ini beserta seluruh Tujuan Pembelajaran di dalamnya? Tindakan ini tidak bisa dibatalkan.');
}
let _cptpBankCache = null; // cache Bank CP-TP agar tidak fetch ulang ke backend saat memilih dari dropdown
function tambahCPTPModal() {
  gsRun('getBankCPTP', ['Fase B'], res => {
    const bank = res.data || [];
    _cptpBankCache = bank;
    const bankOptions = bank.map(b => `<option value="${b.ID}">${esc(b.TeksCP.substring(0,80))}...</option>`).join('');
    openModal('Tambah CP &amp; TP', `
      <div class="mb-3"><label class="form-label">Ambil dari Bank CP-TP IPAS (opsional)</label>
        <select class="form-select" id="fBankCPTP" onchange="pilihDariBank(this.value)"><option value="">-- Input manual --</option>${bankOptions}</select></div>
      <div class="mb-3"><label class="form-label">Fase</label>
        <select class="form-select" id="fFaseCPTP"><option>Fase A</option><option selected>Fase B</option><option>Fase C</option></select></div>
      <div class="mb-3"><label class="form-label">Teks Capaian Pembelajaran (CP)</label><textarea class="form-control" id="fTeksCP" rows="3"></textarea></div>
      <div class="mb-3"><label class="form-label">Tujuan Pembelajaran</label>
        <div id="tpListWrap"><input class="form-control mb-2 tp-input" placeholder="TP 1"></div>
        <button class="btn btn-sm btn-adaptiva-ghost" onclick="tambahBarisTP()"><i class="bi bi-plus"></i> Tambah TP</button></div>`,
      `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="simpanCPTPNow()">Simpan</button>`);
  });
}
function pilihDariBank(bankId) {
  if (!bankId) return;
  const b = (_cptpBankCache || []).find(x => x.ID === bankId);
  if (!b) return;
  document.getElementById('fTeksCP').value = b.TeksCP;
  document.getElementById('tpListWrap').innerHTML = b.TPJson.map(t => `<input class="form-control mb-2 tp-input" value="${esc(t.teks)}">`).join('');
}
function tambahBarisTP() {
  const wrap = document.getElementById('tpListWrap');
  const inp = document.createElement('input');
  inp.className = 'form-control mb-2 tp-input';
  inp.placeholder = 'TP ' + (wrap.querySelectorAll('.tp-input').length + 1);
  wrap.appendChild(inp);
}
function simpanCPTPNow() {
  const teksCP = document.getElementById('fTeksCP').value;
  const fase = document.getElementById('fFaseCPTP').value;
  const tpList = Array.from(document.querySelectorAll('.tp-input')).map(i => ({ teks: i.value })).filter(t => t.teks);
  if (!teksCP || !tpList.length) { showToast('Peringatan', 'Isi CP dan minimal 1 TP.', 'warning'); return; }
  gsRun('simpanCPTP', [AppState.kelasId, fase, teksCP, tpList], res => {
    if (res.success) { showToast('Berhasil', 'CP & TP tersimpan.', 'success'); closeModal(); renderCPTPContent(); }
    else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// DIFERENSIASI
// ════════════════════════════════════════════════════════

function loadDiferensiasiSection() {
  document.getElementById('section-diferensiasi').innerHTML = `
    <div class="page-eyebrow">Langkah 5</div><div class="page-title">Diferensiasi Pembelajaran</div>
    <div class="page-subtitle">Rekomendasi diferensiasi konten, proses, produk berdasarkan kelompok belajar &amp; TP.</div>
    <div class="mb-3" id="difKelasSelector"></div>
    <div id="difContent"></div>`;
  renderKelasSelectorInto('difKelasSelector', 'renderDiferensiasiContent');
  setTimeout(renderDiferensiasiContent, 400);
}
function renderDiferensiasiContent() {
  if (!AppState.kelasId) return;
  gsRun('getKelompokBelajar', [AppState.kelasId, null], kres => {
    const kelompokList = kres.data || [];
    if (!kelompokList.length) {
      document.getElementById('difContent').innerHTML = '<p class="text-muted">Lengkapi Kelompok Belajar terlebih dahulu.</p>';
      return;
    }
    gsRun('getDiferensiasiByKelas', [AppState.kelasId], dres => {
      const saved = dres.data || [];
      window.__kelompokRekMap = window.__kelompokRekMap || {};
      let html = '<p class="text-muted small">Satu rekomendasi diferensiasi berlaku untuk semua TP pada kelompok yang sama (tidak perlu diulang per TP). Tombol "Isi Rekomendasi" mengambil saran yang sama dengan yang tampil di Kelompok Belajar.</p><div class="row g-3">';
      kelompokList.forEach(k => {
        window.__kelompokRekMap[k.ID] = k.rekomendasi || {};
        const existing = saved.find(d => d.KelompokID === k.ID) || {};
        html += `<div class="col-md-4"><div class="card">
          <span class="badge-tier ${TIER_CLASS[k.NamaKelompok]} mb-2"><span class="dot"></span>${TIER_LABEL[k.NamaKelompok]}</span>
          <label class="form-label">Konten</label><textarea class="form-control mb-2 dif-konten" rows="2" data-kid="${k.ID}">${esc(existing.Konten)}</textarea>
          <label class="form-label">Proses</label><textarea class="form-control mb-2 dif-proses" rows="2" data-kid="${k.ID}">${esc(existing.Proses)}</textarea>
          <label class="form-label">Produk</label><textarea class="form-control mb-2 dif-produk" rows="2" data-kid="${k.ID}">${esc(existing.Produk)}</textarea>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-adaptiva-ghost" onclick="isiRekomendasi('${k.ID}')"><i class="bi bi-magic"></i> Isi Rekomendasi</button>
            <button class="btn btn-sm btn-adaptiva-primary" onclick="simpanDiferensiasiNow('${k.ID}')">Simpan</button>
          </div></div></div>`;
      });
      html += '</div>';
      document.getElementById('difContent').innerHTML = html;
    });
  });
}
function isiRekomendasi(kelompokId) {
  const rek = (window.__kelompokRekMap || {})[kelompokId] || {};
  const sel = `[data-kid="${kelompokId}"]`;
  document.querySelector('.dif-konten' + sel).value = rek.kontenGuru || '';
  document.querySelector('.dif-proses' + sel).value = rek.prosesGuru || '';
  document.querySelector('.dif-produk' + sel).value = rek.produkGuru || '';
}
function simpanDiferensiasiNow(kelompokId) {
  const sel = `[data-kid="${kelompokId}"]`;
  const konten = document.querySelector('.dif-konten' + sel).value;
  const proses = document.querySelector('.dif-proses' + sel).value;
  const produk = document.querySelector('.dif-produk' + sel).value;
  gsRun('simpanDiferensiasi', [kelompokId, konten, proses, produk], res => {
    if (res.success) showToast('Tersimpan', 'Diferensiasi tersimpan.', 'success'); else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// SCAFFOLDING PLANNER
// ════════════════════════════════════════════════════════

function loadScaffoldingSection() {
  document.getElementById('section-scaffolding').innerHTML = `
    <div class="page-eyebrow">Langkah 6</div><div class="page-title">Scaffolding Planner</div>
    <div class="page-subtitle">Rancang gradasi dukungan bertahap (Modeling → Prompting → Guided Practice → Independent Practice) per kelompok, per TP.</div>
    <div class="mb-3" id="scafKelasSelector"></div>
    <div id="scafContent"></div>`;
  renderKelasSelectorInto('scafKelasSelector', 'renderScaffoldingContent');
  setTimeout(renderScaffoldingContent, 400);
}
function renderScaffoldingContent() {
  if (!AppState.kelasId) return;
  gsRun('getKelompokBelajar', [AppState.kelasId, null], kres => {
    const kelompokList = kres.data || [];
    if (!kelompokList.length) {
      document.getElementById('scafContent').innerHTML = '<p class="text-muted">Lengkapi Kelompok Belajar terlebih dahulu.</p>';
      return;
    }
    gsRun('getScaffoldingByKelas', [AppState.kelasId], sres => {
      const saved = sres.data || [];
      window.__kelompokRekMap = window.__kelompokRekMap || {};
      let html = '<p class="text-muted small">Satu rencana scaffolding berlaku untuk semua TP pada kelompok yang sama (tidak perlu diulang per TP). Tombol "Isi Rekomendasi" mengisi level yang sesuai kesiapan kelompok dengan saran yang sama dengan Kelompok Belajar — level lain tetap bisa disesuaikan manual.</p>';
      const levels = ['Level 1: Modeling','Level 2: Prompting','Level 3: Guided Practice','Level 4: Independent Practice'];
      kelompokList.forEach(k => {
        window.__kelompokRekMap[k.ID] = k.rekomendasi || {};
        const ex = saved.find(s => s.KelompokID === k.ID) || {};
        html += `<div class="card">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="badge-tier ${TIER_CLASS[k.NamaKelompok]}"><span class="dot"></span>${TIER_LABEL[k.NamaKelompok]}</span>
            <button class="btn btn-sm btn-adaptiva-ghost" onclick="isiRekomendasiScaffolding('${k.ID}')"><i class="bi bi-magic"></i> Isi Rekomendasi</button>
          </div>
          <div class="row g-2">
            ${levels.map((lab, i) => `<div class="col-md-3"><label class="form-label">${lab}</label>
              <textarea class="form-control scaf-l${i+1}" rows="3" data-kid="${k.ID}">${esc(ex['Level' + (i+1)])}</textarea></div>`).join('')}
          </div>
          <button class="btn btn-sm btn-adaptiva-primary mt-2" onclick="simpanScaffoldingNow('${k.ID}')">Simpan Scaffolding</button>
        </div>`;
      });
      document.getElementById('scafContent').innerHTML = html;
    });
  });
}
function isiRekomendasiScaffolding(kelompokId) {
  const rek = (window.__kelompokRekMap || {})[kelompokId] || {};
  let level = rek.scaffoldingLevel;
  if (!level && rek.scaffoldingTeori) {
    const m = /Level\s*(\d)/.exec(rek.scaffoldingTeori);
    if (m) level = parseInt(m[1], 10);
  }
  if (!level) level = 2;
  const sel = `[data-kid="${kelompokId}"]`;
  const box = document.querySelector('.scaf-l' + level + sel);
  if (box) box.value = rek.scaffoldingGuru || '';
  showToast('Terisi', `Saran diisi pada Level ${level} sesuai kesiapan kelompok ini. Level lain bisa disesuaikan manual.`, 'success');
}
function simpanScaffoldingNow(kelompokId) {
  const sel = `[data-kid="${kelompokId}"]`;
  const l1 = document.querySelector('.scaf-l1' + sel).value, l2 = document.querySelector('.scaf-l2' + sel).value;
  const l3 = document.querySelector('.scaf-l3' + sel).value, l4 = document.querySelector('.scaf-l4' + sel).value;
  gsRun('simpanScaffolding', [kelompokId, l1, l2, l3, l4], res => {
    if (res.success) showToast('Tersimpan', 'Rencana scaffolding tersimpan.', 'success'); else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// MODUL AJAR (GENERATE AI + REVIEW + VALIDASI)
// ════════════════════════════════════════════════════════

function loadModulAjarSection() {
  document.getElementById('section-modulAjar').innerHTML = `
    <div class="page-eyebrow">Langkah 7 &amp; 8</div><div class="page-title">Modul Ajar Saya</div>
    <div class="page-subtitle">Generate Modul Ajar otomatis dari CP/TP, diferensiasi, dan scaffolding yang sudah dirancang.</div>
    <div id="modulGenForm" class="card"></div>
    <div id="modulListWrap"></div>`;
  renderGenerateForm();
  renderModulList();
}
const KURIKULUM_CINTA_TOPIK = ['Cinta Allah Swt. dan Rasul-Nya', 'Cinta Ilmu', 'Cinta Lingkungan', 'Cinta Diri dan Sesama Manusia', 'Cinta Tanah Air'];
const MODEL_PEMBELAJARAN_LIST = ['Tanpa Model Pembelajaran (Pendekatan Konvensional)', 'Problem Based Learning (PBL)', 'Project Based Learning (PjBL)',
  'Discovery Learning', 'Inquiry Learning', 'Contextual Teaching and Learning (CTL)', 'STEAM', 'Pembelajaran Berdiferensiasi',
  'Cooperative Learning (Tipe STAD)', 'Cooperative Learning (Tipe Jigsaw)', 'Cooperative Learning (Tipe NHT)', 'Cooperative Learning (Tipe TGT)'];
const DIMENSI_PROFIL_LULUSAN = ['Keimanan dan Ketakwaan terhadap Tuhan YME', 'Kewargaan', 'Penalaran Kritis', 'Kreativitas',
  'Kolaborasi', 'Kemandirian', 'Kesehatan', 'Komunikasi'];
function renderGenerateForm() {
  gsRun('getKelasSaya', [], res => {
    const kelasList = res.data || [];
    const p = AppState.profile || {};
    const tahunAjaranDefault = (() => { const y = new Date().getFullYear(); const m = new Date().getMonth() + 1; const a = m >= 7 ? y : y - 1; return a + '/' + (a + 1); })();
    document.getElementById('modulGenForm').innerHTML = `
      <h6 class="mb-3">Generate Modul Ajar Baru</h6>
      <h6 class="text-muted small text-uppercase mt-2 mb-2">Identitas Dokumen</h6>
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">Nama Sekolah</label><input class="form-control" id="genNamaSekolah" value="${esc(p.Sekolah || '')}"></div>
        <div class="col-md-4"><label class="form-label">Nama Kepala Sekolah</label><input class="form-control" id="genNamaKepsek" placeholder="Nama Kepala Sekolah"></div>
        <div class="col-md-4"><label class="form-label">NIP Kepala Sekolah</label><input class="form-control" id="genNipKepsek" placeholder="NIP Kepala Sekolah"></div>
        <div class="col-md-4"><label class="form-label">Nama Guru Mapel</label><input class="form-control" id="genNamaGuru" value="${esc(p.Nama || '')}"></div>
        <div class="col-md-4"><label class="form-label">NIP Guru Mapel</label><input class="form-control" id="genNipGuru" placeholder="NIP Guru Mapel"></div>
        <div class="col-md-4"><label class="form-label">Tahun Pelajaran</label><input class="form-control" id="genTahunPelajaran" value="${tahunAjaranDefault}"></div>
      </div>
      <hr>
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">Jenjang</label>
          <select class="form-select" id="genJenjang"><option>SD</option><option>MI</option></select></div>
        <div class="col-md-4"><label class="form-label">Kelas</label>
          <select class="form-select" id="genKelas" onchange="onGenKelasChange()">${kelasList.map(k => `<option value="${k.ID}">${esc(k.NamaKelas)}</option>`).join('')}</select></div>
        <div class="col-md-4"><label class="form-label">Asesmen Diagnostik (auto-load)</label><select class="form-select" id="genAsesmen"></select></div>
        <div class="col-md-12"><label class="form-label">Jenis Template</label>
          <select class="form-select" id="genTemplate" onchange="onGenTemplateChange()"><option>Pembelajaran Mendalam</option><option>Kurikulum Berbasis Cinta</option></select></div>
        <div class="col-md-12" id="genKurikulumCintaWrap" style="display:none">
          <label class="form-label">Nilai Panca Cinta yang diintegrasikan <span class="text-muted fw-normal">(kosongkan bila ingin dipilihkan otomatis)</span></label>
          <div class="d-flex flex-wrap gap-2">${KURIKULUM_CINTA_TOPIK.map((t,i) => `<input type="checkbox" class="btn-check gen-kc-check" value="${esc(t)}" id="kc_${i}" autocomplete="off" checked>
            <label class="btn btn-outline-adaptiva-primary rounded-pill btn-sm" for="kc_${i}"><i class="bi bi-check-lg"></i> ${esc(t)}</label>`).join('')}</div>
        </div>
        <div class="col-md-12"><label class="form-label">Dimensi Profil Lulusan <span class="text-muted fw-normal">(pilih yang relevan)</span></label>
          <div class="d-flex flex-wrap gap-2">${DIMENSI_PROFIL_LULUSAN.map((t,i) => `<input type="checkbox" class="btn-check gen-dpl-check" value="${esc(t)}" id="dpl_${i}" autocomplete="off">
            <label class="btn btn-outline-adaptiva-primary rounded-pill btn-sm" for="dpl_${i}"><i class="bi bi-check-lg"></i> ${esc(t)}</label>`).join('')}</div>
        </div>
        <div class="col-md-12"><label class="form-label">Tujuan Pembelajaran</label><div id="genTPWrap" class="border rounded p-2 small text-muted">Pilih kelas dahulu.</div></div>
        <div class="col-md-12"><label class="form-label">Capaian Pembelajaran (CP) terkait</label><textarea class="form-control" id="genCPDisplay" rows="2" readonly placeholder="Otomatis tampil setelah memilih Tujuan Pembelajaran di atas."></textarea></div>
        <div class="col-md-4"><label class="form-label">Materi</label><input class="form-control" id="genMateri" placeholder="Contoh: Siklus air dan rantai makanan"></div>
        <div class="col-md-4"><label class="form-label">Model Pembelajaran</label>
          <select class="form-select" id="genModelPembelajaran">${MODEL_PEMBELAJARAN_LIST.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
        <div class="col-md-4"><label class="form-label">Alokasi Waktu</label><input class="form-control" id="genAlokasiWaktu" placeholder="Contoh: 2 x 35 menit"></div>
        <div class="col-md-6"><label class="form-label">Jumlah Pertemuan</label><input type="number" class="form-control" id="genPertemuan" value="1" min="1"></div>
        <div class="col-md-6"><label class="form-label">Jumlah Sesi</label><input type="number" class="form-control" id="genSesi" value="1" min="1"></div>
      </div>
      <button class="btn btn-adaptiva-primary mt-3" id="btnGenerate" onclick="generateModulNow()"><i class="bi bi-stars"></i> Generate Modul Ajar (AI)</button>`;
    if (kelasList.length) onGenKelasChange();
  });
}
function onGenTemplateChange() {
  const isKBC = document.getElementById('genTemplate').value === 'Kurikulum Berbasis Cinta';
  document.getElementById('genKurikulumCintaWrap').style.display = isKBC ? '' : 'none';
}
function onGenKelasChange() {
  const kelasId = document.getElementById('genKelas').value;
  gsRun('getAsesmenByKelas', [kelasId], res => {
    const list = (res.data || []).filter(a => a.StatusAktif === 'Aktif');
    document.getElementById('genAsesmen').innerHTML = list.map(a => `<option value="${a.ID}">${esc(a.Judul)} — ${esc(a.Tanggal || '')}</option>`).join('') || '<option value="">Belum ada asesmen aktif</option>';
  });
  gsRun('getCPTPByKelas', [kelasId], res => {
    window.__genTPCPMap = {};
    let tpList = [];
    (res.data || []).forEach(c => c.TPJson.forEach(t => { window.__genTPCPMap[t.id] = c.TeksCP; tpList.push(t); }));
    document.getElementById('genTPWrap').innerHTML = tpList.length
      ? tpList.map(t => `<div class="form-check"><input class="form-check-input gen-tp-check" type="checkbox" value="${t.id}" id="tp_${t.id}" onchange="updateGenCPDisplay()"><label class="form-check-label" for="tp_${t.id}">${esc(t.teks)}</label></div>`).join('')
      : '<span class="text-muted">Belum ada TP untuk kelas ini.</span>';
    updateGenCPDisplay();
  });
}
function updateGenCPDisplay() {
  const checked = Array.from(document.querySelectorAll('.gen-tp-check:checked')).map(c => c.value);
  const cpSet = Array.from(new Set(checked.map(id => (window.__genTPCPMap || {})[id]).filter(Boolean)));
  const el = document.getElementById('genCPDisplay');
  if (el) el.value = cpSet.join('\n\n');
}
function generateModulNow() {
  const tpIds = Array.from(document.querySelectorAll('.gen-tp-check:checked')).map(c => c.value);
  if (tpIds.length === 0) { showToast('Peringatan', 'Pilih minimal 1 Tujuan Pembelajaran.', 'warning'); return; }
  const params = {
    kelasId: document.getElementById('genKelas').value, asesmenId: document.getElementById('genAsesmen').value,
    tpIds, materi: document.getElementById('genMateri').value,
    jumlahPertemuan: document.getElementById('genPertemuan').value, jumlahSesi: document.getElementById('genSesi').value,
    jenisTemplate: document.getElementById('genTemplate').value,
    jenjang: document.getElementById('genJenjang').value,
    kurikulumCintaTopik: Array.from(document.querySelectorAll('.gen-kc-check:checked')).map(c => c.value),
    dimensiProfilLulusan: Array.from(document.querySelectorAll('.gen-dpl-check:checked')).map(c => c.value),
    modelPembelajaran: document.getElementById('genModelPembelajaran').value,
    alokasiWaktu: document.getElementById('genAlokasiWaktu').value,
    namaSekolah: document.getElementById('genNamaSekolah').value,
    namaKepsek: document.getElementById('genNamaKepsek').value,
    nipKepsek: document.getElementById('genNipKepsek').value,
    namaGuru: document.getElementById('genNamaGuru').value,
    nipGuru: document.getElementById('genNipGuru').value,
    tahunPelajaran: document.getElementById('genTahunPelajaran').value
  };
  if (!params.materi) { showToast('Peringatan', 'Isi nama materi.', 'warning'); return; }
  const btn = document.getElementById('btnGenerate');
  btn.innerHTML = '<span class="spinner-inline"></span> Menggenerate...'; btn.disabled = true;
  gsRun('generateModulAjar', [params], res => {
    btn.innerHTML = '<i class="bi bi-stars"></i> Generate Modul Ajar (AI)'; btn.disabled = false;
    if (res.success) { showToast('Berhasil', res.message, 'success'); renderModulList(); }
    else showToast('Gagal', res.message, 'danger');
  }, err => { btn.innerHTML = '<i class="bi bi-stars"></i> Generate Modul Ajar (AI)'; btn.disabled = false; showToast('Error', err.message, 'danger'); });
}
function renderModulList() {
  showLoading('modulListWrap');
  gsRun('getModulAjarSaya', [], res => {
    const list = (res.data || []).sort((a,b) => new Date(b.Tanggal) - new Date(a.Tanggal));
    const rows = list.map(m => `
      <div class="card">
        <div class="card-header-flex">
          <div><h6 class="mb-1">${esc(m.Materi)}</h6><span class="badge-status ${STATUS_CLASS[m.Status]}">${esc(m.Status)}</span> <small class="text-muted ms-2">${esc(m.JenisTemplate)} • ${esc(m.Tanggal)}</small></div>
          <div>
            <button class="btn btn-sm btn-adaptiva-ghost" onclick="bukaEditorModul('${m.ID}')"><i class="bi bi-pencil-square"></i> Buka/Sunting</button>
            <button class="btn btn-sm btn-adaptiva-primary" onclick="lihatPratinjauModul('${m.ID}')"><i class="bi bi-eye"></i> Pratinjau</button>
            ${m.FilePdfUrl ? `<a class="btn btn-sm btn-adaptiva-secondary" href="${m.FilePdfUrl}" target="_blank"><i class="bi bi-download"></i> PDF</a>
              <a class="btn btn-sm btn-adaptiva-secondary" href="${m.FileDocUrl}" target="_blank"><i class="bi bi-file-earmark-word"></i> Word</a>` : ''}
            <button class="btn btn-sm btn-adaptiva-secondary" id="btnUnduh-${m.ID}" onclick="unduhModulAjar('${m.ID}')"><i class="bi bi-file-earmark-arrow-down"></i> ${m.FilePdfUrl ? 'Buat Ulang Dokumen' : 'Unduh Dokumen'}</button>
            <button class="btn btn-sm text-danger" onclick="hapusModulAjarNow('${m.ID}', '${escJsAttr(m.Materi)}')" title="Hapus Modul Ajar"><i class="bi bi-trash"></i></button>
          </div>
        </div>
        ${m.Status === 'Dikembalikan' && m.CatatanValidasi ? `<div class="alert alert-warning py-2 mb-0 small"><b>Catatan Validator:</b> ${esc(m.CatatanValidasi)}</div>` : ''}
      </div>`).join('');
    document.getElementById('modulListWrap').innerHTML = `<h6 class="mt-4 mb-2">Daftar Modul Ajar</h6>${rows || '<p class="text-muted">Belum ada Modul Ajar.</p>'}`;
  });
}
function hapusModulAjarNow(modulId, materi) {
  confirmDelete('hapusModulAjar', modulId, renderModulList,
    'Hapus Modul Ajar "' + materi + '"? Tindakan ini tidak dapat dibatalkan.');
}
function unduhModulAjar(modulId) {
  const btn = document.getElementById('btnUnduh-' + modulId);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="spinner-border spinner-border-sm"></i> Membuat dokumen...'; }
  // Fitur ini TETAP di GAS lama (DocumentApp tidak ada di Node/Vercel) — dipanggil lewat
  // gsRunLegacy() dengan email guru yang sedang login, lihat eksporModulAjarKeDokumenPublic di Kode.gs.
  gsRunLegacy('eksporModulAjarKeDokumenPublic', [modulId, (AppState.profile && AppState.profile.Email) || ''], res => {
    if (res.success) {
      showToast('Berhasil', 'Dokumen berhasil dibuat.', 'success');
      renderModulList();
    } else {
      showToast('Gagal', res.message, 'danger');
      if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
  }, err => { showToast('Error', err.message, 'danger'); if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; } });
}
// ════════════════════════════════════════════════════════
// PRATINJAU MODUL AJAR — tampilan dokumen resmi langsung di app, tanpa unduh.
// Mengikuti struktur yang sama dengan buildModulAjarDocument_ di Kode.gs.
// ════════════════════════════════════════════════════════
const TIER_ORDER_PREVIEW_ = ['mahir', 'berkembang', 'perluPendampingan'];
const TIER_LABEL_PREVIEW_ = { mahir: 'Kelompok Mahir', berkembang: 'Kelompok Berkembang', perluPendampingan: 'Kelompok Perlu Pendampingan' };
const DPL_LABELS_PREVIEW_ = ['Keimanan dan Ketakwaan terhadap Tuhan YME', 'Kewargaan', 'Penalaran Kritis', 'Kreativitas', 'Kolaborasi', 'Kemandirian', 'Kesehatan', 'Komunikasi'];
const KURIKULUM_CINTA_TOPIK_PREVIEW_ = ['Cinta Allah Swt. dan Rasul-Nya', 'Cinta Ilmu', 'Cinta Lingkungan', 'Cinta Diri dan Sesama Manusia', 'Cinta Tanah Air'];

function nl2br_(s) { return esc(s || '-').replace(/\n/g, '<br>'); }
// Menerima array ATAU string (kompatibel dengan modul lama berskema string).
function bulletHtml_(val) {
  const arr = Array.isArray(val) ? val : (val ? [val] : []);
  return arr.length ? ('• ' + arr.map(esc).join('<br>• ')) : '-';
}
function ringkasanKelompokHtml_(kelompokRingkasan, kelompokKeysAda) {
  if (kelompokRingkasan && kelompokRingkasan.length) {
    return kelompokRingkasan.map(k => esc(k.nama) + ' (' + esc(k.jumlahSiswa) + ' siswa, ' + esc(k.persentase) + '%)').join(', ');
  }
  return kelompokKeysAda.map(key => TIER_LABEL_PREVIEW_[key]).join(', ') || 'beberapa kelompok';
}
function praktikPedagogisHtml_(modelPembelajaran, pertemuanList) {
  const model = esc(modelPembelajaran || '-');
  const p1 = (pertemuanList && pertemuanList[0]) || {};
  const sintaksRingkasan = [
    (p1.tahapIntiMemahami || {}).sintaks,
    (p1.tahapIntiMengaplikasi || {}).sintaks,
    (p1.tahapIntiMerefleksi || {}).sintaks
  ].filter(Boolean).map(esc).join(' → ');
  return model + (sintaksRingkasan ? '<br><small>Sintaks: ' + sintaksRingkasan + '</small>' : '');
}
function checklistHtml_(allLabels, selected) {
  selected = selected || [];
  return allLabels.map(l => (selected.indexOf(l) !== -1 ? '☑ ' : '☐ ') + esc(l)).join('<br>');
}
function labelRowHtml_(label, contentHtml, isHeader) {
  return isHeader
    ? `<tr class="table-light"><th colspan="2">${esc(label)}</th></tr>`
    : `<tr><td class="text-nowrap fw-semibold" style="width:220px;vertical-align:top">${esc(label)}</td><td>${contentHtml || '-'}</td></tr>`;
}
function formatKelompokHtml_(tahap) {
  const kelompokObj = (tahap && tahap.kelompok) || {};
  const bagian = TIER_ORDER_PREVIEW_.filter(k => kelompokObj[k]).map(k => {
    const kp = kelompokObj[k] || {};
    return `<div class="mb-2"><b>${esc(TIER_LABEL_PREVIEW_[k])}:</b><br>${bulletHtml_(kp.kegiatan)}` +
      (kp.scaffolding ? `<br><i>Scaffolding:</i><br>${bulletHtml_(kp.scaffolding)}` : '') + '</div>';
  });
  return bagian.join('') || '-';
}
function pertemuanTableHtml_(p) {
  const awal = p.tahapAwal || {}, memahami = p.tahapIntiMemahami || {}, mengaplikasi = p.tahapIntiMengaplikasi || {},
        merefleksi = p.tahapIntiMerefleksi || {}, penutup = p.tahapPenutup || {};
  const baris = [
    ['Awal', bulletHtml_(awal.kegiatan), nl2br_(awal.prinsip), awal.waktu],
    ['Inti – Memahami' + (memahami.sintaks ? '<br><small>(' + esc(memahami.sintaks) + ')</small>' : ''), formatKelompokHtml_(memahami), nl2br_(memahami.prinsip), memahami.waktu],
    ['Inti – Mengaplikasi' + (mengaplikasi.sintaks ? '<br><small>(' + esc(mengaplikasi.sintaks) + ')</small>' : ''), formatKelompokHtml_(mengaplikasi), nl2br_(mengaplikasi.prinsip), mengaplikasi.waktu],
    ['Inti – Merefleksi' + (merefleksi.sintaks ? '<br><small>(' + esc(merefleksi.sintaks) + ')</small>' : ''), formatKelompokHtml_(merefleksi), nl2br_(merefleksi.prinsip), merefleksi.waktu],
    ['Penutup', bulletHtml_(penutup.kegiatan), nl2br_(penutup.prinsip), penutup.waktu]
  ];
  return `<h6 class="mt-3">Pertemuan ${esc(p.nomor)} — ${esc(p.judul)}${p.fokus ? ' (' + esc(p.fokus) + ')' : ''}</h6>
    <table class="table table-bordered table-sm doc-table">
      <thead><tr><th>Tahap / Sintaks</th><th>Kegiatan Konkret</th><th>Prinsip &amp; Insersi</th><th>Waktu</th></tr></thead>
      <tbody>${baris.map(b => `<tr><td style="width:160px">${b[0]}</td><td>${b[1]}</td><td style="width:220px">${b[2]}</td><td style="width:60px">${esc(b[3] || '-')}</td></tr>`).join('')}</tbody>
    </table>`;
}
function rubrikTableHtml_(judul, rubrik, jumlahBarisKelompok) {
  rubrik = rubrik || {};
  const aspekList = (rubrik.aspek && rubrik.aspek.length) ? rubrik.aspek : ['Aspek Penilaian'];
  const barisKosong = Array.from({ length: jumlahBarisKelompok }, (_, i) =>
    `<tr><td>${i + 1}</td><td></td>${aspekList.map(() => '<td></td>').join('')}<td></td></tr>`).join('');
  const pedomanList = (rubrik.pedomanSkor && rubrik.pedomanSkor.length) ? rubrik.pedomanSkor : aspekList.map(a => ({ aspek: a }));
  return `<h6 class="mt-3">${esc(judul)}</h6>
    <table class="table table-bordered table-sm doc-table"><thead><tr><th>No</th><th>Nama Kelompok</th>${aspekList.map(a => '<th>' + esc(a) + '</th>').join('')}<th>Jumlah Nilai</th></tr></thead>
    <tbody>${barisKosong}</tbody></table>
    <p class="fw-semibold mb-1">Pedoman Skor</p>
    <table class="table table-bordered table-sm doc-table"><thead><tr><th>Aspek Penilaian</th><th>Skor 4 (Sangat Baik)</th><th>Skor 3 (Baik)</th><th>Skor 2 (Cukup)</th><th>Skor 1 (Kurang)</th></tr></thead>
    <tbody>${pedomanList.map(pd => `<tr><td>${esc(pd.aspek || '-')}</td><td>${esc(pd.skor4 || '-')}</td><td>${esc(pd.skor3 || '-')}</td><td>${esc(pd.skor2 || '-')}</td><td>${esc(pd.skor1 || '-')}</td></tr>`).join('')}</tbody></table>
    <p class="small text-muted">Nilai Akhir = (Jumlah skor yang diperoleh ÷ ${aspekList.length * 4}) × 100.</p>`;
}
function karakterTableHtml_(instrumenKarakter) {
  instrumenKarakter = instrumenKarakter || [];
  if (!instrumenKarakter.length) return '';
  let no = 1, totalIndikator = 0;
  const rows = instrumenKarakter.map(dim => {
    const dimRow = `<tr class="table-light"><td></td><td class="fw-semibold">${esc(dim.dimensi || '-')}</td><td></td><td></td><td></td><td></td></tr>`;
    const indRows = (dim.indikator || []).map(ind => { totalIndikator++; return `<tr><td>${no++}</td><td>${esc(ind)}</td><td></td><td></td><td></td><td></td></tr>`; }).join('');
    return dimRow + indRows;
  }).join('');
  return `<h6 class="mt-3">a. Instrumen Penilaian Karakter (Dimensi Profil Lulusan)</h6>
    <p class="small text-muted mb-1">Teknik Penilaian: observasi guru dan penilaian diri.</p>
    <table class="table table-bordered table-sm doc-table"><thead><tr><th>No.</th><th>Dimensi dan Indikator</th><th>BM</th><th>MB</th><th>BSH</th><th>SB</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="small text-muted">Keterangan: BM = Belum Muncul (1); MB = Mulai Berkembang (2); BSH = Berkembang Sesuai Harapan (3); SB = Sangat Berkembang (4). Nilai akhir = (jumlah skor yang diperoleh / ${totalIndikator * 4}) × 100.</p>`;
}
function collectKelompokLintasPertemuan_(pertemuanList, tierKey) {
  const hasil = [];
  const tambah = val => {
    const arr = Array.isArray(val) ? val : (val ? [val] : []);
    arr.forEach(x => { if (x && hasil.indexOf(x) === -1) hasil.push(x); });
  };
  (pertemuanList || []).forEach(p => {
    const kp = p.tahapIntiMengaplikasi && p.tahapIntiMengaplikasi.kelompok && p.tahapIntiMengaplikasi.kelompok[tierKey];
    if (!kp) return;
    tambah(kp.kegiatan);
    tambah(kp.scaffolding);
  });
  return hasil;
}

function renderKontenPreviewHtml_(m) {
  const k = m.KontenJson || {};
  const isKBC = m.JenisTemplate === 'Kurikulum Berbasis Cinta';
  const info = k.informasiUmum || {};
  const asesmen = k.asesmen || {};
  const pertemuanList = k.pertemuan || [];
  const kelompokKeysAda = TIER_ORDER_PREVIEW_.filter(key =>
    pertemuanList.some(p => p.tahapIntiMengaplikasi && p.tahapIntiMengaplikasi.kelompok && p.tahapIntiMengaplikasi.kelompok[key]));

  let html = `<h4 class="text-center fw-bold mb-3">${isKBC ? 'PERENCANAAN PEMBELAJARAN MENDALAM (KURIKULUM BERBASIS CINTA)' : 'PERENCANAAN PEMBELAJARAN MENDALAM'}</h4>`;
  html += '<table class="table table-bordered doc-table">';
  html += labelRowHtml_('IDENTITAS', '', true);
  html += labelRowHtml_('Penyusun', esc(info.guru));
  html += labelRowHtml_('Sekolah', esc(info.sekolah));
  html += labelRowHtml_('Tahun Pelajaran', esc(info.tahunPelajaran));
  html += labelRowHtml_('Semester', esc(info.semester));
  html += labelRowHtml_('Mata Pelajaran', esc(info.mapel));
  html += labelRowHtml_('Kelas / Fase', esc(info.kelas) + ' / ' + esc(info.fase));
  html += labelRowHtml_('Topik / Elemen', esc(m.Materi));
  html += labelRowHtml_('Alokasi Waktu', esc(info.alokasiWaktu));
  html += labelRowHtml_('Identifikasi', '', true);
  html += labelRowHtml_('Murid', 'Kesiapan belajar bervariasi, terbagi menjadi ' +
    ringkasanKelompokHtml_(k.kelompokRingkasan, kelompokKeysAda) +
    ' berdasarkan hasil asesmen diagnostik — lihat rincian kegiatan &amp; scaffolding tiap kelompok pada tahap Mengaplikasi setiap pertemuan di bagian Pengalaman Belajar.');
  html += labelRowHtml_('Materi Pelajaran', 'Materi: ' + esc(m.Materi) + ' (' + esc(info.mapel) + ', ' + esc(info.kelas) + '/' + esc(info.fase) + ').');
  html += labelRowHtml_('Dimensi Profil Lulusan', checklistHtml_(DPL_LABELS_PREVIEW_, info.dimensiProfilLulusan || []));
  if (isKBC) {
    html += labelRowHtml_('Topik Kurikulum Cinta', checklistHtml_(KURIKULUM_CINTA_TOPIK_PREVIEW_, info.topikKurikulumCinta || []));
    html += labelRowHtml_('Materi Insersi', nl2br_(k.pemahamanBermakna));
  }
  html += labelRowHtml_('Desain Pembelajaran', '', true);
  html += labelRowHtml_('Capaian Pembelajaran', nl2br_(m.CapaianPembelajaranText));
  html += labelRowHtml_('Lintas Disiplin Ilmu', bulletHtml_(k.lintasDisiplinIlmu));
  html += labelRowHtml_('Tujuan Pembelajaran', bulletHtml_(k.tujuanPembelajaran));
  html += labelRowHtml_('Topik Pembelajaran', esc(k.topikPembelajaran || m.Materi));
  html += labelRowHtml_('Pertanyaan Pemantik', bulletHtml_(k.pertanyaanPemantik));
  html += labelRowHtml_('Praktik Pedagogis', praktikPedagogisHtml_(info.modelPembelajaran, pertemuanList));
  html += labelRowHtml_('Kemitraan Pembelajaran', bulletHtml_(k.kemitraanPembelajaran));
  html += labelRowHtml_('Lingkungan Pembelajaran', bulletHtml_(k.lingkunganPembelajaran));
  html += labelRowHtml_('Pemanfaatan Digital', bulletHtml_(k.pemanfaatanDigital));
  html += '</table>';

  html += '<h5 class="mt-4">Pengalaman Belajar</h5>';
  html += `<p class="small text-muted">Setiap tahap pembelajaran dirancang dengan prinsip pembelajaran mendalam: berkesadaran (mindful), bermakna (meaningful), dan menggembirakan (joyful)` +
    (isKBC ? ', serta menyisipkan nilai Panca Cinta.' : '.') + ` Model pembelajaran: ${esc(info.modelPembelajaran)}.</p>`;
  html += pertemuanList.map(pertemuanTableHtml_).join('');

  html += '<h5 class="mt-4">Asesmen Pembelajaran</h5>';
  html += '<table class="table table-bordered doc-table">' +
    labelRowHtml_('Asesmen pada Awal Pembelajaran', nl2br_(asesmen.awal)) +
    labelRowHtml_('Asesmen pada Proses Pembelajaran', nl2br_(asesmen.proses)) +
    labelRowHtml_('Asesmen pada Akhir Pembelajaran', nl2br_(asesmen.akhir)) + '</table>';

  html += '<hr><h5 class="mt-4">Lampiran — Asesmen / Penilaian Hasil Pembelajaran</h5>';
  html += '<h6>1. Asesmen Diagnostik Non-Kognitif</h6>';
  const diagnostikList = (k.asesmenDiagnostikNonKognitif && k.asesmenDiagnostikNonKognitif.length) ? k.asesmenDiagnostikNonKognitif : ['Apa kabar hari ini?'];
  html += '<table class="table table-bordered table-sm doc-table"><thead><tr><th>No</th><th>Pertanyaan</th><th>Ya</th><th>Tidak</th></tr></thead><tbody>' +
    diagnostikList.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q)}</td><td></td><td></td></tr>`).join('') + '</tbody></table>';

  html += '<h6 class="mt-3">2. Asesmen Formatif</h6>';
  html += '<p class="small">Diskusi, Presentasi, dan Unjuk Kerja dinilai menggunakan rubrik berikut.</p>';
  html += karakterTableHtml_(k.instrumenKarakter);
  html += rubrikTableHtml_('b. Instrumen Penilaian Pengetahuan — Penilaian Kelompok Mengerjakan LKPD', k.rubrikPengetahuan, 5);
  html += rubrikTableHtml_('c. Instrumen Penilaian Keterampilan — Penilaian Hasil Unjuk Kerja Kelompok', k.rubrikKeterampilan, 5);

  html += '<h6 class="mt-3">Pengayaan dan Remedial</h6>';
  const strategiRemedial = collectKelompokLintasPertemuan_(pertemuanList, 'perluPendampingan');
  const strategiPengayaan = collectKelompokLintasPertemuan_(pertemuanList, 'mahir');
  html += `<p><b>Remedial</b> — Membantu peserta didik pada Kelompok Perlu Pendampingan agar dapat mengikuti pembelajaran ${esc(m.Materi)} sesuai tujuan pembelajaran.</p>` +
    (strategiRemedial.length ? '<ul>' + strategiRemedial.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '');
  html += `<p><b>Pengayaan</b> — Memberikan tantangan lebih bagi peserta didik pada Kelompok Mahir untuk memperdalam dan memperluas pemahaman tentang ${esc(m.Materi)}.</p>` +
    (strategiPengayaan.length ? '<ul>' + strategiPengayaan.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '');

  html += '<h6 class="mt-3">Refleksi Guru dan Peserta Didik</h6>';
  html += (k.refleksiGuru && k.refleksiGuru.length) ? '<p><b>Refleksi Guru:</b></p><ul>' + k.refleksiGuru.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '';
  html += (k.refleksiSiswa && k.refleksiSiswa.length) ? '<p><b>Refleksi Peserta Didik:</b></p><ol>' + k.refleksiSiswa.map(r => '<li>' + esc(r) + '</li>').join('') + '</ol>' : '';
  return html;
}

function lihatPratinjauModul(modulId) {
  gsRun('getModulAjarDetail', [modulId], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    const m = res.data;
    document.getElementById('previewModalTitle').textContent = 'Pratinjau Modul Ajar — ' + m.Materi;
    document.getElementById('previewModalBody').innerHTML = renderKontenPreviewHtml_(m);
    document.getElementById('previewModalFooter').innerHTML = `
      <button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>
      ${m.FilePdfUrl ? `<a class="btn btn-adaptiva-primary" href="${m.FilePdfUrl}" target="_blank"><i class="bi bi-download"></i> Unduh PDF</a>` : `<button class="btn btn-adaptiva-primary" onclick="unduhModulAjar('${m.ID}')">Unduh Dokumen</button>`}`;
    new bootstrap.Modal(document.getElementById('previewModal')).show();
  });
}

function bukaEditorModul(modulId) {
  gsRun('getModulAjarDetail', [modulId], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    const m = res.data; const k = m.KontenJson;
    const info = k.informasiUmum || {};
    window._editorKontenAsli = k; // simpan konten lengkap (field lain spt rubrik/instrumenKarakter ikut dibawa saat simpan)
    const body = `
      <p class="text-muted small mb-3">Lihat hasil lengkap terformat lewat tombol <b>Pratinjau</b> pada daftar Modul Ajar. Editor di bawah untuk menyunting bagian inti saja.</p>
      <div class="mb-3"><label class="form-label">Tujuan Pembelajaran</label>
        <textarea class="form-control" id="edTujuan" rows="2">${esc((k.tujuanPembelajaran || []).join(String.fromCharCode(10)))}</textarea></div>
      <div class="mb-3"><label class="form-label">Pemahaman Bermakna</label><textarea class="form-control" id="edPemahaman" rows="2">${esc(k.pemahamanBermakna)}</textarea></div>
      <div class="mb-3"><label class="form-label">Pertanyaan Pemantik</label><textarea class="form-control" id="edPemantik" rows="2">${esc((k.pertanyaanPemantik || []).join(String.fromCharCode(10)))}</textarea></div>
      <div class="mb-3"><label class="form-label">Pengalaman Belajar per Pertemuan (JSON, disunting AI — tahap Mengaplikasi berisi diferensiasi per kelompok)</label>
        <textarea class="form-control" id="edPertemuan" rows="10" style="font-family:monospace;font-size:.8rem">${esc(JSON.stringify(k.pertemuan || [], null, 2))}</textarea></div>
      <div class="mb-3"><label class="form-label">Asesmen (Awal / Proses / Akhir)</label>
        <textarea class="form-control" id="edAsesmen" rows="3">${esc(JSON.stringify(k.asesmen || {}, null, 2))}</textarea></div>
      <div class="mb-3"><label class="form-label">Refleksi Guru</label><textarea class="form-control" id="edRefleksi" rows="2">${esc((k.refleksiGuru || []).join(String.fromCharCode(10)))}</textarea></div>
      ${m.Status === 'Draft' || m.Status === 'Dikembalikan' ? `
      <hr><label class="form-label">Ajukan ke Kepala Sekolah/Pengawas (Validator)</label>
      <div id="validatorSelectWrap"></div>` : ''}`;
    openModal('Editor Modul Ajar — ' + m.Materi, body, `
      <button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>
      <button class="btn btn-adaptiva-ghost" onclick="lihatPratinjauModul('${modulId}')"><i class="bi bi-eye"></i> Pratinjau</button>
      <button class="btn btn-adaptiva-secondary" onclick="simpanEditorModul('${modulId}')">Simpan Perubahan</button>
      ${(m.Status === 'Draft' || m.Status === 'Dikembalikan') ? `<button class="btn btn-adaptiva-primary" onclick="ajukanValidasiNow('${modulId}')">Ajukan Validasi</button>` : ''}`);
    if (m.Status === 'Draft' || m.Status === 'Dikembalikan') renderValidatorSelect();
  });
}
function renderValidatorSelect() {
  gsRun('getDaftarValidator', [], res => {
    const kepsekList = res.data || [];
    document.getElementById('validatorSelectWrap').innerHTML = kepsekList.length
      ? `<select class="form-select" id="fValidator">${kepsekList.map(u => `<option value="${u.Email}">${esc(u.Nama)} (${esc(u.Sekolah)})</option>`).join('')}</select>`
      : '<span class="text-danger small">Belum ada Kepala Sekolah/Pengawas terdaftar. Hubungi Admin.</span>';
  });
}
function simpanEditorModul(modulId) {
  let pertemuan = [], asesmen = {};
  try { pertemuan = JSON.parse(document.getElementById('edPertemuan').value); } catch(e) { showToast('Error', 'Format JSON Pengalaman Belajar/Pertemuan tidak valid.', 'danger'); return; }
  try { asesmen = JSON.parse(document.getElementById('edAsesmen').value); } catch(e) { showToast('Error', 'Format JSON Asesmen tidak valid.', 'danger'); return; }
  // Gabungkan dengan konten asli supaya field lain (informasiUmum, rubrikPengetahuan/Keterampilan,
  // instrumenKarakter, asesmenDiagnostikNonKognitif, dst.) tidak hilang saat disimpan.
  const konten = Object.assign({}, window._editorKontenAsli || {}, {
    tujuanPembelajaran: document.getElementById('edTujuan').value.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean),
    pemahamanBermakna: document.getElementById('edPemahaman').value,
    pertanyaanPemantik: document.getElementById('edPemantik').value.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean),
    pertemuan: pertemuan, asesmen: asesmen,
    refleksiGuru: document.getElementById('edRefleksi').value.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean)
  });
  gsRun('simpanEditModulAjar', [modulId, konten], res => {
    if (res.success) { showToast('Tersimpan', 'Perubahan tersimpan.', 'success'); } else showToast('Gagal', res.message, 'danger');
  });
}
function ajukanValidasiNow(modulId) {
  const sel = document.getElementById('fValidator');
  if (!sel || !sel.value) { showToast('Peringatan', 'Pilih validator terlebih dahulu.', 'warning'); return; }
  gsRun('ajukanValidasi', [modulId, sel.value], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); closeModal(); renderModulList(); }
    else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// VALIDASI (KEPALA SEKOLAH / PENGAWAS)
// ════════════════════════════════════════════════════════

function loadValidasiSection() {
  showLoading('section-validasi');
  gsRun('getModulUntukValidasi', [], res => {
    const list = res.data || [];
    const rows = list.map(m => `
      <div class="card">
        <div class="card-header-flex">
          <div><h6 class="mb-1">${esc(m.Materi)}</h6><small class="text-muted">${esc(m.JenisTemplate)} • Diajukan ${esc(m.Tanggal)}</small></div>
          <button class="btn btn-sm btn-adaptiva-ghost" onclick="lihatDetailValidasi('${m.ID}')"><i class="bi bi-eye"></i> Tinjau &amp; Validasi</button>
        </div>
      </div>`).join('');
    document.getElementById('section-validasi').innerHTML = `
      <div class="page-eyebrow">Validasi</div><div class="page-title">Validasi Modul Ajar</div>
      <div class="page-subtitle">Tinjau Modul Ajar yang diajukan guru binaan sebelum dapat diunduh.</div>
      ${rows || '<p class="text-muted">Tidak ada Modul Ajar yang menunggu validasi.</p>'}`;
  });
}
function lihatDetailValidasi(modulId) {
  gsRun('getModulAjarDetail', [modulId], res => {
    const m = res.data;
    const body = `${renderKontenPreviewHtml_(m)}
      <hr><label class="form-label">Catatan (wajib bila dikembalikan)</label><textarea class="form-control" id="fCatatanValidasi" rows="3"></textarea>`;
    openModal('Tinjau Modul Ajar — ' + m.Materi, body, `
      <button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Tutup</button>
      <button class="btn btn-danger" onclick="prosesValidasiNow('${modulId}','kembalikan')">Kembalikan dengan Catatan</button>
      <button class="btn btn-adaptiva-primary" onclick="prosesValidasiNow('${modulId}','setuju')">Setujui &amp; Validasi</button>`);
  });
}
function prosesValidasiNow(modulId, keputusan) {
  const catatan = document.getElementById('fCatatanValidasi').value;
  if (keputusan === 'kembalikan' && !catatan) { showToast('Peringatan', 'Catatan wajib diisi bila mengembalikan.', 'warning'); return; }
  gsRun('prosesValidasi', [modulId, keputusan, catatan], res => {
    if (res.success) { showToast('Berhasil', res.message, 'success'); closeModal(); loadValidasiSection(); }
    else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// BANK REFERENSI (Admin)
// ════════════════════════════════════════════════════════

function loadBankReferensiSection() {
  showLoading('section-bankReferensi');
  gsRun('getBankStrategi', [], res => {
    const list = res.data || [];
    const rows = list.map(b => `<tr><td>${esc(b.Dimensi)}</td><td>${esc(b.TingkatKesiapan)}</td><td>${esc(b.Deskripsi)}</td>
      <td><button class="btn btn-sm text-danger" onclick="confirmDelete('hapusBankStrategi','${b.ID}', loadBankReferensiSection)"><i class="bi bi-trash"></i></button></td></tr>`).join('');
    document.getElementById('section-bankReferensi').innerHTML = `
      <div class="page-eyebrow">Referensi</div><div class="page-title">Bank Referensi</div>
      <div class="page-subtitle">Bank Strategi Diferensiasi &amp; Bank CP-TP IPAS yang dapat dipakai guru.</div>
      <button class="btn btn-adaptiva-primary mb-3" onclick="tambahBankStrategiModal()"><i class="bi bi-plus-lg"></i> Tambah Strategi Diferensiasi</button>
      <div class="table-responsive"><table class="table"><thead><tr><th>Dimensi</th><th>Tingkat Kesiapan</th><th>Deskripsi</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="text-center text-muted py-3">Belum ada data.</td></tr>'}</tbody></table></div>`;
  });
}
function tambahBankStrategiModal() {
  openModal('Tambah Strategi Diferensiasi', `
    <div class="mb-3"><label class="form-label">Dimensi</label><select class="form-select" id="fDimensi"><option>Konten</option><option>Proses</option><option>Produk</option></select></div>
    <div class="mb-3"><label class="form-label">Tingkat Kesiapan</label><select class="form-select" id="fTingkat"><option>Rendah</option><option>Sedang</option><option>Tinggi</option></select></div>
    <div class="mb-3"><label class="form-label">Deskripsi Strategi</label><textarea class="form-control" id="fDeskripsi" rows="3"></textarea></div>`,
    `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="simpanBankStrategiNow()">Simpan</button>`);
}
function simpanBankStrategiNow() {
  const obj = { Dimensi: document.getElementById('fDimensi').value, TingkatKesiapan: document.getElementById('fTingkat').value, Deskripsi: document.getElementById('fDeskripsi').value };
  gsRun('kelolaBankStrategi', [obj], res => { if (res.success) { closeModal(); loadBankReferensiSection(); } else showToast('Gagal', res.message, 'danger'); });
}

// ════════════════════════════════════════════════════════
// KELOLA AKUN (Admin/Superadmin)
// ════════════════════════════════════════════════════════

function loadAkunSection() {
  showLoading('section-akun');
  gsRun('getDaftarAkun', [], res => {
    const list = res.data || [];
    const rows = list.map(u => `<tr><td>${esc(u.Sapaan ? u.Sapaan + ' ' + u.Nama : u.Nama)}</td><td>${esc(u.Email)}</td><td>${esc(u.Peran)}</td><td>${esc(u.Sekolah)}</td>
      <td><span class="badge-status ${u.Status === 'Aktif' ? 'tervalidasi' : 'draft'}">${esc(u.Status)}</span></td>
      <td class="text-end">
        <button class="btn btn-sm btn-adaptiva-ghost" onclick="ubahPasswordAkunModal('${u.ID}','${esc(u.Nama)}')" title="Ubah Password"><i class="bi bi-key"></i></button>
        <button class="btn btn-sm btn-adaptiva-ghost" onclick="ubahStatusAkunNow('${u.ID}','${u.Status === 'Aktif' ? 'Nonaktif' : 'Aktif'}')">${u.Status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </td></tr>`).join('');
    document.getElementById('section-akun').innerHTML = `
      <div class="page-eyebrow">Manajemen</div><div class="page-title">Kelola Akun</div>
      <div class="page-subtitle">Daftarkan akun email + password untuk Guru dan Kepala Sekolah/Pengawas (maksimal 100 guru).</div>
      <button class="btn btn-adaptiva-primary mb-3" onclick="daftarkanAkunModal()"><i class="bi bi-person-plus"></i> Daftarkan Akun</button>
      <div class="table-responsive"><table class="table"><thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Sekolah</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="text-center text-muted py-3">Belum ada akun.</td></tr>'}</tbody></table></div>`;
  });
}
function daftarkanAkunModal() {
  const role = AppState.profile.Peran;
  openModal('Daftarkan Akun', `
    <div class="mb-3"><label class="form-label">Email</label><input type="email" class="form-control" id="fEmailAkun" placeholder="nama@email.com"></div>
    <div class="mb-3"><label class="form-label">Password Awal</label><input type="text" class="form-control" id="fPasswordAkun" placeholder="Minimal 6 karakter"></div>
    <div class="mb-3"><label class="form-label">Sapaan</label><select class="form-select" id="fSapaanAkun">
      <option value="Ibu">Ibu</option><option value="Bapak">Bapak</option>
    </select></div>
    <div class="mb-3"><label class="form-label">Nama Lengkap</label><input class="form-control" id="fNamaAkun"></div>
    <div class="mb-3"><label class="form-label">Peran</label><select class="form-select" id="fPeranAkun">
      <option value="Guru">Guru</option><option value="KepalaSekolah">Kepala Sekolah/Madrasah &amp; Pengawas</option>
      ${role === 'Superadmin' ? '<option value="Admin">Admin</option>' : ''}
    </select></div>
    <div class="mb-3"><label class="form-label">Sekolah/Madrasah</label><input class="form-control" id="fSekolahAkun"></div>`,
    `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="daftarkanAkunNow()">Daftarkan</button>`);
}
function daftarkanAkunNow() {
  const email = document.getElementById('fEmailAkun').value, nama = document.getElementById('fNamaAkun').value;
  const peran = document.getElementById('fPeranAkun').value, sekolah = document.getElementById('fSekolahAkun').value;
  const sapaan = document.getElementById('fSapaanAkun').value, password = document.getElementById('fPasswordAkun').value;
  if (!email || !nama || !password) { showToast('Peringatan', 'Email, nama, dan password wajib diisi.', 'warning'); return; }
  gsRun('daftarkanAkun', [email, nama, peran, sekolah, sapaan, password], res => {
    if (res.success) { showToast('Berhasil', 'Akun berhasil didaftarkan. Beritahu email & password ini ke yang bersangkutan.', 'success'); closeModal(); loadAkunSection(); }
    else showToast('Gagal', res.message, 'danger');
  });
}
function ubahStatusAkunNow(id, status) {
  gsRun('ubahStatusAkun', [id, status], res => { if (res.success) loadAkunSection(); });
}
function ubahPasswordAkunModal(id, nama) {
  openModal('Ubah Password — ' + nama, `
    <div class="mb-3"><label class="form-label">Password Baru</label><input type="text" class="form-control" id="fPasswordBaru" placeholder="Minimal 6 karakter"></div>`,
    `<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="ubahPasswordAkunNow('${id}')">Simpan</button>`);
}
function ubahPasswordAkunNow(id) {
  const password = document.getElementById('fPasswordBaru').value;
  if (!password) { showToast('Peringatan', 'Password baru wajib diisi.', 'warning'); return; }
  gsRun('ubahPasswordAkun', [id, password], res => {
    if (res.success) { showToast('Berhasil', 'Password berhasil diubah.', 'success'); closeModal(); }
    else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// PENGATURAN (Admin/Superadmin)
// ════════════════════════════════════════════════════════

function loadPengaturanSection() {
  gsRun('getAllConfig', [], res => {
    const c = res.data || {};
    document.getElementById('section-pengaturan').innerHTML = `
      <div class="page-eyebrow">Sistem</div><div class="page-title">Pengaturan</div>
      <div class="card">
        <h6 class="mb-3">Konfigurasi AI (Generator Modul Ajar)</h6>
        <label class="form-label">Gemini API Key</label>
        <input class="form-control mb-3" id="fGeminiKey" value="${esc(c.geminiApiKey)}" placeholder="Masukkan API Key dari Google AI Studio">
        <button class="btn btn-adaptiva-primary" onclick="simpanPengaturan()">Simpan Pengaturan</button>
      </div>
      <div class="card mt-3">
        <h6 class="mb-2">Validasi Modul Ajar</h6>
        <div class="form-check form-switch mb-2">
          <input class="form-check-input" type="checkbox" id="fWajibValidasi" ${c.wajibValidasiModulAjar === 'true' ? 'checked' : ''}>
          <label class="form-check-label" for="fWajibValidasi">Wajibkan validasi Kepala Sekolah/Pengawas sebelum Modul Ajar bisa diunduh</label>
        </div>
        <p class="text-muted small mb-3">Saat ini masa ujicoba &mdash; biarkan OFF agar guru bisa langsung mengunduh dokumen tanpa menunggu validasi. Menu validasi Kepala Sekolah/Pengawas tetap aktif dan bisa dipakai kapan pun; nyalakan opsi ini jika nanti validasi ingin dijadikan wajib sebelum unduh.</p>
        <button class="btn btn-adaptiva-primary" onclick="simpanValidasiToggle()">Simpan</button>
      </div>`;
  });
}
function simpanPengaturan() {
  gsRun('setConfig', ['geminiApiKey', document.getElementById('fGeminiKey').value], res => {
    if (res.success) showToast('Tersimpan', 'Pengaturan disimpan.', 'success'); else showToast('Gagal', res.message, 'danger');
  });
}
function simpanValidasiToggle() {
  const val = document.getElementById('fWajibValidasi').checked ? 'true' : 'false';
  gsRun('setConfig', ['wajibValidasiModulAjar', val], res => {
    if (res.success) showToast('Tersimpan', 'Pengaturan validasi disimpan.', 'success'); else showToast('Gagal', res.message, 'danger');
  });
}

// ════════════════════════════════════════════════════════
// HALAMAN PUBLIK: ASESMEN DIAGNOSTIK SISWA (tanpa login)
// ════════════════════════════════════════════════════════

function initPublicForm() {
  const token = window.ADAPTIVA_FORM_TOKEN;
  if (!token) { document.getElementById('publicContent').innerHTML = '<p class="text-danger text-center">Tautan tidak valid.</p>'; return; }
  gsRun('getPublicAssessment', [token], res => {
    if (!res.success) { document.getElementById('publicContent').innerHTML = `<p class="text-danger text-center">${esc(res.message)}</p>`; return; }
    renderPublicForm(res.data, token);
  });
}
// ════════════════════════════════════════════════════════
// MISI SAINTIS CILIK: PETUALANGAN ENERGI
// (asesmen diagnostik dikemas sebagai game agar terasa menyenangkan bagi siswa,
// tanpa mengubah struktur data yang dikirim ke submitPublicResponse)
// ════════════════════════════════════════════════════════

const MISI_META = {
  kognitif:     { key: 'kognitif', badge: 'MISI 1 · BERBURU ENERGI', cls: 'm1', mascot: '🧑‍🔬', judul: 'Temukan kristal energi yang hilang!' },
  gaya_belajar: { key: 'gaya_belajar', badge: 'MISI 2 · CARA BELAJARMU', cls: 'm2', mascot: '🤖', judul: 'Pilih aktivitas favoritmu di laboratorium.' },
  minat:        { key: 'minat', badge: 'MISI 3 · TANGKI SEMANGAT', cls: 'm3', mascot: '🦉', judul: 'Isi tangki semangat Robo IPA!' }
};
const GAME_EMOJI = ['😞', '😐', '🙂', '😊', '🤩'];
// Feedback setelah menjawab soal Likert (gaya belajar/minat) disesuaikan per tingkat jawaban,
// bukan kalimat antusias acak untuk semua pilihan — supaya jawaban seperti "Jarang" tidak
// mendapat reaksi seolah-olah itu capaian yang membanggakan.
const MASCOT_LINES_BY_LEVEL = [
  { emoji: '😶', text: 'Terima kasih sudah jujur, Saintis Cilik!' },
  { emoji: '😐', text: 'Baik, dicatat ya.' },
  { emoji: '🙂', text: 'Oke, Robo IPA mencatatnya!' },
  { emoji: '😄', text: 'Keren, terus semangat belajar!' },
  { emoji: '🤩', text: 'Luar biasa! Profesor Energi bangga sekali!' }
];

function renderPublicForm(data, token) {
  const { asesmen, kelas, siswaList } = data;
  window._game = {
    data, token, siswaId: '', points: 0, stars: 0,
    missions: ['kognitif', 'gaya_belajar', 'minat']
      .map(j => ({ jenis: j, soal: data.soalList.filter(s => (s.JenisInstrumen || '').toString().trim().toLowerCase() === j) }))
      .filter(m => m.soal.length > 0),
    mIdx: 0, qIdx: 0, jawaban: {}
  };
  const siswaOptions = siswaList.map(s => `<option value="${s.ID}">${esc(s.Nama)}</option>`).join('');

  document.getElementById('publicContent').innerHTML = `
    <div class="game-characters">🧑‍🔬 🤖 🦉</div>
    <div class="game-intro-title">Misi Saintis Cilik</div>
    <p class="text-center fw-semibold" style="color:#FF7A00;">Petualangan Energi</p>
    <p class="game-intro-sub">Halo, Saintis Cilik! Hari ini kamu akan menjelajahi Pulau Energi:
      memecahkan teka-teki, menemukan cara belajar favoritmu, dan menunjukkan rasa ingin tahumu tentang IPA.
      <br><b>Tidak ada jawaban yang salah.</b> Jawablah sesuai dirimu!</p>
    <p class="small text-muted text-center mb-1">${esc(asesmen.Judul)} — ${esc(kelas ? kelas.NamaKelas : '')}</p>
    <label class="form-label fw-bold">Siapa namamu?</label>
    <select class="form-select mb-3" id="pubSiswaId"><option value="">-- Pilih nama --</option>${siswaOptions}</select>
    <button class="game-btn-primary" onclick="mulaiPetualangan()"><i class="bi bi-rocket-takeoff"></i> Mulai Petualangan!</button>`;
}

function mulaiPetualangan() {
  const siswaId = document.getElementById('pubSiswaId').value;
  if (!siswaId) { showToast('Peringatan', 'Pilih namamu dahulu, ya!', 'warning'); return; }
  const g = window._game;
  if (!g.missions || !g.missions.length) {
    document.getElementById('publicContent').innerHTML = `
      <div class="text-center py-4">
        <p class="text-danger fw-bold">Asesmen ini belum memiliki soal.</p>
        <p class="text-muted small">Minta gurumu membuka menu "Asesmen Diagnostik" &rarr; "Kelola Soal", lalu memuat soal dari Bank Soal atau membuat soal dengan AI terlebih dahulu.</p>
      </div>`;
    return;
  }
  g.siswaId = siswaId;
  g.mIdx = 0; g.qIdx = 0;
  renderGameQuestion();
}

function totalSoalGame() {
  return window._game.missions.reduce((n, m) => n + m.soal.length, 0);
}
function soalKeGame() {
  let n = 0;
  for (let i = 0; i < window._game.mIdx; i++) n += window._game.missions[i].soal.length;
  return n + window._game.qIdx;
}

function renderGameQuestion() {
  const g = window._game;
  const mission = g.missions[g.mIdx];
  if (!mission) { selesaikanGame(); return; }
  const meta = MISI_META[mission.jenis];
  const soal = mission.soal[g.qIdx];
  const progress = Math.round((soalKeGame() / totalSoalGame()) * 100);

  let answersHtml;
  if (mission.jenis === 'kognitif') {
    const huruf = ['A', 'B', 'C', 'D', 'E'];
    answersHtml = `<div class="game-answers">${soal.OpsiJSON.map((o, i) =>
      `<button type="button" class="game-answer-btn" onclick="jawabKognitif(${i})"><b>${huruf[i]}</b><span>${esc(o.label.replace(/^[A-E][\.\)]\s*/, ''))}</span></button>`).join('')}</div>`;
  } else {
    answersHtml = `<div class="game-emoji-scale">${soal.OpsiJSON.map((o, i) =>
      `<div class="game-emoji-btn" onclick="jawabLikert(${i})"><span class="em">${GAME_EMOJI[i] || '🙂'}</span>${esc(o.label)}</div>`).join('')}</div>`;
  }

  document.getElementById('publicContent').innerHTML = `
    <div class="game-topbar">
      <span class="game-mascot">${meta.mascot}</span>
      <div class="game-progress-track"><div class="game-progress-fill" style="width:${progress}%"></div></div>
      <span class="game-stars">⭐ ${g.stars}</span>
    </div>
    <span class="mission-badge ${meta.cls}">${meta.badge}</span>
    <div class="game-question">${esc(soal.ButirSoal)}</div>
    <div id="gameAnswerArea">${answersHtml}</div>
    <div id="gameFeedback"></div>`;
}

function _lanjutSoalGame(answerLabel) {
  const g = window._game;
  const mission = g.missions[g.mIdx];
  const soal = mission.soal[g.qIdx];
  g.jawaban[soal.ButirSoal] = answerLabel;

  g.qIdx++;
  if (g.qIdx >= mission.soal.length) { g.qIdx = 0; g.mIdx++; }

  if (g.mIdx >= g.missions.length) selesaikanGame();
  else setTimeout(renderGameQuestion, 700);
}

function jawabKognitif(i) {
  const g = window._game;
  const soal = g.missions[g.mIdx].soal[g.qIdx];
  const opsi = soal.OpsiJSON[i];
  const btns = document.querySelectorAll('#gameAnswerArea .game-answer-btn');
  btns.forEach(b => b.disabled = true);
  const benar = opsi.value && soal.KunciJawaban && opsi.value === soal.KunciJawaban;
  btns[i].classList.add(benar ? 'correct' : 'wrong');
  if (benar) { g.stars++; g.points += 10; }
  document.getElementById('gameFeedback').innerHTML =
    `<div class="game-feedback ${benar ? 'ok' : 'no'}">${benar ? '⭐ +10! Tepat sekali!' : 'Belum tepat, tapi tetap semangat!'}</div>`;
  _lanjutSoalGame(opsi.label);
}

function jawabLikert(i) {
  const g = window._game;
  const soal = g.missions[g.mIdx].soal[g.qIdx];
  const opsi = soal.OpsiJSON[i];
  const m = MASCOT_LINES_BY_LEVEL[i] || MASCOT_LINES_BY_LEVEL[2];
  document.getElementById('gameFeedback').innerHTML =
    `<div class="game-feedback ok">${m.emoji} ${m.text}</div>`;
  _lanjutSoalGame(opsi.label);
}

function selesaikanGame() {
  const g = window._game;
  document.getElementById('publicContent').innerHTML = `
    <div class="text-center py-3">
      <div class="spinner-border text-primary" role="status"></div>
      <p class="mt-2 text-muted">Menyimpan petualanganmu...</p>
    </div>`;
  gsRun('submitPublicResponse', [g.token, g.siswaId, g.jawaban], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    document.getElementById('publicContent').innerHTML = `
      <div class="text-center py-2">
        <div class="game-result-badge">🏆</div>
        <div class="game-intro-title">Misi Selesai!</div>
        <p class="game-intro-sub">Kamu mengumpulkan <b style="color:#FF7A00">⭐ ${g.stars}</b> bintang dalam petualangan ini.<br>
        Setiap anak punya cara belajar yang unik — teruslah bereksperimen dan bertanya!</p>
        <p class="small text-muted">Hasil lengkapmu sudah dikirim ke gurumu. Sampai jumpa di misi berikutnya, Saintis Cilik! 🚀</p>
      </div>`;
    tembakConfetti();
  });
}

// Confetti sederhana pakai canvas, tanpa library eksternal.
function tembakConfetti() {
  const canvas = document.getElementById('gameConfettiCanvas');
  if (!canvas) return;
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#FF7A00', '#FFC107', '#43A047', '#1E88E5', '#E53935'];
  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.5,
    r: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)],
    vy: 2 + Math.random() * 3, vx: -2 + Math.random() * 4, rot: Math.random() * 360, vr: -6 + Math.random() * 12
  }));
  let frame = 0;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6);
      ctx.restore();
    });
    frame++;
    if (frame < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
}
