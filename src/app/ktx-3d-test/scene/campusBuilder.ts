import * as THREE from 'three';
import type {
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  SceneTheme,
  UnitXRayFilter,
} from '../types';
import {
  createGroundTileTexture,
  createPlaqueTexture,
  createRoadTexture,
} from './materials';

export interface RoomVisualHandle {
  room: CampusRoomNode;
  bodyMesh: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  stripMat: THREE.MeshStandardMaterial;
  worldCenter: THREE.Vector3;
}

export interface CampusBuildResult {
  group: THREE.Group;
  hitTargets: THREE.Object3D[];
  roomVisuals: Map<string, RoomVisualHandle>;
  boundsCenter: THREE.Vector3;
  boundsRadius: number;
}

const PALETTE = {
  empty: 0x64748b,
  available: 0x10b981,
  full: 0xf59e0b,
  overloaded: 0xf43f5e,
  male: 0x3b82f6,
  female: 0xec4899,
  mixed: 0xf59e0b,
  xrayMatch: 0x38bdf8,
  xrayStrong: 0x0ea5e9,
  ghostDark: 0x1e293b,
  ghostLight: 0x94a3b8,
};

export function getRoomUnitMatchCount(
  room: CampusRoomNode,
  unitFilter: UnitXRayFilter | null
): number {
  if (!unitFilter) return 0;
  if (unitFilter.type === 'platoon') {
    return room.platoonCounts[unitFilter.value] || 0;
  }
  return room.unitCounts[unitFilter.value] || 0;
}

export function resolveRoomColor(
  room: CampusRoomNode,
  mode: CampusColorMode,
  unitFilter: UnitXRayFilter | null,
  theme: SceneTheme
): { color: number; emissive: number; emissiveIntensity: number; opacity: number } {
  const isOverloaded = room.occupied > room.capacity;
  const isFull = room.occupied >= room.capacity && room.capacity > 0;
  const isEmpty = room.occupied === 0;
  const ghostColor = theme === 'light' ? PALETTE.ghostLight : PALETTE.ghostDark;
  const ghostOpacity = theme === 'light' ? 0.28 : 0.22;

  if (mode === 'unit_xray' && unitFilter) {
    const matchCount = getRoomUnitMatchCount(room, unitFilter);
    if (matchCount > 0) {
      const ratio = room.occupied > 0 ? matchCount / room.occupied : 1;
      return {
        color: ratio >= 0.5 ? PALETTE.xrayStrong : PALETTE.xrayMatch,
        emissive: 0x0284c7,
        emissiveIntensity: 0.22 + ratio * 0.28,
        opacity: 1,
      };
    }
    return { color: ghostColor, emissive: 0x000000, emissiveIntensity: 0, opacity: ghostOpacity };
  }

  if (mode === 'vacant_only') {
    if (room.vacant > 0) {
      return {
        color: isEmpty ? 0x38bdf8 : PALETTE.available,
        emissive: isEmpty ? 0x0ea5e9 : 0x059669,
        emissiveIntensity: 0.26,
        opacity: 1,
      };
    }
    return { color: ghostColor, emissive: 0x000000, emissiveIntensity: 0, opacity: ghostOpacity };
  }

  if (mode === 'overloaded_only') {
    if (isOverloaded) {
      return {
        color: PALETTE.overloaded,
        emissive: 0xe11d48,
        emissiveIntensity: 0.42,
        opacity: 1,
      };
    }
    return { color: ghostColor, emissive: 0x000000, emissiveIntensity: 0, opacity: ghostOpacity };
  }

  if (mode === 'gender') {
    const g = room.genderInfo.gender;
    if (g === 'female') {
      return { color: PALETTE.female, emissive: 0x9d174d, emissiveIntensity: 0.14, opacity: 1 };
    }
    if (g === 'male') {
      return { color: PALETTE.male, emissive: 0x1d4ed8, emissiveIntensity: 0.14, opacity: 1 };
    }
    if (g === 'mixed') {
      return { color: PALETTE.mixed, emissive: 0xb45309, emissiveIntensity: 0.16, opacity: 1 };
    }
    return { color: PALETTE.empty, emissive: 0x000000, emissiveIntensity: 0, opacity: 0.85 };
  }

  // Default: occupancy heatmap
  if (isOverloaded) {
    return { color: PALETTE.overloaded, emissive: 0xbe123c, emissiveIntensity: 0.3, opacity: 1 };
  }
  if (isFull) {
    return { color: PALETTE.full, emissive: 0xb45309, emissiveIntensity: 0.14, opacity: 1 };
  }
  if (isEmpty) {
    return { color: PALETTE.empty, emissive: 0x000000, emissiveIntensity: 0, opacity: 0.9 };
  }
  return { color: PALETTE.available, emissive: 0x047857, emissiveIntensity: 0.14, opacity: 1 };
}

