import * as THREE from 'three';
import type { SceneTheme } from '../types';

/**
 * Procedural PBR textures & crisp canvas signage for the 3D KTX digital twin.
 * Zero external image/model files — 100% generated in memory with proper SRGBColorSpace.
 */

export function createGroundTileTexture(
  maxAnisotropy: number,
  theme: SceneTheme = 'dark'
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const isLight = theme === 'light';
  ctx.fillStyle = isLight ? '#d8e1ec' : '#1b2436';
  ctx.fillRect(0, 0, size, size);

  // Subtle speckle noise
  for (let i = 0; i < 1600; i++) {
    const x = (i * 73) % size;
    const y = (i * 197 + Math.floor(i / 7) * 31) % size;
    const alpha = (i % 5) * 0.012 + 0.012;
    ctx.fillStyle =
      i % 2 === 0
        ? isLight
          ? `rgba(255,255,255,${alpha * 2.2})`
          : `rgba(255,255,255,${alpha})`
        : isLight
          ? `rgba(15,23,42,${alpha * 1.1})`
          : `rgba(0,0,0,${alpha * 1.4})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Architectural paving grid lines
  ctx.strokeStyle = isLight ? 'rgba(71, 85, 105, 0.16)' : 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 2;
  const step = size / 4;
  for (let i = 0; i <= 4; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26);
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

export function createRoadTexture(
  maxAnisotropy: number,
  theme: SceneTheme = 'dark'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = theme === 'light' ? '#475569' : '#232c3d';
  ctx.fillRect(0, 0, 256, 512);

  // Road edges
  ctx.fillStyle = theme === 'light' ? 'rgba(248, 250, 252, 0.6)' : 'rgba(226, 232, 240, 0.28)';
  ctx.fillRect(8, 0, 4, 512);
  ctx.fillRect(244, 0, 4, 512);

  // Dashed center line
  ctx.fillStyle = theme === 'light' ? 'rgba(250, 204, 21, 0.8)' : 'rgba(250, 204, 21, 0.45)';
  for (let y = 16; y < 512; y += 64) {
    ctx.fillRect(125, y, 6, 34);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

export function createRoomTileFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d5dbe5';
  ctx.fillRect(0, 0, size, size);

  const tiles = 4;
  const step = size / tiles;
  for (let r = 0; r < tiles; r++) {
    for (let c = 0; c < tiles; c++) {
      const shade = (r + c) % 2 === 0 ? '#dce2ec' : '#d2d8e4';
      ctx.fillStyle = shade;
      ctx.fillRect(c * step + 2, r * step + 2, step - 4, step - 4);
    }
  }

  // Grout lines
  ctx.strokeStyle = '#9aa6ba';
  ctx.lineWidth = 3;
  for (let i = 0; i <= tiles; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 6);
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

export interface PlaqueOptions {
  bg?: string;
  border?: string;
  fg?: string;
  subtext?: string;
  width?: number;
  height?: number;
  fontSize?: number;
  maxAnisotropy?: number;
}

export function createPlaqueTexture(
  text: string,
  options: PlaqueOptions = {},
  dedupeCache?: Map<string, THREE.CanvasTexture>
): THREE.CanvasTexture {
  const width = options.width ?? 256;
  const height = options.height ?? 96;
  const bg = options.bg ?? '#0f172a';
  const border = options.border ?? '#38bdf8';
  const fg = options.fg ?? '#f8fafc';
  const subtext = options.subtext ?? '';
  const fontSize = options.fontSize ?? (subtext ? 34 : 42);

  if (dedupeCache) {
    const cacheKey = `${text}|${subtext}|${bg}|${border}|${fg}|${width}x${height}|${fontSize}`;
    const existing = dedupeCache.get(cacheKey);
    if (existing) return existing;

    const tex = renderPlaqueCanvas(text, {
      bg,
      border,
      fg,
      subtext,
      width,
      height,
      fontSize,
      maxAnisotropy: options.maxAnisotropy,
    });
    dedupeCache.set(cacheKey, tex);
    return tex;
  }

  return renderPlaqueCanvas(text, {
    bg,
    border,
    fg,
    subtext,
    width,
    height,
    fontSize,
    maxAnisotropy: options.maxAnisotropy,
  });
}

function renderPlaqueCanvas(
  text: string,
  opts: Required<Omit<PlaqueOptions, 'maxAnisotropy'>> & { maxAnisotropy?: number }
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, opts.width, opts.height);

  ctx.strokeStyle = opts.border;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, opts.width - 8, opts.height - 8);

  ctx.fillStyle = opts.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `700 ${opts.fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillText(text, opts.width / 2, opts.subtext ? opts.height * 0.39 : opts.height / 2, opts.width - 24);

  if (opts.subtext) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 ${Math.round(opts.fontSize * 0.54)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(opts.subtext, opts.width / 2, opts.height * 0.74, opts.width - 24);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(opts.maxAnisotropy ?? 4, 8);
  return tex;
}

export function createSoftShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.18)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Procedural trapezoidal standing-seam corrugated metal roofing (tôn lạnh / tôn mạ màu) */
export function createCorrugatedRoofTexture(
  baseHex: string,
  ribHex: string,
  maxAnisotropy: number,
  repeatX = 14,
  repeatY = 2
): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, w, h);

  // Standing-seam trapezoidal ribs
  const ribPitch = 16;
  for (let x = 0; x < w; x += ribPitch) {
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(x, 0, 3, h);
    ctx.fillStyle = ribHex;
    ctx.fillRect(x + 3, 0, 4, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 7, 0, 2, h);
  }

  // Horizontal lap seams & purlin fastener lines
  ctx.strokeStyle = 'rgba(15,23,42,0.22)';
  ctx.lineWidth = 2;
  for (let y = 64; y < h; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

/** Procedural 20ft ISO shipping container corrugated steel wall texture */
export function createContainerWallTexture(
  baseHex: string,
  accentHex: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, w, h);

  // Vertical trapezoidal container wall ribs
  for (let x = 10; x < w - 10; x += 10) {
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(x, 12, 2, h - 24);
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(x + 5, 12, 3, h - 24);
  }

  // Top & bottom ISO structural steel frame rails
  ctx.fillStyle = 'rgba(15,23,42,0.45)';
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillRect(0, 0, 8, h);
  ctx.fillRect(w - 8, 0, 8, h);

  // Color-coded horizontal identification stripe
  ctx.fillStyle = accentHex;
  ctx.fillRect(8, 12, w - 16, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

/** Poured industrial concrete compound slab with expansion joints & subtle aggregate grain */
export function createConcreteYardTexture(
  maxAnisotropy: number,
  theme: SceneTheme = 'dark'
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const isLight = theme === 'light';
  ctx.fillStyle = isLight ? '#cfd8e3' : '#263244';
  ctx.fillRect(0, 0, size, size);

  // Subtle poured-slab tone variation per bay
  const step = size / 4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const delta = ((r * 3 + c * 5) % 4) * 3 - 4;
      ctx.fillStyle = isLight
        ? `rgba(${206 + delta},${216 + delta},${227 + delta},0.45)`
        : `rgba(${38 + delta},${50 + delta},${68 + delta},0.45)`;
      ctx.fillRect(c * step + 2, r * step + 2, step - 4, step - 4);
    }
  }

  // Fine aggregate speckle
  for (let i = 0; i < 2200; i++) {
    const x = (i * 97 + Math.floor(i / 13) * 19) % size;
    const y = (i * 151 + Math.floor(i / 11) * 29) % size;
    ctx.fillStyle =
      i % 2 === 0
        ? isLight
          ? 'rgba(255,255,255,0.09)'
          : 'rgba(255,255,255,0.04)'
        : isLight
          ? 'rgba(15,23,42,0.07)'
          : 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Expansion control joints (khe co giãn bê tông)
  ctx.strokeStyle = isLight ? 'rgba(71,85,105,0.28)' : 'rgba(15,23,42,0.52)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

/** 2m Corrugated sheet metal perimeter fence texture (Hàng rào tôn cao 2m — 21) */
export function createCorrugatedFenceTexture(
  maxAnisotropy: number,
  theme: SceneTheme = 'dark'
): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const isLight = theme === 'light';
  ctx.fillStyle = isLight ? '#94a3b8' : '#3b4a62';
  ctx.fillRect(0, 0, w, h);

  for (let x = 0; x < w; x += 8) {
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
    ctx.fillRect(x, 0, 2, h);
    ctx.fillStyle = 'rgba(15,23,42,0.24)';
    ctx.fillRect(x + 4, 0, 2, h);
  }

  // Vincons blue architectural top & bottom trim rails
  ctx.fillStyle = isLight ? '#1d4ed8' : '#1e40af';
  ctx.fillRect(0, 0, w, 10);
  ctx.fillStyle = isLight ? '#475569' : '#1e293b';
  ctx.fillRect(0, h - 12, w, 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

/** Transparent B40 diamond chain-link wire mesh fence (Hàng rào thép lưới B40 phía Bắc) */
export function createB40MeshTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.85)';
  ctx.lineWidth = 3;

  const step = 24;
  for (let i = -size; i < size * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(i + size, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

  // Top & bottom tension wire
  ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
  ctx.fillRect(0, 0, size, 5);
  ctx.fillRect(0, size - 5, size, 5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

/** Striped sunshade canopy for Căng Teen (20) */
export function createCanteenAwningTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const stripeW = 32;
  for (let x = 0; x < w; x += stripeW) {
    ctx.fillStyle = (x / stripeW) % 2 === 0 ? '#dc2626' : '#f8fafc';
    ctx.fillRect(x, 0, stripeW, h);
  }
  ctx.fillStyle = 'rgba(15,23,42,0.18)';
  ctx.fillRect(0, h - 8, w, 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

export interface RoofInfoBoardSpec {
  title: string;
  subtitle: string;
  occupied: number;
  capacity: number;
  vacant: number;
  overflow: number;
  activeRooms: number;
  functionalRooms: number;
  hiddenRooms: number;
  maintenanceRooms: number;
  unregisteredTamTru: number;
  directionHint: string; // e.g. "◀ P.15  ···  P.1 ▶"
  accentHex: string;
  isPlaceholder?: boolean;
  theme?: SceneTheme;
}

function drawRoundedRectPath(
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
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * High-DPI (2048×240, 8.53:1) Architectural Rooftop Telemetry Board for Dormitory Rows.
 * Renders crisp live occupancy, capacity progress bar, room breakdown, alerts, and room compass.
 */
export function createRoofInfoBoardTexture(
  spec: RoofInfoBoardSpec,
  maxAnisotropy: number,
  dedupeCache?: Map<string, THREE.CanvasTexture>
): THREE.CanvasTexture {
  const cacheKey = `roof-board|${spec.title}|${spec.subtitle}|${spec.occupied}/${spec.capacity}|v${spec.vacant}|o${spec.overflow}|r${spec.activeRooms}|f${spec.functionalRooms}|h${spec.hiddenRooms}|m${spec.maintenanceRooms}|t${spec.unregisteredTamTru}|${spec.directionHint}|${spec.accentHex}|${spec.isPlaceholder ? 1 : 0}|${spec.theme ?? 'dark'}`;
  if (dedupeCache) {
    const existing = dedupeCache.get(cacheKey);
    if (existing) return existing;
  }

  const W = 2048;
  const H = 240;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const isLight = spec.theme === 'light';
  const fontStack = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  ctx.clearRect(0, 0, W, H);

  // Outer architectural dark-slate plate with subtle chamfered corners
  drawRoundedRectPath(ctx, 6, 6, W - 12, H - 12, 22);
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  if (isLight) {
    bgGrad.addColorStop(0, 'rgba(15, 23, 42, 0.92)');
    bgGrad.addColorStop(1, 'rgba(23, 35, 58, 0.90)');
  } else {
    bgGrad.addColorStop(0, 'rgba(9, 16, 31, 0.94)');
    bgGrad.addColorStop(1, 'rgba(15, 25, 46, 0.92)');
  }
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Crisp perimeter border + subtle inner hairline
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Left color-coded status accent bar
  ctx.save();
  drawRoundedRectPath(ctx, 6, 6, W - 12, H - 12, 22);
  ctx.clip();
  ctx.fillStyle = spec.accentHex;
  ctx.fillRect(6, 6, 20, H - 12);
  // Subtle accent wash behind Zone 1
  const leftWash = ctx.createLinearGradient(26, 0, 220, 0);
  leftWash.addColorStop(0, `${spec.accentHex}28`);
  leftWash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = leftWash;
  ctx.fillRect(26, 6, 200, H - 12);
  ctx.restore();

  // Subtle CAD corner ticks (top-right & bottom-right)
  ctx.strokeStyle = spec.accentHex;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W - 44, 16);
  ctx.lineTo(W - 18, 16);
  ctx.lineTo(W - 18, 42);
  ctx.moveTo(W - 44, H - 16);
  ctx.lineTo(W - 18, H - 16);
  ctx.lineTo(W - 18, H - 42);
  ctx.stroke();

  // Helper: Vertical divider
  const drawDivider = (x: number) => {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.26)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 34);
    ctx.lineTo(x, H - 34);
    ctx.stroke();
  };

  // ── ZONE 1: Building Title & Classification (x: 52 → 500) ──
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `800 84px ${fontStack}`;
  ctx.fillText(spec.title, 54, 96, 440);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = `600 31px ${fontStack}`;
  ctx.fillText(spec.subtitle, 56, 178, 440);

  drawDivider(520);

  // ── ZONE 2: Live Occupancy, Vacant & Progress Bar (x: 556 → 1185) ──
  const pct =
    spec.capacity > 0 ? Math.min(100, Math.round((spec.occupied / spec.capacity) * 100)) : 0;
  const statusColor =
    spec.overflow > 0
      ? '#fb7185'
      : spec.capacity > 0 && spec.occupied >= spec.capacity
        ? '#fbbf24'
        : spec.occupied > 0
          ? '#34d399'
          : '#38bdf8';

  if (spec.isPlaceholder) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `700 54px ${fontStack}`;
    ctx.fillText('MẶT BẰNG CHUẨN · 15 PHÒNG', 556, 94, 620);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 32px ${fontStack}`;
    ctx.fillText('Sức chứa thiết kế 300 chỗ · Sẵn sàng đồng bộ dữ liệu', 556, 166, 620);
  } else {
    // Top row: Occupied / Capacity + % + Vacant status
    const occStr = `${spec.occupied.toLocaleString('vi-VN')} / ${spec.capacity.toLocaleString('vi-VN')}`;
    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 66px ${fontStack}`;
    ctx.fillText(occStr, 556, 86, 320);

    const occMeasured = Math.min(320, ctx.measureText(occStr).width);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 30px ${fontStack}`;
    ctx.fillText('chỗ', 556 + occMeasured + 12, 96);

    // Right-aligned status summary in Zone 2
    ctx.textAlign = 'right';
    const rightStatus =
      spec.overflow > 0
        ? `QUÁ TẢI +${spec.overflow}`
        : spec.vacant > 0
          ? `Trống ${spec.vacant.toLocaleString('vi-VN')}`
          : spec.capacity > 0
            ? 'ĐẦY 100%'
            : '0 chỗ';
    ctx.fillStyle = statusColor;
    ctx.font = `800 40px ${fontStack}`;
    ctx.fillText(`${rightStatus} · ${pct}%`, 1176, 88, 290);
    ctx.textAlign = 'left';

    // Horizontal Occupancy Progress Bar
    const barX = 556;
    const barY = 154;
    const barW = 620;
    const barH = 26;
    drawRoundedRectPath(ctx, barX, barY, barW, barH, 13);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.fill();

    const fillW =
      spec.capacity > 0
        ? Math.max(spec.occupied > 0 ? 22 : 0, Math.round((Math.min(spec.occupied, spec.capacity) / spec.capacity) * barW))
        : 0;
    if (fillW > 0) {
      drawRoundedRectPath(ctx, barX, barY, fillW, barH, 13);
      ctx.fillStyle = statusColor;
      ctx.fill();
    }
  }

  drawDivider(1210);

  // ── ZONE 3: Rooms & Operational Status Chips (x: 1244 → 1705) ──
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f1f5f9';
  ctx.font = `700 44px ${fontStack}`;
  const roomSummary = spec.isPlaceholder
    ? '15 phòng ở'
    : `${spec.activeRooms} phòng ở${spec.functionalRooms > 0 ? ` · ${spec.functionalRooms} CN` : ''}`;
  ctx.fillText(roomSummary, 1244, 86, 455);

  // Status chips row
  const chips: { label: string; bg: string; fg: string; border: string }[] = [];
  if (spec.hiddenRooms > 0) {
    chips.push({
      label: `${spec.hiddenRooms} ẩn`,
      bg: 'rgba(100, 116, 139, 0.35)',
      fg: '#e2e8f0',
      border: 'rgba(148, 163, 184, 0.6)',
    });
  }
  if (spec.maintenanceRooms > 0) {
    chips.push({
      label: `${spec.maintenanceRooms} bảo trì`,
      bg: 'rgba(234, 88, 12, 0.3)',
      fg: '#fdba74',
      border: 'rgba(249, 115, 22, 0.75)',
    });
  }
  if (spec.unregisteredTamTru > 0) {
    chips.push({
      label: `${spec.unregisteredTamTru} chưa TT`,
      bg: 'rgba(217, 119, 6, 0.28)',
      fg: '#fde68a',
      border: 'rgba(245, 158, 11, 0.72)',
    });
  }

  if (chips.length === 0) {
    ctx.fillStyle = spec.occupied > 0 ? '#6ee7b7' : '#7dd3fc';
    ctx.font = `600 30px ${fontStack}`;
    ctx.fillText(
      spec.occupied > 0 ? 'Vận hành ổn định · Không sự cố' : 'Phòng trống · Sẵn sàng tiếp nhận',
      1244,
      166,
      455
    );
  } else {
    let chipX = 1244;
    const chipY = 140;
    const chipH = 52;
    ctx.font = `700 28px ${fontStack}`;
    for (const chip of chips) {
      const tw = ctx.measureText(chip.label).width;
      const cw = tw + 34;
      if (chipX + cw > 1705) break;
      drawRoundedRectPath(ctx, chipX, chipY, cw, chipH, 12);
      ctx.fillStyle = chip.bg;
      ctx.fill();
      ctx.strokeStyle = chip.border;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = chip.fg;
      ctx.fillText(chip.label, chipX + 17, chipY + chipH / 2 + 1);
      chipX += cw + 14;
    }
  }

  drawDivider(1728);

  // ── ZONE 4: Room Sequence Compass (x: 1746 → 2022) ──
  ctx.textAlign = 'center';
  const z4Mid = 1882;
  ctx.fillStyle = '#94a3b8';
  ctx.font = `700 24px ${fontStack}`;
  ctx.fillText('CHIỀU ĐÁNH SỐ', z4Mid, 78);

  ctx.fillStyle = '#38bdf8';
  ctx.font = `800 40px ${fontStack}`;
  ctx.fillText(spec.directionHint, z4Mid, 156, 268);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 16);
  tex.needsUpdate = true;

  if (dedupeCache) {
    dedupeCache.set(cacheKey, tex);
  }
  return tex;
}

/**
 * Clean architectural rooftop identification banner for Dining Halls & central functional structures.
 */
export function createFacilityRoofSignTexture(
  title: string,
  subtitle: string,
  accentHex: string,
  maxAnisotropy: number,
  dedupeCache?: Map<string, THREE.CanvasTexture>
): THREE.CanvasTexture {
  const cacheKey = `facility-roof|${title}|${subtitle}|${accentHex}`;
  if (dedupeCache) {
    const existing = dedupeCache.get(cacheKey);
    if (existing) return existing;
  }

  const W = 1024;
  const H = 144;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const fontStack = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  ctx.clearRect(0, 0, W, H);
  drawRoundedRectPath(ctx, 6, 6, W - 12, H - 12, 18);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.28)';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  ctx.save();
  drawRoundedRectPath(ctx, 6, 6, W - 12, H - 12, 18);
  ctx.clip();
  ctx.fillStyle = accentHex;
  ctx.fillRect(6, 6, 16, H - 12);
  ctx.fillRect(W - 22, 6, 16, H - 12);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `800 48px ${fontStack}`;
  ctx.fillText(title, W / 2, 56, W - 76);

  ctx.fillStyle = '#fde68a';
  ctx.font = `600 28px ${fontStack}`;
  ctx.fillText(subtitle, W / 2, 108, W - 76);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 16);
  tex.needsUpdate = true;

  if (dedupeCache) {
    dedupeCache.set(cacheKey, tex);
  }
  return tex;
}

/** Recursively disposes geometries, materials, and textures under an Object3D */
export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      geometries.add(mesh.geometry);
    }
    if (mesh.material) {
      const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      matList.forEach(mat => {
        materials.add(mat);
        const std = mat as THREE.MeshStandardMaterial;
        if (std.map) textures.add(std.map);
        if (std.normalMap) textures.add(std.normalMap);
        if (std.roughnessMap) textures.add(std.roughnessMap);
        if (std.emissiveMap) textures.add(std.emissiveMap);
      });
    }
  });

  textures.forEach(t => t.dispose());
  materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose());
}
