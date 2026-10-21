// ============================================================
// lib/modulajar.js — Generator Modul Ajar (AI/Gemini) + alur Validasi.
// CATATAN ARSITEKTUR: isi/konten Modul Ajar (teks hasil AI) dibuat & disimpan
// di SINI (Vercel). Tombol "Download Word/PDF" (eksporModulAjarKeDokumen)
// SENGAJA TETAP di Google Apps Script (lihat lib/README atau catatan di
// api/rpc.js) karena memakai DocumentApp yang hanya ada di Apps Script.
//
// PERUBAHAN PERILAKU KECIL vs versi lama: dulu saat Kepsek "Setuju"-kan
// validasi, dokumen Word/PDF langsung otomatis ter-generate di baliknya.
// Sekarang (karena pembuatan dokumen ada di sistem terpisah/GAS), proses
// itu TIDAK lagi otomatis — guru tinggal klik tombol "Download Word/PDF"
// seperti biasa setelah modul tervalidasi. Fungsinya tetap sama, cuma
// waktunya jadi manual satu klik, bukan otomatis.
// ============================================================

const { randomUUID } = require('crypto');
const sheets = require('./sheets');
const auth = require('./auth');
const { getCPTPByKelas } = require('./kelompok');
const { getKelompokBelajar, getDiferensiasiByKelas: _getDif, getScaffoldingByKelas: _getScaf } = require('./kelompok');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }
function safeParseJSON(str, fallback) { try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; } }
function nowStr() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace('T', ' '); }

const TEMPLATE_JENIS = { PEMBELAJARAN_MENDALAM: 'Pembelajaran Mendalam', KURIKULUM_CINTA: 'Kurikulum Berbasis Cinta' };
const MODUL_STATUS = { DRAFT: 'Draft', DIAJUKAN: 'Diajukan', TERVALIDASI: 'Tervalidasi', DIKEMBALIKAN: 'Dikembalikan' };
const TIER_JSON_KEY_ = { Mahir: 'mahir', Berkembang: 'berkembang', PerluPendampingan: 'perluPendampingan' };

