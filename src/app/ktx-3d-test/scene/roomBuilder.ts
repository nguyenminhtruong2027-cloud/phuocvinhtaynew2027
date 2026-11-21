import * as THREE from 'three';
import type { CampusRoomNode, RoomBedSlot } from '../types';
import {
  createPlaqueTexture,
  createRoomTileFloorTexture,
  createSoftShadowTexture,
} from './materials';

export interface BedVisualHandle {
  bed: RoomBedSlot;
  mattressMat: THREE.MeshStandardMaterial;
  blanketMat: THREE.MeshStandardMaterial;
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

export function applyBedHighlights(
  bedVisuals: Map<string, BedVisualHandle>,
  hoveredBedId: string | null,
  selectedBedId: string | null
): void {
  bedVisuals.forEach((handle, id) => {
    const tone = getBedTone(handle.bed);
    const isSelected = id === selectedBedId;
    const isHovered = id === hoveredBedId;

    handle.mattressMat.color.setHex(tone.mattress);
    handle.blanketMat.color.setHex(tone.blanket);

    if (isSelected) {
      handle.mattressMat.emissive.setHex(0x38bdf8);
      handle.mattressMat.emissiveIntensity = 0.55;
      handle.blanketMat.emissive.setHex(0x38bdf8);
      handle.blanketMat.emissiveIntensity = 0.4;
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

export function buildRoomInteriorScene(
  room: CampusRoomNode,
  beds: RoomBedSlot[],
  maxAnisotropy: number,
  castShadows: boolean
): RoomBuildResult {
  const group = new THREE.Group();
  group.name = `room-interior-${room.key}`;

  const hitTargets: THREE.Object3D[] = [];
  const bedVisuals = new Map<string, BedVisualHandle>();

  // Pair beds into 2-tier bunk units (2 beds per bunk unit)
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

  // Arrange bunks symmetrically: left wall & right wall with central corridor
  const bunksPerSide = Math.max(1, Math.ceil(totalBunks / 2));
  const BUNK_LEN = 2.02; // perpendicular to wall (along X)
  const BUNK_W = 0.98;   // parallel to wall (along Z)
  const BUNK_GAP_Z = 0.56;
  const AISLE_W = 2.35;

  const ROOM_W = BUNK_LEN * 2 + AISLE_W + 0.9; // ~7.3m wide
  const ROOM_L = Math.max(5.6, bunksPerSide * (BUNK_W + BUNK_GAP_Z) + 1.9);
  const WALL_H = 3.15;
  const WALL_T = 0.18;

  // Materials (varied roughness & metalness across surfaces)
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

  const pillowMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.9,
    metalness: 0.0,
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

  const floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_L),
    floorMat
  );
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = 0.012;
  floorPlane.receiveShadow = true;
  group.add(floorPlane);

  // ── 2. Cutaway Architectural Walls (Back wall + Left & Right walls, open front for clear viewing) ──
  // Back wall (-Z)
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_W + WALL_T * 2, WALL_H, WALL_T),
    wallMat
  );
  backWall.position.set(0, WALL_H / 2, -ROOM_L / 2 - WALL_T / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  // Back wall wainscot band
  const backWainscot = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_W, 1.05, 0.04),
    wainscotMat
  );
  backWainscot.position.set(0, 0.525, -ROOM_L / 2 + 0.02);
  group.add(backWainscot);

