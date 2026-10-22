// ============================================================
// lib/asesmen.js — Modul Asesmen Diagnostik: dibuat guru, diisi siswa lewat
// form publik (tanpa login), lalu profil siswa (kesiapan/minat/gaya belajar)
// dihitung otomatis. Logika port 1:1 dari buatAsesmen..recomputeProfilSiswa
// di Kode.gs lama — hasil angkanya harus identik.
// ============================================================

const { randomUUID } = require('crypto');
const sheets = require('./sheets');
const auth = require('./auth');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }
function nowStr() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace('T', ' ');
}
function safeParseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
}

async function buatAsesmen(sessionToken, [kelasId, judul]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const rec = await sheets.addRecord('AsesmenDiagnostik', {
    ID: randomUUID(), KelasID: kelasId, Judul: judul, StatusAktif: 'Draft', Tanggal: nowStr(), Token: randomUUID()
  });
  return ok(rec);
}

async function tambahSoalAsesmen(sessionToken, [asesmenId, butirSoal, jenisInstrumen, opsi, bagian, dimensi, kunciJawaban]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const rec = await sheets.addRecord('SoalAsesmen', {
    ID: randomUUID(), AsesmenID: asesmenId, JenisInstrumen: jenisInstrumen,
    Bagian: bagian || '', Dimensi: dimensi || '', ButirSoal: butirSoal,
    OpsiJSON: JSON.stringify(opsi || []), KunciJawaban: kunciJawaban || ''
  });
  return ok(rec);
}

