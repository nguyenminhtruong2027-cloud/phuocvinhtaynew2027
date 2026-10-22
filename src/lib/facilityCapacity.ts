import { createClient } from '@/lib/supabase/client';

export type RoomCapacityMap = Record<string, number>;

export function normalizeRoomLabel(raw: string): string {
  return (raw || '').trim().replace(/^Phòng\s*/i, '').toLowerCase();
}

export function buildRoomKey(ktx: string, day: string, phong: string): string {
  return `${(ktx || '').trim()}||${(day || '').trim()}||${normalizeRoomLabel(phong)}`;
}

/** Fetch per-room bed capacity from the `facilities` table (column `giuong`). */
export async function fetchRoomCapacities(): Promise<RoomCapacityMap> {
  const supabase = createClient();
  const map: RoomCapacityMap = {};

  try {
    const { data, error } = await supabase
      .from('facilities')
      .select('ktx, day, phong_khu_vuc, giuong');

    if (error) {
      console.warn('[facilityCapacity] fetch error:', error.message);
      return map;
    }

    for (const row of (data ?? [])) {
      const key = buildRoomKey(row?.ktx ?? '', row?.day ?? '', row?.phong_khu_vuc ?? '');
      const count = Number(row?.giuong ?? 0);
      if (Number.isFinite(count) && count > 0) {
        map[key] = count;
      }
    }
  } catch (err) {
    console.warn('[facilityCapacity] fetch error:', err);
  }

  return map;
}

export function getRoomCapacity(
  map: RoomCapacityMap,
  ktx: string,
  day: string,
  phong: string
): number {
  return map[buildRoomKey(ktx, day, phong)] ?? 0;
}
