'use strict';
// Shared multipart upload and safe slide-archive extraction.
//
// Luồng chuẩn:
//   const ctx = await receiveUpload(req, { stagingRoot });
//   const info = await extractUpload(ctx);
//   const dest = await promoteStaging(info.outDir, destDir, { conflict, trashRoot });
//
// `receiveUpload` stream file multipart ra `.uploads/<id>/_src/<name>` (không nhồi RAM).
// `extractUpload` nhận .zip (giải nén) hoặc .html đơn (chép thẳng), rồi "làm phẳng"
// nếu zip có đúng 1 thư mục gốc, và kiểm chéo bắt buộc có >=1 .html.
// `promoteStaging` chuyển outDir sang vị trí thật — nếu đích đã có:
//   - 'overwrite': chuyển bản cũ vào `.trash/<name>-<ts>/`
//   - 'rename':    tự thêm hậu tố `-2`, `-3` …
//   - 'fail':      báo lỗi 409
//
// An toàn: chặn zip-slip (`..`, path tuyệt đối), symlink, giới hạn upload và tổng
// giải nén (chống zip-bomb), whitelist đuôi, bỏ file hệ thống, decode UTF-8/CP437
// để tên tiếng Việt không hỏng.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const stream = require('stream');
const Busboy = require('busboy');
const yauzl = require('yauzl');

const DEFAULT_LIMITS = {
  maxUploadBytes: 100 * 1024 * 1024,     // tổng upload ≤100MB
  maxEntries:     3000,                   // ≤3000 entry trong zip
  maxTotalBytes:  500 * 1024 * 1024,      // tổng sau giải nén ≤500MB (chống bomb)
  maxFileBytes:   100 * 1024 * 1024       // mỗi file ≤100MB
};

const ALLOWED_EXT = new Set([
  'html','htm','css','js','mjs','json','map',
  'png','jpg','jpeg','gif','svg','webp','avif','ico',
  'woff','woff2','ttf','otf','eot',
  'mp4','webm','mp3','wav','ogg',
  'pdf','txt','md','csv','xml'
]);

const IGNORE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const IGNORE_PATHS = /^__MACOSX(\/|$)/;

/* ================= CP437 → UTF-8 (zip legacy) =====================
 * Zip tạo bằng Windows cũ ghi tên file theo CP437 khi KHÔNG bật
 * cờ bit 11. Tên tiếng Việt sẽ hỏng nếu không dịch tay. Bảng dưới
 * đủ cho ký tự Latin + ký tự in được. Zip hiện đại (bit 11 bật) đã
 * là UTF-8, bỏ qua bảng này.
 * ================================================================= */
const CP437 = [
  '\x00','☺','☻','♥','♦','♣','♠','•',
  '◘','○','◙','♂','♀','♪','♫','☼',
  '►','◄','↕','‼','¶','§','▬','↨',
  '↑','↓','→','←','∟','↔','▲','▼',
  ' ','!','"','#','$','%','&',"'",'(',')','*','+',',','-','.','/',
  '0','1','2','3','4','5','6','7','8','9',':',';','<','=','>','?',
  '@','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O',
  'P','Q','R','S','T','U','V','W','X','Y','Z','[','\\',']','^','_',
  '`','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o',
  'p','q','r','s','t','u','v','w','x','y','z','{','|','}','~','⌂',
  'Ç','ü','é','â','ä','à','å','ç',
  'ê','ë','è','ï','î','ì','Ä','Å',
  'É','æ','Æ','ô','ö','ò','û','ù',
  'ÿ','Ö','Ü','¢','£','¥','₧','ƒ',
  'á','í','ó','ú','ñ','Ñ','ª','º',
  '¿','⌐','¬','½','¼','¡','«','»',
  '░','▒','▓','│','┤','╡','╢','╖',
  '╕','╣','║','╗','╝','╜','╛','┐',
  '└','┴','┬','├','─','┼','╞','╟',
  '╚','╔','╩','╦','╠','═','╬','╧',
  '╨','╤','╥','╙','╘','╒','╓','╫',
  '╪','┘','┌','█','▄','▌','▐','▀',
  'α','ß','Γ','π','Σ','σ','µ','τ',
  'Φ','Θ','Ω','δ','∞','φ','ε','∩',
  '≡','±','≥','≤','⌠','⌡','÷','≈',
  '°','∙','·','√','ⁿ','²','■',' '
];

function decodeFileName(nameBuf, flags) {
  if (flags & 0x800) return nameBuf.toString('utf8');  // bit 11: tên UTF-8
  let out = '';
  for (const b of nameBuf) out += CP437[b] || '?';
  return out;
}

/* ====================================================================
 * 1) Nhận multipart (busboy) → file tạm.
 *    Trả { id, stagingDir, file:{name,path,bytes,mimetype}, fields, limits }
 * ================================================================= */