function buildModulAjarPrompt(d) {
  const judulTemplate = d.jenisTemplate === TEMPLATE_JENIS.KURIKULUM_CINTA
    ? 'MODUL AJAR PEMBELAJARAN MENDALAM (KURIKULUM BERBASIS CINTA)'
    : 'MODUL AJAR PEMBELAJARAN MENDALAM';
  const kelompokKeysAda = d.kelompok.map(k => TIER_JSON_KEY_[k.nama] || k.nama.toLowerCase());

  return [
    'Anda adalah perancang kurikulum sekaligus guru ahli IPAS SD/MI di Indonesia, yang biasa menulis Modul Ajar/RPP yang RAPI, KONKRET, DAN SPESIFIK pada materi — bukan kalimat umum yang bisa dipakai untuk topik apa saja.',
    'Susun sebuah ' + judulTemplate + ' berdasarkan data berikut, dan kembalikan HASIL HANYA dalam format JSON (tanpa markdown, tanpa penjelasan tambahan) dengan struktur persis seperti contoh di bawah.',
    '',
    'DATA:',
    'Jenjang: ' + (d.jenjang || 'SD/MI'),
    'Sekolah: ' + d.sekolah, 'Kepala Sekolah: ' + (d.namaKepsek || '-') + ' (NIP: ' + (d.nipKepsek || '-') + ')',
    'Guru Mapel: ' + d.guru + ' (NIP: ' + (d.nipGuru || '-') + ')', 'Tahun Pelajaran: ' + (d.tahunPelajaran || '-') + ', Semester: ' + (d.semester || '-'),
    'Kelas/Fase: ' + d.kelas + ' / ' + d.fase,
    'Mapel: ' + d.mapel, 'Materi: ' + d.materi,
    'Model Pembelajaran: ' + (d.modelPembelajaran || '-'),
    'Alokasi Waktu: ' + (d.alokasiWaktu || '-') + ', Jumlah Pertemuan: ' + d.jumlahPertemuan + ', Jumlah Sesi per pertemuan: ' + d.jumlahSesi,
    (d.dimensiProfilLulusan && d.dimensiProfilLulusan.length ? 'Dimensi Profil Lulusan yang disasar: ' + d.dimensiProfilLulusan.join(', ') : ''),
    'Tujuan Pembelajaran (TP) yang dipilih: ' + JSON.stringify(d.tp),
    'Kelompok Belajar yang ADA (hasil pengelompokan berdasarkan kesiapan — HANYA kelompok ini yang boleh dipakai, jangan menambah kelompok lain), beserta rencana Diferensiasi (Konten/Proses/Produk) dan Scaffolding Planner (4 level) yang SUDAH DIRANCANG SENDIRI OLEH GURU untuk tiap kelompok — WAJIB dipakai apa adanya, bukan dikarang ulang: ' + JSON.stringify(d.kelompok),
    'Key JSON untuk kelompok di atas (urutan sama): ' + JSON.stringify(kelompokKeysAda),
    (d.jenisTemplate === TEMPLATE_JENIS.KURIKULUM_CINTA && d.kurikulumCintaTopik && d.kurikulumCintaTopik.length
      ? 'Topik Kurikulum Cinta yang dipilih guru untuk diinsersikan: ' + d.kurikulumCintaTopik.join(', ') : ''),
    '',
    'KETENTUAN PENTING:',
    '1. Bagi "Langkah-langkah Pembelajaran" (field "pertemuan") menjadi ' + d.jumlahPertemuan + ' pertemuan. Setiap pertemuan punya judul menarik & konkret (bukan generik), dan "fokus" yang menyebutkan TP mana yang menjadi fokus/penguatan pada pertemuan itu — sebarkan Tujuan Pembelajaran secara logis dan bertahap di seluruh pertemuan (bisa ada penguatan TP sebelumnya + fokus TP baru).',
    '2. Setiap pertemuan WAJIB punya 5 tahap: tahapAwal, tahapIntiMemahami, tahapIntiMengaplikasi, tahapIntiMerefleksi, tahapPenutup — persis mengikuti kerangka resmi AWAL / INTI (Memahami→Mengaplikasi→Merefleksi) / PENUTUP. Pada tahapIntiMemahami, tahapIntiMengaplikasi, dan tahapIntiMerefleksi, isi field "sintaks" dengan nomor+nama sintaks Model Pembelajaran "' + (d.modelPembelajaran || '-') + '" yang paling sesuai tahap itu (map sintaks modelnya ke 3 sub-tahap ini secara logis — boleh satu sintaks mencakup lebih dari satu sub-tahap). tahapAwal dan tahapPenutup TIDAK perlu field sintaks.',
    '3. DIFERENSIASI HANYA BOLEH MUNCUL DI tahapIntiMengaplikasi, lewat field "kelompok" — berisi SATU key untuk SETIAP key pada daftar "Key JSON untuk kelompok di atas" (tidak lebih, tidak kurang). Untuk tiap key, isi {"kegiatan":["...","..."], "scaffolding":["...","..."]}: "kegiatan" adalah ARRAY 3-5 POIN kegiatan konkret berurutan (bukan satu paragraf), diturunkan/dijabarkan langsung dari diferensiasiKonten/diferensiasiProses/diferensiasiProduk kelompok tersebut (jangan mengarang strategi lain), dan "scaffolding" adalah ARRAY 2-4 POIN yang mengikuti urutan scaffoldingModeling → scaffoldingPrompting → scaffoldingGuidedPractice → scaffoldingIndependentPractice milik kelompok itu (lewati level yang kosong). Variasikan kegiatan konkretnya antar pertemuan (jangan mengulang kalimat yang sama di setiap pertemuan) walau tetap konsisten dengan rencana diferensiasi guru. tahapAwal, tahapIntiMemahami, tahapIntiMerefleksi, dan tahapPenutup TIDAK dipisah per kelompok (satu kegiatan yang sama untuk seluruh kelas).',
    '4. Setiap tahap (kecuali tahapIntiMengaplikasi, lihat poin 3) WAJIB punya field "kegiatan" berupa ARRAY 3-5 POIN kegiatan KONKRET berurutan (bukan satu paragraf) sesuai konteks sekolah & materi — sebutkan media/alat spesifik, pertanyaan pemantik, dsb — jangan kalimat umum. JANGAN PERNAH menyebut nama guru secara spesifik di dalam "kegiatan" (mis. "Guru Budi" atau "Bu Siti") — gunakan kata generik "Guru" saja. Setiap tahap juga WAJIB punya "prinsip" (satu kalimat, kaitkan dengan prinsip Pembelajaran Mendalam: berkesadaran/bermakna/menggembirakan, DAN kaitkan dengan nilai Panca Cinta yang relevan jika Kurikulum Berbasis Cinta), dan "waktu" (estimasi menit realistis dari Alokasi Waktu di atas, format singkat seperti "10\'"). tahapIntiMengaplikasi juga wajib punya "sintaks", "prinsip", dan "waktu" di level tahap (selain field "kelompok").',
    '5. Gunakan bahasa Indonesia baku, konkret, dan sesuai konteks ' + (d.jenjang || 'SD/MI') + ' serta nama sekolah/guru di atas.',
    (d.jenisTemplate === TEMPLATE_JENIS.KURIKULUM_CINTA ? '6. Sisipkan nilai adab dan penguatan karakter Islami secara wajar pada Pemahaman Bermakna, "prinsip" tiap tahap, dan Refleksi, khususnya merujuk topik Kurikulum Cinta yang dipilih di atas.' : '6. Ikuti prinsip Pembelajaran Mendalam (mindful, meaningful, joyful) secara konsisten.'),
    '7. Isi "informasiUmum" persis dengan data identitas dokumen di atas (jangan dikosongkan/dikarang). Jika Kurikulum Berbasis Cinta, isi juga "topikKurikulumCinta" dengan menyalin ulang PERSIS daftar "Topik Kurikulum Cinta yang dipilih guru" di atas (jangan diubah/ditambah).',
    '8. "lintasDisiplinIlmu", "kemitraanPembelajaran", "lingkunganPembelajaran", "pemanfaatanDigital" HARUS berisi 2-3 poin KONKRET dan relevan dengan Materi "' + d.materi + '" (sebutkan mapel lain yang relevan, pihak/tempat spesifik, media digital yang masuk akal dipakai di ' + (d.jenjang || 'SD/MI') + ') — jangan diisi tanda "-".',
    '9. "asesmenDiagnostikNonKognitif" WAJIB 5 pertanyaan Ya/Tidak yang relevan dengan karakteristik/gaya belajar kelompok di atas dan Materi "' + d.materi + '" (bukan pertanyaan umum seperti "apa kabar hari ini").',
    (d.dimensiProfilLulusan && d.dimensiProfilLulusan.length
      ? '10. "instrumenKarakter" WAJIB berisi SATU entri untuk SETIAP Dimensi Profil Lulusan yang disasar di atas (urutan sama), masing-masing dengan 2 "indikator" perilaku KONKRET dan teramati terkait Materi "' + d.materi + '" (bukan indikator umum).'
      : '10. "instrumenKarakter" boleh dikosongkan ([]) karena tidak ada Dimensi Profil Lulusan yang disasar.'),
    '11. "rubrikPengetahuan" dan "rubrikKeterampilan" WAJIB masing-masing punya 3-4 "aspek" penilaian yang SPESIFIK untuk Materi "' + d.materi + '" (bukan aspek generik seperti "Pemahaman Konsep" tanpa konteks — tulis mis. "Identifikasi Fungsi Panca Indra"), dan "pedomanSkor" berisi deskriptor konkret berjenjang skor4 (Sangat Baik) → skor1 (Kurang) untuk tiap aspek tersebut.',
    '12. "refleksiSiswa" berisi 3 pertanyaan reflektif yang ramah anak dan terkait langsung dengan Materi "' + d.materi + '".',
    '',
    'FORMAT JSON OUTPUT (ikuti struktur ini persis):',
    '{',
    '  "informasiUmum": {"sekolah":"...","kepalaSekolah":"...","nipKepalaSekolah":"...","guru":"...","nipGuru":"...","tahunPelajaran":"...","semester":"...","kelas":"...","fase":"...","mapel":"IPAS","materi":"...","modelPembelajaran":"...","alokasiWaktu":"...","dimensiProfilLulusan":["..."],"topikKurikulumCinta":["..."]},',
    '  "lintasDisiplinIlmu": ["..."], "kemitraanPembelajaran": ["..."], "lingkunganPembelajaran": ["..."], "pemanfaatanDigital": ["..."],',
    '  "topikPembelajaran": "...",',
    '  "tujuanPembelajaran": ["..."],',
    '  "pemahamanBermakna": "...",',
    '  "pertanyaanPemantik": ["..."],',
    '  "pertemuan": [',
    '    { "nomor": 1, "judul": "...", "fokus": "...",',
    '      "tahapAwal": {"kegiatan":["...","..."],"prinsip":"...","waktu":"10\'"},',
    '      "tahapIntiMemahami": {"sintaks":"...","kegiatan":["...","..."],"prinsip":"...","waktu":"15\'"},',
    '      "tahapIntiMengaplikasi": {"sintaks":"...","prinsip":"...","waktu":"15\'","kelompok": { "<key_kelompok>": {"kegiatan":["...","..."],"scaffolding":["...","..."]} } },',
    '      "tahapIntiMerefleksi": {"sintaks":"...","kegiatan":["...","..."],"prinsip":"...","waktu":"15\'"},',
    '      "tahapPenutup": {"kegiatan":["...","..."],"prinsip":"...","waktu":"10\'"}',
    '    }',
    '  ],',
    '  "asesmen": {"awal":"...","proses":"...","akhir":"..."},',
    '  "asesmenDiagnostikNonKognitif": ["...","...","...","...","..."],',
    '  "instrumenKarakter": [ {"dimensi":"...", "indikator": ["...","..."]} ],',
    '  "rubrikPengetahuan": {"aspek":["..."], "pedomanSkor":[{"aspek":"...","skor4":"...","skor3":"...","skor2":"...","skor1":"..."}]},',
    '  "rubrikKeterampilan": {"aspek":["..."], "pedomanSkor":[{"aspek":"...","skor4":"...","skor3":"...","skor2":"...","skor1":"..."}]},',
    '  "refleksiGuru": ["..."],',
    '  "refleksiSiswa": ["...","...","..."]',
    '}'
  ].join('\n');
}

