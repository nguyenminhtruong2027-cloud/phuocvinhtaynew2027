'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BedDouble,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  DoorOpen,
  ExternalLink,
  Eye,
  Filter,
  Layers,
  Loader2,
  QrCode,
  User,
  X,
} from 'lucide-react';
import { useWorkers } from '@/context/WorkerContext';
import {
  compareKtxNames,
  DEFAULT_ROOM_CAPACITY,
  naturalSortCompare,
  type Worker,
} from '@/data/workers';
import {
  buildRoomCapacityMapFromFacilities,
  fetchFacilitiesList,
  formatRoomDisplay,
  getRoomCapacity,
  normalizeRoomLabel,
  type FacilityItem,
  type RoomCapacityMap,
} from '@/lib/facilityCapacity';
import {
  fetchRoomLabelsAuthoritative,
  getRoomGenderInfo,
  loadSavedRoomGenderMap,
  normalizeGender,
} from '@/lib/roomGender';
import {
  deduplicateBedRows,
  normalizeBedLabel,
  normalizeDayKey,
  normalizeKtxCompact,
} from '@/lib/bedSync';
import { createClient } from '@/lib/supabase/client';
import Ktx3DViewport from './Ktx3DViewport';
import type {
  CameraPreset,
  CampusBuildingNode,
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  HoverInfo,
  RenderPerfStats,
  RoomBedSlot,
  ViewLevel,
} from '../types';

interface RawBedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: string;
  worker_id: string | null;
  ma_nv: string | null;
  ho_va_ten: string | null;
}

function getBedStatusLabel(status: RoomBedSlot['status']): string {
  if (status === 'occupied') return 'Đang ở';
  if (status === 'maintenance') return 'Đang sửa chữa';
  if (status === 'checkout_pending') return 'Chờ check-out';
  return 'Giường trống';
}

function getBedStatusBadgeClass(status: RoomBedSlot['status']): string {
  if (status === 'occupied') return 'bg-blue-500/20 text-blue-300 border-blue-400/40';
  if (status === 'maintenance') return 'bg-rose-500/20 text-rose-300 border-rose-400/40';
  if (status === 'checkout_pending') return 'bg-amber-500/20 text-amber-300 border-amber-400/40';
  return 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40';
}

