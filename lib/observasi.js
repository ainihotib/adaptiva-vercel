// ============================================================
// lib/observasi.js — Modul Observasi Kelas dan Jurnal Kelas.
//
// Alur (keputusan peneliti, 8 Nov 2026):
//  - Kepala Sekolah/Pengawas menjadwalkan pertemuan yang diamati untuk guru
//    di cakupannya, lalu mengisi Lembar Observasi + Jurnal A (catatan observer).
//  - Guru mengisi instrumen yang sama sebagai penilaian diri + Jurnal B,
//    HANYA untuk pertemuan yang dijadwalkan/diamati.
//  - Target pengamatan = 20% dari jumlah pertemuan IPAS per semester per guru
//    (dibulatkan ke atas), diisi Admin/Kepala Sekolah.
//  - Skor dan perbandingan hanya tampil di dashboard Admin. Guru hanya boleh
//    membaca catatan kualitatif observer SETELAH penilaian dirinya selesai
//    (supaya penilaian diri tidak terpengaruh).
// Butir instrumen: lib/instrumenObservasi.js (disalin dari Lembar Observasi dan Jurnal Kelas).
// ============================================================

const sheets = require('./sheets');
const auth = require('./auth');
const INS = require('./instrumenObservasi');
const { randomUUID } = require('crypto');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }
function parse(str, fallback) { try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; } }
function nowStr() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }); }
function persenTarget(total) { const n = Number(total) || 0; return n > 0 ? Math.ceil(n * 0.2) : 0; }

const TABS = ['JadwalObservasi', 'Observasi', 'PenilaianDiriGuru', 'TargetObservasi'];
async function siap() { for (const t of TABS) await sheets.ensureSheet(t); }

const R = auth.ROLE;
const SEMUA_BUTIR = INS.checklist.map(c => c.id).concat(INS.kesesuaian.map(m => m.id));
const RUBRIK_ID = INS.rubrik.map(r => r.id);

// ── Cakupan guru milik Kepala Sekolah/Pengawas ──
function tokens(s) { return String(s || '').split(/[;,|\n]/).map(x => x.trim().toLowerCase()).filter(Boolean); }
async function guruDalamCakupan(user) {
  const semua = (await sheets.getAllData('Users')).filter(u => u.Peran === R.GURU && u.Status === 'Aktif');
  if (user.Peran === R.ADMIN || user.Peran === R.SUPERADMIN) return semua;
  const t = tokens(user.Sekolah);
  if (!t.length) return semua;
  return semua.filter(g => tokens(g.Sekolah).some(x => t.indexOf(x) !== -1));
}

// ── Ringkasan skor (sama dengan Bagian 5 lembar) ──
function ringkas(checklist, rubrik) {
  const dim = INS.dimensi.map(d => {
    const jawab = d.butir.map(id => (checklist && checklist[id] && checklist[id].v) || '');
    const ya = jawab.filter(v => v === 'Ya').length;
    const terisi = jawab.filter(v => v === 'Ya' || v === 'Tidak').length;
    return { kode: d.kode, nama: d.nama, butir: d.butir.length, terisi, ya, persen: d.butir.length ? Math.round(100 * ya / d.butir.length) : 0 };
  });
  const totalButir = dim.reduce((a, d) => a + d.butir, 0);
  const totalYa = dim.reduce((a, d) => a + d.ya, 0);
  const skor = RUBRIK_ID.map(id => Number(rubrik && rubrik[id] && rubrik[id].skor) || 0);
  const terisiR = skor.filter(x => x >= 1 && x <= 4);
  const jumlahR = terisiR.reduce((a, b) => a + b, 0);
  return {
    dimensi: dim, totalButir, totalYa, persenTotal: totalButir ? Math.round(100 * totalYa / totalButir) : 0,
    rubrik: { skor, jumlah: jumlahR, rata: terisiR.length ? Math.round(100 * jumlahR / terisiR.length) / 100 : 0, terisi: terisiR.length }
  };
}

// Pemeriksaan kelengkapan saat Selesai. perluBukti: observer wajib bukti pada jawaban Ya.
function periksaKelengkapan(checklist, rubrik, perluBukti) {
  const kurang = [];
  SEMUA_BUTIR.forEach(id => {
    const c = (checklist && checklist[id]) || {};
    if (c.v !== 'Ya' && c.v !== 'Tidak') kurang.push('Butir ' + id + ' belum dijawab Ya/Tidak');
    else if (perluBukti && c.v === 'Ya' && !String(c.bukti || '').trim()) kurang.push('Butir ' + id + ' dijawab Ya tetapi bukti belum diisi');
  });
  RUBRIK_ID.forEach(id => {
    const s = Number(rubrik && rubrik[id] && rubrik[id].skor);
    if (!(s >= 1 && s <= 4)) kurang.push('Rubrik ' + id + ' belum diberi skor 1–4');
  });
  return kurang;
}

