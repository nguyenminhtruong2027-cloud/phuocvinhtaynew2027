import { Worker, DEFAULT_ROOM_CAPACITY, naturalSortCompare } from '@/data/workers';
import { FacilityItem, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { normalizeBedLabel } from '@/lib/bedSync';
import { getRoomGenderInfo, normalizeGender } from '@/lib/roomGender';

export const FACILITY_ISSUE_REGEX = /hỏng|hư|sửa|bảo trì|lỗi|thay|kém|yếu|chập/i;

export function hasFacilityIssueNote(note?: string | null): boolean {
  return Boolean(note && FACILITY_ISSUE_REGEX.test(note));
}

export interface RoomAssignmentCandidate {
  ktx: string;
  day: string;
  room: string;
  capacity: number;
  currentCount: number;
  availableSlots: number;
  firstFreeBed: string;
  genderType: 'male' | 'female' | 'empty' | 'mixed';
  sameUnitCount: number;
  samePlatoonCount: number;
  hasIssue: boolean;
  isPhase1: boolean;
  score: number;
  reasons: string[];
}

export interface SmartAssignTarget {
  id?: string;
  gioiTinh?: string;
  donVi?: string;
  tieuDoan?: string;
  ktx?: string;
}

export interface SmartAssignOptions {
  preferPhase1?: boolean;
  allowedDays?: string[];
  limit?: number;
  extraOccupiedByRoom?: Map<string, number>;
  extraOccupiedBeds?: Map<string, Set<string>>;
  extraAssignedGender?: Map<string, 'male' | 'female'>;
}

function normalizeText(v?: string | null): string {
  return (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase();
}

export function isPhase1Day(day: string): boolean {
  const m = (day || '').match(/(\d+)/);
  if (!m) return false;
  const num = parseInt(m[1], 10);
  return num >= 1 && num <= 3;
}

function findFirstAvailableBed(capacity: number, usedBeds: Set<string>): string {
  const limit = Math.max(1, capacity || DEFAULT_ROOM_CAPACITY);
  for (let i = 1; i <= limit; i++) {
    const label = String(i);
    if (!usedBeds.has(label)) {
      return label;
    }
  }
  return String(limit + 1);
}

function toRoomGenderBucket(val?: string | null): 'male' | 'female' | 'unknown' {
  const g = normalizeGender(val);
  if (g === 'nam') return 'male';
  if (g === 'nu') return 'female';
  return 'unknown';
}

/**
 * Computes ranked optimal room + bed suggestions for a worker based on:
 * - Hard gender separation (respects roomGenderMap and current occupants)
 * - Capacity ceiling (no overflow)
 * - Same unit / platoon grouping
 * - Phase 1 priority (Dãy 1–3) when enabled
 * - Packing partially filled rooms before opening brand-new empty rooms
 * - Avoiding rooms with reported facility issues
 */
export function suggestOptimalRooms(
  target: SmartAssignTarget,
  workers: Worker[],
  facilities: FacilityItem[],
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>,
  options: SmartAssignOptions = {}
): RoomAssignmentCandidate[] {
  const {
    preferPhase1 = true,
    allowedDays,
    limit = 6,
    extraOccupiedByRoom,
    extraOccupiedBeds,
    extraAssignedGender,
  } = options;

  const targetGender = toRoomGenderBucket(target.gioiTinh); // 'male' | 'female' | 'unknown'
  const targetUnit = normalizeText(target.donVi);
  const targetPlatoon = normalizeText(target.tieuDoan);
  const targetKtx = (target.ktx || '').trim();
  const allowedDaySet = allowedDays && allowedDays.length > 0
    ? new Set(allowedDays.map(d => normalizeText(d)))
    : null;

  // Group current active workers by normalized room key
  const workersByRoom = new Map<string, Worker[]>();
  const usedBedsByRoom = new Map<string, Set<string>>();

  for (const w of workers) {
    if (target.id && w.id === target.id) continue;
    const k = (w.ktx || '').trim();
    const d = (w.day || '').trim();
    const r = normalizeRoomLabel(w.phongSo || '');
    if (!k || !d || !r) continue;
    const key = `${k}||${d}||${r}`;
    let list = workersByRoom.get(key);
    if (!list) {
      list = [];
      workersByRoom.set(key, list);
    }
    list.push(w);

    const bedNorm = normalizeBedLabel(w.giuong || '');
    if (bedNorm) {
      let beds = usedBedsByRoom.get(key);
      if (!beds) {
        beds = new Set<string>();
        usedBedsByRoom.set(key, beds);
      }
      beds.add(bedNorm);
    }
  }

  // Only consider visible accommodation rooms
  const rooms = facilities.filter(f => {
    if ((f.room_type || 'accommodation') !== 'accommodation') return false;
    if (f.is_visible === false) return false;
    if (targetKtx && f.ktx.trim() !== targetKtx) return false;
    if (allowedDaySet && !allowedDaySet.has(normalizeText(f.day))) return false;
    return Boolean(f.ktx && f.day && f.phong_khu_vuc);
  });

  const candidates: RoomAssignmentCandidate[] = [];

  for (const fac of rooms) {
    const ktx = fac.ktx.trim();
    const day = fac.day.trim();
    const rawRoom = fac.phong_khu_vuc.trim();
    const normRoom = normalizeRoomLabel(rawRoom);
    if (!normRoom) continue;

    const normKey = `${ktx}||${day}||${normRoom}`;
    const rawKey = `${ktx}||${day}||${rawRoom}`;

    const capacity = Number(fac.giuong) > 0 ? Number(fac.giuong) : DEFAULT_ROOM_CAPACITY;
    const existing = workersByRoom.get(normKey) || [];
    const extraCount = extraOccupiedByRoom?.get(normKey) || 0;
    const currentCount = existing.length + extraCount;
    const availableSlots = capacity - currentCount;

    if (availableSlots <= 0) continue;

    // Resolve authoritative room gender
    const adminGender = roomGenderMap[rawKey] || roomGenderMap[normKey];
    const overrideLabel = adminGender === 'male' ? 'Nam' : adminGender === 'female' ? 'Nữ' : null;
    const gInfo = getRoomGenderInfo(existing, overrideLabel);
    const batchGender = extraAssignedGender?.get(normKey);

    let effectiveGender: 'male' | 'female' | 'empty' | 'mixed' = gInfo.gender;
    if (effectiveGender === 'empty' && batchGender) {
      effectiveGender = batchGender;
    }

    // Hard gender compatibility rule
    if (targetGender === 'male' && (effectiveGender === 'female' || effectiveGender === 'mixed')) {
      continue;
    }
    if (targetGender === 'female' && (effectiveGender === 'male' || effectiveGender === 'mixed')) {
      continue;
    }

    // Count matching unit & platoon
    let sameUnitCount = 0;
    let samePlatoonCount = 0;
    if (targetUnit || targetPlatoon) {
      for (const w of existing) {
        if (targetUnit && normalizeText(w.donVi) === targetUnit) sameUnitCount++;
        if (targetPlatoon && normalizeText(w.tieuDoan) === targetPlatoon) samePlatoonCount++;
      }
    }

    const hasIssue = hasFacilityIssueNote(fac.ghi_chu);
    const phase1 = isPhase1Day(day);

    // Score calculation
    let score = 0;
    const reasons: string[] = [];

    if (sameUnitCount > 0) {
      score += 100 + Math.min(sameUnitCount * 4, 40);
      reasons.push(`Cùng đơn vị (${sameUnitCount} người)`);
    }
    if (samePlatoonCount > 0) {
      score += 45 + Math.min(samePlatoonCount * 3, 24);
      reasons.push(`Cùng tiểu đoàn (${samePlatoonCount})`);
    }
    if (targetGender !== 'unknown' && effectiveGender === targetGender) {
      score += 55;
      reasons.push(targetGender === 'female' ? 'Phòng Nữ' : 'Phòng Nam');
    } else if (effectiveGender === 'empty') {
      score += 20;
      reasons.push('Phòng trống sẵn sàng');
    }

    if (preferPhase1 && phase1) {
      score += 35;
      reasons.push('Ưu tiên GĐ 1 (Dãy 1–3)');
    }

    // Encourage filling partially occupied rooms cleanly (when compatible) before scattering
    if (currentCount > 0) {
      score += 18 + Math.min(currentCount, 12);
    }

    if (hasIssue) {
      score -= 60;
      reasons.push('Có ghi chú bảo trì');
    }

    // Stable tie-breaker favoring lower Dãy & lower Phòng number
    const dayNumMatch = day.match(/(\d+)/);
    const roomNumMatch = normRoom.match(/(\d+)/);
    const dayNum = dayNumMatch ? parseInt(dayNumMatch[1], 10) : 99;
    const roomNum = roomNumMatch ? parseInt(roomNumMatch[1], 10) : 99;
    score -= dayNum * 0.5 + roomNum * 0.05;

    const usedBeds = new Set<string>(usedBedsByRoom.get(normKey) || []);
    const batchBeds = extraOccupiedBeds?.get(normKey);
    if (batchBeds) {
      batchBeds.forEach(b => usedBeds.add(b));
    }
    const firstFreeBed = findFirstAvailableBed(capacity, usedBeds);

    candidates.push({
      ktx,
      day,
      room: normRoom,
      capacity,
      currentCount,
      availableSlots,
      firstFreeBed,
      genderType: effectiveGender,
      sameUnitCount,
      samePlatoonCount,
      hasIssue,
      isPhase1: phase1,
      score,
      reasons,
    });
  }

  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    const dCmp = naturalSortCompare(a.day, b.day);
    if (dCmp !== 0) return dCmp;
    return naturalSortCompare(a.room, b.room);
  });

  return candidates.slice(0, limit);
}

