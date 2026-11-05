'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function collect(source, relative = '', files = []) {
  const absolute = path.join(source, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Từ chối symbolic link: ${relative || '.'}`);
  if (stat.isFile()) { files.push(relative); return files; }
  if (!stat.isDirectory()) throw new Error(`Từ chối loại file không hỗ trợ: ${relative || '.'}`);
  for (const name of fs.readdirSync(absolute).sort()) collect(source, path.join(relative, name), files);
  return files;
}

function selectedRoots(source) {
  const configPath = path.join(source, 'config.json');
  if (!fs.existsSync(configPath)) throw new Error('Không tìm thấy config.json trong thư mục nguồn.');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const roots = new Set(['config.json', 'logs', 'covers']);
  for (const project of Array.isArray(config.projects) ? config.projects : []) {
    const dir = String(project.dir || '');
    if (!dir || dir.includes('\\') || path.isAbsolute(dir) || dir.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Đường dẫn thư mục dự án không an toàn: ${dir || '(trống)'}`);
    }
    roots.add(dir);
  }
  return [...roots].filter(rel => fs.existsSync(path.join(source, rel))).sort();
}

function assertNoSymlinkPath(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Từ chối đích qua symbolic link: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function assertNoSymlinkComponents(root, relative) {
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Từ chối nguồn qua symbolic link: ${relative}`);
  }
}

function migrate({ source, target, apply = false } = {}) {
  if (!source || !target) throw new Error('Cần chỉ định --source và --target.');
  source = path.resolve(source);
  target = path.resolve(target);
  if (source === target || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) {
    throw new Error('Nguồn và đích phải là hai thư mục tách biệt, không lồng nhau.');
  }
  if (!fs.lstatSync(source).isDirectory() || fs.lstatSync(source).isSymbolicLink()) throw new Error('Nguồn phải là thư mục thật, không phải symbolic link.');
  assertNoSymlinkPath(target);

  const roots = selectedRoots(source);
  for (const root of roots) assertNoSymlinkComponents(source, root);
  const files = [...new Set(roots.flatMap(root => collect(source, root)))].sort();
  const plan = files.map(rel => {
    const from = path.join(source, rel);
    const to = path.join(target, rel);
    assertNoSymlinkPath(to);
    const digest = hashFile(from);
    if (fs.existsSync(to)) {
      const stat = fs.lstatSync(to);
      if (!stat.isFile() || stat.isSymbolicLink() || hashFile(to) !== digest) throw new Error(`Đích đã tồn tại nhưng khác nội dung: ${rel}`);
    }
    return { path: rel.split(path.sep).join('/'), sha256: digest, exists: fs.existsSync(to) };
  });

  if (apply) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const item of plan) {
      if (item.exists) continue;
      const from = path.join(source, item.path);
      const to = path.join(target, item.path);
      assertNoSymlinkPath(to);
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
      const temporary = `${to}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.migration-tmp`;
      fs.copyFileSync(from, temporary, fs.constants.COPYFILE_EXCL);
      if (hashFile(temporary) !== item.sha256) { fs.rmSync(temporary, { force: true }); throw new Error(`Hash sau khi copy không khớp: ${item.path}`); }
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, to);
    }
  }
  return { source, target, applied: apply, files: plan };
}

function parseArgs(argv) {
  const result = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') result.source = argv[++i];
    else if (argv[i] === '--target') result.target = argv[++i];
    else if (argv[i] === '--apply') result.apply = true;
    else throw new Error(`Tham số không hợp lệ: ${argv[i]}`);
  }
  return result;
}

if (require.main === module) {
  try {
    const result = migrate(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${result.applied ? 'Đã sao chép' : 'Dry-run'}: ${result.files.length} file\n`);
    for (const file of result.files) process.stdout.write(`${file.exists ? 'đã có' : 'sẽ copy'}  ${file.path}  sha256:${file.sha256}\n`);
    if (!result.applied) process.stdout.write('Chạy lại với --apply để sao chép; nguồn sẽ được giữ nguyên.\n');
  } catch (error) {
    process.stderr.write(`Migration dừng an toàn: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { migrate, selectedRoots, collect, assertNoSymlinkPath, assertNoSymlinkComponents };
