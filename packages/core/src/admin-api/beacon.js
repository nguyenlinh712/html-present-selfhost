'use strict';

const TYPES = new Set(['start', 'ping', 'slide', 'click', 'end']);

function cleanTrackingEvent(body, context = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !TYPES.has(body.type)) return null;
  const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const number = (value, min, max, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
  };
  const bool = value => value === true || value === 1 || value === 'true';
  const st = {};
  if (body.st && typeof body.st === 'object' && !Array.isArray(body.st)) {
    for (const [key, value] of Object.entries(body.st).slice(0, 200)) {
      if (!/^\d{1,4}$/.test(key)) continue;
      const slide = Number(key), seconds = number(value, 0, 86400, -1);
      if (slide >= 1 && slide <= 9999 && seconds >= 0) st[slide] = seconds;
    }
  }
  function cleanReferrer(value) {
    const raw = text(value, 1000);
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) return '';
      url.searchParams.delete('k'); url.username = ''; url.password = '';
      return url.toString().slice(0, 500);
    } catch { return ''; }
  }
  function cleanLanding(value) {
    const raw = text(value, 1000);
    try {
      const url = new URL(raw, 'https://html-present.invalid');
      url.searchParams.delete('k');
      return `${url.pathname}${url.search}`.slice(0, 500);
    } catch { return ''; }
  }
  function cleanEnv(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const conn = value.conn && typeof value.conn === 'object' && !Array.isArray(value.conn) ? value.conn : {};
    const brands = Array.isArray(value.brands) ? value.brands.slice(0, 6).map(item => ({
      brand: text(item && item.brand, 40), version: text(item && item.version, 20)
    })).filter(item => item.brand) : [];
    const orientation = text(value.orientation, 40);
    return {
      screenW: number(value.screenW, 0, 20000), screenH: number(value.screenH, 0, 20000),
      vpW: number(value.vpW, 0, 20000), vpH: number(value.vpH, 0, 20000),
      dpr: Math.max(0, Math.min(8, Number(value.dpr) || 0)),
      orientation: /^(portrait|landscape)-(primary|secondary)$/.test(orientation) ? orientation : '',
      platform: text(value.platform, 80), brands, mobile: bool(value.mobile),
      lang: text(value.lang, 32), langs: Array.isArray(value.langs) ? value.langs.slice(0, 8).map(item => text(item, 32)).filter(Boolean) : [],
      tz: text(value.tz, 80), tzOffset: number(value.tzOffset, -840, 840),
      colorScheme: ['light', 'dark', 'no-preference'].includes(value.colorScheme) ? value.colorScheme : '',
      reducedMotion: bool(value.reducedMotion),
      conn: { effectiveType: text(conn.effectiveType, 20), downlink: Math.max(0, Math.min(10000, Number(conn.downlink) || 0)), rtt: number(conn.rtt, 0, 60000), saveData: bool(conn.saveData) },
      mem: Math.max(0, Math.min(128, Number(value.mem) || 0)), cpu: number(value.cpu, 0, 256), touch: number(value.touch, 0, 100)
    };
  }
  function cleanUtm(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
      const item = text(value[key], 200); if (item) out[key] = item;
    }
    return out;
  }

  const sid = text(body.sid, 80);
  if (!sid) return null;
  const event = {
    t: new Date().toISOString(), sid, vid: text(body.vid, 100), firstSeen: text(body.firstSeen, 40),
    type: body.type, project: context.project.id, slug: context.project.slug,
    path: `/${context.project.slug}/${context.relPath || ''}`.replace(/\/$/, context.relPath ? '' : '/'),
    share: context.shareId || null,
    slide: number(body.slide, 0, 9999), maxSlide: number(body.maxSlide, 0, 9999), total: number(body.total, 0, 9999),
    seconds: number(body.seconds, 0, 86400), durationTotal: number(body.durationTotal, 0, 604800),
    engagedTime: number(body.engagedTime, 0, 604800), st,
    scrollDepth: number(body.scrollDepth, 0, 100), interactions: number(body.interactions, 0, 1000000),
    idleSeconds: number(body.idleSeconds, 0, 86400), tabSwitches: number(body.tabSwitches, 0, 10000),
    revisits: number(body.revisits, 0, 100000), exitSlide: number(body.exitSlide, 0, 9999),
    rageClicks: number(body.rageClicks, 0, 10000), copyAttempt: number(body.copyAttempt, 0, 10000),
    printAttempt: number(body.printAttempt, 0, 10000), mobile: bool(body.mobile), env: cleanEnv(body.env),
    utm: cleanUtm(body.utm), referrer: cleanReferrer(body.referrer),
    ip: text(context.ip, 80), country: text(context.country, 2).toUpperCase(), ua: text(context.userAgent, 500)
  };
  const landingPath = cleanLanding(body.landingPath);
  if (landingPath) event.landingPath = landingPath;
  const startedAt = text(body.startedAt, 40);
  if (startedAt && Number.isFinite(Date.parse(startedAt))) event.startedAt = new Date(startedAt).toISOString();
  if (body.type === 'click') {
    const href = text(body.href, 300);
    if (/^(https?:|mailto:|tel:)/i.test(href)) { event.href = href; event.text = text(body.text, 80); }
  }
  return event;
}

module.exports = { cleanTrackingEvent };
