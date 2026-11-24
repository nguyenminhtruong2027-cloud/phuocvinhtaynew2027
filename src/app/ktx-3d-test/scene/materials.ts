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
