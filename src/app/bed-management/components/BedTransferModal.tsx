'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { compareKtxNames } from '@/data/workers';

interface TransferBed {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'empty' | 'occupied' | 'maintenance';
}

interface SourceBed {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workerId: string | null;
  sourceBed: SourceBed | null;
  /** Được gọi sau khi chuyển thành công (caller tự refresh). */
  onTransferred?: () => void;
}

const PAGE = 1000;

export default function BedTransferModal({ open, onClose, workerId, sourceBed, onTransferred }: Props) {
  const [beds, setBeds] = useState<TransferBed[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [maNv, setMaNv] = useState('');
  const [selKtx, setSelKtx] = useState('');
  const [selDay, setSelDay] = useState('');
  const [selRoom, setSelRoom] = useState('');
  const [selBed, setSelBed] = useState('');
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const loadBeds = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows: TransferBed[] = [];
      let from = 0;
      for (let page = 0; page < 30; page++) {
        try {
          const { data, error } = await supabase
            .from('beds')
            .select('id, ktx, day, phong_so, giuong, status')
            .range(from, from + PAGE - 1);
          if (error) {
            setError(error.message);
            break;
          }
          const list = (data ?? []) as Record<string, unknown>[];
          list.forEach((r, i) => {
            const ktx = String(r?.ktx ?? '').trim();
            const day = String(r?.day ?? '').trim();
            const phong = String(r?.phong_so ?? '').trim();
            const giuong = String(r?.giuong ?? '').trim();
            if (!ktx || !day || !phong || !giuong) return;
            rows.push({
              id: String(r?.id ?? `b-${i}`),
              ktx, day, phong_so: phong, giuong,
              status: r?.status === 'occupied' ? 'occupied' : r?.status === 'maintenance' ? 'maintenance' : 'empty',
            });
          });
          if (list.length < PAGE) break;
          from += PAGE;
        } catch (err) {
          console.warn('[bed-transfer] load beds failed:', err);
          break;
        }
      }
      setBeds(rows);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const loadWorker = useCallback(async () => {
    if (!workerId) return;
    try {
      const { data } = await supabase
        .from('workers')
        .select('ho_va_ten, ma_nv')
        .eq('id', workerId)
        .maybeSingle();
      if (data) {
        setWorkerName(String(data?.ho_va_ten ?? ''));
        setMaNv(String(data?.ma_nv ?? ''));
      }
    } catch (err) {
      console.warn('[bed-transfer] load worker failed:', err);
    }
  }, [workerId, supabase]);

  useEffect(() => {
    if (!open) return;
    setSelKtx(''); setSelDay(''); setSelRoom(''); setSelBed('');
    loadBeds();
    loadWorker();
  }, [open, loadBeds, loadWorker]);

  // Chỉ giường TRỐNG (không trùng giường cũ)
  const emptyBeds = useMemo(
    () => (beds || []).filter(b => b.status === 'empty' && (!sourceBed || b.id !== sourceBed.id)),
    [beds, sourceBed]
  );
  const ktxList = useMemo(() => [...new Set(emptyBeds.map(b => b.ktx))].sort(compareKtxNames), [emptyBeds]);
  const dayList = useMemo(
    () => [...new Set(emptyBeds.filter(b => b.ktx === selKtx).map(b => b.day))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
    [emptyBeds, selKtx]
  );
  const roomList = useMemo(
    () => [...new Set(emptyBeds.filter(b => b.ktx === selKtx && b.day === selDay).map(b => b.phong_so))].sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b, 'vi', { numeric: true });
    }),
    [emptyBeds, selKtx, selDay]
  );
  const bedList = useMemo(
    () => emptyBeds.filter(b => b.ktx === selKtx && b.day === selDay && b.phong_so === selRoom).sort((a, b) => {
      const na = parseInt(a.giuong.replace(/\D/g, ''), 10) || 999;
      const nb = parseInt(b.giuong.replace(/\D/g, ''), 10) || 999;
      return na - nb;
    }),
    [emptyBeds, selKtx, selDay, selRoom]
  );

  const confirmTransfer = useCallback(async () => {
    if (!workerId || !sourceBed) return;
    const target = bedList.find(b => b.id === selBed);
    if (!target) {
      setError('Vui lòng chọn giường mới (chỉ giường trống).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // 1) workers → vị trí mới (trigger tự đồng bộ beds; explicit underneath để chắc chắn)
      const { error: workerErr } = await supabase
        .from('workers')
        .update({ ktx: target.ktx, day: target.day, phong_so: target.phong_so, giuong: target.giuong })
        .eq('id', workerId);
      if (workerErr) throw new Error(workerErr.message);

      // 2) Giường cũ → trả về empty + worker_id NULL
      try {
        await supabase
          .from('beds')
          .update({ status: 'empty', worker_id: null, ma_nv: null, ho_va_ten: null })
          .eq('id', sourceBed.id);
      } catch (err) {
        console.warn('[bed-transfer] release old bed failed:', err);
      }

      // 3) Giường mới → occupied + gán worker
      try {
        await supabase
          .from('beds')
          .update({ status: 'occupied', worker_id: workerId, ma_nv: maNv || null, ho_va_ten: workerName || null })
          .eq('id', target.id);
      } catch (err) {
        console.warn('[bed-transfer] occupy new bed failed:', err);
      }

      // 4) Audit log
      try {
        const logId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`;
        await supabase.from('audit_logs').insert({
          id: logId,
          timestamp: new Date().toISOString(),
          account: workerName || maNv || 'Quản lý giường',
          action: 'BED_REASSIGN',
          detail: JSON.stringify({
            worker_id: workerId,
            ma_nv: maNv || '',
            ho_va_ten: workerName || '',
            from: { ktx: sourceBed.ktx, day: sourceBed.day, phong_so: sourceBed.phong_so, giuong: sourceBed.giuong },
            to: { ktx: target.ktx, day: target.day, phong_so: target.phong_so, giuong: target.giuong },
            at: new Date().toISOString(),
          }),
        });
      } catch (logErr) {
        console.warn('[bed-transfer] audit log failed:', logErr);
      }

      toast.success(
        `✅ Đã chuyển công nhân sang KTX ${target.ktx} - Dãy ${target.day} - Phòng ${target.phong_so} - Giường G${target.giuong} thành công!`
      );
      onTransferred?.();
      onClose();
    } catch (err: any) {
      console.error('[bed-transfer] transfer failed:', err);
      setError(err?.message || 'Không thể chuyển giường — thử lại.');
    } finally {
      setBusy(false);
    }
  }, [workerId, sourceBed, bedList, selBed, supabase, maNv, workerName, onTransferred, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-[#131B2E] border border-slate-800/80 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
          <div>
            <h3 className="font-extrabold text-white flex items-center gap-2">
              <ArrowRightLeft size={16} className="text-blue-400" /> ⇄ Chuyển / Đổi Giường
            </h3>
            <p className="text-xs text-slate-300 font-tabular mt-0.5 truncate">
              {maNv || workerName || '—'} · vị trí cũ: {sourceBed ? `${sourceBed.ktx} · ${sourceBed.day} · P${sourceBed.phong_so} · G${sourceBed.giuong}` : '—'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-900/80 text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-14"><Loader2 size={22} className="animate-spin text-cyan-400" /></div>
        ) : (
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-semibold text-rose-300 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" /> {error}
              </div>
            )}
            {emptyBeds.length === 0 ? (
              <p className="text-sm text-slate-400 italic text-center py-8">Không còn giường trống nào để chuyển.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">KTX mới</label>
                    <select
                      value={selKtx}
                      onChange={e => { setSelKtx(e.target.value); setSelDay(''); setSelRoom(''); setSelBed(''); }}
                      className="mt-1 w-full bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer"
                    >
                      <option value="">-- Chọn KTX --</option>
                      {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Dãy mới</label>
                    <select
                      value={selDay}
                      onChange={e => { setSelDay(e.target.value); setSelRoom(''); setSelBed(''); }}
                      disabled={!selKtx}
                      className="mt-1 w-full bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <option value="">-- Chọn Dãy --</option>
                      {dayList.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Phòng mới</label>
                    <select
                      value={selRoom}
                      onChange={e => { setSelRoom(e.target.value); setSelBed(''); }}
                      disabled={!selDay}
                      className="mt-1 w-full bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <option value="">-- Chọn Phòng --</option>
                      {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Giường mới (chỉ giường trống)</label>
                    <select
                      value={selBed}
                      onChange={e => setSelBed(e.target.value)}
                      disabled={!selRoom}
                      className="mt-1 w-full bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <option value="">-- Chọn Giường --</option>
                      {bedList.map(b => <option key={b.id} value={b.id}>G{b.giuong}</option>)}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy || !selBed}
                  onClick={confirmTransfer}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-extrabold disabled:opacity-50 transition-colors"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} ✓ Xác nhận chuyển giường
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
