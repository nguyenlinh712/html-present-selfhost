'use strict';

const crypto = require('node:crypto');

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

function cookieToken(project, secret) {
  return crypto.createHmac('sha256', String(secret)).update(`pw:${project.id}:${project.password || ''}`).digest('base64url');
}

function cookieValid(project, secret, value) {
  if (!project || !project.password || !value) return false;
  const a = Buffer.from(String(value));
  const b = Buffer.from(cookieToken(project, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, cookieToken, cookieValid };
