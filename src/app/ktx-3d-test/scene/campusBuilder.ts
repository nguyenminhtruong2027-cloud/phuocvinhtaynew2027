import * as THREE from 'three';
import type { CampusColorMode, CampusKtxNode, CampusRoomNode } from '../types';
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

// Semantic architectural palette (works harmoniously under ACESFilmic + RoomEnvironment)
const PALETTE = {
  empty: 0x475569,
  available: 0x10b981,
  full: 0xf59e0b,
  overloaded: 0xf43f5e,
  male: 0x3b82f6,
  female: 0xec4899,
  mixed: 0xf59e0b,
  ghost: 0x1e293b,
};

export function resolveRoomColor(
  room: CampusRoomNode,
  mode: CampusColorMode
): { color: number; emissive: number; emissiveIntensity: number; opacity: number } {
  const isOverloaded = room.occupied > room.capacity;
  const isFull = room.occupied >= room.capacity && room.capacity > 0;
  const isEmpty = room.occupied === 0;

  if (mode === 'vacant_only') {
    if (room.vacant > 0) {
      return {
        color: isEmpty ? 0x38bdf8 : PALETTE.available,
        emissive: isEmpty ? 0x0ea5e9 : 0x059669,
        emissiveIntensity: 0.28,
        opacity: 1,
      };
    }
    return { color: PALETTE.ghost, emissive: 0x000000, emissiveIntensity: 0, opacity: 0.24 };
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
    return { color: PALETTE.ghost, emissive: 0x000000, emissiveIntensity: 0, opacity: 0.22 };
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
  hoveredKey: string | null
): void {
  roomVisuals.forEach((handle, key) => {
    const spec = resolveRoomColor(handle.room, mode);
    const isHovered = key === hoveredKey;
    handle.bodyMat.color.setHex(spec.color);
    handle.bodyMat.opacity = isHovered ? 1 : spec.opacity;
    handle.bodyMat.transparent = !isHovered && spec.opacity < 0.99;
    handle.bodyMat.depthWrite = isHovered || spec.opacity >= 0.99;
    handle.bodyMat.emissive.setHex(isHovered ? 0x38bdf8 : spec.emissive);
    handle.bodyMat.emissiveIntensity = isHovered ? 0.55 : spec.emissiveIntensity;

    handle.stripMat.color.setHex(isHovered ? 0x7dd3fc : spec.color);
    handle.stripMat.emissive.setHex(isHovered ? 0x38bdf8 : spec.color);
    handle.stripMat.emissiveIntensity = isHovered ? 0.85 : spec.opacity < 0.5 ? 0.05 : 0.45;
  });
}

export function buildCampusScene(
  ktxNodes: CampusKtxNode[],
  colorMode: CampusColorMode,
  maxAnisotropy: number,
  castShadows: boolean
): CampusBuildResult {
  const group = new THREE.Group();
  group.name = 'ktx-campus-root';

  const hitTargets: THREE.Object3D[] = [];
  const roomVisuals = new Map<string, RoomVisualHandle>();

  // Dimensions (meters-like architectural units)
  const ROOM_W = 2.6;
  const ROOM_D = 3.2;
  const ROOM_H = 2.35;
  const ROOM_GAP = 0.24;
  const CORRIDOR_D = 1.15;
  const BUILDING_GAP_Z = 5.6;
  const KTX_PAD_X = 3.0;
  const KTX_PAD_Z = 2.8;
  const KTX_ZONE_GAP_X = 7.5;

  // Shared materials (varied roughness/metalness for crisp architectural depth)
  const concretePlinthMat = new THREE.MeshStandardMaterial({
    color: 0x263246,
    roughness: 0.88,
    metalness: 0.06,
  });
  const buildingDeckMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.82,
    metalness: 0.08,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.46,
    metalness: 0.48,
  });
  const roofTrimMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.34,
    metalness: 0.65,
  });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.55,
    metalness: 0.25,
  });
  const windowGlassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.14,
    metalness: 0.35,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.25,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.62,
    metalness: 0.22,
  });
  const signPostMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.35,
    metalness: 0.75,
  });
  const lawnMat = new THREE.MeshStandardMaterial({
    color: 0x1a3a2f,
    roughness: 0.94,
    metalness: 0.0,
  });

  // Shared geometries for reuse across all rooms/buildings (low draw-call / memory footprint)
  const roomBodyGeo = new THREE.BoxGeometry(ROOM_W, ROOM_H, ROOM_D);
  const windowGeo = new THREE.BoxGeometry(ROOM_W * 0.42, 0.72, 0.08);
  const doorGeo = new THREE.BoxGeometry(0.68, 1.55, 0.08);
  const stripGeo = new THREE.BoxGeometry(ROOM_W - 0.12, 0.12, 0.14);
  const pillarGeo = new THREE.CylinderGeometry(0.08, 0.09, ROOM_H + 0.15, 8);
  const roomPlaqueGeo = new THREE.PlaneGeometry(1.15, 0.46);

  // Measure each KTX zone footprint first so we can center the entire campus cleanly at (0, 0, 0)
  interface ZoneLayout {
    node: CampusKtxNode;
    width: number;
    depth: number;
    maxRoomsInRow: number;
  }

  const zoneLayouts: ZoneLayout[] = ktxNodes.map(ktxNode => {
    const maxRooms = Math.max(
      1,
      ...ktxNode.buildings.map(b => Math.max(1, b.rooms.length))
    );
    const maxBuildingW = maxRooms * (ROOM_W + ROOM_GAP) + 1.2;
    const totalDepth =
      ktxNode.buildings.length * (ROOM_D + CORRIDOR_D) +
      Math.max(0, ktxNode.buildings.length - 1) * BUILDING_GAP_Z;
    return {
      node: ktxNode,
      width: maxBuildingW + KTX_PAD_X * 2,
      depth: Math.max(10, totalDepth + KTX_PAD_Z * 2),
      maxRoomsInRow: maxRooms,
    };
  });

  const totalCampusW =
    zoneLayouts.reduce((sum, z) => sum + z.width, 0) +
    Math.max(0, zoneLayouts.length - 1) * KTX_ZONE_GAP_X;
  const maxCampusD = Math.max(18, ...zoneLayouts.map(z => z.depth));

  // ── 1. Extended Outdoor Ground Plane (blends cleanly into horizon fog, no void edge) ──
  const groundSize = Math.max(260, Math.max(totalCampusW, maxCampusD) * 4.5);
  const groundTex = createGroundTileTexture(maxAnisotropy);
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

  // Main horizontal campus boulevard in front of KTX zones
  const roadTex = createRoadTexture(maxAnisotropy);
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

  // ── 2. Build each KTX Zone ──
  let cursorX = -totalCampusW / 2;
  const treePositions: { x: number; z: number }[] = [];

  zoneLayouts.forEach((zl, ktxIdx) => {
    const zoneCenterX = cursorX + zl.width / 2;
    cursorX += zl.width + KTX_ZONE_GAP_X;

    const ktxGroup = new THREE.Group();
    ktxGroup.name = `ktx-zone-${zl.node.ktx}`;
    ktxGroup.position.set(zoneCenterX, 0, 0);

    // KTX Zone architectural plinth (y offset >= 0.04 above ground)
    const plinthH = 0.24;
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(zl.width, plinthH, zl.depth),
      concretePlinthMat
    );
    plinth.position.set(0, plinthH / 2 + 0.02, 0);
    plinth.receiveShadow = true;
    ktxGroup.add(plinth);

    // Green courtyard strips along left & right edges of zone
    const lawnStripGeo = new THREE.BoxGeometry(1.1, 0.06, zl.depth - 1.4);
    const leftLawn = new THREE.Mesh(lawnStripGeo, lawnMat);
    leftLawn.position.set(-zl.width / 2 + 0.8, plinthH + 0.05, 0);
    ktxGroup.add(leftLawn);
    const rightLawn = new THREE.Mesh(lawnStripGeo, lawnMat);
    rightLawn.position.set(zl.width / 2 - 0.8, plinthH + 0.05, 0);
    ktxGroup.add(rightLawn);

    // Register perimeter trees outside KTX plinth for InstancedMesh
    const treeCountSide = Math.max(3, Math.min(8, Math.floor(zl.depth / 6)));
    for (let t = 0; t < treeCountSide; t++) {
      const tz = -zl.depth / 2 + 2.5 + (t * (zl.depth - 5)) / Math.max(1, treeCountSide - 1);
      treePositions.push({ x: zoneCenterX - zl.width / 2 - 1.9, z: tz });
      if (ktxIdx === zoneLayouts.length - 1) {
        treePositions.push({ x: zoneCenterX + zl.width / 2 + 1.9, z: tz });
      }
    }

    // KTX Zone Entrance Monument Signboard
    const ktxSignTex = createPlaqueTexture(zl.node.ktx, {
      subtext: `${zl.node.totalOccupied}/${zl.node.totalCapacity} chỗ · ${zl.node.totalRooms} phòng`,
      bg: '#0f172a',
      border: '#3b82f6',
      width: 384,
      height: 112,
      fontSize: 38,
      maxAnisotropy,
    });
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

    const postGeo = new THREE.CylinderGeometry(0.1, 0.11, 1.6, 8);
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

      const bldGroup = new THREE.Group();
      bldGroup.name = `building-${building.key}`;
      bldGroup.position.set(0, plinthH + 0.02, bldCenterZ);

      // Building concrete foundation + front walkway deck
      const deckH = 0.22;
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.4, deckH, bldTotalD + 0.3),
        buildingDeckMat
      );
      deck.position.set(0, deckH / 2, 0);
      deck.receiveShadow = true;
      bldGroup.add(deck);

      // Pitched architectural roof overhang + ridge beam
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

      // Corridor front fascia trim
      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.94, 0.14, 0.12),
        roofTrimMat
      );
      fascia.position.set(0, roofY - 0.04, bldTotalD / 2 + 0.4);
      bldGroup.add(fascia);

      // Front walkway columns
      const pillarCount = Math.max(2, Math.min(rowRoomCount + 1, 14));
      for (let p = 0; p < pillarCount; p++) {
        const px = -bldW / 2 + (p * bldW) / (pillarCount - 1);
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(px, deckH + (ROOM_H + 0.15) / 2, bldTotalD / 2 - 0.1);
        bldGroup.add(pillar);
      }

      // Building signboard on left gable end
      const bldSignTex = createPlaqueTexture(building.day, {
        subtext: `${building.totalOccupied}/${building.totalCapacity}`,
        bg: '#0f172a',
        border: '#10b981',
        width: 256,
        height: 96,
        fontSize: 34,
        maxAnisotropy,
      });
      const bldSign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 0.82),
        new THREE.MeshStandardMaterial({
          map: bldSignTex,
          roughness: 0.35,
          metalness: 0.1,
        })
      );
      bldSign.position.set(-bldW / 2 - 0.24, deckH + ROOM_H * 0.62, 0);
      bldSign.rotation.y = -Math.PI / 2;
      bldGroup.add(bldSign);

      // ── 4. Build Interactive Room Units along the Building ──
      const startRoomX = -((rowRoomCount - 1) * (ROOM_W + ROOM_GAP)) / 2;
      const roomZLocal = -CORRIDOR_D / 2;

      building.rooms.forEach((room, rIdx) => {
        const rx = startRoomX + rIdx * (ROOM_W + ROOM_GAP);
        const spec = resolveRoomColor(room, colorMode);

        const roomGroup = new THREE.Group();
        roomGroup.position.set(rx, deckH, roomZLocal);

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
        bodyMesh.position.set(0, ROOM_H / 2, 0);
        bodyMesh.castShadow = castShadows;
        bodyMesh.receiveShadow = true;
        bodyMesh.userData = { type: 'room', roomKey: room.key };
        roomGroup.add(bodyMesh);
        hitTargets.push(bodyMesh);

        // Front door (facing corridor +Z)
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(-0.56, 0.78, ROOM_D / 2 + 0.02);
        roomGroup.add(door);

        // Front & rear recessed windows
        const frontWin = new THREE.Mesh(windowGeo, windowGlassMat);
        frontWin.position.set(0.48, 1.32, ROOM_D / 2 + 0.02);
        roomGroup.add(frontWin);

        const rearWin = new THREE.Mesh(windowGeo, windowGlassMat);
        rearWin.position.set(0, 1.32, -ROOM_D / 2 - 0.02);
        roomGroup.add(rearWin);

        // Status indicator bar above corridor lintel
        const stripMat = new THREE.MeshStandardMaterial({
          color: spec.color,
          emissive: spec.color,
          emissiveIntensity: spec.opacity < 0.5 ? 0.05 : 0.45,
          roughness: 0.25,
          metalness: 0.3,
        });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, ROOM_H - 0.16, ROOM_D / 2 + 0.06);
        roomGroup.add(strip);

        // Crisp room number plaque above door
        const rPlaqueTex = createPlaqueTexture(room.roomLabel, {
          bg: '#0b1220',
          border: '#475569',
          width: 160,
          height: 64,
          fontSize: 32,
          maxAnisotropy,
        });
        const rPlaque = new THREE.Mesh(
          roomPlaqueGeo,
          new THREE.MeshStandardMaterial({
            map: rPlaqueTex,
            roughness: 0.4,
            metalness: 0.1,
          })
        );
        rPlaque.position.set(0, ROOM_H + 0.36, ROOM_D / 2 + CORRIDOR_D * 0.46);
        rPlaque.rotation.x = -0.35;
        roomGroup.add(rPlaque);

        bldGroup.add(roomGroup);

        const worldCenter = new THREE.Vector3(
          zoneCenterX + rx,
          plinthH + 0.02 + deckH + ROOM_H / 2,
          bldCenterZ + roomZLocal
        );

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

  // ── 3. Composite Procedural Trees via InstancedMesh (3-part: trunk + lower crown + upper crown) ──
  // Add front boulevard trees as well
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

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    treePositions.forEach((pos, idx) => {
      const scale = 0.86 + ((idx * 37) % 30) / 100; // ±15% natural variation
      const rotY = ((idx * 1.7) % (Math.PI * 2));

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

      // Subtle natural foliage shade variation
      const greenHue = 0.36 + ((idx % 5) - 2) * 0.015;
      const greenLight = 0.24 + ((idx * 13) % 7) * 0.015;
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
