// Lane A (Phase 6) — Phân tích hành vi kiểu Cloudflare, bóc tách theo link khách.
(function () {
  'use strict';

  const LT = window.LT = window.LT || {};
  let panel = null, ready = false, busy = false, projects = [];
  const charts = new Map();
  const state = { project: '', share: '', from: '', to: '', path: '' };

  const $ = (sel) => panel && panel.querySelector(sel);
  const primaryColor = () => getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#2563eb';
  const palette = () => [primaryColor(), '#202936', '#f59e0b', '#15803d', '#2563eb', '#9333ea', '#0891b2', '#64748b'];
  const withAlpha = (hex, alpha) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const c = m[1];
    return `rgba(${parseInt(c.slice(0, 2), 16)},${parseInt(c.slice(2, 4), 16)},${parseInt(c.slice(4, 6), 16)},${alpha})`;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = (s) => esc(s).replace(/'/g, '&#39;');
  const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0);
  const dur = (s) => {
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return `${s} giây`;
    const m = Math.floor(s / 60), sec = s % 60;
    return sec ? `${m}p${sec}` : `${m} phút`;
  };
  const dateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', {
      timeZone: (LT.state && LT.state.timezone) || 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(d);
  };
  const option = (value, label, sel) => `<option value="${attr(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;

  async function request(url) {
    const r = await fetch(`/_admin${url}`, { credentials: 'same-origin' });
    let body = null; try { body = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((body && body.error) || `Lỗi ${r.status}`);
    return body;
  }

  async function loadChartLibrary() {
    const meta = await request('/api/vendor/chart.umd.min.js/meta');
    if (!window.Chart || window.Chart.version !== meta.version) {
      await new Promise((resolve, reject) => {
        const old = document.querySelector('script[data-htmlpresent-chart]');
        if (old) old.remove();
        const script = document.createElement('script');
        script.dataset.htmlpresentChart = 'true';
        script.src = `/_admin/api/vendor/chart.umd.min.js?v=${encodeURIComponent(meta.mtime)}`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Không tải được thư viện biểu đồ.'));
        document.head.appendChild(script);
      });
    }
  }

  function ensureStyles() {
    if (document.getElementById('analytics2-style')) return;
    const style = document.createElement('style');
    style.id = 'analytics2-style';
    style.textContent = `
      #tab-analytics .an-filters{display:flex;align-items:end;gap:8px;flex-wrap:wrap}
      #tab-analytics .an-filters label{display:grid;gap:3px;margin:0;font-size:11px;color:var(--muted)}
      #tab-analytics .an-filters select,#tab-analytics .an-filters input{width:auto;min-width:130px;padding:7px 9px;font-size:12px}
      .an-drill{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:13px}
      .an-link-table{width:100%;border-collapse:collapse;font-size:13px}
      .an-link-table th,.an-link-table td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
      .an-link-table th{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}
      .an-link-table td.num,.an-link-table th.num{text-align:right;font-variant-numeric:tabular-nums}
      .an-link-row{cursor:pointer}
      .an-link-row:hover{background:var(--red-soft)}
      .an-link-row.is-current{background:var(--red-soft)}
      .an-link-name{font-weight:600;color:var(--ink)}
      .an-token{font:600 11px/1.4 ui-monospace,Menlo,monospace;color:var(--muted)}
      .an-bar{position:relative;min-width:120px}
      .an-bar>span{position:absolute;inset:0;z-index:0;border-radius:4px;background:color-mix(in srgb,var(--html-present-primary,#2563eb) 14%,transparent)}
      .an-bar>b{position:relative;z-index:1;font-weight:600}
      .an-flag{display:inline-flex;gap:4px;align-items:center}
      .an-sig{display:inline-flex;gap:4px;flex-wrap:wrap}
      .an-sig .chip{background:#fdecec;color:#b42318}
      @media(prefers-color-scheme:dark){.an-sig .chip{background:#3a1a1a;color:#fca5a5}}
      .an-list{list-style:none;margin:0;padding:0}
      .an-list li{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
      .an-list li:last-child{border-bottom:0}
      .an-list .an-list-bar{flex:1;height:7px;border-radius:99px;background:var(--soft);overflow:hidden}
      .an-list .an-list-bar>i{display:block;height:100%;background:var(--html-present-primary,#2563eb)}
      .an-list .an-list-val{font-variant-numeric:tabular-nums;color:var(--muted);min-width:38px;text-align:right}
      .an-list .an-list-label{min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    if (!panel) panel = document.getElementById('tab-analytics');
    if (!panel || panel.dataset.analytics2) return panel;
    panel.dataset.analytics2 = '1';
    ensureStyles();
    panel.innerHTML = `
      <div class="pagehead">
        <div><h2>Phân tích hành vi</h2><p>Lưu lượng & hành vi theo từng link khách.</p></div>
        <div class="an-filters">
          <label>Dự án<select data-an="project"></select></label>
          <label>Link khách<select data-an="share"></select></label>
          <label>Slide<select data-an="path"></select></label>
          <label>Từ ngày<input type="date" data-an="from"></label>
          <label>Đến ngày<input type="date" data-an="to"></label>
          <button type="button" class="btn ghost sm" data-an-refresh>Làm mới</button>
          <button type="button" class="btn ghost sm" data-an-export>Xuất Excel</button>
        </div>
      </div>
      <div class="err" data-an-error role="alert"></div>
      <div class="grid" data-an-kpis></div>

      <section class="card">
        <div class="cardhead"><h3 class="h">Xu hướng phiên xem</h3><span class="muted" data-an-range></span></div>
        <div class="chart-wrap"><canvas data-an-chart="daily" aria-label="Phiên theo ngày" role="img"></canvas></div>
      </section>

      <section class="card">
        <div class="cardhead"><h3 class="h">Theo link khách</h3><span class="muted">Mỗi link = một khách. Bấm để xem riêng.</span></div>
        <div class="an-drill" data-an-drill hidden></div>
        <div class="analytics-table-wrap"><table class="an-link-table" data-an-links><thead><tr>
          <th>Khách / Link</th><th class="num">Phiên</th><th class="num">Khách</th><th class="num">TG TB</th>
          <th class="num">Hoàn thành</th><th class="num">Tương tác</th><th class="num">Mobile</th><th>Quốc gia</th><th>Tín hiệu</th>
        </tr></thead><tbody></tbody></table></div>
      </section>

      <div class="analytics-grid">
        <section class="card"><div class="cardhead"><h3 class="h">Thiết bị</h3></div><div class="chart-wrap sm"><canvas data-an-chart="device" role="img" aria-label="Thiết bị"></canvas></div></section>
        <section class="card"><div class="cardhead"><h3 class="h">Quốc gia</h3></div><div data-an-country></div></section>
        <section class="card"><div class="cardhead"><h3 class="h">Nguồn truy cập</h3></div><div data-an-source></div></section>
      </div>

      <div class="analytics-grid">
        <section class="card">
          <div class="cardhead"><h3 class="h">Phễu theo slide</h3><span class="muted" data-an-funnel-doc></span></div>
          <div class="chart-wrap"><canvas data-an-chart="funnel" role="img" aria-label="Phễu slide"></canvas></div>
        </section>
        <section class="card">
          <div class="cardhead"><h3 class="h">Khung giờ hoạt động</h3><span class="muted">Phiên theo giờ × thứ</span></div>
          <div data-an-heatmap></div>
        </section>
      </div>

      <div class="analytics-grid">
        <section class="card"><div class="cardhead"><h3 class="h">Thời gian dừng theo slide</h3><span class="muted">Trung bình · trung vị · tỷ lệ rời</span></div><div data-an-dwell></div></section>
        <section class="card"><div class="cardhead"><h3 class="h">CTA tạo chuyển đổi</h3><span class="muted">Theo lượt bấm và khách riêng</span></div><div data-an-cta></div></section>
      </div>

      <section class="card">
        <div class="cardhead"><h3 class="h">Tín hiệu bất thường</h3><span class="muted">Thử sao chép / in / rage-click</span></div>
        <div class="grid" data-an-signals></div>
      </section>

      <section class="card">
        <div class="cardhead"><h3 class="h">Phiên gần đây</h3><span class="muted">Tối đa 100 phiên mới nhất</span></div>
        <div class="analytics-table-wrap"><table data-an-sessions><thead><tr>
          <th>Thời gian</th><th>Deck / slide</th><th>Khách</th><th>Link</th><th>Tiến độ</th><th>Thời gian</th><th>Quốc gia</th><th>Thiết bị</th>
        </tr></thead><tbody><tr><td colspan="8" class="muted">Đang tải…</td></tr></tbody></table></div>
      </section>`;

    panel.addEventListener('change', event => {
      const el = event.target.closest('[data-an]');
      if (!el) return;
      state[el.dataset.an] = el.value;
      if (el.dataset.an === 'project') { state.share = ''; state.path = ''; }
      load();
    });
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-an-refresh]')) { load(); return; }
      if (event.target.closest('[data-an-export]')) { exportReport(); return; }
      if (event.target.closest('[data-an-drill-clear]')) { state.share = ''; syncFilterInputs(); load(); return; }
      const row = event.target.closest('.an-link-row');
      if (row) { state.share = row.dataset.share || ''; syncFilterInputs(); load(); }
    });
    return panel;
  }

  function setError(message) { const el = $('[data-an-error]'); if (el) el.textContent = message || ''; }

  function syncFilterInputs() {
    for (const key of ['project', 'share', 'path', 'from', 'to']) {
      const el = $(`[data-an="${key}"]`); if (el && el.value !== state[key]) el.value = state[key];
    }
  }

  function fillProjectOptions() {
    const sel = $('[data-an="project"]');
    sel.innerHTML = option('', 'Tất cả dự án', !state.project) + projects.map(p => option(p.id, p.name || p.slug || p.id, p.id === state.project)).join('');
  }

  function fillShareOptions() {
    const sel = $('[data-an="share"]');
    const shares = [];
    for (const p of projects) {
      if (state.project && p.id !== state.project) continue;
      for (const sh of p.shares || []) if (sh.id) shares.push([sh.id, `${p.name || p.slug}: ${sh.label || 'Link'}`]);
    }
    sel.innerHTML = option('', 'Tất cả link khách', !state.share) + shares.map(([id, label]) => option(id, label, id === state.share)).join('');
  }

  function fillPathOptions(d) {
    const sel = $('[data-an="path"]');
    const docs = (d.perDoc || []).filter(doc => !state.project || doc.project === state.project);
    sel.innerHTML = option('', 'Tất cả slide', !state.path) + docs.map(doc => option(doc.path, `${doc.slug || ''}${doc.path || ''}`, doc.path === state.path)).join('');
  }

  function filterParams() {
    const p = new URLSearchParams();
    for (const key of ['project', 'share', 'from', 'to', 'path']) if (state[key]) p.set(key, state[key]);
    return p.toString();
  }

  const common = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
    plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Be Vietnam Pro, sans-serif', size: 11 } } }, tooltip: { mode: 'index', intersect: false } }
  };
  function draw(key, config) {
    const canvas = $(`[data-an-chart="${key}"]`);
    if (!canvas || !window.Chart) return;
    if (charts.has(key)) charts.get(key).destroy();
    charts.set(key, new window.Chart(canvas, config));
  }

  function renderKpis(d) {
    const cards = [
      ['Phiên xem', fmt(d.sessions)], ['Khách', fmt(d.visitors)], ['Khách quay lại', fmt(d.returningVisitors)],
      ['Thời gian xem TB', dur(d.avgSeconds)], ['Xem hết slide', `${fmt(d.completionRate)}%`], ['Chủ động', `${fmt(d.engagedRate)}%`]
    ];
    $('[data-an-kpis]').innerHTML = cards.map(([l, v]) => `<div class="stat"><div class="n">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  }

  function renderDaily(d) {
    const rows = d.byDay || [];
    draw('daily', {
      type: 'line',
      data: { labels: rows.map(x => x.date), datasets: [{ label: 'Phiên', data: rows.map(x => x.count), borderColor: primaryColor(), backgroundColor: withAlpha(primaryColor(), .12), fill: true, tension: .3, pointRadius: 2 }] },
      options: { ...common, plugins: { ...common.plugins, legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function renderLinks(d) {
    const rows = d.byShare || [];
    const tbody = $('[data-an-links] tbody');
    const drill = $('[data-an-drill]');
    if (state.share) {
      const sh = rows.find(r => r.share === state.share) || projectShareMeta(state.share);
      drill.hidden = false;
      drill.innerHTML = `<button type="button" class="btn ghost xs" data-an-drill-clear>← Tất cả link</button>
        <span class="muted">Đang xem riêng: <b class="an-link-name">${esc(sh ? sh.label : 'Link')}</b></span>
        <button type="button" class="btn ghost xs" data-an-export style="margin-left:auto">⬇ Xuất báo cáo khách này</button>`;
    } else {
      drill.hidden = true; drill.innerHTML = '';
    }
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">Chưa có dữ liệu theo link trong khoảng này.</td></tr>'; return; }
    const max = Math.max(1, ...rows.map(r => r.sessions));
    tbody.innerHTML = rows.map(r => {
      const sig = [];
      if (r.copyAttempt) sig.push(`<span class="chip" title="Lần thử sao chép">⎘ ${fmt(r.copyAttempt)}</span>`);
      if (r.printAttempt) sig.push(`<span class="chip" title="Lần thử in">🖨 ${fmt(r.printAttempt)}</span>`);
      if (r.rageClicks) sig.push(`<span class="chip" title="Rage-click">⚡ ${fmt(r.rageClicks)}</span>`);
      const pct = Math.round(100 * r.sessions / max);
      return `<tr class="an-link-row${r.share === state.share ? ' is-current' : ''}" data-share="${attr(r.share || '')}">
        <td><div class="an-link-name">${esc(r.label)}</div>${r.token ? `<div class="an-token">${esc(String(r.token).slice(0, 10))}…</div>` : ''}</td>
        <td class="num an-bar"><span style="width:${pct}%"></span><b>${fmt(r.sessions)}</b></td>
        <td class="num">${fmt(r.visitors)}</td>
        <td class="num">${esc(dur(r.avgSeconds))}</td>
        <td class="num">${fmt(r.completionRate)}%</td>
        <td class="num">${fmt(r.engagedRate)}%</td>
        <td class="num">${fmt(r.mobilePct)}%</td>
        <td>${esc(r.topCountry || '—')}</td>
        <td><span class="an-sig">${sig.join(' ') || '<span class="muted">—</span>'}</span></td>
      </tr>`;
    }).join('');
  }

  function projectShareMeta(shareId) {
    for (const p of projects) for (const sh of p.shares || []) if (sh.id === shareId) return { label: `${p.name || p.slug}: ${sh.label || 'Link'}`, token: sh.token };
    return null;
  }

  function renderDevice(d) {
    const rows = d.byDevice || [];
    draw('device', {
      type: 'doughnut',
      data: { labels: rows.map(x => x.label), datasets: [{ data: rows.map(x => x.count), backgroundColor: rows.map((_, i) => palette()[i % palette().length]), borderWidth: 0 }] },
      options: { ...common, cutout: '62%', plugins: { ...common.plugins, legend: { position: 'bottom', labels: { ...common.plugins.legend.labels, padding: 12 } } } }
    });
  }

  function renderList(selector, rows, limit = 8) {
    const el = $(selector);
    const items = (rows || []).slice(0, limit);
    if (!items.length) { el.innerHTML = '<p class="muted" style="font-size:13px">Chưa có dữ liệu.</p>'; return; }
    const max = Math.max(1, ...items.map(x => x.count));
    el.innerHTML = `<ul class="an-list">${items.map(x => `
      <li><span class="an-list-label" title="${attr(x.label)}">${esc(x.label)}</span>
        <span class="an-list-bar"><i style="width:${Math.round(100 * x.count / max)}%"></i></span>
        <span class="an-list-val">${fmt(x.count)}</span></li>`).join('')}</ul>`;
  }

  function renderFunnel(d) {
    const docs = (d.perDoc || []).filter(doc => !state.project || doc.project === state.project);
    const doc = docs.find(x => !state.path || x.path === state.path) || docs[0];
    $('[data-an-funnel-doc]').textContent = doc ? `${doc.slug || ''}${doc.path || ''}` : '';
    const funnel = (doc && doc.funnel) || [];
    draw('funnel', {
      type: 'bar',
      data: { labels: funnel.map((_, i) => `Slide ${i + 1}`), datasets: [{ label: 'Phiên đạt tới', data: funnel, backgroundColor: primaryColor(), borderRadius: 5, maxBarThickness: 34 }] },
      options: { ...common, plugins: { ...common.plugins, legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function renderDwell(d) {
    const el = $('[data-an-dwell]');
    const rows = (d.bySlideDwell || []).slice(0, 20);
    if (!rows.length) { el.innerHTML = '<p class="muted">Chưa có dữ liệu thời gian theo slide.</p>'; return; }
    const max = Math.max(1, ...rows.map(row => row.avgSeconds));
    el.innerHTML = `<ul class="an-list">${rows.map(row => `<li>
      <span class="an-list-label">Slide ${fmt(row.slide)}</span>
      <span class="an-list-bar"><i style="width:${Math.round(100 * row.avgSeconds / max)}%"></i></span>
      <span class="an-list-val" title="Trung vị ${dur(row.medianSeconds)} · rời ${row.exitRate}%">${dur(row.avgSeconds)}</span>
      <span class="muted" style="font-size:11px;min-width:52px;text-align:right">rời ${fmt(row.exitRate)}%</span>
    </li>`).join('')}</ul>`;
  }

  function renderCtas(d) {
    const el = $('[data-an-cta]');
    const rows = (d.byCta || []).filter(row => !state.share || Object.prototype.hasOwnProperty.call(row.byShare || {}, state.share)).slice(0, 12);
    if (!rows.length) { el.innerHTML = '<p class="muted">Chưa có lượt bấm CTA.</p>'; return; }
    el.innerHTML = `<div class="tablewrap"><table class="an-link-table"><thead><tr><th>CTA</th><th class="num">Bấm</th><th class="num">Khách</th><th>Link</th></tr></thead><tbody>${rows.map(row => {
      const scoped = state.share && row.byShare ? row.byShare[state.share] : null;
      const shareLabels = Object.keys(row.byShare || {}).map(id => id ? (projectShareMeta(id) || {}).label || 'Link khác' : 'Trực tiếp');
      const selectedLabel = state.share ? ((projectShareMeta(state.share) || {}).label || 'Link khác') : '';
      return `<tr><td><div class="an-link-name">${esc(row.text || row.href)}</div><div class="an-token">${esc(row.href)}</div></td><td class="num">${fmt(scoped ? scoped.clicks : row.clicks)}</td><td class="num">${fmt(scoped ? scoped.visitors : row.visitors)}</td><td>${esc(state.share ? selectedLabel : (shareLabels.join(' · ') || 'Trực tiếp'))}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderHeatmap(matrix) {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const max = Math.max(0, ...matrix.flat());
    const cells = ['<span class="hm-corner"></span>'];
    for (let h = 0; h < 24; h++) cells.push(`<span class="hm-hour">${h % 3 === 0 ? `${String(h).padStart(2, '0')}h` : ''}</span>`);
    matrix.forEach((row, day) => {
      cells.push(`<span class="hm-day">${days[day]}</span>`);
      row.forEach((value, hour) => {
        const alpha = max ? 0.07 + 0.88 * value / max : 0.06;
        cells.push(`<span class="hm-cell" title="${days[day]} ${String(hour).padStart(2, '0')}:00 · ${fmt(value)} phiên" style="--heat:${Math.round(alpha * 100)}%"></span>`);
      });
    });
    $('[data-an-heatmap]').innerHTML = `<div class="heatmap-grid">${cells.join('')}</div><div class="hm-legend"><span>Ít</span><i></i><span>Nhiều</span></div>`;
  }

  function renderSignals(d) {
    const rows = d.byShare || [];
    const sum = (field) => rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);
    const cards = [
      ['Lần thử sao chép', sum('copyAttempt')],
      ['Lần thử in', sum('printAttempt')],
      ['Rage-click', sum('rageClicks')],
      ['Link có tín hiệu', rows.filter(r => r.copyAttempt || r.printAttempt || r.rageClicks).length]
    ];
    $('[data-an-signals]').innerHTML = cards.map(([l, v]) => `<div class="stat"><div class="n">${fmt(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  }

  function renderSessions(rows) {
    const tbody = $('[data-an-sessions] tbody');
    if (!rows || !rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">Chưa có phiên trong khoảng đã chọn.</td></tr>'; return; }
    tbody.innerHTML = rows.map(s => {
      const sh = projectShareMeta(s.share);
      return `<tr>
        <td>${esc(dateTime(s.t))}</td>
        <td>${esc((s.slug || '') + (s.path || ''))}</td>
        <td class="an-token">${esc((s.vid || s.sid || '').slice(0, 10))}</td>
        <td>${esc(sh ? sh.label : (s.share ? 'Link khác' : 'Trực tiếp'))}</td>
        <td>${fmt(s.maxSlide)} / ${fmt(s.total)}</td>
        <td>${esc(dur(s.seconds))}</td>
        <td>${esc(s.country || '—')}</td>
        <td>${s.mobile ? 'Điện thoại' : 'Máy tính'}</td>
      </tr>`;
    }).join('');
  }

  async function loadProjects() {
    if (projects.length) return;
    const result = await request('/api/projects');
    projects = Array.isArray(result) ? result : result.projects || [];
    await Promise.all(projects.map(async p => {
      try { const r = await request(`/api/projects/${encodeURIComponent(p.id)}/content`); p.content = r.content || []; }
      catch (_) { p.content = []; }
    }));
  }

  async function load() {
    if (busy || !ensurePanel()) return;
    busy = true; setError('');
    const refresh = $('[data-an-refresh]'); if (refresh) refresh.disabled = true;
    try {
      await loadProjects();
      fillProjectOptions(); fillShareOptions();
      await loadChartLibrary();
      const d = await request(`/api/analytics?${filterParams()}`);
      fillPathOptions(d);
      $('[data-an-range]').textContent = d.from && d.to ? `${String(d.from).slice(0, 10)} → ${String(d.to).slice(0, 10)}` : '';
      renderKpis(d); renderDaily(d); renderLinks(d);
      renderDevice(d);
      renderList('[data-an-country]', d.byCountry);
      renderList('[data-an-source]', d.bySource);
      renderFunnel(d);
      renderDwell(d);
      renderCtas(d);
      renderHeatmap(d.byHourDay || Array.from({ length: 7 }, () => Array(24).fill(0)));
      renderSignals(d);
      renderSessions(d.recent || []);
    } catch (error) {
      setError(error.message || 'Không tải được dữ liệu phân tích.');
    } finally {
      busy = false; if (refresh) refresh.disabled = false;
    }
  }

  function exportReport() {
    window.location.assign(`/_admin/api/export/report.xlsx?${filterParams()}`);
  }

  async function init() {
    if (!ensurePanel()) return;
    if (!ready) {
      ready = true;
      const today = new Date();
      const iso = (dt) => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 29);
      state.to = iso(today); state.from = iso(fromDate);
      syncFilterInputs();
    }
    await load();
  }

  // Giữ tương thích cách đăng ký tab hiện có trong admin.html.
  LT.tabs = LT.tabs || {};
  LT.tabs.analytics = init;
})();
