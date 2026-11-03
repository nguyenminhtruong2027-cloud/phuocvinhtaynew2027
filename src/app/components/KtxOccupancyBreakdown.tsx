'use client';
import React from 'react';
import type { KtxOccupancy } from '@/data/workers';

function getFillTone(rate: number) {
  if (rate > 1) return { bar: 'bg-dgr', text: 'text-dgr' };
  if (rate >= 0.9) return { bar: 'bg-wn', text: 'text-wn' };
  if (rate >= 0.5) return { bar: 'bg-ok2', text: 'text-ok' };
  return { bar: 'bg-pri2', text: 'text-lnk' };
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
  const safeItems = (Array.isArray(items) ? items : []).filter(Boolean);
  if (safeItems.length === 0) {
    return <p className="mt-2 text-xs text-mu">Chưa có dữ liệu KTX.</p>;
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between px-0.5 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-mu">
          {`Theo KTX (${safeItems.length})`}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-mu">Trống</span>
      </div>
      <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin" aria-label="Tỷ lệ lấp đầy theo từng KTX">
        {safeItems.map((item, idx) => {
          const ktxLabel = item?.ktx ?? `KTX ${idx + 1}`;
          const fillRate = Number(item?.fillRate ?? 0) || 0;
          const occupied = Number(item?.occupied ?? 0) || 0;
          const capacity = Number(item?.capacity ?? 0) || 0;
          const rooms = Number(item?.rooms ?? 0) || 0;
          const overflow = Number(item?.overflow ?? 0) || 0;
          const vacant = Math.max(0, capacity - occupied);
          const pct = Math.round(fillRate * 100);
          const tone = getFillTone(fillRate);
          const isActive = selectedKtx === ktxLabel;
          return (
            <li key={`${ktxLabel}-${idx}`}>
              <button
                type="button"
                onClick={() => onSelectKtx?.(isActive ? 'all' : ktxLabel)}
                aria-pressed={isActive}
                title={`${ktxLabel}: ${occupied}/${capacity} chỗ · ${rooms} phòng${overflow > 0 ? ` · vượt ${overflow}` : ''}`}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-pri2/50 ${
                  isActive
                    ? 'border-pri2/60 bg-act shadow-sm'
                    : 'border-bdr bg-surf hover:bg-act'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate whitespace-nowrap text-xs font-semibold text-tx">{ktxLabel}</span>
                  <div className="flex items-center gap-2 font-tabular whitespace-nowrap shrink-0">
                    <span className={`text-[11px] font-bold ${tone.text}`}>{pct}%</span>
                    <span className="min-w-[2.5rem] text-right text-xs font-bold text-tx">
                      {vacant.toLocaleString('vi-VN')}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bdr2" aria-hidden="true">
                  <div className={`h-full rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-mu font-tabular flex items-center justify-between whitespace-nowrap overflow-hidden text-ellipsis">
                  <span className="truncate">{`${occupied.toLocaleString('vi-VN')}/${capacity.toLocaleString('vi-VN')} chỗ · ${rooms} phòng`}</span>
                  {overflow > 0 && <span className="font-semibold text-dgr shrink-0">{` · vượt ${overflow}`}</span>}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
