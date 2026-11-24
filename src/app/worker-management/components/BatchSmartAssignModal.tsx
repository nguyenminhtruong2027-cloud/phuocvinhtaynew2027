'use client';

import React, { useMemo, useState } from 'react';
import { X, Sparkles, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Worker } from '@/data/workers';
import { FacilityItem, formatRoomDisplay } from '@/lib/facilityCapacity';
import {
  BatchAssignmentPlanItem,
  planBatchSmartAssignments,
} from '@/lib/smartRoomAssign';

interface Props {
  selectedWorkers: Worker[];
  allWorkers: Worker[];
  facilities: FacilityItem[];
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>;
  applying: boolean;
  onApplyPlan: (plan: BatchAssignmentPlanItem[]) => Promise<void>;
  onClose: () => void;
}

export default function BatchSmartAssignModal({
  selectedWorkers,
  allWorkers,
  facilities,
  roomGenderMap,
  applying,
  onApplyPlan,
  onClose,
}: Props) {
  const [phaseScope, setPhaseScope] = useState<'phase1_first' | 'phase1_only' | 'all'>('phase1_first');

  const plan = useMemo(() => {
    const allowedDays =
      phaseScope === 'phase1_only' ? ['Dãy 1', 'Dãy 2', 'Dãy 3'] : undefined;
    return planBatchSmartAssignments(
      selectedWorkers.map(w => ({
        id: w.id,
        hoVaTen: w.hoVaTen,
        gioiTinh: w.gioiTinh,
        donVi: w.donVi,
        tieuDoan: w.tieuDoan,
        ktx: w.ktx || undefined,
      })),
      allWorkers,
      facilities,
      roomGenderMap,
      {
        preferPhase1: phaseScope !== 'all',
        allowedDays,
      }
    );
  }, [selectedWorkers, allWorkers, facilities, roomGenderMap, phaseScope]);

  const assignedItems = useMemo(() => plan.filter(p => p.assigned !== null), [plan]);
  const unassignedCount = plan.length - assignedItems.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
      onClick={() => { if (!applying) onClose(); }}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-side">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-bdg text-lnk flex items-center justify-center shrink-0">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                Xếp phòng & giường tự động thông minh ({selectedWorkers.length} công nhân)
              </h3>
              <p className="text-xs text-mu mt-0.5">
                Tự gom cùng Đơn vị / Tiểu đoàn · Tách tuyệt đối Nam/Nữ · Không vượt quá sức chứa phòng
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={applying}
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Strategy Selector */}
        <div className="px-5 py-3 border-b border-bdr bg-page/60 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-act border border-bdr">
            <button
              type="button"
              onClick={() => setPhaseScope('phase1_first')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                phaseScope === 'phase1_first' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              Ưu tiên GĐ 1 (Dãy 1–3)
            </button>
            <button
              type="button"
              onClick={() => setPhaseScope('phase1_only')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                phaseScope === 'phase1_only' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              Chỉ xếp trong GĐ 1 (Dãy 1–3)
            </button>
            <button
              type="button"
              onClick={() => setPhaseScope('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                phaseScope === 'all' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              Toàn khu (Dãy 1–6)
            </button>
          </div>

          <div className="text-xs text-mu tabular-nums">
            Xếp được <strong className="text-ok">{assignedItems.length}</strong> / {plan.length}
            {unassignedCount > 0 && (
              <span className="text-dgr font-semibold"> · Thiếu chỗ: {unassignedCount}</span>
            )}
          </div>
        </div>

        {/* Preview Table */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surf border-b border-bdr text-mu">
              <tr>
                <th className="py-2 text-left font-semibold">Họ và tên</th>
                <th className="py-2 text-left font-semibold">GT / Đơn vị</th>
                <th className="py-2 text-left font-semibold">Phòng & Giường đề xuất</th>
                <th className="py-2 text-left font-semibold">Lý do ghép</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {plan.map(item => (
                <tr key={item.workerId}>
                  <td className="py-2.5 pr-2 font-semibold text-tx">{item.workerName}</td>
                  <td className="py-2.5 pr-2 text-mu">
                    {item.gioiTinh || '—'} · {item.donVi || 'Chưa rõ ĐV'}
                  </td>
                  <td className="py-2.5 pr-2 font-mono tabular-nums">
                    {item.assigned ? (
                      <span className="text-lnk font-bold">
                        {item.assigned.day} · {formatRoomDisplay(item.assigned.room)} · G.{item.assigned.bed}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-dgr font-semibold">
                        <AlertTriangle size={12} /> Hết phòng phù hợp
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-mu">
                    {item.assigned ? item.assigned.reasons.slice(0, 2).join(' · ') : 'Kiểm tra lại công suất / giới tính'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3.5 border-t border-bdr bg-side flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={applying}
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={applying || assignedItems.length === 0}
            onClick={() => onApplyPlan(assignedItems)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            <span>
              {applying
                ? 'Đang xếp phòng...'
                : `Xác nhận xếp ${assignedItems.length} công nhân`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