// Daftar model dicoba berurutan sama seperti versi GAS lama.
const GEMINI_MODEL_FALLBACK = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

async function callGeminiAPI(prompt) {
  const apiKey = await sheets.getConfig('geminiApiKey');
  if (!apiKey) return fail('Gemini API Key belum diatur di menu Pengaturan.');

  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, responseMimeType: 'application/json' } });
  let lastErrorMsg = '';
  for (const model of GEMINI_MODEL_FALLBACK) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const code = resp.status;
      if (code === 200) {
        const json = await resp.json();
        const text = json.candidates && json.candidates[0] && json.candidates[0].content.parts[0].text;
        if (!text) return fail('Respons AI kosong.');
        return ok(JSON.parse(text));
      }
      const bodyText = await resp.text();
      if (code === 429 || bodyText.indexOf('RESOURCE_EXHAUSTED') !== -1) {
        return fail('Kuota gratis Gemini API untuk hari ini sudah habis. Tunggu sampai kuota reset (biasanya harian), atau aktifkan billing/upgrade plan di Google AI Studio untuk kuota lebih besar. Detail: ' + bodyText);
      }
      lastErrorMsg = 'Gemini API (' + model + ') error (' + code + '): ' + bodyText;
      if (code !== 503 && code !== 500) break;
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return fail(lastErrorMsg + ' (sudah dicoba ulang di beberapa model, server Gemini sedang sibuk. Coba lagi beberapa saat lagi.)');
}

