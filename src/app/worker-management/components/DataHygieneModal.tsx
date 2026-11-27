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
  Wand2,
  VenusAndMars,
  GitMerge,
} from 'lucide-react';
import { toast } from 'sonner';
import { Worker, removeAccents } from '@/data/workers';
import { daysSinceVN } from '@/lib/vnDate';
import { formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { loadSavedRoomGenderMap, normalizeGender } from '@/lib/roomGender';
import { createClient } from '@/lib/supabase/client';

type HygieneTab =
  | 'dup_cccd'
  | 'overdue_tamtru'
  | 'missing_info'
  | 'dup_phone'
  | 'no_bed'
  | 'gender_mismatch'
  | 'auto_fix';

interface Props {
  workers: Worker[];
  onClose: () => void;
  onEditWorker: (w: Worker) => void;
  onBulkMarkTamTru: (ids: string[]) => Promise<void>;
  onAutoFixed?: (summaryDetail: string) => Promise<void> | void;
  canWriteBlock: (day: string, ktx?: string) => boolean;
  isAdmin: boolean;
}

function normDigits(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

/** Format Vietnamese full name into clean Title Case without stripping diacritics */
export function formatVietnameseTitleCase(raw: string): string {
  const collapsed = (raw || '').trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';
  return collapsed
    .split(' ')
    .map(word => {
      if (!word) return '';
      const chars = Array.from(word);
      const first = chars[0].toLocaleUpperCase('vi-VN');
      const rest = chars.slice(1).join('').toLocaleLowerCase('vi-VN');
      return first + rest;
    })
    .join(' ');
}

export interface AutoFixProposal {
  worker: Worker;
  changes: Array<{
    field: 'ho_va_ten' | 'so_dien_thoai' | 'cccd';
    label: string;
    before: string;
    after: string;
  }>;
  dbPatch: Record<string, string>;
}

export interface VariantMergeGroup {
  field: 'don_vi' | 'to_truong';
  fieldLabel: string;
  canonical: string;
  variants: Array<{ value: string; count: number; workerIds: string[] }>;
  affectedWorkerIds: string[];
}

export interface GenderMismatchItem {
  worker: Worker;
  reason: string;
}

export interface HygieneSummary {
  dupCccd: Worker[];
  dupPhone: Worker[];
  missingInfo: Worker[];
  overdueTamTru: Worker[];
  noBed: Worker[];
  genderMismatches: GenderMismatchItem[];
  autoFixProposals: AutoFixProposal[];
  mergeGroups: VariantMergeGroup[];
  totalIssues: number;
}

export function analyzeWorkerHygiene(workers: Worker[]): HygieneSummary {
  const cccdMap = new Map<string, Worker[]>();
  const phoneMap = new Map<string, Worker[]>();
  const roomGenderBuckets = new Map<string, { males: Worker[]; females: Worker[] }>();
  const donViVariantMap = new Map<string, Map<string, string[]>>();
  const toTruongVariantMap = new Map<string, Map<string, string[]>>();

  const missingInfo: Worker[] = [];
  const overdueTamTru: Worker[] = [];
  const noBed: Worker[] = [];
  const autoFixProposals: AutoFixProposal[] = [];

  const roomGenderMap = typeof window !== 'undefined' ? loadSavedRoomGenderMap() : {};

  for (const w of workers) {
    if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) continue;

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

    // Track room gender consistency
    if (w.ktx && w.day && w.phongSo) {
      const rk = `${w.ktx.trim()}||${w.day.trim()}||${normalizeRoomLabel(w.phongSo)}`;
      const bucket = roomGenderBuckets.get(rk) || { males: [], females: [] };
      const g = normalizeGender(w.gioiTinh);
      if (g === 'nu') bucket.females.push(w);
      else if (g === 'nam') bucket.males.push(w);
      roomGenderBuckets.set(rk, bucket);
    }

    // Track auto-fix formatting proposals
    const changes: AutoFixProposal['changes'] = [];
    const dbPatch: Record<string, string> = {};

    const rawName = w.hoVaTen || '';
    const formattedName = formatVietnameseTitleCase(rawName);
    if (rawName && formattedName && rawName !== formattedName) {
      changes.push({ field: 'ho_va_ten', label: 'Họ tên', before: rawName, after: formattedName });
      dbPatch.ho_va_ten = formattedName;
    }

    const rawPhone = w.soDienThoai || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    if (rawPhone && cleanPhone.length >= 9 && rawPhone !== cleanPhone) {
      changes.push({ field: 'so_dien_thoai', label: 'SĐT', before: rawPhone, after: cleanPhone });
      dbPatch.so_dien_thoai = cleanPhone;
    }

    const rawCccd = w.cccd || '';
    const cleanCccd = rawCccd.replace(/\D/g, '');
    if (rawCccd && cleanCccd.length >= 9 && rawCccd !== cleanCccd) {
      changes.push({ field: 'cccd', label: 'CCCD', before: rawCccd, after: cleanCccd });
      dbPatch.cccd = cleanCccd;
    }

    if (changes.length > 0) {
      autoFixProposals.push({ worker: w, changes, dbPatch });
    }

    // Track case/whitespace/accent variants for donVi & toTruong
    if (w.donVi?.trim()) {
      const normKey = removeAccents(w.donVi.trim().replace(/\s+/g, ' ')).toLowerCase();
      const variants = donViVariantMap.get(normKey) || new Map<string, string[]>();
      const ids = variants.get(w.donVi) || [];
      ids.push(w.id);
      variants.set(w.donVi, ids);
      donViVariantMap.set(normKey, variants);
    }

    if (w.toTruong?.trim()) {
      const normKey = removeAccents(w.toTruong.trim().replace(/\s+/g, ' ')).toLowerCase();
      const variants = toTruongVariantMap.get(normKey) || new Map<string, string[]>();
      const ids = variants.get(w.toTruong) || [];
      ids.push(w.id);
      variants.set(w.toTruong, ids);
      toTruongVariantMap.set(normKey, variants);
    }
  }

  // Gender mismatches (mixed room OR conflicting with admin-assigned room gender)
  const genderMismatches: GenderMismatchItem[] = [];
  const mismatchSeen = new Set<string>();
  for (const [rk, bucket] of roomGenderBuckets.entries()) {
    const override = roomGenderMap[rk];
    if (override === 'male') {
      for (const w of bucket.females) {
        if (!mismatchSeen.has(w.id)) {
          mismatchSeen.add(w.id);
          genderMismatches.push({ worker: w, reason: 'Công nhân Nữ đang xếp trong Phòng Nam' });
        }
      }
    } else if (override === 'female') {
      for (const w of bucket.males) {
        if (!mismatchSeen.has(w.id)) {
          mismatchSeen.add(w.id);
          genderMismatches.push({ worker: w, reason: 'Công nhân Nam đang xếp trong Phòng Nữ' });
        }
      }
    } else if (bucket.males.length > 0 && bucket.females.length > 0) {
      const minority = bucket.males.length >= bucket.females.length ? bucket.females : bucket.males;
      const roomMajorityLabel = bucket.males.length >= bucket.females.length ? 'Nam' : 'Nữ';
      for (const w of minority) {
        if (!mismatchSeen.has(w.id)) {
          mismatchSeen.add(w.id);
          genderMismatches.push({
            worker: w,
            reason: `Phòng đang ở lẫn Nam/Nữ (đa số ${roomMajorityLabel})`,
          });
        }
      }
    }
  }

  // Build variant merge groups (when same normalized text appears with >= 2 different spellings/casings)
  const mergeGroups: VariantMergeGroup[] = [];
  const collectMerges = (
    source: Map<string, Map<string, string[]>>,
    field: 'don_vi' | 'to_truong',
    fieldLabel: string
  ) => {
    for (const variantMap of source.values()) {
      if (variantMap.size < 2) continue;
      const variants = Array.from(variantMap.entries())
        .map(([value, workerIds]) => ({ value, count: workerIds.length, workerIds }))
        .sort((a, b) => b.count - a.count);
      const canonical =
        field === 'to_truong'
          ? formatVietnameseTitleCase(variants[0].value)
          : variants[0].value.trim().replace(/\s+/g, ' ');
      const affectedWorkerIds = variants
        .filter(v => v.value !== canonical)
        .flatMap(v => v.workerIds);
      if (affectedWorkerIds.length > 0) {
        mergeGroups.push({ field, fieldLabel, canonical, variants, affectedWorkerIds });
      }
    }
  };
  collectMerges(donViVariantMap, 'don_vi', 'Đơn vị / Nhà thầu');
  collectMerges(toTruongVariantMap, 'to_truong', 'Tổ trưởng');

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
    ...genderMismatches.map(m => m.worker.id),
  ]);

  return {
    dupCccd,
    dupPhone,
    missingInfo,
    overdueTamTru,
    noBed,
    genderMismatches,
    autoFixProposals,
    mergeGroups,
    totalIssues: uniqueIssueIds.size,
  };
}

