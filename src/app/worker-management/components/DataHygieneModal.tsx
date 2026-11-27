'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  AlertTriangle,
  Copy,
  FileWarning,
  Clock,
  BedDouble,
  Edit2,
  CheckCircle2,
  ShieldCheck,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Worker } from '@/data/workers';
import { daysSinceVN } from '@/lib/vnDate';
import { formatRoomDisplay } from '@/lib/facilityCapacity';

type HygieneTab = 'dup_cccd' | 'dup_phone' | 'missing_info' | 'overdue_tamtru' | 'no_bed';

interface Props {
  workers: Worker[];
  onClose: () => void;
  onEditWorker: (w: Worker) => void;
  onBulkMarkTamTru: (ids: string[]) => Promise<void>;
  canWriteBlock: (day: string, ktx?: string) => boolean;
  isAdmin: boolean;
}

function normDigits(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

export interface HygieneSummary {
  dupCccd: Worker[];
  dupPhone: Worker[];
  missingInfo: Worker[];
  overdueTamTru: Worker[];
  noBed: Worker[];
  totalIssues: number;
}

export function analyzeWorkerHygiene(workers: Worker[]): HygieneSummary {
  const cccdMap = new Map<string, Worker[]>();
  const phoneMap = new Map<string, Worker[]>();

  const missingInfo: Worker[] = [];
  const overdueTamTru: Worker[] = [];
  const noBed: Worker[] = [];

  for (const w of workers) {
    if (w.ngayRaKTX) continue;

    const cccd = normDigits(w.cccd);
    if (cccd.length >= 9) {
      const list = cccdMap.get(cccd) || [];
      list.push(w);
      cccdMap.set(cccd, list);
    }

    const phone = normDigits(w.soDienThoai);
    if (phone.length >= 9) {
      const list = phoneMap.get(phone) || [];
      list.push(w);
      phoneMap.set(phone, list);
    }

    if (cccd.length < 9 || phone.length < 9 || !(w.ngaySinh || '').trim()) {
      missingInfo.push(w);
    }

    if (w.tamTruStatus !== 'registered') {
      const d = daysSinceVN(w.ngayVaoKTX || w.createdAt);
      if (d !== null && d > 7) {
        overdueTamTru.push(w);
      }
    }

    if (!(w.giuong || '').trim()) {
      noBed.push(w);
    }
  }

  const dupCccd: Worker[] = [];
  cccdMap.forEach(group => {
    if (group.length > 1) dupCccd.push(...group);
  });

  const dupPhone: Worker[] = [];
  phoneMap.forEach(group => {
    if (group.length > 1) dupPhone.push(...group);
  });

  const uniqueIssueIds = new Set<string>([
    ...dupCccd.map(w => w.id),
    ...dupPhone.map(w => w.id),
    ...missingInfo.map(w => w.id),
    ...overdueTamTru.map(w => w.id),
  ]);

  return {
    dupCccd,
    dupPhone,
    missingInfo,
    overdueTamTru,
    noBed,
    totalIssues: uniqueIssueIds.size,
  };
}

export default function DataHygieneModal({
  workers,
  onClose,
  onEditWorker,
  onBulkMarkTamTru,
  canWriteBlock,
  isAdmin,
}: Props) {
  const summary = useMemo(() => analyzeWorkerHygiene(workers), [workers]);
  const [tab, setTab] = useState<HygieneTab>(() => {
    if (summary.dupCccd.length > 0) return 'dup_cccd';
    if (summary.overdueTamTru.length > 0) return 'overdue_tamtru';
    if (summary.missingInfo.length > 0) return 'missing_info';
    if (summary.dupPhone.length > 0) return 'dup_phone';
    return 'no_bed';
  });
  const [markingTamTru, setMarkingTamTru] = useState(false);

  const tabs: {
    id: HygieneTab;
    label: string;
    count: number;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    tone: string;
  }[] = [
    { id: 'dup_cccd', label: 'Trùng CCCD', count: summary.dupCccd.length, icon: Copy, tone: 'text-dgr' },
    { id: 'overdue_tamtru', label: 'Quá hạn tạm trú', count: summary.overdueTamTru.length, icon: Clock, tone: 'text-wn' },
    { id: 'missing_info', label: 'Thiếu CCCD/SĐT', count: summary.missingInfo.length, icon: FileWarning, tone: 'text-wn' },
    { id: 'dup_phone', label: 'Trùng SĐT', count: summary.dupPhone.length, icon: AlertTriangle, tone: 'text-wn' },
    { id: 'no_bed', label: 'Chưa gắn giường', count: summary.noBed.length, icon: BedDouble, tone: 'text-lnk' },
  ];

  const activeList = useMemo(() => {
    switch (tab) {
      case 'dup_cccd':
        return summary.dupCccd;
      case 'dup_phone':
        return summary.dupPhone;
      case 'missing_info':
        return summary.missingInfo;
      case 'overdue_tamtru':
        return summary.overdueTamTru;
      case 'no_bed':
        return summary.noBed;
    }
  }, [tab, summary]);

  const authorizedOverdueIds = useMemo(
    () =>
      summary.overdueTamTru
        .filter(w => isAdmin || canWriteBlock(w.day, w.ktx))
        .map(w => w.id),
    [summary.overdueTamTru, isAdmin, canWriteBlock]
  );

  const handleMarkAllOverdue = async () => {
    if (authorizedOverdueIds.length === 0) return;
    setMarkingTamTru(true);
    try {
      await onBulkMarkTamTru(authorizedOverdueIds);
    } finally {
      setMarkingTamTru(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface-elevated rounded-t-3xl sm:rounded-2xl shadow-2xl border border-bdr3 w-full max-w-3xl max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden sheet-enter-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-bdr2" />
        </div>

        {/* Header */}
        <div className="px-5 py-3.5 sm:py-4 border-b border-bdr flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk shrink-0">
              <Sparkles size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-tx truncate">Trung tâm Rà soát &amp; Làm sạch Dữ liệu</h2>
              <p className="text-xs text-mu">
                Tự động phát hiện hồ sơ trùng CCCD/SĐT, thiếu thông tin hoặc quá hạn đăng ký tạm trú
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="px-4 py-2.5 border-b border-bdr bg-act/40 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0">
          {tabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
                  active
                    ? 'bg-surf border-pri2 text-tx shadow-sm'
                    : 'bg-transparent border-transparent text-mu hover:bg-act hover:text-tx'
                }`}
              >
                <Icon size={13} className={t.count > 0 ? t.tone : 'text-mu'} />
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-md text-[11px] font-tabular font-bold ${
                    t.count > 0
                      ? active
                        ? 'bg-pri2/15 text-lnk'
                        : 'bg-act text-tx'
                      : 'bg-act/60 text-mu'
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Batch Action Strip for Overdue Tam Tru */}
        {tab === 'overdue_tamtru' && authorizedOverdueIds.length > 0 && (
          <div className="px-5 py-2.5 bg-okbg/25 border-b border-bdr flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="text-xs text-tx font-medium">
              Có <strong className="font-tabular text-wn">{authorizedOverdueIds.length}</strong> công nhân quá 7 ngày chưa đánh dấu Đã ĐK tạm trú trong phạm vi quyền của bạn.
            </span>
            <button
              type="button"
              onClick={handleMarkAllOverdue}
              disabled={markingTamTru}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ok2 hover:opacity-90 text-ok2-fg text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {markingTamTru ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              <span>Đánh dấu Đã ĐK tất cả ({authorizedOverdueIds.length})</span>
            </button>
          </div>
        )}

        {/* List Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-bdr">
          {activeList.length === 0 ? (
            <div className="py-14 px-6 text-center space-y-2">
              <ShieldCheck size={36} className="mx-auto text-ok opacity-85" />
              <p className="text-sm font-bold text-tx">Dữ liệu mục này hoàn toàn sạch!</p>
              <p className="text-xs text-mu">Không phát hiện hồ sơ bất thường nào trong nhóm đang xem.</p>
            </div>
          ) : (
            activeList.slice(0, 150).map(w => {
              const canEdit = isAdmin || canWriteBlock(w.day, w.ktx);
              const stayDays = daysSinceVN(w.ngayVaoKTX || w.createdAt);
              const missingTags: string[] = [];
              if (normDigits(w.cccd).length < 9) missingTags.push('Thiếu CCCD');
              if (normDigits(w.soDienThoai).length < 9) missingTags.push('Thiếu SĐT');
              if (!(w.ngaySinh || '').trim()) missingTags.push('Thiếu ngày sinh');

              return (
                <div
                  key={`${tab}-${w.id}`}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-act/40 transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-tx truncate">{w.hoVaTen}</span>
                      {w.maNV && (
                        <span className="text-[11px] font-mono text-mu bg-act px-1.5 py-0.5 rounded">
                          {w.maNV}
                        </span>
                      )}
                      {tab === 'overdue_tamtru' && stayDays !== null && (
                        <span className="text-[11px] font-bold text-wn font-tabular">
                          · Ở {stayDays} ngày chưa ĐK
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-mu flex items-center gap-1.5 flex-wrap font-tabular">
                      <span>
                        {[w.ktx, w.day, w.phongSo ? formatRoomDisplay(w.phongSo) : '', w.giuong ? `G.${w.giuong}` : '']
                          .filter(Boolean)
                          .join(' · ') || 'Chưa xếp phòng'}
                      </span>
                      {w.cccd && (
                        <>
                          <span>·</span>
                          <span className={tab === 'dup_cccd' ? 'text-dgr font-mono font-bold' : 'font-mono'}>
                            CCCD: {w.cccd}
                          </span>
                        </>
                      )}
                      {w.soDienThoai && (
                        <>
                          <span>·</span>
                          <span className={tab === 'dup_phone' ? 'text-wn font-bold' : ''}>
                            SĐT: {w.soDienThoai}
                          </span>
                        </>
                      )}
                    </div>
                    {tab === 'missing_info' && missingTags.length > 0 && (
                      <div className="text-[11px] text-wn font-medium">{missingTags.join(' · ')}</div>
                    )}
                  </div>

                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => onEditWorker(w)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-lnk cursor-pointer shrink-0"
                    >
                      <Edit2 size={12} />
                      <span>Sửa ngay</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-mu shrink-0">Ngoài phạm vi</span>
                  )}
                </div>
              );
            })
          )}
          {activeList.length > 150 && (
            <div className="px-5 py-3 text-center text-xs text-mu">
              Đang hiển thị 150/{activeList.length.toLocaleString('vi-VN')} hồ sơ đầu tiên.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bdr bg-surf flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-mu font-tabular">
            Tổng hồ sơ cần lưu ý: <strong className="text-tx">{summary.totalIssues}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-tx cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
