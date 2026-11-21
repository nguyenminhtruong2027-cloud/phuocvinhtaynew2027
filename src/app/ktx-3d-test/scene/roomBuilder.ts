import * as THREE from 'three';
import type { BedTierFilter, CampusRoomNode, RoomBedSlot } from '../types';
import {
  createPlaqueTexture,
  createRoomTileFloorTexture,
  createSoftShadowTexture,
} from './materials';

export interface BedVisualHandle {
  bed: RoomBedSlot;
  mattressMat: THREE.MeshStandardMaterial;
  blanketMat: THREE.MeshStandardMaterial;
  pillowMat: THREE.MeshStandardMaterial;
  tagMat: THREE.MeshStandardMaterial;
  hitMeshes: THREE.Object3D[];
  worldCenter: THREE.Vector3;
}

export interface RoomBuildResult {
  group: THREE.Group;
  hitTargets: THREE.Object3D[];
  bedVisuals: Map<string, BedVisualHandle>;
  boundsCenter: THREE.Vector3;
  boundsRadius: number;
}

const BED_PALETTE = {
  male: { mattress: 0x3b82f6, blanket: 0x1d4ed8, emissive: 0x1e3a8a },
  female: { mattress: 0xec4899, blanket: 0xbe185d, emissive: 0x831843 },
  occupiedUnknown: { mattress: 0x6366f1, blanket: 0x4338ca, emissive: 0x312e81 },
  empty: { mattress: 0x10b981, blanket: 0x059669, emissive: 0x064e3b },
  checkout_pending: { mattress: 0xf59e0b, blanket: 0xd97706, emissive: 0x78350f },
  maintenance: { mattress: 0xf43f5e, blanket: 0xbe123c, emissive: 0x881337 },
};

function getBedTone(bed: RoomBedSlot) {
  if (bed.status === 'maintenance') return BED_PALETTE.maintenance;
  if (bed.status === 'checkout_pending') return BED_PALETTE.checkout_pending;
  if (bed.status === 'empty') return BED_PALETTE.empty;
  if (bed.gender === 'female') return BED_PALETTE.female;
  if (bed.gender === 'male') return BED_PALETTE.male;
  return BED_PALETTE.occupiedUnknown;
}

/** Formats "Nguyễn Văn Dũng" -> "N.V.Dũng" for crisp compact bed tags */
function formatShortResidentName(fullName: string | null): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 10);
  const last = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map(p => p.charAt(0).toUpperCase())
    .join('.');
  return `${initials}.${last}`.slice(0, 14);
}

export function applyBedHighlights(
  bedVisuals: Map<string, BedVisualHandle>,
  hoveredBedId: string | null,
  selectedBedId: string | null,
  tierFilter: BedTierFilter = 'all'
): void {
  bedVisuals.forEach((handle, id) => {
    const tone = getBedTone(handle.bed);
    const isSelected = id === selectedBedId;
    const isHovered = id === hoveredBedId;
    const isDimmedByTier =
      (tierFilter === 'bottom' && handle.bed.tier === 'top') ||
      (tierFilter === 'top' && handle.bed.tier === 'bottom');

    // Dim non-matching tier cleanly & let raycast pass straight through dimmed upper bunks!
    const targetOpacity = isDimmedByTier ? (handle.bed.tier === 'top' ? 0.12 : 0.18) : 1;
    const isGhost = isDimmedByTier;

    handle.mattressMat.color.setHex(tone.mattress);
    handle.blanketMat.color.setHex(tone.blanket);

    [handle.mattressMat, handle.blanketMat, handle.pillowMat, handle.tagMat].forEach(mat => {
      mat.transparent = isGhost;
      mat.opacity = targetOpacity;
      mat.depthWrite = !isGhost;
    });

    handle.hitMeshes.forEach(mesh => {
      // Layer 0 = active raycastable; Layer 2 = pass-through while dimmed
      if (isGhost) mesh.layers.set(2);
      else mesh.layers.set(0);
    });

    if (isGhost) {
      handle.mattressMat.emissive.setHex(0x000000);
      handle.mattressMat.emissiveIntensity = 0;
      handle.blanketMat.emissive.setHex(0x000000);
      handle.blanketMat.emissiveIntensity = 0;
    } else if (isSelected) {
      handle.mattressMat.emissive.setHex(0x38bdf8);
      handle.mattressMat.emissiveIntensity = 0.58;
      handle.blanketMat.emissive.setHex(0x38bdf8);
      handle.blanketMat.emissiveIntensity = 0.42;
    } else if (isHovered) {
      handle.mattressMat.emissive.setHex(0x7dd3fc);
      handle.mattressMat.emissiveIntensity = 0.34;
      handle.blanketMat.emissive.setHex(0x38bdf8);
      handle.blanketMat.emissiveIntensity = 0.25;
    } else {
      handle.mattressMat.emissive.setHex(tone.emissive);
      handle.mattressMat.emissiveIntensity = 0.14;
      handle.blanketMat.emissive.setHex(0x000000);
      handle.blanketMat.emissiveIntensity = 0;
    }
  });
}

