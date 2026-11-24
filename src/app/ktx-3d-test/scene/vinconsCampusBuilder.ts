import * as THREE from 'three';
import type {
  CampusBuildingNode,
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  FunctionalAreaNode,
  SceneTheme,
  UnitXRayFilter,
} from '../types';
import type {
  CampusBlueprintConfig,
  CampusLandmarkConfig,
} from './campusLayoutConfig';
import {
  createB40MeshTexture,
  createCanteenAwningTexture,
  createConcreteYardTexture,
  createContainerWallTexture,
  createCorrugatedFenceTexture,
  createCorrugatedRoofTexture,
  createGroundTileTexture,
  createPlaqueTexture,
  createRoadTexture,
} from './materials';
import {
  resolveRoomColor,
  type BuildingVisualHandle,
  type CampusBuildResult,
  type RoomVisualHandle,
} from './campusBuilder';

/**
 * Photorealistic Architectural & Engineering 3D Masterplan Builder
 * VINCONS Shopdrawing VHM.PVT.CTT.KTX-00 — KHU LÁN TRẠI VINCONS (strictly excluding Vinalpha)
 * -----------------------------------------------------------------------------------------
 * Site dimensions: 151.235 m (East-West) × 145.645 m (North-South)
 * Scale: 1 m ≈ 0.562 scene units -> Compound footprint: 85.0 × 82.0 units
 *
 * Complete Official Shopdrawing Legend (1 → 21) — VINCONS Compound ONLY:
 *  (1) Dãy nhà ở công nhân Nam & (2) Dãy nhà ở công nhân Nữ — 6 single-story rows (3 North + 3 South),
 *      each 1 full-depth linear row of 15 rooms (Phòng 1–15) = 90 rooms · 1.800 chỗ
 *  (3) 2× Nhà ăn + Sinh hoạt cộng đồng (central open-air portal frame halls with ridge skylight vents)
 *  (4) 4× Gian soạn đồ ăn (enclosed serving/kitchen pavilions at BOTH West & East ends of both dining halls)
 *  (5) Khu thăm thân (visitor reception pavilion inside Main Gate North side)
 *  (6) 13× Nhà để xe công nhân (3 vertical SW + 4 vertical NE + 6 horizontal SE)
 *  (7) Cổng 2 cánh 4m + Cổng phụ (7.62m Main Entrance + R8000 curved concrete highway apron)
 *  (7A) Cổng phụ phục vụ lấy rác thải từ Nhà rác (SW West perimeter)
 *  (8) Container 20 feet kiểm soát Face ID (checkpoint straddling entrance lane with tripod turnstiles)
 *  (10) 3× Bồn nước Inox 20m³ (elevated galvanized steel structural towers + mirror Inox 304 tanks at NW)
 *  (11) Bể tự hoại Composite (2×5m³) & (12) Bể Composite bơm nước thải vào bồn XLNT (West utility yard)
 *  (13)–(17) Khu tắm rửa & WC: 3 columns of 20ft ISO containers (13 WC Nữ, 14 Tắm Nữ, 15 WC Nam, 16 Tắm Nam, 17 Giặt Nam/Nữ)
 *  (18) 2× Nhà rác (SW enclosed waste-sorting houses next to Gate 7A)
 *  (19) 2× Bồn xử lý nước thải 50m³/h — BỂ XLNT (NW aeration basins, catwalks, safety railings, clarifiers)
 *  (20) 3× Căng Teen (NE East-fence mini-mart pavilions with striped awnings & glass display counters)
 *  (21) Hàng rào tôn cao 2m quanh lán trại (West/South/East) + Hàng rào thép lưới B40 (North boundary)
 */

const COMPOUND_W = 85.0; // ~151.2m
const COMPOUND_D = 82.0; // ~145.6m
const PLINTH_H = 0.24;

// Exact Z coordinates for the 6 Single-Story Dormitory Rows (1)/(2): 3 North + 3 South
const DORM_SLOT_ZS = [-33.7, -24.2, -14.7, 14.7, 24.2, 33.7] as const;
const DORM_CENTER_X = -4.2;
const DORM_MAX_SPAN_W = 36.8;

// Exact Z coordinates for the 2 Central Dining Halls (3) + West & East Gian Soạn Đồ Ăn (4)
const DINING_SLOT_ZS = [-4.9, 4.9] as const;

// Main Gate Center (East Fence — 7.62m opening + R8000 junction apron)
const GATE_Z = -15.2;
const GATE_OPENING = 6.8;

/** Creates a true pitched gable roof geometry extruded along X, centered at origin with base at y = 0 */
function createPitchedGableRoofGeometry(
  lengthX: number,
  spanZ: number,
  ridgeRise: number,
  eaveThickness = 0.14
): THREE.ExtrudeGeometry {
  const halfZ = spanZ / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfZ, 0);
  shape.lineTo(halfZ, 0);
  shape.lineTo(halfZ, eaveThickness);
  shape.lineTo(0, eaveThickness + ridgeRise);
  shape.lineTo(-halfZ, eaveThickness);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: lengthX,
    bevelEnabled: false,
    steps: 1,
  });
  // Extrude runs along +Z; rotate +90deg around Y so roof ridge runs along X, then center along X
  geo.rotateY(Math.PI / 2);
  geo.translate(-lengthX / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Creates a smooth R8000 curved concrete highway junction apron connecting East Highway to Gate (7) */
function buildCurvedApronMesh(isLight: boolean): THREE.Mesh {
  const gateHalf = GATE_OPENING / 2;
  const flare = 4.5; // ~R8000 scaled
  const xGate = COMPOUND_W / 2;
  const xRoad = COMPOUND_W / 2 + 5.6;

  const shape = new THREE.Shape();
  shape.moveTo(xGate - 0.6, -(GATE_Z - gateHalf));
  shape.lineTo(xGate + 1.2, -(GATE_Z - gateHalf));
  shape.quadraticCurveTo(xRoad, -(GATE_Z - gateHalf), xRoad, -(GATE_Z - gateHalf - flare));
  shape.lineTo(xRoad, -(GATE_Z + gateHalf + flare));
  shape.quadraticCurveTo(xRoad, -(GATE_Z + gateHalf), xGate + 1.2, -(GATE_Z + gateHalf));
  shape.lineTo(xGate - 0.6, -(GATE_Z + gateHalf));
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 16);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x64748b : 0x263145,
    roughness: 0.86,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.035;
  mesh.receiveShadow = true;
  return mesh;
}

function createParkingBayTexture(
  horizontal: boolean,
  maxAnisotropy: number,
  isLight: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = horizontal ? 512 : 256;
  canvas.height = horizontal ? 256 : 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = isLight ? '#8c9bae' : '#222e42';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle asphalt grain
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect((i * 53) % canvas.width, (i * 107) % canvas.height, 2, 2);
  }

  ctx.strokeStyle = isLight ? 'rgba(248,250,252,0.78)' : 'rgba(226,232,240,0.38)';
  ctx.lineWidth = 3;

  if (horizontal) {
    ctx.beginPath();
    ctx.moveTo(8, canvas.height / 2);
    ctx.lineTo(canvas.width - 8, canvas.height / 2);
    ctx.stroke();
    for (let x = 24; x < canvas.width - 12; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, canvas.height - 12);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 8);
    ctx.lineTo(canvas.width / 2, canvas.height - 8);
    ctx.stroke();
    for (let y = 24; y < canvas.height - 12; y += 28) {
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(canvas.width - 12, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

function createHatchPadTexture(maxAnisotropy: number, isLight: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = isLight ? '#cbd5e1' : '#263449';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = isLight ? 'rgba(51,65,85,0.26)' : 'rgba(148,163,184,0.2)';
  ctx.lineWidth = 4;
  for (let i = -size; i < size * 2; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + size, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

  ctx.strokeStyle = isLight ? '#475569' : '#64748b';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, size - 8, size - 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  return tex;
}

function buildCustomLandmark(
  landmark: CampusLandmarkConfig,
  maxAnisotropy: number,
  plaqueCache: Map<string, THREE.CanvasTexture>,
  castShadows: boolean
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(landmark.x, PLINTH_H + 0.02, landmark.z);
  g.rotation.y = THREE.MathUtils.degToRad(landmark.rotationDeg || 0);

  const colorByType: Record<CampusLandmarkConfig['type'], number> = {
    gate: 0x0284c7,
    parking: 0x475569,
    courtyard: 0x15803d,
    canteen: 0xd97706,
    utility: 0x7c3aed,
  };

  const baseH = landmark.type === 'courtyard' ? 0.08 : landmark.type === 'parking' ? 0.16 : 2.2;
  const mat = new THREE.MeshStandardMaterial({
    color: colorByType[landmark.type],
    roughness: landmark.type === 'courtyard' ? 0.92 : 0.55,
    metalness: landmark.type === 'courtyard' ? 0.0 : 0.25,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(landmark.width, baseH, landmark.depth), mat);
  body.position.y = baseH / 2;
  body.castShadow = castShadows && baseH > 0.3;
  body.receiveShadow = true;
  g.add(body);

  const tex = createPlaqueTexture(
    landmark.label,
    {
      subtext: landmark.subtext,
      bg: '#0f172a',
      border: '#38bdf8',
      width: 288,
      height: 84,
      fontSize: 30,
      maxAnisotropy,
    },
    plaqueCache
  );
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(landmark.width * 0.9, 3.6), 0.95),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 })
  );
  plaque.position.set(0, baseH + 0.65, landmark.depth / 2 + 0.08);
  g.add(plaque);

  return g;
}

interface MappedDormSlot {
  slotIndex: number;
  z: number;
  southWing: CampusBuildingNode | null;
  northWing: CampusBuildingNode | null;
  labelOverride: string;
}

function extractDaySlotIndex(dayLabel: string): number | null {
  const m = (dayLabel || '').match(/(\d+)/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num >= 1 && num <= 6) return num - 1;
  return null;
}

/**
 * Maps live KTX/Building data strictly onto the 6 SINGLE-STORY (1 tầng) Vincons Shopdrawing rows (3 North + 3 South):
 *  - Official KTX Phước Vĩnh Tây: Dãy 1–6 → Slots 0–5 explicitly by day number,
 *    each Dãy is 1 single full-depth linear row of 15 rooms (Phòng 1–15, West → East).
 *  - 0 buildings (empty DB) -> 6 single-story architectural blueprint rows (15 rooms/dãy × 6 = 90 rooms).
 *  - Legacy 2-KTX test data -> paired back-to-back on ground level (strictly 1 floor).
 */
function assignBuildingsToSixVinconsSlots(ktxNodes: CampusKtxNode[]): MappedDormSlot[] {
  const flatBuildings: CampusBuildingNode[] = ktxNodes.flatMap(k => k.buildings);
  const slotCount = DORM_SLOT_ZS.length; // 6

  const slots: MappedDormSlot[] = DORM_SLOT_ZS.map((z, idx) => ({
    slotIndex: idx,
    z,
    southWing: null,
    northWing: null,
    labelOverride: idx === 0 ? `Dãy 1 · (1)(2)` : `Dãy ${idx + 1} · (1)`,
  }));

  if (flatBuildings.length === 0) {
    return slots;
  }

  if (
    ktxNodes.length === 2 &&
    ktxNodes[0].buildings.length <= slotCount &&
    ktxNodes[1].buildings.length <= slotCount
  ) {
    ktxNodes[0].buildings.forEach((b, i) => {
      const idx = extractDaySlotIndex(b.day) ?? i;
      if (idx >= 0 && idx < slotCount && !slots[idx].southWing) slots[idx].southWing = b;
      else if (i < slotCount) slots[i].southWing = b;
    });
    ktxNodes[1].buildings.forEach((b, i) => {
      const idx = extractDaySlotIndex(b.day) ?? i;
      if (idx >= 0 && idx < slotCount && !slots[idx].northWing) slots[idx].northWing = b;
      else if (i < slotCount) slots[i].northWing = b;
    });
    return slots;
  }

  if (flatBuildings.length <= slotCount) {
    const unassigned: CampusBuildingNode[] = [];
    flatBuildings.forEach(b => {
      const idx = extractDaySlotIndex(b.day);
      if (idx !== null && !slots[idx].southWing) {
        slots[idx].southWing = b;
      } else {
        unassigned.push(b);
      }
    });
    unassigned.forEach(b => {
      const freeSlot = slots.find(s => !s.southWing);
      if (freeSlot) freeSlot.southWing = b;
    });
    return slots;
  }

  flatBuildings.forEach((b, i) => {
    const target = slots[i % slotCount];
    if (!target.southWing) target.southWing = b;
    else if (!target.northWing) target.northWing = b;
  });
  return slots;
}

