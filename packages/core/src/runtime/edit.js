/* Sửa slide trực tiếp trên trang xem — chỉ nạp cho admin (viewer/service.js).
   Đăng ký mục "Sửa slide" vào FAB (window.LTPresent). Lưu sạch: map text sửa
   vào bản HTML gốc fetch từ API, không ghi runtime inject vào file.
   Xem docs/internal/PHASE4-FAB-EDIT.md. */
(function () {
  'use strict';
  const hp = window.__htmlpresent || {};
  if (!hp.admin) return; // 2 lớp: UI ẩn + backend adminOnly

  const EDITABLE_SEL = 'h1,h2,h3,h4,h5,h6,p,li,span,strong,em,b,i,td,th,figcaption,blockquote,summary,a';
  const EXCLUDE_HOST = '#htmlpresent-presenter-panel, #htmlpresent-audience, .lt-fab-root, .lt-edit-bar, .lt-code-overlay';

  let csrfToken = '';
  let originalHtml = '';
  let revision = '';
  let cloneDoc = null;
  let editing = false;
  let dirty = false;
  let saving = false;
  let liveEditables = [];
  let bar = null;

  function relPath() {
    if (typeof hp.relPath === 'string' && hp.relPath) return hp.relPath;
    // fallback: tách base khỏi path
    const p = String(hp.path || location.pathname).split(/[?#]/, 1)[0].split('/').filter(Boolean);
    return p[0] === hp.slug ? p.slice(1).join('/') : p.join('/');
  }

  function authorSlides(root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('.slide, section[id]'))
      .filter(s => !s.closest(EXCLUDE_HOST) && !(s.parentElement && s.parentElement.closest(EXCLUDE_HOST)));
  }

  // Các element "lá" chứa text (không bọc element editable khác) → map 1-1 live↔clone.
  function collectEditables(root) {
    const out = [];
    authorSlides(root).forEach(slide => {
      slide.querySelectorAll(EDITABLE_SEL).forEach(el => {
        if (el.querySelector(EDITABLE_SEL)) return;      // bỏ element bọc editable khác
        if (el.closest('aside.notes, .notes, script, style')) return;
        if (!el.textContent.trim()) return;
        out.push(el);
      });
    });
    return out;
  }

  function toast(msg, isErr) {
    let t = document.querySelector('.lt-edit-toast');
    if (!t) { t = document.createElement('div'); t.className = 'lt-edit-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle('lt-edit-toast-err', !!isErr);
    t.classList.add('lt-visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('lt-visible'), 3200);
  }

  async function fetchCsrf() {
    const res = await fetch('/_admin/api/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Không xác thực được admin.');
    const data = await res.json();
    if (!data.authed) throw new Error('Cần đăng nhập admin.');
    csrfToken = data.csrfToken || '';
  }

  async function fetchOriginal() {
    const url = `/_admin/api/projects/${encodeURIComponent(hp.project)}/file?path=${encodeURIComponent(relPath())}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được file gốc.');
    const data = await res.json();
    originalHtml = data.content || '';
    revision = typeof data.revision === 'string' ? data.revision : '';
    cloneDoc = new DOMParser().parseFromString(originalHtml, 'text/html');
  }

  function setDirty(v) {
    dirty = v;
    if (bar) {
      const save = bar.querySelector('[data-edit="save"]');
      if (save) save.disabled = !v;
      const status = bar.querySelector('.lt-edit-status');
      if (status) status.textContent = v ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ';
    }
  }

  function beforeUnload(event) {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'lt-edit-bar';
    bar.innerHTML = `
      <span class="lt-edit-badge">✏️ Đang sửa</span>
      <span class="lt-edit-status">Bấm vào text để sửa</span>
      <span class="lt-edit-spacer"></span>
      <button type="button" class="lt-edit-btn" data-edit="code">⟨/⟩ Code</button>
      <button type="button" class="lt-edit-btn lt-edit-ghost" data-edit="exit">Thoát</button>
      <button type="button" class="lt-edit-btn lt-edit-primary" data-edit="save" disabled>Lưu</button>`;
    document.body.appendChild(bar);
    bar.addEventListener('click', async event => {
      const b = event.target.closest('[data-edit]'); if (!b) return;
      if (b.dataset.edit === 'save') saveInline();
      else if (b.dataset.edit === 'exit') {
        if (dirty && !confirm('Bạn còn thay đổi chưa lưu. Thoát sẽ bỏ các thay đổi này?')) return;
        exitEdit(true);
      }
      else if (b.dataset.edit === 'code') openCodeEditor();
      else if (b.dataset.edit === 'copy-draft') {
        try { await navigator.clipboard.writeText(draftContent()); toast('Đã copy bản nháp HTML.'); }
        catch (_) { toast('Không copy được bản nháp.', true); }
      } else if (b.dataset.edit === 'reload') {
        if (confirm('Tải lại bản mới từ máy chủ? Bản nháp hiện tại sẽ mất.')) location.reload();
      }
    });
  }

  async function enterEditMode() {
    if (editing) return;
    try {
      await fetchCsrf();
      await fetchOriginal();
    } catch (err) {
      toast(err.message || 'Không vào được chế độ sửa.', true);
      return;
    }
    editing = true;
    try { window.LTPresent && window.LTPresent.hideFab && window.LTPresent.hideFab(); } catch (_) {}
    document.documentElement.classList.add('lt-editing');
    liveEditables = collectEditables(document);
    liveEditables.forEach(el => {
      el.setAttribute('contenteditable', 'plaintext-only');
      el.classList.add('lt-editable');
      el.addEventListener('input', onInput);
    });
    window.addEventListener('beforeunload', beforeUnload);
    buildBar();
    setDirty(false);
    toast('Chế độ sửa: bấm vào chữ để sửa, xong bấm Lưu.');
  }

  function onInput() { setDirty(true); }

  function exitEdit(discard = false) {
    if (discard && cloneDoc) {
      const saved = collectEditables(cloneDoc);
      if (saved.length !== liveEditables.length) { location.reload(); return; }
      liveEditables.forEach((el, index) => { el.textContent = saved[index].textContent; });
    }
    liveEditables.forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('lt-editable');
      el.removeEventListener('input', onInput);
    });
    liveEditables = [];
    if (bar) { bar.remove(); bar = null; }
    document.documentElement.classList.remove('lt-editing');
    window.removeEventListener('beforeunload', beforeUnload);
    editing = false;
    dirty = false;
    try { window.LTPresent && window.LTPresent.showFab && window.LTPresent.showFab(); } catch (_) {}
  }

  async function saveInline() {
    if (saving || !dirty) return;
    const cloneEditables = collectEditables(cloneDoc);
    if (cloneEditables.length !== liveEditables.length) {
      toast('Cấu trúc slide thay đổi so với file gốc — hãy dùng chế độ Code.', true);
      return;
    }
    await putFile(draftContent(), 'inline');
  }

  function draftContent() {
    const nextDoc = cloneDoc.cloneNode(true);
    const nextEditables = collectEditables(nextDoc);
    liveEditables.forEach((el, i) => { nextEditables[i].textContent = el.textContent; });
    return '<!doctype html>\n' + nextDoc.documentElement.outerHTML;
  }

  async function putFile(content, mode) {
    if (saving) return false;
    saving = true;
    const save = bar && bar.querySelector('[data-edit="save"]');
    if (save) save.disabled = true;
    try {
      const res = await fetch(`/_admin/api/projects/${encodeURIComponent(hp.project)}/file`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ path: relPath(), content, ...(revision ? { expectedRevision: revision } : {}) })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          if (bar && !bar.querySelector('[data-edit="copy-draft"]')) {
            const status = bar.querySelector('.lt-edit-status');
            status.textContent = 'Xung đột phiên bản — bản nháp vẫn còn';
            const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'lt-edit-btn'; copy.dataset.edit = 'copy-draft'; copy.textContent = 'Copy nháp';
            const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'lt-edit-btn lt-edit-ghost'; reload.dataset.edit = 'reload'; reload.textContent = 'Tải bản mới';
            bar.insertBefore(copy, bar.querySelector('[data-edit="cancel"]'));
            bar.insertBefore(reload, bar.querySelector('[data-edit="cancel"]'));
          }
          throw new Error('File đã được thay đổi ở tab hoặc người dùng khác. Bản nháp vẫn được giữ; hãy tải lại bản mới rồi kiểm tra trước khi lưu lại.');
        }
        throw new Error(payload.error || 'Lưu thất bại.');
      }
      originalHtml = content;
      if (typeof payload.revision === 'string') revision = payload.revision;
      cloneDoc = new DOMParser().parseFromString(content, 'text/html');
      setDirty(false);
      toast(`Đã lưu phiên bản ${revision ? revision.slice(0, 10) : ''}. Tải lại trang (F5) để xem bản mới hoàn chỉnh.`);
      return true;
    } catch (err) {
      toast(err.message || 'Lưu thất bại.', true);
      if (save) save.disabled = false;
      return false;
    } finally {
      saving = false;
    }
  }

  // ==== Code editor (sửa sâu) ====
  function openCodeEditor() {
    // Lấy bản hiện tại: nếu đã sửa inline thì gom vào clone trước.
    let current = originalHtml;
    try {
      const cloneEditables = collectEditables(cloneDoc);
      if (cloneEditables.length === liveEditables.length) {
        const draftDoc = cloneDoc.cloneNode(true);
        const draftEditables = collectEditables(draftDoc);
        liveEditables.forEach((el, i) => { draftEditables[i].textContent = el.textContent; });
        current = '<!doctype html>\n' + draftDoc.documentElement.outerHTML;
      }
    } catch (_) {}

    const overlay = document.createElement('div');
    overlay.className = 'lt-code-overlay';
    overlay.innerHTML = `
      <div class="lt-code-head">
        <strong>Sửa code HTML</strong>
        <span class="lt-code-path"></span>
        <span class="lt-edit-spacer"></span>
        <button type="button" class="lt-edit-btn lt-edit-ghost" data-code="close">Đóng</button>
        <button type="button" class="lt-edit-btn lt-edit-primary" data-code="save">Lưu</button>
      </div>
      <textarea class="lt-code-area" spellcheck="false"></textarea>
      <div class="lt-code-foot">Lưu sẽ ghi đè toàn bộ file. Bản cũ lưu trong <code>.history/</code>.</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.lt-code-path').textContent = relPath();
    const area = overlay.querySelector('.lt-code-area');
    area.value = current;
    area.focus();
    // Tab chèn 2 space thay vì nhảy focus
    area.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = area.selectionStart, en = area.selectionEnd;
        area.value = area.value.slice(0, s) + '  ' + area.value.slice(en);
        area.selectionStart = area.selectionEnd = s + 2;
      }
    });
    overlay.addEventListener('click', async event => {
      const b = event.target.closest('[data-code]'); if (!b) return;
      if (b.dataset.code === 'close') { overlay.remove(); }
      else if (b.dataset.code === 'save') {
        b.disabled = true;
        const ok = await putFile(area.value, 'code');
        b.disabled = false;
        if (ok) { overlay.remove(); exitEdit(); toast('Đã lưu code. F5 để xem bản mới.'); }
      }
    });
  }

  // ==== Đăng ký vào FAB ====
  function register() {
    window.LTPresent.registerMenuItem({
      id: 'edit-slide', icon: '✏️', label: 'Sửa slide', order: 60,
      when: () => !!(window.__htmlpresent && window.__htmlpresent.admin),
      onClick: enterEditMode
    });
  }
  if (window.LTPresent && window.LTPresent.registerMenuItem) register();
  else window.addEventListener('lt-present-ready', function once() {
    window.removeEventListener('lt-present-ready', once);
    if (window.LTPresent && window.LTPresent.registerMenuItem) register();
  });

  // Dự phòng: nếu present.js không chạy (slide đơn / present=false) thì vẫn có nút sửa nổi.
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (!window.LTPresent && !document.querySelector('.lt-edit-fallback')) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lt-edit-fallback';
        b.textContent = '✏️ Sửa'; b.title = 'Sửa slide (admin)';
        b.addEventListener('click', enterEditMode);
        document.body.appendChild(b);
      }
    }, 1200);
  });
})();
