'use client';

export type WorkerTableColumnKey =
  | 'maNV'
  | 'tieuDoan'
  | 'ktx'
  | 'day'
  | 'phongSo'
  | 'giuong'
  | 'soDienThoai'
  | 'cccd'
  | 'hoKhauTinh'
  | 'toTruong'
  | 'ngayVaoKTX'
  | 'soNgay'
  | 'tamTru'
  | 'profileStatus';

export const TOGGLEABLE_WORKER_COLUMNS: Array<{
  key: WorkerTableColumnKey;
  label: string;
}> = [
  { key: 'maNV', label: 'Mã NV' },
  { key: 'tieuDoan', label: 'Tiểu đoàn (TD)' },
  { key: 'ktx', label: 'Khu KTX' },
  { key: 'day', label: 'Dãy' },
  { key: 'phongSo', label: 'Phòng' },
  { key: 'giuong', label: 'Giường' },
  { key: 'soDienThoai', label: 'Số điện thoại' },
  { key: 'cccd', label: 'CCCD' },
  { key: 'hoKhauTinh', label: 'Tỉnh/TP' },
  { key: 'toTruong', label: 'Tổ trưởng' },
  { key: 'ngayVaoKTX', label: 'Ngày vào KTX' },
  { key: 'soNgay', label: 'Số ngày ở' },
  { key: 'tamTru', label: 'Tạm trú' },
  { key: 'profileStatus', label: 'Trạng thái hồ sơ' },
];

export type WorkerTableDensity = 'compact' | 'comfortable';

export interface WorkerTablePrefs {
  hiddenColumns: WorkerTableColumnKey[];
  density: WorkerTableDensity;
}

export interface SavedWorkerView {
  id: string;
  name: string;
  filters: {
    search: string;
    ktx: string;
    building: string;
    room: string;
    platoon: string;
    profileStatus: string;
    toTruong: string;
    province: string;
    tamTruStatus: string;
  };
  quickChip: 'none' | 'overdue_tamtru' | 'missing_info' | 'no_bed' | 'today';
  createdAt: number;
}

const TABLE_PREFS_KEY = 'ktx_worker_table_prefs_v1';
const SAVED_VIEWS_KEY = 'ktx_worker_saved_views_v1';

export const DEFAULT_WORKER_TABLE_PREFS: WorkerTablePrefs = {
  hiddenColumns: [],
  density: 'comfortable',
};

export function loadWorkerTablePrefs(): WorkerTablePrefs {
  if (typeof window === 'undefined') return DEFAULT_WORKER_TABLE_PREFS;
  try {
    const raw = window.localStorage.getItem(TABLE_PREFS_KEY);
    if (!raw) return DEFAULT_WORKER_TABLE_PREFS;
    const parsed = JSON.parse(raw) as Partial<WorkerTablePrefs>;
    const validKeys = new Set<string>(TOGGLEABLE_WORKER_COLUMNS.map(c => c.key));
    const hiddenColumns = Array.isArray(parsed.hiddenColumns)
      ? (parsed.hiddenColumns.filter(k => typeof k === 'string' && validKeys.has(k)) as WorkerTableColumnKey[])
      : [];
    const density: WorkerTableDensity = parsed.density === 'compact' ? 'compact' : 'comfortable';
    return { hiddenColumns, density };
  } catch {
    return DEFAULT_WORKER_TABLE_PREFS;
  }
}

export function saveWorkerTablePrefs(prefs: WorkerTablePrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage quota errors
  }
}

export function loadSavedWorkerViews(): SavedWorkerView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is SavedWorkerView =>
          Boolean(v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string' && v.filters)
      )
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function saveSavedWorkerViews(views: SavedWorkerView[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views.slice(0, 12)));
  } catch {
    // ignore storage quota errors
  }
}
