'use client';

import { Worker, DEFAULT_ROOM_CAPACITY, naturalSortCompare, compareKtxNames, removeAccents } from '@/data/workers';
import { FacilityItem, formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { BedReservation, BedReservationSlotInput, buildReservationSlotKey } from '@/lib/bedReservations';
import { buildCanonicalBedKey, normalizeBedLabel } from '@/lib/bedSync';
import { RoomGenderInfo, getRoomGenderInfo, normalizeGender } from '@/lib/roomGender';

export interface IntakeBedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'empty' | 'occupied' | 'maintenance';
  worker_id: string | null;
}

export interface RoomFreeBucket {
  ktx: string;
  day: string;
  phongSo: string;
  roomDisplay: string;
  capacity: number;
  occupiedCount: number;
  /** 'male' | 'female' | 'flex' (completely empty room with no fixed gender) */
  genderBucket: 'male' | 'female' | 'flex';
  genderLabel: string;
  /** Units already living in this room (used for unit-affinity grouping) */
  existingUnits: Set<string>;
  /** Free bed labels (excluding occupied, maintenance, and active reservations) */
  freeBeds: string[];
}

export interface PlannedRoomAllocation {
  ktx: string;
  day: string;
  phongSo: string;
  roomDisplay: string;
  forGender: 'Nam' | 'Nữ';
  wasFlexRoom: boolean;
  assignedBeds: string[];
  remainingAfter: number;
}

export interface GroupCapacityForecastResult {
  maleRequested: number;
  femaleRequested: number;
  totalFreeMale: number;
  totalFreeFemale: number;
  totalFreeFlex: number;
  allocatedMale: number;
  allocatedFemale: number;
  shortageMale: number;
  shortageFemale: number;
  enoughAll: boolean;
  allocations: PlannedRoomAllocation[];
  slotsToReserve: BedReservationSlotInput[];
  zaloReportText: string;
}

export interface BatchBedAssignmentItem {
  worker: Worker;
  ktx: string;
  day: string;
  phongSo: string;
  roomDisplay: string;
  giuong: string;
  matchReason: 'reservation' | 'same_unit' | 'same_gender' | 'flex_room';
  matchLabel: string;
  matchedReservationId?: string;
}

export interface BatchBedPlanResult {
  assignments: BatchBedAssignmentItem[];
  unassigned: Array<{ worker: Worker; reason: string }>;
}

function normStr(v?: string | null): string {
  return removeAccents((v || '').trim()).toLowerCase();
}

function isWorkerFemale(w: Worker): boolean {
  const g = normalizeGender(w.gioiTinh);
  return g === 'nu';
}

