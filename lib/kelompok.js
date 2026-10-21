// ============================================================
// lib/kelompok.js — Kelompok Belajar (pengelompokan otomatis berbasis
// Readiness) + CP&TP. Port 1:1 dari Kode.gs (konstanta READINESS_BASELINE
// dan CONTOH_REPRESENTASI_GAYA TIDAK boleh diubah susunan tekstnya, supaya
// rekomendasi yang tampil ke guru sama persis dengan versi lama).
// ============================================================

const { randomUUID } = require('crypto');
const sheets = require('./sheets');
const auth = require('./auth');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }
function safeParseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
}

const READINESS_BASELINE = {
  Mahir: {
    karakteristik: 'Memahami konsep dengan cepat, mampu berpikir kritis dan mandiri dalam belajar.',
    kontenGuru: materi => `Siapkan tantangan lanjutan dari materi ${materi} — soal atau kasus dengan tingkat kesulitan di atas rata-rata kelas.`,
    prosesGuru: () => 'Biarkan siswa menyelidiki sendiri (eksplorasi mandiri atau proyek kecil) tanpa banyak arahan langkah demi langkah.',
    produkGuru: () => 'Izinkan siswa memilih sendiri bentuk hasil karyanya (laporan, poster, presentasi, dsb), asal memenuhi kriteria yang menantang.',
    scaffoldingGuru: () => 'Peran guru di sini cukup sebagai pendamping — beri tantangan terbuka, lalu biarkan siswa bekerja mandiri sampai pertemuan berikutnya.',
    scaffoldingTipe: 'Strategic (pengayaan)', scaffoldingLevel: 3, scaffoldingLevelNama: 'Developing Conceptual Thinking',
    scaffoldingReferensi: 'Anghileri, 2006'
  },
  Berkembang: {
    karakteristik: 'Memahami konsep dasar, namun perlu latihan dan penguatan bertahap.',
    kontenGuru: materi => `Ulangi inti materi ${materi} secara singkat, lalu tambahkan latihan penguatan pada bagian yang masih sering salah.`,
    prosesGuru: () => 'Bimbing siswa dengan pertanyaan pemandu (bukan langsung memberi jawaban) saat mereka mengerjakan latihan.',
    produkGuru: () => 'Minta siswa memilih topik latihan sesuai minat mereka, dari beberapa pilihan yang guru sediakan.',
    scaffoldingGuruDefault: () => 'Kelompok ini butuh sedikit bimbingan tambahan. Amati dulu apakah siswa lebih butuh dicontohkan caranya, atau butuh diajak berdiskusi memilih strategi yang tepat — sesuaikan pendampingan berdasarkan itu.',
    scaffoldingGuruGapA: materi => `Kelompok ini belum menguasai bagian materi baru dari ${materi}. Pilih salah satu sesuai kondisi kelas: (a) jika siswa masih bingung caranya, tunjukkan langkah-langkah konkret disertai contoh; (b) jika siswa sudah tahu caranya tapi belum tepat menerapkan strategi, ajak diskusi kelompok kecil untuk membandingkan cara penyelesaian.`,
    scaffoldingGuruGapB: materi => `Kelompok ini sudah bisa mengikuti bagian baru dari ${materi}, tapi materi dasar/prasyaratnya masih perlu dikuatkan. Berikan penjelasan ulang singkat dan contoh konkret untuk materi dasarnya sebelum lanjut ke latihan berikutnya.`,
    scaffoldingTipe: null, scaffoldingLevel: 2, scaffoldingLevelNama: 'Explaining, Reviewing, Restructuring',
    scaffoldingReferensi: 'Anghileri, 2006; Kim & Hannafin, 2011'
  },
  PerluPendampingan: {
    karakteristik: 'Perlu bantuan memahami konsep, butuh bimbingan intensif dan media konkret.',
    kontenGuru: materi => `Sederhanakan materi ${materi} — gunakan bahasa yang lebih mudah dan contoh benda/kejadian nyata yang dekat dengan keseharian siswa.`,
    prosesGuru: () => 'Dampingi dalam kelompok kecil, tunjukkan langsung menggunakan alat peraga atau pengamatan langsung.',
    produkGuru: () => 'Minta hasil kerja dalam bentuk paling konkret — gambar, benda nyata, atau demonstrasi langsung — hindari tugas yang abstrak.',
    scaffoldingGuru: () => 'Kelompok ini butuh pendampingan penuh dari guru, dari awal sampai akhir. Sediakan lingkungan belajar dan alat bantu yang memudahkan mereka memahami konsep secara langsung, bukan sekadar teori.',
    scaffoldingTipe: 'Cognitive (otomatis)', scaffoldingLevel: 1, scaffoldingLevelNama: 'Environmental Provisions',
    scaffoldingReferensi: 'Anghileri, 2006'
  }
};

