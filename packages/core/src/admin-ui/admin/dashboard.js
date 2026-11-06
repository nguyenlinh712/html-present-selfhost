// Lane N — dashboard tổng quan cho thư viện slide.
(function () {
  'use strict';

  const LT = window.LT = window.LT || {};
  let panel = null;
  let chart = null;
  let busy = false;
  let selectedDays = 7;
  let projects = [];
  let allProjects = [];
  let notifyReady = false;
  let notifyTimer = null;
  let notifyPanel = null;
  const notifyStorageKey = 'htmlpresent.admin.notifications.v1';

  const $ = selector => panel && panel.querySelector(selector);
  const esc = value => LT.esc ? LT.esc(value) : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = value => LT.attr ? LT.attr(value) : esc(value).replace(/'/g, '&#39;');
  const fmt = value => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
  const dateTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: LT.state && LT.state.timezone || 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  };

  function readNotifyState() {
    try { return JSON.parse(localStorage.getItem(notifyStorageKey) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeNotifyState(state) {
    try { localStorage.setItem(notifyStorageKey, JSON.stringify(state)); } catch (_) {}
  }
  function setNotifyBadge(count) {
    const badge = document.getElementById('ltNotifyBadge');
    if (!badge) return;
    const n = Math.max(0, Number(count) || 0);
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
  }
  function bindNotifications() {
    if (notifyReady) return;
    const button = document.getElementById('ltNotifyButton');
    if (!button) return;
    notifyReady = true;
    // Thay emoji 🔔 (lệch, không đều) bằng icon SVG đơn giản, canh giữa trong ô vuông.
    const badge = document.getElementById('ltNotifyBadge');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    if (badge) button.appendChild(badge);
    const state = readNotifyState();
    setNotifyBadge(state.unread || 0);
    button.addEventListener('click', (event) => { event.stopPropagation(); toggleNotifyPanel(); });
  }

  /* -------- Dropdown danh sách thông báo (mở khi bấm chuông) -------- */
  function ensureNotifyPanel() {
    if (notifyPanel) return notifyPanel;
    notifyPanel = document.createElement('div');
    notifyPanel.className = 'lt-notify-panel';
    notifyPanel.id = 'ltNotifyPanel';
    notifyPanel.hidden = true;
    document.body.appendChild(notifyPanel);
    document.addEventListener('click', (event) => {
      if (notifyPanel.hidden) return;
      const button = document.getElementById('ltNotifyButton');
      if (notifyPanel.contains(event.target) || (button && button.contains(event.target))) return;
      closeNotifyPanel();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeNotifyPanel(); });
    window.addEventListener('resize', () => { if (!notifyPanel.hidden) positionNotifyPanel(); });
    return notifyPanel;
  }
  function positionNotifyPanel() {
    const button = document.getElementById('ltNotifyButton');
    if (!button || !notifyPanel) return;
    const rect = button.getBoundingClientRect();
    const width = notifyPanel.offsetWidth || 340;
    // Neo mép phải panel vào chuông, nhưng clamp để luôn nằm trong màn hình (mobile: chuông ở giữa).
    let left = Math.min(rect.right - width, window.innerWidth - width - 12);
    left = Math.max(12, left);
    notifyPanel.style.left = Math.round(left) + 'px';
    notifyPanel.style.right = 'auto';
    notifyPanel.style.top = Math.round(rect.bottom + 6) + 'px';
  }
  function closeNotifyPanel() { if (notifyPanel) notifyPanel.hidden = true; }
  async function toggleNotifyPanel() {
    const node = ensureNotifyPanel();
    if (!node.hidden) { closeNotifyPanel(); return; }
    node.hidden = false;
    positionNotifyPanel();
    node.innerHTML = '<div class="lt-notify-head"><span>Thông báo</span></div><div class="lt-notify-empty">Đang tải…</div>';
    const next = { ...readNotifyState(), unread: 0, readAt: new Date().toISOString() };
    writeNotifyState(next); setNotifyBadge(0);
    await renderNotifyList(node);
  }
  async function renderNotifyList(node) {
    let items = [];
    try {
      const [data, leadResult] = await Promise.all([
        LT.api('GET', '/api/analytics?days=7').catch(() => ({})),
        LT.api('GET', '/api/leads?days=7').catch(() => ({ leads: [] }))
      ]);
      const leads = Array.isArray(leadResult) ? leadResult : (leadResult && leadResult.leads) || [];
      const recent = (data && data.recent) || [];
      leads.forEach(r => items.push({
        t: r.t, icon: '📩',
        html: `<b>Lead mới</b> · ${esc(r.name || 'Khách')}${r.phone ? ' · ' + esc(r.phone) : (r.email ? ' · ' + esc(r.email) : '')}`
      }));
      recent.forEach(r => items.push({
        t: r.t, icon: '👁',
        html: `Khách mở <b>${esc(r.slug || r.project || 'deck')}</b>${r.path ? ' / ' + esc(r.path) : ''}`
      }));
      items = items.filter(x => x.t).sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 15);
    } catch (_) { items = []; }
    if (node.hidden) return;
    const head = `<div class="lt-notify-head"><span>Thông báo</span>${items.length ? '<button type="button" class="lt-notify-clear" id="ltNotifyGoto">Xem tổng quan</button>' : ''}</div>`;
    const body = items.length
      ? items.map(x => `<div class="lt-notify-item"><span class="ic" aria-hidden="true">${x.icon}</span><span class="tx">${x.html}<div class="tm">${esc(dateTime(x.t))}</div></span></div>`).join('')
      : '<div class="lt-notify-empty">Chưa có hoạt động nào gần đây.</div>';
    node.innerHTML = head + body;
    const goto = node.querySelector('#ltNotifyGoto');
    if (goto) goto.addEventListener('click', () => { closeNotifyPanel(); if (LT.showTab) LT.showTab('dashboard'); });
  }
  function notificationTimestamp(data, leads) {
    const activity = (data && data.recent || []).map(row => Date.parse(row.t || '')).filter(Number.isFinite);
    const leadTimes = (leads || []).map(row => Date.parse(row.t || '')).filter(Number.isFinite);
    return { activity: activity.length ? Math.max(...activity) : 0, lead: leadTimes.length ? Math.max(...leadTimes) : 0 };
  }
  async function pollNotifications(initial = false) {
    bindNotifications();
    try {
      const [data, leadResult] = await Promise.all([
        LT.api('GET', '/api/analytics?days=1'),
        LT.api('GET', '/api/leads?days=1').catch(() => ({ leads: [] }))
      ]);
      const leads = Array.isArray(leadResult) ? leadResult : (leadResult && leadResult.leads) || [];
      const current = notificationTimestamp(data, leads);
      const previous = readNotifyState();
      if (initial || (!previous.activityAt && !previous.leadAt)) {
        writeNotifyState({ ...previous, activityAt: current.activity, leadAt: current.lead, unread: Number(previous.unread) || 0 });
        setNotifyBadge(previous.unread || 0);
        return;
      }
      const activityNew = current.activity > (Number(previous.activityAt) || 0);
      const leadNew = current.lead > (Number(previous.leadAt) || 0);
      const increment = (activityNew ? (data.recent || []).filter(row => Date.parse(row.t || '') > (Number(previous.activityAt) || 0)).length : 0)
        + (leadNew ? leads.filter(row => Date.parse(row.t || '') > (Number(previous.leadAt) || 0)).length : 0);
      const unread = Math.min(99, (Number(previous.unread) || 0) + increment);
      writeNotifyState({ ...previous, activityAt: Math.max(Number(previous.activityAt) || 0, current.activity), leadAt: Math.max(Number(previous.leadAt) || 0, current.lead), unread });
      setNotifyBadge(unread);
      if (leadNew) LT.toast('Có lead mới từ khách hàng.');
      else if (activityNew) LT.toast('Có khách vừa mở deck.');
    } catch (_) {}
  }

  function ensurePanel() {
    if (!panel) panel = document.getElementById('tab-dashboard');
    if (!panel || panel.dataset.dashboardReady) return panel;
    panel.dataset.dashboardReady = 'true';
    if (!document.getElementById('dashboard-style')) {
      const style = document.createElement('style');
      style.id = 'dashboard-style';
      style.textContent = `
        .dashboard-top-list{list-style:none;margin:0;padding:0}
        .dashboard-top-list li{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
        .dashboard-top-list li:last-child{border-bottom:0}
        .dashboard-rank{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--red-soft);color:var(--red);font-size:12px;font-weight:800}
        .dashboard-project-link{flex:1;min-width:0;border:0;padding:0;text-align:left;background:none;color:var(--ink);font:600 13px/1.4 var(--font);cursor:pointer}
        .dashboard-project-link:hover{color:var(--red);text-decoration:underline}
        .dashboard-top-list li>b{font-size:13px;font-variant-numeric:tabular-nums}
        .dashboard-warnings{display:grid;gap:8px}
        .dashboard-warning{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
        .dashboard-warning-copy{display:flex;flex:1;min-width:0;flex-direction:column;font-size:12px}
        .dashboard-warning-copy b{color:var(--ink);font-size:13px}
        .dashboard-warning-copy span{color:var(--muted)}
        .dashboard-warning .chip.sec{background:#fdecec;color:#b42318}
        .dashboard-live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#aeb5c0;vertical-align:middle}
        .dashboard-live-dot.is-live{background:#16a34a;box-shadow:0 0 0 0 rgba(22,163,74,.5);animation:dashboard-pulse 1.6s ease-out infinite}
        @keyframes dashboard-pulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.5)}70%{box-shadow:0 0 0 7px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}
        .dashboard-live-list{list-style:none;margin:0;padding:0}
        .dashboard-live-list li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
        .dashboard-live-list li:last-child{border-bottom:0}
        .dashboard-live-list .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink);font-weight:600}
        .dashboard-live-list .mt{color:var(--muted);font-size:12px;white-space:nowrap}
        @media(max-width:640px){.dashboard-warning{align-items:flex-start;flex-wrap:wrap}.dashboard-warning-copy{flex-basis:calc(100% - 120px)}}
      `;
      document.head.appendChild(style);
    }
    panel.innerHTML = `
      <div class="pagehead">
        <div><h2>Tổng quan</h2><p>Tình hình thư viện, lượt xem và những việc cần xử lý.</p></div>
        <div class="row">
          <label for="dashboardDays" class="muted" style="font-size:12px">Khoảng thời gian</label>
          <select id="dashboardDays" style="width:auto">
            <option value="7">7 ngày</option><option value="30">30 ngày</option>
          </select>
          <button type="button" class="btn ghost sm" data-dashboard-refresh>Làm mới</button>
        </div>
      </div>
      <div class="err" data-dashboard-error role="alert"></div>
      <div class="grid" data-dashboard-kpis></div>
      <div class="analytics-grid">
        <section class="card">
          <div class="cardhead"><h3 class="h"><span class="dashboard-live-dot" data-dashboard-live-dot></span> Đang xem</h3><span class="muted" data-dashboard-live-count></span></div>
          <div data-dashboard-live></div>
        </section>
        <section class="card">
          <div class="cardhead"><h3 class="h">Link mới được mở</h3><span class="muted">Lần đầu có người xem gần đây</span></div>
          <div data-dashboard-newlinks></div>
        </section>
      </div>
      <div class="analytics-grid">
        <section class="card">
          <div class="cardhead"><h3 class="h">Xu hướng phiên xem</h3><span class="muted" data-dashboard-range></span></div>
          <div class="chart-wrap"><canvas data-dashboard-chart aria-label="Biểu đồ phiên xem theo ngày" role="img"></canvas></div>
        </section>
        <section class="card">
          <div class="cardhead"><h3 class="h">Deck nổi bật</h3><span class="muted">Theo phiên xem</span></div>
          <div data-dashboard-top></div>
        </section>
      </div>
      <section class="card">
        <div class="cardhead"><h3 class="h">Việc cần xử lý</h3><span class="muted" data-dashboard-warning-count></span></div>
        <div data-dashboard-warnings></div>
      </section>
      <section class="card">
        <div class="cardhead"><h3 class="h">Hoạt động gần đây</h3><span class="muted">Tối đa 8 phiên mới nhất</span></div>
        <div class="analytics-table-wrap">
          <table data-dashboard-activity>
            <thead><tr><th>Thời gian</th><th>Deck / slide</th><th>Link</th><th>Tiến độ</th><th></th></tr></thead>
            <tbody><tr><td colspan="5" class="muted">Đang tải…</td></tr></tbody>
          </table>
        </div>
      </section>`;
    panel.addEventListener('click', event => {
      const refresh = event.target.closest('[data-dashboard-refresh]');
      if (refresh) { load(); return; }
      const target = event.target.closest('[data-open-project]');
      if (target) openProject(target.dataset.openProject);
    });
    panel.querySelector('#dashboardDays').addEventListener('change', event => {
      selectedDays = Number(event.target.value) === 30 ? 30 : 7;
      load();
    });
    return panel;
  }

  async function ensureChartLibrary() {
    if (window.Chart) return;
    const meta = await LT.api('GET', '/api/vendor/chart.umd.min.js/meta');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.dataset.dashboardChart = 'true';
      script.src = `/_admin/api/vendor/chart.umd.min.js?v=${encodeURIComponent(meta.mtime)}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Không tải được thư viện biểu đồ.'));
      document.head.appendChild(script);
    });
    if (!window.Chart) throw new Error('Thư viện biểu đồ chưa sẵn sàng.');
  }

  function trendSeries(data, days) {
    const counts = new Map((data.byDay || []).map(item => [item.date, Number(item.count) || 0]));
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const labels = [];
    const values = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(end.getTime() - offset * 86400000).toISOString().slice(0, 10);
      labels.push(date);
      values.push(counts.get(date) || 0);
    }
    return { labels, values };
  }

  function renderKpis(data, activeProjects, warnings) {
    const cards = [
      ['Deck đang hoạt động', fmt(activeProjects.length)],
      [`Phiên xem · ${selectedDays} ngày`, fmt(data.sessions)],
      ['Khách xem', fmt(data.visitors)],
      ['Việc cần xử lý', fmt(warnings.length)]
    ];
    $('[data-dashboard-kpis]').innerHTML = cards.map(([label, value]) =>
      `<div class="stat"><div class="n">${esc(value)}</div><div class="l">${esc(label)}</div></div>`).join('');
  }

  function renderTrend(data) {
    const canvas = $('[data-dashboard-chart]');
    if (!canvas || !window.Chart) return;
    if (chart) chart.destroy();
    const series = trendSeries(data, selectedDays);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#2563eb';
    const match = /^#([\da-f]{6})$/i.exec(color);
    const fill = match
      ? `rgba(${parseInt(match[1].slice(0, 2), 16)},${parseInt(match[1].slice(2, 4), 16)},${parseInt(match[1].slice(4, 6), 16)},.12)`
      : 'rgba(37,99,235,.12)';
    chart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets: [{
        label: 'Phiên xem', data: series.values, borderColor: color,
        backgroundColor: fill,
        fill: true, tension: 0.28, pointRadius: 2, pointHoverRadius: 4
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function sessionsByProject(data) {
    const totals = new Map();
    for (const doc of data.perDoc || []) totals.set(doc.project, (totals.get(doc.project) || 0) + (Number(doc.sessions) || 0));
    return Array.from(totals, ([project, sessions]) => ({ project, sessions }))
      .sort((a, b) => b.sessions - a.sessions).slice(0, 5);
  }

  function renderTopDecks(data) {
    const top = sessionsByProject(data);
    if (!top.length) {
      $('[data-dashboard-top]').innerHTML = '<p class="muted">Chưa có dữ liệu phiên xem trong khoảng này.</p>';
      return;
    }
    $('[data-dashboard-top]').innerHTML = `<ol class="dashboard-top-list">${top.map((item, index) => {
      const project = allProjects.find(candidate => candidate.id === item.project);
      const name = project ? (project.name || project.slug) : (item.project || 'Deck');
      return `<li><span class="dashboard-rank">${index + 1}</span>
        <button type="button" class="dashboard-project-link" data-open-project="${attr(item.project)}">${esc(name)}</button>
        <b>${fmt(item.sessions)}</b></li>`;
    }).join('')}</ol>`;
  }

  function collectWarnings(activeProjects) {
    const now = Date.now();
    const soon = now + 7 * 86400000;
    const warnings = [];
    for (const project of activeProjects) {
      if (project.present === false) warnings.push({
        id: project.id, type: 'present', title: project.name || project.slug,
        detail: 'Chưa bật điều khiển trình chiếu và sửa trực tiếp.'
      });
      const shares = project.shares || [];
      if (!shares.some(share => share.enabled)) warnings.push({
        id: project.id, type: 'share', title: project.name || project.slug,
        detail: 'Chưa có link chia sẻ đang bật.'
      });
      for (const share of shares) {
        if (!share.enabled || !share.expiresAt) continue;
        const expiry = Date.parse(share.expiresAt);
        if (!Number.isFinite(expiry) || expiry > soon) continue;
        warnings.push({
          id: project.id, type: 'expiry', title: `${project.name || project.slug} · ${share.label || 'Link chia sẻ'}`,
          detail: expiry <= now ? 'Link đã hết hạn.' : `Link hết hạn ${dateTime(share.expiresAt)}.`
        });
      }
    }
    return warnings;
  }

  // Cảnh báo bảo mật: deck/link có lần thử sao chép hoặc in (từ analytics byShare).
  function collectSecurityWarnings(data) {
    const out = [];
    for (const row of (data && data.byShare) || []) {
      const copy = Number(row.copyAttempt) || 0;
      const print = Number(row.printAttempt) || 0;
      if (copy <= 0 && print <= 0) continue;
      const parts = [];
      if (copy) parts.push(`${fmt(copy)} lần thử sao chép`);
      if (print) parts.push(`${fmt(print)} lần thử in`);
      out.push({
        id: row.project, type: 'security', weight: copy + print,
        title: `${row.slug || 'Deck'} · ${row.label || 'Link'}`,
        detail: parts.join(' · ') + '.'
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // "Đang xem": phiên có nhịp tim trong ~90 giây gần nhất (track.js ping mỗi 15s).
  const LIVE_MS = 90000;
  function renderLive(data) {
    const now = Date.now();
    const live = (data.recent || [])
      .filter(r => { const t = Date.parse(r.t); return Number.isFinite(t) && now - t <= LIVE_MS; })
      .sort((a, b) => String(b.t).localeCompare(String(a.t)));
    const dot = $('[data-dashboard-live-dot]');
    if (dot) dot.classList.toggle('is-live', live.length > 0);
    const count = $('[data-dashboard-live-count]');
    if (count) count.textContent = live.length ? `${fmt(live.length)} phiên đang hoạt động` : 'Không có ai đang xem';
    const el = $('[data-dashboard-live]');
    if (!el) return;
    if (!live.length) { el.innerHTML = '<p class="muted" style="font-size:13px;margin:0">Hiện chưa có ai đang xem.</p>'; return; }
    el.innerHTML = `<ul class="dashboard-live-list">${live.slice(0, 12).map(r => {
      const project = allProjects.find(p => p.id === r.project);
      const share = project && (project.shares || []).find(s => s.id === r.share);
      const name = (project && (project.name || project.slug)) || r.slug || 'Deck';
      const ago = Math.max(0, Math.round((now - Date.parse(r.t)) / 1000));
      return `<li><span class="nm">${esc(name)}${r.path ? ` · ${esc(r.path)}` : ''}</span>
        <span class="mt">${esc(share ? share.label : (r.share ? 'Link khác' : 'Trực tiếp'))} · slide ${fmt(r.maxSlide)}/${fmt(r.total)} · ${ago < 60 ? ago + 's' : Math.round(ago / 60) + 'p'} trước</span></li>`;
    }).join('')}</ul>`;
  }

  // "Link mới được mở": link có lượt xem lần đầu (trong khoảng đang xem) gần đây.
  // Ghi chú: 'first' là lần xuất hiện sớm nhất trong khoảng thời gian đã chọn.
  function renderNewLinks(data) {
    const el = $('[data-dashboard-newlinks]');
    if (!el) return;
    const now = Date.now();
    const WINDOW = 7 * 86400000;
    const rows = (data.byShare || [])
      .filter(r => r.share && r.first)
      .map(r => ({ ...r, firstMs: Date.parse(r.first) }))
      .filter(r => Number.isFinite(r.firstMs) && now - r.firstMs <= WINDOW)
      .sort((a, b) => b.firstMs - a.firstMs)
      .slice(0, 10);
    if (!rows.length) { el.innerHTML = '<p class="muted" style="font-size:13px;margin:0">Chưa có link nào được mở lần đầu gần đây.</p>'; return; }
    el.innerHTML = `<ul class="dashboard-live-list">${rows.map(r => {
      const project = allProjects.find(p => p.id === r.project);
      const name = (project && (project.name || project.slug)) || r.slug || 'Deck';
      const ageH = Math.round((now - r.firstMs) / 3600000);
      const isNew = now - r.firstMs <= 2 * 86400000;
      const when = ageH < 24 ? `${Math.max(0, ageH)}h trước` : `${Math.round(ageH / 24)} ngày trước`;
      return `<li><button type="button" class="dashboard-project-link nm" data-open-project="${attr(r.project)}">${esc(r.label)}${isNew ? ' <span class="chip a" style="font-size:10px;padding:0 6px">MỚI</span>' : ''}</button>
        <span class="mt">${esc(name)} · ${when} · ${fmt(r.sessions)} lượt</span></li>`;
    }).join('')}</ul>`;
  }

  let liveTimer = null;
  function startLivePolling() {
    bindNotifications();
    if (liveTimer) return;
    liveTimer = setInterval(async () => {
      const panelEl = document.getElementById('tab-dashboard');
      if (!panelEl || panelEl.classList.contains('hidden') || !panelEl.isConnected) return;
      try { renderLive(await LT.api('GET', '/api/analytics?days=1')); } catch (_) {}
      pollNotifications(false);
    }, 25000);
    if (!notifyTimer) notifyTimer = setInterval(() => pollNotifications(false), 15000);
  }

  function renderWarnings(warnings) {
    $('[data-dashboard-warning-count]').textContent = warnings.length ? `${warnings.length} mục` : '';
    if (!warnings.length) {
      $('[data-dashboard-warnings]').innerHTML = '<div class="empty-state">Không có việc cần xử lý.</div>';
      return;
    }
    const chipText = { expiry: 'Link sắp hết hạn', present: 'Trình chiếu tắt', share: 'Thiếu link', security: 'Bảo mật' };
    $('[data-dashboard-warnings]').innerHTML = `<div class="dashboard-warnings">${warnings.map(item =>
      `<div class="dashboard-warning"><span class="chip ${item.type === 'security' ? 'sec' : 'a'}">${chipText[item.type] || 'Lưu ý'}</span>
        <div class="dashboard-warning-copy"><b>${esc(item.title)}</b><span>${esc(item.detail)}</span></div>
        <button type="button" class="btn ghost xs" data-open-project="${attr(item.id)}">Mở deck</button></div>`).join('')}</div>`;
  }

  function renderRecent(data) {
    const tbody = $('[data-dashboard-activity] tbody');
    const rows = (data.recent || []).slice().sort((a, b) => String(b.t || '').localeCompare(String(a.t || ''))).slice(0, 8);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Chưa có hoạt động trong khoảng này.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const project = allProjects.find(candidate => candidate.id === row.project);
      const share = project && (project.shares || []).find(item => item.id === row.share);
      return `<tr>
        <td>${esc(dateTime(row.t))}</td>
        <td>${esc((project && (project.name || project.slug) || row.slug || 'Deck') + (row.path ? ` · ${row.path}` : ''))}</td>
        <td>${esc(share ? share.label : (row.share ? 'Link khác' : 'Trực tiếp'))}</td>
        <td>${fmt(row.maxSlide)} / ${fmt(row.total)}</td>
        <td><button type="button" class="btn ghost xs" data-open-project="${attr(row.project)}">Quản lý</button></td>
      </tr>`;
    }).join('');
  }

  function waitForProjectCard(id) {
    const find = () => document.querySelector(`[data-project-id="${CSS.escape(String(id))}"]`);
    const existing = find();
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      const root = document.getElementById('tab-projects') || document.body;
      let done = false;
      const finish = card => {
        if (done) return;
        done = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(card);
      };
      const observer = new MutationObserver(() => { const card = find(); if (card) finish(card); });
      observer.observe(root, { childList: true, subtree: true });
      const timer = window.setTimeout(() => finish(find()), 2200);
    });
  }

  async function openProject(id) {
    const project = allProjects.find(item => item.id === id);
    if (LT.library && LT.library.state) {
      const state = LT.library.state;
      state.archived = project && project.archived ? 'archived' : 'active';
      state.visibility = 'all'; state.links = 'all'; state.updated = 'all'; state.tag = 'all'; state.search = '';
      if (typeof LT.library.refresh === 'function') LT.library.refresh();
      const search = document.getElementById('globalSearch');
      if (search) search.value = '';
    }
    if (typeof LT.showTab === 'function') LT.showTab('projects');
    const card = await waitForProjectCard(id);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
  }

  function setError(message) { $('[data-dashboard-error]').textContent = message || ''; }

  async function load() {
    if (busy || !ensurePanel()) return;
    busy = true;
    const refresh = $('[data-dashboard-refresh]');
    refresh.disabled = true;
    setError('');
    try {
      const [projectList, data] = await Promise.all([
        LT.api('GET', '/api/projects'),
        LT.api('GET', `/api/analytics?days=${selectedDays}`)
      ]);
      allProjects = Array.isArray(projectList) ? projectList : projectList.projects || [];
      projects = allProjects.filter(project => !project.archived);
      const warnings = collectWarnings(projects).concat(collectSecurityWarnings(data));
      $('[data-dashboard-range]').textContent = `${selectedDays} ngày gần đây`;
      renderKpis(data, projects, warnings);
      renderTopDecks(data);
      renderWarnings(warnings);
      renderLive(data);
      renderNewLinks(data);
      renderRecent(data);
      await pollNotifications(true);
      startLivePolling();
      try { await ensureChartLibrary(); renderTrend(data); }
      catch (error) { setError(error.message || 'Không tải được biểu đồ.'); }
    } catch (error) {
      setError(error.message || 'Không tải được dashboard.');
      $('[data-dashboard-top]').innerHTML = '';
      $('[data-dashboard-warnings]').innerHTML = '';
      $('[data-dashboard-activity] tbody').innerHTML = '<tr><td colspan="5" class="muted">Không tải được dữ liệu.</td></tr>';
    } finally {
      busy = false;
      refresh.disabled = false;
    }
  }

  const dashboardPanel = LT.registerTab({
    id: 'dashboard', label: 'Tổng quan', icon: '◧', group: 'content', order: 10,
    init: load
  });
  if (dashboardPanel) {
    const sidebar = document.getElementById('sidebar');
    const button = sidebar && sidebar.querySelector('[data-tab="dashboard"]');
    const projectsButton = sidebar && sidebar.querySelector('[data-tab="projects"]');
    if (button && projectsButton) sidebar.insertBefore(button, projectsButton);
  }

  // Chuông thông báo phải hoạt động độc lập với tab đang mở (trước đây chỉ bind khi
  // mở tab Tổng quan → bấm chuông không ra gì). Bind handler + chạy poll badge ngay.
  bindNotifications();
  pollNotifications(true).catch(() => {});
  if (!notifyTimer) notifyTimer = setInterval(() => pollNotifications(false), 15000);
})();
