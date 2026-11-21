import { createClient } from '@/lib/supabase/client';

export type RoomCapacityMap = Record<string, number>;

export function normalizeRoomLabel(raw: string): string {
  if (!raw) return '';
  let cleaned = String(raw).normalize('NFC').trim();
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:phòng|phong|p[.\s]*)\s*/i, '').trim();
  }
  if (/^\d+$/.test(cleaned)) {
    return String(parseInt(cleaned, 10));
  }
  return cleaned.toLowerCase();
}

/**
 * Formats room name cleanly for grid badges, cell headers, and drawer titles:
 * - "Phòng 1" -> "P.1"
 * - "1" -> "P.1"
 * - "P.1" or "P1" -> "P.1"
 * - "Phòng 102" -> "P.102"
 * - "Phòng ở" -> "P.Ở"
 * - "Phòng ở 1" -> "P.1"
 * - Prevents redundant "P.Phòng ..." or truncated "P.Phòn..."
 */
export function formatRoomDisplay(raw: string): string {
  if (!raw) return 'P.—';
  const str = raw.trim();

  // If already starts with "P." or "P "
  const pMatch = str.match(/^P[.\s]+(.+)$/i);
  if (pMatch) {
    const rest = pMatch[1].trim();
    const cleanRest = rest.replace(/^Phòng\s*/i, '');
    return `P.${cleanRest || rest}`;
  }

  // If starts with "Phòng"
  const phongMatch = str.match(/^Phòng\s*(.*)$/i);
  if (phongMatch) {
    const rest = phongMatch[1].trim();
    if (rest) {
      const subDigit = rest.match(/^(?:ở\s*)?(\d+[A-Za-z]?)$/i);
      if (subDigit) {
        return `P.${subDigit[1]}`;
      }
      if (rest.toLowerCase() === 'ở') {
        return 'P.Ở';
      }
      return `P.${rest}`;
    }
    return 'Phòng';
  }

  // Pure digits or alphanumerics e.g. "1", "12", "102A"
  if (/^[a-zA-Z0-9_\-]+$/.test(str)) {
    return `P.${str}`;
  }

  return `P.${str}`;
}

export function extractRoomNumber(raw: string): string {
  if (!raw) return '';
  let cleaned = String(raw).normalize('NFC').trim();
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:phòng|phong|p[.\s]*)\s*/i, '').trim();
  }
  if (/^\d+$/.test(cleaned)) {
    return String(parseInt(cleaned, 10));
  }
  return cleaned;
}

export function buildRoomKey(ktx: string, day: string, phong: string): string {
  return `${(ktx || '').trim()}||${(day || '').trim()}||${normalizeRoomLabel(phong)}`;
}

export interface FacilityItem {
  id?: string;
  ktx: string;
  day: string;
  phong_khu_vuc: string;
  giuong: number;
  dieu_hoa?: number;
  tu?: number;
  quat?: number;
  o_cam_dien?: number;
  remote?: number;
  bong_tuyp?: number;
  ban_an?: number;
  ghe_an?: number;
  ghi_chu?: string;
  room_type?: 'accommodation' | 'functional';
  is_visible?: boolean;
  [key: string]: any;
}

export function buildRoomCapacityMapFromFacilities(facilities: FacilityItem[]): RoomCapacityMap {
  const map: RoomCapacityMap = {};
  for (const row of facilities) {
    const roomType = row?.room_type || 'accommodation';
    const isVisible = row?.is_visible !== false;
    if (roomType === 'functional' || !isVisible) continue;
    const key = buildRoomKey(row?.ktx ?? '', row?.day ?? '', row?.phong_khu_vuc ?? '');
    const count = Number(row?.giuong ?? 0);
    if (Number.isFinite(count) && count > 0) {
      map[key] = count;
    }
  }
  return map;
}

const FACILITIES_CACHE_TTL_MS = 15_000;
let _cachedFacilities: FacilityItem[] | null = null;
let _cachedFacilitiesAt = 0;
let _inflightFacilities: Promise<FacilityItem[]> | null = null;
let _facilityInvalidationBound = false;

export function invalidateFacilitiesCache(): void {
  _cachedFacilities = null;
  _cachedFacilitiesAt = 0;
  _inflightFacilities = null;
}

function bindFacilityCacheInvalidation(): void {
  if (_facilityInvalidationBound || typeof window === 'undefined') return;
  _facilityInvalidationBound = true;
  window.addEventListener('ktx_facilities_updated', () => {
    invalidateFacilitiesCache();
  });
}

/** Fetch all physical facilities from the database catalog (paginated, cached & deduplicated) */
export async function fetchFacilitiesList(forceRefresh = false): Promise<FacilityItem[]> {
  bindFacilityCacheInvalidation();
  const now = Date.now();
  if (!forceRefresh && _cachedFacilities && now - _cachedFacilitiesAt < FACILITIES_CACHE_TTL_MS) {
    return _cachedFacilities;
  }
  if (!forceRefresh && _inflightFacilities) {
    return _inflightFacilities;
  }

  _inflightFacilities = (async () => {
    const supabase = createClient();
    const PAGE_SIZE = 1000;
    const allRows: any[] = [];
    try {
      let from = 0;
      for (let page = 0; page < 30; page++) {
        const { data, error } = await supabase
          .from('facilities')
          .select('*')
          .order('day', { ascending: true })
          .order('phong_khu_vuc', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) {
          console.warn('[facilityCapacity] fetchFacilitiesList error:', error.message);
          break;
        }
        const chunk = data || [];
        allRows.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const byId = new Map<string, FacilityItem>();
      allRows.forEach((row: any, idx: number) => {
        const id = String(row?.id ?? `fac-${idx}`);
        byId.set(id, {
          ...row,
          id,
          room_type: row.room_type || 'accommodation',
          is_visible: row.is_visible !== false,
        });
      });
      const result = Array.from(byId.values());
      _cachedFacilities = result;
      _cachedFacilitiesAt = Date.now();
      return result;
    } catch (err) {
      console.warn('[facilityCapacity] fetchFacilitiesList error:', err);
      return _cachedFacilities ?? [];
    } finally {
      _inflightFacilities = null;
    }
  })();

  return _inflightFacilities;
}

/** Fetch per-room bed capacity from the cached `facilities` catalog. Only accommodation & visible rooms. */
export async function fetchRoomCapacities(forceRefresh = false): Promise<RoomCapacityMap> {
  const facilities = await fetchFacilitiesList(forceRefresh);
  return buildRoomCapacityMapFromFacilities(facilities);
}

export function getRoomCapacity(
  map: RoomCapacityMap,
  ktx: string,
  day: string,
  phong: string
): number {
  return map[buildRoomKey(ktx, day, phong)] ?? 0;
}
