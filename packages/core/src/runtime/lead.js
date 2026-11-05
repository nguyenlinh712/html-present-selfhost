// Form thu lead trong deck (Phase 7, lane A). Chỉ tải khi project.leadForm bật và người xem
// KHÔNG phải admin (service.js quyết định việc inject). Gửi về POST /__lead.
(function () {
  'use strict';
  try {
    var hp = window.__htmlpresent || {};
    var isAdmin = !!hp.admin; // admin chỉ xem trước, không gửi/lưu lead
    var slug = hp.slug || (location.pathname.split('/').filter(Boolean)[0] || '');
    if (!slug) return;
    var pagePath = hp.path || location.pathname;

    function sid() { try { return sessionStorage.getItem('ltrk_sid_' + pagePath) || ''; } catch (_) { return ''; } }
    function vid() { try { return localStorage.getItem('htmlpresent_vid') || ''; } catch (_) { return ''; } }
    function currentSlide() {
      // Best-effort: slide đang hiện (nếu present.js đánh dấu .is-active) hoặc theo hash.
      var active = document.querySelector('.slide.is-active, .slide.active, section.is-active');
      var slides = document.querySelectorAll('.slide, section[id]');
      if (active && slides.length) { var i = Array.prototype.indexOf.call(slides, active); if (i >= 0) return i + 1; }
      return 0;
    }

    var DONE_KEY = 'ltlead_done_' + pagePath;
    function alreadySent() { try { return localStorage.getItem(DONE_KEY) === '1'; } catch (_) { return false; } }
    function markSent() { try { localStorage.setItem(DONE_KEY, '1'); } catch (_) {} }

    // ----- UI -----
    var opened = false;
    function buildModal() {
      var wrap = document.createElement('div');
      wrap.className = 'lt-lead-modal';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML =
        '<div class="lt-lead-card">' +
          '<button type="button" class="lt-lead-close" aria-label="Đóng">×</button>' +
          '<h3 class="lt-lead-title">Để lại thông tin</h3>' +
          '<p class="lt-lead-sub">Chúng tôi sẽ liên hệ tư vấn sớm nhất.</p>' +
          '<form class="lt-lead-form">' +
            '<input class="lt-lead-input" name="name" type="text" autocomplete="name" placeholder="Họ tên" maxlength="120">' +
            '<input class="lt-lead-input" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="Số điện thoại" maxlength="20">' +
            '<input class="lt-lead-input" name="email" type="email" autocomplete="email" placeholder="Email (tuỳ chọn)" maxlength="200">' +
            '<textarea class="lt-lead-input lt-lead-note" name="note" placeholder="Nhu cầu của bạn (tuỳ chọn)" maxlength="1000" rows="2"></textarea>' +
            '<div class="lt-lead-msg" aria-live="polite"></div>' +
            '<button type="submit" class="lt-lead-submit">Gửi thông tin</button>' +
          '</form>' +
        '</div>';
      document.body.appendChild(wrap);

      var form = wrap.querySelector('.lt-lead-form');
      var msg = wrap.querySelector('.lt-lead-msg');
      var submit = wrap.querySelector('.lt-lead-submit');

      function close() { wrap.classList.remove('is-open'); setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); opened = false; }, 200); }
      wrap.querySelector('.lt-lead-close').addEventListener('click', close);
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var phone = String(fd.get('phone') || '').trim();
        var email = String(fd.get('email') || '').trim();
        if (!phone && !email) { msg.textContent = 'Vui lòng nhập số điện thoại hoặc email.'; msg.className = 'lt-lead-msg is-err'; return; }
        if (isAdmin) { msg.textContent = 'Bản xem trước (admin) — lead không được gửi/lưu.'; msg.className = 'lt-lead-msg'; return; }
        submit.disabled = true; submit.textContent = 'Đang gửi…'; msg.textContent = ''; msg.className = 'lt-lead-msg';
        var payload = {
          slug: slug, path: pagePath, share: hp.share || null,
          sid: sid(), vid: vid(), slide: currentSlide(),
          name: String(fd.get('name') || '').trim(), phone: phone, email: email,
          note: String(fd.get('note') || '').trim()
        };
        fetch('/__lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) { return r.ok ? r.json().catch(function () { return { ok: true }; }) : r.json().then(function (j) { throw new Error(j && j.error || 'Gửi không thành công'); }); })
          .then(function () {
            markSent();
            wrap.querySelector('.lt-lead-card').innerHTML =
              '<button type="button" class="lt-lead-close" aria-label="Đóng">×</button>' +
              '<div class="lt-lead-thanks"><div class="lt-lead-check">✓</div><h3>Đã gửi!</h3><p>Cảm ơn bạn, chúng tôi sẽ liên hệ sớm.</p></div>';
            wrap.querySelector('.lt-lead-close').addEventListener('click', close);
            if (fab) fab.style.display = 'none';
            setTimeout(close, 2500);
          })
          .catch(function (err) {
            submit.disabled = false; submit.textContent = 'Gửi thông tin';
            msg.textContent = (err && err.message) || 'Có lỗi, vui lòng thử lại.'; msg.className = 'lt-lead-msg is-err';
          });
      });

      requestAnimationFrame(function () { wrap.classList.add('is-open'); var first = wrap.querySelector('input'); if (first) first.focus(); });
    }

    function open() { if (opened) return; opened = true; buildModal(); }

    // Nút nổi góc dưới-trái (FAB present.js ở góc phải nên không đè nhau).
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'lt-lead-fab';
    fab.textContent = 'Để lại thông tin';
    fab.setAttribute('aria-label', 'Để lại thông tin liên hệ');
    fab.addEventListener('click', open);

    // Nếu deck tự đặt phần tử [data-lead-form] / [data-lead-trigger] thì gắn mở modal vào đó
    // và ẩn nút nổi mặc định.
    function wireDeckTriggers() {
      var triggers = document.querySelectorAll('[data-lead-trigger], [data-lead-form] button, a[href="#lead"]');
      if (triggers.length) {
        fab.style.display = 'none';
        Array.prototype.forEach.call(triggers, function (el) {
          el.addEventListener('click', function (e) { e.preventDefault(); open(); });
        });
      }
    }

    function init() {
      if (!isAdmin && alreadySent()) return; // khách đã gửi ở phiên trước → không làm phiền (admin luôn xem trước được)
      document.body.appendChild(fab);
      wireDeckTriggers();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  } catch (_) {}
})();
