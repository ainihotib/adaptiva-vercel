// ============================================================
// lib/import.js — Import massal Siswa (Excel/Word) & Respon Asesmen (Excel).
// Di Apps Script versi lama, ini memakai trik Drive.Files.create({convert:true})
// untuk mengonversi file upload menjadi Google Sheets/Docs sementara lalu
// dibaca lewat SpreadsheetApp/DocumentApp. Di Node/Vercel tidak ada Drive
// semacam itu, jadi dipakai cara yang lebih langsung: paket "xlsx" untuk
// membaca file Excel langsung dari buffer, dan "mammoth" untuk mengubah
// file Word (.docx) menjadi HTML lalu tabel pertamanya diparse manual.
// Aturan pencocokan kolom & validasi dibuat SAMA PERSIS dengan logika asli
// (importSiswaRows / importAsesmenExcel di Kode.gs) supaya hasil & pesan
// error konsisten dengan versi GAS.
// ============================================================

const XLSX = require('xlsx');
const mammoth = require('mammoth');
const { randomUUID } = require('crypto');
const sheets = require('./sheets');
const auth = require('./auth');
const asesmen = require('./asesmen');

function ok(data, message) { return { success: true, data, message: message || 'OK' }; }
function fail(message) { return { success: false, data: null, message }; }
function nowStr() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace('T', ' '); }

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Helper bersama: baca array baris (header di baris pertama, dicari fleksibel
// di antara 15 baris pertama) lalu simpan sebagai Siswa baru. Sama persis
// dengan importSiswaRows di Kode.gs, hanya addRecord-nya jadi async/berurutan.
async function importSiswaRowsHelper(values, kelasId) {
  if (!values || values.length < 2) return 0;
  const norm = v => (v === null || v === undefined) ? '' : v.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  const namaCandidates = ['namasiswa', 'nama'];
  let headerRowIdx = -1, headers = null;
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const rowNorm = (values[i] || []).map(norm);
    if (rowNorm.some(h => namaCandidates.indexOf(h) !== -1)) { headerRowIdx = i; headers = rowNorm; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error('Kolom "Nama Siswa" (atau "Nama") tidak ditemukan pada file. Pastikan ada baris header dengan nama kolom "Nama" atau "Nama Siswa".');
  }

  const findCol = candidates => headers.findIndex(h => candidates.indexOf(h) !== -1);
  const colAbsen = findCol(['noabsen', 'no', 'nomor', 'absen']);
  const colNama = findCol(namaCandidates);
  const colNis = findCol(['nis']);
  const colJK = findCol(['jk', 'jeniskelamin', 'gender']);

  let imported = 0;
  const rows = values.slice(headerRowIdx + 1);
  for (const row of rows) {
    const namaRaw = row[colNama];
    if (!namaRaw || !namaRaw.toString().trim()) continue;
    let jk = colJK !== -1 && row[colJK] ? row[colJK].toString().trim().toUpperCase() : '';
    jk = jk.startsWith('P') ? 'P' : (jk.startsWith('L') ? 'L' : (jk || 'L'));
    await sheets.addRecord('Siswa', {
      ID: randomUUID(),
      KelasID: kelasId,
      Nama: namaRaw.toString().trim(),
      JenisKelamin: jk,
      NoAbsen: colAbsen !== -1 ? (row[colAbsen] != null ? row[colAbsen] : '') : '',
      NIS: colNis !== -1 ? (row[colNis] != null ? row[colNis] : '') : ''
    });
    imported++;
  }
  return imported;
}

async function importSiswaExcel(sessionToken, [base64Data, fileName, kelasId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  try {
    const buf = Buffer.from(base64Data, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const imported = await importSiswaRowsHelper(values, kelasId);
    return ok({ imported }, imported + ' siswa berhasil diimpor.');
  } catch (err) {
    return fail('Gagal mengimpor Excel: ' + err.message);
  }
}

async function importSiswaWord(sessionToken, [base64Data, fileName, kelasId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  try {
    const buf = Buffer.from(base64Data, 'base64');
    const result = await mammoth.convertToHtml({ buffer: buf });
    const html = result.value || '';
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
    if (!tableMatch) {
      return fail('Tidak ditemukan tabel di dokumen Word. Pastikan data siswa dibuat dalam bentuk tabel (baris pertama header).');
    }
    const rowMatches = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const values = rowMatches.map(rowHtml => {
      const cellMatches = rowHtml.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
      return cellMatches.map(cellHtml => stripHtml(cellHtml));
    });
    const imported = await importSiswaRowsHelper(values, kelasId);
    return ok({ imported }, imported + ' siswa berhasil diimpor.');
  } catch (err) {
    return fail('Gagal mengimpor Word: ' + err.message);
  }
}

async function importAsesmenExcel(sessionToken, [base64Data, fileName, asesmenId]) {
  await auth.requireRole(sessionToken, [auth.ROLE.GURU]);
  try {
    const asesmenObj = await sheets.findOne('AsesmenDiagnostik', 'ID', asesmenId);
    if (!asesmenObj) return fail('Asesmen tidak ditemukan.');

    const buf = Buffer.from(base64Data, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!values.length) return fail('File kosong.');

    const headers = values[0];
    const siswaList = await sheets.findMany('Siswa', 'KelasID', asesmenObj.KelasID);
    let imported = 0;
    for (const row of values.slice(1)) {
      const nama = row[0];
      if (!nama || !nama.toString().trim()) continue;
      const siswa = siswaList.find(s => s.Nama.toString().trim().toLowerCase() === nama.toString().trim().toLowerCase());
      if (!siswa) continue;
      const jawaban = {};
      headers.slice(1).forEach((h, i) => { jawaban[h] = row[i + 1]; });
      await sheets.addRecord('ResponAsesmen', {
        ID: randomUUID(), SiswaID: siswa.ID, AsesmenID: asesmenObj.ID,
        JawabanJSON: JSON.stringify(jawaban), Waktu: nowStr()
      });
      await asesmen.recomputeProfilSiswa(siswa.ID, asesmenObj.ID);
      imported++;
    }
    return ok({ imported }, imported + ' respon siswa berhasil diimpor.');
  } catch (err) {
    return fail('Gagal mengimpor: ' + err.message);
  }
}

module.exports = { importSiswaExcel, importSiswaWord, importAsesmenExcel };
