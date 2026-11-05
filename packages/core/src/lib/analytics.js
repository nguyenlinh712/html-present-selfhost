'use strict';

function clampDays(value, fallback = 30) {
  const n = parseInt(value, 10);
  return Math.min(366, Math.max(1, Number.isFinite(n) && n > 0 ? n : fallback));
}
function safeDate(value, fallback, endOfDay = false) {
  const raw = String(value || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+07:00`)
    : (value ? new Date(value) : fallback);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
function filterRange(opts = {}) {
  const now = new Date();
  const days = clampDays(opts.days);
  const to = safeDate(opts.to, now, true);
  const from = safeDate(opts.from, new Date(to.getTime() - days * 86400000));
  return { from, to, days };
}
function eventInRange(e, range) {
  const time = Date.parse(e.t || '');
  return Number.isFinite(time) && time >= range.from.getTime() && time <= range.to.getTime();
}
function browserName(e) {
  const brands = e.env && e.env.brands;
  if (Array.isArray(brands) && brands.length) {
    const brand = brands.find(x => x && !/not.?a.?brand/i.test(x.brand || '')) || brands[0];
    return String(brand.brand || 'Khác');
  }
  const ua = String(e.ua || '');
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Khác';
}
function visitorKey(s) { return s.vid || s.ip || s.sid; }
function projectShareLabel(project, shareId) {
  const share = (project && project.shares || []).find(s => s.id === shareId);
  return share ? share.label : (shareId ? 'Link khác' : 'Truy cập trực tiếp');
}

function buildSessions(events, opts = {}) {
  const range = filterRange(opts);
  const selected = events.filter(e => {
    if (!eventInRange(e, range)) return false;
    if (opts.project && e.project !== opts.project) return false;
    if (opts.path && e.path !== opts.path) return false;
    if (opts.share && e.share !== opts.share) return false;
    return true;
  }).sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')));
  const sessions = new Map();
  const clickEvents = [];
  for (const e of selected) {
    if (e.type === 'click' && e.href) clickEvents.push(e);
    const sid = String(e.sid || '');
    if (!sid) continue;
    const key = [e.project || e.slug || '', sid, e.path || ''].join('|');
    let s = sessions.get(key);
    if (!s) {
      s = {
        sid, vid: e.vid || '', project: e.project || '', slug: e.slug || '', path: e.path || '',
        ip: e.ip || '', country: e.country || '', share: e.share || null,
        mobile: !!e.mobile, env: e.env || {}, utm: e.utm || {}, referrer: e.referrer || '',
        total: 0, maxSlide: 0, seconds: 0, durationTotal: 0, engagedTime: 0,
        st: {}, scrollDepth: 0, interactions: 0, idleSeconds: 0, tabSwitches: 0,
        revisits: 0, exitSlide: 0, rageClicks: 0, copyAttempt: 0, printAttempt: 0,
        start: e.t || '', last: e.t || '', types: new Set()
      };
      sessions.set(key, s);
    }
    s.types.add(e.type);
    if (!s.start || e.t < s.start) s.start = e.t;
    if (!s.last || e.t > s.last) s.last = e.t;
    if (e.vid) s.vid = e.vid;
    if (e.ip) s.ip = e.ip;
    if (e.country) s.country = e.country;
    if (e.share) s.share = e.share;
    if (e.env && Object.keys(e.env).length) s.env = e.env;
    if (e.utm && Object.keys(e.utm).length) s.utm = e.utm;
    if (e.referrer) s.referrer = e.referrer;
    s.mobile = e.mobile !== undefined ? !!e.mobile : s.mobile;
    s.total = Math.max(s.total, Number(e.total) || 0);
    s.maxSlide = Math.max(s.maxSlide, Number(e.maxSlide) || Number(e.slide) || 0);
    s.seconds = Math.max(s.seconds, Number(e.seconds) || 0);
    s.durationTotal = Math.max(s.durationTotal, Number(e.durationTotal) || Number(e.seconds) || 0);
    s.engagedTime = Math.max(s.engagedTime, Number(e.engagedTime) || Number(e.seconds) || 0);
    s.scrollDepth = Math.max(s.scrollDepth, Number(e.scrollDepth) || 0);
    for (const field of ['interactions', 'tabSwitches', 'revisits', 'rageClicks', 'copyAttempt', 'printAttempt']) {
      s[field] = Math.max(s[field], Number(e[field]) || 0);
    }
    if (e.idleSeconds !== undefined) s.idleSeconds = Number(e.idleSeconds) || 0;
    if (e.exitSlide) s.exitSlide = Number(e.exitSlide);
    if (e.st && typeof e.st === 'object') {
      for (const [idx, seconds] of Object.entries(e.st)) s.st[idx] = Math.max(s.st[idx] || 0, Number(seconds) || 0);
    }
  }
  return { sessions: Array.from(sessions.values()), clickEvents, range, selected };
}

function summarize(input = {}) {
  const { events = [], projects = [], ...opts } = input;
  const { sessions, clickEvents, range } = buildSessions(events, opts);
  const projectMap = new Map(projects.map(p => [p.id, p]));
  const visitors = new Map();
  for (const s of sessions) {
    const k = visitorKey(s); if (!k) continue;
    visitors.set(k, (visitors.get(k) || 0) + 1);
  }
  const seconds = sessions.map(s => s.seconds);
  const completed = sessions.filter(s => s.total && s.maxSlide >= s.total).length;
  const engaged = sessions.filter(s => s.engagedTime >= 10 && s.maxSlide >= 2).length;
  const byDay = new Map(), byHourDay = Array.from({ length: 7 }, () => Array(24).fill(0));
  const bySlide = new Map(), bySlideDwell = new Map(), byDevice = new Map(), byBrowser = new Map(), bySource = new Map(), byTeam = new Map(), byDoc = new Map();
  const byShare = new Map();   // Lane A (Phase 6): tổng hợp giàu theo link khách cho trang Phân tích hành vi.
  const byCountry = new Map();
  for (const s of sessions) {
    const when = new Date(Date.parse(s.start || s.last) + 7 * 60 * 60 * 1000);
    const day = when.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    byHourDay[when.getDay()][when.getHours()]++;
    const device = s.mobile || (s.env && s.env.mobile) ? 'Điện thoại' : 'Máy tính';
    byDevice.set(device, (byDevice.get(device) || 0) + 1);
    const browser = browserName(s);
    byBrowser.set(browser, (byBrowser.get(browser) || 0) + 1);
    const source = s.utm && s.utm.source || (s.referrer ? (() => { try { return new URL(s.referrer).hostname; } catch (_) { return 'Khác'; } })() : 'Truy cập trực tiếp');
    bySource.set(source, (bySource.get(source) || 0) + 1);
    const country = s.country || 'Không rõ';
    byCountry.set(country, (byCountry.get(country) || 0) + 1);
    const project = projectMap.get(s.project);
    const team = projectShareLabel(project, s.share);
    byTeam.set(team, (byTeam.get(team) || 0) + 1);
    // Gom theo từng link khách (share). Khóa theo project+share để không trộn
    // hai link trùng id rỗng của hai dự án; share rỗng = truy cập trực tiếp.
    const shareKey = [s.project || '', s.share || ''].join('|');
    let sh = byShare.get(shareKey);
    if (!sh) {
      sh = { share: s.share || null, project: s.project, slug: s.slug, sessions: 0, visitors: new Set(),
        completed: 0, engaged: 0, seconds: [], mobile: 0, countries: new Map(),
        copyAttempt: 0, printAttempt: 0, rageClicks: 0, first: '', last: '' };
      byShare.set(shareKey, sh);
    }
    sh.sessions++; sh.visitors.add(visitorKey(s)); sh.seconds.push(s.seconds);
    if (s.total && s.maxSlide >= s.total) sh.completed++;
    if (s.engagedTime >= 10 && s.maxSlide >= 2) sh.engaged++;
    if (s.mobile || (s.env && s.env.mobile)) sh.mobile++;
    if (s.country) sh.countries.set(s.country, (sh.countries.get(s.country) || 0) + 1);
    sh.copyAttempt += Number(s.copyAttempt) || 0;
    sh.printAttempt += Number(s.printAttempt) || 0;
    sh.rageClicks += Number(s.rageClicks) || 0;
    if (!sh.last || String(s.last) > sh.last) sh.last = s.last || '';
    const firstSeen = s.start || s.last || '';
    if (firstSeen && (!sh.first || String(firstSeen) < sh.first)) sh.first = firstSeen;
    const docKey = [s.project, s.path].join('|');
    const d = byDoc.get(docKey) || { project: s.project, slug: s.slug, path: s.path, sessions: 0, visitors: new Set(), completed: 0, engaged: 0, seconds: [], slideTimes: {}, funnel: {} };
    d.sessions++; d.visitors.add(visitorKey(s)); d.seconds.push(s.seconds);
    if (s.total && s.maxSlide >= s.total) d.completed++;
    if (s.engagedTime >= 10 && s.maxSlide >= 2) d.engaged++;
    for (let i = 1; i <= s.maxSlide; i++) d.funnel[i] = (d.funnel[i] || 0) + 1;
    for (const [idx, sec] of Object.entries(s.st)) {
      if (sec <= 0) continue;
      const agg = d.slideTimes[idx] || (d.slideTimes[idx] = { total: 0, count: 0 });
      agg.total += sec; agg.count++;
      const global = bySlide.get(idx) || { seconds: 0, samples: 0 };
      global.seconds += sec; global.samples++; bySlide.set(idx, global);
      const dwell = bySlideDwell.get(idx) || { values: [], sessions: 0, exits: 0 };
      dwell.values.push(sec); dwell.sessions++;
      if (Number(s.exitSlide) === Number(idx)) dwell.exits++;
      bySlideDwell.set(idx, dwell);
    }
    byDoc.set(docKey, d);
  }
  const ctas = new Map();
  for (const e of clickEvents) {
    const key = String(e.href).slice(0, 300);
    const item = ctas.get(key) || { href: key, text: e.text || '', count: 0 };
    item.count++; if (e.text) item.text = e.text;
    ctas.set(key, item);
  }
  const byCta = new Map();
  for (const e of clickEvents) {
    const key = [e.project || e.slug || '', String(e.href).slice(0, 300), e.text || ''].join('|');
    const item = byCta.get(key) || { project: e.project || '', slug: e.slug || '', href: String(e.href).slice(0, 300), text: e.text || '', clicks: 0, visitors: new Set(), shares: new Map(), shareVisitors: new Map() };
    item.clicks++;
    const visitor = visitorKey(e); if (visitor) item.visitors.add(visitor);
    const shareKey = e.share || '';
    item.shares.set(shareKey, (item.shares.get(shareKey) || 0) + 1);
    if (visitor) {
      const visitors = item.shareVisitors.get(shareKey) || new Set();
      visitors.add(visitor); item.shareVisitors.set(shareKey, visitors);
    }
    byCta.set(key, item);
  }
  const perDoc = Array.from(byDoc.values()).map(d => ({
    project: d.project, slug: d.slug, path: d.path, sessions: d.sessions, visitors: d.visitors.size,
    avgSeconds: Math.round(d.seconds.reduce((a, b) => a + b, 0) / Math.max(1, d.seconds.length)),
    completionRate: Math.round(100 * d.completed / Math.max(1, d.sessions)),
    engagedRate: Math.round(100 * d.engaged / Math.max(1, d.sessions)),
    funnel: Array.from({ length: Math.max(1, ...Object.keys(d.funnel).map(Number)) }, (_, i) => d.funnel[i + 1] || 0),
    slideTimes: Object.fromEntries(Object.entries(d.slideTimes).map(([i, x]) => [i, Math.round(x.total / Math.max(1, x.count))]))
  })).sort((a, b) => b.sessions - a.sessions);
  const recent = sessions.slice().sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 100).map(s => ({
    t: s.last, project: s.project, slug: s.slug, path: s.path, sid: s.sid, vid: s.vid,
    ip: s.ip, country: s.country, share: s.share, mobile: s.mobile,
    seconds: s.seconds, engagedTime: s.engagedTime, maxSlide: s.maxSlide, total: s.total,
    scrollDepth: s.scrollDepth, interactions: s.interactions, utm: s.utm
  }));
  return {
    from: range.from.toISOString(), to: range.to.toISOString(), days: range.days,
    sessions: sessions.length, visitors: visitors.size,
    returningVisitors: Array.from(visitors.values()).filter(n => n > 1).length,
    avgSeconds: Math.round(seconds.reduce((a, b) => a + b, 0) / Math.max(1, seconds.length)),
    completionRate: Math.round(100 * completed / Math.max(1, sessions.length)),
    engagedRate: Math.round(100 * engaged / Math.max(1, sessions.length)),
    byDay: Array.from(byDay, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    byHourDay, bySlide: Array.from(bySlide, ([slide, x]) => ({ slide: Number(slide), avgSeconds: Math.round(x.seconds / Math.max(1, x.samples)), samples: x.samples })).sort((a, b) => a.slide - b.slide),
    bySlideDwell: Array.from(bySlideDwell, ([slide, x]) => {
      const values = x.values.slice().sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const medianSeconds = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      return { slide: Number(slide), avgSeconds: Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)), medianSeconds: Math.round(medianSeconds), samples: values.length, exitRate: Math.round(100 * x.exits / Math.max(1, x.sessions)) };
    }).sort((a, b) => a.slide - b.slide),
    byDevice: Array.from(byDevice, ([label, count]) => ({ label, count })),
    byBrowser: Array.from(byBrowser, ([label, count]) => ({ label, count })),
    byCountry: Array.from(byCountry, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    bySource: Array.from(bySource, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    byTeam: Array.from(byTeam, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    byShare: Array.from(byShare.values()).map(sh => {
      const project = projectMap.get(sh.project);
      const share = project && (project.shares || []).find(x => x.id === sh.share);
      const topCountry = Array.from(sh.countries).sort((a, b) => b[1] - a[1])[0];
      return {
        share: sh.share, project: sh.project, slug: sh.slug || (project && project.slug) || '',
        label: projectShareLabel(project, sh.share),
        token: share ? share.token : null,
        sessions: sh.sessions, visitors: sh.visitors.size,
        avgSeconds: Math.round(sh.seconds.reduce((a, b) => a + b, 0) / Math.max(1, sh.seconds.length)),
        completionRate: Math.round(100 * sh.completed / Math.max(1, sh.sessions)),
        engagedRate: Math.round(100 * sh.engaged / Math.max(1, sh.sessions)),
        mobilePct: Math.round(100 * sh.mobile / Math.max(1, sh.sessions)),
        topCountry: topCountry ? topCountry[0] : '',
        copyAttempt: sh.copyAttempt, printAttempt: sh.printAttempt, rageClicks: sh.rageClicks,
        first: sh.first || null, last: sh.last || null
      };
    }).sort((a, b) => b.sessions - a.sessions),
    topCta: Array.from(ctas.values()).sort((a, b) => b.count - a.count).slice(0, 20),
    byCta: Array.from(byCta.values()).map(item => ({ ...item, visitors: item.visitors.size, byShare: Object.fromEntries(Array.from(item.shares, ([share, clicks]) => [share, { clicks, visitors: (item.shareVisitors.get(share) || new Set()).size }])) })).sort((a, b) => b.clicks - a.clicks).slice(0, 50),
    perDoc, recent
  };
}

function viewsByPath(events, projectId, days = 90) {
  const { sessions } = buildSessions(events, { project: projectId, days });
  const out = {};
  for (const s of sessions) {
    const p = s.path || '';
    const rec = out[p] || (out[p] = { sessions: 0, visitors: new Set(), lastSeen: null });
    rec.sessions++;
    const v = visitorKey(s); if (v) rec.visitors.add(v);
    if (!rec.lastSeen || s.last > rec.lastSeen) rec.lastSeen = s.last;
  }
  for (const rec of Object.values(out)) rec.visitors = rec.visitors.size;
  return out;
}

function accessRows(rows, opts = {}) {
  const range = filterRange(opts);
  return (Array.isArray(rows) ? rows : []).filter(e => eventInRange(e, range) && (!opts.project || e.project === opts.project) && (!opts.path || e.path === opts.path) && (!opts.share || e.share === opts.share));
}

module.exports = { summarize, viewsByPath, accessRows, buildSessions, filterRange };
