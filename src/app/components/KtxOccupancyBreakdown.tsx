'use client';

import React from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import type { KtxOccupancy } from '@/data/workers';

export interface BuildingOccupancyItem {
  ktx: string;
  building: string;
  rooms: number;
  emptyRooms: number;
  occupied: number;
  capacity: number;
  vacant: number;
  overflow: number;
  fillRate: number;
}

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
  buildings = [],
  onSelectBuilding,
}: {
  items: KtxOccupancy[];
  selectedKtx: string;
  onSelectKtx?: (ktx: string) => void;
  buildings?: BuildingOccupancyItem[];
  onSelectBuilding?: (ktx: string, building: string) => void;
}) {
  const safeItems = (Array.isArray(items) ? items : []).filter(Boolean);
  const safeBuildings = (Array.isArray(buildings) ? buildings : []).filter(Boolean);

  if (safeItems.length === 0) {
    return (
      <div className="py-3 text-xs text-mu">
        Chưa có dữ liệu công suất KTX. Hãy khai báo cơ sở vật chất để theo dõi sức chứa.
      </div>
    );
  }

  const totalRooms = safeItems.reduce((acc, it) => acc + (Number(it.rooms) || 0), 0);
  const totalVacant = safeItems.reduce(
    (acc, it) => acc + Math.max(0, (Number(it.capacity) || 0) - (Number(it.occupied) || 0)),
    0
  );

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} className="text-pri2 shrink-0" />
          <h2 className="text-sm sm:text-base font-bold text-tx tracking-tight">
            Công Suất KTX &amp; Phân Bổ Dãy Nhà
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-mu font-tabular flex-wrap">
          <span>{safeItems.length} KTX</span>
          <span aria-hidden="true">·</span>
          <span>{totalRooms.toLocaleString('vi-VN')} phòng</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-tx">
            Trống {totalVacant.toLocaleString('vi-VN')} chỗ
          </span>
        </div>
      </div>

      {/* KTX Level Overview */}
      <div
        className={
          safeItems.length === 1
            ? 'grid grid-cols-1'
            : safeItems.length === 2
            ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
            : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'
        }
        aria-label="Tỷ lệ lấp đầy theo từng KTX"
      >
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
            <button
              key={`${ktxLabel}-${idx}`}
              type="button"
              onClick={() => onSelectKtx?.(isActive ? 'all' : ktxLabel)}
              aria-pressed={isActive}
              title={`${ktxLabel}: ${occupied}/${capacity} chỗ · ${rooms} phòng${overflow > 0 ? ` · vượt ${overflow}` : ''}`}
              className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-pri2/50 ${
                isActive
                  ? 'border-pri2/70 bg-act'
                  : 'border-bdr bg-act/40 hover:bg-act hover:border-bdr2'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-sm font-bold text-tx">{ktxLabel}</span>
                  <span className="text-xs text-mu font-tabular whitespace-nowrap shrink-0">
                    {occupied.toLocaleString('vi-VN')}/{capacity.toLocaleString('vi-VN')} chỗ · {rooms} phòng
                  </span>
                  {overflow > 0 && (
                    <span className="text-xs font-semibold text-dgr font-tabular whitespace-nowrap shrink-0">
                      · vượt {overflow}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 font-tabular whitespace-nowrap shrink-0">
                  <span className={`text-xs font-bold ${tone.text}`}>{pct}%</span>
                  <span className="text-xs font-bold text-tx">
                    Trống {vacant.toLocaleString('vi-VN')}
                  </span>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bdr2" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Building / Day Level Breakdown Grid */}
      {safeBuildings.length > 0 && (
        <div className="pt-3 border-t border-bdr/70 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-mu">
              Chi tiết theo dãy nhà ({safeBuildings.length} dãy)
            </span>
            {onSelectBuilding && (
              <span className="text-[11px] text-mu hidden sm:inline">
                Bấm vào dãy để mở sơ đồ phòng
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {safeBuildings.map((b) => {
              const pct = Math.round((Number(b.fillRate) || 0) * 100);
              const tone = getFillTone(b.fillRate);
              const showKtxPrefix = safeItems.length > 1 && selectedKtx === 'all';

              return (
                <button
                  key={`${b.ktx}||${b.building}`}
                  type="button"
                  onClick={() => onSelectBuilding?.(b.ktx, b.building)}
                  className="group/day rounded-xl border border-bdr bg-surf hover:bg-act hover:border-pri2/50 px-3 py-2.5 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-pri2/50"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-tx truncate">
                      {showKtxPrefix ? `${b.ktx} · ${b.building}` : b.building}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 font-tabular">
                      <span className={`text-[11px] font-bold ${tone.text}`}>{pct}%</span>
                      {onSelectBuilding && (
                        <ChevronRight
                          size={12}
                          className="text-mu group-hover/day:text-lnk group-hover/day:translate-x-0.5 transition-transform"
                        />
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bdr2" aria-hidden="true">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>

                  <div className="mt-1.5 flex items-center justify-between gap-1 text-[11px] text-mu font-tabular">
                    <span className="truncate">
                      {b.occupied}/{b.capacity} chỗ
                    </span>
                    <span className="font-semibold text-tx shrink-0">
                      Trống {b.vacant}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-mu font-tabular truncate">
                    {b.rooms} phòng · {b.emptyRooms} phòng trống
                    {b.overflow > 0 ? ` · vượt ${b.overflow}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
