'use client';
import React from 'react';
import { Trash2, X, CheckCircle2, Clock, ArrowRightLeft, Layers, Sparkles } from 'lucide-react';

interface Props {
  selectedCount: number;
  onDelete?: () => void;
  onBulkTamTru?: (status: 'registered' | 'unregistered') => void;
  onBulkMove?: () => void;
  onBulkSmartAssign?: () => void;
  onClear: () => void;
}

export default function BulkActionBar({ selectedCount, onDelete, onBulkTamTru, onBulkMove, onBulkSmartAssign, onClear }: Props) {
  if (selectedCount <= 0) return null;

  return (
    <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1rem)] sm:w-[calc(100%-1.5rem)] max-w-4xl pointer-events-auto">
      <div
        className="slide-up flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-2.5 bg-surf border border-bdr3 rounded-2xl px-3 sm:px-4 py-2.5 shadow-2xl"
        style={{ boxShadow: 'inset 0 1px 0 var(--specular), 0 18px 40px -10px var(--sh)' }}
      >
        {/* Selection Counter Badge + Mobile Close */}
        <div className="flex items-center justify-between gap-2 sm:pr-1">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg craft-icon-blue flex items-center justify-center shrink-0">
              <Layers size={14} strokeWidth={2.2} />
            </span>
            <span className="text-xs sm:text-sm font-bold text-tx font-tabular whitespace-nowrap">
              Đã chọn <span className="text-lnk font-mono">{selectedCount}</span> công nhân
            </span>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="sm:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-act border border-bdr2 text-mu hover:text-tx text-xs font-semibold cursor-pointer"
            title="Bỏ chọn tất cả"
          >
            <X size={13} />
            <span>Bỏ chọn</span>
          </button>
        </div>

        <div className="hidden sm:block flex-1 min-w-[6px]" />

        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-thin pb-0.5 sm:pb-0 sm:flex-wrap">
          {onBulkTamTru && (
            <>
              <button
                type="button"
                onClick={() => onBulkTamTru('registered')}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl bg-okbg hover:opacity-90 text-ok border border-ok2/35 text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
              >
                <CheckCircle2 size={13} />
                <span>Đã ĐK tạm trú</span>
              </button>
              <button
                type="button"
                onClick={() => onBulkTamTru('unregistered')}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl tint-wn hover:opacity-90 text-wn border border-wn/35 text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Clock size={13} />
                <span>Chưa ĐK tạm trú</span>
              </button>
            </>
          )}

          {onBulkSmartAssign && (
            <button
              type="button"
              onClick={onBulkSmartAssign}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl bg-pri hover:opacity-90 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
            >
              <Sparkles size={13} />
              <span>Xếp phòng tự động</span>
            </button>
          )}

          {onBulkMove && (
            <button
              type="button"
              onClick={onBulkMove}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl bg-bdg hover:opacity-90 text-lnk border border-pri2/35 text-xs font-bold transition-all active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowRightLeft size={13} />
              <span>Chuyển phòng / Dãy</span>
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-xl bg-dgr hover:opacity-90 text-white text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 size={13} />
              <span>Xóa {selectedCount} mục</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClear}
            className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-act hover:bg-act/70 border border-bdr2 text-mu hover:text-tx text-xs font-semibold transition-colors cursor-pointer shrink-0"
            title="Bỏ chọn tất cả"
          >
            <X size={13} />
            <span>Bỏ chọn</span>
          </button>
        </div>
      </div>
    </div>
  );
}