// ── Data bantu per pertemuan: identitas, kelompok, perbandingan rencana ──
async function dataPertemuan(jadwal) {
  const guru = await sheets.findOne('Users', 'Email', jadwal.GuruEmail);
  const kelas = await sheets.findOne('Kelas', 'ID', jadwal.KelasID);
  const siswa = await sheets.findMany('Siswa', 'KelasID', jadwal.KelasID);
  const identitas = {
    sekolah: guru ? guru.Sekolah : '', guru: jadwal.GuruNama, kelasFase: kelas ? (kelas.NamaKelas + ' / ' + kelas.Fase) : jadwal.KelasNama,
    tanggal: jadwal.Tanggal, pertemuanKe: jadwal.PertemuanKe, materi: jadwal.Materi, observer: jadwal.ObserverNama,
    jumlahSiswaTerdaftar: siswa.length
  };
  // kelompok dari pengelompokan terbaru kelas ini
  const kelompokAll = await sheets.findMany('KelompokBelajar', 'KelasID', jadwal.KelasID);
  let kelompok = [];
  if (kelompokAll.length) {
    const asesmen = (await sheets.findMany('AsesmenDiagnostik', 'KelasID', jadwal.KelasID))
      .sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
    let pilihId = null;
    for (const a of asesmen) { if (kelompokAll.some(k => k.AsesmenID === a.ID)) { pilihId = a.ID; break; } }
    kelompok = kelompokAll.filter(k => !pilihId || k.AsesmenID === pilihId);
  }
  const jumlahKelompok = {};
  kelompok.forEach(k => { jumlahKelompok[k.NamaKelompok] = parse(k.AnggotaJSON, []).length; });
  // gaya belajar dominan dari ProfilSiswa
  const profil = await sheets.getAllData('ProfilSiswa');
  const idSet = {}; siswa.forEach(s => { idSet[s.ID] = true; });
  const gaya = {};
  profil.filter(p => idSet[p.SiswaID]).forEach(p => { const g = p.GayaDominan || 'Belum ada'; gaya[g] = (gaya[g] || 0) + 1; });
  // perbandingan rencana (diferensiasi + langkah Planner) per kelompok
  const dif = await sheets.getAllData('Diferensiasi');
  const scaf = await sheets.getAllData('ScaffoldingPlan');
  const potong = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const perbandingan = kelompok.map(k => {
    const d = dif.filter(x => x.KelompokID === k.ID);
    const rencana = d.length ? d.map(x => 'Konten: ' + potong(x.Konten, 110) + ' | Proses: ' + potong(x.Proses, 110) + ' | Produk: ' + potong(x.Produk, 110)).join(' || ') : '';
    const sc = scaf.filter(x => x.KelompokID === k.ID);
    const langkah = [];
    sc.forEach(x => [x.Level1, x.Level2, x.Level3, x.Level4].forEach((t, i) => { if (String(t || '').trim() && langkah.indexOf(i + 1) === -1) langkah.push(i + 1); }));
    langkah.sort();
    return { kelompok: k.NamaKelompok, rencana, langkah: langkah.length ? 'Langkah ' + langkah.join(', ') : '', terlaksana: '' };
  });
  return { identitas, jumlahKelompok, gaya, perbandingan };
}

// ── Instrumen ──
async function getInstrumenObservasi(sessionToken) {
  await auth.requireRole(sessionToken, null);
  return ok(INS);
}

