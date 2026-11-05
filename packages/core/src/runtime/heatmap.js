// Collects heatmap activity for enabled presentations.
(function () {
  'use strict';

  try {
    const htmlpresent = window.__htmlpresent || {};
    if (htmlpresent.noTrack || htmlpresent.heatmap === false) return;

    let slides = Array.from(document.querySelectorAll('.slide'));
    if (!slides.length) slides = Array.from(document.querySelectorAll('section[id]'));
    if (!slides.length) return;

    const COLS = 24, ROWS = 14, MAX_SLIDES = 200, MAX_CELL_COUNT = 10000;
    const pagePath = String(htmlpresent.path || location.pathname).slice(0, 500);
    const slug = String(htmlpresent.slug || location.pathname.split('/').filter(Boolean)[0] || '').slice(0, 120);
    if (!slug) return;

    const sidKey = 'ltrk_sid_' + pagePath;
    let sid = '';
    try { sid = sessionStorage.getItem(sidKey) || ''; } catch (_) {}
    if (!sid) {
      sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
      try { sessionStorage.setItem(sidKey, sid); } catch (_) {}
    }
    let vid = sid;
    try { vid = localStorage.getItem('htmlpresent_vid') || sid; } catch (_) {}

    const mobile = !!(window.innerWidth < 768 || (navigator.userAgentData && navigator.userAgentData.mobile));
    const device = mobile ? 'm' : 'd';
    let dirty = Object.create(null);
    let lastMouseAt = 0;
    let lastMouseCell = '';
    let visible = document.visibilityState !== 'hidden';

    function slideAt(target, x, y) {
      let node = target && target.closest && target.closest('.slide, section[id]');
      if (node && slides.includes(node)) return node;
      if (typeof x === 'number' && typeof y === 'number') {
        node = document.elementFromPoint(x, y);
        node = node && node.closest && node.closest('.slide, section[id]');
        if (node && slides.includes(node)) return node;
      }
      const center = window.innerHeight / 2;
      let best = null, distance = Infinity;
      slides.forEach(slide => {
        const r = slide.getBoundingClientRect();
        const d = center < r.top ? r.top - center : center > r.bottom ? center - r.bottom : 0;
        if (d < distance) { distance = d; best = slide; }
      });
      return best;
    }

    function add(type, target, x, y) {
      if (!visible || document.visibilityState === 'hidden') return;
      const slide = slideAt(target, x, y);
      if (!slide) return;
      const idx = slides.indexOf(slide);
      if (idx < 0 || idx >= MAX_SLIDES) return;
      const rect = slide.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = Math.max(0, Math.min(0.999999, (x - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(0.999999, (y - rect.top) / rect.height));
      const col = Math.floor(nx * COLS), row = Math.floor(ny * ROWS);
      const cell = row * COLS + col;
      const slideKey = String(idx + 1);
      const slideData = dirty[slideKey] || (dirty[slideKey] = { m: Object.create(null), c: Object.create(null), t: Object.create(null) });
      const counts = slideData[type];
      counts[cell] = Math.min(MAX_CELL_COUNT, (counts[cell] || 0) + 1);
    }

    function onMouseMove(event) {
      if (!visible || document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastMouseAt < 100) return;
      const slide = slideAt(event.target, event.clientX, event.clientY);
      if (!slide) return;
      const rect = slide.getBoundingClientRect();
      const col = Math.floor(Math.max(0, Math.min(.999999, (event.clientX - rect.left) / rect.width)) * COLS);
      const row = Math.floor(Math.max(0, Math.min(.999999, (event.clientY - rect.top) / rect.height)) * ROWS);
      const cellKey = `${slides.indexOf(slide)}:${row * COLS + col}`;
      if (cellKey === lastMouseCell && now - lastMouseAt < 250) return;
      lastMouseAt = now; lastMouseCell = cellKey;
      add('m', slide, event.clientX, event.clientY);
    }

    function onClick(event) {
      if (event.target && event.target.closest && event.target.closest('.htmlpresent-present-ui,.htmlpresent-present-launch')) return;
      add('c', event.target, event.clientX, event.clientY);
    }

    function onTouch(event) {
      const touches = event.changedTouches || [];
      for (let i = 0; i < Math.min(touches.length, 3); i++) {
        const t = touches[i]; add('t', event.target, t.clientX, t.clientY);
      }
    }

    function mergeBack(payload) {
      for (const [slide, groups] of Object.entries(payload.slides || {})) {
        const target = dirty[slide] || (dirty[slide] = { m: Object.create(null), c: Object.create(null), t: Object.create(null) });
        for (const type of ['m', 'c', 't']) for (const [cell, n] of Object.entries(groups[type] || {})) {
          target[type][cell] = Math.min(MAX_CELL_COUNT, (target[type][cell] || 0) + n);
        }
      }
    }

    function flush() {
      if (!Object.keys(dirty).length || document.visibilityState === 'hidden' && !pageHiding) return;
      const payload = {
        sid, vid, slug, path: pagePath, dev: device,
        grid: { cols: COLS, rows: ROWS }, slides: dirty
      };
      dirty = Object.create(null);
      let body;
      try { body = new Blob([JSON.stringify(payload)], { type: 'application/json' }); }
      catch (_) { mergeBack(payload); return; }
      try {
        if (navigator.sendBeacon('/__hm', body)) return;
      } catch (_) {}
      try {
        fetch('/__hm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true })
          .then(response => { if (!response.ok) mergeBack(payload); })
          .catch(() => mergeBack(payload));
      } catch (_) { mergeBack(payload); }
    }

    let pageHiding = false;
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('click', onClick, { passive: true, capture: true });
    document.addEventListener('touchstart', onTouch, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      visible = document.visibilityState !== 'hidden';
      if (!visible) flush();
    });
    window.addEventListener('pagehide', () => { pageHiding = true; flush(); });
    window.addEventListener('pageshow', () => { pageHiding = false; visible = document.visibilityState !== 'hidden'; });
    setInterval(flush, 15000);
  } catch (_) {
    // Telemetry must never disrupt the slide.
  }
})();
