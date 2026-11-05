// Lane B (Phase 6) — tổng quan lưu lượng và mức độ xem.
(function () {
  'use strict';

  const LT = window.LT;
  if (!LT) return;

  let panel = null;
  let chart = null;
  let requestVersion = 0;
  let topDeckSort = { key: 'sessions', direction: -1 };
  let ready = false;

  const esc = value => LT.esc(value);
  const fmt = value => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
  const duration = seconds => LT.fmtDur(Math.max(0, Number(seconds) || 0));
  const timezone = () => (LT.state && LT.state.timezone) || 'Asia/Ho_Chi_Minh';

  function dateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: timezone(), day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function ensureStyles() {
    if (document.getElementById('stats-lane-b-style')) return;
    const style = document.createElement('style');
    style.id = 'stats-lane-b-style';
    style.textContent = `
      #statsDashboard .stats-devices{display:grid;gap:14px;margin-top:4px}
      #statsDashboard .stats-device-head{display:flex;justify-content:space-between;gap:12px;font-size:13px}
      #statsDashboard .stats-device-head b{color:var(--ink);font-variant-numeric:tabular-nums}
      #statsDashboard .stats-track{height:9px;margin-top:6px;border-radius:99px;background:var(--soft);overflow:hidden}
      #statsDashboard .stats-track i{display:block;height:100%;border-radius:inherit;background:var(--red)}
      #statsDashboard .stats-device:nth-child(2) .stats-track i{background:#64748b}
      #statsDashboard .stats-sort{border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;cursor:pointer;white-space:nowrap}
      #statsDashboard .stats-sort:hover{color:var(--red)}
      #statsDashboard .stats-sort[aria-pressed="true"]{color:var(--ink)}
      #statsDashboard .stats-number{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      #statsDashboard .stats-recent-ip{font-family:var(--mono);font-size:12px;white-space:nowrap}
      @media(max-width:640px){#statsDashboard .stats-number{white-space:normal}}
    `;
    document.head.appendChild(style);
  }

  function ensureLayout() {
    panel = document.getElementById('tab-stats');
    if (!panel) return false;
    if (ready) return true;
    const cards = document.getElementById('statCards');
    if (!cards) return false;

    ensureStyles();
    let sibling = cards.nextSibling;
    while (sibling) {
      const next = sibling.nextSibling;
      sibling.remove();
      sibling = next;
    }
    const view = document.createElement('div');
    view.id = 'statsDashboard';
    view.className = 'analytics-grid';
    view.innerHTML = `
      <div class="err" id="statsError" role="status" style="grid-column:1/-1"></div>
      <section class="card">
        <div class="cardhead"><h3 class="h">Lượt truy cập theo ngày</h3><span class="muted" id="statsChartRange"></span></div>
        <div class="chart-wrap"><canvas id="statsChart" role="img" aria-label="Lượt truy cập theo ngày"></canvas></div>
      </section>
      <section class="card">
        <div class="cardhead"><h3 class="h">Thiết bị</h3><span class="muted" id="statsDeviceTotal"></span></div>
        <div id="statsDevices"></div>
      </section>
      <section class="card">
        <div class="cardhead"><h3 class="h">Deck nổi bật</h3><span class="muted">Theo phiên xem</span></div>
        <div class="tablewrap"><table id="statsTopDecks">
          <thead><tr>
            <th><button type="button" class="stats-sort" data-top-sort="name">Deck</button></th>
            <th class="stats-number"><button type="button" class="stats-sort" data-top-sort="sessions">Phiên</button></th>
            <th class="stats-number"><button type="button" class="stats-sort" data-top-sort="avgSeconds">TG xem TB</button></th>
            <th class="stats-number"><button type="button" class="stats-sort" data-top-sort="completionRate">Xem hết</button></th>
          </tr></thead><tbody></tbody>
        </table></div>
      </section>
      <section class="card">
        <div class="cardhead"><h3 class="h">Trang được xem nhiều</h3><span class="muted">Tối đa 20 trang</span></div>
        <div class="tablewrap"><table id="statsTopPages"><thead><tr><th>Đường dẫn</th><th class="stats-number">Lượt</th></tr></thead><tbody></tbody></table></div>
      </section>
      <section class="card" style="grid-column:1/-1">
        <div class="cardhead"><h3 class="h">Hoạt động truy cập gần đây</h3><span class="muted">Tối đa 200 lượt mới nhất</span></div>
        <div class="tablewrap" style="max-height:440px"><table id="statsRecent">
          <thead><tr><th>Thời gian</th><th>Khách</th><th>Deck</th><th>Đường dẫn</th></tr></thead><tbody></tbody>
        </table></div>
      </section>`;
    cards.parentNode.insertBefore(view, cards.nextSibling);
    view.addEventListener('click', event => {
      const button = event.target.closest('[data-top-sort]');
      if (!button) return;
      const key = button.dataset.topSort;
      topDeckSort = {
        key,
        direction: topDeckSort.key === key ? -topDeckSort.direction : (key === 'name' ? 1 : -1)
      };
      if (latestEngagement) renderTopDecks(latestEngagement);
    });
    ready = true;
    return true;
  }

  let latestEngagement = null;

  async function ensureChartLibrary() {
    if (window.Chart) return;
    const meta = await LT.api('GET', '/api/vendor/chart.umd.min.js/meta');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.dataset.statsChart = 'true';
      script.src = `/_admin/api/vendor/chart.umd.min.js?v=${encodeURIComponent(meta.mtime)}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Không tải được thư viện biểu đồ.'));
      document.head.appendChild(script);
    });
    if (!window.Chart) throw new Error('Thư viện biểu đồ chưa sẵn sàng.');
  }

  function dailySeries(stats, days) {
    const counts = stats.byDay || {};
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const labels = [];
    const values = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(end.getTime() - offset * 86400000);
      const key = date.toISOString().slice(0, 10);
      labels.push(new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit' }).format(date));
      values.push(Number(counts[key]) || 0);
    }
    return { labels, values };
  }

  function renderTrend(stats, days) {
    const canvas = document.getElementById('statsChart');
    if (!canvas || !window.Chart) return;
    if (chart) chart.destroy();
    const series = dailySeries(stats, days);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#2563eb';
    const match = /^#([\da-f]{6})$/i.exec(color);
    const fill = match
      ? `rgba(${parseInt(match[1].slice(0, 2), 16)},${parseInt(match[1].slice(2, 4), 16)},${parseInt(match[1].slice(4, 6), 16)},.12)`
      : 'rgba(37,99,235,.12)';
    chart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets: [{
        label: 'Lượt truy cập', data: series.values, borderColor: color,
        backgroundColor: fill, fill: true, tension: .28, pointRadius: 2, pointHoverRadius: 4
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function aggregateDecks(engagement) {
    const grouped = new Map();
    for (const page of engagement.perDoc || []) {
      const key = page.project || page.slug || '(không rõ)';
      const item = grouped.get(key) || {
        key, name: page.slug || key, sessions: 0, durationTotal: 0,
        completed: 0, pages: 0
      };
      const sessions = Number(page.sessions) || 0;
      item.sessions += sessions;
      item.durationTotal += (Number(page.avgSeconds) || 0) * sessions;
      item.completed += (Number(page.completionRate) || 0) * sessions;
      item.pages++;
      grouped.set(key, item);
    }
    return Array.from(grouped.values()).map(item => ({
      ...item,
      avgSeconds: item.sessions ? item.durationTotal / item.sessions : 0,
      completionRate: item.sessions ? Math.round(item.completed / item.sessions) : 0
    }));
  }

  function renderTopDecks(engagement) {
    const rows = aggregateDecks(engagement);
    const { key, direction } = topDeckSort;
    rows.sort((a, b) => {
      const left = a[key], right = b[key];
      return (typeof left === 'string' ? left.localeCompare(right, 'vi') : left - right) * direction;
    });
    const tbody = document.querySelector('#statsTopDecks tbody');
    tbody.innerHTML = rows.length ? rows.slice(0, 10).map(item => `
      <tr><td><b>${esc(item.name)}</b><div class="muted" style="font-size:11px">${fmt(item.pages)} trang</div></td>
      <td class="stats-number">${fmt(item.sessions)}</td>
      <td class="stats-number">${esc(duration(item.avgSeconds))}</td>
      <td class="stats-number"><span class="chip ${item.completionRate >= 50 ? 'g' : ''}">${fmt(item.completionRate)}%</span></td></tr>
    `).join('') : '<tr><td colspan="4" class="muted">Chưa có phiên xem trong khoảng này.</td></tr>';
    document.querySelectorAll('#statsTopDecks [data-top-sort]').forEach(button => {
      const active = button.dataset.topSort === key;
      button.setAttribute('aria-pressed', String(active));
      if (!button.dataset.baseLabel) button.dataset.baseLabel = button.textContent;
      button.textContent = button.dataset.baseLabel + (active ? (direction > 0 ? ' ↑' : ' ↓') : '');
    });
  }

  function renderDevices(insights) {
    const root = document.getElementById('statsDevices');
    const mobile = Math.max(0, Number(insights && insights.mobile) || 0);
    const desktop = Math.max(0, Number(insights && insights.desktop) || 0);
    const total = mobile + desktop;
    document.getElementById('statsDeviceTotal').textContent = total ? `${fmt(total)} phiên` : '';
    if (!total) {
      root.innerHTML = '<div class="empty">Chưa có dữ liệu thiết bị.</div>';
      return;
    }
    root.innerHTML = `<div class="stats-devices">${[
      ['Máy tính', desktop], ['Điện thoại', mobile]
    ].map(([label, count]) => {
      const percent = Math.round(count / total * 100);
      return `<div class="stats-device"><div class="stats-device-head"><span>${label}</span><b>${fmt(count)} · ${percent}%</b></div>
        <div class="stats-track"><i style="width:${percent}%"></i></div></div>`;
    }).join('')}</div>`;
  }

  function renderTopPages(stats) {
    const pages = stats.topPages || [];
    const tbody = document.querySelector('#statsTopPages tbody');
    tbody.innerHTML = pages.length
      ? pages.map(([path, count]) => `<tr><td class="mono">${esc(path || '/')}</td><td class="stats-number">${fmt(count)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">Chưa có dữ liệu trang.</td></tr>';
  }

  function renderRecent(stats) {
    const rows = stats.recent || [];
    const tbody = document.querySelector('#statsRecent tbody');
    tbody.innerHTML = rows.length ? rows.map(row => {
      const visitor = [LT.flag(row.country), row.ip].filter(Boolean).join(' ');
      return `<tr><td>${esc(dateTime(row.t))}</td>
        <td class="stats-recent-ip">${esc(visitor || 'Khách')}</td>
        <td>${esc(row.slug || '—')}</td><td class="mono">${esc(row.path || '/')}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="muted">Chưa có lượt truy cập nào.</td></tr>';
  }

  function weightedAverage(pages, field) {
    const total = pages.reduce((sum, page) => sum + (Number(page.sessions) || 0), 0);
    if (!total) return 0;
    return pages.reduce((sum, page) => sum + (Number(page[field]) || 0) * (Number(page.sessions) || 0), 0) / total;
  }

  function renderKpis(stats, engagement, days) {
    const pages = engagement.perDoc || [];
    const sessions = pages.reduce((sum, page) => sum + (Number(page.sessions) || 0), 0);
    const visitors = engagement.insights && engagement.insights.uniqueVisitors != null
      ? engagement.insights.uniqueVisitors : stats.uniqueVisitors;
    const cards = [
      ['Lượt xem trang', fmt(stats.pageViews)],
      ['Khách duy nhất', fmt(visitors)],
      [`Phiên xem · ${days} ngày`, fmt(sessions)],
      ['Thời lượng xem TB', duration(weightedAverage(pages, 'avgSeconds'))],
      ['Tỷ lệ xem hết', `${Math.round(weightedAverage(pages, 'completionRate'))}%`]
    ];
    document.getElementById('statCards').innerHTML = cards.map(([label, value]) =>
      `<div class="stat"><div class="n">${esc(value)}</div><div class="l">${esc(label)}</div></div>`).join('');
  }

  function showError(message) {
    const error = document.getElementById('statsError');
    if (error) error.textContent = message || '';
  }

  async function loadStats() {
    if (!ensureLayout()) return;
    const version = ++requestVersion;
    const days = Number(document.getElementById('statDays').value) || 30;
    const project = document.getElementById('statProject').value;
    const query = `days=${encodeURIComponent(days)}${project ? `&project=${encodeURIComponent(project)}` : ''}`;
    showError('');
    try {
      const [stats, engagement] = await Promise.all([
        LT.api('GET', `/api/stats?${query}`),
        LT.api('GET', `/api/engagement?${query}`)
      ]);
      if (version !== requestVersion) return;
      latestEngagement = engagement;
      renderKpis(stats, engagement, days);
      renderTopDecks(engagement);
      renderDevices(engagement.insights || {});
      renderTopPages(stats);
      renderRecent(stats);
      document.getElementById('statsChartRange').textContent = `${days} ngày gần đây · yêu cầu`;
      try {
        await ensureChartLibrary();
        if (version === requestVersion) renderTrend(stats, days);
      } catch (error) {
        if (version === requestVersion) showError(error.message || 'Không tải được biểu đồ.');
      }
    } catch (error) {
      if (version === requestVersion) showError(error.message || 'Không tải được số liệu.');
    }
  }

  LT.tabs.stats = loadStats;
  // Giữ tương thích các onchange/onclick cũ trong admin.html.
  window.loadStats = loadStats;
})();