const CONTOH_REPRESENTASI_GAYA = {
  Visual: materi => `sediakan diagram, gambar, atau video tentang ${materi} agar lebih mudah dipahami secara visual`,
  Auditory: materi => `beri kesempatan berdiskusi lisan, bercerita, atau dengarkan penjelasan/rekaman audio tentang ${materi}`,
  Kinesthetic: materi => `ajak siswa mengamati atau mempraktikkan langsung sesuatu di sekitar mereka yang berkaitan dengan ${materi}`
};

function computeGroupOptions(anggota, materiLabel) {
  const materi = materiLabel || 'materi ini';
  const total = anggota.length;
  const hitungGaya = {};
  anggota.forEach(a => { if (a.GayaDominan && a.GayaDominan !== '-') hitungGaya[a.GayaDominan] = (hitungGaya[a.GayaDominan] || 0) + 1; });
  const minatRendah = anggota.filter(a => a.KategoriMinat === 'Rendah').length;

  const opsi = [];
  Object.keys(hitungGaya).forEach(gaya => {
    const contoh = CONTOH_REPRESENTASI_GAYA[gaya] ? CONTOH_REPRESENTASI_GAYA[gaya](materi) : '';
    opsi.push({
      checked: true,
      label: 'Sediakan representasi ' + gaya.toLowerCase() + (contoh ? ' (misalnya: ' + contoh + ')' : ''),
      keterangan: hitungGaya[gaya] + ' dari ' + total + ' anggota dominan ' + gaya
    });
  });
  if (minatRendah > 0) {
    opsi.push({
      checked: true,
      label: `Tambahkan penguatan motivasi (misalnya: kaitkan ${materi} dengan hal yang dekat dengan keseharian siswa, atau gunakan permainan/aktivitas eksplorasi yang lebih menarik)`,
      keterangan: minatRendah + ' anggota tergolong minat rendah'
    });
  }
  return opsi;
}

function generateRecommendationForGroup(tierKey, anggota, materiLabel) {
  const base = READINESS_BASELINE[tierKey];
  const materi = materiLabel || 'materi ini';

  let scaffoldingGuru = '';
  let scaffoldingTipe = base.scaffoldingTipe;
  if (tierKey === 'Berkembang') {
    const gapA = anggota.some(a => a.BagianGap === 'A');
    const gapB = anggota.some(a => a.BagianGap === 'B');
    if (gapA) { scaffoldingTipe = null; scaffoldingGuru = base.scaffoldingGuruGapA(materi); }
    else if (gapB) { scaffoldingTipe = 'Cognitive (otomatis)'; scaffoldingGuru = base.scaffoldingGuruGapB(materi); }
    else { scaffoldingGuru = base.scaffoldingGuruDefault(); }
  } else {
    scaffoldingGuru = base.scaffoldingGuru();
  }

  const scaffoldingTeori = (scaffoldingTipe ? scaffoldingTipe + ' — ' : 'Guru memilih pendekatan yang sesuai — ') +
    'Level ' + base.scaffoldingLevel + ': ' + base.scaffoldingLevelNama + ' (' + base.scaffoldingReferensi + ')';

  return {
    kontenGuru: base.kontenGuru(materi), prosesGuru: base.prosesGuru(), produkGuru: base.produkGuru(),
    scaffoldingGuru, scaffoldingTeori, scaffoldingLevel: base.scaffoldingLevel
  };
}

