/* ============================================================
   observasi.js — Observasi Kelas + Jurnal (ADAPTIVA)
   Kepala Sekolah/Pengawas: jadwal & lembar observasi + Jurnal A
   Guru: penilaian diri + Jurnal B (hanya pertemuan terjadwal)
   Admin: target 20%, jadwal, rekap pengamat vs penilaian diri
   ============================================================ */
const OB = { ins: null, role: '', tab: 'jadwal', jadwal: [], guru: [], form: null };
const OB_FILE = 'Lembar_Observasi_dan_Jurnal_Kelas_ADAPTIVA.docx';

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
  return '<a class="btn btn-sm btn-adaptiva-secondary" href="' + OB_FILE + '" download><i class="bi bi-download"></i> Unduh lembar kosong (isi manual)</a>';
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
    const g = d.perGuru.map(x => '<tr><td>' + esc(x.Nama) + '</td><td>' + esc(x.Sekolah) + '</td><td>' + x.Target + '</td><td>' + x.Terjadwal + '</td><td>' + x.ObservasiSelesai + '</td><td>' + x.DiriSelesai + '</td><td>' + pc(x.Pengamat) + '</td><td>' + pc(x.Diri) + '</td></tr>').join('');
    const dt = d.detail.map(x => '<tr><td>' + esc(x.Tanggal) + '</td><td>' + esc(x.Guru) + '</td><td>' + esc(x.Kelas) + '</td><td>' + (x.Pengamat ? x.Pengamat.persenTotal + '% / ' + x.Pengamat.rubrik : '-') + '</td><td>' + (x.Diri ? x.Diri.persenTotal + '% / ' + x.Diri.rubrik : '-') + '</td></tr>').join('');
    const dim = (() => {
      const rows = d.dimensi.map((m, i) => {
        const avg = k => { const a = d.perGuru.filter(x => x[k]).map(x => x[k].dimensi[i].persen); return a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) + '%' : '-'; };
        return '<tr><td>' + esc(m.kode) + ' — ' + esc(m.nama) + '</td><td>' + avg('Pengamat') + '</td><td>' + avg('Diri') + '</td></tr>';
      }).join('');
      return '<table class="table table-sm"><thead><tr><th>Dimensi</th><th>Pengamat (% Ya)</th><th>Penilaian diri (% Ya)</th></tr></thead><tbody>' + rows + '</tbody></table>';
    })();
    b.innerHTML = '<h6>Per guru</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Guru</th><th>Sekolah</th><th>Target</th><th>Terjadwal</th><th>Obs. selesai</th><th>Diri selesai</th><th>Pengamat</th><th>Diri</th></tr></thead><tbody>' + (g || '<tr><td colspan="8">Belum ada data</td></tr>') + '</tbody></table></div>' +
      '<h6 class="mt-3">Rata-rata per dimensi</h6>' + dim +
      '<h6 class="mt-3">Per pertemuan (% Ya / rata-rata rubrik 1–4)</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Tanggal</th><th>Guru</th><th>Kelas</th><th>Pengamat</th><th>Diri</th></tr></thead><tbody>' + (dt || '<tr><td colspan="5">Belum ada data</td></tr>') + '</tbody></table></div>';
  });
}

