// HTML Present admin — tab "Trang & Dự án".
// Chủ sở hữu: Lane A. Lane C/E/F thêm hành động qua window.LT.contentActions / LT.projectToggles
// (không sửa file này — xem PHASE2-PLAN.md §8.5).
(function () {
  'use strict';
  const LT = window.LT; if (!LT) return;
  const { api, toast, esc, attr, fmtDate, openModal } = LT;
  let projectCache = [];
  let libraryLoadPromise = null;

  async function ensureLibraryLoaded() {
    if (LT.library) return LT.library;
    if (libraryLoadPromise) return libraryLoadPromise;
    libraryLoadPromise = (async () => {
      const response = await fetch('/_app/admin/library.js', { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) throw new Error('Không tải được thư viện deck.');
      const modified = Date.parse(response.headers.get('last-modified') || '');
      const version = Number.isFinite(modified) ? modified : Date.now();
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/_app/admin/library.js?v=${version}`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Không tải được thư viện deck.'));
        document.head.appendChild(script);
      });
      if (!LT.library) throw new Error('Module thư viện deck chưa khởi tạo.');
      return LT.library;
    })().catch(error => { libraryLoadPromise = null; throw error; });
    return libraryLoadPromise;
  }

  /* ------------------------- Nạp dữ liệu --------------------------- */
  async function loadProjects() {
    const list = await api('GET', '/api/projects');
    let viewCounts = {};
    try { viewCounts = (await api('GET', '/api/stats?days=90')).byProject || {}; } catch (_) {}
    await Promise.all(list.map(async p => {
      p.tags = Array.isArray(p.tags) ? p.tags : [];
      p.archived = p.archived === true;
      p.views90 = Number(viewCounts[p.id]) || 0;
      try {
        const d = await api('GET', '/api/projects/' + p.id + '/content');
        p.content = d.tree || [];
      } catch (_) { p.content = []; }
    }));
    const sel = document.getElementById('statProject');
    if (sel) sel.innerHTML = '<option value="">Tất cả dự án</option>' +
      list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    projectCache = list;
    if (LT.library) LT.library.setProjects(list);
    else renderProjectCards(list);
  }

  function renderProjectCards(list) {
    const el = document.getElementById('projList');
    if (!el) return;
    el.innerHTML = list.length
      ? list.map(renderProject).join('')
      : (projectCache.length
        ? '<div class="card muted">Không có deck nào khớp bộ lọc.</div>'
        : '<div class="card muted">Chưa có dự án nào. Thêm từ danh sách thư mục bên trên.</div>');
  }

  async function loadScan() {
    const folders = await api('GET', '/api/scan');
    const el = document.getElementById('scanList');
    if (!folders.length) { el.innerHTML = '<span class="muted">Không tìm thấy thư mục con nào.</span>'; return; }
    const avail = folders.filter(f => !f.registered && f.htmlCount > 0);
    el.innerHTML = avail.map(f => {
      const info = `${f.htmlCount} file HTML${f.hasIndex ? ' · có index.html' : ''}`;
      if (f.registered) return `<div class="row" style="padding:4px 0"><span class="proj-dir">📁 ${esc(f.dir)}</span><span class="badge off">đã thêm</span></div>`;
      return `<div class="row" style="padding:5px 0;justify-content:space-between">
        <span><span class="proj-dir">📁 ${esc(f.dir)}</span> <span class="muted" style="font-size:12px">${info}</span></span>
        <button class="btn sm" data-act="add-project" data-dir="${attr(f.dir)}">+ Thêm làm dự án</button></div>`;
    }).join('');
    if (!avail.length) el.innerHTML += '<div class="muted" style="font-size:12px;margin-top:6px">Không có thư mục HTML mới để thêm.</div>';
  }

  /* ------------------------ Render 1 dự án ------------------------- */
  function renderProject(p) {
    if (LT.library && LT.library.isGrid()) return renderGridProject(p);
    const thumbContent = p.cover
      ? `<img class="proj-thumb" src="${attr(p.cover)}" alt="">`
      : `<span class="proj-thumb">chưa có<br>ảnh</span>`;
    const thumb = `<div class="proj-thumb-wrap">
      <button type="button" class="proj-thumb-trigger" data-act="cover-menu" data-id="${p.id}" aria-label="Đổi ảnh bìa">${thumbContent}</button>
      <div class="proj-cover-menu" data-cover-menu="${attr(p.id)}" hidden>
        <button type="button" class="btn ghost xs" data-act="pick-cover" data-id="${p.id}">Tải ảnh</button>
        <button type="button" class="btn ghost xs" data-act="set-cover-url" data-id="${p.id}">Dán link</button>
        ${p.cover ? `<button type="button" class="btn danger xs" data-act="remove-cover" data-id="${p.id}">Xóa ảnh</button>` : ''}
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" id="cv_${p.id}" style="display:none" data-act="cover-file" data-id="${p.id}">
    </div>`;
    const pwBadge = (p.visibility === 'restricted' && p.hasPassword) ? '<span class="badge lock">🔒 Mật khẩu</span>' : '';
    const archiveBadge = p.archived ? '<span class="badge off">Đã lưu trữ</span>' : '';
    const tags = renderTags(p);
    const pub = p.visibility === 'public';
    const homeOn = pub || p.listed;
    const homeHint = pub ? '<span class="muted" style="font-size:12px">Công khai luôn hiển thị</span>'
      : (p.visibility === 'off' ? '<span class="muted" style="font-size:12px">Đang Tắt — không hiển thị</span>' : '');

    // Công tắc do các lane khác đăng ký (Lane C: present, Lane F: heatmap, …)
    const extraToggles = (LT.projectToggles || []).map(t => `
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <span style="font-size:13px;color:var(--ink);font-weight:600">${esc(t.label)}
          ${t.hint ? `<span class="muted" style="font-weight:400;font-size:11.5px"> · ${esc(t.hint)}</span>` : ''}
        </span>
        <label class="tgl"><input type="checkbox" ${p[t.field] ? 'checked' : ''}
          data-act="toggle-field" data-id="${p.id}" data-field="${attr(t.field)}"><span class="tr"></span></label>
      </div>`).join('');

    let passwordSection = '';
    let restricted = '';
    const deckActions = p.content && p.content.length ? renderDeckActions(p, p.content) : '';
    const contentShares = p.content && hasContentShares(p.content);
    if (p.visibility === 'restricted') {
      passwordSection = `
      <div class="section proj-password">
        <div class="proj-password-row">
          <div>
            <div class="lbl">Mật khẩu xem</div>
            ${p.hasPassword
              ? `<div class="row"><span class="muted" style="font-size:13px">🔒 Đã đặt mật khẩu</span>
               <button class="btn ghost xs" data-act="set-pw" data-id="${p.id}">Đổi</button>
               <button class="btn danger xs" data-act="clear-pw" data-id="${p.id}">Xóa</button></div>`
              : `<div class="row"><span class="muted" style="font-size:13px">Chưa đặt — ai có link vẫn xem được.</span>
               <button class="btn ghost xs" data-act="set-pw" data-id="${p.id}">Đặt mật khẩu</button></div>`}
          </div>
          ${deckActions ? `<div class="proj-deck-actions">${deckActions}</div>` : ''}
        </div>
      </div>`;
      restricted = `
      <div class="section">
        <div class="lbl">Link chia sẻ
          <button class="btn sm" style="margin-left:auto" data-act="add-share" data-id="${p.id}">+ Thêm link</button>
        </div>
        ${p.shares.length
          ? p.shares.map(s => renderShare(p.id, s)).join('')
          : '<p class="muted" style="font-size:13px">Chưa có link nào. Bấm "Thêm link" để tạo cho từng đối tác.</p>'}
      </div>`;
    }

    return `<div class="proj" data-project-id="${p.id}">
      <div class="proj-head">
        <div class="proj-id">
          <label class="lib-select"><input type="checkbox" data-act="select-project" data-id="${p.id}" ${LT.library && LT.library.state.selected.has(p.id) ? 'checked' : ''} aria-label="Chọn ${attr(p.name)}"></label>
          ${thumb}
          <div>
            <p class="proj-title">${esc(p.name)} <span class="badge ${p.visibility}">${LT.VIS[p.visibility]}</span> ${pwBadge} ${archiveBadge}</p>
            <div class="proj-dir">📁 ${esc(p.dir)}</div>
            ${tags}
            <div class="muted" style="font-size:11px;margin-top:5px">${Number(p.views90) || 0} lượt xem · sửa ${esc(fmtDate(p.updatedAt))}</div>
            <div class="proj-url-row" style="margin-top:7px">
              <input readonly value="${attr(p.url)}" onclick="this.select()" style="padding:6px 9px;font-size:12px">
              <button class="btn ghost xs" data-act="copy" data-text="${attr(p.url)}">📋 Copy</button>
              <a class="btn ghost xs" href="/${encodeURIComponent(p.slug)}/" target="_blank" rel="noopener">↗ Preview</a>
            </div>
          </div>
        </div>
        <div class="row">
          <select data-act="set-vis" data-id="${p.id}" style="width:auto">
            <option value="public" ${p.visibility === 'public' ? 'selected' : ''}>Công khai</option>
            <option value="restricted" ${p.visibility === 'restricted' ? 'selected' : ''}>Hạn chế</option>
            <option value="off" ${p.visibility === 'off' ? 'selected' : ''}>Tắt</option>
          </select>
          <button class="btn ghost sm" data-act="edit-project" data-id="${p.id}" data-name="${attr(p.name)}" data-slug="${attr(p.slug)}">Đổi tên</button>
          ${p.archived
            ? `<button class="btn ghost sm" data-act="restore-project" data-id="${p.id}">Khôi phục</button>`
            : `<button class="btn ghost sm" data-act="archive-project" data-id="${p.id}">Lưu trữ</button>`}
        </div>
      </div>

      ${passwordSection}
      <div class="section proj-settings-grid">
        <div class="proj-setting">
          <div><span style="font-size:13px;color:var(--ink);font-weight:600;display:block">Hiển thị trên trang chủ</span>${homeHint}</div>
          <label class="tgl"><input type="checkbox" ${homeOn ? 'checked' : ''} ${pub ? 'disabled' : ''}
            data-act="toggle-field" data-id="${p.id}" data-field="listed"><span class="tr"></span></label>
        </div>
        <div class="proj-setting">
          <span style="font-size:13px;color:var(--ink);font-weight:600" title="Chặn thao tác sao chép phổ biến và thêm dấu truy vết">Bảo vệ nội dung</span>
          <label class="tgl"><input type="checkbox" ${p.protect ? 'checked' : ''}
            data-act="toggle-field" data-id="${p.id}" data-field="protect"><span class="tr"></span></label>
        </div>
        ${extraToggles}
      </div>

      ${restricted}
      ${p.visibility !== 'restricted' && deckActions ? `<div class="section proj-deck-actions-only"><div class="proj-deck-actions">${deckActions}</div></div>` : ''}
      ${contentShares ? `<div class="section">${renderContent(p, p.content)}</div>` : ''}
    </div>`;
  }

  function renderTags(project) {
    return project.tags && project.tags.length
      ? `<div class="lib-tags">${project.tags.map(tag => `<span class="lib-tag">${esc(tag)}<button type="button" title="Bỏ nhãn ${attr(tag)}" aria-label="Bỏ nhãn ${attr(tag)}" data-act="remove-tag" data-id="${project.id}" data-tag="${attr(tag)}">×</button></span>`).join('')}</div>`
      : '';
  }

  function renderGridProject(project) {
    const cover = project.cover
      ? `<img class="lib-grid-cover" src="${attr(project.cover)}" alt="">`
      : '<div class="lib-grid-cover lib-grid-cover-empty">Chưa có ảnh bìa</div>';
    return `<article class="proj lib-grid-card" data-project-id="${project.id}">
      ${cover}
      <div class="lib-grid-body">
        <div class="lib-grid-top">
          <label class="lib-select"><input type="checkbox" data-act="select-project" data-id="${project.id}" ${LT.library && LT.library.state.selected.has(project.id) ? 'checked' : ''} aria-label="Chọn ${attr(project.name)}"></label>
          <div class="lib-grid-title">${esc(project.name)}</div>
          <span class="badge ${project.visibility}">${LT.VIS[project.visibility]}</span>
        </div>
        <div class="lib-grid-meta">/${esc(project.slug)}/ · ${Number(project.views90) || 0} lượt xem · ${esc(fmtDate(project.updatedAt))}</div>
        ${project.archived ? '<span class="badge off">Đã lưu trữ</span>' : ''}
        ${renderTags(project)}
        <div class="lib-grid-actions">
          <select data-act="set-vis" data-id="${project.id}" aria-label="Trạng thái ${attr(project.name)}">
            <option value="public" ${project.visibility === 'public' ? 'selected' : ''}>Công khai</option>
            <option value="restricted" ${project.visibility === 'restricted' ? 'selected' : ''}>Hạn chế</option>
            <option value="off" ${project.visibility === 'off' ? 'selected' : ''}>Tắt</option>
          </select>
          <button class="btn ghost sm" data-act="edit-project" data-id="${project.id}" data-name="${attr(project.name)}" data-slug="${attr(project.slug)}">Đổi tên</button>
          ${project.archived
            ? `<button class="btn ghost sm" data-act="restore-project" data-id="${project.id}">Khôi phục</button>`
            : `<button class="btn ghost sm" data-act="archive-project" data-id="${project.id}">Lưu trữ</button>`}
        </div>
      </div>
    </article>`;
  }

  function renderContent(project, nodes) {
    return '<div class="content-tree">' + nodes.map(node => {
      const isDir = node.type === 'dir';
      return `<div class="content-node">
        ${node.shares && node.shares.length ? `<div class="muted" style="font-size:11px;margin:4px 0 0 24px">${node.shares.map(s => `<span class="chip">${esc(s.label)} · ${s.scope ? esc(s.scope) : 'Cả dự án'} · ${s.role === 'presenter' ? 'Người trình bày' : 'Người xem'}</span>`).join(' ')}</div>` : ''}
        ${isDir && node.children && node.children.length ? `<div style="margin:6px 0 0 20px;border-left:1px solid var(--line);padding-left:12px">${renderContent(project, node.children)}</div>` : ''}
      </div>`;
    }).join('') + '</div>';
  }

  function hasContentShares(nodes) {
    return (nodes || []).some(node => (node.shares && node.shares.length) || hasContentShares(node.children));
  }

  function renderDeckActions(project, nodes) {
    const buttons = [];
    const visit = list => (list || []).forEach(node => {
      (LT.contentActions || [])
        .filter(a => typeof a.show !== 'function' || a.show(node, project))
        .forEach(a => buttons.push(`<button class="btn ghost xs" data-act="content-hook" data-hook="${attr(a.id)}" data-pid="${project.id}" data-path="${attr(node.relPath)}" title="${attr(a.label)}">${esc(a.icon || '')} ${esc(a.label)}</button>`));
      visit(node.children);
    });
    visit(nodes);
    return buttons.join(' ');
  }

  function renderShare(pid, s) {
    const state = !s.enabled ? '<span class="pill off">Đã tắt</span>'
      : (s.expiresAt && !s.valid) ? '<span class="pill exp">Hết hạn</span>'
      : '<span class="pill on">Đang bật</span>';
    return `<div class="share ${s.enabled && s.valid ? '' : 'dim'}">
      <div class="share-top">
        <div class="row">
          <label class="tgl"><input type="checkbox" ${s.enabled ? 'checked' : ''}
            data-act="toggle-share" data-pid="${pid}" data-sid="${s.id}"><span class="tr"></span></label>
          <span class="share-label" data-act="rename-share" data-pid="${pid}" data-sid="${s.id}" data-cur="${attr(s.label)}" title="Bấm để đổi tên">${esc(s.label)}</span>
          ${state}
          <span class="chip">${s.scope ? (s.scope.includes('.') ? '📄 ' : '📁 ') + esc(s.scope) : 'Cả dự án'}</span>
          <span class="chip">${s.role === 'presenter' ? 'Người trình bày' : 'Người xem'}</span>
        </div>
        <div class="row">
          <button class="btn ghost xs" data-act="rotate-share" data-pid="${pid}" data-sid="${s.id}" title="Tạo mã mới, link cũ hết hiệu lực">Đổi mã</button>
          <button class="btn danger xs" data-act="del-share" data-pid="${pid}" data-sid="${s.id}" data-label="${attr(s.label)}">Thu hồi</button>
        </div>
      </div>
      <div class="share-url">
        <input readonly value="${attr(s.url)}" onclick="this.select()">
        <button class="btn sm" data-act="copy" data-text="${attr(s.url)}">Copy</button>
      </div>
      <div class="share-meta">
        <div class="share-meta-info">
          <span>👁 ${Number(s.views) || 0} lượt xem</span>
          <span>Lần cuối: ${fmtDate(s.lastSeen)}</span>
        </div>
        <div class="exp-wrap">Hết hạn
          <input type="date" value="${s.expiresAt || ''}" data-act="set-expiry" data-pid="${pid}" data-sid="${s.id}">
          ${s.expiresAt ? `<button class="btn ghost xs" data-act="clear-expiry" data-pid="${pid}" data-sid="${s.id}">Bỏ hạn</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  /* --------------------------- Hành động --------------------------- */
  async function setVis(id, v) {
    try { await api('PATCH', '/api/projects/' + id, { visibility: v }); toast('Đã cập nhật'); loadProjects(); }
    catch (e) { toast(e.message); }
  }
  async function toggleField(id, field, on) {
    try {
      await api('PATCH', '/api/projects/' + id, { [field]: on });
      toast('Đã cập nhật');
      loadProjects();
    } catch (e) { toast(e.message); loadProjects(); }
  }
  async function editProject(id, name, slug) {
    const n = prompt('Tên hiển thị:', name); if (n === null) return;
    const s = prompt('Đường dẫn (slug):', slug); if (s === null) return;
    try { await api('PATCH', '/api/projects/' + id, { name: n, slug: s }); toast('Đã lưu'); loadProjects(); }
    catch (e) { alert(e.message); }
  }
  async function delProject(id, name) {
    const typed = prompt('⚠️ XÓA DỰ ÁN "' + name + '" khỏi danh sách.\n(Không xóa file trên ổ đĩa.)\n\nGõ đúng TÊN dự án để xác nhận:');
    if (typed === null) return;
    if (typed.trim() !== name) { alert('Tên không khớp — đã hủy, không xóa gì cả.'); return; }
    try { await api('DELETE', '/api/projects/' + id); toast('Đã xóa dự án'); loadProjects(); loadScan(); }
    catch (e) { toast(e.message); }
  }
  async function setArchived(id, archived) {
    try {
      await api('PATCH', '/api/projects/' + encodeURIComponent(id), { archived });
      toast(archived ? 'Đã lưu trữ dự án' : 'Đã khôi phục dự án');
      await loadProjects();
    } catch (e) { toast(e.message); }
  }
  async function removeTag(id, tag) {
    const project = projectCache.find(item => item.id === id);
    if (!project) return;
    try {
      await api('PATCH', '/api/projects/' + encodeURIComponent(id), { tags: (project.tags || []).filter(item => item !== tag) });
      await loadProjects();
    } catch (e) { toast(e.message); }
  }
  async function addShare(pid) {
    const label = prompt('Tên link (đối tác/ mục đích), vd "Khách A":', ''); if (label === null) return;
    try { await api('POST', '/api/projects/' + pid + '/shares', { label }); toast('Đã tạo link'); loadProjects(); }
    catch (e) { alert(e.message); }
  }
  async function addContentShare(pid, scope, name) {
    const label = prompt('Tên link nhóm:', 'Link ' + name); if (label === null) return;
    try {
      await api('POST', '/api/projects/' + pid + '/shares', { label, scope, role: 'viewer' });
      toast('Đã tạo link theo phạm vi'); await loadProjects();
    } catch (e) { alert(e.message); }
  }
  async function toggleShare(pid, sid, on) {
    try { await api('PATCH', '/api/projects/' + pid + '/shares/' + sid, { enabled: on }); toast(on ? 'Đã bật link' : 'Đã tắt link'); loadProjects(); }
    catch (e) { toast(e.message); loadProjects(); }
  }
  async function renameShare(pid, sid, cur) {
    const label = prompt('Đổi tên link:', cur); if (label === null) return;
    try { await api('PATCH', '/api/projects/' + pid + '/shares/' + sid, { label }); loadProjects(); }
    catch (e) { alert(e.message); }
  }
  async function setExpiry(pid, sid, v) {
    try { await api('PATCH', '/api/projects/' + pid + '/shares/' + sid, { expiresAt: v }); toast(v ? 'Đã đặt hạn' : 'Đã bỏ hạn'); loadProjects(); }
    catch (e) { alert(e.message); loadProjects(); }
  }
  async function rotateShare(pid, sid) {
    if (!confirm('Đổi mã link này? Link cũ sẽ hết hiệu lực ngay.')) return;
    try { await api('POST', '/api/projects/' + pid + '/shares/' + sid + '/rotate'); toast('Đã đổi mã'); loadProjects(); }
    catch (e) { toast(e.message); }
  }
  async function delShare(pid, sid, label) {
    if (!confirm('Thu hồi (xóa) link "' + label + '"? Không ảnh hưởng các link khác.')) return;
    try { await api('DELETE', '/api/projects/' + pid + '/shares/' + sid); toast('Đã thu hồi link'); loadProjects(); }
    catch (e) { toast(e.message); }
  }
  async function setPw(id) {
    const pw = prompt('Nhập mật khẩu xem (tối thiểu 4 ký tự):', ''); if (!pw) return;
    try { await api('POST', '/api/projects/' + id + '/password', { password: pw }); toast('Đã đặt mật khẩu'); loadProjects(); }
    catch (e) { alert(e.message); }
  }
  async function clearPw(id) {
    if (!confirm('Xóa mật khẩu xem của dự án này?')) return;
    try { await api('DELETE', '/api/projects/' + id + '/password'); toast('Đã xóa mật khẩu'); loadProjects(); }
    catch (e) { toast(e.message); }
  }
  function pickCover(id) { document.getElementById('cv_' + id).click(); }
  async function uploadCover(id, input) {
    const f = input.files && input.files[0]; if (!f) return;
    if (f.size > 6 * 1024 * 1024) { alert('Ảnh quá lớn (tối đa 6MB)'); input.value = ''; return; }
    const rd = new FileReader();
    rd.onload = async () => {
      try { await api('POST', '/api/projects/' + id + '/cover', { dataUrl: rd.result }); toast('Đã cập nhật ảnh bìa'); loadProjects(); }
      catch (e) { alert(e.message); } finally { input.value = ''; }
    };
    rd.readAsDataURL(f);
  }
  async function setCoverUrl(id) {
    const url = prompt('Dán link ảnh (https://...):'); if (!url) return;
    try { await api('POST', '/api/projects/' + id + '/cover', { url }); toast('Đã cập nhật ảnh bìa'); loadProjects(); }
    catch (e) { alert(e.message); }
  }
  async function removeCover(id) {
    if (!confirm('Xóa ảnh bìa của dự án này?')) return;
    try { await api('DELETE', '/api/projects/' + id + '/cover'); toast('Đã xóa ảnh'); loadProjects(); }
    catch (e) { toast(e.message); }
  }
  async function addProject(dir) {
    try {
      await api('POST', '/api/projects', { dir, slug: dir, name: dir, visibility: 'off' });
      toast('Đã thêm "' + dir + '" (đang Tắt — bật khi sẵn sàng)');
      loadProjects(); loadScan();
    } catch (e) { alert(e.message); }
  }

  /* -------------------- Nối sự kiện (uỷ quyền) --------------------- */
  // Dùng event delegation để không phải sinh onclick="..." trong HTML.
  function bind() {
    const root = document.getElementById('tab-projects');
    if (!root || root._bound) return; root._bound = true;

    root.addEventListener('click', async (ev) => {
      const t = ev.target.closest('[data-act]'); if (!t) return;
      const act = t.dataset.act;
      switch (act) {
        case 'add-project': return addProject(t.dataset.dir);
        case 'edit-project': return editProject(t.dataset.id, t.dataset.name, t.dataset.slug);
        case 'del-project': return delProject(t.dataset.id, t.dataset.name);
        case 'archive-project': return setArchived(t.dataset.id, true);
        case 'restore-project': return setArchived(t.dataset.id, false);
        case 'remove-tag': return removeTag(t.dataset.id, t.dataset.tag);
        case 'add-share': return addShare(t.dataset.id);
        case 'rename-share': return renameShare(t.dataset.pid, t.dataset.sid, t.dataset.cur);
        case 'rotate-share': return rotateShare(t.dataset.pid, t.dataset.sid);
        case 'del-share': return delShare(t.dataset.pid, t.dataset.sid, t.dataset.label);
        case 'clear-expiry': return setExpiry(t.dataset.pid, t.dataset.sid, '');
        case 'set-pw': return setPw(t.dataset.id);
        case 'clear-pw': return clearPw(t.dataset.id);
        case 'cover-menu': {
          const menu = root.querySelector(`[data-cover-menu="${CSS.escape(t.dataset.id)}"]`);
          if (menu) menu.hidden = !menu.hidden;
          return;
        }
        case 'pick-cover': return pickCover(t.dataset.id);
        case 'set-cover-url': return setCoverUrl(t.dataset.id);
        case 'remove-cover': return removeCover(t.dataset.id);
        case 'copy': return LT.copy(t.dataset.text);
        case 'content-copy': return LT.copy(t.dataset.url);
        case 'content-share': return addContentShare(t.dataset.pid, t.dataset.path, t.dataset.label);
        case 'content-hook': {
          const hook = (LT.contentActions || []).find(a => a.id === t.dataset.hook);
          const project = (await api('GET', '/api/projects')).find(p => p.id === t.dataset.pid);
          const node = { relPath: t.dataset.path, type: '', name: t.dataset.path };
          if (hook && project) return hook.run(node, project);
          return;
        }
      }
    });

    root.addEventListener('change', (ev) => {
      const t = ev.target.closest('[data-act]'); if (!t) return;
      const act = t.dataset.act;
      switch (act) {
        case 'select-project':
          if (LT.library) {
            if (t.checked) LT.library.state.selected.add(t.dataset.id);
            else LT.library.state.selected.delete(t.dataset.id);
            LT.library.refresh();
          }
          return;
        case 'set-vis': return setVis(t.dataset.id, t.value);
        case 'toggle-field': return toggleField(t.dataset.id, t.dataset.field, t.checked);
        case 'toggle-share': return toggleShare(t.dataset.pid, t.dataset.sid, t.checked);
        case 'set-expiry': return setExpiry(t.dataset.pid, t.dataset.sid, t.value);
        case 'cover-file': return uploadCover(t.dataset.id, t);
      }
    });
  }

  /* ------------------------- Đăng ký tab --------------------------- */
  LT.tabs.projects = async function () {
    try { await ensureLibraryLoaded(); } catch (error) { toast(error.message); }
    bind();
    await Promise.all([loadProjects(), loadScan()]);
  };
  LT.loadProjects = loadProjects;
  LT.loadScan = loadScan;
  LT.renderProjectCards = renderProjectCards;
  LT.renderProject = renderProject;   // Lane K (library): tái dùng để render thẻ trong chế độ nhóm.
  LT.bindProjects = bind;
  // Phơi ra toàn cục để các khối legacy khác gọi được.
  window.loadProjects = loadProjects;
  window.loadScan = loadScan;
})();
