'use strict';

const DEFAULT_BRANDING = Object.freeze({
  productName: 'HTML Present',
  logoUrl: '',
  primaryColor: '#2563eb',
  showFooter: true
});

function normalizeBranding(input = {}) {
  const value = { ...DEFAULT_BRANDING, ...input };
  const productName = String(value.productName || '').trim();
  if (!productName || productName.length > 60 || /[<>\u0000-\u001f\u007f]/.test(productName)) throw new Error('Tên sản phẩm cần từ 1 đến 60 ký tự.');
  const logoUrl = String(value.logoUrl || '').trim();
  if (logoUrl && !(/^(https:\/\/[^\s"'<>]+|\/_app\/[a-zA-Z0-9_./-]+)$/.test(logoUrl) && !logoUrl.split('/').includes('..'))) {
    throw new Error('Logo cần là HTTPS hoặc đường dẫn trong /_app/.');
  }
  const primaryColor = String(value.primaryColor || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) throw new Error('Màu chính cần có dạng #RRGGBB.');
  return { productName, logoUrl, primaryColor: primaryColor.toLowerCase(), showFooter: value.showFooter !== false };
}

module.exports = { DEFAULT_BRANDING, normalizeBranding };
