import { escapeHtml } from '@/lib/printHtml';
import { getVNDateString, getVNDateTimeDisplay } from '@/lib/vnDate';

export interface DailyBriefingBuildingStat {
  day: string;
  workers: number;
  capacity: number;
  rooms: number;
  emptyRooms: number;
  staffName?: string;
}

export interface DailyBriefingInput {
  ktxLabel: string;
  totalWorkers: number;
  totalCapacity: number;
  totalRooms: number;
  emptyRooms: number;
  overloadedRooms: number;
  maleWorkers: number;
  femaleWorkers: number;
  todayEntered: number;
  todayLeft: number;
  unregisteredTamTru: number;
  overdueTamTru: number;
  facilityIssuesCount: number;
  maintenanceBedsCount: number;
  pendingRegistrationsCount?: number;
  pendingCheckoutsCount?: number;
  buildingStats: DailyBriefingBuildingStat[];
}

export function buildZaloDailyBriefing(input: DailyBriefingInput): string {
  const todayIso = getVNDateString();
  const [y, m, d] = todayIso.split('-');
  const dateVN = `${d}/${m}/${y}`;
  const timeNow = getVNDateTimeDisplay();
  const vacant = Math.max(0, input.totalCapacity - input.totalWorkers);
  const fillPct = input.totalCapacity > 0
    ? ((input.totalWorkers / input.totalCapacity) * 100).toFixed(1)
    : '0.0';
  const net = input.todayEntered - input.todayLeft;
  const netStr = net > 0 ? `+${net}` : `${net}`;

  const phase1Buildings = input.buildingStats.filter(b => {
    const match = b.day.match(/(\d+)/);
    const num = match ? parseInt(match[1], 10) : 0;
    return num >= 1 && num <= 3;
  });
  const phase1Workers = phase1Buildings.reduce((s, b) => s + b.workers, 0);
  const phase1Cap = phase1Buildings.reduce((s, b) => s + b.capacity, 0);
  const phase1Pct = phase1Cap > 0 ? ((phase1Workers / phase1Cap) * 100).toFixed(1) : '0.0';

  const lines: string[] = [
    `BÁO CÁO GIAO BAN NHANH — ${input.ktxLabel.toUpperCase()}`,
    `Ngày: ${dateVN} (Cập nhật: ${timeNow})`,
    `--------------------------------`,
    `1. TỔNG QUÂN SỐ & CÔNG SUẤT`,
    `- Hiện diện: ${input.totalWorkers.toLocaleString('vi-VN')} / ${input.totalCapacity.toLocaleString('vi-VN')} chỗ (${fillPct}%)`,
    `- Nam: ${input.maleWorkers.toLocaleString('vi-VN')} | Nữ: ${input.femaleWorkers.toLocaleString('vi-VN')}`,
    `- Chỗ trống: ${vacant.toLocaleString('vi-VN')} chỗ (${input.emptyRooms}/${input.totalRooms} phòng trống hoàn toàn)`,
  ];

  if (phase1Cap > 0 && phase1Cap < input.totalCapacity) {
    lines.push(
      `- GĐ 1 (Dãy 1–3): ${phase1Workers.toLocaleString('vi-VN')} / ${phase1Cap.toLocaleString('vi-VN')} chỗ (${phase1Pct}%)`
    );
  }

  lines.push(
    ``,
    `2. BIẾN ĐỘNG TRONG NGÀY (${dateVN})`,
    `- Vào mới: +${input.todayEntered} | Rời KTX: -${input.todayLeft} | Biến động ròng: ${netStr}`,
    ``,
    `3. CHI TIẾT THEO DÃY NHÀ`
  );

  for (const b of input.buildingStats) {
    const pct = b.capacity > 0 ? Math.round((b.workers / b.capacity) * 100) : 0;
    const staff = b.staffName ? ` · PT: ${b.staffName}` : '';
    lines.push(
      `- ${b.day}: ${b.workers}/${b.capacity} (${pct}%) · Trống ${b.emptyRooms}/${b.rooms} phòng${staff}`
    );
  }

  lines.push(
    ``,
    `4. CẢNH BÁO CẦN XỬ LÝ`,
    `- Tạm trú: ${input.unregisteredTamTru} chưa ĐK (${input.overdueTamTru} quá hạn > 7 ngày)`,
    `- Phòng quá tải: ${input.overloadedRooms} phòng`,
    `- Bảo trì CSVC: ${input.facilityIssuesCount} phòng có ghi chú hỏng · ${input.maintenanceBedsCount} giường bảo trì`
  );

  if (
    typeof input.pendingRegistrationsCount === 'number' ||
    typeof input.pendingCheckoutsCount === 'number'
  ) {
    lines.push(
      `- Hồ sơ QR chờ duyệt: ${input.pendingRegistrationsCount ?? 0} đăng ký · ${input.pendingCheckoutsCount ?? 0} check-out`
    );
  }

  lines.push(`--------------------------------`, `Ban Quản Lý ${input.ktxLabel}`);

  return lines.join('\n');
}

