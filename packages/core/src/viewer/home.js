'use strict';
const path = require('path');
const COVER_NAMES = ['cover', 'thumbnail', 'thumb', 'poster', 'preview'];
const COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* --------------------------- Ảnh bìa ------------------------------ */
// Ưu tiên cover cấu hình trong admin, sau đó tới file cover.* trong thư mục
function coverUrl(project, resolveCover) {
  if (project.cover) return project.cover; // đã là URL (http hoặc /_app/covers/.. hoặc /slug/..)
  return typeof resolveCover === 'function' ? resolveCover(project, COVER_NAMES, COVER_EXT) : null;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// team.html -> "Team", product-demo.html -> "Product Demo"
function prettyName(file) {
  return String(file).replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\p{L}/gu, c => c.toUpperCase()) || file;
}

/* ------------------------ Thành phần chung ------------------------ */
const DECK_SVG = '<svg class="deck" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const SEARCH_MIN = 5; // chỉ hiện ô tìm kiếm khi có từ 5 mục trở lên

function searchBox(placeholder) {
  return `<div class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    <input id="q" type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="Tìm kiếm">
  </div>`;
}

const GALLERY_JS = assetUrl => `<script src="${assetUrl('gallery.js')}" defer></script>`;

function footer(year, assetUrl = rel => `/_app/${rel}`, brandName = 'HTML Present', brandUrl = '') {
  return `<footer><div class="foot">
    <div class="brand"><img src="${assetUrl('assets/logo.svg')}" alt="${esc(brandName)}"></div>
    <div class="copy">© ${year} ${esc(brandName)}</div>
    ${brandUrl ? `<a class="site" href="${esc(brandUrl)}" target="_blank" rel="noopener">${esc(brandUrl)} ↗</a>` : ''}
  </div></footer>`;
}

function pageShell(title, desc, body, assetUrl = rel => `/_app/${rel}`, brandColor = '#2563eb') {
  return `<!doctype html><html lang="vi"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(brandColor)}">
<style>:root{--red:${esc(brandColor)};--red-dark:${esc(brandColor)};--red-soft:color-mix(in srgb,${esc(brandColor)} 10%,white)}</style>
<link rel="icon" href="${assetUrl('assets/favicon.svg')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${assetUrl('gallery.css')}">
</head><body>${body}</body></html>`;
}

/* ----------------------- Trang chủ (root) ------------------------- */
// Dự án hiện trên trang chủ: public (tự hiện) HOẶC restricted đã bật "Hiển thị"
function publicProjects(projects = [], resolveCover) {
  return projects
    .filter(p => p.visibility === 'public' || (p.visibility === 'restricted' && p.listed))
    .map(p => ({
      name: p.name, slug: p.slug, url: `/${p.slug}/`,
      description: p.description || '', cover: coverUrl(p, resolveCover),
      locked: p.visibility === 'restricted', needPassword: !!p.password
    }));
}

function projectTile(p) {
  const lockChip = p.locked
    ? `<span class="lock-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>${p.needPassword ? 'Cần mật khẩu' : 'Cần truy cập'}</span>`
    : '';
  const cover = p.cover
    ? `<div class="cover has-img" style="background-image:url('${esc(p.cover)}')"><span class="shade"></span>${lockChip}</div>`
    : `<div class="cover"><span class="initial">${esc(initials(p.name))}</span>${DECK_SVG}${lockChip}</div>`;
  const desc = p.description ? `<p class="desc">${esc(p.description)}</p>` : '';
  return `<a class="tile" data-name="${esc(p.name)}" href="${esc(p.url)}" target="_blank" rel="noopener">
    ${cover}
    <div class="body">
      <h3 class="title">${esc(p.name)}</h3>
      ${desc}
      <div class="meta"><span class="badge">Bản trình bày</span><span class="go">Xem ${ARROW}</span></div>
    </div>
  </a>`;
}

