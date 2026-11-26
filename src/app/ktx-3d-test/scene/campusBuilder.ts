import * as THREE from 'three';
import type {
  CampusBuildingNode,
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  FunctionalAreaNode,
  SceneTheme,
  SiteLandmarkNode,
  UnitXRayFilter,
} from '../types';
import {
  CAMPUS_BLUEPRINT_CONFIG,
  findBuildingBlueprint,
  type CampusBlueprintConfig,
  type CampusLandmarkConfig,
} from './campusLayoutConfig';
import {
  createGroundTileTexture,
  createPlaqueTexture,
  createRoadTexture,
  createRoofInfoBoardTexture,
} from './materials';
import { buildVinconsCampusScene } from './vinconsCampusBuilder';

export interface RoomVisualHandle {
  room: CampusRoomNode;
  bodyMesh: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  stripMat: THREE.MeshStandardMaterial;
  issueBeacon?: THREE.Mesh;
  issueBeaconMat?: THREE.MeshStandardMaterial;
  worldCenter: THREE.Vector3;
}

export interface BuildingVisualHandle {
  building: CampusBuildingNode;
  worldCenter: THREE.Vector3;
  radius: number;
  builtX: number;
  builtZ: number;
  builtRotationDeg: number;
}

export interface InfrastructureVisualHandle {
  landmark: SiteLandmarkNode;
  worldCenter: THREE.Vector3;
  radius: number;
  cameraOffset: THREE.Vector3;
}