async function generateModulAjar(sessionToken, [params]) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const kelas = await sheets.findOne('Kelas', 'ID', params.kelasId);
  const cptpRes = await getCPTPByKelas(sessionToken, [params.kelasId]);
  const cptpList = cptpRes.data || [];
  const tpTerpilih = [];
  cptpList.forEach(c => c.TPJson.forEach(tp => { if (params.tpIds.indexOf(tp.id) !== -1) tpTerpilih.push(Object.assign({}, tp, { cp: c.TeksCP, fase: c.Fase })); }));
  if (tpTerpilih.length === 0) return fail('Pilih minimal satu Tujuan Pembelajaran (TP).');

  const kelompokRes = await getKelompokBelajar(sessionToken, [params.kelasId, params.asesmenId]);
  const diferensiasiRes = await _getDif(sessionToken, [params.kelasId]);
  const scaffoldingRes = await _getScaf(sessionToken, [params.kelasId]);
  const kelompokList = kelompokRes.data || [];
  const diferensiasi = diferensiasiRes.data || [];
  const scaffolding = scaffoldingRes.data || [];

  const dataUntukAI = {
    sekolah: params.namaSekolah || user.Sekolah, guru: params.namaGuru || user.Nama,
    nipGuru: params.nipGuru || '', namaKepsek: params.namaKepsek || '', nipKepsek: params.nipKepsek || '',
    tahunPelajaran: params.tahunPelajaran || '', semester: (new Date().getMonth() + 1) >= 7 ? 'Ganjil' : 'Genap',
    kelas: kelas.NamaKelas, fase: kelas.Fase, jenjang: params.jenjang || 'SD/MI',
    mapel: 'IPAS', materi: params.materi, jumlahPertemuan: params.jumlahPertemuan, jumlahSesi: params.jumlahSesi,
    alokasiWaktu: params.alokasiWaktu || '', modelPembelajaran: params.modelPembelajaran || '',
    dimensiProfilLulusan: params.dimensiProfilLulusan || [], tp: tpTerpilih,
    kelompok: kelompokList.map(k => {
      const dif = diferensiasi.find(d => d.KelompokID === k.ID) || {};
      const scaf = scaffolding.find(s => s.KelompokID === k.ID) || {};
      return {
        nama: k.NamaKelompok, jumlahSiswa: k.anggota.length, karakteristik: k.Karakteristik,
        diferensiasiKonten: dif.Konten || '(belum diisi guru — gunakan strategi umum sesuai karakteristik kelompok)',
        diferensiasiProses: dif.Proses || '(belum diisi guru — gunakan strategi umum sesuai karakteristik kelompok)',
        diferensiasiProduk: dif.Produk || '(belum diisi guru — gunakan strategi umum sesuai karakteristik kelompok)',
        scaffoldingModeling: scaf.Level1 || '', scaffoldingPrompting: scaf.Level2 || '',
        scaffoldingGuidedPractice: scaf.Level3 || '', scaffoldingIndependentPractice: scaf.Level4 || ''
      };
    }),
    jenisTemplate: params.jenisTemplate, kurikulumCintaTopik: params.kurikulumCintaTopik || []
  };

  const prompt = buildModulAjarPrompt(dataUntukAI);
  const aiResult = await callGeminiAPI(prompt);
  if (!aiResult.success) return fail('Generate gagal: ' + aiResult.message);

  const totalSiswaSemua = dataUntukAI.kelompok.reduce((s, k) => s + (k.jumlahSiswa || 0), 0);
  const kelompokRingkasan = dataUntukAI.kelompok.map(k => ({
    nama: k.nama, jumlahSiswa: k.jumlahSiswa,
    persentase: totalSiswaSemua ? Math.round((k.jumlahSiswa / totalSiswaSemua) * 100) : 0
  }));
  const kontenFinal = Object.assign({}, aiResult.data, { kelompokRingkasan });

  const record = {
    ID: randomUUID(), GuruEmail: user.Email, KelasID: params.kelasId, Mapel: 'IPAS', Materi: params.materi,
    JenisTemplate: params.jenisTemplate, TPIdsJson: JSON.stringify(params.tpIds),
    KontenJson: JSON.stringify(kontenFinal), Status: MODUL_STATUS.DRAFT,
    FileDocUrl: '', FilePdfUrl: '', ValidatorEmail: '', CatatanValidasi: '', Tanggal: nowStr()
  };
  await sheets.addRecord('ModulAjar', record);
  return ok(record, 'Draf Modul Ajar berhasil digenerate. Silakan sunting sebelum diajukan.');
}

