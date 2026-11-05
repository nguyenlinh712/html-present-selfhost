'use strict';

const { findValidShare } = require('../lib/share-scope');

function isPagePath(relPath) {
  const value = String(relPath || '').replace(/\\/g, '/');
  const leaf = value.split('/').filter(Boolean).pop() || '';
  if (!leaf || /\.html?$/i.test(leaf)) return true;
  return !/\.[a-z0-9]+$/i.test(leaf);
}

/**
 * Shared viewer access policy. The app adapter resolves cookies, password
 * cookies, and authenticated roles, then passes normalized facts here.
 *
 * @param {{project: object|null, relPath?: string, ctx?: object, shareTokens?: string[], passwordValid?: boolean}} input
 * @returns {{ok: boolean, share: object|null, viaPassword: boolean, admin: boolean, reason?: string}}
 */
function resolveAccess(input = {}) {
  const { project, relPath = '', ctx = {}, shareTokens = [], passwordValid = false } = input;
  const admin = ['owner', 'admin', 'superadmin'].includes(ctx.role);
  if (!project) return { ok: false, share: null, viaPassword: false, admin, reason: 'no-project' };
  if (admin) return { ok: true, share: null, viaPassword: false, admin: true };
  if (project.visibility === 'off') return { ok: false, share: null, viaPassword: false, admin: false, reason: 'off' };

  // P1-6: share token phải được giải quyết TRƯỚC khi rơi về quyền public.
  // Trước đây dự án public return sớm → link chia sẻ role `presenter` mất quyền
  // trình bày. Share hợp lệ thì dùng role của nó; không hợp lệ mới xét public.
  const page = isPagePath(relPath);
  for (const token of new Set(shareTokens.filter(Boolean).map(String))) {
    const share = findValidShare(project, token, relPath, page);
    if (share) return { ok: true, share, viaPassword: false, admin: false };
  }

  if (project.visibility === 'public') return { ok: true, share: null, viaPassword: false, admin: false };

  return passwordValid
    ? { ok: true, share: null, viaPassword: true, admin: false }
    : { ok: false, share: null, viaPassword: false, admin: false, reason: 'need-token' };
}

module.exports = { isPagePath, resolveAccess };