export interface CampusBuildResult {
  group: THREE.Group;
  roofsGroup: THREE.Group;
  functionalGroup: THREE.Group;
  roofLabelMeshes: THREE.Object3D[];
  hitTargets: THREE.Object3D[];
  functionalHitTargets: THREE.Object3D[];
  buildingHitTargets: THREE.Object3D[];
  infrastructureHitTargets: THREE.Object3D[];
  roomVisuals: Map<string, RoomVisualHandle>;
  functionalLookup: Map<string, FunctionalAreaNode>;
  buildingVisuals: Map<string, BuildingVisualHandle>;
  infrastructureVisuals: Map<string, InfrastructureVisualHandle>;
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
  functional: 0x8b5cf6,
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

export const CONTRACTOR_PALETTE: Array<{ hex: number; css: string; emissive: number }> = [
  { hex: 0x3b82f6, css: '#3b82f6', emissive: 0x1d4ed8 }, // Blue
  { hex: 0x10b981, css: '#10b981', emissive: 0x047857 }, // Emerald
  { hex: 0xf59e0b, css: '#f59e0b', emissive: 0xb45309 }, // Amber
  { hex: 0x8b5cf6, css: '#8b5cf6', emissive: 0x6d28d9 }, // Violet
  { hex: 0x06b6d4, css: '#06b6d4', emissive: 0x0e7490 }, // Cyan
  { hex: 0xec4899, css: '#ec4899', emissive: 0xbe185d }, // Pink
  { hex: 0xf97316, css: '#f97316', emissive: 0xc2410c }, // Orange
  { hex: 0x84cc16, css: '#84cc16', emissive: 0x4d7c0f }, // Lime
];

export function getContractorColorSpec(contractorName: string): {
  hex: number;
  css: string;
  emissive: number;
} {
  const key = (contractorName || '').trim().toLowerCase();
  if (!key) {
    return { hex: 0x64748b, css: '#64748b', emissive: 0x000000 };
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CONTRACTOR_PALETTE[hash % CONTRACTOR_PALETTE.length];
}

export function resolveRoomColor(
  room: CampusRoomNode,
  mode: CampusColorMode,
  unitFilter: UnitXRayFilter | null,
  theme: SceneTheme,
  assignedOnly = false
): { color: number; emissive: number; emissiveIntensity: number; opacity: number } {
  const isOverloaded = room.occupied > room.capacity;
  const isFull = room.occupied >= room.capacity && room.capacity > 0;
  const isEmpty = room.occupied === 0;
  const ghostColor = theme === 'light' ? PALETTE.ghostLight : PALETTE.ghostDark;
  const ghostOpacity = theme === 'light' ? 0.28 : 0.22;

  // Hidden rooms render as architectural translucent slate bays so managers can observe & restore them without shifting layout
  if (!room.isVisible) {
    return {
      color: theme === 'light' ? 0x94a3b8 : 0x334155,
      emissive: 0x000000,
      emissiveIntensity: 0,
      opacity: theme === 'light' ? 0.34 : 0.28,
    };
  }

  if (assignedOnly && !room.hasWriteAccess) {
    return { color: ghostColor, emissive: 0x000000, emissiveIntensity: 0, opacity: ghostOpacity };
  }

  // Dedicated Maintenance / SLA Heatmap Mode (highlights overdue SLA & urgent tickets in crimson)
  if (mode === 'maintenance') {
    const hasMaintBed = room.maintenanceBedCount > 0;
    const hasFacIssue = room.hasFacilityIssue;
    const hasOverdueOrUrgent =
      (room.overdueSlaTicketCount || 0) > 0 || (room.urgentTicketCount || 0) > 0;
    if (hasMaintBed || hasFacIssue || hasOverdueOrUrgent) {
      const isSevere =
        hasOverdueOrUrgent || (hasMaintBed && hasFacIssue) || room.maintenanceBedCount >= 2;
      return {
        color: isSevere ? 0xef4444 : 0xf97316,
        emissive: isSevere ? 0xdc2626 : 0xea580c,
        emissiveIntensity: isSevere ? 0.58 : 0.36,
        opacity: 1,
      };
    }
    return {
      color: ghostColor,
      emissive: 0x000000,
      emissiveIntensity: 0,
      opacity: theme === 'light' ? 0.3 : 0.24,
    };
  }

  // Contractor / Unit Distribution Overlay Mode
  if (mode === 'contractor') {
    if (room.roomType === 'functional') {
      return {
        color: PALETTE.functional,
        emissive: 0x6d28d9,
        emissiveIntensity: 0.14,
        opacity: 0.65,
      };
    }
    if (isEmpty) {
      return { color: ghostColor, emissive: 0x000000, emissiveIntensity: 0, opacity: 0.42 };
    }
    const label = room.dominantContractor || room.dominantUnit;
    const cSpec = getContractorColorSpec(label);
    return {
      color: cSpec.hex,
      emissive: cSpec.emissive,
      emissiveIntensity: 0.22,
      opacity: 1,
    };
  }

  // Functional rooms positioned inside a dormitory row render in unmistakable royal violet
  if (room.roomType === 'functional') {
    const isDimmedFilterMode =
      (mode === 'unit_xray' && Boolean(unitFilter)) ||
      mode === 'vacant_only' ||
      mode === 'overloaded_only';
    return {
      color: PALETTE.functional,
      emissive: 0x6d28d9,
      emissiveIntensity: isDimmedFilterMode ? 0.08 : 0.24,
      opacity: isDimmedFilterMode ? 0.45 : 1,
    };
  }

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

  if (mode === 'tam_tru') {
    if (isEmpty) {
      return { color: ghostColor, emissive: 0x000000, emissiveIntensity: 0, opacity: 0.45 };
    }
    if (room.unregisteredTamTruCount === 0) {
      return { color: PALETTE.available, emissive: 0x047857, emissiveIntensity: 0.14, opacity: 1 };
    }
    const unregRatio = room.unregisteredTamTruCount / Math.max(1, room.occupied);
    if (unregRatio >= 0.5) {
      return { color: PALETTE.overloaded, emissive: 0xe11d48, emissiveIntensity: 0.34, opacity: 1 };
    }
    return { color: PALETTE.full, emissive: 0xb45309, emissiveIntensity: 0.24, opacity: 1 };
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
  theme: SceneTheme,
  assignedOnly = false,
  focusedBuildingKey: string | null = null
): void {
  roomVisuals.forEach((handle, key) => {
    const spec = resolveRoomColor(handle.room, mode, unitFilter, theme, assignedOnly);
    const isHovered = key === hoveredKey;
    const isFocused = key === focusedKey;
    const roomBldKey = `${handle.room.ktx}||${handle.room.day}`;
    const isOtherBuildingDimmed = Boolean(focusedBuildingKey && roomBldKey !== focusedBuildingKey);
    const isFocusedBuilding = Boolean(focusedBuildingKey && roomBldKey === focusedBuildingKey);

    const effectiveOpacity =
      isHovered || isFocused
        ? 1
        : isOtherBuildingDimmed
          ? Math.min(spec.opacity, theme === 'light' ? 0.24 : 0.18)
          : spec.opacity;

    handle.bodyMat.color.setHex(spec.color);
    handle.bodyMat.opacity = effectiveOpacity;
    handle.bodyMat.transparent = effectiveOpacity < 0.99;
    handle.bodyMat.depthWrite = effectiveOpacity >= 0.99;

    if (isFocused) {
      handle.bodyMat.emissive.setHex(0x38bdf8);
      handle.bodyMat.emissiveIntensity = 0.65;
    } else if (isHovered) {
      handle.bodyMat.emissive.setHex(0x7dd3fc);
      handle.bodyMat.emissiveIntensity = 0.48;
    } else if (isOtherBuildingDimmed) {
      handle.bodyMat.emissive.setHex(0x000000);
      handle.bodyMat.emissiveIntensity = 0;
    } else if (isFocusedBuilding) {
      handle.bodyMat.emissive.setHex(spec.emissive || 0x0ea5e9);
      handle.bodyMat.emissiveIntensity = Math.max(spec.emissiveIntensity, 0.2);
    } else {
      handle.bodyMat.emissive.setHex(spec.emissive);
      handle.bodyMat.emissiveIntensity = spec.emissiveIntensity;
    }

    handle.stripMat.color.setHex(isFocused || isHovered ? 0x7dd3fc : spec.color);
    handle.stripMat.emissive.setHex(
      isFocused || isHovered ? 0x38bdf8 : isOtherBuildingDimmed ? 0x000000 : spec.color
    );
    handle.stripMat.emissiveIntensity =
      isFocused || isHovered
        ? 0.9
        : isOtherBuildingDimmed
          ? 0.02
          : isFocusedBuilding
            ? 0.65
            : effectiveOpacity < 0.5
              ? 0.05
              : 0.45;

    if (handle.issueBeacon && handle.issueBeaconMat) {
      const hasIssue =
        handle.room.isVisible &&
        (handle.room.maintenanceBedCount > 0 || handle.room.hasFacilityIssue);
      handle.issueBeacon.visible = hasIssue && !isOtherBuildingDimmed;
      const emphasize = mode === 'maintenance' || isFocused || isHovered;
      handle.issueBeacon.scale.setScalar(emphasize ? 1.28 : 0.92);
      handle.issueBeaconMat.emissiveIntensity = emphasize ? 0.95 : 0.48;
    }
  });
}

function buildLandmarkMesh(
  landmark: CampusLandmarkConfig,
  maxAnisotropy: number,
  plaqueCache: Map<string, THREE.CanvasTexture>,
  castShadows: boolean
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(landmark.x, 0, landmark.z);
  g.rotation.y = THREE.MathUtils.degToRad(landmark.rotationDeg || 0);

  const colorByType: Record<CampusLandmarkConfig['type'], number> = {
    gate: 0x0284c7,
    parking: 0x475569,
    courtyard: 0x15803d,
    canteen: 0xd97706,
    utility: 0x7c3aed,
  };

  const baseH = landmark.type === 'courtyard' ? 0.08 : landmark.type === 'parking' ? 0.14 : 2.2;
  const mat = new THREE.MeshStandardMaterial({
    color: colorByType[landmark.type],
    roughness: landmark.type === 'courtyard' ? 0.92 : 0.55,
    metalness: landmark.type === 'courtyard' ? 0.0 : 0.25,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(landmark.width, baseH, landmark.depth),
    mat
  );
  body.position.y = baseH / 2 + 0.03;
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

export function buildCampusScene(
  ktxNodes: CampusKtxNode[],
  colorMode: CampusColorMode,
  unitFilter: UnitXRayFilter | null,
  theme: SceneTheme,
  maxAnisotropy: number,
  castShadows: boolean,
  blueprint: CampusBlueprintConfig = CAMPUS_BLUEPRINT_CONFIG,
  assignedOnly = false,
  showFunctionalRooms = true,
  showHiddenRooms = true,
  hiddenBuildingKeys?: ReadonlySet<string>
): CampusBuildResult {
  if (blueprint.mode === 'vincons') {
    return buildVinconsCampusScene(
      ktxNodes,
      colorMode,
      unitFilter,
      theme,
      maxAnisotropy,
      castShadows,
      blueprint,
      assignedOnly,
      showFunctionalRooms,
      showHiddenRooms,
      hiddenBuildingKeys
    );
  }

  const group = new THREE.Group();
  group.name = 'ktx-campus-root';

  // Separate dedicated groups for instant 0ms Roof Cutaway & Functional Layer toggling
  const roofsGroup = new THREE.Group();
  roofsGroup.name = 'ktx-campus-roofs';
  group.add(roofsGroup);

  const functionalGroup = new THREE.Group();
  functionalGroup.name = 'ktx-campus-functional';
  group.add(functionalGroup);

  const roofLabelMeshes: THREE.Object3D[] = [];
  const hitTargets: THREE.Object3D[] = [];
  const functionalHitTargets: THREE.Object3D[] = [];
  const buildingHitTargets: THREE.Object3D[] = [];
  const roomVisuals = new Map<string, RoomVisualHandle>();
  const functionalLookup = new Map<string, FunctionalAreaNode>();
  const buildingVisuals = new Map<string, BuildingVisualHandle>();
  const plaqueTexCache = new Map<string, THREE.CanvasTexture>();
  const roomPlaqueMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const isLight = theme === 'light';

  // Dimensions
  const ROOM_W = 2.6;
  const ROOM_D = 3.2;
  const ROOM_H = 2.35;
  const FLOOR_SLAB_H = 0.22;
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
  const functionalMat = new THREE.MeshStandardMaterial({
    color: PALETTE.functional,
    roughness: 0.48,
    metalness: 0.16,
    emissive: 0x4c1d95,
    emissiveIntensity: 0.18,
  });
  const functionalRoofMat = new THREE.MeshStandardMaterial({
    color: 0x4c1d95,
    roughness: 0.42,
    metalness: 0.4,
  });

  // Shared reusable geometries
  const roomBodyGeo = new THREE.BoxGeometry(ROOM_W, ROOM_H, ROOM_D);
  const windowGeo = new THREE.BoxGeometry(ROOM_W * 0.42, 0.72, 0.08);
  const doorGeo = new THREE.BoxGeometry(0.68, 1.55, 0.08);
  const stripGeo = new THREE.BoxGeometry(ROOM_W - 0.12, 0.12, 0.14);
  const pillarGeo = new THREE.CylinderGeometry(0.08, 0.09, ROOM_H + 0.15, 8);
  const roomPlaqueGeo = new THREE.PlaneGeometry(1.42, 0.62);
  const postGeo = new THREE.CylinderGeometry(0.1, 0.11, 1.6, 8);

  const FUNC_W = 2.8;
  const FUNC_D = 2.5;
  const FUNC_H = 2.05;
  const FUNC_GAP_X = 0.55;
  const FUNC_GAP_Z = 0.85;

  interface ZoneLayout {
    node: CampusKtxNode;
    width: number;
    depth: number;
    funcApron: number;
    funcCols: number;
    funcRows: number;
  }

  const zoneLayouts: ZoneLayout[] = ktxNodes.map(ktxNode => {
    const maxRoomsInRow = Math.max(
      1,
      ...ktxNode.buildings.map(b => {
        const accPerFloor = Math.max(1, b.rooms.length);
        const attachedCount = b.functionalAreas?.length || 0;
        return Math.max(1, accPerFloor + attachedCount);
      })
    );
    const maxBuildingW = maxRoomsInRow * (ROOM_W + ROOM_GAP) + 1.2;
    const zoneW = Math.max(12, maxBuildingW + KTX_PAD_X * 2);
    const funcCount = ktxNode.functionalAreas.length;
    const funcCols = Math.max(1, Math.floor((zoneW - 3.6) / (FUNC_W + FUNC_GAP_X)));
    const funcRows = funcCount > 0 ? Math.ceil(funcCount / funcCols) : 0;
    const funcApron = funcRows > 0 ? funcRows * (FUNC_D + FUNC_GAP_Z) + 1.4 : 0;

    const totalDepth =
      ktxNode.buildings.length * (ROOM_D + CORRIDOR_D) +
      Math.max(0, ktxNode.buildings.length - 1) * BUILDING_GAP_Z +
      funcApron;
    return {
      node: ktxNode,
      width: zoneW,
      depth: Math.max(10, totalDepth + KTX_PAD_Z * 2),
      funcApron,
      funcCols,
      funcRows,
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

  // Batched InstancedMesh transform collectors (supports arbitrary building rotation!)
  const doorMatrices: THREE.Matrix4[] = [];
  const windowMatrices: THREE.Matrix4[] = [];
  const pillarMatrices: THREE.Matrix4[] = [];
  const treePositions: { x: number; z: number }[] = [];

  const _tmpObj = new THREE.Object3D();
  const _bldMatWorld = new THREE.Matrix4();
  const _localMat = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _upAxis = new THREE.Vector3(0, 1, 0);

  // ── 2. Build each KTX Zone ──
  let cursorX = -totalCampusW / 2;

  zoneLayouts.forEach((zl, ktxIdx) => {
    const ktxBp =
      blueprint.mode === 'blueprint'
        ? blueprint.ktxZones.find(z => z.ktx.trim().toLowerCase() === zl.node.ktx.trim().toLowerCase())
        : undefined;

    const zoneCenterX = ktxBp ? ktxBp.x : cursorX + zl.width / 2;
    const zoneCenterZ = ktxBp ? ktxBp.z : 0;
    cursorX += zl.width + KTX_ZONE_GAP_X;

    const ktxGroup = new THREE.Group();
    ktxGroup.name = `ktx-zone-${zl.node.ktx}`;
    ktxGroup.position.set(zoneCenterX, 0, zoneCenterZ);

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
      const tz =
        zoneCenterZ - zl.depth / 2 + 2.5 + (t * (zl.depth - 5)) / Math.max(1, treeCountSide - 1);
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

    // ── 3. Build Accommodation Buildings (Supports Multi-Floor Blueprint Overrides!) ──
    const buildings = zl.node.buildings;
    const funcApron = zl.funcApron;
    const totalBldSpanZ =
      buildings.length * (ROOM_D + CORRIDOR_D) +
      Math.max(0, buildings.length - 1) * BUILDING_GAP_Z;
    let bldCursorZ = -totalBldSpanZ / 2 - funcApron / 2;

    buildings.forEach(building => {
      const bp = findBuildingBlueprint(blueprint, zl.node.ktx, building.day);
      const floors = 1;
      const accPerFloor = Math.max(1, building.rooms.length);
      const attachedFuncs = building.functionalAreas || [];
      const rowRoomCount = Math.max(1, accPerFloor + attachedFuncs.length);

      const bldW = rowRoomCount * (ROOM_W + ROOM_GAP) + 0.8;
      const bldTotalD = ROOM_D + CORRIDOR_D;
      const bldCenterZLocal = bldCursorZ + bldTotalD / 2;
      bldCursorZ += bldTotalD + BUILDING_GAP_Z;

      if (hiddenBuildingKeys?.has(building.key)) {
        return;
      }

      const bldWorldX = blueprint.mode === 'blueprint' && bp ? bp.x : zoneCenterX;
      const bldWorldZ = blueprint.mode === 'blueprint' && bp ? bp.z : zoneCenterZ + bldCenterZLocal;
      const bldRotDeg = bp?.rotationDeg || 0;
      const bldRotY = THREE.MathUtils.degToRad(bldRotDeg);
      const bldBaseY = plinthH + 0.02;

      const bldGroup = new THREE.Group();
      bldGroup.name = `building-${building.key}`;
      bldGroup.position.set(bldWorldX, bldBaseY, bldWorldZ);
      bldGroup.rotation.y = bldRotY;
      group.add(bldGroup);

      // World transform matrix for this building (for InstancedMesh & roof placement)
      _quat.setFromAxisAngle(_upAxis, bldRotY);
      _bldMatWorld.compose(
        new THREE.Vector3(bldWorldX, bldBaseY, bldWorldZ),
        _quat,
        new THREE.Vector3(1, 1, 1)
      );

      // Ground deck slab
      const deckH = FLOOR_SLAB_H;
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.4, deckH, bldTotalD + 0.3),
        buildingDeckMat
      );
      deck.position.set(0, deckH / 2, 0);
      deck.receiveShadow = true;
      bldGroup.add(deck);

      // Floor-by-floor rooms & intermediate slabs
      const storyStep = ROOM_H + FLOOR_SLAB_H;
      const startRoomX = -((rowRoomCount - 1) * (ROOM_W + ROOM_GAP)) / 2;
      const roomZLocal = -CORRIDOR_D / 2;

      for (let f = 0; f < floors; f++) {
        const floorBaseY = deckH + f * storyStep;

        // Intermediate floor slab + balcony handrail for upper floors (f > 0)
        if (f > 0) {
          const midSlab = new THREE.Mesh(
            new THREE.BoxGeometry(bldW + 0.4, FLOOR_SLAB_H, bldTotalD + 0.3),
            buildingDeckMat
          );
          midSlab.position.set(0, floorBaseY - FLOOR_SLAB_H / 2, 0);
          midSlab.receiveShadow = true;
          bldGroup.add(midSlab);

          const rail = new THREE.Mesh(
            new THREE.BoxGeometry(bldW + 0.2, 0.08, 0.08),
            roofTrimMat
          );
          rail.position.set(0, floorBaseY + 0.88, bldTotalD / 2 - 0.08);
          bldGroup.add(rail);
        }

        // Front walkway pillars per floor
        const pillarCount = Math.max(2, Math.min(rowRoomCount + 1, 14));
        for (let p = 0; p < pillarCount; p++) {
          const px = -bldW / 2 + (p * bldW) / (pillarCount - 1);
          _tmpObj.position.set(px, floorBaseY + (ROOM_H + 0.15) / 2, bldTotalD / 2 - 0.1);
          _tmpObj.rotation.set(0, 0, 0);
          _tmpObj.scale.setScalar(1);
          _tmpObj.updateMatrix();
          _localMat.multiplyMatrices(_bldMatWorld, _tmpObj.matrix);
          pillarMatrices.push(_localMat.clone());
        }
      }

      // Exterior stairwell block on right gable if multi-floor (floors > 1)
      if (floors > 1) {
        const stairH = floors * storyStep;
        const stairTower = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, stairH, bldTotalD * 0.72),
          buildingDeckMat
        );
        stairTower.position.set(bldW / 2 + 0.75, deckH + stairH / 2, 0);
        stairTower.castShadow = castShadows;
        bldGroup.add(stairTower);
      }

      // Roof assembly placed inside `roofsGroup` (0ms hide/show cutaway!)
      const totalStoriesH = floors * storyStep;
      const roofY = deckH + totalStoriesH - FLOOR_SLAB_H + 0.18;
      const bldRoofGroup = new THREE.Group();
      bldRoofGroup.position.set(bldWorldX, bldBaseY, bldWorldZ);
      bldRoofGroup.rotation.y = bldRotY;

      const roofMain = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.9, 0.22, bldTotalD + 0.8),
        roofMat
      );
      roofMain.position.set(0, roofY, 0);
      roofMain.castShadow = castShadows;
      roofMain.receiveShadow = true;
      bldRoofGroup.add(roofMain);

      const roofRidge = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.96, 0.28, 0.72),
        roofTrimMat
      );
      roofRidge.position.set(0, roofY + 0.22, -0.15);
      roofRidge.castShadow = castShadows;
      bldRoofGroup.add(roofRidge);

      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(bldW + 0.94, 0.14, 0.12),
        roofTrimMat
      );
      fascia.position.set(0, roofY - 0.04, bldTotalD / 2 + 0.4);
      bldRoofGroup.add(fascia);

      // Architectural Rooftop Telemetry Board (flush on top roof plane for effortless aerial legibility)
      const bldVacantRoof = Math.max(0, building.totalCapacity - building.totalOccupied);
      const bldOverflowRoof = building.rooms.reduce(
        (s, r) => s + (r.isVisible && r.roomType === 'accommodation' ? r.overflow : 0),
        0
      );
      const bldActiveAcc = building.rooms.filter(
        r => r.isVisible && r.roomType === 'accommodation'
      ).length;
      const bldFuncCnt = building.rooms.filter(
        r => r.isVisible && r.roomType === 'functional'
      ).length;
      const bldHiddenCnt = building.rooms.filter(r => !r.isVisible).length;
      const roofAccent =
        bldOverflowRoof > 0
          ? '#f43f5e'
          : building.totalCapacity > 0 && building.totalOccupied >= building.totalCapacity
            ? '#f59e0b'
            : building.totalOccupied > 0
              ? '#10b981'
              : '#38bdf8';
      const roofBoardTex = createRoofInfoBoardTexture(
        {
          title: building.day.toUpperCase(),
          subtitle: zl.node.ktx,
          occupied: building.totalOccupied,
          capacity: building.totalCapacity,
          vacant: bldVacantRoof,
          overflow: bldOverflowRoof,
          activeRooms: bldActiveAcc,
          functionalRooms: bldFuncCnt,
          hiddenRooms: bldHiddenCnt,
          maintenanceRooms: building.maintenanceIssueRoomsCount,
          unregisteredTamTru: building.unregisteredTamTruCount,
          directionHint: `1 → ${Math.max(1, building.rooms.length)}`,
          accentHex: roofAccent,
          theme,
        },
        maxAnisotropy,
        plaqueTexCache
      );
      const roofBoardMat = new THREE.MeshStandardMaterial({
        map: roofBoardTex,
        emissiveMap: roofBoardTex,
        emissive: 0xffffff,
        emissiveIntensity: isLight ? 0.16 : 0.4,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const rBoardH = Math.min((bldTotalD + 0.4) * 0.42, 2.0);
      const rBoardW = Math.min(bldW * 0.82, rBoardH * (2048 / 240));
      const rBoard = new THREE.Mesh(new THREE.PlaneGeometry(rBoardW, rBoardH), roofBoardMat);
      rBoard.position.set(0, roofY + 0.14, bldTotalD * 0.22);
      rBoard.rotation.x = -Math.PI / 2;
      rBoard.userData = { type: 'building', buildingKey: building.key };
      bldRoofGroup.add(rBoard);
      roofLabelMeshes.push(rBoard);
      buildingHitTargets.push(rBoard);

      roofsGroup.add(bldRoofGroup);

      // Dual-end clickable building signboards (left AND right gable ends -> click to frame building!)
      const bldVacant = Math.max(0, building.totalCapacity - building.totalOccupied);
      const bldSignTex = createPlaqueTexture(
        building.day,
        {
          subtext: `${building.totalOccupied}/${building.totalCapacity} · Trống ${bldVacant}${floors > 1 ? ` · ${floors}T` : ''}`,
          bg: '#0f172a',
          border: '#10b981',
          width: 300,
          height: 104,
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
      const bldSignGeo = new THREE.PlaneGeometry(2.5, 0.9);

      const bldSignLeft = new THREE.Mesh(bldSignGeo, bldSignMat);
      bldSignLeft.position.set(-bldW / 2 - 0.24, deckH + ROOM_H * 0.62, 0);
      bldSignLeft.rotation.y = -Math.PI / 2;
      bldSignLeft.userData = { type: 'building', buildingKey: building.key };
      bldGroup.add(bldSignLeft);
      buildingHitTargets.push(bldSignLeft);

      const bldSignRight = new THREE.Mesh(bldSignGeo, bldSignMat);
      bldSignRight.position.set(bldW / 2 + (floors > 1 ? 1.38 : 0.24), deckH + ROOM_H * 0.62, 0);
      bldSignRight.rotation.y = Math.PI / 2;
      bldSignRight.userData = { type: 'building', buildingKey: building.key };
      bldGroup.add(bldSignRight);
      buildingHitTargets.push(bldSignRight);

      buildingVisuals.set(building.key, {
        building,
        worldCenter: new THREE.Vector3(bldWorldX, bldBaseY + (floors * storyStep) * 0.45, bldWorldZ),
        radius: Math.max(7.5, Math.hypot(bldW / 2, bldTotalD / 2) * 1.1),
        builtX: Math.round(bldWorldX * 10) / 10,
        builtZ: Math.round(bldWorldZ * 10) / 10,
        builtRotationDeg: bldRotDeg,
      });

      // Build Interactive Room Units across floor(s)
      building.rooms.forEach((room, rIdx) => {
        if (!room.isVisible && !showHiddenRooms) return;
        if (room.roomType === 'functional' && room.isVisible && !showFunctionalRooms) return;

        const floorIdx = Math.min(floors - 1, Math.floor(rIdx / Math.max(1, accPerFloor)));
        const colIdx = rIdx % Math.max(1, accPerFloor);
        const rx = startRoomX + colIdx * (ROOM_W + ROOM_GAP);
        const floorBaseY = deckH + floorIdx * storyStep;

        const spec = resolveRoomColor(room, colorMode, unitFilter, theme, assignedOnly);

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
        bodyMesh.position.set(rx, floorBaseY + ROOM_H / 2, roomZLocal);
        bodyMesh.castShadow = castShadows && room.isVisible;
        bodyMesh.receiveShadow = true;
        bodyMesh.userData = { type: 'room', roomKey: room.key };
        bldGroup.add(bodyMesh);
        hitTargets.push(bodyMesh);

        // Queue door & front/rear windows into world-space InstancedMesh matrices
        const pushLocal = (list: THREE.Matrix4[], x: number, y: number, z: number) => {
          _tmpObj.position.set(x, y, z);
          _tmpObj.rotation.set(0, 0, 0);
          _tmpObj.scale.setScalar(1);
          _tmpObj.updateMatrix();
          _localMat.multiplyMatrices(_bldMatWorld, _tmpObj.matrix);
          list.push(_localMat.clone());
        };
        if (room.isVisible) {
          pushLocal(doorMatrices, rx - 0.56, floorBaseY + 0.78, roomZLocal + ROOM_D / 2 + 0.02);
          pushLocal(windowMatrices, rx + 0.48, floorBaseY + 1.32, roomZLocal + ROOM_D / 2 + 0.02);
          pushLocal(windowMatrices, rx, floorBaseY + 1.32, roomZLocal - ROOM_D / 2 - 0.02);
        }

        // Status indicator bar
        const stripMat = new THREE.MeshStandardMaterial({
          color: spec.color,
          emissive: spec.color,
          emissiveIntensity: spec.opacity < 0.5 ? 0.05 : 0.45,
          roughness: 0.25,
          metalness: 0.3,
        });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(rx, floorBaseY + ROOM_H - 0.16, roomZLocal + ROOM_D / 2 + 0.06);
        bldGroup.add(strip);

        // Deduplicated 2-line room plaque: Room label + direct occupancy / functional / hidden status
        const isHiddenRoom = !room.isVisible;
        const isFuncRoom = room.roomType === 'functional';
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
        const plaqueCacheKey = `${room.roomLabel}|${ratioText}|${plaqueBorder}|${plaqueBg}`;
        let plaqueMat = roomPlaqueMatCache.get(plaqueCacheKey);
        if (!plaqueMat) {
          const rPlaqueTex = createPlaqueTexture(
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
          plaqueMat = new THREE.MeshStandardMaterial({
            map: rPlaqueTex,
            roughness: 0.4,
            metalness: 0.1,
            transparent: isHiddenRoom,
            opacity: isHiddenRoom ? 0.72 : 1,
          });
          roomPlaqueMatCache.set(plaqueCacheKey, plaqueMat);
        }
        const rPlaque = new THREE.Mesh(roomPlaqueGeo, plaqueMat);
        rPlaque.position.set(rx, floorBaseY + ROOM_H + 0.08, roomZLocal + ROOM_D / 2 + 0.38);
        rPlaque.rotation.x = -0.55;
        bldGroup.add(rPlaque);

        const worldCenter = new THREE.Vector3(rx, floorBaseY + ROOM_H / 2, roomZLocal).applyMatrix4(
          _bldMatWorld
        );
        roomVisuals.set(room.key, {
          room,
          bodyMesh,
          bodyMat,
          stripMat,
          worldCenter,
        });
      });

      // Build Building-Attached Functional Rooms seamlessly on Floor 0 inside this building!
      if (attachedFuncs.length > 0) {
        const bldFuncGroup = new THREE.Group();
        bldFuncGroup.position.set(bldWorldX, bldBaseY, bldWorldZ);
        bldFuncGroup.rotation.y = bldRotY;

        const pushFuncLocal = (list: THREE.Matrix4[], x: number, y: number, z: number) => {
          _tmpObj.position.set(x, y, z);
          _tmpObj.rotation.set(0, 0, 0);
          _tmpObj.scale.setScalar(1);
          _tmpObj.updateMatrix();
          _localMat.multiplyMatrices(_bldMatWorld, _tmpObj.matrix);
          list.push(_localMat.clone());
        };

        attachedFuncs.forEach((fNode, fIdx) => {
          const colIdx = accPerFloor + fIdx;
          const fx = startRoomX + colIdx * (ROOM_W + ROOM_GAP);
          const floorBaseY = deckH;

          const fBody = new THREE.Mesh(roomBodyGeo, functionalMat);
          fBody.position.set(fx, floorBaseY + ROOM_H / 2, roomZLocal);
          fBody.castShadow = castShadows;
          fBody.receiveShadow = true;
          fBody.userData = { type: 'functional', functionalKey: fNode.key };
          bldFuncGroup.add(fBody);
          functionalHitTargets.push(fBody);
          functionalLookup.set(fNode.key, fNode);

          // Front door & windows aligned seamlessly with building facade
          pushFuncLocal(doorMatrices, fx - 0.56, floorBaseY + 0.78, roomZLocal + ROOM_D / 2 + 0.02);
          pushFuncLocal(windowMatrices, fx + 0.48, floorBaseY + 1.32, roomZLocal + ROOM_D / 2 + 0.02);
          pushFuncLocal(windowMatrices, fx, floorBaseY + 1.32, roomZLocal - ROOM_D / 2 - 0.02);

          // Violet accent strip on upper facade
          const fStrip = new THREE.Mesh(stripGeo, functionalRoofMat);
          fStrip.position.set(fx, floorBaseY + ROOM_H - 0.16, roomZLocal + ROOM_D / 2 + 0.06);
          bldFuncGroup.add(fStrip);

          // Angled facade plaque matching the building's room plaques
          const fTex = createPlaqueTexture(
            fNode.name.slice(0, 18),
            {
              subtext: `${building.day} · Khu CN`,
              bg: '#1e1b4b',
              border: '#a78bfa',
              width: 240,
              height: 88,
              fontSize: 24,
              maxAnisotropy,
            },
            plaqueTexCache
          );
          const fPlaque = new THREE.Mesh(
            new THREE.PlaneGeometry(2.15, 0.74),
            new THREE.MeshStandardMaterial({ map: fTex, roughness: 0.35 })
          );
          fPlaque.position.set(fx, floorBaseY + ROOM_H + 0.1, roomZLocal + ROOM_D / 2 + 0.38);
          fPlaque.rotation.x = -0.55;
          bldFuncGroup.add(fPlaque);
        });

        functionalGroup.add(bldFuncGroup);
      }
    });

    // ── 4. Functional Areas Layer (Multi-Row Wrap — ZERO items ever truncated!) ──
    const funcList = zl.node.functionalAreas || [];
    if (funcList.length > 0) {
      const cols = Math.max(1, zl.funcCols);
      const rows = Math.max(1, zl.funcRows);
      const totalFuncD = rows * (FUNC_D + FUNC_GAP_Z) - FUNC_GAP_Z;
      const funcBlockStartZ = zoneCenterZ + zl.depth / 2 - KTX_PAD_Z - totalFuncD + FUNC_D / 2;

      funcList.forEach((fNode, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const rowItemCount = Math.min(cols, funcList.length - r * cols);
        const startFX = -((rowItemCount - 1) * (FUNC_W + FUNC_GAP_X)) / 2;
        const fx = zoneCenterX + startFX + c * (FUNC_W + FUNC_GAP_X);
        const fz = funcBlockStartZ + r * (FUNC_D + FUNC_GAP_Z);

        const fGroup = new THREE.Group();
        fGroup.position.set(fx, plinthH + 0.02, fz);

        const fBody = new THREE.Mesh(
          new THREE.BoxGeometry(FUNC_W, FUNC_H, FUNC_D),
          functionalMat
        );
        fBody.position.y = FUNC_H / 2;
        fBody.castShadow = castShadows;
        fBody.receiveShadow = true;
        fBody.userData = { type: 'functional', functionalKey: fNode.key };
        fGroup.add(fBody);
        functionalHitTargets.push(fBody);
        functionalLookup.set(fNode.key, fNode);

        const fRoof = new THREE.Mesh(
          new THREE.BoxGeometry(FUNC_W + 0.36, 0.18, FUNC_D + 0.36),
          functionalRoofMat
        );
        fRoof.position.y = FUNC_H + 0.09;
        fGroup.add(fRoof);

        const fTex = createPlaqueTexture(
          fNode.name.slice(0, 18),
          {
            subtext: fNode.day || 'Khu chức năng',
            bg: '#1e1b4b',
            border: '#a78bfa',
            width: 240,
            height: 84,
            fontSize: 26,
            maxAnisotropy,
          },
          plaqueTexCache
        );
        const fPlaque = new THREE.Mesh(
          new THREE.PlaneGeometry(2.2, 0.76),
          new THREE.MeshStandardMaterial({ map: fTex, roughness: 0.35 })
        );
        fPlaque.position.set(0, FUNC_H + 0.52, FUNC_D / 2 + 0.08);
        fPlaque.rotation.x = -0.25;
        fGroup.add(fPlaque);

        functionalGroup.add(fGroup);
      });
    }

    group.add(ktxGroup);
  });

  // ── 5. Blueprint Landmarks (Gate, Parking, Courtyard, etc.) ──
  if (blueprint.landmarks.length > 0) {
    blueprint.landmarks.forEach(lm => {
      group.add(buildLandmarkMesh(lm, maxAnisotropy, plaqueTexCache, castShadows));
    });
  } else {
    // Clean default Security Gatehouse at the campus boulevard center
    group.add(
      buildLandmarkMesh(
        {
          id: 'default-gate',
          type: 'gate',
          label: 'CỔNG KTX PHƯỚC VĨNH TÂY',
          subtext: 'Trạm bảo vệ',
          x: -totalCampusW / 2 - 4.5,
          z: maxCampusD / 2 + 5.2,
          width: 3.4,
          depth: 2.2,
        },
        maxAnisotropy,
        plaqueTexCache,
        castShadows
      )
    );
  }

  // ── 6. Commit Batched InstancedMeshes (Doors, Windows, Corridor Pillars) ──
  const commitMatrixInst = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    matrices: THREE.Matrix4[]
  ) => {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  };

  commitMatrixInst(doorGeo, doorMat, doorMatrices);
  commitMatrixInst(windowGeo, windowGlassMat, windowMatrices);
  commitMatrixInst(pillarGeo, pillarMat, pillarMatrices);

  // ── 7. Composite Procedural Trees via InstancedMesh ──
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
    roofsGroup,
    functionalGroup,
    roofLabelMeshes,
    hitTargets,
    functionalHitTargets,
    buildingHitTargets,
    infrastructureHitTargets: [],
    roomVisuals,
    functionalLookup,
    buildingVisuals,
    infrastructureVisuals: new Map(),
    boundsCenter,
    boundsRadius,
  };
}