export interface BatchAssignmentPlanItem {
  workerId: string;
  workerName: string;
  gioiTinh: string;
  donVi: string;
  assigned: {
    ktx: string;
    day: string;
    room: string;
    bed: string;
    reasons: string[];
  } | null;
}

/**
 * Plans non-overlapping, gender-safe, capacity-safe room & bed assignments for a batch of workers.
 */
export function planBatchSmartAssignments(
  targets: Array<{ id: string; hoVaTen: string; gioiTinh?: string; donVi?: string; tieuDoan?: string; ktx?: string }>,
  allWorkers: Worker[],
  facilities: FacilityItem[],
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>,
  options: { preferPhase1?: boolean; allowedDays?: string[]; targetKtx?: string } = {}
): BatchAssignmentPlanItem[] {
  const targetIdSet = new Set(targets.map(t => t.id));
  const baselineWorkers = allWorkers.filter(w => !targetIdSet.has(w.id));

  const extraOccupiedByRoom = new Map<string, number>();
  const extraOccupiedBeds = new Map<string, Set<string>>();
  const extraAssignedGender = new Map<string, 'male' | 'female'>();

  // Group targets by gender + unit so teammates land in the same room consecutively
  const ordered = [...targets].sort((a, b) => {
    const gCmp = (a.gioiTinh || '').localeCompare(b.gioiTinh || '', 'vi');
    if (gCmp !== 0) return gCmp;
    const uCmp = (a.donVi || '').localeCompare(b.donVi || '', 'vi');
    if (uCmp !== 0) return uCmp;
    return (a.hoVaTen || '').localeCompare(b.hoVaTen || '', 'vi');
  });

  // Track virtual workers placed during batch so subsequent same-unit workers see them
  const virtualWorkers: Worker[] = [...baselineWorkers];
  const results: BatchAssignmentPlanItem[] = [];

  for (const item of ordered) {
    const suggestions = suggestOptimalRooms(
      {
        id: item.id,
        gioiTinh: item.gioiTinh,
        donVi: item.donVi,
        tieuDoan: item.tieuDoan,
        ktx: options.targetKtx || item.ktx,
      },
      virtualWorkers,
      facilities,
      roomGenderMap,
      {
        preferPhase1: options.preferPhase1 ?? true,
        allowedDays: options.allowedDays,
        limit: 1,
        extraOccupiedByRoom,
        extraOccupiedBeds,
        extraAssignedGender,
      }
    );

    const best = suggestions[0];
    if (!best) {
      results.push({
        workerId: item.id,
        workerName: item.hoVaTen,
        gioiTinh: item.gioiTinh || '',
        donVi: item.donVi || '',
        assigned: null,
      });
      continue;
    }

    const roomKey = `${best.ktx}||${best.day}||${best.room}`;
    extraOccupiedByRoom.set(roomKey, (extraOccupiedByRoom.get(roomKey) || 0) + 1);
    let bedSet = extraOccupiedBeds.get(roomKey);
    if (!bedSet) {
      bedSet = new Set<string>();
      extraOccupiedBeds.set(roomKey, bedSet);
    }
    bedSet.add(best.firstFreeBed);

    const g = toRoomGenderBucket(item.gioiTinh);
    if ((g === 'male' || g === 'female') && !extraAssignedGender.has(roomKey)) {
      extraAssignedGender.set(roomKey, g);
    }

    // Add synthetic record so same-unit teammates cluster into the same room
    virtualWorkers.push({
      id: item.id,
      stt: 0,
      hoVaTen: item.hoVaTen,
      maNV: '',
      cccd: '',
      soDienThoai: '',
      gioiTinh: item.gioiTinh || '',
      ngaySinh: '',
      hoKhauTinh: '',
      ktx: best.ktx,
      day: best.day,
      phongSo: best.room,
      giuong: best.firstFreeBed,
      donVi: item.donVi || '',
      tieuDoan: item.tieuDoan || '',
      toTruong: '',
      sdtToTruong: '',
      ngayVaoKTX: '',
      ngayRaKTX: '',
      khoaTraCuu: `${best.ktx}|${best.day}|${best.room}`,
      ghiChu: '',
      tamTruStatus: 'unregistered',
    });

    results.push({
      workerId: item.id,
      workerName: item.hoVaTen,
      gioiTinh: item.gioiTinh || '',
      donVi: item.donVi || '',
      assigned: {
        ktx: best.ktx,
        day: best.day,
        room: best.room,
        bed: best.firstFreeBed,
        reasons: best.reasons,
      },
    });
  }

  return results;
}
