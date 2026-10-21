// ============================================================
// lib/sheets.js — Jembatan ke Google Sheets dari Vercel.
//
// Data ADAPTIVA TETAP di Google Spreadsheet yang sama seperti sekarang
// (tidak ada migrasi data). Yang berubah hanya CARA mengaksesnya:
// dulu lewat SpreadsheetApp (bawaan Apps Script), sekarang lewat
// Google Sheets API v4 pakai sebuah Service Account.
//
// Env var yang WAJIB diisi di pengaturan Vercel (lihat panduan setup):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — email service account
//   GOOGLE_SERVICE_ACCOUNT_KEY     — private key service account (format PEM)
//   ADAPTIVA_SPREADSHEET_ID        — ID spreadsheet DB_ADAPTIVA (dari URL-nya)
// ============================================================

const { google } = require('googleapis');

let _sheetsClient = null;

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !rawKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY belum diatur di Environment Variables Vercel.');
  }
  // Private key yang ditempel di Vercel biasanya baris barunya jadi "\n" literal — dikembalikan jadi baris baru asli.
  const key = rawKey.replace(/\\n/g, '\n');
  return new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
}

function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const auth = getAuthClient();
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

function getSpreadsheetId() {
  const id = process.env.ADAPTIVA_SPREADSHEET_ID;
  if (!id) throw new Error('ADAPTIVA_SPREADSHEET_ID belum diatur di Environment Variables Vercel.');
  return id;
}

// Definisi sheet & header — SAMA PERSIS dengan SHEET_DEFS di Kode.gs lama,
// supaya kompatibel dengan data yang sudah ada.
const SHEET_DEFS = {
  Users: ['ID', 'Email', 'Nama', 'Peran', 'Sekolah', 'Status', 'PeranPreview', 'Sapaan'],
  Kelas: ['ID', 'GuruEmail', 'NamaKelas', 'Fase', 'TahunAjaran'],
  Siswa: ['ID', 'KelasID', 'Nama', 'JenisKelamin', 'NoAbsen', 'NIS'],
  AsesmenDiagnostik: ['ID', 'KelasID', 'Judul', 'StatusAktif', 'Tanggal', 'Token'],
  SoalAsesmen: ['ID', 'AsesmenID', 'JenisInstrumen', 'Bagian', 'Dimensi', 'ButirSoal', 'OpsiJSON', 'KunciJawaban'],
  BankSoalAsesmen: ['ID', 'JenisInstrumen', 'Bagian', 'Dimensi', 'ButirSoal', 'OpsiJSON', 'KunciJawaban', 'Materi'],
  ResponAsesmen: ['ID', 'SiswaID', 'AsesmenID', 'JawabanJSON', 'Waktu'],
  ProfilSiswa: ['SiswaID', 'SkorKesiapan', 'KategoriKesiapan', 'BagianGap', 'SkorMinatTotal', 'KategoriMinat',
                'SubdimensiMinatJSON', 'GayaDominan', 'GayaPendukung', 'SubdimensiGayaJSON', 'Diperbarui'],
  KelompokBelajar: ['ID', 'KelasID', 'AsesmenID', 'NamaKelompok', 'AnggotaJSON', 'Karakteristik', 'StrategiUmum',
                    'OpsiDiferensiasiJSON', 'RekomendasiJSON'],
  CP_TP: ['ID', 'KelasID', 'Fase', 'TeksCP', 'TPJson'],
  Diferensiasi: ['ID', 'KelompokID', 'TPID', 'Konten', 'Proses', 'Produk'],
  ScaffoldingPlan: ['ID', 'KelompokID', 'TPID', 'Level1', 'Level2', 'Level3', 'Level4'],
  ModulAjar: ['ID', 'GuruEmail', 'KelasID', 'Mapel', 'Materi', 'JenisTemplate', 'TPIdsJson',
              'KontenJson', 'Status', 'FileDocUrl', 'FilePdfUrl', 'ValidatorEmail', 'CatatanValidasi', 'Tanggal'],
  LogValidasi: ['ID', 'ModulID', 'ValidatorEmail', 'Status', 'Catatan', 'Tanggal'],
  BankCPTP_IPAS: ['ID', 'Fase', 'TeksCP', 'TPJson'],
  BankStrategiDiferensiasi: ['ID', 'Dimensi', 'TingkatKesiapan', 'Deskripsi'],
  AppConfig: ['Key', 'Value']
};

// Cache ringan per-invocation (satu request Vercel) supaya sheet yang sama
// tidak dibaca berkali-kali dalam satu permintaan.
let _rowsCache = {};

function clearCache() { _rowsCache = {}; }

async function readSheetRaw(sheetName) {
  if (_rowsCache[sheetName]) return _rowsCache[sheetName];
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: sheetName
  });
  const rows = res.data.values || [];
  _rowsCache[sheetName] = rows;
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== ''));
}

async function getAllData(sheetName) {
  const rows = await readSheetRaw(sheetName);
  return rowsToObjects(rows);
}