// ── Target 20% dan daftar guru (Kepala Sekolah/Pengawas/Admin) ──
async function getGuruObservasi(sessionToken) {
  try {
    const user = await auth.requireRole(sessionToken, [R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    const guruList = await guruDalamCakupan(user);
    const target = await sheets.getAllData('TargetObservasi');
    const jadwal = await sheets.getAllData('JadwalObservasi');
    const kelas = await sheets.getAllData('Kelas');
    const hasil = guruList.map(g => {
      const t = target.find(x => x.GuruEmail === g.Email);
      const total = t ? Number(t.TotalPertemuan) || 0 : 0;
      const jg = jadwal.filter(j => j.GuruEmail === g.Email && j.Status !== 'Dibatalkan');
      return {
        Email: g.Email, Nama: g.Nama, Sekolah: g.Sekolah, TotalPertemuan: total, Target: persenTarget(total),
        Terjadwal: jg.length, Selesai: jg.filter(j => j.Status === 'Selesai').length,
        Kelas: kelas.filter(k => k.GuruEmail === g.Email).map(k => ({ ID: k.ID, NamaKelas: k.NamaKelas, Fase: k.Fase }))
      };
    });
    return ok(hasil);
  } catch (err) { return fail(err.message); }
}

async function simpanTargetObservasi(sessionToken, [guruEmail, total]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    const guruList = await guruDalamCakupan(user);
    if (!guruList.some(g => g.Email === guruEmail)) return fail('Guru tersebut tidak berada dalam cakupan Anda.');
    const n = Math.floor(Number(total));
    if (!(n >= 0 && n <= 400)) return fail('Jumlah pertemuan tidak valid.');
    const ada = await sheets.findOne('TargetObservasi', 'GuruEmail', guruEmail);
    const rec = { ID: ada ? ada.ID : randomUUID(), GuruEmail: guruEmail, TotalPertemuan: n, Semester: '', Diperbarui: nowStr() };
    if (ada) await sheets.updateRecord('TargetObservasi', rec); else await sheets.addRecord('TargetObservasi', rec);
    return ok({ TotalPertemuan: n, Target: persenTarget(n) }, 'Target pengamatan: ' + persenTarget(n) + ' pertemuan (20% dari ' + n + ').');
  } catch (err) { return fail(err.message); }
}

// ── Jadwal ──
async function getJadwalObservasi(sessionToken) {
  try {
    const user = await auth.requireRole(sessionToken, [R.GURU, R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    let jadwal = await sheets.getAllData('JadwalObservasi');
    if (user.Peran === R.GURU) jadwal = jadwal.filter(j => j.GuruEmail === user.Email);
    else if (user.Peran === R.KEPSEK) {
      const emails = (await guruDalamCakupan(user)).map(g => g.Email);
      jadwal = jadwal.filter(j => j.ObserverEmail === user.Email || emails.indexOf(j.GuruEmail) !== -1);
    }
    const obs = await sheets.getAllData('Observasi');
    const diri = await sheets.getAllData('PenilaianDiriGuru');
    const data = jadwal.map(j => {
      const o = obs.find(x => x.JadwalID === j.ID);
      const d = diri.find(x => x.JadwalID === j.ID);
      return Object.assign({}, j, { ObservasiStatus: o ? o.Status : 'Belum', DiriStatus: d ? d.Status : 'Belum' });
    }).sort((a, b) => String(b.Tanggal).localeCompare(String(a.Tanggal)));
    return ok(data);
  } catch (err) { return fail(err.message); }
}

async function simpanJadwalObservasi(sessionToken, [obj]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    obj = obj || {};
    if (!obj.GuruEmail || !obj.KelasID || !obj.Tanggal) return fail('Guru, kelas, dan tanggal wajib diisi.');
    const guruList = await guruDalamCakupan(user);
    const guru = guruList.find(g => g.Email === obj.GuruEmail);
    if (!guru) return fail('Guru tersebut tidak berada dalam cakupan Anda.');
    const kelas = await sheets.findOne('Kelas', 'ID', obj.KelasID);
    if (!kelas || kelas.GuruEmail !== guru.Email) return fail('Kelas tidak sesuai dengan guru yang dipilih.');
    let observer = user;
    if (user.Peran !== R.KEPSEK) {
      if (!obj.ObserverEmail) return fail('Pilih Kepala Sekolah/Pengawas yang mengamati.');
      observer = await sheets.findOne('Users', 'Email', obj.ObserverEmail);
      if (!observer || observer.Peran !== R.KEPSEK) return fail('Pengamat harus berperan Kepala Sekolah/Pengawas.');
    }
    const semua = await sheets.getAllData('JadwalObservasi');
    const kembar = semua.find(j => j.ID !== obj.ID && j.Status !== 'Dibatalkan' && j.GuruEmail === guru.Email
      && j.KelasID === obj.KelasID && j.Tanggal === obj.Tanggal && String(j.PertemuanKe) === String(obj.PertemuanKe || ''));
    if (kembar) return fail('Pertemuan yang sama untuk guru, kelas, dan tanggal ini sudah dijadwalkan.');
    const rec = {
      ID: obj.ID || randomUUID(), GuruEmail: guru.Email, GuruNama: guru.Nama, KelasID: kelas.ID, KelasNama: kelas.NamaKelas,
      Tanggal: obj.Tanggal, PertemuanKe: obj.PertemuanKe || '', Materi: obj.Materi || '',
      ObserverEmail: observer.Email, ObserverNama: observer.Nama, Status: 'Terjadwal', Dibuat: nowStr()
    };
    if (obj.ID) {
      const lama = semua.find(j => j.ID === obj.ID);
      if (!lama) return fail('Jadwal tidak ditemukan.');
      if (lama.Status === 'Selesai') return fail('Jadwal yang sudah selesai diamati tidak dapat diubah.');
      rec.Dibuat = lama.Dibuat; rec.Status = lama.Status;
      await sheets.updateRecord('JadwalObservasi', rec);
    } else await sheets.addRecord('JadwalObservasi', rec);
    const t = await sheets.findOne('TargetObservasi', 'GuruEmail', guru.Email);
    const target = t ? persenTarget(t.TotalPertemuan) : 0;
    const jumlah = (await sheets.findMany('JadwalObservasi', 'GuruEmail', guru.Email)).filter(j => j.Status !== 'Dibatalkan').length;
    let msg = 'Jadwal tersimpan.';
    if (target) msg += ' Terjadwal ' + jumlah + ' dari target ' + target + ' pertemuan.';
    else msg += ' Target pengamatan guru ini belum diisi.';
    return ok(rec, msg);
  } catch (err) { return fail(err.message); }
}

async function batalkanJadwalObservasi(sessionToken, [id]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    const j = await sheets.findOne('JadwalObservasi', 'ID', id);
    if (!j) return fail('Jadwal tidak ditemukan.');
    if (user.Peran === R.KEPSEK) {
      const emails = (await guruDalamCakupan(user)).map(g => g.Email);
      if (j.ObserverEmail !== user.Email && emails.indexOf(j.GuruEmail) === -1) return fail('Jadwal ini di luar cakupan Anda.');
    }
    if (j.Status === 'Selesai') return fail('Jadwal yang sudah selesai diamati tidak dapat dibatalkan.');
    await sheets.updateRecord('JadwalObservasi', Object.assign({}, j, { Status: 'Dibatalkan' }));
    return ok(true, 'Jadwal dibatalkan.');
  } catch (err) { return fail(err.message); }
}

// ── Lembar Observasi + Jurnal A (pengamat) ──
async function jadwalUntukPengamat(user, jadwalId) {
  const j = await sheets.findOne('JadwalObservasi', 'ID', jadwalId);
  if (!j) throw new Error('Jadwal tidak ditemukan.');
  if (user.Peran === R.KEPSEK && j.ObserverEmail !== user.Email) throw new Error('Lembar ini milik pengamat lain.');
  if (user.Peran === R.GURU) throw new Error('Guru tidak dapat membuka Lembar Observasi.');
  return j;
}

async function getObservasi(sessionToken, [jadwalId]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    const j = await jadwalUntukPengamat(user, jadwalId);
    const bantu = await dataPertemuan(j);
    const o = await sheets.findOne('Observasi', 'JadwalID', jadwalId);
    const rec = o ? {
      Status: o.Status, Checklist: parse(o.ChecklistJson, {}), Rubrik: parse(o.RubrikJson, {}), Perbandingan: parse(o.PerbandinganJson, null),
      CatatanUmum: o.CatatanUmum, JurnalA: parse(o.JurnalAJson, {}), IdentitasTambahan: parse(o.IdentitasJson, {})
    } : null;
    return ok({ jadwal: j, bantu, observasi: rec });
  } catch (err) { return fail(err.message); }
}

