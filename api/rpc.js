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
const observasi = require('../lib/observasi');
const { randomUUID } = require('crypto');

// Batas jumlah guru terdaftar. Naikkan hanya setelah memastikan performa Google Sheets masih memadai.
const MAKS_GURU = 300;

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
    if (totalGuru >= MAKS_GURU) return fail('Batas maksimal ' + MAKS_GURU + ' guru terdaftar sudah tercapai.');
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

// Hapus permanen sebuah akun dari daftar pengguna. Pengaman:
// - tidak bisa menghapus akun sendiri,
// - akun Superadmin tidak bisa dihapus lewat aplikasi,
// - akun Admin hanya bisa dihapus oleh Superadmin.
// Data kerja milik guru (kelas, asesmen, modul) tidak ikut terhapus.
async function hapusAkun(sessionToken, [id]) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  const existing = await sheets.findOne('Users', 'ID', id);
  if (!existing) return fail('Akun tidak ditemukan.');
  if (existing.ID === user.ID || String(existing.Email).toLowerCase() === String(user.Email).toLowerCase()) {
    return fail('Anda tidak dapat menghapus akun Anda sendiri.');
  }
  if (existing.Peran === auth.ROLE.SUPERADMIN) return fail('Akun Superadmin tidak dapat dihapus.');
  if (existing.Peran === auth.ROLE.ADMIN && user.Peran !== auth.ROLE.SUPERADMIN) {
    return fail('Hanya Superadmin yang dapat menghapus akun Admin.');
  }
  const berhasil = await sheets.deleteRecord('Users', id);
  if (!berhasil) return fail('Akun gagal dihapus.');
  return ok(true, 'Akun dihapus.');
}