function buildRoomFreeBuckets(params: {
  facilities: FacilityItem[];
  beds: IntakeBedRow[];
  workers: Worker[];
  reservations: BedReservation[];
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>;
  ktxFilter?: string;
  dayFilter?: string;
  allowedBlockFn?: (day: string, ktx?: string) => boolean;
}): RoomFreeBucket[] {
  const { facilities, beds, workers, reservations, roomGenderMap, ktxFilter, dayFilter, allowedBlockFn } = params;

  const reservedKeys = new Set<string>(
    reservations
      .filter(r => r.status === 'active')
      .map(r => buildReservationSlotKey(r.ktx, r.day, r.phong_so, r.giuong))
  );

  // Group active workers by room
  const roomWorkersMap = new Map<string, Worker[]>();
  const occupiedBedKeys = new Set<string>();
  for (const w of workers) {
    if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) continue;
    const k = (w.ktx || '').trim();
    const d = (w.day || '').trim();
    const r = normalizeRoomLabel(w.phongSo);
    if (!k || !d || !r) continue;
    const rk = `${k}||${d}||${r}`;
    const list = roomWorkersMap.get(rk) || [];
    list.push(w);
    roomWorkersMap.set(rk, list);
    const b = normalizeBedLabel(w.giuong);
    if (b) occupiedBedKeys.add(buildCanonicalBedKey(k, d, r, b));
  }

  // Group beds table rows by room
  const roomBedsMap = new Map<string, IntakeBedRow[]>();
  for (const row of beds) {
    const k = (row.ktx || '').trim();
    const d = (row.day || '').trim();
    const r = normalizeRoomLabel(row.phong_so);
    if (!k || !d || !r) continue;
    const rk = `${k}||${d}||${r}`;
    const list = roomBedsMap.get(rk) || [];
    list.push(row);
    roomBedsMap.set(rk, list);
  }

  // Build unique rooms from facilities + beds
  const roomMetaMap = new Map<string, { ktx: string; day: string; phongSo: string; capacity: number }>();
  for (const f of facilities) {
    if (f.is_visible === false) continue;
    const k = (f.ktx || '').trim();
    const d = (f.day || '').trim();
    const r = normalizeRoomLabel(f.phong_khu_vuc);
    if (!k || !d || !r) continue;
    const rk = `${k}||${d}||${r}`;
    if (!roomMetaMap.has(rk)) {
      roomMetaMap.set(rk, {
        ktx: k,
        day: d,
        phongSo: r,
        capacity: Number(f.giuong) > 0 ? Number(f.giuong) : DEFAULT_ROOM_CAPACITY,
      });
    }
  }
  for (const [rk, rows] of roomBedsMap.entries()) {
    if (!roomMetaMap.has(rk) && rows.length > 0) {
      const sample = rows[0];
      roomMetaMap.set(rk, {
        ktx: sample.ktx.trim(),
        day: sample.day.trim(),
        phongSo: normalizeRoomLabel(sample.phong_so),
        capacity: Math.max(rows.length, DEFAULT_ROOM_CAPACITY),
      });
    }
  }

  const buckets: RoomFreeBucket[] = [];

  for (const [rk, meta] of roomMetaMap.entries()) {
    if (ktxFilter && ktxFilter !== 'all' && meta.ktx !== ktxFilter) continue;
    if (dayFilter && dayFilter !== 'all' && meta.day !== dayFilter) continue;
    if (allowedBlockFn && !allowedBlockFn(meta.day, meta.ktx)) continue;

    const rWorkers = roomWorkersMap.get(rk) || [];
    const rBedRows = roomBedsMap.get(rk) || [];

    // Collect candidate bed labels from DB beds or 1..capacity fallback
    const bedStatusMap = new Map<string, 'empty' | 'occupied' | 'maintenance'>();
    for (const row of rBedRows) {
      const lbl = normalizeBedLabel(row.giuong);
      if (!lbl) continue;
      bedStatusMap.set(lbl, row.status);
    }
    if (bedStatusMap.size === 0) {
      for (let i = 1; i <= meta.capacity; i++) {
        bedStatusMap.set(String(i), 'empty');
      }
    }

    const freeBeds: string[] = [];
    for (const [bedLbl, status] of bedStatusMap.entries()) {
      if (status !== 'empty') continue;
      const canonKey = buildCanonicalBedKey(meta.ktx, meta.day, meta.phongSo, bedLbl);
      if (occupiedBedKeys.has(canonKey)) continue;
      if (reservedKeys.has(canonKey)) continue;
      freeBeds.push(bedLbl);
    }

    freeBeds.sort(naturalSortCompare);
    if (freeBeds.length === 0) continue;

    // Determine gender bucket
    const explicitOverride =
      roomGenderMap[`${meta.ktx}||${meta.day}||${meta.phongSo}`] ||
      roomGenderMap[`${meta.ktx}||${meta.day}||P.${meta.phongSo}`] ||
      'auto';
    const overrideLabel = explicitOverride === 'male' ? 'Nam' : explicitOverride === 'female' ? 'Nữ' : null;
    const gInfo: RoomGenderInfo = getRoomGenderInfo(rWorkers, overrideLabel);

    let genderBucket: 'male' | 'female' | 'flex' = 'flex';
    let genderLabel = 'Phòng trống linh hoạt';
    if (gInfo.gender === 'female') {
      genderBucket = 'female';
      genderLabel = 'Phòng Nữ';
    } else if (gInfo.gender === 'male') {
      genderBucket = 'male';
      genderLabel = 'Phòng Nam';
    } else if (gInfo.gender === 'mixed') {
      // Skip mixed rooms from auto-assign to avoid worsening gender conflict
      continue;
    }

    const existingUnits = new Set<string>();
    for (const w of rWorkers) {
      if (w.donVi?.trim()) existingUnits.add(normStr(w.donVi));
    }

    buckets.push({
      ktx: meta.ktx,
      day: meta.day,
      phongSo: meta.phongSo,
      roomDisplay: formatRoomDisplay(meta.phongSo),
      capacity: meta.capacity,
      occupiedCount: rWorkers.length,
      genderBucket,
      genderLabel,
      existingUnits,
      freeBeds,
    });
  }

  // Sort deterministically by KTX -> Dãy -> Phòng
  buckets.sort(
    (a, b) =>
      compareKtxNames(a.ktx, b.ktx) ||
      naturalSortCompare(a.day, b.day) ||
      naturalSortCompare(a.phongSo, b.phongSo)
  );

  return buckets;
}