function receiveUpload(req, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const stagingRoot = opts.stagingRoot;
  if (!stagingRoot) throw new Error('receiveUpload: thiếu stagingRoot');

  return new Promise((resolve, reject) => {
    const id = crypto.randomBytes(8).toString('hex');
    const stagingDir = path.join(stagingRoot, id);
    const srcDir = path.join(stagingDir, '_src');
    fs.mkdirSync(srcDir, { recursive: true });

    const bb = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: limits.maxUploadBytes, fieldSize: 1024 * 1024 }
    });

    const fields = {};
    let file = null, fileTooBig = false, aborted = false, closed = false;
    let pending = 0;      // số file đang ghi ra đĩa — chờ xong rồi mới resolve
    const finish = () => {
      if (aborted || pending > 0 || !closed) return;
      if (fileTooBig) return fail(httpErr(413, `File lớn hơn giới hạn ${bytesToMB(limits.maxUploadBytes)}MB`));
      if (!file)      return fail(httpErr(400, 'Thiếu file upload (trường "file")'));
      resolve({ id, stagingDir, file, fields, limits });
    };

    const fail = (err) => {
      if (aborted) return; aborted = true;
      try { req.unpipe(bb); } catch {}
      cleanupSync(stagingDir);
      reject(err);
    };

    bb.on('field', (name, value) => {
      if (Object.keys(fields).length < 32 && typeof value === 'string' && value.length < 4096) {
        fields[name] = value;
      }
    });

    bb.on('file', (fieldName, s, info) => {
      if (fieldName !== 'file') { s.resume(); return; }
      const safe = sanitizeSingleName(info.filename || 'upload');
      const dest = path.join(srcDir, safe);
      const ws = fs.createWriteStream(dest);
      let bytes = 0;
      pending++;
      s.on('data', (chunk) => { bytes += chunk.length; });
      s.on('limit', () => { fileTooBig = true; });
      stream.pipeline(s, ws, (err) => {
        pending--;
        if (aborted) return;
        if (err) return fail(err);
        file = { name: safe, path: dest, bytes, mimetype: info.mimeType || info.mime };
        finish();
      });
    });

    bb.on('error', fail);
    bb.on('close', () => { closed = true; finish(); });

    req.pipe(bb);
  });
}

/* ====================================================================
 * 2) Giải nén (hoặc chép html đơn) → `<stagingDir>/out/`.
 *    Trả { stagingDir, outDir, files[], htmlFiles[], skipped[] }
 * ================================================================= */

async function extractUpload(ctx) {
  const { stagingDir, file, limits } = ctx;
  const outDir = path.join(stagingDir, 'out');
  await fsp.mkdir(outDir, { recursive: true });
  const skipped = [];
  const written = [];

  if (/\.html?$/i.test(file.name)) {
    const dest = path.join(outDir, file.name);
    await fsp.copyFile(file.path, dest);
    written.push({ relPath: file.name, bytes: file.bytes });
  } else if (/\.zip$/i.test(file.name)) {
    await extractZip(file.path, outDir, limits, skipped, written);
  } else {
    throw httpErr(400, 'Chỉ chấp nhận file .zip hoặc .html');
  }

  // Nếu zip chỉ có 1 thư mục gốc (vd `my-deck/index.html`), kéo nội dung lên.
  await flattenSingleRoot(outDir);

  const files = await listTree(outDir);
  const htmlFiles = files.filter(p => /\.html?$/i.test(p));
  if (!htmlFiles.length) throw httpErr(400, 'Không tìm thấy file .html hợp lệ trong gói tải lên');

  return { stagingDir, outDir, files, htmlFiles, skipped };
}

