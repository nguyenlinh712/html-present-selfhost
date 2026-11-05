'use strict';

// Hợp đồng phiên bản chung (Phase 8, lane V): revision của một file = hash nội dung.
// Dùng chung cho Free (selfhost) và Cloud để cùng một nội dung luôn ra cùng revision.
const crypto = require('node:crypto');

/** Trả về sha256 hex của nội dung (string hoặc Buffer). */
function contentRevision(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content == null ? '' : content), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = { contentRevision };