async function findOne(sheetName, field, value) {
  const all = await getAllData(sheetName);
  return all.find(o => String(o[field]) === String(value)) || null;
}

async function findMany(sheetName, field, value) {
  const all = await getAllData(sheetName);
  return all.filter(o => String(o[field]) === String(value));
}

async function addRecord(sheetName, recordObj) {
  const headers = SHEET_DEFS[sheetName];
  if (!headers) throw new Error('Sheet tidak dikenal: ' + sheetName);
  const sheets = getSheetsClient();
  const row = headers.map(h => (recordObj[h] !== undefined ? recordObj[h] : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
  clearCache();
  return recordObj;
}

// Seperti addRecord, tapi menulis BANYAK baris sekaligus dalam SATU panggilan
// API (bukan satu-per-satu dalam loop) — lebih cepat dan tidak berisiko
// "terpotong di tengah jalan" kalau jumlah barisnya banyak (mis. import soal
// dari Bank Soal puluhan butir sekaligus).
async function addRecords(sheetName, recordObjs) {
  if (!recordObjs.length) return [];
  const headers = SHEET_DEFS[sheetName];
  if (!headers) throw new Error('Sheet tidak dikenal: ' + sheetName);
  const sheets = getSheetsClient();
  const rows = recordObjs.map(recordObj => headers.map(h => (recordObj[h] !== undefined ? recordObj[h] : '')));
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
  clearCache();
  return recordObjs;
}

async function _findRowIndexByField(sheetName, field, value) {
  const rows = await readSheetRaw(sheetName);
  const headers = rows[0] || SHEET_DEFS[sheetName];
  const col = headers.indexOf(field);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][col]) === String(value)) return { rowNumber: i + 1, headers };
  }
  return null;
}

async function updateRecord(sheetName, recordObj) {
  const found = await _findRowIndexByField(sheetName, 'ID', recordObj.ID);
  if (!found) throw new Error('Data dengan ID ' + recordObj.ID + ' tidak ditemukan di ' + sheetName + '.');
  const headers = SHEET_DEFS[sheetName] || found.headers;
  const sheets = getSheetsClient();
  const row = headers.map(h => (recordObj[h] !== undefined ? recordObj[h] : ''));
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A${found.rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
  clearCache();
  return recordObj;
}

// Untuk sheet yang kunci barisnya BUKAN kolom 'ID' (mis. ProfilSiswa pakai 'SiswaID') —
// update baris yang cocok bila sudah ada, atau tambah baris baru bila belum ada.
async function upsertByField(sheetName, keyField, recordObj) {
  const found = await _findRowIndexByField(sheetName, keyField, recordObj[keyField]);
  const headers = SHEET_DEFS[sheetName];
  const sheets = getSheetsClient();
  const row = headers.map(h => (recordObj[h] !== undefined ? recordObj[h] : ''));
  if (found) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${sheetName}!A${found.rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: sheetName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
  }
  clearCache();
  return recordObj;
}

async function deleteRecord(sheetName, id) {
  const found = await _findRowIndexByField(sheetName, 'ID', id);
  if (!found) return false;
  const sheets = getSheetsClient();
  // Butuh sheetId numerik (bukan nama) untuk batchUpdate deleteDimension.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheetMeta) throw new Error('Sheet tidak ditemukan: ' + sheetName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheetMeta.properties.sheetId,
            dimension: 'ROWS',
            startIndex: found.rowNumber - 1,
            endIndex: found.rowNumber
          }
        }
      }]
    }
  });
  clearCache();
  return true;
}

async function getConfig(key) {
  const row = await findOne('AppConfig', 'Key', key);
  return row ? row.Value : null;
}

async function setConfig(key, value) {
  const existing = await findOne('AppConfig', 'Key', key);
  if (existing) return updateRecord('AppConfig', { Key: key, Value: value });
  return addRecord('AppConfig', { Key: key, Value: value });
}

// Hapus banyak baris sekaligus berdasarkan satu field (mis. semua SoalAsesmen
// milik satu AsesmenID) — menulis ulang sheet dalam satu kali operasi, setara
// dengan hapusSemuaSoalAsesmen() versi GAS lama.
async function deleteManyByField(sheetName, field, value) {
  const sheets = getSheetsClient();
  const rows = await readSheetRaw(sheetName);
  if (!rows.length) return 0;
  const headers = rows[0];
  const col = headers.indexOf(field);
  const sisa = rows.slice(1).filter(r => String(r[col]) !== String(value));
  const dihapus = (rows.length - 1) - sisa.length;
  if (dihapus === 0) return 0;
  await sheets.spreadsheets.values.clear({ spreadsheetId: getSpreadsheetId(), range: sheetName });
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers, ...sisa] }
  });
  clearCache();
  return dihapus;
}

module.exports = {
  SHEET_DEFS, clearCache, getAllData, findOne, findMany,
  addRecord, addRecords, updateRecord, upsertByField, deleteRecord, deleteManyByField,
  getConfig, setConfig
};
