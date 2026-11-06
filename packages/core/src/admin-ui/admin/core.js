// HTML Present admin — hạ tầng dùng chung cho mọi tab.
// Phơi ra window.LT.* (namespace), các hàm toàn cục cũ vẫn còn (api/toast/copy/...) để
// code trong admin.html gọi trực tiếp theo kiểu onclick="..." như hiện nay.

// API tokens UI (cho openclaw/CI/curl upload không cần login)
window.loadApiTokens = async function(){
  try {
    const r = await fetch('/_admin/api/tokens', { credentials:'same-origin' });
    const d = await r.json();
    const el = document.getElementById('tokenList'); if (!el) return;
    const rows = (d.tokens || []).map(t =>
      '<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">' +
        '<span style="flex:1"><b>' + LT.esc(t.label) + '</b> <span class="muted" style="font-size:11px">· ' + LT.fmtDate(t.createdAt) + (t.lastUsedAt?' · dùng '+LT.fmtDate(t.lastUsedAt):' · chưa dùng') + '</span></span>' +
        '<button class="btn danger xs" onclick="deleteApiToken(\'' + t.id + '\')">Thu hồi</button>' +
      '</div>').join('');
    el.innerHTML = rows || '<p class="muted" style="font-size:13px;margin:0">Chưa có token nào.</p>';
  } catch (_) {}
};
window.createApiToken = async function(){
  const label = document.getElementById('tokenLabel').value.trim() || 'Token';
  const CSRF = (await (await fetch('/_admin/api/me')).json()).csrfToken;
  const r = await fetch('/_admin/api/tokens', { method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json','x-csrf-token':CSRF},
    body: JSON.stringify({ label }) });
  const d = await r.json();
  if (!r.ok) { alert(d.error||'Lỗi'); return; }
  const box = document.getElementById('tokenNew');
  box.classList.remove('hidden');
  box.innerHTML = '⚠ <b>Copy ngay</b> (token này không hiện lại):<br>' + LT.esc(d.token);
  document.getElementById('tokenLabel').value = '';
  window.loadApiTokens();
};
window.deleteApiToken = async function(id){
  if (!confirm('Thu hồi token này? Agent dùng token này sẽ mất quyền ngay.')) return;
  const CSRF = (await (await fetch('/_admin/api/me')).json()).csrfToken;
  await fetch('/_admin/api/tokens/'+id, { method:'DELETE', credentials:'same-origin', headers:{'x-csrf-token':CSRF} });
  window.loadApiTokens();
};

