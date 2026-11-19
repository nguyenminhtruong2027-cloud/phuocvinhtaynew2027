'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  BedDouble, RefreshCw, Search, X, User, UserCheck, UserX,
  ArrowRightLeft, Loader2, Building2, Phone, Briefcase, VenusAndMars,
  AlertCircle, LayoutGrid, Table2, BarChart3, Wrench, DoorOpen, Calendar,
  ExternalLink, UserPlus, CheckCircle2, Printer, Lock, Download,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { compareKtxNames, DEFAULT_ROOM_CAPACITY } from '@/data/workers';
import { fetchRoomCapacities, getRoomCapacity, RoomCapacityMap, formatRoomDisplay, normalizeRoomLabel, invalidateFacilitiesCache } from '@/lib/facilityCapacity';
import { reconcileBedsWithWorkers, releaseBedsForWorkers, releaseBedByLocation, normalizeBedLabel } from '@/lib/bedSync';
import { preserveDeletedWorkerEntries } from '@/lib/workerFluctuation';
import { invalidateWorkerHierarchyCache } from '@/lib/workerHierarchy';
import { invalidateKtxStructureCache } from '@/lib/ktxStructure';
import { exportToExcel } from '@/lib/exportExcel';
import BedQrPrintModal from './BedQrPrintModal';
import BedTransferModal from './BedTransferModal';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';

type BedStatus = 'empty' | 'occupied' | 'maintenance';
type ViewMode = 'grid' | 'table' | 'analytics';

interface BedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: BedStatus;
  ma_nv: string | null;
  ho_va_ten: string | null;
  worker_id: string | null;
}

interface WorkerLite {
  id: string;
  hoVaTen: string;
  maNV: string;
  cccd: string;
  donVi: string;
  gioiTinh: string;
  soDienThoai: string;
  ngayVaoKTX: string;
  ktx: string;
  day: string;
  phongSo: string;
  giuong: string;
}

const PAGE = 1000;

async function fetchAllRows<T extends { id?: unknown }>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  select: string
): Promise<T[]> {
  const byId = new Map<string, T>();
  const noId: T[] = [];
  let from = 0;
  for (let page = 0; page < 30; page++) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn(`[bed-management] fetch ${table} error:`, error.message);
        break;
      }
      const list = (data ?? []) as unknown as T[];
      for (const row of list) {
        const rid = row?.id ? String(row.id) : '';
        if (rid) byId.set(rid, row);
        else noId.push(row);
      }
      if (list.length < PAGE) break;
      from += PAGE;
    } catch (err) {
      console.warn(`[bed-management] fetch ${table} failed (offline?):`, err);
      break;
    }
  }
  return [...Array.from(byId.values()), ...noId];
}