function extractZip(zipPath, outDir, limits, skipped, written) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, decodeStrings: false }, (err, zip) => {
      if (err) return reject(httpErr(400, 'Không mở được file zip: ' + err.message));

      let entries = 0, totalBytes = 0, settled = false;
      const bail = (e) => { if (settled) return; settled = true; try { zip.close(); } catch {} reject(e); };
      const done = () => { if (settled) return; settled = true; resolve(); };

      zip.on('error', bail);
      zip.on('end', done);

      zip.on('entry', (entry) => {
        entries++;
        if (entries > limits.maxEntries) return bail(httpErr(413, `Zip có quá nhiều mục (>${limits.maxEntries})`));

        const name = decodeFileName(entry.fileName, entry.generalPurposeBitFlag);
        const normalized = normalizeEntryPath(name);
        if (!normalized) { skipped.push({ name, reason: 'tên không hợp lệ' }); return zip.readEntry(); }
        if (IGNORE_PATHS.test(normalized) || IGNORE_NAMES.has(path.basename(normalized)) ||
            normalized.split('/').some(p => p && p.startsWith('.'))) {
          skipped.push({ name: normalized, reason: 'file hệ thống' });
          return zip.readEntry();
        }

        // Symlink (external attrs cao 4 bit = 0xA → symlink) → chặn.
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xFFFF;
        if ((unixMode & 0xF000) === 0xA000) {
          skipped.push({ name: normalized, reason: 'symlink bị chặn' });
          return zip.readEntry();
        }

        const dest = path.resolve(outDir, normalized);
        if (dest !== outDir && !dest.startsWith(outDir + path.sep)) {
          return bail(httpErr(400, `Zip-slip bị chặn: ${normalized}`));
        }

        if (/\/$/.test(normalized)) {   // thư mục
          fsp.mkdir(dest, { recursive: true }).then(() => zip.readEntry()).catch(bail);
          return;
        }

        const ext = (path.extname(normalized).slice(1) || '').toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          skipped.push({ name: normalized, reason: 'đuôi ".' + (ext || '?') + '" không cho phép' });
          return zip.readEntry();
        }
        if (entry.uncompressedSize > limits.maxFileBytes) {
          skipped.push({ name: normalized, reason: `>${bytesToMB(limits.maxFileBytes)}MB` });
          return zip.readEntry();
        }

        fsp.mkdir(path.dirname(dest), { recursive: true }).then(() => {
          zip.openReadStream(entry, (err2, rs) => {
            if (err2) return bail(err2);
            let bytes = 0;
            const ws = fs.createWriteStream(dest);
            rs.on('data', (chunk) => {
              bytes += chunk.length; totalBytes += chunk.length;
              if (bytes > limits.maxFileBytes || totalBytes > limits.maxTotalBytes) {
                rs.destroy(httpErr(413, `Zip bomb bị chặn (vượt ${bytesToMB(limits.maxTotalBytes)}MB)`));
              }
            });
            stream.pipeline(rs, ws, (err3) => {
              if (err3) return bail(err3);
              written.push({ relPath: normalized, bytes });
              zip.readEntry();
            });
          });
        }).catch(bail);
      });

      zip.readEntry();
    });
  });
}

/* ====================================================================
 * 3) Promote staging → thư mục đích.
 * ================================================================= */

async function promoteStaging(stagingOutDir, destDir, opts = {}) {
  const mode = opts.conflict || 'fail';
  const trashRoot = opts.trashRoot;

  await fsp.mkdir(path.dirname(destDir), { recursive: true });

  let finalDir = destDir;
  if (await exists(destDir)) {
    if (mode === 'fail') throw httpErr(409, 'Thư mục đích đã tồn tại');
    if (mode === 'overwrite') {
      if (!trashRoot) throw new Error('promoteStaging: thiếu trashRoot cho mode overwrite');
      await fsp.mkdir(trashRoot, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const trashPath = path.join(trashRoot, `${path.basename(destDir)}-${stamp}`);
      await fsp.rename(destDir, trashPath);
    } else if (mode === 'rename') {
      let i = 2, candidate;
      do { candidate = `${destDir}-${i++}`; } while (await exists(candidate));
      finalDir = candidate;
    }
  }

  await fsp.rename(stagingOutDir, finalDir);
  return finalDir;
}

/* Dọn staging cũ (>24h) khi khởi động. */
async function cleanupStaging(stagingRoot, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const entries = await fsp.readdir(stagingRoot, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(stagingRoot, e.name);
      try {
        const st = await fsp.stat(full);
        if (st.mtimeMs < cutoff) await fsp.rm(full, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

/* ======================= Helpers ================================== */

function sanitizeSingleName(name) {
  const base = String(name).replace(/\\/g, '/').split('/').pop() || 'upload';
  return base.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 180) || 'upload';
}

function normalizeEntryPath(name) {
  let s = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s) return '';
  const parts = s.split('/');
  for (const p of parts) {
    if (p === '..' || /^[A-Za-z]:$/.test(p)) return '';
  }
  const trailing = s.endsWith('/') ? '/' : '';
  const clean = parts.filter(Boolean).join('/');
  return clean + trailing;
}

async function flattenSingleRoot(outDir) {
  const entries = await fsp.readdir(outDir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const inner = path.join(outDir, entries[0].name);
  const tmp = path.join(path.dirname(outDir), '_flatten_' + crypto.randomBytes(4).toString('hex'));
  await fsp.rename(inner, tmp);
  await fsp.rmdir(outDir);
  await fsp.rename(tmp, outDir);
}

async function listTree(root, prefix = '') {
  const out = [];
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...(await listTree(path.join(root, e.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function exists(p) { try { await fsp.stat(p); return true; } catch { return false; } }
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
function bytesToMB(n) { return Math.round(n / 1024 / 1024); }
function cleanupSync(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

module.exports = {
  receiveUpload, extractUpload, promoteStaging, cleanupStaging,
  decodeFileName, normalizeEntryPath, extractZip, ALLOWED_EXT, DEFAULT_LIMITS
};
