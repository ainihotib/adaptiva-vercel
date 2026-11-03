/* ============================================================
   beranda.js — Carousel hero, maskot "Adapti" & tombol WhatsApp
   untuk halaman muka ADAPTIVA.
   ============================================================ */

// Nomor WhatsApp admin/penyelenggara untuk pertanyaan guru.
// Format internasional TANPA tanda + atau spasi, mis. '6281234567890'.
// Kosongkan ('') untuk menyembunyikan tombol WhatsApp.
const BERANDA_WA_NUMBER = '6281285959665';
const BERANDA_WA_TEXT = 'Halo, saya guru pengguna ADAPTIVA. Saya ingin bertanya...';

(function () {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────── Carousel ─────────
  function initCarousel() {
    const hero = document.getElementById('berandaHero');
    if (!hero) return;
    const slides = Array.from(hero.querySelectorAll('.bh-slide'));
    const dots = Array.from(hero.querySelectorAll('.bh-dot'));
    if (slides.length < 2) return;
    let idx = 0, timer = null;

    function show(n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => {
        const on = i === idx;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        s.querySelectorAll('a,button').forEach(el => { el.tabIndex = on ? 0 : -1; });
      });
      dots.forEach((d, i) => {
        d.classList.toggle('is-active', i === idx);
        d.setAttribute('aria-current', i === idx ? 'true' : 'false');
      });
    }
    function start() { if (!reduceMotion) { stop(); timer = setInterval(() => show(idx + 1), 6500); } }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    hero.querySelector('.bh-prev').addEventListener('click', () => { show(idx - 1); start(); });
    hero.querySelector('.bh-next').addEventListener('click', () => { show(idx + 1); start(); });
    dots.forEach((d, i) => d.addEventListener('click', () => { show(i); start(); }));
    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', start);
    hero.addEventListener('focusin', stop);
    hero.addEventListener('focusout', start);

    // geser (swipe) di layar sentuh
    let x0 = null;
    hero.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; stop(); }, { passive: true });
    hero.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
      x0 = null; start();
    });

    show(0);
    start();
  }

  // ───────── Maskot Adapti ─────────
  const TIPS = [
    'Halo, Bapak/Ibu Guru! 👋',
    'Klik "Login" untuk mulai menyusun Modul Ajar ya.',
    'Asesmen diagnostik membantu mengenali kesiapan murid.',
    'Ada pertanyaan? Tap tombol WhatsApp di bawah ya!',
    'Modul Ajar bisa disusun otomatis, lalu Anda sunting sendiri.'
  ];

  function initMascot() {
    const el = document.getElementById('adapti');
    if (!el) return;
    const bubble = el.querySelector('.adapti-bubble');
    const pupils = Array.from(el.querySelectorAll('.adapti-pupil'));
    let tip = 0, hideT = null;

    function say(text, ms) {
      bubble.textContent = text;
      bubble.classList.add('is-show');
      clearTimeout(hideT);
      hideT = setTimeout(() => bubble.classList.remove('is-show'), ms || 4500);
    }
    function nextTip() { say(TIPS[tip % TIPS.length]); tip++; }

    // pupil mata mengikuti kursor / sentuhan
    function look(clientX, clientY) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
      const dx = clientX - cx, dy = clientY - cy;
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(3.2, d / 40);
      const ox = (dx / d) * m, oy = (dy / d) * m;
      pupils.forEach(p => p.setAttribute('transform', 'translate(' + ox.toFixed(2) + ' ' + oy.toFixed(2) + ')'));
    }
    if (!reduceMotion) {
      window.addEventListener('mousemove', e => look(e.clientX, e.clientY), { passive: true });
      window.addEventListener('touchmove', e => { const t = e.touches[0]; look(t.clientX, t.clientY); }, { passive: true });
    }

    el.addEventListener('click', () => {
      el.classList.remove('is-jump'); void el.offsetWidth; el.classList.add('is-jump');
      nextTip();
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });

    setTimeout(nextTip, 1800);
    setInterval(() => {
      // hanya bicara saat halaman muka sedang tampil
      const landing = document.getElementById('landingScreen');
      if (landing && landing.offsetParent !== null) nextTip();
    }, 14000);
  }

  // ───────── Tombol WhatsApp ─────────
  function initWhatsApp() {
    const a = document.getElementById('waFloat');
    if (!a) return;
    const num = String(BERANDA_WA_NUMBER || '').replace(/\D/g, '');
    if (!num) return; // belum diisi → tombol tetap tersembunyi
    a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(BERANDA_WA_TEXT);
    a.classList.add('is-ready');
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCarousel();
    initMascot();
    initWhatsApp();
  });
})();
