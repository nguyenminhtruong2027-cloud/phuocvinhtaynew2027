import { createClient } from '@/lib/supabase/client';

export interface WorkerRef {
  hoVaTen: string;
  maNV: string;
  cccd: string;
  soDienThoai: string;
  ktx: string;
  day: string;
  phongSo: string;
  donVi: string;
}

export interface WorkerHierarchyData {
  units: string[];
  ktxList: string[];
  daysByKtx: Record<string, string[]>;
  roomsByKtxDay: Record<string, string[]>;
  workers: WorkerRef[];
}

// In-memory cache to prevent multiple round-trips when switching views
let cachedData: WorkerHierarchyData | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15s

const DEFAULT_UNITS = [
  'XD',
  'ME',
  'Vin Alpha',
  'Trắc đạc',
  'DVVS',
  'QC',
  'Ép cọc',
  'QLVTTB',
  'Lái xe',
  'Tuyển dụng',
];

/** Natural sort comparator for Vietnamese text and numbers (e.g. "KTX 1" < "KTX 2", "Dãy 2" < "Dãy 10") */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });
}

/**
 * Lấy danh sách các giá trị DUY NHẤT đã từng xuất hiện trong dữ liệu công nhân (bảng workers)
 * - Đơn vị: danh sách đơn vị đã có trong công nhân
 * - KTX / Dãy / Phòng: cây phân cấp liên kết, chỉ chứa các vị trí có ít nhất 1 công nhân đã gán
 * - Không lấy từ bảng facilities
 */
export async function fetchWorkerHierarchy(forceRefresh = false): Promise<WorkerHierarchyData> {
  const now = Date.now();
  if (!forceRefresh && cachedData && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedData;
  }

  const supabase = createClient();
  const allRows: WorkerRef[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  try {
    while (true) {
      const { data, error } = await supabase
        .from('workers')
        .select('ho_va_ten, ma_nv, cccd, so_dien_thoai, ktx, day, phong_so, don_vi')
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;

      for (const r of data) {
        allRows.push({
          hoVaTen: String(r.ho_va_ten || '').trim(),
          maNV: String(r.ma_nv || '').trim(),
          cccd: String(r.cccd || '').trim(),
          soDienThoai: String(r.so_dien_thoai || '').trim(),
          ktx: String(r.ktx || '').trim(),
          day: String(r.day || '').trim(),
          phongSo: String(r.phong_so || '').trim(),
          donVi: String(r.don_vi || '').trim(),
        });
      }

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  } catch (err) {
    console.error('Error fetching workers for hierarchy:', err);
  }

  const ktxSet = new Set<string>();
  const daysByKtxSet: Record<string, Set<string>> = {};
  const roomsByKtxDaySet: Record<string, Set<string>> = {};
  const rawUnitsSet = new Set<string>();

  for (const w of allRows) {
    if (w.donVi) rawUnitsSet.add(w.donVi);
    if (w.ktx) {
      ktxSet.add(w.ktx);
      if (!daysByKtxSet[w.ktx]) daysByKtxSet[w.ktx] = new Set();
      if (w.day) {
        daysByKtxSet[w.ktx].add(w.day);
        const kdKey = `${w.ktx}__${w.day}`;
        if (!roomsByKtxDaySet[kdKey]) roomsByKtxDaySet[kdKey] = new Set();
        if (w.phongSo) {
          roomsByKtxDaySet[kdKey].add(w.phongSo);
        }
      }
    }
  }

  // Deduplicate units case-insensitively while preserving nice casing
  const unitMap = new Map<string, string>();
  // Pre-seed known common defaults
  DEFAULT_UNITS.forEach(u => unitMap.set(u.toLowerCase(), u));
  rawUnitsSet.forEach(u => {
    const lower = u.toLowerCase();
    if (!unitMap.has(lower)) {
      unitMap.set(lower, u);
    }
  });

  const units = Array.from(unitMap.values()).sort(naturalCompare);
  const ktxList = Array.from(ktxSet).sort(naturalCompare);

  const daysByKtx: Record<string, string[]> = {};
  for (const ktx of ktxList) {
    daysByKtx[ktx] = Array.from(daysByKtxSet[ktx] || []).sort(naturalCompare);
  }

  const roomsByKtxDay: Record<string, string[]> = {};
  for (const kdKey of Object.keys(roomsByKtxDaySet)) {
    roomsByKtxDay[kdKey] = Array.from(roomsByKtxDaySet[kdKey] || []).sort(naturalCompare);
  }

  const result: WorkerHierarchyData = {
    units,
    ktxList,
    daysByKtx,
    roomsByKtxDay,
    workers: allRows,
  };

  cachedData = result;
  lastFetchTime = now;
  return result;
}

/** Clean a phone number or CCCD for matching */
function cleanIdentifier(val: string = ''): string {
  return val.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
}

export interface DuplicateMatch {
  matched: boolean;
  field: 'CCCD' | 'SĐT';
  matchedValue: string;
  worker: WorkerRef;
}

/**
 * Kiểm tra xem CCCD hoặc SĐT có trùng với bản ghi trong bảng công nhân chính hay không
 */
export function checkDuplicateWorker(
  workers: WorkerRef[],
  cccd?: string | null,
  phone?: string | null
): DuplicateMatch | null {
  const cleanCccd = cleanIdentifier(cccd || '');
  const cleanPhone = cleanIdentifier(phone || '');

  if (!cleanCccd && !cleanPhone) return null;

  for (const w of workers) {
    const wCccd = cleanIdentifier(w.cccd);
    const wPhone = cleanIdentifier(w.soDienThoai);

    // Trùng CCCD (độ dài >= 8 ký tự số)
    if (cleanCccd.length >= 8 && wCccd.length >= 8 && cleanCccd === wCccd) {
      return {
        matched: true,
        field: 'CCCD',
        matchedValue: w.cccd,
        worker: w,
      };
    }

    // Trùng SĐT (độ dài >= 9 số)
    if (cleanPhone.length >= 9 && wPhone.length >= 9 && cleanPhone === wPhone) {
      return {
        matched: true,
        field: 'SĐT',
        matchedValue: w.soDienThoai,
        worker: w,
      };
    }
  }

  return null;
}