export default function DataHygieneModal({
  workers,
  onClose,
  onEditWorker,
  onBulkMarkTamTru,
  onAutoFixed,
  canWriteBlock,
  isAdmin,
}: Props) {
  const summary = useMemo(() => analyzeWorkerHygiene(workers), [workers]);
  const [tab, setTab] = useState<HygieneTab>(() => {
    if (summary.dupCccd.length > 0) return 'dup_cccd';
    if (summary.genderMismatches.length > 0) return 'gender_mismatch';
    if (summary.overdueTamTru.length > 0) return 'overdue_tamtru';
    if (summary.autoFixProposals.length > 0 || summary.mergeGroups.length > 0) return 'auto_fix';
    if (summary.missingInfo.length > 0) return 'missing_info';
    if (summary.dupPhone.length > 0) return 'dup_phone';
    return 'no_bed';
  });

  const [markingTamTru, setMarkingTamTru] = useState(false);
  const [applyingAutoFix, setApplyingAutoFix] = useState(false);
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [excludedFixIds, setExcludedFixIds] = useState<Set<string>>(new Set());

  const authorizedAutoFix = useMemo(
    () => summary.autoFixProposals.filter(p => isAdmin || canWriteBlock(p.worker.day, p.worker.ktx)),
    [summary.autoFixProposals, isAdmin, canWriteBlock]
  );

  const selectedAutoFix = useMemo(
    () => authorizedAutoFix.filter(p => !excludedFixIds.has(p.worker.id)),
    [authorizedAutoFix, excludedFixIds]
  );

  const tabs: {
    id: HygieneTab;
    label: string;
    count: number;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    tone: string;
  }[] = [
    { id: 'dup_cccd', label: 'Trùng CCCD', count: summary.dupCccd.length, icon: Copy, tone: 'text-dgr' },
    {
      id: 'gender_mismatch',
      label: 'Lệch giới tính',
      count: summary.genderMismatches.length,
      icon: VenusAndMars,
      tone: 'text-dgr',
    },
    { id: 'overdue_tamtru', label: 'Quá hạn tạm trú', count: summary.overdueTamTru.length, icon: Clock, tone: 'text-wn' },
    {
      id: 'auto_fix',
      label: 'Chuẩn hóa & Gộp tên',
      count: authorizedAutoFix.length + summary.mergeGroups.length,
      icon: Wand2,
      tone: 'text-lnk',
    },
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
      default:
        return [];
    }
  }, [tab, summary]);

  const authorizedOverdueIds = useMemo(
    () => summary.overdueTamTru.filter(w => isAdmin || canWriteBlock(w.day, w.ktx)).map(w => w.id),
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

  const handleApplyAutoFix = async () => {
    if (selectedAutoFix.length === 0) return;
    setApplyingAutoFix(true);
    const supabase = createClient();
    let okCount = 0;
    try {
      for (const prop of selectedAutoFix) {
        const { error } = await supabase
          .from('workers')
          .update(prop.dbPatch)
          .eq('id', prop.worker.id);
        if (!error) okCount++;
      }
      if (okCount > 0) {
        toast.success(`Đã tự động chuẩn hóa định dạng cho ${okCount} hồ sơ công nhân!`);
        await onAutoFixed?.(`Tự động chuẩn hóa định dạng Họ tên/SĐT/CCCD cho ${okCount} công nhân`);
      } else {
        toast.error('Không thể cập nhật chuẩn hóa dữ liệu.');
      }
    } finally {
      setApplyingAutoFix(false);
    }
  };

  const handleMergeVariantGroup = async (group: VariantMergeGroup) => {
    const allowedIds = group.affectedWorkerIds.filter(id => {
      const w = workers.find(x => x.id === id);
      return w ? isAdmin || canWriteBlock(w.day, w.ktx) : false;
    });
    if (allowedIds.length === 0) {
      toast.warning('Bạn không có quyền chỉnh sửa các hồ sơ thuộc nhóm này.');
      return;
    }
    const key = `${group.field}:${group.canonical}`;
    setMergingKey(key);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('workers')
        .update({ [group.field]: group.canonical })
        .in('id', allowedIds);
      if (error) {
        toast.error(`Lỗi gộp tên: ${error.message}`);
        return;
      }
      toast.success(`Đã gộp ${allowedIds.length} hồ sơ về đúng tên chuẩn "${group.canonical}"!`);
      await onAutoFixed?.(
        `Gộp chuẩn hóa ${group.fieldLabel} thành "${group.canonical}" cho ${allowedIds.length} công nhân`
      );
    } finally {
      setMergingKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface-elevated rounded-t-3xl sm:rounded-2xl shadow-2xl border border-bdr3 w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden sheet-enter-bottom"
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
              <h2 className="text-base font-bold text-tx truncate">Trung tâm Rà soát &amp; Chuẩn hóa Dữ liệu</h2>
              <p className="text-xs text-mu">
                Phát hiện trùng CCCD/SĐT, lệch giới tính phòng, quá hạn tạm trú &amp; tự động chuẩn hóa hàng loạt
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-bdr">
          {tab === 'auto_fix' ? (
            <div className="p-4 sm:p-5 space-y-5 divide-y-0">
              {/* Section 1: Merge Typo / Casing Variants */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-mu flex items-center gap-1.5">
                    <GitMerge size={13} className="text-lnk" />
                    Gộp tên Đơn vị / Tổ trưởng bị gõ lệch ({summary.mergeGroups.length})
                  </h3>
                </div>
                {summary.mergeGroups.length === 0 ? (
                  <div className="rounded-xl border border-bdr bg-surf p-3.5 text-xs text-mu flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-ok shrink-0" />
                    <span>Không phát hiện tên Đơn vị hoặc Tổ trưởng bị trùng lặp sai chính tả/chữ hoa.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {summary.mergeGroups.map(g => {
                      const key = `${g.field}:${g.canonical}`;
                      const busy = mergingKey === key;
                      return (
                        <div
                          key={key}
                          className="rounded-xl border border-bdr2 bg-surf p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="text-xs font-bold text-tx">
                              {g.fieldLabel}: gộp về chuẩn{' '}
                              <span className="text-ok">&ldquo;{g.canonical}&rdquo;</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {g.variants.map(v => (
                                <span
                                  key={v.value}
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                                    v.value === g.canonical
                                      ? 'bg-okbg/30 text-ok border-ok2/40'
                                      : 'tint-wn text-wn border-wn/30'
                                  }`}
                                >
                                  &ldquo;{v.value}&rdquo; ({v.count})
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleMergeVariantGroup(g)}
                            className="px-3 py-1.5 rounded-xl btn-glow-primary text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                            <span>Gộp {g.affectedWorkerIds.length} hồ sơ</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 2: Auto-format Names, Phone, CCCD */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-mu flex items-center gap-1.5">
                    <Wand2 size={13} className="text-lnk" />
                    Chuẩn hóa Viết hoa Họ tên &amp; Định dạng SĐT/CCCD ({selectedAutoFix.length}/{authorizedAutoFix.length})
                  </h3>
                  {authorizedAutoFix.length > 0 && (
                    <button
                      type="button"
                      disabled={applyingAutoFix || selectedAutoFix.length === 0}
                      onClick={handleApplyAutoFix}
                      className="btn-glow-primary px-3.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {applyingAutoFix ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                      <span>Áp dụng chuẩn hóa ({selectedAutoFix.length})</span>
                    </button>
                  )}
                </div>

                {authorizedAutoFix.length === 0 ? (
                  <div className="rounded-xl border border-bdr bg-surf p-4 text-xs text-mu flex items-center gap-2">
                    <ShieldCheck size={16} className="text-ok shrink-0" />
                    <span>Toàn bộ Họ tên, SĐT và CCCD đều đã đúng chuẩn định dạng!</span>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-bdr overflow-hidden divide-y divide-bdr">
                    {authorizedAutoFix.slice(0, 100).map(prop => {
                      const checked = !excludedFixIds.has(prop.worker.id);
                      return (
                        <label
                          key={prop.worker.id}
                          className="px-3.5 py-2.5 bg-surf hover:bg-act/40 flex items-start gap-2.5 text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setExcludedFixIds(prev => {
                                const next = new Set(prev);
                                if (next.has(prop.worker.id)) next.delete(prop.worker.id);
                                else next.add(prop.worker.id);
                                return next;
                              });
                            }}
                            className="mt-0.5 rounded accent-pri2 shrink-0"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="font-bold text-tx">{prop.worker.hoVaTen}</div>
                            {prop.changes.map(c => (
                              <div key={c.field} className="text-[11px] flex items-center gap-1.5 flex-wrap">
                                <span className="text-mu font-semibold">{c.label}:</span>
                                <span className="line-through text-dgr/85 font-mono">{c.before}</span>
                                <span className="text-mu">→</span>
                                <span className="text-ok font-bold font-mono">{c.after}</span>
                              </div>
                            ))}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'gender_mismatch' ? (
            summary.genderMismatches.length === 0 ? (
              <div className="py-14 px-6 text-center space-y-2">
                <ShieldCheck size={36} className="mx-auto text-ok opacity-85" />
                <p className="text-sm font-bold text-tx">Không có công nhân nào ở nhầm phòng khác giới tính!</p>
                <p className="text-xs text-mu">Tất cả các phòng Nam/Nữ đều đồng nhất.</p>
              </div>
            ) : (
              summary.genderMismatches.map(({ worker: w, reason }) => {
                const canEdit = isAdmin || canWriteBlock(w.day, w.ktx);
                return (
                  <div
                    key={`gm-${w.id}`}
                    className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-act/40 transition-colors"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-tx">{w.hoVaTen}</span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-act text-tx">
                          {w.gioiTinh || '—'}
                        </span>
                      </div>
                      <div className="text-xs text-mu font-tabular">
                        {[w.ktx, w.day, w.phongSo ? formatRoomDisplay(w.phongSo) : '', w.giuong ? `G.${w.giuong}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <div className="text-[11px] font-semibold text-dgr">{reason}</div>
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => onEditWorker(w)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-lnk cursor-pointer shrink-0"
                      >
                        <Edit2 size={12} />
                        <span>Điều chuyển</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-mu shrink-0">Ngoài phạm vi</span>
                    )}
                  </div>
                );
              })
            )
          ) : activeList.length === 0 ? (
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
