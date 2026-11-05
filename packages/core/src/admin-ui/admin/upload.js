// HTML Present admin — modal upload slide (Lane E, làm lại ở Lane U / Phase 5).
// Chỉ đụng tab Trang & Dự án qua DOM: không sửa projects.js, không sửa admin.html.
//
// Phase 5 sửa P0-2: trước đây showReport() gọi `closest('div').remove()` trên
// `.up-drop` (là <label>) → xoá luôn `.modal-body` → modal trắng, mất báo cáo.
// Nay form nằm trong #upform và chỉ bị ẩn; báo cáo render vào #upreport.
// CSS đã chuyển hết sang admin-ui/design.css (P0-1) — file này không inject CSS.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const LT = window.LT; if (!LT) return;
  const { api, toast, esc, attr, openModal, closeModal } = LT;

  /* Dựng form HTML. Toàn bộ phần nhập nằm trong #upform để ẩn/hiện nguyên khối. */
  function formHtml(projects) {
    const projOpts = projects.map(p => `<option value="${attr(p.id)}">${esc(p.name)}</option>`).join('');
    return `
      <h2>⬆ Tải slide lên</h2>
      <div id="upform">
        <p class="hint" style="margin:0 0 14px">Chấp nhận file <code>.zip</code> (sẽ tự giải nén) hoặc 1 file <code>.html</code>.
          Giới hạn 100MB upload, tổng giải nén ≤500MB.</p>

        <label class="up-drop" id="updrop">
          <input type="file" id="upfile" accept=".zip,.html,.htm">
          📁 Kéo-thả file vào đây, hoặc <b style="color:var(--red)">bấm để chọn</b>
          <div class="up-file" id="upname" hidden></div>
        </label>

        <div class="radio-row" style="margin-top:16px">
          <label class="inline"><input type="radio" name="target" value="new" checked> Tạo dự án mới</label>
          <label class="inline"><input type="radio" name="target" value="existing"> Thêm vào dự án có sẵn</label>
        </div>

        <div id="upblock-new" style="margin-top:14px">
          <div class="fieldrow">
            <div style="flex:2"><label for="upname-new">Tên dự án</label><input id="upname-new" placeholder="Ví dụ: Bản trình bày quý 3"></div>
            <div style="flex:1"><label for="upslug">Slug (tuỳ chọn)</label><input id="upslug" placeholder="tự sinh"></div>
          </div>
          <div class="fieldrow" style="margin-top:10px">
            <div style="flex:1">
              <label for="uplayout">Hướng slide</label>
              <select id="uplayout">
                <option value="responsive" selected>Responsive (tự co dãn)</option>
                <option value="landscape">Khung ngang 16:9 (desktop pitch)</option>
                <option value="portrait">Khung dọc 9:16 (mobile/story)</option>
              </select>
            </div>
            <div style="flex:1" id="upbase-wrap" hidden>
              <label for="upbasew">Kích thước gốc</label>
              <div class="row"><input id="upbasew" type="number" min="320" max="10000" placeholder="rộng" style="flex:1"> × <input id="upbaseh" type="number" min="320" max="10000" placeholder="cao" style="flex:1"></div>
            </div>
          </div>
        </div>

        <div id="upblock-existing" class="hidden" style="margin-top:14px">
          <div class="fieldrow">
            <div style="flex:2"><label for="upproj">Dự án</label><select id="upproj">${projOpts}</select></div>
            <div style="flex:1"><label for="upsub">Thư mục con (tuỳ chọn)</label><input id="upsub" placeholder="vd: team-a"></div>
          </div>
          <div style="margin-top:10px"><label for="upname-leaf">Tên thư mục mới (dùng cho đích)</label><input id="upname-leaf" placeholder="auto từ tên file"></div>
        </div>

        <div style="margin-top:14px;max-width:280px">
          <label for="upconflict">Khi trùng</label>
          <select id="upconflict">
            <option value="fail" selected>Báo lỗi (an toàn)</option>
            <option value="rename">Đổi tên tự động</option>
            <option value="overwrite">Ghi đè (bản cũ vào .trash)</option>
          </select>
        </div>

        <div class="up-progress hidden" id="upbar"><i></i></div>
        <div class="up-stage hidden" id="upstage"></div>
        <div class="err" id="uperr"></div>

        <div class="modal-foot">
          <button class="btn ghost" type="button" id="upcancel">Hủy</button>
          <button class="btn" type="button" id="upsubmit" disabled>Tải lên</button>
        </div>
      </div>

      <div class="up-report hidden" id="upreport"></div>
    `;
  }

  async function openUploadModal() {
    let projects = [];
    try { projects = await api('GET', '/api/projects'); } catch (_) {}
    const m = openModal(formHtml(projects));
    const q = (sel) => m.root.querySelector(sel);

    let picked = null;
    const form = q('#upform');
    const drop = q('#updrop'), fileInput = q('#upfile'), nameEl = q('#upname');
    const bar = q('#upbar'), barI = bar.querySelector('i'), stage = q('#upstage'), err = q('#uperr');
    const submit = q('#upsubmit');

    function setFile(f) {
      picked = f || null;
      nameEl.hidden = !f;
      nameEl.textContent = f ? `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} MB` : '';
      submit.disabled = !f;
      if (f) err.textContent = '';
    }

    /** Trạng thái tiến trình: 'upload' có % thật, 'process' là pha giải nén
     *  phía máy chủ (không đo được) → sọc vô định. */
    function setStage(kind, text, percent) {
      bar.classList.remove('hidden');
      stage.classList.remove('hidden');
      stage.textContent = text;
      if (kind === 'process') {
        bar.classList.add('indeterminate');
      } else {
        bar.classList.remove('indeterminate');
        barI.style.width = `${percent}%`;
      }
    }
    function clearStage() {
      bar.classList.add('hidden');
      bar.classList.remove('indeterminate');
      barI.style.width = '0%';
      stage.classList.add('hidden');
      stage.textContent = '';
    }
    /** Lỗi: cho sửa và bấm Tải lên lại ngay, không phải mở lại modal (Lane U). */
    function fail(message) {
      clearStage();
      err.textContent = message;
      submit.disabled = !picked;
      submit.textContent = 'Thử lại';
    }

    fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
    });

    // Show/hide base-size input theo layout
    const layoutSel = q('#uplayout'), baseWrap = q('#upbase-wrap');
    const syncLayoutUI = () => {
      const v = layoutSel.value;
      baseWrap.hidden = v === 'responsive';
      if (v === 'landscape') { q('#upbasew').placeholder = '1920'; q('#upbaseh').placeholder = '1080'; }
      else if (v === 'portrait') { q('#upbasew').placeholder = '1080'; q('#upbaseh').placeholder = '1920'; }
    };
    layoutSel.addEventListener('change', syncLayoutUI);
    syncLayoutUI();

    m.root.querySelectorAll('input[name="target"]').forEach(r => {
      r.addEventListener('change', () => {
        q('#upblock-new').classList.toggle('hidden', r.value !== 'new' || !r.checked);
        q('#upblock-existing').classList.toggle('hidden', r.value !== 'existing' || !r.checked);
      });
    });

    q('#upcancel').addEventListener('click', closeModal);

    submit.addEventListener('click', () => {
      err.textContent = '';
      if (!picked) { err.textContent = 'Chưa chọn file'; return; }
      const target = m.root.querySelector('input[name="target"]:checked').value;
      const fd = new FormData();
      fd.append('file', picked);
      fd.append('target', target);
      fd.append('conflict', q('#upconflict').value);
      if (target === 'new') {
        fd.append('name', q('#upname-new').value || '');
        if (q('#upslug').value) fd.append('slug', q('#upslug').value);
        const layoutVal = layoutSel.value;
        fd.append('layout', layoutVal);
        if (layoutVal !== 'responsive') {
          if (q('#upbasew').value) fd.append('baseWidth', q('#upbasew').value);
          if (q('#upbaseh').value) fd.append('baseHeight', q('#upbaseh').value);
        }
      } else {
        fd.append('projectId', q('#upproj').value || '');
        if (q('#upsub').value) fd.append('subdir', q('#upsub').value);
        if (q('#upname-leaf').value) fd.append('name', q('#upname-leaf').value);
      }

      submit.disabled = true;
      setStage('upload', 'Đang tải file lên…', 0);

      // Dùng XHR cho progress event (fetch chưa có progress upload chuẩn).
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/_admin/api/upload');
      const csrfToken = LT.getCsrfToken && LT.getCsrfToken();
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const percent = e.loaded / e.total * 100;
        if (percent >= 99.5) setStage('process', 'Đã tải xong — máy chủ đang giải nén & kiểm tra file…');
        else setStage('upload', `Đang tải file lên… ${percent.toFixed(0)}%`, percent);
      });
      xhr.upload.addEventListener('load', () => {
        setStage('process', 'Đã tải xong — máy chủ đang giải nén & kiểm tra file…');
      });
      xhr.onload = () => {
        let data = {}; try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          clearStage();
          showReport(m.root, data);
          toast('Đã tải lên dự án');
          if (LT.loadProjects) LT.loadProjects();
          if (LT.loadScan) LT.loadScan();
        } else {
          fail(data.error || `Máy chủ trả lỗi ${xhr.status}. Kiểm tra lại file rồi thử lại.`);
        }
      };
      xhr.onerror = () => fail('Lỗi mạng — không gửi được file. Kiểm tra kết nối rồi thử lại.');
      xhr.onabort = () => fail('Đã huỷ tải lên.');
      xhr.send(fd);
    });

    /** Ẩn form, hiện báo cáo. KHÔNG xoá DOM — đó là nguyên nhân P0-2. */
    function showReport(root, data) {
      form.classList.add('hidden');
      const report = root.querySelector('#upreport');
      report.classList.remove('hidden');
      report.innerHTML = reportHtml(data);
      const again = report.querySelector('#upagain');
      if (again) again.addEventListener('click', () => {
        report.classList.add('hidden');
        report.innerHTML = '';
        form.classList.remove('hidden');
        setFile(null);
        fileInput.value = '';
        err.textContent = '';
        submit.textContent = 'Tải lên';
        clearStage();
      });
      const close = report.querySelector('#upclose');
      if (close) close.addEventListener('click', closeModal);
      const copyBtn = report.querySelector('#upcopydeck');
      if (copyBtn) copyBtn.addEventListener('click', () => LT.copy(copyBtn.dataset.url));
    }
  }

  function reportHtml(data) {
    const slug = (data.project && data.project.slug) || '';
    const htmlFiles = data.htmlFiles || [];
    const skipped = data.skipped || [];
    const deckUrl = `${window.location.origin}/${encodeURIComponent(slug)}/`;

    const fileRows = htmlFiles.map(f => {
      const rel = data.destDir ? `${data.destDir}/${f}` : f;
      const url = `/${encodeURIComponent(slug)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
      return `<li>
        <span class="ok" aria-hidden="true">✅</span>
        <span class="name">${esc(f)}</span>
        <button class="btn ghost xs" type="button" title="Copy link"
          onclick="LT.copy('${attr(window.location.origin + url)}')">📋 Copy</button>
        <a class="btn ghost xs" href="${attr(url)}" target="_blank" rel="noopener">Mở ↗</a>
      </li>`;
    }).join('');

    const skipRows = skipped.map(s =>
      `<li><span class="warn" aria-hidden="true">⚠️</span>
        <span class="name">${esc(s.name)}</span>
        <span class="muted" style="font-size:12px">${esc(s.reason)}</span></li>`).join('');

    return `
      <div class="up-done">
        <span class="ico" aria-hidden="true">✅</span>
        <div>
          <b>Tải lên thành công</b>
          <span style="font-size:13px">Dự án <b>${esc(data.project.name)}</b> · ${htmlFiles.length} file HTML${skipped.length ? ` · ${skipped.length} file bị bỏ qua` : ''}</span>
        </div>
      </div>

      <div class="up-openrow">
        <input readonly value="${attr(deckUrl)}" aria-label="Link dự án">
        <button class="btn ghost" type="button" id="upcopydeck" data-url="${attr(deckUrl)}">📋 Copy</button>
        <a class="btn" href="${attr('/' + encodeURIComponent(slug) + '/')}" target="_blank" rel="noopener">Mở deck ↗</a>
      </div>

      <h3 style="margin:20px 0 0">File HTML đã đưa vào</h3>
      <ul>${fileRows || '<li><span class="warn">⚠️</span><span class="name">Không có file HTML nào — deck sẽ trống.</span></li>'}</ul>

      ${skipped.length ? `<h3 style="margin:20px 0 0">File bị bỏ qua</h3>
        <p class="hint" style="margin:4px 0 0">Thường do sai định dạng, nằm ngoài thư mục cho phép, hoặc vượt giới hạn dung lượng.</p>
        <ul>${skipRows}</ul>` : ''}

      <div class="modal-foot">
        <button class="btn ghost" type="button" id="upagain">Tải file khác</button>
        <button class="btn" type="button" id="upclose">Xong</button>
      </div>`;
  }

  /* Đăng ký nút "⬆ Tải slide lên" ở đầu tab Trang & Dự án */
  function addToolbarButton() {
    const tab = document.getElementById('tab-projects');
    if (!tab || tab.querySelector('#upbtn')) return;
    const first = tab.querySelector('.card');
    const btn = document.createElement('button');
    btn.id = 'upbtn';
    btn.className = 'btn sm';
    btn.type = 'button';
    btn.textContent = '⬆ Tải slide lên';
    btn.addEventListener('click', openUploadModal);
    // Thêm vào góc phải của card đầu tiên (ô "Thư mục trên máy chủ") nếu có.
    if (first) {
      const row = first.querySelector('.cardhead .row') || first.querySelector('.row');
      if (row) row.appendChild(btn);
      else first.insertBefore(btn, first.firstChild);
    } else {
      tab.insertBefore(btn, tab.firstChild);
    }
  }

  // Bọc init của tab projects để chèn thêm nút khi tab load xong.
  const original = LT.tabs.projects;
  LT.tabs.projects = async function () {
    if (typeof original === 'function') await original();
    addToolbarButton();
  };
  // Nếu tab đã load (admin đã enterApp trước khi script này chạy), gắn luôn.
  if (document.readyState !== 'loading') addToolbarButton();
  else document.addEventListener('DOMContentLoaded', addToolbarButton);
})();