async function simpanObservasi(sessionToken, [obj]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.KEPSEK, R.ADMIN, R.SUPERADMIN]);
    await siap();
    obj = obj || {};
    const j = await jadwalUntukPengamat(user, obj.JadwalID);
    const selesai = obj.Status === 'Selesai';
    if (selesai) {
      const kurang = periksaKelengkapan(obj.Checklist, obj.Rubrik, true);
      if (kurang.length) return fail('Belum dapat diselesaikan (' + kurang.length + ' hal): ' + kurang.slice(0, 4).join('; ') + (kurang.length > 4 ? '; dan lainnya.' : '.'));
    }
    const lama = await sheets.findOne('Observasi', 'JadwalID', j.ID);
    const rec = {
      ID: lama ? lama.ID : randomUUID(), JadwalID: j.ID, ObserverEmail: j.ObserverEmail,
      IdentitasJson: JSON.stringify(obj.IdentitasTambahan || {}), ChecklistJson: JSON.stringify(obj.Checklist || {}),
      RubrikJson: JSON.stringify(obj.Rubrik || {}), PerbandinganJson: JSON.stringify(obj.Perbandingan || []),
      CatatanUmum: obj.CatatanUmum || '', JurnalAJson: JSON.stringify(obj.JurnalA || {}),
      Status: selesai ? 'Selesai' : 'Draft', Diperbarui: nowStr()
    };
    if (lama) await sheets.updateRecord('Observasi', rec); else await sheets.addRecord('Observasi', rec);
    if (selesai && j.Status !== 'Selesai') await sheets.updateRecord('JadwalObservasi', Object.assign({}, j, { Status: 'Selesai' }));
    if (!selesai && j.Status === 'Selesai') await sheets.updateRecord('JadwalObservasi', Object.assign({}, j, { Status: 'Terjadwal' }));
    return ok({ ringkasan: ringkas(obj.Checklist, obj.Rubrik) }, selesai ? 'Lembar observasi diselesaikan.' : 'Draf tersimpan.');
  } catch (err) { return fail(err.message); }
}

