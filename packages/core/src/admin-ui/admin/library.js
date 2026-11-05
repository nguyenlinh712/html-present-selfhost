// Lane K — bộ lọc, sắp xếp, nhãn, lưu trữ và chế độ xem thư viện.
(function () {
  'use strict';
  const LT = window.LT;
  if (!LT) return;

  const state = {
    projects: [], search: '', archived: 'active', visibility: 'all', links: 'all',
    updated: 'all', tag: 'all', sort: 'updated', view: 'list', selected: new Set()
  };
  let controls;

  function ensureStyles() {
    if (document.getElementById('library-style')) return;
    const style = document.createElement('style');
    style.id = 'library-style';
    style.textContent = `
      #library-controls{margin:0 0 12px;padding:10px 12px}
      #library-controls .lib-filters{display:flex;align-items:end;gap:6px;flex-wrap:wrap}
      #library-controls .lib-filters label{display:grid;gap:3px;margin:0;font-size:11px}
      #library-controls select,#library-controls input{width:auto;min-width:112px;padding:7px 9px;font-size:12px}
      #library-controls .lib-bulk{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px;padding-top:8px;border-top:1px solid var(--line)}
      #library-controls .lib-bulk[hidden]{display:none!important}
      #library-controls .lib-bulk-select{display:flex;align-items:center;gap:8px;min-width:0;margin-right:0}
      #library-controls .lib-bulk-select .lib-select{display:inline-flex;align-items:center;width:auto;margin:0;gap:4px;white-space:nowrap}
      #library-controls .lib-bulk-select .lib-select input{width:16px!important;min-width:16px!important;height:16px;margin:0!important;flex:0 0 16px}
      #library-controls .lib-count{font-size:12px;font-weight:700;color:var(--red);white-space:nowrap}
      #library-controls .lib-bulk label:not(.lib-select){display:flex;align-items:center;gap:6px;margin:0;font-size:11px;color:var(--muted)}
      #library-controls .lib-view[aria-pressed="true"]{color:var(--red);border-color:var(--red)}
      #projList.library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:14px}
      #projList.library-grid>.proj{margin:0;min-width:0}
      .proj-details{border-top:1px solid var(--line);margin-top:12px;padding-top:10px}
      .proj-details>summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--muted);padding:4px 0}
      .proj-details>.section{margin-top:12px}
      .proj-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px}
      .proj-settings-grid .proj-setting,.proj-settings-grid>.row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;margin:0!important;padding:8px 0;border-bottom:1px solid var(--line)}
      .proj-settings-grid .proj-setting:last-child,.proj-settings-grid>.row:last-child{border-bottom:0}
      .proj-settings-grid .muted{font-size:11px;white-space:nowrap}
      #projList .proj-head{gap:12px;align-items:start}
      #projList .proj-id{min-width:0;flex:1}
      #projList .proj-id>div:last-child{min-width:0;flex:1}
      #projList .proj-thumb{width:56px;height:44px;flex:none}
      #projList .proj-title{font-size:15px;overflow-wrap:anywhere}
      #projList .proj-dir{font-size:11px;overflow-wrap:anywhere}
      #projList .proj-id input[readonly]{width:100%;min-width:0}
      .proj-url-row{display:flex;align-items:center;gap:6px;max-width:560px}
      .proj-url-row input{flex:1;min-width:0}
      .proj-url-row .btn{flex:none}
      .content-node .row{flex-wrap:wrap}
      .content-node .row>.row{margin-left:auto}
      .lib-select{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:11px;white-space:nowrap}
      .lib-select input{width:16px!important;height:16px;margin:0;accent-color:var(--red)}
      .lib-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
      .lib-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;background:var(--red-soft);color:var(--red);font-size:11px;font-weight:600}
      .lib-tag button{border:0;padding:0;background:none;color:inherit;cursor:pointer;font:inherit;line-height:1}
      .lib-grid-card{overflow:hidden;display:flex;flex-direction:column}
      .lib-grid-cover{display:block;width:100%;height:158px;object-fit:cover;background:var(--soft);border-bottom:1px solid var(--line)}
      .lib-grid-cover-empty{display:grid;place-items:center;color:var(--muted);font-size:12px}
      .lib-grid-body{padding:14px;display:flex;flex-direction:column;flex:1;min-width:0}
      .lib-grid-top{display:flex;align-items:start;justify-content:space-between;gap:8px}
      .lib-grid-title{font-size:15px;font-weight:700;color:var(--ink);overflow-wrap:anywhere}
      .lib-grid-meta{font-size:11px;color:var(--muted);margin-top:4px}
      .lib-grid-actions{display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:12px}
      .lib-grid-actions select{width:auto}
      .lib-group{margin:0 0 22px}
      .lib-group-head{display:flex;align-items:center;gap:9px;margin:0 0 12px;padding-bottom:7px;border-bottom:2px solid var(--line);font-size:15px;color:var(--ink)}
      .lib-group-count{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 7px;border-radius:99px;background:var(--red-soft);color:var(--red);font-size:12px;font-weight:700}
      .lib-group-decks{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:14px}
      .lib-group-decks>.proj{margin:0;min-width:0}
      @media(max-width:700px){.proj-settings-grid{grid-template-columns:1fr}}
      @media(max-width:640px){#library-controls .lib-filters>*{flex:1 1 42%}#library-controls .lib-filters select{width:100%}#library-controls .lib-bulk-select{min-width:100%;margin-right:0}.lib-grid-actions>*{flex:1}.proj-url-row{max-width:none}.proj-url-row input{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureControls() {
    const panel = document.getElementById('tab-projects');
    if (!panel) return null;
    controls = document.getElementById('library-controls');
    if (controls) return controls;
    ensureStyles();
    controls = document.createElement('section');
    controls.id = 'library-controls';
    controls.className = 'card';
    controls.innerHTML = `
      <div class="lib-filters">
        <label>Lưu trữ<select data-lib="archived"><option value="active">Đang hoạt động</option><option value="archived">Đã lưu trữ</option><option value="all">Tất cả</option></select></label>
        <label>Hiển thị<select data-lib="visibility"><option value="all">Mọi trạng thái</option><option value="public">Công khai</option><option value="restricted">Hạn chế</option><option value="off">Đang tắt</option></select></label>
        <label>Link chia sẻ<select data-lib="links"><option value="all">Có hoặc chưa có</option><option value="yes">Có link</option><option value="no">Chưa có link</option></select></label>
        <label>Ngày sửa<select data-lib="updated"><option value="all">Mọi thời điểm</option><option value="7">7 ngày gần đây</option><option value="30">30 ngày gần đây</option><option value="90">90 ngày gần đây</option></select></label>
        <label>Nhãn<select data-lib="tag"><option value="all">Mọi nhãn</option></select></label>
        <label>Sắp xếp<select data-lib="sort"><option value="updated">Mới sửa gần đây</option><option value="name">Tên A–Z</option><option value="views">Lượt xem · 90 ngày</option></select></label>
        <button type="button" class="btn ghost sm lib-view" data-lib-view="list" aria-pressed="true">☷ Danh sách</button>
        <button type="button" class="btn ghost sm lib-view" data-lib-view="grid" aria-pressed="false">▦ Lưới</button>
        <button type="button" class="btn ghost sm lib-view" data-lib-view="group" aria-pressed="false">⊞ Nhóm theo chủ đề</button>
      </div>
      <div class="lib-bulk" data-lib-bulk>
        <div class="lib-bulk-select">
          <label class="lib-select"><input type="checkbox" data-lib-select-all> Chọn tất cả</label>
          <span class="lib-count" data-lib-count>0 đã chọn</span>
        </div>
        <label>Nhãn mới<input type="text" maxlength="32" data-lib-new-tag placeholder="VD: Hội thảo"></label>
        <button type="button" class="btn ghost sm" data-lib-action="tag">Gắn nhãn</button>
        <label>Đổi hiển thị<select data-lib-bulk-visibility><option value="">Giữ nguyên</option><option value="public">Công khai</option><option value="restricted">Hạn chế</option><option value="off">Tắt</option></select></label>
        <button type="button" class="btn ghost sm" data-lib-action="visibility">Áp dụng</button>
        <button type="button" class="btn ghost sm" data-lib-action="archive">Lưu trữ</button>
      </div>`;
    const list = document.getElementById('projList');
    panel.insertBefore(controls, list || null);
    controls.addEventListener('change', event => {
      const el = event.target.closest('[data-lib]');
      if (el) { state[el.dataset.lib] = el.value; render(); return; }
      if (event.target.matches('[data-lib-select-all]')) {
        const visible = filterProjects(state.projects);
        if (event.target.checked) visible.forEach(project => state.selected.add(project.id));
        else visible.forEach(project => state.selected.delete(project.id));
        render();
      }
      if (event.target.matches('[data-lib-bulk-visibility]')) updateBulkControls();
    });
    controls.addEventListener('click', event => {
      const viewButton = event.target.closest('[data-lib-view]');
      if (viewButton) { state.view = viewButton.dataset.libView; render(); return; }
      const action = event.target.closest('[data-lib-action]');
      if (action) runBulkAction(action.dataset.libAction);
    });
    controls.addEventListener('input', event => {
      if (event.target.matches('[data-lib-new-tag]')) updateBulkControls();
    });
    updateTagOptions();
    return controls;
  }

  function normalizeSearch(value) { return String(value || '').trim().toLocaleLowerCase('vi'); }

  function contentSearchText(nodes, out = []) {
    for (const node of nodes || []) {
      out.push(node.name || '', node.prettyName || '', node.relPath || '');
      for (const share of node.shares || []) out.push(share.label || '', share.url || '');
      if (node.children) contentSearchText(node.children, out);
    }
    return out;
  }

  function filterProjects(projects) {
    const needle = normalizeSearch(state.search);
    const now = Date.now();
    const days = state.updated === 'all' ? 0 : Number(state.updated);
    return projects.filter(project => {
      if (state.archived === 'active' && project.archived) return false;
      if (state.archived === 'archived' && !project.archived) return false;
      if (state.visibility !== 'all' && project.visibility !== state.visibility) return false;
      const hasShares = Array.isArray(project.shares) && project.shares.length > 0;
      if (state.links === 'yes' && !hasShares) return false;
      if (state.links === 'no' && hasShares) return false;
      if (state.tag !== 'all' && !(project.tags || []).some(tag => normalizeSearch(tag) === normalizeSearch(state.tag))) return false;
      if (days) {
        const updatedAt = Date.parse(project.updatedAt || '');
        if (!Number.isFinite(updatedAt) || updatedAt < now - days * 86400000) return false;
      }
      if (needle) {
        const shareTerms = (project.shares || []).flatMap(share => [share.label || '', share.url || '']);
        const corpus = [project.name, project.slug, project.description, ...(project.tags || []), ...shareTerms, ...contentSearchText(project.content)]
          .join(' ').toLocaleLowerCase('vi');
        if (!corpus.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => {
      if (state.sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
      if (state.sort === 'views') return (Number(b.views90) || 0) - (Number(a.views90) || 0);
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function updateTagOptions() {
    const select = controls && controls.querySelector('[data-lib="tag"]');
    if (!select) return;
    const selected = state.tag;
    const uniqueTags = new Map();
    state.projects.flatMap(project => project.tags || []).forEach(tag => {
      const key = normalizeSearch(tag);
      if (key && !uniqueTags.has(key)) uniqueTags.set(key, tag);
    });
    const tags = Array.from(uniqueTags.values()).sort((a, b) => a.localeCompare(b, 'vi'));
    select.innerHTML = '<option value="all">Mọi nhãn</option>' + tags.map(tag =>
      `<option value="${LT.attr(tag)}">${LT.esc(tag)}</option>`).join('');
    const matchingTag = tags.find(tag => normalizeSearch(tag) === normalizeSearch(selected));
    if (matchingTag) { state.tag = matchingTag; select.value = matchingTag; }
    else { state.tag = 'all'; select.value = 'all'; }
  }

  function updateBulkControls(visible = filterProjects(state.projects)) {
    if (!controls) return;
    const count = state.selected.size;
    const bulk = controls.querySelector('[data-lib-bulk]');
    bulk.hidden = state.projects.length === 0;
    controls.querySelector('[data-lib-count]').textContent = `${count} đã chọn`;
    const selectAll = controls.querySelector('[data-lib-select-all]');
    selectAll.checked = visible.length > 0 && visible.every(project => state.selected.has(project.id));
    selectAll.indeterminate = !selectAll.checked && visible.some(project => state.selected.has(project.id));
    const restore = state.archived === 'archived';
    const archiveButton = controls.querySelector('[data-lib-action="archive"]');
    archiveButton.textContent = restore ? 'Khôi phục' : 'Lưu trữ';
    archiveButton.disabled = !count;
    controls.querySelector('[data-lib-action="tag"]').disabled = !count || !controls.querySelector('[data-lib-new-tag]').value.trim();
    controls.querySelector('[data-lib-action="visibility"]').disabled = !count || !controls.querySelector('[data-lib-bulk-visibility]').value;
  }

  // Chế độ nhóm: gom deck theo nhãn (chủ đề). Deck nhiều nhãn xuất hiện ở nhiều
  // nhóm; deck không nhãn gom vào "Chưa phân nhóm". Tái dùng thẻ grid qua
  // LT.renderProject (isGrid() đã tính cả view 'group').
  const UNGROUPED_KEY = '\u0000ungrouped';
  function renderGroups(visible, list) {
    list.classList.remove('library-grid');
    if (!visible.length) {
      list.innerHTML = state.projects.length
        ? '<div class="card muted">Không có deck nào khớp bộ lọc.</div>'
        : '<div class="card muted">Chưa có dự án nào. Thêm từ danh sách thư mục bên trên.</div>';
      return;
    }
    const renderOne = typeof LT.renderProject === 'function' ? LT.renderProject : null;
    if (!renderOne) { if (typeof LT.renderProjectCards === 'function') LT.renderProjectCards(visible); return; }
    const groups = new Map();
    for (const project of visible) {
      const tags = (project.tags || []).map(t => String(t).trim()).filter(Boolean);
      if (!tags.length) {
        if (!groups.has(UNGROUPED_KEY)) groups.set(UNGROUPED_KEY, { label: 'Chưa phân nhóm', decks: [] });
        groups.get(UNGROUPED_KEY).decks.push(project);
      } else {
        for (const tag of tags) {
          const key = normalizeSearch(tag);
          if (!groups.has(key)) groups.set(key, { label: tag, decks: [] });
          groups.get(key).decks.push(project);
        }
      }
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      if (a[0] === UNGROUPED_KEY) return 1;
      if (b[0] === UNGROUPED_KEY) return -1;
      return a[1].label.localeCompare(b[1].label, 'vi');
    });
    list.innerHTML = ordered.map(([, group]) => `
      <section class="lib-group">
        <h3 class="lib-group-head">${LT.esc(group.label)} <span class="lib-group-count">${group.decks.length}</span></h3>
        <div class="lib-group-decks library-grid">${group.decks.map(renderOne).join('')}</div>
      </section>`).join('');
  }

  function render() {
    if (!ensureControls()) return;
    updateTagOptions();
    const visible = filterProjects(state.projects);
    const list = document.getElementById('projList');
    if (list) {
      list.classList.toggle('library-grid', state.view === 'grid');
      if (state.view === 'group') renderGroups(visible, list);
      else if (typeof LT.renderProjectCards === 'function') LT.renderProjectCards(visible);
    }
    controls.querySelectorAll('[data-lib-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.libView === state.view));
    });
    updateBulkControls(visible);
  }

  async function runBulkAction(action) {
    const selected = state.projects.filter(project => state.selected.has(project.id));
    if (!selected.length) return;
    const patches = [];
    let archiveTarget = null;
    if (action === 'visibility') {
      const visibility = controls.querySelector('[data-lib-bulk-visibility]').value;
      if (!['public', 'restricted', 'off'].includes(visibility)) return;
      selected.forEach(project => patches.push([project, { visibility }]));
    } else if (action === 'tag') {
      const tag = controls.querySelector('[data-lib-new-tag]').value.trim();
      if (!tag) return;
      if ([...tag].length > 32) { LT.toast('Nhãn tối đa 32 ký tự.'); return; }
      const key = tag.normalize('NFKC').toLocaleLowerCase('vi');
      const wouldExceedLimit = selected.some(project => {
        const tags = project.tags || [];
        const alreadyTagged = tags.some(value => String(value).normalize('NFKC').toLocaleLowerCase('vi') === key);
        return !alreadyTagged && tags.length >= 20;
      });
      if (wouldExceedLimit) { LT.toast('Một hoặc nhiều dự án đã có tối đa 20 nhãn.'); return; }
      selected.forEach(project => patches.push([project, { tags: [...(project.tags || []), tag] }]));
    } else if (action === 'archive') {
      archiveTarget = state.archived !== 'archived';
      selected.forEach(project => patches.push([project, { archived: archiveTarget }]));
    }
    try {
      // FileRepo ghi một config.json dùng chung; chạy tuần tự để tránh tranh chấp file .tmp.
      for (const [project, patch] of patches) {
        await LT.api('PATCH', `/api/projects/${encodeURIComponent(project.id)}`, patch);
      }
      state.selected.clear();
      const tagInput = controls.querySelector('[data-lib-new-tag]'); if (tagInput) tagInput.value = '';
      const visibilityInput = controls.querySelector('[data-lib-bulk-visibility]'); if (visibilityInput) visibilityInput.value = '';
      LT.toast(action === 'archive' ? (archiveTarget ? 'Đã lưu trữ dự án' : 'Đã khôi phục dự án') : 'Đã cập nhật các dự án');
      if (typeof LT.loadProjects === 'function') await LT.loadProjects();
    } catch (error) {
      LT.toast(error.message || 'Không thể cập nhật thư viện.');
      if (typeof LT.loadProjects === 'function') await LT.loadProjects();
    }
  }

  function setProjects(projects) {
    state.projects = Array.isArray(projects) ? projects : [];
    const known = new Set(state.projects.map(project => project.id));
    state.selected.forEach(id => { if (!known.has(id)) state.selected.delete(id); });
    render();
  }

  const panel = LT.registerTab({
    id: 'projects', label: 'Thư viện deck', icon: '▤', group: 'content', order: 20,
    init: async () => {
      ensureControls();
      if (typeof LT.bindProjects === 'function') LT.bindProjects();
      if (typeof LT.loadProjects === 'function') await LT.loadProjects();
      if (typeof LT.loadScan === 'function') await LT.loadScan();
    }
  });
  if (panel) {
    const nav = document.querySelector('#sidebar [data-tab="projects"]');
    if (nav) {
      const icon = nav.querySelector('.ico');
      nav.textContent = '';
      if (icon) nav.appendChild(icon);
      nav.appendChild(document.createTextNode('Thư viện deck'));
    }
  }

  LT.library = {
    setProjects,
    filterProjects,
    isGrid: () => state.view === 'grid' || state.view === 'group',
    viewMode: () => state.view,
    refresh: render,
    state
  };
  LT.onSearch(term => { state.search = term; render(); });
})();
