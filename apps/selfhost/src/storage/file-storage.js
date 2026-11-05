'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const DEFAULT_CTX = Object.freeze({ tenantId: 'default', user: null, role: 'owner' });

function createFileStorage({ repo, dataDir } = {}) {
  if (!repo || !repo.projects) throw new TypeError('FileRepo is required');
  const rootDir = path.resolve(dataDir || process.cwd());

  async function resolveKey(key, { createParent = false, allowMissing = false } = {}) {
    const raw = String(key || '').replace(/\\/g, '/');
    const parts = raw.split('/').filter(Boolean);
    if (parts.length < 2 || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) {
      throw Object.assign(new Error('Storage key không hợp lệ.'), { status: 400 });
    }
    const [projectId, ...relativeParts] = parts;
    const project = await repo.projects.get(DEFAULT_CTX, projectId);
    if (!project || typeof project.dir !== 'string' || path.isAbsolute(project.dir)) return null;
    const projectRoot = path.resolve(rootDir, project.dir);
    if (!projectRoot.startsWith(rootDir + path.sep)) return null;
    const filePath = path.resolve(projectRoot, ...relativeParts);
    if (!filePath.startsWith(projectRoot + path.sep)) return null;
    const realDataRoot = await fsp.realpath(rootDir).catch(() => null);
    if (!realDataRoot) return null;
    let realRoot;
    try { realRoot = await fsp.realpath(projectRoot); }
    catch {
      if (!allowMissing) return null;
      await fsp.mkdir(projectRoot, { recursive: true });
      realRoot = await fsp.realpath(projectRoot);
    }
    if (!realDataRoot || (realRoot !== realDataRoot && !realRoot.startsWith(realDataRoot + path.sep))) return null;
    const parentPath = path.dirname(filePath);
    const relativeParent = path.relative(projectRoot, parentPath);
    let ancestor = projectRoot;
    try {
      const rootStat = await fsp.lstat(projectRoot);
      if (rootStat.isSymbolicLink()) return null;
      for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
        ancestor = path.join(ancestor, segment);
        let stat;
        try { stat = await fsp.lstat(ancestor); }
        catch (error) { if (error.code === 'ENOENT') break; throw error; }
        if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
      }
    } catch { return null; }
    if (createParent) await fsp.mkdir(parentPath, { recursive: true });
    let realBoundary;
    try { realBoundary = await fsp.realpath(createParent ? parentPath : filePath); }
    catch { return allowMissing ? { key: raw, project, projectRoot, filePath, realRoot } : null; }
    if (realBoundary !== realRoot && !realBoundary.startsWith(realRoot + path.sep)) return null;
    return { key: raw, project, projectRoot, filePath, realRoot };
  }

  return {
    async put(key, input) {
      const target = await resolveKey(key, { createParent: true, allowMissing: true });
      if (!target) throw Object.assign(new Error('Không tìm thấy dự án.'), { status: 404 });
      const parent = await fsp.realpath(path.dirname(target.filePath));
      if (parent !== target.realRoot && !parent.startsWith(target.realRoot + path.sep)) throw Object.assign(new Error('Storage path vượt khỏi dự án.'), { status: 400 });
      const temp = path.join(parent, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      try {
        if (Buffer.isBuffer(input) || typeof input === 'string') await fsp.writeFile(temp, input, { mode: 0o600 });
        else await pipeline(input, fs.createWriteStream(temp, { mode: 0o600, flags: 'wx' }));
        await fsp.rename(temp, target.filePath);
        const stat = await fsp.stat(target.filePath);
        return { key: target.key, size: stat.size };
      } catch (error) {
        await fsp.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    },

    async get(key) {
      const target = await resolveKey(key);
      if (!target) return null;
      const stat = await fsp.stat(target.filePath).catch(() => null);
      if (!stat || !stat.isFile()) return null;
      return fs.createReadStream(target.filePath);
    },

    async list(prefix) {
      const raw = String(prefix || '').replace(/\\/g, '/').replace(/\/+$/, '');
      const parts = raw.split('/').filter(Boolean);
      if (parts.length < 1 || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return [];
      const projectId = parts[0];
      const project = await repo.projects.get(DEFAULT_CTX, projectId);
      if (!project || typeof project.dir !== 'string' || path.isAbsolute(project.dir)) return [];
      const projectRoot = path.resolve(rootDir, project.dir);
      const start = path.resolve(projectRoot, ...parts.slice(1));
      if (start !== projectRoot && !start.startsWith(projectRoot + path.sep)) return [];
      const base = await fsp.realpath(start).catch(() => null);
      const realRoot = await fsp.realpath(projectRoot).catch(() => null);
      const realDataRoot = await fsp.realpath(rootDir).catch(() => null);
      if (!base || !realRoot || !realDataRoot || (realRoot !== realDataRoot && !realRoot.startsWith(realDataRoot + path.sep)) || (base !== realRoot && !base.startsWith(realRoot + path.sep))) return [];
      const out = [];
      async function walk(dir, rel) {
        const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          const child = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(child, childRel);
          else if (entry.isFile()) {
            const stat = await fsp.stat(child).catch(() => null);
            if (stat) out.push({ key: `${projectId}/${parts.slice(1).concat(childRel).filter(Boolean).join('/')}`, size: stat.size });
          }
        }
      }
      await walk(base, '');
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },

    async deletePrefix(prefix) {
      const raw = String(prefix || '').replace(/\\/g, '/').replace(/\/+$/, '');
      const parts = raw.split('/').filter(Boolean);
      if (parts.length < 2 || parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) {
        throw Object.assign(new Error('Chỉ có thể xóa tiền tố bên trong một dự án.'), { status: 400 });
      }
      const target = await resolveKey(raw, { allowMissing: true });
      if (!target) return 0;
      const realTarget = await fsp.realpath(target.filePath).catch(() => null);
      if (!realTarget) return 0;
      if (realTarget === target.realRoot || !realTarget.startsWith(target.realRoot + path.sep)) throw Object.assign(new Error('Storage path vượt khỏi dự án.'), { status: 400 });
      const files = await this.list(raw);
      await fsp.rm(realTarget, { recursive: true, force: true });
      return files.length;
    }
  };
}

module.exports = { createFileStorage };
