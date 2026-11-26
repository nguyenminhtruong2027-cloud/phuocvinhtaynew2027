'use client';

export interface SnapshotLegendItem {
  label: string;
  color: string;
}

export interface ExecutiveSnapshotOptions {
  webglDataUrl: string;
  scopeTitle: string;
  modeLabel: string;
  theme: 'dark' | 'light';
  stats: {
    occupied: number;
    capacity: number;
    vacant: number;
    fillRatePct: number;
    roomsCount: number;
    issueRoomsCount: number;
    overdueSlaCount?: number;
  };
  legend: SnapshotLegendItem[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = err => reject(err);
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Composites a raw WebGL 3D screenshot into a presentation-ready Executive Report PNG
 * with header banner, timestamp, active mode badge, 5 KPI tiles, and color legend.
 */
export async function composeExecutive3DSnapshot(
  opts: ExecutiveSnapshotOptions
): Promise<string> {
  const img = await loadImage(opts.webglDataUrl);
  const isLight = opts.theme === 'light';

  const pad = 28;
  const headerH = 84;
  const footerH = 128;
  const targetW = Math.max(1280, Math.min(2048, img.naturalWidth || 1600));
  const aspect = img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : 9 / 16;
  const viewportW = targetW - pad * 2;
  const viewportH = Math.round(viewportW * aspect);
  const totalH = headerH + viewportH + footerH + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return opts.webglDataUrl;

  // Palette
  const bg = isLight ? '#F4F6FB' : '#0B1020';
  const cardBg = isLight ? '#FFFFFF' : '#121A30';
  const border = isLight ? '#D5DCEA' : '#26334F';
  const textPrimary = isLight ? '#0F172A' : '#E8ECF6';
  const textMuted = isLight ? '#5B6780' : '#93A0BC';
  const accent = isLight ? '#2550DC' : '#4F7CFF';

  // Background fill
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, targetW, totalH);

  // Subtle architectural header accent line
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, targetW, 4);

  // ── Header Band ──
  const nowStr = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  ctx.fillStyle = textPrimary;
  ctx.font = '800 24px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('KÝ TÚC XÁ PHƯỚC VĨNH TÂY — BÁO CÁO HIỆN TRẠNG 3D', pad, pad + 2);

  ctx.fillStyle = textMuted;
  ctx.font = '600 14px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `Phạm vi: ${opts.scopeTitle}   ·   Chế độ hiển thị: ${opts.modeLabel}   ·   Xuất lúc: ${nowStr}`,
    pad,
    pad + 36
  );

  // Right badge: Mode pill
  ctx.font = '700 13px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  const badgeText = `LỚP DỮ LIỆU: ${opts.modeLabel.toUpperCase()}`;
  const badgeW = Math.ceil(ctx.measureText(badgeText).width) + 28;
  const badgeX = targetW - pad - badgeW;
  const badgeY = pad + 8;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, 34, 10);
  ctx.fillStyle = isLight ? '#E0E8FF' : '#1B2A55';
  ctx.fill();
  ctx.strokeStyle = isLight ? '#93B4FF' : '#3B66F0';
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.fillStyle = isLight ? '#1D4ED8' : '#9DB4FF';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + 14, badgeY + 17);

  // ── 3D Viewport Frame ──
  const vpY = pad + headerH - 12;
  ctx.save();
  drawRoundedRect(ctx, pad, vpY, viewportW, viewportH, 16);
  ctx.clip();
  ctx.drawImage(img, pad, vpY, viewportW, viewportH);
  ctx.restore();

  drawRoundedRect(ctx, pad, vpY, viewportW, viewportH, 16);
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── Footer Executive KPI Strip + Legend ──
  const footY = vpY + viewportH + 16;
  const kpiRowH = 68;

  const kpis: Array<{ label: string; value: string; color: string }> = [
    {
      label: 'QUÂN SỐ HIỆN DIỆN',
      value: `${opts.stats.occupied.toLocaleString('vi-VN')} người`,
      color: isLight ? '#2550DC' : '#9DB4FF',
    },
    {
      label: 'TỔNG SỨC CHỨA',
      value: `${opts.stats.capacity.toLocaleString('vi-VN')} chỗ (${opts.stats.roomsCount}P)`,
      color: textPrimary,
    },
    {
      label: 'TỶ LỆ LẤP ĐẦY',
      value: `${opts.stats.fillRatePct}%`,
      color:
        opts.stats.fillRatePct > 100
          ? '#EF4444'
          : opts.stats.fillRatePct >= 90
            ? '#F59E0B'
            : '#10B981',
    },
    {
      label: 'CHỖ CÒN TRỐNG',
      value: `${opts.stats.vacant.toLocaleString('vi-VN')} giường`,
      color: '#10B981',
    },
    {
      label: 'PHÒNG SỰ CỐ / SLA',
      value:
        opts.stats.overdueSlaCount && opts.stats.overdueSlaCount > 0
          ? `${opts.stats.issueRoomsCount}P (${opts.stats.overdueSlaCount} quá hạn)`
          : `${opts.stats.issueRoomsCount} phòng`,
      color:
        opts.stats.issueRoomsCount > 0
          ? opts.stats.overdueSlaCount && opts.stats.overdueSlaCount > 0
            ? '#EF4444'
            : '#F97316'
          : textMuted,
    },
  ];

  const kpiGap = 12;
  const kpiW = (viewportW - kpiGap * (kpis.length - 1)) / kpis.length;

  kpis.forEach((item, i) => {
    const x = pad + i * (kpiW + kpiGap);
    drawRoundedRect(ctx, x, footY, kpiW, kpiRowH, 12);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.fillStyle = textMuted;
    ctx.font = '700 11px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
    ctx.fillText(item.label, x + 14, footY + 12);

    ctx.fillStyle = item.color;
    ctx.font = '800 20px "JetBrains Mono", "Plus Jakarta Sans", monospace';
    ctx.fillText(item.value, x + 14, footY + 32);
  });

  // ── Legend Strip ──
  const legY = footY + kpiRowH + 14;
  drawRoundedRect(ctx, pad, legY, viewportW, 38, 10);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  let curX = pad + 14;
  const midY = legY + 19;

  ctx.fillStyle = textMuted;
  ctx.font = '700 11px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  const prefix = 'CHÚ GIẢI:';
  ctx.fillText(prefix, curX, midY);
  curX += ctx.measureText(prefix).width + 16;

  ctx.font = '600 12px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  for (const leg of opts.legend) {
    const labelW = ctx.measureText(leg.label).width;
    if (curX + 18 + labelW > targetW - pad - 14) break;
    drawRoundedRect(ctx, curX, midY - 6, 12, 12, 3);
    ctx.fillStyle = leg.color;
    ctx.fill();
    curX += 18;
    ctx.fillStyle = textPrimary;
    ctx.fillText(leg.label, curX, midY);
    curX += labelW + 20;
  }

  return canvas.toDataURL('image/png');
}
