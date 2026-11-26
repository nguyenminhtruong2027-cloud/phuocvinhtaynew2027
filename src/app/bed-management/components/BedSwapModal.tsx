'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  ArrowLeftRight,
  Search,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  User,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { normalizeBedLabel } from '@/lib/bedSync';
import { swapWorkerBeds, SwapWorkerParticipant } from '@/lib/bedSwap';
import { removeAccents } from '@/data/workers';

interface Props {
  occupiedWorkers: SwapWorkerParticipant[];
  initialWorkerAId?: string;
  initialWorkerBId?: string;
  onClose: () => void;
  onSwapped: () => Promise<void> | void;
}

function normalizeGenderSimple(raw?: string | null): 'nam' | 'nu' | '' {
  const s = removeAccents(String(raw || '')).toLowerCase().trim();
  if (s.includes('nu')) return 'nu';
  if (s.includes('nam')) return 'nam';
  return '';
}

function WorkerPickerColumn({
  title,
  accent,
  workers,
  selectedId,
  disabledId,
  onSelect,
  canManage,
}: {
  title: string;
  accent: 'blue' | 'teal';
  workers: SwapWorkerParticipant[];
  selectedId: string;
  disabledId: string;
  onSelect: (id: string) => void;
  canManage: (w: SwapWorkerParticipant) => boolean;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = removeAccents(search.trim()).toLowerCase();
    return workers
      .filter(w => {
        if (!q) return true;
        const hay = removeAccents(
          `${w.hoVaTen} ${w.maNV || ''} ${w.cccd || ''} ${w.day} ${w.phongSo} G${w.giuong} ${w.donVi || ''}`
        ).toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 60);
  }, [workers, search]);

  const selectedWorker = workers.find(w => w.id === selectedId) || null;

  return (
    <div className="flex flex-col rounded-2xl border border-bdr bg-page/60 overflow-hidden">
      <div
        className={`px-3.5 py-2.5 border-b border-bdr flex items-center justify-between ${
          accent === 'blue' ? 'bg-bdg' : 'bg-okbg'
        }`}
      >
        <span className={`text-xs font-extrabold uppercase tracking-wider ${accent === 'blue' ? 'text-lnk' : 'text-ok'}`}>
          {title}
        </span>
        {selectedWorker && (
          <span className="text-[11px] font-bold text-tx truncate max-w-[180px]">
            {selectedWorker.hoVaTen}
          </span>
        )}
      </div>

      {/* Selected summary card */}
      {selectedWorker ? (
        <div className="p-3 bg-surf border-b border-bdr flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-tx truncate">{selectedWorker.hoVaTen}</div>
            <div className="text-[11px] text-mu mt-0.5 flex flex-wrap gap-x-2">
              <span className="font-semibold text-lnk">
                {selectedWorker.day} · {formatRoomDisplay(selectedWorker.phongSo)} · G{normalizeBedLabel(selectedWorker.giuong) || selectedWorker.giuong}
              </span>
              {selectedWorker.gioiTinh && <span>· {selectedWorker.gioiTinh}</span>}
              {selectedWorker.donVi && <span>· {selectedWorker.donVi}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelect('')}
            className="text-[11px] px-2 py-1 rounded-lg bg-act text-mu hover:text-tx font-semibold cursor-pointer shrink-0"
          >
            Đổi
          </button>
        </div>
      ) : null}

      {/* Search box */}
      <div className="p-2.5 border-b border-bdr bg-surf">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mu" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm theo tên, Mã NV, số phòng..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-page border border-bdr2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/35"
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-56 overflow-y-auto divide-y divide-bdr bg-surf">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-mu">Không tìm thấy công nhân đang có giường phù hợp.</div>
        ) : (
          filtered.map(w => {
            const isPicked = w.id === selectedId;
            const isOther = w.id === disabledId;
            const allowed = canManage(w);
            return (
              <button
                key={w.id}
                type="button"
                disabled={isOther || !allowed}
                onClick={() => onSelect(w.id)}
                className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors text-xs ${
                  isPicked
                    ? 'bg-bdg/80 text-tx font-bold'
                    : isOther || !allowed
                    ? 'opacity-45 cursor-not-allowed'
                    : 'hover:bg-act/60 cursor-pointer'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <User size={12} className="text-mu shrink-0" />
                    <span className="font-bold text-tx truncate">{w.hoVaTen}</span>
                    {!allowed && <Lock size={11} className="text-wn shrink-0" />}
                  </div>
                  <div className="text-[11px] text-mu truncate">
                    {w.donVi || '—'} {w.gioiTinh ? `· ${w.gioiTinh}` : ''}
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-lnk shrink-0">
                  {w.day} · {formatRoomDisplay(w.phongSo)} · G{normalizeBedLabel(w.giuong) || w.giuong}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function BedSwapModal({
  occupiedWorkers,
  initialWorkerAId = '',
  initialWorkerBId = '',
  onClose,
  onSwapped,
}: Props) {
  const { currentUser, isAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();

  const [workerAId, setWorkerAId] = useState(initialWorkerAId);
  const [workerBId, setWorkerBId] = useState(initialWorkerBId);
  const [submitting, setSubmitting] = useState(false);

  const workerA = useMemo(() => occupiedWorkers.find(w => w.id === workerAId) || null, [occupiedWorkers, workerAId]);
  const workerB = useMemo(() => occupiedWorkers.find(w => w.id === workerBId) || null, [occupiedWorkers, workerBId]);

  const canManage = (w: SwapWorkerParticipant) => isAdmin || canWriteBlock(w.day || '', w.ktx || '');

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (!workerA || !workerB) return list;
    const gA = normalizeGenderSimple(workerA.gioiTinh);
    const gB = normalizeGenderSimple(workerB.gioiTinh);
    const sameRoom =
      workerA.ktx.trim().toLowerCase() === workerB.ktx.trim().toLowerCase() &&
      workerA.day.trim().toLowerCase() === workerB.day.trim().toLowerCase() &&
      formatRoomDisplay(workerA.phongSo) === formatRoomDisplay(workerB.phongSo);
    if (!sameRoom && gA && gB && gA !== gB) {
      list.push(
        `Cảnh báo khác giới tính: ${workerA.hoVaTen} (${workerA.gioiTinh}) ⇄ ${workerB.hoVaTen} (${workerB.gioiTinh}) ở 2 phòng khác nhau. Hãy kiểm tra lại giới tính phòng trước khi đổi.`
      );
    }
    if (workerA.donVi && workerB.donVi && workerA.donVi.trim() !== workerB.donVi.trim() && !sameRoom) {
      list.push(`Lưu ý: Hai công nhân thuộc 2 đơn vị khác nhau (${workerA.donVi} và ${workerB.donVi}).`);
    }
    return list;
  }, [workerA, workerB]);

  const handleConfirmSwap = async () => {
    if (!workerA || !workerB) return;
    if (!canManage(workerA) || !canManage(workerB)) {
      toast.error('Bạn không có quyền hoán đổi giường ngoài phạm vi dãy phụ trách.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const res = await swapWorkerBeds(supabase, workerA, workerB);
      if (!res.ok) {
        toast.error(res.error || 'Hoán đổi giường thất bại.');
        return;
      }
      addLog(currentUser?.email || currentUser?.name || 'Admin', 'SWAP_BEDS', res.auditDetailJson);
      toast.success(res.summaryText);
      await onSwapped();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi khi hoán đổi giường.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-3 sm:p-5 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-surf border border-bdr2 shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-bdg text-lnk border border-pri2/35 flex items-center justify-center shrink-0">
              <ArrowLeftRight size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-tx truncate">
                Hoán Đổi Giường 1 Chạm (A ⇄ B)
              </h2>
              <p className="text-xs text-mu mt-0.5">
                Đổi chỗ trực tiếp 2 công nhân giữa 2 giường/phòng bất kỳ mà không cần tháo giường trung gian
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <WorkerPickerColumn
              title="Công nhân A"
              accent="blue"
              workers={occupiedWorkers}
              selectedId={workerAId}
              disabledId={workerBId}
              onSelect={setWorkerAId}
              canManage={canManage}
            />
            <WorkerPickerColumn
              title="Công nhân B"
              accent="teal"
              workers={occupiedWorkers}
              selectedId={workerBId}
              disabledId={workerAId}
              onSelect={setWorkerBId}
              canManage={canManage}
            />
          </div>

          {/* Preview Swap Banner */}
          {workerA && workerB && (
            <div className="rounded-2xl border border-pri2/35 bg-bdg/40 p-4 space-y-2.5">
              <div className="text-xs font-extrabold uppercase tracking-wider text-lnk flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                Xem trước vị trí sau khi hoán đổi
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-surf border border-bdr p-3">
                  <div className="font-bold text-tx">{workerA.hoVaTen}</div>
                  <div className="text-mu mt-1">
                    Cũ: {workerA.day} · {formatRoomDisplay(workerA.phongSo)} · G{normalizeBedLabel(workerA.giuong) || workerA.giuong}
                  </div>
                  <div className="text-ok font-bold mt-0.5">
                    Mới: {workerB.day} · {formatRoomDisplay(workerB.phongSo)} · G{normalizeBedLabel(workerB.giuong) || workerB.giuong}
                  </div>
                </div>
                <div className="rounded-xl bg-surf border border-bdr p-3">
                  <div className="font-bold text-tx">{workerB.hoVaTen}</div>
                  <div className="text-mu mt-1">
                    Cũ: {workerB.day} · {formatRoomDisplay(workerB.phongSo)} · G{normalizeBedLabel(workerB.giuong) || workerB.giuong}
                  </div>
                  <div className="text-ok font-bold mt-0.5">
                    Mới: {workerA.day} · {formatRoomDisplay(workerA.phongSo)} · G{normalizeBedLabel(workerA.giuong) || workerA.giuong}
                  </div>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="rounded-xl tint-wn border border-wn/40 p-3 space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-wn font-semibold">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-bdr bg-side flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={!workerA || !workerB || submitting}
            onClick={handleConfirmSwap}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold cursor-pointer disabled:opacity-45"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            <span>Xác nhận Hoán đổi</span>
          </button>
        </div>
      </div>
    </div>
  );
}