async function simpanEditModulAjar(sessionToken, [modulId, kontenObj]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const existing = await sheets.findOne('ModulAjar', 'ID', modulId);
  if (!existing) return fail('Modul tidak ditemukan.');
  const rec = await sheets.updateRecord('ModulAjar', Object.assign({}, existing, { KontenJson: JSON.stringify(kontenObj) }));
  return ok(rec);
}

async function getModulAjarSaya(sessionToken) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const list = (await sheets.findMany('ModulAjar', 'GuruEmail', user.Email)).map(m => Object.assign({}, m, {
    KontenJson: safeParseJSON(m.KontenJson, {}), TPIdsJson: safeParseJSON(m.TPIdsJson, [])
  }));
  return ok(list);
}

async function getCapaianPembelajaranTeks_(sessionToken, kelasId, tpIds) {
  const res = await getCPTPByKelas(sessionToken, [kelasId]);
  const cptpList = res.data || [];
  const cpTerkait = [];
  cptpList.forEach(c => (c.TPJson || []).forEach(tp => {
    if (tpIds.indexOf(tp.id) !== -1 && cpTerkait.indexOf(c.TeksCP) === -1) cpTerkait.push(c.TeksCP);
  }));
  return cpTerkait.join(' ');
}

async function getModulAjarDetail(sessionToken, [modulId]) {
  const m = await sheets.findOne('ModulAjar', 'ID', modulId);
  if (!m) return fail('Modul tidak ditemukan.');
  m.KontenJson = safeParseJSON(m.KontenJson, {});
  m.TPIdsJson = safeParseJSON(m.TPIdsJson, []);
  m.CapaianPembelajaranText = await getCapaianPembelajaranTeks_(sessionToken, m.KelasID, m.TPIdsJson);
  return ok(m);
}