export default function Ktx3DTestClient() {
  const router = useRouter();
  const { workers, loading: workersLoading } = useWorkers();

  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>({});
  const [metaLoading, setMetaLoading] = useState(true);

  // View state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('campus');
  const [selectedKtxFilter, setSelectedKtxFilter] = useState<string>('all');
  const [colorMode, setColorMode] = useState<CampusColorMode>('occupancy');
  const [activeRoomKey, setActiveRoomKey] = useState<string | null>(null);
  const [activeRoomBeds, setActiveRoomBeds] = useState<RoomBedSlot[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [selectedBed, setSelectedBed] = useState<RoomBedSlot | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  // HUD state
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraPresetReq, setCameraPresetReq] = useState<{ preset: CameraPreset; seq: number } | null>(null);
  const [perfStats, setPerfStats] = useState<RenderPerfStats | null>(null);

  // Keyboard shortcut H to toggle Cinema/Zen mode (collapse/expand bottom dock)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed(prev => !prev);
      } else if (e.key === 'Escape') {
        if (selectedBed) setSelectedBed(null);
        else if (viewLevel === 'room') {
          setViewLevel('campus');
          setActiveRoomKey(null);
          setHoverInfo(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBed, viewLevel]);

  // Load real facilities & room gender labels (Read-Only)
  useEffect(() => {
    let active = true;
    const savedGender = loadSavedRoomGenderMap();
    setRoomGenderMap(savedGender);

    Promise.all([
      fetchFacilitiesList(false).catch(() => [] as FacilityItem[]),
      fetchRoomLabelsAuthoritative().catch(() => ({ data: savedGender, ok: false })),
    ]).then(([facs, genderRes]) => {
      if (!active) return;
      setFacilities(facs);
      setCapacities(buildRoomCapacityMapFromFacilities(facs));
      if (genderRes.ok) {
        setRoomGenderMap(genderRes.data);
      }
      setMetaLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  // Build hierarchical KTX -> Building -> Room model from real data (Read-Only)
  const { allKtxNodes, allRoomsFlat, roomByKeyMap } = useMemo(() => {
    const accFacilities = (facilities || []).filter(
      f => (f.room_type || 'accommodation') === 'accommodation' && f.is_visible !== false
    );
    const hiddenKeys = new Set<string>();
    (facilities || []).forEach(f => {
      if ((f.room_type || 'accommodation') !== 'accommodation' || f.is_visible === false) {
        const k = (f.ktx || '').trim();
        const b = (f.day || '').trim();
        const r = normalizeRoomLabel(f.phong_khu_vuc || '');
        if (k && b && r) hiddenKeys.add(`${k}||${b}||${r}`);
      }
    });

    const ktxBuildingsMap = new Map<string, Map<string, Map<string, string>>>();
    const roomWorkersMap = new Map<string, Worker[]>();

    const ensureRoomSlot = (ktx: string, day: string, rawRoom: string) => {
      const k = ktx.trim();
      const d = day.trim();
      const norm = normalizeRoomLabel(rawRoom);
      if (!k || !d || !norm) return null;
      const fullKey = `${k}||${d}||${norm}`;
      if (hiddenKeys.has(fullKey)) return null;

      let bMap = ktxBuildingsMap.get(k);
      if (!bMap) {
        bMap = new Map();
        ktxBuildingsMap.set(k, bMap);
      }
      let rMap = bMap.get(d);
      if (!rMap) {
        rMap = new Map();
        bMap.set(d, rMap);
      }
      if (!rMap.has(norm)) rMap.set(norm, rawRoom.trim());
      return fullKey;
    };

    accFacilities.forEach(f => {
      ensureRoomSlot(f.ktx || '', f.day || '', f.phong_khu_vuc || '');
    });

    (workers || []).forEach(w => {
      const fullKey = ensureRoomSlot(w.ktx || '', w.day || '', w.phongSo || '');
      if (!fullKey) return;
      let list = roomWorkersMap.get(fullKey);
      if (!list) {
        list = [];
        roomWorkersMap.set(fullKey, list);
      }
      list.push(w);
    });

    const ktxNamesSorted = Array.from(ktxBuildingsMap.keys()).sort(compareKtxNames);
    const flatRooms: CampusRoomNode[] = [];
    const byKey = new Map<string, CampusRoomNode>();

    const nodes: CampusKtxNode[] = ktxNamesSorted.map(ktx => {
      const bMap = ktxBuildingsMap.get(ktx)!;
      const dayNamesSorted = Array.from(bMap.keys()).sort(naturalSortCompare);

      const buildings: CampusBuildingNode[] = dayNamesSorted.map(day => {
        const rMap = bMap.get(day)!;
        const roomEntries = Array.from(rMap.entries()).sort((a, b) =>
          naturalSortCompare(a[1], b[1])
        );

        const rooms: CampusRoomNode[] = roomEntries.map(([roomNorm, roomRaw]) => {
          const key = `${ktx}||${day}||${roomNorm}`;
          const rWorkers = roomWorkersMap.get(key) || [];
          const cap = getRoomCapacity(capacities, ktx, day, roomRaw) || DEFAULT_ROOM_CAPACITY;
          const occupied = rWorkers.length;
          const adminG =
            roomGenderMap[`${ktx}||${day}||${roomRaw}`] ||
            roomGenderMap[`${ktx}||${day}||${roomNorm}`] ||
            null;
          const genderInfo = getRoomGenderInfo(
            rWorkers,
            adminG === 'male' ? 'Nam' : adminG === 'female' ? 'Nữ' : null
          );

          // Dominant unit/platoon label for tooltip
          const unitCounts = new Map<string, number>();
          rWorkers.forEach(w => {
            const u = (w.tieuDoan ? `TĐ ${w.tieuDoan}` : w.donVi || '').trim();
            if (u) unitCounts.set(u, (unitCounts.get(u) || 0) + 1);
          });
          let dominantUnit = '';
          let maxU = 0;
          unitCounts.forEach((cnt, u) => {
            if (cnt > maxU) {
              maxU = cnt;
              dominantUnit = u;
            }
          });

          const roomNode: CampusRoomNode = {
            key,
            ktx,
            day,
            roomRaw,
            roomNorm,
            roomLabel: formatRoomDisplay(roomRaw),
            capacity: cap,
            occupied,
            vacant: Math.max(0, cap - occupied),
            overflow: Math.max(0, occupied - cap),
            fillRate: cap > 0 ? occupied / cap : 0,
            genderInfo,
            workers: rWorkers,
            dominantUnit,
          };
          flatRooms.push(roomNode);
          byKey.set(key, roomNode);
          return roomNode;
        });

        return {
          key: `${ktx}||${day}`,
          ktx,
          day,
          rooms,
          totalCapacity: rooms.reduce((s, r) => s + r.capacity, 0),
          totalOccupied: rooms.reduce((s, r) => s + r.occupied, 0),
        };
      });

      return {
        ktx,
        buildings,
        totalRooms: buildings.reduce((s, b) => s + b.rooms.length, 0),
        totalCapacity: buildings.reduce((s, b) => s + b.totalCapacity, 0),
        totalOccupied: buildings.reduce((s, b) => s + b.totalOccupied, 0),
      };
    });

    return {
      allKtxNodes: nodes,
      allRoomsFlat: flatRooms,
      roomByKeyMap: byKey,
    };
  }, [facilities, workers, capacities, roomGenderMap]);

  const visibleKtxNodes = useMemo(() => {
    if (selectedKtxFilter === 'all') return allKtxNodes;
    return allKtxNodes.filter(n => n.ktx === selectedKtxFilter);
  }, [allKtxNodes, selectedKtxFilter]);

  const visibleRoomsFlat = useMemo(() => {
    if (selectedKtxFilter === 'all') return allRoomsFlat;
    return allRoomsFlat.filter(r => r.ktx === selectedKtxFilter);
  }, [allRoomsFlat, selectedKtxFilter]);

  const activeRoom = useMemo(
    () => (activeRoomKey ? roomByKeyMap.get(activeRoomKey) || null : null),
    [activeRoomKey, roomByKeyMap]
  );

  // Lazily fetch real `beds` rows ONLY for the active room when entering Room 3D view (Read-Only)
  useEffect(() => {
    if (viewLevel !== 'room' || !activeRoom) {
      setActiveRoomBeds([]);
      return;
    }

    let cancelled = false;
    setBedsLoading(true);

    const loadRoomBeds = async () => {
      let dbRows: RawBedRow[] = [];
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('beds')
          .select('id, ktx, day, phong_so, giuong, status, worker_id, ma_nv, ho_va_ten')
          .limit(500);

        if (!error && Array.isArray(data)) {
          const targetKtx = normalizeKtxCompact(activeRoom.ktx);
          const targetDay = normalizeDayKey(activeRoom.day);
          const targetRoom = normalizeRoomLabel(activeRoom.roomRaw);
          const matched = (data as RawBedRow[]).filter(
            row =>
              normalizeKtxCompact(row.ktx) === targetKtx &&
              normalizeDayKey(row.day) === targetDay &&
              normalizeRoomLabel(row.phong_so) === targetRoom
          );
          dbRows = deduplicateBedRows(matched).kept;
        }
      } catch (err) {
        console.warn('[ktx-3d-test] fetch room beds warning:', err);
      }

      if (cancelled) return;

      // Index DB beds by normalized bed number
      const dbByNum = new Map<number, RawBedRow>();
      dbRows.forEach(row => {
        const norm = normalizeBedLabel(row.giuong);
        const n = parseInt(norm, 10);
        if (Number.isFinite(n) && n > 0 && !dbByNum.has(n)) {
          dbByNum.set(n, row);
        }
      });

      // Map room workers by worker_id and by bed number
      const workerById = new Map<string, Worker>();
      const workerByBedNum = new Map<number, Worker>();
      const unplacedWorkers: Worker[] = [];

      activeRoom.workers.forEach(w => {
        workerById.set(w.id, w);
        const n = parseInt(normalizeBedLabel(w.giuong), 10);
        if (Number.isFinite(n) && n > 0 && !workerByBedNum.has(n)) {
          workerByBedNum.set(n, w);
        } else {
          unplacedWorkers.push(w);
        }
      });

      const maxDbBedNum = Array.from(dbByNum.keys()).reduce((m, n) => Math.max(m, n), 0);
      const maxWorkerBedNum = Array.from(workerByBedNum.keys()).reduce((m, n) => Math.max(m, n), 0);
      const totalSlots = Math.max(
        activeRoom.capacity,
        activeRoom.workers.length,
        maxDbBedNum,
        maxWorkerBedNum,
        2
      );
      // Round up to even count so bunk frames pair cleanly
      const evenSlots = totalSlots % 2 === 0 ? totalSlots : totalSlots + 1;

      const slots: RoomBedSlot[] = [];
      const placedWorkerIds = new Set<string>();

      for (let bedNum = 1; bedNum <= evenSlots; bedNum++) {
        const dbRow = dbByNum.get(bedNum);
        let occupant: Worker | undefined =
          (dbRow?.worker_id ? workerById.get(dbRow.worker_id) : undefined) ||
          workerByBedNum.get(bedNum);

        if (occupant) {
          placedWorkerIds.add(occupant.id);
        }

        let status: RoomBedSlot['status'] = 'empty';
        if (dbRow?.status === 'maintenance') {
          status = 'maintenance';
        } else if (dbRow?.status === 'checkout_pending') {
          status = 'checkout_pending';
        } else if (occupant || dbRow?.status === 'occupied') {
          status = 'occupied';
        }

        const rawGender = occupant ? normalizeGender(occupant.gioiTinh) : null;
        const gender: RoomBedSlot['gender'] =
          rawGender === 'nu' ? 'female' : rawGender === 'nam' ? 'male' : 'unknown';

        slots.push({
          id: `${activeRoom.key}||G${bedNum}`,
          bedNumber: bedNum,
          bedLabel: `G${bedNum}`,
          bunkIndex: Math.floor((bedNum - 1) / 2),
          tier: bedNum % 2 === 1 ? 'bottom' : 'top',
          status,
          gender,
          workerId: occupant?.id || dbRow?.worker_id || null,
          hoVaTen: occupant?.hoVaTen || dbRow?.ho_va_ten || null,
          maNV: occupant?.maNV || dbRow?.ma_nv || null,
          tieuDoan: occupant?.tieuDoan || null,
          donVi: occupant?.donVi || null,
          ngayVaoKTX: occupant?.ngayVaoKTX || null,
          bedDbId: dbRow?.id || null,
        });
      }

      // Place any remaining workers in the room who didn't have an explicit bed number onto free slots
      const remaining = unplacedWorkers.filter(w => !placedWorkerIds.has(w.id));
      let remIdx = 0;
      for (const slot of slots) {
        if (remIdx >= remaining.length) break;
        if (slot.status === 'empty' && !slot.hoVaTen) {
          const w = remaining[remIdx++];
          const g = normalizeGender(w.gioiTinh);
          slot.status = 'occupied';
          slot.workerId = w.id;
          slot.hoVaTen = w.hoVaTen;
          slot.maNV = w.maNV;
          slot.tieuDoan = w.tieuDoan || null;
          slot.donVi = w.donVi || null;
          slot.ngayVaoKTX = w.ngayVaoKTX || null;
          slot.gender = g === 'nu' ? 'female' : g === 'nam' ? 'male' : 'unknown';
        }
      }

      setActiveRoomBeds(slots);
      setBedsLoading(false);
    };

    loadRoomBeds();

    return () => {
      cancelled = true;
    };
  }, [viewLevel, activeRoom]);

  const handleEnterRoom = useCallback((room: CampusRoomNode) => {
    setActiveRoomKey(room.key);
    setSelectedBed(null);
    setHoverInfo(null);
    setViewLevel('room');
  }, []);

  const handleBackToCampus = useCallback(() => {
    setViewLevel('campus');
    setActiveRoomKey(null);
    setSelectedBed(null);
    setHoverInfo(null);
  }, []);

  const triggerCameraPreset = useCallback((preset: CameraPreset) => {
    setCameraPresetReq(prev => ({ preset, seq: (prev?.seq || 0) + 1 }));
  }, []);

  // Adjacent room navigation inside Room 3D view
  const activeRoomIndex = useMemo(() => {
    if (!activeRoomKey) return -1;
    return visibleRoomsFlat.findIndex(r => r.key === activeRoomKey);
  }, [activeRoomKey, visibleRoomsFlat]);

  const handleStepRoom = useCallback(
    (dir: -1 | 1) => {
      if (visibleRoomsFlat.length === 0 || activeRoomIndex < 0) return;
      const nextIdx = (activeRoomIndex + dir + visibleRoomsFlat.length) % visibleRoomsFlat.length;
      handleEnterRoom(visibleRoomsFlat[nextIdx]);
    },
    [visibleRoomsFlat, activeRoomIndex, handleEnterRoom]
  );

  // Aggregate summary stats for top badge
  const campusTotals = useMemo(() => {
    const rooms = visibleKtxNodes.reduce((s, n) => s + n.totalRooms, 0);
    const occupied = visibleKtxNodes.reduce((s, n) => s + n.totalOccupied, 0);
    const capacity = visibleKtxNodes.reduce((s, n) => s + n.totalCapacity, 0);
    const vacant = Math.max(0, capacity - occupied);
    const overloaded = visibleRoomsFlat.filter(r => r.occupied > r.capacity).length;
    return { rooms, occupied, capacity, vacant, overloaded };
  }, [visibleKtxNodes, visibleRoomsFlat]);

  const roomBedStats = useMemo(() => {
    let occupied = 0;
    let empty = 0;
    let maintenance = 0;
    let checkoutPending = 0;
    activeRoomBeds.forEach(b => {
      if (b.status === 'occupied') occupied++;
      else if (b.status === 'maintenance') maintenance++;
      else if (b.status === 'checkout_pending') checkoutPending++;
      else empty++;
    });
    return { occupied, empty, maintenance, checkoutPending };
  }, [activeRoomBeds]);

  const isLoading = workersLoading || metaLoading;

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden bg-[#0b1220]">
      {/* ── Dedicated Isolated 3D WebGL Viewport (100% Unobstructed Center) ── */}
      {isLoading ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-300">
          <Loader2 size={28} className="animate-spin text-blue-400" />
          <p className="text-sm font-semibold">Đang tải dữ liệu Ký Túc Xá cho mô hình 3D...</p>
          <p className="text-xs text-slate-400">Chế độ thử nghiệm độc lập · Chỉ xem (Read-only)</p>
        </div>
      ) : allKtxNodes.length === 0 ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-300 p-6 text-center">
          <Box size={32} className="text-slate-500" />
          <p className="text-sm font-semibold">Chưa có dữ liệu phòng để dựng mô hình 3D</p>
          <p className="text-xs text-slate-400 max-w-md">
            Hệ thống cần ít nhất một Khu KTX / phòng ở trong Cơ sở vật chất hoặc danh sách Công nhân để dựng sa bàn.
          </p>
        </div>
      ) : (
        <Ktx3DViewport
          viewLevel={viewLevel}
          ktxNodes={visibleKtxNodes}
          colorMode={colorMode}
          activeRoom={activeRoom}
          activeRoomBeds={activeRoomBeds}
          selectedBedId={selectedBed?.id || null}
          cameraPresetRequest={cameraPresetReq}
          onSelectRoom={handleEnterRoom}
          onSelectBed={setSelectedBed}
          onHoverChange={setHoverInfo}
          onPerfStats={setPerfStats}
        />
      )}

      {/* ── Top-Left Minimal Breadcrumb & Scope Header (Solid rgba, no backdrop-filter) ── */}
      <div className="pointer-events-none fixed lg:absolute top-3.5 left-3.5 right-3.5 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl bg-[#0f172a]/92 border border-slate-700/80 px-3.5 py-2.5 shadow-xl max-w-[min(92vw,580px)]">
          {viewLevel === 'room' ? (
            <button
              type="button"
              onClick={handleBackToCampus}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Sa bàn</span>
            </button>
          ) : (
            <span className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/35 text-blue-300 flex items-center justify-center shrink-0">
              <Box size={16} />
            </span>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-bold text-slate-100 tracking-tight truncate">
                {viewLevel === 'campus'
                  ? 'Sa Bàn 3D Toàn Khu KTX'
                  : activeRoom
                    ? `${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel}`
                    : 'Chi Tiết Phòng 3D'}
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/35 text-[10px] font-bold text-amber-300">
                <Eye size={10} />
                Bản test · Chỉ xem
              </span>
            </div>

            <p className="text-[11px] text-slate-400 font-tabular mt-0.5">
              {viewLevel === 'campus' ? (
                <>
                  {campusTotals.rooms} phòng ·{' '}
                  <strong className="text-slate-200">
                    {campusTotals.occupied.toLocaleString('vi-VN')}/{campusTotals.capacity.toLocaleString('vi-VN')}
                  </strong>{' '}
                  chỗ · Trống {campusTotals.vacant.toLocaleString('vi-VN')}
                  {campusTotals.overloaded > 0 ? ` · Quá tải ${campusTotals.overloaded}` : ''}
                </>
              ) : (
                <>
                  {bedsLoading
                    ? 'Đang tải danh sách giường...'
                    : `${roomBedStats.occupied} đang ở · ${roomBedStats.empty} trống${
                        roomBedStats.maintenance > 0 ? ` · ${roomBedStats.maintenance} sửa chữa` : ''
                      }${
                        roomBedStats.checkoutPending > 0
                          ? ` · ${roomBedStats.checkoutPending} chờ ra`
                          : ''
                      }`}
                </>
              )}
            </p>
          </div>
        </div>

        {/* ── Selected Bed Inspector Card (Top-Right, ONLY when a bed is clicked) ── */}
        {viewLevel === 'room' && selectedBed && (
          <div className="pointer-events-auto w-72 sm:w-80 rounded-2xl bg-[#0f172a]/95 border border-slate-700/80 p-4 shadow-2xl text-slate-100">
            <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-700/70">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/35 text-blue-300 flex items-center justify-center shrink-0">
                  <BedDouble size={16} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold font-mono">{selectedBed.bedLabel}</span>
                    <span className="text-[11px] text-slate-400">
                      · {selectedBed.tier === 'bottom' ? 'Tầng dưới' : 'Tầng trên'}
                    </span>
                  </div>
                  <span
                    className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${getBedStatusBadgeClass(
                      selectedBed.status
                    )}`}
                  >
                    {getBedStatusLabel(selectedBed.status)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBed(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                aria-label="Đóng chi tiết giường"
              >
                <X size={15} />
              </button>
            </div>

            {selectedBed.hoVaTen ? (
              <div className="py-3 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <User size={13} className="text-slate-400 shrink-0" />
                  <span className="font-bold text-slate-100 truncate">{selectedBed.hoVaTen}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 font-tabular bg-slate-900/75 rounded-xl p-2.5 border border-slate-800">
                  <div>
                    <span className="text-slate-500 block">Mã NV</span>
                    <span className="font-semibold">{selectedBed.maNV || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Tiểu đoàn / ĐV</span>
                    <span className="font-semibold truncate block">
                      {selectedBed.tieuDoan
                        ? `TĐ ${selectedBed.tieuDoan}`
                        : selectedBed.donVi || '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Ngày vào KTX</span>
                    <span className="font-semibold">{selectedBed.ngayVaoKTX || '—'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-3 text-xs text-slate-400">
                Giường này hiện chưa có công nhân lưu trú. Trong bản thử nghiệm chỉ xem, mọi thao tác xếp giường thực hiện ở trang Quản Lý Giường.
              </p>
            )}

            <div className="pt-2 border-t border-slate-700/70 flex items-center gap-2">
              {selectedBed.workerId && (
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/worker-management?view=${encodeURIComponent(selectedBed.workerId!)}`)
                  }
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                >
                  <ExternalLink size={12} />
                  <span>Hồ sơ CN</span>
                </button>
              )}
              {selectedBed.bedDbId ? (
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/qr-portal?tab=bed_inspect&bed_qr=${encodeURIComponent(selectedBed.bedDbId!)}`
                    )
                  }
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold transition-colors"
                >
                  <QrCode size={12} />
                  <span>Kiểm tra QR</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push('/bed-management')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold transition-colors"
                >
                  <BedDouble size={12} />
                  <span>Mở QL Giường</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Floating Hover Tooltip (Pointer-Events-None, Zero Occlusion) ── */}
      {hoverInfo && (
        <div
          className="pointer-events-none fixed z-30 rounded-xl bg-[#0f172a]/95 border border-slate-600/80 px-3 py-2 shadow-2xl text-xs text-slate-100 max-w-xs"
          style={{
            left: Math.min(hoverInfo.screenX + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240),
            top: Math.max(12, hoverInfo.screenY - 12),
          }}
        >
          {hoverInfo.type === 'room' && hoverInfo.room && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-slate-100">
                  {hoverInfo.room.ktx} · {hoverInfo.room.day} · {hoverInfo.room.roomLabel}
                </span>
                <span className="font-tabular font-bold text-sky-300">
                  {hoverInfo.room.occupied}/{hoverInfo.room.capacity}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                {hoverInfo.room.genderInfo.label}
                {hoverInfo.room.dominantUnit ? ` · ${hoverInfo.room.dominantUnit}` : ''}
                {hoverInfo.room.vacant > 0
                  ? ` · Còn ${hoverInfo.room.vacant} chỗ`
                  : hoverInfo.room.overflow > 0
                    ? ` · Quá tải +${hoverInfo.room.overflow}`
                    : ' · Đầy 100%'}
              </p>
              <p className="text-[10px] text-sky-400 font-semibold">
                Bấm để xem mô hình giường tầng bên trong →
              </p>
            </div>
          )}

          {hoverInfo.type === 'bed' && hoverInfo.bed && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold font-mono text-slate-100">
                  {hoverInfo.bed.bedLabel} · {hoverInfo.bed.tier === 'bottom' ? 'Tầng dưới' : 'Tầng trên'}
                </span>
                <span className="text-[10px] font-semibold text-sky-300">
                  {getBedStatusLabel(hoverInfo.bed.status)}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                {hoverInfo.bed.hoVaTen
                  ? `${hoverInfo.bed.hoVaTen}${hoverInfo.bed.maNV ? ` (#${hoverInfo.bed.maNV})` : ''}`
                  : 'Chưa có người ở'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Unified Collapsible Bottom Control Dock (Zero Side-Panel Clutter) ── */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-[min(940px,94vw)]">
        {/* Collapse / Expand Toggle Handle */}
        <button
          type="button"
          onClick={() => setDockCollapsed(prev => !prev)}
          title="Ẩn/hiện thanh điều khiển (Phím H)"
          className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-xl bg-[#0f172a]/92 border border-b-0 border-slate-700/80 text-[11px] font-semibold text-slate-300 hover:text-white transition-colors"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp size={13} />
              <span>Hiện điều khiển (H)</span>
            </>
          ) : (
            <>
              <ChevronDown size={13} />
              <span>Ẩn điều khiển (H)</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto w-full rounded-2xl bg-[#0f172a]/94 border border-slate-700/80 px-3.5 py-2.5 shadow-2xl space-y-2">
            {viewLevel === 'campus' ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* KTX Scope Selector */}
                  <div className="flex items-center gap-1.5">
                    <Filter size={13} className="text-slate-400 shrink-0" />
                    <select
                      value={selectedKtxFilter}
                      onChange={e => setSelectedKtxFilter(e.target.value)}
                      className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="all">Tất cả KTX ({allKtxNodes.length})</option>
                      {allKtxNodes.map(n => (
                        <option key={n.ktx} value={n.ktx}>
                          {n.ktx} ({n.totalRooms} phòng)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Color / X-Ray Layer Mode */}
                  <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-xl p-0.5 text-[11px]">
                    {(
                      [
                        { id: 'occupancy', label: 'Lấp đầy' },
                        { id: 'gender', label: 'Nam / Nữ' },
                        { id: 'vacant_only', label: 'Phòng trống' },
                        { id: 'overloaded_only', label: 'Quá tải' },
                      ] as { id: CampusColorMode; label: string }[]
                    ).map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setColorMode(opt.id)}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                          colorMode === opt.id
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Quick Jump Into Any Room */}
                  <div className="flex items-center gap-1.5">
                    <DoorOpen size={13} className="text-slate-400 shrink-0" />
                    <select
                      value=""
                      onChange={e => {
                        const room = roomByKeyMap.get(e.target.value);
                        if (room) handleEnterRoom(room);
                      }}
                      className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:outline-none focus:border-blue-500 max-w-[180px]"
                    >
                      <option value="">Mở nhanh phòng 3D...</option>
                      {visibleRoomsFlat.map(r => (
                        <option key={r.key} value={r.key}>
                          {r.ktx} · {r.day} · {r.roomLabel} ({r.occupied}/{r.capacity})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Camera Presets */}
                  <div className="flex items-center gap-1">
                    <Compass size={13} className="text-slate-400 mr-0.5" />
                    {(
                      [
                        { id: 'overview', label: '3/4' },
                        { id: 'top', label: 'Trên cao' },
                        { id: 'low', label: 'Góc thấp' },
                      ] as { id: CameraPreset; label: string }[]
                    ).map(cam => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => triggerCameraPreset(cam.id)}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-200 transition-colors"
                      >
                        {cam.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Legend + Render Stat Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800 text-[11px] text-slate-400">
                  <div className="flex flex-wrap items-center gap-3">
                    {colorMode === 'gender' ? (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                          Phòng Nam
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-pink-500" />
                          Phòng Nữ
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                          Hỗn hợp
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-600" />
                          Trống
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                          Còn chỗ
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                          Đầy 100%
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                          Quá tải
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-600" />
                          Trống
                        </span>
                      </>
                    )}
                    <span className="hidden sm:inline text-slate-500">
                      · Kéo chuột xoay · Cuộn zoom · Bấm phòng để vào bên trong
                    </span>
                  </div>

                  {perfStats && (
                    <span className="font-mono text-[10px] text-slate-500 font-tabular">
                      {perfStats.isSoftwareGl ? 'SW' : 'GPU'} · {perfStats.lastFrameMs}ms ·{' '}
                      {perfStats.drawCalls} calls
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Room Prev / Select / Next */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleStepRoom(-1)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
                      title="Phòng trước"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <select
                      value={activeRoomKey || ''}
                      onChange={e => {
                        const room = roomByKeyMap.get(e.target.value);
                        if (room) handleEnterRoom(room);
                      }}
                      className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:border-blue-500 max-w-[230px]"
                    >
                      {visibleRoomsFlat.map(r => (
                        <option key={r.key} value={r.key}>
                          {r.ktx} · {r.day} · {r.roomLabel} ({r.occupied}/{r.capacity})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleStepRoom(1)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
                      title="Phòng kế tiếp"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  {/* Interior Camera Presets */}
                  <div className="flex items-center gap-1">
                    <Layers size={13} className="text-slate-400 mr-0.5" />
                    {(
                      [
                        { id: 'overview', label: 'Tổng phòng' },
                        { id: 'left_row', label: 'Dãy trái' },
                        { id: 'right_row', label: 'Dãy phải' },
                        { id: 'top', label: 'Nhìn từ trên' },
                      ] as { id: CameraPreset; label: string }[]
                    ).map(cam => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => triggerCameraPreset(cam.id)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-200 transition-colors"
                      >
                        {cam.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bed Legend + Render Stat Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800 text-[11px] text-slate-400">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                      Nam đang ở
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-pink-500" />
                      Nữ đang ở
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                      Giường trống
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                      Chờ check-out
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                      Sửa chữa
                    </span>
                    <span className="hidden sm:inline text-slate-500">
                      · Bấm vào từng giường tầng để xem thông tin
                    </span>
                  </div>

                  {perfStats && (
                    <span className="font-mono text-[10px] text-slate-500 font-tabular">
                      {perfStats.isSoftwareGl ? 'SW' : 'GPU'} · {perfStats.lastFrameMs}ms
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
