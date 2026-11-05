// Keep image resources warm for the current tab; no persistent offline copy.
(function () {
  'use strict';
  const retained = [];
  let busy = false;
  let label = 'Tải trước ảnh';
  function refresh() {
    window.LTPresent?.registerMenuItem({
      id: 'preload-images', icon: '↓', label: () => busy ? 'Đang tải ảnh…' : label,
      order: 58, disabled: () => busy, onClick: prepare
    });
  }
  async function prepare() {
    if (busy) return;
    busy = true;
    refresh();
    const urls = new Set();
    let unsupported = !!document.querySelector('iframe,video,audio');
    document.querySelectorAll('img').forEach(img => {
      img.loading = 'eager';
      if (img.currentSrc || img.src) urls.add(img.currentSrc || img.src);
    });
    document.querySelectorAll('.slide, .slide *, section[id], section[id] *').forEach(el => {
      for (const pseudo of [null, '::before', '::after']) {
        const bg = getComputedStyle(el, pseudo).backgroundImage;
        for (const match of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          try { urls.add(new URL(match[1], document.baseURI).href); } catch (_) { unsupported = true; }
        }
      }
    });
    const queue = [...urls];
    let failed = 0;
    async function worker() {
      while (queue.length) {
        const src = queue.shift();
        await new Promise(resolve => {
          const img = new Image();
          retained.push(img);
          let done = false;
          const finish = ok => {
            if (done) return;
            done = true; clearTimeout(timer);
            img.onload = img.onerror = null;
            if (!ok) failed++;
            resolve();
          };
          const timer = setTimeout(() => finish(false), 15000);
          img.onload = () => finish(true);
          img.onerror = () => finish(false);
          img.src = src;
        });
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    busy = false;
    label = failed ? 'Tải lại ảnh lỗi' : 'Tải trước ảnh';
    refresh();
    alert(`Đã tải ${urls.size - failed}/${urls.size} ảnh của trang đang mở.${unsupported ? ' Video, âm thanh và nội dung nhúng vẫn cần mạng.' : ''} Giữ tab này mở khi mất mạng; tải lại trang hoặc mở trang khác vẫn cần kết nối. Đây chưa phải bản offline đầy đủ.`);
  }
  refresh();
})();