async function generateKelompokBelajar(sessionToken, [kelasId, asesmenId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const siswaList = await sheets.findMany('Siswa', 'KelasID', kelasId);
  if (siswaList.length === 0) return fail('Belum ada siswa di kelas ini.');

  const profilAll = await sheets.getAllData('ProfilSiswa');
  const profilList = siswaList.map(s => Object.assign({}, s,
    profilAll.find(p => p.SiswaID === s.ID) || { KategoriKesiapan: '-', SkorKesiapan: 0, BagianGap: '', KategoriMinat: '-', GayaDominan: '-' }
  ));
  const responCount = (await sheets.findMany('ResponAsesmen', 'AsesmenID', asesmenId)).length;
  if (responCount === 0) return fail('Belum ada hasil asesmen diagnostik untuk kelompok ini.');

  const asesmen = await sheets.findOne('AsesmenDiagnostik', 'ID', asesmenId);
  const materiLabel = asesmen ? asesmen.Judul : 'materi ini';

  const tiers = {
    Mahir: profilList.filter(p => p.KategoriKesiapan === 'Paham Utuh'),
    Berkembang: profilList.filter(p => p.KategoriKesiapan === 'Paham Sebagian'),
    PerluPendampingan: profilList.filter(p => p.KategoriKesiapan === 'Belum Paham' || !p.KategoriKesiapan || p.KategoriKesiapan === '-')
  };

  const existing = (await sheets.findMany('KelompokBelajar', 'KelasID', kelasId)).filter(k => k.AsesmenID === asesmenId);
  for (const k of existing) await sheets.deleteRecord('KelompokBelajar', k.ID);

  const hasil = [];
  for (const tier of Object.keys(tiers)) {
    if (tiers[tier].length === 0) continue;
    const opsiDiferensiasi = computeGroupOptions(tiers[tier], materiLabel);
    const rekomendasi = generateRecommendationForGroup(tier, tiers[tier], materiLabel);
    const rec = {
      ID: randomUUID(), KelasID: kelasId, AsesmenID: asesmenId, NamaKelompok: tier,
      AnggotaJSON: JSON.stringify(tiers[tier].map(p => p.ID)),
      Karakteristik: READINESS_BASELINE[tier].karakteristik,
      StrategiUmum: rekomendasi.kontenGuru,
      OpsiDiferensiasiJSON: JSON.stringify(opsiDiferensiasi),
      RekomendasiJSON: JSON.stringify(rekomendasi)
    };
    await sheets.addRecord('KelompokBelajar', rec);
    hasil.push(Object.assign({}, rec, { anggota: tiers[tier], opsiDiferensiasi, rekomendasi }));
  }
  return ok(hasil, 'Pengelompokan otomatis berbasis readiness berhasil dibuat.');
}

async function getKelompokBelajar(sessionToken, [kelasId, asesmenId]) {
  const list = (await sheets.findMany('KelompokBelajar', 'KelasID', kelasId)).filter(k => !asesmenId || k.AsesmenID === asesmenId);
  const profilAll = await sheets.getAllData('ProfilSiswa');
  const enriched = [];
  for (const k of list) {
    const ids = safeParseJSON(k.AnggotaJSON, []);
    const anggota = [];
    for (const id of ids) {
      const s = await sheets.findOne('Siswa', 'ID', id);
      const p = profilAll.find(pr => pr.SiswaID === id);
      anggota.push(Object.assign({}, s, p || {}));
    }
    enriched.push(Object.assign({}, k, {
      anggota, opsiDiferensiasi: safeParseJSON(k.OpsiDiferensiasiJSON, []), rekomendasi: safeParseJSON(k.RekomendasiJSON, {})
    }));
  }
  return ok(enriched);
}

async function pindahkanSiswaKelompok(sessionToken, [siswaId, kelompokAsalId, kelompokTujuanId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const asal = await sheets.findOne('KelompokBelajar', 'ID', kelompokAsalId);
  const tujuan = await sheets.findOne('KelompokBelajar', 'ID', kelompokTujuanId);
  if (!asal || !tujuan) return fail('Kelompok tidak ditemukan.');
  const anggotaAsal = safeParseJSON(asal.AnggotaJSON, []).filter(id => id !== siswaId);
  const anggotaTujuan = safeParseJSON(tujuan.AnggotaJSON, []);
  if (anggotaTujuan.indexOf(siswaId) === -1) anggotaTujuan.push(siswaId);
  await sheets.updateRecord('KelompokBelajar', Object.assign({}, asal, { AnggotaJSON: JSON.stringify(anggotaAsal) }));
  await sheets.updateRecord('KelompokBelajar', Object.assign({}, tujuan, { AnggotaJSON: JSON.stringify(anggotaTujuan) }));
  return ok(null, 'Siswa berhasil dipindahkan kelompok.');
}

// ── CP & TP ──
async function getBankCPTP(sessionToken, [fase]) {
  const list = await sheets.findMany('BankCPTP_IPAS', 'Fase', fase);
  return ok(list.map(b => Object.assign({}, b, { TPJson: safeParseJSON(b.TPJson, []) })));
}

async function kelolaBankCPTP(sessionToken, [bankObj]) {
  await auth.requireRole(sessionToken, [auth.ROLE.ADMIN, auth.ROLE.SUPERADMIN]);
  const payload = Object.assign({}, bankObj, { TPJson: JSON.stringify(bankObj.TPJson || []) });
  const rec = payload.ID ? await sheets.updateRecord('BankCPTP_IPAS', payload) : await sheets.addRecord('BankCPTP_IPAS', Object.assign({ ID: randomUUID() }, payload));
  return ok(rec);
}

async function simpanCPTP(sessionToken, [kelasId, fase, teksCP, daftarTP]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const tpWithId = (daftarTP || []).map(t => (t.id ? t : Object.assign({}, t, { id: randomUUID() })));
  const rec = await sheets.addRecord('CP_TP', {
    ID: randomUUID(), KelasID: kelasId, Fase: fase, TeksCP: teksCP, TPJson: JSON.stringify(tpWithId)
  });
  return ok(rec);
}

async function getCPTPByKelas(sessionToken, [kelasId]) {
  const list = await sheets.findMany('CP_TP', 'KelasID', kelasId);
  return ok(list.map(c => Object.assign({}, c, { TPJson: safeParseJSON(c.TPJson, []) })));
}

async function hapusCPTP(sessionToken, [cptpId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  if (!cptpId) return fail('ID CP & TP wajib diisi.');
  await sheets.deleteRecord('CP_TP', cptpId);
  return ok(null, 'CP & TP berhasil dihapus.');
}

// ── Diferensiasi ──
async function getRekomendasiDiferensiasi(sessionToken, [namaKelompok]) {
  const tingkat = namaKelompok === 'Mahir' ? 'Tinggi' : (namaKelompok === 'Berkembang' ? 'Sedang' : 'Rendah');
  const bank = (await sheets.getAllData('BankStrategiDiferensiasi')).filter(b => b.TingkatKesiapan === tingkat);
  const byDimensi = { Konten: [], Proses: [], Produk: [] };
  bank.forEach(b => { if (byDimensi[b.Dimensi]) byDimensi[b.Dimensi].push(b.Deskripsi); });
  return ok(byDimensi);
}

async function simpanDiferensiasi(sessionToken, [kelompokId, konten, proses, produk]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const existing = (await sheets.findMany('Diferensiasi', 'KelompokID', kelompokId))[0];
  const payload = { ID: existing ? existing.ID : randomUUID(), KelompokID: kelompokId, TPID: '', Konten: konten, Proses: proses, Produk: produk };
  const rec = existing ? await sheets.updateRecord('Diferensiasi', payload) : await sheets.addRecord('Diferensiasi', payload);
  return ok(rec);
}

async function getDiferensiasiByKelas(sessionToken, [kelasId]) {
  const kelompokIds = (await sheets.findMany('KelompokBelajar', 'KelasID', kelasId)).map(k => k.ID);
  const all = (await sheets.getAllData('Diferensiasi')).filter(d => kelompokIds.indexOf(d.KelompokID) !== -1);
  return ok(all);
}

// ── Scaffolding Planner ──
async function simpanScaffolding(sessionToken, [kelompokId, level1, level2, level3, level4]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const existing = (await sheets.findMany('ScaffoldingPlan', 'KelompokID', kelompokId))[0];
  const payload = { ID: existing ? existing.ID : randomUUID(), KelompokID: kelompokId, TPID: '', Level1: level1, Level2: level2, Level3: level3, Level4: level4 };
  const rec = existing ? await sheets.updateRecord('ScaffoldingPlan', payload) : await sheets.addRecord('ScaffoldingPlan', payload);
  return ok(rec);
}

async function getScaffoldingByKelas(sessionToken, [kelasId]) {
  const kelompokIds = (await sheets.findMany('KelompokBelajar', 'KelasID', kelasId)).map(k => k.ID);
  const all = (await sheets.getAllData('ScaffoldingPlan')).filter(s => kelompokIds.indexOf(s.KelompokID) !== -1);
  return ok(all);
}

module.exports = {
  generateKelompokBelajar, getKelompokBelajar, pindahkanSiswaKelompok,
  getBankCPTP, kelolaBankCPTP, simpanCPTP, getCPTPByKelas, hapusCPTP,
  getRekomendasiDiferensiasi, simpanDiferensiasi, getDiferensiasiByKelas,
  simpanScaffolding, getScaffoldingByKelas
};