function parseRoomBayNumber(room: CampusRoomNode): number | null {
  const raw = (room.roomNorm || room.roomRaw || '').trim();
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function assignFixedRoomBays(
  wingRooms: CampusRoomNode[],
  minSlots: number
): { assigned: { room: CampusRoomNode; slotIdx: number }[]; slotCount: number } {
  const used = new Set<number>();
  const assigned: { room: CampusRoomNode; slotIdx: number }[] = [];
  let maxSlot = minSlots - 1;
  const unplaced: CampusRoomNode[] = [];

  wingRooms.forEach(room => {
    const bayNum = parseRoomBayNumber(room);
    if (bayNum !== null && bayNum <= 30 && !used.has(bayNum - 1)) {
      const idx = bayNum - 1;
      used.add(idx);
      if (idx > maxSlot) maxSlot = idx;
      assigned.push({ room, slotIdx: idx });
    } else {
      unplaced.push(room);
    }
  });

  let cursor = 0;
  unplaced.forEach(room => {
    while (used.has(cursor)) cursor++;
    used.add(cursor);
    if (cursor > maxSlot) maxSlot = cursor;
    assigned.push({ room, slotIdx: cursor });
  });

  return { assigned, slotCount: Math.max(minSlots, maxSlot + 1) };
}

export function buildVinconsCampusScene(
  ktxNodes: CampusKtxNode[],
  colorMode: CampusColorMode,
  unitFilter: UnitXRayFilter | null,
  theme: SceneTheme,
  maxAnisotropy: number,
  castShadows: boolean,
  blueprint: CampusBlueprintConfig,
  assignedOnly = false,
  showFunctionalRooms = true,
  showHiddenRooms = true
): CampusBuildResult {
  const group = new THREE.Group();
  group.name = 'vincons-ktx-campus-root';

  const roofsGroup = new THREE.Group();
  roofsGroup.name = 'ktx-campus-roofs';
  group.add(roofsGroup);

  const functionalGroup = new THREE.Group();
  functionalGroup.name = 'ktx-campus-functional';
  group.add(functionalGroup);

  const hitTargets: THREE.Object3D[] = [];
  const functionalHitTargets: THREE.Object3D[] = [];
  const buildingHitTargets: THREE.Object3D[] = [];
  const roomVisuals = new Map<string, RoomVisualHandle>();
  const functionalLookup = new Map<string, FunctionalAreaNode>();
  const buildingVisuals = new Map<string, BuildingVisualHandle>();
  const plaqueTexCache = new Map<string, THREE.CanvasTexture>();
  const roomPlaqueMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const isLight = theme === 'light';

  // Collect all functional rooms from DB so Dining Halls & Canteens can bind to live equipment data
  const allDbFunctional: FunctionalAreaNode[] = [];
  ktxNodes.forEach(k => {
    k.functionalAreas.forEach(f => allDbFunctional.push(f));
    k.buildings.forEach(b => {
      (b.functionalAreas || []).forEach(f => allDbFunctional.push(f));
    });
  });

  const diningDbNodes = allDbFunctional.filter(f =>
    /nha\s*an|nhà\s*ăn|bep|bếp/i.test(f.name)
  );
  const canteenDbNodes = allDbFunctional.filter(f =>
    /can\s*tin|căn\s*tin|căng\s*teen|cang\s*teen/i.test(f.name)
  );

  // ── Shared High-Fidelity Procedural PBR Materials ──
  const yardConcreteTex = createConcreteYardTexture(maxAnisotropy, theme);
  const concretePlinthMat = new THREE.MeshStandardMaterial({
    map: yardConcreteTex,
    roughness: 0.88,
    metalness: 0.04,
  });
  const concreteCurbMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x94a3b8 : 0x334155,
    roughness: 0.84,
    metalness: 0.06,
  });
  const internalRoadMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x5c6b80 : 0x1c2638,
    roughness: 0.9,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const laneMarkMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xf8fafc : 0x94a3b8,
    roughness: 0.65,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const buildingDeckMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xa3b1c2 : 0x334155,
    roughness: 0.84,
    metalness: 0.08,
  });
  const drainTrenchMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x475569 : 0x111827,
    roughness: 0.78,
    metalness: 0.28,
  });

  // Corrugated steel roof PBR materials (tôn mạ màu công nghiệp)
  const dormRoofTex = createCorrugatedRoofTexture(
    isLight ? '#3d526a' : '#25354c',
    isLight ? '#526b87' : '#364b68',
    maxAnisotropy,
    18,
    2
  );
  const dormRoofMat = new THREE.MeshStandardMaterial({
    map: dormRoofTex,
    roughness: 0.42,
    metalness: 0.56,
  });
  const diningRoofTex = createCorrugatedRoofTexture(
    isLight ? '#1e4fa8' : '#1d3f85',
    isLight ? '#3067c7' : '#2c54a6',
    maxAnisotropy,
    16,
    2
  );
  const diningRoofMat = new THREE.MeshStandardMaterial({
    map: diningRoofTex,
    roughness: 0.38,
    metalness: 0.52,
  });
  const canopyRoofTex = createCorrugatedRoofTexture(
    isLight ? '#4f6278' : '#2c3d55',
    isLight ? '#647991' : '#3d5270',
    maxAnisotropy,
    10,
    2
  );
  const canopyRoofMat = new THREE.MeshStandardMaterial({
    map: canopyRoofTex,
    roughness: 0.44,
    metalness: 0.58,
  });

  const roofTrimMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xe2e8f0 : 0x94a3b8,
    roughness: 0.3,
    metalness: 0.72,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xcbd5e1 : 0x94a3b8,
    roughness: 0.34,
    metalness: 0.78,
  });
  // High-polish SUS304 Stainless Steel for 20m³ Water Tanks (10) & reserve tanks
  const inoxTankMat = new THREE.MeshStandardMaterial({
    color: 0xe6edf5,
    roughness: 0.16,
    metalness: 0.92,
  });
  const safetyYellowMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.42,
    metalness: 0.28,
  });
  const pvcPipeBlueMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.35,
    metalness: 0.15,
  });
  const frpTankMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x0f766e : 0x115e59,
    roughness: 0.38,
    metalness: 0.18,
  });
  const windowGlassMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.1,
    metalness: 0.42,
    emissive: isLight ? 0x0369a1 : 0x0c4a6e,
    emissiveIntensity: isLight ? 0.12 : 0.28,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x334155 : 0x1e293b,
    roughness: 0.56,
    metalness: 0.28,
  });
  const acUnitMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xf1f5f9 : 0xcbd5e1,
    roughness: 0.48,
    metalness: 0.22,
  });

  // Corrugated 2m Perimeter Fence (21) & North B40 Wire-Mesh Fence
  const fenceCorrugatedTex = createCorrugatedFenceTexture(maxAnisotropy, theme);
  const fenceB40Tex = createB40MeshTexture(maxAnisotropy);
  const gateLeafBlueMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x1d4ed8 : 0x2563eb,
    roughness: 0.36,
    metalness: 0.55,
  });

  // Color-coded 20ft ISO Container materials matching official Legend (13)–(17), (8), (20)
  const containerFemaleMat = new THREE.MeshStandardMaterial({
    map: createContainerWallTexture(isLight ? '#334155' : '#1f2937', '#f43f5e', maxAnisotropy),
    roughness: 0.46,
    metalness: 0.42,
  });
  const containerMaleMat = new THREE.MeshStandardMaterial({
    map: createContainerWallTexture(isLight ? '#334155' : '#1f2937', '#0ea5e9', maxAnisotropy),
    roughness: 0.46,
    metalness: 0.42,
  });
  const containerLaundryMat = new THREE.MeshStandardMaterial({
    map: createContainerWallTexture(isLight ? '#334155' : '#1f2937', '#10b981', maxAnisotropy),
    roughness: 0.46,
    metalness: 0.42,
  });
  const containerFaceIdMat = new THREE.MeshStandardMaterial({
    map: createContainerWallTexture(isLight ? '#1e3a5f' : '#172554', '#38bdf8', maxAnisotropy),
    roughness: 0.42,
    metalness: 0.48,
  });
  const canteenWallMat = new THREE.MeshStandardMaterial({
    map: createContainerWallTexture(isLight ? '#e2e8f0' : '#475569', '#dc2626', maxAnisotropy),
    roughness: 0.5,
    metalness: 0.28,
  });
  const canteenAwningMat = new THREE.MeshStandardMaterial({
    map: createCanteenAwningTexture(maxAnisotropy),
    roughness: 0.68,
    metalness: 0.05,
  });
  const trashHouseMat = new THREE.MeshStandardMaterial({
    map: createContainerWallTexture(isLight ? '#475569' : '#293548', '#84cc16', maxAnisotropy),
    roughness: 0.58,
    metalness: 0.34,
  });
  const utilityCabinMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xe2e8f0 : 0x475569,
    roughness: 0.52,
    metalness: 0.28,
  });
  const kitchenWallMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xf1f5f9 : 0x3b485e,
    roughness: 0.58,
    metalness: 0.16,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    roughness: 0.12,
    metalness: 0.18,
    emissive: 0x0e7490,
    emissiveIntensity: 0.3,
  });
  const diningTableMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0xd97706 : 0xb45309,
    roughness: 0.56,
    metalness: 0.14,
  });
  const motoBodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.48,
  });
  const emptyShellMat = new THREE.MeshStandardMaterial({
    color: isLight ? 0x94a3b8 : 0x475569,
    roughness: 0.6,
    metalness: 0.14,
  });

  // ── 1. Extended Outdoor Terrain & Concrete Compound Slab (151.2m × 145.6m) ──
  const groundSize = 380;
  const groundTex = createGroundTileTexture(maxAnisotropy, theme);
  groundTex.repeat.set(36, 36);
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94, metalness: 0.02 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // Main raised poured-concrete compound slab with expansion joints
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(COMPOUND_W, PLINTH_H, COMPOUND_D),
    concretePlinthMat
  );
  plinth.position.set(0, PLINTH_H / 2 + 0.01, 0);
  plinth.receiveShadow = true;
  group.add(plinth);

  // ── 2. External East Concrete Road + R8000 Junction Apron + Internal Road Network ──
  const roadTex = createRoadTexture(maxAnisotropy, theme);
  roadTex.repeat.set(1, 14);
  const eastHighway = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 145),
    new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.86,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  eastHighway.rotation.x = -Math.PI / 2;
  eastHighway.position.set(COMPOUND_W / 2 + 9.0, 0.03, 0);
  eastHighway.receiveShadow = true;
  group.add(eastHighway);

  // Curved R8000 Concrete Turning Apron into the 7.62m Main Gate (7)
  group.add(buildCurvedApronMesh(isLight));

  // East-West Entrance Boulevard (from Main Gate (7) past Face ID (8) to N-S Spine Road)
  const gateRoad = new THREE.Mesh(new THREE.PlaneGeometry(27.0, 5.2), internalRoadMat);
  gateRoad.rotation.x = -Math.PI / 2;
  gateRoad.position.set(29.0, PLINTH_H + 0.022, GATE_Z);
  gateRoad.receiveShadow = true;
  group.add(gateRoad);

  const gateDash = new THREE.Mesh(new THREE.PlaneGeometry(23.5, 0.14), laneMarkMat);
  gateDash.rotation.x = -Math.PI / 2;
  gateDash.position.set(29.2, PLINTH_H + 0.028, GATE_Z);
  group.add(gateDash);

  // Main North-South Internal Spine Road (dividing Residential Core from East Parking/Canteen Zone)
  const spineRoad = new THREE.Mesh(new THREE.PlaneGeometry(3.4, COMPOUND_D - 1.6), internalRoadMat);
  spineRoad.rotation.x = -Math.PI / 2;
  spineRoad.position.set(16.4, PLINTH_H + 0.022, 0);
  spineRoad.receiveShadow = true;
  group.add(spineRoad);

  // West Utility Service Lane (dividing Residential Core from West WC/WWTP/Parking Strip)
  const westRoad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, COMPOUND_D - 1.6), internalRoadMat);
  westRoad.rotation.x = -Math.PI / 2;
  westRoad.position.set(-25.3, PLINTH_H + 0.022, 0);
  westRoad.receiveShadow = true;
  group.add(westRoad);

  // Perimeter Fire Lanes (North & South edges inside fence)
  const northLane = new THREE.Mesh(new THREE.PlaneGeometry(COMPOUND_W - 2.0, 2.2), internalRoadMat);
  northLane.rotation.x = -Math.PI / 2;
  northLane.position.set(0, PLINTH_H + 0.02, -COMPOUND_D / 2 + 1.5);
  group.add(northLane);

  const southLane = new THREE.Mesh(new THREE.PlaneGeometry(COMPOUND_W - 2.0, 2.2), internalRoadMat);
  southLane.rotation.x = -Math.PI / 2;
  southLane.position.set(0, PLINTH_H + 0.02, COMPOUND_D / 2 - 1.5);
  group.add(southLane);

  // ── 3. Perimeter Fence: (21) 2m Corrugated Metal (W/S/E) + North B40 Wire-Mesh Divider ──
  const fenceH = 1.85;
  const fenceBaseY = PLINTH_H + fenceH / 2 + 0.01;
  const fencePostMatrices: THREE.Matrix4[] = [];
  const _tmpObj = new THREE.Object3D();

  const addFenceSpan = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    style: 'corrugated' | 'b40' = 'corrugated'
  ) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const angle = Math.atan2(-dz, dx);

    // Concrete perimeter curb base
    const curb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.24), concreteCurbMat);
    curb.position.set((x1 + x2) / 2, PLINTH_H + 0.11, (z1 + z2) / 2);
    curb.rotation.y = angle;
    curb.receiveShadow = true;
    group.add(curb);

    if (style === 'b40') {
      const bTex = fenceB40Tex.clone();
      bTex.needsUpdate = true;
      bTex.repeat.set(Math.max(1, Math.round(len / 1.8)), 1);
      const bMat = new THREE.MeshStandardMaterial({
        map: bTex,
        transparent: true,
        alphaTest: 0.22,
        side: THREE.DoubleSide,
        roughness: 0.45,
        metalness: 0.65,
      });
      const meshPanel = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), bMat);
      meshPanel.position.set((x1 + x2) / 2, fenceBaseY + 0.08, (z1 + z2) / 2);
      meshPanel.rotation.y = angle;
      group.add(meshPanel);
    } else {
      const fTex = fenceCorrugatedTex.clone();
      fTex.needsUpdate = true;
      fTex.repeat.set(Math.max(1, Math.round(len / 2.8)), 1);
      const fMat = new THREE.MeshStandardMaterial({
        map: fTex,
        roughness: 0.5,
        metalness: 0.48,
      });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(len, fenceH, 0.12), fMat);
      panel.position.set((x1 + x2) / 2, fenceBaseY + 0.08, (z1 + z2) / 2);
      panel.rotation.y = angle;
      panel.castShadow = castShadows;
      panel.receiveShadow = true;
      group.add(panel);
    }

    const posts = Math.max(2, Math.round(len / 3.6) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      _tmpObj.position.set(x1 + dx * t, PLINTH_H + fenceH / 2 + 0.14, z1 + dz * t);
      _tmpObj.rotation.set(0, 0, 0);
      _tmpObj.scale.setScalar(1);
      _tmpObj.updateMatrix();
      fencePostMatrices.push(_tmpObj.matrix.clone());
    }
  };

  const hw = COMPOUND_W / 2;
  const hd = COMPOUND_D / 2;
  // North boundary: B40 diamond wire-mesh fence separating Vincons cleanly from northern parcel
  addFenceSpan(-hw, -hd, hw, -hd, 'b40');
  // South boundary: 2m corrugated metal fence (21)
  addFenceSpan(-hw, hd, hw, hd, 'corrugated');
  // West boundary: 2m corrugated fence (21) with SW Auxiliary Trash Gate opening (7A)
  addFenceSpan(-hw, -hd, -hw, 28.4, 'corrugated');
  addFenceSpan(-hw, 34.0, -hw, hd, 'corrugated');
  // East boundary: 2m corrugated fence (21) with Main Gate opening (7) — 7.62m
  addFenceSpan(hw, -hd, hw, GATE_Z - GATE_OPENING / 2, 'corrugated');
  addFenceSpan(hw, GATE_Z + GATE_OPENING / 2, hw, hd, 'corrugated');

  // ── 4. Main Entrance Complex: Cổng (7), Face ID 20ft Container (8), Khu Thăm Thân (5) ──
  const gateGroup = new THREE.Group();
  gateGroup.position.set(hw, PLINTH_H + 0.02, GATE_Z);

  // Heavy H-steel gantry portal columns + top truss banner
  [-GATE_OPENING / 2, GATE_OPENING / 2].forEach(gz => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.8), concreteCurbMat);
    base.position.set(0, 0.275, gz);
    gateGroup.add(base);

    const col = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.75, 0.42), steelMat);
    col.position.set(0, 2.38, gz);
    col.castShadow = castShadows;
    gateGroup.add(col);
  });

  // 2-leaf 4m swinging steel vehicle gate (slightly ajar for welcoming industrial read) + side pedestrian wicket
  const leafTop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, 2.2), gateLeafBlueMat);
  leafTop.position.set(-0.7, 1.05, -GATE_OPENING / 2 + 1.25);
  leafTop.rotation.y = 0.55;
  leafTop.castShadow = castShadows;
  gateGroup.add(leafTop);

  const leafBottom = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, 2.2), gateLeafBlueMat);
  leafBottom.position.set(-0.7, 1.05, GATE_OPENING / 2 - 1.25);
  leafBottom.rotation.y = -0.55;
  leafBottom.castShadow = castShadows;
  gateGroup.add(leafBottom);

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 1.25, GATE_OPENING + 1.2),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.48 })
  );
  beam.position.set(0, 4.7, 0);
  beam.castShadow = castShadows;
  gateGroup.add(beam);

  const gateSignTex = createPlaqueTexture(
    'KHU LÁN TRẠI VINCONS · KTX PHƯỚC VĨNH TÂY',
    {
      subtext: 'CỔNG CHÍNH (7) 2 CÁNH 4M + CỔNG PHỤ · BẢN VẼ VHM.PVT.CTT.KTX-00',
      bg: '#0f172a',
      border: '#38bdf8',
      width: 680,
      height: 116,
      fontSize: 26,
      maxAnisotropy,
    },
    plaqueTexCache
  );
  const gateSignMat = new THREE.MeshStandardMaterial({ map: gateSignTex, roughness: 0.3 });
  const gateSignOut = new THREE.Mesh(new THREE.PlaneGeometry(GATE_OPENING + 0.8, 1.12), gateSignMat);
  gateSignOut.position.set(0.33, 4.7, 0);
  gateSignOut.rotation.y = Math.PI / 2;
  gateGroup.add(gateSignOut);

  const gateSignIn = new THREE.Mesh(new THREE.PlaneGeometry(GATE_OPENING + 0.8, 1.12), gateSignMat);
  gateSignIn.position.set(-0.33, 4.7, 0);
  gateSignIn.rotation.y = -Math.PI / 2;
  gateGroup.add(gateSignIn);

  // Automatic Barrier Boom Gate
  const barrierPost = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 1.1, 0.38),
    new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.38, metalness: 0.32 })
  );
  barrierPost.position.set(-1.35, 0.55, -GATE_OPENING / 2 + 0.5);
  gateGroup.add(barrierPost);
  const barrierArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, GATE_OPENING - 1.1),
    safetyYellowMat
  );
  barrierArm.position.set(-1.35, 0.96, 0);
  gateGroup.add(barrierArm);
  group.add(gateGroup);

  // 4b. Container 20 feet Kiểm soát Face ID (8) — Composite Engineering Checkpoint right inside Gate (7)
  {
    const faceIdGroup = new THREE.Group();
    faceIdGroup.position.set(36.8, PLINTH_H + 0.02, GATE_Z - 3.9);

    // Concrete foundation pad
    const fPad = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.16, 4.6), buildingDeckMat);
    fPad.position.set(0, 0.08, 0.6);
    fPad.receiveShadow = true;
    faceIdGroup.add(fPad);

    // 20ft ISO Ribbed Security Container Hull (~6.0m × 2.44m scaled -> 3.6 × 2.45 × 1.85)
    const fHull = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.45, 1.9), containerFaceIdMat);
    fHull.position.set(0, 0.16 + 1.225, -0.35);
    fHull.castShadow = castShadows;
    fHull.receiveShadow = true;
    faceIdGroup.add(fHull);

    // Observation Glass Bay
    const fGlass = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.98), windowGlassMat);
    fGlass.position.set(0, 0.16 + 1.48, -0.35);
    faceIdGroup.add(fGlass);

    // Overhead Shaded Turnstile Canopy extending over pedestrian Face ID lane
    const fCanopy = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 3.8), canopyRoofMat);
    fCanopy.position.set(0, 0.16 + 2.55, 0.45);
    fCanopy.castShadow = castShadows;
    faceIdGroup.add(fCanopy);

    // 3 Stainless-steel Face ID Tripod Turnstile Pedestals
    [-1.1, 0, 1.1].forEach(tx => {
      const turnstile = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.95, 0.95), inoxTankMat);
      turnstile.position.set(tx, 0.16 + 0.48, 1.55);
      faceIdGroup.add(turnstile);
      const scanner = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.34, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0284c7, emissiveIntensity: 0.45 })
      );
      scanner.position.set(tx, 0.16 + 1.18, 1.55);
      faceIdGroup.add(scanner);
    });

    // Rooftop AC condenser
    const fAc = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, 0.4), acUnitMat);
    fAc.position.set(-1.35, 0.16 + 2.84, -0.4);
    faceIdGroup.add(fAc);

    // Signage
    const fTex = createPlaqueTexture(
      'KIỂM SOÁT FACE ID (8)',
      { subtext: 'Container 20ft · Cổng kiểm soát ra vào', bg: '#0f172a', border: '#38bdf8', width: 320, height: 88, fontSize: 24, maxAnisotropy },
      plaqueTexCache
    );
    const fPlaque = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 0.96),
      new THREE.MeshStandardMaterial({ map: fTex, roughness: 0.34 })
    );
    fPlaque.position.set(0, 0.16 + 3.15, 2.32);
    faceIdGroup.add(fPlaque);
    group.add(faceIdGroup);
  }

  // 4c. Khu Thăm Thân (5) — Visitor Reception Pavilion just South-West of Main Gate / North Staging
  {
    const visitGroup = new THREE.Group();
    visitGroup.position.set(37.6, PLINTH_H + 0.02, GATE_Z + 4.8);

    const vSlab = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.18, 3.6), buildingDeckMat);
    vSlab.position.y = 0.09;
    vSlab.receiveShadow = true;
    visitGroup.add(vSlab);

    // 4 steel corner posts
    [
      [-1.9, -1.5],
      [1.9, -1.5],
      [-1.9, 1.5],
      [1.9, 1.5],
    ].forEach(([px, pz]) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), steelMat);
      p.position.set(px, 0.18 + 1.25, pz);
      p.castShadow = castShadows;
      visitGroup.add(p);
    });

    // Pitched visitor pavilion roof
    const vRoofGeo = createPitchedGableRoofGeometry(4.9, 4.1, 0.72, 0.12);
    const vRoof = new THREE.Mesh(vRoofGeo, diningRoofMat);
    vRoof.position.set(0, 0.18 + 2.48, 0);
    vRoof.castShadow = castShadows;
    visitGroup.add(vRoof);

    // 2 Visitor seating tables inside
    [-0.95, 0.95].forEach(tx => {
      const tbl = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.72, 0.95), diningTableMat);
      tbl.position.set(tx, 0.18 + 0.36, 0);
      visitGroup.add(tbl);
    });

    const vTex = createPlaqueTexture(
      'KHU THĂM THÂN (5)',
      { subtext: 'Nhà đón tiếp người nhà công nhân', bg: '#0f172a', border: '#10b981', width: 300, height: 84, fontSize: 24, maxAnisotropy },
      plaqueTexCache
    );
    const vSign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 0.9),
      new THREE.MeshStandardMaterial({ map: vTex, roughness: 0.35 })
    );
    vSign.position.set(2.26, 0.18 + 2.25, 0);
    vSign.rotation.y = Math.PI / 2;
    visitGroup.add(vSign);
    group.add(visitGroup);
  }

  // ── 5. Batched InstancedMesh Collectors (Zero Draw-Call Bloat!) ──
  const doorMatrices: THREE.Matrix4[] = [];
  const windowMatrices: THREE.Matrix4[] = [];
  const acUnitMatrices: THREE.Matrix4[] = [];
  const pillarMatrices: THREE.Matrix4[] = [];
  const diningTableMatrices: THREE.Matrix4[] = [];
  const diningColumnMatrices: THREE.Matrix4[] = [];
  const parkingColumnMatrices: THREE.Matrix4[] = [];
  const motoMatrices: THREE.Matrix4[] = [];
  const wcFemaleMatrices: THREE.Matrix4[] = [];
  const wcMaleMatrices: THREE.Matrix4[] = [];
  const laundryMatrices: THREE.Matrix4[] = [];
  const wcTankMatrices: THREE.Matrix4[] = [];

  const _bldMatWorld = new THREE.Matrix4();
  const _localMat = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _upAxis = new THREE.Vector3(0, 1, 0);

  // ── 6. Build the 6 Dormitory Rows (1) & (2) — Single-Story, Pitched Corrugated Gable Roofs ──
  const ROOM_H = 2.45;
  const FLOOR_SLAB_H = 0.24;

  const slots = assignBuildingsToSixVinconsSlots(ktxNodes);

  slots.forEach(slot => {
    const southBld = slot.southWing;
    const northBld = slot.northWing;
    const isEmptyPlaceholder = !southBld && !northBld;
    const singleBigBuildingSplit = Boolean(southBld && !northBld && southBld.rooms.length > 16);
    const isDoubleSided = Boolean(southBld && northBld) || singleBigBuildingSplit;

    // Single-story full-depth 15-room bar matches Vincons Shopdrawing VHM.PVT.CTT.KTX-00 (6 rows × 15 rooms)
    const wingRoomD = isDoubleSided ? 2.4 : 4.25;
    const wingCorridorD = isDoubleSided ? 0.85 : 1.15;
    const spineWallT = isDoubleSided ? 0.2 : 0;
    const bldTotalD = isDoubleSided
      ? (wingRoomD + wingCorridorD) * 2 + spineWallT
      : wingRoomD + wingCorridorD;

    let southRooms: CampusRoomNode[] = [];
    let northRooms: CampusRoomNode[] = [];
    if (southBld && northBld) {
      southRooms = southBld.rooms;
      northRooms = northBld.rooms;
    } else if (singleBigBuildingSplit && southBld) {
      const half = Math.ceil(southBld.rooms.length / 2);
      southRooms = southBld.rooms.slice(0, half);
      northRooms = southBld.rooms.slice(half);
    } else if (southBld) {
      southRooms = southBld.rooms;
    }

    const southPlan = assignFixedRoomBays(southRooms, 15);
    const northPlan = isDoubleSided
      ? assignFixedRoomBays(northRooms, 15)
      : { assigned: [], slotCount: 0 };

    const maxRoomsPerSide = isEmptyPlaceholder
      ? 15
      : Math.max(15, southPlan.slotCount, northPlan.slotCount);

    const roomPitch = Math.min(3.15, DORM_MAX_SPAN_W / Math.max(1, maxRoomsPerSide));
    const roomW = Math.max(1.75, roomPitch - 0.16);
    const bldW = Math.max(34.8, maxRoomsPerSide * roomPitch + 0.9);

    const bldWorldX = DORM_CENTER_X;
    const bldWorldZ = slot.z;
    const bldBaseY = PLINTH_H + 0.02;

    const bldGroup = new THREE.Group();
    bldGroup.name = `vincons-dorm-row-${slot.slotIndex + 1}`;
    bldGroup.position.set(bldWorldX, bldBaseY, bldWorldZ);
    group.add(bldGroup);

    _quat.setFromAxisAngle(_upAxis, 0);
    _bldMatWorld.compose(
      new THREE.Vector3(bldWorldX, bldBaseY, bldWorldZ),
      _quat,
      new THREE.Vector3(1, 1, 1)
    );

    // Raised concrete foundation slab + front rainwater drainage trench
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(bldW + 0.55, FLOOR_SLAB_H, bldTotalD + 0.4),
      buildingDeckMat
    );
    deck.position.set(0, FLOOR_SLAB_H / 2, 0);
    deck.receiveShadow = true;
    bldGroup.add(deck);

    const drainGrate = new THREE.Mesh(
      new THREE.BoxGeometry(bldW + 0.6, 0.05, 0.28),
      drainTrenchMat
    );
    drainGrate.position.set(0, 0.03, bldTotalD / 2 + 0.34);
    bldGroup.add(drainGrate);

    if (isDoubleSided) {
      const spineWall = new THREE.Mesh(
        new THREE.BoxGeometry(bldW - 0.3, ROOM_H, spineWallT),
        buildingDeckMat
      );
      spineWall.position.set(0, FLOOR_SLAB_H + ROOM_H / 2, 0);
      bldGroup.add(spineWall);
    }

    // Ground-floor galvanized steel veranda walkway columns (16 posts aligned to 15 room bays)
    const pillarCount = Math.min(maxRoomsPerSide + 1, 16);
    const pillarSides = isDoubleSided ? [bldTotalD / 2 - 0.1, -bldTotalD / 2 + 0.1] : [bldTotalD / 2 - 0.1];
    pillarSides.forEach(pz => {
      for (let p = 0; p < pillarCount; p++) {
        const px = -bldW / 2 + (p * bldW) / (pillarCount - 1);
        _tmpObj.position.set(px, FLOOR_SLAB_H + (ROOM_H + 0.12) / 2, pz);
        _tmpObj.rotation.set(0, 0, 0);
        _tmpObj.scale.setScalar(1);
        _tmpObj.updateMatrix();
        _localMat.multiplyMatrices(_bldMatWorld, _tmpObj.matrix);
        pillarMatrices.push(_localMat.clone());
      }
    });

    // True Extruded Pitched Gable Corrugated Metal Roof inside `roofsGroup` (0ms "Ẩn mái" toggle!)
    const roofBaseY = FLOOR_SLAB_H + ROOM_H + 0.04;
    const roofSpanZ = bldTotalD + 1.15;
    const roofRidgeRise = isDoubleSided ? 1.12 : 0.92;
    const bldRoofGroup = new THREE.Group();
    bldRoofGroup.position.set(bldWorldX, bldBaseY + roofBaseY, bldWorldZ);

    const roofGeo = createPitchedGableRoofGeometry(bldW + 1.1, roofSpanZ, roofRidgeRise, 0.14);
    const roofMain = new THREE.Mesh(roofGeo, dormRoofMat);
    roofMain.castShadow = castShadows;
    roofMain.receiveShadow = true;
    bldRoofGroup.add(roofMain);

    // Metallic ridge cap flashing along full peak
    const ridgeCap = new THREE.Mesh(
      new THREE.BoxGeometry(bldW + 1.16, 0.14, 0.42),
      roofTrimMat
    );
    ridgeCap.position.set(0, 0.14 + roofRidgeRise + 0.04, 0);
    bldRoofGroup.add(ridgeCap);

    // Galvanized eaves gutters / fascia along South & North eaves
    [roofSpanZ / 2 + 0.02, -roofSpanZ / 2 - 0.02].forEach(ez => {
      const gutter = new THREE.Mesh(new THREE.BoxGeometry(bldW + 1.12, 0.14, 0.12), roofTrimMat);
      gutter.position.set(0, 0.07, ez);
      bldRoofGroup.add(gutter);
    });

    roofsGroup.add(bldRoofGroup);

    // Shared room geometries sized cleanly for this single-story block
    const roomBodyGeo = new THREE.BoxGeometry(roomW, ROOM_H, wingRoomD);
    const stripGeo = new THREE.BoxGeometry(roomW - 0.12, 0.12, 0.14);
    const roomPlaqueGeo = new THREE.PlaneGeometry(Math.min(1.52, roomW * 0.74), 0.58);

    const southRoomZ = isDoubleSided ? spineWallT / 2 + wingRoomD / 2 : -wingCorridorD / 2;
    const northRoomZ = -(spineWallT / 2 + wingRoomD / 2);

    const pushLocalInst = (list: THREE.Matrix4[], x: number, y: number, z: number) => {
      _tmpObj.position.set(x, y, z);
      _tmpObj.rotation.set(0, 0, 0);
      _tmpObj.scale.setScalar(1);
      _tmpObj.updateMatrix();
      _localMat.multiplyMatrices(_bldMatWorld, _tmpObj.matrix);
      list.push(_localMat.clone());
    };

    const renderRoomMesh = (
      room: CampusRoomNode,
      slotIdx: number,
      totalSlots: number,
      facing: 'south' | 'north'
    ) => {
      // Respect layer toggles while preserving fixed physical bay coordinates of neighboring rooms
      if (!room.isVisible && !showHiddenRooms) return;
      if (room.roomType === 'functional' && room.isVisible && !showFunctionalRooms) return;

      // Official Vincons direction: P.1 starts at East (+X, nearest Main Gate & Spine Road) -> P.15 at West (-X)
      const eastStartX = ((totalSlots - 1) * roomPitch) / 2;
      const rx = eastStartX - slotIdx * roomPitch;
      const rz = facing === 'south' ? southRoomZ : northRoomZ;
      const dir = facing === 'south' ? 1 : -1;
      const spec = resolveRoomColor(room, colorMode, unitFilter, theme, assignedOnly);
      const isHiddenRoom = !room.isVisible;
      const isFuncRoom = room.roomType === 'functional';

      const bodyMat = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.54,
        metalness: 0.12,
        emissive: spec.emissive,
        emissiveIntensity: spec.emissiveIntensity,
        transparent: spec.opacity < 0.99,
        opacity: spec.opacity,
        depthWrite: spec.opacity >= 0.99,
      });

      const bodyMesh = new THREE.Mesh(roomBodyGeo, bodyMat);
      bodyMesh.position.set(rx, FLOOR_SLAB_H + ROOM_H / 2, rz);
      bodyMesh.castShadow = castShadows && !isHiddenRoom;
      bodyMesh.receiveShadow = true;
      bodyMesh.userData = { type: 'room', roomKey: room.key };
      bldGroup.add(bodyMesh);
      hitTargets.push(bodyMesh);

      if (!isHiddenRoom) {
        const frontFaceZ = rz + dir * (wingRoomD / 2 + 0.02);
        pushLocalInst(doorMatrices, rx - dir * roomW * 0.22, FLOOR_SLAB_H + 0.8, frontFaceZ);
        pushLocalInst(windowMatrices, rx + dir * roomW * 0.2, FLOOR_SLAB_H + 1.38, frontFaceZ);
        // Wall-mounted AC outdoor condenser unit per room (cục nóng điều hòa)
        pushLocalInst(acUnitMatrices, rx + dir * roomW * 0.26, FLOOR_SLAB_H + 0.42, frontFaceZ + dir * 0.15);
        if (!isDoubleSided) {
          pushLocalInst(windowMatrices, rx, FLOOR_SLAB_H + 1.38, rz - wingRoomD / 2 - 0.02);
        }
      }

      const stripMat = new THREE.MeshStandardMaterial({
        color: spec.color,
        emissive: spec.color,
        emissiveIntensity: spec.opacity < 0.5 ? 0.05 : 0.45,
        roughness: 0.25,
        metalness: 0.3,
      });
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(rx, FLOOR_SLAB_H + ROOM_H - 0.14, rz + dir * (wingRoomD / 2 + 0.06));
      bldGroup.add(strip);

      const shortNote = room.ghiChu ? room.ghiChu.slice(0, 12) : '';
      const ratioText = isHiddenRoom
        ? 'Đang ẩn'
        : isFuncRoom
          ? shortNote || 'Chức năng'
          : `${room.occupied}/${room.capacity}`;
      const plaqueBorder = isHiddenRoom
        ? '#64748b'
        : isFuncRoom
          ? '#a78bfa'
          : room.overflow > 0
            ? '#f43f5e'
            : room.vacant > 0
              ? '#10b981'
              : '#f59e0b';
      const plaqueBg = isHiddenRoom ? '#1e293b' : isFuncRoom ? '#1e1038' : '#0b1220';
      const pKey = `${room.roomLabel}|${ratioText}|${plaqueBorder}|${plaqueBg}`;
      let pMat = roomPlaqueMatCache.get(pKey);
      if (!pMat) {
        const tex = createPlaqueTexture(
          room.roomLabel,
          {
            subtext: ratioText,
            bg: plaqueBg,
            border: plaqueBorder,
            width: 192,
            height: 88,
            fontSize: 30,
            maxAnisotropy,
          },
          plaqueTexCache
        );
        pMat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.4,
          metalness: 0.1,
          transparent: isHiddenRoom,
          opacity: isHiddenRoom ? 0.72 : 1,
        });
        roomPlaqueMatCache.set(pKey, pMat);
      }
      const rPlaque = new THREE.Mesh(roomPlaqueGeo, pMat);
      rPlaque.position.set(rx, FLOOR_SLAB_H + ROOM_H + 0.06, rz + dir * (wingRoomD / 2 + 0.34));
      if (facing === 'south') {
        rPlaque.rotation.x = -0.55;
      } else {
        rPlaque.rotation.y = Math.PI;
        rPlaque.rotation.x = 0.55;
      }
      bldGroup.add(rPlaque);

      const worldCenter = new THREE.Vector3(rx, FLOOR_SLAB_H + ROOM_H / 2, rz).applyMatrix4(
        _bldMatWorld
      );
      roomVisuals.set(room.key, {
        room,
        bodyMesh,
        bodyMat,
        stripMat,
        worldCenter,
      });
    };

    if (isEmptyPlaceholder) {
      // Architectural 1-story full-depth blueprint rows (15 rooms/dãy × 6 dãy = 90 rooms · 1.800 chỗ)
      const placeholderCount = 15;
      const eastStartX = ((placeholderCount - 1) * roomPitch) / 2;
      const rz = southRoomZ;
      for (let i = 0; i < placeholderCount; i++) {
        const rx = eastStartX - i * roomPitch;
        const body = new THREE.Mesh(roomBodyGeo, emptyShellMat);
        body.position.set(rx, FLOOR_SLAB_H + ROOM_H / 2, rz);
        body.castShadow = castShadows;
        body.receiveShadow = true;
        bldGroup.add(body);
        const frontFaceZ = rz + (wingRoomD / 2 + 0.02);
        pushLocalInst(doorMatrices, rx - roomW * 0.22, FLOOR_SLAB_H + 0.8, frontFaceZ);
        pushLocalInst(windowMatrices, rx + roomW * 0.2, FLOOR_SLAB_H + 1.38, frontFaceZ);
        pushLocalInst(acUnitMatrices, rx + roomW * 0.26, FLOOR_SLAB_H + 0.42, frontFaceZ + 0.15);
        pushLocalInst(windowMatrices, rx, FLOOR_SLAB_H + 1.38, rz - wingRoomD / 2 - 0.02);
      }
    } else {
      southPlan.assigned.forEach(({ room, slotIdx }) => {
        renderRoomMesh(room, slotIdx, maxRoomsPerSide, 'south');
      });
      northPlan.assigned.forEach(({ room, slotIdx }) => {
        renderRoomMesh(room, slotIdx, maxRoomsPerSide, 'north');
      });

      const registerVisual = (b: CampusBuildingNode, zOffset: number) => {
        buildingVisuals.set(b.key, {
          building: b,
          worldCenter: new THREE.Vector3(bldWorldX, bldBaseY + FLOOR_SLAB_H + ROOM_H * 0.5, bldWorldZ + zOffset),
          radius: Math.max(9, Math.hypot(bldW / 2, bldTotalD / 2) * 1.05),
          builtX: Math.round(bldWorldX * 10) / 10,
          builtZ: Math.round(bldWorldZ * 10) / 10,
          builtRotationDeg: 0,
        });
      };
      if (southBld) registerVisual(southBld, isDoubleSided ? wingRoomD * 0.5 : 0);
      if (northBld) registerVisual(northBld, -wingRoomD * 0.5);
    }

    // Dual-end Clickable Building Signboards (East & West Gables)
    const activeBlds = [southBld, northBld].filter((b): b is CampusBuildingNode => Boolean(b));
    const occSum = activeBlds.reduce((s, b) => s + b.totalOccupied, 0);
    const capSum = activeBlds.reduce((s, b) => s + b.totalCapacity, 0);
    const vacSum = Math.max(0, capSum - occSum);
    const funcSum = activeBlds.reduce(
      (s, b) => s + b.rooms.filter(r => r.isVisible && r.roomType === 'functional').length,
      0
    );
    const hiddenSum = activeBlds.reduce(
      (s, b) => s + b.rooms.filter(r => !r.isVisible).length,
      0
    );
    const primaryBld = southBld || northBld;
    const legendTag = slot.slotIndex === 0 ? '(1)(2)' : '(1)';
    const signTitle = primaryBld
      ? northBld
        ? `Dãy ${slot.slotIndex + 1} · ${legendTag}`
        : `${primaryBld.day} · ${legendTag}`
      : slot.labelOverride;
    const extraTags = [
      funcSum > 0 ? `${funcSum} CN` : null,
      hiddenSum > 0 ? `${hiddenSum} ẩn` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const signSub = primaryBld
      ? `${occSum}/${capSum} chỗ · ${extraTags || `Trống ${vacSum}`}`
      : slot.slotIndex === 0
        ? 'Khu Nam (1) & Nữ (2) · 15 phòng'
        : 'Nhà ở công nhân (1) · 15 phòng';

    const bldSignTex = createPlaqueTexture(
      signTitle,
      {
        subtext: signSub,
        bg: '#0f172a',
        border: slot.slotIndex === 0 ? '#f43f5e' : '#10b981',
        width: 320,
        height: 104,
        fontSize: 30,
        maxAnisotropy,
      },
      plaqueTexCache
    );
    const bldSignMat = new THREE.MeshStandardMaterial({ map: bldSignTex, roughness: 0.35, metalness: 0.1 });
    const bldSignGeo = new THREE.PlaneGeometry(3.2, 1.04);
    const gableOffset = bldW / 2 + 0.24;

    const signW = new THREE.Mesh(bldSignGeo, bldSignMat);
    signW.position.set(-gableOffset, FLOOR_SLAB_H + ROOM_H * 0.62, 0);
    signW.rotation.y = -Math.PI / 2;
    if (primaryBld) {
      signW.userData = { type: 'building', buildingKey: primaryBld.key };
      buildingHitTargets.push(signW);
    }
    bldGroup.add(signW);

    const signE = new THREE.Mesh(bldSignGeo, bldSignMat);
    signE.position.set(gableOffset, FLOOR_SLAB_H + ROOM_H * 0.62, 0);
    signE.rotation.y = Math.PI / 2;
    if (primaryBld) {
      signE.userData = { type: 'building', buildingKey: primaryBld.key };
      buildingHitTargets.push(signE);
    }
    bldGroup.add(signE);
  });

  // ── 7. Two Central Dining Halls (3) + West & East Gian Soạn Đồ Ăn (4) ──
  const DINING_HALL_W = 28.0;
  const KITCHEN_W = 4.2;
  const DINING_D = 6.2;
  const DINING_H = 3.25;

  DINING_SLOT_ZS.forEach((dz, idx) => {
    const hallCenterX = DORM_CENTER_X;
    const westKitchenX = hallCenterX - DINING_HALL_W / 2 - KITCHEN_W / 2 - 0.14;
    const eastKitchenX = hallCenterX + DINING_HALL_W / 2 + KITCHEN_W / 2 + 0.14;
    const baseY = PLINTH_H + 0.02;

    const dbFunc = diningDbNodes[idx];
    const funcKey = dbFunc ? dbFunc.key : `vincons-dining-${idx + 1}`;
    const funcNode: FunctionalAreaNode = dbFunc || {
      key: funcKey,
      ktx: 'KTX Phước Vĩnh Tây',
      day: 'Khu trung tâm',
      name: `Nhà ăn ${idx + 1} + Sinh hoạt cộng đồng (3) & 2 Gian soạn đồ ăn (4)`,
      ghiChu: 'Hạng mục (3) Nhà ăn + Sinh hoạt cộng đồng kèm 2 đầu (4) Gian soạn đồ ăn theo VHM.PVT.CTT.KTX-00',
      facility: {
        ktx: 'KTX Phước Vĩnh Tây',
        day: 'Khu trung tâm',
        phong_khu_vuc: `Nhà ăn ${idx + 1}`,
        room_type: 'functional',
        giuong: 0,
        dieu_hoa: 0,
        tu: 0,
        quat: 24,
        o_cam: 12,
        remote: 0,
        bong_tuyp: 40,
        ban_an: 64,
        ghe_an: 384,
      },
    };
    functionalLookup.set(funcKey, funcNode);

    const hallGroup = new THREE.Group();
    hallGroup.position.set(0, baseY, dz);

    // Concrete dining floor slab spanning West Gian soạn (4) + Dining Hall (3) + East Gian soạn (4)
    const totalSpanW = DINING_HALL_W + KITCHEN_W * 2 + 0.32;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(totalSpanW + 0.55, 0.24, DINING_D + 0.55),
      buildingDeckMat
    );
    slab.position.set(hallCenterX, 0.12, 0);
    slab.receiveShadow = true;
    hallGroup.add(slab);

    // Open-air ventilated low perimeter walls (reveals tables inside!)
    const lowWallMat = new THREE.MeshStandardMaterial({
      color: isLight ? 0xe2e8f0 : 0x334155,
      roughness: 0.65,
      metalness: 0.12,
    });
    [-DINING_D / 2 + 0.1, DINING_D / 2 - 0.1].forEach(wz => {
      const lowWall = new THREE.Mesh(new THREE.BoxGeometry(DINING_HALL_W, 1.05, 0.18), lowWallMat);
      lowWall.position.set(hallCenterX, 0.24 + 0.525, wz);
      lowWall.castShadow = castShadows;
      lowWall.receiveShadow = true;
      lowWall.userData = { type: 'functional', functionalKey: funcKey };
      hallGroup.add(lowWall);
      functionalHitTargets.push(lowWall);
    });

    // Clickable hit volume
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(DINING_HALL_W, DINING_H, DINING_D),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
    );
    hitBox.position.set(hallCenterX, 0.24 + DINING_H / 2, 0);
    hitBox.userData = { type: 'functional', functionalKey: funcKey };
    hallGroup.add(hitBox);
    functionalHitTargets.push(hitBox);

    // Steel portal columns
    const colCount = 10;
    for (let c = 0; c < colCount; c++) {
      const cx = hallCenterX - DINING_HALL_W / 2 + (c * DINING_HALL_W) / (colCount - 1);
      [-DINING_D / 2 + 0.12, DINING_D / 2 - 0.12].forEach(cz => {
        _tmpObj.position.set(cx, baseY + 0.24 + DINING_H / 2, dz + cz);
        _tmpObj.rotation.set(0, 0, 0);
        _tmpObj.scale.setScalar(1);
        _tmpObj.updateMatrix();
        diningColumnMatrices.push(_tmpObj.matrix.clone());
      });
    }

    // Interior canteen tables & benches (instanced)
    const tableCols = 10;
    for (let t = 0; t < tableCols; t++) {
      const tx = hallCenterX - DINING_HALL_W / 2 + 1.8 + t * ((DINING_HALL_W - 3.6) / (tableCols - 1));
      [-1.55, 1.55].forEach(tz => {
        _tmpObj.position.set(tx, baseY + 0.24 + 0.42, dz + tz);
        _tmpObj.rotation.set(0, 0, 0);
        _tmpObj.scale.setScalar(1);
        _tmpObj.updateMatrix();
        diningTableMatrices.push(_tmpObj.matrix.clone());
      });
    }

    // Dual Enclosed Gian Soạn Đồ Ăn (4) on BOTH West & East ends
    [westKitchenX, eastKitchenX].forEach(kx => {
      const kitchenBody = new THREE.Mesh(
        new THREE.BoxGeometry(KITCHEN_W, DINING_H, DINING_D),
        kitchenWallMat
      );
      kitchenBody.position.set(kx, 0.24 + DINING_H / 2, 0);
      kitchenBody.castShadow = castShadows;
      kitchenBody.receiveShadow = true;
      kitchenBody.userData = { type: 'functional', functionalKey: funcKey };
      hallGroup.add(kitchenBody);
      functionalHitTargets.push(kitchenBody);

      // Stainless serving counter pass-through shutter facing interior dining hall
      const inwardDir = kx < hallCenterX ? 1 : -1;
      const counter = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.92, DINING_D - 1.4), inoxTankMat);
      counter.position.set(kx + inwardDir * (KITCHEN_W / 2 + 0.08), 0.24 + 0.98, 0);
      hallGroup.add(counter);

      // Amber safety architectural band
      const kAccent = new THREE.Mesh(
        new THREE.BoxGeometry(KITCHEN_W + 0.08, 0.24, DINING_D + 0.08),
        safetyYellowMat
      );
      kAccent.position.set(kx, 0.24 + DINING_H - 0.2, 0);
      hallGroup.add(kAccent);

      // Twin stainless rooftop exhaust turbines (quả cầu thông gió inox)
      [-1.4, 1.4].forEach(vz => {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.55, 10), steelMat);
        neck.position.set(kx, 0.24 + DINING_H + 1.12, vz);
        hallGroup.add(neck);
        const turbine = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), inoxTankMat);
        turbine.position.set(kx, 0.24 + DINING_H + 1.52, vz);
        hallGroup.add(turbine);
      });
    });

    // Dining Hall & Serving Wing Signage
    const dSignTex = createPlaqueTexture(
      dbFunc ? dbFunc.name.toUpperCase() : `NHÀ ĂN ${idx + 1} · SHCĐ (3)`,
      {
        subtext: 'Nhà ăn + Sinh hoạt cộng đồng · 2 Gian soạn đồ ăn (4)',
        bg: '#172554',
        border: '#f59e0b',
        width: 390,
        height: 102,
        fontSize: 28,
        maxAnisotropy,
      },
      plaqueTexCache
    );
    const dSignMat = new THREE.MeshStandardMaterial({ map: dSignTex, roughness: 0.34 });
    const dSignEast = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.16), dSignMat);
    dSignEast.position.set(eastKitchenX + KITCHEN_W / 2 + 0.16, 0.24 + DINING_H * 0.65, 0);
    dSignEast.rotation.y = Math.PI / 2;
    hallGroup.add(dSignEast);

    const kSignTex = createPlaqueTexture(
      'GIAN SOẠN ĐỒ ĂN (4)',
      { subtext: `Nhà ăn ${idx + 1}`, bg: '#1e1b4b', border: '#f59e0b', width: 280, height: 84, fontSize: 24, maxAnisotropy },
      plaqueTexCache
    );
    const kSignWest = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.96),
      new THREE.MeshStandardMaterial({ map: kSignTex, roughness: 0.35 })
    );
    kSignWest.position.set(westKitchenX - KITCHEN_W / 2 - 0.14, 0.24 + DINING_H * 0.62, 0);
    kSignWest.rotation.y = -Math.PI / 2;
    hallGroup.add(kSignWest);

    functionalGroup.add(hallGroup);

    // Wide-Span Extruded Pitched Metal Roof + Raised Ridge Monitor Ventilator inside `roofsGroup`
    const dRoofGroup = new THREE.Group();
    dRoofGroup.position.set(hallCenterX, baseY + 0.24 + DINING_H + 0.02, dz);
    const dRoofSpanZ = DINING_D + 1.3;
    const dRoofRise = 1.28;
    const dRoofMain = new THREE.Mesh(
      createPitchedGableRoofGeometry(totalSpanW + 1.15, dRoofSpanZ, dRoofRise, 0.16),
      diningRoofMat
    );
    dRoofMain.castShadow = castShadows;
    dRoofMain.receiveShadow = true;
    dRoofGroup.add(dRoofMain);

    // Raised Ridge Louver Ventilator Skylight Monitor (authentic industrial dining hall ventilation!)
    const ventMonitor = new THREE.Mesh(
      new THREE.BoxGeometry(DINING_HALL_W - 1.2, 0.42, 1.35),
      steelMat
    );
    ventMonitor.position.set(0, 0.16 + dRoofRise + 0.14, 0);
    dRoofGroup.add(ventMonitor);
    const ventCap = new THREE.Mesh(
      createPitchedGableRoofGeometry(DINING_HALL_W - 0.6, 1.75, 0.32, 0.08),
      roofTrimMat
    );
    ventCap.position.set(0, 0.16 + dRoofRise + 0.32, 0);
    dRoofGroup.add(ventCap);

    roofsGroup.add(dRoofGroup);
  });

  // ── 8. West Engineering & Sanitary Zone: (19) XLNT, (10) Bồn Inox 20m³, (11)(12) Composite, (13–17) WC/Tắm/Giặt, (18) Nhà Rác, (7A) ──
  // 8a. Twin 50m³/h Wastewater Treatment Plant Basins — (19) BỒN XỬ LÝ NƯỚC THẢI 50M3/H (BỂ XLNT)
  [-33.6, -24.2].forEach((wz, idx) => {
    const basinGroup = new THREE.Group();
    basinGroup.position.set(-38.6, PLINTH_H + 0.02, wz);

    // Reinforced concrete aeration basin walls
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.42, 7.2), buildingDeckMat);
    wall.position.y = 0.71;
    wall.castShadow = castShadows;
    wall.receiveShadow = true;
    basinGroup.add(wall);

    // Twin aerated cyan wastewater treatment chambers
    [-1.7, 1.7].forEach(pz => {
      const pool = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 2.95), waterMat);
      pool.position.set(0, 1.38, pz);
      basinGroup.add(pool);
    });

    // Center galvanized catwalk grating + safety-yellow handrail bars
    const catwalk = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.12, 0.62), steelMat);
    catwalk.position.set(0, 1.48, 0);
    basinGroup.add(catwalk);

    [-0.28, 0.28].forEach(rz => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.06, 0.06), safetyYellowMat);
      rail.position.set(0, 2.15, rz);
      basinGroup.add(rail);
    });
    [-2.3, 0, 2.3].forEach(rx => {
      [-0.28, 0.28].forEach(rz => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.68, 6), safetyYellowMat);
        post.position.set(rx, 1.82, rz);
        basinGroup.add(post);
      });
    });

    // Air-blower cabinet & vertical FRP clarifier cylinder
    const blower = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.15, 0.9), utilityCabinMat);
    blower.position.set(-1.7, 2.02, -2.6);
    basinGroup.add(blower);

    const clarifier = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.8, 14), frpTankMat);
    clarifier.position.set(1.5, 2.3, -2.4);
    clarifier.castShadow = castShadows;
    basinGroup.add(clarifier);

    const wTex = createPlaqueTexture(
      `BỂ XLNT 50M³/H (19)`,
      { subtext: `Module xử lý nước thải #${idx + 1}`, bg: '#083344', border: '#22d3ee', width: 280, height: 84, fontSize: 24, maxAnisotropy },
      plaqueTexCache
    );
    const wSign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.98),
      new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.34 })
    );
    wSign.position.set(0, 2.45, 3.66);
    basinGroup.add(wSign);

    group.add(basinGroup);
  });

  // 8b. (11) Bể Tự Hoại Composite (2×5m³) & (12) Bể Composite Bơm Nước Thải (directly South of BỂ XLNT)
  {
    const septicGroup = new THREE.Group();
    septicGroup.position.set(-38.6, PLINTH_H + 0.02, -16.8);

    const pad = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.14, 5.2), buildingDeckMat);
    pad.position.y = 0.07;
    pad.receiveShadow = true;
    septicGroup.add(pad);

    // 2× 5m³ Horizontal Ribbed FRP Composite Septic Tanks (11)
    [-1.15, 0.75].forEach(tz => {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 3.6, 16), frpTankMat);
      tank.rotation.z = Math.PI / 2;
      tank.position.set(-0.3, 0.85, tz);
      tank.castShadow = castShadows;
      septicGroup.add(tank);
      // Yellow inspection manhole collar
      const manhole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.32, 10), safetyYellowMat);
      manhole.position.set(-0.3, 1.56, tz);
      septicGroup.add(manhole);
    });

    // Vertical Composite Lift-Pump Tank (12) + blue PVC pressure header pipe to WWTP (19)
    const pumpTank = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.55, 14), pvcPipeBlueMat);
    pumpTank.position.set(1.85, 0.92, -0.2);
    pumpTank.castShadow = castShadows;
    septicGroup.add(pumpTank);

    const pipeRun = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 8), pvcPipeBlueMat);
    pipeRun.rotation.x = Math.PI / 2;
    pipeRun.position.set(1.85, 1.45, -2.3);
    septicGroup.add(pipeRun);

    const sTex = createPlaqueTexture(
      'BỂ COMPOSITE (11)(12)',
      { subtext: 'Tự hoại 2×5m³ & Bơm nước thải', bg: '#042f2e', border: '#2dd4bf', width: 280, height: 80, fontSize: 22, maxAnisotropy },
      plaqueTexCache
    );
    const sSign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.94),
      new THREE.MeshStandardMaterial({ map: sTex, roughness: 0.35 })
    );
    sSign.position.set(0, 2.25, 2.65);
    septicGroup.add(sSign);
    group.add(septicGroup);
  }

  // 8c. (10) 3× Bồn Nước Inox 20m³ on Galvanized Steel Structural Towers at NW Corner!
  [-34.2, -31.1, -28.0].forEach((tx, idx) => {
    const tower = new THREE.Group();
    tower.position.set(tx, PLINTH_H + 0.02, -36.4);

    // Reinforced concrete footing pad
    const footing = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.22, 4.8), buildingDeckMat);
    footing.position.y = 0.11;
    footing.receiveShadow = true;
    tower.add(footing);

    // 4 Galvanized Steel Structural Tower Legs + Elevated Deck
    const towerH = 2.65;
    [
      [-0.95, -1.75],
      [0.95, -1.75],
      [-0.95, 1.75],
      [0.95, 1.75],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, towerH, 0.14), steelMat);
      leg.position.set(lx, 0.22 + towerH / 2, lz);
      leg.castShadow = castShadows;
      tower.add(leg);
    });

    // Horizontal steel tie-beams at mid-height and platform top
    [1.45, 2.82].forEach(hy => {
      const deckBeam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 3.85), steelMat);
      deckBeam.position.set(0, hy, 0);
      tower.add(deckBeam);
    });

    // Mirror-Polished Cylindrical SUS304 Stainless-Steel 20m³ Water Tank (horizontal cylinder + domed caps)
    const tankCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.1, 20), inoxTankMat);
    tankCyl.rotation.x = Math.PI / 2;
    tankCyl.position.set(0, 2.9 + 0.95, 0);
    tankCyl.castShadow = castShadows;
    tower.add(tankCyl);

    [-1.55, 1.55].forEach(cz => {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        inoxTankMat
      );
      dome.rotation.x = cz > 0 ? Math.PI / 2 : -Math.PI / 2;
      dome.position.set(0, 2.9 + 0.95, cz);
      tower.add(dome);
    });

    // Vertical blue inlet/outlet riser pipe
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.3, 8), pvcPipeBlueMat);
    riser.position.set(0.75, 1.8, 1.9);
    tower.add(riser);

    if (idx === 1) {
      const tTex = createPlaqueTexture(
        '3× BỒN NƯỚC INOX 20M³ (10)',
        { subtext: 'Trạm cấp nước sạch toàn KTX', bg: '#0f172a', border: '#38bdf8', width: 320, height: 84, fontSize: 23, maxAnisotropy },
        plaqueTexCache
      );
      const tSign = new THREE.Mesh(
        new THREE.PlaneGeometry(4.4, 1.1),
        new THREE.MeshStandardMaterial({ map: tTex, roughness: 0.34 })
      );
      tSign.position.set(0, 5.45, -2.5);
      tower.add(tSign);
    }

    group.add(tower);
  });

  // 8d. Khu Tắm Rửa & WC — 3 Columns of 20ft ISO Sanitary Containers:
  //     (13) WC Nữ & (14) Tắm Nữ (North rows, rose trim),
  //     (15) WC Nam & (16) Tắm Nam (South rows, blue trim),
  //     (17) Giặt Nam/Nữ (East column, emerald trim)
  const wcColXs = [-34.2, -31.2, -28.2];
  const wcRows = 7;
  for (let c = 0; c < wcColXs.length; c++) {
    for (let r = 0; r < wcRows; r++) {
      const wz = -29.8 + r * 4.25;
      _tmpObj.position.set(wcColXs[c], PLINTH_H + 0.02 + 1.18, wz);
      _tmpObj.rotation.set(0, 0, 0);
      _tmpObj.scale.setScalar(1);
      _tmpObj.updateMatrix();

      if (c === 2 && r >= 2 && r <= 4) {
        laundryMatrices.push(_tmpObj.matrix.clone()); // (17) Giặt Nam/Nữ
      } else if (r <= 1) {
        wcFemaleMatrices.push(_tmpObj.matrix.clone()); // (13) WC Nữ + (14) Tắm Nữ
      } else {
        wcMaleMatrices.push(_tmpObj.matrix.clone()); // (15) WC Nam + (16) Tắm Nam
      }

      if (r % 2 === 0 && c !== 1) {
        _tmpObj.position.set(wcColXs[c], PLINTH_H + 0.02 + 2.74, wz);
        _tmpObj.rotation.set(0, 0, Math.PI / 2);
        _tmpObj.scale.setScalar(1);
        _tmpObj.updateMatrix();
        wcTankMatrices.push(_tmpObj.matrix.clone());
      }
    }
  }
  const wcZoneTex = createPlaqueTexture(
    'KHU TẮM RỬA · WC · GIẶT (13–17)',
    { subtext: '20ft Container: WC/Tắm Nữ (13–14) · Nam (15–16) · Giặt (17)', bg: '#0f172a', border: '#38bdf8', width: 420, height: 92, fontSize: 23, maxAnisotropy },
    plaqueTexCache
  );
  const wcZoneSign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 1.38),
    new THREE.MeshStandardMaterial({ map: wcZoneTex, roughness: 0.34 })
  );
  wcZoneSign.position.set(-31.2, PLINTH_H + 3.65, -16.5);
  wcZoneSign.rotation.y = Math.PI / 2;
  group.add(wcZoneSign);

  // 8e. SW Waste Collection Zone: (18) 2× Nhà Rác & (7A) Cổng Phụ Phục Vụ Lấy Rác Thải
  const hatchTex = createHatchPadTexture(maxAnisotropy, isLight);
  const hatchMat = new THREE.MeshStandardMaterial({ map: hatchTex, roughness: 0.86, metalness: 0.05 });
  const swYard = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 27.5), hatchMat);
  swYard.position.set(-39.0, PLINTH_H + 0.08, 22.0);
  swYard.receiveShadow = true;
  group.add(swYard);

  [10.2, 18.2].forEach((cz, idx) => {
    const trashGroup = new THREE.Group();
    trashGroup.position.set(-39.0, PLINTH_H + 0.12, cz);

    const body = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.45, 4.5), trashHouseMat);
    body.position.y = 1.225;
    body.castShadow = castShadows;
    body.receiveShadow = true;
    trashGroup.add(body);

    const roof = new THREE.Mesh(createPitchedGableRoofGeometry(3.7, 4.9, 0.55, 0.1), canopyRoofMat);
    roof.position.y = 2.44;
    roof.castShadow = castShadows;
    trashGroup.add(roof);

    // Colored waste-sorting wheelie bins lined up in front
    [0x16a34a, 0xd97706, 0x2563eb].forEach((binCol, bIdx) => {
      const bin = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.82, 0.55),
        new THREE.MeshStandardMaterial({ color: binCol, roughness: 0.5 })
      );
      bin.position.set(1.95, 0.41, -1.1 + bIdx * 1.1);
      trashGroup.add(bin);
    });

    if (idx === 0) {
      const trTex = createPlaqueTexture(
        'NHÀ RÁC (18)',
        { subtext: '2 nhà tập kết rác thải', bg: '#14532d', border: '#84cc16', width: 260, height: 80, fontSize: 24, maxAnisotropy },
        plaqueTexCache
      );
      const trSign = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.96),
        new THREE.MeshStandardMaterial({ map: trTex, roughness: 0.35 })
      );
      trSign.position.set(1.75, 2.85, 0);
      trSign.rotation.y = Math.PI / 2;
      trashGroup.add(trSign);
    }
    group.add(trashGroup);
  });

  // Auxiliary Trash Gate (7A) on SW West Fence
  {
    const g7a = new THREE.Group();
    g7a.position.set(-hw, PLINTH_H + 0.02, 31.2);
    [-2.7, 2.7].forEach(pz => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.45, 0.32), steelMat);
      post.position.set(0, 1.22, pz);
      g7a.add(post);
    });
    const leafA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.85, 2.55), gateLeafBlueMat);
    leafA.position.set(0, 0.98, -1.32);
    g7a.add(leafA);
    const leafB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.85, 2.55), gateLeafBlueMat);
    leafB.position.set(0, 0.98, 1.32);
    g7a.add(leafB);

    const p7aTex = createPlaqueTexture(
      'CỔNG PHỤ LẤY RÁC (7A)',
      { subtext: 'Xe thu gom rác thải Nhà rác (18)', bg: '#0f172a', border: '#84cc16', width: 300, height: 82, fontSize: 22, maxAnisotropy },
      plaqueTexCache
    );
    const p7aSign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.0, 1.04),
      new THREE.MeshStandardMaterial({ map: p7aTex, roughness: 0.35 })
    );
    p7aSign.position.set(0.35, 3.05, 0);
    p7aSign.rotation.y = Math.PI / 2;
    g7a.add(p7aSign);
    group.add(g7a);
  }

  // ── 9. (6) 13× Nhà Để Xe Công Nhân (3 SW + 4 NE + 6 SE) & (20) 3× Căng Teen ──
  const parkTexV = createParkingBayTexture(false, maxAnisotropy, isLight);
  const parkTexH = createParkingBayTexture(true, maxAnisotropy, isLight);
  const parkPadMatV = new THREE.MeshStandardMaterial({ map: parkTexV, roughness: 0.86, metalness: 0.05 });
  const parkPadMatH = new THREE.MeshStandardMaterial({ map: parkTexH, roughness: 0.86, metalness: 0.05 });

  const addParkingShed = (
    cx: number,
    cz: number,
    w: number,
    d: number,
    horizontal: boolean
  ) => {
    const baseY = PLINTH_H + 0.02;
    const canopyH = 2.45;

    // Marked concrete parking bay pad
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, d),
      horizontal ? parkPadMatH : parkPadMatV
    );
    pad.position.set(cx, baseY + 0.05, cz);
    pad.receiveShadow = true;
    group.add(pad);

    // Pitched corrugated steel canopy roof placed inside `roofsGroup` (lifts off cleanly on "Ẩn mái"!)
    const roofSpan = horizontal ? d + 0.65 : w + 0.65;
    const roofLen = horizontal ? w + 0.55 : d + 0.55;
    const canopyGeo = createPitchedGableRoofGeometry(roofLen, roofSpan, 0.42, 0.09);
    const canopy = new THREE.Mesh(canopyGeo, canopyRoofMat);
    canopy.position.set(cx, baseY + canopyH, cz);
    if (!horizontal) canopy.rotation.y = Math.PI / 2;
    canopy.castShadow = castShadows;
    canopy.receiveShadow = true;
    roofsGroup.add(canopy);

    if (horizontal) {
      const colSteps = Math.max(3, Math.round(w / 4.8) + 1);
      for (let i = 0; i < colSteps; i++) {
        const px = cx - w / 2 + 0.2 + (i * (w - 0.4)) / (colSteps - 1);
        _tmpObj.position.set(px, baseY + canopyH / 2, cz);
        _tmpObj.rotation.set(0, 0, 0);
        _tmpObj.scale.setScalar(1);
        _tmpObj.updateMatrix();
        parkingColumnMatrices.push(_tmpObj.matrix.clone());
      }
      const motoCols = Math.floor((w - 1.2) / 1.15);
      for (let m = 0; m < motoCols; m++) {
        const mx = cx - ((motoCols - 1) * 1.15) / 2 + m * 1.15;
        [-d * 0.27, d * 0.27].forEach((mz, side) => {
          if ((m + side) % 5 === 0) return;
          _tmpObj.position.set(mx, baseY + 0.46, cz + mz);
          _tmpObj.rotation.set(0, side === 0 ? 0 : Math.PI, 0);
          _tmpObj.scale.setScalar(1);
          _tmpObj.updateMatrix();
          motoMatrices.push(_tmpObj.matrix.clone());
        });
      }
    } else {
      const colSteps = Math.max(3, Math.round(d / 4.8) + 1);
      for (let i = 0; i < colSteps; i++) {
        const pz = cz - d / 2 + 0.2 + (i * (d - 0.4)) / (colSteps - 1);
        _tmpObj.position.set(cx, baseY + canopyH / 2, pz);
        _tmpObj.rotation.set(0, 0, 0);
        _tmpObj.scale.setScalar(1);
        _tmpObj.updateMatrix();
        parkingColumnMatrices.push(_tmpObj.matrix.clone());
      }
      const motoRows = Math.floor((d - 1.2) / 1.15);
      for (let m = 0; m < motoRows; m++) {
        const mz = cz - ((motoRows - 1) * 1.15) / 2 + m * 1.15;
        [-w * 0.27, w * 0.27].forEach((mx, side) => {
          if ((m + side) % 5 === 0) return;
          _tmpObj.position.set(cx + mx, baseY + 0.46, mz);
          _tmpObj.rotation.set(0, side === 0 ? Math.PI / 2 : -Math.PI / 2, 0);
          _tmpObj.scale.setScalar(1);
          _tmpObj.updateMatrix();
          motoMatrices.push(_tmpObj.matrix.clone());
        });
      }
    }
  };

  // 9a. 3 Vertical SW Motorcycle Parking Sheds (6)
  addParkingShed(-34.6, 21.0, 2.6, 29.5, false);
  addParkingShed(-31.3, 21.0, 2.6, 29.5, false);
  addParkingShed(-28.0, 21.0, 2.6, 29.5, false);

  // 9b. 4 Vertical NE Motorcycle Parking Sheds (6)
  addParkingShed(20.6, -29.2, 3.1, 17.8, false);
  addParkingShed(24.7, -29.2, 3.1, 17.8, false);
  addParkingShed(28.8, -29.2, 3.1, 17.8, false);
  addParkingShed(32.9, -29.2, 3.1, 17.8, false);

  // 9c. (20) 3× CĂNG TEEN Pavilions along NE East Fence — Composite Mini-Marts with Striped Awnings!
  [-35.6, -29.8, -24.0].forEach((cz, idx) => {
    const cGroup = new THREE.Group();
    cGroup.position.set(38.8, PLINTH_H + 0.02, cz);

    const dbCan = canteenDbNodes[idx];
    const cKey = dbCan ? dbCan.key : `vincons-canteen-${idx + 1}`;
    const cNode: FunctionalAreaNode = dbCan || {
      key: cKey,
      ktx: 'KTX Phước Vĩnh Tây',
      day: 'Khu Đông Bắc',
      name: `Căng Teen ${idx + 1} (20)`,
      ghiChu: 'Hạng mục (20) Căng Teen phục vụ công nhân theo bản vẽ VHM.PVT.CTT.KTX-00',
      facility: {
        ktx: 'KTX Phước Vĩnh Tây',
        day: 'Khu Đông Bắc',
        phong_khu_vuc: `Căng Teen ${idx + 1}`,
        room_type: 'functional',
        giuong: 0,
        dieu_hoa: 1,
        tu: 2,
        quat: 2,
        o_cam: 4,
        remote: 1,
        bong_tuyp: 4,
        ban_an: 4,
        ghe_an: 16,
      },
    };
    functionalLookup.set(cKey, cNode);

    // Concrete patio pad
    const cPad = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 5.0), buildingDeckMat);
    cPad.position.set(-0.4, 0.07, 0);
    cPad.receiveShadow = true;
    cGroup.add(cPad);

    // Ribbed container canteen body
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.55, 4.5), canteenWallMat);
    cab.position.set(0, 0.14 + 1.275, 0);
    cab.castShadow = castShadows;
    cab.receiveShadow = true;
    cab.userData = { type: 'functional', functionalKey: cKey };
    cGroup.add(cab);
    functionalHitTargets.push(cab);

    // Glass front display counter window facing West (toward NE parking/workers)
    const displayWin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.15, 3.2), windowGlassMat);
    displayWin.position.set(-1.62, 0.14 + 1.48, 0);
    cGroup.add(displayWin);

    // Striped red/white sloped café sunshade awning
    const awning = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.1, 4.6), canteenAwningMat);
    awning.position.set(-2.22, 0.14 + 2.18, 0);
    awning.rotation.z = 0.28;
    awning.castShadow = castShadows;
    cGroup.add(awning);

    // Pitched corrugated roof
    const cRoof = new THREE.Mesh(createPitchedGableRoofGeometry(4.8, 3.6, 0.45, 0.1), canopyRoofMat);
    cRoof.rotation.y = Math.PI / 2;
    cRoof.position.set(0, 0.14 + 2.55, 0);
    cRoof.castShadow = castShadows;
    cGroup.add(cRoof);

    // Outdoor seating table
    const oTbl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.72, 1.4), diningTableMat);
    oTbl.position.set(-2.25, 0.14 + 0.36, 0);
    cGroup.add(oTbl);

    if (idx === 1) {
      const cTex = createPlaqueTexture(
        'CĂNG TEEN (20)',
        { subtext: '3 gian căng teen phục vụ KTX', bg: '#7f1d1d', border: '#fbbf24', width: 290, height: 84, fontSize: 26, maxAnisotropy },
        plaqueTexCache
      );
      const cSign = new THREE.Mesh(
        new THREE.PlaneGeometry(3.8, 1.06),
        new THREE.MeshStandardMaterial({ map: cTex, roughness: 0.34 })
      );
      cSign.position.set(-1.75, 0.14 + 3.45, 0);
      cSign.rotation.y = -Math.PI / 2;
      cGroup.add(cSign);
    }

    functionalGroup.add(cGroup);
  });

  // 9d. 6 Horizontal SE Motorcycle Parking Sheds (6)
  [-0.2, 6.4, 13.0, 19.6, 26.2, 32.8].forEach(pz => {
    addParkingShed(29.8, pz, 20.6, 4.0, true);
  });

  // SE Compound Zone Monument Signboard ("KTX PHƯỚC VĨNH TÂY · 1.800 CHỖ")
  const vinconsSignTex = createPlaqueTexture(
    'KTX PHƯỚC VĨNH TÂY · 1.800 CHỖ',
    {
      subtext: '6 Dãy × 15 Phòng × 20 Giường · Khu Lán Trại Vincons · VHM.PVT.CTT.KTX-00',
      bg: '#0f172a',
      border: '#38bdf8',
      width: 580,
      height: 116,
      fontSize: 27,
      maxAnisotropy,
    },
    plaqueTexCache
  );
  const vinconsSign = new THREE.Mesh(
    new THREE.BoxGeometry(7.6, 1.72, 0.22),
    new THREE.MeshStandardMaterial({ map: vinconsSignTex, roughness: 0.32, metalness: 0.18 })
  );
  vinconsSign.position.set(29.8, PLINTH_H + 1.9, -7.2);
  vinconsSign.castShadow = castShadows;
  group.add(vinconsSign);
  [-2.8, 2.8].forEach(px => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 1.85, 8), steelMat);
    post.position.set(29.8 + px, PLINTH_H + 0.92, -7.2);
    group.add(post);
  });

  // ── 9e. 8 Tall Galvanized Site Floodlight Masts around Perimeter ──
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfde68a,
    emissiveIntensity: isLight ? 0.3 : 1.15,
    roughness: 0.2,
  });
  [
    [-23.5, -39.2],
    [14.5, -39.2],
    [40.6, -39.2],
    [40.6, -6.5],
    [40.6, 39.2],
    [14.5, 39.2],
    [-23.5, 39.2],
    [-40.8, -2.5],
  ].forEach(([lx, lz]) => {
    const mast = new THREE.Group();
    mast.position.set(lx, PLINTH_H + 0.02, lz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 7.6, 8), steelMat);
    pole.position.y = 3.8;
    pole.castShadow = castShadows;
    mast.add(pole);
    const crossBar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), steelMat);
    crossBar.position.y = 7.55;
    mast.add(crossBar);
    [-0.38, 0.38].forEach(hx => {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.24), lampHeadMat);
      lamp.position.set(hx, 7.46, 0);
      mast.add(lamp);
    });
    group.add(mast);
  });

  // Custom Admin Landmarks (if any added in Blueprint Editor)
  blueprint.landmarks.forEach(lm => {
    group.add(buildCustomLandmark(lm, maxAnisotropy, plaqueTexCache, castShadows));
  });

  // ── 10. Commit All Batched InstancedMeshes (Zero Draw-Call Bloat!) ──
  const commitInst = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    matrices: THREE.Matrix4[],
    shadow = false,
    colorFn?: (inst: THREE.InstancedMesh, count: number) => void
  ) => {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = shadow && castShadows;
    inst.receiveShadow = true;
    if (colorFn) {
      colorFn(inst, matrices.length);
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
    inst.computeBoundingSphere();
    group.add(inst);
  };

  commitInst(new THREE.BoxGeometry(0.66, 1.56, 0.08), doorMat, doorMatrices);
  commitInst(new THREE.BoxGeometry(0.98, 0.74, 0.08), windowGlassMat, windowMatrices);
  commitInst(new THREE.BoxGeometry(0.56, 0.42, 0.26), acUnitMat, acUnitMatrices);
  commitInst(new THREE.CylinderGeometry(0.08, 0.09, ROOM_H + 0.14, 8), steelMat, pillarMatrices);
  commitInst(new THREE.BoxGeometry(0.18, fenceH + 0.22, 0.18), steelMat, fencePostMatrices);
  commitInst(new THREE.BoxGeometry(1.75, 0.78, 1.15), diningTableMat, diningTableMatrices, false);
  commitInst(new THREE.BoxGeometry(0.22, DINING_H, 0.22), steelMat, diningColumnMatrices, true);
  commitInst(new THREE.CylinderGeometry(0.09, 0.1, 2.45, 7), steelMat, parkingColumnMatrices);

  // Color-coded 20ft ISO Sanitary/Shower/Laundry Containers (13–17) + Overhead Stainless Tanks
  const sanitaryBoxGeo = new THREE.BoxGeometry(2.45, 2.35, 2.65);
  commitInst(sanitaryBoxGeo, containerFemaleMat, wcFemaleMatrices, true);
  commitInst(sanitaryBoxGeo, containerMaleMat, wcMaleMatrices, true);
  commitInst(sanitaryBoxGeo, containerLaundryMat, laundryMatrices, true);
  commitInst(new THREE.CylinderGeometry(0.4, 0.4, 1.38, 12), inoxTankMat, wcTankMatrices);

  // Stylized Parked Commuter Motorcycles
  const motoPalette = [0xe11d48, 0x2563eb, 0x334155, 0xf8fafc, 0xd97706, 0x10b981];
  const _tint = new THREE.Color();
  commitInst(
    new THREE.BoxGeometry(0.48, 0.72, 1.25),
    motoBodyMat,
    motoMatrices,
    false,
    (inst, count) => {
      for (let i = 0; i < count; i++) {
        _tint.setHex(motoPalette[(i * 7 + 3) % motoPalette.length]);
        inst.setColorAt(i, _tint);
      }
    }
  );

  // ── 11. Layered Multi-Tier Botanical Perimeter Landscaping Trees ──
  const treePositions: { x: number; z: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const tz = -hd - 2.0 + (i * (COMPOUND_D + 4.0)) / 11;
    treePositions.push({ x: -hw - 3.6, z: tz });
    if (Math.abs(tz - GATE_Z) > 9.5) {
      treePositions.push({ x: hw + 15.6, z: tz });
    }
  }
  for (let i = 0; i < 10; i++) {
    const tx = -hw + 4 + (i * (COMPOUND_W - 8)) / 9;
    treePositions.push({ x: tx, z: -hd - 3.8 });
    treePositions.push({ x: tx, z: hd + 3.8 });
  }

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.25, 2.2, 7);
    const crownLowerGeo = new THREE.DodecahedronGeometry(1.42, 1);
    const crownUpperGeo = new THREE.DodecahedronGeometry(1.02, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.92 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 });

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    const crownLowerInst = new THREE.InstancedMesh(crownLowerGeo, leafMat, treePositions.length);
    const crownUpperInst = new THREE.InstancedMesh(crownUpperGeo, leafMat, treePositions.length);
    const leafCol = new THREE.Color();

    treePositions.forEach((tp, idx) => {
      const s = 0.85 + ((idx * 17) % 10) * 0.04;
      _tmpObj.position.set(tp.x, 1.1 * s, tp.z);
      _tmpObj.rotation.set(0, idx * 0.7, 0);
      _tmpObj.scale.set(s, s, s);
      _tmpObj.updateMatrix();
      trunkInst.setMatrixAt(idx, _tmpObj.matrix);

      _tmpObj.position.set(tp.x, 2.55 * s, tp.z);
      _tmpObj.scale.set(s, s * 0.86, s);
      _tmpObj.updateMatrix();
      crownLowerInst.setMatrixAt(idx, _tmpObj.matrix);

      _tmpObj.position.set(tp.x + 0.14 * s, 3.65 * s, tp.z - 0.1 * s);
      _tmpObj.scale.set(s * 0.92, s * 0.88, s * 0.92);
      _tmpObj.updateMatrix();
      crownUpperInst.setMatrixAt(idx, _tmpObj.matrix);

      const greenHue = 0.35 + ((idx % 5) - 2) * 0.015;
      leafCol.setHSL(greenHue, isLight ? 0.5 : 0.36, isLight ? 0.38 : 0.28);
      crownLowerInst.setColorAt(idx, leafCol);
      leafCol.setHSL(greenHue + 0.012, isLight ? 0.54 : 0.4, isLight ? 0.44 : 0.34);
      crownUpperInst.setColorAt(idx, leafCol);
    });

    trunkInst.instanceMatrix.needsUpdate = true;
    crownLowerInst.instanceMatrix.needsUpdate = true;
    crownUpperInst.instanceMatrix.needsUpdate = true;
    if (crownLowerInst.instanceColor) crownLowerInst.instanceColor.needsUpdate = true;
    if (crownUpperInst.instanceColor) crownUpperInst.instanceColor.needsUpdate = true;
    crownLowerInst.castShadow = castShadows;
    crownUpperInst.castShadow = castShadows;
    trunkInst.computeBoundingSphere();
    crownLowerInst.computeBoundingSphere();
    crownUpperInst.computeBoundingSphere();
    group.add(trunkInst);
    group.add(crownLowerInst);
    group.add(crownUpperInst);
  }

  // Final world bounds for smooth camera fitting
  const boundsCenter = new THREE.Vector3(2.0, 2.6, 0);
  const boundsRadius = 62.0;

  return {
    group,
    roofsGroup,
    functionalGroup,
    hitTargets,
    functionalHitTargets,
    buildingHitTargets,
    roomVisuals,
    functionalLookup,
    buildingVisuals,
    boundsCenter,
    boundsRadius,
  };
}
