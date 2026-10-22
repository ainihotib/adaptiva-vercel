// ============================================================
// api/rpc.js — SATU endpoint Vercel yang menggantikan /exec milik Apps
// Script. Sengaja dibuat menerima payload {fnName, argsArray, sessionToken}
// yang SAMA PERSIS dengan sebelumnya, supaya di frontend (app.js) cukup
// mengganti GAS_URL — tidak perlu mengubah setiap pemanggilan gsRun(...).
//
// CATATAN TAHAP: fungsi yang sudah dipindah ke sini ada di FN_REGISTRY di
// bawah. Fungsi lain (Asesmen Diagnostik, CP&TP, Kelompok Belajar, dst.)
// akan ditambahkan bertahap di modul lib/ terpisah lalu didaftarkan di sini
// — perilaku & bentuk balasannya tetap { success, data, message } seperti
// GAS lama, sehingga frontend tidak perlu diubah logikanya.
// ============================================================

const sheets = require('../lib/sheets');
const auth = require('../lib/auth');
const asesmen = require('../lib/asesmen');
const kelompok = require('../lib/kelompok');
const modulajar = require('../lib/modulajar');
const importLib = require('../lib/import');
const dashboard = require('../lib/dashboard');
const { randomUUID } = require('crypto');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }

// ── Akun (Superadmin/Admin mendaftarkan Guru/Kepsek dgn email Google mereka) ──
async function daftarkanAkun(sessionToken, [email, nama, peran, sekolah, sapaan]) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  if (peran === auth.ROLE.ADMIN && user.Peran !== auth.ROLE.SUPERADMIN) {
    return fail('Hanya Superadmin yang dapat mendaftarkan Admin.');
  }
  const existing = await sheets.findOne('Users', 'Email', email);
  if (existing) return fail('Email sudah terdaftar.');
  if (peran === auth.ROLE.GURU) {
    const totalGuru = (await sheets.findMany('Users', 'Peran', auth.ROLE.GURU)).length;
    if (totalGuru >= 100) return fail('Batas maksimal 100 guru terdaftar sudah tercapai.');
  }
  const rec = await sheets.addRecord('Users', {
    ID: randomUUID(), Email: email, Nama: nama, Peran: peran, Sekolah: sekolah,
    Status: 'Aktif', Sapaan: sapaan || 'Bapak/Ibu', PeranPreview: ''
  });
  return ok(rec);
}

