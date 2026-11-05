'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('@html-present/core');
const { resolveDataDir } = require('../config');

function positiveInt(value, def) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 320 && n <= 10000 ? n : def;
}
const { DEFAULT_BRANDING, normalizeBranding } = require('../config/branding');

const RESERVED = new Set([
  '_admin', '_app', 'apps', 'covers', 'docs', 'lib', 'logs', 'node_modules', 'packages', 'scripts', 'samples', 'sessions',
  'config.json', 'package.json', 'package-lock.json', 'server.js', 'favicon.ico', 'robots.txt',
  '.git', '.uploads', '.trash'
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeId() { return crypto.randomBytes(6).toString('hex'); }
function makeToken() { return crypto.randomBytes(12).toString('base64url'); }

function normalizeTags(value) {
  if (!Array.isArray(value)) throw Object.assign(new Error('Nhãn phải là một danh sách.'), { status: 400 });
  if (value.length > 20) throw Object.assign(new Error('Mỗi dự án chỉ được có tối đa 20 nhãn.'), { status: 400 });
  const tags = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string') throw Object.assign(new Error('Nhãn không hợp lệ.'), { status: 400 });
    const tag = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    if ([...tag].length > 32 || /[\u0000-\u001f\u007f]/.test(tag)) {
      throw Object.assign(new Error('Nhãn tối đa 32 ký tự và không được chứa ký tự điều khiển.'), { status: 400 });
    }
    const key = tag.toLocaleLowerCase('vi');
    if (!seen.has(key)) { seen.add(key); tags.push(tag); }
  }
  return tags;
}

function normalizeStoredTags(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const tag = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!tag || [...tag].length > 32 || /[\u0000-\u001f\u007f]/.test(tag)) continue;
    const key = tag.toLocaleLowerCase('vi');
    if (!seen.has(key)) { seen.add(key); out.push(tag); }
    if (out.length >= 20) break;
  }
  return out;
}

