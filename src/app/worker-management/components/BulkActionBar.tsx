'use client';
import React from 'react';
import { Trash2, X, CheckCircle2, Clock, ArrowRightLeft } from 'lucide-react';

interface Props {
  selectedCount: number;
  onDelete?: () => void;
  onBulkTamTru?: (status: 'registered' | 'unregistered') => void;
  onBulkMove?: () => void;
  onClear: () => void;
}

export default function BulkActionBar({ selectedCount, onDelete, onBulkTamTru, onBulkMove, onClear }: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className="slide-up mb-4 flex flex-wrap items-center gap-2 sm:gap-3 bg-surf border border-bdr2 rounded-2xl px-4 py-3 shadow-xl backdrop-blur-md">
      <span className="text-sm font-bold text-lnk font-tabular">
        Đã chọn {selectedCount} công nhân
      </span>
      <div className="flex-1 min-w-[8px]" />
      {onBulkTamTru && (
        <>
          <button
            type="button"
            onClick={() => onBulkTamTru('registered')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-okbg hover:opacity-90 text-ok border border-bdr2 text-xs font-bold transition-all active:scale-95"
          >
            <CheckCircle2 size={14} />
            <span>Đã ĐK tạm trú</span>
          </button>
          <button
            type="button"
            onClick={() => onBulkTamTru('unregistered')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-wnbg hover:opacity-90 text-wn border border-bdr2 text-xs font-bold transition-all active:scale-95"
          >
            <Clock size={14} />
            <span>Chưa ĐK tạm trú</span>
          </button>
        </>
      )}
      {onBulkMove && (
        <button
          type="button"
          onClick={onBulkMove}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bdg hover:opacity-90 text-lnk border border-bdr2 text-xs font-bold transition-all active:scale-95"
        >
          <ArrowRightLeft size={14} />
          <span>Chuyển phòng / Dãy</span>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-dgr hover:opacity-90 text-white text-xs font-bold transition-all active:scale-95"
        >
          <Trash2 size={14} />
          <span>Xóa {selectedCount} mục đã chọn</span>
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-act hover:bg-act/70 text-mu hover:text-tx text-xs font-semibold transition-colors"
      >
        <X size={13} />
        <span>Bỏ chọn</span>
      </button>
    </div>
  );
}
