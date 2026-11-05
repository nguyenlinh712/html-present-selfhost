// Slide layout — hỗ trợ dự án có khung cố định (landscape/portrait).
// Đọc window.__htmlpresent.{layout, baseWidth, baseHeight}. Nếu không phải
// 'responsive' thì:
//   - gói mỗi .slide / section[id] trong một "stage" scale fit viewport;
//   - letterbox tự nhiên theo nền slide/body;
//   - nếu landscape và viewport dọc (mobile portrait) → hiện toast "Xoay ngang"
//     (auto-hide, hiện lại khi khách chạm/di chuột — xem toggleToastVisibility).
// Chạy sớm nhưng chờ DOM ready mới wrap. Không chạm khi 'responsive'.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const cfg = window.__htmlpresent;
  if (!cfg) return;
  const layout = String(cfg.layout || 'responsive');
  if (layout !== 'landscape' && layout !== 'portrait') return;

  const baseW = clampInt(cfg.baseWidth, 320, 10000, layout === 'portrait' ? 1080 : 1920);
  const baseH = clampInt(cfg.baseHeight, 320, 10000, layout === 'portrait' ? 1920 : 1080);

  function clampInt(v, min, max, def) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  }

  // UI của present.js (panel người trình bày là <section id>, các clone preview/
  // overview/audience mang class .slide) KHÔNG phải slide thật → không được bọc
  // stage/scale, nếu không panel bị đẩy ra ngoài và preview lệch.
  const UI_SELECTOR = '#htmlpresent-presenter-panel,#htmlpresent-audience,.lt-overview,.lt-fab,.lt-fab-menu,.lt-help,[data-htmlpresent-ui]';
  function isAppUi(node) {
    return !!(node && node.closest && node.closest(UI_SELECTOR));
  }

  function selectSlides() {
    let nodes = document.querySelectorAll('.slide');
    if (!nodes.length) nodes = document.querySelectorAll('section[id]');
    return [...nodes].filter(node => !isAppUi(node));
  }

  function wrapSlide(slide) {
    if (isAppUi(slide) || !slide.parentNode) return;
    // Nếu đã wrap bởi lần chạy trước, bỏ qua
    if (slide.parentElement && slide.parentElement.classList.contains('htmlpresent-stage')) return;
    const stage = document.createElement('div');
    stage.className = 'htmlpresent-stage';
    stage.dataset.layout = layout;
    slide.parentNode.insertBefore(stage, slide);
    stage.appendChild(slide);
    slide.classList.add('htmlpresent-stage-inner');
    slide.style.width = baseW + 'px';
    slide.style.height = baseH + 'px';
    fit(slide);
  }

  function fit(slide) {
    const parent = slide.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    const scale = Math.min(w / baseW, h / baseH);
    slide.style.transform = `translate(-50%,-50%) scale(${scale})`;
  }

  function fitAll() {
    document.querySelectorAll('.htmlpresent-stage-inner').forEach(fit);
  }

  function init() {
    document.documentElement.classList.add('htmlpresent-layout-' + layout);
    selectSlides().forEach(wrapSlide);
    setupRotateToast();
    // Theo dõi slide mới được thêm (vd deck tự chèn section)
    if ('MutationObserver' in window) {
      const mo = new MutationObserver(muts => {
        for (const m of muts) m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches && (node.matches('.slide') || node.matches('section[id]'))) wrapSlide(node);
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', fitAll);
    window.addEventListener('orientationchange', fitAll);
  }

  /* ---------- Toast "xoay ngang" (chỉ cho landscape + mobile portrait) ---------- */
  let toastEl = null, toastTimer = null;

  function needRotateHint() {
    return layout === 'landscape' && window.innerWidth < window.innerHeight;
  }

  function setupRotateToast() {
    if (!needRotateHint()) return;
    toastEl = document.createElement('div');
    toastEl.className = 'htmlpresent-rotate-toast';
    toastEl.innerHTML = '📱↻ <span>Xoay ngang điện thoại để xem đẹp hơn</span>';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
    showToast();
    // Hiện lại khi khách chạm / di chuột / cuộn
    const trigger = () => { if (needRotateHint()) showToast(); };
    ['pointermove', 'pointerdown', 'touchstart', 'wheel'].forEach(evt =>
      window.addEventListener(evt, trigger, { passive: true }));
    // Ẩn hẳn nếu khách xoay ngang
    window.addEventListener('orientationchange', () => {
      if (!needRotateHint() && toastEl) toastEl.classList.remove('is-visible');
    });
  }

  function showToast() {
    if (!toastEl) return;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('is-visible'), 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