function createFileRepo(options = {}) {
  const dataDir = resolveDataDir(options);
  const configPath = path.join(dataDir, 'config.json');
  const logDir = path.join(dataDir, 'logs');
  let config;

  function assertTenant(ctx) {
    if (!ctx || ctx.tenantId !== 'default') throw Object.assign(new Error('FileRepo chỉ hỗ trợ tenant mặc định.'), { status: 404 });
  }

  function defaultConfig() {
    return {
      baseUrl: '',
      branding: { ...DEFAULT_BRANDING },
      admin: { passwordHash: null, updatedAt: null },
      session: { secret: crypto.randomBytes(32).toString('hex') },
      projects: []
    };
  }

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${configPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, configPath);
  }

  function load() {
    if (config) return config;
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { config = defaultConfig(); persist(); }
    let changed = false;
    if (!config.session || !config.session.secret) { config.session = { secret: crypto.randomBytes(32).toString('hex') }; changed = true; }
    if (!config.admin || typeof config.admin !== 'object') { config.admin = { passwordHash: null, updatedAt: null }; changed = true; }
    if (!Array.isArray(config.projects)) { config.projects = []; changed = true; }
    if (typeof config.baseUrl !== 'string') { config.baseUrl = ''; changed = true; }
    try {
      const branding = normalizeBranding(config.branding || {});
      if (JSON.stringify(branding) !== JSON.stringify(config.branding)) { config.branding = branding; changed = true; }
    } catch { config.branding = { ...DEFAULT_BRANDING }; changed = true; }
    for (const project of config.projects) {
      const tags = normalizeStoredTags(project.tags);
      if (JSON.stringify(tags) !== JSON.stringify(project.tags)) { project.tags = tags; changed = true; }
      if (typeof project.archived !== 'boolean') { project.archived = false; changed = true; }
      if (project.visibility === 'link') { project.visibility = 'restricted'; changed = true; }
      if (!Array.isArray(project.shares)) {
        project.shares = [];
        if (project.token) project.shares.push({ id: makeId(), label: 'Link mặc định', token: project.token, enabled: true, createdAt: project.createdAt || new Date().toISOString(), expiresAt: null, scope: null, role: 'viewer' });
        changed = true;
      }
      if ('token' in project) { delete project.token; changed = true; }
      for (const [key, value] of Object.entries({ password: null, listed: false, protect: false, present: true, heatmap: true })) {
        if (!(key in project)) { project[key] = value; changed = true; }
      }
      for (const share of project.shares) {
        if (!('scope' in share)) { share.scope = null; changed = true; }
        if (!share.role) { share.role = 'viewer'; changed = true; }
      }
    }
    if (changed) persist();
    return config;
  }

  function findProject(id) { return load().projects.find(project => project.id === String(id)) || null; }

  function appendRows(prefix, rows) {
    const values = Array.isArray(rows) ? rows : [rows];
    if (!values.length) return 0;
    fs.mkdirSync(logDir, { recursive: true });
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    fs.appendFileSync(path.join(logDir, `${prefix}-${month}.jsonl`), values.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
    return values.length;
  }

  function readRows(prefix) {
    let names = [];
    try { names = fs.readdirSync(logDir).filter(name => new RegExp(`^${prefix}-\\d{4}-\\d{2}\\.jsonl$`).test(name)).sort(); }
    catch { return []; }
    const rows = [];
    for (const name of names) {
      let raw;
      try { raw = fs.readFileSync(path.join(logDir, name), 'utf8'); } catch { continue; }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row);
        } catch { /* Ignore a partially-written or malformed JSONL row. */ }
      }
    }
    return rows;
  }

  function inRange(rows, filter = {}) {
    const range = core.analytics.filterRange(filter);
    return rows.filter(row => {
      const time = Date.parse(row.t || '');
      return Number.isFinite(time) && time >= range.from.getTime() && time <= range.to.getTime()
        && (!filter.project || row.project === filter.project)
        && (!filter.path || row.path === filter.path)
        && (!filter.share || row.share === filter.share);
    });
  }

  function safeProjectDir(project) {
    if (!project || typeof project.dir !== 'string' || !project.dir || path.isAbsolute(project.dir)
      || project.dir.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
    const resolved = path.resolve(dataDir, project.dir);
    return resolved.startsWith(dataDir + path.sep) ? resolved : null;
  }

  function tree(projectId, prefix = '') {
    const project = findProject(projectId);
    const root = safeProjectDir(project);
    if (!root) return [];
    let base = root;
    const parts = prefix ? String(prefix).replace(/\\/g, '/').split('/').filter(Boolean) : [];
    if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return [];
    base = path.resolve(root, ...parts);
    if (base !== root && !base.startsWith(root + path.sep)) return [];
    function walk(dir, rel, depth = 1) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
      const out = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const children = depth < 6 ? walk(path.join(dir, entry.name), relPath, depth + 1) : [];
          if (children.length) out.push({ type: 'dir', name: entry.name, relPath, children });
        } else if (/\.html?$/i.test(entry.name)) {
          out.push({ type: 'file', name: entry.name, relPath });
        }
      }
      out.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'vi') : a.type === 'dir' ? -1 : 1);
      return out;
    }
    return walk(base, prefix);
  }

  // ---- Phase 8 (lane V): lưu phiên bản an toàn + lịch sử HTML ----
  const HISTORY_DIR = '.history';
  function historyDirFor(root) { return path.join(root, HISTORY_DIR); }
  function makeSnapshotId() {
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  }
  // Đổi tên snapshot cũ dạng 2026-11-05T00-00-00-000Z về ISO hợp lệ (best-effort).
  function legacyTsToIso(ts) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(String(ts || ''));
    return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : '';
  }
  // Giải đúng 1 file đang tồn tại (chống traversal/symlink), trả {root, relPath, fullPath}.
  function resolveExistingFile(projectId, relPath) {
    const project = findProject(projectId); const root = safeProjectDir(project);
    const parts = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!root || !parts.length || parts.some(p => p === '.' || p === '..' || p.startsWith('.'))) return null;
    const fullPath = path.resolve(root, ...parts);
    try {
      const base = fs.realpathSync(root), real = fs.realpathSync(fullPath), stat = fs.statSync(real);
      if (!real.startsWith(base + path.sep) || !stat.isFile()) return null;
    } catch { return null; }
    return { root, relPath: parts.join('/'), fullPath };
  }
  // Lưu snapshot của nội dung hiện tại kèm metadata. NÉM lỗi nếu thất bại (P0:
  // không được nuốt lỗi rồi vẫn ghi đè — phải còn bản backup trước khi ghi mới).
  function writeSnapshot(root, relPath, contentBuf, meta) {
    const dir = historyDirFor(root);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = makeSnapshotId();
    fs.writeFileSync(path.join(dir, id), contentBuf, { mode: 0o600 });
    const full = {
      id, path: relPath, createdAt: new Date().toISOString(), sizeBytes: contentBuf.length,
      sha256: meta.sha256, reason: meta.reason || 'save', actorId: meta.actorId || null
    };
    fs.writeFileSync(path.join(dir, id + '.meta.json'), JSON.stringify(full), { mode: 0o600 });
    return full;
  }
  // Ghi atomic: file tạm cùng thư mục → fsync → rename. Lỗi giữa chừng giữ nguyên bản cũ.
  function atomicWrite(fullPath, contentStr) {
    const tmp = path.join(path.dirname(fullPath), `.tmp-${crypto.randomBytes(6).toString('hex')}`);
    try {
      const fd = fs.openSync(tmp, 'w', 0o600);
      try { fs.writeSync(fd, contentStr); try { fs.fsyncSync(fd); } catch {} } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, fullPath);
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      throw error;
    }
  }
  function listSnapshots(root, relPath) {
    const dir = historyDirFor(root);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const nameSet = new Set(names);
    const legacySuffix = '-' + relPath.split('/').join('__');
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (meta && meta.id && meta.path === relPath) out.push({ ...meta, legacy: false });
      } catch { /* bỏ qua meta hỏng */ }
    }
    for (const name of names) {
      if (name.endsWith('.meta.json') || nameSet.has(name + '.meta.json')) continue; // đã có meta
      if (!name.endsWith(legacySuffix)) continue;                                     // chỉ snapshot cũ của đúng file này
      let buf; try { buf = fs.readFileSync(path.join(dir, name)); } catch { continue; }
      out.push({
        id: name, path: relPath, createdAt: legacyTsToIso(name.slice(0, name.length - legacySuffix.length)),
        sizeBytes: buf.length, sha256: core.revision.contentRevision(buf), reason: 'legacy', actorId: null, legacy: true
      });
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  }
  function readSnapshot(root, relPath, versionId) {
    if (!versionId || /[\\/]/.test(versionId) || versionId.includes('..')) return null;
    const dir = historyDirFor(root);
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, versionId + '.meta.json'), 'utf8')); } catch {}
    if (meta) {
      if (meta.path !== relPath) return null;
      try { return { content: fs.readFileSync(path.join(dir, versionId), 'utf8'), meta }; } catch { return null; }
    }
    const legacySuffix = '-' + relPath.split('/').join('__');
    if (!versionId.endsWith(legacySuffix)) return null;
    try {
      const buf = fs.readFileSync(path.join(dir, versionId));
      return { content: buf.toString('utf8'), meta: { id: versionId, path: relPath, createdAt: legacyTsToIso(versionId.slice(0, versionId.length - legacySuffix.length)), sizeBytes: buf.length, sha256: core.revision.contentRevision(buf), reason: 'legacy', actorId: null } };
    } catch { return null; }
  }
  // Lưu file an toàn: kiểm tra revision → snapshot (bắt buộc OK) → ghi atomic.
  function writeFileSafe(ctx, projectId, relPath, content, options = {}) {
    assertTenant(ctx);
    if (typeof content !== 'string') throw Object.assign(new Error('Nội dung không hợp lệ.'), { status: 400 });
    if (content.length > 4 * 1024 * 1024) throw Object.assign(new Error('File quá lớn (tối đa 4MB).'), { status: 413 });
    const file = resolveExistingFile(projectId, relPath);
    if (!file) throw Object.assign(new Error('Không tìm thấy file.'), { status: 404 });
    let currentBuf;
    try { currentBuf = fs.readFileSync(file.fullPath); }
    catch { throw Object.assign(new Error('Không đọc được file hiện tại.'), { status: 500 }); }
    const currentRev = core.revision.contentRevision(currentBuf);
    if (options.expectedRevision && options.expectedRevision !== currentRev) {
      throw Object.assign(new Error('Nội dung đã thay đổi từ lúc bạn mở. Hãy tải lại bản mới.'), { status: 409, currentRevision: currentRev });
    }
    const newRev = core.revision.contentRevision(content);
    if (newRev === currentRev) {
      return { ok: true, unchanged: true, relPath: file.relPath, size: currentBuf.length, revision: currentRev, snapshot: null };
    }
    const snap = writeSnapshot(file.root, file.relPath, currentBuf, {
      sha256: currentRev, reason: options.reason || 'before-save', actorId: (ctx.user && ctx.user.id) || null
    });
    atomicWrite(file.fullPath, content);
    return { ok: true, relPath: file.relPath, size: Buffer.byteLength(content, 'utf8'), revision: newRev, snapshot: snap.id };
  }

  const repo = {
    projects: {
      list(ctx) { assertTenant(ctx); return clone(load().projects); },
      get(ctx, id) { assertTenant(ctx); return clone(findProject(id)); },
      bySlug(ctx, slug) { assertTenant(ctx); return clone(load().projects.find(project => project.slug === slug) || null); },
      create(ctx, input = {}) {
        assertTenant(ctx);
        const slug = String(input.slug || '').trim();
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug) || RESERVED.has(slug)) throw Object.assign(new Error('Slug không hợp lệ.'), { status: 400 });
        if (load().projects.some(project => project.slug === slug)) throw Object.assign(new Error('Slug đã tồn tại.'), { status: 409 });
        const dir = String(input.dir || slug);
        if (path.isAbsolute(dir) || dir.startsWith('.') || /[\\/]/.test(dir) || RESERVED.has(dir)) throw Object.assign(new Error('Thư mục dự án không hợp lệ.'), { status: 400 });
        const layout = ['responsive', 'landscape', 'portrait'].includes(input.layout) ? input.layout : 'responsive';
        const defSize = layout === 'portrait' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
        const project = { id: makeId(), slug, dir, name: String(input.name || slug), description: '', visibility: input.visibility || 'off', listed: false, protect: false, present: true, heatmap: true, archived: false, tags: normalizeTags(input.tags || []), password: null, shares: [], notes: {}, layout, baseWidth: positiveInt(input.baseWidth, defSize.w), baseHeight: positiveInt(input.baseHeight, defSize.h), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        load().projects.push(project); persist(); return clone(project);
      },
      update(ctx, id, patch = {}) {
        assertTenant(ctx); const project = findProject(id); if (!project) return null;
        const allowed = ['name', 'slug', 'description', 'visibility', 'listed', 'protect', 'present', 'heatmap', 'archived', 'tags', 'password', 'cover', 'notes', 'layout', 'baseWidth', 'baseHeight', 'leadForm'];
        const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
        if (Object.prototype.hasOwnProperty.call(safePatch, 'leadForm')) safePatch.leadForm = safePatch.leadForm === true;
        if (Object.prototype.hasOwnProperty.call(safePatch, 'tags')) safePatch.tags = normalizeTags(safePatch.tags);
        if (Object.prototype.hasOwnProperty.call(safePatch, 'archived') && typeof safePatch.archived !== 'boolean') {
          throw Object.assign(new Error('Trạng thái lưu trữ không hợp lệ.'), { status: 400 });
        }
        if (safePatch.layout != null && !['responsive', 'landscape', 'portrait'].includes(safePatch.layout)) {
          throw Object.assign(new Error('Hướng slide không hợp lệ.'), { status: 400 });
        }
        if (safePatch.baseWidth != null) safePatch.baseWidth = positiveInt(safePatch.baseWidth, project.baseWidth || 1920);
        if (safePatch.baseHeight != null) safePatch.baseHeight = positiveInt(safePatch.baseHeight, project.baseHeight || 1080);
        if (safePatch.slug != null) {
          if (!/^[a-z0-9][a-z0-9_-]*$/.test(String(safePatch.slug)) || RESERVED.has(String(safePatch.slug))) throw Object.assign(new Error('Slug không hợp lệ.'), { status: 400 });
          if (load().projects.some(other => other.id !== project.id && other.slug === safePatch.slug)) throw Object.assign(new Error('Slug đã tồn tại.'), { status: 409 });
        }
        if (safePatch.visibility != null && !['public', 'restricted', 'off'].includes(safePatch.visibility)) throw Object.assign(new Error('Quyền truy cập không hợp lệ.'), { status: 400 });
        Object.assign(project, safePatch, { updatedAt: new Date().toISOString() }); persist(); return clone(project);
      },
      remove(ctx, id) {
        assertTenant(ctx); const projects = load().projects; const index = projects.findIndex(project => project.id === String(id));
        if (index < 0) return false; projects.splice(index, 1); persist(); return true;
      },
      scan(ctx) {
        assertTenant(ctx); const used = new Set(load().projects.map(project => project.dir)); let entries = [];
        try { entries = fs.readdirSync(dataDir, { withFileTypes: true }); } catch { return []; }
        return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !RESERVED.has(entry.name)).map(entry => {
          const names = fs.readdirSync(path.join(dataDir, entry.name)).filter(name => !name.startsWith('.'));
          const htmlFiles = names.filter(name => /\.html?$/i.test(name));
          return { dir: entry.name, registered: used.has(entry.name), htmlCount: htmlFiles.length, hasIndex: htmlFiles.some(name => name.toLowerCase() === 'index.html'), htmlFiles: htmlFiles.slice(0, 50) };
        });
      }
    },
    shares: {
      list(ctx, projectId) { assertTenant(ctx); const project = findProject(projectId); return clone(project ? project.shares : []); },
      byToken(ctx, token) { assertTenant(ctx); const project = load().projects.find(item => item.shares.some(share => share.token === token)); const share = project && project.shares.find(item => item.token === token); return clone(share || null); },
      create(ctx, projectId, input = {}) {
        assertTenant(ctx); const project = findProject(projectId); if (!project) throw Object.assign(new Error('Không tìm thấy dự án.'), { status: 404 });
        const share = { id: makeId(), label: String(input.label || 'Link mới').slice(0, 120), token: makeToken(), enabled: true, createdAt: new Date().toISOString(), expiresAt: input.expiresAt || null, scope: input.scope || null, role: input.role === 'presenter' ? 'presenter' : 'viewer' };
        project.shares.push(share); persist(); return clone(share);
      },
      update(ctx, projectId, id, patch = {}) { assertTenant(ctx); const project = findProject(projectId); const share = project && project.shares.find(item => item.id === String(id)); if (!share) return null; const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => ['label', 'enabled', 'expiresAt', 'scope', 'role'].includes(key))); if (safePatch.scope != null && !core.shareScope.isValidScope(safePatch.scope)) throw Object.assign(new Error('Phạm vi không hợp lệ.'), { status: 400 }); if (safePatch.role != null && !['viewer', 'presenter'].includes(safePatch.role)) throw Object.assign(new Error('Vai trò link không hợp lệ.'), { status: 400 }); Object.assign(share, safePatch); persist(); return clone(share); },
      rotate(ctx, projectId, id) { assertTenant(ctx); const project = findProject(projectId); const share = project && project.shares.find(item => item.id === String(id)); if (!share) return null; share.token = makeToken(); persist(); return clone(share); },
      remove(ctx, projectId, id) { assertTenant(ctx); const project = findProject(projectId); if (!project) return false; const before = project.shares.length; project.shares = project.shares.filter(item => item.id !== String(id)); if (project.shares.length === before) return false; persist(); return true; }
    },
    notes: {
      get(ctx, projectId, relPath) { assertTenant(ctx); const project = findProject(projectId); const value = project && project.notes && project.notes[relPath]; return clone(value && typeof value === 'object' ? value : {}); },
      put(ctx, projectId, relPath, notes) { assertTenant(ctx); const project = findProject(projectId); if (!project) throw Object.assign(new Error('Không tìm thấy dự án.'), { status: 404 }); if (!project.notes || typeof project.notes !== 'object') project.notes = {}; if (Object.keys(notes || {}).length) project.notes[relPath] = clone(notes); else delete project.notes[relPath]; project.updatedAt = new Date().toISOString(); persist(); return clone(project.notes[relPath] || {}); }
    },
    files: {
      get(ctx, projectId, relPath) {
        assertTenant(ctx); const project = findProject(projectId); const root = safeProjectDir(project);
        const parts = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
        if (!root || !parts.length || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
        const fullPath = path.resolve(root, ...parts);
        try {
          const dataRoot = fs.realpathSync(dataDir), base = fs.realpathSync(root), real = fs.realpathSync(fullPath), stat = fs.statSync(real);
          if ((base !== dataRoot && !base.startsWith(dataRoot + path.sep)) || !real.startsWith(base + path.sep) || !stat.isFile()) return null;
          return { key: `${project.id}/${parts.join('/')}`, relPath: parts.join('/'), size: stat.size };
        } catch { return null; }
      },
      list(ctx, projectId, prefix = '') { assertTenant(ctx); return clone(tree(projectId, prefix)); },
      read(ctx, projectId, relPath) {
        assertTenant(ctx);
        const info = this.get(ctx, projectId, relPath);
        if (!info) return null;
        const project = findProject(projectId); const root = safeProjectDir(project);
        const fullPath = path.resolve(root, ...info.relPath.split('/'));
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          return { relPath: info.relPath, content, revision: core.revision.contentRevision(content) };
        } catch { return null; }
      },
      // Lưu an toàn: snapshot bắt buộc thành công trước khi ghi, ghi atomic, trả revision.
      // options: { expectedRevision, reason }. 409 khi nội dung đã đổi.
      write(ctx, projectId, relPath, content, options = {}) {
        return writeFileSafe(ctx, projectId, relPath, content, options);
      }
    },
    versions: {
      list(ctx, projectId, relPath, opts = {}) {
        assertTenant(ctx);
        const file = resolveExistingFile(projectId, relPath);
        if (!file) throw Object.assign(new Error('Không tìm thấy file.'), { status: 404 });
        const all = listSnapshots(file.root, file.relPath);
        const limit = Math.min(200, Math.max(1, parseInt(opts.limit, 10) || 50));
        const offset = Math.max(0, parseInt(opts.cursor, 10) || 0);
        const page = all.slice(offset, offset + limit);
        return { versions: page, total: all.length, cursor: offset + limit < all.length ? String(offset + limit) : null };
      },
      get(ctx, projectId, relPath, versionId) {
        assertTenant(ctx);
        const file = resolveExistingFile(projectId, relPath);
        if (!file) throw Object.assign(new Error('Không tìm thấy file.'), { status: 404 });
        const snap = readSnapshot(file.root, file.relPath, versionId);
        if (!snap) throw Object.assign(new Error('Không tìm thấy phiên bản.'), { status: 404 });
        return snap;
      },
      restore(ctx, projectId, relPath, versionId, opts = {}) {
        assertTenant(ctx);
        const file = resolveExistingFile(projectId, relPath);
        if (!file) throw Object.assign(new Error('Không tìm thấy file.'), { status: 404 });
        const snap = readSnapshot(file.root, file.relPath, versionId);
        if (!snap) throw Object.assign(new Error('Không tìm thấy phiên bản.'), { status: 404 });
        // Khôi phục = ghi lại nội dung bản chọn; writeFileSafe tự snapshot bản hiện tại trước.
        return writeFileSafe(ctx, projectId, file.relPath, snap.content, { expectedRevision: opts.expectedRevision, reason: 'before-restore' });
      }
    },
    events: {
      append(ctx, rows) { assertTenant(ctx); return appendRows('events', rows); },
      list(ctx, filter = {}) { assertTenant(ctx); return inRange(readRows('events'), filter); }
    },
    access: {
      append(ctx, rows) { assertTenant(ctx); return appendRows('access', rows); },
      list(ctx, filter = {}) { assertTenant(ctx); return inRange(readRows('access'), filter); }
    },
    leads: {
      append(ctx, rows) { assertTenant(ctx); return appendRows('leads', rows); },
      list(ctx, filter = {}) { assertTenant(ctx); return inRange(readRows('leads'), filter); }
    },
    analytics: {
      summary(ctx, filter = {}) { assertTenant(ctx); return core.analytics.summarize({ events: inRange(readRows('events'), filter), projects: load().projects, ...filter }); }
    },
    heatmap: {
      add(ctx, rows) {
        assertTenant(ctx);
        const values = Array.isArray(rows) ? rows : [rows];
        for (const row of values) {
          const date = new Date(row.t || Date.now());
          const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
          fs.mkdirSync(logDir, { recursive: true });
          fs.appendFileSync(path.join(logDir, `heatmap-${month}.jsonl`), JSON.stringify(row) + '\n', { mode: 0o600 });
        }
        return values.length;
      },
      grid(ctx, filter = {}) {
        assertTenant(ctx);
        const rows = readRows('heatmap');
        const projects = load().projects;
        return core.heatmap.summarize(rows, projects, filter);
      }
    },
    config: {
      get(ctx) { assertTenant(ctx); const value = load(); return { baseUrl: value.baseUrl, branding: clone(value.branding), admin: clone(value.admin), session: clone(value.session) }; },
      update(ctx, patch = {}) { assertTenant(ctx); if (typeof patch.baseUrl === 'string') load().baseUrl = patch.baseUrl; if (patch.branding && typeof patch.branding === 'object') load().branding = normalizeBranding(patch.branding); if (patch.admin && typeof patch.admin === 'object' && typeof patch.admin.passwordHash === 'string') load().admin = { passwordHash: patch.admin.passwordHash, updatedAt: patch.admin.updatedAt || new Date().toISOString() }; persist(); return { baseUrl: load().baseUrl, branding: clone(load().branding), admin: clone(load().admin), session: clone(load().session) }; }
    },
    apiTokens: {
      // Lưu hash sha256; token gốc chỉ trả 1 lần khi tạo (giống GitHub PAT).
      list(ctx) {
        assertTenant(ctx);
        return (load().apiTokens || []).map(t => ({ id: t.id, label: t.label, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || null, enabled: t.enabled !== false }));
      },
      create(ctx, label) {
        assertTenant(ctx);
        const cfg = load();
        if (!Array.isArray(cfg.apiTokens)) cfg.apiTokens = [];
        if (cfg.apiTokens.length >= 20) throw Object.assign(new Error('Tối đa 20 token.'), { status: 400 });
        const id = crypto.randomBytes(6).toString('hex');
        const token = crypto.randomBytes(24).toString('base64url');
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        cfg.apiTokens.push({ id, label: String(label || 'Token').slice(0, 60), hash, enabled: true, createdAt: new Date().toISOString() });
        persist();
        return { id, label, token }; // token gốc chỉ hiện lần này
      },
      remove(ctx, id) {
        assertTenant(ctx);
        const cfg = load();
        cfg.apiTokens = (cfg.apiTokens || []).filter(t => t.id !== id);
        persist();
      },
      touch(ctx, id) {
        assertTenant(ctx);
        const t = (load().apiTokens || []).find(x => x.id === id);
        if (t) { t.lastUsedAt = new Date().toISOString(); persist(); }
      }
    }
  };

  return { repo, dataDir, configPath, logDir, load, persist, getConfig: clone(load()), scanFolders: ctx => repo.projects.scan(ctx) };
}

module.exports = { createFileRepo };