// ── Penilaian diri guru + Jurnal B ──
async function jadwalUntukGuru(user, jadwalId) {
  const j = await sheets.findOne('JadwalObservasi', 'ID', jadwalId);
  if (!j || j.GuruEmail !== user.Email) throw new Error('Jadwal tidak ditemukan.');
  if (j.Status === 'Dibatalkan') throw new Error('Jadwal ini sudah dibatalkan.');
  return j;
}

async function getPenilaianDiri(sessionToken, [jadwalId]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.GURU]);
    await siap();
    const j = await jadwalUntukGuru(user, jadwalId);
    const bantu = await dataPertemuan(j);
    const d = await sheets.findOne('PenilaianDiriGuru', 'JadwalID', jadwalId);
    const rec = d ? { Status: d.Status, Checklist: parse(d.ChecklistJson, {}), Rubrik: parse(d.RubrikJson, {}), JurnalB: parse(d.JurnalBJson, {}) } : null;
    // Catatan kualitatif observer baru terbuka setelah penilaian diri guru selesai
    let umpanBalik = null;
    if (d && d.Status === 'Selesai') {
      const o = await sheets.findOne('Observasi', 'JadwalID', jadwalId);
      if (o && o.Status === 'Selesai') {
        const ja = parse(o.JurnalAJson, {});
        umpanBalik = { observer: j.ObserverNama, catatanUmum: o.CatatanUmum || '', refleksi: (ja.c3 || '') };
      }
    }
    return ok({ jadwal: j, bantu, penilaianDiri: rec, umpanBalik });
  } catch (err) { return fail(err.message); }
}

async function simpanPenilaianDiri(sessionToken, [obj]) {
  try {
    const user = await auth.requireRole(sessionToken, [R.GURU]);
    await siap();
    obj = obj || {};
    const j = await jadwalUntukGuru(user, obj.JadwalID);
    const selesai = obj.Status === 'Selesai';
    if (selesai) {
      const kurang = periksaKelengkapan(obj.Checklist, obj.Rubrik, false);
      if (kurang.length) return fail('Belum dapat diselesaikan (' + kurang.length + ' hal): ' + kurang.slice(0, 4).join('; ') + (kurang.length > 4 ? '; dan lainnya.' : '.'));
    }
    const lama = await sheets.findOne('PenilaianDiriGuru', 'JadwalID', j.ID);
    const rec = {
      ID: lama ? lama.ID : randomUUID(), JadwalID: j.ID, GuruEmail: user.Email,
      ChecklistJson: JSON.stringify(obj.Checklist || {}), RubrikJson: JSON.stringify(obj.Rubrik || {}),
      JurnalBJson: JSON.stringify(obj.JurnalB || {}), Status: selesai ? 'Selesai' : 'Draft', Diperbarui: nowStr()
    };
    if (lama) await sheets.updateRecord('PenilaianDiriGuru', rec); else await sheets.addRecord('PenilaianDiriGuru', rec);
    return ok(true, selesai ? 'Penilaian diri dan jurnal diselesaikan.' : 'Draf tersimpan.');
  } catch (err) { return fail(err.message); }
}

