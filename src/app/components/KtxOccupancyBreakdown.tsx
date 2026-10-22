'use client';
import React from 'react';
import type { KtxOccupancy } from '@/data/workers';

function getFillTone(rate: number) {
  if (rate > 1) return { bar: 'bg-rose-500', text: 'text-rose-400' };
  if (rate >= 0.9) return { bar: 'bg-amber-500', text: 'text-amber-400' };
  if (rate >= 0.5) return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
  return { bar: 'bg-blue-500', text: 'text-blue-400' };
}

export default function KtxOccupancyBreakdown({
  items,
  selectedKtx,
  onSelectKtx,
}: {
  items: KtxOccupancy[];
  selectedKtx: string;
  onSelectKtx?: (ktx: string) => void;
}) {
  if (items.length === 0) {
    return <p className="mt-2 text-xs text-gray-400">Chưa có dữ liệu KTX.</p>;
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between px-0.5 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {`Theo KTX (${items.length})`}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Trống</span>
      </div>
      <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin" aria-label="Tỷ lệ lấp đầy theo từng KTX">
        {items.map(item => {
          const pct = Math.round(item.fillRate * 100);
          const tone = getFillTone(item.fillRate);
          const isActive = selectedKtx === item.ktx;
          return (
            <li key={item.ktx}>
              <button
                type="button"
                onClick={() => onSelectKtx?.(isActive ? 'all' : item.ktx)}
                aria-pressed={isActive}
                title={`${item.ktx}: ${item.occupied}/${item.capacity} chỗ · ${item.rooms} phòng${item.overflow > 0 ? ` · vượt ${item.overflow}` : ''}`}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                  isActive
                    ? 'border-blue-500/60 bg-blue-500/15 shadow-sm'
                    : 'border-gray-700/60 bg-gray-800/80 hover:bg-gray-700/60 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate whitespace-nowrap text-xs font-semibold text-gray-200">{item.ktx}</span>
                  <div className="flex items-center gap-2 font-tabular whitespace-nowrap shrink-0">
                    <span className={`text-[11px] font-bold ${tone.text}`}>{pct}%</span>
                    <span className="min-w-[2.5rem] text-right text-xs font-bold text-gray-100">
                      {item.vacant.toLocaleString('vi-VN')}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700" aria-hidden="true">
                  <div className={`h-full rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-gray-400 font-tabular flex items-center justify-between whitespace-nowrap overflow-hidden text-ellipsis">
                  <span className="truncate">{`${item.occupied.toLocaleString('vi-VN')}/${item.capacity.toLocaleString('vi-VN')} chỗ · ${item.rooms} phòng`}</span>
                  {item.overflow > 0 && <span className="font-semibold text-rose-400 shrink-0">{` · vượt ${item.overflow}`}</span>}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
