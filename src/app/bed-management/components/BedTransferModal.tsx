'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { compareKtxNames } from '@/data/workers';
import { loadSavedRoomGenderMap, normalizeGender } from '@/lib/roomGender';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { MonoChip } from '@/components/ui/StatusTag';

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
  const { isAdmin, canWriteBlock, currentUser } = useAuth();
  const { addLog } = useAudit();
  const [beds, setBeds] = useState<TransferBed[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [maNv, setMaNv] = useState('');
  const [workerGender, setWorkerGender] = useState('');
  const [roomGenderNote, setRoomGenderNote] = useState('');
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
      const byId = new Map<string, TransferBed>();
      let from = 0;
      for (let page = 0; page < 30; page++) {
        try {
          const { data, error } = await supabase
            .from('beds')
            .select('id, ktx, day, phong_so, giuong, status')
            .order('id', { ascending: true })
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
            const id = String(r?.id ?? `b-${from}-${i}`);
            byId.set(id, {
              id,
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
      setBeds(Array.from(byId.values()));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const loadWorker = useCallback(async () => {
    if (!workerId) return;
    try {
      const { data } = await supabase
        .from('workers')
        .select('ho_va_ten, ma_nv, gioi_tinh')
        .eq('id', workerId)
        .maybeSingle();
      if (data) {
        setWorkerName(String(data?.ho_va_ten ?? ''));
        setMaNv(String(data?.ma_nv ?? ''));
        setWorkerGender(String(data?.gioi_tinh ?? ''));
      }
    } catch (err) {
      console.warn('[bed-transfer] load worker failed:', err);
    }
  }, [workerId, supabase]);

  useEffect(() => {
    if (!open) return;
    setSelKtx(''); setSelDay(''); setSelRoom(''); setSelBed('');
    setRoomGenderNote('');
    loadBeds();
    loadWorker();
  }, [open, loadBeds, loadWorker]);

  // Check gender consistency when target room is chosen
  useEffect(() => {
    if (!selKtx || !selDay || !selRoom) {
      setRoomGenderNote('');
      return;
    }
    const g = normalizeGender(workerGender);
    if (g !== 'nam' && g !== 'nu') {
      setRoomGenderNote('');
      return;
    }
    const normRoom = normalizeRoomLabel(selRoom);
    const saved = loadSavedRoomGenderMap()[`${selKtx.trim()}||${selDay.trim()}||${normRoom}`];
    if (saved === 'male' && g === 'nu') {
      setRoomGenderNote(`Lưu ý: Phòng ${normRoom} được đánh dấu Phòng Nam (khác giới tính Nữ).`);
      return;
    }
    if (saved === 'female' && g === 'nam') {
      setRoomGenderNote(`Lưu ý: Phòng ${normRoom} được đánh dấu Phòng Nữ (khác giới tính Nam).`);
      return;
    }
    let active = true;
    supabase
      .from('workers')
      .select('gioi_tinh')
      .eq('ktx', selKtx)
      .eq('day', selDay)
      .eq('phong_so', selRoom)
      .then(({ data }) => {
        if (!active || !data) return;
        const opp = data.filter(w => {
          const wg = normalizeGender((w as any).gioi_tinh);
          return (wg === 'nam' || wg === 'nu') && wg !== g;
        }).length;
        if (opp > 0) {
          setRoomGenderNote(`Lưu ý: Phòng ${normRoom} đang có ${opp} người ${g === 'nam' ? 'Nữ' : 'Nam'}.`);
        } else {
          setRoomGenderNote('');
        }
      });
    return () => { active = false; };
  }, [selKtx, selDay, selRoom, workerGender, supabase]);

  // Chỉ giường TRỐNG thuộc phạm vi được phép (Admin: tất cả; Staff: block phụ trách)
  const emptyBeds = useMemo(
    () =>
      (beds || []).filter(
        b =>
          b.status === 'empty' &&
          (!sourceBed || b.id !== sourceBed.id) &&
          (isAdmin || canWriteBlock(b.day, b.ktx))
      ),
    [beds, sourceBed, isAdmin, canWriteBlock]
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
    if (!isAdmin && (!canWriteBlock(sourceBed.day, sourceBed.ktx) || !canWriteBlock(target.day, target.ktx))) {
      setError('Bạn không có quyền chuyển giường ngoài phạm vi dãy phụ trách.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // 0) Live race-condition guard: verify target bed is still empty right before transfer
      const { data: liveTarget } = await supabase
        .from('beds')
        .select('status')
        .eq('id', target.id)
        .maybeSingle();
      if (liveTarget && liveTarget.status !== 'empty') {
        setError('Giường đích vừa được người khác gán hoặc chuyển bảo trì. Đang tải lại danh sách...');
        loadBeds();
        return;
      }

      // 1) workers → vị trí mới
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

      // 4) Audit log via AuditContext with real operator account
      addLog(
        currentUser?.email || currentUser?.name || 'system',
        'BED_REASSIGN',
        JSON.stringify({
          worker_id: workerId,
          ma_nv: maNv || '',
          ho_va_ten: workerName || '',
          from: { ktx: sourceBed.ktx, day: sourceBed.day, phong_so: sourceBed.phong_so, giuong: sourceBed.giuong },
          to: { ktx: target.ktx, day: target.day, phong_so: target.phong_so, giuong: target.giuong },
          at: new Date().toISOString(),
        })
      );

      toast.success(
        `Đã chuyển công nhân sang ${target.ktx} · ${target.day} · Phòng ${target.phong_so} · Giường G${target.giuong}!`
      );
      onTransferred?.();
      onClose();
    } catch (err: any) {
      console.error('[bed-transfer] transfer failed:', err);
      setError(err?.message || 'Không thể chuyển giường — thử lại.');
    } finally {
      setBusy(false);
    }
  }, [workerId, sourceBed, bedList, selBed, isAdmin, canWriteBlock, supabase, loadBeds, maNv, workerName, currentUser, addLog, onTransferred, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 modal-backdrop-scrim fade-in flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="surface-elevated border border-bdr2 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[90vh] overflow-hidden modal-enter"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bdr bg-act/50">
          <div className="flex items-center gap-3 min-w-0">
            <CraftIconBadge icon={ArrowRightLeft} tone="blue" size="sm" interactive={false} />
            <div className="min-w-0">
              <h3 className="font-extrabold text-tx tracking-tight">Chuyển / Đổi Giường</h3>
              <div className="flex items-center gap-1.5 text-xs text-mu font-tabular mt-0.5 flex-wrap">
                <span className="truncate">{maNv || workerName || '—'}</span>
                {sourceBed && (
                  <MonoChip>
                    {sourceBed.ktx} · {sourceBed.day} · P{sourceBed.phong_so} · G{sourceBed.giuong}
                  </MonoChip>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-act text-mu hover:text-tx cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-14"><Loader2 size={22} className="animate-spin text-pri2" /></div>
        ) : (
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {error && (
              <div className="rounded-xl border border-dgr tint-dgr p-3 text-xs font-semibold text-dgr flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" /> {error}
              </div>
            )}
            {emptyBeds.length === 0 ? (
              <p className="text-sm text-mu italic text-center py-8">Không còn giường trống nào để chuyển.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-mu uppercase tracking-wider">KTX mới</label>
                    <select
                      value={selKtx}
                      onChange={e => { setSelKtx(e.target.value); setSelDay(''); setSelRoom(''); setSelBed(''); }}
                      className="mt-1 w-full bg-surf border border-bdr2 text-tx rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer"
                    >
                      <option value="">-- Chọn KTX --</option>
                      {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Dãy mới</label>
                    <select
                      value={selDay}
                      onChange={e => { setSelDay(e.target.value); setSelRoom(''); setSelBed(''); }}
                      disabled={!selKtx}
                      className="mt-1 w-full bg-surf border border-bdr2 text-tx rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <option value="">-- Chọn Dãy --</option>
                      {dayList.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Phòng mới</label>
                    <select
                      value={selRoom}
                      onChange={e => { setSelRoom(e.target.value); setSelBed(''); }}
                      disabled={!selDay}
                      className="mt-1 w-full bg-surf border border-bdr2 text-tx rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <option value="">-- Chọn Phòng --</option>
                      {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Giường mới (chỉ giường trống)</label>
                    <select
                      value={selBed}
                      onChange={e => setSelBed(e.target.value)}
                      disabled={!selRoom}
                      className="mt-1 w-full bg-surf border border-bdr2 text-tx rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <option value="">-- Chọn Giường --</option>
                      {bedList.map(b => <option key={b.id} value={b.id}>G{b.giuong}</option>)}
                    </select>
                  </div>
                </div>

                {roomGenderNote && (
                  <div className="rounded-xl border border-wn/40 tint-wn p-2.5 text-xs font-medium text-wn flex items-center gap-2">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{roomGenderNote}</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={busy || !selBed}
                  onClick={confirmTransfer}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl btn-glow-primary text-sm font-extrabold disabled:opacity-50 cursor-pointer"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  <span>Xác nhận chuyển giường</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
