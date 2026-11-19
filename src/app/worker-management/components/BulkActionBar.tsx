'use client';
import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Trash2, X, CheckCircle2, Clock, ArrowRightLeft, Layers } from 'lucide-react';

interface Props {
  selectedCount: number;
  onDelete?: () => void;
  onBulkTamTru?: (status: 'registered' | 'unregistered') => void;
  onBulkMove?: () => void;
  onClear: () => void;
}

export default function BulkActionBar({ selectedCount, onDelete, onBulkTamTru, onBulkMove, onClear }: Props) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-4xl pointer-events-auto"
        >
          <div
            className="flex flex-wrap items-center gap-2 sm:gap-2.5 bg-surf border border-bdr3 rounded-2xl px-3.5 sm:px-4 py-2.5 shadow-2xl"
            style={{ boxShadow: 'inset 0 1px 0 var(--specular), 0 18px 40px -10px var(--sh)' }}
          >
            {/* Selection Counter Badge */}
            <div className="flex items-center gap-2 pr-1">
              <span className="w-7 h-7 rounded-lg craft-icon-blue flex items-center justify-center">
                <Layers size={14} strokeWidth={2.2} />
              </span>
              <span className="text-xs sm:text-sm font-bold text-tx font-tabular whitespace-nowrap">
                Đã chọn <span className="text-lnk font-mono">{selectedCount}</span> công nhân
              </span>
            </div>

            <div className="flex-1 min-w-[6px]" />

            {onBulkTamTru && (
              <>
                <button
                  type="button"
                  onClick={() => onBulkTamTru('registered')}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-okbg hover:opacity-90 text-ok border border-ok2/35 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                >
                  <CheckCircle2 size={13} />
                  <span>Đã ĐK tạm trú</span>
                </button>
                <button
                  type="button"
                  onClick={() => onBulkTamTru('unregistered')}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl tint-wn hover:opacity-90 text-wn border border-wn/35 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                >
                  <Clock size={13} />
                  <span>Chưa ĐK tạm trú</span>
                </button>
              </>
            )}

            {onBulkMove && (
              <button
                type="button"
                onClick={onBulkMove}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-bdg hover:opacity-90 text-lnk border border-pri2/35 text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                <ArrowRightLeft size={13} />
                <span>Chuyển phòng / Dãy</span>
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-dgr hover:opacity-90 text-white text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Xóa {selectedCount} mục</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-act hover:bg-act/70 border border-bdr2 text-mu hover:text-tx text-xs font-semibold transition-colors cursor-pointer"
              title="Bỏ chọn tất cả"
            >
              <X size={13} />
              <span className="hidden sm:inline">Bỏ chọn</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