async function getDaftarAkun(sessionToken) {
  await auth.requireRole(sessionToken, [auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  const data = await sheets.getAllData('Users');
  return ok(data);
}

// Dipakai guru (siapa saja yang login) untuk mengisi dropdown pilih
// Kepala Sekolah/Pengawas saat mengajukan validasi Modul Ajar — beda dari
// getDaftarAkun yang khusus Admin/Superadmin dan mengembalikan semua akun
// (termasuk PasswordHash).
async function getDaftarValidator(sessionToken) {
  await auth.requireRole(sessionToken, null);
  const data = await sheets.getAllData('Users');
  const kepsekList = data
    .filter(u => u.Peran === 'KepalaSekolah' && u.Status === 'Aktif')
    .map(u => ({ Email: u.Email, Nama: u.Nama, Sekolah: u.Sekolah }));
  return ok(kepsekList);
}

async function ubahStatusAkun(sessionToken, [id, status]) {
  await auth.requireRole(sessionToken, [auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  const existing = await sheets.findOne('Users', 'ID', id);
  if (!existing) return fail('Akun tidak ditemukan.');
  const rec = await sheets.updateRecord('Users', Object.assign({}, existing, { Status: status }));
  return ok(rec);
}

// ── Master Data: Kelas & Siswa ──
async function getKelasSaya(sessionToken) {
  const user = await auth.requireRole(sessionToken, null);
  const semua = await sheets.getAllData('Kelas');
  const data = user.Peran === auth.ROLE.GURU ? semua.filter(k => k.GuruEmail === user.Email) : semua;
  return ok(data);
}

async function simpanKelas(sessionToken, [kelasObj]) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  if (kelasObj.ID) {
    const existing = await sheets.findOne('Kelas', 'ID', kelasObj.ID);
    if (!existing) return fail('Kelas tidak ditemukan.');
    const rec = await sheets.updateRecord('Kelas', Object.assign({}, existing, kelasObj));
    return ok(rec);
  }
  const rec = await sheets.addRecord('Kelas', Object.assign({ ID: randomUUID(), GuruEmail: user.Email }, kelasObj));
  return ok(rec);
}

async function hapusKelas(sessionToken, [id]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  await sheets.deleteRecord('Kelas', id);
  return ok(true);
}

async function getSiswaByKelas(sessionToken, [kelasId]) {
  await auth.requireRole(sessionToken, null);
  const data = await sheets.findMany('Siswa', 'KelasID', kelasId);
  return ok(data);
}

async function simpanSiswa(sessionToken, [siswaObj]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  if (siswaObj.ID) {
    const existing = await sheets.findOne('Siswa', 'ID', siswaObj.ID);
    if (!existing) return fail('Siswa tidak ditemukan.');
    const rec = await sheets.updateRecord('Siswa', Object.assign({}, existing, siswaObj));
    return ok(rec);
  }
  const rec = await sheets.addRecord('Siswa', Object.assign({ ID: randomUUID() }, siswaObj));
  return ok(rec);
}

async function hapusSiswa(sessionToken, [id]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  await sheets.deleteRecord('Siswa', id);
  return ok(true);
}

// ── Pendaftaran fungsi yang bisa dipanggil dari frontend lewat fnName ──
const FN_REGISTRY = {
  loginWithGoogle: async (token, [idToken]) => auth.loginWithGoogle(idToken),
  getCurrentUserProfile: async (token) => auth.getCurrentUserProfile(token),
  setPeranPreview: async (token, [roleBaru]) => ok(await auth.setPeranPreview(token, roleBaru)),
  daftarkanAkun, getDaftarAkun, ubahStatusAkun, getDaftarValidator,
  getKelasSaya, simpanKelas, hapusKelas,
  getSiswaByKelas, simpanSiswa, hapusSiswa,
  buatAsesmen: asesmen.buatAsesmen,
  tambahSoalAsesmen: asesmen.tambahSoalAsesmen,
  hapusSoalAsesmen: asesmen.hapusSoalAsesmen,
  hapusSemuaSoalAsesmen: asesmen.hapusSemuaSoalAsesmen,
  importSoalDariBank: asesmen.importSoalDariBank,
  getMateriBankKognitif: asesmen.getMateriBankKognitif,
  aktifkanAsesmen: asesmen.aktifkanAsesmen,
  getAsesmenByKelas: asesmen.getAsesmenByKelas,
  getSoalByAsesmen: asesmen.getSoalByAsesmen,
  getPublicFormLink: asesmen.getPublicFormLink,
  getPublicAssessment: asesmen.getPublicAssessment,
  submitPublicResponse: asesmen.submitPublicResponse,
  recomputeSemuaProfilSiswa: asesmen.recomputeSemuaProfilSiswa,
  getHasilAsesmen: asesmen.getHasilAsesmen,
  getAllProfilSiswa: asesmen.getAllProfilSiswa,
  generateKelompokBelajar: kelompok.generateKelompokBelajar,
  getKelompokBelajar: kelompok.getKelompokBelajar,
  pindahkanSiswaKelompok: kelompok.pindahkanSiswaKelompok,
  getBankCPTP: kelompok.getBankCPTP,
  kelolaBankCPTP: kelompok.kelolaBankCPTP,
  simpanCPTP: kelompok.simpanCPTP,
  getCPTPByKelas: kelompok.getCPTPByKelas,
  hapusCPTP: kelompok.hapusCPTP,
  getRekomendasiDiferensiasi: kelompok.getRekomendasiDiferensiasi,
  simpanDiferensiasi: kelompok.simpanDiferensiasi,
  getDiferensiasiByKelas: kelompok.getDiferensiasiByKelas,
  simpanScaffolding: kelompok.simpanScaffolding,
  getScaffoldingByKelas: kelompok.getScaffoldingByKelas,
  generateModulAjar: modulajar.generateModulAjar,
  simpanEditModulAjar: modulajar.simpanEditModulAjar,
  getModulAjarSaya: modulajar.getModulAjarSaya,
  getModulAjarDetail: modulajar.getModulAjarDetail,
  ajukanValidasi: modulajar.ajukanValidasi,
  getModulUntukValidasi: modulajar.getModulUntukValidasi,
  prosesValidasi: modulajar.prosesValidasi,
  kelolaBankStrategi: modulajar.kelolaBankStrategi,
  hapusBankStrategi: modulajar.hapusBankStrategi,
  getBankStrategi: modulajar.getBankStrategi,
  importSiswaExcel: importLib.importSiswaExcel,
  importSiswaWord: importLib.importSiswaWord,
  importAsesmenExcel: importLib.importAsesmenExcel,
  getDashboardData: dashboard.getDashboardData,
  getLaporanData: dashboard.getLaporanData
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  sheets.clearCache(); // cache hanya berlaku per-request, bukan antar-request

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    if (!body) body = {};
    const fnName = body.fnName || body.fn || '';
    const argsArray = body.argsArray || body.args || [];
    const sessionToken = body.sessionToken || body.token || '';

    if (!fnName) { res.status(200).json(fail('fnName wajib diisi.')); return; }
    const fn = FN_REGISTRY[fnName];
    if (!fn) { res.status(200).json(fail('Fungsi "' + fnName + '" belum tersedia di backend Vercel (masih proses migrasi bertahap).')); return; }

    const result = await fn(sessionToken, argsArray);
    res.status(200).json(result);
  } catch (err) {
    res.status(200).json(fail(err.message || String(err)));
  }
};
