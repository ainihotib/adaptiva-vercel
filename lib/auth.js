// ============================================================
// lib/auth.js — Login Google OAuth 2.0 (mengganti email+password).
//
// Alur:
//  1. Di frontend, guru klik tombol "Login dengan Google" (Google Identity
//     Services) → browser memberi sebuah ID Token (bukan password).
//  2. Frontend kirim ID Token itu ke backend lewat loginWithGoogle(idToken).
//  3. Backend verifikasi ID Token ke server Google (memastikan token asli,
//     bukan rekayasa), ambil emailnya, lalu cocokkan dengan sheet Users —
//     HANYA email yang sudah didaftarkan Admin yang bisa masuk (perilaku
//     "didaftarkan Admin" dari versi lama tetap dipertahankan, cuma
//     passwordnya diganti jadi "harus login pakai akun Google yang sama").
//  4. Backend menerbitkan sessionToken (JWT bertanda tangan) yang dipakai
//     frontend untuk request-request berikutnya — fungsinya sama persis
//     seperti sessionToken di versi GAS lama.
//
// Env var WAJIB:
//   GOOGLE_OAUTH_CLIENT_ID — Client ID OAuth 2.0 (dari Google Cloud Console)
//   SESSION_SECRET         — string rahasia bebas untuk menandatangani sessionToken
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { findOne, updateRecord } = require('./sheets');

const ROLE = { SUPERADMIN: 'Superadmin', ADMIN: 'Admin', GURU: 'Guru', KEPSEK: 'KepalaSekolah' };

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID belum diatur di Environment Variables Vercel.');
  return new OAuth2Client(clientId);
}

function getSessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET belum diatur di Environment Variables Vercel.');
  return s;
}

// Memverifikasi ID Token Google asli (ditandatangani Google, belum kedaluwarsa,
// dan memang ditujukan untuk aplikasi ini) — bukan sekadar membaca isinya mentah-mentah.
async function verifyGoogleIdToken(idToken) {
  const client = getOAuthClient();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_OAUTH_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email_verified) {
    throw new Error('Akun Google tidak terverifikasi.');
  }
  return { email: payload.email, nama: payload.name || payload.email };
}

function createSessionToken(email) {
  return jwt.sign({ email }, getSessionSecret(), { expiresIn: '12h' });
}

function resolveSessionEmail(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getSessionSecret());
    return decoded.email;
  } catch (e) {
    return null;
  }
}

// loginWithGoogle(idToken) — dipanggil dari frontend setelah Google Identity
// Services memberi ID Token. Menggantikan loginUser(email, password) lama.
async function loginWithGoogle(idToken) {
  const { email, nama } = await verifyGoogleIdToken(idToken);
  const user = await findOne('Users', 'Email', email);
  if (!user) {
    return { success: false, data: null, message: 'Akun Google (' + email + ') belum terdaftar di ADAPTIVA. Minta Admin mendaftarkan email ini terlebih dahulu.' };
  }
  if (user.Status && user.Status !== 'Aktif') {
    return { success: false, data: null, message: 'Akun Anda berstatus "' + user.Status + '". Hubungi Admin.' };
  }
  const sessionToken = createSessionToken(email);
  const profile = Object.assign({}, user);
  profile.PeranAsli = profile.Peran;
  if (profile.Peran === ROLE.SUPERADMIN && profile.PeranPreview) profile.Peran = profile.PeranPreview;
  return {
    success: true,
    data: { sessionToken, user: profile },
    message: 'Login berhasil.'
  };
}

async function getCurrentUserEmailOrThrow(sessionToken) {
  const email = resolveSessionEmail(sessionToken);
  if (!email) throw new Error('Sesi tidak valid atau sudah berakhir. Silakan login kembali.');
  return email;
}

// Profil efektif: untuk Superadmin yang sedang memakai mode "Ganti Tampilan
// Role" (PeranPreview terisi), Peran yang dipakai utk render & cek akses
// mengikuti PeranPreview, sementara PeranAsli tetap menyimpan Superadmin
// (perilaku sama persis dengan getCurrentUserProfile() versi GAS lama).
async function getCurrentUserProfile(sessionToken) {
  const email = await getCurrentUserEmailOrThrow(sessionToken);
  const user = await findOne('Users', 'Email', email);
  if (!user) return { success: false, data: { email }, message: 'Akun ' + email + ' belum terdaftar di ADAPTIVA. Hubungi Admin untuk didaftarkan.' };
  if (user.Status && user.Status !== 'Aktif') return { success: false, data: { email }, message: 'Akun Anda belum/tidak aktif. Hubungi Admin.' };
  const profile = Object.assign({}, user);
  profile.PeranAsli = profile.Peran;
  if (profile.Peran === ROLE.SUPERADMIN && profile.PeranPreview) profile.Peran = profile.PeranPreview;
  return { success: true, data: profile, message: 'OK' };
}

async function setPeranPreview(sessionToken, roleBaru) {
  const email = await getCurrentUserEmailOrThrow(sessionToken);
  const user = await findOne('Users', 'Email', email);
  if (!user) throw new Error('Akun tidak ditemukan.');
  if (user.Peran !== ROLE.SUPERADMIN) throw new Error('Hanya akun Superadmin asli yang dapat memakai mode Ganti Tampilan Role.');
  const valid = ['', ROLE.SUPERADMIN, ROLE.ADMIN, ROLE.GURU, ROLE.KEPSEK];
  if (valid.indexOf(roleBaru || '') === -1) throw new Error('Role tidak dikenali.');
  await updateRecord('Users', Object.assign({}, user, { PeranPreview: roleBaru || '' }));
  return { peranAktif: roleBaru || ROLE.SUPERADMIN };
}

async function requireRole(sessionToken, allowedRoles) {
  const res = await getCurrentUserProfile(sessionToken);
  if (!res.success) throw new Error(res.message);
  if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(res.data.Peran) === -1) {
    throw new Error('Anda tidak memiliki akses ke fitur ini.');
  }
  return res.data;
}

module.exports = {
  ROLE, loginWithGoogle, resolveSessionEmail, getCurrentUserEmailOrThrow,
  getCurrentUserProfile, setPeranPreview, requireRole
};
