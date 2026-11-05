'use strict';

const ExcelJS = require('exceljs');
const analytics = require('./analytics');

const RED = 'FF2563EB';
const PALE = 'FFEFF6FF';
const INK = 'FF252A31';
const MUTED = 'FF68717D';
const WHITE = 'FFFFFFFF';
const EDGE = 'FFE5E7EB';
function zonedParts(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}
const fmtDate = (value, timezone) => {
  if (!value) return null;
  const parts = zonedParts(value, timezone);
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, new Date(value).getUTCMilliseconds())) : null;
};
const fmtDuration = seconds => Math.max(0, Number(seconds) || 0);

function workbookBase(brandName = 'HTML Present') {
  const wb = new ExcelJS.Workbook();
  wb.creator = brandName;
  wb.company = brandName;
  wb.subject = 'Phân tích hành vi người xem slide HTML';
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
function styleSheet(ws, headers, rows, opts = {}) {
  const startRow = opts.startRow || 1;
  ws.addRow(headers);
  for (const values of rows) ws.addRow(values);
  const header = ws.getRow(startRow);
  header.height = 28;
  header.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: RED } } };
  });
  for (let r = startRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.height = 20;
    row.eachCell(cell => {
      cell.font = { color: { argb: INK }, size: 10 };
      cell.border = { bottom: { style: 'hair', color: { argb: EDGE } } };
      cell.alignment = { vertical: 'middle' };
    });
  }
  ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: opts.freezeColumns || 0 }];
  if (rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: headers.length } };
  headers.forEach((head, index) => {
    const values = rows.slice(0, 300).map(row => row[index]).filter(v => v != null).map(v => v instanceof Date ? 19 : String(v).length);
    ws.getColumn(index + 1).width = Math.min(opts.maxWidth || 44, Math.max(12, String(head).length + 2, ...values.map(n => n + 2)));
  });
  ws.properties.defaultRowHeight = 19;
  ws.pageSetup = { orientation: headers.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return startRow + 1;
}
function setNumberFormats(ws, columns, start = 2) {
  for (const col of columns.seconds || []) ws.getColumn(col).numFmt = '[h]:mm:ss';
  for (const col of columns.date || []) ws.getColumn(col).numFmt = 'dd/mm/yyyy hh:mm';
  for (const col of columns.percent || []) ws.getColumn(col).numFmt = '0%';
  for (const col of columns.integer || []) ws.getColumn(col).numFmt = '#,##0';
  for (const col of columns.decimal || []) ws.getColumn(col).numFmt = '#,##0.0';
}
function styleTitle(ws, title, subtitle) {
  ws.mergeCells('C1:F1');
  ws.getCell('C1').value = title;
  ws.getCell('C1').font = { bold: true, color: { argb: INK }, size: 19 };
  ws.getCell('C1').alignment = { vertical: 'middle' };
  ws.getRow(1).height = 33;
  ws.mergeCells('C2:F2');
  ws.getCell('C2').value = subtitle;
  ws.getCell('C2').font = { color: { argb: MUTED }, size: 10 };
  ws.getRow(2).height = 21;
}
function safeSheetName(value) { return String(value || '').replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31) || 'Dự án'; }
function projectName(projects, id) { return (projects.find(project => project.id === id) || {}).name || 'Tất cả dự án'; }
function cleanFilename(value) {
  return String(value || 'du-an').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'du-an';
}
function datePart(value, timezone) {
  const parts = zonedParts(value, timezone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : 'tat-ca';
}
function localeDate(value, timezone) {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}
function addLogo(wb, ws, logo) {
  try {
    if (logo && Buffer.isBuffer(logo)) {
      const imageId = wb.addImage({ buffer: logo, extension: 'png' });
      ws.addImage(imageId, { tl: { col: 0.1, row: 0.12 }, br: { col: 1.9, row: 1.8 } });
    }
  } catch (_) {}
}
function allSessions(events, projects, opts) {
  const grouped = analytics.buildSessions(events, opts);
  const sessions = grouped.sessions;
  const projectLabels = new Map(projects.map(p => [p.id, p]));
  for (const s of sessions) {
    const p = projectLabels.get(s.project);
    const share = (p && p.shares || []).find(x => x.id === s.share);
    s.shareLabel = share ? share.label : (s.share ? 'Link khác' : 'Truy cập trực tiếp');
    s.visitor = s.vid || s.ip || s.sid;
  }
  return sessions;
}

async function reportBuffer(input = {}) {
  const { events = [], projects = [], logo, brandName = 'HTML Present', timezone = 'Asia/Ho_Chi_Minh', ...opts } = input;
  const summary = analytics.summarize({ events, projects, ...opts });
  const sessions = allSessions(events, projects, opts);
  const wb = workbookBase(brandName);
  const projectLabel = projectName(projects, opts.project);
  const subtitle = `${projectLabel} · ${localeDate(summary.from, timezone)} – ${localeDate(summary.to, timezone)}`;

  const overview = wb.addWorksheet('Tổng quan', { properties: { tabColor: { argb: RED } } });
  styleTitle(overview, 'BÁO CÁO HÀNH VI NGƯỜI XEM', subtitle);
  addLogo(wb, overview, logo);
  overview.getRow(4).values = ['Chỉ số', 'Giá trị', 'Chỉ số', 'Giá trị', 'Phạm vi', 'Giá trị'];
  const overviewRows = [
    ['Phiên xem', summary.sessions, 'Khách duy nhất', summary.visitors, 'Dự án', projectLabel],
    ['Khách quay lại', summary.returningVisitors, 'Thời lượng TB', summary.avgSeconds / 86400, 'Từ ngày', new Date(summary.from)],
    ['Tỷ lệ xem hết', summary.completionRate / 100, 'Tỷ lệ chủ động', summary.engagedRate / 100, 'Đến ngày', new Date(summary.to)]
  ];
  overviewRows.forEach(r => overview.addRow(r));
  const kpiHeader = overview.getRow(4);
  kpiHeader.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } }; c.font = { bold: true, color: { argb: WHITE } }; });
  for (let r = 5; r <= 7; r++) {
    overview.getRow(r).height = 26;
    [2, 4, 6].forEach(c => { overview.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }; overview.getCell(r, c).font = { bold: true, color: { argb: INK }, size: 13 }; });
  }
  overview.getCell('B7').numFmt = '0%'; overview.getCell('D7').numFmt = '0%';
  overview.getCell('D6').numFmt = '[h]:mm:ss';
  overview.getCell('F6').numFmt = 'dd/mm/yyyy'; overview.getCell('F7').numFmt = 'dd/mm/yyyy';
  overview.columns = [{ width: 24 }, { width: 21 }, { width: 24 }, { width: 21 }, { width: 20 }, { width: 36 }];
  overview.views = [{ state: 'frozen', ySplit: 4 }];

  const docs = wb.addWorksheet('Theo slide');
  const docRows = summary.perDoc.map(d => [d.slug, d.path, d.sessions, d.visitors, d.avgSeconds / 86400, d.completionRate / 100, d.engagedRate / 100]);
  styleSheet(docs, ['Dự án', 'Đường dẫn', 'Phiên', 'Khách', 'Thời lượng TB', 'Xem hết', 'Chủ động'], docRows);
  setNumberFormats(docs, { integer: [3, 4], seconds: [5], percent: [6, 7] });

  const maxSlides = Math.min(200, Math.max(1, ...sessions.map(s => s.total || s.maxSlide)));
  const stop = wb.addWorksheet('Dừng theo slide');
  const stopHeaders = ['Dự án', 'Đường dẫn', ...Array.from({ length: maxSlides }, (_, i) => `Slide ${i + 1}`), 'Tổng dừng'];
  const stopRows = summary.perDoc.map(doc => {
    const matching = sessions.filter(s => s.project === doc.project && s.path === doc.path);
    const values = Array.from({ length: maxSlides }, (_, i) => {
      const samples = matching.map(s => s.st[String(i + 1)] || 0).filter(v => v > 0);
      return samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) / 86400 : null;
    });
    return [doc.slug, doc.path, ...values, values.reduce((a, b) => a + (b || 0), 0)];
  });
  styleSheet(stop, stopHeaders, stopRows, { maxWidth: 22 });
  if (stopRows.length && maxSlides) {
    const lastCol = stopHeaders.length;
    const lastRow = stopRows.length + 1;
    stop.addConditionalFormatting({ ref: `C2:${stop.getColumn(lastCol - 1).letter}${lastRow}`, rules: [
      { type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }], color: [{ argb: 'FFF2F4F7' }, { argb: 'FFFFD166' }, { argb: 'FF2563EB' }] }
    ] });
    stop.addConditionalFormatting({ ref: `${stop.getColumn(lastCol).letter}2:${stop.getColumn(lastCol).letter}${lastRow}`, rules: [
      { type: 'dataBar', priority: 1, gradient: true, color: { argb: RED }, cfvo: [{ type: 'min' }, { type: 'max' }], showValue: true }
    ] });
  }
  for (let c = 3; c <= stopHeaders.length; c++) stop.getColumn(c).numFmt = '[h]:mm:ss';

  const funnelRows = [];
  for (const doc of summary.perDoc) doc.funnel.forEach((count, i) => funnelRows.push([doc.slug, doc.path, i + 1, count]));
  const funnel = wb.addWorksheet('Phễu');
  styleSheet(funnel, ['Dự án', 'Đường dẫn', 'Slide', 'Phiên tới slide'], funnelRows);
  setNumberFormats(funnel, { integer: [3, 4] });
  if (funnelRows.length) funnel.addConditionalFormatting({ ref: `D2:D${funnelRows.length + 1}`, rules: [{ type: 'dataBar', color: { argb: RED }, cfvo: [{ type: 'min' }, { type: 'max' }], showValue: true }] });

  const teams = wb.addWorksheet('Theo team-link');
  styleSheet(teams, ['Team / link', 'Phiên'], summary.byTeam.map(x => [x.label, x.count]));
  setNumberFormats(teams, { integer: [2] });
  if (summary.byTeam.length) teams.addConditionalFormatting({ ref: `B2:B${summary.byTeam.length + 1}`, rules: [{ type: 'dataBar', color: { argb: RED }, cfvo: [{ type: 'min' }, { type: 'max' }], showValue: true }] });

  const cta = wb.addWorksheet('Click CTA');
  styleSheet(cta, ['Nội dung', 'URL', 'Lượt bấm'], summary.topCta.map(x => [x.text, x.href, x.count]));
  setNumberFormats(cta, { integer: [3] });

  const devices = wb.addWorksheet('Thiết bị & trình duyệt');
  styleSheet(devices, ['Nhóm', 'Tên', 'Phiên'], [
    ...summary.byDevice.map(x => ['Thiết bị', x.label, x.count]),
    ...summary.byBrowser.map(x => ['Trình duyệt', x.label, x.count])
  ]);
  setNumberFormats(devices, { integer: [3] });

  const sources = wb.addWorksheet('Nguồn');
  styleSheet(sources, ['Nguồn truy cập', 'Phiên'], summary.bySource.map(x => [x.label, x.count]));
  setNumberFormats(sources, { integer: [2] });

  const visitorAgg = new Map();
  for (const s of sessions) {
    const key = s.visitor || s.sid;
    const v = visitorAgg.get(key) || { vid: s.vid || '', ip: s.ip || '', country: s.country || '', sessions: 0, last: s.last, docs: new Set() };
    v.sessions++; if (s.last > v.last) v.last = s.last; if (s.ip) v.ip = s.ip; if (s.country) v.country = s.country; v.docs.add(s.path);
    visitorAgg.set(key, v);
  }
  const visitors = wb.addWorksheet('Khách (vid)');
  const visitorRows = Array.from(visitorAgg.values()).sort((a, b) => b.sessions - a.sessions).map(v => [v.vid, v.ip, v.country, v.sessions, v.docs.size, fmtDate(v.last, timezone)]);
  styleSheet(visitors, ['Mã khách', 'IP', 'Quốc gia', 'Phiên', 'Slide khác nhau', 'Lần cuối'], visitorRows);
  setNumberFormats(visitors, { integer: [4, 5], date: [6] });

  const detailRows = sessions.slice().sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 100000).map(s => [
    fmtDate(s.start, timezone), fmtDate(s.last, timezone), s.slug, s.path, s.shareLabel, s.vid, s.ip, s.country,
    s.mobile ? 'Điện thoại' : 'Máy tính', s.total, s.maxSlide, s.seconds / 86400,
    s.engagedTime / 86400, s.scrollDepth / 100, s.interactions, s.idleSeconds,
    s.tabSwitches, s.revisits, s.rageClicks, s.copyAttempt, s.printAttempt,
    Object.entries(s.st).map(([slide, sec]) => `${slide}:${sec}s`).join(' · '),
    s.utm.source || '', s.utm.medium || '', s.utm.campaign || '', s.referrer
  ]);
  const detail = wb.addWorksheet('Phiên chi tiết');
  styleSheet(detail, ['Bắt đầu', 'Lần cuối', 'Dự án', 'Đường dẫn', 'Team/link', 'Mã khách', 'IP', 'Quốc gia', 'Thiết bị', 'Tổng slide', 'Slide đạt', 'Thời lượng', 'TG chủ động', 'Cuộn sâu nhất', 'Tương tác', 'Giây nghỉ', 'Chuyển tab', 'Quay lại', 'Bấm liên tục', 'Copy', 'In', 'Dừng mỗi slide', 'UTM source', 'UTM medium', 'UTM campaign', 'Nguồn giới thiệu'], detailRows, { maxWidth: 36, freezeColumns: 3 });
  setNumberFormats(detail, { date: [1, 2], integer: [10, 11, 15, 16, 17, 18, 19, 20, 21], seconds: [12, 13], percent: [14] });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `HTML-Present-BaoCao-${cleanFilename(projectLabel)}-${datePart(summary.from, timezone)}-${datePart(summary.to, timezone)}.xlsx`;
  return { buffer, filename };
}

