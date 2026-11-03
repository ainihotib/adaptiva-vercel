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

    // Posisi robot: mengejar kursor dengan gerak halus (lerp). Di layar sentuh / reduced-motion
    // robot diam di pojok kanan bawah (di atas tombol WhatsApp).
    const canFollow = !reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let W = el.offsetWidth || 96, H = 120 / 100 * W;
    let x = 0, y = 0, tx = 0, ty = 0, mx = -1, my = -1, raf = null, placed = false;

    function cornerTarget() {
      W = el.offsetWidth || 96; H = W * 1.2;
      const waVisible = document.getElementById('waFloat') && document.getElementById('waFloat').classList.contains('is-ready');
      return { x: window.innerWidth - W - 18, y: window.innerHeight - H - (waVisible ? 86 : 24) };
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function setPos() {
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      bubble.classList.toggle('to-right', x < 230); // dekat tepi kiri → balon di sisi kanan
    }
    function look() {
      const cx = x + W / 2, cy = y + H * 0.42;
      const tX = mx < 0 ? cx : mx, tY = my < 0 ? cy : my;
      const dx = tX - cx, dy = tY - cy, d = Math.hypot(dx, dy) || 1, m = Math.min(3.2, d / 40);
      const ox = (dx / d) * m, oy = (dy / d) * m;
      pupils.forEach(p => p.setAttribute('transform', 'translate(' + ox.toFixed(2) + ' ' + oy.toFixed(2) + ')'));
    }
    function tick() {
      const landing = document.getElementById('landingScreen');
      const visible = landing && landing.offsetParent !== null;
      if (visible) {
        let goal;
        if (canFollow && mx >= 0) {
          // berhenti sedikit di kanan-bawah kursor; jika mentok tepi kanan/bawah, pindah ke sisi lain
          let gx = mx + 34, gy = my + 26;
          if (gx + W > window.innerWidth - 8) gx = mx - W - 34;
          if (gy + H > window.innerHeight - 8) gy = my - H - 26;
          goal = { x: clamp(gx, 8, window.innerWidth - W - 8), y: clamp(gy, 8, window.innerHeight - H - 8) };
        } else goal = cornerTarget();
        tx = goal.x; ty = goal.y;
        if (!placed) { x = tx; y = ty; placed = true; el.classList.add('is-ready'); }
        x += (tx - x) * 0.09; y += (ty - y) * 0.09;
        setPos(); look();
      }
      raf = requestAnimationFrame(tick);
    }
    if (canFollow) {
      el.classList.add('is-following');
      window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
      document.addEventListener('mouseleave', () => { mx = -1; my = -1; });
    }
    window.addEventListener('resize', () => { if (!canFollow || mx < 0) placed = false; });
    raf = requestAnimationFrame(tick);

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
