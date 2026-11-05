'use strict';

const COLS = 24, ROWS = 14, CELLS = COLS * ROWS, MAX_SLIDES = 200, MAX_COUNT = 10000;

function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function safeText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

function cleanPayload(payload, context = {}) {
  if (!isObject(payload)) return { error: 'Dữ liệu heatmap không hợp lệ.' };
  const slug = safeText(payload.slug, 120);
  const relPath = safeText(payload.path, 500);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug) || !relPath || relPath.split(/[\\/]/).includes('..')) return { error: 'Dự án hoặc đường dẫn không hợp lệ.' };
  if (payload.dev !== 'd' && payload.dev !== 'm') return { error: 'Loại thiết bị không hợp lệ.' };
  if (!isObject(payload.grid) || Number(payload.grid.cols) !== COLS || Number(payload.grid.rows) !== ROWS) return { error: 'Kích thước lưới không hợp lệ.' };
  if (!isObject(payload.slides)) return { error: 'Thiếu dữ liệu slide.' };

  const slides = {};
  const entries = Object.entries(payload.slides).slice(0, MAX_SLIDES);
  for (const [rawSlide, rawGroups] of entries) {
    const slide = Number(rawSlide);
    if (!Number.isInteger(slide) || slide < 1 || slide > MAX_SLIDES || !isObject(rawGroups)) continue;
    const groups = {};
    for (const type of ['m', 'c', 't']) {
      const rawCells = rawGroups[type];
      if (!isObject(rawCells)) continue;
      const cells = {};
      for (const [rawCell, rawCount] of Object.entries(rawCells).slice(0, CELLS)) {
        const cell = Number(rawCell), count = Number(rawCount);
        if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || !Number.isFinite(count) || count < 1) continue;
        cells[cell] = Math.min(MAX_COUNT, Math.floor(count));
      }
      if (Object.keys(cells).length) groups[type] = cells;
    }
    if (Object.keys(groups).length) slides[slide] = groups;
  }
  if (!Object.keys(slides).length) return { error: 'Không có ô heatmap hợp lệ.' };

  const now = new Date();
  return {
    row: {
      t: now.toISOString(), project: safeText(context.project, 80) || null,
      share: safeText(context.share, 120) || null, slug, path: relPath,
      sid: safeText(payload.sid, 100), vid: safeText(payload.vid, 100),
      dev: payload.dev, grid: { cols: COLS, rows: ROWS }, slides
    }
  };
}

function safeDate(value, fallback, endOfDay = false) {
  const raw = String(value || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+07:00`)
    : (value ? new Date(value) : fallback);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function rangeFrom(opts = {}) {
  const now = new Date(), daysValue = parseInt(opts.days, 10);
  const days = Math.min(366, Math.max(1, Number.isFinite(daysValue) && daysValue > 0 ? daysValue : 30));
  const to = safeDate(opts.to, now, true);
  const from = safeDate(opts.from, new Date(to.getTime() - days * 86400000));
  return { from, to };
}

function shareLabel(project, id) {
  const share = (project && project.shares || []).find(item => item.id === id);
  return share ? share.label : (id ? 'Link khác' : 'Truy cập trực tiếp');
}

function summarize(rows = [], projects = [], opts = {}) {
  const range = rangeFrom(opts);
  const projectsById = new Map(projects.map(p => [p.id, p]));
  const selected = (Array.isArray(rows) ? rows : []).filter(row => {
    const t = Date.parse(row.t || '');
    return Number.isFinite(t) && t >= range.from.getTime() && t <= range.to.getTime()
      && (!opts.project || row.project === opts.project)
      && (!opts.path || row.path === opts.path)
      && (!opts.share || row.share === opts.share);
  });
  const slides = new Map(), days = new Map(), teams = new Map();
  let samples = 0;
  for (const row of selected) {
    const date = new Date(Date.parse(row.t) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const team = shareLabel(projectsById.get(row.project), row.share);
    const dayKey = `${date}|${row.dev}`;
    const day = days.get(dayKey) || { date, dev: row.dev, interactions: 0, rows: 0 };
    day.rows++;
    const teamRow = teams.get(team) || { label: team, interactions: 0, rows: 0 };
    teamRow.rows++;
    for (const [rawSlide, groups] of Object.entries(row.slides || {})) {
      const slide = Number(rawSlide);
      if (!Number.isInteger(slide) || slide < 1 || slide > MAX_SLIDES || !isObject(groups)) continue;
      const item = slides.get(slide) || { slide, interactions: 0, devices: { d: emptyGroups(), m: emptyGroups() } };
      for (const type of ['m', 'c', 't']) {
        const cells = groups[type]; if (!isObject(cells)) continue;
        for (const [rawCell, rawCount] of Object.entries(cells)) {
          const cell = Number(rawCell), count = Number(rawCount);
          if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || !Number.isFinite(count) || count <= 0) continue;
          const n = Math.min(MAX_COUNT, Math.floor(count));
          const deviceGroups = item.devices[row.dev];
          if (deviceGroups) deviceGroups[type][cell] = (deviceGroups[type][cell] || 0) + n;
          item.interactions += n; day.interactions += n; teamRow.interactions += n; samples += n;
        }
      }
      slides.set(slide, item);
    }
    days.set(dayKey, day); teams.set(team, teamRow);
  }
  return {
    from: range.from.toISOString(), to: range.to.toISOString(), rows: selected.length, interactions: samples,
    bySlide: Array.from(slides.values()).sort((a, b) => a.slide - b.slide),
    byDay: Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date) || a.dev.localeCompare(b.dev)),
    byTeam: Array.from(teams.values()).sort((a, b) => b.interactions - a.interactions)
  };
}

function emptyGroups() { return { m: {}, c: {}, t: {} }; }

module.exports = { cleanPayload, summarize };
