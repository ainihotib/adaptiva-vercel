// ============================================================
// lib/dashboard.js — Dashboard & Laporan.
// Port langsung dari getDashboardData/buildDashboard*/getLaporanData/
// buildLaporan* di Kode.gs. Logika agregasi & field-field hasilnya dibuat
// SAMA PERSIS dengan versi GAS (hanya pemanggilan data sheet-nya jadi async
// lewat lib/sheets.js, dan findOne/findMany/getAllData di sini sudah
// mengembalikan array langsung, bukan {data:[...]} seperti createResponse
// di GAS — jadi tidak perlu `.data` lagi setelah getAllData()).
// ============================================================

const sheets = require('./sheets');
const auth = require('./auth');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }
function safeParseJSON(str, fallback) { try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; } }
function nowStrFromDate(d) {
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace('T', ' ');
  } catch (e) { return String(d); }
}

const MODUL_STATUS = { DRAFT: 'Draft', DIAJUKAN: 'Diajukan', TERVALIDASI: 'Tervalidasi', DIKEMBALIKAN: 'Dikembalikan' };

// ── Dashboard ──

async function getDashboardData(sessionToken) {
  try {
    const user = await auth.requireRole(sessionToken, [auth.ROLE.GURU, auth.ROLE.ADMIN, auth.ROLE.KEPSEK, auth.ROLE.SUPERADMIN]);
    if (user.Peran === auth.ROLE.GURU) return ok(await buildDashboardGuru(user));
    if (user.Peran === auth.ROLE.KEPSEK) return ok(await buildDashboardKepsek(user));
    return ok(await buildDashboardAdmin(user));
  } catch (err) { return fail(err.message); }
}

async function buildDashboardGuru(user) {
  const kelasList = await sheets.findMany('Kelas', 'GuruEmail', user.Email);
  const kelasIds = kelasList.map(k => k.ID);
  const allSiswaData = await sheets.getAllData('Siswa');
  const allSiswa = allSiswaData.filter(s => kelasIds.indexOf(s.KelasID) !== -1);
  const allAsesmenData = await sheets.getAllData('AsesmenDiagnostik');
  const allAsesmen = allAsesmenData.filter(a => kelasIds.indexOf(a.KelasID) !== -1);
  const allKelompokData = await sheets.getAllData('KelompokBelajar');
  const allKelompok = allKelompokData.filter(k => kelasIds.indexOf(k.KelasID) !== -1);
  const modulList = await sheets.findMany('ModulAjar', 'GuruEmail', user.Email);

  const profilCount = { Mahir: 0, Berkembang: 0, PerluPendampingan: 0 };
  allKelompok.forEach(k => { profilCount[k.NamaKelompok] = (profilCount[k.NamaKelompok] || 0) + safeParseJSON(k.AnggotaJSON, []).length; });

  const statusModul = {};
  modulList.forEach(m => { statusModul[m.Status] = (statusModul[m.Status] || 0) + 1; });

  const asesmenTerakhir = allAsesmen.slice().sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal))[0];

  const minatCount = {}, gayaCount = {};
  for (const s of allSiswa) {
    const p = await sheets.findOne('ProfilSiswa', 'SiswaID', s.ID);
    if (p && p.KategoriMinat) minatCount[p.KategoriMinat] = (minatCount[p.KategoriMinat] || 0) + 1;
    if (p && p.GayaDominan) gayaCount[p.GayaDominan] = (gayaCount[p.GayaDominan] || 0) + 1;
  }
  const topMinat = Object.keys(minatCount).sort((a, b) => minatCount[b] - minatCount[a])[0];
  const topGaya = Object.keys(gayaCount).sort((a, b) => gayaCount[b] - gayaCount[a])[0];

  return {
    jumlahSiswa: allSiswa.length,
    jumlahKelas: kelasList.length,
    asesmenTerakhir: asesmenTerakhir ? asesmenTerakhir.Tanggal : '-',
    jumlahKelompok: allKelompok.length,
    jumlahModul: modulList.length,
    profilKesiapan: profilCount,
    distribusiMinat: minatCount,
    distribusiGaya: gayaCount,
    statusModul,
    insights: [
      'Total ' + allSiswa.length + ' siswa terdaftar di ' + kelasList.length + ' kelas.',
      profilCount.PerluPendampingan > 0 ? profilCount.PerluPendampingan + ' siswa berada di kelompok Perlu Pendampingan — pertimbangkan scaffolding Level 1 (Environmental Provisions).' : 'Semua siswa berada di kelompok Berkembang/Mahir.',
      topMinat ? 'Mayoritas siswa memiliki minat belajar IPAS kategori "' + topMinat + '" (' + minatCount[topMinat] + ' siswa).' : null,
      topGaya ? 'Gaya belajar dominan di kelas Anda: ' + topGaya + ' (' + gayaCount[topGaya] + ' siswa).' : null
    ].filter(Boolean)
  };
}

