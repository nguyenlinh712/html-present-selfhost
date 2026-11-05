// HTML Present admin — heatmap viewer (Lane F4).
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.LT) return;

  const LT = window.LT;
  const { api, toast, esc, attr, openModal } = LT;
  const TYPES = { m: 'Di chuyển chuột', c: 'Bấm', t: 'Chạm' };
  let cssReady = false;

  function addCss() {
    if (cssReady || document.getElementById('htmlpresent-heatmap-css')) return;
    cssReady = true;
    const style = document.createElement('style');
    style.id = 'htmlpresent-heatmap-css';
    style.textContent = `
      #modal:has(.hm-viewer) .modal-card{max-width:1180px;width:100%;max-height:94vh;padding:18px;overflow:auto}
      #modal:has(.hm-viewer) .modal-body{padding-right:0}
      .hm-viewer{color:var(--ink,#15181d)}
      .hm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:0 34px 12px 0}
      .hm-head h2{margin:0;font-size:18px}.hm-head p{margin:4px 0 0;font-size:12px;color:var(--muted,#8a9099)}
      .hm-controls{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:9px;margin-bottom:10px}
      .hm-controls label{display:block;margin:0 0 4px;font-size:11px}.hm-controls select,.hm-controls input{padding:7px 8px;font-size:12px}
      .hm-controls .hm-opacity{display:flex;align-items:center;gap:8px;height:34px}.hm-controls input[type=range]{padding:0}
      .hm-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;margin:0 0 8px;color:var(--muted,#8a9099)}
      .hm-summary b{color:var(--ink,#15181d)}.hm-summary .hm-error{color:#b42318}
      .hm-stage{height:min(61vh,660px);min-height:300px;position:relative;overflow:hidden;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:#e9edf3;}
      .hm-world{position:absolute;left:50%;top:50%;transform-origin:center center;background:#fff;box-shadow:0 2px 16px #1113;overflow:hidden}
      .hm-world iframe,.hm-world canvas{position:absolute;left:0;top:0;border:0;width:100%;height:100%;}
      .hm-world iframe{background:#fff}.hm-world canvas{pointer-events:none}
      .hm-empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;background:#ffffffdc;color:#596273;font-size:14px;pointer-events:none}
      .hm-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted,#8a9099)}
      @media(max-width:820px){.hm-controls{grid-template-columns:repeat(3,minmax(95px,1fr))}.hm-stage{height:55vh}}
      @media(max-width:520px){.hm-controls{grid-template-columns:repeat(2,minmax(95px,1fr))}.hm-head{display:block}.hm-stage{min-height:260px}}
    `;
    document.head.appendChild(style);
  }

  function todayLocal() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LT.state.timezone || 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function previewUrl(project, relPath) {
    const encoded = String(relPath || '').split('/').map(encodeURIComponent).join('/');
    return `/${encodeURIComponent(project.slug)}/${encoded}`;
  }

  function openViewer(node, project) {
    addCss();
    const today = todayLocal();
    const fromDate = new Date(Date.now() - 29 * 86400000);
    const from = new Intl.DateTimeFormat('en-CA', { timeZone: LT.state.timezone || 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fromDate);
    const shareOptions = (project.shares || []).map(share => `<option value="${attr(share.id)}">${esc(share.label)}</option>`).join('');
    const html = `
      <section class="hm-viewer">
        <div class="hm-head"><div><h2>🔥 Heatmap · ${esc(node.relPath)}</h2><p>Vị trí được cộng gộp theo lưới 24 × 14; không hiển thị phiên của từng người.</p></div></div>
        <div class="hm-controls">
          <div><label for="hm-from">Từ ngày</label><input id="hm-from" type="date" value="${from}"></div>
          <div><label for="hm-to">Đến ngày</label><input id="hm-to" type="date" value="${today}"></div>
          <div><label for="hm-team">Nhóm / link</label><select id="hm-team"><option value="">Tất cả nhóm</option>${shareOptions}</select></div>
          <div><label for="hm-slide">Slide</label><select id="hm-slide"><option value="1">Đang tải…</option></select></div>
          <div><label for="hm-device">Thiết bị</label><select id="hm-device"><option value="all">Tất cả</option><option value="d">Máy tính</option><option value="m">Điện thoại</option></select></div>
          <div><label for="hm-type">Lớp tương tác</label><select id="hm-type"><option value="m">Di chuyển chuột</option><option value="c">Bấm</option><option value="t">Chạm</option></select></div>
          <div><label for="hm-mode">Khung xem</label><select id="hm-mode"><option value="desktop">Máy tính · 1440 px</option><option value="mobile">Điện thoại · 390 px</option></select></div>
          <div><label for="hm-opacity">Độ mờ <span id="hm-opacity-label">65%</span></label><div class="hm-opacity"><input id="hm-opacity" type="range" min="10" max="100" value="65"></div></div>
        </div>
        <div class="hm-summary"><span id="hm-count">Đang tải dữ liệu…</span><span id="hm-status"></span></div>
        <div class="hm-stage"><div class="hm-world"><iframe title="Xem trước slide" scrolling="yes"></iframe><canvas aria-hidden="true"></canvas></div><div class="hm-empty hidden"></div></div>
        <div class="hm-bottom"><span id="hm-slide-count"></span><button class="btn ghost sm" type="button" id="hm-export">Tải PNG lớp heatmap</button></div>
      </section>`;

    const modal = openModal(html, { lightDismiss: true });
    if (!modal) return;
    const q = selector => modal.root.querySelector(selector);
    const stage = q('.hm-stage'), world = q('.hm-world'), frame = q('iframe'), canvas = q('canvas');
    const ctx = canvas.getContext('2d');
    const empty = q('.hm-empty'), slideSelect = q('#hm-slide');
    const filter = {
      from: q('#hm-from'), to: q('#hm-to'), share: q('#hm-team'), device: q('#hm-device'),
      type: q('#hm-type'), mode: q('#hm-mode'), opacity: q('#hm-opacity')
    };
    let slides = [], summary = null, loadId = 0, logical = { width: 1440, height: 810 }, frameReady = false;

    function pickedCells() {
      const row = (summary && summary.bySlide || []).find(item => item.slide === Number(slideSelect.value));
      const cells = Object.create(null);
      if (!row) return { cells, count: 0 };
      const devices = filter.device.value === 'all' ? ['d', 'm'] : [filter.device.value];
      for (const device of devices) {
        const source = row.devices && row.devices[device] && row.devices[device][filter.type.value] || {};
        for (const [cell, raw] of Object.entries(source)) cells[cell] = (cells[cell] || 0) + Number(raw || 0);
      }
      return { cells, count: Object.values(cells).reduce((sum, count) => sum + count, 0) };
    }

    function fitFrame() {
      const width = filter.mode.value === 'mobile' ? 390 : 1440;
      const height = filter.mode.value === 'mobile' ? 844 : 810;
      logical = { width, height };
      world.style.width = width + 'px'; world.style.height = height + 'px';
      frame.style.width = width + 'px'; frame.style.height = height + 'px';
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
      world.style.transform = `translate(-50%,-50%) scale(${scale})`;
      if (frameReady && frame.contentWindow) {
        frame.contentDocument.documentElement.style.width = width + 'px';
        frame.contentDocument.body.style.width = width + 'px';
      }
      draw();
    }

    function draw() {
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(logical.width * dpr); canvas.height = Math.round(logical.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, logical.width, logical.height);
      const selected = pickedCells(), total = selected.count;
      const selectedSlide = slides[Number(slideSelect.value) - 1];
      q('#hm-count').innerHTML = summary
        ? `<b>${total.toLocaleString('vi-VN')}</b> tương tác ở lớp này · ${Number(summary.rows || 0).toLocaleString('vi-VN')} lượt gửi · tổng ${Number(summary.interactions || 0).toLocaleString('vi-VN')} tương tác`
        : 'Đang tải dữ liệu…';
      if (!selectedSlide || !total || !frameReady) {
        empty.classList.remove('hidden');
        empty.textContent = frameReady ? (selectedSlide ? 'Chưa có dữ liệu cho bộ lọc này.' : 'Không tìm thấy slide trong trang.') : 'Đang tải bản xem trước…';
        return;
      }
      empty.classList.add('hidden');
      const rect = selectedSlide.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, logical.width, logical.height); ctx.clip();
      const cellW = rect.width / 24, cellH = rect.height / 14;
      const max = Math.max(...Object.values(selected.cells));
      const opacity = Number(filter.opacity.value) / 100;
      for (const [rawCell, rawCount] of Object.entries(selected.cells)) {
        const count = Number(rawCount); if (!count) continue;
        const idx = Number(rawCell), col = idx % 24, row = Math.floor(idx / 24);
        const x = rect.left + (col + .5) * cellW, y = rect.top + (row + .5) * cellH;
        const strength = Math.max(.08, Math.min(1, count / max));
        const radius = Math.max(cellW, cellH) * 1.55;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const hue = 220 - Math.min(220, strength * 220);
        gradient.addColorStop(0, `hsla(${hue},100%,50%,${opacity * (.38 + .55 * strength)})`);
        gradient.addColorStop(.55, `hsla(${hue},100%,50%,${opacity * .35 * strength})`);
        gradient.addColorStop(1, `hsla(${hue},100%,50%,0)`);
        ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    }

    async function loadSummary() {
      const id = ++loadId;
      const params = new URLSearchParams({ project: project.id, path: `/${project.slug}/${node.relPath}`, from: filter.from.value, to: filter.to.value });
      if (filter.share.value) params.set('share', filter.share.value);
      q('#hm-status').textContent = 'Đang cập nhật…';
      try {
        const data = await api('GET', '/api/heatmap?' + params.toString());
        if (id !== loadId) return;
        summary = data;
        q('#hm-status').textContent = '';
        const rows = data.bySlide || [];
        for (const option of slideSelect.options) {
          const row = rows.find(item => item.slide === Number(option.value));
          const count = row ? Number(row.interactions || 0) : 0;
          option.textContent = `Slide ${option.value} · ${count.toLocaleString('vi-VN')} mẫu`;
        }
        draw();
      } catch (error) {
        if (id !== loadId) return;
        summary = { bySlide: [], rows: 0, interactions: 0 };
        q('#hm-status').innerHTML = `<span class="hm-error">${esc(error.message || 'Không tải được dữ liệu heatmap.')}</span>`;
        draw();
      }
    }

    function findSlides() {
      try {
        const doc = frame.contentDocument;
        slides = Array.from(doc.querySelectorAll('.slide'));
        if (!slides.length) slides = Array.from(doc.querySelectorAll('section[id]'));
        slideSelect.innerHTML = slides.length
          ? slides.map((slide, index) => `<option value="${index + 1}">Slide ${index + 1}</option>`).join('')
          : '<option value="1">Không tìm thấy slide</option>';
        q('#hm-slide-count').textContent = slides.length ? `${slides.length} slide` : 'Không tìm thấy .slide hoặc section[id]';
        frameReady = true;
        if (slides[0]) slides[0].scrollIntoView({ block: 'start' });
        draw(); loadSummary();
        frame.contentWindow.addEventListener('scroll', draw, { passive: true });
      } catch (_) {
        frameReady = true; slides = [];
        empty.classList.remove('hidden'); empty.textContent = 'Không thể đọc bản xem trước slide.';
        q('#hm-slide-count').textContent = '';
      }
    }

    frame.addEventListener('load', findSlides, { once: true });
    frame.src = previewUrl(project, node.relPath);
    slideSelect.addEventListener('change', () => { const slide = slides[Number(slideSelect.value) - 1]; if (slide) slide.scrollIntoView({ block: 'start', behavior: 'smooth' }); draw(); });
    filter.mode.addEventListener('change', fitFrame);
    filter.device.addEventListener('change', draw); filter.type.addEventListener('change', draw);
    filter.opacity.addEventListener('input', () => { q('#hm-opacity-label').textContent = filter.opacity.value + '%'; draw(); });
    [filter.from, filter.to, filter.share].forEach(control => control.addEventListener('change', loadSummary));
    window.addEventListener('resize', fitFrame);
    // Escape, click nền và nút đóng đều đi qua openModal; theo dõi host để dọn iframe.
    const host = modal.root.closest('#modal');
    const observer = new MutationObserver(() => {
      if (!host.classList.contains('hidden')) return;
      observer.disconnect(); window.removeEventListener('resize', fitFrame); frame.src = 'about:blank';
    });
    observer.observe(host, { attributes: true, attributeFilter: ['class'] });
    q('#hm-export').addEventListener('click', () => {
      canvas.toBlob(blob => {
        if (!blob) { toast('Không xuất được PNG.'); return; }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `HTML-Present-Heatmap-${project.slug}-slide-${slideSelect.value}.png`;
        link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }, 'image/png');
    });
    fitFrame();
  }

  LT.contentActions.push({
    id: 'heatmap-view', label: 'Heatmap', icon: '🔥',
    show: node => /\.html?$/i.test(node.relPath || ''),
    run: openViewer
  });
  LT.projectToggles.push({ field: 'heatmap', label: 'Heatmap', hint: 'Thu di chuyển, bấm và chạm' });
})();
