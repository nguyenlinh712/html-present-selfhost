// Thu thập số liệu hành vi ở mức tổng hợp, không ghi nội dung người dùng nhập.
(function () {
  'use strict';
  try {
    var htmlpresent = window.__htmlpresent || {};
    if (htmlpresent.noTrack) return;

    var pagePath = htmlpresent.path || location.pathname;
    var parts = location.pathname.split('/').filter(Boolean);
    var slug = htmlpresent.slug || (parts[0] ? decodeURIComponent(parts[0]) : '');
    if (!slug) return;

    var slides = document.querySelectorAll('.slide');
    if (!slides.length) slides = document.querySelectorAll('section[id]');
    var total = slides.length || 1;
    var sidKey = 'ltrk_sid_' + pagePath;
    var sid = '';
    try { sid = sessionStorage.getItem(sidKey) || ''; } catch (_) {}
    if (!sid) {
      sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
      try { sessionStorage.setItem(sidKey, sid); } catch (_) {}
    }

    var vid = '';
    try {
      vid = localStorage.getItem('htmlpresent_vid') || '';
      if (!vid) { vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('htmlpresent_vid', vid); }
    } catch (_) { vid = sid; }
    var firstSeen = '';
    try {
      firstSeen = localStorage.getItem('htmlpresent_first_seen') || '';
      if (!firstSeen) { firstSeen = new Date().toISOString(); localStorage.setItem('htmlpresent_first_seen', firstSeen); }
    } catch (_) { firstSeen = new Date().toISOString(); }

    var revisits = 0;
    try {
      var revisitKey = 'htmlpresent_revisit_' + pagePath;
      revisits = Math.min(1000, parseInt(localStorage.getItem(revisitKey) || '0', 10) || 0);
      localStorage.setItem(revisitKey, String(Math.min(1000, revisits + 1)));
    } catch (_) {}

    var params = new URLSearchParams(location.search);
    var utm = {};
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) {
      var v = params.get('utm_' + k); if (v) utm[k] = v.slice(0, 200);
    });
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    var uaData = navigator.userAgentData || {};
    var env = {
      screenW: screen.width || 0, screenH: screen.height || 0,
      vpW: innerWidth || 0, vpH: innerHeight || 0,
      dpr: Number((devicePixelRatio || 1).toFixed(2)),
      orientation: screen.orientation && screen.orientation.type || '',
      platform: uaData.platform || navigator.platform || '',
      brands: (uaData.brands || []).slice(0, 6).map(function (b) { return { brand: String(b.brand).slice(0, 40), version: String(b.version).slice(0, 20) }; }),
      mobile: !!uaData.mobile, lang: navigator.language || '', langs: (navigator.languages || []).slice(0, 8),
      tz: '', tzOffset: new Date().getTimezoneOffset(),
      colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      conn: { effectiveType: conn.effectiveType || '', downlink: conn.downlink || 0, rtt: conn.rtt || 0, saveData: !!conn.saveData },
      mem: navigator.deviceMemory || 0, cpu: navigator.hardwareConcurrency || 0,
      touch: navigator.maxTouchPoints || 0
    };
    try { env.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    function safeReferrer() {
      try {
        if (!document.referrer) return '';
        var ref = new URL(document.referrer); ref.searchParams.delete('k');
        return (ref.origin + ref.pathname + ref.search).slice(0, 500);
      } catch (_) { return ''; }
    }
    var landing = new URL(location.href); landing.searchParams.delete('k');

    var current = 1, maxSlide = 1, lastTick = Date.now();
    var visible = document.visibilityState === 'visible';
    var activeMs = 0, engagedMs = 0, lastActivity = Date.now();
    var st = {}, scrollDepth = 0, interactions = 0, tabSwitches = 0, rageClicks = 0;
    var copyAttempt = 0, printAttempt = 0, lastClickAt = 0, rapidClicks = 0, lastClickTarget = null;

    function markActivity() { lastActivity = Date.now(); }
    function measureScroll() {
      var height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight);
      var pct = height ? Math.round(Math.min(100, ((scrollY + innerHeight) / height) * 100)) : 0;
      scrollDepth = Math.max(scrollDepth, pct);
    }
    function base(type) {
      var secondsBySlide = {}; Object.keys(st).forEach(function (k) { secondsBySlide[k] = Math.round(st[k] / 1000); });
      return {
        sid: sid, vid: vid, firstSeen: firstSeen, type: type, slug: slug, path: pagePath,
        slide: current, maxSlide: maxSlide, total: total,
        seconds: Math.round(activeMs / 1000), durationTotal: Math.round((Date.now() - startedAt) / 1000),
        engagedTime: Math.round(engagedMs / 1000), st: secondsBySlide,
        scrollDepth: scrollDepth, interactions: interactions,
        idleSeconds: Math.max(0, Math.round((Date.now() - lastActivity) / 1000)),
        tabSwitches: tabSwitches, revisits: revisits, exitSlide: current,
        rageClicks: rageClicks, copyAttempt: copyAttempt, printAttempt: printAttempt,
        mobile: innerWidth < 768, env: env,
        utm: utm, referrer: safeReferrer()
      };
    }
    function send(type, extra) {
      try {
        var payload = base(type);
        if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) navigator.sendBeacon('/__track', new Blob([body], { type: 'application/json' }));
        else fetch('/__track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
      } catch (_) {}
    }
    function tick() {
      var now = Date.now(), delta = Math.max(0, now - lastTick);
      if (visible) {
        activeMs += delta;
        if (now - lastActivity < 30000) engagedMs += delta;
        st[current] = (st[current] || 0) + delta;
      }
      lastTick = now;
    }

    var startedAt = Date.now();
    if (slides.length && 'IntersectionObserver' in window) {
      var ratios = new Array(slides.length).fill(0);
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { var i = Array.prototype.indexOf.call(slides, entry.target); if (i >= 0) ratios[i] = entry.intersectionRatio; });
        var best = -1, bestIndex = 0;
        for (var i = 0; i < ratios.length; i++) if (ratios[i] > best) { best = ratios[i]; bestIndex = i; }
        var next = bestIndex + 1;
        if (next !== current) { tick(); current = next; maxSlide = Math.max(maxSlide, current); send('slide'); }
      }, { threshold: [0.2, 0.5, 0.8] });
      Array.prototype.forEach.call(slides, function (slide) { io.observe(slide); });
    }

    ['scroll', 'pointerdown', 'keydown', 'touchstart', 'mousemove'].forEach(function (eventName) {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener('scroll', measureScroll, { passive: true });
    measureScroll();

    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('a[href],button,[role="button"]') : null;
      if (!target) return;
      markActivity(); interactions++;
      var now = Date.now();
      if (target === lastClickTarget && now - lastClickAt < 800) rapidClicks++;
      else { lastClickTarget = target; rapidClicks = 1; }
      if (rapidClicks === 3) rageClicks++;
      lastClickAt = now;
      var anchor = target.matches('a[href]') ? target : null;
      var href = anchor ? (anchor.getAttribute('href') || '') : '';
      if (/^(https?:|mailto:|tel:)/i.test(href)) send('click', { href: href.slice(0, 300), text: (anchor.textContent || '').trim().slice(0, 80) });
    }, true);
    document.addEventListener('copy', function () { copyAttempt++; markActivity(); });
    window.addEventListener('beforeprint', function () { printAttempt++; });
    document.addEventListener('visibilitychange', function () {
      tick();
      var wasVisible = visible; visible = document.visibilityState === 'visible';
      if (wasVisible && !visible) { tabSwitches++; send('ping'); }
      if (visible) markActivity();
    });
    window.addEventListener('pagehide', function () { tick(); send('end'); });

    send('start', {
      landingPath: landing.pathname + landing.search,
      startedAt: new Date(startedAt).toISOString(),
      referrer: safeReferrer(),
      utm: utm, env: env
    });
    setInterval(function () { tick(); measureScroll(); if (visible) send('ping'); }, 15000);
  } catch (_) {}
})();