  // Left & Right side walls (slightly lower cutaway height on front half so camera sees beds easily)
  const sideWallGeo = new THREE.BoxGeometry(WALL_T, WALL_H * 0.82, ROOM_L);
  const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
  leftWall.position.set(-ROOM_W / 2 - WALL_T / 2, (WALL_H * 0.82) / 2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
  rightWall.position.set(ROOM_W / 2 + WALL_T / 2, (WALL_H * 0.82) / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // ── 3. Architectural Fixtures (Rear Windows, AC Unit, Entrance Threshold, Room Plaque) ──
  // Rear double windows on back wall
  [-1.9, 1.9].forEach(wx => {
    const frameGroup = new THREE.Group();
    frameGroup.position.set(wx, 1.85, -ROOM_L / 2 + 0.04);

    const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.15, 0.08), steelFrameMat);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.36, 1.0, 0.04), windowGlassMat);
    pane.position.z = 0.02;
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.04, 0.09), steelFrameMat);
    mullion.position.z = 0.02;
    frameGroup.add(frameOuter, pane, mullion);
    group.add(frameGroup);
  });

  // Wall-mounted AC Unit centered high on back wall
  const acGroup = new THREE.Group();
  acGroup.position.set(0, WALL_H - 0.52, -ROOM_L / 2 + 0.16);
  const acBox = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.34, 0.26), acBodyMat);
  const acVent = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.06, 0.04), steelFrameMat);
  acVent.position.set(0, -0.09, 0.13);
  acGroup.add(acBox, acVent);
  group.add(acGroup);

  // Room info plaque centered on back wall
  const roomSignTex = createPlaqueTexture(`${room.ktx} · ${room.day} · ${room.roomLabel}`, {
    subtext: `${room.occupied}/${room.capacity} công nhân · ${beds.length} giường`,
    bg: '#0f172a',
    border: '#38bdf8',
    width: 512,
    height: 112,
    fontSize: 32,
    maxAnisotropy,
  });
  const roomSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.58),
    new THREE.MeshStandardMaterial({ map: roomSignTex, roughness: 0.35 })
  );
  roomSign.position.set(0, 1.9, -ROOM_L / 2 + 0.05);
  group.add(roomSign);

  // Entrance doorway indicator mat + half-open door on front cutaway (+Z)
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

  // Subtle LED ceiling light bars floating above corridor
  const lightCount = Math.max(2, Math.min(4, Math.ceil(bunksPerSide / 2)));
  for (let i = 0; i < lightCount; i++) {
    const lz = -ROOM_L / 2 + 1.4 + (i * (ROOM_L - 2.8)) / Math.max(1, lightCount - 1);
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 1.15), ledMat);
    fixture.position.set(0, WALL_H + 0.05, lz);
    group.add(fixture);
  }

  // ── 4. Shared Bunk Frame Geometries ──
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
  const tagPlaqueGeo = new THREE.PlaneGeometry(0.38, 0.22);
  const shadowGeo = new THREE.PlaneGeometry(BUNK_LEN + 0.4, BUNK_W + 0.4);

  // ── 5. Build Each Composite 2-Tier Bunk Bed Unit ──
  const startZ = -((bunksPerSide - 1) * (BUNK_W + BUNK_GAP_Z)) / 2;

  bunkPairs.forEach((pair, bIdx) => {
    const isLeftSide = bIdx < bunksPerSide;
    const rowIdx = isLeftSide ? bIdx : bIdx - bunksPerSide;
    const xPos = isLeftSide
      ? -ROOM_W / 2 + BUNK_LEN / 2 + 0.24
      : ROOM_W / 2 - BUNK_LEN / 2 - 0.24;
    const zPos = startZ + rowIdx * (BUNK_W + BUNK_GAP_Z);
    const aisleSign = isLeftSide ? 1 : -1; // +1 faces +X aisle, -1 faces -X aisle

    const bunkGroup = new THREE.Group();
    bunkGroup.position.set(xPos, 0, zPos);

    // Contact shadow grounded directly on tile floor
    const shadowPad = new THREE.Mesh(shadowGeo, contactShadowMat);
    shadowPad.rotation.x = -Math.PI / 2;
    shadowPad.position.y = 0.022;
    bunkGroup.add(shadowPad);

    // 4 vertical steel posts
    const halfL = BUNK_LEN / 2 - 0.03;
    const halfW = BUNK_W / 2 - 0.03;
    [
      [-halfL, -halfW],
      [-halfL, halfW],
      [halfL, -halfW],
      [halfL, halfW],
    ].forEach(([px, pz]) => {
      const post = new THREE.Mesh(postGeo, steelFrameMat);
      post.position.set(px, BUNK_H / 2, pz);
      post.castShadow = castShadows;
      bunkGroup.add(post);
    });

    // Horizontal steel rails & wooden deck slats for both tiers
    [LOWER_Y, UPPER_Y].forEach(ty => {
      [-halfW, halfW].forEach(rz => {
        const lRail = new THREE.Mesh(longRailGeo, steelFrameMat);
        lRail.position.set(0, ty, rz);
        bunkGroup.add(lRail);
      });
      [-halfL, halfL].forEach(rx => {
        const sRail = new THREE.Mesh(shortRailGeo, steelFrameMat);
        sRail.position.set(rx, ty, 0);
        bunkGroup.add(sRail);
      });
      const slats = new THREE.Mesh(slatBoardGeo, slatWoodMat);
      slats.position.set(0, ty + 0.015, 0);
      bunkGroup.add(slats);
    });

    // Upper bunk safety guardrails (both front & rear edges)
    [-halfW, halfW].forEach(gz => {
      const guard = new THREE.Mesh(guardRailGeo, steelAccentMat);
      guard.position.set(-aisleSign * 0.14, UPPER_Y + 0.34, gz);
      bunkGroup.add(guard);

      [-0.45, 0.25].forEach(gx => {
        const gp = new THREE.Mesh(guardPostGeo, steelAccentMat);
        gp.position.set(gx - aisleSign * 0.12, UPPER_Y + 0.18, gz);
        bunkGroup.add(gp);
      });
    });

    // Front access ladder on the aisle-facing side
    const ladderX = aisleSign * (halfL - 0.26);
    const ladderZ = halfW + 0.025;
    [-0.17, 0.17].forEach(lxOff => {
      const lRail = new THREE.Mesh(ladderRailGeo, steelAccentMat);
      lRail.position.set(ladderX + lxOff, 0.88, ladderZ);
      bunkGroup.add(lRail);
    });
    for (let r = 0; r < 4; r++) {
      const rung = new THREE.Mesh(ladderRungGeo, steelAccentMat);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(ladderX, 0.38 + r * 0.34, ladderZ);
      bunkGroup.add(rung);
    }

    // Build clickable mattress + blanket + pillow + label for Bottom and Top slots
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

      const slotGroup = new THREE.Group();
      slotGroup.position.set(0, tierY + 0.1, 0);

      const mattress = new THREE.Mesh(mattressGeo, mattressMat);
      mattress.castShadow = castShadows;
      mattress.receiveShadow = true;
      mattress.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(mattress);
      hitTargets.push(mattress);

      // Folded blanket toward the foot (aisle side)
      const blanket = new THREE.Mesh(blanketGeo, blanketMat);
      blanket.position.set(aisleSign * 0.28, 0.08, 0);
      blanket.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(blanket);
      hitTargets.push(blanket);

      // Pillow toward the wall head
      const pillow = new THREE.Mesh(pillowGeo, pillowMat);
      pillow.position.set(-aisleSign * (BUNK_LEN / 2 - 0.34), 0.11, 0);
      pillow.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(pillow);
      hitTargets.push(pillow);

      // Crisp Bed Number tag facing the central corridor
      const tagTex = createPlaqueTexture(slot.bedLabel, {
        bg: '#0f172a',
        border:
          slot.status === 'empty'
            ? '#10b981'
            : slot.status === 'maintenance'
              ? '#f43f5e'
              : slot.status === 'checkout_pending'
                ? '#f59e0b'
                : '#38bdf8',
        width: 128,
        height: 72,
        fontSize: 36,
        maxAnisotropy,
      });
      const tag = new THREE.Mesh(
        tagPlaqueGeo,
        new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.35 })
      );
      tag.position.set(aisleSign * (BUNK_LEN / 2 + 0.02), 0.02, 0);
      tag.rotation.y = aisleSign > 0 ? Math.PI / 2 : -Math.PI / 2;
      tag.userData = { type: 'bed', bedId: slot.id };
      slotGroup.add(tag);
      hitTargets.push(tag);

      bunkGroup.add(slotGroup);

      bedVisuals.set(slot.id, {
        bed: slot,
        mattressMat,
        blanketMat,
        worldCenter: new THREE.Vector3(xPos, tierY + 0.18, zPos),
      });
    };

    buildBedSlot(pair.bottom, LOWER_Y);
    buildBedSlot(pair.top, UPPER_Y);

    group.add(bunkGroup);
  });

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
