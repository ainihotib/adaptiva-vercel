/* ============================================================
   observasi.js — Observasi Kelas + Jurnal (ADAPTIVA)
   Kepala Sekolah/Pengawas: jadwal & lembar observasi + Jurnal A
   Guru: Jurnal mandiri tiap selesai mengajar + penilaian diri (dibuka setiap 2 jurnal)
   Admin: target 20%, jadwal, rekap pengamat vs penilaian diri
   ============================================================ */
const OB = { ins: null, role: '', tab: 'jadwal', jadwal: [], guru: [], form: null };
const OB_FILE_GURU = 'Instrumen_Observasi_Guru_ADAPTIVA.docx';
const OB_FILE_KM = 'Instrumen_Observasi_Kepala_Madrasah_ADAPTIVA.docx';

function obSec_() { return document.getElementById('section-observasi'); }
function obBadge_(s) {
  const m = { Terjadwal: 'secondary', Selesai: 'success', Draft: 'warning', Belum: 'light text-muted border', Dibatalkan: 'danger' };
  return '<span class="badge bg-' + (m[s] || 'secondary') + '">' + esc(s) + '</span>';
}

function loadObservasi() {
  OB.role = AppState.profile.Peran;
  const sec = obSec_();
  sec.innerHTML = '<div class="card"><div class="text-center py-4"><div class="spinner-border text-primary"></div></div></div>';
  const lanjut = () => {
    if (OB.role === 'Guru') return obGuruHome_();
    obStaffHome_();
  };
  if (OB.ins) return lanjut();
  gsRun('getInstrumenObservasi', [], res => {
    if (!res || !res.success) { sec.innerHTML = '<div class="card text-danger">' + esc((res && res.message) || 'Gagal memuat instrumen') + '</div>'; return; }
    OB.ins = res.data; lanjut();
  });
}

function obUnduhLembar_() {
  const btn = (f, t) => '<a class="btn btn-sm btn-adaptiva-secondary ms-1" href="' + f + '" download><i class="bi bi-download"></i> ' + t + '</a>';
  if (OB.role === 'Guru') return btn(OB_FILE_GURU, 'Unduh lembar kosong (isi manual)');
  return btn(OB_FILE_KM, 'Lembar pengamat (kosong)') + btn(OB_FILE_GURU, 'Lembar guru (kosong)');
}

/* ───────── Kepala Sekolah / Pengawas / Admin ───────── */
function obStaffHome_() {
  const admin = OB.role === 'Admin' || OB.role === 'Superadmin';
  const tabs = [['jadwal', 'Jadwal Observasi'], ['target', 'Target 20%']].concat(admin ? [['rekap', 'Rekap (Admin)']] : []);
  const nav = tabs.map(t => '<li class="nav-item"><a class="nav-link ' + (OB.tab === t[0] ? 'active' : '') + '" href="javascript:void(0)" onclick="OB.tab=\'' + t[0] + '\';obStaffHome_()">' + t[1] + '</a></li>').join('');
  obSec_().innerHTML = '<div class="card"><div class="card-header-flex"><h4 class="mb-0">Observasi Kelas &amp; Jurnal</h4>' + obUnduhLembar_() + '</div>' +
    '<ul class="nav nav-tabs mb-3">' + nav + '</ul><div id="obBody"></div></div>';
  if (OB.tab === 'target') obTarget_(); else if (OB.tab === 'rekap') obRekap_(); else obJadwal_();
}

function obJadwal_() {
  const b = document.getElementById('obBody'); b.innerHTML = '<div class="text-muted">Memuat…</div>';
  gsRun('getJadwalObservasi', [], res => {
    if (!res.success) { b.innerHTML = '<div class="text-danger">' + esc(res.message) + '</div>'; return; }
    OB.jadwal = res.data;
    const rows = OB.jadwal.map(j => '<tr><td>' + esc(j.Tanggal) + '</td><td>' + esc(j.GuruNama) + '</td><td>' + esc(j.KelasNama) + '</td><td>' + esc(j.PertemuanKe) + '</td><td>' + esc(j.ObserverNama) + '</td>' +
      '<td>' + obBadge_(j.Status) + '</td><td>' + obBadge_(j.ObservasiStatus) + '</td><td>' + obBadge_(j.DiriStatus) + '</td><td class="text-nowrap">' +
      (j.Status !== 'Dibatalkan' ? '<button class="btn btn-sm btn-adaptiva-primary" onclick="obBukaObservasi_(\'' + j.ID + '\')">' + (j.ObservasiStatus === 'Selesai' ? 'Lihat' : 'Isi') + '</button> ' : '') +
      (j.Status === 'Terjadwal' ? '<button class="btn btn-sm btn-outline-danger" onclick="obBatal_(\'' + j.ID + '\')">Batalkan</button>' : '') + '</td></tr>').join('');
    b.innerHTML = '<div class="mb-2"><button class="btn btn-adaptiva-primary btn-sm" onclick="obFormJadwal_()"><i class="bi bi-plus-lg"></i> Jadwalkan pertemuan</button></div>' +
      (rows ? '<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Tanggal</th><th>Guru</th><th>Kelas</th><th>Ke-</th><th>Pengamat</th><th>Jadwal</th><th>Observasi</th><th>Penilaian diri</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="text-muted">Belum ada jadwal.</p>');
  });
}