export function applyCampusColorMode(
  roomVisuals: Map<string, RoomVisualHandle>,
  mode: CampusColorMode,
  hoveredKey: string | null,
  focusedKey: string | null,
  unitFilter: UnitXRayFilter | null,
  theme: SceneTheme
): void {
  roomVisuals.forEach((handle, key) => {
    const spec = resolveRoomColor(handle.room, mode, unitFilter, theme);
    const isHovered = key === hoveredKey;
    const isFocused = key === focusedKey;

    handle.bodyMat.color.setHex(spec.color);
    handle.bodyMat.opacity = isHovered || isFocused ? 1 : spec.opacity;
    handle.bodyMat.transparent = !isHovered && !isFocused && spec.opacity < 0.99;
    handle.bodyMat.depthWrite = isHovered || isFocused || spec.opacity >= 0.99;

    if (isFocused) {
      handle.bodyMat.emissive.setHex(0x38bdf8);
      handle.bodyMat.emissiveIntensity = 0.65;
    } else if (isHovered) {
      handle.bodyMat.emissive.setHex(0x7dd3fc);
      handle.bodyMat.emissiveIntensity = 0.48;
    } else {
      handle.bodyMat.emissive.setHex(spec.emissive);
      handle.bodyMat.emissiveIntensity = spec.emissiveIntensity;
    }

    handle.stripMat.color.setHex(isFocused || isHovered ? 0x7dd3fc : spec.color);
    handle.stripMat.emissive.setHex(isFocused || isHovered ? 0x38bdf8 : spec.color);
    handle.stripMat.emissiveIntensity =
      isFocused || isHovered ? 0.9 : spec.opacity < 0.5 ? 0.05 : 0.45;
  });
}

