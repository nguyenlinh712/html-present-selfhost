// Sửa slide: chỉnh HTML gốc trong admin. Sửa trực tiếp trên slide dùng runtime/edit.js.
// Snapshot phiên bản cũ vào .history/ (xử lý ở backend).
(function () {
  'use strict';
  const LT = window.LT; if (!LT) return;
  const { api, esc, openModal } = LT;

  function fileUrl(id, relPath) {
    return `/api/projects/${encodeURIComponent(id)}/file?path=${encodeURIComponent(relPath)}`;
  }

  async function editFile(node, project) {
    const relPath = node.relPath || '';
    const modal = openModal(`<div class="slide-editor">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0;color:var(--ink);font-size:19px">Sửa slide</h2>
          <p class="muted" style="margin:4px 0 0;font-size:13px">${esc(project.name)} · ${esc(relPath)}</p>
        </div>
          <div class="row" style="gap:6px">
          <span class="muted" style="font-size:12px">⟨/⟩ HTML</span>
          <button class="btn sm se-save" disabled>Lưu</button>
        </div>
      </div>
      <div class="se-status" role="status">Đang tải…</div>
      <textarea class="se-code" spellcheck="false"></textarea>
      <p class="hint">💡 Chỉnh HTML gốc của slide. Muốn sửa trực quan, hãy dùng nút <b>Sửa slide</b> ngay trên trang trình chiếu. Phiên bản cũ được lưu trong <code>.history/</code>.</p>
    </div>`, { wide: true });
    if (!modal) return;
    const root = modal.root;
    const status = root.querySelector('.se-status');
    const code = root.querySelector('.se-code');
    const saveBtn = root.querySelector('.se-save');

    let originalHtml = '';
    let dirty = false;

    function setDirty(v) {
      dirty = v;
      saveBtn.disabled = !v;
      status.textContent = v ? 'Có thay đổi chưa lưu.' : 'Đã lưu.';
      status.className = v ? 'se-status' : 'se-status muted';
    }

    code.addEventListener('input', () => setDirty(true));

    saveBtn.addEventListener('click', async () => {
      const content = code.value;
      saveBtn.disabled = true;
      status.textContent = 'Đang lưu…'; status.className = 'se-status muted';
      try {
        await api('PUT', `/api/projects/${encodeURIComponent(project.id)}/file`, { path: relPath, content });
        originalHtml = content;
        setDirty(false);
        status.textContent = 'Đã lưu. Mở lại tab khán giả để thấy thay đổi.';
      } catch (error) {
        status.textContent = `Chưa lưu được: ${error.message}`; status.className = 'se-status err';
        saveBtn.disabled = false;
      }
    });

    try {
      const file = await api('GET', fileUrl(project.id, relPath));
      originalHtml = file.content || '';
      code.value = originalHtml;
      status.textContent = 'Đã tải HTML. Có thể chỉnh sửa và bấm Lưu.';
    } catch (error) {
      status.textContent = `Không tải được: ${error.message}`; status.className = 'se-status err';
    }
  }

  LT.contentActions.push({
    id: 'edit-slide', label: 'Sửa', icon: '✏️',
    show: node => /\.html?$/i.test(node.relPath || ''),
    run: editFile
  });
})();
