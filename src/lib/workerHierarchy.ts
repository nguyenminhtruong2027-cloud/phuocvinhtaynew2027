import { createClient } from '@/lib/supabase/client';
import { normalizeRoomLabel, buildRoomKey } from '@/lib/facilityCapacity';
import { normalizeBedLabel } from '@/lib/bedSync';

export interface WorkerRef {
  hoVaTen: string;
  maNV: string;
  cccd: string;
  soDienThoai: string;
  ktx: string;
  day: string;
  phongSo: string;
  donVi: string;
  giuong?: string;
}

export interface RoomBedAvailability {
  capacity: number;
  occupiedCount: number;
  emptyBeds: string[];
  occupiedBeds: string[];
  allBeds: Array<{ giuong: string; status: 'empty' | 'occupied' | 'maintenance' }>;
}

export interface WorkerHierarchyData {
  units: string[];
  ktxList: string[];
  daysByKtx: Record<string, string[]>;
  roomsByKtxDay: Record<string, string[]>;
  roomCapacities: Record<string, number>;
  workers: WorkerRef[];
}

// In-memory cache to prevent multiple round-trips when switching views
let cachedData: WorkerHierarchyData | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15s

export function invalidateWorkerHierarchyCache(): void {
  cachedData = null;
  lastFetchTime = 0;
}

/** Natural sort comparator for Vietnamese text and numbers (e.g. "KTX 1" < "KTX 2", "Dãy 2" < "Dãy 10") */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });
}

function isIgnoredKtxLabel(raw: string): boolean {
  const l = raw.trim().toLowerCase();
  return !l || l.includes('tổng') || l.includes('tong') || l.includes('cơ sở vật chất');
}

/**
 * Hợp nhất cây phân cấp KTX / Dãy / Phòng từ:
 * 1. Bảng `facilities` (ưu tiên phòng ở & hiển thị trên sơ đồ — bao gồm cả KTX/phòng mới chưa có người ở)
 * 2. Bảng `workers` (đơn vị công tác + các phòng đang có công nhân cư trú)
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
        .select('ho_va_ten, ma_nv, cccd, so_dien_thoai, ktx, day, phong_so, giuong, don_vi')
        .order('id', { ascending: true })
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
          giuong: String(r.giuong || '').trim(),
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
  const roomCapacities: Record<string, number> = {};
  const rawUnitsSet = new Set<string>();

  const addLocation = (rawKtx: string, rawDay: string, rawRoom: string) => {
    const ktx = rawKtx.trim();
    const day = rawDay.trim();
    const room = normalizeRoomLabel(rawRoom);
    if (!ktx || isIgnoredKtxLabel(ktx)) return;
    ktxSet.add(ktx);
    if (!daysByKtxSet[ktx]) daysByKtxSet[ktx] = new Set();
    if (day) {
      daysByKtxSet[ktx].add(day);
      const kdKey = `${ktx}__${day}`;
      if (!roomsByKtxDaySet[kdKey]) roomsByKtxDaySet[kdKey] = new Set();
      if (room) {
        roomsByKtxDaySet[kdKey].add(room);
      }
    }
  };

  // Merge active accommodation rooms from `facilities` so newly added KTX/rooms appear immediately
  try {
    let fFrom = 0;
    for (let page = 0; page < 20; page++) {
      const { data: facRows, error: facErr } = await supabase
        .from('facilities')
        .select('ktx, day, phong_khu_vuc, giuong, room_type, is_visible')
        .order('id', { ascending: true })
        .range(fFrom, fFrom + PAGE_SIZE - 1);

      if (facErr || !facRows || facRows.length === 0) break;

      for (const row of facRows) {
        const roomType = (row as any)?.room_type || 'accommodation';
        const isVisible = (row as any)?.is_visible !== false;
        if (roomType === 'functional' || !isVisible) continue;
        const ktx = String((row as any)?.ktx || '').trim();
        const day = String((row as any)?.day || '').trim();
        const room = String((row as any)?.phong_khu_vuc || '').trim();
        addLocation(ktx, day, room);
        const cap = Number((row as any)?.giuong ?? 0);
        if (ktx && day && room && Number.isFinite(cap) && cap > 0) {
          roomCapacities[buildRoomKey(ktx, day, room)] = cap;
        }
      }

      if (facRows.length < PAGE_SIZE) break;
      fFrom += PAGE_SIZE;
    }
  } catch (err) {
    console.warn('[workerHierarchy] facilities merge fallback:', err);
  }

  for (const w of allRows) {
    if (w.donVi) rawUnitsSet.add(w.donVi);
    addLocation(w.ktx, w.day, w.phongSo);
  }

  // Deduplicate units case-insensitively while preserving nice casing
  const unitMap = new Map<string, string>();
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
    roomCapacities,
    workers: allRows,
  };

  cachedData = result;
  lastFetchTime = now;
  return result;
}

/**
 * Tra cứu giường trống / giường đã có người cho một phòng cụ thể.
 * Ưu tiên bảng `beds` (chính xác từng giường); fallback tính từ `facilities` + `workers`.
 */