async function buildDashboardKepsek(user) {
  const modulList = await sheets.findMany('ModulAjar', 'ValidatorEmail', user.Email);
  const statusCount = {};
  modulList.forEach(m => { statusCount[m.Status] = (statusCount[m.Status] || 0) + 1; });
  return {
    totalDiajukan: modulList.length,
    statusCount,
    menungguValidasi: modulList.filter(m => m.Status === MODUL_STATUS.DIAJUKAN).length,
    insights: ['Ada ' + (statusCount[MODUL_STATUS.DIAJUKAN] || 0) + ' Modul Ajar menunggu validasi Anda.']
  };
}

async function buildDashboardAdmin(user) {
  const guruList = await sheets.findMany('Users', 'Peran', auth.ROLE.GURU);
  const kepsekList = await sheets.findMany('Users', 'Peran', auth.ROLE.KEPSEK);
  const modulList = await sheets.getAllData('ModulAjar');
  const statusCount = {};
  modulList.forEach(m => { statusCount[m.Status] = (statusCount[m.Status] || 0) + 1; });
  return {
    totalGuru: guruList.length,
    totalKepsek: kepsekList.length,
    totalModul: modulList.length,
    statusCount,
    insights: ['Terdaftar ' + guruList.length + ' dari maksimal 100 guru.']
  };
}

// ── Laporan ──

async function getLaporanData(sessionToken) {
  try {
    const user = await auth.requireRole(sessionToken, [auth.ROLE.GURU, auth.ROLE.ADMIN, auth.ROLE.KEPSEK, auth.ROLE.SUPERADMIN]);
    if (user.Peran === auth.ROLE.GURU) return ok(await buildLaporanGuru(user));
    if (user.Peran === auth.ROLE.KEPSEK) return ok(await buildLaporanKepsek(user));
    return ok(await buildLaporanAdmin(user));
  } catch (err) { return fail(err.message); }
}

async function buildLaporanGuru(user) {
  const kelasList = await sheets.findMany('Kelas', 'GuruEmail', user.Email);

  const kelasReport = [];
  for (const kelas of kelasList) {
    const totalSiswa = (await sheets.findMany('Siswa', 'KelasID', kelas.ID)).length;
    const asesmenList = (await sheets.findMany('AsesmenDiagnostik', 'KelasID', kelas.ID))
      .sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));

    const asesmenReport = [];
    for (const a of asesmenList) {
      const responList = await sheets.findMany('ResponAsesmen', 'AsesmenID', a.ID);
      const siswaSudahIsi = {};
      responList.forEach(r => { siswaSudahIsi[r.SiswaID] = true; });
      const jumlahSudahIsi = Object.keys(siswaSudahIsi).length;
      const kelompokUntukAsesmen = (await sheets.findMany('KelompokBelajar', 'KelasID', kelas.ID)).filter(k => k.AsesmenID === a.ID);
      const tierCount = { Mahir: 0, Berkembang: 0, PerluPendampingan: 0 };
      kelompokUntukAsesmen.forEach(k => { tierCount[k.NamaKelompok] = safeParseJSON(k.AnggotaJSON, []).length; });
      asesmenReport.push({
        asesmenId: a.ID, judul: a.Judul, tanggal: a.Tanggal, statusAktif: a.StatusAktif,
        totalSiswa, jumlahSudahIsi,
        persenLengkap: totalSiswa > 0 ? Math.round((jumlahSudahIsi / totalSiswa) * 100) : 0,
        tierCount
      });
    }

    kelasReport.push({ kelasId: kelas.ID, namaKelas: kelas.NamaKelas, fase: kelas.Fase, totalSiswa, asesmenReport });
  }

  const modulListRaw = (await sheets.findMany('ModulAjar', 'GuruEmail', user.Email))
    .sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
  const riwayatModul = [];
  for (const m of modulListRaw) {
    const kelas = await sheets.findOne('Kelas', 'ID', m.KelasID);
    riwayatModul.push({ id: m.ID, namaKelas: kelas ? kelas.NamaKelas : '-', materi: m.Materi, status: m.Status, tanggal: m.Tanggal, catatanValidasi: m.CatatanValidasi || '' });
  }

  return { kelasReport, riwayatModul };
}

