'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
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
  Hand,
  Layers,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Moon,
  Orbit,
  QrCode,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Tag,
  Unlock,
  User,
  Users,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWorkers } from '@/context/WorkerContext';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
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
  releaseBedsForWorkers,
} from '@/lib/bedSync';
import { createClient } from '@/lib/supabase/client';
import Ktx3DViewport, { type Ktx3DViewportHandle } from './Ktx3DViewport';
import BlueprintEditorPanel from './BlueprintEditorPanel';
import BedOperationsPanel from './BedOperationsPanel';
import { getRoomUnitMatchCount } from '../scene/campusBuilder';
import {
  CAMPUS_BLUEPRINT_CONFIG,
  fetchCampusBlueprintConfig,
  saveCampusBlueprintConfig,
  type CampusBlueprintConfig,
} from '../scene/campusLayoutConfig';
import type {
  AlertCategory,
  BedTierFilter,
  CameraNavMode,
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
  const searchParams = useSearchParams();
  const { workers, loading: workersLoading, refreshWorkers } = useWorkers();
  const { currentUser, isAdmin, isStaff, canWriteBlock } = useAuth();
  const { addLog } = useAudit();

  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>({});
  const [blueprintConfig, setBlueprintConfig] = useState<CampusBlueprintConfig>(
    CAMPUS_BLUEPRINT_CONFIG
  );
  const [metaLoading, setMetaLoading] = useState(true);

  // View & Theme state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('campus');
  const [sceneTheme, setSceneTheme] = useState<SceneTheme>('dark');
  const [selectedKtxFilter, setSelectedKtxFilter] = useState<string>('all');
  const [colorMode, setColorMode] = useState<CampusColorMode>('occupancy');
  const [unitXRayFilter, setUnitXRayFilter] = useState<UnitXRayFilter | null>(null);
  const [assignedOnlyFilter, setAssignedOnlyFilter] = useState(false);
  const [focusedRoomKey, setFocusedRoomKey] = useState<string | null>(null);
  const [hideRoofs, setHideRoofs] = useState(false);
  const [showFunctionalRooms, setShowFunctionalRooms] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Operational Alert Bar cycling state
  const [activeAlertCursor, setActiveAlertCursor] = useState<{
    category: AlertCategory;
    index: number;
  } | null>(null);

  // Active Room & Beds state
  const [activeRoomKey, setActiveRoomKey] = useState<string | null>(null);
  const [activeRoomBeds, setActiveRoomBeds] = useState<RoomBedSlot[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [selectedBed, setSelectedBed] = useState<RoomBedSlot | null>(null);
  const [bedTierFilter, setBedTierFilter] = useState<BedTierFilter>('all');
  const [showBedNames, setShowBedNames] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  // Safe Operational Mode (Default LOCKED Read-only) + Admin Blueprint Editor
  const [editModeUnlocked, setEditModeUnlocked] = useState(false);
  const [bedOpBusy, setBedOpBusy] = useState(false);
  const [blueprintEditorOpen, setBlueprintEditorOpen] = useState(false);
  const [savingBlueprint, setSavingBlueprint] = useState(false);

  // Quick Search, Room Residents & Equipment Popovers + Cache/Refresh
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [residentsPanelOpen, setResidentsPanelOpen] = useState(false);
  const [equipmentPanelOpen, setEquipmentPanelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Ktx3DViewportHandle | null>(null);
  const pendingFocusWorkerIdRef = useRef<string | null>(null);
  const pendingFocusBedNumRef = useRef<number | null>(null);
  const deepLinkAppliedRef = useRef(false);
  const roomBedsCacheRef = useRef<Map<string, { rows: RawBedRow[]; fetchedAt: number }>>(new Map());

  // Camera & HUD controls
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [navMode, setNavMode] = useState<CameraNavMode>('orbit');
  const [compassHeading, setCompassHeading] = useState<number>(0);
  const [cameraPresetReq, setCameraPresetReq] = useState<{ preset: CameraPreset; seq: number } | null>(null);
  const [focusRoomReq, setFocusRoomReq] = useState<{ roomKey: string; seq: number } | null>(null);
  const [focusBuildingReq, setFocusBuildingReq] = useState<{ buildingKey: string; seq: number } | null>(null);
  const [focusBedReq, setFocusBedReq] = useState<{ bedId: string; seq: number } | null>(null);
  const [zoomReq, setZoomReq] = useState<{ factor: number; seq: number } | null>(null);
  const [perfStats, setPerfStats] = useState<RenderPerfStats | null>(null);

  const hasStaffAssignedBlocks =
    isStaff && Boolean(currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0);

  // Default Staff accounts to highlighting their assigned blocks cleanly
  useEffect(() => {
    if (hasStaffAssignedBlocks) {
      setAssignedOnlyFilter(true);
    }
  }, [hasStaffAssignedBlocks]);

  // Sync initial sceneTheme cleanly with app's active Light/Dark mode
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isLightDom =
      document.documentElement.classList.contains('light') ||
      document.documentElement.getAttribute('data-theme') === 'light';
    if (isLightDom) setSceneTheme('light');
  }, []);

  // Track Fullscreen API state
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Auto-invalidate bed cache whenever WorkerContext data refreshes
  useEffect(() => {
    roomBedsCacheRef.current.clear();
  }, [workers]);

  // Supabase Realtime subscription for `beds` & `facilities` (debounced 850ms for zero frame stutter)
  useEffect(() => {
    const supabase = createClient();
    let bedsTimer: number | null = null;
    let facTimer: number | null = null;

    const channel = supabase
      .channel('ktx-3d-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'beds' },
        () => {
          if (bedsTimer) window.clearTimeout(bedsTimer);
          bedsTimer = window.setTimeout(() => {
            roomBedsCacheRef.current.clear();
            setRefreshSeq(prev => prev + 1);
          }, 850);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'facilities' },
        () => {
          if (facTimer) window.clearTimeout(facTimer);
          facTimer = window.setTimeout(() => {
            void fetchFacilitiesList(true)
              .then(facs => {
                setFacilities(facs);
                setCapacities(buildRoomCapacityMapFromFacilities(facs));
              })
              .catch(() => {});
          }, 1000);
        }
      )
      .subscribe();

    return () => {
      if (bedsTimer) window.clearTimeout(bedsTimer);
      if (facTimer) window.clearTimeout(facTimer);
      void supabase.removeChannel(channel);
    };
  }, []);

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
        } else if (blueprintEditorOpen) {
          setBlueprintEditorOpen(false);
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
          setEditModeUnlocked(false);
          setHoverInfo(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    searchOpen,
    blueprintEditorOpen,
    residentsPanelOpen,
    equipmentPanelOpen,
    selectedBed,
    focusedRoomKey,
    viewLevel,
  ]);

  // Load real facilities, room gender labels & saved 3D blueprint config
  useEffect(() => {
    let active = true;
    const savedGender = loadSavedRoomGenderMap();
    setRoomGenderMap(savedGender);

    Promise.all([
      fetchFacilitiesList(false).catch(() => [] as FacilityItem[]),
      fetchRoomLabelsAuthoritative().catch(() => ({ data: savedGender, ok: false })),
      fetchCampusBlueprintConfig().catch(() => CAMPUS_BLUEPRINT_CONFIG),
    ]).then(([facs, genderRes, bpCfg]) => {
      if (!active) return;
      setFacilities(facs);
      setCapacities(buildRoomCapacityMapFromFacilities(facs));
      if (genderRes.ok) {
        setRoomGenderMap(genderRes.data);
      }
      setBlueprintConfig(bpCfg);
      setMetaLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  // Manual Refresh: bypasses facility + bed caches to pull latest real-time state
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
      void refreshWorkers();
      setRefreshSeq(prev => prev + 1);
      toast.success('Đã đồng bộ dữ liệu 3D mới nhất');
    } catch {
      toast.error('Không thể làm mới dữ liệu lúc này');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, roomGenderMap, refreshWorkers]);

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

      const ktxAllFuncs = (functionalAreasByKtx.get(ktx) || []).sort((a, b) =>
        naturalSortCompare(a.name, b.name)
      );
      const matchedFuncKeys = new Set<string>();

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

          let unregisteredTamTruCount = 0;
          let unassignedBedCount = 0;

          rWorkers.forEach(w => {
            const td = (w.tieuDoan || '').trim();
            const dv = (w.donVi || '').trim();
            if (td) platoonCounts[td] = (platoonCounts[td] || 0) + 1;
            if (dv) unitCounts[dv] = (unitCounts[dv] || 0) + 1;
            const uLabel = td ? `TĐ ${td}` : dv;
            if (uLabel) combinedCounts.set(uLabel, (combinedCounts.get(uLabel) || 0) + 1);
            if (w.tamTruStatus !== 'registered') unregisteredTamTruCount++;
            if (!normalizeBedLabel(w.giuong)) unassignedBedCount++;
          });

          let dominantUnit = '';
          let maxU = 0;
          combinedCounts.forEach((cnt, u) => {
            if (cnt > maxU) {
              maxU = cnt;
              dominantUnit = u;
            }
          });

          const hasWriteAccess = isAdmin || canWriteBlock(day, ktx);

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
            unregisteredTamTruCount,
            unassignedBedCount,
            hasWriteAccess,
            facility: facilityByKey.get(key) || null,
          };
          flatRooms.push(roomNode);
          byKey.set(key, roomNode);
          return roomNode;
        });

        // Attach functional rooms (e.g. Nhà ăn 1 in Dãy 1 KTX 1) directly to their parent building!
        const normBldDay = normalizeDayKey(day);
        const bldFuncs = ktxAllFuncs.filter(f => {
          if (!f.day) return false;
          if (normalizeDayKey(f.day) === normBldDay) {
            matchedFuncKeys.add(f.key);
            return true;
          }
          return false;
        });

        return {
          key: `${ktx}||${day}`,
          ktx,
          day,
          rooms,
          functionalAreas: bldFuncs,
          totalCapacity: rooms.reduce((s, r) => s + r.capacity, 0),
          totalOccupied: rooms.reduce((s, r) => s + r.occupied, 0),
          unregisteredTamTruCount: rooms.reduce((s, r) => s + r.unregisteredTamTruCount, 0),
          hasWriteAccess: isAdmin || canWriteBlock(day, ktx),
        };
      });

      // Only truly standalone functional areas (no matching building day) sit in the KTX yard apron
      const standaloneFunctionalAreas = ktxAllFuncs.filter(f => !matchedFuncKeys.has(f.key));

      return {
        ktx,
        buildings,
        functionalAreas: standaloneFunctionalAreas,
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
  }, [facilities, workers, capacities, roomGenderMap, isAdmin, canWriteBlock]);

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

      // Keep selected bed inspector synced with fresh slot state after realtime/write updates
      setSelectedBed(prev => (prev ? slots.find(s => s.id === prev.id) || null : null));

      // If user jumped here from Quick Search or Deep-Link for a specific worker or bed, auto-select & fly to it!
      const pendingWorkerId = pendingFocusWorkerIdRef.current;
      const pendingBedNum = pendingFocusBedNumRef.current;
      if (pendingWorkerId) {
        pendingFocusWorkerIdRef.current = null;
        pendingFocusBedNumRef.current = null;
        const targetBed = slots.find(s => s.workerId === pendingWorkerId);
        if (targetBed) {
          setSelectedBed(targetBed);
          window.setTimeout(() => {
            setFocusBedReq(prev => ({ bedId: targetBed.id, seq: (prev?.seq || 0) + 1 }));
          }, 120);
        }
      } else if (pendingBedNum !== null) {
        pendingFocusBedNumRef.current = null;
        const targetBed = slots.find(s => s.bedNumber === pendingBedNum);
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
    setBlueprintEditorOpen(false);
    setEditModeUnlocked(false);
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
    setEditModeUnlocked(false);
    setHoverInfo(null);
  }, []);

  // ── 2-Way Deep-Linking (?ktx=&day=&room=&worker=&bed=) ──
  useEffect(() => {
    if (deepLinkAppliedRef.current || workersLoading || metaLoading || allRoomsFlat.length === 0) {
      return;
    }
    const qWorker = (searchParams.get('worker') || '').trim();
    const qKtx = (searchParams.get('ktx') || '').trim();
    const qDay = (searchParams.get('day') || '').trim();
    const qRoom = (searchParams.get('room') || '').trim();
    const qBed = (searchParams.get('bed') || '').trim();

    if (!qWorker && !qKtx && !qDay && !qRoom && !qBed) {
      deepLinkAppliedRef.current = true;
      return;
    }

    deepLinkAppliedRef.current = true;

    if (qWorker) {
      const targetWorker = (workers || []).find(w => w.id === qWorker);
      if (targetWorker) {
        const wKtx = normalizeKtxCompact(targetWorker.ktx);
        const wDay = normalizeDayKey(targetWorker.day);
        const wRoom = normalizeRoomLabel(targetWorker.phongSo || '');
        const matchedRoom = allRoomsFlat.find(
          r =>
            normalizeKtxCompact(r.ktx) === wKtx &&
            normalizeDayKey(r.day) === wDay &&
            normalizeRoomLabel(r.roomRaw) === wRoom
        );
        if (matchedRoom) {
          pendingFocusWorkerIdRef.current = targetWorker.id;
          handleEnterRoom(matchedRoom);
          return;
        }
      }
    }

    if (qKtx && qDay && qRoom) {
      const tKtx = normalizeKtxCompact(qKtx);
      const tDay = normalizeDayKey(qDay);
      const tRoom = normalizeRoomLabel(qRoom);
      const matchedRoom = allRoomsFlat.find(
        r =>
          normalizeKtxCompact(r.ktx) === tKtx &&
          normalizeDayKey(r.day) === tDay &&
          normalizeRoomLabel(r.roomRaw) === tRoom
      );
      if (matchedRoom) {
        if (qBed) {
          const parsedBed = parseInt(normalizeBedLabel(qBed), 10);
          if (Number.isFinite(parsedBed) && parsedBed > 0) {
            pendingFocusBedNumRef.current = parsedBed;
          }
        }
        handleEnterRoom(matchedRoom);
        return;
      }
    }

    if (qKtx) {
      const tKtx = normalizeKtxCompact(qKtx);
      const matchedKtx = allKtxNodes.find(k => normalizeKtxCompact(k.ktx) === tKtx);
      if (matchedKtx) {
        setSelectedKtxFilter(matchedKtx.ktx);
        if (qDay) {
          const tDay = normalizeDayKey(qDay);
          const matchedB = matchedKtx.buildings.find(b => normalizeDayKey(b.day) === tDay);
          if (matchedB) {
            window.setTimeout(() => {
              setFocusBuildingReq(prev => ({ buildingKey: matchedB.key, seq: (prev?.seq || 0) + 1 }));
            }, 140);
          }
        }
      }
    }
  }, [searchParams, workersLoading, metaLoading, allRoomsFlat, allKtxNodes, workers, handleEnterRoom]);

  const handleToggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        await (containerRef.current || document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      toast.error('Trình duyệt không hỗ trợ chế độ toàn màn hình tại khung này');
    }
  }, []);

  const handleCopyDeepLink = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const url = new URL('/ktx-3d', window.location.origin);
    if (viewLevel === 'room' && activeRoom) {
      url.searchParams.set('ktx', activeRoom.ktx);
      url.searchParams.set('day', activeRoom.day);
      url.searchParams.set('room', activeRoom.roomRaw);
      if (selectedBed?.workerId) {
        url.searchParams.set('worker', selectedBed.workerId);
      } else if (selectedBed) {
        url.searchParams.set('bed', String(selectedBed.bedNumber));
      }
    } else if (focusedRoom) {
      url.searchParams.set('ktx', focusedRoom.ktx);
      url.searchParams.set('day', focusedRoom.day);
      url.searchParams.set('room', focusedRoom.roomRaw);
    } else if (selectedKtxFilter !== 'all') {
      url.searchParams.set('ktx', selectedKtxFilter);
    }

    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success('Đã sao chép đường dẫn 3D trực tiếp');
    } catch {
      toast.error('Không thể sao chép liên kết vào bộ nhớ tạm');
    }
  }, [viewLevel, activeRoom, selectedBed, focusedRoom, selectedKtxFilter]);

  const handleSaveBlueprint = useCallback(async () => {
    if (!isAdmin || savingBlueprint) return;
    setSavingBlueprint(true);
    try {
      const res = await saveCampusBlueprintConfig(blueprintConfig);
      if (res.savedRemote) {
        toast.success('Đã lưu cấu hình mặt bằng 3D và đồng bộ hệ thống');
      } else {
        toast.success('Đã lưu mặt bằng 3D trên trình duyệt này (chưa đồng bộ máy chủ)');
      }
    } catch {
      toast.error('Không thể lưu cấu hình mặt bằng 3D');
    } finally {
      setSavingBlueprint(false);
    }
  }, [isAdmin, savingBlueprint, blueprintConfig]);

  const handleResetBlueprintAuto = useCallback(async () => {
    if (!isAdmin) return;
    const resetCfg: CampusBlueprintConfig = {
      ...blueprintConfig,
      mode: 'vincons',
      buildings: [],
      landmarks: [],
    };
    setBlueprintConfig(resetCfg);
    await saveCampusBlueprintConfig(resetCfg);
    toast.success('Đã khôi phục bố cục sa bàn 3D theo bản vẽ Vincons');
  }, [isAdmin, blueprintConfig]);

  const actorLabel = currentUser?.name || currentUser?.email || 'Quản trị viên';

  const ensureBedDbRow = useCallback(
    async (slot: RoomBedSlot, room: CampusRoomNode): Promise<string | null> => {
      if (slot.bedDbId) return slot.bedDbId;
      const supabase = createClient();
      const targetKtx = normalizeKtxCompact(room.ktx);
      const targetDay = normalizeDayKey(room.day);
      const targetRoom = normalizeRoomLabel(room.roomRaw);
      const targetBed = String(slot.bedNumber);

      const { data: existing } = await supabase
        .from('beds')
        .select('id, ktx, day, phong_so, giuong')
        .ilike('phong_so', `%${targetRoom}%`);

      const matched = ((existing || []) as RawBedRow[]).find(
        row =>
          normalizeKtxCompact(row.ktx) === targetKtx &&
          normalizeDayKey(row.day) === targetDay &&
          normalizeRoomLabel(row.phong_so) === targetRoom &&
          normalizeBedLabel(row.giuong) === targetBed
      );
      if (matched?.id) return matched.id;

      const { data: inserted, error } = await supabase
        .from('beds')
        .insert({
          ktx: room.ktx,
          day: room.day,
          phong_so: room.roomRaw,
          giuong: targetBed,
          status: 'empty',
          worker_id: null,
          ma_nv: null,
          ho_va_ten: null,
        })
        .select('id')
        .single();

      if (error || !inserted?.id) return null;
      return String(inserted.id);
    },
    []
  );

  // ── Safe Operational Bed Actions (Strictly gated by editModeUnlocked && activeRoom.hasWriteAccess) ──
  const handleAssignWorkerToBed = useCallback(
    async (worker: Worker) => {
      if (!activeRoom || !selectedBed || !editModeUnlocked || !activeRoom.hasWriteAccess) {
        toast.error('Bạn cần mở khóa chế độ Vận hành và có quyền ghi tại dãy này');
        return;
      }
      setBedOpBusy(true);
      try {
        const supabase = createClient();
        const bedId = await ensureBedDbRow(selectedBed, activeRoom);
        if (!bedId) {
          toast.error('Không thể khởi tạo bản ghi giường trong cơ sở dữ liệu');
          return;
        }

        // Live occupancy guard: ensure bed wasn't taken by another device in the last second
        const { data: liveRow } = await supabase
          .from('beds')
          .select('id, status, worker_id, ho_va_ten')
          .eq('id', bedId)
          .single();
        if (liveRow && liveRow.status === 'occupied' && liveRow.worker_id && liveRow.worker_id !== worker.id) {
          toast.error(`Giường ${selectedBed.bedLabel} vừa được xếp cho ${liveRow.ho_va_ten || 'người khác'}`);
          roomBedsCacheRef.current.clear();
          setRefreshSeq(prev => prev + 1);
          return;
        }

        // Release any previous bed held by this worker
        await releaseBedsForWorkers(supabase, [worker.id]);

        const bedNumStr = String(selectedBed.bedNumber);
        const { error: wErr } = await supabase
          .from('workers')
          .update({
            ktx: activeRoom.ktx,
            day: activeRoom.day,
            phong_so: activeRoom.roomRaw,
            giuong: bedNumStr,
          })
          .eq('id', worker.id);

        if (wErr) throw new Error(wErr.message);

        const { error: bErr } = await supabase
          .from('beds')
          .update({
            status: 'occupied',
            worker_id: worker.id,
            ma_nv: worker.maNV || null,
            ho_va_ten: worker.hoVaTen || null,
          })
          .eq('id', bedId);

        if (bErr) throw new Error(bErr.message);

        addLog(
          actorLabel,
          'BED_REASSIGN',
          `[3D] Xếp ${worker.hoVaTen} (${worker.maNV || '—'}) vào ${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel} · ${selectedBed.bedLabel}`
        );

        roomBedsCacheRef.current.clear();
        await refreshWorkers();
        setRefreshSeq(prev => prev + 1);
        toast.success(`Đã xếp ${worker.hoVaTen} vào giường ${selectedBed.bedLabel}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi khi xếp giường');
      } finally {
        setBedOpBusy(false);
      }
    },
    [activeRoom, selectedBed, editModeUnlocked, ensureBedDbRow, addLog, actorLabel, refreshWorkers]
  );

  const handleSwapOrMoveBed = useCallback(
    async (targetBed: RoomBedSlot) => {
      if (!activeRoom || !selectedBed || !editModeUnlocked || !activeRoom.hasWriteAccess) {
        toast.error('Bạn cần mở khóa chế độ Vận hành và có quyền ghi tại dãy này');
        return;
      }
      if (!selectedBed.workerId) {
        toast.error('Giường hiện tại không có mã hồ sơ công nhân để di chuyển');
        return;
      }
      setBedOpBusy(true);
      try {
        const supabase = createClient();
        const srcBedId = await ensureBedDbRow(selectedBed, activeRoom);
        const dstBedId = await ensureBedDbRow(targetBed, activeRoom);
        if (!srcBedId || !dstBedId) {
          toast.error('Không thể đồng bộ bản ghi giường để hoán đổi');
          return;
        }

        const srcWorkerId = selectedBed.workerId;
        const srcName = selectedBed.hoVaTen;
        const srcMaNv = selectedBed.maNV;
        const dstWorkerId = targetBed.workerId;
        const dstName = targetBed.hoVaTen;
        const dstMaNv = targetBed.maNV;

        // Move source worker to target bed
        const { error: w1Err } = await supabase
          .from('workers')
          .update({
            ktx: activeRoom.ktx,
            day: activeRoom.day,
            phong_so: activeRoom.roomRaw,
            giuong: String(targetBed.bedNumber),
          })
          .eq('id', srcWorkerId);
        if (w1Err) throw new Error(w1Err.message);

        if (dstWorkerId) {
          // Swap: move target worker to source bed
          const { error: w2Err } = await supabase
            .from('workers')
            .update({
              ktx: activeRoom.ktx,
              day: activeRoom.day,
              phong_so: activeRoom.roomRaw,
              giuong: String(selectedBed.bedNumber),
            })
            .eq('id', dstWorkerId);
          if (w2Err) throw new Error(w2Err.message);

          await supabase
            .from('beds')
            .update({
              status: 'occupied',
              worker_id: dstWorkerId,
              ma_nv: dstMaNv || null,
              ho_va_ten: dstName || null,
            })
            .eq('id', srcBedId);
        } else {
          // Move to empty bed: clear source bed
          await supabase
            .from('beds')
            .update({
              status: 'empty',
              worker_id: null,
              ma_nv: null,
              ho_va_ten: null,
            })
            .eq('id', srcBedId);
        }

        await supabase
          .from('beds')
          .update({
            status: 'occupied',
            worker_id: srcWorkerId,
            ma_nv: srcMaNv || null,
            ho_va_ten: srcName || null,
          })
          .eq('id', dstBedId);

        addLog(
          actorLabel,
          'BED_REASSIGN',
          dstWorkerId
            ? `[3D] Đổi giường ${selectedBed.bedLabel} (${srcName}) ↔ ${targetBed.bedLabel} (${dstName}) tại ${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel}`
            : `[3D] Chuyển ${srcName} từ ${selectedBed.bedLabel} sang ${targetBed.bedLabel} tại ${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel}`
        );

        roomBedsCacheRef.current.clear();
        pendingFocusBedNumRef.current = targetBed.bedNumber;
        await refreshWorkers();
        setRefreshSeq(prev => prev + 1);
        toast.success(
          dstWorkerId
            ? `Đã hoán đổi ${selectedBed.bedLabel} ↔ ${targetBed.bedLabel}`
            : `Đã chuyển ${srcName} sang ${targetBed.bedLabel}`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi khi chuyển / đổi giường');
      } finally {
        setBedOpBusy(false);
      }
    },
    [activeRoom, selectedBed, editModeUnlocked, ensureBedDbRow, addLog, actorLabel, refreshWorkers]
  );

  const handleToggleBedMaintenance = useCallback(
    async (nextStatus: 'maintenance' | 'empty') => {
      if (!activeRoom || !selectedBed || !editModeUnlocked || !activeRoom.hasWriteAccess) {
        toast.error('Bạn cần mở khóa chế độ Vận hành và có quyền ghi tại dãy này');
        return;
      }
      setBedOpBusy(true);
      try {
        const supabase = createClient();
        const bedId = await ensureBedDbRow(selectedBed, activeRoom);
        if (!bedId) {
          toast.error('Không thể cập nhật trạng thái giường');
          return;
        }
        const { error } = await supabase
          .from('beds')
          .update({
            status: nextStatus,
            worker_id: null,
            ma_nv: null,
            ho_va_ten: null,
          })
          .eq('id', bedId);
        if (error) throw new Error(error.message);

        addLog(
          actorLabel,
          'Sửa',
          `[3D] Chuyển ${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel} · ${selectedBed.bedLabel} sang trạng thái ${
            nextStatus === 'maintenance' ? 'Bảo trì / Sửa chữa' : 'Giường trống'
          }`
        );

        roomBedsCacheRef.current.clear();
        setRefreshSeq(prev => prev + 1);
        toast.success(
          nextStatus === 'maintenance'
            ? `Đã đánh dấu ${selectedBed.bedLabel} đang bảo trì`
            : `Đã mở lại ${selectedBed.bedLabel} thành giường trống`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật bảo trì');
      } finally {
        setBedOpBusy(false);
      }
    },
    [activeRoom, selectedBed, editModeUnlocked, ensureBedDbRow, addLog, actorLabel]
  );

  const handleReleaseBed = useCallback(async () => {
    if (!activeRoom || !selectedBed || !editModeUnlocked || !activeRoom.hasWriteAccess) {
      toast.error('Bạn cần mở khóa chế độ Vận hành và có quyền ghi tại dãy này');
      return;
    }
    setBedOpBusy(true);
    try {
      const supabase = createClient();
      const workerName = selectedBed.hoVaTen || 'công nhân';
      if (selectedBed.workerId) {
        await supabase
          .from('workers')
          .update({ giuong: '' })
          .eq('id', selectedBed.workerId);
        await releaseBedsForWorkers(supabase, [selectedBed.workerId]);
      }
      if (selectedBed.bedDbId) {
        await supabase
          .from('beds')
          .update({
            status: 'empty',
            worker_id: null,
            ma_nv: null,
            ho_va_ten: null,
          })
          .eq('id', selectedBed.bedDbId);
      }

      addLog(
        actorLabel,
        'BED_REASSIGN',
        `[3D] Trả giường ${selectedBed.bedLabel} (${workerName}) tại ${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel}`
      );

      roomBedsCacheRef.current.clear();
      await refreshWorkers();
      setRefreshSeq(prev => prev + 1);
      toast.success(`Đã trả giường ${selectedBed.bedLabel}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi khi trả giường');
    } finally {
      setBedOpBusy(false);
    }
  }, [activeRoom, selectedBed, editModeUnlocked, addLog, actorLabel, refreshWorkers]);

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

  // Aggregate summary stats + Operational Alert lists
  const campusTotals = useMemo(() => {
    const rooms = visibleKtxNodes.reduce((s, n) => s + n.totalRooms, 0);
    const functionalCount = visibleKtxNodes.reduce(
      (s, n) =>
        s +
        n.functionalAreas.length +
        n.buildings.reduce((bs, b) => bs + b.functionalAreas.length, 0),
      0
    );
    const occupied = visibleKtxNodes.reduce((s, n) => s + n.totalOccupied, 0);
    const capacity = visibleKtxNodes.reduce((s, n) => s + n.totalCapacity, 0);
    const vacant = Math.max(0, capacity - occupied);
    const overloaded = visibleRoomsFlat.filter(r => r.occupied > r.capacity).length;
    const unregisteredTamTru = visibleRoomsFlat.reduce((s, r) => s + r.unregisteredTamTruCount, 0);
    const xrayMatchedRooms = unitXRayFilter
      ? visibleRoomsFlat.filter(r => getRoomUnitMatchCount(r, unitXRayFilter) > 0).length
      : 0;
    return {
      rooms,
      functionalCount,
      occupied,
      capacity,
      vacant,
      overloaded,
      unregisteredTamTru,
      xrayMatchedRooms,
    };
  }, [visibleKtxNodes, visibleRoomsFlat, unitXRayFilter]);

  const alertLists = useMemo(() => {
    const scopeRooms = assignedOnlyFilter
      ? visibleRoomsFlat.filter(r => r.hasWriteAccess)
      : visibleRoomsFlat;
    return {
      overloaded: scopeRooms.filter(r => r.occupied > r.capacity),
      mixed_gender: scopeRooms.filter(r => r.genderInfo.gender === 'mixed'),
      unregistered_tam_tru: scopeRooms.filter(r => r.unregisteredTamTruCount > 0),
      unassigned_bed: scopeRooms.filter(r => r.unassignedBedCount > 0),
    };
  }, [visibleRoomsFlat, assignedOnlyFilter]);

  const handleCycleAlert = useCallback(
    (category: AlertCategory) => {
      const list = alertLists[category];
      if (!list || list.length === 0) return;
      const nextIdx =
        activeAlertCursor && activeAlertCursor.category === category
          ? (activeAlertCursor.index + 1) % list.length
          : 0;
      const targetRoom = list[nextIdx];
      setActiveAlertCursor({ category, index: nextIdx });

      if (category === 'unregistered_tam_tru') {
        setColorMode('tam_tru');
        setUnitXRayFilter(null);
      } else if (category === 'overloaded') {
        setColorMode('overloaded_only');
        setUnitXRayFilter(null);
      } else if (category === 'mixed_gender') {
        setColorMode('gender');
        setUnitXRayFilter(null);
      }

      setFocusedRoomKey(targetRoom.key);
      window.setTimeout(() => {
        setFocusRoomReq(prev => ({ roomKey: targetRoom.key, seq: (prev?.seq || 0) + 1 }));
      }, 40);
    },
    [alertLists, activeAlertCursor]
  );

  const handleSelectBuildingSignboard = useCallback((building: CampusBuildingNode) => {
    setFocusedRoomKey(null);
    setFocusBuildingReq(prev => ({ buildingKey: building.key, seq: (prev?.seq || 0) + 1 }));
  }, []);

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
      ref={containerRef}
      className={`relative w-full ${
        isFullscreen ? 'h-screen' : 'h-[calc(100vh-3.5rem)] lg:h-screen'
      } overflow-hidden ${isLight ? 'bg-[#dbe7f5]' : 'bg-[#0b1220]'}`}
    >
      {/* ── Dedicated Isolated 3D WebGL Viewport (100% Unobstructed Center) ── */}
      {isLoading ? (
        <div
          className={`w-full h-full flex flex-col items-center justify-center gap-3 ${
            isLight ? 'text-slate-700' : 'text-slate-300'
          }`}
        >
          <Loader2 size={28} className="animate-spin text-blue-500" />
          <p className="text-sm font-semibold">Đang tải dữ liệu Ký Túc Xá cho bản đồ 3D...</p>
          <p className={`text-xs ${hudMuted}`}>Đồng bộ trực tiếp với Cơ sở vật chất & Danh sách công nhân</p>
        </div>
      ) : allKtxNodes.length === 0 && blueprintConfig.mode !== 'vincons' ? (
        <div
          className={`w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center ${
            isLight ? 'text-slate-700' : 'text-slate-300'
          }`}
        >
          <Box size={32} className="text-slate-500" />
          <p className="text-sm font-semibold">Chưa có dữ liệu phòng để dựng bản đồ 3D</p>
          <p className={`text-xs max-w-md ${hudMuted}`}>
            Hệ thống cần ít nhất một Khu KTX / phòng ở trong Cơ sở vật chất hoặc danh sách Công nhân để dựng sa bàn.
          </p>
        </div>
      ) : (
        <Ktx3DViewport
          ref={viewportRef}
          viewLevel={viewLevel}
          sceneTheme={sceneTheme}
          campusScopeKey={`${selectedKtxFilter}|${blueprintConfig.mode}`}
          navMode={navMode}
          blueprintConfig={blueprintConfig}
          ktxNodes={visibleKtxNodes}
          colorMode={colorMode}
          unitXRayFilter={unitXRayFilter}
          assignedOnlyFilter={assignedOnlyFilter}
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
          focusBuildingRequest={focusBuildingReq}
          focusBedRequest={focusBedReq}
          zoomRequest={zoomReq}
          onSelectRoom={handleEnterRoom}
          onSelectBuilding={handleSelectBuildingSignboard}
          onSelectBed={setSelectedBed}
          onHoverChange={setHoverInfo}
          onCompassHeadingChange={setCompassHeading}
          onPerfStats={setPerfStats}
        />
      )}

      {/* ── Top Bar Overlay (Top-Left Breadcrumb + Operational Controls + Popovers) ── */}
      <div className="pointer-events-none fixed lg:absolute top-3.5 left-3.5 right-3.5 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-col gap-2 max-w-[min(94vw,760px)]">
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
                    ? 'Bản Đồ 3D Toàn Khu KTX'
                    : activeRoom
                      ? `${activeRoom.ktx} · ${activeRoom.day} · ${activeRoom.roomLabel}`
                      : 'Chi Tiết Phòng 3D'}
                </h1>

                {viewLevel === 'room' && activeRoom?.hasWriteAccess ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditModeUnlocked(prev => {
                        const next = !prev;
                        toast.info(
                          next
                            ? 'Đã mở khóa Vận hành giường 3D cho phòng này'
                            : 'Đã khóa về chế độ Chỉ xem an toàn'
                        );
                        return next;
                      });
                    }}
                    title={
                      editModeUnlocked
                        ? 'Đang bật chế độ Vận hành · Bấm để khóa về Chỉ xem'
                        : 'Đang khóa Chỉ xem · Bấm để mở khóa thao tác giường trực tiếp'
                    }
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold transition-colors ${
                      editModeUnlocked
                        ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-500'
                        : 'bg-amber-500/15 border-amber-500/35 text-amber-500 hover:bg-amber-500/25'
                    }`}
                  >
                    {editModeUnlocked ? <Unlock size={10} /> : <Lock size={10} />}
                    <span>{editModeUnlocked ? 'Vận hành' : 'Chỉ xem'}</span>
                  </button>
                ) : viewLevel === 'room' ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-[10px] font-bold text-amber-500">
                    <Eye size={10} />
                    Chỉ xem
                  </span>
                ) : null}
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
                    {colorMode === 'tam_tru'
                      ? ` · Thiếu tạm trú ${campusTotals.unregisteredTamTru.toLocaleString('vi-VN')} người`
                      : ''}
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

            {/* Quick Action Icons */}
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

              {viewLevel === 'campus' && isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setBlueprintEditorOpen(prev => !prev);
                    setSearchOpen(false);
                  }}
                  title="Chỉnh vị trí dãy nhà & công trình phụ theo bản vẽ (Quản trị)"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                    blueprintEditorOpen ? 'bg-blue-600 border-blue-500 text-white' : hudSubtleBtn
                  }`}
                >
                  <SlidersHorizontal size={13} />
                  <span className="hidden md:inline">Mặt bằng</span>
                </button>
              )}

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
                onClick={handleCopyDeepLink}
                title="Sao chép đường dẫn 3D hiện tại để chia sẻ nhanh"
                className={`p-1.5 rounded-xl border transition-colors ${hudSubtleBtn}`}
                aria-label="Sao chép đường dẫn 3D"
              >
                <Link2 size={14} />
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

              <button
                type="button"
                onClick={handleToggleFullscreen}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình (Trình chiếu phòng trực ban)'}
                className={`hidden sm:inline-flex p-1.5 rounded-xl border transition-colors ${hudSubtleBtn}`}
                aria-label="Toàn màn hình"
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>

          {/* ── Compact Operational Alert Bar (Campus view only, when anomalies exist) ── */}
          {viewLevel === 'campus' &&
            (alertLists.overloaded.length > 0 ||
              alertLists.mixed_gender.length > 0 ||
              alertLists.unregistered_tam_tru.length > 0 ||
              alertLists.unassigned_bed.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {alertLists.overloaded.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCycleAlert('overloaded')}
                    title="Bấm liên tiếp để bay camera đến từng phòng quá tải"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold font-tabular transition-colors ${
                      activeAlertCursor?.category === 'overloaded'
                        ? 'bg-rose-600 border-rose-500 text-white'
                        : isLight
                          ? 'bg-rose-50/95 border-rose-300 text-rose-700 hover:bg-rose-100'
                          : 'bg-rose-950/90 border-rose-500/45 text-rose-300 hover:bg-rose-900/80'
                    }`}
                  >
                    <AlertTriangle size={11} />
                    <span>Quá tải: {alertLists.overloaded.length}P</span>
                  </button>
                )}

                {alertLists.mixed_gender.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCycleAlert('mixed_gender')}
                    title="Bấm liên tiếp để bay camera đến từng phòng có Nam/Nữ ở lẫn"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold font-tabular transition-colors ${
                      activeAlertCursor?.category === 'mixed_gender'
                        ? 'bg-amber-600 border-amber-500 text-white'
                        : isLight
                          ? 'bg-amber-50/95 border-amber-300 text-amber-800 hover:bg-amber-100'
                          : 'bg-amber-950/90 border-amber-500/45 text-amber-300 hover:bg-amber-900/80'
                    }`}
                  >
                    <AlertTriangle size={11} />
                    <span>Nam/Nữ lẫn: {alertLists.mixed_gender.length}P</span>
                  </button>
                )}

                {alertLists.unregistered_tam_tru.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCycleAlert('unregistered_tam_tru')}
                    title="Bấm liên tiếp để bay camera đến từng phòng có người chưa đăng ký tạm trú"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold font-tabular transition-colors ${
                      activeAlertCursor?.category === 'unregistered_tam_tru'
                        ? 'bg-orange-600 border-orange-500 text-white'
                        : isLight
                          ? 'bg-orange-50/95 border-orange-300 text-orange-800 hover:bg-orange-100'
                          : 'bg-orange-950/90 border-orange-500/45 text-orange-300 hover:bg-orange-900/80'
                    }`}
                  >
                    <ShieldCheck size={11} />
                    <span>Thiếu tạm trú: {alertLists.unregistered_tam_tru.length}P</span>
                  </button>
                )}

                {alertLists.unassigned_bed.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCycleAlert('unassigned_bed')}
                    title="Bấm liên tiếp để bay camera đến từng phòng có người chưa gắn mã giường"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold font-tabular transition-colors ${
                      activeAlertCursor?.category === 'unassigned_bed'
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : isLight
                          ? 'bg-sky-50/95 border-sky-300 text-sky-800 hover:bg-sky-100'
                          : 'bg-sky-950/90 border-sky-500/45 text-sky-300 hover:bg-sky-900/80'
                    }`}
                  >
                    <BedDouble size={11} />
                    <span>Chưa xếp giường: {alertLists.unassigned_bed.length}P</span>
                  </button>
                )}
              </div>
            )}

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

        {/* ── Admin Visual Blueprint Editor (Top-Right, Campus view only) ── */}
        {viewLevel === 'campus' && isAdmin && blueprintEditorOpen && (
          <BlueprintEditorPanel
            config={blueprintConfig}
            allKtxNodes={allKtxNodes}
            isLight={isLight}
            saving={savingBlueprint}
            getBuiltBuildingPositions={() => viewportRef.current?.getBuiltBuildingPositions() || {}}
            onChange={setBlueprintConfig}
            onSave={handleSaveBlueprint}
            onResetAuto={handleResetBlueprintAuto}
            onClose={() => setBlueprintEditorOpen(false)}
            onFocusBuilding={buildingKey =>
              setFocusBuildingReq(prev => ({ buildingKey, seq: (prev?.seq || 0) + 1 }))
            }
          />
        )}

        {/* ── Selected Bed Inspector Card (Top-Right, ONLY when a bed is clicked) ── */}
        {viewLevel === 'room' && selectedBed && (
          <div className={`pointer-events-auto w-72 sm:w-80 rounded-2xl border p-4 max-h-[82vh] overflow-y-auto scrollbar-thin ${hudCard}`}>
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
                {selectedBed.status === 'maintenance'
                  ? 'Giường đang ở trạng thái bảo trì / sửa chữa.'
                  : editModeUnlocked
                    ? 'Giường đang trống. Chọn công nhân bên dưới để xếp trực tiếp vào giường này.'
                    : 'Giường đang trống. Mở khóa chế độ Vận hành ở thanh trên để xếp giường trực tiếp.'}
              </p>
            )}

            {/* Safe Operational Bed Controls (When unlocked + user has write access) */}
            {activeRoom?.hasWriteAccess && editModeUnlocked ? (
              <div className={`pt-2.5 pb-2.5 border-t ${hudDivider}`}>
                <BedOperationsPanel
                  activeRoom={activeRoom}
                  selectedBed={selectedBed}
                  allRoomBeds={activeRoomBeds}
                  allWorkers={workers || []}
                  isLight={isLight}
                  busy={bedOpBusy}
                  onAssignWorker={handleAssignWorkerToBed}
                  onSwapOrMoveBed={handleSwapOrMoveBed}
                  onToggleMaintenance={handleToggleBedMaintenance}
                  onReleaseBed={handleReleaseBed}
                />
              </div>
            ) : activeRoom?.hasWriteAccess ? (
              <div className={`pt-2 pb-2.5 border-t ${hudDivider}`}>
                <button
                  type="button"
                  onClick={() => {
                    setEditModeUnlocked(true);
                    toast.info('Đã mở khóa Vận hành giường 3D cho phòng này');
                  }}
                  className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors ${hudSubtleBtn}`}
                >
                  <Unlock size={12} className="text-emerald-500" />
                  <span>Mở khóa Vận hành (Xếp / Đổi giường)</span>
                </button>
              </div>
            ) : null}

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
              {colorMode === 'tam_tru' && hoverInfo.room.occupied > 0 && (
                <p
                  className={`text-[11px] font-semibold font-tabular ${
                    hoverInfo.room.unregisteredTamTruCount > 0 ? 'text-orange-500' : 'text-emerald-500'
                  }`}
                >
                  {hoverInfo.room.unregisteredTamTruCount > 0
                    ? `Chưa đăng ký tạm trú: ${hoverInfo.room.unregisteredTamTruCount}/${hoverInfo.room.occupied} người`
                    : 'Đã đăng ký tạm trú 100%'}
                </p>
              )}
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

          {hoverInfo.type === 'building' && hoverInfo.building && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold">
                  {hoverInfo.building.ktx} · {hoverInfo.building.day}
                </span>
                <span className="font-tabular font-bold text-sky-500">
                  {hoverInfo.building.totalOccupied}/{hoverInfo.building.totalCapacity}
                </span>
              </div>
              <p className={`text-[11px] font-tabular ${hudMuted}`}>
                {hoverInfo.building.rooms.length} phòng · Trống{' '}
                {Math.max(0, hoverInfo.building.totalCapacity - hoverInfo.building.totalOccupied)} chỗ
                {hoverInfo.building.unregisteredTamTruCount > 0
                  ? ` · Thiếu tạm trú ${hoverInfo.building.unregisteredTamTruCount}`
                  : ''}
              </p>
              <p className="text-[10px] text-blue-500 font-semibold">
                Bấm để căn khung camera vào dãy nhà này →
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
                    className={`flex items-center gap-0.5 rounded-xl border p-0.5 text-[11px] overflow-x-auto max-w-full ${
                      isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900/90 border-slate-800'
                    }`}
                  >
                    {(
                      [
                        { id: 'occupancy', label: 'Lấp đầy' },
                        { id: 'gender', label: 'Nam / Nữ' },
                        { id: 'tam_tru', label: 'Tạm trú' },
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
                        className={`px-2 py-1 rounded-lg font-semibold whitespace-nowrap transition-colors ${
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

                  {/* Free 360° Steering: Orbit/Pan Mode + Compass + Rotate ↺/↻ + Presets + Zoom */}
                  <div className="flex flex-wrap items-center gap-1">
                    {/* Left-Drag Mode Toggle: Free 360° Orbit vs Hand Pan */}
                    <div
                      className={`flex items-center gap-0.5 rounded-lg border p-0.5 text-[11px] ${
                        isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900/90 border-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setNavMode('orbit')}
                        title="Chuột trái: Xoay tự do 360° · Chuột phải: Kéo bản đồ"
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold transition-colors ${
                          navMode === 'orbit'
                            ? 'bg-blue-600 text-white'
                            : `${hudMuted} hover:text-blue-500`
                        }`}
                      >
                        <Orbit size={11} />
                        <span>Xoay 360°</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNavMode('pan')}
                        title="Chuột trái: Kéo trượt mặt bằng · Chuột phải: Xoay 360°"
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold transition-colors ${
                          navMode === 'pan'
                            ? 'bg-blue-600 text-white'
                            : `${hudMuted} hover:text-blue-500`
                        }`}
                      >
                        <Hand size={11} />
                        <span>Kéo</span>
                      </button>
                    </div>

                    {/* Live Compass Heading (Click to align North 0°) */}
                    <button
                      type="button"
                      onClick={() => viewportRef.current?.resetNorth()}
                      title="La bàn hướng nhìn — Bấm để xoay thẳng về hướng Bắc (0°)"
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-mono font-semibold font-tabular transition-colors ${hudSubtleBtn}`}
                    >
                      <Compass
                        size={12}
                        className="text-sky-500 transition-transform duration-150"
                        style={{ transform: `rotate(${-compassHeading}deg)` }}
                      />
                      <span>{compassHeading}°</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => viewportRef.current?.orbitStep(-45, 0)}
                      title="Xoay góc nhìn sang trái 45° (Phím Q)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Xoay trái 45 độ"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => viewportRef.current?.orbitStep(45, 0)}
                      title="Xoay góc nhìn sang phải 45° (Phím E)"
                      className={`p-1.5 rounded-lg border transition-colors ${hudSubtleBtn}`}
                      aria-label="Xoay phải 45 độ"
                    >
                      <RotateCw size={12} />
                    </button>

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
                      title="Đặt lại toàn cảnh mặc định (Phím 0)"
                      className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${hudSubtleBtn}`}
                    >
                      Reset
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
                    ) : colorMode === 'tam_tru' ? (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                          Đủ tạm trú
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                          Thiếu &lt;50%
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                          Thiếu ≥50%
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-500" />
                          Trống
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
                    {hasStaffAssignedBlocks && (
                      <button
                        type="button"
                        onClick={() => setAssignedOnlyFilter(prev => !prev)}
                        title="Làm nổi bật các dãy nhà bạn được phân công phụ trách"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-colors ${
                          assignedOnlyFilter
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : hudSubtleBtn
                        }`}
                      >
                        <ShieldCheck size={11} />
                        <span>Dãy phụ trách</span>
                      </button>
                    )}

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

                {/* Concise Free-Angle Controls Guide */}
                <div className={`hidden sm:flex items-center justify-between text-[10px] pt-0.5 ${hudMuted}`}>
                  <span>
                    {navMode === 'orbit'
                      ? 'Kéo trái: Xoay tự do 360° · Kéo phải / WASD: Di chuyển · Q/E: Xoay · R/F: Nghiêng · Nháy đúp mặt đất: Đổi tâm xoay · Cuộn: Zoom theo chuột'
                      : 'Kéo trái / WASD: Kéo trượt mặt bằng · Kéo phải / Q/E: Xoay tự do 360° · R/F: Nghiêng · Nháy đúp mặt đất: Đổi tâm xoay · Cuộn: Zoom theo chuột'}
                  </span>
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
