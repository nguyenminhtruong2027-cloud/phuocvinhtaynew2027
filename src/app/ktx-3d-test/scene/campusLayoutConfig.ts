/**
 * Campus Blueprint Layout Configuration & Persistence
 * ---------------------------------------------------------------------------
 * Cấu hình mặt bằng tọa độ thực tế cho Bản đồ 3D KTX Phước Vĩnh Tây.
 *
 * - `mode: 'auto'` tự động xếp gọn các Khu KTX và Dãy nhà dựa trên dữ liệu thực.
 * - `mode: 'blueprint'` cho phép Admin chỉnh tọa độ (x, z), góc xoay, số tầng (1-3),
 *   số phòng/tầng và các công trình phụ trợ (Cổng, Nhà xe, Sân chung, Căn tin...)
 *   ngay trên giao diện trực quan, tự lưu bộ nhớ trình duyệt & đồng bộ lên Supabase.
 */

import { createClient } from '@/lib/supabase/client';

export type CampusLandmarkType = 'gate' | 'parking' | 'courtyard' | 'canteen' | 'utility';

export interface BuildingBlueprintOverride {
  /** Tên KTX (VD: "KTX 1") */
  ktx: string;
  /** Tên Dãy (VD: "Dãy 1") */
  day: string;
  /** Tọa độ tâm dãy nhà theo trục X (mét) */
  x: number;
  /** Tọa độ tâm dãy nhà theo trục Z (mét) */
  z: number;
  /** Góc xoay theo trục đứng (0 = nằm ngang Đông-Tây, 90 = dọc Bắc-Nam) */
  rotationDeg?: number;
  /** Số tầng của dãy nhà (mặc định 1; hỗ trợ 1, 2, 3+ tầng kèm cầu thang ngoài) */
  floors?: number;
  /** Số phòng tối đa mỗi tầng (nếu chia nhiều tầng) */
  roomsPerFloor?: number;
}

export interface KtxZoneBlueprintOverride {
  ktx: string;
  /** Tâm cụm KTX (mét) */
  x: number;
  z: number;
  width?: number;
  depth?: number;
}

export interface CampusLandmarkConfig {
  id: string;
  type: CampusLandmarkType;
  label: string;
  subtext?: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotationDeg?: number;
}

export interface CampusBlueprintConfig {
  mode: 'auto' | 'blueprint';
  /** Số tầng mặc định khi chạy chế độ tự động (1 = nhà cấp 4 / 1 tầng) */
  defaultFloors: number;
  /** Danh sách ghi đè tọa độ từng Khu KTX (dùng khi có bản vẽ thật) */
  ktxZones: KtxZoneBlueprintOverride[];
  /** Danh sách ghi đè tọa độ & số tầng từng Dãy nhà */
  buildings: BuildingBlueprintOverride[];
  /** Các hạng mục hạ tầng phụ trợ (Cổng bảo vệ, Nhà xe, Sân chung...) */
  landmarks: CampusLandmarkConfig[];
}

export const CAMPUS_BLUEPRINT_CONFIG: CampusBlueprintConfig = {
  mode: 'auto',
  defaultFloors: 1,
  ktxZones: [],
  buildings: [],
  landmarks: [],
};

const LOCAL_STORAGE_KEY = 'ktx_3d_blueprint_config_v1';
const REMOTE_SENTINEL = {
  ktx: '__SYSTEM__',
  day_nha: '__3D_BLUEPRINT__',
  phong_so: 'config_v1',
};

