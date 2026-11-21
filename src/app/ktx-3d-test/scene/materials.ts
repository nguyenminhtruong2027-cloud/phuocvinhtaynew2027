import * as THREE from 'three';

/**
 * Procedural PBR textures & crisp canvas signage for the 3D KTX digital twin.
 * Zero external image/model files — 100% generated in memory with proper SRGBColorSpace.
 */

export function createGroundTileTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Soft warm-cool concrete yard base
  ctx.fillStyle = '#1b2436';
  ctx.fillRect(0, 0, size, size);

  // Subtle speckle noise
  for (let i = 0; i < 1600; i++) {
    const x = (i * 73) % size;
    const y = (i * 197 + Math.floor(i / 7) * 31) % size;
    const alpha = (i % 5) * 0.014 + 0.015;
    ctx.fillStyle = i % 2 === 0 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.4})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Architectural paving grid lines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
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

export function createRoadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#232c3d';
  ctx.fillRect(0, 0, 256, 512);

  // Road edges
  ctx.fillStyle = 'rgba(226, 232, 240, 0.28)';
  ctx.fillRect(8, 0, 4, 512);
  ctx.fillRect(244, 0, 4, 512);

  // Dashed center line
  ctx.fillStyle = 'rgba(250, 204, 21, 0.45)';
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

export function createPlaqueTexture(
  text: string,
  options: {
    bg?: string;
    border?: string;
    fg?: string;
    subtext?: string;
    width?: number;
    height?: number;
    fontSize?: number;
    maxAnisotropy?: number;
  } = {}
): THREE.CanvasTexture {
  const width = options.width ?? 256;
  const height = options.height ?? 96;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = options.bg ?? '#0f172a';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = options.border ?? '#38bdf8';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  ctx.fillStyle = options.fg ?? '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const mainFontSize = options.fontSize ?? (options.subtext ? 34 : 42);
  ctx.font = `700 ${mainFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillText(text, width / 2, options.subtext ? height * 0.39 : height / 2, width - 24);

  if (options.subtext) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 ${Math.round(mainFontSize * 0.54)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(options.subtext, width / 2, height * 0.74, width - 24);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(options.maxAnisotropy ?? 4, 8);
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
