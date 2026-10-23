'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  BedDouble, RefreshCw, Search, X, User, UserCheck, UserX, LogOut,
  ArrowRightLeft, Loader2, Building2, Phone, Briefcase, VenusAndMars, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { compareKtxNames, DEFAULT_ROOM_CAPACITY } from '@/data/workers';

interface BedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'empty' | 'occupied';
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
  ktx: string;
  day: string;
  phongSo: string;
  giuong: string;
}

const PAGE = 1000;

async function fetchAllRows<T>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  select: string,
  order?: string
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  // Sanità limit of 30 pages (30,000 rows) to avoid runaway loops on bad data.
  for (let page = 0; page < 30; page++) {
    try {
      let query = supabase.from(table).select(select).range(from, from + PAGE - 1);
      if (order) query = query.order(order, { ascending: true });
      const { data, error } = await query;
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

export default function BedManagementClient() {
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [workers, setWorkers] = useState<WorkerLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState('');

  const [filterKtx, setFilterKtx] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [filterRoom, setFilterRoom] = useState('');

  // Assign modal
  const [assignTarget, setAssignTarget] = useState<BedRow | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Detail modal for occupied bed
  const [detailTarget, setDetailTarget] = useState<BedRow | null>(null);
  const [transferMode, setTransferMode] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const loadBeds = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await fetchAllRows<Record<string, unknown>>(supabase, 'beds', '*', '');
      const mapped: BedRow[] = (rows || []).map((r, i) => ({
        id: String(r?.id ?? `bed-${i}`),
        ktx: String(r?.ktx ?? ''),
        day: String(r?.day ?? ''),
        phong_so: String(r?.phong_so ?? ''),
        giuong: String(r?.giuong ?? ''),
        status: r?.status === 'occupied' ? 'occupied' : 'empty',
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
        'id, ho_va_ten, ma_nv, don_vi, gioi_tinh, so_dien_thoai, ktx, day, phong_so, giuong'
      );
      const mapped: WorkerLite[] = (rows || []).map((r, i) => ({
        id: String(r?.id ?? `w-${i}`),
        hoVaTen: String(r?.ho_va_ten ?? ''),
        maNV: String(r?.ma_nv ?? ''),
        donVi: String(r?.don_vi ?? ''),
        gioiTinh: String(r?.gioi_tinh ?? ''),
        soDienThoai: String(r?.so_dien_thoai ?? ''),
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

  useEffect(() => {
    loadBeds();
    loadWorkers();
  }, [loadBeds, loadWorkers]);

  // Realtime: bed occupancy + worker profile changes propagate instantly (no F5).
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('bed_management_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => {
          loadBeds(true);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, () => {
          loadWorkers();
        })
        .subscribe();
    } catch (err) {
      console.warn('[bed-management] realtime subscribe failed:', err);
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
  }, [supabase, loadBeds, loadWorkers]);

  // ─── Distinct discovery from beds (no static arrays) ──────────────────────
  const ktxList = useMemo(
    () => [...new Set(beds.map(b => (b.ktx || '').trim()).filter(Boolean))].sort(compareKtxNames),
    [beds]
  );
  const dayList = useMemo(
    () =>
      [...new Set(beds.filter(b => (b.ktx || '').trim() === (filterKtx || '').trim()).map(b => (b.day || '').trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, 'vi', { numeric: true })
      ),
    [beds, filterKtx]
  );
  const roomList = useMemo(
    () =>
      [
        ...new Set(
          beds
            .filter(b => (b.ktx || '').trim() === (filterKtx || '').trim() && (b.day || '').trim() === (filterDay || '').trim())
            .map(b => (b.phong_so || '').trim())
            .filter(Boolean)
        ),
      ].sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b, 'vi', { numeric: true });
      }),
    [beds, filterKtx, filterDay]
  );

  const bedsInView = useMemo(() => {
    return (beds || []).filter(b => {
      if (filterKtx && (b.ktx || '').trim() !== filterKtx.trim()) return false;
      if (filterDay && (b.day || '').trim() !== filterDay.trim()) return false;
      if (filterRoom && (b.phong_so || '').trim() !== filterRoom.trim()) return false;
      return true;
    });
  }, [beds, filterKtx, filterDay, filterRoom]);

  const occupiedCount = useMemo(() => bedsInView.filter(b => b.status === 'occupied').length, [bedsInView]);
  const emptyCount = useMemo(() => bedsInView.length - occupiedCount, [bedsInView]);
  const workerById = useMemo(() => {
    const map = new Map<string, WorkerLite>();
    (workers || []).forEach(w => { if (w?.id) map.set(w.id, w); });
    return map;
  }, [workers]);

  // Group beds in view: ktx → day → phong_so
  const grouped = useMemo(() => {
    const result: { day: string; rooms: { room: string; beds: BedRow[] }[] }[] = [];
    const dayMap = new Map<string, Map<string, BedRow[]>>();
    bedsInView.forEach(b => {
      const day = (b.day || '').trim() || '(Chưa phân dãy)';
      const room = (b.phong_so || '').trim() || '(Chưa phân phòng)';
      if (!dayMap.has(day)) dayMap.set(day, new Map());
      const roomMap = dayMap.get(day)!;
      if (!roomMap.has(room)) roomMap.set(room, []);
      roomMap.get(room)!.push(b);
    });
    const sortedDays = [...dayMap.keys()].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    sortedDays.forEach(day => {
      const roomMap = dayMap.get(day)!;
      const rooms = [...roomMap.entries()]
        .map(([room, list]) => ({
          room,
          beds: list.sort((a, b) => {
            const na = parseInt((a.giuong || '').replace(/\D/g, ''), 10);
            const nb = parseInt((b.giuong || '').replace(/\D/g, ''), 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return (a.giuong || '').localeCompare(b.giuong || '', 'vi', { numeric: true });
          }),
        }))
        .sort((a, b) => {
          const na = parseInt(a.room.replace(/\D/g, ''), 10);
          const nb = parseInt(b.room.replace(/\D/g, ''), 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.room.localeCompare(b.room, 'vi', { numeric: true });
        });
      result.push({ day, rooms });
    });
    return result;
  }, [bedsInView]);

  const occupiedIds = useMemo(() => {
    const set = new Set<string>();
    (beds || []).forEach(b => { if (b.worker_id) set.add(b.worker_id); });
    return set;
  }, [beds]);

  const candidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    return (workers || []).filter(w => {
      if (!w?.id) return false;
      if (occupiedIds.has(w.id)) return false;
      if (!q) return true;
      return (
        (w.hoVaTen || '').toLowerCase().includes(q) ||
        (w.maNV || '').toLowerCase().includes(q) ||
        (w.donVi || '').toLowerCase().includes(q)
      );
    });
  }, [workers, occupiedIds, candidateSearch]);

  const emptyBedsForTransfer = useMemo(() => {
    const q = transferSearch.trim().toLowerCase();
    return (beds || []).filter(b => {
      if (!b || b.status !== 'empty') return false;
      if (detailTarget) {
        // Same (ktx, day, phong_so) bed cannot be transferred onto itself… but it's empty anyway.
        if (b.id === detailTarget.id) return false;
      }
      if (!q) return true;
      return (
        (b.ktx || '').toLowerCase().includes(q) ||
        (b.day || '').toLowerCase().includes(q) ||
        (b.phong_so || '').toLowerCase().includes(q) ||
        (b.giuong || '').toLowerCase().includes(q)
      );
    });
  }, [beds, detailTarget, transferSearch]);

  // ─── Mutations ────────────────────────────────────────────────────────────
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
        // Trigger sync_bed_occupancy updates `beds`; realtime refreshes the grid.
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
    const wid = detailTarget?.worker_id ?? '';
    if (!wid) return;
    setBusy(true);
    setActionError('');
    try {
      const { error } = await supabase
        .from('workers')
        .update({ ktx: '', day: '', phong_so: '', giuong: '' })
        .eq('id', wid);
      if (error) throw new Error(error.message);
      setDetailTarget(null);
      setTransferMode(false);
      loadBeds(true);
    } catch (err: any) {
      console.error('[bed-management] release bed failed:', err);
      setActionError(err?.message || 'Không thể trả phòng — thử lại.');
    } finally {
      setBusy(false);
    }
  }, [detailTarget, supabase, loadBeds]);

  const handleTransfer = useCallback(
    async (targetBed: BedRow) => {
      const wid = detailTarget?.worker_id ?? '';
      if (!wid || !targetBed) return;
      const ok = await applyWorkerBed(wid, {
        ktx: targetBed.ktx || '',
        day: targetBed.day || '',
        phong_so: targetBed.phong_so || '',
        giuong: targetBed.giuong || '',
      });
      if (ok) {
        setDetailTarget(null);
        setTransferMode(false);
        setTransferSearch('');
        loadBeds(true);
      }
    },
    [detailTarget, applyWorkerBed, loadBeds]
  );

  const isFemale = (worker?: WorkerLite | null, fallbackName?: string | null) => {
    const g = (worker?.gioiTinh || fallbackName || '').toLowerCase();
    return g.includes('nữ') || g === 'nu' || g === 'female';
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BedDouble size={20} className="text-primary" />
            Quản Lý Giường &amp; Sơ Đồ KTX
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sơ đồ giường động — quét trực tiếp từ bảng <code className="text-xs">beds</code> + <code className="text-xs">workers</code> trên Supabase
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadBeds(); loadWorkers(); }}
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

      {/* Stats + Filters */}
      <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Tổng giường', value: bedsInView.length, color: 'text-gray-100' },
            { label: 'Đã ở', value: occupiedCount, color: 'text-emerald-400' },
            { label: 'Trống', value: emptyCount, color: 'text-blue-400' },
            { label: 'KTX hiện có', value: ktxList.length, color: 'text-indigo-400' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-gray-700/60 bg-gray-800/60 p-3">
              <p className="text-xs text-gray-400 font-medium">{s.label}</p>
              <p className={`text-2xl font-bold font-tabular mt-0.5 ${s.color}`}>{s.value.toLocaleString('vi-VN')}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">KTX</label>
            <select
              value={filterKtx}
              onChange={e => { setFilterKtx(e.target.value); setFilterDay(''); setFilterRoom(''); }}
              className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[140px] cursor-pointer"
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
                className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-[120px] cursor-pointer"
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
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-primary" /></div>
      ) : beds.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8 text-center space-y-2">
          <BedDouble size={34} className="mx-auto text-amber-400" />
          <p className="font-semibold text-amber-300">Chưa có dữ liệu giường trong bảng <code>beds</code></p>
          <p className="text-sm text-amber-200/80">Hãy chạy <code className="font-mono">supabase/bootstrap.sql</code> trong Supabase SQL Editor, hoặc thêm phòng trong Cơ Sở Vật Chất — hệ thống sẽ tự sinh giường.</p>
        </div>
      ) : bedsInView.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Không có giường nào khớp bộ lọc.</p>
      ) : (
        <div className="space-y-5">
          {grouped.map(group => (
            <div key={group.day} className="rounded-2xl bg-[#1F2937] border border-gray-700/60 p-4 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={14} className="text-blue-400 shrink-0" />
                <h3 className="text-sm font-bold text-white">{group.day}</h3>
                <span className="text-xs text-gray-400 font-tabular">
                  · {group.rooms.reduce((s, r) => s + r.beds.length, 0)} giường
                </span>
              </div>
              <div className="space-y-4">
                {group.rooms.map(roomGroup => (
                  <div key={roomGroup.room}>
                    <p className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                      Phòng {roomGroup.room}
                      <span className="text-[10px] text-gray-500 font-normal">({roomGroup.beds.length} giường)</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {roomGroup.beds.map(bed => {
                        const worker = bed.worker_id ? (workerById.get(bed.worker_id) || null) : null;
                        const occupied = bed.status === 'occupied';
                        const female = occupied && isFemale(worker, bed.ho_va_ten);
                        return (
                          <button
                            type="button"
                            key={bed.id}
                            onClick={() => {
                              if (occupied) {
                                setDetailTarget(bed);
                                setTransferMode(false);
                              } else {
                                setAssignTarget(bed);
                                setCandidateSearch('');
                              }
                            }}
                            className={`text-left rounded-xl border p-3 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                              occupied
                                ? female
                                  ? 'border-pink-500/40 bg-pink-500/10 hover:border-pink-400/70'
                                  : 'border-emerald-500/30 bg-emerald-500/10 hover:border-emerald-400/60'
                                : 'border-dashed border-gray-600 bg-gray-800/40 hover:border-blue-500/60'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold text-gray-400 font-tabular">
                                Giường {bed.giuong || '—'}
                              </span>
                              {occupied ? (
                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${female ? 'text-pink-300' : 'text-emerald-300'}`}>
                                  <UserCheck size={10} /> Đã ở
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-400">
                                  <UserX size={10} /> Trống
                                </span>
                              )}
                            </div>
                            {occupied ? (
                              <div className="space-y-0.5 min-w-0">
                                <p className="text-sm font-bold text-white truncate">{bed.ho_va_ten || worker?.hoVaTen || '(Không rõ tên)'}</p>
                                <p className="text-[11px] text-gray-400 font-tabular truncate">Mã NV: {bed.ma_nv || worker?.maNV || '—'}</p>
                                <p className="text-[11px] text-gray-400 truncate flex items-center gap-1">
                                  <Briefcase size={10} className="shrink-0" />
                                  {worker?.donVi || '—'}
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500 italic">Bấm để gán công nhân…</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Assign modal ─── */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setAssignTarget(null)}>
          <div
            className="bg-[#1F2937] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div>
                <h3 className="font-bold text-white">Gán công nhân vào giường</h3>
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
                      {(w?.hoVaTen || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{w?.hoVaTen || '(Không tên)'}</p>
                      <p className="text-[11px] text-gray-400 font-tabular truncate">
                        {w?.maNV || '—'} · {w?.donVi || '—'}
                      </p>
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

      {/* ─── Detail / Transfer modal ─── */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setDetailTarget(null); setTransferMode(false); }}>
          <div
            className="bg-[#1F2937] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div>
                <h3 className="font-bold text-white">Chi tiết giường</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {detailTarget.ktx || '(KTX)'} · {detailTarget.day || '(Dãy)'} · Phòng {detailTarget.phong_so || '?'} · Giường {detailTarget.giuong || '?'}
                </p>
              </div>
              <button onClick={() => setDetailTarget(null)} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"><X size={16} /></button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {(() => {
                const w = detailTarget.worker_id ? (workerById.get(detailTarget.worker_id) || null) : null;
                const name = detailTarget.ho_va_ten || w?.hoVaTen || '(Không rõ tên)';
                const maNv = detailTarget.ma_nv || w?.maNV || '—';
                return (
                  <>
                    <div className="flex items-center gap-4 rounded-xl border border-gray-700/60 bg-gray-800/60 p-4">
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${isFemale(w, detailTarget.ho_va_ten) ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40' : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'}`}>
                        {(name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-base font-bold text-white flex items-center gap-2">
                          {name}
                          {isFemale(w, detailTarget.ho_va_ten) && <VenusAndMars size={14} className="text-pink-300" />}
                        </p>
                        <p className="text-xs text-gray-300 font-tabular flex items-center gap-1.5"><User size={11} /> Mã NV: {maNv}</p>
                        <p className="text-xs text-gray-300 flex items-center gap-1.5"><Briefcase size={11} /> Đơn vị: {w?.donVi || '—'}</p>
                        <p className="text-xs text-gray-300 font-tabular flex items-center gap-1.5"><Phone size={11} /> SĐT: {w?.soDienThoai || '—'}</p>
                      </div>
                    </div>

                    {transferMode ? (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                          <input
                            autoFocus
                            value={transferSearch}
                            onChange={e => setTransferSearch(e.target.value)}
                            placeholder="Tìm giường trống (KTX / dãy / phòng / giường)…"
                            className="w-full bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          />
                        </div>
                        <div className="max-h-52 overflow-y-auto space-y-1.5">
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
                                <span className="text-gray-200">
                                  <b className="font-tabular">{b.ktx || '—'}</b> · {b.day || '—'} · P{b.phong_so || '—'} · Giường {b.giuong || '—'}
                                </span>
                                <ArrowRightLeft size={14} className="text-blue-400 shrink-0" />
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!detailTarget.worker_id || busy}
                          onClick={() => { setTransferMode(true); setTransferSearch(''); }}
                          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          <ArrowRightLeft size={14} /> Chuyển giường
                        </button>
                        <button
                          type="button"
                          disabled={!detailTarget.worker_id || busy}
                          onClick={handleRelease}
                          className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Trả phòng
                        </button>
                      </div>
                    )}
                    {busy && transferMode && (
                      <p className="text-xs text-gray-300 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Đang xử lý…</p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
