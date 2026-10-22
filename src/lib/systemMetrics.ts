import { Worker, ROOM_CAPACITY, compareKtxNames } from '@/data/workers';
import { getRoomGenderInfo, normalizeGender } from '@/lib/roomGender';

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
 * in the database / system.
 */
export function getActiveKtxList(
  workers: Worker[] = [],
  knownKtxList: string[] = []
): string[] {
  const safeWorkers = Array.isArray(workers) ? workers : [];
  const ktxSet = new Set<string>(knownKtxList);
  safeWorkers.forEach(w => {
    const k = (w.ktx ?? '').trim();
    if (k) ktxSet.add(k);
  });
  return Array.from(ktxSet).sort(compareKtxNames);
}

/**
 * Single Source of Truth for all operational numbers across Dashboard,
 * Reports ("Tổng quan đa chiều"), and Heatmap.
 */
export function computeSystemMetrics(
  workers: Worker[] = [],
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'> = {},
  selectedKtx: string = 'all',
  knownKtxList: string[] = []
): SystemMetrics {
  const safeWorkers = Array.isArray(workers) ? workers : [];
  const safeRoomGenderMap = roomGenderMap && typeof roomGenderMap === 'object' ? roomGenderMap : {};
  const activeKtxList = getActiveKtxList(safeWorkers, knownKtxList);

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

  // Buildings and rooms for filtered selection
  const buildingSet = new Set<string>();
  const roomSet = new Set<string>();
  const roomOccupancyMap = new Map<string, Worker[]>();
  let workersWithRoom = 0;

  filteredWorkers.forEach(w => {
    const b = (w.day ?? '').trim();
    const r = (w.phongSo ?? '').trim();
    const k = (w.ktx ?? '').trim();

    if (b) buildingSet.add(b);

    if (b && r) {
      workersWithRoom++;
      const roomKey = `${k}||${b}||${r}`;
      roomSet.add(roomKey);
      if (!roomOccupancyMap.has(roomKey)) {
        roomOccupancyMap.set(roomKey, []);
      }
      roomOccupancyMap.get(roomKey)!.push(w);
    }
  });

  // Also include any rooms recorded in safeRoomGenderMap for the filtered selection
  Object.keys(safeRoomGenderMap).forEach(key => {
    const [k, b, r] = key.split('||');
    if (!k || !b || !r) return;
    if (selectedKtx === 'all' || k === selectedKtx) {
      buildingSet.add(b);
      roomSet.add(key);
      if (!roomOccupancyMap.has(key)) {
        roomOccupancyMap.set(key, []);
      }
    }
  });

  const uniqueBuildings = Array.from(buildingSet).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  const buildingCount = uniqueBuildings.length;
  const uniqueRooms = Array.from(roomSet);
  const roomCount = uniqueRooms.length;
  const capacity = roomCount * ROOM_CAPACITY;
  const workersWithoutRoom = Math.max(0, selectedWorkersCount - workersWithRoom);
  const fillRate = capacity > 0 ? Math.round((workersWithRoom / capacity) * 100) : 0;
  const vacantSpots = Math.max(0, capacity - workersWithRoom);

  // Overloaded & empty room counts
  let overloadedRooms = 0;
  let emptyRoomsCount = 0;
  roomOccupancyMap.forEach(rWorkers => {
    if (rWorkers.length > ROOM_CAPACITY) overloadedRooms++;
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

    ktxWorkers.forEach(w => {
      const g = normalizeGender(w.gioiTinh);
      if (g === 'nam') male++;
      else if (g === 'nu') female++;

      const b = (w.day ?? '').trim();
      const r = (w.phongSo ?? '').trim();
      if (b) ktxBuildings.add(b);

      if (b && r) {
        withRoomCount++;
        const rKey = `${ktx}||${b}||${r}`;
        if (!ktxRooms.has(rKey)) ktxRooms.set(rKey, []);
        ktxRooms.get(rKey)!.push(w);
      }
    });

    // Also include any rooms recorded in safeRoomGenderMap for this KTX
    Object.keys(safeRoomGenderMap).forEach(key => {
      const [k, b] = key.split('||');
      if (k === ktx && b) {
        ktxBuildings.add(b);
        if (!ktxRooms.has(key)) {
          ktxRooms.set(key, []);
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
    const ktxCapacity = totalRooms * ROOM_CAPACITY;
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
    maleRooms: overallMaleRooms,
    femaleRooms: overallFemaleRooms,
    mixedRooms: overallMixedRooms,
    emptyRooms: overallEmptyRooms,
    totalRooms: overallTotalRooms,
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
