'use strict';

const os = require('node:os');
const path = require('node:path');

function positivePort(value, fallback) {
  if (value == null || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
  }
  return port;
}

function resolveDataDir(options = {}, env = process.env) {
  return path.resolve(options.dataDir || env.DATA_DIR || path.join(os.homedir(), '.html-present'));
}

function headerName(value, variable) {
  const result = String(value || '').toLowerCase();
  if (result && !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(result)) throw new Error(`${variable} không phải tên HTTP header hợp lệ.`);
  return result;
}

function loadConfig(options = {}, env = process.env) {
  const dataDir = resolveDataDir(options, env);
  const timezone = options.timezone || env.APP_TIMEZONE || env.TZ || 'Asia/Ho_Chi_Minh';
  const proxyProfile = String(options.proxyProfile || env.PROXY_PROFILE || 'none').toLowerCase();
  if (!['none', 'cloudflare'].includes(proxyProfile)) throw new Error('PROXY_PROFILE chỉ nhận none hoặc cloudflare.');
  try { new Intl.DateTimeFormat('vi-VN', { timeZone: timezone }); }
  catch { throw new Error('APP_TIMEZONE không phải múi giờ IANA hợp lệ.'); }
  return Object.freeze({
    dataDir,
    host: options.host || env.HOST || '127.0.0.1',
    port: positivePort(options.port || env.PORT, 3301),
    cookieSecure: options.cookieSecure == null ? env.COOKIE_SECURE === '1' : Boolean(options.cookieSecure),
    timezone,
    proxyProfile,
    clientIpHeader: headerName(options.clientIpHeader || env.CLIENT_IP_HEADER || (proxyProfile === 'cloudflare' ? 'cf-connecting-ip' : ''), 'CLIENT_IP_HEADER'),
    countryHeader: headerName(options.countryHeader || env.COUNTRY_HEADER || (proxyProfile === 'cloudflare' ? 'cf-ipcountry' : ''), 'COUNTRY_HEADER')
  });
}

module.exports = { loadConfig, positivePort, resolveDataDir };
