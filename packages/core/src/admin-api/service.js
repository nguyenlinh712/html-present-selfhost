'use strict';

const { createContext } = require('../ports');
const { isValidScope, normalizeRelPath } = require('../lib/share-scope');
const { extractSlides } = require('../lib/notes');
const projectPassword = require('../lib/project-password');
const { readLimited } = require('../viewer/service');
const { reportBuffer, accessBuffer } = require('../lib/export');
const { buildStats, buildEngagement } = require('./analytics');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireRole(ctx, roles) {
  if (!roles.includes(ctx.role)) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.');
}

function createAdminService({ repo, storage, brandName = 'HTML Present', logo, timezone = 'Asia/Ho_Chi_Minh', getBranding } = {}) {
  if (!repo || !storage) throw new TypeError('repo and storage adapters are required');

  function context(value) { return createContext(value); }

  async function getNotesForProject(ctx, projectId, relPath) {
    const safePath = cleanHtmlPath(relPath);
    if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
    const project = await repo.projects.get(ctx, projectId);
    if (!project) throw httpError(404, 'Không tìm thấy dự án.');
    const file = await repo.files.get(ctx, projectId, safePath);
    if (!file) throw httpError(404, 'Không đọc được slide HTML.');
    const source = await storage.get(file.key);
    if (!source) throw httpError(404, 'Không đọc được slide HTML.');
    const html = (await readLimited(source, 10 * 1024 * 1024)).toString('utf8');
    return {
      path: safePath,
      slides: extractSlides(html),
      notes: await repo.notes.get(ctx, projectId, safePath)
    };
  }

  return {
    async listProjects(rawCtx, filters) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      return repo.projects.list(ctx, filters);
    },

    async scanProjects(rawCtx) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin']);
      if (typeof repo.projects.scan !== 'function') return [];
      return repo.projects.scan(ctx);
    },

    async createProject(rawCtx, input) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin']);
      return repo.projects.create(ctx, input);
    },

    async updateProject(rawCtx, projectId, patch) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      return repo.projects.update(ctx, projectId, patch);
    },

    async removeProject(rawCtx, projectId) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin']);
      return repo.projects.remove(ctx, projectId);
    },

    async updateShare(rawCtx, projectId, shareId, patch) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      return repo.shares.update(ctx, projectId, shareId, patch);
    },

    async rotateShare(rawCtx, projectId, shareId) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      return repo.shares.rotate(ctx, projectId, shareId);
    },

    async removeShare(rawCtx, projectId, shareId) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      return repo.shares.remove(ctx, projectId, shareId);
    },

    async setProjectPassword(rawCtx, projectId, password) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      if (String(password || '').length < 4) throw httpError(400, 'Mật khẩu cần tối thiểu 4 ký tự.');
      const project = await repo.projects.get(ctx, projectId);
      if (!project) throw httpError(404, 'Không tìm thấy dự án.');
      return repo.projects.update(ctx, projectId, { password: projectPassword.hashPassword(password) });
    },

    async clearProjectPassword(rawCtx, projectId) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      return repo.projects.update(ctx, projectId, { password: null });
    },

    async getProjectContent(rawCtx, projectId, prefix = '') {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      const safePrefix = cleanContentPath(prefix);
      if (safePrefix == null) throw httpError(400, 'Đường dẫn không hợp lệ.');
      const project = await repo.projects.get(ctx, projectId);
      if (!project) throw httpError(404, 'Không tìm thấy dự án.');
      return repo.files.list(ctx, projectId, safePrefix);
    },

    async readProjectFile(rawCtx, projectId, relPath) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      const safePath = cleanHtmlPath(relPath);
      if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
      const file = await repo.files.read(ctx, projectId, safePath);
      if (!file) throw httpError(404, 'Không tìm thấy file.');
      return file;
    },

    async writeProjectFile(rawCtx, projectId, relPath, content, options = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      const safePath = cleanHtmlPath(relPath);
      if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
      if (typeof content !== 'string') throw httpError(400, 'Nội dung không hợp lệ.');
      const expectedRevision = typeof options.expectedRevision === 'string' ? options.expectedRevision : undefined;
      return repo.files.write(ctx, projectId, safePath, content, { expectedRevision });
    },

    // Phase 8 (lane V): lịch sử phiên bản file HTML. Chỉ chạy khi adapter hỗ trợ (Free).
    async listFileVersions(rawCtx, projectId, relPath, query = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      if (!repo.versions) throw httpError(501, 'Máy chủ này chưa hỗ trợ lịch sử phiên bản.');
      const safePath = cleanHtmlPath(relPath);
      if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
      return repo.versions.list(ctx, projectId, safePath, { cursor: query.cursor, limit: query.limit });
    },

    async getFileVersion(rawCtx, projectId, relPath, versionId) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      if (!repo.versions) throw httpError(501, 'Máy chủ này chưa hỗ trợ lịch sử phiên bản.');
      const safePath = cleanHtmlPath(relPath);
      if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
      return repo.versions.get(ctx, projectId, safePath, String(versionId || ''));
    },

    async restoreFileVersion(rawCtx, projectId, relPath, versionId, options = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      if (!repo.versions) throw httpError(501, 'Máy chủ này chưa hỗ trợ lịch sử phiên bản.');
      const safePath = cleanHtmlPath(relPath);
      if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
      const expectedRevision = typeof options.expectedRevision === 'string' ? options.expectedRevision : undefined;
      return repo.versions.restore(ctx, projectId, safePath, String(versionId || ''), { expectedRevision });
    },

    async getNotes(rawCtx, projectId, relPath) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      return getNotesForProject(ctx, projectId, relPath);
    },

    async putNotes(rawCtx, projectId, relPath, input) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      const safePath = cleanHtmlPath(relPath);
      if (!safePath) throw httpError(400, 'Đường dẫn slide HTML không hợp lệ.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Danh sách ghi chú không hợp lệ.');
      const current = await getNotesForProject(ctx, projectId, safePath);
      const allowed = new Set(current.slides.map(slide => String(slide.idx)));
      const clean = {};
      for (const [idx, value] of Object.entries(input).slice(0, 200)) {
        if (!allowed.has(idx) || typeof value !== 'string') continue;
        const text = value.replace(/\r\n?/g, '\n').slice(0, 5000);
        if (text.trim()) clean[idx] = text;
      }
      const saved = await repo.notes.put(ctx, projectId, safePath, clean);
      return { ok: true, notes: saved || clean };
    },

    async createShare(rawCtx, projectId, input = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      const project = await repo.projects.get(ctx, projectId);
      if (!project) throw httpError(404, 'Không tìm thấy dự án.');
      const scope = input.scope == null || input.scope === '' ? null : normalizeRelPath(input.scope);
      if (!isValidScope(input.scope)) throw httpError(400, 'Phạm vi không hợp lệ.');
      if (scope) {
        const content = await repo.files.list(ctx, projectId, '');
        if (!content.some(file => file.relPath === scope || file.path === scope)) throw httpError(400, 'Không tìm thấy phạm vi được chọn.');
      }
      return repo.shares.create(ctx, projectId, {
        label: String(input.label || '').trim().slice(0, 120),
        scope,
        role: input.role === 'presenter' ? 'presenter' : 'viewer'
      });
    },

    async analyticsSummary(rawCtx, filter = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      return repo.analytics.summary(ctx, cleanFilters(filter));
    },

    async heatmapGrid(rawCtx, filter = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      return repo.heatmap.grid(ctx, cleanFilters(filter));
    },

    async accessStats(rawCtx, filter = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      const clean = cleanFilters(filter);
      const rows = await repo.access.list(ctx, { days: clean.days, project: clean.project });
      return buildStats(rows, clean);
    },

    async engagementSummary(rawCtx, filter = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
      const clean = cleanFilters(filter);
      const [events, projects] = await Promise.all([
        repo.events.list(ctx, { days: clean.days, project: clean.project }),
        repo.projects.list(ctx)
      ]);
      return buildEngagement(events, projects, clean);
    },

    async exportReport(rawCtx, filter = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin', 'editor']);
      const branding = getBranding ? await getBranding(ctx) : {};
      const filters = cleanFilters(filter);
      const [events, projects] = await Promise.all([
        repo.events.list(ctx, filters),
        repo.projects.list(ctx)
      ]);
      return reportBuffer({ events, projects, logo, brandName: branding.productName || brandName, timezone, ...filters });
    },

    async exportAccess(rawCtx, filter = {}) {
      const ctx = context(rawCtx);
      requireRole(ctx, ['owner', 'admin']);
      const branding = getBranding ? await getBranding(ctx) : {};
      const filters = cleanFilters(filter);
      const [access, projects] = await Promise.all([
        repo.access.list(ctx, filters),
        repo.projects.list(ctx)
      ]);
      return accessBuffer({ access, projects, brandName: branding.productName || brandName, timezone, ...filters });
    }
  };
}

function cleanContentPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  const parts = raw.split('/').filter(Boolean);
  if (raw.startsWith('/') || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

function cleanHtmlPath(value) {
  const normalized = cleanContentPath(value);
  return normalized && /\.html?$/i.test(normalized) ? normalized : null;
}

function cleanFilters(filter) {
  const source = filter && typeof filter === 'object' ? filter : {};
  return {
    project: typeof source.project === 'string' ? source.project.slice(0, 120) : '',
    path: typeof source.path === 'string' ? source.path.slice(0, 500) : '',
    share: typeof source.share === 'string' ? source.share.slice(0, 120) : '',
    days: source.days,
    from: source.from,
    to: source.to
  };
}

module.exports = { createAdminService, cleanContentPath, cleanHtmlPath, cleanFilters };