/* ───────── Guru ───────── */
function obGuruHome_() {
  const sec = obSec_();
  gsRun('getJadwalObservasi', [], res => {
    if (!res.success) { sec.innerHTML = '<div class="card text-danger">' + esc(res.message) + '</div>'; return; }
    const list = res.data.filter(j => j.Status !== 'Dibatalkan');
    const rows = list.map(j => '<tr><td>' + esc(j.Tanggal) + '</td><td>' + esc(j.KelasNama) + '</td><td>' + esc(j.PertemuanKe) + '</td><td>' + esc(j.Materi) + '</td><td>' + esc(j.ObserverNama) + '</td><td>' + obBadge_(j.DiriStatus) + '</td>' +
      '<td><button class="btn btn-sm btn-adaptiva-primary" onclick="obBukaDiri_(\'' + j.ID + '\')">' + (j.DiriStatus === 'Selesai' ? 'Lihat' : 'Isi') + '</button></td></tr>').join('');
    sec.innerHTML = '<div class="card"><div class="card-header-flex"><h4 class="mb-0">Penilaian Diri &amp; Jurnal</h4>' + obUnduhLembar_() + '</div>' +
      '<p class="text-muted small">Isi hanya untuk pertemuan yang dijadwalkan Kepala Sekolah/Pengawas. Catatan pengamat dapat Anda baca setelah penilaian diri Anda diselesaikan.</p>' +
      (rows ? '<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Tanggal</th><th>Kelas</th><th>Ke-</th><th>Materi</th><th>Pengamat</th><th>Penilaian diri</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="text-muted">Belum ada pertemuan terjadwal.</p>') + '</div>';
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
function obBukaDiri_(id) {
  gsRun('getPenilaianDiri', [id], res => {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    OB.form = { mode: 'diri', jadwal: res.data.jadwal, bantu: res.data.bantu, rec: res.data.penilaianDiri, umpan: res.data.umpanBalik };
    obRenderForm_();
  });
}

function obRenderForm_() {
  const F = OB.form, I = OB.ins, obs = F.mode === 'obs', rec = F.rec || {};
  const ck = rec.Checklist || {}, ru = rec.Rubrik || {};
  const jr = (obs ? rec.JurnalA : rec.JurnalB) || {};
  const done = rec.Status === 'Selesai';
  const id = F.bantu.identitas;
  const dis = done ? ' disabled' : '';
  const yn = k => ['Ya', 'Tidak'].map(v => '<label class="me-3"><input type="radio" name="ck_' + k + '" value="' + v + '"' + ((ck[k] || {}).v === v ? ' checked' : '') + dis + '> ' + v + '</label>').join('');
  const butir = (k, t) => '<div class="border rounded p-2 mb-2"><div class="small mb-1"><b>' + k + '</b> ' + esc(t) + '</div><div>' + yn(k) +
    '</div><input class="form-control form-control-sm mt-1" id="bk_' + k + '" placeholder="' + (obs ? 'Bukti singkat (wajib bila Ya)' : 'Bukti/alasan (opsional)') + '" value="' + esc((ck[k] || {}).bukti || '') + '"' + dis + '></div>';
  let h = '<div class="card"><div class="card-header-flex"><h4 class="mb-0">' + (obs ? 'Lembar Observasi &amp; Jurnal A' : 'Penilaian Diri &amp; Jurnal B') + '</h4>' +
    '<button class="btn btn-sm btn-adaptiva-secondary" onclick="loadObservasi()"><i class="bi bi-arrow-left"></i> Kembali</button></div>';
  h += '<div class="small mb-3"><b>Sekolah:</b> ' + esc(id.sekolah) + ' · <b>Guru:</b> ' + esc(id.guru) + ' · <b>Kelas/Fase:</b> ' + esc(id.kelasFase) + ' · <b>Tanggal:</b> ' + esc(id.tanggal) + ' · <b>Pertemuan ke-:</b> ' + esc(id.pertemuanKe) + ' · <b>Pengamat:</b> ' + esc(id.observer) + '<br><b>Materi:</b> ' + esc(id.materi) +
    '<br><b>Siswa terdaftar:</b> ' + id.jumlahSiswaTerdaftar + ' · <b>Kelompok:</b> ' + (Object.keys(F.bantu.jumlahKelompok).map(k => esc(k) + ' (' + F.bantu.jumlahKelompok[k] + ')').join(', ') || '-') +
    ' · <b>Gaya belajar:</b> ' + (Object.keys(F.bantu.gaya).map(k => esc(k) + ' (' + F.bantu.gaya[k] + ')').join(', ') || '-') + '</div>';
  if (done) h += '<div class="alert alert-success py-2">Sudah diselesaikan — hanya dapat dilihat.</div>';
  let last = '';
  I.checklist.forEach(c => { if (c.dim !== last) { h += '<h6 class="mt-3">' + esc(c.dim) + '</h6>'; last = c.dim; } h += butir(c.id, c.teks); });
  h += '<h6 class="mt-3">KESESUAIAN DENGAN MODUL AJAR</h6>' + I.kesesuaian.map(m => butir(m.id, m.teks)).join('');
  h += '<h6 class="mt-3">RUBRIK (skor 1–4)</h6>' + I.rubrik.map(r => {
    const s = (ru[r.id] || {}).skor;
    return '<div class="border rounded p-2 mb-2"><div class="small"><b>' + r.id + '</b> ' + esc(r.judul) + '</div>' +
      [1, 2, 3, 4].map(n => '<div class="small"><label><input type="radio" name="ru_' + r.id + '" value="' + n + '"' + (String(s) === String(n) ? ' checked' : '') + dis + '> <b>' + n + '</b> — ' + esc(r.deskriptor[n]) + '</label></div>').join('') +
      '<input class="form-control form-control-sm mt-1" id="ra_' + r.id + '" placeholder="Alasan singkat" value="' + esc((ru[r.id] || {}).alasan || '') + '"' + dis + '></div>';
  }).join('');
  if (obs) {
    const pb = (rec.Perbandingan && rec.Perbandingan.length) ? rec.Perbandingan : (F.bantu.perbandingan || []);
    h += '<h6 class="mt-3">PERBANDINGAN RENCANA &amp; PELAKSANAAN</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Kelompok</th><th>Rencana (ADAPTIVA)</th><th>Langkah rencana</th><th>Yang terlaksana</th></tr></thead><tbody>' +
      pb.map((p, i) => '<tr><td>' + esc(p.kelompok) + '</td><td class="small">' + esc(p.rencana) + '</td><td>' + esc(p.langkah) + '</td><td><textarea class="form-control form-control-sm" id="pb_' + i + '" rows="2"' + dis + '>' + esc(p.terlaksana || '') + '</textarea></td></tr>').join('') + '</tbody></table></div>';
    OB.form.pb = pb;
    h += '<h6 class="mt-3">JURNAL A — CATATAN PENGAMAT</h6>' + I.catatanObserverJurnal.map((t, i) => '<div class="mb-2"><label class="form-label small">' + esc(t) + '</label><textarea class="form-control" rows="2" id="ja_' + i + '"' + dis + '>' + esc(jr['c' + i] || '') + '</textarea></div>').join('');
    h += '<div class="mb-2"><label class="form-label small"><b>Catatan umum</b> (dapat dibaca guru setelah penilaian dirinya selesai)</label><textarea class="form-control" rows="3" id="obCU"' + dis + '>' + esc(rec.CatatanUmum || '') + '</textarea></div>';
  } else {
    h += '<h6 class="mt-3">JURNAL B — REFLEKSI GURU</h6>' + I.pertanyaanRefleksiGuru.map((t, i) => '<div class="mb-2"><label class="form-label small">' + (i + 1) + '. ' + esc(t) + '</label><textarea class="form-control" rows="2" id="jb_' + i + '"' + dis + '>' + esc(jr['b' + i] || '') + '</textarea></div>').join('');
    if (F.umpan) h += '<div class="alert alert-info mt-3"><b>Catatan pengamat (' + esc(F.umpan.observer) + ')</b><br>' + esc(F.umpan.catatanUmum || '-') + '<br><br><b>Refleksi pengamat:</b> ' + esc(F.umpan.refleksi || '-') + '</div>';
    else h += '<p class="small text-muted mt-3">Catatan pengamat akan tampil di sini setelah Anda menyelesaikan penilaian diri dan pengamat menyelesaikan lembarnya.</p>';
  }
  if (!done) h += '<div class="mt-3"><button class="btn btn-adaptiva-secondary me-2" onclick="obSimpanForm_(\'Draft\')">Simpan draf</button><button class="btn btn-adaptiva-primary" onclick="obSimpanForm_(\'Selesai\')">Selesaikan</button></div>';
  obSec_().innerHTML = h + '</div>';
  window.scrollTo(0, 0);
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
  const o = { JadwalID: OB.form.jadwal.ID, Checklist: checklist, Rubrik: rubrik };
  if (obs) {
    o.Perbandingan = (OB.form.pb || []).map((p, i) => Object.assign({}, p, { terlaksana: document.getElementById('pb_' + i).value.trim() }));
    o.JurnalA = {}; I.catatanObserverJurnal.forEach((t, i) => { o.JurnalA['c' + i] = document.getElementById('ja_' + i).value.trim(); });
    o.CatatanUmum = document.getElementById('obCU').value.trim();
  } else {
    o.JurnalB = {}; I.pertanyaanRefleksiGuru.forEach((t, i) => { o.JurnalB['b' + i] = document.getElementById('jb_' + i).value.trim(); });
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
    else (OB.form.mode === 'obs' ? obBukaObservasi_ : obBukaDiri_)(OB.form.jadwal.ID);
  });
}
