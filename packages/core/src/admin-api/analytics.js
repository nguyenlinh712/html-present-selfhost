'use strict';

const analytics = require('../lib/analytics');

function cleanDays(value) {
  return Math.min(366, Math.max(1, parseInt(value, 10) || 30));
}

function buildStats(rows = [], query = {}) {
  const days = cleanDays(query.days);
  const byDay = {}, byProject = {}, byShare = {}, lastSeenByShare = {}, topPages = {}, ips = new Set();
  let pageViews = 0;
  for (const row of rows) {
    const day = String(row.t || '').slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    const key = row.project || '(không rõ)';
    byProject[key] = (byProject[key] || 0) + 1;
    if (row.share) {
      byShare[row.share] = (byShare[row.share] || 0) + 1;
      if (!lastSeenByShare[row.share] || String(row.t || '') > lastSeenByShare[row.share]) lastSeenByShare[row.share] = row.t;
    }
    if (row.ip) ips.add(row.ip);
    if (!row.path || /\.html?$/i.test(row.path) || !/\.[a-z0-9]+$/i.test(row.path)) {
      if (Number(row.status) < 400) {
        pageViews++;
        topPages[row.path] = (topPages[row.path] || 0) + 1;
      }
    }
  }
  return {
    days, total: rows.length, pageViews, uniqueVisitors: ips.size, byDay, byProject, byShare, lastSeenByShare,
    topPages: Object.entries(topPages).sort((a, b) => b[1] - a[1]).slice(0, 20),
    recent: rows.slice(-200).reverse()
  };
}

function buildEngagement(events = [], projects = [], query = {}) {
  const filter = { days: cleanDays(query.days), project: String(query.project || '') };
  const { sessions, clickEvents } = analytics.buildSessions(events, filter);
  const summary = analytics.summarize({ events, projects, ...filter });
  const perDoc = summary.perDoc.map(doc => {
    const matching = sessions.filter(session => session.project === doc.project && session.path === doc.path);
    const total = Math.max(0, ...matching.map(session => Number(session.total) || 0));
    const avgMaxSlide = Math.round(matching.reduce((sum, session) => sum + (Number(session.maxSlide) || 0), 0) / Math.max(1, matching.length));
    const maxSeconds = Math.max(0, ...matching.map(session => Number(session.seconds) || 0));
    const slideAvg = Array.from({ length: Math.max(total, ...Object.keys(doc.slideTimes || {}).map(Number)) }, (_, index) => doc.slideTimes[String(index + 1)] || 0);
    const hotSlide = slideAvg.reduce((best, seconds, index) => seconds > (slideAvg[best - 1] || 0) ? index + 1 : best, 0);
    return { ...doc, total, avgMaxSlide, maxSeconds, slideAvg, hotSlide };
  });
  const mobile = sessions.filter(session => session.mobile).length;
  const clicks = new Map();
  for (const event of clickEvents) if (event.href) {
    const item = clicks.get(event.href) || { href: event.href, text: event.text || '', count: 0 };
    item.count++;
    if (event.text) item.text = event.text;
    clicks.set(event.href, item);
  }
  return {
    perDoc,
    recent: sessions.slice().sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 100),
    insights: {
      mobile, desktop: sessions.length - mobile, returningVisitors: summary.returningVisitors,
      uniqueVisitors: summary.visitors,
      topClicks: Array.from(clicks.values()).sort((a, b) => b.count - a.count).slice(0, 20)
    }
  };
}

module.exports = { buildStats, buildEngagement, cleanDays };