async function ajukanValidasi(sessionToken, [modulId, validatorEmail]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  const validator = await sheets.findOne('Users', 'Email', validatorEmail);
  if (!validator || validator.Peran !== auth.ROLE.KEPSEK) return fail('Validator harus terdaftar sebagai Kepala Sekolah/Pengawas.');
  const existing = await sheets.findOne('ModulAjar', 'ID', modulId);
  await sheets.updateRecord('ModulAjar', Object.assign({}, existing, { Status: MODUL_STATUS.DIAJUKAN, ValidatorEmail: validatorEmail }));
  await sheets.addRecord('LogValidasi', { ID: randomUUID(), ModulID: modulId, ValidatorEmail: validatorEmail, Status: MODUL_STATUS.DIAJUKAN, Catatan: '', Tanggal: nowStr() });
  return ok(null, 'Modul Ajar berhasil diajukan untuk validasi.');
}

async function getModulUntukValidasi(sessionToken) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.KEPSEK]);
  const list = (await sheets.findMany('ModulAjar', 'ValidatorEmail', user.Email)).filter(m => m.Status === MODUL_STATUS.DIAJUKAN);
  return ok(list.map(m => Object.assign({}, m, { KontenJson: safeParseJSON(m.KontenJson, {}) })));
}

async function prosesValidasi(sessionToken, [modulId, keputusan, catatan]) {
  const user = await auth.requireRole(sessionToken, [auth.ROLE.KEPSEK]);
  const status = keputusan === 'setuju' ? MODUL_STATUS.TERVALIDASI : MODUL_STATUS.DIKEMBALIKAN;
  const existing = await sheets.findOne('ModulAjar', 'ID', modulId);
  await sheets.updateRecord('ModulAjar', Object.assign({}, existing, { Status: status, CatatanValidasi: catatan || '' }));
  await sheets.addRecord('LogValidasi', { ID: randomUUID(), ModulID: modulId, ValidatorEmail: user.Email, Status: status, Catatan: catatan || '', Tanggal: nowStr() });
  return ok(null, status === MODUL_STATUS.TERVALIDASI
    ? 'Modul Ajar disetujui & tervalidasi. Guru dapat mengunduh Word/PDF-nya dari menu Modul Ajar Saya.'
    : 'Modul Ajar dikembalikan ke guru dengan catatan.');
}

async function kelolaBankStrategi(sessionToken, [bankObj]) {
  await auth.requireRole(sessionToken, [auth.ROLE.ADMIN, auth.ROLE.SUPERADMIN]);
  const rec = bankObj.ID ? await sheets.updateRecord('BankStrategiDiferensiasi', bankObj) : await sheets.addRecord('BankStrategiDiferensiasi', Object.assign({ ID: randomUUID() }, bankObj));
  return ok(rec);
}

async function hapusBankStrategi(sessionToken, [id]) {
  await auth.requireRole(sessionToken, [auth.ROLE.ADMIN, auth.ROLE.SUPERADMIN]);
  await sheets.deleteRecord('BankStrategiDiferensiasi', id);
  return ok(true);
}

module.exports = {
  generateModulAjar, simpanEditModulAjar, getModulAjarSaya, getModulAjarDetail,
  ajukanValidasi, getModulUntukValidasi, prosesValidasi,
  kelolaBankStrategi, hapusBankStrategi
};
