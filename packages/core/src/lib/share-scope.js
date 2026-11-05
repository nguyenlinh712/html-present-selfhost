'use strict';

function normalizeRelPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isValidScope(scope) {
  if (scope == null || scope === '') return true;
  if (typeof scope !== 'string') return false;
  const normalized = normalizeRelPath(scope);
  if (!normalized) return false;
  return !normalized.split('/').some(part => part === '..' || part === '.' || /^[A-Za-z]:$/.test(part));
}

function shareValid(share, now = Date.now()) {
  if (!share || !share.enabled) return false;
  if (!share.expiresAt) return true;
  const expiresOn = share.expiresAt instanceof Date
    ? share.expiresAt.toISOString().slice(0, 10)
    : String(share.expiresAt);
  const expiry = new Date(`${expiresOn}T23:59:59`);
  return !Number.isNaN(expiry.getTime()) && now <= expiry.getTime();
}

/** Find an enabled, unexpired share that grants access to this page/asset. */
function findValidShare(project, token, relPath = '', isPage = true, now = Date.now()) {
  if (!token || !project || !Array.isArray(project.shares)) return null;
  const share = project.shares.find(item => item.token === token);
  if (!shareValid(share, now)) return null;
  const scope = normalizeRelPath(share.scope);
  if (!scope || !isPage) return share;
  const target = normalizeRelPath(relPath);
  return target === scope || target.startsWith(`${scope}/`) ? share : null;
}

module.exports = { normalizeRelPath, isValidScope, shareValid, findValidShare };
