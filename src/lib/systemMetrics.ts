import { Worker, DEFAULT_ROOM_CAPACITY, compareKtxNames, RoomCapacityLookup } from '@/data/workers';
import { getRoomGenderInfo, normalizeGender } from '@/lib/roomGender';
import { FacilityItem, normalizeRoomLabel } from '@/lib/facilityCapacity';

export interface KtxMetricItem {
  ktx: string;
  totalWorkers: number;
  male: number;
  female: number;
  maleRooms: number;
  femaleRooms: number;
  mixedRooms: number;
  emptyRooms: number;
  totalRooms: number;
  buildingCount: number;
  capacity: number;
  fillRate: number;
  vacant: number;
  overflow: number;
}

export interface SystemMetrics {
  activeKtxList: string[];
  totalWorkersAll: number;
  selectedWorkersCount: number;
  maleWorkers: number;
  femaleWorkers: number;
  uniqueBuildings: string[];
  buildingCount: number;
  uniqueRooms: string[];
  roomCount: number;
  capacity: number;
  workersWithRoom: number;
  workersWithoutRoom: number;
  fillRate: number;
  vacantSpots: number;
  overloadedRooms: number;
  emptyRoomsCount: number;
  maleRooms: number;
  femaleRooms: number;
  mixedRooms: number;
  emptyRooms: number;
  totalRooms: number;
  contractors: [string, number][];
  contractorByKtx: Record<string, [string, number][]>;
  genderByKtx: Record<string, { male: number; female: number }>;
  ktxBreakdown: KtxMetricItem[];
  overallRoomTotals: {
    maleRooms: number;
    femaleRooms: number;
    mixedRooms: number;
    emptyRooms: number;
    totalRooms: number;
  };
}

/**
 * Returns strictly the list of KTX areas that actually exist and have active data
 * in the database / system (from workers or physical facilities).
 */
export function getActiveKtxList(
  workers: Worker[] = [],
  knownKtxList: string[] = [],
  facilitiesList: FacilityItem[] = []
): string[] {
  const ktxSet = new Set<string>();
  const isCleanKtx = (k: string) => {
    if (!k) return false;
    const l = k.toLowerCase();
    return !l.includes('tổng') && !l.includes('tong') && !l.includes('cơ sở vật chất') && !l.includes('chưa phân');
  };

  (facilitiesList || []).forEach(f => {
    if ((f.room_type || 'accommodation') === 'accommodation' && f.is_visible !== false) {
      const k = (f.ktx ?? '').trim();
      if (isCleanKtx(k)) ktxSet.add(k);
    }
  });
  // If facilities list is empty, fallback to knownKtxList or workers for safety
  if (ktxSet.size === 0) {
    const safeWorkers = Array.isArray(workers) ? workers : [];
    safeWorkers.forEach(w => {
      const k = (w.ktx ?? '').trim();
      if (isCleanKtx(k)) ktxSet.add(k);
    });
    knownKtxList.forEach(k => {
      const s = (k ?? '').trim();
      if (isCleanKtx(s)) ktxSet.add(s);
    });
  }
  return Array.from(ktxSet).sort(compareKtxNames);
}

/**
 * Single Source of Truth for all operational numbers across Dashboard,
 * Reports ("Tổng quan đa chiều"), and Heatmap.
 * Renders from physical facilities inventory, excluding functional and hidden rooms.
 */