function obFormJadwal_() {
  gsRun('getGuruObservasi', [], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    OB.guru = res.data;
    if (!OB.guru.length) { showToast('Info', 'Belum ada guru dalam cakupan Anda.', 'warning'); return; }
    const admin = OB.role !== 'KepalaSekolah';
    const optG = OB.guru.map(g => '<option value="' + esc(g.Email) + '">' + esc(g.Nama) + ' — ' + esc(g.Sekolah) + '</option>').join('');
    openModal('Jadwalkan Pertemuan yang Diamati',
      '<div class="mb-2"><label class="form-label">Guru</label><select id="obJg" class="form-select" onchange="obIsiKelas_()">' + optG + '</select></div>' +
      '<div class="mb-2"><label class="form-label">Kelas</label><select id="obJk" class="form-select"></select></div>' +
      '<div class="row"><div class="col-6 mb-2"><label class="form-label">Tanggal</label><input type="date" id="obJt" class="form-control"></div>' +
      '<div class="col-6 mb-2"><label class="form-label">Pertemuan ke-</label><input id="obJp" class="form-control"></div></div>' +
      '<div class="mb-2"><label class="form-label">Materi</label><input id="obJm" class="form-control"></div>' +
      (admin ? '<div class="mb-2"><label class="form-label">Email Kepala Sekolah/Pengawas pengamat</label><input id="obJo" class="form-control" placeholder="email@..."></div>' : ''),
      '<button class="btn btn-adaptiva-secondary" data-bs-dismiss="modal">Batal</button><button class="btn btn-adaptiva-primary" onclick="obSimpanJadwal_()">Simpan</button>');
    obIsiKelas_();
  });
}
function obIsiKelas_() {
  const g = OB.guru.find(x => x.Email === document.getElementById('obJg').value);
  document.getElementById('obJk').innerHTML = (g ? g.Kelas : []).map(k => '<option value="' + esc(k.ID) + '">' + esc(k.NamaKelas) + ' (' + esc(k.Fase) + ')</option>').join('');
}
function obSimpanJadwal_() {
  const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const obj = { GuruEmail: v('obJg'), KelasID: v('obJk'), Tanggal: v('obJt'), PertemuanKe: v('obJp'), Materi: v('obJm'), ObserverEmail: v('obJo') };
  gsRun('simpanJadwalObservasi', [obj], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal(); showToast('Berhasil', res.message, 'success'); obJadwal_();
  });
}
function obBatal_(id) {
  if (!confirm('Batalkan jadwal ini?')) return;
  gsRun('batalkanJadwalObservasi', [id], res => { showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); obJadwal_(); });
}

function obTarget_() {
  const b = document.getElementById('obBody'); b.innerHTML = '<div class="text-muted">Memuat…</div>';
  gsRun('getGuruObservasi', [], res => {
    if (!res.success) { b.innerHTML = '<div class="text-danger">' + esc(res.message) + '</div>'; return; }
    OB.guru = res.data;
    const rows = OB.guru.map((g, i) => '<tr><td>' + esc(g.Nama) + '</td><td>' + esc(g.Sekolah) + '</td>' +
      '<td style="width:130px"><input type="number" min="0" class="form-control form-control-sm" id="obTot' + i + '" value="' + g.TotalPertemuan + '" oninput="obHitungTarget_(' + i + ')"></td>' +
      '<td id="obTg' + i + '"><b>' + g.Target + '</b></td><td>' + g.Terjadwal + '</td><td>' + g.Selesai + '</td>' +
      '<td><button class="btn btn-sm btn-adaptiva-primary" onclick="obSimpanTarget_(' + i + ')">Simpan</button></td></tr>').join('');
    b.innerHTML = '<p class="text-muted small">Isi jumlah pertemuan IPAS per semester untuk tiap guru. Target pengamatan = 20% (dibulatkan ke atas).</p>' +
      '<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Guru</th><th>Sekolah</th><th>Total pertemuan</th><th>Target diamati</th><th>Terjadwal</th><th>Selesai</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  });
}
function obHitungTarget_(i) { const n = parseInt(document.getElementById('obTot' + i).value, 10) || 0; document.getElementById('obTg' + i).innerHTML = '<b>' + (n > 0 ? Math.ceil(n * 0.2) : 0) + '</b>'; }
function obSimpanTarget_(i) {
  gsRun('simpanTargetObservasi', [OB.guru[i].Email, document.getElementById('obTot' + i).value], res => {
    showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); if (res.success) obTarget_();
  });
}

function obRekap_() {
  const b = document.getElementById('obBody'); b.innerHTML = '<div class="text-muted">Memuat…</div>';
  gsRun('getRekapObservasi', [], res => {
    if (!res.success) { b.innerHTML = '<div class="text-danger">' + esc(res.message) + '</div>'; return; }
    const d = res.data;
    const pc = x => x ? x.persenTotal + '%' : '-';
    const g = d.perGuru.map(x => '<tr><td>' + esc(x.Nama) + '</td><td>' + esc(x.Sekolah) + '</td><td>' + x.Target + '</td><td>' + x.Terjadwal + '</td><td>' + x.ObservasiSelesai + '</td><td>' + x.DiriSelesai + '</td><td>' + x.JurnalSelesai + '</td><td>' + x.DiriMandiri + '</td><td>' + pc(x.Pengamat) + '</td><td>' + pc(x.Diri) + '</td></tr>').join('');
    const dt = d.detail.map(x => '<tr><td>' + esc(x.Tanggal) + '</td><td>' + esc(x.Guru) + '</td><td>' + esc(x.Kelas) + '</td><td>' + (x.Pengamat ? x.Pengamat.persenTotal + '% / ' + x.Pengamat.rubrik : '-') + '</td><td>' + (x.Diri ? x.Diri.persenTotal + '% / ' + x.Diri.rubrik : '-') + '</td></tr>').join('');
    const dim = (() => {
      const rows = d.dimensi.map((m, i) => {
        const avg = k => { const a = d.perGuru.filter(x => x[k]).map(x => x[k].dimensi[i].persen); return a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) + '%' : '-'; };
        return '<tr><td>' + esc(m.kode) + ' — ' + esc(m.nama) + '</td><td>' + avg('Pengamat') + '</td><td>' + avg('Diri') + '</td></tr>';
      }).join('');
      return '<table class="table table-sm"><thead><tr><th>Dimensi</th><th>Pengamat (% Ya)</th><th>Penilaian diri (% Ya)</th></tr></thead><tbody>' + rows + '</tbody></table>';
    })();
    b.innerHTML = '<h6>Per guru</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Guru</th><th>Sekolah</th><th>Target</th><th>Terjadwal</th><th>Obs. selesai</th><th>Diri (banding)</th><th>Jurnal</th><th>Diri mandiri</th><th>Pengamat</th><th>Diri</th></tr></thead><tbody>' + (g || '<tr><td colspan="10">Belum ada data</td></tr>') + '</tbody></table></div>' +
      '<h6 class="mt-3">Rata-rata per dimensi</h6>' + dim +
      '<h6 class="mt-3">Per pertemuan (% Ya / rata-rata rubrik 1–4)</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Tanggal</th><th>Guru</th><th>Kelas</th><th>Pengamat</th><th>Diri</th></tr></thead><tbody>' + (dt || '<tr><td colspan="5">Belum ada data</td></tr>') + '</tbody></table></div>';
  });
}