export function buildPrintableDailyBriefingHtml(input: DailyBriefingInput): string {
  const todayIso = getVNDateString();
  const [y, m, d] = todayIso.split('-');
  const dateVN = `${d}/${m}/${y}`;
  const timeNow = getVNDateTimeDisplay();
  const vacant = Math.max(0, input.totalCapacity - input.totalWorkers);
  const fillPct = input.totalCapacity > 0
    ? ((input.totalWorkers / input.totalCapacity) * 100).toFixed(1)
    : '0.0';
  const net = input.todayEntered - input.todayLeft;

  const buildingRows = input.buildingStats
    .map(b => {
      const pct = b.capacity > 0 ? ((b.workers / b.capacity) * 100).toFixed(1) : '0.0';
      return `
        <tr>
          <td class="b">${escapeHtml(b.day)}</td>
          <td class="r">${b.rooms}</td>
          <td class="r">${b.capacity.toLocaleString('vi-VN')}</td>
          <td class="r b">${b.workers.toLocaleString('vi-VN')}</td>
          <td class="r">${Math.max(0, b.capacity - b.workers).toLocaleString('vi-VN')}</td>
          <td class="r">${b.emptyRooms}</td>
          <td class="r">${pct}%</td>
          <td>${escapeHtml(b.staffName || 'Chưa phân công')}</td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Báo Cáo Giao Ban Ngày ${escapeHtml(dateVN)} — ${escapeHtml(input.ktxLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
    }
    .hdr {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .title { font-size: 18px; font-weight: 800; }
    .sub { font-size: 11px; color: #475569; margin-top: 2px; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .kpi {
      border: 1px solid #cbd5e1;
      padding: 10px;
      background: #f8fafc;
    }
    .kpi-label { font-size: 10px; text-transform: uppercase; color: #475569; font-weight: 700; }
    .kpi-val { font-size: 20px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; }
    .kpi-sub { font-size: 10.5px; color: #64748b; margin-top: 2px; }
    h3 { font-size: 13px; font-weight: 800; margin: 14px 0 6px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #64748b; padding: 6px 8px; }
    th { background: #e2e8f0; font-size: 11px; text-align: center; }
    td.r { text-align: right; font-variant-numeric: tabular-nums; }
    td.b { font-weight: 700; }
    .alert-box {
      border: 1px solid #cbd5e1;
      padding: 10px 12px;
      background: #fffbeb;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px 16px;
      font-size: 11.5px;
    }
    .sign {
      display: flex;
      justify-content: space-between;
      margin-top: 28px;
      text-align: center;
    }
    .sign > div { width: 42%; }
    .sign-lbl { font-weight: 700; font-size: 11.5px; }
    .sign-note { font-size: 10.5px; color: #64748b; font-style: italic; }
  </style>
</head>
<body>
  <div class="hdr">
    <div>
      <div class="title">BÁO CÁO GIAO BAN VẬN HÀNH KÝ TÚC XÁ</div>
      <div class="sub">${escapeHtml(input.ktxLabel)} · Khu Lán Trại Vincons</div>
    </div>
    <div style="text-align:right">
      <div><strong>Ngày báo cáo:</strong> ${escapeHtml(dateVN)}</div>
      <div class="sub">Xuất lúc: ${escapeHtml(timeNow)}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Quân số hiện diện</div>
      <div class="kpi-val">${input.totalWorkers.toLocaleString('vi-VN')}</div>
      <div class="kpi-sub">Nam: ${input.maleWorkers} · Nữ: ${input.femaleWorkers}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Công suất & Lấp đầy</div>
      <div class="kpi-val">${fillPct}%</div>
      <div class="kpi-sub">${input.totalWorkers}/${input.totalCapacity} chỗ · ${input.totalRooms} phòng</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Sẵn sàng tiếp nhận</div>
      <div class="kpi-val">${vacant.toLocaleString('vi-VN')}</div>
      <div class="kpi-sub">${input.emptyRooms} phòng trống hoàn toàn</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Biến động hôm nay</div>
      <div class="kpi-val">${net > 0 ? `+${net}` : net}</div>
      <div class="kpi-sub">Vào: +${input.todayEntered} · Ra: -${input.todayLeft}</div>
    </div>
  </div>

  <h3>1. Chi tiết vận hành theo Dãy nhà</h3>
  <table>
    <thead>
      <tr>
        <th>Dãy nhà</th>
        <th>Số phòng</th>
        <th>Sức chứa</th>
        <th>Hiện diện</th>
        <th>Chỗ trống</th>
        <th>Phòng trống</th>
        <th>Lấp đầy</th>
        <th>Phụ trách</th>
      </tr>
    </thead>
    <tbody>
      ${buildingRows}
    </tbody>
  </table>

  <h3>2. Tổng hợp cảnh báo & tồn đọng</h3>
  <div class="alert-box">
    <div><strong>Chưa ĐK tạm trú:</strong> ${input.unregisteredTamTru} người (${input.overdueTamTru} quá hạn &gt; 7 ngày)</div>
    <div><strong>Phòng quá tải:</strong> ${input.overloadedRooms} phòng</div>
    <div><strong>Sự cố thiết bị CSVC:</strong> ${input.facilityIssuesCount} phòng có ghi chú</div>
    <div><strong>Giường đang bảo trì:</strong> ${input.maintenanceBedsCount} giường</div>
  </div>

  <div class="sign">
    <div>
      <div class="sign-lbl">NGƯỜI LẬP BÁO CÁO</div>
      <div class="sign-note">(Ký và ghi rõ họ tên)</div>
    </div>
    <div>
      <div class="sign-lbl">CHỈ HUY TRƯỞNG / BAN QUẢN LÝ</div>
      <div class="sign-note">(Ký duyệt)</div>
    </div>
  </div>
</body>
</html>`;
}
