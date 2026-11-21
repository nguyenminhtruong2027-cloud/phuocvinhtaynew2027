'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronDown, ChevronRight, ChevronUp, Layers } from 'lucide-react';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { naturalSortCompare, type Worker } from '@/data/workers';

interface TopUnitsRankingCardProps {
  workers: Worker[];
  selectedKTX: string;
}

type GroupMode = 'platoon' | 'unit';

interface RankedGroup {
  rawKey: string;
  label: string;
  count: number;
  pct: number;
  isUnassigned: boolean;
}

const TOP_LIMIT = 7;

function formatPlatoonLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Chưa phân tiểu đoàn';
  if (/^(tiểu\s*đoàn|tđ)\b/i.test(trimmed)) return trimmed;
  return `Tiểu đoàn ${trimmed}`;
}

function getBarColorClass(rank: number, isUnassigned: boolean): string {
  if (isUnassigned) return 'bg-ic/70';
  if (rank === 0) return 'bg-pri2';
  if (rank === 1) return 'bg-ok2';
  if (rank === 2) return 'bg-wn';
  return 'bg-pri/75';
}

export default function TopUnitsRankingCard({ workers, selectedKTX }: TopUnitsRankingCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<GroupMode>('platoon');
  const [showOthers, setShowOthers] = useState(false);

  const safeWorkers = useMemo(() => (Array.isArray(workers) ? workers : []), [workers]);
  const totalWorkers = safeWorkers.length;

  const { topGroups, otherGroups, otherCount, maxCount } = useMemo(() => {
    const counts = new Map<string, number>();

    safeWorkers.forEach(w => {
      const rawVal = mode === 'platoon' ? (w?.tieuDoan || '').trim() : (w?.donVi || '').trim();
      const key = rawVal || '__none__';
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const ranked: RankedGroup[] = Array.from(counts.entries())
      .map(([rawKey, count]) => {
        const isUnassigned = rawKey === '__none__';
        const label =
          mode === 'platoon'
            ? isUnassigned
              ? 'Chưa phân tiểu đoàn'
              : formatPlatoonLabel(rawKey)
            : isUnassigned
              ? 'Chưa ghi đơn vị'
              : rawKey;
        return {
          rawKey,
          label,
          count,
          pct: totalWorkers > 0 ? (count / totalWorkers) * 100 : 0,
          isUnassigned,
        };
      })
      .sort((a, b) => {
        // Keep unassigned at the bottom unless it's the only group
        if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
        if (b.count !== a.count) return b.count - a.count;
        return naturalSortCompare(a.label, b.label);
      });

    const top = ranked.slice(0, TOP_LIMIT);
    const others = ranked.slice(TOP_LIMIT);
    const othersSum = others.reduce((sum, g) => sum + g.count, 0);
    const highest = top[0]?.count || 1;

    return {
      topGroups: top,
      otherGroups: others,
      otherCount: othersSum,
      maxCount: highest,
    };
  }, [safeWorkers, mode, totalWorkers]);

  const handleOpenGroup = (group: RankedGroup) => {
    const params = new URLSearchParams();
    if (selectedKTX !== 'all') params.set('ktx', selectedKTX);

    if (mode === 'platoon') {
      params.set('platoon', group.rawKey);
    } else if (!group.isUnassigned) {
      params.set('search', group.rawKey);
    }

    const qs = params.toString();
    router.push(qs ? `/worker-management?${qs}` : '/worker-management');
  };

  const scopeLabel = selectedKTX === 'all' ? 'Toàn KTX' : selectedKTX;
  const otherPct = totalWorkers > 0 ? (otherCount / totalWorkers) * 100 : 0;

  return (
    <div className="surface-elevated rounded-2xl p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <CraftIconBadge icon={Building2} badgeIcon={Layers} tone="blue" size="sm" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-tx tracking-tight truncate">
              Top {mode === 'platoon' ? 'Tiểu Đoàn' : 'Đơn Vị'} Lưu Trú
            </h2>
            <p className="text-xs text-mu font-tabular truncate">
              {scopeLabel} · {totalWorkers.toLocaleString('vi-VN')} công nhân
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div
          className="inline-flex items-center rounded-xl bg-act border border-bdr p-0.5 text-xs shrink-0"
          role="tablist"
          aria-label="Chọn nhóm xếp hạng"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'platoon'}
            onClick={() => {
              setMode('platoon');
              setShowOthers(false);
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              mode === 'platoon'
                ? 'bg-pri text-white shadow-sm'
                : 'text-mu hover:text-tx'
            }`}
          >
            Tiểu đoàn
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'unit'}
            onClick={() => {
              setMode('unit');
              setShowOthers(false);
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              mode === 'unit'
                ? 'bg-pri text-white shadow-sm'
                : 'text-mu hover:text-tx'
            }`}
          >
            Đơn vị
          </button>
        </div>
      </div>

      {/* Body */}
      {totalWorkers === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
          <div className="w-11 h-11 rounded-2xl bg-act border border-bdr flex items-center justify-center mb-2.5 text-ic">
            <Building2 size={20} />
          </div>
          <p className="text-sm font-semibold text-tx">Chưa có dữ liệu phân bổ</p>
          <p className="text-xs text-mu mt-1">
            Chưa ghi nhận công nhân thuộc phạm vi {scopeLabel}
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between gap-3">
          <div className="space-y-2.5">
            {topGroups.map((group, idx) => {
              const barWidth = Math.max(4, Math.round((group.count / maxCount) * 100));
              const pctText =
                group.pct > 0 && group.pct < 0.1
                  ? '<0,1%'
                  : `${group.pct.toFixed(1).replace('.', ',')}%`;

              return (
                <button
                  key={`${mode}-${group.rawKey}`}
                  type="button"
                  onClick={() => handleOpenGroup(group)}
                  className="w-full text-left rounded-xl px-3 py-2.5 bg-act/60 hover:bg-act border border-bdr/70 hover:border-bdr2 transition-all group"
                  title={`Xem danh sách công nhân thuộc ${group.label}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-[11px] font-bold font-tabular w-5 text-center shrink-0 ${
                          idx === 0
                            ? 'text-lnk'
                            : idx === 1
                              ? 'text-ok'
                              : idx === 2
                                ? 'text-wn'
                                : 'text-mu'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <span
                        className={`text-sm font-semibold truncate ${
                          group.isUnassigned ? 'text-mu italic' : 'text-tx'
                        }`}
                      >
                        {group.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 font-tabular">
                      <span className="text-sm font-bold text-tx">
                        {group.count.toLocaleString('vi-VN')}
                      </span>
                      <span className="text-xs text-mu w-11 text-right">{pctText}</span>
                      <ChevronRight
                        size={14}
                        className="text-mu opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
                      />
                    </div>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-bdr/70 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${getBarColorClass(idx, group.isUnassigned)}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </button>
              );
            })}

            {/* Collapsible Others Bucket */}
            {otherGroups.length > 0 && (
              <div className="rounded-xl border border-bdr/70 bg-act/35 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowOthers(prev => !prev)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-act/80 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-semibold text-mu w-5 text-center shrink-0">
                      +
                    </span>
                    <span className="text-xs font-semibold text-mu truncate">
                      Khác ({otherGroups.length} nhóm nhỏ)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-tabular">
                    <span className="text-xs font-bold text-tx">
                      {otherCount.toLocaleString('vi-VN')}
                    </span>
                    <span className="text-xs text-mu w-11 text-right">
                      {otherPct.toFixed(1).replace('.', ',')}%
                    </span>
                    {showOthers ? (
                      <ChevronUp size={14} className="text-mu" />
                    ) : (
                      <ChevronDown size={14} className="text-mu" />
                    )}
                  </div>
                </button>

                {showOthers && (
                  <div className="border-t border-bdr/60 max-h-48 overflow-y-auto scrollbar-thin divide-y divide-bdr/40">
                    {otherGroups.map(group => (
                      <button
                        key={`other-${mode}-${group.rawKey}`}
                        type="button"
                        onClick={() => handleOpenGroup(group)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-act transition-colors text-left"
                      >
                        <span
                          className={`truncate ${
                            group.isUnassigned ? 'text-mu italic' : 'text-tx font-medium'
                          }`}
                        >
                          {group.label}
                        </span>
                        <span className="font-tabular text-mu shrink-0">
                          <strong className="text-tx">{group.count.toLocaleString('vi-VN')}</strong>{' '}
                          ({group.pct.toFixed(1).replace('.', ',')}%)
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Subtle Hint Footer */}
          <div className="pt-2 border-t border-bdr/60 flex items-center justify-between text-[11px] text-mu">
            <span>Bấm vào từng mục để lọc danh sách công nhân</span>
            <span className="font-tabular">
              Tổng {topGroups.length + otherGroups.length} nhóm
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
