'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  BedDouble, RefreshCw, Search, X, User, UserCheck, UserX, Loader2,
  Wrench, DoorOpen, Phone, Briefcase, VenusAndMars, Calendar,
  CheckCircle2, AlertCircle, ScanLine,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface BedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'empty' | 'occupied' | 'maintenance';
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

function renderSkeleton() {
  return (
    <div className="min-h-screen bg-[#0B0F17] p-4 flex items-center justify-center" suppressHydrationWarning>
      <div className="w-full max-w-md rounded-2xl border border-slate-800/80 bg-[#131B2E] p-6 space-y-4 animate-pulse">
        <div className="h-6 w-40 bg-white/10 rounded" />
        <div className="h-32 bg-white/10 rounded-xl" />
        <div className="h-10 bg-white/10 rounded-xl" />
      </div>
    </div>
  );
}

export default function BedInspectClient() {
  const [isMounted, setIsMounted] = useState(false);
  const [bed, setBed] = useState<BedRow | null>(null);
  const [worker, setWorker] = useState<WorkerLite | null>(null);
  const [bedLookup, setBedLookup] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [workers, setWorkers] = useState<WorkerLite[]>([]);
  const [busy, setBusy] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  // 1. Read URL params: bed_qr (uuid hoặc "KTX|Dãy|Phòng|Giường") hoặc bộ (ktx,day,phong_so,giuong)
  useEffect(() => {
    setIsMounted(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const ktx = (params.get('ktx') || '').trim();
      const day = (params.get('day') || '').trim();
      const phong = (params.get('phong_so') || params.get('phong') || '').trim();
      const giuong = (params.get('giuong') || params.get('bed') || '').trim();
      // bed_qr: UUID của bảng beds, hoặc chuỗi "KTX|Dãy|Phòng|Giường"
      const bedQr = (params.get('bed_qr') || '').trim();
      const qr = bedQr || (ktx && day && phong && giuong ? `${ktx}|${day}|${phong}|${giuong}` : '');
      setBedLookup({ ktx, day, phong, giuong, qr });
    } catch (err) {
      console.warn('[bed-inspector] parse url failed:', err);
    }
  }, []);

  /** Resolve bed by UUID, encoded "ktx|day|phong|giuong" hoặc 4 tham số riêng lẻ. */
  const findBed = useCallback(
    async (lookup: any): Promise<BedRow | null> => {
      if (!lookup || !supabase) return null;
      try {
        if (lookup.qr) {
          const qr = String(lookup.qr);
          // a) QR là UUID của bảng beds
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qr);
          if (isUuid) {
            const { data, error } = await supabase.from('beds').select('*').eq('id', qr).maybeSingle();
            if (!error && data) return mapBed(data);
          }
          // b) QR mã hóa "KTX|Dãy|Phòng|Giường"
          const parts = qr.split('|').map((p: string) => p.trim());
          if (parts.length === 4 && parts.every(Boolean)) {
            const { data, error } = await supabase
              .from('beds')
              .select('*')
              .eq('ktx', parts[0])
              .eq('day', parts[1])
              .eq('phong_so', parts[2])
              .eq('giuong', parts[3])
              .maybeSingle();
            if (!error && data) return mapBed(data);
          }
        }
        // c) 4 tham số riêng lẻ trên URL
        if (lookup.ktx && lookup.day && lookup.phong && lookup.giuong) {
          const { data, error } = await supabase
            .from('beds')
            .select('*')
            .eq('ktx', lookup.ktx)
            .eq('day', lookup.day)
            .eq('phong_so', lookup.phong)
            .eq('giuong', lookup.giuong)
            .maybeSingle();
          if (!error && data) return mapBed(data);
        }
      } catch (err) {
        console.warn('[bed-inspector] find bed failed:', err);
      }
      return null;
    },
    [supabase]
  );

  const loadBedData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const found = await findBed(bedLookup);
        if (!found) {
          setNotFound(true);
          setBed(null);
        } else {
          setNotFound(false);
          setBed(found);
          // Worker detail: ưu tiên worker_id, fallback theo ma_nv
          let w: WorkerLite | null = null;
          try {
            if (found.worker_id) {
              const { data } = await supabase.from('workers').select('*').eq('id', found.worker_id).maybeSingle();
              if (data) w = mapWorker(data);
            }
            if (!w && found.ma_nv) {
              const { data } = await supabase.from('workers').select('*').eq('ma_nv', found.ma_nv).limit(1);
              if (data && data[0]) w = mapWorker(data[0]);
            }
          } catch (err) {
            console.warn('[bed-inspector] load worker failed:', err);
          }
          setWorker(w);
        }
      } catch (err) {
        console.warn('[bed-inspector] load bed failed:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [bedLookup, findBed, supabase]
  );

  const loadWorkers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('workers')
        .select('id, ho_va_ten, ma_nv, cccd, don_vi, gioi_tinh, so_dien_thoai, ngay_vao_ktx, ktx, day, phong_so, giuong')
        .limit(5000);
      if (error) {
        console.warn('[bed-inspector] load workers failed:', error.message);
        return;
      }
      setWorkers((data || []).map(mapWorker).filter((w): w is WorkerLite => Boolean(w)));
    } catch (err) {
      console.warn('[bed-inspector] load workers failed:', err);
    }
  }, [supabase]);

  // Realtime — đồng bộ tức thời với /bed-management
  useEffect(() => {
    if (!isMounted) return;
    loadBedData();
    loadWorkers();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('bed_inspect_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => loadBedData(true))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, () => { loadBedData(true); loadWorkers(); })
        .subscribe();
    } catch (err) {
      console.warn('[bed-inspector] realtime failed:', err);
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, bedLookup]);

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const setBedStatus = useCallback(
    async (status: 'maintenance' | 'empty') => {
      if (!bed) return;
      setBusy(true);
      setMessage('');
      try {
        const { error } = await supabase.from('beds').update({ status }).eq('id', bed.id);
        if (error) throw new Error(error.message);
        setMessage(status === 'maintenance' ? '🔧 Đã chuyển giường sang bảo trì.' : '✅ Giường đã sẵn sàng sử dụng lại.');
      } catch (err: any) {
        console.error('[bed-inspector] set status failed:', err);
        setMessage(err?.message || 'Không thể cập nhật trạng thái giường.');
      } finally {
        setBusy(false);
      }
    },
    [bed, supabase]
  );

  const confirmPresence = useCallback(async () => {
    if (!bed) return;
    setBusy(true);
    setMessage('');
    try {
      const logId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`;
      const { error } = await supabase.from('audit_logs').insert({
        id: logId,
        timestamp: new Date().toISOString(),
        account: worker?.hoVaTen || bed.ho_va_ten || 'Kiểm tra giường',
        action: 'BED_INSPECT_CONFIRM',
        detail: JSON.stringify({
          bed_id: bed.id,
          ktx: bed.ktx,
          day: bed.day,
          phong_so: bed.phong_so,
          giuong: bed.giuong,
          ma_nv: bed.ma_nv || worker?.maNV || '',
          ho_va_ten: bed.ho_va_ten || worker?.hoVaTen || '',
          don_vi: worker?.donVi || '',
          ngay_vao_ktx: worker?.ngayVaoKTX || '',
          confirmed_at: new Date().toISOString(),
        }),
      });
      if (error) throw new Error(error.message);
      setMessage('✓ Đã xác nhận có mặt và lưu log hệ thống.');
    } catch (err: any) {
      console.error('[bed-inspector] confirm presence failed:', err);
      setMessage(err?.message || 'Không thể lưu log xác nhận.');
    } finally {
      setBusy(false);
    }
  }, [bed, worker, supabase]);

  const requestCheckout = useCallback(async () => {
    if (!bed) return;
    setBusy(true);
    setMessage('');
    try {
      const now = new Date().toISOString();
      const note = `[CHECKOUT] Lý do: Qua Kiểm Tra Giường QR${now ? ` | Ngày dự kiến dọn ra: ${now.split('T')[0]}` : ''}`;
      const { error } = await supabase.from('worker_registrations').insert({
        ho_va_ten: bed.ho_va_ten || worker?.hoVaTen || '',
        ma_nv: bed.ma_nv || worker?.maNV || '',
        so_cccd: worker?.cccd || '',
        so_dien_thoai: worker?.soDienThoai || '',
        ktx: bed.ktx,
        day: bed.day,
        phong_so: bed.phong_so,
        giuong: bed.giuong,
        status: 'pending',
        ghi_chu: note,
      });
      if (error) throw new Error(error.message);
      setMessage('🚪 Đã tạo yêu cầu check-out — chờ quản lý duyệt ở tab Duyệt Check-out.');
    } catch (err: any) {
      console.error('[bed-inspector] checkout request failed:', err);
      setMessage(err?.message || 'Không thể tạo yêu cầu check-out.');
    } finally {
      setBusy(false);
    }
  }, [bed, worker, supabase]);

  const handleAssign = useCallback(
    async (candidate: WorkerLite) => {
      if (!bed) return;
      setBusy(true);
      setMessage('');
      try {
        const { error } = await supabase
          .from('workers')
          .update({ ktx: bed.ktx, day: bed.day, phong_so: bed.phong_so, giuong: bed.giuong })
          .eq('id', candidate?.id ?? '');
        if (error) throw new Error(error.message);
        setShowAssign(false);
        setAssignSearch('');
        setMessage('✓ Đã gán công nhân vào giường (bảng workers đã cập nhật).');
      } catch (err: any) {
        console.error('[bed-inspector] assign failed:', err);
        setMessage(err?.message || 'Không thể gán công nhân.');
      } finally {
        setBusy(false);
      }
    },
    [bed, supabase]
  );

  const occupiedIds = useMemo(() => {
    const set = new Set<string>([]);
    (workers || []).forEach(w => {
      if (w?.ktx && w?.day && w?.phongSo && w?.giuong) set.add(w?.id ?? '');
    });
    return set;
  }, [workers]);

  const candidates = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    return (workers || []).filter(w => {
      if (!w?.id) return false;
      if (occupiedIds.has(w.id)) return false;
      if (!q) return true;
      return [w.hoVaTen, w.maNV, w.cccd, w.donVi].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [workers, occupiedIds, assignSearch]);

  if (!isMounted) return renderSkeleton();
  if (loading) {
    return (
      <div className="p-4 max-w-md mx-auto flex items-center justify-center py-16">
        <Loader2 size={26} className="animate-spin text-cyan-400" />
      </div>
    );
  }

  const female = (() => {
    const g = (worker?.gioiTinh || bed?.ho_va_ten || '').toLowerCase();
    return g.includes('nữ') || g === 'nu' || g === 'female';
  })();
  const name = bed?.ho_va_ten || worker?.hoVaTen || '';
  const maNv = bed?.ma_nv || worker?.maNV || '';

  return (
    <div className="min-h-[80vh] p-4 bg-[#0B0F17]" suppressHydrationWarning>
      <div className="max-w-md mx-auto space-y-4">
        {/* Header */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#131B2E] p-4 flex items-center justify-between shadow-xl">
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-white flex items-center gap-2">
              <ScanLine size={18} className="text-cyan-400" /> Kiểm Tra Giường QR
            </h1>
            <p className="text-xs text-slate-300 font-tabular mt-1 truncate">
              {[bed?.ktx, bed?.day].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <button
            onClick={() => loadBedData()}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-800/80 bg-slate-900/80 text-slate-300 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {notFound && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-1.5">
            <p className="text-sm font-extrabold text-amber-300 flex items-center gap-2">
              <AlertCircle size={15} /> Không tìm thấy giường trong cơ sở dữ liệu
            </p>
            <p className="text-xs text-amber-200/80">
              Mã QR không khớp bản ghi <code>beds</code> nào. Kiểm tra lại mã hoặc liên hệ quản lý đồng bộ dữ liệu.
            </p>
          </div>
        )}

        {message && (
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm font-semibold text-cyan-300 flex items-start gap-2">
            <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
            <span className="leading-snug">{message}</span>
          </div>
        )}

        {bed && (() => {
          const occupied = bed.status === 'occupied';
          const maintenance = bed.status === 'maintenance';
          return (
            <>
              {/* Bed identity card */}
              <div className={`rounded-2xl border p-5 shadow-2xl ${
                occupied ? 'border-emerald-500/50 bg-[#131B2E]' : maintenance ? 'border-amber-500/50 bg-[#131B2E]' : 'border border-dashed border-blue-400 bg-[#131B2E]'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold text-cyan-300 font-tabular flex items-center gap-1.5">
                    <BedDouble size={14} /> Giường {bed.giuong || '—'}
                  </span>
                  {occupied
                    ? <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">● ĐÃ Ở (OCCUPIED)</span>
                    : maintenance
                    ? <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/50">● ĐANG BẢO TRÌ</span>
                    : <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/50">● GIƯỜNG TRỐNG SẴN SÀNG</span>}
                </div>
                <p className="text-2xl font-extrabold text-white font-tabular">Phòng {bed.phong_so || '—'}</p>
                <p className="text-xs text-slate-300 font-tabular mt-0.5">
                  {bed.ktx || '—'} · {bed.day || '—'} · G{bed.giuong || '—'}
                </p>
              </div>

              {/* Occupied: worker profile */}
              {occupied && name && (
                <div className="rounded-2xl border border-slate-800/80 bg-[#131B2E] p-5 shadow-xl">
                  <div className="flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-extrabold shrink-0 ${female ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'}`}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-lg font-extrabold text-white flex items-center gap-2 truncate">
                        {name}
                        {female && <VenusAndMars size={14} className="text-pink-300 shrink-0" />}
                      </p>
                      <p className="text-xs text-slate-200 font-tabular flex items-center gap-1.5"><User size={11} className="shrink-0" /> Mã NV: <b className="text-cyan-300">{maNv || '—'}</b></p>
                      <p className="text-xs text-slate-300 flex items-center gap-1.5 truncate"><Briefcase size={11} className="shrink-0" /> {worker?.donVi || '—'}</p>
                      <p className="text-xs text-slate-300 font-tabular flex items-center gap-1.5"><Phone size={11} className="shrink-0" /> {worker?.soDienThoai || '—'}</p>
                      <p className="text-xs text-slate-300 font-tabular flex items-center gap-1.5"><Calendar size={11} className="shrink-0" /> Vào: {worker?.ngayVaoKTX || '—'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="rounded-2xl border border-slate-800/80 bg-[#131B2E] p-4 space-y-2.5">
                {occupied && name && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={confirmPresence}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} ✓ Xác nhận có mặt
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setBedStatus('maintenance')}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0F17] text-sm font-extrabold transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Wrench size={15} />} 🔧 Báo hỏng / Bảo trì
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={requestCheckout}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-extrabold transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <DoorOpen size={15} />} 🚪 Check-out
                    </button>
                  </>
                )}
                {maintenance ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setBedStatus('empty')}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} ✓ Hoàn tất bảo trì
                  </button>
                ) : (
                  !occupied && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setShowAssign(true); setAssignSearch(''); }}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-extrabold transition-colors disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />} ＋ Gán Nhanh Công Nhân
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setBedStatus('maintenance')}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0F17] text-sm font-extrabold transition-colors disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Wrench size={15} />} 🔧 Báo hỏng / Bảo trì
                      </button>
                    </>
                  )
                )}
                {busy && <p className="text-[11px] text-slate-300 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Đang xử lý…</p>}
              </div>
            </>
          );
        })()}
      </div>

      {/* ─── Quick Assign Modal ─── */}
      {showAssign && bed && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowAssign(false)}>
          <div className="bg-[#131B2E] border border-slate-800/80 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
              <div>
                <h3 className="font-extrabold text-white flex items-center gap-2"><UserCheck size={16} className="text-cyan-400" /> Gán nhanh công nhân</h3>
                <p className="text-xs text-slate-300 font-tabular mt-0.5">{bed.ktx} · {bed.day} · P{bed.phong_so} · G{bed.giuong}</p>
              </div>
              <button onClick={() => setShowAssign(false)} className="p-2 rounded-lg hover:bg-slate-900/80 text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-5 pt-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  value={assignSearch}
                  onChange={e => setAssignSearch(e.target.value)}
                  placeholder="Tên / Mã NV / Số CCCD…"
                  className="w-full bg-slate-900/80 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {candidates.length === 0 ? (
                <p className="text-sm text-slate-400 italic text-center py-8">Không tìm thấy công nhân chưa có giường.</p>
              ) : (
                candidates.slice(0, 80).map(w => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssign(w)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-800/80 hover:border-cyan-400/60 hover:bg-slate-900/80 transition-colors disabled:opacity-60"
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold shrink-0 ${(w?.gioiTinh || '').toLowerCase().includes('nữ') ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40' : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'}`}>
                      {String(w?.hoVaTen || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-white truncate">{w?.hoVaTen || '(Không tên)'}</p>
                      <p className="text-[11px] text-slate-300 font-tabular truncate">
                        {w?.maNV || '—'} · CCCD {w?.cccd ? `${w.cccd.slice(0, 4)}****${w.cccd.slice(-3)}` : '—'} · {w?.donVi || '—'}
                      </p>
                    </div>
                    <UserCheck size={15} className="text-cyan-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mappers (null-safe) ─────────────────────────────────────────────────────
function mapBed(r: Record<string, unknown> | null): BedRow | null {
  if (!r) return null;
  return {
    id: String(r?.id ?? ''),
    ktx: String(r?.ktx ?? ''),
    day: String(r?.day ?? ''),
    phong_so: String(r?.phong_so ?? ''),
    giuong: String(r?.giuong ?? ''),
    status: r?.status === 'occupied' ? 'occupied' : r?.status === 'maintenance' ? 'maintenance' : 'empty',
    ma_nv: r?.ma_nv ? String(r.ma_nv) : null,
    ho_va_ten: r?.ho_va_ten ? String(r.ho_va_ten) : null,
    worker_id: r?.worker_id ? String(r.worker_id) : null,
  };
}

function mapWorker(r: Record<string, unknown> | null): WorkerLite | null {
  if (!r) return null;
  return {
    id: String(r?.id ?? ''),
    hoVaTen: String(r?.ho_va_ten ?? ''),
    maNV: String(r?.ma_nv ?? ''),
    cccd: String(r?.cccd ?? ''),
    donVi: String(r?.don_vi ?? ''),
    gioiTinh: String(r?.gioi_tinh ?? ''),
    soDienThoai: String(r?.so_dien_thoai ?? ''),
    ngayVaoKTX: String(r?.ngay_vao_ktx ?? ''),
    ktx: String(r?.ktx ?? ''),
    day: String(r?.day ?? ''),
    phongSo: String(r?.phong_so ?? ''),
    giuong: String(r?.giuong ?? ''),
  };
}