/* ───────── Guru ───────── */
function obGuruHome_() {
  const sec = obSec_();
  gsRun('getJurnalSaya', [], res => {
    if (!res.success) { sec.innerHTML = '<div class="card text-danger">' + esc(res.message) + '</div>'; return; }
    const d = res.data; OB.gj = d;
    const rows = d.jurnal.map(j => {
      const diri = j.DiriStatus === 'Selesai' ? '<button class="btn btn-sm btn-adaptiva-secondary" onclick="obBukaDiri_(\'' + j.ID + '\')">Lihat</button>'
        : j.BolehDiri ? '<button class="btn btn-sm btn-adaptiva-primary" onclick="obBukaDiri_(\'' + j.ID + '\')">' + (j.DiriStatus === 'Draft' ? 'Lanjutkan' : 'Isi') + '</button>'
        : '<button class="btn btn-sm btn-outline-secondary" disabled style="opacity:.55" title="' + esc(j.AlasanDiri) + '"><i class="bi bi-lock"></i> Isi</button>';
      return '<tr><td>' + esc(j.Tanggal) + '</td><td>' + esc(j.KelasNama) + '</td><td>' + esc(j.PertemuanKe) + '</td><td>' + esc(j.Materi) + (j.Diobservasi ? '<div class="small text-muted"><i class="bi bi-eye"></i> Diobservasi: ' + esc(j.Diobservasi) + '</div>' : '') + '</td>' +
        '<td>' + obBadge_(j.Status) + '</td><td>' + obBadge_(j.DiriStatus) + (j.CatatanPengamat ? '<div class="small mt-1"><a href="javascript:void(0)" onclick="obBukaDiri_(\'' + j.ID + '\')">Catatan pengamat</a></div>' : '') + '</td>' +
        '<td class="text-end text-nowrap"><button class="btn btn-sm btn-adaptiva-secondary me-1" onclick="obBukaJurnal_(\'' + j.ID + '\')">' + (j.Status === 'Selesai' ? 'Ubah jurnal' : 'Lanjutkan') + '</button>' + diri + '</td></tr>';
    }).join('');
    const jd = d.jadwal.length ? '<div class="alert alert-info py-2 small"><b>Pertemuan yang dijadwalkan untuk observasi:</b><br>' +
      d.jadwal.map(j => esc(j.Tanggal) + ' · ' + esc(j.KelasNama) + (j.PertemuanKe ? ' · pertemuan ke-' + esc(j.PertemuanKe) : '') + ' · pengamat ' + esc(j.ObserverNama)).join('<br>') +
      '<br>Isi jurnal dan penilaian diri pada tanggal tersebut seperti biasa; penilaian diri untuk pertemuan ini selalu dapat dibuka.</div>' : '';
    sec.innerHTML = '<div class="card"><div class="card-header-flex"><h4 class="mb-0">Jurnal &amp; Penilaian Diri</h4><div>' +
      '<button class="btn btn-adaptiva-primary" onclick="obBukaJurnal_()"><i class="bi bi-plus-lg"></i> Isi Jurnal Baru</button>' + obUnduhLembar_() + '</div></div>' +
      '<p class="text-muted small mb-2">Isi jurnal setiap selesai melaksanakan pembelajaran (tanpa batas waktu): cukup pilih kelas dan tanggal pelaksanaan. Penilaian diri dapat diisi pada jurnal pertemuan ke-2, ke-4, dan seterusnya ; jurnal pertemuan ganjil tidak aktif (abu-abu).</p>' +
      '<div class="mb-3"><span class="badge bg-success me-2">Jurnal tersimpan: ' + d.jurnalSelesai + '</span><span class="badge bg-' + (d.diriTersedia ? 'primary' : 'secondary') + '">Penilaian diri tersedia: ' + d.diriTersedia + '</span></div>' + jd +
      (rows ? '<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Tanggal</th><th>Kelas</th><th>Ke-</th><th>Materi</th><th>Jurnal</th><th>Penilaian diri</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="text-muted">Belum ada jurnal. Klik <b>Isi Jurnal Baru</b> setelah Anda selesai mengajar.</p>') + '</div>';
  });
}

