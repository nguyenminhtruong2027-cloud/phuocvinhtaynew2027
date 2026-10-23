'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  BedDouble, RefreshCw, Search, X, User, UserCheck, UserX,
  ArrowRightLeft, Loader2, Building2, Phone, Briefcase, VenusAndMars,
  AlertCircle, LayoutGrid, Table2, BarChart3, Wrench, DoorOpen, Calendar,
  ExternalLink, UserPlus, CheckCircle2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { compareKtxNames, DEFAULT_ROOM_CAPACITY } from '@/data/workers';
import { fetchRoomCapacities, getRoomCapacity, RoomCapacityMap } from '@/lib/facilityCapacity';

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

async function fetchAllRows<T>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  select: string
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (let page = 0; page < 30; page++) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn(`[bed-management] fetch ${table} error:`, error.message);
        break;
      }
      const list = (data ?? []) as T[];
      rows.push(...list);
      if (list.length < PAGE) break;
      from += PAGE;
    } catch (err) {
      console.warn(`[bed-management] fetch ${table} failed (offline?):`, err);
      break;
    }
  }
  return rows;
}

function shortName(full?: string | null): string {
  const s = (full || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  return parts[parts.length - 1] || s;
}

export default function BedManagementClient() {
  const router = useRouter();
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [workers, setWorkers] = useState<WorkerLite[]>([]);
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [view, setView] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  const [filterKtx, setFilterKtx] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [filterRoom, setFilterRoom] = useState('');

  const [assignTarget, setAssignTarget] = useState<BedRow | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [drawerBed, setDrawerBed] = useState<BedRow | null>(null);
  const [transferMode, setTransferMode] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  // ─── Data loading ──────────────────────────────────────────────────────────
  const loadBeds = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await fetchAllRows<Record<string, unknown>>(supabase, 'beds', '*');
      const mapped: BedRow[] = (rows || []).map((r, i) => ({
        id: String(r?.id ?? `bed-${i}`),
        ktx: String(r?.ktx ?? ''),
        day: String(r?.day ?? ''),
        phong_so: String(r?.phong_so ?? ''),
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
    try {
      const rows = await fetchAllRows<Record<string, unknown>>(
        supabase,
        'workers',
        'id, ho_va_ten, ma_nv, don_vi, gioi_tinh, so_dien_thoai, ngay_vao_ktx, ktx, day, phong_so, giuong'
      );
      const mapped: WorkerLite[] = (rows || []).map((r, i) => ({
        id: String(r?.id ?? `w-${i}`),
        hoVaTen: String(r?.ho_va_ten ?? ''),
        maNV: String(r?.ma_nv ?? ''),
        donVi: String(r?.don_vi ?? ''),
        gioiTinh: String(r?.gioi_tinh ?? ''),
        soDienThoai: String(r?.so_dien_thoai ?? ''),
        ngayVaoKTX: String(r?.ngay_vao_ktx ?? ''),
        ktx: String(r?.ktx ?? ''),
        day: String(r?.day ?? ''),
        phongSo: String(r?.phong_so ?? ''),
        giuong: String(r?.giuong ?? ''),
      }));
      setWorkers(mapped);
    } catch (err) {
      console.warn('[bed-management] load workers failed:', err);
    }
  }, [supabase]);

  const loadCapacities = useCallback(async () => {
    try {
      setCapacities(await fetchRoomCapacities());
    } catch (err) {
      console.warn('[bed-management] load capacities failed:', err);
    }
  }, []);

  useEffect(() => {
    loadBeds();
    loadWorkers();
    loadCapacities();
  }, [loadBeds, loadWorkers, loadCapacities]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('bed_management_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => loadBeds(true))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, () => { loadWorkers(); loadBeds(true); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, () => loadCapacities())
        .subscribe();
    } catch (err) {
      console.warn('[bed-management] realtime subscribe failed:', err);
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
  }, [supabase, loadBeds, loadWorkers, loadCapacities]);

  // ─── Derived data (null-safe) ──────────────────────────────────────────────
  const workerById = useMemo(() => {
    const map = new Map<string, WorkerLite>();
    (workers || []).forEach(w => { if (w?.id) map.set(w.id, w); });
    return map;
  }, [workers]);

  const roomCap = useCallback(
    (ktx: string, day: string, phong: string) =>
      getRoomCapacity(capacities, ktx, day, phong) || DEFAULT_ROOM_CAPACITY,
    [capacities]
  );

  const bedsFiltered = useMemo(() => {
    const ktx = (filterKtx || '').trim();
    const day = (filterDay || '').trim();
    const room = (filterRoom || '').trim();
    const q = searchQuery.trim().toLowerCase();
    return (beds || []).filter(b => {
      if (ktx && (b?.ktx || '').trim() !== ktx) return false;
      if (day && (b?.day || '').trim() !== day) return false;
      if (room && (b?.phong_so || '').trim() !== room) return false;
      if (!q) return true;
      const w = b?.worker_id ? workerById.get(b.worker_id) : null;
      const haystack = [
        b?.ktx, b?.day, b?.phong_so, b?.giuong, b?.ho_va_ten, b?.ma_nv,
        w?.donVi, w?.soDienThoai,
      ].map(v => String(v ?? '').toLowerCase());
      return haystack.some(v => v.includes(q)) || `g${String(b?.giuong ?? '').toLowerCase().replace(/[^0-9a-z]/g, '')}`.includes(q);
    });
  }, [beds, filterKtx, filterDay, filterRoom, searchQuery, workerById]);

  const ktxList = useMemo(
    () => [...new Set((beds || []).map(b => String(b?.ktx ?? '').trim()).filter(Boolean))].sort(compareKtxNames),
    [beds]
  );

  const dayList = useMemo(
    () =>
      [...new Set(
        (beds || [])
          .filter(b => String(b?.ktx ?? '').trim() === (filterKtx || '').trim())
          .map(b => String(b?.day ?? '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
    [beds, filterKtx]
  );

  const roomList = useMemo(
    () =>
      [...new Set(
        (beds || [])
          .filter(b => String(b?.ktx ?? '').trim() === (filterKtx || '').trim() && String(b?.day ?? '').trim() === (filterDay || '').trim())
          .map(b => String(b?.phong_so ?? '').trim())
          .filter(Boolean)
      )].sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b, 'vi', { numeric: true });
      }),
    [beds, filterKtx, filterDay]
  );

  interface RoomGroup {
    ktx: string;
    day: string;
    room: string;
    beds: BedRow[];
    cap: number;
    occupied: number;
    maintenance: number;
    empty: number;
    overloaded: boolean;
  }

  const roomGroups = useMemo((): RoomGroup[] => {
    const map = new Map<string, RoomGroup>();
    bedsFiltered.forEach(b => {
      const ktx = String(b?.ktx ?? '').trim() || '(Chưa phân KTX)';
      const day = String(b?.day ?? '').trim() || '(Chưa phân dãy)';
      const room = String(b?.phong_so ?? '').trim() || '(Chưa phân phòng)';
      const key = `${ktx}||${day}||${room}`;
      if (!map.has(key)) {
        map.set(key, {
          ktx, day, room,
          beds: [],
          cap: roomCap(ktx, day, room),
          occupied: 0,
          maintenance: 0,
          empty: 0,
          overloaded: false,
        });
      }
      const g = map.get(key)!;
      g.beds.push(b);
      if (b?.status === 'occupied') g.occupied++;
      else if (b?.status === 'maintenance') g.maintenance++;
      else g.empty++;
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
  }, [bedsFiltered, roomCap]);

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
      const ktx = String(b?.ktx ?? '').trim() || '(Chưa phân KTX)';
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
    return set;
  }, [beds]);

  const emptyBedsForTransfer = useMemo(() => {
    const q = transferSearch.trim().toLowerCase();
    return (beds || []).filter(b => {
      if (!b || b.status !== 'empty') return false;
      if (drawerBed && b.id === drawerBed.id) return false;
      if (!q) return true;
      return [b.ktx, b.day, b.phong_so, b.giuong].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [beds, drawerBed, transferSearch]);

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

  const handleAssign = useCallback(
    async (worker: WorkerLite) => {
      if (!assignTarget) return;
      const ok = await applyWorkerBed(worker?.id ?? '', {
        ktx: assignTarget.ktx || '',
        day: assignTarget.day || '',
        phong_so: assignTarget.phong_so || '',
        giuong: assignTarget.giuong || '',
      });
      if (ok) {
        setAssignTarget(null);
        setCandidateSearch('');
        loadBeds(true);
      }
    },
    [assignTarget, applyWorkerBed, loadBeds]
  );

  const handleRelease = useCallback(async () => {
    const wid = drawerBed?.worker_id ?? '';
    if (!wid) return;
    const ok = await applyWorkerBed(wid, { ktx: '', day: '', phong_so: '', giuong: '' });
    if (ok) {
      setDrawerBed(null);
      setTransferMode(false);
      loadBeds(true);
    }
  }, [drawerBed, applyWorkerBed, loadBeds]);

  const handleTransfer = useCallback(
    async (targetBed: BedRow) => {
      const wid = drawerBed?.worker_id ?? '';
      if (!wid || !targetBed) return;
      const ok = await applyWorkerBed(wid, {
        ktx: targetBed.ktx || '',
        day: targetBed.day || '',
        phong_so: targetBed.phong_so || '',
        giuong: targetBed.giuong || '',
      });
      if (ok) {
        setDrawerBed(null);
        setTransferMode(false);
        setTransferSearch('');
        loadBeds(true);
      }
    },
    [drawerBed, applyWorkerBed, loadBeds]
  );

  const setBedStatus = useCallback(
    async (bed: BedRow, status: BedStatus) => {
      setBusy(true);
      setActionError('');
      try {
        const { error } = await supabase
          .from('beds')
          .update({ status })
          .eq('id', bed.id);
        if (error) throw new Error(error.message);
        drawerBed && setDrawerBed(status === 'empty' ? null : { ...drawerBed, status });
        loadBeds(true);
      } catch (err: any) {
        console.error('[bed-management] set bed status failed:', err);
        setActionError(err?.message || 'Không thể cập nhật trạng thái giường.');
      } finally {
        setBusy(false);
      }
    },
    [supabase, drawerBed, loadBeds]
  );

  const candidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    return (workers || []).filter(w => {
      if (!w?.id) return false;
      if (occupiedIds.has(w.id)) return false;
      if (!q) return true;
      return [w.hoVaTen, w.maNV, w.donVi].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [workers, occupiedIds, candidateSearch]);

  const isFemale = (worker?: WorkerLite | null, fallbackName?: string | null) => {
    const g = (worker?.gioiTinh || fallbackName || '').toLowerCase();
    return g.includes('nữ') || g === 'nu' || g === 'female';
  };

  // ─── Small building blocks ─────────────────────────────────────────────────
  const statusBadge = (status: BedStatus, female: boolean) => {
    if (status === 'occupied')
      return <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${female ? 'text-pink-300' : 'text-emerald-300'}`}><UserCheck size={10} /> Đã ở</span>;
    if (status === 'maintenance')
      return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300"><Wrench size={10} /> Bảo trì</span>;
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-400"><UserX size={10} /> Trống</span>;
  };

  const bedCellClasses = (status: BedStatus, female: boolean) => {
    if (status === 'occupied')
      return female
        ? 'border-pink-500/40 bg-pink-500/10 hover:border-pink-400/70'
        : 'border-emerald-500/30 bg-emerald-500/10 hover:border-emerald-400/60';
    if (status === 'maintenance')
      return 'border-amber-500/40 bg-amber-500/10 hover:border-amber-400/70';
    return 'border-dashed border-blue-500/40 bg-blue-500/5 hover:border-blue-400/80';
  };

  const BedTooltip = ({ bed, worker }: { bed: BedRow; worker?: WorkerLite | null }) => (
    <div
      className="pointer-events-none absolute left-1/2 bottom-full z-40 mb-2 hidden sm:block w-64 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      role="tooltip"
    >
      <div className="rounded-xl border border-gray-600 bg-gray-900/95 shadow-2xl p-3 backdrop-blur-sm">
        {(() => {
          const w = bed?.worker_id ? (workerById.get(bed.worker_id) || worker) : worker;
          const name = bed?.ho_va_ten || w?.hoVaTen || null;
          const female = isFemale(w, bed?.ho_va_ten);
          return (
            <>
              <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${name ? (female ? 'bg-pink-500/20 text-pink-300' : 'bg-emerald-500/20 text-emerald-300') : 'bg-gray-700 text-gray-400'}`}>
                  {name ? name.charAt(0).toUpperCase() : <BedDouble size={16} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{name || 'Giường trống'}</p>
                  <p className="text-[11px] text-gray-400 font-tabular truncate">
                    Mã NV: {bed?.ma_nv || w?.maNV || '—'}
                  </p>
                </div>
              </div>
              {name && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] text-gray-300">
                  <dt className="flex items-center gap-1 text-gray-500"><Phone size={10} /> SĐT</dt>
                  <dd className="font-tabular truncate">{w?.soDienThoai || '—'}</dd>
                  <dt className="flex items-center gap-1 text-gray-500"><Calendar size={10} /> Vào</dt>
                  <dd className="font-tabular truncate">{w?.ngayVaoKTX || '—'}</dd>
                  <dt className="flex items-center gap-1 text-gray-500"><Briefcase size={10} /> Đơn vị</dt>
                  <dd className="truncate">{w?.donVi || '—'}</dd>
                  <dt className="flex items-center gap-1 text-gray-500"><Building2 size={10} /> Giường</dt>
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
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BedDouble size={20} className="text-primary" />
            Sơ Đồ Mặt Bằng — Quản Lý Giường
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Interactive Floor Plan đồng bộ Realtime từ <code className="text-xs">beds</code> · <code className="text-xs">workers</code> · <code className="text-xs">facilities</code>
          </p>
        </div>
        {/* View switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-muted rounded-xl p-1">
            {([
              { key: 'grid', label: 'Sơ Đồ Ma Trận', icon: LayoutGrid },
              { key: 'table', label: 'Danh Sách', icon: Table2 },
              { key: 'analytics', label: 'Lắp Đầy', icon: BarChart3 },
            ] as { key: ViewMode; label: string; icon: any }[]).map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  view === v.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <v.icon size={13} /> {v.label}
              </button>
            ))}
          </div>
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

      {actionError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          <AlertCircle size={16} className="shrink-0" />
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="ml-auto opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* ─── Top Bar Controls ─── */}
      <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">KTX</label>
            <select
              value={filterKtx}
              onChange={e => { setFilterKtx(e.target.value); setFilterDay(''); setFilterRoom(''); }}
              className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[130px] cursor-pointer"
            >
              <option value="">Tất cả KTX</option>
              {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {filterKtx && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Dãy</label>
              <select
                value={filterDay}
                onChange={e => { setFilterDay(e.target.value); setFilterRoom(''); }}
                className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[110px] cursor-pointer"
              >
                <option value="">Tất cả dãy</option>
                {dayList.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {filterKtx && filterDay && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Phòng</label>
              <select
                value={filterRoom}
                onChange={e => setFilterRoom(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[110px] cursor-pointer"
              >
                <option value="">Tất cả phòng</option>
                {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
              </select>
            </div>
          )}
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tìm kiếm nhanh</label>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tên công nhân, mã NV, số giường (G1), đơn vị…"
                className="w-full bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 p-0.5"
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
            { label: 'Tổng giường', value: bedsFiltered.length, color: 'text-gray-100' },
            { label: 'Đã ở', value: occupiedCount, color: 'text-emerald-400' },
            { label: 'Trống', value: emptyCount, color: 'text-blue-400' },
            { label: 'Bảo trì', value: maintenanceCount, color: 'text-amber-400' },
            { label: 'Tỷ lệ lấp đầy', value: `${fillRateInView}%`, color: 'text-indigo-400' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-gray-700/60 bg-gray-800/60 p-2.5">
              <p className="text-[11px] text-gray-400 font-medium">{s.label}</p>
              <p className={`text-xl font-bold font-tabular mt-0.5 ${s.color}`}>
                {typeof s.value === 'number' ? s.value.toLocaleString('vi-VN') : s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-gray-700/60">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Chú thích:</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
            <span className="w-3.5 h-3.5 rounded bg-emerald-500/30 border border-emerald-500/60" /> Đã ở (Occupied)
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
            <span className="w-3.5 h-3.5 rounded border-dashed border border-blue-500/70 bg-blue-500/10" /> Còn trống (Available)
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
            <span className="w-3.5 h-3.5 rounded bg-amber-500/30 border border-amber-500/60" /> Bảo trì (Maintenance)
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
            <span className="w-3.5 h-3.5 rounded bg-rose-500/40 border border-rose-500/70" /> Phòng quá tải
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-primary" /></div>
      ) : beds.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8 text-center space-y-2">
          <BedDouble size={34} className="mx-auto text-amber-400" />
          <p className="font-semibold text-amber-300">Chưa có dữ liệu giường trong bảng <code>beds</code></p>
          <p className="text-sm text-amber-200/80">Chạy <code className="font-mono">supabase/bootstrap.sql</code> trong SQL Editor, hoặc thêm phòng ở Cơ Sở Vật Chất — giường sẽ tự sinh.</p>
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
                  const barColor = g.overloaded ? 'bg-rose-500' : pct >= 0.9 ? 'bg-amber-400' : pct >= 0.5 ? 'bg-emerald-400' : 'bg-blue-400';
                  return (
                    <React.Fragment key={`${g.ktx}-${g.day}-${g.room}`}>
                      {showKtx && (
                        <div className="flex items-center gap-2.5 pt-2">
                          <span className="text-xs font-bold px-3 py-1 rounded-lg border bg-blue-500/15 text-blue-300 border-blue-500/30">
                            {g.ktx}
                          </span>
                          <span className="text-xs text-gray-400 font-medium">Sơ đồ mặt bằng</span>
                          <div className="flex-1 h-px bg-gray-700/60" />
                        </div>
                      )}
                      {showDay && (
                        <div className="flex items-center gap-2">
                          <Building2 size={14} className="text-indigo-400 shrink-0" />
                          <h3 className="text-sm font-bold text-white">{g.day}</h3>
                        </div>
                      )}
                      {/* Room Card */}
                      <div className={`rounded-2xl border p-3.5 shadow-xl transition-all hover:shadow-2xl ${
                        g.overloaded ? 'border-rose-500/50 bg-rose-500/5' : 'border-gray-700/60 bg-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-extrabold text-white bg-gray-800/80 border border-gray-600/60 px-2 py-0.5 rounded-lg">
                              Phòng {g.room}
                            </span>
                            {g.overloaded && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <AlertCircle size={9} /> Quá tải
                              </span>
                            )}
                            {g.maintenance > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <Wrench size={9} /> {g.maintenance} bảo trì
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-tabular font-bold text-gray-300 shrink-0">
                            {g.occupied}/{g.cap} giường
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-700/60 rounded-full overflow-hidden mb-3">
                          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                          {g.beds.map(bed => {
                            const worker = bed?.worker_id ? (workerById.get(bed.worker_id) || null) : null;
                            const occupied = bed?.status === 'occupied';
                            const maintenance = bed?.status === 'maintenance';
                            const female = occupied && isFemale(worker, bed?.ho_va_ten);
                            const unit = worker?.donVi || '';
                            const bedLabel = `G${bed?.giuong || '?'}`;
                            return (
                              <button
                                type="button"
                                key={bed?.id}
                                onClick={() => {
                                  if (occupied) {
                                    setDrawerBed(bed);
                                    setTransferMode(false);
                                  } else if (maintenance) {
                                    setDrawerBed(bed);
                                    setTransferMode(false);
                                  } else {
                                    setAssignTarget(bed);
                                    setCandidateSearch('');
                                  }
                                }}
                                className={`group relative text-left rounded-xl border p-2.5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 overflow-visible ${bedCellClasses(bed?.status ?? 'empty', female)}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-gray-300 font-tabular">
                                    <BedDouble size={11} /> {bedLabel}
                                  </span>
                                  {statusBadge(bed?.status ?? 'empty', female)}
                                </div>
                                {occupied ? (
                                  <div className="space-y-0.5 min-w-0">
                                    <p className="text-xs font-bold text-white truncate">{shortName(bed?.ho_va_ten) || shortName(worker?.hoVaTen) || '?'}</p>
                                    <p className="text-[10px] text-gray-400 font-tabular truncate">MNV {bed?.ma_nv || worker?.maNV || '—'}</p>
                                    {unit && (
                                      <span className="inline-flex max-w-full items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 truncate">
                                        {unit}
                                      </span>
                                    )}
                                  </div>
                                ) : maintenance ? (
                                  <p className="text-[11px] font-semibold text-amber-300">Đang kiểm tra / sửa</p>
                                ) : (
                                  <p className="text-[11px] text-blue-300/80 italic">Bấm để gán…</p>
                                )}
                                {occupied && <BedTooltip bed={bed} worker={worker} />}
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
            <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl shadow-xl overflow-hidden">
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/60 text-left">
                      {['KTX', 'Dãy', 'Phòng', 'Giường', 'Trạng thái', 'Họ tên', 'Mã NV', 'Đơn vị', 'SĐT', 'Ngày vào', 'Thao tác'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {bedsFiltered.map(bed => {
                      const worker = bed?.worker_id ? (workerById.get(bed.worker_id) || null) : null;
                      const female = isFemale(worker, bed?.ho_va_ten);
                      return (
                        <tr key={bed?.id} className="hover:bg-gray-800/60 transition-colors">
                          <td className="px-3 py-2 text-xs font-bold text-gray-200 whitespace-nowrap">{bed?.ktx || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300 whitespace-nowrap">{bed?.day || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300 font-tabular whitespace-nowrap">P{bed?.phong_so || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-200 font-tabular whitespace-nowrap">G{bed?.giuong || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {bed?.status === 'occupied'
                              ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${female ? 'bg-pink-500/15 text-pink-300 border-pink-500/40' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'}`}>Đã ở</span>
                              : bed?.status === 'maintenance'
                              ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-500/15 text-amber-300 border-amber-500/40">Bảo trì</span>
                              : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border border-dashed bg-blue-500/10 text-blue-300 border-blue-500/40">Trống</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-100 font-semibold truncate max-w-[160px]">{bed?.ho_va_ten || worker?.hoVaTen || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300 font-tabular whitespace-nowrap">{bed?.ma_nv || worker?.maNV || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300 truncate max-w-[130px]">{worker?.donVi || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300 font-tabular whitespace-nowrap">{worker?.soDienThoai || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300 font-tabular whitespace-nowrap">{worker?.ngayVaoKTX || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {bed?.status === 'empty' && (
                                <button
                                  type="button"
                                  onClick={() => { setAssignTarget(bed); setCandidateSearch(''); }}
                                  disabled={busy}
                                  className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-500/20 border border-blue-500/30 disabled:opacity-50"
                                  title="Gán công nhân"
                                >
                                  <UserPlus size={13} />
                                </button>
                              )}
                              {bed?.status === 'occupied' && (
                                <button
                                  type="button"
                                  onClick={() => { setDrawerBed(bed); setTransferMode(false); }}
                                  className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30"
                                  title="Chi tiết / thao tác"
                                >
                                  <ExternalLink size={13} />
                                </button>
                              )}
                              {bed?.status === 'empty' && (
                                <button
                                  type="button"
                                  onClick={() => setBedStatus(bed, 'maintenance')}
                                  disabled={busy}
                                  className="p-1.5 rounded-lg text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 disabled:opacity-50"
                                  title="Đánh dấu bảo trì"
                                >
                                  <Wrench size={13} />
                                </button>
                              )}
                              {bed?.status === 'maintenance' && (
                                <button
                                  type="button"
                                  onClick={() => setBedStatus(bed, 'empty')}
                                  disabled={busy}
                                  className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30 disabled:opacity-50"
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
                      <tr><td colSpan={11} className="px-3 py-10 text-center text-xs text-gray-500 italic">Không có giường nào khớp bộ lọc.</td></tr>
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
                  { label: 'Tổng giường', value: bedsFiltered.length, color: 'text-gray-100 border-gray-700' },
                  { label: 'Đã ở', value: occupiedCount, color: 'text-emerald-400 border-emerald-500/30' },
                  { label: 'Trống', value: emptyCount, color: 'text-blue-400 border-blue-500/30' },
                  { label: 'Bảo trì', value: maintenanceCount, color: 'text-amber-400 border-amber-500/30' },
                  { label: 'Tỷ lệ lấp đầy', value: `${fillRateInView}%`, color: 'text-indigo-400 border-indigo-500/30' },
                ].map(s => (
                  <div key={s.label} className={`rounded-2xl border bg-[#1F2937] p-4 shadow-xl ${s.color}`}>
                    <p className="text-xs text-gray-400 font-medium">{s.label}</p>
                    <p className={`text-2xl font-bold font-tabular mt-1 ${s.color}`}>
                      {typeof s.value === 'number' ? s.value.toLocaleString('vi-VN') : s.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl p-5 shadow-xl space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><BarChart3 size={15} className="text-indigo-400" /> Lấp đầy theo KTX</h3>
                {perKtxStats.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">Không có dữ liệu.</p>
                ) : (
                  perKtxStats.map(s => {
                    const rate = s.total > 0 ? s.occupied / s.total : 0;
                    return (
                      <div key={s.ktx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-gray-200">{s.ktx}</span>
                          <span className="text-gray-400 font-tabular">
                            {s.occupied}/{s.total} · Trống {s.empty} · BT {s.maintenance} · <b className="text-indigo-300">{Math.round(rate * 100)}%</b>
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-700/60 rounded-full overflow-hidden flex" aria-hidden="true">
                          <div className="h-full bg-emerald-400" style={{ width: `${(s.occupied / Math.max(s.total, 1)) * 100}%` }} />
                          <div className="h-full bg-amber-400" style={{ width: `${(s.maintenance / Math.max(s.total, 1)) * 100}%` }} />
                          <div className="h-full bg-blue-500/60" style={{ width: `${(s.empty / Math.max(s.total, 1)) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
                <p className="text-[10px] text-gray-500 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-1 rounded bg-emerald-400" /> Đã ở</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-1 rounded bg-amber-400" /> Bảo trì</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-1 rounded bg-blue-500/60" /> Trống</span>
                </p>
              </div>

              <div className="bg-[#1F2937] border border-rose-500/40 rounded-2xl p-5 shadow-xl space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><AlertCircle size={15} className="text-rose-400" /> Phòng cần hỗ trợ (Quá tải)</h3>
                {overloadedRooms.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">Không có phòng nào quá tải.</p>
                ) : (
                  overloadedRooms.map(g => (
                    <div key={`${g.ktx}-${g.day}-${g.room}`} className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                      <span className="text-xs text-rose-200">
                        <b>{g.ktx || '—'}</b> · {g.day} · Phòng {g.room}
                      </span>
                      <span className="text-xs font-tabular font-bold text-rose-300">{g.occupied}/{g.cap} giường</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Assign Modal ─── */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setAssignTarget(null)}>
          <div className="bg-[#1F2937] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2"><UserCheck size={16} className="text-emerald-400" /> Gán công nhân vào giường</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {assignTarget.ktx || '(KTX)'} · {assignTarget.day || '(Dãy)'} · Phòng {assignTarget.phong_so || '?'} · Giường {assignTarget.giuong || '?'}
                </p>
              </div>
              <button onClick={() => { setAssignTarget(null); setActionError(''); }} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-5 pt-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  autoFocus
                  value={candidateSearch}
                  onChange={e => setCandidateSearch(e.target.value)}
                  placeholder="Tìm công nhân theo tên / mã NV / đơn vị…"
                  className="w-full bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {candidates.length === 0 ? (
                <p className="text-sm text-gray-500 italic text-center py-8">Không tìm thấy công nhân phù hợp.</p>
              ) : (
                candidates.slice(0, 60).map(w => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssign(w)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-700/60 hover:border-blue-500/50 hover:bg-gray-800/80 transition-colors disabled:opacity-60"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-300 text-xs font-bold shrink-0">
                      {String(w?.hoVaTen || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{w?.hoVaTen || '(Không tên)'}</p>
                      <p className="text-[11px] text-gray-400 font-tabular truncate">{w?.maNV || '—'} · {w?.donVi || '—'}</p>
                    </div>
                    <UserCheck size={15} className="text-emerald-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
            {busy && (
              <div className="px-5 py-3 border-t border-gray-700 flex items-center gap-2 text-xs text-gray-300">
                <Loader2 size={13} className="animate-spin" /> Đang gán giường…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Quick Drawer (right side) ─── */}
      {drawerBed && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => { setDrawerBed(null); setTransferMode(false); }} />
          <div
            className="fixed z-50 animate-slide-in-right bottom-0 inset-x-0 max-h-[85vh] sm:max-h-full sm:top-0 sm:right-0 sm:left-auto sm:inset-x-auto sm:h-full w-full sm:max-w-md bg-[#1F2937] border-t sm:border-t-0 sm:border-l border-gray-700/80 text-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/80 bg-gray-900/60">
              <div className="min-w-0">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <BedDouble size={16} className="text-primary" /> Giường {drawerBed?.giuong || '?'}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5 font-tabular truncate">
                  {[drawerBed?.ktx, drawerBed?.day, `Phòng ${drawerBed?.phong_so || '?'}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              {drawerBed?.status === 'maintenance' && (
                <span className="hidden sm:inline-flex mx-2 items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0"><Wrench size={10} /> Bảo trì</span>
              )}
              <button onClick={() => { setDrawerBed(null); setTransferMode(false); }} className="p-2 rounded-xl hover:bg-gray-800 text-gray-400 hover:text-white shrink-0"><X size={18} /></button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto scrollbar-thin">
              {(() => {
                const w = drawerBed?.worker_id ? (workerById.get(drawerBed.worker_id) || null) : null;
                const name = drawerBed?.ho_va_ten || w?.hoVaTen || '';
                const female = isFemale(w, drawerBed?.ho_va_ten);
                if (!name) {
                  return (
                    <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-200">
                      Giường đang trống. Bấm <b>Gán công nhân</b> bên dưới để cấp vị trí.
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-4 rounded-xl border border-gray-700/60 bg-gray-800/60 p-4">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${female ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'}`}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-base font-bold text-white flex items-center gap-2 truncate">
                        {name}
                        {female && <VenusAndMars size={14} className="text-pink-300 shrink-0" />}
                      </p>
                      <p className="text-xs text-gray-300 font-tabular flex items-center gap-1.5"><User size={11} className="shrink-0" /> Mã NV: {drawerBed?.ma_nv || w?.maNV || '—'}</p>
                      <p className="text-xs text-gray-300 flex items-center gap-1.5 truncate"><Briefcase size={11} className="shrink-0" /> Đơn vị: {w?.donVi || '—'}</p>
                      <p className="text-xs text-gray-300 font-tabular flex items-center gap-1.5"><Phone size={11} className="shrink-0" /> SĐT: {w?.soDienThoai || '—'}</p>
                      <p className="text-xs text-gray-300 font-tabular flex items-center gap-1.5"><Calendar size={11} className="shrink-0" /> Ngày vào: {w?.ngayVaoKTX || '—'}</p>
                    </div>
                  </div>
                );
              })()}

              {transferMode ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5"><ArrowRightLeft size={12} className="text-blue-400" /> Chọn giường trống mới</p>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      autoFocus
                      value={transferSearch}
                      onChange={e => setTransferSearch(e.target.value)}
                      placeholder="KTX / dãy / phòng / số giường…"
                      className="w-full bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1.5">
                    {emptyBedsForTransfer.length === 0 ? (
                      <p className="text-sm text-gray-500 italic text-center py-6">Không còn giường trống nào.</p>
                    ) : (
                      emptyBedsForTransfer.slice(0, 60).map(b => (
                        <button
                          key={b.id}
                          type="button"
                          disabled={busy}
                          onClick={() => handleTransfer(b)}
                          className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-700/60 hover:border-blue-500/50 hover:bg-gray-800/80 transition-colors text-sm disabled:opacity-60"
                        >
                          <span className="text-gray-200 font-tabular truncate">
                            <b>{b?.ktx || '—'}</b> · {b?.day || '—'} · P{b?.phong_so || '—'} · G{b?.giuong || '—'}
                          </span>
                          <ArrowRightLeft size={14} className="text-blue-400 shrink-0" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {drawerBed?.status === 'occupied' && (
                    <>
                      <button
                        type="button"
                        disabled={!drawerBed?.worker_id || busy}
                        onClick={() => { setTransferMode(true); setTransferSearch(''); }}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                      >
                        <ArrowRightLeft size={14} /> Chuyển giường nhanh
                      </button>
                      <button
                        type="button"
                        disabled={!drawerBed?.worker_id || busy}
                        onClick={handleRelease}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} />} Trả phòng / Yêu cầu check-out
                      </button>
                    </>
                  )}
                  {drawerBed?.status === 'maintenance' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setBedStatus(drawerBed, 'empty')}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Hoàn tất — Bỏ bảo trì
                    </button>
                  )}
                </div>
              )}

              {busy && !transferMode && (
                <p className="text-xs text-gray-300 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Đang xử lý…</p>
              )}

              <button
                type="button"
                onClick={() => router.push('/worker-management')}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-xs font-semibold transition-colors"
              >
                <ExternalLink size={12} /> Mở hồ sơ trong Quản Lý Công Nhân
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