// Ubah data akun (nama, sapaan, email, peran, sekolah). Pengaman:
// - akun Superadmin hanya dapat diubah Superadmin; akun Admin hanya oleh Superadmin,
// - akun sendiri: email dan peran tidak dapat diubah (agar tidak terkunci dari sistem),
// - peran Superadmin tidak dapat diberikan lewat aplikasi, peran Admin hanya oleh Superadmin,
// - email harus valid dan belum dipakai akun lain.
// Bila email berubah, kolom email pada data kerja (kelas, modul ajar, validasi, observasi, dst.)
// ikut dipindahkan ke email baru supaya data pengguna tidak yatim.
async function ubahAkun(sessionToken, [id, data]) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  data = data || {};
  const existing = await sheets.findOne('Users', 'ID', id);
  if (!existing) return fail('Akun tidak ditemukan.');
  const lc = v => String(v == null ? '' : v).trim().toLowerCase();
  const diriSendiri = existing.ID === user.ID || lc(existing.Email) === lc(user.Email);
  if ((existing.Peran === auth.ROLE.SUPERADMIN || existing.Peran === auth.ROLE.ADMIN) && user.Peran !== auth.ROLE.SUPERADMIN) {
    return fail('Hanya Superadmin yang dapat mengubah akun Admin atau Superadmin.');
  }
  const nama = String(data.Nama == null ? existing.Nama : data.Nama).trim();
  const sekolah = String(data.Sekolah == null ? existing.Sekolah : data.Sekolah).trim();
  const sapaan = String(data.Sapaan == null ? existing.Sapaan : data.Sapaan).trim();
  const email = data.Email == null ? lc(existing.Email) : lc(data.Email);
  const peran = data.Peran == null ? existing.Peran : data.Peran;
  if (!nama) return fail('Nama wajib diisi.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Format email tidak valid.');
  const emailBerubah = email !== lc(existing.Email);
  const peranBerubah = peran !== existing.Peran;
  if (diriSendiri && (emailBerubah || peranBerubah)) return fail('Email dan peran akun Anda sendiri tidak dapat diubah dari sini.');
  if (peranBerubah) {
    if (existing.Peran === auth.ROLE.SUPERADMIN || peran === auth.ROLE.SUPERADMIN) return fail('Peran Superadmin tidak dapat diubah lewat aplikasi.');
    if (peran === auth.ROLE.ADMIN && user.Peran !== auth.ROLE.SUPERADMIN) return fail('Hanya Superadmin yang dapat menjadikan akun sebagai Admin.');
    if ([auth.ROLE.GURU, auth.ROLE.KEPSEK, auth.ROLE.ADMIN].indexOf(peran) === -1) return fail('Peran tidak dikenal.');
    if (peran === auth.ROLE.GURU) {
      const totalGuru = (await sheets.findMany('Users', 'Peran', auth.ROLE.GURU)).length;
      if (totalGuru >= MAKS_GURU) return fail('Batas maksimal ' + MAKS_GURU + ' guru terdaftar sudah tercapai.');
    }
  }
  if (emailBerubah) {
    const semua = await sheets.getAllData('Users');
    if (semua.some(u => u.ID !== existing.ID && lc(u.Email) === email)) return fail('Email sudah dipakai akun lain.');
  }
  const emailLama = lc(existing.Email);
  const rec = await sheets.updateRecord('Users', Object.assign({}, existing, { Nama: nama, Sekolah: sekolah, Sapaan: sapaan, Email: emailBerubah ? email : existing.Email, Peran: peran }));
  let dipindah = 0;
  if (emailBerubah || nama !== existing.Nama) {
    for (const nm of Object.keys(sheets.SHEET_DEFS)) {
      if (nm === 'Users') continue;
      const headers = sheets.SHEET_DEFS[nm];
      const kolomEmail = headers.filter(h => /Email$/.test(h));
      if (!kolomEmail.length || headers.indexOf('ID') === -1) continue;
      let rows = [];
      try { rows = await sheets.getAllData(nm); } catch (e) { continue; }
      for (const r of rows) {
        let ubah = false;
        kolomEmail.forEach(h => {
          if (lc(r[h]) !== emailLama) return;
          if (emailBerubah) { r[h] = email; ubah = true; }
          const kolomNama = h === 'GuruEmail' ? 'GuruNama' : (h === 'ObserverEmail' ? 'ObserverNama' : '');
          if (kolomNama && headers.indexOf(kolomNama) !== -1 && nama !== existing.Nama) { r[kolomNama] = nama; ubah = true; }
        });
        if (ubah) { await sheets.updateRecord(nm, r); dipindah++; }
      }
    }
  }
  return ok(rec, dipindah ? 'Akun diperbarui; ' + dipindah + ' data terkait ikut disesuaikan.' : 'Akun diperbarui.');
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
  daftarkanAkun, getDaftarAkun, ubahStatusAkun, hapusAkun, ubahAkun, getDaftarValidator,
  getKelasSaya, simpanKelas, hapusKelas,
  getSiswaByKelas, simpanSiswa, hapusSiswa,
  buatAsesmen: asesmen.buatAsesmen,
  tambahSoalAsesmen: asesmen.tambahSoalAsesmen,
  hapusSoalAsesmen: asesmen.hapusSoalAsesmen,
  hapusSemuaSoalAsesmen: asesmen.hapusSemuaSoalAsesmen,
  hapusAsesmen: asesmen.hapusAsesmen,
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
  hapusModulAjar: modulajar.hapusModulAjar,
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
  getLaporanData: dashboard.getLaporanData,
  getInstrumenObservasi: observasi.getInstrumenObservasi,
  getGuruObservasi: observasi.getGuruObservasi,
  simpanTargetObservasi: observasi.simpanTargetObservasi,
  getJadwalObservasi: observasi.getJadwalObservasi,
  simpanJadwalObservasi: observasi.simpanJadwalObservasi,
  batalkanJadwalObservasi: observasi.batalkanJadwalObservasi,
  getObservasi: observasi.getObservasi,
  simpanObservasi: observasi.simpanObservasi,
  getPenilaianDiri: observasi.getPenilaianDiri,
  simpanPenilaianDiri: observasi.simpanPenilaianDiri,
  getRekapObservasi: observasi.getRekapObservasi
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
