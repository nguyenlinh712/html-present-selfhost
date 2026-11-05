// Răn đe sao chép và đóng dấu truy vết. Không thể ngăn tuyệt đối việc lưu HTML.
(function () {
  'use strict';

  try {
    var root = document.documentElement;
    var watermarkId = '__wm';
    var suppliedWatermark = typeof window.__wm === 'string' ? window.__wm.trim() : '';
    var viewer = window.__htmlpresent || {};
    if (viewer.admin) return; // Editing requires native selection, clipboard and focus.
    var accessLabel = viewer.share
      ? ('Link chia sẻ ' + String(viewer.share).slice(0, 8))
      : (viewer.role ? ('Vai trò ' + String(viewer.role)) : 'Người xem');
    var timestamp = new Date().toLocaleString('vi-VN');
    var watermarkText = suppliedWatermark || (accessLabel + ' · ' + timestamp);

    // Ngăn các thao tác thông thường; người xem vẫn có thể lấy nội dung qua mạng.
    ['contextmenu', 'selectstart', 'copy', 'cut', 'dragstart'].forEach(function (eventName) {
      document.addEventListener(eventName, function (event) {
        event.preventDefault();
      }, true);
    });

    document.addEventListener('keydown', function (event) {
      var key = String(event.key || '').toLowerCase();
      var command = event.ctrlKey || event.metaKey;
      var blocked = key === 'f12' || (command && (
        key === 's' || key === 'u' || key === 'p' ||
        (event.shiftKey && (key === 'i' || key === 'j' || key === 'c'))
      ));
      if (blocked) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    var style = document.createElement('style');
    style.setAttribute('data-lt-protect-style', '');
    style.textContent =
      '*{-webkit-user-select:none!important;-moz-user-select:none!important;user-select:none!important}' +
      'img,canvas,svg{-webkit-user-drag:none;user-drag:none}' +
      '@media print{html,body{display:none!important;visibility:hidden!important}}' +
      'html.lt-protect-obscured body>:not(#__wm){filter:blur(10px)!important;pointer-events:none!important}' +
      '#__wm{position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;background-repeat:repeat!important;opacity:.14!important}' +
      'html.lt-protect-obscured #__wm{opacity:.3!important}' +
      '@media(prefers-reduced-motion:no-preference){html.lt-protect-obscured body>:not(#__wm){transition:filter .12s ease!important}}';
    document.head.appendChild(style);

    function paintWatermark() {
      if (!document.body) return;
      var canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 200;
      var context = canvas.getContext && canvas.getContext('2d');
      if (!context) return;
      context.translate(180, 100);
      context.rotate(-0.42);
      context.font = '600 14px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif';
      context.fillStyle = '#111';
      context.textAlign = 'center';
      context.fillText(watermarkText.slice(0, 120), 0, 0, 330);

      var watermark = document.getElementById(watermarkId);
      if (!watermark) {
        watermark = document.createElement('div');
        watermark.id = watermarkId;
        watermark.setAttribute('aria-hidden', 'true');
        watermark.setAttribute('data-lt-protect-watermark', '');
        watermark.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;background-repeat:repeat;opacity:.14';
        document.body.appendChild(watermark);
      }
      watermark.style.backgroundImage = 'url("' + canvas.toDataURL() + '")';
    }

    function obscure() { root.classList.add('lt-protect-obscured'); }
    function reveal() { root.classList.remove('lt-protect-obscured'); }

    window.addEventListener('blur', obscure);
    window.addEventListener('focus', reveal);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) obscure(); else reveal();
    });
    window.addEventListener('beforeprint', obscure);
    window.addEventListener('afterprint', reveal);

    // Răn đe khi DevTools được dock cạnh trang; heuristic có thể báo nhầm với sidebar lớn.
    function checkDevTools() {
      var opened = Math.abs(window.outerWidth - window.innerWidth) > 240 ||
        Math.abs(window.outerHeight - window.innerHeight) > 240;
      if (opened) obscure();
      else if (document.hasFocus() && !document.hidden) reveal();
    }

    paintWatermark();
    if (window.MutationObserver && document.body) {
      var observer = new MutationObserver(function () {
        if (!document.getElementById(watermarkId)) paintWatermark();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', checkDevTools);
    window.setInterval(checkDevTools, 1500);
  } catch (error) {
    // Chế độ răn đe không được làm hỏng việc xem slide nếu trình duyệt thiếu API.
  }
})();
