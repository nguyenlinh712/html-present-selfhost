'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const core = require('@html-present/core');
const crypto = require('node:crypto');
const Busboy = require('busboy');
const { normalizeBranding } = require('../config/branding');

const IMAGE_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/jpg', 'jpg'],
  ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/avif', 'avif']
]);

function createAdminRouter({ fileRepo, auth, coreAdmin, coreRoot, dataDir, clientIpHeader = '', timezone = 'Asia/Ho_Chi_Minh' } = {}) {
  const router = express.Router();
  const repo = fileRepo.repo;
  const adminOnly = auth.requireRole('owner');
  const coversDir = path.join(dataDir, 'covers');
  const uploadRoot = path.join(dataDir, '.uploads');
  const trashRoot = path.join(dataDir, '.trash');
  const chartFile = path.join(coreRoot, 'src', 'admin-ui', 'vendor', 'chart.umd.min.js');
  const guideFile = path.join(dataDir, 'agent-slide-guide.md');
  const attempts = new Map();
  const attemptsCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, state] of attempts) if (now >= state.until) attempts.delete(ip);
  }, 5 * 60 * 1000);
  attemptsCleanup.unref();

  const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  const ctx = req => auth.context(req);
  const config = () => repo.config.get({ tenantId: 'default' });
  const baseUrl = req => String(config().baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  function receiveSingleFile(req, { maxBytes = 2 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let file = null;
      const finish = (error, value) => { if (done) return; done = true; error ? reject(error) : resolve(value); };
      let bb;
      try { bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 4 } }); }
      catch (error) { finish(error); return; }
      bb.on('file', (_name, stream, info) => {
        if (file) { stream.resume(); return; }
        const chunks = [];
        let size = 0;
        let limited = false;
        stream.on('data', chunk => { size += chunk.length; chunks.push(chunk); });
        stream.on('limit', () => { limited = true; });
        stream.on('end', () => { file = { filename: info.filename || '', mimeType: info.mimeType || '', buffer: Buffer.concat(chunks), size, limited }; });
      });
      bb.on('error', error => finish(error));
      bb.on('finish', () => file ? finish(null, file) : finish(Object.assign(new Error('Chưa chọn file.'), { status: 400 })));
      req.pipe(bb);
    });
  }

  function safeProject(project, req, shareStats = {}) {
    if (!project) return null;
    const shares = (project.shares || []).map(share => ({
      id: share.id, label: share.label, enabled: !!share.enabled,
      valid: core.shareScope.shareValid(share), expiresAt: share.expiresAt || null,
      scope: share.scope || null, role: share.role || 'viewer',
      views: Number(shareStats[share.id] || share.views || share.viewCount || 0), lastSeen: shareStats.lastSeen && shareStats.lastSeen[share.id] || share.lastSeen || share.lastViewedAt || null,
      url: share.scope
        ? `${baseUrl(req)}/${project.slug}/${encodeURI(share.scope)}?k=${encodeURIComponent(share.token)}`
        : `${baseUrl(req)}/${project.slug}/?k=${encodeURIComponent(share.token)}`
    }));
    return {
      id: project.id, name: project.name, slug: project.slug, dir: project.dir,
      layout: project.layout || 'responsive', baseWidth: project.baseWidth || null, baseHeight: project.baseHeight || null,
      leadForm: project.leadForm === true,
      description: project.description || '', visibility: project.visibility || 'off',
      listed: !!project.listed, protect: !!project.protect,
      tags: Array.isArray(project.tags) ? project.tags : [], archived: project.archived === true,
      present: project.present !== false, heatmap: project.heatmap !== false,
      hasPassword: !!project.password, cover: project.cover || null,
      createdAt: project.createdAt || null, updatedAt: project.updatedAt || null,
      url: `${baseUrl(req)}/${project.slug}/`, shares
    };
  }

  router.get('/api/me', (req, res) => {
    const stored = config();
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
    res.json({ authed: !!auth.currentUser(req), needsSetup: !stored.admin.passwordHash, baseUrl: stored.baseUrl || '', brandingEnabled: true, branding: stored.branding, timezone, csrfToken: req.session.csrfToken });
  });

  // API token bearer auth: cho phép agent (openclaw, CI, cron) gọi upload/project
  // không cần session + CSRF. Token lưu trong config.json.apiTokens[], chỉ hash
  // lưu trên đĩa; token gốc chỉ hiện 1 lần khi tạo (giống GitHub PAT).
  router.use((req, res, next) => {
    const auth_header = String(req.get('authorization') || '');
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(auth_header);
    if (!m) return next();
    const presented = m[1];
    const presentedHash = crypto.createHash('sha256').update(presented).digest('hex');
    const tokens = (fileRepo.load().apiTokens || []);
    const match = tokens.find(t => t.enabled !== false && t.hash === presentedHash);
    if (!match) return res.status(401).json({ error: 'API token không hợp lệ.' });
    // Chỉ cấp quyền cho request này; không ghi Bearer token vào cookie session.
    req.apiTokenId = match.id;
    // Ghi nhận lastUsedAt (best-effort)
    try { fileRepo.repo.apiTokens.touch(ctx(req), match.id); } catch (_) {}
    next();
  });

  router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.apiTokenId) return next(); // API token đã auth, bỏ qua CSRF
    const token = String(req.get('x-csrf-token') || '');
    const tokenBytes = Buffer.from(token);
    const expectedBytes = Buffer.from(req.session && req.session.csrfToken || '');
    if (!req.session || !expectedBytes.length || tokenBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(tokenBytes, expectedBytes)) {
      return res.status(403).json({ error: 'Phiên bảo mật đã hết hạn. Hãy tải lại trang.' });
    }
    next();
  });

  // CRUD API token (admin UI)
  router.get('/api/tokens', adminOnly, route(async (req, res) => {
    res.json({ tokens: fileRepo.repo.apiTokens.list(ctx(req)) });
  }));
  router.post('/api/tokens', adminOnly, route(async (req, res) => {
    const { id, label, token } = fileRepo.repo.apiTokens.create(ctx(req), (req.body && req.body.label) || '');
    res.json({ ok: true, id, label, token }); // token gốc chỉ hiện lần này
  }));
  router.delete('/api/tokens/:id', adminOnly, route(async (req, res) => {
    fileRepo.repo.apiTokens.remove(ctx(req), req.params.id);
    res.json({ ok: true });
  }));

  function limitedAuth(handler) {
    return route(async (req, res, next) => {
      const ip = clientIpHeader ? String(req.headers[clientIpHeader] || req.ip || '') : String(req.ip || '');
      const now = Date.now();
      const prior = attempts.get(ip);
      if (prior && now < prior.until && prior.count >= 10) return res.status(429).json({ error: 'Thử quá nhiều lần. Vui lòng đợi 15 phút.' });
      const state = prior && now < prior.until ? prior : { count: 0, until: now + 15 * 60 * 1000 };
      state.count++;
      attempts.set(ip, state);
      res.once('finish', () => { if (res.statusCode < 400) attempts.delete(ip); });
      const result = await handler(req, res, next);
      return result;
    });
  }

  router.post('/api/setup', limitedAuth(async (req, res) => {
    auth.setup(req.body && req.body.password);
    await regenerateSession(req);
    req.session.admin = true;
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
    res.json({ ok: true, csrfToken: req.session.csrfToken });
  }));

  router.post('/api/login', limitedAuth(async (req, res) => {
    if (!auth.verify(req.body && req.body.password)) return res.status(401).json({ error: 'Sai mật khẩu' });
    await regenerateSession(req);
    req.session.admin = true;
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
    res.json({ ok: true, csrfToken: req.session.csrfToken });
  }));

  router.post('/api/logout', (req, res) => {
    if (!req.session) return res.json({ ok: true });
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.post('/api/password', adminOnly, route(async (req, res) => {
    const { current, next } = req.body || {};
    auth.changePassword(current, next);
    res.json({ ok: true });
  }));

  router.post('/api/base-url', adminOnly, route(async (req, res) => {
    const value = String(req.body && req.body.baseUrl || '').trim();
    if (!/^https?:\/\//i.test(value)) return res.status(400).json({ error: 'URL không hợp lệ' });
    repo.config.update(ctx(req), { baseUrl: value.replace(/\/$/, '') });
    res.json({ ok: true, baseUrl: config().baseUrl });
  }));

  router.post('/api/branding', adminOnly, route(async (req, res) => {
    try {
      const branding = normalizeBranding(req.body || {});
      repo.config.update(ctx(req), { branding });
      res.json({ ok: true, branding: config().branding });
    } catch (error) { res.status(400).json({ error: error.message || 'Cấu hình thương hiệu không hợp lệ.' }); }
  }));

  router.post('/api/branding/logo', adminOnly, route(async (req, res) => {
    const upload = await receiveSingleFile(req, { maxBytes: 2 * 1024 * 1024 });
    if (upload.limited) return res.status(413).json({ error: 'Logo quá lớn (tối đa 2MB).' });
    const ext = IMAGE_TYPES.get(upload.mimeType);
    if (!ext) return res.status(400).json({ error: 'Logo phải là PNG, JPEG, WebP, GIF hoặc AVIF.' });
    fs.mkdirSync(coversDir, { recursive: true });
    const filename = `branding-logo.${ext}`;
    const target = path.join(coversDir, filename);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, upload.buffer, { mode: 0o600 });
    fs.renameSync(temporary, target);
    for (const oldExt of IMAGE_TYPES.values()) if (oldExt !== ext) { try { fs.unlinkSync(path.join(coversDir, `branding-logo.${oldExt}`)); } catch (_) {} }
    const branding = normalizeBranding({ ...config().branding, logoUrl: `/_app/covers/${filename}` });
    repo.config.update(ctx(req), { branding });
    res.json({ ok: true, branding: config().branding });
  }));

  router.delete('/api/branding/logo', adminOnly, route(async (req, res) => {
    for (const ext of IMAGE_TYPES.values()) { try { fs.unlinkSync(path.join(coversDir, `branding-logo.${ext}`)); } catch (_) {} }
    const branding = normalizeBranding({ ...config().branding, logoUrl: '' });
    repo.config.update(ctx(req), { branding });
    res.json({ ok: true, branding: config().branding });
  }));

  router.get('/api/guide', adminOnly, route(async (_req, res) => {
    const bundled = path.resolve(coreRoot, '..', '..', 'docs', 'SLIDE-SPEC.md');
    const source = fs.existsSync(guideFile) ? guideFile : bundled;
    if (!fs.existsSync(source)) return res.status(404).json({ error: 'Chưa có file quy ước.' });
    res.type('text/markdown').set('Content-Disposition', 'attachment; filename="SLIDE-SPEC.md"').send(fs.readFileSync(source));
  }));

  router.post('/api/guide', adminOnly, route(async (req, res) => {
    const upload = await receiveSingleFile(req, { maxBytes: 2 * 1024 * 1024 });
    if (upload.limited) return res.status(413).json({ error: 'File hướng dẫn quá lớn (tối đa 2MB).' });
    if (!/\.md$/i.test(upload.filename || '')) return res.status(400).json({ error: 'File hướng dẫn phải có đuôi .md.' });
    fs.mkdirSync(path.dirname(guideFile), { recursive: true });
    const temporary = `${guideFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, upload.buffer, { mode: 0o600 });
    fs.renameSync(temporary, guideFile);
    res.json({ ok: true, size: upload.buffer.length, name: upload.filename });
  }));

  router.get('/api/projects', adminOnly, route(async (req, res) => {
    const projects = await coreAdmin.listProjects(ctx(req));
    const stats = await coreAdmin.accessStats(ctx(req), { days: 90 });
    const shareStats = { ...stats.byShare, lastSeen: stats.lastSeenByShare };
    res.json(projects.map(project => safeProject(project, req, shareStats)));
  }));

  router.get('/api/scan', adminOnly, route(async (req, res) => res.json(await coreAdmin.scanProjects(ctx(req)))));

  router.get('/api/projects/:id/content', adminOnly, route(async (req, res) => {
    const project = await repo.projects.get(ctx(req), req.params.id);
    if (!project) return res.status(404).json({ error: 'Không tìm thấy dự án.' });
    const tree = await coreAdmin.getProjectContent(ctx(req), req.params.id);
    res.json({ project: safeProject(project, req), rootShares: (project.shares || []).filter(share => !share.scope).map(share => safeProject({ ...project, shares: [share] }, req).shares[0]), tree });
  }));

  router.get('/api/projects/:id/notes', adminOnly, route(async (req, res) => {
    const result = await coreAdmin.getNotes(ctx(req), req.params.id, req.query.path);
    res.json(result);
  }));

  router.put('/api/projects/:id/notes', adminOnly, route(async (req, res) => {
    const result = await coreAdmin.putNotes(ctx(req), req.params.id, req.query.path || (req.body && req.body.path), req.body && req.body.notes);
    res.json(result);
  }));

  router.get('/api/projects/:id/file', adminOnly, route(async (req, res) => {
    const result = await coreAdmin.readProjectFile(ctx(req), req.params.id, req.query.path);
    res.json(result);
  }));

  router.put('/api/projects/:id/file', adminOnly, route(async (req, res) => {
    const body = req.body || {};
    const result = await coreAdmin.writeProjectFile(ctx(req), req.params.id, body.path || req.query.path, body.content,
      { expectedRevision: body.expectedRevision });
    res.json(result);
  }));

  router.post('/api/projects', adminOnly, route(async (req, res) => {
    const { name, dir, slug, visibility } = req.body || {};
    const folder = String(dir || '');
    const scan = await coreAdmin.scanProjects(ctx(req));
    if (!scan.some(item => item.dir === folder)) return res.status(400).json({ error: 'Thư mục không tồn tại hoặc không có slide HTML.' });
    const project = await coreAdmin.createProject(ctx(req), { name: String(name || folder).trim(), dir: folder, slug: String(slug || folder).toLowerCase(), visibility: normalizeVisibility(visibility) });
    res.json(safeProject(project, req));
  }));

  router.patch('/api/projects/:id', adminOnly, route(async (req, res) => {
    const body = req.body || {};
    const patch = {};
    for (const field of ['name', 'slug', 'description', 'listed', 'protect', 'present', 'heatmap', 'tags', 'archived', 'layout', 'baseWidth', 'baseHeight', 'leadForm']) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    if (body.visibility !== undefined) patch.visibility = normalizeVisibility(body.visibility);
    const project = await coreAdmin.updateProject(ctx(req), req.params.id, patch);
    if (!project) return res.status(404).json({ error: 'Không tìm thấy dự án.' });
    res.json(safeProject(project, req));
  }));

  router.delete('/api/projects/:id', adminOnly, route(async (req, res) => {
    const removed = await coreAdmin.removeProject(ctx(req), req.params.id);
    if (!removed) return res.status(404).json({ error: 'Không tìm thấy dự án.' });
    removeCoverFiles(req.params.id);
    res.json({ ok: true });
  }));

  router.post('/api/projects/:id/shares', adminOnly, route(async (req, res) => {
    const share = await coreAdmin.createShare(ctx(req), req.params.id, req.body || {});
    const project = await repo.projects.get(ctx(req), req.params.id);
    res.json(safeProject({ ...project, shares: [share] }, req));
  }));

  router.patch('/api/projects/:id/shares/:sid', adminOnly, route(async (req, res) => {
    const patch = { ...(req.body || {}) };
    if (patch.expiresAt != null && patch.expiresAt !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.expiresAt))) return res.status(400).json({ error: 'Ngày hết hạn không hợp lệ' });
    if (patch.expiresAt === '') patch.expiresAt = null;
    const share = await coreAdmin.updateShare(ctx(req), req.params.id, req.params.sid, patch);
    if (!share) return res.status(404).json({ error: 'Không tìm thấy link.' });
    const project = await repo.projects.get(ctx(req), req.params.id);
    res.json(safeProject({ ...project, shares: [share] }, req));
  }));

  router.post('/api/projects/:id/shares/:sid/rotate', adminOnly, route(async (req, res) => {
    const share = await coreAdmin.rotateShare(ctx(req), req.params.id, req.params.sid);
    if (!share) return res.status(404).json({ error: 'Không tìm thấy link.' });
    const project = await repo.projects.get(ctx(req), req.params.id);
    res.json(safeProject({ ...project, shares: [share] }, req));
  }));

  router.delete('/api/projects/:id/shares/:sid', adminOnly, route(async (req, res) => {
    const removed = await coreAdmin.removeShare(ctx(req), req.params.id, req.params.sid);
    if (!removed) return res.status(404).json({ error: 'Không tìm thấy link.' });
    res.json({ ok: true });
  }));

  router.post('/api/projects/:id/password', adminOnly, route(async (req, res) => {
    const project = await coreAdmin.setProjectPassword(ctx(req), req.params.id, req.body && req.body.password);
    res.json(safeProject(project, req));
  }));

  router.delete('/api/projects/:id/password', adminOnly, route(async (req, res) => {
    const project = await coreAdmin.clearProjectPassword(ctx(req), req.params.id);
    if (!project) return res.status(404).json({ error: 'Không tìm thấy dự án.' });
    res.json(safeProject(project, req));
  }));

  router.post('/api/projects/:id/cover', adminOnly, route(async (req, res) => {
    const project = await repo.projects.get(ctx(req), req.params.id);
    if (!project) return res.status(404).json({ error: 'Không tìm thấy dự án.' });
    const body = req.body || {};
    if (body.url !== undefined) {
      if (!/^https?:\/\//i.test(String(body.url))) return res.status(400).json({ error: 'URL ảnh không hợp lệ' });
      removeCoverFiles(project.id);
      project.cover = String(body.url);
    } else if (body.dataUrl) {
      const match = /^data:([^;]+);base64,(.+)$/i.exec(String(body.dataUrl));
      if (!match || !IMAGE_TYPES.has(match[1].toLowerCase())) return res.status(400).json({ error: 'Chỉ nhận ảnh PNG, JPG, WEBP, GIF, AVIF' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Ảnh quá lớn (tối đa 6MB)' });
      fs.mkdirSync(coversDir, { recursive: true });
      removeCoverFiles(project.id);
      const filename = `${project.id}.${IMAGE_TYPES.get(match[1].toLowerCase())}`;
      fs.writeFileSync(path.join(coversDir, filename), buffer, { mode: 0o600 });
      project.cover = `/_app/covers/${filename}?v=${Date.now()}`;
    } else return res.status(400).json({ error: 'Thiếu ảnh' });
    const updated = await coreAdmin.updateProject(ctx(req), project.id, { cover: project.cover });
    res.json(safeProject(updated, req));
  }));

  router.delete('/api/projects/:id/cover', adminOnly, route(async (req, res) => {
    const project = await repo.projects.get(ctx(req), req.params.id);
    if (!project) return res.status(404).json({ error: 'Không tìm thấy dự án.' });
    removeCoverFiles(project.id);
    const updated = await coreAdmin.updateProject(ctx(req), project.id, { cover: null });
    res.json(safeProject(updated, req));
  }));

  router.post('/api/upload', adminOnly, route(async (req, res) => {
    let uploadContext;
    try {
      uploadContext = await core.upload.receiveUpload(req, { stagingRoot: uploadRoot });
      const extracted = await core.upload.extractUpload(uploadContext);
      const fields = uploadContext.fields;
      const target = fields.target === 'existing' ? 'existing' : 'new';
      const conflict = ['fail', 'rename', 'overwrite'].includes(fields.conflict) ? fields.conflict : 'fail';
      let project, destination, destinationRelative = '';

      if (target === 'new') {
        const name = String(fields.name || basename(uploadContext.file.name)).trim() || 'Slide';
        let slug = String(fields.slug || '').trim().toLowerCase() || slugify(name);
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw httpError(400, 'Slug không hợp lệ (a-z, 0-9, -, _)');
        const existing = (await repo.projects.list(ctx(req))).find(item => item.slug === slug);
        if (existing && conflict === 'fail') throw httpError(400, 'Slug đã tồn tại');
        if (existing && conflict === 'rename') {
          let suffix = 2;
          while ((await repo.projects.list(ctx(req))).some(item => item.slug === `${slug}-${suffix}`)) suffix++;
          slug = `${slug}-${suffix}`;
        }
        if (existing && conflict === 'overwrite') await repo.projects.remove(ctx(req), existing.id);
        destination = path.join(dataDir, slug);
        const finalPath = await core.upload.promoteStaging(extracted.outDir, destination, { conflict, trashRoot });
        const actualDir = path.basename(finalPath);
        const layout = ['responsive', 'landscape', 'portrait'].includes(fields.layout) ? fields.layout : 'responsive';
        project = await coreAdmin.createProject(ctx(req), { name, slug, dir: actualDir, visibility: 'restricted', layout, baseWidth: fields.baseWidth, baseHeight: fields.baseHeight });
        await repo.shares.create(ctx(req), project.id, { label: 'Link mặc định', role: 'viewer' });
        destinationRelative = '';
      } else {
        project = await repo.projects.get(ctx(req), fields.projectId || '');
        if (!project) throw httpError(400, 'Không tìm thấy dự án');
        const subdir = safeSubdir(fields.subdir);
        const leaf = slugify(String(fields.name || basename(uploadContext.file.name)).trim()) || 'slide';
        destinationRelative = [subdir, leaf].filter(Boolean).join('/');
        const projectRoot = path.resolve(dataDir, project.dir);
        destination = path.resolve(projectRoot, destinationRelative);
        if (!destination.startsWith(projectRoot + path.sep)) throw httpError(400, 'Đường dẫn thư mục không hợp lệ');
        await core.upload.promoteStaging(extracted.outDir, destination, { conflict, trashRoot });
      }
      repo.projects.update(ctx(req), project.id, { updatedAt: new Date().toISOString() });
      fs.rmSync(uploadContext.stagingDir, { recursive: true, force: true });
      const current = await repo.projects.get(ctx(req), project.id);
      res.json({ ok: true, project: safeProject(current, req), files: extracted.files, htmlFiles: extracted.htmlFiles, skipped: extracted.skipped, destDir: destinationRelative });
    } catch (error) {
      if (uploadContext) fs.rmSync(uploadContext.stagingDir, { recursive: true, force: true });
      throw error;
    }
  }));

  // Phase 8 (lane V): lịch sử phiên bản file HTML.
  router.get('/api/projects/:id/versions', adminOnly, route(async (req, res) => {
    res.json(await coreAdmin.listFileVersions(ctx(req), req.params.id, req.query.path, { cursor: req.query.cursor, limit: req.query.limit }));
  }));
  router.get('/api/projects/:id/versions/:versionId', adminOnly, route(async (req, res) => {
    res.json(await coreAdmin.getFileVersion(ctx(req), req.params.id, req.query.path, req.params.versionId));
  }));
  router.post('/api/projects/:id/versions/:versionId/restore', adminOnly, route(async (req, res) => {
    const body = req.body || {};
    res.json(await coreAdmin.restoreFileVersion(ctx(req), req.params.id, body.path || req.query.path, req.params.versionId, { expectedRevision: body.expectedRevision }));
  }));

  router.get('/api/analytics', adminOnly, route(async (req, res) => res.json(await coreAdmin.analyticsSummary(ctx(req), req.query))));
  router.get('/api/heatmap', adminOnly, route(async (req, res) => res.json(await coreAdmin.heatmapGrid(ctx(req), req.query))));
  router.get('/api/stats', adminOnly, route(async (req, res) => res.json(await coreAdmin.accessStats(ctx(req), req.query))));
  router.get('/api/engagement', adminOnly, route(async (req, res) => res.json(await coreAdmin.engagementSummary(ctx(req), req.query))));

  // Lead khách để lại (Phase 7, lane A). leads là collection tùy chọn — chỉ selfhost có.
  function readLeads(req, extraFilter = {}) {
    if (!fileRepo.repo.leads) return [];
    const filter = { days: Number(req.query.days) || 90, ...extraFilter };
    return fileRepo.repo.leads.list(ctx(req), filter)
      .slice()
      .sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')))
      .slice(0, 2000);
  }
  router.get('/api/leads', adminOnly, route(async (req, res) => {
    res.json({ leads: readLeads(req), enabled: !!fileRepo.repo.leads });
  }));
  router.get('/api/projects/:id/leads', adminOnly, route(async (req, res) => {
    res.json({ leads: readLeads(req, { project: req.params.id }) });
  }));

  router.get('/api/vendor/chart.umd.min.js/meta', adminOnly, (_req, res) => {
    let version = '4.5.1';
    try { version = require('chart.js/package.json').version; } catch {}
    fs.stat(chartFile, (error, stat) => {
      if (error) return res.status(404).json({ error: 'Không tìm thấy thư viện biểu đồ.' });
      res.set('Cache-Control', 'no-store').json({ version, mtime: Math.floor(stat.mtimeMs) });
    });
  });
  router.get('/api/vendor/chart.umd.min.js', adminOnly, (_req, res) => res.sendFile(chartFile));

  router.get('/api/export/report.xlsx', adminOnly, route(async (req, res) => sendWorkbook(res, await coreAdmin.exportReport(ctx(req), req.query))));
  router.get('/api/export/access.xlsx', adminOnly, route(async (req, res) => sendWorkbook(res, await coreAdmin.exportAccess(ctx(req), req.query))));

  router.use((error, _req, res, _next) => {
    const status = Number(error.status) || 500;
    const payload = { error: error.message || 'Có lỗi xảy ra.' };
    // 409: trả revision hiện tại để client xử lý xung đột (không âm thầm ghi đè).
    if (status === 409 && error.currentRevision) payload.currentRevision = error.currentRevision;
    res.status(status).json(payload);
  });

  function removeCoverFiles(id) {
    try { for (const name of fs.readdirSync(coversDir)) if (name.startsWith(`${id}.`)) fs.rmSync(path.join(coversDir, name), { force: true }); } catch {}
  }

  return router;
}

function normalizeVisibility(value) { return ['public', 'restricted', 'off'].includes(value) ? value : 'off'; }
function basename(value) { return String(value || '').replace(/\.[a-z0-9]+$/i, ''); }
function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function safeSubdir(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  if (raw.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw httpError(400, 'Thư mục con không hợp lệ.');
  return raw;
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function regenerateSession(req) { return new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve())); }

function sendWorkbook(res, result) {
  const encoded = encodeURIComponent(result.filename).replace(/['()]/g, escape);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${result.filename.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store'
  });
  res.send(result.buffer);
}

module.exports = { createAdminRouter };
