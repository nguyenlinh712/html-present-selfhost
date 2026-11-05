// Lane C — biên tập ghi chú riêng và bật/tắt trình chiếu.
(function () {
  'use strict';
  const LT = window.LT; if (!LT) return;
  const { api, esc, openModal } = LT;

  function notesUrl(id, relPath) {
    return `/api/projects/${encodeURIComponent(id)}/notes?path=${encodeURIComponent(relPath)}`;
  }

  async function editNotes(node, project) {
    const relPath = node.relPath || '';
    const modal = openModal(`<div class="notes-editor">
      <h2 style="margin:0 0 4px;color:var(--ink);font-size:19px">Ghi chú người trình bày</h2>
      <p class="muted" style="margin:0 0 14px;font-size:13px">${esc(project.name)} · ${esc(relPath)}. Ghi chú riêng được lưu tự động và chỉ quản trị viên/người trình bày xem được.</p>
      <div class="notes-editor-status muted" role="status">Đang tải danh sách slide…</div>
      <div class="notes-editor-slides"></div>
    </div>`);
    if (!modal) return;
    const status = modal.root.querySelector('.notes-editor-status');
    const list = modal.root.querySelector('.notes-editor-slides');
    let timer = null, saving = false, dirty = false;

    function collect() {
      const out = {};
      list.querySelectorAll('textarea[data-note-index]').forEach(field => {
        if (field.value.trim()) out[field.dataset.noteIndex] = field.value;
      });
      return out;
    }

    async function saveQueue() {
      dirty = true;
      if (saving) return;
      saving = true;
      while (dirty) {
        dirty = false; status.textContent = 'Đang lưu…'; status.className = 'notes-editor-status muted';
        try {
          await api('PUT', notesUrl(project.id, relPath), { path: relPath, notes: collect() });
          status.textContent = 'Đã lưu tự động'; status.className = 'notes-editor-status notes-saved';
        } catch (error) {
          status.textContent = `Chưa lưu được: ${error.message}`; status.className = 'notes-editor-status err';
        }
      }
      saving = false;
    }

    try {
      const result = await api('GET', notesUrl(project.id, relPath));
      if (!result.slides.length) {
        status.textContent = 'Không tìm thấy section/slide trong file HTML.';
        return;
      }
      list.innerHTML = result.slides.map(slide => `<section class="notes-editor-slide" style="padding:14px 0;border-top:1px solid var(--line)">
        <div class="notes-editor-heading" style="display:flex;align-items:center;gap:9px;margin-bottom:8px"><span style="width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:var(--red-soft);color:var(--red);font-weight:800">${slide.idx}</span><strong style="color:var(--ink)">${esc(slide.title)}</strong></div>
        ${slide.note ? `<details class="notes-editor-source" style="margin:0 0 10px;font-size:12px"><summary>Ghi chú có sẵn trong HTML</summary><p style="white-space:pre-wrap">${esc(slide.note)}</p></details>` : ''}
        <label for="note_${slide.idx}">Ghi chú riêng</label>
        <textarea id="note_${slide.idx}" data-note-index="${slide.idx}" rows="4" maxlength="5000" style="width:100%;min-height:92px;resize:vertical" placeholder="Ghi ý chính, câu chuyển hoặc lời nhắc cho slide này…">${esc(result.notes[String(slide.idx)] || '')}</textarea>
      </section>`).join('');
      status.textContent = 'Thay đổi được lưu tự động';
      list.addEventListener('input', event => {
        if (!event.target.matches('textarea[data-note-index]')) return;
        clearTimeout(timer); status.textContent = 'Đang chờ lưu…'; status.className = 'notes-editor-status muted';
        timer = setTimeout(saveQueue, 500);
      });
    } catch (error) {
      status.textContent = `Không tải được ghi chú: ${error.message}`; status.className = 'notes-editor-status err';
    }
  }

  LT.contentActions.push({
    id: 'present-notes', label: 'Notes', icon: '📝',
    show: node => /\.html?$/i.test(node.relPath || ''),
    run: editNotes
  });
  LT.projectToggles.push({ field: 'present', label: 'Trình chiếu', hint: 'Đồng bộ cửa sổ khán giả' });
})();