/* ───────── Jurnal mandiri guru ───────── */
function obBukaJurnal_(id) {
  const tampil = (j) => obRenderJurnal_(j);
  if (!id) return tampil({ ID: '', Tanggal: OB.gj ? OB.gj.hariIni : '', KelasID: '', PertemuanKe: '', Materi: '', CatatanPelaksanaan: '', Status: '', JurnalB: {} });
  gsRun('getJurnal', [id], res => { if (!res.success) { showToast('Gagal', res.message, 'danger'); return; } tampil(res.data); });
}
function obRenderJurnal_(j) {
  const G = OB.gj || { kelas: [], hariIni: '', pertanyaan: OB.ins.pertanyaanRefleksiGuru };
  const jb = j.JurnalB || {};
  const kelasOpt = '<option value="">— Pilih kelas —</option>' + G.kelas.map(k => '<option value="' + esc(k.ID) + '"' + (k.ID === j.KelasID ? ' selected' : '') + '>' + esc(k.NamaKelas) + (k.Fase ? ' (' + esc(k.Fase) + ')' : '') + '</option>').join('');
  const fld = (lbl, html, hint) => '<div class="ob-field"><label class="ob-lbl ob-lbl-lg">' + lbl + '</label>' + html + (hint ? '<div class="ob-hint mt-1">' + hint + '</div>' : '') + '</div>';
  let h = '<div class="card ob-form"><div class="ob-head"><div><div class="ob-eyebrow">Jurnal guru</div><h4 class="ob-title">' + (j.ID ? 'Ubah Jurnal Pembelajaran' : 'Jurnal Pembelajaran Baru') + '</h4></div>' +
    '<button class="btn btn-sm btn-adaptiva-secondary" onclick="loadObservasi()"><i class="bi bi-arrow-left"></i> Kembali</button></div>';
  if (!G.kelas.length) h += '<div class="alert alert-warning">Anda belum memiliki kelas. Tambahkan kelas terlebih dahulu di menu Kelas &amp; Siswa.</div>';
  h += '<h5 class="ob-sec">PELAKSANAAN PEMBELAJARAN</h5><div class="row g-3 mb-2">' +
    '<div class="col-md-4">' + fld('Tanggal pelaksanaan', '<input type="date" class="form-control" id="jrTgl" max="' + esc(G.hariIni) + '" value="' + esc(j.Tanggal) + '">') + '</div>' +
    '<div class="col-md-5">' + fld('Kelas', '<select class="form-select" id="jrKelas">' + kelasOpt + '</select>') + '</div>' +
    '<div class="col-md-3">' + fld('Pertemuan ke-', '<input type="number" min="1" class="form-control" id="jrKe" value="' + esc(j.PertemuanKe) + '" placeholder="otomatis">') + '</div></div>' +
    fld('Materi', '<input class="form-control" id="jrMateri" value="' + esc(j.Materi) + '" placeholder="Contoh: Siklus air">') +
    fld('Catatan selama pelaksanaan pembelajaran', '<textarea class="form-control" rows="5" id="jrCatatan" placeholder="Tuliskan apa yang terjadi selama pembelajaran">' + esc(j.CatatanPelaksanaan) + '</textarea>', 'Minimal 10 kata. Misalnya kejadian penting, kendala, respons siswa, atau perubahan dari rencana.');
  OB.jurnalDraf = { t1: jb.t1 || [], t2: jb.t2 || [] };
  h += '<div id="jrTabel"></div>';
  h += '<h5 class="ob-sec">3. PERTANYAAN REFLEKSI</h5><p class="ob-hint">Tiap jawaban minimal 10 kata.</p>' + G.pertanyaan.map((t, i) => '<div class="ob-field"><label class="ob-lbl ob-lbl-lg" for="jb_' + i + '"><span class="ob-num">' + (i + 1) + '</span>' + esc(t) + '</label><textarea class="form-control" rows="3" id="jb_' + i + '">' + esc(jb['b' + i] || '') + '</textarea></div>').join('');
  h += '<div class="ob-actions"><button class="btn btn-adaptiva-secondary" onclick="obSimpanJurnal_(\'Draft\')">Simpan draf</button><button class="btn btn-adaptiva-primary" onclick="obSimpanJurnal_(\'Selesai\')">Simpan jurnal</button></div></div>';
  OB.jurnalId = j.ID || '';
  obSec_().innerHTML = h;
  document.getElementById('jrKelas').addEventListener('change', () => obTabelJurnal_(true));
  obTabelJurnal_(false);
  window.scrollTo(0, 0);
}
// Tabel 1 & 2 hanya menampilkan kelompok yang aktif (beranggota) menurut hasil asesmen kelas terpilih.
function obBacaTabel_() {
  const g = x => document.getElementById(x), out = { t1: [], t2: [] };
  ['t1', 't2'].forEach(tid => { for (let i = 0; i < 12; i++) { if (!g(tid + '_' + i + '_0')) break; const r = {}; for (let c = 0; c < 4; c++) r['c' + c] = g(tid + '_' + i + '_' + c).value.trim(); out[tid].push(r); } });
  return out;
}
function obTabelJurnal_(ambilDariLayar) {
  const I = OB.ins, G = OB.gj || { kelas: [] }, box = document.getElementById('jrTabel');
  if (ambilDariLayar && document.getElementById('t1_0_0')) OB.jurnalDraf = obBacaTabel_();
  const kid = document.getElementById('jrKelas').value, k = G.kelas.find(x => x.ID === kid);
  if (!k) { box.innerHTML = '<div class="alert alert-info">Pilih kelas terlebih dahulu. Tabel kelompok belajar akan muncul sesuai hasil asesmen diagnostik kelas tersebut.</div>'; return; }
  const aktif = (k.Kelompok && k.Kelompok.length) ? k.Kelompok : null;
  const nama = aktif || I.jurnalKelompok;
  const ambil = (tid, n) => (OB.jurnalDraf[tid] || []).find(r => r.c0 === n) || { c0: n };
  const ta = (id, v) => '<textarea class="form-control form-control-sm" rows="3" id="' + id + '">' + esc(v) + '</textarea>';
  const kartu = (tid, hd, langkah) => nama.map((n, i) => { const r = ambil(tid, n); return '<div class="ob-kel mb-3"><div class="fw-bold mb-2">Kelompok: ' + esc(n) + '<input type="hidden" id="' + tid + '_' + i + '_0" value="' + esc(n) + '"></div><div class="row g-2">' +
    [1, 2, 3].map(c => '<div class="col-md-4"><label class="ob-lbl">' + esc(hd[c]) + '</label>' + (langkah && c === 1
      ? '<select class="form-select form-select-sm" id="' + tid + '_' + i + '_1"><option value="">— Pilih —</option>' + I.jurnalLangkah.map(l => '<option' + (r.c1 === l ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>'
      : ta(tid + '_' + i + '_' + c, r['c' + c])) + '</div>').join('') + '</div></div>'; }).join('');
  const info = aktif ? '<p class="ob-hint">Kelompok yang tampil sesuai hasil asesmen kelas ini (kelompok tanpa siswa tidak ditampilkan). Semua kelompok yang tampil wajib diisi; tiap kotak minimal 10 kata.</p>'
    : '<div class="alert alert-warning py-2">Kelas ini belum memiliki hasil pengelompokan dari asesmen diagnostik, sehingga semua kelompok ditampilkan. Isi minimal satu kelompok.</div>';
  box.innerHTML = '<h5 class="ob-sec">1. RENCANA DAN PELAKSANAAN PER KELOMPOK</h5>' + info + '<p class="ob-hint">"Alasan bila berbeda" boleh singkat atau dikosongkan jika sesuai rencana.</p>' + kartu('t1', I.jurnalTabel1, false) +
    '<h5 class="ob-sec">2. SCAFFOLDING YANG SAYA BERIKAN</h5>' + kartu('t2', I.jurnalTabel2, true);
}
function obSimpanJurnal_(status) {
  const g = x => document.getElementById(x), o = { ID: OB.jurnalId, Status: status, Tanggal: g('jrTgl').value, KelasID: g('jrKelas').value, PertemuanKe: g('jrKe').value, Materi: g('jrMateri').value.trim(), CatatanPelaksanaan: g('jrCatatan').value.trim(), JurnalB: {} };
  OB.ins.pertanyaanRefleksiGuru.forEach((t, i) => { o.JurnalB['b' + i] = g('jb_' + i).value.trim(); });
  Object.assign(o.JurnalB, document.getElementById('t1_0_0') ? obBacaTabel_() : { t1: [], t2: [] });
  if (!o.Tanggal || !o.KelasID) { showToast('Peringatan', 'Tanggal pelaksanaan dan kelas wajib diisi.', 'warning'); return; }
  gsRun('simpanJurnal', [o], res => {
    if (!res.success) {
      showToast('Belum bisa disimpan', res.message, 'danger');
      let kt = document.getElementById('jrPesan');
      if (!kt) { kt = document.createElement('div'); kt.id = 'jrPesan'; kt.className = 'alert alert-danger'; kt.setAttribute('role', 'alert'); const f = document.querySelector('.ob-form .ob-head'); f.parentNode.insertBefore(kt, f.nextSibling); }
      kt.innerHTML = '<b>Jurnal belum dapat disimpan.</b><br>' + esc(res.message).replace(/; /g, '<br>• ').replace(/^(.*?:)/, '$1<br>• ');
      window.scrollTo({ top: 0, behavior: 'smooth' }); return;
    }
    showToast('Berhasil', res.message, 'success'); loadObservasi();
  });
}

/* ───────── Formulir (bersama) ───────── */
function obBukaObservasi_(id) {
  gsRun('getObservasi', [id], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    OB.form = { mode: 'obs', jadwal: res.data.jadwal, bantu: res.data.bantu, rec: res.data.observasi, umpan: null };
    obRenderForm_();
  });
}
function obBukaDiri_(jurnalId) {
  gsRun('getPenilaianDiri', [jurnalId], res => {
    if (!res.success) { showToast('Belum dapat dibuka', res.message, 'warning'); return; }
    OB.form = { mode: 'diri', jurnalId: jurnalId, jadwal: {}, bantu: res.data.bantu, rec: res.data.penilaianDiri, umpan: res.data.umpanBalik };
    try { obRenderForm_(); } catch (e) { showToast('Formulir tidak dapat ditampilkan', (e && e.message) || String(e), 'danger'); }
  });
}


const OB_GLOSARIUM = [
  ['Modeling','Pemodelan atau pemberian contoh'],['Prompting','Pemberian petunjuk pengarah'],['Guided Practice','Latihan terbimbing'],['Independent Practice','Latihan mandiri'],
  ['Tingkat 1 (Environmental Provisions)','Penyediaan lingkungan belajar yang mendukung'],['Tingkat 2 (Explaining, Reviewing, Restructuring)','Menjelaskan, meninjau kembali, dan menyusun ulang'],['Tingkat 3 (Developing Conceptual Thinking)','Pengembangan pemahaman konsep'],
  ['Kontingensi','Penyesuaian bantuan berdasarkan respons murid'],['Fading','Pengurangan bantuan secara bertahap'],['Scaffolding Planner','Perencana bantuan belajar (fitur ADAPTIVA)'],
  ['Gaya belajar','Preferensi cara belajar yang diketahui dari profil siswa'],['Konsep prasyarat','Konsep yang harus dikuasai lebih dulu, mis. mengenal bagian tumbuhan sebelum membahas fungsinya'],
  ['Tingkat tantangan','Mis. tugas menyebutkan ciri dibandingkan menjelaskan hubungan'],['Uraian ciri','Penjelasan ciri pada setiap skor 1–4 di rubrik'],['Sebagian kelompok','Lebih dari separuh kelompok yang diamati'],['Sesekali','Satu atau dua kali pada pertemuan'],['Tiga tahap','Di awal, saat berlatih, dan setelah tugas']
];
function obPetunjuk_(obs) {
  const rows = OB_GLOSARIUM.map(g => '<tr><td>' + esc(g[0]) + '</td><td>' + esc(g[1]) + '</td></tr>').join('');
  return '<details class="ob-help"><summary>Petunjuk pengisian &amp; glosarium istilah</summary><div class="ob-help-body">' +
    '<ol><li>' + (obs ? 'Catat kejadian apa adanya, lalu bedakan kejadian yang teramati dari tafsiran Anda.' : 'Isi tanpa melihat lembar observasi pengamat, dan isi dengan jujur: lembar ini untuk melihat penerapan diferensiasi dan scaffolding, bukan menilai kinerja Anda.') + '</li>' +
    '<li>Pilih <b>Ya</b> bila perilaku benar-benar terjadi pada pertemuan ini, <b>Tidak</b> bila tidak. Setiap jawaban Ya wajib disertai bukti: apa yang dilakukan, untuk kelompok mana, pada bagian pembelajaran mana.</li>' +
    '<li>Pilih satu skor 1–4 per rubrik berdasarkan uraian ciri yang paling menggambarkan pembelajaran secara keseluruhan, lalu tulis alasan singkat. Bila ciri yang teramati berada pada dua uraian skor, pilih skor yang lebih rendah; skor yang lebih tinggi hanya bila seluruh cirinya terpenuhi. Untuk R5, hitung dahulu jumlah langkah yang terlaksana; urutan dinilai mulai skor 3. Bila tiga atau empat langkah terlaksana tetapi urutannya tidak sesuai kebutuhan kelompok, pilih skor 2.</li>' +
    '<li>Ringkasan: % Ya = jumlah Ya ÷ jumlah butir × 100%. Rata-rata rubrik = jumlah skor R1–R6 ÷ 6 bila semua rubrik terisi.</li></ol>' +
    '<table class="table table-sm ob-gl"><thead><tr><th>Istilah</th><th>Padanan / penjelasan</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
}

// Lembar penilaian diri memakai sudut pandang orang pertama ("Saya"); lembar pengamat tetap "Guru".
function obSaya_(t) {
  return String(t == null ? '' : t).replace(/\bGuru\b/g, 'Saya').replace(/\bguru\b/g, 'saya');
}
function obRenderForm_() {
  const F = OB.form, I = OB.ins, obs = F.mode === 'obs', rec = F.rec || {};
  const T = x => obs ? x : obSaya_(x);
  const ck = rec.Checklist || {}, ru = rec.Rubrik || {};
  const jr = (obs ? rec.JurnalA : rec.JurnalB) || {};
  const done = rec.Status === 'Selesai';
  const id = F.bantu.identitas;
  const dis = done ? ' disabled' : '';
  const kel = Object.keys(F.bantu.jumlahKelompok || {}).map(k => esc(k) + ' (' + F.bantu.jumlahKelompok[k] + ')').join(', ') || '-';
  const gaya = Object.keys(F.bantu.gaya || {}).map(k => esc(k) + ' (' + F.bantu.gaya[k] + ')').join(', ') || '-';
  const meta = (l, v) => '<div class="ob-meta-item"><div class="ob-meta-l">' + l + '</div><div class="ob-meta-v">' + (v === '' || v == null ? '-' : v) + '</div></div>';
  const yn = k => '<div class="ob-seg" role="radiogroup">' + ['Ya', 'Tidak'].map(v =>
    '<label class="ob-seg-opt ob-seg-' + v.toLowerCase() + '"><input type="radio" name="ck_' + k + '" value="' + v + '"' + ((ck[k] || {}).v === v ? ' checked' : '') + dis + ' onchange="obToggle_(\'' + k + '\')"><span>' + v + '</span></label>').join('') + '</div>';
  const butir = (k, t) => '<div class="ob-item" id="obi_' + k + '"><div class="ob-item-top"><span class="ob-id">' + k + '</span><div class="ob-q">' + esc(T(t)) + '</div></div>' + yn(k) +
    '<div class="ob-bukti" id="obb_' + k + '"><label class="ob-lbl" for="bk_' + k + '">Bukti singkat <span class="ob-req">wajib bila Ya</span></label>' +
    '<input class="form-control" id="bk_' + k + '" placeholder="Apa yang dilakukan, untuk kelompok mana, pada bagian pembelajaran mana" value="' + esc((ck[k] || {}).bukti || '') + '"' + dis + '></div></div>';
  const area = (lbl, idAttr, val, rows, num) => '<div class="ob-field"><label class="ob-lbl ob-lbl-lg" for="' + idAttr + '">' + (num ? '<span class="ob-num">' + num + '</span>' : '') + lbl + '</label><textarea class="form-control" rows="' + rows + '" id="' + idAttr + '"' + dis + '>' + esc(val) + '</textarea></div>';
  const sec = (t) => '<h5 class="ob-sec">' + t + '</h5>';
  let h = '<div class="card ob-form"><div class="ob-head"><div><div class="ob-eyebrow">' + (obs ? 'Lembar pengamat' : 'Lembar guru') + '</div><h4 class="ob-title">' + (obs ? 'Lembar Observasi &amp; Jurnal A' : 'Penilaian Diri') + '</h4></div>' +
    '<button class="btn btn-sm btn-adaptiva-secondary" onclick="loadObservasi()"><i class="bi bi-arrow-left"></i> Kembali</button></div>';
  h += '<div class="ob-meta">' + meta('Sekolah', esc(id.sekolah)) + meta('Guru', esc(id.guru)) + meta('Kelas / Fase', esc(id.kelasFase)) + meta('Tanggal', esc(id.tanggal)) + meta('Pertemuan ke-', esc(id.pertemuanKe)) + meta('Pengamat', esc(id.observer)) +
    meta('Materi', esc(id.materi)) + meta('Siswa terdaftar', esc(id.jumlahSiswaTerdaftar != null ? id.jumlahSiswaTerdaftar : F.bantu.jumlahSiswaTerdaftar)) + meta('Kelompok', kel) + meta('Gaya belajar', gaya) + '</div>';
  h += obPetunjuk_(obs);
  h += '<div class="ob-progress" id="obProg"><div class="ob-progress-txt" id="obProgTxt"></div><div class="ob-progress-bar"><div id="obProgBar"></div></div></div>';
  if (done) h += '<div class="alert alert-success py-2">Sudah diselesaikan — hanya dapat dilihat.</div>';
  let last = '';
  I.checklist.forEach(c => { if (c.dim !== last) { h += sec(esc(c.dim)); last = c.dim; } h += butir(c.id, c.teks); });
  h += sec('KESESUAIAN DENGAN MODUL AJAR') + I.kesesuaian.map(m => butir(m.id, m.teks)).join('');
  h += sec('RUBRIK PENILAIAN <small>pilih satu skor 1–4 pada setiap rubrik</small>') + I.rubrik.map(r => {
    const sk = (ru[r.id] || {}).skor;
    return '<div class="ob-item ob-rub"><div class="ob-item-top"><span class="ob-id">' + r.id + '</span><div class="ob-q"><b>' + esc(T(r.judul)) + '</b></div></div><div class="ob-opts">' +
      [1, 2, 3, 4].map(n => '<label class="ob-opt"><input type="radio" class="ob-radio" name="ru_' + r.id + '" value="' + n + '"' + (String(sk) === String(n) ? ' checked' : '') + dis + ' onchange="obProgress_()"><span class="ob-box"></span><span class="ob-score">' + n + '</span><span class="ob-desc">' + esc(T(r.deskriptor[n])) + '</span></label>').join('') + '</div>' +
      '<div class="ob-bukti" style="display:block"><label class="ob-lbl" for="ra_' + r.id + '">Alasan singkat</label><input class="form-control" id="ra_' + r.id + '" placeholder="Mengapa skor ini dipilih" value="' + esc((ru[r.id] || {}).alasan || '') + '"' + dis + '></div></div>';
  }).join('');
  if (obs) {
    const pb = (rec.Perbandingan && rec.Perbandingan.length) ? rec.Perbandingan : (F.bantu.perbandingan || []);
    h += sec('PERBANDINGAN RENCANA &amp; PELAKSANAAN') + '<div class="table-responsive ob-table"><table class="table"><thead><tr><th>Kelompok</th><th>Rencana (ADAPTIVA)</th><th>Langkah rencana</th><th style="min-width:220px">Yang terlaksana</th></tr></thead><tbody>' +
      pb.map((p, i) => '<tr><td><b>' + esc(p.kelompok) + '</b></td><td>' + esc(p.rencana) + '</td><td>' + esc(p.langkah) + '</td><td><textarea class="form-control" id="pb_' + i + '" rows="3"' + dis + '>' + esc(p.terlaksana || '') + '</textarea></td></tr>').join('') + '</tbody></table></div>';
    OB.form.pb = pb;
    h += sec('JURNAL A — CATATAN PENGAMAT') + I.catatanObserverJurnal.map((t, i) => area(esc(t), 'ja_' + i, jr['c' + i] || '', 3, i + 1)).join('');
    h += area('<b>Catatan umum</b> <span class="ob-hint">dapat dibaca guru setelah penilaian dirinya selesai</span>', 'obCU', rec.CatatanUmum || '', 4, '');
  } else {
    if (F.umpan) h += '<div class="alert alert-info mt-3"><b>Catatan pengamat (' + esc(F.umpan.observer) + ')</b><br>' + esc(F.umpan.catatanUmum || '-') + '<br><br><b>Refleksi pengamat:</b> ' + esc(F.umpan.refleksi || '-') + '</div>';
    else if (F.bantu.identitas.observer && F.bantu.identitas.observer !== '-') h += '<p class="small text-muted mt-3">Pertemuan ini diobservasi. Catatan pengamat akan tampil di sini setelah Anda menyelesaikan penilaian diri dan pengamat menyelesaikan lembarnya.</p>';
  }
  if (!done) h += '<div class="ob-actions"><button class="btn btn-adaptiva-secondary" onclick="obSimpanForm_(\'Draft\')">Simpan draf</button><button class="btn btn-adaptiva-primary" onclick="obSimpanForm_(\'Selesai\')">Selesaikan</button></div>';
  obSec_().innerHTML = h + '</div>';
  I.checklist.concat(I.kesesuaian).forEach(c => obToggle_(c.id));
  obSec_().querySelectorAll('input[type=text], textarea').forEach(el => el.addEventListener('input', obProgress_));
  obProgress_();
  window.scrollTo(0, 0);
}
// Kolom bukti hanya tampil bila jawaban Ya (mengurangi kepadatan), dan penghitung kelengkapan diperbarui.
function obToggle_(k) {
  const r = document.querySelector('input[name="ck_' + k + '"]:checked'), b = document.getElementById('obb_' + k);
  if (b) b.style.display = (r && r.value === 'Ya') ? 'block' : 'none';
  obProgress_();
}
function obProgress_() {
  const I = OB.ins; if (!I || !document.getElementById('obProgTxt')) return;
  const ids = I.checklist.concat(I.kesesuaian).map(c => c.id);
  const n1 = ids.filter(k => document.querySelector('input[name="ck_' + k + '"]:checked')).length;
  const n2 = I.rubrik.filter(r => document.querySelector('input[name="ru_' + r.id + '"]:checked')).length;
  const tot = ids.length + I.rubrik.length, isi = n1 + n2;
  document.getElementById('obProgTxt').textContent = 'Terisi ' + isi + ' dari ' + tot + ' butir dan rubrik';
  document.getElementById('obProgBar').style.width = Math.round(isi / tot * 100) + '%';
}

function obKumpul_() {
  const I = OB.ins, obs = OB.form.mode === 'obs';
  const checklist = {}, rubrik = {};
  I.checklist.map(c => c.id).concat(I.kesesuaian.map(m => m.id)).forEach(k => {
    const r = document.querySelector('input[name="ck_' + k + '"]:checked');
    checklist[k] = { v: r ? r.value : '', bukti: document.getElementById('bk_' + k).value.trim() };
  });
  I.rubrik.forEach(r => {
    const s = document.querySelector('input[name="ru_' + r.id + '"]:checked');
    rubrik[r.id] = { skor: s ? Number(s.value) : 0, alasan: document.getElementById('ra_' + r.id).value.trim() };
  });
  const o = obs ? { JadwalID: OB.form.jadwal.ID, Checklist: checklist, Rubrik: rubrik } : { JurnalID: OB.form.jurnalId, Checklist: checklist, Rubrik: rubrik };
  if (obs) {
    o.Perbandingan = (OB.form.pb || []).map((p, i) => Object.assign({}, p, { terlaksana: document.getElementById('pb_' + i).value.trim() }));
    o.JurnalA = {}; I.catatanObserverJurnal.forEach((t, i) => { o.JurnalA['c' + i] = document.getElementById('ja_' + i).value.trim(); });
    o.CatatanUmum = document.getElementById('obCU').value.trim();
  }
  return o;
}
function obSimpanForm_(status) {
  const o = obKumpul_(); o.Status = status;
  if (status === 'Selesai' && !confirm('Selesaikan dan kunci lembar ini? Setelah selesai tidak dapat diubah.')) return;
  gsRun(OB.form.mode === 'obs' ? 'simpanObservasi' : 'simpanPenilaianDiri', [o], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    showToast('Berhasil', res.message, 'success');
    if (status === 'Selesai') loadObservasi();
    else if (OB.form.mode === 'obs') obBukaObservasi_(OB.form.jadwal.ID); else obBukaDiri_(OB.form.jurnalId);
  });
}
