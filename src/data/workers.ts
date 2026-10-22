export interface Worker {
  id: string;
  stt: number;
  hoVaTen: string;
  maNV: string;
  tieuDoan: string;
  ktx: string;
  day: string;
  phongSo: string;
  donVi: string;
  gioiTinh: string;
  ngaySinh?: string;
  queQuan?: string;
  cccd?: string;
  soCCCD?: string;
  soDienThoai?: string;
  giuong?: string;
  hoKhauTinh?: string;
  toTruong?: string;
  sdtToTruong?: string;
  ngayVaoKTX?: string;
  ngayRaKTX?: string;
  ghiChu?: string;
  khoaTraCuu?: string;
  avatar?: string;
  tamTruStatus?: 'registered' | 'unregistered';
}

// Mock data removed — data is loaded strictly from Supabase
export const WORKERS: Worker[] = [];

export const ROOM_CAPACITY = 20;
export const BUILDINGS = ['Dãy 1', 'Dãy 2', 'Dãy 3', 'Dãy 4'];
export const ROOMS = ['1', '2', '3', '4', '5', '6'];
export const PLATOONS = ['1', '2', '3', '8', '111', '113'];

export function compareKtxNames(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });
}

/** Remove Vietnamese accents and convert 'đ'/'Đ' to 'd'/'D' for accent-insensitive search */
export function removeAccents(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, m => (m === 'đ' ? 'd' : 'D'))
    .toLowerCase();
}

/** Extract clean, unique, non-junk team leader (Tổ Trưởng) names sorted in Vietnamese alphabetical order */
export function getUniqueToTruongList(workers: Worker[] = WORKERS): string[] {
  const set = new Set<string>();
  (workers || []).forEach(w => {
    const raw = (w.toTruong || '').trim();
    if (!raw || raw === '0' || raw === 'null' || raw === 'undefined' || raw === '—' || raw === '-') return;
    set.add(raw);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
}

export function getUniqueKTX(workers: Worker[] = WORKERS): string[] {
  return [...new Set(workers.map(w => w.ktx?.trim()).filter(Boolean) as string[])].sort(compareKtxNames);
}

export interface KtxOccupancy {
  ktx: string;
  rooms: number;
  capacity: number;
  occupied: number;
  vacant: number;
  overflow: number;
  fillRate: number;
}

export function aggregateKtxOccupancy(workers: Worker[], roomCapacity: number = ROOM_CAPACITY): KtxOccupancy[] {
  const buckets = new Map<string, { rooms: Set<string>; occupied: number }>();

  for (const w of workers) {
    const ktx = w.ktx?.trim();
    if (!ktx) continue;
    let bucket = buckets.get(ktx);
    if (!bucket) {
      bucket = { rooms: new Set(), occupied: 0 };
      buckets.set(ktx, bucket);
    }
    if (w.day && w.phongSo) {
      bucket.rooms.add(`${w.day.trim()}||${w.phongSo.trim()}`);
      bucket.occupied++;
    }
  }

  return [...buckets.entries()]
    .map(([ktx, { rooms, occupied }]) => {
      const capacity = rooms.size * roomCapacity;
      return {
        ktx,
        rooms: rooms.size,
        capacity,
        occupied,
        vacant: Math.max(0, capacity - occupied),
        overflow: Math.max(0, occupied - capacity),
        fillRate: capacity > 0 ? occupied / capacity : 0,
      };
    })
    .sort((a, b) => compareKtxNames(a.ktx, b.ktx));
}

export function getUniqueBuildingKeys(workers: Worker[] = WORKERS): string[] {
  const keys = new Set<string>();
  workers.forEach(w => {
    if (!w.day) return;
    keys.add(`${w.ktx || ''}||${w.day}`);
  });
  return [...keys].sort();
}

export function countUniqueBuildings(workers: Worker[] = WORKERS): number {
  return getUniqueBuildingKeys(workers).length;
}

export function getUniqueBuildings(workers: Worker[] = WORKERS): string[] {
  const list = workers || WORKERS;
  return [...new Set(list.map(w => w.day).filter(Boolean))].sort();
}

export function getUniqueRooms(workers: Worker[] = WORKERS, day?: string): string[] {
  const list = day ? workers.filter(w => w.day === day) : workers;
  return [...new Set(list.map(w => w.phongSo).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
}

export function getUniquePlatoons(workers: Worker[] = WORKERS): string[] {
  return [...new Set(workers.map(w => w.tieuDoan).filter(Boolean))].sort();
}

export function getworkersByRoom(day: string, phongSo: string): Worker[] {
  return WORKERS.filter(w => w.day === day && w.phongSo === phongSo);
}

export function getworkersByBuilding(day: string): Worker[] {
  return WORKERS.filter(w => w.day === day);
}

export function getProfileStatus(w: Worker): 'full' | 'missing_cccd_sdt' | 'no_room' | 'incomplete' {
  if (!w.day || !w.phongSo) return 'no_room';
  if (!w.cccd || !w.soDienThoai) return 'missing_cccd_sdt';
  if (w.hoVaTen && w.maNV && w.cccd && w.soDienThoai) return 'full';
  return 'incomplete';
}

export function calcSoNgay(ngayVao?: string, ngayRa?: string): number {
  if (!ngayVao) return 0;
  let start: Date;
  if (ngayVao.includes('/')) {
    const parts = ngayVao.split('/');
    if (parts.length === 3) {
      start = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      start = new Date(ngayVao);
    }
  } else {
    start = new Date(ngayVao);
  }
  if (isNaN(start.getTime())) return 0;

  let end = new Date();
  if (ngayRa) {
    if (ngayRa.includes('/')) {
      const parts = ngayRa.split('/');
      if (parts.length === 3) {
        end = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      } else {
        end = new Date(ngayRa);
      }
    } else {
      end = new Date(ngayRa);
    }
  }
  const diff = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}