export function computeSystemMetrics(
  workers: Worker[] = [],
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'> = {},
  selectedKtx: string = 'all',
  knownKtxList: string[] = [],
  getCapacity: RoomCapacityLookup = () => DEFAULT_ROOM_CAPACITY,
  facilitiesList: FacilityItem[] = []
): SystemMetrics {
  const safeWorkers = Array.isArray(workers) ? workers : [];
  const safeRoomGenderMap = roomGenderMap && typeof roomGenderMap === 'object' ? roomGenderMap : {};
  
  // Filter only active physical accommodation rooms (exclude functional, hidden, and summary rows)
  const activeFacilities = (facilitiesList || []).filter(f => {
    if ((f.room_type || 'accommodation') !== 'accommodation' || f.is_visible === false) return false;
    const k = (f.ktx || '').toLowerCase();
    const d = (f.day || '').toLowerCase();
    const r = (f.phong_khu_vuc || '').toLowerCase();
    return !k.includes('tổng') && !k.includes('tong') && !d.includes('tổng') && !r.includes('tổng') && !/^\d+\s*phòng$/i.test(r.trim());
  });

  const activeKtxList = getActiveKtxList(safeWorkers, knownKtxList, facilitiesList);

  // Defensive capacity lookup: never throw / NaN even if facilities data is incomplete.
  const safeCap = (k: string, b: string, r: string): number => {
    try {
      const v = getCapacity(k, b, r);
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
    } catch {
      return 0;
    }
  };

  // Filter workers based on selected KTX
  const filteredWorkers = selectedKtx === 'all'
    ? safeWorkers
    : safeWorkers.filter(w => (w.ktx ?? '').trim() === selectedKtx);

  const totalWorkersAll = safeWorkers.length;
  const selectedWorkersCount = filteredWorkers.length;

  // Gender counts for filtered selection
  let maleWorkers = 0;
  let femaleWorkers = 0;
  filteredWorkers.forEach(w => {
    const g = normalizeGender(w.gioiTinh);
    if (g === 'nam') maleWorkers++;
    else if (g === 'nu') femaleWorkers++;
  });

  // Buildings and rooms for filtered selection — strictly driven by activeFacilities
  const buildingSet = new Set<string>();
  const buildingPairSet = new Set<string>();
  const roomSet = new Set<string>();
  const roomOccupancyMap = new Map<string, Worker[]>();
  let workersWithRoom = 0;

  // 1. Populate rooms and buildings 100% from physical facilities inventory
  activeFacilities.forEach(f => {
    const k = (f.ktx ?? '').trim();
    const b = (f.day ?? '').trim();
    const r = (f.phong_khu_vuc ?? '').trim();
    if (!k || !b || !r) return;
    if (selectedKtx === 'all' || k === selectedKtx) {
      buildingSet.add(b);
      buildingPairSet.add(`${k}||${b}`);
      const roomKey = `${k}||${b}||${r}`;
      roomSet.add(roomKey);
      if (!roomOccupancyMap.has(roomKey)) {
        roomOccupancyMap.set(roomKey, []);
      }
    }
  });

  // 2. Count workers into rooms that exist in activeFacilities
  filteredWorkers.forEach(w => {
    const b = (w.day ?? '').trim();
    const r = (w.phongSo ?? '').trim();
    const k = (w.ktx ?? '').trim();

    if (b && r) {
      const exactKey = `${k}||${b}||${r}`;
      let matchedKey: string | null = null;
      if (roomOccupancyMap.has(exactKey)) {
        matchedKey = exactKey;
      } else {
        const normR = normalizeRoomLabel(r);
        for (const key of roomSet) {
          const [fk, fb, fr] = key.split('||');
          if (fk === k && fb === b && normalizeRoomLabel(fr) === normR) {
            matchedKey = key;
            break;
          }
        }
      }

      if (matchedKey) {
        workersWithRoom++;
        roomOccupancyMap.get(matchedKey)!.push(w);
      }
    }
  });

  const uniqueBuildings = Array.from(buildingSet).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
  const buildingCount = buildingPairSet.size;
  const uniqueRooms = Array.from(roomSet);
  const roomCount = uniqueRooms.length;
  let capacity = 0;
  uniqueRooms.forEach(roomKey => {
    const [k, b, r] = roomKey.split('||');
    capacity += safeCap(k, b, r);
  });
  const workersWithoutRoom = Math.max(0, selectedWorkersCount - workersWithRoom);
  const fillRate = capacity > 0 ? Math.round((workersWithRoom / capacity) * 100) : 0;
  const vacantSpots = Math.max(0, capacity - workersWithRoom);

  // Overloaded & empty room counts
  let overloadedRooms = 0;
  let emptyRoomsCount = 0;
  roomOccupancyMap.forEach((rWorkers, roomKey) => {
    const [k, b, r] = roomKey.split('||');
    if (rWorkers.length > safeCap(k, b, r)) overloadedRooms++;
    if (rWorkers.length === 0) emptyRoomsCount++;
  });

  // Contractors ranking and Gender per KTX
  const donViMap: Record<string, number> = {};
  const contractorPerKtx: Record<string, Record<string, number>> = {};
  const genderByKtx: Record<string, { male: number; female: number }> = {};

  activeKtxList.forEach(k => {
    genderByKtx[k] = { male: 0, female: 0 };
    contractorPerKtx[k] = {};
  });

  safeWorkers.forEach(w => {
    const ktxKey = (w.ktx ?? '').trim();
    const g = normalizeGender(w.gioiTinh);

    if (ktxKey) {
      if (!genderByKtx[ktxKey]) genderByKtx[ktxKey] = { male: 0, female: 0 };
      if (g === 'nam') genderByKtx[ktxKey].male++;
      else if (g === 'nu') genderByKtx[ktxKey].female++;
    }

    const dv = (w.donVi ?? '').trim();
    if (dv) {
      donViMap[dv] = (donViMap[dv] || 0) + 1;
      if (ktxKey) {
        if (!contractorPerKtx[ktxKey]) contractorPerKtx[ktxKey] = {};
        contractorPerKtx[ktxKey][dv] = (contractorPerKtx[ktxKey][dv] || 0) + 1;
      }
    }
  });

  const contractors: [string, number][] = Object.entries(donViMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const contractorByKtx: Record<string, [string, number][]> = {};
  activeKtxList.forEach(k => {
    contractorByKtx[k] = [];
  });
  Object.keys(contractorPerKtx).forEach(k => {
    contractorByKtx[k] = Object.entries(contractorPerKtx[k])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  });

  // Per-KTX Detailed Breakdown (only active KTXs)
  const ktxBreakdown: KtxMetricItem[] = activeKtxList.map(ktx => {
    const ktxWorkers = safeWorkers.filter(w => (w.ktx ?? '').trim() === ktx);
    let male = 0;
    let female = 0;
    const ktxRooms = new Map<string, Worker[]>();
    const ktxBuildings = new Set<string>();
    let withRoomCount = 0;

    // 1. Populate physical facility rooms for this KTX
    activeFacilities.forEach(f => {
      const k = (f.ktx ?? '').trim();
      const b = (f.day ?? '').trim();
      const r = (f.phong_khu_vuc ?? '').trim();
      if (k === ktx && b && r) {
        ktxBuildings.add(b);
        const rKey = `${ktx}||${b}||${r}`;
        if (!ktxRooms.has(rKey)) {
          ktxRooms.set(rKey, []);
        }
      }
    });

    // 2. Count workers into rooms that exist in activeFacilities
    ktxWorkers.forEach(w => {
      const g = normalizeGender(w.gioiTinh);
      if (g === 'nam') male++;
      else if (g === 'nu') female++;

      const b = (w.day ?? '').trim();
      const r = (w.phongSo ?? '').trim();

      if (b && r) {
        const exactKey = `${ktx}||${b}||${r}`;
        let matchedKey: string | null = null;
        if (ktxRooms.has(exactKey)) {
          matchedKey = exactKey;
        } else {
          const normR = normalizeRoomLabel(r);
          for (const key of ktxRooms.keys()) {
            const [, fb, fr] = key.split('||');
            if (fb === b && normalizeRoomLabel(fr) === normR) {
              matchedKey = key;
              break;
            }
          }
        }

        if (matchedKey) {
          withRoomCount++;
          ktxRooms.get(matchedKey)!.push(w);
        }
      }
    });

    let maleRooms = 0;
    let femaleRooms = 0;
    let mixedRooms = 0;
    let emptyRooms = 0;

    ktxRooms.forEach((rWorkers, rKey) => {
      const adminGender = safeRoomGenderMap[rKey];
      const gInfo = getRoomGenderInfo(
        rWorkers,
        adminGender === 'male' ? 'Nam' : adminGender === 'female' ? 'Nữ' : null
      );
      if (gInfo.gender === 'female') femaleRooms++;
      else if (gInfo.gender === 'male') maleRooms++;
      else if (gInfo.gender === 'mixed') mixedRooms++;
      else if (gInfo.gender === 'empty') emptyRooms++;
    });

    const totalRooms = ktxRooms.size;
    let ktxCapacity = 0;
    ktxRooms.forEach((_rWorkers, rKey) => {
      const [k, b, r] = rKey.split('||');
      ktxCapacity += safeCap(k, b, r);
    });
    const ktxFillRate = ktxCapacity > 0 ? Math.round((withRoomCount / ktxCapacity) * 100) : 0;
    const vacant = Math.max(0, ktxCapacity - withRoomCount);
    const overflow = Math.max(0, withRoomCount - ktxCapacity);

    return {
      ktx,
      totalWorkers: ktxWorkers.length,
      male,
      female,
      maleRooms,
      femaleRooms,
      mixedRooms,
      emptyRooms,
      totalRooms,
      buildingCount: ktxBuildings.size,
      capacity: ktxCapacity,
      fillRate: ktxFillRate,
      vacant,
      overflow,
    };
  });

  // Overall Room Totals across all active KTX
  let overallMaleRooms = 0;
  let overallFemaleRooms = 0;
  let overallMixedRooms = 0;
  let overallEmptyRooms = 0;
  let overallTotalRooms = 0;

  ktxBreakdown.forEach(k => {
    overallMaleRooms += k.maleRooms;
    overallFemaleRooms += k.femaleRooms;
    overallMixedRooms += k.mixedRooms;
    overallEmptyRooms += k.emptyRooms;
    overallTotalRooms += k.totalRooms;
  });

  const currentKtxBreakdown = selectedKtx !== 'all' ? ktxBreakdown.find(k => k.ktx === selectedKtx) : null;

  return {
    activeKtxList,
    totalWorkersAll,
    selectedWorkersCount,
    maleWorkers,
    femaleWorkers,
    uniqueBuildings,
    buildingCount,
    uniqueRooms,
    roomCount,
    capacity,
    workersWithRoom,
    workersWithoutRoom,
    fillRate,
    vacantSpots,
    overloadedRooms,
    emptyRoomsCount,
    maleRooms: currentKtxBreakdown ? currentKtxBreakdown.maleRooms : overallMaleRooms,
    femaleRooms: currentKtxBreakdown ? currentKtxBreakdown.femaleRooms : overallFemaleRooms,
    mixedRooms: currentKtxBreakdown ? currentKtxBreakdown.mixedRooms : overallMixedRooms,
    emptyRooms: currentKtxBreakdown ? currentKtxBreakdown.emptyRooms : overallEmptyRooms,
    totalRooms: currentKtxBreakdown ? currentKtxBreakdown.totalRooms : overallTotalRooms,
    contractors,
    contractorByKtx,
    genderByKtx,
    ktxBreakdown,
    overallRoomTotals: {
      maleRooms: overallMaleRooms,
      femaleRooms: overallFemaleRooms,
      mixedRooms: overallMixedRooms,
      emptyRooms: overallEmptyRooms,
      totalRooms: overallTotalRooms,
    },
  };
}
