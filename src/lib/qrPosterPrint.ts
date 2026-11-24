import { escapeHtml, printHtmlViaIframe } from '@/lib/printHtml';
import { generateQrDataUrl } from '@/components/QrCodeImage';

export type PosterPaperSize = 'A4' | 'A5';

export interface QrPosterConfig {
  url: string;
  paperSize?: PosterPaperSize;
  badgeText: string;
  title: string;
  subtitle: string;
  accentHex?: string;
  steps: Array<{ title: string; detail: string }>;
  footerNote: string;
  metaLine?: string;
}

/**
 * Tạo và in mẫu Poster QR khổ A4 hoặc A5 chuyên nghiệp để niêm yết tại bảng tin / cổng KTX.
 */
export async function printQrBulletinPoster(config: QrPosterConfig): Promise<boolean> {
  const {
    url,
    paperSize = 'A4',
    badgeText,
    title,
    subtitle,
    accentHex = '#0f3d7a',
    steps,
    footerNote,
    metaLine,
  } = config;

  const qrWidth = paperSize === 'A5' ? 480 : 640;
  const qrDataUrl = await generateQrDataUrl(url, { width: qrWidth, margin: 3 });
  if (!qrDataUrl) return false;

  const isA5 = paperSize === 'A5';
  const stepsHtml = steps
    .map(
      (s, idx) => `
      <div class="step">
        <div class="step-num">${idx + 1}</div>
        <div class="step-body">
          <div class="step-title">${escapeHtml(s.title)}</div>
          <div class="step-desc">${escapeHtml(s.detail)}</div>
        </div>
      </div>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} (${paperSize})</title>
  <style>
    @page {
      size: ${paperSize} portrait;
      margin: ${isA5 ? '8mm' : '12mm'};
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 100%;
      max-width: ${isA5 ? '132mm' : '186mm'};
      margin: 0 auto;
      border: 2px solid #0f172a;
      border-radius: ${isA5 ? '10px' : '14px'};
      overflow: hidden;
    }
    .topbar {
      background: ${accentHex};
      color: #ffffff;
      padding: ${isA5 ? '12px 16px' : '18px 26px'};
      text-align: center;
    }
    .org {
      font-size: ${isA5 ? '10px' : '12px'};
      font-weight: 700;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      opacity: 0.9;
    }
    .badge {
      display: inline-block;
      margin-top: ${isA5 ? '6px' : '8px'};
      padding: ${isA5 ? '2px 10px' : '3px 12px'};
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.45);
      font-size: ${isA5 ? '9.5px' : '11px'};
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .content {
      padding: ${isA5 ? '14px 16px 12px' : '24px 28px 20px'};
      text-align: center;
    }
    h1 {
      margin: 0;
      font-size: ${isA5 ? '18px' : '26px'};
      font-weight: 800;
      line-height: 1.25;
      color: #0f172a;
    }
    .subtitle {
      margin: ${isA5 ? '6px auto 0' : '8px auto 0'};
      max-width: ${isA5 ? '110mm' : '150mm'};
      font-size: ${isA5 ? '11px' : '14px'};
      line-height: 1.45;
      color: #475569;
    }
    .meta {
      margin-top: ${isA5 ? '8px' : '10px'};
      font-size: ${isA5 ? '11px' : '13px'};
      font-weight: 700;
      color: ${accentHex};
    }
    .qr-wrap {
      margin: ${isA5 ? '14px auto 10px' : '22px auto 14px'};
      display: inline-block;
      padding: ${isA5 ? '10px' : '14px'};
      border: 2.5px solid #0f172a;
      border-radius: ${isA5 ? '10px' : '14px'};
      background: #ffffff;
    }
    .qr-wrap img {
      display: block;
      width: ${isA5 ? '58mm' : '82mm'};
      height: ${isA5 ? '58mm' : '82mm'};
      object-fit: contain;
    }
    .scan-hint {
      font-size: ${isA5 ? '10.5px' : '13px'};
      font-weight: 700;
      color: #0f172a;
      margin-bottom: ${isA5 ? '4px' : '6px'};
    }
    .url-box {
      display: inline-block;
      margin-top: 4px;
      padding: ${isA5 ? '4px 10px' : '6px 14px'};
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: ${isA5 ? '9.5px' : '11.5px'};
      color: #1e293b;
      word-break: break-all;
    }
    .steps {
      margin-top: ${isA5 ? '14px' : '22px'};
      padding-top: ${isA5 ? '12px' : '16px'};
      border-top: 1px dashed #cbd5e1;
      display: grid;
      grid-template-columns: repeat(${Math.min(steps.length, 3)}, 1fr);
      gap: ${isA5 ? '8px' : '12px'};
      text-align: left;
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: ${isA5 ? '6px' : '8px'};
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: ${isA5 ? '7px' : '10px'};
    }
    .step-num {
      width: ${isA5 ? '18px' : '22px'};
      height: ${isA5 ? '18px' : '22px'};
      border-radius: 50%;
      background: ${accentHex};
      color: #ffffff;
      font-size: ${isA5 ? '10px' : '12px'};
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .step-title {
      font-size: ${isA5 ? '10px' : '12px'};
      font-weight: 700;
      color: #0f172a;
      line-height: 1.25;
    }
    .step-desc {
      margin-top: 2px;
      font-size: ${isA5 ? '9px' : '10.5px'};
      color: #475569;
      line-height: 1.35;
    }
    .footer {
      background: #f8fafc;
      border-top: 1px solid #cbd5e1;
      padding: ${isA5 ? '8px 14px' : '12px 24px'};
      text-align: center;
      font-size: ${isA5 ? '9.5px' : '11.5px'};
      color: #334155;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="topbar">
      <div class="org">Ký Túc Xá Phước Vĩnh Tây · Hệ Thống Quản Lý Cư Trú</div>
      <div class="badge">${escapeHtml(badgeText)}</div>
    </div>
    <div class="content">
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      ${metaLine ? `<div class="meta">${escapeHtml(metaLine)}</div>` : ''}
      <div class="qr-wrap">
        <img src="${qrDataUrl}" alt="${escapeHtml(title)}" />
      </div>
      <div class="scan-hint">Mở Camera điện thoại hoặc ứng dụng Zalo để quét mã</div>
      <div class="url-box">${escapeHtml(url)}</div>
      ${steps.length > 0 ? `<div class="steps">${stepsHtml}</div>` : ''}
    </div>
    <div class="footer">${escapeHtml(footerNote)}</div>
  </div>
</body>
</html>`;

  printHtmlViaIframe(html);
  return true;
}

export interface BatchRoomQrItem {
  ktx: string;
  day: string;
  roomLabel: string;
  url: string;
}

/**
 * In hàng loạt tem QR báo hỏng dán cửa phòng theo bố cục A4 (6 tem/trang — 2 cột x 3 hàng, có đường kẻ cắt).
 */
export async function printBatchRoomIssueQrStickers(
  items: BatchRoomQrItem[],
  headerTitle: string
): Promise<boolean> {
  if (!items || items.length === 0) return false;

  const qrDataUrls = await Promise.all(
    items.map(item => generateQrDataUrl(item.url, { width: 320, margin: 2 }))
  );

  // Split into pages of 6 stickers (2 columns x 3 rows)
  const pages: Array<Array<{ item: BatchRoomQrItem; qr: string }>> = [];
  for (let i = 0; i < items.length; i += 6) {
    const chunk: Array<{ item: BatchRoomQrItem; qr: string }> = [];
    for (let j = i; j < Math.min(i + 6, items.length); j++) {
      const qr = qrDataUrls[j];
      if (qr) chunk.push({ item: items[j], qr });
    }
    if (chunk.length > 0) pages.push(chunk);
  }
  if (pages.length === 0) return false;

  const pagesHtml = pages
    .map((page, pageIdx) => {
      const cardsHtml = page
        .map(
          ({ item, qr }) => `
            <div class="sticker">
              <div class="st-top">
                <span class="st-org">KTX PHƯỚC VĨNH TÂY</span>
                <span class="st-badge">BÁO HỎNG QR</span>
              </div>
              <div class="st-body">
                <div class="st-room">${escapeHtml(item.day)} · ${escapeHtml(item.roomLabel)}</div>
                <div class="st-ktx">${escapeHtml(item.ktx)}</div>
                <div class="st-qr">
                  <img src="${qr}" alt="${escapeHtml(item.day)} ${escapeHtml(item.roomLabel)}" />
                </div>
                <div class="st-sub">Quét bằng Zalo / Camera — Tự điền sẵn phòng</div>
                <div class="st-cats">Điều hòa · Quạt · Đèn điện · Nước · Giường tủ · Khóa cửa</div>
              </div>
              <div class="st-foot">1. Quét mã &nbsp;→&nbsp; 2. Chọn thiết bị hỏng &nbsp;→&nbsp; 3. Gửi Tổ Kỹ thuật</div>
            </div>
          `
        )
        .join('');

      return `
        <section class="page ${pageIdx < pages.length - 1 ? 'page-break' : ''}">
          <div class="page-head">
            <span>${escapeHtml(headerTitle)}</span>
            <span>Trang ${pageIdx + 1}/${pages.length} · Cắt theo đường nét đứt dán cửa phòng</span>
          </div>
          <div class="grid-6">
            ${cardsHtml}
          </div>
        </section>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(headerTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 100%;
    }
    .page-break {
      page-break-after: always;
      break-after: page;
    }
    .page-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9.5px;
      color: #475569;
      padding: 0 2px 5px;
      margin-bottom: 5px;
      border-bottom: 1px solid #cbd5e1;
      font-weight: 600;
    }
    .grid-6 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: repeat(3, 1fr);
      gap: 6mm;
      height: 270mm;
    }
    .sticker {
      border: 1.5px dashed #64748b;
      border-radius: 10px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff;
    }
    .st-top {
      background: #b45309;
      color: #ffffff;
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .st-org {
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.04em;
    }
    .st-badge {
      font-size: 8.5px;
      font-weight: 800;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.35);
      border-radius: 999px;
      padding: 2px 7px;
    }
    .st-body {
      flex: 1;
      padding: 7px 10px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .st-room {
      font-size: 16px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.01em;
      line-height: 1.15;
    }
    .st-ktx {
      font-size: 9.5px;
      font-weight: 600;
      color: #64748b;
      margin-top: 2px;
    }
    .st-qr {
      margin: 6px 0 5px;
      padding: 5px;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
    }
    .st-qr img {
      width: 38mm;
      height: 38mm;
      display: block;
    }
    .st-sub {
      font-size: 9.5px;
      font-weight: 700;
      color: #b45309;
    }
    .st-cats {
      font-size: 8.5px;
      color: #475569;
      margin-top: 2px;
    }
    .st-foot {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 5px 8px;
      text-align: center;
      font-size: 8.5px;
      font-weight: 700;
      color: #334155;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

  printHtmlViaIframe(html);
  return true;
}