async function hapusSoalAsesmen(sessionToken, [soalId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  await sheets.deleteRecord('SoalAsesmen', soalId);
  return ok(true);
}

async function hapusSemuaSoalAsesmen(sessionToken, [asesmenId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  if (!asesmenId) return fail('ID Asesmen wajib diisi.');
  const jumlah = await sheets.deleteManyByField('SoalAsesmen', 'AsesmenID', asesmenId);
  if (jumlah === 0) return ok(null, 'Tidak ada soal untuk dihapus.');
  return ok(null, jumlah + ' soal berhasil dihapus.');
}

// Hapus satu Asesmen Diagnostik beserta data turunannya (soal, respon siswa,
// kelompok belajar yang sudah dibuat dari asesmen itu) — supaya guru bisa
// bersih-bersih kalau ada asesmen duplikat/salah buat, tanpa data sisa yang
// nyangkut dan bikin bingung (mis. dropdown pemilihan asesmen).
async function hapusAsesmen(sessionToken, [asesmenId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  if (!asesmenId) return fail('ID Asesmen wajib diisi.');
  await sheets.deleteManyByField('SoalAsesmen', 'AsesmenID', asesmenId);
  await sheets.deleteManyByField('ResponAsesmen', 'AsesmenID', asesmenId);
  await sheets.deleteManyByField('KelompokBelajar', 'AsesmenID', asesmenId);
  await sheets.deleteRecord('AsesmenDiagnostik', asesmenId);
  return ok(true, 'Asesmen beserta data terkaitnya berhasil dihapus.');
}

async function importSoalDariBank(sessionToken, [asesmenId, jenisList, materi]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const asesmen = await sheets.findOne('AsesmenDiagnostik', 'ID', asesmenId);
  if (!asesmen) return fail('Asesmen tidak ditemukan.');
  const bankAll = await sheets.getAllData('BankSoalAsesmen');
  const bank = bankAll.filter(b => {
    if (jenisList.indexOf(b.JenisInstrumen) === -1) return false;
    if (b.JenisInstrumen === 'kognitif' && materi) return b.Materi === materi;
    return true;
  });
  const rows = bank.map(b => ({
    ID: randomUUID(), AsesmenID: asesmenId, JenisInstrumen: b.JenisInstrumen,
    Bagian: b.Bagian || '', Dimensi: b.Dimensi || '', ButirSoal: b.ButirSoal,
    OpsiJSON: b.OpsiJSON, KunciJawaban: b.KunciJawaban || ''
  }));
  await sheets.addRecords('SoalAsesmen', rows);
  return ok({ imported: bank.length }, bank.length + ' soal berhasil dimuat dari Bank Soal.');
}

async function getMateriBankKognitif(sessionToken) {
  await auth.requireRole(sessionToken, null);
  const bank = await sheets.getAllData('BankSoalAsesmen');
  const materiSet = {};
  bank.forEach(b => { if (b.JenisInstrumen === 'kognitif' && b.Materi) materiSet[b.Materi] = true; });
  return ok(Object.keys(materiSet));
}

async function aktifkanAsesmen(sessionToken, [asesmenId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const existing = await sheets.findOne('AsesmenDiagnostik', 'ID', asesmenId);
  if (!existing) return fail('Asesmen tidak ditemukan.');
  const rec = await sheets.updateRecord('AsesmenDiagnostik', Object.assign({}, existing, { StatusAktif: 'Aktif' }));
  return ok(rec);
}

async function getAsesmenByKelas(sessionToken, [kelasId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU, auth.ROLE.ADMIN, auth.ROLE.KEPSEK, auth.ROLE.SUPERADMIN]);
  return ok(await sheets.findMany('AsesmenDiagnostik', 'KelasID', kelasId));
}

async function getSoalByAsesmen(sessionToken, [asesmenId]) {
  const soal = (await sheets.findMany('SoalAsesmen', 'AsesmenID', asesmenId)).map(s => {
    s.OpsiJSON = safeParseJSON(s.OpsiJSON, []);
    return s;
  });
  return ok(soal);
}

async function getPublicFormLink(sessionToken, [asesmenId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const asesmen = await sheets.findOne('AsesmenDiagnostik', 'ID', asesmenId);
  if (!asesmen) return fail('Asesmen tidak ditemukan.');
  const base = process.env.FRONTEND_BASE_URL || '';
  return ok({ url: base + 'isi-asesmen.html?form=' + asesmen.Token });
}

// ── Akses PUBLIK (tanpa login) untuk siswa — tidak melalui requireRole ──
async function getPublicAssessment(sessionToken, [token]) {
  const asesmen = await sheets.findOne('AsesmenDiagnostik', 'Token', token);
  if (!asesmen) return fail('Tautan asesmen tidak valid.');
  if (asesmen.StatusAktif !== 'Aktif') return fail('Asesmen ini belum/tidak aktif.');
  const kelas = await sheets.findOne('Kelas', 'ID', asesmen.KelasID);
  const siswaList = await sheets.findMany('Siswa', 'KelasID', asesmen.KelasID);
  const soalList = (await sheets.findMany('SoalAsesmen', 'AsesmenID', asesmen.ID)).map(s => {
    s.OpsiJSON = safeParseJSON(s.OpsiJSON, []);
    return s;
  });
  return ok({ asesmen, kelas, siswaList, soalList });
}

async function submitPublicResponse(sessionToken, [token, siswaId, jawaban]) {
  const asesmen = await sheets.findOne('AsesmenDiagnostik', 'Token', token);
  if (!asesmen) return fail('Tautan asesmen tidak valid.');
  await sheets.addRecord('ResponAsesmen', {
    ID: randomUUID(), SiswaID: siswaId, AsesmenID: asesmen.ID,
    JawabanJSON: JSON.stringify(jawaban), Waktu: nowStr()
  });
  await recomputeProfilSiswa(siswaId, asesmen.ID);
  return ok(null, 'Terima kasih! Jawabanmu sudah tersimpan.');
}

// Logika skor IDENTIK dengan recomputeProfilSiswa() versi GAS lama — jangan
// diubah tanpa menyamakan juga ambang batas kategori (8/5 untuk readiness,
// 33/21 untuk minat) supaya hasil Kelompok Belajar tidak berubah.
// Menghitung profil siswa (tanpa menulis ke sheet) — dipakai oleh
// recomputeProfilSiswa (tulis langsung, untuk 1 siswa) dan oleh
// recomputeSemuaProfilSiswa (kumpulkan dulu, tulis sekaligus di akhir).
async function hitungProfilSiswa(siswaId, asesmenId) {
  const responAll = await sheets.findMany('ResponAsesmen', 'SiswaID', siswaId);
  const responList = responAll.filter(r => r.AsesmenID === asesmenId);
  const soalList = await sheets.findMany('SoalAsesmen', 'AsesmenID', asesmenId);

  let totalBenar = 0, totalSoalKognitif = 0;
  const benarPerBagian = { A: 0, B: 0, C: 0 };
  const soalPerBagian = { A: 0, B: 0, C: 0 };
  let minatTotal = 0;
  const minatSub = { Interest_Material: 0, Curiosity: 0, Engagement: 0 };
  const gayaSub = { Visual: 0, Auditory: 0, Kinesthetic: 0 };

  responList.forEach(r => {
    const jawaban = safeParseJSON(r.JawabanJSON, {});
    soalList.forEach(soal => {
      const jawabText = jawaban[soal.ButirSoal];
      if (jawabText === undefined) return;
      const opsi = safeParseJSON(soal.OpsiJSON, []);
      const matched = opsi.find(o => o.label === jawabText || o.value === jawabText);
      if (!matched) return;

      if (soal.JenisInstrumen === 'kognitif') {
        const bagian = soal.Bagian || 'C';
        soalPerBagian[bagian] = (soalPerBagian[bagian] || 0) + 1;
        totalSoalKognitif++;
        if (matched.value && soal.KunciJawaban && matched.value === soal.KunciJawaban) {
          totalBenar++; benarPerBagian[bagian] = (benarPerBagian[bagian] || 0) + 1;
        }
      } else if (soal.JenisInstrumen === 'minat' && matched.skor !== undefined) {
        minatTotal += Number(matched.skor);
        if (soal.Dimensi && minatSub[soal.Dimensi] !== undefined) minatSub[soal.Dimensi] += Number(matched.skor);
      } else if (soal.JenisInstrumen === 'gaya_belajar' && matched.skor !== undefined) {
        if (soal.Dimensi && gayaSub[soal.Dimensi] !== undefined) gayaSub[soal.Dimensi] += Number(matched.skor);
      }
    });
  });

  const skorKesiapan = totalSoalKognitif > 0 ? Math.round((totalBenar / totalSoalKognitif) * 10 * 10) / 10 : 0;
  let kategoriKesiapan = '-';
  if (totalSoalKognitif > 0) kategoriKesiapan = skorKesiapan >= 8 ? 'Paham Utuh' : (skorKesiapan >= 5 ? 'Paham Sebagian' : 'Belum Paham');
  let bagianGap = '';
  ['A', 'B', 'C'].some(b => {
    if (soalPerBagian[b] > 0 && benarPerBagian[b] < soalPerBagian[b]) { bagianGap = b; return true; }
    return false;
  });

  const adaSoalMinat = soalList.some(s => s.JenisInstrumen === 'minat');
  let kategoriMinat = '-';
  if (adaSoalMinat) kategoriMinat = minatTotal >= 33 ? 'Tinggi' : (minatTotal >= 21 ? 'Sedang' : 'Rendah');

  const gayaSorted = Object.entries(gayaSub).sort((a, b) => b[1] - a[1]);
  const gayaDominan = gayaSorted[0] && gayaSorted[0][1] > 0 ? gayaSorted[0][0] : '-';
  const gayaPendukung = gayaSorted[1] && gayaSorted[1][1] > 0 ? gayaSorted[1][0] : '-';

  const payload = {
    SiswaID: siswaId, SkorKesiapan: skorKesiapan, KategoriKesiapan: kategoriKesiapan, BagianGap: bagianGap,
    SkorMinatTotal: minatTotal, KategoriMinat: kategoriMinat, SubdimensiMinatJSON: JSON.stringify(minatSub),
    GayaDominan: gayaDominan, GayaPendukung: gayaPendukung, SubdimensiGayaJSON: JSON.stringify(gayaSub),
    Diperbarui: nowStr()
  };
  return payload;
}

async function recomputeProfilSiswa(siswaId, asesmenId) {
  const payload = await hitungProfilSiswa(siswaId, asesmenId);
  await sheets.upsertByField('ProfilSiswa', 'SiswaID', payload);
  return payload;
}

async function recomputeSemuaProfilSiswa(sessionToken) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU, auth.ROLE.KEPSEK, auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  const responList = await sheets.getAllData('ResponAsesmen');
  const pasangan = {};
  responList.forEach(r => { pasangan[r.SiswaID + '||' + r.AsesmenID] = { siswaId: r.SiswaID, asesmenId: r.AsesmenID }; });
  const payloads = [];
  for (const p of Object.values(pasangan)) { payloads.push(await hitungProfilSiswa(p.siswaId, p.asesmenId)); }
  if (payloads.length) await sheets.upsertManyByField('ProfilSiswa', 'SiswaID', payloads);
  return ok({ total: payloads.length }, 'Selesai. ' + payloads.length + ' profil siswa berhasil dihitung ulang.');
}

// Dipakai halaman "Profil Siswa" (Langkah 2) untuk mengambil semua baris
// ProfilSiswa sekaligus, lalu dicocokkan per siswa di sisi frontend.
async function getAllProfilSiswa(sessionToken) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU, auth.ROLE.KEPSEK, auth.ROLE.SUPERADMIN, auth.ROLE.ADMIN]);
  return ok(await sheets.getAllData('ProfilSiswa'));
}

async function getHasilAsesmen(sessionToken, [asesmenId]) {
  const respon = await sheets.findMany('ResponAsesmen', 'AsesmenID', asesmenId);
  const asesmen = await sheets.findOne('AsesmenDiagnostik', 'ID', asesmenId);
  const siswaList = asesmen ? await sheets.findMany('Siswa', 'KelasID', asesmen.KelasID) : [];
  const profilAll = await sheets.getAllData('ProfilSiswa');
  const profil = siswaList.map(s => {
    const p = profilAll.find(pr => pr.SiswaID === s.ID);
    return Object.assign({}, s, p || {});
  });
  return ok({ totalRespon: respon.length, totalSiswa: siswaList.length, profil });
}

module.exports = {
  buatAsesmen, tambahSoalAsesmen, hapusSoalAsesmen, hapusSemuaSoalAsesmen,
  importSoalDariBank, getMateriBankKognitif, aktifkanAsesmen, getAsesmenByKelas,
  getSoalByAsesmen, getPublicFormLink, getPublicAssessment, submitPublicResponse,
  recomputeProfilSiswa, recomputeSemuaProfilSiswa, getHasilAsesmen, getAllProfilSiswa, hapusAsesmen
};