function shortName(full?: string | null): string {
  const s = (full || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  return parts[parts.length - 1] || s;
}

function normNfcLower(v?: string | null): string {
  return String(v || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normDayValue(v?: string | null): string {
  return normNfcLower(v).replace(/^(?:dãy|day|d[.\s]*)\s*/i, '');
}

export default function BedManagementClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, canWriteBlock, currentUser } = useAuth();
  const { addLog } = useAudit();
  const {
    workers: contextWorkers,
    setWorkers: setContextWorkers,
    markWorkersDeleted: markContextWorkersDeleted,
    refreshWorkers,
  } = useWorkers();
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [hoveredBedId, setHoveredBedId] = useState<string | null>(null);
  const workers = useMemo<WorkerLite[]>(
    () =>
      (contextWorkers || []).map(w => ({
        id: w.id,
        hoVaTen: w.hoVaTen || '',
        maNV: w.maNV || '',
        cccd: w.cccd || '',
        donVi: w.donVi || '',
        gioiTinh: w.gioiTinh || '',
        soDienThoai: w.soDienThoai || '',
        ngayVaoKTX: w.ngayVaoKTX || '',
        ktx: w.ktx || '',
        day: w.day || '',
        phongSo: w.phongSo || '',
        giuong: w.giuong || '',
      })),
    [contextWorkers]
  );
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState('');

  const initialView = ((): ViewMode => {
    const v = searchParams?.get('view');
    return v === 'table' || v === 'analytics' || v === 'grid' ? v : 'grid';
  })();
  const initialStatus = ((): 'all' | BedStatus => {
    const s = searchParams?.get('status');
    return s === 'occupied' || s === 'empty' || s === 'maintenance' ? s : 'all';
  })();

  const [view, setView] = useState<ViewMode>(initialView);
  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('q') || '');

  const [filterKtx, setFilterKtx] = useState(() => searchParams?.get('ktx') || '');
  const [filterDay, setFilterDay] = useState(() => searchParams?.get('day') || '');
  const [filterRoom, setFilterRoom] = useState(() => searchParams?.get('room') || '');
  const [filterStatus, setFilterStatus] = useState<'all' | BedStatus>(initialStatus);

  // Sync active filters back into URL cleanly without re-navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (view !== 'grid') params.set('view', view);
    if (filterKtx) params.set('ktx', filterKtx);
    if (filterDay) params.set('day', filterDay);
    if (filterRoom) params.set('room', filterRoom);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [view, filterKtx, filterDay, filterRoom, filterStatus, searchQuery]);

  const [assignTarget, setAssignTarget] = useState<BedRow | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [drawerBed, setDrawerBed] = useState<BedRow | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [swapSourceBed, setSwapSourceBed] = useState<BedRow | null>(null);
  const [swapSearch, setSwapSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncingBeds, setSyncingBeds] = useState(false);
  const [showQrPrint, setShowQrPrint] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  // ─── Data loading ──────────────────────────────────────────────────────────
  const loadBeds = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await fetchAllRows<Record<string, unknown>>(supabase, 'beds', '*');
      const mapped: BedRow[] = (rows || [])
        .filter(r => {
          const ktx = String(r?.ktx ?? '').trim().toLowerCase();
          const day = String(r?.day ?? '').trim();
          const room = String(r?.phong_so ?? '').trim();
          const bedNo = String(r?.giuong ?? '').trim();
          if (!ktx || !day || !room || !bedNo) return false;
          if (
            ktx.includes('tổng') ||
            ktx.includes('tong') ||
            ktx.includes('cơ sở vật chất') ||
            ktx.includes('chưa phân') ||
            ['ktx 5', 'ktx 12', 'ktx 999'].includes(ktx) ||
            room === 'ở' ||
            room === 'chức năng' ||
            /^\d+\s*phòng$/i.test(room)
          ) {
            return false;
          }
          return true;
        })
        .map((r, i) => ({
          id: String(r?.id ?? `bed-${i}`),
          ktx: String(r?.ktx ?? ''),
          day: String(r?.day ?? ''),
          phong_so: String(r?.phong_so ?? '').replace(/^(?:phòng|p[.\s]*)\s*/i, '').trim(),
          giuong: String(r?.giuong ?? ''),
          status: r?.status === 'occupied' ? 'occupied' : r?.status === 'maintenance' ? 'maintenance' : 'empty',
          ma_nv: r?.ma_nv ? String(r.ma_nv) : null,
          ho_va_ten: r?.ho_va_ten ? String(r.ho_va_ten) : null,
          worker_id: r?.worker_id ? String(r.worker_id) : null,
        }));
      setBeds(mapped);
      setActionError('');
    } catch (err) {
      console.warn('[bed-management] load beds failed:', err);
      setActionError('Không tải được danh sách giường — kiểm tra kết nối Supabase.');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, [supabase]);

  const loadWorkers = useCallback(async () => {
    await refreshWorkers();
  }, [refreshWorkers]);

  const loadCapacities = useCallback(async () => {
    try {
      setCapacities(await fetchRoomCapacities());
    } catch (err) {
      console.warn('[bed-management] load capacities failed:', err);
    }
  }, []);

  useEffect(() => {
    loadBeds();
    loadCapacities();
  }, [loadBeds, loadCapacities]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let facTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      channel = supabase
        .channel('bed_management_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new) {
            const r = payload.new as Record<string, unknown>;
            const rid = String(r?.id ?? '');
            if (!rid) return;
            const mappedRow: BedRow = {
              id: rid,
              ktx: String(r?.ktx ?? ''),
              day: String(r?.day ?? ''),
              phong_so: String(r?.phong_so ?? '').replace(/^(?:phòng|p[.\s]*)\s*/i, '').trim(),
              giuong: String(r?.giuong ?? ''),
              status: r?.status === 'occupied' ? 'occupied' : r?.status === 'maintenance' ? 'maintenance' : 'empty',
              ma_nv: r?.ma_nv ? String(r.ma_nv) : null,
              ho_va_ten: r?.ho_va_ten ? String(r.ho_va_ten) : null,
              worker_id: r?.worker_id ? String(r.worker_id) : null,
            };
            setBeds(prev => prev.map(b => (b.id === rid ? mappedRow : b)));
            setDrawerBed(prev => (prev && prev.id === rid ? mappedRow : prev));
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const rid = String((payload.old as Record<string, unknown>)?.id ?? '');
            if (rid) setBeds(prev => prev.filter(b => b.id !== rid));
          } else {
            if (facTimer) clearTimeout(facTimer);
            facTimer = setTimeout(() => loadBeds(true), 400);
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, () => {
          if (facTimer) clearTimeout(facTimer);
          facTimer = setTimeout(() => loadCapacities(), 350);
        })
        .subscribe();
    } catch (err) {
      console.warn('[bed-management] realtime subscribe failed:', err);
    }
    return () => {
      if (facTimer) clearTimeout(facTimer);
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
  }, [supabase, loadBeds, loadCapacities]);

  // ─── Derived data (null-safe) ──────────────────────────────────────────────
  const workerById = useMemo(() => {
    const map = new Map<string, WorkerLite>();
    (workers || []).forEach(w => { if (w?.id) map.set(w.id, w); });
    return map;
  }, [workers]);

  const workerBySlot = useMemo(() => {
    const map = new Map<string, WorkerLite>();
    (workers || []).forEach(w => {
      const k = (w.ktx || '').trim();
      const d = (w.day || '').trim();
      const r = normalizeRoomLabel(w.phongSo || '');
      const g = normalizeBedLabel(w.giuong || '');
      if (k && d && r && g) {
        const key = `${k}||${d}||${r}||${g}`;
        if (!map.has(key)) map.set(key, w);
      }
    });
    return map;
  }, [workers]);

  const getWorkerForBed = useCallback(
    (bed?: BedRow | null): WorkerLite | null => {
      if (!bed) return null;
      if (bed.worker_id) {
        const byId = workerById.get(bed.worker_id);
        if (byId) return byId;
      }
      const key = `${(bed.ktx || '').trim()}||${(bed.day || '').trim()}||${normalizeRoomLabel(bed.phong_so || '')}||${normalizeBedLabel(bed.giuong || '')}`;
      const bySlot = workerBySlot.get(key);
      if (bySlot) return bySlot;
      if (bed.ho_va_ten) {
        const normName = bed.ho_va_ten.trim().toLowerCase().replace(/\s+/g, ' ');
        const normRoom = normalizeRoomLabel(bed.phong_so || '');
        const match = (workers || []).find(
          w =>
            (w.ktx || '').trim() === (bed.ktx || '').trim() &&
            normalizeRoomLabel(w.phongSo || '') === normRoom &&
            (w.hoVaTen || '').trim().toLowerCase().replace(/\s+/g, ' ') === normName
        );
        if (match) return match;
      }
      return null;
    },
    [workerById, workerBySlot, workers]
  );

  const roomCap = useCallback(
    (ktx: string, day: string, phong: string) =>
      getRoomCapacity(capacities, ktx, day, phong) || DEFAULT_ROOM_CAPACITY,
    [capacities]
  );

  const bedsFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (beds || []).filter(b => {
      // Only real KTX/Dãy/Phòng/Giường rows — no placeholder placeholders ever.
      const ktx = String(b?.ktx ?? '').trim();
      const day = String(b?.day ?? '').trim();
      const room = String(b?.phong_so ?? '').trim();
      const bedNo = String(b?.giuong ?? '').trim();
      if (!ktx || !day || !room || !bedNo) return false;
      if (filterKtx && ktx !== filterKtx.trim()) return false;
      if (filterDay && day !== filterDay.trim()) return false;
      if (filterRoom && room !== filterRoom.trim()) return false;
      if (filterStatus !== 'all' && b?.status !== filterStatus) return false;
      if (!q) return true;
      const w = b?.worker_id ? workerById.get(b.worker_id) : null;
      const haystack = [
        b?.ktx, b?.day, b?.phong_so, b?.giuong, b?.ho_va_ten, b?.ma_nv,
        w?.donVi, w?.soDienThoai,
      ].map(v => String(v ?? '').toLowerCase());
      return haystack.some(v => v.includes(q)) || `g${bedNo.toLowerCase().replace(/[^0-9a-z]/g, '')}`.includes(q);
    });
  }, [beds, filterKtx, filterDay, filterRoom, filterStatus, searchQuery, workerById]);

  const ktxList = useMemo(
    () =>
      [...new Set((beds || []).map(b => String(b?.ktx ?? '').trim()).filter(Boolean))]
        .filter(k => {
          const l = k.toLowerCase();
          return (
            !l.includes('tổng') &&
            !l.includes('tong') &&
            !l.includes('cơ sở vật chất') &&
            !l.includes('chưa phân') &&
            !['ktx 5', 'ktx 12', 'ktx 999'].includes(l)
          );
        })
        .sort(compareKtxNames),
    [beds]
  );

  const dayList = useMemo(
    () =>
      [...new Set(
        bedsFiltered
          .filter(b => String(b?.ktx ?? '').trim() === (filterKtx || '').trim())
          .map(b => String(b?.day ?? '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
    [bedsFiltered, filterKtx]
  );

  const roomList = useMemo(
    () =>
      [...new Set(
        bedsFiltered
          .filter(b => String(b?.ktx ?? '').trim() === (filterKtx || '').trim() && String(b?.day ?? '').trim() === (filterDay || '').trim())
          .map(b => String(b?.phong_so ?? '').trim())
          .filter(Boolean)
      )].sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b, 'vi', { numeric: true });
      }),
    [bedsFiltered, filterKtx, filterDay]
  );

  interface RoomGroup {
    ktx: string;
    day: string;
    room: string;
    beds: BedRow[];
    cap: number;
    occupied: number;
    maleCount: number;
    femaleCount: number;
    maintenance: number;
    empty: number;
    overloaded: boolean;
  }

  const roomGroups = useMemo((): RoomGroup[] => {
    const map = new Map<string, RoomGroup>();
    bedsFiltered.forEach(b => {
      const ktx = String(b?.ktx ?? '').trim();
      const day = String(b?.day ?? '').trim();
      const room = String(b?.phong_so ?? '').trim();
      // Chỉ dữ liệu thật: bỏ hẳn các mục rác (Chưa phân …) khỏi ma trận.
      if (!ktx || !day || !room) return;
      const key = `${ktx}||${day}||${room}`;
      if (!map.has(key)) {
        map.set(key, {
          ktx, day, room,
          beds: [],
          cap: roomCap(ktx, day, room),
          occupied: 0,
          maleCount: 0,
          femaleCount: 0,
          maintenance: 0,
          empty: 0,
          overloaded: false,
        });
      }
      const g = map.get(key)!;
      g.beds.push(b);
      if (b?.status === 'occupied') {
        g.occupied++;
        const w = getWorkerForBed(b);
        const gender = (w?.gioiTinh || '').trim().toLowerCase();
        if (gender === 'nữ' || gender === 'nu' || gender === 'female' || gender.includes('nữ')) {
          g.femaleCount++;
        } else {
          g.maleCount++;
        }
      } else if (b?.status === 'maintenance') {
        g.maintenance++;
      } else {
        g.empty++;
      }
    });
    const list = [...map.values()];
    list.forEach(g => {
      g.beds.sort((a, b) => {
        const na = parseInt(String(a?.giuong ?? '9999').replace(/\D/g, ''), 10) || 9999;
        const nb = parseInt(String(b?.giuong ?? '9999').replace(/\D/g, ''), 10) || 9999;
        return na - nb;
      });
      g.overloaded = g.occupied > g.cap;
    });
    list.sort((a, b) => {
      const k = compareKtxNames(a.ktx, b.ktx);
      if (k !== 0) return k;
      const d = a.day.localeCompare(b.day, 'vi', { numeric: true });
      if (d !== 0) return d;
      return a.room.localeCompare(b.room, 'vi', { numeric: true });
    });
    return list;
  }, [bedsFiltered, roomCap, getWorkerForBed]);

  const occupiedCount = useMemo(() => bedsFiltered.filter(b => b?.status === 'occupied').length, [bedsFiltered]);
  const emptyCount = useMemo(() => bedsFiltered.filter(b => b?.status === 'empty').length, [bedsFiltered]);
  const maintenanceCount = useMemo(() => bedsFiltered.filter(b => b?.status === 'maintenance').length, [bedsFiltered]);
  const totalCapInView = useMemo(
    () => (bedsFiltered.length > 0 ? Math.max(bedsFiltered.length, 1) : 0),
    [bedsFiltered]
  );
  const fillRateInView = totalCapInView > 0 ? Math.round((occupiedCount / totalCapInView) * 100) : 0;
  const overloadedRooms = useMemo(() => roomGroups.filter(g => g.overloaded), [roomGroups]);

  const perKtxStats = useMemo(() => {
    const map = new Map<string, { occupied: number; empty: number; maintenance: number; total: number }>();
    bedsFiltered.forEach(b => {
      const ktx = String(b?.ktx ?? '').trim();
      if (!ktx) return;
      if (!map.has(ktx)) map.set(ktx, { occupied: 0, empty: 0, maintenance: 0, total: 0 });
      const s = map.get(ktx)!;
      s.total++;
      if (b?.status === 'occupied') s.occupied++;
      else if (b?.status === 'maintenance') s.maintenance++;
      else s.empty++;
    });
    return [...map.entries()]
      .sort((a, b) => compareKtxNames(a[0], b[0]))
      .map(([ktx, s]) => ({ ktx, ...s }));
  }, [bedsFiltered]);

  const occupiedIds = useMemo(() => {
    const set = new Set<string>();
    (beds || []).forEach(b => { if (b?.worker_id) set.add(b.worker_id); });
    (workers || []).forEach(w => {
      if (w?.id && w?.ktx && w?.day && w?.phongSo && w?.giuong) set.add(w.id);
    });
    return set;
  }, [beds, workers]);

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const applyWorkerBed = useCallback(
    async (workerId: string, bed: { ktx: string; day: string; phong_so: string; giuong: string }) => {
      setBusy(true);
      setActionError('');
      try {
        const { error } = await supabase
          .from('workers')
          .update({ ktx: bed.ktx, day: bed.day, phong_so: bed.phong_so, giuong: bed.giuong })
          .eq('id', workerId);
        if (error) throw new Error(error.message);
        return true;
      } catch (err: any) {
        console.error('[bed-management] apply worker bed failed:', err);
        setActionError(err?.message || 'Không thể cập nhật giường — thử lại.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [supabase]
  );

  const canWriteBed = useCallback(
    (bed?: { day?: string; ktx?: string } | null) =>
      isAdmin || (bed ? canWriteBlock(bed.day || '', bed.ktx || '') : false),
    [isAdmin, canWriteBlock]
  );

  const handleAssign = useCallback(
    async (worker: WorkerLite) => {
      if (!assignTarget || !worker?.id) return;
      if (!canWriteBed(assignTarget)) {
        toast.error(`Bạn không có quyền gán giường tại ${assignTarget.ktx} - ${assignTarget.day}.`);
        return;
      }
      if (!isAdmin && worker.ktx && worker.day && worker.giuong && !canWriteBlock(worker.day, worker.ktx)) {
        toast.error(`Công nhân đang thuộc ${worker.ktx} · ${worker.day} ngoài phạm vi phụ trách của bạn.`);
        return;
      }

      // Live race guard: confirm bed is still empty in DB before writing
      setBusy(true);
      try {
        const { data: liveBed } = await supabase
          .from('beds')
          .select('status')
          .eq('id', assignTarget.id)
          .maybeSingle();
        if (liveBed && liveBed.status !== 'empty') {
          toast.error('Giường này vừa được người khác gán hoặc bảo trì! Đang cập nhật lại sơ đồ...');
          loadBeds(true);
          return;
        }
      } finally {
        setBusy(false);
      }

      const ok = await applyWorkerBed(worker.id, {
        ktx: assignTarget.ktx || '',
        day: assignTarget.day || '',
        phong_so: assignTarget.phong_so || '',
        giuong: assignTarget.giuong || '',
      });
      if (ok) {
        const targetId = assignTarget.id;
        // Optimistic UI update before background sync
        setBeds(prev =>
          prev.map(b => {
            if (b.id === targetId) {
              return {
                ...b,
                status: 'occupied',
                worker_id: worker.id,
                ma_nv: worker.maNV || null,
                ho_va_ten: worker.hoVaTen || null,
              };
            }
            if (b.worker_id === worker.id) {
              return { ...b, status: 'empty', worker_id: null, ma_nv: null, ho_va_ten: null };
            }
            return b;
          })
        );
        try {
          await releaseBedsForWorkers(supabase, [worker.id]);
          await supabase
            .from('beds')
            .update({
              status: 'occupied',
              worker_id: worker.id,
              ma_nv: worker.maNV || null,
              ho_va_ten: worker.hoVaTen || null,
            })
            .eq('id', targetId);
        } catch (err) {
          console.warn('[bed-management] direct bed occupy warning:', err);
        }
        const actor = currentUser?.name || currentUser?.email || 'Admin';
        addLog(
          actor,
          'BED_REASSIGN',
          `Gán giường: ${worker.hoVaTen} (${worker.maNV || '—'}) → ${assignTarget.ktx} · ${assignTarget.day} · P${assignTarget.phong_so} · G${assignTarget.giuong}`
        );
        toast.success(`Đã gán ${worker.hoVaTen} vào G${assignTarget.giuong} (Phòng ${assignTarget.phong_so})`);
        setAssignTarget(null);
        setCandidateSearch('');
        refreshWorkers();
      }
    },
    [assignTarget, canWriteBed, isAdmin, canWriteBlock, applyWorkerBed, supabase, currentUser, addLog, loadBeds, refreshWorkers]
  );

  // 1-Click Atomic Swap between two occupied beds (A <-> B)
  const handleSwapBeds = useCallback(
    async (targetBed: BedRow) => {
      const sourceBed = swapSourceBed;
      if (!sourceBed || !targetBed || sourceBed.id === targetBed.id) return;
      if (!sourceBed.worker_id || !targetBed.worker_id || sourceBed.worker_id === targetBed.worker_id) return;
      if (!canWriteBed(sourceBed) || !canWriteBed(targetBed)) {
        toast.error('Bạn không có quyền hoán đổi giường ngoài phạm vi phụ trách.');
        return;
      }

      setBusy(true);
      setActionError('');
      try {
        // Verify live DB state of both beds before swapping
        const { data: livePair, error: liveErr } = await supabase
          .from('beds')
          .select('id, status, worker_id')
          .in('id', [sourceBed.id, targetBed.id]);

        if (liveErr) throw new Error(liveErr.message);
        const liveA = (livePair || []).find(r => String(r.id) === sourceBed.id);
        const liveB = (livePair || []).find(r => String(r.id) === targetBed.id);
        if (!liveA || !liveB || liveA.status !== 'occupied' || liveB.status !== 'occupied' ||
            liveA.worker_id !== sourceBed.worker_id || liveB.worker_id !== targetBed.worker_id) {
          toast.error('Trạng thái một trong hai giường vừa thay đổi. Vui lòng kiểm tra lại!');
          loadBeds(true);
          return;
        }

        const workerAId = sourceBed.worker_id;
        const workerBId = targetBed.worker_id;

        const [updA, updB] = await Promise.all([
          supabase
            .from('workers')
            .update({ ktx: targetBed.ktx, day: targetBed.day, phong_so: targetBed.phong_so, giuong: targetBed.giuong })
            .eq('id', workerAId),
          supabase
            .from('workers')
            .update({ ktx: sourceBed.ktx, day: sourceBed.day, phong_so: sourceBed.phong_so, giuong: sourceBed.giuong })
            .eq('id', workerBId),
        ]);
        if (updA.error) throw new Error(updA.error.message);
        if (updB.error) throw new Error(updB.error.message);

        await Promise.all([
          supabase
            .from('beds')
            .update({
              status: 'occupied',
              worker_id: workerBId,
              ma_nv: targetBed.ma_nv || null,
              ho_va_ten: targetBed.ho_va_ten || null,
            })
            .eq('id', sourceBed.id),
          supabase
            .from('beds')
            .update({
              status: 'occupied',
              worker_id: workerAId,
              ma_nv: sourceBed.ma_nv || null,
              ho_va_ten: sourceBed.ho_va_ten || null,
            })
            .eq('id', targetBed.id),
        ]);

        // Optimistic state update
        setBeds(prev =>
          prev.map(b => {
            if (b.id === sourceBed.id) {
              return { ...b, worker_id: workerBId, ma_nv: targetBed.ma_nv, ho_va_ten: targetBed.ho_va_ten };
            }
            if (b.id === targetBed.id) {
              return { ...b, worker_id: workerAId, ma_nv: sourceBed.ma_nv, ho_va_ten: sourceBed.ho_va_ten };
            }
            return b;
          })
        );

        const actor = currentUser?.email || currentUser?.name || 'Admin';
        addLog(
          actor,
          'BED_REASSIGN',
          `Hoán đổi giường: ${sourceBed.ho_va_ten || 'A'} (${sourceBed.ktx} · ${sourceBed.day} · P${sourceBed.phong_so} · G${sourceBed.giuong}) ↔ ${targetBed.ho_va_ten || 'B'} (${targetBed.ktx} · ${targetBed.day} · P${targetBed.phong_so} · G${targetBed.giuong})`
        );

        toast.success(
          `Đã hoán đổi: ${shortName(sourceBed.ho_va_ten)} ↔ ${shortName(targetBed.ho_va_ten)}`
        );
        setSwapSourceBed(null);
        setSwapSearch('');
        setDrawerBed(null);
        refreshWorkers();
      } catch (err: any) {
        console.error('[bed-management] swap beds failed:', err);
        const msg = err?.message || 'Không thể hoán đổi giường.';
        setActionError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [swapSourceBed, canWriteBed, supabase, loadBeds, currentUser, addLog, refreshWorkers]
  );

  const swapCandidates = useMemo(() => {
    if (!swapSourceBed) return [];
    const q = swapSearch.trim().toLowerCase();
    return (beds || [])
      .filter(
        b =>
          b.status === 'occupied' &&
          b.id !== swapSourceBed.id &&
          b.worker_id &&
          b.worker_id !== swapSourceBed.worker_id &&
          canWriteBed(b)
      )
      .filter(b => {
        if (!q) return true;
        const w = b.worker_id ? workerById.get(b.worker_id) : null;
        return [b.ho_va_ten, b.ma_nv, b.ktx, b.day, `P${b.phong_so}`, `G${b.giuong}`, w?.donVi]
          .some(v => String(v ?? '').toLowerCase().includes(q));
      })
      .slice(0, 50);
  }, [swapSourceBed, beds, swapSearch, canWriteBed, workerById]);

  const handleSyncBeds = useCallback(async () => {
    if (!isAdmin) {
      toast.error('Chỉ Quản trị viên (Admin) mới có quyền chạy đồng bộ toàn bộ giường.');
      return;
    }
    setSyncingBeds(true);
    setActionError('');
    try {
      const res = await reconcileBedsWithWorkers(supabase);
      await Promise.all([loadBeds(true), loadWorkers(), loadCapacities()]);
      const changes: string[] = [];
      if (res.releasedCount > 0) changes.push(`giải phóng ${res.releasedCount} giường trống`);
      if (res.assignedCount > 0) changes.push(`liên kết ${res.assignedCount} giường`);
      if (res.updatedInfoCount > 0) changes.push(`cập nhật ${res.updatedInfoCount} thông tin`);
      if (changes.length > 0) {
        toast.success(`Đồng bộ giường hoàn tất: ${changes.join(', ')}.`);
      } else {
        toast.success('Dữ liệu giường và công nhân đã đồng bộ hoàn toàn.');
      }
    } catch (err: any) {
      console.error('[bed-management] reconcile error:', err);
      const msg = err?.message || 'Không thể đồng bộ giường.';
      setActionError(msg);
      toast.error(msg);
    } finally {
      setSyncingBeds(false);
    }
  }, [isAdmin, supabase, loadBeds, loadWorkers, loadCapacities]);

  /** Resolve worker ID from bed.worker_id, context slot/name fallback, or live Supabase query */
  const resolveLiveWorkerForBed = useCallback(
    async (bed: BedRow): Promise<WorkerLite | null> => {
      const localMatch = getWorkerForBed(bed);
      if (localMatch?.id) return localMatch;

      if (bed.worker_id) {
        const { data } = await supabase
          .from('workers')
          .select('id, ho_va_ten, ma_nv, cccd, don_vi, gioi_tinh, so_dien_thoai, ngay_vao_ktx, ktx, day, phong_so, giuong')
          .eq('id', bed.worker_id)
          .maybeSingle();
        if (data?.id) {
          return {
            id: String(data.id),
            hoVaTen: String(data.ho_va_ten || ''),
            maNV: String(data.ma_nv || ''),
            cccd: String(data.cccd || ''),
            donVi: String(data.don_vi || ''),
            gioiTinh: String(data.gioi_tinh || ''),
            soDienThoai: String(data.so_dien_thoai || ''),
            ngayVaoKTX: String(data.ngay_vao_ktx || ''),
            ktx: String(data.ktx || ''),
            day: String(data.day || ''),
            phongSo: String(data.phong_so || ''),
            giuong: String(data.giuong || ''),
          };
        }
      }

      if (bed.ktx) {
        const normRoom = normalizeRoomLabel(bed.phong_so || '');
        const normBed = normalizeBedLabel(bed.giuong || '');
        const normBedDay = normDayValue(bed.day);
        const normName = normNfcLower(bed.ho_va_ten);

        const ktxWorkers: any[] = [];
        for (let page = 0; page < 15; page++) {
          const from = page * PAGE;
          const { data, error: pageErr } = await supabase
            .from('workers')
            .select('id, ho_va_ten, ma_nv, cccd, don_vi, gioi_tinh, so_dien_thoai, ngay_vao_ktx, ktx, day, phong_so, giuong')
            .ilike('ktx', bed.ktx.trim())
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
          if (pageErr || !data || data.length === 0) break;
          ktxWorkers.push(...data);
          if (data.length < PAGE) break;
        }

        const found = ktxWorkers.find((w: any) => {
          const sameRoom = normalizeRoomLabel(String(w?.phong_so || '')) === normRoom;
          const normWorkerDay = normDayValue(w?.day);
          const sameDay = !normBedDay || !normWorkerDay || normWorkerDay === normBedDay;
          const sameBed = Boolean(normBed && normalizeBedLabel(String(w?.giuong || '')) === normBed);
          const sameName = Boolean(normName && normNfcLower(w?.ho_va_ten) === normName);
          return sameDay && sameRoom && (sameBed || sameName);
        });
        if (found?.id) {
          return {
            id: String(found.id),
            hoVaTen: String(found.ho_va_ten || ''),
            maNV: String(found.ma_nv || ''),
            cccd: String(found.cccd || ''),
            donVi: String(found.don_vi || ''),
            gioiTinh: String(found.gioi_tinh || ''),
            soDienThoai: String(found.so_dien_thoai || ''),
            ngayVaoKTX: String(found.ngay_vao_ktx || ''),
            ktx: String(found.ktx || ''),
            day: String(found.day || ''),
            phongSo: String(found.phong_so || ''),
            giuong: String(found.giuong || ''),
          };
        }
      }
      return null;
    },
    [getWorkerForBed, supabase]
  );

  /** Lựa chọn 1: gửi yêu cầu check-out sang QR Portal (status=pending) — giữ nguyên giường cho đến khi duyệt. */
  const handleCheckoutRequest = useCallback(async () => {
    const bed = drawerBed;
    if (!bed || bed.status !== 'occupied') return;
    if (!canWriteBed(bed)) {
      toast.error(`Bạn không có quyền trả phòng tại ${bed.ktx} - ${bed.day}.`);
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const workerRef = await resolveLiveWorkerForBed(bed);
      const wid = workerRef?.id || bed.worker_id || null;
      const now = new Date().toISOString();

      let pendingCheckQuery = supabase
        .from('worker_registrations')
        .select('id')
        .eq('status', 'pending')
        .like('ghi_chu', '[CHECKOUT]%');

      if (wid) {
        pendingCheckQuery = pendingCheckQuery.eq('worker_id', wid);
      } else {
        pendingCheckQuery = pendingCheckQuery
          .eq('ktx', bed.ktx || '')
          .eq('day', bed.day || '')
          .eq('phong_so', bed.phong_so || '')
          .eq('giuong', bed.giuong || '');
      }

      const { data: existingPending } = await pendingCheckQuery.limit(1);
      if (existingPending && existingPending.length > 0) {
        toast.info('Giường / công nhân này đã có yêu cầu check-out đang chờ duyệt ở QR Portal.');
        return;
      }

      const { error } = await supabase.from('worker_registrations').insert({
        type: 'CHECKOUT',
        worker_id: wid,
        ho_va_ten: bed.ho_va_ten || workerRef?.hoVaTen || '',
        ma_nv: bed.ma_nv || workerRef?.maNV || '',
        so_cccd: workerRef?.cccd || '',
        so_dien_thoai: workerRef?.soDienThoai || '',
        ktx: bed.ktx || '',
        day: bed.day || '',
        phong_so: bed.phong_so || '',
        giuong: bed.giuong || '',
        status: 'pending',
        ghi_chu: `[CHECKOUT] Yêu cầu trả phòng từ Quản Lý Giường | Ngày: ${now.split('T')[0]}`,
      });
      if (error) throw new Error(error.message);

      const actor = currentUser?.name || currentUser?.email || 'Admin';
      addLog(
        actor,
        'CHECKOUT_REQUEST',
        `Gửi yêu cầu check-out (chờ duyệt): ${bed.ho_va_ten || workerRef?.hoVaTen || ''} (${bed.ma_nv || workerRef?.maNV || '—'}) tại ${bed.ktx} · ${bed.day} · P${bed.phong_so} · G${bed.giuong}`
      );
      toast.success('Đã gửi yêu cầu check-out sang QR Portal — giường sẽ giải phóng sau khi quản lý duyệt.');
      setDrawerBed(null);
    } catch (err: any) {
      console.error('[bed-management] checkout request failed:', err);
      const msg = err?.message || 'Không thể gửi yêu cầu check-out.';
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [drawerBed, canWriteBed, resolveLiveWorkerForBed, supabase, currentUser, addLog]);

  /** Lựa chọn 2: Check-out & Trả giường ngay (xóa hồ sơ khỏi KTX, xác nhận đã xóa, giải phóng giường tức thì). */
  const handleHardDelete = useCallback(async () => {
    const bed = drawerBed;
    if (!bed || bed.status !== 'occupied') return;
    if (!canWriteBed(bed)) {
      toast.error(`Bạn không có quyền check-out / xóa công nhân tại ${bed.ktx} - ${bed.day}.`);
      return;
    }
    setBusy(true);
    setActionError('');
    const now = new Date().toISOString();
    try {
      const workerRef = await resolveLiveWorkerForBed(bed);
      const wid = workerRef?.id || bed.worker_id || null;
      const targetName = bed.ho_va_ten || workerRef?.hoVaTen || '';
      const targetMaNv = bed.ma_nv || workerRef?.maNV || '';
      let deletedWorkerId: string | null = null;

      if (wid) {
        try {
          await supabase.from('worker_deletion_log').insert({
            worker_id: wid,
            ho_va_ten: targetName || null,
            ma_nv: targetMaNv || null,
            ktx: bed.ktx || workerRef?.ktx || null,
            day: bed.day || workerRef?.day || null,
            deleted_at: now,
          });
        } catch (logErr) {
          console.warn('[bed-management] deletion log failed:', logErr);
        }

        const { data: deletedRows, error: delErr } = await supabase
          .from('workers')
          .delete()
          .eq('id', wid)
          .select('id');

        if (delErr) throw new Error(delErr.message);
        if (!deletedRows || deletedRows.length === 0) {
          throw new Error(
            `Không thể xóa hồ sơ công nhân "${targetName || wid}" khỏi CSDL (kiểm tra quyền RLS tại ${bed.ktx} · ${bed.day}).`
          );
        }
        deletedWorkerId = String(deletedRows[0].id);

        preserveDeletedWorkerEntries([
          {
            id: deletedWorkerId,
            hoVaTen: targetName,
            maNV: targetMaNv,
            ktx: bed.ktx || workerRef?.ktx || '',
            day: bed.day || workerRef?.day || '',
          },
        ]);
      }

      // Giải phóng giường chắc chắn bằng cả worker_id lẫn vị trí chuẩn hóa
      await releaseBedByLocation(supabase, {
        workerIds: wid ? [wid] : [],
        bedId: bed.id,
        ktx: bed.ktx,
        day: bed.day,
        phongSo: bed.phong_so,
        giuong: bed.giuong,
      });

      // Đồng bộ mọi đơn check-out pending còn tồn cho cùng công nhân/vị trí để tránh treo
      try {
        if (deletedWorkerId) {
          await supabase
            .from('worker_registrations')
            .update({ status: 'approved', reviewed_by: currentUser?.id, reviewed_at: now })
            .eq('status', 'pending')
            .eq('worker_id', deletedWorkerId)
            .like('ghi_chu', '[CHECKOUT]%');
        }
      } catch {}

      if (deletedWorkerId) {
        markContextWorkersDeleted([deletedWorkerId]);
        setContextWorkers(prev => prev.filter(w => w.id !== deletedWorkerId));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_workers_deleted', { detail: { ids: [deletedWorkerId] } }));
          window.dispatchEvent(new Event('ktx_workers_updated'));
        }
      }

      setBeds(prev =>
        prev.map(b => (b.id === bed.id ? { ...b, status: 'empty', worker_id: null, ma_nv: null, ho_va_ten: null } : b))
      );

      const actor = currentUser?.name || currentUser?.email || 'Admin';
      addLog(
        actor,
        'CHECKOUT_APPROVED',
        `Check-out trực tiếp & trả giường: ${targetName || '—'} (${targetMaNv || '—'}) tại ${bed.ktx} · ${bed.day} · P${bed.phong_so} · G${bed.giuong}`
      );

      invalidateWorkerHierarchyCache();
      invalidateKtxStructureCache();
      invalidateFacilitiesCache();
      refreshWorkers().catch(() => {});

      toast.success(
        deletedWorkerId
          ? `Đã check-out "${targetName}" và giải phóng Giường ${bed.giuong}!`
          : `Đã giải phóng Giường ${bed.giuong} (hồ sơ đã được gỡ trước đó)!`
      );
      setDrawerBed(null);
    } catch (err: any) {
      console.error('[bed-management] hard delete failed:', err);
      const msg = err?.message || 'Không thể check-out / xóa công nhân khỏi KTX.';
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [drawerBed, canWriteBed, resolveLiveWorkerForBed, supabase, currentUser, markContextWorkersDeleted, setContextWorkers, addLog, refreshWorkers]);

  const setBedStatus = useCallback(
    async (bed: BedRow, status: BedStatus) => {
      if (!canWriteBed(bed)) {
        toast.error(`Bạn không có quyền đổi trạng thái giường tại ${bed.ktx} - ${bed.day}.`);
        return;
      }
      setBusy(true);
      setActionError('');
      // Optimistic local state
      const prevStatus = bed.status;
      setBeds(prev => prev.map(b => (b.id === bed.id ? { ...b, status } : b)));
      try {
        const { error } = await supabase
          .from('beds')
          .update({ status })
          .eq('id', bed.id);
        if (error) {
          setBeds(prev => prev.map(b => (b.id === bed.id ? { ...b, status: prevStatus } : b)));
          throw new Error(error.message);
        }
        const actor = currentUser?.name || currentUser?.email || 'Admin';
        addLog(
          actor,
          'Sửa',
          `Cập nhật trạng thái giường ${bed.ktx} · ${bed.day} · P${bed.phong_so} · G${bed.giuong} → ${status === 'maintenance' ? 'Bảo trì' : 'Sẵn sàng (Trống)'}`
        );
        drawerBed && setDrawerBed(status === 'empty' ? null : { ...drawerBed, status });
        toast.success(status === 'maintenance' ? `Đã chuyển G${bed.giuong} sang Bảo trì` : `Đã đưa G${bed.giuong} về Sẵn sàng`);
      } catch (err: any) {
        console.error('[bed-management] set bed status failed:', err);
        setActionError(err?.message || 'Không thể cập nhật trạng thái giường.');
      } finally {
        setBusy(false);
      }
    },
    [supabase, canWriteBed, currentUser, addLog, drawerBed]
  );

  const handleExportBeds = useCallback(() => {
    if (bedsFiltered.length === 0) {
      toast.warning('Không có dữ liệu giường nào khớp bộ lọc để xuất Excel.');
      return;
    }
    const rows = bedsFiltered.map((b, idx) => {
      const w = b?.worker_id ? workerById.get(b.worker_id) : null;
      return {
        'STT': idx + 1,
        'KTX': b.ktx || '—',
        'Dãy': b.day || '—',
        'Phòng': b.phong_so ? `Phòng ${b.phong_so}` : '—',
        'Giường': b.giuong ? `G${b.giuong}` : '—',
        'Trạng thái': b.status === 'occupied' ? 'Đã ở' : b.status === 'maintenance' ? 'Đang bảo trì' : 'Còn trống',
        'Họ và tên': b.ho_va_ten || w?.hoVaTen || '',
        'Mã NV': b.ma_nv || w?.maNV || '',
        'Đơn vị': w?.donVi || '',
        'SĐT': w?.soDienThoai || '',
        'Ngày vào KTX': w?.ngayVaoKTX || '',
      };
    });
    const today = new Date().toISOString().split('T')[0];
    const scope = filterKtx ? filterKtx.replace(/\s+/g, '_') : 'TatCa';
    const ok = exportToExcel(rows, `DanhSach_Giuong_${scope}_${today}.xlsx`, 'Danh sách giường');
    if (ok) {
      toast.success(`Đã xuất ${rows.length.toLocaleString('vi-VN')} giường ra file Excel.`);
    } else {
      toast.error('Không thể xuất file Excel.');
    }
  }, [bedsFiltered, workerById, filterKtx]);

  const candidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    return (workers || []).filter(w => {
      if (!w?.id) return false;
      if (occupiedIds.has(w.id)) return false;
      if (!q) return true;
      return [w.hoVaTen, w.maNV, w.donVi].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [workers, occupiedIds, candidateSearch]);

  const isFemale = (worker?: WorkerLite | null) => {
    const g = (worker?.gioiTinh || '').trim().toLowerCase();
    return g === 'nữ' || g === 'nu' || g === 'female' || g.includes('nữ');
  };

  // ─── Small building blocks (Sơ Đồ Giường Tầng Trực Quan) ──────────────────
  const statusBadge = (status: BedStatus, female: boolean) => {
    if (status === 'occupied') {
      return female ? (
        <span className="text-[11px] font-bold text-pink-tone tracking-tight">♀ Nữ</span>
      ) : (
        <span className="text-[11px] font-bold text-lnk tracking-tight">♂ Nam</span>
      );
    }
    if (status === 'maintenance') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-wn">
          <Wrench size={10} /> Bảo trì
        </span>
      );
    }
    return <span className="text-[11px] font-semibold text-ok">Còn trống</span>;
  };

  const bedCellClasses = (status: BedStatus, female: boolean) => {
    if (status === 'occupied') {
      return female
        ? 'bg-surf border border-pink-tint hover:border-[var(--pink-fg)] hover:tint-pink'
        : 'bg-surf border border-pri2/55 hover:border-pri2 hover:bg-bdg/45';
    }
    if (status === 'maintenance') {
      return 'tint-wn border border-wn/65 hover:border-wn';
    }
    return 'bg-page/60 border border-dashed border-ok/45 hover:border-ok2 hover:bg-okbg/40';
  };

  const bedHeadboardClass = (status: BedStatus, female: boolean) => {
    if (status === 'occupied') {
      return female ? 'bg-[var(--pink-fg)]' : 'bg-pri2';
    }
    if (status === 'maintenance') {
      return 'bg-wn';
    }
    return 'bg-ok2/45';
  };

  const BedTooltip = ({ bed, worker }: { bed: BedRow; worker?: WorkerLite | null }) => (
    <div
      className="pointer-events-none absolute left-1/2 bottom-full z-40 mb-2 hidden sm:block w-64 -translate-x-1/2"
      role="tooltip"
    >
      <div className="rounded-xl border border-bdr bg-page shadow-lg p-3">
        {(() => {
          const w = bed?.worker_id ? (workerById.get(bed.worker_id) || worker) : worker;
          const name = bed?.ho_va_ten || w?.hoVaTen || null;
          const female = isFemale(w);
          return (
            <>
              <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${name ? (female ? 'tint-pink text-pink-tone border border-pink-tint' : 'bg-bdg text-lnk border border-pri2/40') : 'bg-act text-mu'}`}>
                  {name ? name.charAt(0).toUpperCase() : <BedDouble size={16} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-tx truncate">{name || 'Giường trống'}</p>
                  <p className="text-[11px] text-mu font-tabular truncate">
                    Mã NV: {bed?.ma_nv || w?.maNV || '—'}
                  </p>
                </div>
              </div>
              {name && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] text-mu">
                  <dt className="flex items-center gap-1 text-ic"><Phone size={10} /> SĐT</dt>
                  <dd className="font-tabular truncate">{w?.soDienThoai || '—'}</dd>
                  <dt className="flex items-center gap-1 text-ic"><Calendar size={10} /> Vào</dt>
                  <dd className="font-tabular truncate">{w?.ngayVaoKTX || '—'}</dd>
                  <dt className="flex items-center gap-1 text-ic"><Briefcase size={10} /> Đơn vị</dt>
                  <dd className="truncate">{w?.donVi || '—'}</dd>
                  <dt className="flex items-center gap-1 text-ic"><Building2 size={10} /> Giường</dt>
                  <dd className="truncate font-tabular">{[bed?.ktx, bed?.day, `P${bed?.phong_so}`, `G${bed?.giuong}`].filter(Boolean).join(' · ')}</dd>
                </dl>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );

  return (
    <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-5 max-w-screen-2xl mx-auto space-y-5 bg-transparent min-h-screen">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3.5 border-b border-bdr">
        <div className="flex items-center gap-3">
          <CraftIconBadge icon={BedDouble} badgeIcon={LayoutGrid} tone="blue" size="md" />
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-tx tracking-tight">
              Sơ Đồ Mặt Bằng — Quản Lý Giường
            </h1>
            <p className="text-xs text-mu mt-0.5">
              Đồng bộ thời gian thực trạng thái giường, công nhân và cơ sở vật chất
            </p>
          </div>
        </div>
        {/* View switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <SlidingTabs
            layoutId="bed-management-view"
            compact
            value={view}
            onChange={setView}
            tabs={[
              { id: 'grid', label: 'Sơ Đồ Ma Trận', icon: LayoutGrid },
              { id: 'table', label: 'Danh Sách', icon: Table2 },
              { id: 'analytics', label: 'Lấp Đầy', icon: BarChart3 },
            ]}
          />
          {isAdmin && (
            <button
              onClick={handleSyncBeds}
              disabled={syncingBeds || refreshing || loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-bdr2 bg-bdg text-lnk hover:bg-act text-sm font-bold transition-colors disabled:opacity-60"
              title="Đối chiếu và dọn dẹp giường trống / công nhân đã xóa hoặc đổi phòng"
            >
              <ArrowRightLeft size={14} className={syncingBeds ? 'animate-spin' : ''} />
              {syncingBeds ? 'Đang đồng bộ...' : 'Đồng bộ giường'}
            </button>
          )}
          <button
            onClick={handleExportBeds}
            disabled={loading || bedsFiltered.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ok2 hover:opacity-90 text-ok2-fg text-sm font-bold transition-colors disabled:opacity-50"
            title="Xuất danh sách giường đang lọc ra Excel"
          >
            <Download size={14} /> Xuất Excel
          </button>
          <button
            onClick={() => setShowQrPrint(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-bdr3 bg-transparent text-tx hover:bg-act text-sm font-bold transition-colors"
            title="In tem QR cho giường ở phạm vi đang chọn"
          >
            <Printer size={14} /> Xuất Danh Sách QR
          </button>
          <button
            onClick={() => { loadBeds(); loadWorkers(); loadCapacities(); }}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing || loading ? 'animate-spin' : ''} />
            Làm mới
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bdg border border-bdr2 text-xs text-lnk">
          <Lock size={14} className="shrink-0" />
          <span>
            Chế độ phân quyền: bạn chỉ có thể gán, chuyển hoặc bảo trì giường thuộc phạm vi phụ trách (
            <strong>{currentUser?.assignedBlocks?.length ? currentUser.assignedBlocks.join(', ') : 'Chỉ xem'}</strong>).
          </span>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl tint-dgr border border-dgr text-dgr text-sm">
          <AlertCircle size={16} className="shrink-0" />
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="ml-auto opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* ─── Top Bar Controls ─── */}
      <div className="bg-surf border border-bdr rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-mu uppercase tracking-wider">KTX</label>
            <select
              value={filterKtx}
              onChange={e => { setFilterKtx(e.target.value); setFilterDay(''); setFilterRoom(''); }}
              className="bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 min-w-[130px] cursor-pointer"
            >
              <option value="">Tất cả KTX</option>
              {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {filterKtx && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Dãy</label>
              <select
                value={filterDay}
                onChange={e => { setFilterDay(e.target.value); setFilterRoom(''); }}
                className="bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 min-w-[110px] cursor-pointer"
              >
                <option value="">Tất cả dãy</option>
                {dayList.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {filterKtx && filterDay && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Phòng</label>
              <select
                value={filterRoom}
                onChange={e => setFilterRoom(e.target.value)}
                className="bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 min-w-[110px] cursor-pointer"
              >
                <option value="">Tất cả phòng</option>
                {roomList.map(r => <option key={r} value={r}>{formatRoomDisplay(r)}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Trạng thái</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as 'all' | BedStatus)}
              className="bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 min-w-[130px] cursor-pointer"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="occupied">Đã ở</option>
              <option value="empty">Còn trống</option>
              <option value="maintenance">Đang bảo trì</option>
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Tìm kiếm nhanh</label>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ic" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tên công nhân, mã NV, số giường (G1), đơn vị…"
                className="w-full bg-surf border border-bdr text-tx placeholder-mu rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pri2/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ic hover:text-tx p-0.5"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {[
            { label: 'Tổng giường', value: bedsFiltered.length, color: 'text-tx' },
            { label: 'Đã ở', value: occupiedCount, color: 'text-ok' },
            { label: 'Trống', value: emptyCount, color: 'text-lnk' },
            { label: 'Bảo trì', value: maintenanceCount, color: 'text-wn' },
            { label: 'Tỷ lệ lấp đầy', value: `${fillRateInView}%`, color: 'text-lnk' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-bdr bg-surf p-2.5">
              <p className="text-[11px] text-mu font-semibold">{s.label}</p>
              <p className={`text-xl font-bold font-tabular mt-0.5 ${s.color}`}>
                {typeof s.value === 'number' ? s.value.toLocaleString('vi-VN') : s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Legend — Sơ Đồ Giường Tầng Trực Quan */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-bdr">
          <span className="text-[11px] font-extrabold text-tx uppercase tracking-wider">Sơ đồ màu giường:</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tx">
            <span className="w-4 h-3.5 rounded border border-pri2/60 bg-surf relative overflow-hidden inline-block">
              <span className="absolute inset-x-0 top-0 h-1 bg-pri2" />
            </span>
            Nam (Đã ở)
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tx">
            <span className="w-4 h-3.5 rounded border border-pink-tint bg-surf relative overflow-hidden inline-block">
              <span className="absolute inset-x-0 top-0 h-1 bg-[var(--pink-fg)]" />
            </span>
            Nữ (Đã ở)
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tx">
            <span className="w-4 h-3.5 rounded border border-dashed border-ok/60 bg-page relative overflow-hidden inline-block">
              <span className="absolute inset-x-0 top-0 h-1 bg-ok2/50" />
            </span>
            Còn trống
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tx">
            <span className="w-4 h-3.5 rounded border border-wn/70 tint-wn relative overflow-hidden inline-block">
              <span className="absolute inset-x-0 top-0 h-1 bg-wn" />
            </span>
            Bảo trì
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tx">
            <span className="w-3.5 h-3.5 rounded tint-dgr border border-dgr" /> Phòng quá tải
          </span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(r => (
            <div key={r} className="rounded-2xl border border-bdr bg-surf p-4 space-y-3">
              <div className="flex justify-between items-center">
                <div className="h-6 w-24 rounded-lg skeleton-pulse" />
                <div className="h-4 w-20 rounded-md skeleton-pulse" />
              </div>
              <div className="h-1.5 w-full rounded-full skeleton-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[1, 2, 3, 4].map(b => (
                  <div key={b} className="h-16 rounded-xl skeleton-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : beds.length === 0 ? (
        <div className="rounded-2xl border border-wn tint-wn p-8 text-center space-y-2">
          <BedDouble size={34} className="mx-auto text-wn" />
          <p className="font-semibold text-wn">Chưa có dữ liệu giường trong bảng <code>beds</code></p>
          <p className="text-sm text-wn/80">Chạy <code className="font-mono">supabase/bootstrap.sql</code> trong SQL Editor, hoặc thêm phòng ở Cơ Sở Vật Chất — giường sẽ tự sinh.</p>
        </div>
      ) : (
        <>
          {/* ─── GRID VIEW — Floor Plan Matrix ─── */}
          {view === 'grid' && (
            <div className="space-y-5">
              {roomGroups.length === 0 && (
                <p className="text-sm text-muted-foreground py-10 text-center">Không có giường nào khớp bộ lọc/tìm kiếm.</p>
              )}
              {(() => {
                let currentKtx = '';
                let currentDay = '';
                return roomGroups.map(g => {
                  const showKtx = g.ktx !== currentKtx;
                  const showDay = g.day !== currentDay;
                  currentKtx = g.ktx;
                  currentDay = g.day;
                  const pct = g.cap > 0 ? Math.min(g.occupied / g.cap, 1.2) : 0;
                  const barColor = g.overloaded ? 'bg-dgr' : pct >= 0.9 ? 'bg-wn' : pct >= 0.5 ? 'bg-ok2' : 'bg-pri2';
                  return (
                    <React.Fragment key={`${g.ktx}-${g.day}-${g.room}`}>
                      {showKtx && (
                        <div className="flex items-center gap-2.5 pt-2">
                          <span className="text-sm font-extrabold px-3 py-1.5 rounded-xl border bg-act border-bdr text-tx shadow-lg">
                            {g.ktx}
                          </span>
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-wn">Sơ đồ mặt bằng</span>
                          <div className="flex-1 h-px bg-bdr2" />
                        </div>
                      )}
                      {showDay && (
                        <div className="flex items-center gap-2">
                          <Building2 size={15} className="text-lnk shrink-0" />
                          <h3 className="text-base font-extrabold text-tx">{g.day}</h3>
                        </div>
                      )}
                      {/* Room Card */}
                      <div className={`rounded-2xl border p-3.5 shadow-sm transition-colors ${
                        g.overloaded ? 'border-dgr tint-dgr' : 'border-bdr bg-surf'
                      }`}>
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                            <span className="text-sm font-extrabold text-tx bg-act border border-bdr px-2.5 py-1 rounded-xl shrink-0">
                              {formatRoomDisplay(g.room)}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-tabular text-mu truncate">
                              {g.occupied > 0 && (
                                <>
                                  {g.maleCount > 0 && <span className="text-lnk font-semibold">♂ {g.maleCount} Nam</span>}
                                  {g.maleCount > 0 && g.femaleCount > 0 && <span className="text-ic">·</span>}
                                  {g.femaleCount > 0 && <span className="text-pink-tone font-semibold">♀ {g.femaleCount} Nữ</span>}
                                  <span className="text-ic">·</span>
                                </>
                              )}
                              <span className={g.empty > 0 ? 'text-ok font-medium' : 'text-mu'}>{g.empty} trống</span>
                            </span>
                            {g.overloaded && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md tint-dgr text-dgr border border-dgr">
                                <AlertCircle size={9} /> Quá tải
                              </span>
                            )}
                            {g.maintenance > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md tint-wn text-wn border border-wn">
                                <Wrench size={9} /> {g.maintenance} bảo trì
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-tabular font-extrabold text-tx shrink-0">
                            {g.occupied}/{g.cap} giường
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-bdr2 rounded-full overflow-hidden mb-3">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                          {g.beds.map(bed => {
                            const worker = getWorkerForBed(bed);
                            const occupied = bed?.status === 'occupied';
                            const maintenance = bed?.status === 'maintenance';
                            const female = occupied && isFemale(worker);
                            const unit = worker?.donVi || '';
                            const bedLabel = `G${bed?.giuong || '?'}`;
                            const isHovered = occupied && hoveredBedId === bed?.id;
                            return (
                              <button
                                type="button"
                                key={bed?.id}
                                onMouseEnter={() => { if (occupied && bed?.id) setHoveredBedId(bed.id); }}
                                onMouseLeave={() => { if (hoveredBedId === bed?.id) setHoveredBedId(null); }}
                                onClick={() => {
                                  if (occupied || maintenance) {
                                    setDrawerBed(bed);
                                  } else {
                                    if (!canWriteBed(bed)) {
                                      toast.error(`Bạn chỉ có quyền xem giường ở ${bed.ktx} - ${bed.day}.`);
                                      return;
                                    }
                                    setAssignTarget(bed);
                                    setCandidateSearch('');
                                  }
                                }}
                                className={`relative text-left rounded-xl p-2.5 pt-3 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-pri2 overflow-visible ${bedCellClasses(bed?.status ?? 'empty', female)}`}
                              >
                                {/* Đầu giường trực quan (Headboard accent strip — không clipping Tooltip) */}
                                <span
                                  aria-hidden="true"
                                  className={`pointer-events-none absolute inset-x-0 top-0 h-[3.5px] rounded-t-[11px] ${bedHeadboardClass(bed?.status ?? 'empty', female)}`}
                                />
                                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                                  <span className="inline-flex items-center gap-1 text-xs font-mono font-tabular font-bold text-tx">
                                    <BedDouble size={12} className={occupied ? (female ? 'text-pink-tone' : 'text-lnk') : maintenance ? 'text-wn' : 'text-ok'} />
                                    {bedLabel}
                                  </span>
                                  {statusBadge(bed?.status ?? 'empty', female)}
                                </div>
                                {occupied ? (
                                  <div className="space-y-0.5 min-w-0">
                                    <p className="text-sm font-bold text-tx truncate">
                                      {shortName(bed?.ho_va_ten) || shortName(worker?.hoVaTen) || '?'}
                                    </p>
                                    <p className="text-[11px] font-tabular truncate flex items-center gap-1 text-mu">
                                      <span className="font-mono font-semibold text-tx/85">MNV {bed?.ma_nv || worker?.maNV || '—'}</span>
                                      {unit && (
                                        <>
                                          <span className="text-ic">·</span>
                                          <span className="truncate text-lnk font-medium">{unit}</span>
                                        </>
                                      )}
                                    </p>
                                  </div>
                                ) : maintenance ? (
                                  <p className="text-xs font-semibold text-wn">Đang kiểm tra / sửa</p>
                                ) : (
                                  <p className="text-[11px] font-medium text-mu">Bấm để gán công nhân…</p>
                                )}
                                {isHovered && <BedTooltip bed={bed} worker={worker} />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          )}

          {/* ─── TABLE VIEW ─── */}
          {view === 'table' && (
            <div className="bg-surf border border-bdr rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bdr text-left">
                      {['KTX', 'Dãy', 'Phòng', 'Giường', 'Trạng thái', 'Họ tên', 'Mã NV', 'Đơn vị', 'SĐT', 'Ngày vào', 'Thao tác'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-mu whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bdr">
                    {bedsFiltered.map(bed => {
                      const worker = bed?.worker_id ? (workerById.get(bed.worker_id) || null) : null;
                      const female = isFemale(worker);
                      return (
                        <tr key={bed?.id} className="hover:bg-surf transition-colors">
                          <td className="px-3 py-2 text-xs font-bold text-tx whitespace-nowrap">{bed?.ktx || '—'}</td>
                          <td className="px-3 py-2 text-xs text-mu whitespace-nowrap">{bed?.day || '—'}</td>
                          <td className="px-3 py-2 text-xs text-mu font-tabular whitespace-nowrap">P{bed?.phong_so || '—'}</td>
                          <td className="px-3 py-2 text-xs text-tx font-tabular whitespace-nowrap">G{bed?.giuong || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {bed?.status === 'occupied'
                              ? <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${female ? 'tint-pink text-pink-tone border-pink-tint' : 'bg-bdg text-lnk border-pri2/40'}`}>{female ? '♀ Nữ · Đã ở' : '♂ Nam · Đã ở'}</span>
                              : bed?.status === 'maintenance'
                              ? <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border tint-wn text-wn border-wn">Bảo trì</span>
                              : <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border border-dashed bg-okbg text-ok border-ok/40">Trống</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-tx font-semibold truncate max-w-[160px]">{bed?.ho_va_ten || worker?.hoVaTen || '—'}</td>
                          <td className="px-3 py-2 text-xs text-mu font-tabular whitespace-nowrap">{bed?.ma_nv || worker?.maNV || '—'}</td>
                          <td className="px-3 py-2 text-xs text-mu truncate max-w-[130px]">{worker?.donVi || '—'}</td>
                          <td className="px-3 py-2 text-xs text-mu font-tabular whitespace-nowrap">{worker?.soDienThoai || '—'}</td>
                          <td className="px-3 py-2 text-xs text-mu font-tabular whitespace-nowrap">{worker?.ngayVaoKTX || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {bed?.status === 'empty' && canWriteBed(bed) && (
                                <button
                                  type="button"
                                  onClick={() => { setAssignTarget(bed); setCandidateSearch(''); }}
                                  disabled={busy}
                                  className="p-1.5 rounded-lg text-lnk hover:bg-bdg border border-bdr2 disabled:opacity-50"
                                  title="Gán công nhân"
                                >
                                  <UserPlus size={13} />
                                </button>
                              )}
                              {bed?.status === 'occupied' && (
                                <button
                                  type="button"
                                  onClick={() => { setDrawerBed(bed); }}
                                  className="p-1.5 rounded-lg text-ok hover:bg-okbg border border-bdr2"
                                  title="Chi tiết / thao tác"
                                >
                                  <ExternalLink size={13} />
                                </button>
                              )}
                              {bed?.status === 'empty' && canWriteBed(bed) && (
                                <button
                                  type="button"
                                  onClick={() => setBedStatus(bed, 'maintenance')}
                                  disabled={busy}
                                  className="p-1.5 rounded-lg text-wn hover:bg-okbg border border-wn disabled:opacity-50"
                                  title="Đánh dấu bảo trì"
                                >
                                  <Wrench size={13} />
                                </button>
                              )}
                              {bed?.status === 'maintenance' && canWriteBed(bed) && (
                                <button
                                  type="button"
                                  onClick={() => setBedStatus(bed, 'empty')}
                                  disabled={busy}
                                  className="p-1.5 rounded-lg text-ok hover:bg-okbg border border-bdr2 disabled:opacity-50"
                                  title="Bỏ bảo trì"
                                >
                                  <CheckCircle2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {bedsFiltered.length === 0 && (
                      <tr><td colSpan={11} className="px-3 py-10 text-center text-xs text-ic italic">Không có giường nào khớp bộ lọc.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── ANALYTICS VIEW ─── */}
          {view === 'analytics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  { label: 'Tổng giường', value: bedsFiltered.length, color: 'text-tx border-bdr' },
                  { label: 'Đã ở', value: occupiedCount, color: 'text-ok border-bdr2' },
                  { label: 'Trống', value: emptyCount, color: 'text-lnk border-bdr2' },
                  { label: 'Bảo trì', value: maintenanceCount, color: 'text-wn border-wn' },
                  { label: 'Tỷ lệ lấp đầy', value: `${fillRateInView}%`, color: 'text-lnk border-bdr2' },
                ].map(s => (
                  <div key={s.label} className={`rounded-2xl border bg-surf p-4 shadow-xl ${s.color}`}>
                    <p className="text-xs text-mu font-semibold">{s.label}</p>
                    <p className={`text-2xl font-bold font-tabular mt-1 ${s.color}`}>
                      {typeof s.value === 'number' ? s.value.toLocaleString('vi-VN') : s.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-surf border border-bdr rounded-2xl p-5 shadow-xl space-y-4">
                <h3 className="text-sm font-bold text-tx flex items-center gap-2"><BarChart3 size={15} className="text-lnk" /> Lấp đầy theo KTX</h3>
                {perKtxStats.length === 0 ? (
                  <p className="text-xs text-ic italic">Không có dữ liệu.</p>
                ) : (
                  perKtxStats.map(s => {
                    const rate = s.total > 0 ? s.occupied / s.total : 0;
                    return (
                      <div key={s.ktx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-tx">{s.ktx}</span>
                          <span className="text-mu font-tabular">
                            {s.occupied}/{s.total} · Trống {s.empty} · BT {s.maintenance} · <b className="text-lnk">{Math.round(rate * 100)}%</b>
                          </span>
                        </div>
                        <div className="w-full h-2 bg-bdr2 rounded-full overflow-hidden flex" aria-hidden="true">
                          <div className="h-full bg-ok2" style={{ width: `${(s.occupied / Math.max(s.total, 1)) * 100}%` }} />
                          <div className="h-full bg-wn" style={{ width: `${(s.maintenance / Math.max(s.total, 1)) * 100}%` }} />
                          <div className="h-full bg-pri2" style={{ width: `${(s.empty / Math.max(s.total, 1)) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
                <p className="text-[10px] text-ic flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-1 rounded bg-ok2" /> Đã ở</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-1 rounded bg-wn" /> Bảo trì</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-1 rounded bg-pri2" /> Trống</span>
                </p>
              </div>

              <div className="bg-surf border border-dgr rounded-2xl p-5 shadow-xl space-y-3">
                <h3 className="text-sm font-bold text-tx flex items-center gap-2"><AlertCircle size={15} className="text-dgr" /> Phòng cần hỗ trợ (Quá tải)</h3>
                {overloadedRooms.length === 0 ? (
                  <p className="text-xs text-ic italic">Không có phòng nào quá tải.</p>
                ) : (
                  overloadedRooms.map(g => (
                    <div key={`${g.ktx}-${g.day}-${g.room}`} className="flex items-center justify-between rounded-xl border border-dgr tint-dgr px-3 py-2">
                      <span className="text-xs text-dgr">
                        <b>{g.ktx || '—'}</b> · {g.day} · Phòng {g.room}
                      </span>
                      <span className="text-xs font-tabular font-bold text-dgr">{g.occupied}/{g.cap} giường</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Print QR labels modal */}
      <BedQrPrintModal open={showQrPrint} onClose={() => setShowQrPrint(false)} lockedBed={null} />

      {/* ─── Assign Modal ─── */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 modal-backdrop-scrim fade-in flex items-center justify-center p-4" onClick={() => setAssignTarget(null)}>
          <div className="modal-enter bg-surf border border-bdr rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-bdr">
              <div>
                <h3 className="font-bold text-tx flex items-center gap-2"><UserCheck size={16} className="text-ok" /> Gán công nhân vào giường</h3>
                <p className="text-xs text-mu mt-0.5">
                  {assignTarget.ktx || '(KTX)'} · {assignTarget.day || '(Dãy)'} · Phòng {assignTarget.phong_so || '?'} · Giường {assignTarget.giuong || '?'}
                </p>
              </div>
              <button onClick={() => { setAssignTarget(null); setActionError(''); }} className="p-2 rounded-lg hover:bg-surf text-mu hover:text-tx"><X size={16} /></button>
            </div>
            <div className="px-5 pt-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ic" />
                <input
                  autoFocus
                  value={candidateSearch}
                  onChange={e => setCandidateSearch(e.target.value)}
                  placeholder="Tìm công nhân theo tên / mã NV / đơn vị…"
                  className="w-full bg-surf border border-bdr text-tx placeholder-mu rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pri2/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {candidates.length === 0 ? (
                <p className="text-sm text-ic italic text-center py-8">Không tìm thấy công nhân phù hợp.</p>
              ) : (
                candidates.slice(0, 60).map(w => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssign(w)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-bdr hover:border-pri2 hover:bg-surf transition-colors disabled:opacity-60"
                  >
                    <div className="w-8 h-8 rounded-lg bg-bdg border border-bdr2 flex items-center justify-center text-lnk text-xs font-bold shrink-0">
                      {String(w?.hoVaTen || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-tx truncate">{w?.hoVaTen || '(Không tên)'}</p>
                      <p className="text-[11px] text-mu font-tabular truncate">{w?.maNV || '—'} · {w?.donVi || '—'}</p>
                    </div>
                    <UserCheck size={15} className="text-ok shrink-0" />
                  </button>
                ))
              )}
            </div>
            {busy && (
              <div className="px-5 py-3 border-t border-bdr flex items-center gap-2 text-xs text-mu">
                <Loader2 size={13} className="animate-spin" /> Đang gán giường…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Quick Drawer (right side) ─── */}
      {drawerBed && (
        <>
          <div className="fixed inset-0 z-40 modal-backdrop-scrim fade-in" onClick={() => { setDrawerBed(null); setShowTransferModal(false); }} />
          <div
            className="fixed z-50 animate-slide-in-right bottom-0 inset-x-0 max-h-[85vh] sm:max-h-full sm:top-0 sm:right-0 sm:left-auto sm:inset-x-auto sm:h-full w-full sm:max-w-md bg-surf border-t sm:border-t-0 sm:border-l border-bdr text-tx shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-bdr bg-act">
              <div className="min-w-0">
                <h3 className="font-bold text-tx flex items-center gap-2">
                  <BedDouble size={16} className="text-pri2" /> Giường {drawerBed?.giuong || '?'}
                </h3>
                <p className="text-xs text-mu mt-0.5 font-tabular truncate">
                  {[drawerBed?.ktx, drawerBed?.day, `Phòng ${drawerBed?.phong_so || '?'}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              {drawerBed?.status === 'maintenance' && (
                <span className="hidden sm:inline-flex mx-2 items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full tint-wn text-wn border border-wn shrink-0"><Wrench size={10} /> Bảo trì</span>
              )}
              <button onClick={() => { setDrawerBed(null); setShowTransferModal(false); }} className="p-2 rounded-xl hover:bg-surf text-mu hover:text-tx shrink-0"><X size={18} /></button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto scrollbar-thin">
              {(() => {
                const w = getWorkerForBed(drawerBed);
                const name = drawerBed?.ho_va_ten || w?.hoVaTen || '';
                const female = isFemale(w);
                if (!name) {
                  return (
                    <div className="rounded-xl border border-bdr2 bg-bdg p-4 text-sm text-lnk">
                      Giường đang trống. Bấm <b>Gán công nhân</b> bên dưới để cấp vị trí.
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-4 rounded-xl border border-bdr bg-surf p-4">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${female ? 'tint-pink text-pink-tone border border-pink-tint' : 'bg-bdg text-lnk border border-pri2/40'}`}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-base font-bold text-tx flex items-center gap-2 truncate">
                        {name}
                        {female && <VenusAndMars size={14} className="text-pink-tone shrink-0" />}
                      </p>
                      <p className="text-xs text-mu font-tabular flex items-center gap-1.5"><User size={11} className="shrink-0" /> Mã NV: {drawerBed?.ma_nv || w?.maNV || '—'}</p>
                      <p className="text-xs text-mu flex items-center gap-1.5 truncate"><Briefcase size={11} className="shrink-0" /> Đơn vị: {w?.donVi || '—'}</p>
                      <p className="text-xs text-mu font-tabular flex items-center gap-1.5"><Phone size={11} className="shrink-0" /> SĐT: {w?.soDienThoai || '—'}</p>
                      <p className="text-xs text-mu font-tabular flex items-center gap-1.5"><Calendar size={11} className="shrink-0" /> Ngày vào: {w?.ngayVaoKTX || '—'}</p>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 gap-2">
                  {drawerBed && !canWriteBed(drawerBed) && (
                    <div className="rounded-xl border border-bdr2 bg-act p-3 text-xs text-mu flex items-center gap-2">
                      <Lock size={14} className="shrink-0 text-wn" />
                      <span>Bạn chỉ có quyền xem giường thuộc {drawerBed.ktx} · {drawerBed.day}.</span>
                    </div>
                  )}
                  {drawerBed?.status === 'occupied' && canWriteBed(drawerBed) && (() => {
                    const resolvedDrawerWorker = getWorkerForBed(drawerBed);
                    const hasWorkerIdentity = Boolean(drawerBed?.worker_id || resolvedDrawerWorker?.id);
                    return (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!hasWorkerIdentity || busy}
                          onClick={() => setShowTransferModal(true)}
                          className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-pri hover:opacity-90 text-white text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <ArrowRightLeft size={14} /> Chuyển giường trống
                        </button>
                        <button
                          type="button"
                          disabled={!hasWorkerIdentity || busy}
                          onClick={() => {
                            const effectiveWid = drawerBed.worker_id || resolvedDrawerWorker?.id || null;
                            setSwapSourceBed({ ...drawerBed, worker_id: effectiveWid });
                            setSwapSearch('');
                          }}
                          className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-bdr2 bg-bdg hover:bg-act text-lnk text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <ArrowRightLeft size={14} /> Hoán đổi 2 người
                        </button>
                      </div>

                      {/* Trả phòng — chọn cách xử lý */}
                      <div className="rounded-xl border border-bdr bg-act p-3 space-y-2">
                        <p className="text-[11px] font-extrabold text-tx uppercase tracking-wider flex items-center gap-1.5">
                          <DoorOpen size={12} className="text-dgr" /> Trả phòng / Check-out khỏi KTX
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleHardDelete}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-dgr hover:opacity-90 text-white text-sm font-extrabold disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />} Check-out & Trả giường ngay
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleCheckoutRequest}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-wn hover:opacity-90 text-wn-fg text-sm font-extrabold disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} />} Gửi yêu cầu check-out để duyệt
                        </button>
                        <p className="text-[10px] text-mu leading-snug">
                          <b>Check-out ngay</b> → gỡ công nhân khỏi hệ thống và giải phóng giường tức thì. <b>Gửi yêu cầu</b> → chờ duyệt ở tab Duyệt Check-out (QR Portal).
                        </p>
                      </div>
                    </>
                    );
                  })()}
                  {drawerBed?.status === 'maintenance' && canWriteBed(drawerBed) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setBedStatus(drawerBed, 'empty')}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok2 hover:opacity-90 text-ok2-fg text-sm font-semibold disabled:opacity-50 transition-colors"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Hoàn tất — Bỏ bảo trì
                    </button>
                  )}
                </div>

              {busy && (
                <p className="text-xs text-mu flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Đang xử lý…</p>
              )}

              <button
                type="button"
                onClick={() => router.push('/worker-management')}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-bdr2 hover:border-bdr3 text-mu hover:text-tx text-xs font-semibold transition-colors"
              >
                <ExternalLink size={12} /> Mở hồ sơ trong Quản Lý Công Nhân
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── Swap Bed Modal (Hoán đổi 2 công nhân A <-> B) ─── */}
      {swapSourceBed && (
        <div className="fixed inset-0 z-50 modal-backdrop-scrim fade-in flex items-center justify-center p-4" onClick={() => { setSwapSourceBed(null); setSwapSearch(''); }}>
          <div className="modal-enter bg-surf border border-bdr2 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-bdr bg-act/50">
              <div>
                <h3 className="font-bold text-tx flex items-center gap-2">
                  <ArrowRightLeft size={16} className="text-lnk" /> Hoán đổi vị trí 2 công nhân
                </h3>
                <p className="text-xs text-mu mt-0.5 font-tabular">
                  Từ: <strong className="text-tx">{swapSourceBed.ho_va_ten || '—'}</strong> ({swapSourceBed.ktx} · {swapSourceBed.day} · P{swapSourceBed.phong_so} · G{swapSourceBed.giuong})
                </p>
              </div>
              <button onClick={() => { setSwapSourceBed(null); setSwapSearch(''); }} className="p-2 rounded-lg hover:bg-act text-mu hover:text-tx cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 pt-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ic" />
                <input
                  autoFocus
                  value={swapSearch}
                  onChange={e => setSwapSearch(e.target.value)}
                  placeholder="Tìm công nhân/giường cần hoán đổi (tên, mã NV, phòng...)"
                  className="w-full bg-surf border border-bdr text-tx placeholder-mu rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pri2/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5 scrollbar-thin">
              {swapCandidates.length === 0 ? (
                <p className="text-sm text-ic italic text-center py-8">Không có giường đang ở nào phù hợp trong phạm vi quyền của bạn.</p>
              ) : (
                swapCandidates.map(target => {
                  const w = target.worker_id ? workerById.get(target.worker_id) : null;
                  return (
                    <button
                      key={target.id}
                      type="button"
                      disabled={busy}
                      onClick={() => handleSwapBeds(target)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-bdr hover:border-pri2 hover:bg-act/60 transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg bg-okbg border border-bdr2 flex items-center justify-center text-ok text-xs font-bold shrink-0">
                        {String(target.ho_va_ten || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-tx truncate">
                          {target.ho_va_ten || '(Chưa rõ)'}
                          {target.ma_nv ? <span className="text-xs text-mu font-mono ml-1.5">#{target.ma_nv}</span> : null}
                        </p>
                        <p className="text-[11px] text-mu font-tabular truncate">
                          {[target.ktx, target.day, `P${target.phong_so}`, `G${target.giuong}`, w?.donVi].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-lnk shrink-0">
                        <ArrowRightLeft size={13} /> Đổi chỗ
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {busy && (
              <div className="px-5 py-3 border-t border-bdr flex items-center gap-2 text-xs text-mu">
                <Loader2 size={13} className="animate-spin" /> Đang hoán đổi 2 giường…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Transfer modal (cascade KTX → Dãy → Phòng → Giường trống) ─── */}
      <BedTransferModal
        open={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        workerId={drawerBed?.worker_id || getWorkerForBed(drawerBed)?.id || null}
        sourceBed={drawerBed
          ? {
              id: drawerBed.id || '',
              ktx: drawerBed.ktx || '',
              day: drawerBed.day || '',
              phong_so: drawerBed.phong_so || '',
              giuong: drawerBed.giuong || '',
            }
          : null}
        onTransferred={() => { setDrawerBed(null); loadBeds(true); refreshWorkers(); }}
      />
    </div>
  );
}