/**
 * Step 1: Forecast capacity for an incoming worker group (X Male + Y Female)
 * and generate an optimal bed allocation plan ready for 1-click reservation or Zalo briefing.
 */
export function planGroupCapacity(params: {
  maleCount: number;
  femaleCount: number;
  groupName: string;
  expectedDate: string;
  ktxFilter?: string;
  dayFilter?: string;
  facilities: FacilityItem[];
  beds: IntakeBedRow[];
  workers: Worker[];
  reservations: BedReservation[];
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>;
  allowedBlockFn?: (day: string, ktx?: string) => boolean;
}): GroupCapacityForecastResult {
  const maleRequested = Math.max(0, Math.floor(params.maleCount || 0));
  const femaleRequested = Math.max(0, Math.floor(params.femaleCount || 0));

  const buckets = buildRoomFreeBuckets({
    facilities: params.facilities,
    beds: params.beds,
    workers: params.workers,
    reservations: params.reservations,
    roomGenderMap: params.roomGenderMap,
    ktxFilter: params.ktxFilter,
    dayFilter: params.dayFilter,
    allowedBlockFn: params.allowedBlockFn,
  });

  const totalFreeMale = buckets
    .filter(b => b.genderBucket === 'male')
    .reduce((s, b) => s + b.freeBeds.length, 0);
  const totalFreeFemale = buckets
    .filter(b => b.genderBucket === 'female')
    .reduce((s, b) => s + b.freeBeds.length, 0);
  const totalFreeFlex = buckets
    .filter(b => b.genderBucket === 'flex')
    .reduce((s, b) => s + b.freeBeds.length, 0);

  // Working copies of free bed arrays
  const remainingByRoom = new Map<string, { bucket: RoomFreeBucket; beds: string[]; claimedGender: 'male' | 'female' | 'flex' }>();
  for (const b of buckets) {
    remainingByRoom.set(`${b.ktx}||${b.day}||${b.phongSo}`, {
      bucket: b,
      beds: [...b.freeBeds],
      claimedGender: b.genderBucket,
    });
  }

  const allocations: PlannedRoomAllocation[] = [];
  const slotsToReserve: BedReservationSlotInput[] = [];

  const allocateForGender = (targetGender: 'male' | 'female', count: number): number => {
    if (count <= 0) return 0;
    let left = count;
    const genderLabelVi: 'Nam' | 'Nữ' = targetGender === 'female' ? 'Nữ' : 'Nam';

    // Priority 1: Existing same-gender rooms sorted by most free beds first (pack contiguously)
    const sameGenderRooms = Array.from(remainingByRoom.values())
      .filter(r => r.claimedGender === targetGender && r.beds.length > 0)
      .sort((a, b) => b.beds.length - a.beds.length || compareKtxNames(a.bucket.ktx, b.bucket.ktx) || naturalSortCompare(a.bucket.day, b.bucket.day));

    // Priority 2: Completely empty flexible rooms (sorted by capacity desc)
    const flexRooms = Array.from(remainingByRoom.values())
      .filter(r => r.claimedGender === 'flex' && r.beds.length > 0)
      .sort((a, b) => b.beds.length - a.beds.length || compareKtxNames(a.bucket.ktx, b.bucket.ktx) || naturalSortCompare(a.bucket.day, b.bucket.day));

    const candidates = [...sameGenderRooms, ...flexRooms];

    for (const room of candidates) {
      if (left <= 0) break;
      const takeCount = Math.min(left, room.beds.length);
      if (takeCount <= 0) continue;

      const wasFlexRoom = room.claimedGender === 'flex';
      room.claimedGender = targetGender;
      const assignedBeds = room.beds.splice(0, takeCount);
      left -= takeCount;

      allocations.push({
        ktx: room.bucket.ktx,
        day: room.bucket.day,
        phongSo: room.bucket.phongSo,
        roomDisplay: room.bucket.roomDisplay,
        forGender: genderLabelVi,
        wasFlexRoom,
        assignedBeds,
        remainingAfter: room.beds.length,
      });

      for (const bedLbl of assignedBeds) {
        slotsToReserve.push({
          ktx: room.bucket.ktx,
          day: room.bucket.day,
          phong_so: room.bucket.phongSo,
          giuong: bedLbl,
        });
      }
    }

    return count - left;
  };

  // Allocate Female first (usually scarcer gender rooms), then Male
  const allocatedFemale = allocateForGender('female', femaleRequested);
  const allocatedMale = allocateForGender('male', maleRequested);

  const shortageMale = Math.max(0, maleRequested - allocatedMale);
  const shortageFemale = Math.max(0, femaleRequested - allocatedFemale);
  const enoughAll = shortageMale === 0 && shortageFemale === 0;

  // Build concise Zalo briefing text
  const scopeTitle =
    params.ktxFilter && params.ktxFilter !== 'all'
      ? params.dayFilter && params.dayFilter !== 'all'
        ? `${params.ktxFilter} · ${params.dayFilter}`
        : params.ktxFilter
      : 'Toàn khu KTX';

  const lines: string[] = [
    `📋 PHƯƠNG ÁN TIẾP NHẬN ĐOÀN CÔNG NHÂN`,
    `• Đơn vị/Đoàn: ${params.groupName.trim() || 'Đoàn công nhân mới'}`,
    `• Ngày dự kiến vào: ${params.expectedDate || 'Chưa ấn định'}`,
    `• Phạm vi rà soát: ${scopeTitle}`,
    `• Nhu cầu: ${maleRequested + femaleRequested} người (${maleRequested} Nam, ${femaleRequested} Nữ)`,
    `• Đánh giá quỹ giường trống thực tế: ${
      enoughAll
        ? `✅ ĐỦ CHỖ (${allocatedMale} Nam, ${allocatedFemale} Nữ)`
        : `⚠️ THIẾU ${shortageMale + shortageFemale} GIƯỜNG (${shortageMale > 0 ? `Thiếu ${shortageMale} Nam` : ''}${shortageMale > 0 && shortageFemale > 0 ? ', ' : ''}${shortageFemale > 0 ? `Thiếu ${shortageFemale} Nữ` : ''})`
    }`,
  ];

  if (allocations.length > 0) {
    lines.push('', `🛏️ CHI TIẾT PHÂN BỔ (${allocations.length} phòng · ${slotsToReserve.length} giường):`);
    allocations.forEach((a, idx) => {
      const bedPreview =
        a.assignedBeds.length <= 6
          ? a.assignedBeds.map(b => `G${b}`).join(', ')
          : `G${a.assignedBeds[0]}..G${a.assignedBeds[a.assignedBeds.length - 1]}`;
      lines.push(
        `${idx + 1}. ${a.ktx} · ${a.day} · ${a.roomDisplay} [${a.forGender}${a.wasFlexRoom ? ' - Phòng mới mở' : ''}]: ${a.assignedBeds.length} giường (${bedPreview})`
      );
    });
  }

  return {
    maleRequested,
    femaleRequested,
    totalFreeMale,
    totalFreeFemale,
    totalFreeFlex,
    allocatedMale,
    allocatedFemale,
    shortageMale,
    shortageFemale,
    enoughAll,
    allocations,
    slotsToReserve,
    zaloReportText: lines.join('\n'),
  };
}