export async function fetchRoomBedAvailability(
  ktx: string,
  day: string,
  phongSo: string,
  hierarchy?: Pick<WorkerHierarchyData, 'roomCapacities' | 'workers'>
): Promise<RoomBedAvailability> {
  const k = ktx.trim();
  const d = day.trim();
  const normRoom = normalizeRoomLabel(phongSo);
  if (!k || !d || !normRoom) {
    return { capacity: 0, occupiedCount: 0, emptyBeds: [], occupiedBeds: [], allBeds: [] };
  }

  const supabase = createClient();
  try {
    let bedRows: any[] | null = null;
    const { data: rpcBeds, error: rpcErr } = await supabase.rpc('lookup_room_bed_availability', {
      p_ktx: k,
      p_day: d,
    });

    if (!rpcErr && Array.isArray(rpcBeds)) {
      bedRows = rpcBeds;
    } else {
      const { data, error } = await supabase
        .from('beds')
        .select('phong_so, giuong, status')
        .eq('ktx', k)
        .eq('day', d);
      if (!error && Array.isArray(data)) {
        bedRows = data;
      }
    }

    if (Array.isArray(bedRows)) {
      const roomBeds = bedRows
        .filter((b: any) => normalizeRoomLabel(String(b?.phong_so ?? '')) === normRoom)
        .map((b: any) => ({
          giuong: normalizeBedLabel(String(b?.giuong ?? '')) || String(b?.giuong ?? '').trim(),
          status: (
            b?.status === 'occupied'
              ? 'occupied'
              : b?.status === 'maintenance'
              ? 'maintenance'
              : 'empty'
          ) as 'empty' | 'occupied' | 'maintenance',
        }))
        .filter(b => b.giuong)
        .sort((a, b) => naturalCompare(a.giuong, b.giuong));

      if (roomBeds.length > 0) {
        const emptyBeds = roomBeds.filter(b => b.status === 'empty').map(b => b.giuong);
        const occupiedBeds = roomBeds.filter(b => b.status === 'occupied').map(b => b.giuong);
        return {
          capacity: roomBeds.length,
          occupiedCount: occupiedBeds.length,
          emptyBeds,
          occupiedBeds,
          allBeds: roomBeds,
        };
      }
    }
  } catch {
    // Fallback below
  }

  const roomKey = buildRoomKey(k, d, normRoom);
  const cap = hierarchy?.roomCapacities?.[roomKey] || 0;
  const occInWorkers = (hierarchy?.workers || []).filter(
    w => w.ktx === k && w.day === d && normalizeRoomLabel(w.phongSo) === normRoom
  );
  const occupiedBedSet = new Set(
    occInWorkers.map(w => normalizeBedLabel(w.giuong || '')).filter(Boolean)
  );
  const allBeds: Array<{ giuong: string; status: 'empty' | 'occupied' | 'maintenance' }> = [];
  if (cap > 0) {
    for (let n = 1; n <= cap; n++) {
      const label = String(n);
      allBeds.push({
        giuong: label,
        status: occupiedBedSet.has(label) ? 'occupied' : 'empty',
      });
    }
  }
  return {
    capacity: cap,
    occupiedCount: occInWorkers.length,
    emptyBeds: allBeds.filter(b => b.status === 'empty').map(b => b.giuong),
    occupiedBeds: Array.from(occupiedBedSet).sort(naturalCompare),
    allBeds,
  };
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