export function sanitizeBlueprintConfig(raw: unknown): CampusBlueprintConfig {
  if (!raw || typeof raw !== 'object') return { ...CAMPUS_BLUEPRINT_CONFIG };
  const obj = raw as Partial<CampusBlueprintConfig>;
  const mode: 'auto' | 'blueprint' = obj.mode === 'blueprint' ? 'blueprint' : 'auto';
  const defaultFloors = Math.max(1, Math.min(5, Number(obj.defaultFloors) || 1));
  const buildings: BuildingBlueprintOverride[] = Array.isArray(obj.buildings)
    ? obj.buildings
        .filter(b => b && typeof b.ktx === 'string' && typeof b.day === 'string')
        .map(b => ({
          ktx: b.ktx.trim(),
          day: b.day.trim(),
          x: Number.isFinite(Number(b.x)) ? Number(b.x) : 0,
          z: Number.isFinite(Number(b.z)) ? Number(b.z) : 0,
          rotationDeg: Number.isFinite(Number(b.rotationDeg)) ? Number(b.rotationDeg) : 0,
          floors: Math.max(1, Math.min(5, Number(b.floors) || 1)),
          roomsPerFloor:
            b.roomsPerFloor && Number(b.roomsPerFloor) > 0
              ? Math.max(1, Math.floor(Number(b.roomsPerFloor)))
              : undefined,
        }))
    : [];
  const ktxZones: KtxZoneBlueprintOverride[] = Array.isArray(obj.ktxZones)
    ? obj.ktxZones
        .filter(z => z && typeof z.ktx === 'string')
        .map(z => ({
          ktx: z.ktx.trim(),
          x: Number(z.x) || 0,
          z: Number(z.z) || 0,
          width: z.width ? Number(z.width) : undefined,
          depth: z.depth ? Number(z.depth) : undefined,
        }))
    : [];
  const validLandmarkTypes: CampusLandmarkType[] = [
    'gate',
    'parking',
    'courtyard',
    'canteen',
    'utility',
  ];
  const landmarks: CampusLandmarkConfig[] = Array.isArray(obj.landmarks)
    ? obj.landmarks
        .filter(l => l && typeof l.label === 'string')
        .map((l, i) => ({
          id: String(l.id || `lm-${i + 1}`),
          type: validLandmarkTypes.includes(l.type) ? l.type : 'utility',
          label: l.label.trim() || 'Công trình',
          subtext: typeof l.subtext === 'string' ? l.subtext.trim() : undefined,
          x: Number.isFinite(Number(l.x)) ? Number(l.x) : 0,
          z: Number.isFinite(Number(l.z)) ? Number(l.z) : 0,
          width: Math.max(1.5, Math.min(40, Number(l.width) || 4)),
          depth: Math.max(1.5, Math.min(40, Number(l.depth) || 3)),
          rotationDeg: Number.isFinite(Number(l.rotationDeg)) ? Number(l.rotationDeg) : 0,
        }))
    : [];

  return { mode, defaultFloors, ktxZones, buildings, landmarks };
}

export function loadLocalBlueprintConfig(): CampusBlueprintConfig {
  if (typeof window === 'undefined') return { ...CAMPUS_BLUEPRINT_CONFIG };
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { ...CAMPUS_BLUEPRINT_CONFIG };
    return sanitizeBlueprintConfig(JSON.parse(raw));
  } catch {
    return { ...CAMPUS_BLUEPRINT_CONFIG };
  }
}

export function saveLocalBlueprintConfig(cfg: CampusBlueprintConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore quota errors
  }
}

/**
 * Loads authoritative 3D blueprint config from Supabase `room_units` sentinel record
 * (safely ignored by roomGender.ts which only parses 'nam' / 'nu'), falling back to localStorage.
 */
export async function fetchCampusBlueprintConfig(): Promise<CampusBlueprintConfig> {
  const local = loadLocalBlueprintConfig();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('room_units')
      .select('room_label')
      .eq('ktx', REMOTE_SENTINEL.ktx)
      .eq('day_nha', REMOTE_SENTINEL.day_nha)
      .eq('phong_so', REMOTE_SENTINEL.phong_so)
      .maybeSingle();

    if (!error && data && typeof data.room_label === 'string' && data.room_label.startsWith('{')) {
      const parsed = sanitizeBlueprintConfig(JSON.parse(data.room_label));
      saveLocalBlueprintConfig(parsed);
      return parsed;
    }
  } catch {
    // fallback to local
  }
  return local;
}

/**
 * Saves 3D blueprint config locally and attempts remote persistence to Supabase `room_units`
 * so all managers see the updated floorplan layout immediately.
 */
export async function saveCampusBlueprintConfig(
  cfg: CampusBlueprintConfig
): Promise<{ savedRemote: boolean }> {
  const clean = sanitizeBlueprintConfig(cfg);
  saveLocalBlueprintConfig(clean);
  try {
    const supabase = createClient();
    const payload = JSON.stringify(clean);
    const { data: updated, error: updErr } = await supabase
      .from('room_units')
      .update({
        room_label: payload,
        updated_at: new Date().toISOString(),
      })
      .eq('ktx', REMOTE_SENTINEL.ktx)
      .eq('day_nha', REMOTE_SENTINEL.day_nha)
      .eq('phong_so', REMOTE_SENTINEL.phong_so)
      .select('ktx');

    if (!updErr && updated && updated.length > 0) {
      return { savedRemote: true };
    }

    const { error: upsertErr } = await supabase.from('room_units').upsert(
      {
        ktx: REMOTE_SENTINEL.ktx,
        day_nha: REMOTE_SENTINEL.day_nha,
        phong_so: REMOTE_SENTINEL.phong_so,
        room_label: payload,
      },
      { onConflict: 'ktx,day_nha,phong_so' }
    );
    return { savedRemote: !upsertErr };
  } catch {
    return { savedRemote: false };
  }
}

export function findBuildingBlueprint(
  config: CampusBlueprintConfig,
  ktx: string,
  day: string
): BuildingBlueprintOverride | undefined {
  const kNorm = ktx.trim().toLowerCase();
  const dNorm = day.trim().toLowerCase();
  return config.buildings.find(
    b => b.ktx.trim().toLowerCase() === kNorm && b.day.trim().toLowerCase() === dNorm
  );
}
