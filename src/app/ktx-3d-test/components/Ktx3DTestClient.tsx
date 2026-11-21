'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BedDouble,
  Box,
  Building2,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  DoorOpen,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Layers,
  Loader2,
  MapPin,
  Moon,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Sun,
  Tag,
  User,
  Users,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWorkers } from '@/context/WorkerContext';
import {
  compareKtxNames,
  DEFAULT_ROOM_CAPACITY,
  naturalSortCompare,
  removeAccents,
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
import Ktx3DViewport, { type Ktx3DViewportHandle } from './Ktx3DViewport';
import { getRoomUnitMatchCount } from '../scene/campusBuilder';
import type {
  BedTierFilter,
  CameraPreset,
  CampusBuildingNode,
  CampusColorMode,
  CampusKtxNode,
  CampusRoomNode,
  FunctionalAreaNode,
  HoverInfo,
  RenderPerfStats,
  RoomBedSlot,
  SceneTheme,
  UnitXRayFilter,
  ViewLevel,
} from '../types';

const BED_CACHE_TTL_MS = 30_000;

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

function formatPlatoonOptionLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^(tiểu\s*đoàn|tđ)\b/i.test(t) ? t : `Tiểu đoàn ${t}`;
}

export default function Ktx3DTestClient() {
  const router = useRouter();
  const { workers, loading: workersLoading } = useWorkers();

  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>({});
  const [metaLoading, setMetaLoading] = useState(true);

  // View & Theme state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('campus');
  const [sceneTheme, setSceneTheme] = useState<SceneTheme>('dark');
  const [selectedKtxFilter, setSelectedKtxFilter] = useState<string>('all');
  const [colorMode, setColorMode] = useState<CampusColorMode>('occupancy');
  const [unitXRayFilter, setUnitXRayFilter] = useState<UnitXRayFilter | null>(null);
  const [focusedRoomKey, setFocusedRoomKey] = useState<string | null>(null);
  const [hideRoofs, setHideRoofs] = useState(false);
  const [showFunctionalRooms, setShowFunctionalRooms] = useState(true);

  // Active Room & Beds state
  const [activeRoomKey, setActiveRoomKey] = useState<string | null>(null);
  const [activeRoomBeds, setActiveRoomBeds] = useState<RoomBedSlot[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [selectedBed, setSelectedBed] = useState<RoomBedSlot | null>(null);
  const [bedTierFilter, setBedTierFilter] = useState<BedTierFilter>('all');
  const [showBedNames, setShowBedNames] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  // Quick Search, Room Residents & Equipment Popovers + Cache/Refresh
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [residentsPanelOpen, setResidentsPanelOpen] = useState(false);
  const [equipmentPanelOpen, setEquipmentPanelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<Ktx3DViewportHandle | null>(null);
  const pendingFocusWorkerIdRef = useRef<string | null>(null);
  const roomBedsCacheRef = useRef<Map<string, { rows: RawBedRow[]; fetchedAt: number }>>(new Map());

  // Camera & HUD controls
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraPresetReq, setCameraPresetReq] = useState<{ preset: CameraPreset; seq: number } | null>(null);
  const [focusRoomReq, setFocusRoomReq] = useState<{ roomKey: string; seq: number } | null>(null);
  const [focusBedReq, setFocusBedReq] = useState<{ bedId: string; seq: number } | null>(null);
  const [zoomReq, setZoomReq] = useState<{ factor: number; seq: number } | null>(null);
  const [perfStats, setPerfStats] = useState<RenderPerfStats | null>(null);

  // Sync initial sceneTheme cleanly with app's active Light/Dark mode
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isLightDom =
      document.documentElement.classList.contains('light') ||
      document.documentElement.getAttribute('data-theme') === 'light';
    if (isLightDom) setSceneTheme('light');
  }, []);

  // Auto-invalidate bed cache whenever WorkerContext data refreshes
  useEffect(() => {
    roomBedsCacheRef.current.clear();
  }, [workers]);

  // Keyboard shortcuts: H = hide dock, / = search, + / - = zoom, 0 = reset, Esc = close/back
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') {
          setSearchOpen(false);
          setSearchQuery('');
        }
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed(prev => !prev);
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
        setResidentsPanelOpen(false);
        setEquipmentPanelOpen(false);
        window.setTimeout(() => searchInputRef.current?.focus(), 20);
      } else if (e.key === '+' || e.key === '=') {
        setZoomReq(prev => ({ factor: 0.78, seq: (prev?.seq || 0) + 1 }));
      } else if (e.key === '-') {
        setZoomReq(prev => ({ factor: 1.28, seq: (prev?.seq || 0) + 1 }));
      } else if (e.key === '0') {
        setCameraPresetReq(prev => ({ preset: 'overview', seq: (prev?.seq || 0) + 1 }));
      } else if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
        } else if (residentsPanelOpen) {
          setResidentsPanelOpen(false);
        } else if (equipmentPanelOpen) {
          setEquipmentPanelOpen(false);
        } else if (selectedBed) {
          setSelectedBed(null);
        } else if (focusedRoomKey) {
          setFocusedRoomKey(null);
        } else if (viewLevel === 'room') {
          setViewLevel('campus');
          setActiveRoomKey(null);
          setBedTierFilter('all');
          setHoverInfo(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen, residentsPanelOpen, equipmentPanelOpen, selectedBed, focusedRoomKey, viewLevel]);

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

  // Manual Refresh: bypasses facility + bed caches to pull latest real-time state (Read-Only)
  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      roomBedsCacheRef.current.clear();
      const [facs, genderRes] = await Promise.all([
        fetchFacilitiesList(true).catch(() => null),
        fetchRoomLabelsAuthoritative().catch(() => ({ data: roomGenderMap, ok: false })),
      ]);
      if (facs) {
        setFacilities(facs);
        setCapacities(buildRoomCapacityMapFromFacilities(facs));
      }
      if (genderRes.ok) {
        setRoomGenderMap(genderRes.data);
      }
      setRefreshSeq(prev => prev + 1);
      toast.success('Đã đồng bộ dữ liệu 3D mới nhất');
    } catch {
      toast.error('Không thể làm mới dữ liệu lúc này');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, roomGenderMap]);

  // Build hierarchical KTX -> Building -> Room model + Functional Areas + Unit/Platoon catalogs from real data
  const { allKtxNodes, allRoomsFlat, roomByKeyMap, xrayOptions } = useMemo(() => {
    const accFacilities = (facilities || []).filter(
      f => (f.room_type || 'accommodation') === 'accommodation' && f.is_visible !== false
    );
    const funcFacilities = (facilities || []).filter(
      f => f.room_type === 'functional' && f.is_visible !== false
    );
    const facilityByKey = new Map<string, FacilityItem>();
    const functionalAreasByKtx = new Map<string, FunctionalAreaNode[]>();

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
    const globalPlatoonCounts = new Map<string, number>();
    const globalUnitCounts = new Map<string, number>();

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
      const fullKey = ensureRoomSlot(f.ktx || '', f.day || '', f.phong_khu_vuc || '');
      if (fullKey && !facilityByKey.has(fullKey)) {
        facilityByKey.set(fullKey, f);
      }
    });

    funcFacilities.forEach((f, idx) => {
      const k = (f.ktx || '').trim();
      const d = (f.day || '').trim();
      const name = (f.phong_khu_vuc || '').trim() || `Khu chức năng ${idx + 1}`;
      if (!k) return;
      if (!ktxBuildingsMap.has(k)) {
        ktxBuildingsMap.set(k, new Map());
      }
      const list = functionalAreasByKtx.get(k) || [];
      list.push({
        key: `${k}||${d}||func||${f.id ?? idx}`,
        ktx: k,
        day: d,
        name,
        ghiChu: (f.ghi_chu || '').trim(),
        facility: f,
      });
      functionalAreasByKtx.set(k, list);
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

      const td = (w.tieuDoan || '').trim();
      if (td) globalPlatoonCounts.set(td, (globalPlatoonCounts.get(td) || 0) + 1);
      const dv = (w.donVi || '').trim();
      if (dv) globalUnitCounts.set(dv, (globalUnitCounts.get(dv) || 0) + 1);
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

          const platoonCounts: Record<string, number> = {};
          const unitCounts: Record<string, number> = {};
          const combinedCounts = new Map<string, number>();

          rWorkers.forEach(w => {
            const td = (w.tieuDoan || '').trim();
            const dv = (w.donVi || '').trim();
            if (td) platoonCounts[td] = (platoonCounts[td] || 0) + 1;
            if (dv) unitCounts[dv] = (unitCounts[dv] || 0) + 1;
            const uLabel = td ? `TĐ ${td}` : dv;
            if (uLabel) combinedCounts.set(uLabel, (combinedCounts.get(uLabel) || 0) + 1);
          });

          let dominantUnit = '';
          let maxU = 0;
          combinedCounts.forEach((cnt, u) => {
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
            platoonCounts,
            unitCounts,
            facility: facilityByKey.get(key) || null,
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

      const functionalAreas = (functionalAreasByKtx.get(ktx) || []).sort((a, b) =>
        naturalSortCompare(a.name, b.name)
      );

      return {
        ktx,
        buildings,
        functionalAreas,
        totalRooms: buildings.reduce((s, b) => s + b.rooms.length, 0),
        totalCapacity: buildings.reduce((s, b) => s + b.totalCapacity, 0),
        totalOccupied: buildings.reduce((s, b) => s + b.totalOccupied, 0),
      };
    });

    const platoonOptions: (UnitXRayFilter & { count: number })[] = Array.from(
      globalPlatoonCounts.entries()
    )
      .sort((a, b) => b[1] - a[1] || naturalSortCompare(a[0], b[0]))
      .map(([value, count]) => ({
        type: 'platoon',
        value,
        label: formatPlatoonOptionLabel(value),
        count,
      }));

    const unitOptions: (UnitXRayFilter & { count: number })[] = Array.from(
      globalUnitCounts.entries()
    )
      .sort((a, b) => b[1] - a[1] || naturalSortCompare(a[0], b[0]))
      .map(([value, count]) => ({
        type: 'unit',
        value,
        label: value,
        count,
      }));

    return {
      allKtxNodes: nodes,
      allRoomsFlat: flatRooms,
      roomByKeyMap: byKey,
      xrayOptions: { platoons: platoonOptions, units: unitOptions },
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

  const focusedRoom = useMemo(
    () => (focusedRoomKey ? roomByKeyMap.get(focusedRoomKey) || null : null),
    [focusedRoomKey, roomByKeyMap]
  );

  // ── Fixed Server-Side Filtered + Paginated Room `beds` Query (100% accurate across ALL KTX zones!) ──
  useEffect(() => {
    if (viewLevel !== 'room' || !activeRoom) {
      setActiveRoomBeds([]);
      return;
    }

    let cancelled = false;
    setBedsLoading(true);

    const loadRoomBeds = async () => {
      const cached = roomBedsCacheRef.current.get(activeRoom.key);
      const cacheFresh = cached && Date.now() - cached.fetchedAt < BED_CACHE_TTL_MS;
      let dbRows: RawBedRow[] = cacheFresh ? cached.rows : [];

      if (!cacheFresh) {
        try {
          const supabase = createClient();
          const targetKtx = normalizeKtxCompact(activeRoom.ktx);
          const targetDay = normalizeDayKey(activeRoom.day);
          const targetRoom = normalizeRoomLabel(activeRoom.roomRaw);

          const collected: RawBedRow[] = [];
          const PAGE_SIZE = 1000;
          let offset = 0;

          // Filter server-side by room number fragment so we never hit a 500-row global cutoff across KTX2/KTX3/KTX4
          for (let page = 0; page < 8; page++) {
            let query = supabase
              .from('beds')
              .select('id, ktx, day, phong_so, giuong, status, worker_id, ma_nv, ho_va_ten')
              .range(offset, offset + PAGE_SIZE - 1);

            if (targetRoom) {
              query = query.ilike('phong_so', `%${targetRoom}%`);
            }

            const { data, error } = await query;
            if (error || !Array.isArray(data)) break;

            const matched = (data as RawBedRow[]).filter(
              row =>
                normalizeKtxCompact(row.ktx) === targetKtx &&
                normalizeDayKey(row.day) === targetDay &&
                normalizeRoomLabel(row.phong_so) === targetRoom
            );
            collected.push(...matched);

            if (data.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }

          dbRows = deduplicateBedRows(collected).kept;
          roomBedsCacheRef.current.set(activeRoom.key, {
            rows: dbRows,
            fetchedAt: Date.now(),
          });
        } catch (err) {
          console.warn('[ktx-3d-test] fetch room beds warning:', err);
        }
      }

      if (cancelled) return;

      const dbByNum = new Map<number, RawBedRow>();
      dbRows.forEach(row => {
        const norm = normalizeBedLabel(row.giuong);
        const n = parseInt(norm, 10);
        if (Number.isFinite(n) && n > 0 && !dbByNum.has(n)) {
          dbByNum.set(n, row);
        }
      });

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
      const evenSlots = totalSlots % 2 === 0 ? totalSlots : totalSlots + 1;

      const slots: RoomBedSlot[] = [];
      const placedWorkerIds = new Set<string>();

      for (let bedNum = 1; bedNum <= evenSlots; bedNum++) {
        const dbRow = dbByNum.get(bedNum);
        const occupant: Worker | undefined =
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

      // If user jumped here from Quick Search for a specific worker, auto-select & fly to their bunk bed!
      const pendingWorkerId = pendingFocusWorkerIdRef.current;
      if (pendingWorkerId) {
        pendingFocusWorkerIdRef.current = null;
        const targetBed = slots.find(s => s.workerId === pendingWorkerId);
        if (targetBed) {
          setSelectedBed(targetBed);
          window.setTimeout(() => {
            setFocusBedReq(prev => ({ bedId: targetBed.id, seq: (prev?.seq || 0) + 1 }));
          }, 120);
        }
      }
    };

    loadRoomBeds();

    return () => {
      cancelled = true;
    };
  }, [viewLevel, activeRoom, refreshSeq]);

  // ── Quick Search Results (Rooms + Workers, accent-insensitive) ──
  const searchResults = useMemo(() => {
    const q = removeAccents(searchQuery.trim());
    if (q.length < 1) return { rooms: [] as CampusRoomNode[], workers: [] as { worker: Worker; room: CampusRoomNode | null }[] };

    const matchedRooms = allRoomsFlat
      .filter(r => {
        const hay = removeAccents(`${r.ktx} ${r.day} ${r.roomLabel} phong ${r.roomRaw} ${r.dominantUnit}`);
        return hay.includes(q);
      })
      .slice(0, 6);

    const matchedWorkers = (workers || [])
      .filter(w => {
        const hay = removeAccents(
          `${w.hoVaTen || ''} ${w.maNV || ''} ${w.cccd || ''} ${w.soDienThoai || ''} ${w.ktx || ''} ${w.day || ''} ${w.phongSo || ''}`
        );
        return hay.includes(q);
      })
      .slice(0, 8)
      .map(worker => {
        const normR = normalizeRoomLabel(worker.phongSo || '');
        const key = `${(worker.ktx || '').trim()}||${(worker.day || '').trim()}||${normR}`;
        return { worker, room: roomByKeyMap.get(key) || null };
      });

    return { rooms: matchedRooms, workers: matchedWorkers };
  }, [searchQuery, allRoomsFlat, workers, roomByKeyMap]);

  const handleEnterRoom = useCallback((room: CampusRoomNode) => {
    setActiveRoomKey(room.key);
    setSelectedBed(null);
    setFocusedRoomKey(null);
    setResidentsPanelOpen(false);
    setEquipmentPanelOpen(false);
    setHoverInfo(null);
    setViewLevel('room');
  }, []);

  const handleBackToCampus = useCallback(() => {
    setViewLevel('campus');
    setActiveRoomKey(null);
    setSelectedBed(null);
    setBedTierFilter('all');
    setResidentsPanelOpen(false);
    setEquipmentPanelOpen(false);
    setHoverInfo(null);
  }, []);

  const handleCaptureSnapshot = useCallback(() => {
    const dataUrl = viewportRef.current?.captureSnapshot();
    if (!dataUrl) {
      toast.error('Không thể chụp ảnh mô hình 3D lúc này');
      return;
    }
    const rawSlug =
      viewLevel === 'room' && activeRoom
        ? `${activeRoom.ktx}_${activeRoom.day}_${activeRoom.roomLabel}`
        : selectedKtxFilter === 'all'
          ? 'Toan_Khu_KTX'
          : selectedKtxFilter;
    const safeSlug = removeAccents(rawSlug).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const stamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `KTX_3D_${safeSlug}_${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Đã lưu ảnh chụp mô hình 3D (PNG)');
  }, [viewLevel, activeRoom, selectedKtxFilter]);

  const handleLocateRoomOnCampus = useCallback(
    (room: CampusRoomNode) => {
      if (selectedKtxFilter !== 'all' && selectedKtxFilter !== room.ktx) {
        setSelectedKtxFilter('all');
      }
      setViewLevel('campus');
      setActiveRoomKey(null);
      setSelectedBed(null);
      setFocusedRoomKey(room.key);
      setSearchOpen(false);
      setSearchQuery('');
      window.setTimeout(() => {
        setFocusRoomReq(prev => ({ roomKey: room.key, seq: (prev?.seq || 0) + 1 }));
      }, 60);
    },
    [selectedKtxFilter]
  );

  const handleLocateWorkerIn3D = useCallback(
    (worker: Worker, room: CampusRoomNode | null) => {
      if (!room) {
        router.push(`/worker-management?view=${encodeURIComponent(worker.id)}`);
        return;
      }
      setSearchOpen(false);
      setSearchQuery('');
      if (viewLevel === 'room' && activeRoomKey === room.key) {
        const targetBed = activeRoomBeds.find(b => b.workerId === worker.id);
        if (targetBed) {
          setSelectedBed(targetBed);
          setFocusBedReq(prev => ({ bedId: targetBed.id, seq: (prev?.seq || 0) + 1 }));
        }
        return;
      }
      pendingFocusWorkerIdRef.current = worker.id;
      handleEnterRoom(room);
    },
    [router, viewLevel, activeRoomKey, activeRoomBeds, handleEnterRoom]
  );

  const handleFocusBed = useCallback((bed: RoomBedSlot) => {
    setSelectedBed(bed);
    setFocusBedReq(prev => ({ bedId: bed.id, seq: (prev?.seq || 0) + 1 }));
  }, []);

  const triggerCameraPreset = useCallback((preset: CameraPreset) => {
    setCameraPresetReq(prev => ({ preset, seq: (prev?.seq || 0) + 1 }));
  }, []);

  const triggerZoom = useCallback((factor: number) => {
    setZoomReq(prev => ({ factor, seq: (prev?.seq || 0) + 1 }));
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

  // Aggregate summary stats
  const campusTotals = useMemo(() => {
    const rooms = visibleKtxNodes.reduce((s, n) => s + n.totalRooms, 0);
    const functionalCount = visibleKtxNodes.reduce((s, n) => s + n.functionalAreas.length, 0);
    const occupied = visibleKtxNodes.reduce((s, n) => s + n.totalOccupied, 0);
    const capacity = visibleKtxNodes.reduce((s, n) => s + n.totalCapacity, 0);
    const vacant = Math.max(0, capacity - occupied);
    const overloaded = visibleRoomsFlat.filter(r => r.occupied > r.capacity).length;
    const xrayMatchedRooms = unitXRayFilter
      ? visibleRoomsFlat.filter(r => getRoomUnitMatchCount(r, unitXRayFilter) > 0).length
      : 0;
    return { rooms, functionalCount, occupied, capacity, vacant, overloaded, xrayMatchedRooms };
  }, [visibleKtxNodes, visibleRoomsFlat, unitXRayFilter]);

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

  const handleXRaySelectChange = (rawVal: string) => {
    if (!rawVal) {
      setUnitXRayFilter(null);
      if (colorMode === 'unit_xray') setColorMode('occupancy');
      return;
    }
    const [type, ...rest] = rawVal.split('::');
    const value = rest.join('::');
    if (type === 'platoon') {
      const opt = xrayOptions.platoons.find(o => o.value === value);
      if (opt) {
        setUnitXRayFilter({ type: 'platoon', value: opt.value, label: opt.label });
        setColorMode('unit_xray');
      }
    } else if (type === 'unit') {
      const opt = xrayOptions.units.find(o => o.value === value);
      if (opt) {
        setUnitXRayFilter({ type: 'unit', value: opt.value, label: opt.label });
        setColorMode('unit_xray');
      }
    }
  };

  const isLoading = workersLoading || metaLoading;
  const isLight = sceneTheme === 'light';

  // Crisp theme-adaptive HUD surfaces (solid rgba, ZERO backdrop-filter over WebGL)
  const hudCard = isLight
    ? 'bg-white/95 border-slate-300 text-slate-900 shadow-lg'
    : 'bg-[#0f172a]/94 border-slate-700/80 text-slate-100 shadow-2xl';
  const hudMuted = isLight ? 'text-slate-600' : 'text-slate-400';
  const hudSubtleBtn = isLight
    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200';
  const hudSelect = isLight
    ? 'bg-slate-50 border-slate-300 text-slate-900'
    : 'bg-slate-900 border-slate-700 text-slate-100';
  const hudDivider = isLight ? 'border-slate-200' : 'border-slate-800';

  return (
    <div
      className={`relative w-full h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden ${
        isLight ? 'bg-[#dbe7f5]' : 'bg-[#0b1220]'
      }`}
    >
      {/* ── Dedicated Isolated 3D WebGL Viewport (100% Unobstructed Center) ── */}
      {isLoading ? (
        <div
          className={`w-full h-full flex flex-col items-center justify-center gap-3 ${
            isLight ? 'text-slate-700' : 'text-slate-300'
          }`}
        >
          <Loader2 size={28} className="animate-spin text-blue-500" />
          <p className="text-sm font-semibold">Đang tải dữ liệu Ký Túc Xá cho mô hình 3D...</p>
          <p className={`text-xs ${hudMuted}`}>Chế độ thử nghiệm độc lập · Chỉ xem (Read-only)</p>
        </div>
      ) : allKtxNodes.length === 0 ? (
        <div
          className={`w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center ${
            isLight ? 'text-slate-700' : 'text-slate-300'
          }`}
        >
          <Box size={32} className="text-slate-500" />
          <p className="text-sm font-semibold">Chưa có dữ liệu phòng để dựng mô hình 3D</p>
          <p className={`text-xs max-w-md ${hudMuted}`}>
            Hệ thống cần ít nhất một Khu KTX / phòng ở trong Cơ sở vật chất hoặc danh sách Công nhân để dựng sa bàn.
          </p>
        </div>
      ) : (
        <Ktx3DViewport
          ref={viewportRef}
          viewLevel={viewLevel}
          sceneTheme={sceneTheme}
          campusScopeKey={selectedKtxFilter}
          ktxNodes={visibleKtxNodes}
          colorMode={colorMode}
          unitXRayFilter={unitXRayFilter}
          focusedRoomKey={focusedRoomKey}
          hideRoofs={hideRoofs}
          showFunctionalRooms={showFunctionalRooms}
          activeRoom={activeRoom}
          activeRoomBeds={activeRoomBeds}
          selectedBedId={selectedBed?.id || null}
          bedTierFilter={bedTierFilter}
          showBedNames={showBedNames}
          cameraPresetRequest={cameraPresetReq}
          focusRoomRequest={focusRoomReq}
          focusBedRequest={focusBedReq}
          zoomRequest={zoomReq}
          onSelectRoom={handleEnterRoom}
          onSelectBed={setSelectedBed}
          onHoverChange={setHoverInfo}
          onPerfStats={setPerfStats}
        />
      )}

      {/* ── Top Bar Overlay (Top-Left Breadcrumb + Search + Theme + Optional Popovers) ── */}
      <div className="pointer-events-none fixed lg:absolute top-3.5 left-3.5 right-3.5 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-col gap-2 max-w-[min(92vw,660px)]">
          {/* Primary Header Strip */}
          <div className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 ${hudCard}`}>
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
              <span className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/35 text-blue-500 flex items-center justify-center shrink-0">
                <Box size={16} />
              </span>
            )}

            <div className="min-w-0 flex-1 pr-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold tracking-tight truncate">
                  {viewLevel === 'campus'
                    ? 'Sa Bàn 3D Toàn Khu KTX'
                    : activeRoom
                      ? `${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel}`
                      : 'Chi Tiết Phòng 3D'}
                </h1>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-[10px] font-bold text-amber-500">
                  <Eye size={10} />
                  Chỉ xem
                </span>
              </div>

              <p className={`text-[11px] font-tabular mt-0.5 ${hudMuted}`}>
                {viewLevel === 'campus' ? (
                  <>
                    {campusTotals.rooms} phòng ·{' '}
                    <strong className={isLight ? 'text-slate-900' : 'text-slate-200'}>
                      {campusTotals.occupied.toLocaleString('vi-VN')}/
                      {campusTotals.capacity.toLocaleString('vi-VN')}
                    </strong>{' '}
                    chỗ · Trống {campusTotals.vacant.toLocaleString('vi-VN')}
                    {campusTotals.overloaded > 0 ? ` · Quá tải ${campusTotals.overloaded}` : ''}
                    {colorMode === 'unit_xray' && unitXRayFilter
                      ? ` · Khớp ${campusTotals.xrayMatchedRooms} phòng (${unitXRayFilter.label})`
                      : ''}
                  </>
                ) : (
                  <>
                    {bedsLoading
                      ? 'Đang đồng bộ danh sách giường...'
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

            {/* Quick Action Icons: Search, Room Residents, Equipment, Refresh, Snapshot, Day/Night Theme */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(prev => {
                    const next = !prev;
                    if (next) {
                      setResidentsPanelOpen(false);
                      setEquipmentPanelOpen(false);
                      window.setTimeout(() => searchInputRef.current?.focus(), 20);
                    }
                    return next;
                  });
                }}
                title="Tìm nhanh công nhân hoặc phòng (Phím /)"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                  searchOpen ? 'bg-blue-600 border-blue-500 text-white' : hudSubtleBtn
                }`}
              >
                <Search size={13} />
                <span className="hidden sm:inline">Tìm nhanh</span>
              </button>

              {viewLevel === 'room' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setResidentsPanelOpen(prev => !prev);
                      setEquipmentPanelOpen(false);
                      setSearchOpen(false);
                    }}
                    title="Xem danh sách giường & cư dân trong phòng"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold font-tabular transition-colors ${
                      residentsPanelOpen ? 'bg-blue-600 border-blue-500 text-white' : hudSubtleBtn
                    }`}
                  >
                    <Users size={13} />
                    <span>
                      {roomBedStats.occupied}/{activeRoomBeds.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEquipmentPanelOpen(prev => !prev);
                      setResidentsPanelOpen(false);
                      setSearchOpen(false);
                    }}
                    title="Xem danh sách thiết bị cơ sở vật chất của phòng"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                      equipmentPanelOpen ? 'bg-blue-600 border-blue-500 text-white' : hudSubtleBtn
                    }`}
                  >
                    <Wrench size={13} />
                    <span className="hidden sm:inline">Thiết bị</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing}
                title="Đồng bộ dữ liệu 3D mới nhất"
                className={`p-1.5 rounded-xl border transition-colors ${hudSubtleBtn}`}
                aria-label="Làm mới dữ liệu 3D"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-500' : ''} />
              </button>

              <button
                type="button"
                onClick={handleCaptureSnapshot}
                title="Chụp ảnh mô hình 3D sắc nét (PNG)"
                className={`p-1.5 rounded-xl border transition-colors ${hudSubtleBtn}`}
                aria-label="Chụp ảnh 3D"
              >
                <Camera size={14} />
              </button>

              <button
                type="button"
                onClick={() => setSceneTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
                title={isLight ? 'Chuyển nền Ban đêm (Tối)' : 'Chuyển nền Ban ngày (Sáng)'}
                className={`p-1.5 rounded-xl border transition-colors ${hudSubtleBtn}`}
                aria-label="Đổi ánh sáng ban ngày / ban đêm"
              >
                {isLight ? <Moon size={14} /> : <Sun size={14} />}
              </button>
            </div>
          </div>

          {/* ── Quick Search Dropdown Panel (Only when toggled open) ── */}
          {searchOpen && (
            <div className={`rounded-2xl border p-3 w-full max-w-md ${hudCard}`}>
              <div className="relative">
                <Search
                  size={14}
                  className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${hudMuted}`}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Nhập họ tên, mã NV, SĐT hoặc số phòng (VD: P.5, Dãy 2)..."
                  className={`w-full pl-9 pr-8 py-2 rounded-xl border text-xs focus:outline-none focus:border-blue-500 ${hudSelect}`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${hudMuted} hover:text-blue-500`}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {searchQuery.trim().length > 0 && (
                <div className={`mt-2.5 max-h-72 overflow-y-auto scrollbar-thin divide-y ${hudDivider}`}>
                  {searchResults.rooms.length === 0 && searchResults.workers.length === 0 ? (
                    <p className={`py-4 text-center text-xs ${hudMuted}`}>
                      Không tìm thấy phòng hoặc công nhân phù hợp
                    </p>
                  ) : (
                    <>
                      {searchResults.rooms.length > 0 && (
                        <div className="pb-2 space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider px-1 ${hudMuted}`}>
                            Phòng ({searchResults.rooms.length})
                          </p>
                          {searchResults.rooms.map(room => (
                            <div
                              key={`sr-${room.key}`}
                              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl transition-colors ${
                                isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800/80'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleLocateRoomOnCampus(room)}
                                className="flex-1 text-left min-w-0"
                              >
                                <p className="text-xs font-bold truncate">
                                  {room.ktx} · {room.day} · {room.roomLabel}
                                </p>
                                <p className={`text-[11px] font-tabular truncate ${hudMuted}`}>
                                  {room.occupied}/{room.capacity} người · {room.genderInfo.label}
                                </p>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSearchOpen(false);
                                  setSearchQuery('');
                                  handleEnterRoom(room);
                                }}
                                className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold shrink-0"
                              >
                                Vào 3D
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {searchResults.workers.length > 0 && (
                        <div className="pt-2 space-y-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wider px-1 ${hudMuted}`}>
                            Công nhân ({searchResults.workers.length})
                          </p>
                          {searchResults.workers.map(({ worker, room }) => (
                            <div
                              key={`sw-${worker.id}`}
                              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl transition-colors ${
                                isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800/80'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleLocateWorkerIn3D(worker, room)}
                                className="flex-1 text-left min-w-0"
                              >
                                <p className="text-xs font-bold truncate">
                                  {worker.hoVaTen}
                                  {worker.maNV ? (
                                    <span className={`ml-1.5 font-mono font-normal ${hudMuted}`}>
                                      #{worker.maNV}
                                    </span>
                                  ) : null}
                                </p>
                                <p className={`text-[11px] font-tabular truncate ${hudMuted}`}>
                                  {room
                                    ? `${room.ktx} · ${room.day} · ${room.roomLabel}${
                                        worker.giuong ? ` · G${normalizeBedLabel(worker.giuong)}` : ''
                                      }`
                                    : 'Chưa xếp phòng'}
                                </p>
                              </button>
                              {room && (
                                <button
                                  type="button"
                                  onClick={() => handleLocateRoomOnCampus(room)}
                                  title="Bay camera định vị trên Sa bàn"
                                  className={`p-1.5 rounded-lg border shrink-0 ${hudSubtleBtn}`}
                                >
                                  <MapPin size={12} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Focused Room Quick Bar (when located via Search on Campus) ── */}
          {viewLevel === 'campus' && focusedRoom && (
            <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${hudCard}`}>
              <div className="flex items-center gap-2 min-w-0">
                <MapPin size={14} className="text-sky-500 shrink-0" />
                <span className="font-bold truncate">
                  {focusedRoom.ktx} · {focusedRoom.day} · {focusedRoom.roomLabel}
                </span>
                <span className={`font-tabular shrink-0 ${hudMuted}`}>
                  ({focusedRoom.occupied}/{focusedRoom.capacity})
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleEnterRoom(focusedRoom)}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                  Vào phòng 3D →
                </button>
                <button
                  type="button"
                  onClick={() => setFocusedRoomKey(null)}
                  className={`p-1 rounded-lg ${hudMuted} hover:text-blue-500`}
                  aria-label="Bỏ chọn phòng đang định vị"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          {/* ── Collapsible Room Residents & Beds Quick-List (Room 3D view only, closed by default) ── */}
          {viewLevel === 'room' && residentsPanelOpen && (
            <div className={`rounded-2xl border p-3 w-full max-w-sm ${hudCard}`}>
              <div className={`flex items-center justify-between pb-2 mb-2 border-b ${hudDivider}`}>
                <span className="text-xs font-bold">
                  Danh sách giường ({activeRoomBeds.length})
                </span>
                <button
                  type="button"
                  onClick={() => setResidentsPanelOpen(false)}
                  className={`p-1 rounded-lg ${hudMuted} hover:text-blue-500`}
                >
                  <X size={13} />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-1 pr-0.5">
                {activeRoomBeds.map(bed => {
                  const isSel = selectedBed?.id === bed.id;
                  return (
                    <button
                      key={`rl-${bed.id}`}
                      type="button"
                      onClick={() => handleFocusBed(bed)}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors border ${
                        isSel
                          ? 'bg-blue-600/20 border-blue-500/60'
                          : isLight
                            ? 'border-transparent hover:bg-slate-100'
                            : 'border-transparent hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-bold text-[11px] w-8 shrink-0">
                          {bed.bedLabel}
                        </span>
                        <span className="truncate font-medium">
                          {bed.hoVaTen || (
                            <span className={`italic ${hudMuted}`}>
                              {getBedStatusLabel(bed.status)}
                            </span>
                          )}
                        </span>
                      </div>
                      <span className={`text-[10px] shrink-0 ${hudMuted}`}>
                        {bed.tier === 'bottom' ? 'Dưới' : 'Trên'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Room Equipment Popover (Synced with real `facilities` table) ── */}
          {viewLevel === 'room' && equipmentPanelOpen && activeRoom && (
            <div className={`rounded-2xl border p-3 w-full max-w-sm ${hudCard}`}>
              <div className={`flex items-center justify-between pb-2 mb-2 border-b ${hudDivider}`}>
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Wrench size={13} className="text-blue-500" />
                  Cơ sở vật chất phòng ({activeRoom.roomLabel})
                </span>
                <button
                  type="button"
                  onClick={() => setEquipmentPanelOpen(false)}
                  className={`p-1 rounded-lg ${hudMuted} hover:text-blue-500`}
                  aria-label="Đóng bảng thiết bị"
                >
                  <X size={13} />
                </button>
              </div>
              {activeRoom.facility ? (
                <div className="space-y-2.5 text-xs">
                  <div className="grid grid-cols-3 gap-1.5 font-tabular">
                    {(
                      [
                        { label: 'Giường', val: activeRoom.facility.giuong },
                        { label: 'Điều hòa', val: activeRoom.facility.dieu_hoa },
                        { label: 'Quạt', val: activeRoom.facility.quat },
                        { label: 'Bóng đèn', val: activeRoom.facility.bong_tuyp },
                        { label: 'Tủ đồ', val: activeRoom.facility.tu },
                        { label: 'Ổ cắm', val: activeRoom.facility.o_cam_dien },
                        { label: 'Remote ĐH', val: activeRoom.facility.remote },
                        { label: 'Bàn ăn', val: activeRoom.facility.ban_an },
                        { label: 'Ghế ăn', val: activeRoom.facility.ghe_an },
                      ] as { label: string; val: number | undefined }[]
                    ).map(item => (
                      <div
                        key={item.label}
                        className={`rounded-xl border px-2 py-1.5 ${
                          isLight
                            ? 'bg-slate-50 border-slate-200'
                            : 'bg-slate-900/75 border-slate-800'
                        }`}
                      >
                        <span className={`block text-[10px] ${hudMuted}`}>{item.label}</span>
                        <span className="font-bold text-xs">{Number(item.val) || 0}</span>
                      </div>
                    ))}
                  </div>
                  {activeRoom.facility.ghi_chu && (
                    <p
                      className={`text-[11px] rounded-xl border px-2.5 py-1.5 ${
                        isLight
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
                      }`}
                    >
                      Ghi chú: {activeRoom.facility.ghi_chu}
                    </p>
                  )}
                </div>
              ) : (
                <p className={`text-xs py-2 ${hudMuted}`}>
                  Phòng này chưa có bản ghi thiết bị trong trang Cơ sở vật chất. Mô hình 3D đang dùng cấu hình mặc định.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Selected Bed Inspector Card (Top-Right, ONLY when a bed is clicked) ── */}
        {viewLevel === 'room' && selectedBed && (
          <div className={`pointer-events-auto w-72 sm:w-80 rounded-2xl border p-4 ${hudCard}`}>
            <div className={`flex items-start justify-between gap-2 pb-2.5 border-b ${hudDivider}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/35 text-blue-500 flex items-center justify-center shrink-0">
                  <BedDouble size={16} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold font-mono">{selectedBed.bedLabel}</span>
                    <span className={`text-[11px] ${hudMuted}`}>
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
                className={`p-1.5 rounded-lg transition-colors ${hudMuted} hover:text-blue-500`}
                aria-label="Đóng chi tiết giường"
              >
                <X size={15} />
              </button>
            </div>

            {selectedBed.hoVaTen ? (
              <div className="py-3 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <User size={13} className={`${hudMuted} shrink-0`} />
                  <span className="font-bold truncate">{selectedBed.hoVaTen}</span>
                </div>
                <div
                  className={`grid grid-cols-2 gap-2 text-[11px] font-tabular rounded-xl p-2.5 border ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-slate-900/75 border-slate-800 text-slate-300'
                  }`}
                >
                  <div>
                    <span className={`${hudMuted} block`}>Mã NV</span>
                    <span className="font-semibold">{selectedBed.maNV || '—'}</span>
                  </div>
                  <div>
                    <span className={`${hudMuted} block`}>Tiểu đoàn / ĐV</span>
                    <span className="font-semibold truncate block">
                      {selectedBed.tieuDoan
                        ? `TĐ ${selectedBed.tieuDoan}`
                        : selectedBed.donVi || '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className={`${hudMuted} block`}>Ngày vào KTX</span>
                    <span className="font-semibold">{selectedBed.ngayVaoKTX || '—'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className={`py-3 text-xs ${hudMuted}`}>
                Giường này hiện chưa có công nhân lưu trú. Trong bản thử nghiệm chỉ xem, mọi thao tác xếp giường thực hiện ở trang Quản Lý Giường.
              </p>
            )}

            <div className={`pt-2 border-t flex items-center gap-2 ${hudDivider}`}>
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
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${hudSubtleBtn}`}
                >
                  <QrCode size={12} />
                  <span>Kiểm tra QR</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push('/bed-management')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${hudSubtleBtn}`}
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
          className={`pointer-events-none fixed z-30 rounded-xl border px-3 py-2 text-xs max-w-xs ${hudCard}`}
          style={{
            left: Math.min(
              hoverInfo.screenX + 16,
              (typeof window !== 'undefined' ? window.innerWidth : 1200) - 250
            ),
            top: Math.max(12, hoverInfo.screenY - 12),
          }}
        >
          {hoverInfo.type === 'room' && hoverInfo.room && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold">
                  {hoverInfo.room.ktx} · {hoverInfo.room.day} · {hoverInfo.room.roomLabel}
                </span>
                <span className="font-tabular font-bold text-sky-500">
                  {hoverInfo.room.occupied}/{hoverInfo.room.capacity}
                </span>
              </div>
              <p className={`text-[11px] ${hudMuted}`}>
                {hoverInfo.room.genderInfo.label}
                {hoverInfo.room.dominantUnit ? ` · ${hoverInfo.room.dominantUnit}` : ''}
                {hoverInfo.room.vacant > 0
                  ? ` · Còn ${hoverInfo.room.vacant} chỗ`
                  : hoverInfo.room.overflow > 0
                    ? ` · Quá tải +${hoverInfo.room.overflow}`
                    : ' · Đầy 100%'}
              </p>
              {colorMode === 'unit_xray' && unitXRayFilter && (
                <p className="text-[11px] font-semibold text-sky-500 font-tabular">
                  {unitXRayFilter.label}: {getRoomUnitMatchCount(hoverInfo.room, unitXRayFilter)}/
                  {hoverInfo.room.occupied} người
                </p>
              )}
              <p className="text-[10px] text-blue-500 font-semibold">
                Bấm để xem mô hình giường tầng bên trong →
              </p>
            </div>
          )}

          {hoverInfo.type === 'bed' && hoverInfo.bed && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold font-mono">
                  {hoverInfo.bed.bedLabel} ·{' '}
                  {hoverInfo.bed.tier === 'bottom' ? 'Tầng dưới' : 'Tầng trên'}
                </span>
                <span className="text-[10px] font-semibold text-sky-500">
                  {getBedStatusLabel(hoverInfo.bed.status)}
                </span>
              </div>
              <p className={`text-[11px] ${hudMuted}`}>
                {hoverInfo.bed.hoVaTen
                  ? `${hoverInfo.bed.hoVaTen}${hoverInfo.bed.maNV ? ` (#${hoverInfo.bed.maNV})` : ''}`
                  : 'Chưa có người ở'}
              </p>
            </div>
          )}

          {hoverInfo.type === 'functional' && hoverInfo.functional && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-violet-500">{hoverInfo.functional.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/35 text-[10px] font-bold text-violet-400">
                  Khu chức năng
                </span>
              </div>
              <p className={`text-[11px] ${hudMuted}`}>
                {hoverInfo.functional.ktx}
                {hoverInfo.functional.day ? ` · ${hoverInfo.functional.day}` : ''}
              </p>
              {(Number(hoverInfo.functional.facility.dieu_hoa) > 0 ||
                Number(hoverInfo.functional.facility.quat) > 0 ||
                Number(hoverInfo.functional.facility.ban_an) > 0) && (
                <p className={`text-[11px] font-tabular ${hudMuted}`}>
                  {[
                    Number(hoverInfo.functional.facility.dieu_hoa) > 0
                      ? `${hoverInfo.functional.facility.dieu_hoa} ĐH`
                      : null,
                    Number(hoverInfo.functional.facility.quat) > 0
                      ? `${hoverInfo.functional.facility.quat} quạt`
                      : null,
                    Number(hoverInfo.functional.facility.ban_an) > 0
                      ? `${hoverInfo.functional.facility.ban_an} bàn`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {hoverInfo.functional.ghiChu && (
                <p className={`text-[11px] italic ${hudMuted}`}>{hoverInfo.functional.ghiChu}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Unified Collapsible Bottom Control Dock (Zero Side-Panel Clutter) ── */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-[min(980px,95vw)]">
        <button
          type="button"
          onClick={() => setDockCollapsed(prev => !prev)}
          title="Ẩn/hiện thanh điều khiển (Phím H)"
          className={`pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-xl border border-b-0 text-[11px] font-semibold transition-colors ${hudCard}`}
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
          <div className={`pointer-events-auto w-full rounded-2xl border px-3.5 py-2.5 space-y-2 ${hudCard}`}>
            {viewLevel === 'campus' ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* KTX Scope Selector */}
                  <div className="flex items-center gap-1.5">
                    <Filter size={13} className={`${hudMuted} shrink-0`} />
                    <select
                      value={selectedKtxFilter}
                      onChange={e => {
                        setSelectedKtxFilter(e.target.value);
                        setFocusedRoomKey(null);
                      }}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-blue-500 ${hudSelect}`}
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
                  <div
                    className={`flex items-center gap-0.5 rounded-xl border p-0.5 text-[11px] ${
                      isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900/90 border-slate-800'
                    }`}
                  >
                    {(
                      [
                        { id: 'occupancy', label: 'Lấp đầy' },
                        { id: 'gender', label: 'Nam / Nữ' },
                        { id: 'vacant_only', label: 'Còn trống' },
                        { id: 'overloaded_only', label: 'Quá tải' },
                      ] as { id: CampusColorMode; label: string }[]
                    ).map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setColorMode(opt.id);
                          setUnitXRayFilter(null);
                        }}
                        className={`px-2 py-1 rounded-lg font-semibold transition-colors ${
                          colorMode === opt.id
                            ? 'bg-blue-600 text-white'
                            : `${hudMuted} hover:text-blue-500`
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* X-Ray Platoon / Unit Filter Dropdown */}
                  <select
                    value={unitXRayFilter ? `${unitXRayFilter.type}::${unitXRayFilter.value}` : ''}
                    onChange={e => handleXRaySelectChange(e.target.value)}
                    title="Lọc X-quang theo Tiểu đoàn hoặc Đơn vị"
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium focus:outline-none focus:border-blue-500 max-w-[185px] ${
                      colorMode === 'unit_xray'
                        ? 'border-sky-500 ring-1 ring-sky-500/40 ' + hudSelect
                        : hudSelect
                    }`}
                  >
                    <option value="">X-quang Tiểu đoàn / ĐV...</option>
                    {xrayOptions.platoons.length > 0 && (
                      <optgroup label="Tiểu đoàn">
                        {xrayOptions.platoons.map(p => (
                          <option key={`pl-${p.value}`} value={`platoon::${p.value}`}>
                            {p.label} ({p.count})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {xrayOptions.units.length > 0 && (
                      <optgroup label="Đơn vị">
                        {xrayOptions.units.map(u => (
                          <option key={`un-${u.value}`} value={`unit::${u.value}`}>
                            {u.label} ({u.count})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* Camera Presets + Zoom +/- + Reset */}
                  <div className="flex items-center gap-1">
                    <Compass size={13} className={`${hudMuted} mr-0.5 hidden sm:inline`} />
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
                        className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${hudSubtleBtn}`}
                      >
                        {cam.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => triggerZoom(0.78)}
                      title="Phóng to (+)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Phóng to"
                    >
                      <ZoomIn size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerZoom(1.28)}
                      title="Thu nhỏ (-)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Thu nhỏ"
                    >
                      <ZoomOut size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedRoomKey(null);
                        triggerCameraPreset('overview');
                      }}
                      title="Đặt lại góc nhìn (0)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Đặt lại góc nhìn"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>

                {/* Legend + Quick Room Jump + Render Stats */}
                <div className={`flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t text-[11px] ${hudDivider} ${hudMuted}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    {colorMode === 'unit_xray' && unitXRayFilter ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-sky-500">
                          <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
                          Có {unitXRayFilter.label} ({campusTotals.xrayMatchedRooms} phòng)
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-500/50" />
                          Phòng khác
                        </span>
                      </>
                    ) : colorMode === 'gender' ? (
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
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-500" />
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
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-500" />
                          Trống
                        </span>
                      </>
                    )}
                    {showFunctionalRooms && campusTotals.functionalCount > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-violet-500" />
                        Chức năng ({campusTotals.functionalCount})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setHideRoofs(prev => !prev)}
                      title="Ẩn/hiện mái tôn các dãy nhà để quan sát mặt bằng từ trên cao"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-colors ${
                        hideRoofs ? 'bg-blue-600 border-blue-500 text-white' : hudSubtleBtn
                      }`}
                    >
                      <EyeOff size={11} />
                      <span>{hideRoofs ? 'Hiện mái' : 'Ẩn mái'}</span>
                    </button>

                    {campusTotals.functionalCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowFunctionalRooms(prev => !prev)}
                        title="Bật/tắt lớp Khu chức năng (Văn phòng, Nhà ăn, WC...)"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-colors ${
                          showFunctionalRooms
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : hudSubtleBtn
                        }`}
                      >
                        <Building2 size={11} />
                        <span>Khu CN</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1">
                      <DoorOpen size={12} className="shrink-0" />
                      <select
                        value=""
                        onChange={e => {
                          const room = roomByKeyMap.get(e.target.value);
                          if (room) handleEnterRoom(room);
                        }}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium focus:outline-none max-w-[165px] ${hudSelect}`}
                      >
                        <option value="">Mở nhanh phòng...</option>
                        {visibleRoomsFlat.map(r => (
                          <option key={r.key} value={r.key}>
                            {r.ktx} · {r.day} · {r.roomLabel} ({r.occupied}/{r.capacity})
                          </option>
                        ))}
                      </select>
                    </div>

                    {perfStats && (
                      <span className="font-mono text-[10px] font-tabular opacity-75">
                        {perfStats.isSoftwareGl ? 'SW' : 'GPU'} · {perfStats.lastFrameMs}ms ·{' '}
                        {perfStats.drawCalls} calls
                      </span>
                    )}
                  </div>
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
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
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
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-blue-500 max-w-[230px] ${hudSelect}`}
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
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      title="Phòng kế tiếp"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  {/* Bunk Tier Filter (Tất cả / Tầng dưới / Tầng trên) + Direct Bed Names */}
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`flex items-center gap-0.5 rounded-xl border p-0.5 text-[11px] ${
                        isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900/90 border-slate-800'
                      }`}
                    >
                      {(
                        [
                          { id: 'all', label: 'Tất cả' },
                          { id: 'bottom', label: 'Tầng dưới' },
                          { id: 'top', label: 'Tầng trên' },
                        ] as { id: BedTierFilter; label: string }[]
                      ).map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setBedTierFilter(opt.id)}
                          className={`px-2 py-1 rounded-lg font-semibold transition-colors ${
                            bedTierFilter === opt.id
                              ? 'bg-blue-600 text-white'
                              : `${hudMuted} hover:text-blue-500`
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowBedNames(prev => !prev)}
                      title="Hiện/ẩn tên ngắn của công nhân ngay trên bảng tên giường 3D"
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                        showBedNames ? 'bg-blue-600 border-blue-500 text-white' : hudSubtleBtn
                      }`}
                    >
                      <Tag size={11} />
                      <span className="hidden sm:inline">Tên CN</span>
                    </button>
                  </div>

                  {/* Interior Camera Presets + Zoom +/- + Reset */}
                  <div className="flex items-center gap-1">
                    <Layers size={13} className={`${hudMuted} mr-0.5 hidden sm:inline`} />
                    {(
                      [
                        { id: 'overview', label: 'Tổng phòng' },
                        { id: 'left_row', label: 'Dãy trái' },
                        { id: 'right_row', label: 'Dãy phải' },
                        { id: 'top', label: 'Trên cao' },
                      ] as { id: CameraPreset; label: string }[]
                    ).map(cam => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => triggerCameraPreset(cam.id)}
                        className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${hudSubtleBtn}`}
                      >
                        {cam.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => triggerZoom(0.78)}
                      title="Phóng to (+)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Phóng to"
                    >
                      <ZoomIn size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerZoom(1.28)}
                      title="Thu nhỏ (-)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Thu nhỏ"
                    >
                      <ZoomOut size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerCameraPreset('overview')}
                      title="Đặt lại góc nhìn (0)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Đặt lại góc nhìn"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>

                {/* Bed Legend + Render Stats */}
                <div className={`flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t text-[11px] ${hudDivider} ${hudMuted}`}>
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
                  </div>

                  {perfStats && (
                    <span className="font-mono text-[10px] font-tabular opacity-75">
                      {perfStats.isSoftwareGl ? 'SW' : 'GPU'} · {perfStats.lastFrameMs}ms ·{' '}
                      {perfStats.drawCalls} calls
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