async function buildLaporanKepsek(user) {
  const modulList = await sheets.findMany('ModulAjar', 'ValidatorEmail', user.Email);
  const statusCount = {};
  modulList.forEach(m => { statusCount[m.Status] = (statusCount[m.Status] || 0) + 1; });

  const perGuruMap = {};
  modulList.forEach(m => {
    if (!perGuruMap[m.GuruEmail]) perGuruMap[m.GuruEmail] = { guruEmail: m.GuruEmail, total: 0, tervalidasi: 0, dikembalikan: 0, menunggu: 0 };
    const row = perGuruMap[m.GuruEmail];
    row.total++;
    if (m.Status === MODUL_STATUS.TERVALIDASI) row.tervalidasi++;
    else if (m.Status === MODUL_STATUS.DIKEMBALIKAN) row.dikembalikan++;
    else if (m.Status === MODUL_STATUS.DIAJUKAN) row.menunggu++;
  });
  const perGuru = [];
  for (const k of Object.keys(perGuruMap)) {
    const row = perGuruMap[k];
    const guru = await sheets.findOne('Users', 'Email', k);
    row.namaGuru = guru ? guru.Nama : k;
    perGuru.push(row);
  }
  perGuru.sort((a, b) => b.menunggu - a.menunggu);

  const durasiJamList = [];
  for (const m of modulList) {
    const logs = (await sheets.findMany('LogValidasi', 'ModulID', m.ID)).sort((a, b) => new Date(a.Tanggal) - new Date(b.Tanggal));
    const tDiajukan = logs.find(l => l.Status === MODUL_STATUS.DIAJUKAN);
    const tKeputusan = logs.filter(l => l.Status === MODUL_STATUS.TERVALIDASI || l.Status === MODUL_STATUS.DIKEMBALIKAN).pop();
    if (tDiajukan && tKeputusan) {
      const jam = (new Date(tKeputusan.Tanggal) - new Date(tDiajukan.Tanggal)) / 36e5;
      if (jam >= 0) durasiJamList.push(jam);
    }
  }
  const rataWaktuValidasiJam = durasiJamList.length ? Math.round(durasiJamList.reduce((a, b) => a + b, 0) / durasiJamList.length) : null;

  const menungguLama = [];
  for (const m of modulList.filter(m => m.Status === MODUL_STATUS.DIAJUKAN)) {
    const guru = await sheets.findOne('Users', 'Email', m.GuruEmail);
    const hariMenunggu = Math.floor((new Date() - new Date(m.Tanggal)) / 864e5);
    menungguLama.push({ id: m.ID, namaGuru: guru ? guru.Nama : m.GuruEmail, materi: m.Materi, tanggal: m.Tanggal, hariMenunggu });
  }
  menungguLama.sort((a, b) => b.hariMenunggu - a.hariMenunggu);

  return { statusCount, perGuru, rataWaktuValidasiJam, menungguLama };
}

async function buildLaporanAdmin(user) {
  const guruList = await sheets.findMany('Users', 'Peran', auth.ROLE.GURU);
  const allKelas = await sheets.getAllData('Kelas');
  const allAsesmen = await sheets.getAllData('AsesmenDiagnostik');
  const allModul = await sheets.getAllData('ModulAjar');
  const kelasByGuru = {};
  allKelas.forEach(k => { (kelasByGuru[k.GuruEmail] = kelasByGuru[k.GuruEmail] || []).push(k.ID); });

  const perGuru = guruList.map(g => {
    const kelasIds = kelasByGuru[g.Email] || [];
    const jumlahAsesmen = allAsesmen.filter(a => kelasIds.indexOf(a.KelasID) !== -1).length;
    const modulGuru = allModul.filter(m => m.GuruEmail === g.Email);
    const tanggalList = modulGuru.map(m => new Date(m.Tanggal)).concat(
      allAsesmen.filter(a => kelasIds.indexOf(a.KelasID) !== -1).map(a => new Date(a.Tanggal))
    );
    const aktivitasTerakhir = tanggalList.length ? new Date(Math.max.apply(null, tanggalList)) : null;
    return {
      email: g.Email, nama: g.Nama, sekolah: g.Sekolah,
      jumlahKelas: kelasIds.length, jumlahAsesmen, jumlahModul: modulGuru.length,
      aktivitasTerakhir: aktivitasTerakhir ? nowStrFromDate(aktivitasTerakhir) : '-',
      aktif: jumlahAsesmen > 0 || modulGuru.length > 0
    };
  }).sort((a, b) => b.jumlahModul - a.jumlahModul);

  const perSekolahMap = {};
  perGuru.forEach(g => {
    const key = g.sekolah || '(Belum diisi)';
    if (!perSekolahMap[key]) perSekolahMap[key] = { sekolah: key, jumlahGuru: 0, jumlahModul: 0, jumlahAsesmen: 0 };
    perSekolahMap[key].jumlahGuru++;
    perSekolahMap[key].jumlahModul += g.jumlahModul;
    perSekolahMap[key].jumlahAsesmen += g.jumlahAsesmen;
  });
  const perSekolah = Object.keys(perSekolahMap).map(k => perSekolahMap[k]).sort((a, b) => b.jumlahGuru - a.jumlahGuru);

  const statusCount = {};
  allModul.forEach(m => { statusCount[m.Status] = (statusCount[m.Status] || 0) + 1; });

  return {
    totalGuru: guruList.length,
    guruAktif: perGuru.filter(g => g.aktif).length,
    totalAsesmen: allAsesmen.length,
    totalModul: allModul.length,
    statusCount,
    perGuru,
    perSekolah
  };
}

module.exports = { getDashboardData, getLaporanData };
