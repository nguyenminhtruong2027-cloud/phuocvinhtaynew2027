import { Worker, naturalSortCompare } from '@/data/workers';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { escapeHtml, printHtmlViaIframe } from '@/lib/printHtml';
import { getVNDateTimeDisplay } from '@/lib/vnDate';

export interface BatchDoorRoomInput {
  ktx: string;
  day: string;
  room: string;
  capacity: number;
  genderLabel: string;
  workers: Worker[];
  note?: string | null;
}

/**
 * Generates and prints clean multi-page A4 room door rosters (1 room per page)
 * for posting on dormitory room doors.
 */
export function printBatchRoomDoorPosters(rooms: BatchDoorRoomInput[]): boolean {
  if (!rooms || rooms.length === 0) return false;

  const sortedRooms = [...rooms].sort((a, b) => {
    const dCmp = naturalSortCompare(a.day, b.day);
    if (dCmp !== 0) return dCmp;
    return naturalSortCompare(a.room, b.room);
  });

  const printTime = getVNDateTimeDisplay();

  const pagesHtml = sortedRooms
    .map((roomInfo, pageIdx) => {
      const sortedWorkers = [...roomInfo.workers].sort((a, b) => {
        const bedCmp = naturalSortCompare(a.giuong || '999', b.giuong || '999');
        if (bedCmp !== 0) return bedCmp;
        return (a.hoVaTen || '').localeCompare(b.hoVaTen || '', 'vi');
      });

      const minRows = Math.max(roomInfo.capacity || 20, sortedWorkers.length);
      const tableRows: string[] = [];

      for (let i = 0; i < minRows; i++) {
        const w = sortedWorkers[i];
        if (w) {
          const tamTruText = w.tamTruStatus === 'registered' ? 'Đã ĐK' : 'Chưa ĐK';
          tableRows.push(`
            <tr>
              <td class="c">${i + 1}</td>
              <td class="c mono">${escapeHtml(w.giuong || '-')}</td>
              <td class="b">${escapeHtml(w.hoVaTen)}</td>
              <td class="c mono">${escapeHtml(w.maNV || '-')}</td>
              <td>${escapeHtml(w.donVi || '-')}</td>
              <td class="c mono">${escapeHtml(w.soDienThoai || '-')}</td>
              <td class="c">${escapeHtml(tamTruText)}</td>
            </tr>
          `);
        } else {
          tableRows.push(`
            <tr class="empty-row">
              <td class="c">${i + 1}</td>
              <td class="c"></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          `);
        }
      }

      const roomTitle = formatRoomDisplay(roomInfo.room);
      const isLast = pageIdx === sortedRooms.length - 1;

      return `
        <section class="sheet ${isLast ? 'last-sheet' : ''}">
          <div class="doc-header">
            <div class="brand">
              <div class="org">BAN QUẢN LÝ KÝ TÚC XÁ PHƯỚC VĨNH TÂY</div>
              <div class="sub">Khu Lán Trại Vincons · Danh Sách Niêm Yết Cửa Phòng</div>
            </div>
            <div class="room-box">
              <div class="room-day">${escapeHtml(roomInfo.day)}</div>
              <div class="room-num">${escapeHtml(roomTitle)}</div>
            </div>
          </div>

          <div class="meta-strip">
            <div><strong>Cơ sở:</strong> ${escapeHtml(roomInfo.ktx)}</div>
            <div><strong>Công năng:</strong> ${escapeHtml(roomInfo.genderLabel)}</div>
            <div><strong>Quân số:</strong> ${sortedWorkers.length} / ${roomInfo.capacity} chỗ</div>
            <div><strong>Cập nhật:</strong> ${escapeHtml(printTime)}</div>
          </div>

          ${
            roomInfo.note
              ? `<div class="note-line"><strong>Ghi chú phòng:</strong> ${escapeHtml(roomInfo.note)}</div>`
              : ''
          }

          <table>
            <thead>
              <tr>
                <th style="width:36px">STT</th>
                <th style="width:54px">Giường</th>
                <th>Họ và tên</th>
                <th style="width:86px">Mã NV</th>
                <th style="width:140px">Đơn vị</th>
                <th style="width:96px">Số điện thoại</th>
                <th style="width:72px">Tạm trú</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows.join('')}
            </tbody>
          </table>

          <div class="sign-row">
            <div class="sign-col">
              <div class="sign-title">ĐẠI DIỆN PHÒNG / TỔ TRƯỞNG</div>
              <div class="sign-sub">(Ký và ghi rõ họ tên)</div>
            </div>
            <div class="sign-col">
              <div class="sign-title">CHUYÊN VIÊN PHỤ TRÁCH DÃY</div>
              <div class="sign-sub">(Ký và ghi rõ họ tên)</div>
            </div>
            <div class="sign-col">
              <div class="sign-title">BAN QUẢN LÝ KÝ TÚC XÁ</div>
              <div class="sign-sub">(Xác nhận)</div>
            </div>
          </div>
        </section>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Danh Sách Niêm Yết Cửa Phòng — KTX Phước Vĩnh Tây</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 0;
      font-size: 11.5px;
      line-height: 1.35;
    }
    .sheet {
      page-break-after: always;
      break-after: page;
    }
    .sheet.last-sheet {
      page-break-after: auto;
      break-after: auto;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 8px;
    }
    .org { font-size: 15px; font-weight: 800; letter-spacing: 0.3px; }
    .sub { font-size: 11px; color: #475569; margin-top: 2px; }
    .room-box {
      border: 2px solid #0f172a;
      padding: 6px 14px;
      text-align: center;
      min-width: 128px;
    }
    .room-day { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #334155; }
    .room-num { font-size: 20px; font-weight: 900; line-height: 1.1; margin-top: 2px; }
    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
      margin-bottom: 8px;
      font-size: 11px;
    }
    .note-line {
      font-size: 11px;
      padding: 5px 10px;
      border: 1px dashed #94a3b8;
      margin-bottom: 8px;
      background: #fffbeb;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #475569;
      padding: 5px 6px;
      vertical-align: middle;
    }
    th {
      background: #e2e8f0;
      font-weight: 700;
      text-align: center;
      font-size: 11px;
    }
    td.c { text-align: center; }
    td.b { font-weight: 600; }
    td.mono { font-family: Consolas, 'Courier New', monospace; font-size: 11px; }
    tr.empty-row td { height: 24px; color: #94a3b8; }
    .sign-row {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      text-align: center;
    }
    .sign-col { width: 32%; }
    .sign-title { font-weight: 700; font-size: 11px; }
    .sign-sub { font-size: 10px; color: #64748b; font-style: italic; margin-top: 2px; }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

  return printHtmlViaIframe(html);
}
