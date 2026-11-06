'use strict';

const path = require('node:path');
const { createContext } = require('../ports');
const { isPagePath, resolveAccess } = require('./access');
const notes = require('../lib/notes');

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
});

function cleanRelativePath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  const parts = raw.split('/').filter(Boolean);
  if (raw.startsWith('/') || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

function safeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function injectRuntime(html, project, ctx, access, route, options = {}) {
  const assetUrl = options.assetUrl || (name => `/_app/${name}`);
  const primaryColor = /^#[0-9a-f]{6}$/i.test(options.branding && options.branding.primaryColor || '') ? options.branding.primaryColor : '#2563eb';
  const isAdmin = access.admin;
  const projectBasePath = String(route.projectBasePath || `/${project.slug}`).replace(/\/+$/, '');
  const normalizedLayout = ['responsive', 'landscape', 'portrait'].includes(project.layout) ? project.layout : 'responsive';
  const defaultsForLayout = normalizedLayout === 'portrait'
    ? { w: 1080, h: 1920 }
    : { w: 1920, h: 1080 };
  const flag = {
    slug: project.slug,
    project: project.id,
    tenantSlug: route.tenantSlug || '',
    projectSlug: project.slug,
    path: `${projectBasePath}/${route.relPath}`.replace(/\/$/, route.relPath ? '' : '/'),
    relPath: String(route.relPath || ''),
    admin: isAdmin,
    role: access.share ? (access.share.role || 'viewer') : (isAdmin ? 'admin' : (ctx.role || 'viewer')),
    share: access.share ? access.share.id : null,
    noTrack: isAdmin || route.noTrack === true,
    present: project.present !== false,
    heatmap: project.heatmap !== false,
    protect: !!project.protect,
    layout: normalizedLayout,
    baseWidth: positiveInt(project.baseWidth, defaultsForLayout.w),
    baseHeight: positiveInt(project.baseHeight, defaultsForLayout.h)
  };
  // Gắn sẵn class trong <head> để CSS áp dụng trước khi body hiện → không bị lóe
  // nội dung rồi mới thu gọn (present.js cũng gắn lại các class này sau):
  //  - lt-immersive: deck khung cố định (landscape/portrait) — hành vi immersive.
  //  - lt-has-steps: deck có [data-step] — ẩn bước chờ reveal, MỌI layout.
  const presentOn = project.present !== false;
  const immersiveLayout = normalizedLayout !== 'responsive' && presentOn;
  const hasSteps = presentOn && /\sdata-step[\s=>/]/i.test(html);
  const headClasses = `${immersiveLayout ? "document.documentElement.classList.add('lt-immersive');" : ''}${hasSteps ? "document.documentElement.classList.add('lt-has-steps');" : ''}`;
  // <base>: để đường dẫn tương đối của deck (deck.css, assets/…) luôn phân giải
  // về thư mục dự án, kể cả khi URL thiếu dấu "/" cuối (vd /slug thay vì /slug/).
  // Đường /_app/… tuyệt đối không bị ảnh hưởng.
  let head = `<base href="${projectBasePath}/"><style>:root{--html-present-primary:${primaryColor}}</style><script>window.__htmlpresent=${safeScriptJson(flag)};${headClasses}</script>`;
  let body = '';
  if (normalizedLayout !== 'responsive') {
    head += `<link rel="stylesheet" href="${assetUrl('layout.css')}">`;
    body += `<script src="${assetUrl('layout.js')}" defer></script>`;
  }
  if (project.present !== false) {
    head += `<link rel="stylesheet" href="${assetUrl('present.css')}">`;
    body += `<script src="${assetUrl('present.js')}" defer></script>`;
  }
  if (isAdmin) {
    // Sửa slide trực tiếp trên trang xem — chỉ admin mới tải (xem docs/internal/PHASE4-FAB-EDIT.md).
    head += `<link rel="stylesheet" href="${assetUrl('edit.css')}">`;
    body += `<script src="${assetUrl('edit.js')}" defer></script>`;
  }
  // Form thu lead (opt-in theo project.leadForm). Admin cũng tải để xem trước (lead.js tự
  // nhận biết admin → chỉ preview, không gửi/lưu).
  if (project.leadForm === true) {
    head += `<link rel="stylesheet" href="${assetUrl('lead.css')}">`;
    body += `<script src="${assetUrl('lead.js')}" defer></script>`;
  }
  body += `<script src="${assetUrl('track.js')}" defer></script>`;
  if (project.heatmap !== false) body += `<script src="${assetUrl('heatmap.js')}" defer></script>`;
  if (project.protect) {
    if (route.watermark) body += `<script>window.__wm=${safeScriptJson(route.watermark)};</script>`;
    body += `<script src="${assetUrl('protect.js')}" defer></script>`;
  }
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, match => `${match}\n${head}`);
  else html = `${head}\n${html}`;
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${body}\n</body>`)
    : `${html}${body}`;
}

function positiveInt(value, def) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 320 && n <= 10000 ? n : def;
}

async function readLimited(stream, maxBytes) {
  if (Buffer.isBuffer(stream)) {
    if (stream.length > maxBytes) throw Object.assign(new Error('Tệp HTML vượt quá giới hạn.'), { status: 413 });
    return stream;
  }
  if (typeof stream === 'string') {
    const value = Buffer.from(stream);
    if (value.length > maxBytes) throw Object.assign(new Error('Tệp HTML vượt quá giới hạn.'), { status: 413 });
    return value;
  }
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('storage.get phải trả về stream hoặc Buffer');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) {
      stream.destroy?.();
      throw Object.assign(new Error('Tệp HTML vượt quá giới hạn.'), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Create the shared, repository-backed viewer service. */
function createViewerService({ repo, storage, getCredentials, getBranding, assetUrl, maxHtmlBytes = 10 * 1024 * 1024 } = {}) {
  if (!repo || !storage) throw new TypeError('repo and storage adapters are required');
  return {
    async load({ req, ctx: rawCtx, slug, relPath = '', watermark = '', projectBasePath = '', tenantSlug = '' } = {}) {
      const ctx = createContext(rawCtx);
      const project = await repo.projects.bySlug(ctx, String(slug || ''));
      if (!project) return { status: 404, reason: 'no-project' };
      const relative = cleanRelativePath(relPath);
      if (relative == null) return { status: 403, reason: 'invalid-path' };
      const credentials = getCredentials ? await getCredentials(req, project, ctx) : {};
      const access = resolveAccess({
        project,
        relPath: relative,
        ctx,
        shareTokens: credentials.shareTokens || [],
        passwordValid: credentials.passwordValid === true
      });
      if (!access.ok) return { status: access.reason === 'off' ? 404 : 401, reason: access.reason, project };
      if (relative && isPagePath(relative) && !/\.html?$/i.test(relative)) return { status: 404, reason: 'not-html', project, access };

      const file = await repo.files.get(ctx, project.id, relative);
      if (!file || typeof file.key !== 'string') return { status: 404, reason: 'no-file', project, access };
      const content = await storage.get(file.key);
      if (!content) return { status: 404, reason: 'no-content', project, access };
      const contentType = file.contentType || MIME_TYPES[path.extname(relative).toLowerCase()] || 'application/octet-stream';
      if (/^text\/html(?:;|$)/i.test(contentType) || /\.html?$/i.test(relative)) {
        const html = (await readLimited(content, maxHtmlBytes)).toString('utf8');
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: injectRuntime(html, project, ctx, access, {
            relPath: relative,
            projectBasePath,
            tenantSlug,
            noTrack: !!(req && req.query && req.query.__htmlpresent_audience === '1'),
            watermark
          }, { assetUrl, branding: getBranding ? await getBranding(ctx) : null }),
          project,
          access
        };
      }
      return { status: 200, contentType, body: content, project, access };
    }
  };
}

async function getPresenterNotes({ repo, storage }, ctx, projectId, relPath, access) {
  if (!access || !access.ok || (!access.admin && (!access.share || access.share.role !== 'presenter'))) {
    throw Object.assign(new Error('Bạn không có quyền xem ghi chú.'), { status: 403 });
  }
  const safePath = cleanRelativePath(relPath);
  if (!safePath || !/\.html?$/i.test(safePath)) throw Object.assign(new Error('Đường dẫn slide HTML không hợp lệ.'), { status: 400 });
  const file = await repo.files.get(ctx, projectId, safePath);
  if (!file) throw Object.assign(new Error('Không đọc được slide HTML.'), { status: 404 });
  const source = await storage.get(file.key);
  if (!source) throw Object.assign(new Error('Không đọc được slide HTML.'), { status: 404 });
  const html = (await readLimited(source, 10 * 1024 * 1024)).toString('utf8');
  return { notes: notes.projectNotes(await repo.projects.get(ctx, projectId), safePath), slides: notes.extractSlides(html) };
}

module.exports = { createViewerService, getPresenterNotes, cleanRelativePath, injectRuntime, readLimited, MIME_TYPES };
