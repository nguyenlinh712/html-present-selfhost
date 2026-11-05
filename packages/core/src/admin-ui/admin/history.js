// Lane U1 — xem và khôi phục lịch sử từng file HTML, không thực thi HTML cũ.
(function () {
  'use strict';
  const LT = window.LT;
  if (!LT) return;

  function fileLabel(path) {
    return String(path || '').split('/').pop() || path || 'slide HTML';
  }

  function renderVersion(version) {
    const when = LT.fmtDate(version.createdAt);
    const reason = version.reason === 'before-restore' ? 'trước khi khôi phục' : version.reason === 'legacy' ? 'lịch sử cũ' : 'trước khi lưu';
    return `<article class="lt-history-item" data-version-id="${LT.attr(version.id)}">
      <div><strong>${LT.esc(when)}</strong><span class="muted"> · ${LT.esc(reason)} · ${Number(version.sizeBytes) || 0} byte</span></div>
      <div class="row"><button type="button" class="btn ghost xs" data-history="view">Xem nội dung</button>
        <button type="button" class="btn danger xs" data-history="restore">Khôi phục</button></div>
    </article>`;
  }

  async function openHistory(node, project) {
    const path = node.relPath;
    const modal = LT.openModal(`<div class="lt-history-modal">
      <div class="lt-history-head"><div><h3 style="margin:0">Lịch sử phiên bản</h3><p class="muted" style="margin:4px 0 0">${LT.esc(project.name)} · ${LT.esc(path)}</p></div></div>
      <div class="lt-history-status muted">Đang tải lịch sử…</div>
      <div class="lt-history-list"></div>
      <button type="button" class="btn ghost sm" data-more hidden>Tải thêm</button>
      <p class="muted">Lịch sử chỉ khôi phục file HTML; ảnh và CSS ngoài file không được hoàn tác.</p>
      <pre class="lt-history-preview" hidden></pre>
    </div>`, { wide: true });
    if (!modal) return;
    const root = modal.root;
    const status = root.querySelector('.lt-history-status');
    const list = root.querySelector('.lt-history-list');
    const preview = root.querySelector('.lt-history-preview');
    const more = root.querySelector('[data-more]');
    let cursor = null, count = 0, baseline = '', busy = false;
    async function load() {
      more.disabled = true;
      try {
      if (!baseline) {
        const current = await LT.api('GET', `/api/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`);
        if (!current.revision) throw new Error('Máy chủ chưa hỗ trợ kiểm tra phiên bản.');
        baseline = current.revision;
      }
      const data = await LT.api('GET', `/api/projects/${encodeURIComponent(project.id)}/versions?path=${encodeURIComponent(path)}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      const versions = data.versions || [];
      list.insertAdjacentHTML('beforeend', versions.map(renderVersion).join(''));
      count += versions.length;
      cursor = data.cursor;
      more.hidden = !cursor;
      more.textContent = 'Tải thêm';
      status.textContent = count ? `${count}/${data.total} phiên bản · bản mới nhất ở trên` : 'Chưa có lịch sử';
    } catch (error) {
      status.textContent = `Không tải được lịch sử: ${error.message}`;
      more.hidden = false; more.textContent = 'Thử lại';
    } finally { more.disabled = false; }
    }
    more.addEventListener('click', load);
    await load();
    list.addEventListener('click', async event => {
      const button = event.target.closest('[data-history]');
      const item = event.target.closest('.lt-history-item');
      if (!button || !item || busy) return;
      busy = true;
      const versionId = item.dataset.versionId;
      button.disabled = true;
      try {
        if (button.dataset.history === 'view') {
          const data = await LT.api('GET', `/api/projects/${encodeURIComponent(project.id)}/versions/${encodeURIComponent(versionId)}?path=${encodeURIComponent(path)}`);
          preview.hidden = false;
          preview.textContent = data.content || '';
          status.textContent = `Đang xem ${fileLabel(path)} · nội dung chỉ đọc`;
        } else {
          if (!confirm(`Khôi phục phiên bản ${versionId} của ${fileLabel(path)}? Bản hiện tại sẽ được lưu lại trước.`)) return;
          if (!baseline) throw new Error('Hãy tải lại lịch sử trước khi khôi phục.');
          await LT.api('POST', `/api/projects/${encodeURIComponent(project.id)}/versions/${encodeURIComponent(versionId)}/restore`, { path, expectedRevision: baseline });
          LT.toast('Đã khôi phục phiên bản. Mở lại slide để kiểm tra.');
          modal.close();
        }
      } catch (error) {
        status.textContent = error.message || 'Thao tác thất bại.';
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
  }

  const style = document.createElement('style');
  style.textContent = `.lt-history-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.lt-history-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.lt-history-preview{max-height:46vh;overflow:auto;margin:14px 0 0;padding:12px;background:var(--soft);border:1px solid var(--line);border-radius:8px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:640px){.lt-history-item{align-items:flex-start;flex-direction:column}.lt-history-item .row{width:100%}.lt-history-item .row>*{flex:1}}`;
  document.head.appendChild(style);

  LT.contentActions.push({
    id: 'history-file', label: 'Lịch sử', icon: '🕘',
    show: node => /\.html?$/i.test(node.relPath || ''),
    run: openHistory
  });
})();