function renderHome(projectRows = [], opts = {}) {
  const tpl = opts.template;
  if (typeof tpl !== 'string') throw new TypeError('renderHome needs a template string');
  const projects = publicProjects(projectRows, opts.resolveCover);
  const tiles = projects.length
    ? projects.map(projectTile).join('\n')
    : `<div class="empty">${DECK_SVG.replace('class="deck"', '')}<p>Chưa có bản trình bày nào được công khai.</p></div>`;
  const search = projects.length >= SEARCH_MIN ? searchBox('Tìm bản trình bày…') : '';
  const assetUrl = opts.assetUrl || (rel => `/_app/${rel}`);
  const branding = opts.branding || {};
  const brandName = branding.productName || 'HTML Present';
  const logoUrl = branding.logoUrl || assetUrl('assets/logo.svg');
  const brandColor = branding.primaryColor || '#2563eb';
  let output = tpl
    .replaceAll('<!--TILES-->', tiles)
    .replaceAll('<!--SEARCH-->', search)
    .replaceAll('<!--COUNT-->', String(projects.length))
    .replaceAll('<!--YEAR-->', String(new Date().getFullYear()))
    .replaceAll('/_app/assets/favicon.svg', assetUrl('assets/favicon.svg'))
    .replaceAll('/_app/assets/logo.svg', () => esc(logoUrl))
    .replaceAll('HTML Present', () => esc(brandName))
    .replaceAll('#2563eb', () => esc(brandColor))
    .replace('/_app/gallery.css', assetUrl('gallery.css'))
    .replace('/_app/gallery.js', assetUrl('gallery.js'));
  output = output.replace('</head>', `<style>:root{--red:${esc(brandColor)};--red-dark:${esc(brandColor)};--red-soft:color-mix(in srgb,${esc(brandColor)} 10%,white)}</style></head>`);
  if (branding.showFooter === false) output = output.replace(/<footer>[\s\S]*?<\/footer>/i, '');
  return output;
}

/* --------------------- Trang bên trong dự án ---------------------- */
// project: bản ghi; entries: direct children from the files repository.
function renderProject(project, entries = [], opts = {}) {
  const branding = opts.branding || {};
  const brandName = branding.productName || opts.brandName || 'HTML Present';
  const brandColor = branding.primaryColor || opts.brandColor || '#2563eb';
  const logoUrl = branding.logoUrl || opts.assetUrl && opts.assetUrl('assets/logo.svg') || '/_app/assets/logo.svg';
  const token = opts.token || '';
  const q = token ? `?k=${encodeURIComponent(token)}` : '';
  const isRoot = opts.isRoot !== false;
  const assetUrl = opts.assetUrl || (rel => `/_app/${rel}`);
  const projectBasePath = String(opts.projectBasePath || '').replace(/\/+$/, '');
  const resolveCover = opts.resolveCover;
  const dirs = [], slides = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.type === 'dir' || (typeof e.isDirectory === 'function' && e.isDirectory())) dirs.push(e.name);
    else if (/\.html?$/i.test(e.name)) slides.push(e.name);
  }
  dirs.sort((a, b) => a.localeCompare(b, 'vi'));
  slides.sort((a, b) => a.localeCompare(b, 'vi'));

  const dirTiles = dirs.map(name => `<a class="tile folder" data-name="${esc(prettyName(name))}" href="${encodeURIComponent(name)}/${q}">
      <div class="cover"><span class="initial">${esc(initials(prettyName(name)))}</span>
        <svg class="deck" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
      <div class="body"><h3 class="title">${esc(prettyName(name))}</h3>
        <div class="meta"><span class="badge">Thư mục</span><span class="go">Mở ${ARROW}</span></div></div>
    </a>`);

  const slideTiles = slides.map(name => `<a class="tile" data-name="${esc(prettyName(name))}" href="${encodeURIComponent(name)}${q}">
      <div class="cover"><span class="initial">${esc(initials(prettyName(name)))}</span>${DECK_SVG}</div>
      <div class="body"><h3 class="title">${esc(prettyName(name))}</h3>
        <div class="meta"><span class="badge">Slide</span><span class="go">Xem ${ARROW}</span></div></div>
    </a>`);

  const tiles = dirTiles.concat(slideTiles).join('\n')
    || `<div class="empty">${DECK_SVG}<p>Chưa có nội dung.</p></div>`;

  const cover = isRoot ? coverUrl(project, resolveCover) : null;
  const partner = cover ? `<img class="partner" src="${esc(cover)}" alt="${esc(project.name)}">` : '';
  const heading = isRoot ? project.name : prettyName(path.basename(opts.relDir || ''));
  const backHref = isRoot ? (projectBasePath ? `${projectBasePath}/` : '/') : `../${q}`;
  const backLabel = isRoot ? 'Thư viện trình bày' : project.name;
  const total = dirs.length + slides.length;
  const countLabel = `${total} ${slides.length && !dirs.length ? 'bài trình bày' : 'mục'}`;
  const descLine = (isRoot && project.description) ? esc(project.description) : countLabel;

  const body = `<div class="topline"></div>
  <div class="nav">
    <a class="back" href="${esc(backHref)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg> ${esc(backLabel)}</a>
    <img class="nav-logo" src="${esc(logoUrl)}" alt="${esc(brandName)}">
  </div>
  <header class="hero has-nav">
    ${partner}
    <h1>${esc(heading)}</h1>
    <p>${descLine}</p>
    <div class="divider"></div>
  </header>
  <main class="wrap">
    <div class="toolbar">
      <p class="count">${esc(countLabel)}</p>
      ${total >= SEARCH_MIN ? searchBox('Tìm bài trình bày…') : ''}
    </div>
    <div class="grid">${tiles}</div>
    <div class="nores" id="noRes">Không tìm thấy mục phù hợp.</div>
  </main>
  ${branding.showFooter === false ? '' : footer(new Date().getFullYear(), rel => rel === 'assets/logo.svg' ? logoUrl : assetUrl(rel), brandName, opts.brandUrl || '')}
  ${GALLERY_JS(assetUrl)}`;

  return pageShell(`${project.name} · ${brandName}`, `Bản trình bày của ${project.name}`, body, assetUrl, brandColor);
}