(function () {
  'use strict';

  const LT = window.LT = window.LT || {};
  // Lane A/C/E/F sẽ push vào các mảng dưới (xem PHASE2-PLAN.md §8.5).
  LT.contentActions = LT.contentActions || []; // {id, label, icon, show(node,project), run(node,project)}
  LT.projectToggles = LT.projectToggles || []; // {field, label, hint?}
  LT.tabs = LT.tabs || {};                     // tên-tab -> initFn
  LT.state = LT.state || { needsSetup: false, baseUrl: '', branding: null, timezone: 'Asia/Ho_Chi_Minh' };

  const STATE = LT.state;
  let csrfToken = '';
  const VIS = LT.VIS = { public: 'Công khai', restricted: 'Hạn chế', off: 'Tắt' };

  /* ---------------------- Gọi API quản trị ------------------------- */
  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()) && csrfToken) opt.headers['X-CSRF-Token'] = csrfToken;
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch('/_admin' + url, opt);
    let data = null; try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((data && data.error) || ('Lỗi ' + r.status));
    return data;
  }

  /* ------------------------- Tiện ích UI --------------------------- */
  function toast(m) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = m; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function copy(t) {
    navigator.clipboard.writeText(t).then(() => toast('Đã copy link'));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function attr(s) { return esc(s).replace(/'/g, '&#39;'); }
  function flag(cc) {
    if (!cc || cc.length !== 2 || !/^[a-zA-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  function fmtDate(iso) { if (!iso) return '—'; return iso.replace('T', ' ').slice(0, 16); }
  function fmtDur(s) {
    s = Math.round(s || 0); if (s < 60) return s + ' giây';
    const m = Math.floor(s / 60), ss = s % 60;
    return ss ? m + ' phút ' + ss + ' giây' : m + ' phút';
  }

  /* ----------------------- Modal dùng chung ------------------------ */
  // Lane C/E/F mở modal: openModal('<div>...</div>') hoặc openModal(domNode).
  // Trả về {close, root}; đóng bằng Esc hoặc click nền hoặc nút .modal-x.
  function openModal(content, opts) {
    const o = opts || {};
    const host = document.getElementById('modal');
    if (!host) return null;
    host.classList.remove('hidden');
    host.innerHTML = `<div class="modal-mask"></div>
      <div class="modal-card${o.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
        <button class="modal-x" aria-label="Đóng" type="button">✕</button>
        <div class="modal-body"></div>
      </div>`;
    const body = host.querySelector('.modal-body');
    if (typeof content === 'string') body.innerHTML = content;
    else if (content instanceof Node) body.appendChild(content);
    const close = () => { host.classList.add('hidden'); host.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    host.querySelector('.modal-mask').addEventListener('click', () => { if (o.lightDismiss !== false) close(); });
    host.querySelector('.modal-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return { close, root: body };
  }
  function closeModal() {
    const host = document.getElementById('modal');
    if (host) { host.classList.add('hidden'); host.innerHTML = ''; }
  }

  /* --------------- Đăng nhập / thiết lập mật khẩu ------------------ */
  async function boot() {
    const me = await api('GET', '/api/me');
    csrfToken = me.csrfToken || '';
    STATE.needsSetup = me.needsSetup;
    STATE.baseUrl = me.baseUrl;
    STATE.timezone = me.timezone || 'Asia/Ho_Chi_Minh';
    const timezoneLabel = document.getElementById('timezoneLabel');
    if (timezoneLabel) timezoneLabel.textContent = STATE.timezone;
    const brandSettingsCard = document.getElementById('brandSettingsCard');
    if (brandSettingsCard) brandSettingsCard.classList.toggle('hidden', me.brandingEnabled !== true);
    STATE.branding = me.branding || { productName: 'HTML Present', logoUrl: '', primaryColor: '#2563eb', showFooter: true };
    applyBranding(STATE.branding);
    if (me.authed) enterApp(); else showAuth(me.needsSetup);
  }
  function applyBranding(branding) {
    const name = branding.productName || 'HTML Present';
    document.title = 'Quản lý · ' + name;
    document.querySelectorAll('[data-brand-name]').forEach(node => { node.textContent = name; });
    document.querySelectorAll('#auth img, header img, .lt-topbar img').forEach(img => {
      img.alt = name;
      img.src = branding.logoUrl || '/_app/assets/logo.svg';
    });
    const color = /^#[0-9a-f]{6}$/i.test(branding.primaryColor || '') ? branding.primaryColor : '#2563eb';
    document.documentElement.style.setProperty('--red', color);
    document.documentElement.style.setProperty('--red-dark', color);
    document.documentElement.style.setProperty('--red-soft', `color-mix(in srgb, ${color} 10%, white)`);
    const fields = { brandNameInput: name, brandLogoInput: branding.logoUrl || '', brandColorInput: color, brandFooterInput: branding.showFooter !== false };
    for (const [id, value] of Object.entries(fields)) { const field = document.getElementById(id); if (field) field.type === 'checkbox' ? field.checked = value : field.value = value; }
  }
  function showAuth(setup) {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth').classList.remove('hidden');
    document.getElementById('authTitle').textContent = setup ? 'Tạo mật khẩu quản trị' : 'Đăng nhập quản trị';
    document.getElementById('authHint').textContent = setup ? 'Lần đầu sử dụng — mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường và số.' : '';
    document.getElementById('pw2wrap').classList.toggle('hidden', !setup);
    document.getElementById('authBtn').textContent = setup ? 'Tạo & vào quản lý' : 'Đăng nhập';
    document.getElementById('pw').focus();
  }
  async function doAuth() {
    const pw = document.getElementById('pw').value, err = document.getElementById('authErr'); err.textContent = '';
    try {
      if (STATE.needsSetup) {
        if (pw !== document.getElementById('pw2').value) { err.textContent = 'Hai mật khẩu không khớp'; return; }
        const session = await api('POST', '/api/setup', { password: pw });
        csrfToken = session.csrfToken || csrfToken;
      } else {
        const session = await api('POST', '/api/login', { password: pw });
        csrfToken = session.csrfToken || csrfToken;
      }
      enterApp();
    } catch (e) { err.textContent = e.message; }
  }
  async function logout() { await api('POST', '/api/logout'); location.reload(); }
  function enterApp() {
    document.getElementById('auth').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('baseUrlLbl').textContent = STATE.baseUrl || '';
    const cur = document.getElementById('baseUrlCur'); if (cur) cur.textContent = STATE.baseUrl || '';
    const inp = document.getElementById('baseUrlInput'); if (inp) inp.value = STATE.baseUrl || '';
    setupGlobalSearch();
    setupMobileNav();
    if (LT.tabs.projects) LT.tabs.projects();
    if (window.loadScan) window.loadScan();
  }

  /* --------------------------- Tabs -------------------------------- */
  // Mỗi tab đăng ký init qua LT.tabs[name]. Mục điều hướng có thể khai báo
  // sẵn trong admin.html hoặc do module thêm vào bằng LT.registerTab().
  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.content > [id^="tab-"]').forEach(el => {
      el.classList.toggle('hidden', el.id !== 'tab-' + name);
    });
    LT.state.activeTab = name;
    closeMobileNav();
    const fn = LT.tabs[name];
    if (typeof fn === 'function') fn();
    if (name === 'settings') window.loadApiTokens && window.loadApiTokens();
  }

  /* -------------------- Menu mobile (hamburger) -------------------- */
  // Trên mobile (≤720px, xem design.css), sidebar ẩn đi và mở bằng nút ☰ này.
  let navToggleBtn = null, navScrim = null, topbar = null;
  let logoImg = null, bellBtn = null, logoHome = null, bellHome = null;

  // Trên mobile: thanh topbar sticky (☰ · logo · 🔔) luôn bám đầu màn hình; drawer &
  // scrim neo ngay dưới topbar (chiều cao nhỏ, không đổi) nên không giật khi cuộn.
  function positionMobileNav() {
    const anchor = topbar && topbar.isConnected ? topbar : document.querySelector('#app header');
    const sidebar = document.getElementById('sidebar');
    if (!anchor || !sidebar) return;
    const bottom = Math.max(0, Math.round(anchor.getBoundingClientRect().bottom));
    sidebar.style.top = bottom + 'px';
    sidebar.style.maxHeight = (window.innerHeight - bottom) + 'px';
    if (navScrim) navScrim.style.top = bottom + 'px';
  }
  function openMobileNav() {
    document.body.classList.add('nav-open');
    positionMobileNav();
    if (navScrim) navScrim.hidden = false;
    if (navToggleBtn) { navToggleBtn.setAttribute('aria-expanded', 'true'); navToggleBtn.textContent = '✕'; }
  }
  function closeMobileNav() {
    document.body.classList.remove('nav-open');
    if (navScrim) navScrim.hidden = true;
    if (navToggleBtn) { navToggleBtn.setAttribute('aria-expanded', 'false'); navToggleBtn.textContent = '☰'; }
  }
  // Mobile: chuyển logo + chuông vào topbar sticky. Desktop: trả về header như cũ.
  function applyMobileChrome(mobile) {
    const app = document.getElementById('app');
    if (!app || !topbar) return;
    if (mobile) {
      if (topbar.parentNode !== app) app.insertBefore(topbar, app.firstChild);
      if (logoImg) topbar.appendChild(logoImg);   // thứ tự: ☰ (sẵn) · logo · 🔔
      if (bellBtn) topbar.appendChild(bellBtn);
    } else {
      closeMobileNav();
      if (logoImg && logoHome) logoHome.insertBefore(logoImg, logoHome.firstChild);
      if (bellBtn && bellHome) bellHome.insertBefore(bellBtn, bellHome.firstChild);
      if (topbar.parentNode) topbar.parentNode.removeChild(topbar);
    }
  }
  function setupMobileNav() {
    if (navToggleBtn) return;
    const header = document.querySelector('#app header');
    const sidebar = document.getElementById('sidebar');
    const app = document.getElementById('app');
    if (!header || !sidebar || !app) return;
    const btn = navToggleBtn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'navtoggle';
    btn.textContent = '☰';
    btn.setAttribute('aria-label', 'Menu điều hướng');
    btn.setAttribute('aria-controls', 'sidebar');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (document.body.classList.contains('nav-open')) closeMobileNav(); else openMobileNav();
    });
    topbar = document.createElement('div');
    topbar.className = 'lt-topbar';
    topbar.appendChild(btn);
    logoImg = header.querySelector('.hl > img');
    bellBtn = document.getElementById('ltNotifyButton');
    logoHome = logoImg && logoImg.parentNode;
    bellHome = bellBtn && bellBtn.parentNode;
    navScrim = document.createElement('div');
    navScrim.className = 'nav-scrim';
    navScrim.hidden = true;
    navScrim.addEventListener('click', closeMobileNav);
    document.body.appendChild(navScrim);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobileNav(); });
    window.addEventListener('resize', () => { if (document.body.classList.contains('nav-open')) positionMobileNav(); });
    const mq = window.matchMedia('(max-width: 720px)');
    const onChange = () => applyMobileChrome(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    applyMobileChrome(mq.matches);
  }

  /** Thêm một mục điều hướng + panel cho module ngoài (Lane N dashboard, Lane K
   *  thư viện…). Panel rỗng được tạo sẵn với id `tab-<id>` để module tự render.
   *  @param {{id:string,label:string,icon?:string,group?:string,order?:number,init?:Function}} tab
   *  @returns {HTMLElement|null} phần tử panel để module render vào. */
  function registerTab(tab) {
    if (!tab || typeof tab.id !== 'string' || !tab.id.trim()) return null;
    const id = tab.id.trim();
    if (typeof tab.init === 'function') LT.tabs[id] = tab.init;

    const content = document.querySelector('.content');
    let panel = document.getElementById('tab-' + id);
    if (!panel && content) {
      panel = document.createElement('div');
      panel.id = 'tab-' + id;
      panel.className = 'hidden';
      content.appendChild(panel);
    }

    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.querySelector(`[data-tab="${CSS.escape(id)}"]`)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tab = id;
      button.dataset.group = tab.group || '';
      button.dataset.order = String(Number(tab.order) || 100);
      button.innerHTML = `<span class="ico" aria-hidden="true"></span><span></span>`;
      button.firstChild.textContent = String(tab.icon || '•');
      button.lastChild.textContent = String(tab.label || id);
      button.addEventListener('click', () => showTab(id));
      // Chèn cuối nhóm tương ứng; không có nhóm thì đặt cuối sidebar.
      const groupNodes = tab.group
        ? Array.from(sidebar.children).filter(n => n.dataset && n.dataset.group === tab.group)
        : [];
      const last = groupNodes[groupNodes.length - 1];
      if (last && last.nextSibling) sidebar.insertBefore(button, last.nextSibling);
      else if (last) sidebar.appendChild(button);
      else sidebar.appendChild(button);
    }
    return panel;
  }

  /* -------------------- Tìm kiếm toàn cục ------------------------- */
  // Module nào cần lọc theo từ khoá thì đăng ký qua LT.onSearch(fn).
  // Mặc định: lọc thẻ dự án đang hiện trong tab Deck & trang.
  const searchHandlers = [];
  function onSearch(fn) {
    if (typeof fn === 'function') searchHandlers.push(fn);
    return () => { const i = searchHandlers.indexOf(fn); if (i >= 0) searchHandlers.splice(i, 1); };
  }
  function defaultSearchFilter(term) {
    const needle = term.trim().toLowerCase();
    document.querySelectorAll('#projList .proj').forEach(card => {
      card.classList.toggle('hidden', !!needle && !card.textContent.toLowerCase().includes(needle));
    });
  }
  function setupGlobalSearch() {
    const input = document.getElementById('globalSearch');
    if (!input) return;
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const term = input.value;
        LT.state.searchTerm = term;
        if (searchHandlers.length) searchHandlers.forEach(fn => { try { fn(term); } catch (_) {} });
        else defaultSearchFilter(term);
      }, 160);
    });
  }

  /* ------------------- Cài đặt (settings tab) ---------------------- */
  async function saveBaseUrl() {
    try {
      const r = await api('POST', '/api/base-url', { baseUrl: document.getElementById('baseUrlInput').value });
      STATE.baseUrl = r.baseUrl;
      document.getElementById('baseUrlCur').textContent = r.baseUrl;
      document.getElementById('baseUrlLbl').textContent = r.baseUrl;
      toast('Đã lưu'); if (LT.tabs.projects) LT.tabs.projects();
    } catch (e) { toast(e.message); }
  }
  async function saveBranding() {
    try {
      const result = await api('POST', '/api/branding', {
        productName: document.getElementById('brandNameInput').value,
        logoUrl: document.getElementById('brandLogoInput').value,
        primaryColor: document.getElementById('brandColorInput').value,
        showFooter: document.getElementById('brandFooterInput').checked
      });
      STATE.branding = result.branding;
      applyBranding(STATE.branding);
      toast('Đã lưu thương hiệu');
    } catch (e) { toast(e.message); }
  }
  async function changePw() {
    const err = document.getElementById('pwErr'); err.textContent = '';
    try {
      await api('POST', '/api/password', {
        current: document.getElementById('pwCur').value,
        next: document.getElementById('pwNew').value
      });
      document.getElementById('pwCur').value = ''; document.getElementById('pwNew').value = '';
      toast('Đã đổi mật khẩu quản trị');
    } catch (e) { err.textContent = e.message; }
  }

  /* ---------------- Phơi ra scope toàn cục ------------------------- */
  Object.assign(LT, { api, toast, copy, esc, attr, flag, fmtDate, fmtDur, openModal, closeModal, showTab, registerTab, onSearch, getCsrfToken: () => csrfToken });
  Object.assign(window, { api, toast, copy, esc, attr, flag, fmtDate, fmtDur, openModal, closeModal, showTab, doAuth, logout, saveBaseUrl, saveBranding, changePw });

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch(e => {
      document.body.innerHTML = '<p style="padding:40px;color:#b1040f">Lỗi khởi tạo: ' + esc(e.message) + '</p>';
    });
  });
})();
