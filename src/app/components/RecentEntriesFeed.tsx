'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, DoorOpen, MapPin, Sparkles, UserPlus } from 'lucide-react';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { calcSoNgay, type Worker } from '@/data/workers';
import { formatRoomDisplay } from '@/lib/facilityCapacity';

interface RecentEntriesFeedProps {
  workers: Worker[];
  selectedKTX: string;
  onSelectRoom?: (ktx: string, building: string, room: string) => void;
}

const RECENT_WINDOW_DAYS = 10;
const VISIBLE_LIMIT = 8;

function getEntryDaysAgo(worker: Worker): number | null {
  if (worker?.ngayVaoKTX) {
    const days = calcSoNgay(worker.ngayVaoKTX, worker.ngayRaKTX);
    if (Number.isFinite(days) && days >= 0) return days;
  }
  if (worker?.createdAt) {
    const ts = Date.parse(worker.createdAt);
    if (!Number.isNaN(ts)) {
      const diff = Math.floor((Date.now() - ts) / 86400000);
      if (diff >= 0) return diff;
    }
  }
  return null;
}

function formatRelativeDaysLabel(days: number): string {
  if (days <= 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  return `${days} ngày trước`;
}

export default function RecentEntriesFeed({
  workers,
  selectedKTX,
  onSelectRoom,
}: RecentEntriesFeedProps) {
  const router = useRouter();

  const { allRecent, visibleRecent } = useMemo(() => {
    const list = (Array.isArray(workers) ? workers : [])
      .map(worker => ({ worker, daysAgo: getEntryDaysAgo(worker) }))
      .filter(
        (item): item is { worker: Worker; daysAgo: number } =>
          item.daysAgo !== null && item.daysAgo >= 0 && item.daysAgo <= RECENT_WINDOW_DAYS
      )
      .sort((a, b) => {
        if (a.daysAgo !== b.daysAgo) return a.daysAgo - b.daysAgo;
        const tsA = a.worker.createdAt ? Date.parse(a.worker.createdAt) || 0 : 0;
        const tsB = b.worker.createdAt ? Date.parse(b.worker.createdAt) || 0 : 0;
        if (tsB !== tsA) return tsB - tsA;
        return (a.worker.hoVaTen || '').localeCompare(b.worker.hoVaTen || '', 'vi');
      });

    return {
      allRecent: list,
      visibleRecent: list.slice(0, VISIBLE_LIMIT),
    };
  }, [workers]);

  const totalRecent = allRecent.length;
  const scopeLabel = selectedKTX === 'all' ? 'Toàn KTX' : selectedKTX;

  const handleOpenWorker = (workerId: string) => {
    router.push(`/worker-management?view=${encodeURIComponent(workerId)}`);
  };

  const handleOpenAll = () => {
    const params = new URLSearchParams();
    if (selectedKTX !== 'all') params.set('ktx', selectedKTX);
    const qs = params.toString();
    router.push(qs ? `/worker-management?${qs}` : '/worker-management');
  };

  return (
    <div className="surface-elevated rounded-2xl p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <CraftIconBadge icon={Sparkles} badgeIcon={UserPlus} tone="teal" size="sm" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-tx tracking-tight truncate">
              Mới Vào Gần Đây
            </h2>
            <p className="text-xs text-mu font-tabular truncate">
              {scopeLabel} · Trong {RECENT_WINDOW_DAYS} ngày qua
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold font-tabular text-lnk">
            {totalRecent.toLocaleString('vi-VN')} người
          </span>
        </div>
      </div>

      {/* Body */}
      {totalRecent === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
          <div className="w-11 h-11 rounded-2xl bg-act border border-bdr flex items-center justify-center mb-2.5 text-ic">
            <UserPlus size={20} />
          </div>
          <p className="text-sm font-semibold text-tx">Không có công nhân mới</p>
          <p className="text-xs text-mu mt-1">
            Chưa có người mới vào {scopeLabel} trong {RECENT_WINDOW_DAYS} ngày qua
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between gap-3">
          <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1 scrollbar-thin">
            {visibleRecent.map(({ worker: w, daysAgo }) => {
              const hasRoom = Boolean(w?.ktx && w?.day && w?.phongSo);
              const locationText = hasRoom
                ? `${w.ktx} · ${w.day} · ${formatRoomDisplay(w.phongSo)}`
                : [w?.ktx, w?.day].filter(Boolean).join(' · ') || 'Chưa xếp phòng';
              const metaSub = [
                w?.maNV ? `#${w.maNV}` : null,
                w?.tieuDoan ? `TĐ ${w.tieuDoan}` : w?.donVi || null,
              ]
                .filter(Boolean)
                .join(' · ');

              const timeToneClass =
                daysAgo <= 0
                  ? 'text-ok bg-okbg border-ok/30'
                  : daysAgo === 1
                    ? 'text-lnk bg-bdg border-bdr2'
                    : 'text-mu bg-surf border-bdr';

              return (
                <div
                  key={w.id}
                  onClick={() => handleOpenWorker(w.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenWorker(w.id);
                    }
                  }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-act/60 border border-bdr/70 hover:bg-act hover:border-bdr2 transition-all duration-150 cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-bdg border border-bdr2 flex items-center justify-center shrink-0 text-lnk text-xs font-bold">
                    {w.hoVaTen?.trim()?.charAt(0)?.toUpperCase() || <UserPlus size={14} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <p className="text-sm font-semibold text-tx truncate leading-tight">
                        {w.hoVaTen}
                      </p>
                      {metaSub && (
                        <span className="text-[11px] text-mu font-tabular truncate hidden sm:inline">
                          {metaSub}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <MapPin size={11} className="text-mu shrink-0" />
                      <p className="text-xs text-mu font-tabular truncate">{locationText}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasRoom && onSelectRoom && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onSelectRoom(w.ktx, w.day, w.phongSo);
                        }}
                        title={`Mở sơ đồ ${formatRoomDisplay(w.phongSo)}`}
                        className="p-1.5 rounded-lg bg-surf border border-bdr text-mu hover:text-tx hover:border-bdr2 transition-colors opacity-80 group-hover:opacity-100"
                      >
                        <DoorOpen size={13} />
                      </button>
                    )}
                    <span
                      className={`text-[11px] font-tabular font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${timeToneClass}`}
                    >
                      {formatRelativeDaysLabel(daysAgo)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="pt-2 border-t border-bdr/60 flex items-center justify-between text-[11px] text-mu">
            <span className="font-tabular">
              {totalRecent > VISIBLE_LIMIT
                ? `Hiển thị ${visibleRecent.length}/${totalRecent.toLocaleString('vi-VN')} người mới nhất`
                : 'Bấm vào dòng để xem hồ sơ hoặc mở nhanh phòng'}
            </span>
            <button
              type="button"
              onClick={handleOpenAll}
              className="inline-flex items-center gap-1 font-semibold text-lnk hover:underline shrink-0"
            >
              <span>Xem tất cả</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