/* ----------------------- Trang mở khoá --------------------------- */
function renderUnlock(project, opts = {}) {
  const branding = opts.branding || {};
  const brandName = branding.productName || opts.brandName || 'HTML Present';
  const brandColor = branding.primaryColor || opts.brandColor || '#2563eb';
  const assetUrl = opts.assetUrl || (rel => `/_app/${rel}`);
  const hasPw = !!opts.hasPassword;
  const bad = !!opts.badToken;
  const unlockUrl = safeInlineJson(opts.unlockUrl || '/__unlock');
  const unlockContext = safeInlineJson(opts.unlockContext || {});
  const lock = '<svg class="lock-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  let main;
  if (hasPw) {
    main = `<p class="lock-sub">${bad ? 'Liên kết không hợp lệ hoặc đã hết hạn. Nhập mật khẩu để tiếp tục xem.' : 'Nội dung này được bảo vệ. Nhập mật khẩu để xem.'}</p>
      <form id="unlockForm" class="lock-form" autocomplete="on">
        <input type="hidden" id="slug" value="${esc(project.slug)}">
        <input id="pw" type="password" placeholder="Mật khẩu" autocomplete="current-password" autofocus>
        <button type="submit">Mở khoá</button>
      </form>
      <p class="lock-err" id="err"></p>
      <script>
      (function(){var f=document.getElementById('unlockForm');
      f.addEventListener('submit',async function(e){e.preventDefault();
        var err=document.getElementById('err');err.textContent='';
        try{var r=await fetch(${unlockUrl},{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(Object.assign({},${unlockContext},{slug:document.getElementById('slug').value,password:document.getElementById('pw').value}))});
          var d={};try{d=await r.json();}catch(_){}
          if(r.ok){location.reload();}else{err.textContent=(d&&d.error)||'Sai mật khẩu';}
        }catch(_){err.textContent='Có lỗi, thử lại.';}});})();
      </script>`;
  } else {
    main = `<p class="lock-sub">${bad ? 'Liên kết không hợp lệ hoặc đã bị thu hồi.' : 'Nội dung này được bảo vệ, cần liên kết hợp lệ để xem.'}</p>
      <a class="lock-home" href="/">← Về thư viện</a>`;
  }

  const body = `<div class="topline"></div>
  <main class="lock-wrap">
    <div class="lock-card">
      <img class="lock-logo" src="${esc(branding.logoUrl || assetUrl('assets/logo.svg'))}" alt="${esc(brandName)}">
      <div class="lock-badge">${lock}</div>
      <h1 class="lock-title">${esc(project.name)}</h1>
      ${main}
    </div>
  </main>
  ${branding.showFooter === false ? '' : footer(new Date().getFullYear(), rel => rel === 'assets/logo.svg' && branding.logoUrl ? branding.logoUrl : assetUrl(rel), brandName)}`;
  return pageShell(`${project.name} · ${brandName}`, 'Nội dung được bảo vệ', body, assetUrl, brandColor);
}

function safeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

module.exports = { renderHome, renderProject, renderUnlock, publicProjects, coverUrl };
