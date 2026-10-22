'use client';
import React from 'react';
import { Trash2, X } from 'lucide-react';

interface Props {
  selectedCount: number;
  onDelete?: () => void;
  onClear: () => void;
}

export default function BulkActionBar({ selectedCount, onDelete, onClear }: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className="slide-up mb-4 flex items-center gap-3 bg-gray-800/95 border border-blue-500/40 rounded-2xl px-4 py-3 shadow-xl backdrop-blur-md">
      <span className="text-sm font-bold text-blue-400 font-tabular">
        Đã chọn {selectedCount} công nhân
      </span>
      <div className="flex-1" />
      {onDelete && (
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/25 active:scale-95"
        >
          <Trash2 size={14} />
          <span>Xóa {selectedCount} mục đã chọn</span>
        </button>
      )}
      <button
        onClick={onClear}
        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gray-700/80 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold transition-colors"
      >
        <X size={13} />
        <span>Bỏ chọn</span>
      </button>
    </div>
  );
}
