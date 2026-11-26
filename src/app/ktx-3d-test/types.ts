import type { Worker } from '@/data/workers';
import type { FacilityItem } from '@/lib/facilityCapacity';
import type { RoomGenderInfo } from '@/lib/roomGender';

export type ViewLevel = 'campus' | 'room';

export type CampusColorMode =
  | 'occupancy'
  | 'gender'
  | 'contractor'
  | 'vacant_only'
  | 'overloaded_only'
  | 'tam_tru'
  | 'maintenance'
  | 'unit_xray';

export type AlertCategory =
  | 'overloaded'
  | 'mixed_gender'
  | 'unregistered_tam_tru'
  | 'unassigned_bed'
  | 'maintenance_issue';

export type SceneTheme = 'dark' | 'light';

export type BedTierFilter = 'all' | 'bottom' | 'top';

export type CameraPreset = 'overview' | 'top' | 'low' | 'left_row' | 'right_row';

export type CameraNavMode = 'orbit' | 'pan';

export type RoomEquipmentCategory = 'ac' | 'fan' | 'locker' | 'light' | 'room_board';

export interface UnitXRayFilter {
  type: 'platoon' | 'unit';
  value: string;
  label: string;
}

export interface FunctionalAreaNode {
  key: string;
  ktx: string;
  day: string;
  name: string;
  ghiChu: string;
  facility: FacilityItem;
}

export interface SiteLandmarkNode {
  id: string;
  code: string; // e.g. "(8)", "(13–17)", "(19)"
  name: string;
  category:
    | 'security'
    | 'dining'
    | 'canteen'
    | 'sanitary'
    | 'water'
    | 'wwtp'
    | 'waste'
    | 'parking'
    | 'visitor';
  zone: string;
  summary: string;
  specs: string[];
  facility?: FacilityItem | null;
}

export interface RoomEquipmentHoverInfo {
  equipmentType: RoomEquipmentCategory;
  label: string;
  count: number;
  roomLabel: string;
}

export interface CampusRoomNode {
  key: string; // `${ktx}||${day}||${normRoom}`
  ktx: string;
  day: string;
  roomRaw: string;
  roomNorm: string;
  roomLabel: string; // P.1
  roomType: 'accommodation' | 'functional';
  isVisible: boolean;
  ghiChu: string;
  capacity: number;
  occupied: number;
  vacant: number;
  overflow: number;
  fillRate: number;
  genderInfo: RoomGenderInfo;
  workers: Worker[];
  dominantUnit: string;
  dominantContractor?: string;
  platoonCounts: Record<string, number>;
  unitCounts: Record<string, number>;
  unregisteredTamTruCount: number;
  unassignedBedCount: number;
  maintenanceBedCount: number;
  activeTicketCount?: number;
  urgentTicketCount?: number;
  overdueSlaTicketCount?: number;
  hasFacilityIssue: boolean;
  hasWriteAccess: boolean;
  facility: FacilityItem | null;
}

export interface CampusBuildingNode {
  key: string; // `${ktx}||${day}`
  ktx: string;
  day: string;
  rooms: CampusRoomNode[];
  functionalAreas: FunctionalAreaNode[];
  totalCapacity: number;
  totalOccupied: number;
  unregisteredTamTruCount: number;
  maintenanceIssueRoomsCount: number;
  hasWriteAccess: boolean;
}

export interface CampusKtxNode {
  ktx: string;
  buildings: CampusBuildingNode[];
  functionalAreas: FunctionalAreaNode[];
  totalRooms: number;
  totalCapacity: number;
  totalOccupied: number;
}

export interface RoomBedSlot {
  id: string;
  bedNumber: number;
  bedLabel: string; // G1, G2...
  bunkIndex: number; // 0-based bunk unit
  tier: 'bottom' | 'top';
  status: 'occupied' | 'empty' | 'maintenance' | 'checkout_pending';
  gender: 'male' | 'female' | 'unknown';
  workerId: string | null;
  hoVaTen: string | null;
  maNV: string | null;
  tieuDoan: string | null;
  donVi: string | null;
  ngayVaoKTX: string | null;
  bedDbId: string | null;
}

export interface HoverInfo {
  type: 'room' | 'bed' | 'functional' | 'building' | 'landmark' | 'equipment';
  screenX: number;
  screenY: number;
  room?: CampusRoomNode;
  bed?: RoomBedSlot;
  functional?: FunctionalAreaNode;
  building?: CampusBuildingNode;
  landmark?: SiteLandmarkNode;
  equipment?: RoomEquipmentHoverInfo;
}

export interface RenderPerfStats {
  isSoftwareGl: boolean;
  lastFrameMs: number;
  drawCalls: number;
  triangles: number;
}