/**
 * Step 2: Automatically assign contiguous empty beds to a batch of unbedded workers,
 * prioritizing active reservations matching the worker's unit/group, then same-unit rooms,
 * then same-gender rooms, then empty flexible rooms.
 */
export function planBatchBedAssignment(params: {
  targetWorkers: Worker[];
  facilities: FacilityItem[];
  beds: IntakeBedRow[];
  allWorkers: Worker[];
  reservations: BedReservation[];
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>;
  ktxFilter?: string;
  dayFilter?: string;
  allowedBlockFn?: (day: string, ktx?: string) => boolean;
}): BatchBedPlanResult {
  const { targetWorkers, facilities, beds, allWorkers, reservations, roomGenderMap, ktxFilter, dayFilter, allowedBlockFn } = params;

  const occupiedBedKeys = new Set<string>();
  for (const w of allWorkers) {
    if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) continue;
    const b = normalizeBedLabel(w.giuong);
    if (w.ktx && w.day && w.phongSo && b) {
      occupiedBedKeys.add(buildCanonicalBedKey(w.ktx, w.day, w.phongSo, b));
    }
  }
  const maintenanceBedKeys = new Set<string>();
  for (const row of beds) {
    if (row.status === 'maintenance') {
      maintenanceBedKeys.add(buildCanonicalBedKey(row.ktx, row.day, row.phong_so, row.giuong));
    }
  }

  // Build available reservation pool (filtered by scope & not already occupied/maintenance)
  const availableReservations = reservations
    .filter(r => {
      if (r.status !== 'active') return false;
      if (ktxFilter && ktxFilter !== 'all' && r.ktx.trim() !== ktxFilter) return false;
      if (dayFilter && dayFilter !== 'all' && r.day.trim() !== dayFilter) return false;
      if (allowedBlockFn && !allowedBlockFn(r.day, r.ktx)) return false;
      const key = buildReservationSlotKey(r.ktx, r.day, r.phong_so, r.giuong);
      if (occupiedBedKeys.has(key) || maintenanceBedKeys.has(key)) return false;
      return true;
    })
    .sort((a, b) => a.expected_date.localeCompare(b.expected_date) || naturalSortCompare(a.giuong, b.giuong));

  const usedReservationIds = new Set<string>();

  // Build regular free room buckets (excluding active reservations)
  const buckets = buildRoomFreeBuckets({
    facilities,
    beds,
    workers: allWorkers,
    reservations,
    roomGenderMap,
    ktxFilter,
    dayFilter,
    allowedBlockFn,
  });

  const roomPool = buckets.map(b => ({
    ...b,
    beds: [...b.freeBeds],
    claimedGender: b.genderBucket as 'male' | 'female' | 'flex',
    units: new Set<string>(b.existingUnits),
  }));

  // Group target workers by gender + unit so people from the same unit sit together
  const sortedTargets = [...targetWorkers].sort((a, b) => {
    const gA = isWorkerFemale(a) ? 0 : 1;
    const gB = isWorkerFemale(b) ? 0 : 1;
    if (gA !== gB) return gA - gB;
    const uCmp = normStr(a.donVi).localeCompare(normStr(b.donVi));
    if (uCmp !== 0) return uCmp;
    return (a.hoVaTen || '').localeCompare(b.hoVaTen || '', 'vi');
  });

  const assignments: BatchBedAssignmentItem[] = [];
  const unassigned: Array<{ worker: Worker; reason: string }> = [];

  for (const w of sortedTargets) {
    const wGender: 'male' | 'female' = isWorkerFemale(w) ? 'female' : 'male';
    const wUnitNorm = normStr(w.donVi);

    // 1. Try matching active reservation whose group_name matches worker's unit/team/battalion
    let matchedRes: BedReservation | undefined;
    if (wUnitNorm) {
      matchedRes = availableReservations.find(r => {
        if (usedReservationIds.has(r.id)) return false;
        const gNorm = normStr(r.group_name);
        if (!gNorm) return false;
        const unitMatches = gNorm.includes(wUnitNorm) || wUnitNorm.includes(gNorm);
        if (!unitMatches) return false;
        // Check room gender compatibility
        const normR = normalizeRoomLabel(r.phong_so);
        const override = roomGenderMap[`${r.ktx.trim()}||${r.day.trim()}||${normR}`] || 'auto';
        if (override === 'male' && wGender === 'female') return false;
        if (override === 'female' && wGender === 'male') return false;
        return true;
      });
    }

    if (matchedRes) {
      usedReservationIds.add(matchedRes.id);
      const normR = normalizeRoomLabel(matchedRes.phong_so);
      assignments.push({
        worker: w,
        ktx: matchedRes.ktx.trim(),
        day: matchedRes.day.trim(),
        phongSo: normR,
        roomDisplay: formatRoomDisplay(normR),
        giuong: normalizeBedLabel(matchedRes.giuong) || matchedRes.giuong.trim(),
        matchReason: 'reservation',
        matchLabel: `Khớp giữ chỗ (${matchedRes.group_name})`,
        matchedReservationId: matchedRes.id,
      });
      continue;
    }

    // 2. Same-gender room with same unit already present
    let chosen = wUnitNorm
      ? roomPool.find(r => r.claimedGender === wGender && r.beds.length > 0 && r.units.has(wUnitNorm))
      : undefined;
    let reason: BatchBedAssignmentItem['matchReason'] = 'same_unit';
    let label = 'Cùng đơn vị & giới tính';

    // 3. Same-gender room with remaining space
    if (!chosen) {
      chosen = roomPool.find(r => r.claimedGender === wGender && r.beds.length > 0);
      reason = 'same_gender';
      label = wGender === 'female' ? 'Phòng Nữ còn trống' : 'Phòng Nam còn trống';
    }

    // 4. Empty flexible room
    if (!chosen) {
      chosen = roomPool.find(r => r.claimedGender === 'flex' && r.beds.length > 0);
      reason = 'flex_room';
      label = 'Phòng trống mới mở';
    }

    if (!chosen) {
      unassigned.push({
        worker: w,
        reason: `Hết giường trống phù hợp (${wGender === 'female' ? 'Nữ' : 'Nam'}) trong phạm vi đã chọn`,
      });
      continue;
    }

    const bedLbl = chosen.beds.shift()!;
    chosen.claimedGender = wGender;
    if (wUnitNorm) chosen.units.add(wUnitNorm);

    assignments.push({
      worker: w,
      ktx: chosen.ktx,
      day: chosen.day,
      phongSo: chosen.phongSo,
      roomDisplay: chosen.roomDisplay,
      giuong: bedLbl,
      matchReason: reason,
      matchLabel: label,
    });
  }

  return { assignments, unassigned };
}
