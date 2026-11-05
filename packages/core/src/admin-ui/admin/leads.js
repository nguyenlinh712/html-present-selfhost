// Lane A (Phase 7) — trang xem lead khách để lại từ form trong deck.
(function () {
  'use strict';
  const LT = window.LT = window.LT || {};
  let panel = null;
  let busy = false;
  let selectedDays = 90;
  let rows = [];
  let projects = [];

  const esc = value => LT.esc ? LT.esc(value) : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: LT.state && LT.state.timezone || 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  };
  const projName = id => { const p = projects.find(x => x.id === id); return p ? (p.name || p.slug) : (id || '—'); };
  const shareLabel = (projectId, shareId) => {
    if (!shareId) return 'Trực tiếp';
    const p = projects.find(x => x.id === projectId);
    const s = p && (p.shares || []).find(x => x.id === shareId);
    return s ? s.label : 'Link khác';
  };

  function ensurePanel() {
    if (!panel) panel = document.getElementById('tab-leads');
    if (!panel || panel.dataset.leadsReady) return panel;
    panel.dataset.leadsReady = 'true';
    panel.innerHTML = `
      <div class="card">
        <div class="cardhd">
          <div><b>Lead khách để lại</b><div class="muted" style="font-size:12px">Thông tin khách gửi từ form trong deck.</div></div>
          <div class="row" style="gap:8px;align-items:center">
            <select class="input sm" data-lead-days>
              <option value="7">7 ngày</option>
              <option value="30">30 ngày</option>
              <option value="90" selected>90 ngày</option>
              <option value="365">1 năm</option>
            </select>
            <button class="btn ghost sm" data-lead-refresh>Làm mới</button>
            <button class="btn sm" data-lead-export>Xuất CSV</button>
          </div>
        </div>
        <div class="lt-lead-stats" data-lead-stats></div>
        <div class="tablewrap" style="max-height:560px">
          <table class="lt-lead-table">
            <thead><tr><th>Thời gian</th><th>Họ tên</th><th>Điện thoại</th><th>Email</th><th>Deck</th><th>Link khách</th><th>Ghi chú</th></tr></thead>
            <tbody data-lead-body><tr><td colspan="7" class="muted">Đang tải…</td></tr></tbody>
          </table>
        </div>
      </div>`;
    panel.querySelector('[data-lead-days]').addEventListener('change', e => { selectedDays = Number(e.target.value) || 90; load(); });
    panel.querySelector('[data-lead-refresh]').addEventListener('click', load);
    panel.querySelector('[data-lead-export]').addEventListener('click', exportCsv);
    return panel;
  }

  function renderRows() {
    const body = panel.querySelector('[data-lead-body]');
    const stats = panel.querySelector('[data-lead-stats]');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">Chưa có lead nào trong khoảng thời gian này.</td></tr>';
      stats.innerHTML = '';
      return;
    }
    const uniq = new Set(rows.map(r => r.phone || r.email).filter(Boolean)).size;
    stats.innerHTML =
      `<div class="stat"><div class="n">${rows.length}</div><div class="l">Lead</div></div>` +
      `<div class="stat"><div class="n">${uniq}</div><div class="l">Khách khác nhau</div></div>`;
    body.innerHTML = rows.map(r => `
      <tr>
        <td>${esc(dateTime(r.t))}</td>
        <td>${esc(r.name || '—')}</td>
        <td>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</td>
        <td>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—'}</td>
        <td>${esc(projName(r.project))}</td>
        <td>${esc(shareLabel(r.project, r.share))}</td>
        <td>${esc(r.note || '')}</td>
      </tr>`).join('');
  }

  function exportCsv() {
    if (!rows.length) { LT.toast && LT.toast('Chưa có lead để xuất.', true); return; }
    const head = ['Thời gian', 'Họ tên', 'Điện thoại', 'Email', 'Deck', 'Link khách', 'Ghi chú', 'Slide'];
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(',')];
    rows.forEach(r => lines.push([dateTime(r.t), r.name, r.phone, r.email, projName(r.project), shareLabel(r.project, r.share), r.note, r.slide].map(cell).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function load() {
    if (busy) return;
    busy = true;
    ensurePanel();
    const body = panel.querySelector('[data-lead-body]');
    try {
      const [leadRes, projRes] = await Promise.all([
        LT.api('GET', `/api/leads?days=${selectedDays}`),
        projects.length ? Promise.resolve(projects) : LT.api('GET', '/api/projects')
      ]);
      projects = Array.isArray(projRes) ? projRes : projects;
      if (leadRes && leadRes.enabled === false) {
        body.innerHTML = '<tr><td colspan="7" class="muted">Tính năng thu lead chưa khả dụng trên máy chủ này.</td></tr>';
        return;
      }
      rows = (leadRes && leadRes.leads) || [];
      renderRows();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7" class="muted">Không tải được lead: ${esc(error.message || '')}</td></tr>`;
    } finally {
      busy = false;
    }
  }

  LT.registerTab({ id: 'leads', label: 'Lead khách', icon: '✉', group: 'insight', order: 50, init: load });
  // Toggle bật/tắt form thu lead cho từng deck (hiện trong trang Deck & trang).
  (LT.projectToggles = LT.projectToggles || []).push({ field: 'leadForm', label: 'Thu lead', hint: 'Hiện form để khách để lại liên hệ' });
})();
