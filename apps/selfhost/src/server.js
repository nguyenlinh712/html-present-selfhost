'use strict';

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('node:fs');
const path = require('node:path');
const core = require('@html-present/core');
const { createFileRepo } = require('./repos/file-repo');
const { createFileStorage } = require('./storage/file-storage');
const { createSingleAdminAuth } = require('./auth/single-admin');
const { createAdminRouter } = require('./web/admin-router');
const { loadConfig } = require('./config');
const { FileSessionStore } = require('./session/file-session-store');
const { health } = require('./health');

const CORE_ROOT = path.resolve(__dirname, '../../..', 'packages', 'core');
const ADMIN_UI_ROOT = path.join(CORE_ROOT, 'src', 'admin-ui');
const RUNTIME_ROOT = path.join(CORE_ROOT, 'src', 'runtime');

function createApp(options = {}) {
  const config = loadConfig(options);
  const dataDir = config.dataDir;
  const fileRepo = createFileRepo({ dataDir });
  const repo = fileRepo.repo;
  const storage = createFileStorage({ repo, dataDir });
  core.upload.cleanupStaging(path.join(dataDir, '.uploads')).catch(() => {});
  const auth = createSingleAdminAuth({ repo });
  core.ports.assertCoreAdapters({ repo, storage, auth });

  const runtimeConfig = repo.config.get({ tenantId: 'default' });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    next();
  });
  app.set('trust proxy', false);
  app.get('/healthz', health);
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use(session({
    name: 'html-present.sid',
    secret: runtimeConfig.session.secret,
    store: new FileSessionStore({ directory: path.join(dataDir, 'sessions') }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  }));

  function assetPath(name) {
    const candidates = [path.join(RUNTIME_ROOT, name), path.join(ADMIN_UI_ROOT, name)];
    return candidates.find(candidate => candidate.startsWith(CORE_ROOT + path.sep) && fs.existsSync(candidate));
  }
  function assetVersion(name) {
    try { return Math.floor(fs.statSync(assetPath(name)).mtimeMs); } catch { return 0; }
  }
  const assetUrl = name => `/_app/${name}?v=${assetVersion(name)}`;
  function resolveCover(project, names, extensions) {
    if (!project || typeof project.dir !== 'string' || path.isAbsolute(project.dir)) return null;
    const root = path.resolve(dataDir);
    const projectRoot = path.resolve(root, project.dir);
    if (!projectRoot.startsWith(root + path.sep)) return null;
    try {
      const realRoot = fs.realpathSync(root);
      const realProject = fs.realpathSync(projectRoot);
      if (!realProject.startsWith(realRoot + path.sep)) return null;
      const files = fs.readdirSync(realProject, { withFileTypes: true });
      const byLower = new Map(files.filter(entry => entry.isFile()).map(entry => [entry.name.toLowerCase(), entry.name]));
      for (const base of names) for (const extension of extensions) {
        const filename = byLower.get(`${base}${extension}`);
        if (!filename) continue;
        const stat = fs.statSync(path.join(realProject, filename));
        return `/${project.slug}/${encodeURIComponent(filename)}?v=${Math.floor(stat.mtimeMs)}`;
      }
    } catch {}
    return null;
  }

  const coreAdmin = core.adminApi.service.createAdminService({
    repo, storage, brandName: 'HTML Present', timezone: config.timezone,
    getBranding: () => repo.config.get({ tenantId: 'default' }).branding
  });
  const getCredentials = (req, project) => {
    const shareTokens = [];
    if (req && req.query && req.query.k) shareTokens.push(String(req.query.k));
    for (const share of project.shares || []) {
      const token = req && req.cookies && req.cookies[`ak_${project.id}_${share.id}`];
      if (token) shareTokens.push(String(token));
    }
    const legacy = req && req.cookies && req.cookies[`ak_${project.id}`];
    if (legacy) shareTokens.push(String(legacy));
    const passwordCookie = req && req.cookies && req.cookies[`pv_${project.id}`];
    return {
      shareTokens,
      passwordValid: core.projectPassword.cookieValid(project, runtimeConfig.session.secret, passwordCookie)
    };
  };
  const viewer = core.viewer.service.createViewerService({ repo, storage, getCredentials, getBranding: () => repo.config.get({ tenantId: 'default' }).branding, assetUrl });

  app.use('/_app/covers', express.static(path.join(dataDir, 'covers'), { fallthrough: true, immutable: true, maxAge: '1y' }));
  app.use('/_app', express.static(ADMIN_UI_ROOT, { fallthrough: true, etag: true }));
  app.use('/_app', express.static(RUNTIME_ROOT, { fallthrough: true, etag: true }));
  app.use('/_admin', createAdminRouter({ fileRepo, auth, coreAdmin, coreRoot: CORE_ROOT, dataDir, clientIpHeader: config.clientIpHeader, timezone: config.timezone }));

  app.get('/_admin', (_req, res, next) => {
    try {
      const template = fs.readFileSync(path.join(ADMIN_UI_ROOT, 'admin.html'), 'utf8');
      // Bỏ thẻ <script> cho module admin chưa tồn tại (vd dashboard.js của
      // Lane N trước khi merge) để không tạo 404 — admin.html có thể khai báo
      // sẵn điểm tích hợp mà không phụ thuộc file đã có hay chưa.
      // Gắn ?v=<mtime> cho script admin + design.css để tránh cache bản cũ.
      const html = template
        .replace(/[ \t]*<script\s+src=(['"])(\/_app\/admin\/[\w.-]+\.js)(?:\?v=[^'"]*)?\1><\/script>\n?/g,
          (match, _quote, asset) => assetPath(asset.slice('/_app/'.length)) ? match : '')
        .replace(/src=(['"])(\/_app\/admin\/[\w.-]+\.js)(?:\?v=[^'"]*)?\1/g,
          (_match, quote, asset) => `src=${quote}${asset}?v=${assetVersion(asset.slice('/_app/'.length))}${quote}`)
        .replace(/href=(['"])(\/_app\/[\w.-]+\.css)(?:\?v=[^'"]*)?\1/g,
          (_match, quote, asset) => `href=${quote}${asset}?v=${assetVersion(asset.slice('/_app/'.length))}${quote}`);
      res.type('html').send(html);
    } catch (error) { next(error); }
  });

  app.get('/', (_req, res, next) => {
    try {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      const projects = repo.projects.list({ tenantId: 'default' });
      const template = fs.readFileSync(path.join(ADMIN_UI_ROOT, 'home.html'), 'utf8');
      const branding = repo.config.get({ tenantId: 'default' }).branding;
      res.type('html').send(core.viewer.home.renderHome(projects, { template, assetUrl, resolveCover, branding }));
    } catch (error) { next(error); }
  });

  app.get('/api/public', (_req, res) => {
    const projects = repo.projects.list({ tenantId: 'default' });
    res.json(core.viewer.home.publicProjects(projects));
  });

  app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(ADMIN_UI_ROOT, 'assets', 'favicon.svg'), error => {
    if (error && !res.headersSent) res.status(204).end();
  }));

  app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

  const unlockAttempts = new Map();
  app.post('/__unlock', (req, res) => {
    const ip = requestIp(req, config);
    const now = Date.now();
    const prior = unlockAttempts.get(ip);
    if (prior && prior.until > now && prior.count >= 10) return res.status(429).json({ error: 'Thử quá nhiều lần. Vui lòng đợi 15 phút.' });
    const state = prior && prior.until > now ? prior : { count: 0, until: now + 15 * 60 * 1000 };
    state.count++;
    unlockAttempts.set(ip, state);
    if (unlockAttempts.size > 10000) for (const [key, item] of unlockAttempts) if (item.until <= now) unlockAttempts.delete(key);

    const body = req.body || {};
    const project = repo.projects.bySlug({ tenantId: 'default' }, String(body.slug || ''));
    if (!project || project.visibility !== 'restricted' || !project.password) return res.status(400).json({ error: 'Không áp dụng' });
    if (!core.projectPassword.verifyPassword(body.password, project.password)) return res.status(401).json({ error: 'Sai mật khẩu' });
    unlockAttempts.delete(ip);
    res.cookie(`pv_${project.id}`, core.projectPassword.cookieToken(project, runtimeConfig.session.secret), {
      httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 1000 * 60 * 60 * 24 * 7
    });
    res.json({ ok: true });
  });

  app.post('/__track', async (req, res, next) => {
    try {
      if (auth.currentUser(req) || (req.query && req.query.__htmlpresent_audience === '1')) return res.status(204).end();
      const body = req.body || {};
      const project = repo.projects.bySlug({ tenantId: 'default' }, String(body.slug || '').trim().slice(0, 120));
      if (!project) return res.status(204).end();
      const relPath = requestProjectPath(body.path, project.slug);
      if (relPath == null) return res.status(204).end();
      const credentials = getCredentials(req, project);
      const ctx = auth.context(req);
      const access = core.viewer.access.resolveAccess({ project, relPath, ctx, ...credentials });
      if (!access.ok || access.admin) return res.status(204).end();
      const event = core.adminApi.beacon.cleanTrackingEvent(body, {
        project, relPath, shareId: access.share && access.share.id,
        ip: requestIp(req, config), country: config.countryHeader ? req.headers[config.countryHeader] : '', userAgent: req.headers['user-agent']
      });
      if (event) await repo.events.append({ tenantId: 'default' }, [event]);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  const leadAttempts = new Map();
  app.post('/__lead', async (req, res, next) => {
    try {
      if (auth.currentUser(req)) return res.status(204).end();
      const ip = requestIp(req, config);
      const now = Date.now();
      const prior = leadAttempts.get(ip);
      if (prior && prior.until > now && prior.count >= 10) return res.status(429).json({ error: 'Gửi quá nhiều lần. Vui lòng thử lại sau.' });
      const state = prior && prior.until > now ? prior : { count: 0, until: now + 15 * 60 * 1000 };
      state.count++;
      leadAttempts.set(ip, state);
      if (leadAttempts.size > 10000) for (const [key, item] of leadAttempts) if (item.until <= now) leadAttempts.delete(key);

      const body = req.body || {};
      const project = repo.projects.bySlug({ tenantId: 'default' }, String(body.slug || '').trim().slice(0, 120));
      if (!project || !project.leadForm) return res.status(204).end();
      const relPath = requestProjectPath(body.path, project.slug);
      if (relPath == null) return res.status(204).end();
      const credentials = getCredentials(req, project);
      const ctx = auth.context(req);
      const access = core.viewer.access.resolveAccess({ project, relPath, ctx, ...credentials });
      if (!access.ok || access.admin) return res.status(204).end();
      if (!repo.leads) return res.status(204).end();
      const lead = core.adminApi.lead.cleanLead(body, {
        project, shareId: access.share && access.share.id,
        ip, country: config.countryHeader ? req.headers[config.countryHeader] : '', userAgent: req.headers['user-agent']
      });
      if (!lead) return res.status(400).json({ error: 'Thiếu số điện thoại hoặc email hợp lệ.' });
      await repo.leads.append({ tenantId: 'default' }, [lead]);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/__hm', async (req, res, next) => {
    try {
      if (auth.currentUser(req)) return res.status(204).end();
      const body = req.body || {};
      const slug = typeof body.slug === 'string' ? body.slug.trim().slice(0, 120) : '';
      const project = repo.projects.bySlug({ tenantId: 'default' }, slug);
      if (!project || project.heatmap === false) return res.status(204).end();
      const relPath = requestProjectPath(body.path, project.slug);
      if (!relPath || !/\.html?$/i.test(relPath)) return res.status(204).end();
      const ctx = auth.context(req);
      if (!repo.files.get(ctx, project.id, relPath)) return res.status(204).end();
      const credentials = getCredentials(req, project);
      const access = core.viewer.access.resolveAccess({ project, relPath, ctx, ...credentials });
      if (!access.ok || access.admin) return res.status(204).end();
      const result = core.heatmap.cleanPayload(body, { project: project.id, share: access.share && access.share.id });
      if (result.error) return res.status(204).end();
      await repo.heatmap.add(ctx, [result.row]);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/__notes', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const project = repo.projects.bySlug({ tenantId: 'default' }, String(req.query.slug || ''));
      if (!project) return res.status(404).end();
      const relPath = requestRelativePath(req.query.path);
      if (!relPath) return res.status(400).end();
      const ctx = auth.context(req);
      const access = core.viewer.access.resolveAccess({ project, relPath, ctx, ...getCredentials(req, project) });
      const result = await core.viewer.service.getPresenterNotes({ repo, storage }, ctx, project.id, relPath, access);
      res.json({ notes: result.notes });
    } catch (error) { if (error.status === 403 || error.status === 400 || error.status === 404) return res.status(error.status).end(); next(error); }
  });

  app.use((req, res, next) => {
    handleProjectRequest(req, res, next).catch(next);
  });

  async function handleProjectRequest(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let segments;
    try { segments = req.path.split('/').filter(Boolean).map(decodeURIComponent); }
    catch { return res.status(400).send(simplePage('400', 'Đường dẫn không hợp lệ.')); }
    if (!segments.length) return next();
    const [slug, ...parts] = segments;
    const ctx = auth.context(req);
    const project = await repo.projects.bySlug(ctx, slug);
    if (!project) return next();
    const relPath = parts.join('/');
    const credentials = getCredentials(req, project);
    const access = core.viewer.access.resolveAccess({ project, relPath, ctx, ...credentials });
    if (!access.ok) {
      if (access.reason === 'off') {
        await logAccess(repo, req, project, 404, null, config);
        return res.status(404).type('html').send(simplePage('404', 'Trang không tồn tại.'));
      }
      const scoped = await findScopedShare(repo, ctx, project, credentials.shareTokens);
      if (scoped) return res.redirect(`/${project.slug}/${encodeURI(scoped.path)}${scoped.directory ? '/' : ''}?k=${encodeURIComponent(scoped.share.token)}`);
      await logAccess(repo, req, project, 401, null, config);
      return res.status(401).type('html').send(core.viewer.home.renderUnlock(project, {
        hasPassword: !!project.password,
        badToken: !!(req.query.k || credentials.shareTokens.length), assetUrl,
        branding: repo.config.get({ tenantId: 'default' }).branding
      }));
    }
    persistShareCookie(res, req, project, access, config.cookieSecure);

    let targetRel = relPath;
    let file = targetRel ? await repo.files.get(ctx, project.id, targetRel) : null;
    if (targetRel && !file && /\.[a-z0-9]+$/i.test(path.posix.basename(targetRel))) {
      await logAccess(repo, req, project, 404, access.share && access.share.id, config);
      return res.status(404).type('html').send(simplePage('404', 'Trang không tồn tại.'));
    }
    const looksLikeDirectory = !targetRel || req.path.endsWith('/') || !file;
    if (looksLikeDirectory) {
      const indexPath = [targetRel, 'index.html'].filter(Boolean).join('/');
      const indexFile = await repo.files.get(ctx, project.id, indexPath);
      if (indexFile) targetRel = indexPath;
      else {
        const tree = await repo.files.list(ctx, project.id, targetRel);
        await logAccess(repo, req, project, 200, access.share && access.share.id, config);
        return res.type('html').send(core.viewer.home.renderProject(project, tree, {
          token: access.share && access.share.token,
          isRoot: !targetRel,
          relDir: targetRel,
          assetUrl,
          resolveCover,
          branding: repo.config.get({ tenantId: 'default' }).branding
        }));
      }
    }

    const result = await viewer.load({ req, ctx, slug: project.slug, relPath: targetRel, watermark: `${requestIp(req, config)} · ${new Date().toLocaleString('vi-VN', { timeZone: config.timezone })}` });
    if (result.status !== 200) {
      await logAccess(repo, req, project, result.status, access.share && access.share.id, config);
      if (result.status === 401) return res.status(401).type('html').send(core.viewer.home.renderUnlock(project, { hasPassword: !!project.password, badToken: true, assetUrl, branding: repo.config.get({ tenantId: 'default' }).branding }));
      return res.status(result.status).send(simplePage(String(result.status), result.status === 404 ? 'Trang không tồn tại.' : 'Bạn cần link truy cập hợp lệ để xem.'));
    }
    await logAccess(repo, req, project, 200, access.share && access.share.id, config);
    res.type(result.contentType);
    if (result.body && typeof result.body.pipe === 'function') result.body.pipe(res);
    else res.send(result.body);
  }

  app.use((_req, res) => res.status(404).type('html').send(simplePage('404', 'Trang không tồn tại.')));
  app.use((error, _req, res, _next) => res.status(Number(error.status) || 500).json({ error: error.message || 'Có lỗi xảy ra.' }));
  app.locals.services = { fileRepo, repo, storage, auth, coreAdmin, viewer };
  return app;
}

function requestProjectPath(value, slug) {
  if (typeof value !== 'string') return null;
  const parts = value.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  try {
    const decoded = parts.map(decodeURIComponent);
    if (decoded[0] !== slug || decoded.some(part => part === '.' || part === '..' || part.includes('\\'))) return null;
    return decoded.slice(1).join('/');
  } catch { return null; }
}

function requestRelativePath(value) {
  if (typeof value !== 'string') return null;
  const raw = value.split(/[?#]/, 1)[0];
  try {
    const decoded = raw.split('/').filter(Boolean).map(decodeURIComponent);
    if (decoded.some(part => part === '.' || part === '..' || part.includes('\\') || part.startsWith('.'))) return null;
    return decoded.join('/');
  } catch { return null; }
}

function requestIp(req, config = {}) {
  return String((config.clientIpHeader && req.headers[config.clientIpHeader]) || req.ip || '').slice(0, 80);
}

async function logAccess(repo, req, project, status, share, config = {}) {
  if (req.session && req.session.admin) return;
  await repo.access.append({ tenantId: 'default' }, [{
    t: new Date().toISOString(), ip: requestIp(req, config), country: String((config.countryHeader && req.headers[config.countryHeader]) || '').slice(0, 2),
    method: req.method, slug: project ? project.slug : null, project: project ? project.id : null,
    share: share || null, path: req.path, status, ref: String(req.headers.referer || '').slice(0, 1000),
    ua: String(req.headers['user-agent'] || '').slice(0, 500)
  }]);
}

function persistShareCookie(res, req, project, access, cookieSecure = false) {
  if (!access.share || req.query.k !== access.share.token) return;
  const options = { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: 1000 * 60 * 60 * 12 };
  res.cookie(`ak_${project.id}_${access.share.id}`, access.share.token, options);
  res.cookie(`ak_${project.id}`, access.share.token, options);
}

async function findScopedShare(repo, ctx, project, tokens = []) {
  const content = flatten(await repo.files.list(ctx, project.id, ''));
  for (const token of tokens) {
    const share = core.shareScope.findValidShare(project, token, '', false);
    if (!share || !share.scope) continue;
    const node = content.find(item => item.relPath === share.scope);
    if (node) return { share, path: share.scope, directory: node.type === 'dir' };
  }
  return null;
}
function flatten(nodes, out = []) { for (const node of nodes || []) { out.push(node); if (node.children) flatten(node.children, out); } return out; }
function simplePage(title, message) { return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body><main><h1>${title}</h1><p>${message}</p><a href="/">Về thư viện</a></main></body></html>`; }

function start(options = {}) {
  const config = loadConfig(options);
  const app = createApp(options);
  return app.listen(config.port, config.host, () => process.stdout.write(`[html-present-selfhost] listening at http://${config.host}:${config.port}\n`));
}

if (require.main === module) start();

module.exports = { createApp, start, requestProjectPath };
