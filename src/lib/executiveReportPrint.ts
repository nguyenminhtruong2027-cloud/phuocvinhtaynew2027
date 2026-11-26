'use client';

import type { Worker } from '@/data/workers';
import { naturalSortCompare } from '@/data/workers';
import { escapeHtml, printHtmlViaIframe } from '@/lib/printHtml';
import { getVNDateString, getVNDateTimeDisplay } from '@/lib/vnDate';
import type { OperationalRiskReport } from '@/lib/riskRadar';
import type { MaintenanceTicket } from '@/lib/maintenanceTickets';

export interface ExecutiveReportBuildingRow {
  day: string;
  rooms: number;
  emptyRooms: number;
  occupied: number;
  capacity: number;
  male: number;
  female: number;
  staffName?: string;
}

export interface ExecutiveReportInput {
  ktxLabel: string;
  actorName: string;
  workers: Worker[];
  buildingRows: ExecutiveReportBuildingRow[];
  todayEntered: number;
  todayLeft: number;
  tickets: MaintenanceTicket[];
  riskReport: OperationalRiskReport;
}

export function printExecutiveReportA4(input: ExecutiveReportInput): boolean {
  const {
    ktxLabel,
    actorName,
    workers,
    buildingRows,
    todayEntered,
    todayLeft,
    tickets,
    riskReport,
  } = input;

  const todayIso = getVNDateString();
  const [yyyy, mm, dd] = todayIso.split('-');
  const dateVN = `${dd}/${mm}/${yyyy}`;
  const generatedAt = getVNDateTimeDisplay();

  const totalOccupied = buildingRows.reduce((s, b) => s + b.occupied, 0);
  const totalCapacity = buildingRows.reduce((s, b) => s + b.capacity, 0);
  const totalRooms = buildingRows.reduce((s, b) => s + b.rooms, 0);
  const totalEmptyRooms = buildingRows.reduce((s, b) => s + b.emptyRooms, 0);
  const totalMale = buildingRows.reduce((s, b) => s + b.male, 0);
  const totalFemale = buildingRows.reduce((s, b) => s + b.female, 0);
  const fillPct = totalCapacity > 0 ? ((totalOccupied / totalCapacity) * 100).toFixed(1) : '0.0';
  const vacantBeds = Math.max(0, totalCapacity - totalOccupied);

  // Contractor distribution (top 10)
  const contractorMap = new Map<string, { name: string; count: number; male: number; female: number; unregistered: number }>();
  workers.forEach(w => {
    const unit = (w.donVi || 'Chưa phân loại').trim() || 'Chưa phân loại';
    const cur = contractorMap.get(unit) || { name: unit, count: 0, male: 0, female: 0, unregistered: 0 };
    cur.count++;
    const g = (w.gioiTinh || '').toLowerCase();
    if (g.includes('nữ') || g === 'nu' || g === 'female') cur.female++;
    else cur.male++;
    if (w.tamTruStatus !== 'registered') cur.unregistered++;
    contractorMap.set(unit, cur);
  });
  const topContractors = Array.from(contractorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
  const resolvedTickets = tickets.filter(t => t.status === 'resolved').length;

  const sortedBuildings = [...buildingRows].sort((a, b) => naturalSortCompare(a.day, b.day));

  const buildingTableHtml = sortedBuildings
    .map(b => {
      const pct = b.capacity > 0 ? Math.round((b.occupied / b.capacity) * 100) : 0;
      const vac = Math.max(0, b.capacity - b.occupied);
      return `
        <tr>
          <td><strong>${escapeHtml(b.day)}</strong></td>
          <td class="num">${b.rooms}</td>
          <td class="num">${b.emptyRooms}</td>
          <td class="num"><strong>${b.occupied}</strong> / ${b.capacity}</td>
          <td class="num">${vac}</td>
          <td class="num">${pct}%</td>
          <td class="num">${b.male} / ${b.female}</td>
          <td>${escapeHtml(b.staffName || '—')}</td>
        </tr>`;
    })
    .join('');

  const contractorTableHtml =
    topContractors.length > 0
      ? topContractors
          .map(
            (c, idx) => `
          <tr>
            <td class="num">${idx + 1}</td>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td class="num"><strong>${c.count}</strong></td>
            <td class="num">${totalOccupied > 0 ? ((c.count / totalOccupied) * 100).toFixed(1) : '0.0'}%</td>
            <td class="num">${c.male} / ${c.female}</td>
            <td class="num">${c.unregistered}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="6" style="text-align:center;color:#64748b;">Chưa có dữ liệu nhà thầu</td></tr>`;

  const riskRowsHtml =
    riskReport.risks.length > 0
      ? riskReport.risks
          .slice(0, 8)
          .map(r => {
            const sevLabel =
              r.severity === 'critical'
                ? 'NGUY CẤP'
                : r.severity === 'high'
                ? 'CAO'
                : 'THEO DÕI';
            const sevColor =
              r.severity === 'critical'
                ? '#b91c1c'
                : r.severity === 'high'
                ? '#b45309'
                : '#1d4ed8';
            return `
              <tr>
                <td style="font-weight:700;color:${sevColor};text-align:center;">${sevLabel}</td>
                <td>${escapeHtml(r.categoryLabel)}</td>
                <td><strong>${escapeHtml(r.title)}</strong><div style="font-size:9.5px;color:#475569;margin-top:2px;">${escapeHtml(r.detail)}</div></td>
                <td class="num" style="font-weight:700;">${escapeHtml(r.metricValue)}</td>
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="4" style="text-align:center;color:#15803d;font-weight:600;">Không ghi nhận điểm nóng rủi ro nghiêm trọng tại thời điểm lập báo cáo.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Báo Cáo Điều Hành KTX Phước Vĩnh Tây — ${escapeHtml(dateVN)}</title>
  <style>
    @page { size: A4 portrait; margin: 13mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.45; margin: 0; }
    .top-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
    .org-left { text-align: left; }
    .org-name { font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; }
    .org-sub { font-size: 10px; color: #475569; margin-top: 2px; }
    .doc-meta { text-align: right; font-size: 10px; color: #334155; }
    .title-block { text-align: center; margin: 10px 0 14px; }
    .title-block h1 { font-size: 16.5px; font-weight: 800; text-transform: uppercase; margin: 0; letter-spacing: 0.5px; }
    .title-block p { font-size: 10.5px; color: #475569; margin: 4px 0 0; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .kpi-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
    .kpi-label { font-size: 9.5px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .kpi-value { font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .kpi-sub { font-size: 9.5px; color: #475569; margin-top: 2px; }
    h2 { font-size: 11.5px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cbd5e1; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 10px; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; text-align: left; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .summary-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 12px; }
    .strip-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px; font-size: 10px; }
    .strip-card strong { display: block; font-size: 10.5px; margin-bottom: 3px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; text-align: center; page-break-inside: avoid; }
    .sig-role { font-weight: 800; font-size: 10.5px; text-transform: uppercase; }
    .sig-note { font-size: 9.5px; color: #64748b; font-style: italic; }
    .sig-gap { height: 54px; }
  </style>
</head>
<body>
  <div class="top-head">
    <div class="org-left">
      <div class="org-name">BAN QUẢN LÝ KÝ TÚC XÁ PHƯỚC VĨNH TÂY</div>
      <div class="org-sub">Phạm vi báo cáo: ${escapeHtml(ktxLabel)}</div>
    </div>
    <div class="doc-meta">
      <div><strong>Ngày báo cáo:</strong> ${escapeHtml(dateVN)}</div>
      <div>Xuất lúc: ${escapeHtml(generatedAt)}</div>
      <div>Người lập: ${escapeHtml(actorName)}</div>
    </div>
  </div>

  <div class="title-block">
    <h1>Báo Cáo Tổng Hợp Điều Hành Ký Túc Xá</h1>
    <p>Quân số lưu trú · Quỹ giường · Pháp lý tạm trú · An ninh kỷ luật · Kỹ thuật bảo trì</p>
  </div>

  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-label">Quân số hiện diện</div>
      <div class="kpi-value">${totalOccupied.toLocaleString('vi-VN')} / ${totalCapacity.toLocaleString('vi-VN')}</div>
      <div class="kpi-sub">Lấp đầy ${fillPct}% · Nam ${totalMale} / Nữ ${totalFemale}</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Quỹ giường trống</div>
      <div class="kpi-value">${vacantBeds.toLocaleString('vi-VN')} chỗ</div>
      <div class="kpi-sub">${totalEmptyRooms}/${totalRooms} phòng trống hoàn toàn</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Biến động hôm nay</div>
      <div class="kpi-value">+${todayEntered} / -${todayLeft}</div>
      <div class="kpi-sub">Ròng: ${todayEntered - todayLeft >= 0 ? `+${todayEntered - todayLeft}` : todayEntered - todayLeft} công nhân</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Cảnh báo điều hành</div>
      <div class="kpi-value">${riskReport.counts.critical} khẩn · ${riskReport.counts.high} cao</div>
      <div class="kpi-sub">Tạm trú quá hạn: ${riskReport.overdueTamTruCount}</div>
    </div>
  </div>

  <h2>I. Tình hình Quân số & Công suất theo Dãy nhà</h2>
  <table>
    <thead>
      <tr>
        <th>Dãy nhà</th>
        <th class="num">Tổng phòng</th>
        <th class="num">Phòng trống</th>
        <th class="num">Hiện diện / ĐM</th>
        <th class="num">Chỗ trống</th>
        <th class="num">Lấp đầy</th>
        <th class="num">Nam / Nữ</th>
        <th>Phụ trách</th>
      </tr>
    </thead>
    <tbody>
      ${buildingTableHtml}
    </tbody>
  </table>

  <h2>II. Phân bổ Quân số theo Nhà thầu / Đơn vị (Top 10)</h2>
  <table>
    <thead>
      <tr>
        <th class="num" style="width:32px;">STT</th>
        <th>Đơn vị / Nhà thầu</th>
        <th class="num">Quân số</th>
        <th class="num">Tỷ trọng</th>
        <th class="num">Nam / Nữ</th>
        <th class="num">Chưa ĐK Tạm trú</th>
      </tr>
    </thead>
    <tbody>
      ${contractorTableHtml}
    </tbody>
  </table>

  <h2>III. Pháp lý Tạm trú · An ninh Kỷ luật · Kỹ thuật Bảo trì</h2>
  <div class="summary-strip">
    <div class="strip-card">
      <strong>Pháp lý Tạm trú & Hồ sơ</strong>
      <div>• Quá hạn &gt;7 ngày: <b>${riskReport.overdueTamTruCount}</b></div>
      <div>• Sắp quá hạn (5–7 ngày): <b>${riskReport.approachingTamTruCount}</b></div>
      <div>• Hồ sơ thiếu thông tin: <b>${riskReport.incompleteProfilesCount}</b></div>
    </div>
    <div class="strip-card">
      <strong>An ninh & Kỷ luật KTX</strong>
      <div>• Vi phạm ghi nhận (30 ngày): <b>${riskReport.recent30dDisciplinesCount}</b></div>
      <div>• Danh sách Đen đang hiệu lực: <b>${riskReport.activeBlacklistCount}</b></div>
      <div>• Phòng thưa cần dồn (&le;35%): <b>${riskReport.sparseRoomsCount}</b></div>
    </div>
    <div class="strip-card">
      <strong>Kỹ thuật & Bảo trì (SLA)</strong>
      <div>• Phiếu đang mở/xử lý: <b>${openTickets}</b></div>
      <div>• Phiếu quá hạn SLA: <b>${riskReport.overdueSlaCount}</b></div>
      <div>• Đã hoàn thành: <b>${resolvedTickets}</b> · Lặp lại: <b>${riskReport.repeatFailureRooms.length} phòng</b></div>
    </div>
  </div>

  <h2>IV. Điểm nóng Rủi ro & Kiến nghị Điều hành</h2>
  <table>
    <thead>
      <tr>
        <th style="width:74px;text-align:center;">Mức độ</th>
        <th style="width:110px;">Nhóm rủi ro</th>
        <th>Nội dung cảnh báo & Khuyến nghị</th>
        <th class="num" style="width:82px;">Quy mô</th>
      </tr>
    </thead>
    <tbody>
      ${riskRowsHtml}
    </tbody>
  </table>

  <div class="signatures">
    <div>
      <div class="sig-role">Người lập báo cáo</div>
      <div class="sig-note">(Ký, ghi rõ họ tên)</div>
      <div class="sig-gap"></div>
      <div><strong>${escapeHtml(actorName)}</strong></div>
    </div>
    <div>
      <div class="sig-role">Trưởng Ban Quản Lý KTX</div>
      <div class="sig-note">(Kiểm duyệt)</div>
      <div class="sig-gap"></div>
      <div>....................................</div>
    </div>
    <div>
      <div class="sig-role">Ban Giám Đốc phê duyệt</div>
      <div class="sig-note">(Ký duyệt, đóng dấu)</div>
      <div class="sig-gap"></div>
      <div>....................................</div>
    </div>
  </div>
</body>
</html>`;

  return printHtmlViaIframe(html);
}
