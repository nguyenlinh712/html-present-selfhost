// Share-link QR actions for the core admin UI.
// QR encoder: qrcode-generator 2.0.4 (MIT; notice is in qrcode-generator.js).
(function () {
  'use strict';

  const LT = window.LT;
  if (!LT || typeof LT.openModal !== 'function') return;

  function attachButtons(root) {
    const cards = root.matches && root.matches('.share')
      ? [root]
      : root.querySelectorAll ? Array.from(root.querySelectorAll('.share')) : [];
    for (const card of cards) {
      if (card.querySelector('[data-share-qr]')) continue;
      const urlInput = card.querySelector('.share-url input');
      const copyButton = card.querySelector('.share-url [data-act="copy"]');
      if (!urlInput || !urlInput.value || !copyButton) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost xs';
      button.dataset.shareQr = '1';
      button.textContent = 'QR';
      button.title = 'Tạo mã QR cho link chia sẻ';
      button.setAttribute('aria-label', 'Tạo mã QR cho link chia sẻ');
      copyButton.insertAdjacentElement('afterend', button);
    }
  }

  function createQr(value) {
    if (typeof window.qrcode !== 'function') throw new Error('Chưa tải được thư viện QR.');
    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    const qr = window.qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    return qr;
  }

  function makePng(qr, filename) {
    const margin = 4;
    const modules = qr.getModuleCount();
    const scale = Math.max(2, Math.floor(1024 / (modules + margin * 2)));
    const size = (modules + margin * 2) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#111827';
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) context.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
    canvas.toBlob(blob => {
      if (!blob) { LT.toast('Không tạo được ảnh PNG'); return; }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }, 'image/png');
  }

  function showQr(card) {
    const url = card.querySelector('.share-url input')?.value || '';
    const label = card.querySelector('.share-label')?.textContent.trim() || 'Link chia sẻ';
    if (!/^https?:\/\//i.test(url)) { LT.toast('Link chia sẻ không hợp lệ'); return; }

    let qr;
    try { qr = createQr(url); }
    catch (error) { LT.toast(error.message || 'Không tạo được mã QR'); return; }

    const modal = LT.openModal(`<h3 style="margin:0 0 10px">Mã QR · ${LT.esc(label)}</h3>
      <p class="muted" style="font-size:13px;margin:0 0 14px">Quét mã để mở link chia sẻ này.</p>
      <div class="share-qr-preview" style="display:flex;justify-content:center;padding:18px;background:#fff;border:1px solid var(--line);border-radius:12px">
        ${qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true })}
      </div>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn" type="button" data-download-qr>Tải PNG</button>
      </div>`);
    if (!modal) return;
    modal.root.querySelector('[data-download-qr]').addEventListener('click', () => {
      makePng(qr, 'html-present-share-qr.png');
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-share-qr]');
    if (button) showQr(button.closest('.share'));
  });

  attachButtons(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) attachButtons(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
