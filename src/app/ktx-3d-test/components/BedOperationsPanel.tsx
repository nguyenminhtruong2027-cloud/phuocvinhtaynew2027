'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  Search,
  UserMinus,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { removeAccents, type Worker } from '@/data/workers';
import { normalizeBedLabel, normalizeDayKey, normalizeKtxCompact } from '@/lib/bedSync';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';
import type { CampusRoomNode, RoomBedSlot } from '../types';

interface BedOperationsPanelProps {
  activeRoom: CampusRoomNode;
  selectedBed: RoomBedSlot;
  allRoomBeds: RoomBedSlot[];
  allWorkers: Worker[];
  isLight: boolean;
  busy: boolean;
  onAssignWorker: (worker: Worker) => Promise<void>;
  onSwapOrMoveBed: (targetBed: RoomBedSlot) => Promise<void>;
  onToggleMaintenance: (nextStatus: 'maintenance' | 'empty') => Promise<void>;
  onReleaseBed: () => Promise<void>;
}

export default function BedOperationsPanel({
  activeRoom,
  selectedBed,
  allRoomBeds,
  allWorkers,
  isLight,
  busy,
  onAssignWorker,
  onSwapOrMoveBed,
  onToggleMaintenance,
  onReleaseBed,
}: BedOperationsPanelProps) {
  const [mode, setMode] = useState<'none' | 'assign' | 'swap' | 'confirm_release'>('none');
  const [query, setQuery] = useState('');

  // Reset inline panel if user switches to a different bed
  React.useEffect(() => {
    setMode('none');
    setQuery('');
  }, [selectedBed.id, selectedBed.status]);

  const candidates = useMemo(() => {
    if (mode !== 'assign') return [];
    const targetKtx = normalizeKtxCompact(activeRoom.ktx);
    const targetDay = normalizeDayKey(activeRoom.day);
    const targetRoom = normalizeRoomLabel(activeRoom.roomRaw);
    const q = removeAccents(query.trim());

    const list = allWorkers
      .filter(w => {
        if (q) {
          const hay = removeAccents(`${w.hoVaTen || ''} ${w.maNV || ''} ${w.tieuDoan || ''} ${w.phongSo || ''}`);
          return hay.includes(q);
        }
        // Without query, prioritize workers in THIS room without a bed, or any worker without a bed
        const hasBed = Boolean(normalizeBedLabel(w.giuong));
        return !hasBed;
      })
      .map(w => {
        const sameRoom =
          normalizeKtxCompact(w.ktx) === targetKtx &&
          normalizeDayKey(w.day) === targetDay &&
          normalizeRoomLabel(w.phongSo || '') === targetRoom;
        const hasBed = Boolean(normalizeBedLabel(w.giuong));
        const score = (sameRoom ? 100 : 0) + (!hasBed ? 50 : 0);
        return { worker: w, sameRoom, hasBed, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return list;
  }, [mode, query, allWorkers, activeRoom]);

  const swapTargets = useMemo(() => {
    if (mode !== 'swap') return [];
    return allRoomBeds.filter(b => b.id !== selectedBed.id && b.status !== 'maintenance');
  }, [mode, allRoomBeds, selectedBed.id]);

  const mutedCls = isLight ? 'text-slate-600' : 'text-slate-400';
  const inputCls = isLight
    ? 'bg-slate-50 border-slate-300 text-slate-900'
    : 'bg-slate-900 border-slate-700 text-slate-100';
  const subtleBtn = isLight
    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200';
  const dividerCls = isLight ? 'border-slate-200' : 'border-slate-800';

  return (
    <div className={`pt-2.5 mt-2 border-t space-y-2 ${dividerCls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
        Vận hành nhanh giường {selectedBed.bedLabel}
      </p>

      {selectedBed.status === 'empty' && (
        <>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(m => (m === 'assign' ? 'none' : 'assign'))}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <UserPlus size={12} />
              <span>Xếp công nhân</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onToggleMaintenance('maintenance')}
              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${subtleBtn}`}
              title="Đánh dấu giường đang bảo trì"
            >
              <Wrench size={12} className="text-rose-500" />
              <span>Bảo trì</span>
            </button>
          </div>

          {mode === 'assign' && (
            <div className="space-y-1.5 pt-1">
              <div className="relative">
                <Search
                  size={12}
                  className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${mutedCls}`}
                />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Tìm tên, mã NV cần xếp giường..."
                  className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] focus:outline-none focus:border-emerald-500 ${inputCls}`}
                />
              </div>
              <div className="max-h-36 overflow-y-auto scrollbar-thin space-y-1">
                {candidates.length === 0 ? (
                  <p className={`text-[11px] text-center py-2 ${mutedCls}`}>
                    Không có công nhân chưa xếp giường phù hợp
                  </p>
                ) : (
                  candidates.map(({ worker, sameRoom, hasBed }) => (
                    <button
                      key={worker.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onAssignWorker(worker)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-left text-[11px] transition-colors ${
                        isLight
                          ? 'bg-slate-50 border-slate-200 hover:border-emerald-500'
                          : 'bg-slate-900/75 border-slate-800 hover:border-emerald-500'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{worker.hoVaTen}</p>
                        <p className={`text-[10px] truncate ${mutedCls}`}>
                          {worker.maNV ? `#${worker.maNV} · ` : ''}
                          {sameRoom ? 'Cùng phòng · ' : worker.phongSo ? `${worker.day} P.${worker.phongSo} · ` : ''}
                          {hasBed ? `Đang ở G${normalizeBedLabel(worker.giuong)}` : 'Chưa có giường'}
                        </p>
                      </div>
                      {busy ? (
                        <Loader2 size={12} className="animate-spin shrink-0 text-emerald-500" />
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-500 shrink-0">Chọn</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {selectedBed.status === 'maintenance' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggleMaintenance('empty')}
          className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          <span>Hoàn tất bảo trì → Mở lại giường trống</span>
        </button>
      )}

      {selectedBed.status === 'occupied' && (
        <>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(m => (m === 'swap' ? 'none' : 'swap'))}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <ArrowRightLeft size={12} />
              <span>Chuyển / Đổi giường</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(m => (m === 'confirm_release' ? 'none' : 'confirm_release'))}
              className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold text-rose-500 transition-colors ${subtleBtn}`}
              title="Trả giường để trống"
            >
              <UserMinus size={12} />
              <span>Trả</span>
            </button>
          </div>

          {mode === 'confirm_release' && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 space-y-2 text-[11px]">
              <p className="font-semibold text-rose-400">
                Xác nhận bỏ xếp giường {selectedBed.bedLabel} cho {selectedBed.hoVaTen}?
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onReleaseBed}
                  className="flex-1 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
                >
                  {busy ? 'Đang xử lý...' : 'Xác nhận trả giường'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('none')}
                  className={`px-2.5 py-1 rounded-lg border font-semibold ${subtleBtn}`}
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {mode === 'swap' && (
            <div className="max-h-36 overflow-y-auto scrollbar-thin space-y-1 pt-1">
              {swapTargets.map(tb => (
                <button
                  key={tb.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onSwapOrMoveBed(tb)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-left text-[11px] transition-colors ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 hover:border-blue-500'
                      : 'bg-slate-900/75 border-slate-800 hover:border-blue-500'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-mono font-bold mr-1.5">{tb.bedLabel}</span>
                    <span className={mutedCls}>
                      {tb.hoVaTen ? tb.hoVaTen : 'Giường trống'}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-blue-500 shrink-0">
                    {tb.status === 'occupied' ? 'Hoán đổi' : 'Chuyển tới'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
