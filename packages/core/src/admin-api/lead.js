'use strict';

// Làm sạch & validate một lead do khách gửi từ form trong deck.
// PII tối thiểu: tên, điện thoại, email, ghi chú. Không nhận field lạ.

function cleanLead(body, context = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!context.project || !context.project.id) return null;

  const text = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const number = (value, min, max, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
  };

  const name = text(body.name, 120);
  const note = text(body.note, 1000);

  // Điện thoại: giữ chữ số và dấu + đầu, chấp nhận 8–15 chữ số (VN + quốc tế).
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phoneDigits = phoneRaw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const phoneCount = phoneDigits.replace(/\D/g, '').length;
  const phone = phoneCount >= 8 && phoneCount <= 15 ? phoneDigits.slice(0, 20) : '';

  // Email: kiểm tra tối giản, không cần hoàn hảo.
  const emailRaw = text(body.email, 200).toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : '';

  // Phải có ít nhất một cách liên hệ, nếu không thì bỏ.
  if (!phone && !email) return null;

  return {
    t: new Date().toISOString(),
    project: context.project.id,
    slug: context.project.slug,
    share: context.shareId || null,
    sid: text(body.sid, 80),
    vid: text(body.vid, 100),
    slide: number(body.slide, 0, 9999),
    name, phone, email, note,
    ip: text(context.ip, 80),
    country: text(context.country, 2).toUpperCase(),
    ua: text(context.userAgent, 500)
  };
}

module.exports = { cleanLead };
