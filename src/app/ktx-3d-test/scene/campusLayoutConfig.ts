/**
 * Campus Blueprint Layout Configuration
 * ---------------------------------------------------------------------------
 * Cấu hình mặt bằng tọa độ thực tế cho Sa bàn 3D KTX Phước Vĩnh Tây.
 *
 * Hiện tại `mode: 'auto'` tự động xếp gọn các Khu KTX và Dãy nhà dựa trên
 * dữ liệu thực tế từ Supabase (`facilities` + `workers`).
 *
 * Khi có bản vẽ mặt bằng thật, chỉ cần chuyển `mode: 'blueprint'` và điền
 * tọa độ `(x, z)`, góc xoay (`rotationDeg`), số tầng (`floors`), cổng, nhà xe
 * và sân chung vào cấu hình bên dưới — bộ máy 3D sẽ tự động dựng đúng thực tế
 * mà không cần sửa mã nguồn render.
 */

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
  landmarks: [
    // Mẫu hạ tầng cơ bản ở chế độ auto: Cổng bảo vệ đặt ở đầu trục đường chính (sẽ tự căn theo tổng bề rộng khu)
  ],
};

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
