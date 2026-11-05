'use strict';

const crypto = require('node:crypto');
const { createContext } = require('@html-present/core').ports;

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(String(value), salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(value, encoded) {
  if (!encoded) return false;
  const parts = String(encoded).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(value), parts[1], 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function createSingleAdminAuth({ repo } = {}) {
  if (!repo || !repo.config) throw new TypeError('FileRepo config adapter is required');

  function config() { return repo.config.get({ tenantId: 'default' }); }
  function saveAdmin(admin) { return repo.config.update({ tenantId: 'default' }, { admin }); }
  function currentUser(req) {
    return req && (req.apiTokenId || (req.session && req.session.admin && !req.session.apiToken))
      ? { id: 'default-admin', name: 'Admin', role: 'owner' }
      : null;
  }

  return {
    currentUser,

    requireRole(role) {
      const allowed = role === 'owner' ? ['owner'] : ['owner', 'admin'];
      return (req, res, next) => {
        const user = currentUser(req);
        if (user && allowed.includes(user.role)) return next();
        return res.status(401).json({ error: 'Chưa đăng nhập' });
      };
    },

    context(req) {
      const user = currentUser(req);
      return createContext({ tenantId: 'default', user, role: user ? 'owner' : null });
    },

    needsSetup() { return !config().admin.passwordHash; },

    setup(password) {
      const current = config();
      if (current.admin.passwordHash) throw Object.assign(new Error('Mật khẩu đã được thiết lập.'), { status: 400 });
      if (!isStrongPassword(password)) throw Object.assign(new Error('Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường và số.'), { status: 400 });
      saveAdmin({ passwordHash: hashPassword(password), updatedAt: new Date().toISOString() });
      return true;
    },

    verify(password) { return verifyPassword(password, config().admin.passwordHash); },

    changePassword(currentPassword, nextPassword) {
      const current = config();
      if (!verifyPassword(currentPassword, current.admin.passwordHash)) throw Object.assign(new Error('Mật khẩu hiện tại không đúng.'), { status: 400 });
      if (!isStrongPassword(nextPassword)) throw Object.assign(new Error('Mật khẩu mới cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường và số.'), { status: 400 });
      saveAdmin({ passwordHash: hashPassword(nextPassword), updatedAt: new Date().toISOString() });
      return true;
    }
  };
}

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

module.exports = { createSingleAdminAuth, hashPassword, verifyPassword, isStrongPassword };
