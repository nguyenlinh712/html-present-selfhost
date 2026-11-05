'use strict';

const session = require('express-session');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class FileSessionStore extends session.Store {
  constructor({ directory } = {}) {
    super();
    if (!directory) throw new TypeError('Session directory is required.');
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.cleanupTimer = setInterval(() => this.cleanup(), 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  filename(sid) { return path.join(this.directory, `${crypto.createHash('sha256').update(String(sid)).digest('hex')}.json`); }

  get(sid, callback) {
    const filename = this.filename(sid);
    fs.lstat(filename, (statError, stat) => {
      if (statError) return callback(statError.code === 'ENOENT' ? null : statError);
      if (stat.isSymbolicLink() || !stat.isFile()) return callback(null, null);
      fs.readFile(filename, 'utf8', (error, raw) => {
      if (error) return callback(error.code === 'ENOENT' ? null : error);
      try {
        const value = JSON.parse(raw);
        if (value.expiresAt && value.expiresAt <= Date.now()) {
          fs.unlink(filename, () => callback(null, null));
          return;
        }
        callback(null, value.session);
      } catch (parseError) { callback(parseError); }
      });
    });
  }

  set(sid, value, callback = () => {}) {
    const cookieExpires = value && value.cookie && value.cookie.expires;
    const expiresAt = cookieExpires ? new Date(cookieExpires).getTime() : Date.now() + 7 * 24 * 60 * 60 * 1000;
    const target = this.filename(sid);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFile(temporary, JSON.stringify({ expiresAt, session: value }), { mode: 0o600 }, error => {
      if (error) return callback(error);
      fs.rename(temporary, target, renameError => {
        if (!renameError) return callback();
        fs.unlink(temporary, () => callback(renameError));
      });
    });
  }

  touch(sid, value, callback) { this.set(sid, value, callback); }

  destroy(sid, callback = () => {}) { fs.unlink(this.filename(sid), error => callback(error && error.code !== 'ENOENT' ? error : null)); }

  cleanup() {
    let names;
    try { names = fs.readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
    catch { return; }
    const now = Date.now();
    for (const name of names) {
      const filename = path.join(this.directory, name);
      try {
        if (fs.lstatSync(filename).isSymbolicLink()) { fs.unlinkSync(filename); continue; }
        const item = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (!item.expiresAt || item.expiresAt <= now) fs.unlinkSync(filename);
      } catch { try { fs.unlinkSync(filename); } catch {} }
    }
  }
}

module.exports = { FileSessionStore };