export function buildCampusScene(
  ktxNodes: CampusKtxNode[],
  colorMode: CampusColorMode,
  unitFilter: UnitXRayFilter | null,
  theme: SceneTheme,
  maxAnisotropy: number,
  castShadows: boolean
): CampusBuildResult {
  const group = new THREE.Group();
  group.name = 'ktx-campus-root';

  const hitTargets: THREE.Object3D[] = [];
  const roomVisuals = new Map<string, RoomVisualHandle>();
  const plaqueTexCache = new Map<string, THREE.CanvasTexture>();
  const roomPlaqueMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const isLight = theme === 'light';

  // Dimensions
  const ROOM_W = 2.6;
  const ROOM_D = 3.2;
  const ROOM_H = 2.35;
  const ROOM_GAP = 0.24;
  const CORRIDOR_D = 1.15;
  const BUILDING_GAP_Z = 5.6;
  const KTX_PAD_X = 3.0;
  const KTX_PAD_Z = 2.8;
  const KTX_ZONE_GAP_X = 7.5;

  // Shared materials adapted cleanly for Daylight vs Night theme
  const concretePlinthMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xcbd5e1 : 0x263246,
    roughness: 0.88,
    metalness: 0.05,
  });
  const buildingDeckMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x94a3b8 : 0x334155,
    roughness: 0.82,
    metalness: 0.08,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x334155 : 0x1e293b,
    roughness: 0.46,
    metalness: 0.45,
  });
  const roofTrimMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xe2e8f0 : 0x64748b,
    roughness: 0.34,
    metalness: 0.62,
  });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xf1f5f9 : 0xcbd5e1,
    roughness: 0.55,
    metalness: 0.25,
  });
  const windowGlassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.14,
    metalness: 0.35,
    emissive: isLight ? 0x0369a1 : 0x0c4a6e,
    emissiveIntensity: isLight ? 0.12 : 0.25,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x334155 : 0x1e293b,
    roughness: 0.62,
    metalness: 0.22,
  });
  const signPostMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.35,
    metalness: 0.75,
  });
  const lawnMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x4d7c5b : 0x1a3a2f,
    roughness: 0.94,
    metalness: 0.0,
  });

  // Shared reusable geometries
  const roomBodyGeo = new THREE.BoxGeometry(ROOM_W, ROOM_H, ROOM_D);
  const windowGeo = new THREE.BoxGeometry(ROOM_W * 0.42, 0.72, 0.08);
  const doorGeo = new THREE.BoxGeometry(0.68, 1.55, 0.08);
  const stripGeo = new THREE.BoxGeometry(ROOM_W - 0.12, 0.12, 0.14);
  const pillarGeo = new THREE.CylinderGeometry(0.08, 0.09, ROOM_H + 0.15, 8);
  const roomPlaqueGeo = new THREE.PlaneGeometry(1.15, 0.46);
  const postGeo = new THREE.CylinderGeometry(0.1, 0.11, 1.6, 8);

  // Measure each KTX zone footprint
  interface ZoneLayout {
    node: CampusKtxNode;
    width: number;
    depth: number;
  }

  const zoneLayouts: ZoneLayout[] = ktxNodes.map(ktxNode => {
    const maxRooms = Math.max(1, ...ktxNode.buildings.map(b => Math.max(1, b.rooms.length)));
    const maxBuildingW = maxRooms * (ROOM_W + ROOM_GAP) + 1.2;
    const totalDepth =
      ktxNode.buildings.length * (ROOM_D + CORRIDOR_D) +
      Math.max(0, ktxNode.buildings.length - 1) * BUILDING_GAP_Z;
    return {
      node: ktxNode,
      width: maxBuildingW + KTX_PAD_X * 2,
      depth: Math.max(10, totalDepth + KTX_PAD_Z * 2),
    };
  });

  const totalCampusW =
    zoneLayouts.reduce((sum, z) => sum + z.width, 0) +
    Math.max(0, zoneLayouts.length - 1) * KTX_ZONE_GAP_X;
  const maxCampusD = Math.max(18, ...zoneLayouts.map(z => z.depth));

  // ── 1. Extended Outdoor Ground Plane ──
  const groundSize = Math.max(260, Math.max(totalCampusW, maxCampusD) * 4.5);
  const groundTex = createGroundTileTexture(maxAnisotropy, theme);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.92,
    metalness: 0.02,
  });
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // Main campus boulevard
  const roadTex = createRoadTexture(maxAnisotropy, theme);
  const roadLen = Math.max(totalCampusW + 40, 80);
  roadTex.repeat.set(1, Math.max(4, Math.round(roadLen / 10)));
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.86,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2, roadLen), roadMat);
  roadMesh.rotation.x = -Math.PI / 2;
  roadMesh.rotation.z = Math.PI / 2;
  roadMesh.position.set(0, 0.025, maxCampusD / 2 + 5.2);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Collectors for high-performance InstancedMesh batching
  const doorPositions: THREE.Vector3[] = [];
  const windowPositions: THREE.Vector3[] = [];
  const pillarPositions: THREE.Vector3[] = [];
  const treePositions: { x: number; z: number }[] = [];

  // ── 2. Build each KTX Zone ──
  let cursorX = -totalCampusW / 2;

  zoneLayouts.forEach((zl, ktxIdx) => {
    const zoneCenterX = cursorX + zl.width / 2;
    cursorX += zl.width + KTX_ZONE_GAP_X;

    const ktxGroup = new THREE.Group();
    ktxGroup.name = `ktx-zone-${zl.node.ktx}`;
    ktxGroup.position.set(zoneCenterX, 0, 0);

    const plinthH = 0.24;
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(zl.width, plinthH, zl.depth),
      concretePlinthMat
    );
    plinth.position.set(0, plinthH / 2 + 0.02, 0);
    plinth.receiveShadow = true;
    ktxGroup.add(plinth);

    const lawnStripGeo = new THREE.BoxGeometry(1.1, 0.06, zl.depth - 1.4);
    const leftLawn = new THREE.Mesh(lawnStripGeo, lawnMat);
    leftLawn.position.set(-zl.width / 2 + 0.8, plinthH + 0.05, 0);
    ktxGroup.add(leftLawn);
    const rightLawn = new THREE.Mesh(lawnStripGeo, lawnMat);
    rightLawn.position.set(zl.width / 2 - 0.8, plinthH + 0.05, 0);
    ktxGroup.add(rightLawn);

    const treeCountSide = Math.max(3, Math.min(8, Math.floor(zl.depth / 6)));
    for (let t = 0; t < treeCountSide; t++) {
      const tz = -zl.depth / 2 + 2.5 + (t * (zl.depth - 5)) / Math.max(1, treeCountSide - 1);
      treePositions.push({ x: zoneCenterX - zl.width / 2 - 1.9, z: tz });
      if (ktxIdx === zoneLayouts.length - 1) {
        treePositions.push({ x: zoneCenterX + zl.width / 2 + 1.9, z: tz });
      }
    }

    // KTX Zone Entrance Monument Signboard
    const ktxSignTex = createPlaqueTexture(
      zl.node.ktx,
      {
        subtext: `${zl.node.totalOccupied}/${zl.node.totalCapacity} chỗ · ${zl.node.totalRooms} phòng`,
        bg: '#0f172a',
        border: '#3b82f6',
        width: 384,
        height: 112,
        fontSize: 38,
        maxAnisotropy,
      },
      plaqueTexCache
    );
    const signBoard = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 1.65, 0.22),
      new THREE.MeshStandardMaterial({
        map: ktxSignTex,
        roughness: 0.35,
        metalness: 0.15,
      })
    );
    signBoard.position.set(0, plinthH + 1.65, zl.depth / 2 + 0.6);
    signBoard.castShadow = castShadows;
    ktxGroup.add(signBoard);

    [-2.1, 2.1].forEach(px => {
      const post = new THREE.Mesh(postGeo, signPostMat);
      post.position.set(px, plinthH + 0.8, zl.depth / 2 + 0.6);
      ktxGroup.add(post);
    });

    // ── 3. Build Buildings (Dãy nhà) inside KTX Zone ──
    const buildings = zl.node.buildings;
    const totalBldSpanZ =
      buildings.length * (ROOM_D + CORRIDOR_D) +
      Math.max(0, buildings.length - 1) * BUILDING_GAP_Z;
    let bldCursorZ = -totalBldSpanZ / 2;

    buildings.forEach(building => {
      const rowRoomCount = Math.max(1, building.rooms.length);
      const bldW = rowRoomCount * (ROOM_W + ROOM_GAP) + 0.8;
      const bldTotalD = ROOM_D + CORRIDOR_D;
      const bldCenterZ = bldCursorZ + bldTotalD / 2;
      bldCursorZ += bldTotalD + BUILDING_GAP_Z;

      const bldBaseY = plinthH + 0.02;
      const bldGroup = new THREE.Group();
      bldGroup.name = `building-${building.key}`;
      bldGroup.position.set(0, bldBaseY, bldCenterZ);

      const deckH = 0.22;
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.4, deckH, bldTotalD + 0.3),
        buildingDeckMat
      );
      deck.position.set(0, deckH / 2, 0);
      deck.receiveShadow = true;
      bldGroup.add(deck);

      const roofY = deckH + ROOM_H + 0.18;
      const roofMain = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.9, 0.22, bldTotalD + 0.8),
        roofMat
      );
      roofMain.position.set(0, roofY, 0);
      roofMain.castShadow = castShadows;
      roofMain.receiveShadow = true;
      bldGroup.add(roofMain);

      const roofRidge = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.96, 0.28, 0.72),
        roofTrimMat
      );
      roofRidge.position.set(0, roofY + 0.22, -0.15);
      roofRidge.castShadow = castShadows;
      bldGroup.add(roofRidge);

      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.94, 0.14, 0.12),
        roofTrimMat
      );
      fascia.position.set(0, roofY - 0.04, bldTotalD / 2 + 0.4);
      bldGroup.add(fascia);

      // Queue front walkway pillars for InstancedMesh
      const pillarCount = Math.max(2, Math.min(rowRoomCount + 1, 14));
      for (let p = 0; p < pillarCount; p++) {
        const px = -bldW / 2 + (p * bldW) / (pillarCount - 1);
        pillarPositions.push(
          new THREE.Vector3(
            zoneCenterX + px,
            bldBaseY + deckH + (ROOM_H + 0.15) / 2,
            bldCenterZ + bldTotalD / 2 - 0.1
          )
        );
      }

      // Building signboards on BOTH left AND right gable ends (readable from any orbit angle!)
      const bldSignTex = createPlaqueTexture(
        building.day,
        {
          subtext: `${building.totalOccupied}/${building.totalCapacity}`,
          bg: '#0f172a',
          border: '#10b981',
          width: 256,
          height: 96,
          fontSize: 34,
          maxAnisotropy,
        },
        plaqueTexCache
      );
      const bldSignMat = new THREE.MeshStandardMaterial({
        map: bldSignTex,
        roughness: 0.35,
        metalness: 0.1,
      });
      const bldSignGeo = new THREE.PlaneGeometry(2.2, 0.82);

      const bldSignLeft = new THREE.Mesh(bldSignGeo, bldSignMat);
      bldSignLeft.position.set(-bldW / 2 - 0.24, deckH + ROOM_H * 0.62, 0);
      bldSignLeft.rotation.y = -Math.PI / 2;
      bldGroup.add(bldSignLeft);

      const bldSignRight = new THREE.Mesh(bldSignGeo, bldSignMat);
      bldSignRight.position.set(bldW / 2 + 0.24, deckH + ROOM_H * 0.62, 0);
      bldSignRight.rotation.y = Math.PI / 2;
      bldGroup.add(bldSignRight);

      // ── 4. Build Interactive Room Units ──
      const startRoomX = -((rowRoomCount - 1) * (ROOM_W + ROOM_GAP)) / 2;
      const roomZLocal = -CORRIDOR_D / 2;

      building.rooms.forEach((room, rIdx) => {
        const rx = startRoomX + rIdx * (ROOM_W + ROOM_GAP);
        const worldX = zoneCenterX + rx;
        const worldYBase = bldBaseY + deckH;
        const worldZ = bldCenterZ + roomZLocal;

        const spec = resolveRoomColor(room, colorMode, unitFilter, theme);

        const bodyMat = new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.52,
          metalness: 0.12,
          emissive: spec.emissive,
          emissiveIntensity: spec.emissiveIntensity,
          transparent: spec.opacity < 0.99,
          opacity: spec.opacity,
          depthWrite: spec.opacity >= 0.99,
        });

        const bodyMesh = new THREE.Mesh(roomBodyGeo, bodyMat);
        bodyMesh.position.set(rx, deckH + ROOM_H / 2, roomZLocal);
        bodyMesh.castShadow = castShadows;
        bodyMesh.receiveShadow = true;
        bodyMesh.userData = { type: 'room', roomKey: room.key };
        bldGroup.add(bodyMesh);
        hitTargets.push(bodyMesh);

        // Queue door + front/rear windows for InstancedMesh
        doorPositions.push(new THREE.Vector3(worldX - 0.56, worldYBase + 0.78, worldZ + ROOM_D / 2 + 0.02));
        windowPositions.push(new THREE.Vector3(worldX + 0.48, worldYBase + 1.32, worldZ + ROOM_D / 2 + 0.02));
        windowPositions.push(new THREE.Vector3(worldX, worldYBase + 1.32, worldZ - ROOM_D / 2 - 0.02));

        // Status indicator bar
        const stripMat = new THREE.MeshStandardMaterial({
          color: spec.color,
          emissive: spec.color,
          emissiveIntensity: spec.opacity < 0.5 ? 0.05 : 0.45,
          roughness: 0.25,
          metalness: 0.3,
        });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(rx, deckH + ROOM_H - 0.16, roomZLocal + ROOM_D / 2 + 0.06);
        bldGroup.add(strip);

        // Deduplicated room number plaque
        let plaqueMat = roomPlaqueMatCache.get(room.roomLabel);
        if (!plaqueMat) {
          const rPlaqueTex = createPlaqueTexture(
            room.roomLabel,
            {
              bg: '#0b1220',
              border: '#475569',
              width: 160,
              height: 64,
              fontSize: 32,
              maxAnisotropy,
            },
            plaqueTexCache
          );
          plaqueMat = new THREE.MeshStandardMaterial({
            map: rPlaqueTex,
            roughness: 0.4,
            metalness: 0.1,
          });
          roomPlaqueMatCache.set(room.roomLabel, plaqueMat);
        }
        const rPlaque = new THREE.Mesh(roomPlaqueGeo, plaqueMat);
        rPlaque.position.set(rx, deckH + ROOM_H + 0.36, roomZLocal + ROOM_D / 2 + CORRIDOR_D * 0.46);
        rPlaque.rotation.x = -0.35;
        bldGroup.add(rPlaque);

        const worldCenter = new THREE.Vector3(worldX, worldYBase + ROOM_H / 2, worldZ);
        roomVisuals.set(room.key, {
          room,
          bodyMesh,
          bodyMat,
          stripMat,
          worldCenter,
        });
      });

      ktxGroup.add(bldGroup);
    });

    group.add(ktxGroup);
  });

  // ── 5. Commit Batched InstancedMeshes (Doors, Windows, Corridor Pillars) ──
  const dummy = new THREE.Object3D();

  if (doorPositions.length > 0) {
    const doorsInst = new THREE.InstancedMesh(doorGeo, doorMat, doorPositions.length);
    doorPositions.forEach((pos, idx) => {
      dummy.position.copy(pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      doorsInst.setMatrixAt(idx, dummy.matrix);
    });
    doorsInst.instanceMatrix.needsUpdate = true;
    doorsInst.computeBoundingSphere();
    group.add(doorsInst);
  }

  if (windowPositions.length > 0) {
    const windowsInst = new THREE.InstancedMesh(windowGeo, windowGlassMat, windowPositions.length);
    windowPositions.forEach((pos, idx) => {
      dummy.position.copy(pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      windowsInst.setMatrixAt(idx, dummy.matrix);
    });
    windowsInst.instanceMatrix.needsUpdate = true;
    windowsInst.computeBoundingSphere();
    group.add(windowsInst);
  }

  if (pillarPositions.length > 0) {
    const pillarsInst = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarPositions.length);
    pillarPositions.forEach((pos, idx) => {
      dummy.position.copy(pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pillarsInst.setMatrixAt(idx, dummy.matrix);
    });
    pillarsInst.instanceMatrix.needsUpdate = true;
    pillarsInst.computeBoundingSphere();
    group.add(pillarsInst);
  }

  // ── 6. Composite Procedural Trees via InstancedMesh ──
  const blvdTreeCount = Math.max(4, Math.min(14, Math.floor(totalCampusW / 8)));
  for (let i = 0; i < blvdTreeCount; i++) {
    const tx = -totalCampusW / 2 + (i * totalCampusW) / Math.max(1, blvdTreeCount - 1);
    treePositions.push({ x: tx, z: maxCampusD / 2 + 9.2 });
    treePositions.push({ x: tx, z: -maxCampusD / 2 - 4.2 });
  }

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.8, 7);
    const crown1Geo = new THREE.ConeGeometry(1.15, 2.2, 7);
    const crown2Geo = new THREE.ConeGeometry(0.85, 1.7, 7);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.92, metalness: 0.0 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    const crowns1 = new THREE.InstancedMesh(crown1Geo, foliageMat, treePositions.length);
    const crowns2 = new THREE.InstancedMesh(crown2Geo, foliageMat, treePositions.length);

    trunks.castShadow = castShadows;
    crowns1.castShadow = castShadows;
    crowns2.castShadow = castShadows;

    const tint = new THREE.Color();
    const baseLightness = isLight ? 0.34 : 0.24;

    treePositions.forEach((pos, idx) => {
      const scale = 0.86 + ((idx * 37) % 30) / 100;
      const rotY = (idx * 1.7) % (Math.PI * 2);

      dummy.position.set(pos.x, 0.9 * scale, pos.z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(pos.x, 2.4 * scale, pos.z);
      dummy.updateMatrix();
      crowns1.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(pos.x, 3.55 * scale, pos.z);
      dummy.updateMatrix();
      crowns2.setMatrixAt(idx, dummy.matrix);

      const greenHue = 0.36 + ((idx % 5) - 2) * 0.015;
      const greenLight = baseLightness + ((idx * 13) % 7) * 0.014;
      tint.setHSL(greenHue, 0.45, greenLight);
      crowns1.setColorAt(idx, tint);
      tint.setHSL(greenHue + 0.01, 0.48, greenLight + 0.05);
      crowns2.setColorAt(idx, tint);
    });

    trunks.instanceMatrix.needsUpdate = true;
    crowns1.instanceMatrix.needsUpdate = true;
    crowns2.instanceMatrix.needsUpdate = true;
    if (crowns1.instanceColor) crowns1.instanceColor.needsUpdate = true;
    if (crowns2.instanceColor) crowns2.instanceColor.needsUpdate = true;

    trunks.computeBoundingSphere();
    crowns1.computeBoundingSphere();
    crowns2.computeBoundingSphere();

    group.add(trunks, crowns1, crowns2);
  }

  const boundsRadius = Math.max(16, Math.hypot(totalCampusW / 2, maxCampusD / 2));
  const boundsCenter = new THREE.Vector3(0, 1.4, 0);

  return {
    group,
    hitTargets,
    roomVisuals,
    boundsCenter,
    boundsRadius,
  };
}