async function accessBuffer(input = {}) {
  const { access = [], projects = [], brandName = 'HTML Present', timezone = 'Asia/Ho_Chi_Minh', ...opts } = input;
  const wb = workbookBase(brandName);
  const ws = wb.addWorksheet('Nhật ký truy cập', { properties: { tabColor: { argb: RED } } });
  const rows = analytics.accessRows(access, opts).sort((a, b) => String(b.t || '').localeCompare(String(a.t || ''))).slice(0, 200000)
    .map(e => [fmtDate(e.t, timezone), e.country || '', e.ip || '', e.slug || '', e.path || '', e.method || '', e.status || '', e.share || '', e.ref || '', e.ua || '']);
  styleSheet(ws, ['Thời gian', 'Quốc gia', 'IP', 'Dự án', 'Đường dẫn', 'Phương thức', 'Mã', 'Team/link ID', 'Nguồn giới thiệu', 'Trình duyệt'], rows, { maxWidth: 48 });
  setNumberFormats(ws, { date: [1], integer: [7] });
  const buffer = await wb.xlsx.writeBuffer();
  const range = analytics.summarize({ events: [], projects, ...opts });
  const filename = `HTML-Present-NhatKy-${cleanFilename(projectName(projects, opts.project))}-${datePart(range.from, timezone)}-${datePart(range.to, timezone)}.xlsx`;
  return { buffer, filename };
}

module.exports = { reportBuffer, accessBuffer };