// ── Rekap khusus Admin: pengamat vs penilaian diri ──
async function getRekapObservasi(sessionToken) {
  try {
    await auth.requireRole(sessionToken, [R.ADMIN, R.SUPERADMIN]);
    await siap();
    const guruList = (await sheets.getAllData('Users')).filter(u => u.Peran === R.GURU && u.Status === 'Aktif');
    const target = await sheets.getAllData('TargetObservasi');
    const jadwal = (await sheets.getAllData('JadwalObservasi')).filter(j => j.Status !== 'Dibatalkan');
    const obs = (await sheets.getAllData('Observasi')).filter(o => o.Status === 'Selesai');
    const diri = (await sheets.getAllData('PenilaianDiriGuru')).filter(d => d.Status === 'Selesai');
    const rataDim = (daftar) => {
      // daftar: array hasil ringkas(); rata-rata persen per dimensi dan rubrik
      if (!daftar.length) return null;
      const dim = INS.dimensi.map((d, i) => ({ kode: d.kode, nama: d.nama, persen: Math.round(daftar.reduce((a, r) => a + r.dimensi[i].persen, 0) / daftar.length) }));
      const rub = RUBRIK_ID.map((id, i) => Math.round(100 * daftar.reduce((a, r) => a + (r.rubrik.skor[i] || 0), 0) / daftar.length) / 100);
      return { dimensi: dim, rubrik: rub, persenTotal: Math.round(daftar.reduce((a, r) => a + r.persenTotal, 0) / daftar.length) };
    };
    const perGuru = guruList.map(g => {
      const t = target.find(x => x.GuruEmail === g.Email);
      const total = t ? Number(t.TotalPertemuan) || 0 : 0;
      const jg = jadwal.filter(j => j.GuruEmail === g.Email);
      const ids = jg.map(j => j.ID);
      const rObs = obs.filter(o => ids.indexOf(o.JadwalID) !== -1).map(o => ringkas(parse(o.ChecklistJson, {}), parse(o.RubrikJson, {})));
      const rDiri = diri.filter(d => ids.indexOf(d.JadwalID) !== -1).map(d => ringkas(parse(d.ChecklistJson, {}), parse(d.RubrikJson, {})));
      return {
        Email: g.Email, Nama: g.Nama, Sekolah: g.Sekolah, TotalPertemuan: total, Target: persenTarget(total),
        Terjadwal: jg.length, ObservasiSelesai: rObs.length, DiriSelesai: rDiri.length,
        Pengamat: rataDim(rObs), Diri: rataDim(rDiri)
      };
    });
    const detail = jadwal.map(j => {
      const o = obs.find(x => x.JadwalID === j.ID); const d = diri.find(x => x.JadwalID === j.ID);
      const ro = o ? ringkas(parse(o.ChecklistJson, {}), parse(o.RubrikJson, {})) : null;
      const rd = d ? ringkas(parse(d.ChecklistJson, {}), parse(d.RubrikJson, {})) : null;
      return {
        JadwalID: j.ID, Guru: j.GuruNama, Sekolah: (guruList.find(g => g.Email === j.GuruEmail) || {}).Sekolah || '', Kelas: j.KelasNama, Tanggal: j.Tanggal, PertemuanKe: j.PertemuanKe,
        Pengamat: ro ? { persenTotal: ro.persenTotal, rubrik: ro.rubrik.rata } : null,
        Diri: rd ? { persenTotal: rd.persenTotal, rubrik: rd.rubrik.rata } : null
      };
    }).sort((a, b) => String(b.Tanggal).localeCompare(String(a.Tanggal)));
    return ok({ perGuru, detail, dimensi: INS.dimensi.map(d => ({ kode: d.kode, nama: d.nama })), rubrik: INS.rubrik.map(r => ({ id: r.id, judul: r.judul })) });
  } catch (err) { return fail(err.message); }
}

module.exports = {
  getInstrumenObservasi, getGuruObservasi, simpanTargetObservasi, getJadwalObservasi, simpanJadwalObservasi,
  batalkanJadwalObservasi, getObservasi, simpanObservasi, getPenilaianDiri, simpanPenilaianDiri, getRekapObservasi,
  _ringkas: ringkas, _periksa: periksaKelengkapan, _persenTarget: persenTarget
};