function addInstancedBatch(
  parent: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  transforms: { pos: [number, number, number]; rot?: [number, number, number] }[],
  castShadow = false
) {
  if (transforms.length === 0) return;
  const inst = new THREE.InstancedMesh(geo, mat, transforms.length);
  inst.castShadow = castShadow;
  const dummy = new THREE.Object3D();
  transforms.forEach((t, idx) => {
    dummy.position.set(t.pos[0], t.pos[1], t.pos[2]);
    if (t.rot) dummy.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
    else dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    inst.setMatrixAt(idx, dummy.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  parent.add(inst);
}

export function buildRoomInteriorScene(
  room: CampusRoomNode,
  beds: RoomBedSlot[],
  maxAnisotropy: number,
  castShadows: boolean,
  showBedNames = true
): RoomBuildResult {
  const group = new THREE.Group();
  group.name = `room-interior-${room.key}`;

  const hitTargets: THREE.Object3D[] = [];
  const bedVisuals = new Map<string, BedVisualHandle>();
  const plaqueTexCache = new Map<string, THREE.CanvasTexture>();

  // Pair beds into 2-tier bunk units
  const bunkPairs: { bottom: RoomBedSlot | null; top: RoomBedSlot | null }[] = [];
  const maxBunkIndex = beds.reduce((m, b) => Math.max(m, b.bunkIndex), -1);
  const totalBunks = Math.max(1, maxBunkIndex + 1);
  for (let i = 0; i < totalBunks; i++) {
    bunkPairs.push({ bottom: null, top: null });
  }
  beds.forEach(b => {
    const pair = bunkPairs[b.bunkIndex];
    if (!pair) return;
    if (b.tier === 'bottom') pair.bottom = b;
    else pair.top = b;
  });

  const bunksPerSide = Math.max(1, Math.ceil(totalBunks / 2));
  const BUNK_LEN = 2.02;
  const BUNK_W = 0.98;
  const BUNK_GAP_Z = 0.56;
  const AISLE_W = 2.35;

  const ROOM_W = BUNK_LEN * 2 + AISLE_W + 0.9;
  const ROOM_L = Math.max(5.6, bunksPerSide * (BUNK_W + BUNK_GAP_Z) + 1.9);
  const WALL_H = 3.15;
  const WALL_T = 0.18;

  // Materials
  const floorTex = createRoomTileFloorTexture(maxAnisotropy);
  floorTex.repeat.set(Math.max(4, Math.round(ROOM_W)), Math.max(4, Math.round(ROOM_L)));
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.42,
    metalness: 0.08,
  });

  const slabEdgeMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.82,
    metalness: 0.1,
  });

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.88,
    metalness: 0.02,
  });

  const wainscotMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.65,
    metalness: 0.05,
  });

  const steelFrameMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.3,
    metalness: 0.78,
  });

  const steelAccentMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.26,
    metalness: 0.82,
  });

  const slatWoodMat = new THREE.MeshStandardMaterial({
    color: 0x926c48,
    roughness: 0.82,
    metalness: 0.02,
  });

  const windowGlassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.12,
    metalness: 0.25,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });

  const doorWoodMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.58,
    metalness: 0.16,
  });

  const acBodyMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.32,
    metalness: 0.18,
  });

  const lockerMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.42,
    metalness: 0.55,
  });

  const fanGuardMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.36,
    metalness: 0.65,
  });

  const ledMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });

  const shadowTex = createSoftShadowTexture();
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  // ── 1. Floor Slab + Ceramic Tile Surface ──
  const baseSlab = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_W + 0.5, 0.24, ROOM_L + 0.5),
    slabEdgeMat
  );
  baseSlab.position.set(0, -0.12, 0);
  baseSlab.receiveShadow = true;
  group.add(baseSlab);

  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_L), floorMat);
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = 0.012;
  floorPlane.receiveShadow = true;
  group.add(floorPlane);

  // ── 2. Cutaway Architectural Walls ──
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_W + WALL_T * 2, WALL_H, WALL_T),
    wallMat
  );
  backWall.position.set(0, WALL_H / 2, -ROOM_L / 2 - WALL_T / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const backWainscot = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 1.05, 0.04), wainscotMat);
  backWainscot.position.set(0, 0.525, -ROOM_L / 2 + 0.02);
  group.add(backWainscot);

  const sideWallGeo = new THREE.BoxGeometry(WALL_T, WALL_H * 0.82, ROOM_L);
  const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
  leftWall.position.set(-ROOM_W / 2 - WALL_T / 2, (WALL_H * 0.82) / 2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
  rightWall.position.set(ROOM_W / 2 + WALL_T / 2, (WALL_H * 0.82) / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // ── 3. Real Equipment Sync from `facilities` (ACs, LED Tubes, Wall Fans, Lockers) ──
  const fac = room.facility;
  const acCount = fac ? Math.min(3, Math.max(0, Number(fac.dieu_hoa ?? 0))) : 1;
  const fanCount = fac ? Math.min(4, Math.max(0, Number(fac.quat ?? 0))) : 0;
  const lockerCount = fac ? Math.min(4, Math.max(0, Number(fac.tu ?? 0))) : 0;
  const rawLights = fac ? Number(fac.bong_tuyp ?? 0) : 0;
  const lightCount =
    rawLights > 0 ? Math.min(6, rawLights) : Math.max(2, Math.min(4, Math.ceil(bunksPerSide / 2)));

  // Rear windows
  [-2.0, 2.0].forEach(wx => {
    const frameGroup = new THREE.Group();
    frameGroup.position.set(wx, 1.85, -ROOM_L / 2 + 0.04);
    const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.12, 0.08), steelFrameMat);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.98, 0.04), windowGlassMat);
    pane.position.z = 0.02;
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.02, 0.09), steelFrameMat);
    mullion.position.z = 0.02;
    frameGroup.add(frameOuter, pane, mullion);
    group.add(frameGroup);
  });

  // Real AC units spaced along upper back wall
  if (acCount > 0) {
    const acBoxGeo = new THREE.BoxGeometry(1.18, 0.32, 0.24);
    const acVentGeo = new THREE.BoxGeometry(1.02, 0.06, 0.04);
    const acPositions =
      acCount === 1 ? [0] : acCount === 2 ? [-1.85, 1.85] : [-2.2, 0, 2.2];
    acPositions.forEach(ax => {
      const acGroup = new THREE.Group();
      acGroup.position.set(ax, WALL_H - 0.46, -ROOM_L / 2 + 0.15);
      const acBox = new THREE.Mesh(acBoxGeo, acBodyMat);
      const acVent = new THREE.Mesh(acVentGeo, steelFrameMat);
      acVent.position.set(0, -0.09, 0.12);
      acGroup.add(acBox, acVent);
      group.add(acGroup);
    });
  }

  // Real wall-mounted electric fans along left & right walls
  if (fanCount > 0) {
    const fanDiskGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12);
    const fanMountGeo = new THREE.BoxGeometry(0.16, 0.14, 0.14);
    for (let i = 0; i < fanCount; i++) {
      const onLeft = i % 2 === 0;
      const tierIdx = Math.floor(i / 2);
      const zOff =
        fanCount <= 2 ? 0 : tierIdx === 0 ? -ROOM_L * 0.24 : ROOM_L * 0.24;
      const fanGroup = new THREE.Group();
      fanGroup.position.set(
        onLeft ? -ROOM_W / 2 + 0.14 : ROOM_W / 2 - 0.14,
        2.15,
        zOff
      );
      const mount = new THREE.Mesh(fanMountGeo, steelFrameMat);
      const head = new THREE.Mesh(fanDiskGeo, fanGuardMat);
      head.rotation.z = Math.PI / 2;
      head.position.x = onLeft ? 0.12 : -0.12;
      fanGroup.add(mount, head);
      group.add(fanGroup);
    }
  }

  // Real steel locker cabinets along back wall aisle center if `tu > 0`
  if (lockerCount > 0) {
    const lockerW = 0.46;
    const lockerH = 1.38;
    const lockerD = 0.42;
    const lockerGeo = new THREE.BoxGeometry(lockerW, lockerH, lockerD);
    const startLX = -((lockerCount - 1) * (lockerW + 0.06)) / 2;
    for (let i = 0; i < lockerCount; i++) {
      const lMesh = new THREE.Mesh(lockerGeo, lockerMat);
      lMesh.position.set(startLX + i * (lockerW + 0.06), lockerH / 2 + 0.015, -ROOM_L / 2 + 0.26);
      lMesh.castShadow = castShadows;
      group.add(lMesh);
    }
  }

  // Room info plaque centered on back wall
  const roomSignTex = createPlaqueTexture(
    `${room.ktx} · ${room.day} · ${room.roomLabel}`,
    {
      subtext: `${room.occupied}/${room.capacity} công nhân · ${beds.length} giường`,
      bg: '#0f172a',
      border: '#38bdf8',
      width: 512,
      height: 112,
      fontSize: 32,
      maxAnisotropy,
    },
    plaqueTexCache
  );
  const roomSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 0.56),
    new THREE.MeshStandardMaterial({ map: roomSignTex, roughness: 0.35 })
  );
  roomSign.position.set(0, 1.92, -ROOM_L / 2 + 0.05);
  group.add(roomSign);

  // Entrance doorway threshold & open door
  const entryThreshold = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.03, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.8 })
  );
  entryThreshold.position.set(0, 0.02, ROOM_L / 2 - 0.12);
  group.add(entryThreshold);

  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.05, 0.92), doorWoodMat);
  doorLeaf.position.set(-0.74, 1.025, ROOM_L / 2 + 0.36);
  doorLeaf.rotation.y = 0.25;
  group.add(doorLeaf);

  // Real LED ceiling tubes via InstancedMesh
  const ledGeo = new THREE.BoxGeometry(0.14, 0.05, 1.05);
  const ledTransforms: { pos: [number, number, number] }[] = [];
  for (let i = 0; i < lightCount; i++) {
    const lz =
      lightCount === 1
        ? 0
        : -ROOM_L / 2 + 1.3 + (i * (ROOM_L - 2.6)) / (lightCount - 1);
    ledTransforms.push({ pos: [0, WALL_H + 0.05, lz] });
  }
  addInstancedBatch(group, ledGeo, ledMat, ledTransforms);

  // ── 4. Shared Bunk Geometries & Instanced Structural Collectors ──
  const BUNK_H = 1.98;
  const LOWER_Y = 0.42;
  const UPPER_Y = 1.44;
  const POST_R = 0.032;

  const postGeo = new THREE.CylinderGeometry(POST_R, POST_R, BUNK_H, 8);
  const longRailGeo = new THREE.BoxGeometry(BUNK_LEN, 0.055, 0.038);
  const shortRailGeo = new THREE.BoxGeometry(0.038, 0.055, BUNK_W);
  const slatBoardGeo = new THREE.BoxGeometry(BUNK_LEN - 0.08, 0.03, BUNK_W - 0.08);
  const guardRailGeo = new THREE.BoxGeometry(BUNK_LEN - 0.52, 0.032, 0.028);
  const guardPostGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6);
  const ladderRailGeo = new THREE.CylinderGeometry(0.018, 0.018, 1.38, 6);
  const ladderRungGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6);
  const mattressGeo = new THREE.BoxGeometry(BUNK_LEN - 0.14, 0.14, BUNK_W - 0.12);
  const blanketGeo = new THREE.BoxGeometry((BUNK_LEN - 0.14) * 0.62, 0.04, BUNK_W - 0.08);
  const pillowGeo = new THREE.BoxGeometry(0.36, 0.11, BUNK_W - 0.32);
  const tagPlaqueGeo = showBedNames
    ? new THREE.PlaneGeometry(0.76, 0.34)
    : new THREE.PlaneGeometry(0.42, 0.24);
  const shadowGeo = new THREE.PlaneGeometry(BUNK_LEN + 0.4, BUNK_W + 0.4);

  const postInst: { pos: [number, number, number] }[] = [];
  const longRailInst: { pos: [number, number, number] }[] = [];
  const shortRailInst: { pos: [number, number, number] }[] = [];
  const slatInst: { pos: [number, number, number] }[] = [];
  const guardRailInst: { pos: [number, number, number] }[] = [];
  const guardPostInst: { pos: [number, number, number] }[] = [];
  const ladderRailInst: { pos: [number, number, number] }[] = [];
  const ladderRungInst: { pos: [number, number, number]; rot: [number, number, number] }[] = [];
  const shadowInst: { pos: [number, number, number]; rot: [number, number, number] }[] = [];

  // ── 5. Populate Bunks & Interactive Bed Slots ──
  const startZ = -((bunksPerSide - 1) * (BUNK_W + BUNK_GAP_Z)) / 2;
  const halfL = BUNK_LEN / 2 - 0.03;
  const halfW = BUNK_W / 2 - 0.03;

  bunkPairs.forEach((pair, bIdx) => {
    const isLeftSide = bIdx < bunksPerSide;
    const rowIdx = isLeftSide ? bIdx : bIdx - bunksPerSide;
    const xPos = isLeftSide
      ? -ROOM_W / 2 + BUNK_LEN / 2 + 0.24
      : ROOM_W / 2 - BUNK_LEN / 2 - 0.24;
    const zPos = startZ + rowIdx * (BUNK_W + BUNK_GAP_Z);
    const aisleSign = isLeftSide ? 1 : -1;

    shadowInst.push({ pos: [xPos, 0.022, zPos], rot: [-Math.PI / 2, 0, 0] });

    [
      [-halfL, -halfW],
      [-halfL, halfW],
      [halfL, -halfW],
      [halfL, halfW],
    ].forEach(([px, pz]) => {
      postInst.push({ pos: [xPos + px, BUNK_H / 2, zPos + pz] });
    });

    [LOWER_Y, UPPER_Y].forEach(ty => {
      [-halfW, halfW].forEach(rz => {
        longRailInst.push({ pos: [xPos, ty, zPos + rz] });
      });
      [-halfL, halfL].forEach(rx => {
        shortRailInst.push({ pos: [xPos + rx, ty, zPos] });
      });
      slatInst.push({ pos: [xPos, ty + 0.015, zPos] });
    });

    [-halfW, halfW].forEach(gz => {
      guardRailInst.push({ pos: [xPos - aisleSign * 0.14, UPPER_Y + 0.34, zPos + gz] });
      [-0.45, 0.25].forEach(gx => {
        guardPostInst.push({ pos: [xPos + gx - aisleSign * 0.12, UPPER_Y + 0.18, zPos + gz] });
      });
    });

    const ladderX = xPos + aisleSign * (halfL - 0.26);
    const ladderZ = zPos + halfW + 0.025;
    [-0.17, 0.17].forEach(lxOff => {
      ladderRailInst.push({ pos: [ladderX + lxOff, 0.88, ladderZ] });
    });
    for (let r = 0; r < 4; r++) {
      ladderRungInst.push({
        pos: [ladderX, 0.38 + r * 0.34, ladderZ],
        rot: [0, 0, Math.PI / 2],
      });
    }

    const buildBedSlot = (slot: RoomBedSlot | null, tierY: number) => {
      if (!slot) return;
      const tone = getBedTone(slot);

      const mattressMat = new THREE.MeshStandardMaterial({
        color: tone.mattress,
        roughness: 0.88,
        metalness: 0.0,
        emissive: tone.emissive,
        emissiveIntensity: 0.14,
      });

      const blanketMat = new THREE.MeshStandardMaterial({
        color: tone.blanket,
        roughness: 0.92,
        metalness: 0.0,
      });

      const pillowMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.9,
        metalness: 0.0,
      });

      const slotGroup = new THREE.Group();
      slotGroup.position.set(xPos, tierY + 0.1, zPos);

      const mattress = new THREE.Mesh(mattressGeo, mattressMat);
      mattress.castShadow = castShadows;
      mattress.receiveShadow = true;
      mattress.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(mattress);

      const blanket = new THREE.Mesh(blanketGeo, blanketMat);
      blanket.position.set(aisleSign * 0.28, 0.08, 0);
      blanket.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(blanket);

      const pillow = new THREE.Mesh(pillowGeo, pillowMat);
      pillow.position.set(-aisleSign * (BUNK_LEN / 2 - 0.34), 0.11, 0);
      pillow.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(pillow);

      const shortName = showBedNames
        ? slot.hoVaTen
          ? formatShortResidentName(slot.hoVaTen)
          : slot.status === 'maintenance'
            ? 'Sửa chữa'
            : slot.status === 'checkout_pending'
              ? 'Chờ ra'
              : 'Trống'
        : undefined;

      const tagTex = createPlaqueTexture(
        slot.bedLabel,
        {
          subtext: shortName,
          bg: '#0f172a',
          border:
            slot.status === 'empty'
              ? '#10b981'
              : slot.status === 'maintenance'
                ? '#f43f5e'
                : slot.status === 'checkout_pending'
                  ? '#f59e0b'
                  : '#38bdf8',
          width: showBedNames ? 224 : 128,
          height: showBedNames ? 100 : 72,
          fontSize: showBedNames ? 32 : 36,
          maxAnisotropy,
        },
        plaqueTexCache
      );
      const tagMat = new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.35 });
      const tag = new THREE.Mesh(tagPlaqueGeo, tagMat);
      tag.position.set(aisleSign * (BUNK_LEN / 2 + 0.025), 0.04, 0);
      tag.rotation.y = aisleSign > 0 ? Math.PI / 2 : -Math.PI / 2;
      tag.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(tag);

      group.add(slotGroup);

      const slotHitMeshes = [mattress, blanket, pillow, tag];
      hitTargets.push(...slotHitMeshes);

      bedVisuals.set(slot.id, {
        bed: slot,
        mattressMat,
        blanketMat,
        pillowMat,
        tagMat,
        hitMeshes: slotHitMeshes,
        worldCenter: new THREE.Vector3(xPos, tierY + 0.2, zPos),
      });
    };

    buildBedSlot(pair.bottom, LOWER_Y);
    buildBedSlot(pair.top, UPPER_Y);
  });

  // ── 6. Commit Batched Structural InstancedMeshes ──
  addInstancedBatch(group, shadowGeo, contactShadowMat, shadowInst, false);
  addInstancedBatch(group, postGeo, steelFrameMat, postInst, castShadows);
  addInstancedBatch(group, longRailGeo, steelFrameMat, longRailInst, false);
  addInstancedBatch(group, shortRailGeo, steelFrameMat, shortRailInst, false);
  addInstancedBatch(group, slatBoardGeo, slatWoodMat, slatInst, false);
  addInstancedBatch(group, guardRailGeo, steelAccentMat, guardRailInst, false);
  addInstancedBatch(group, guardPostGeo, steelAccentMat, guardPostInst, false);
  addInstancedBatch(group, ladderRailGeo, steelAccentMat, ladderRailInst, false);
  addInstancedBatch(group, ladderRungGeo, steelAccentMat, ladderRungInst, false);

  const boundsRadius = Math.max(6.2, Math.hypot(ROOM_W / 2, ROOM_L / 2) * 1.05);
  const boundsCenter = new THREE.Vector3(0, 1.15, 0);

  return {
    group,
    hitTargets,
    bedVisuals,
    boundsCenter,
    boundsRadius,
  };
}
