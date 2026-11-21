'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Archive,
  Download,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Filter,
  CheckSquare,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { AuditEntry } from '@/context/AuditContext';
import { buildStructuredExportRows, type ResolvedActor } from '@/lib/auditParser';
import { exportToExcel } from '@/lib/exportExcel';
import { getVNDateString } from '@/lib/vnDate';

export type CleanupMode = 'retention' | 'filtered' | 'selected';

interface AuditArchiveModalProps {
  open: boolean;
  initialMode?: CleanupMode;
  selectedEntries: AuditEntry[];
  filteredEntries: AuditEntry[];
  filterSummary?: string;
  hasActiveFilter: boolean;
  onClose: () => void;
  resolveActor: (rawAccount: string) => ResolvedActor;
  onPurged: () => Promise<void>;
}

const RETENTION_OPTIONS = [
  { days: 0, label: 'Tất cả (Làm mới sạch)', danger: true },
  { days: 7, label: 'Cũ hơn 7 ngày', danger: false },
  { days: 30, label: 'Cũ hơn 30 ngày', danger: false },
  { days: 90, label: 'Cũ hơn 90 ngày', danger: false },
  { days: 180, label: 'Cũ hơn 180 ngày', danger: false },
  { days: 365, label: 'Cũ hơn 365 ngày', danger: false },
];

export default function AuditArchiveModal({
  open,
  initialMode = 'retention',
  selectedEntries,
  filteredEntries,
  filterSummary,
  hasActiveFilter,
  onClose,
  resolveActor,
  onPurged,
}: AuditArchiveModalProps) {
  const [mode, setMode] = useState<CleanupMode>(initialMode);
  const [days, setDays] = useState<number>(90);
  const [preserveHardDelete, setPreserveHardDelete] = useState(true);
  const [leaveEmptyOnReset, setLeaveEmptyOnReset] = useState(true);
  const [skipBackupForTest, setSkipBackupForTest] = useState(false);

  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backedUpKey, setBackedUpKey] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setConfirmText('');
    setErrorMsg('');
    setBackedUpKey(null);
    setSkipBackupForTest(initialMode === 'selected');
    setPreserveHardDelete(true);
    setLeaveEmptyOnReset(true);
    if (initialMode === 'retention') {
      setDays(90);
    }
  }, [open, initialMode]);

  const cutoffIso = useCallback((d: number) => {
    return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  }, []);

  // Load eligible count for retention / full reset mode
  useEffect(() => {
    if (!open || mode !== 'retention') return;
    let mounted = true;
    setLoadingCount(true);
    setErrorMsg('');
    const supabase = createClient();

    const loadCount = async () => {
      try {
        let q = supabase.from('audit_logs').select('id', { count: 'exact', head: true });
        if (days > 0) {
          q = q.lt('timestamp', cutoffIso(days)).neq('action', 'AUDIT_ARCHIVE_PURGE');
        }
        if (preserveHardDelete) {
          q = q.neq('action', 'WORKER_HARD_DELETE');
        }
        const { count, error } = await q;
        if (!mounted) return;
        if (error) {
          setEligibleCount(0);
          setErrorMsg(error.message);
        } else {
          setEligibleCount(typeof count === 'number' ? count : 0);
        }
      } catch (err: unknown) {
        if (mounted) {
          setEligibleCount(0);
          setErrorMsg(err instanceof Error ? err.message : 'Không thể kiểm tra số lượng bản ghi.');
        }
      } finally {
        if (mounted) setLoadingCount(false);
      }
    };
    loadCount();

    return () => {
      mounted = false;
    };
  }, [open, mode, days, preserveHardDelete, cutoffIso]);

  // Compute targeted lists for selected / filtered modes
  const targetEntriesForListMode = useMemo(() => {
    const base = mode === 'selected' ? selectedEntries : filteredEntries;
    if (preserveHardDelete) {
      return base.filter(e => e.action !== 'WORKER_HARD_DELETE');
    }
    return base;
  }, [mode, selectedEntries, filteredEntries, preserveHardDelete]);

  const hardDeleteInListCount = useMemo(() => {
    const base = mode === 'selected' ? selectedEntries : filteredEntries;
    return base.filter(e => e.action === 'WORKER_HARD_DELETE').length;
  }, [mode, selectedEntries, filteredEntries]);

  const activeTargetCount =
    mode === 'retention' ? (eligibleCount ?? 0) : targetEntriesForListMode.length;

  const currentBackupKey = `${mode}:${days}:${preserveHardDelete ? 'keep' : 'all'}:${activeTargetCount}`;
  const backupCompleted = backedUpKey === currentBackupKey;

  // Confirmation requirements
  const requiredPhrase =
    mode === 'retention' && days === 0
      ? 'XOA SACH'
      : mode === 'selected' && activeTargetCount <= 30 && preserveHardDelete
        ? ''
        : 'XAC NHAN';

  const handleBackupDownload = async () => {
    setExporting(true);
    setErrorMsg('');
    try {
      let entriesToExport: AuditEntry[] = [];

      if (mode === 'retention') {
        const supabase = createClient();
        const PAGE = 1000;
        for (let page = 0; page < 30; page++) {
          const from = page * PAGE;
          let q = supabase
            .from('audit_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .range(from, from + PAGE - 1);
          if (days > 0) {
            q = q.lt('timestamp', cutoffIso(days)).neq('action', 'AUDIT_ARCHIVE_PURGE');
          }
          if (preserveHardDelete) {
            q = q.neq('action', 'WORKER_HARD_DELETE');
          }
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const list = (data ?? []) as AuditEntry[];
          entriesToExport.push(...list);
          if (list.length < PAGE) break;
        }
      } else {
        entriesToExport = targetEntriesForListMode;
      }

      if (entriesToExport.length === 0) {
        toast.info('Không có bản ghi nào để sao lưu.');
        return;
      }

      const rows = buildStructuredExportRows(entriesToExport, resolveActor);
      const tag =
        mode === 'selected'
          ? 'DaChon'
          : mode === 'filtered'
            ? 'TheoBoLoc'
            : days === 0
              ? 'ToanBo'
              : `CuHon${days}Ngay`;
      exportToExcel(rows, `SaoLuu_NhatKy_${tag}_${getVNDateString()}.xlsx`, 'Sao lưu nhật ký');
      setBackedUpKey(currentBackupKey);
      toast.success(`Đã tải file sao lưu ${entriesToExport.length.toLocaleString('vi-VN')} bản ghi.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải file sao lưu.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleExecuteDelete = async () => {
    if (activeTargetCount === 0) {
      toast.info('Không có bản ghi nào để xóa.');
      return;
    }
    if (!skipBackupForTest && !backupCompleted) {
      toast.warning('Vui lòng tải file Excel sao lưu ở Bước 1 (hoặc đánh dấu bỏ qua cho dữ liệu test).');
      return;
    }
    if (requiredPhrase && confirmText.trim().toUpperCase() !== requiredPhrase) {
      toast.warning(`Vui lòng nhập chính xác "${requiredPhrase}" để xác nhận.`);
      return;
    }

    setPurging(true);
    setErrorMsg('');
    try {
      const supabase = createClient();

      if (mode === 'retention') {
        const { data, error } = await supabase.rpc('purge_audit_logs_flexible', {
          p_days: days,
          p_include_hard_delete: !preserveHardDelete,
          p_leave_empty: days === 0 ? leaveEmptyOnReset : false,
        });
        if (error) {
          if (error.message.toLowerCase().includes('purge_audit_logs_flexible') && error.message.toLowerCase().includes('could not find')) {
            throw new Error(
              'Chưa cài đặt hàm SQL (purge_audit_logs_flexible) trên Supabase. Vui lòng chạy đoạn SQL nâng cấp trong Supabase SQL Editor.'
            );
          }
          throw new Error(error.message);
        }
        const deleted =
          typeof (data as { deleted_count?: number } | null)?.deleted_count === 'number'
            ? (data as { deleted_count: number }).deleted_count
            : activeTargetCount;
        toast.success(
          days === 0
            ? `Đã làm mới sạch ${deleted.toLocaleString('vi-VN')} bản ghi nhật ký hệ thống.`
            : `Đã dọn ${deleted.toLocaleString('vi-VN')} bản ghi cũ hơn ${days} ngày.`
        );
      } else {
        const ids = targetEntriesForListMode.map(e => String(e.id)).filter(Boolean);
        let totalDeleted = 0;
        const CHUNK = 400;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { data, error } = await supabase.rpc('delete_audit_logs_by_ids', {
            p_ids: chunk,
            p_include_hard_delete: !preserveHardDelete,
            p_record_audit: false,
          });
          if (error) {
            if (error.message.toLowerCase().includes('delete_audit_logs_by_ids') && error.message.toLowerCase().includes('could not find')) {
              throw new Error(
                'Chưa cài đặt hàm SQL (delete_audit_logs_by_ids) trên Supabase. Vui lòng chạy đoạn SQL nâng cấp trong Supabase SQL Editor.'
              );
            }
            throw new Error(error.message);
          }
          const c = (data as { deleted_count?: number } | null)?.deleted_count;
          totalDeleted += typeof c === 'number' ? c : chunk.length;
        }
        toast.success(`Đã xóa ${totalDeleted.toLocaleString('vi-VN')} bản ghi nhật ký.`);
      }

      await onPurged();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Xóa nhật ký thất bại.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setPurging(false);
    }
  };

  const step1Ready = activeTargetCount > 0 && (backupCompleted || skipBackupForTest);
  const phraseReady = !requiredPhrase || confirmText.trim().toUpperCase() === requiredPhrase;
  const canExecute = step1Ready && phraseReady && !purging && !loadingCount;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="archive-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <motion.div
            key="archive-dialog"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl bg-surf border border-bdr shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-bdr flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <Archive size={18} className="text-lnk shrink-0" />
                <div>
                  <h2 className="text-base font-bold text-tx">Quản trị & Dọn sạch Nhật ký</h2>
                  <p className="text-xs text-mu">Dành riêng cho Quản trị tối cao · Xác thực bảo mật phía Database</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
                aria-label="Đóng"
              >
                <X size={16} />
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="px-5 pt-3.5 pb-2 border-b border-bdr shrink-0">
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-act border border-bdr">
                <button
                  type="button"
                  onClick={() => {
                    setMode('retention');
                    setConfirmText('');
                    setErrorMsg('');
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    mode === 'retention' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  <RotateCcw size={12} />
                  <span>Theo mốc / Reset</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('filtered');
                    setConfirmText('');
                    setErrorMsg('');
                  }}
                  disabled={!hasActiveFilter}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                    mode === 'filtered' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  <Filter size={12} />
                  <span>Theo bộ lọc ({filteredEntries.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('selected');
                    setConfirmText('');
                    setErrorMsg('');
                  }}
                  disabled={selectedEntries.length === 0}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                    mode === 'selected' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  <CheckSquare size={12} />
                  <span>Đã chọn ({selectedEntries.length})</span>
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Mode-Specific Scope Selector */}
              {mode === 'retention' && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx">Chọn phạm vi cần dọn</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {RETENTION_OPTIONS.map(opt => {
                      const active = days === opt.days;
                      return (
                        <button
                          key={opt.days}
                          type="button"
                          onClick={() => {
                            setDays(opt.days);
                            setConfirmText('');
                          }}
                          className={`px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors cursor-pointer ${
                            active
                              ? opt.danger
                                ? 'tint-dgr border-dgr text-dgr'
                                : 'bg-pri2/10 border-pri2 text-lnk'
                              : 'bg-surf border-bdr text-tx hover:bg-act'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {mode === 'filtered' && (
                <div className="rounded-xl border border-bdr bg-act/40 p-3.5 text-xs space-y-1">
                  <p className="font-semibold text-tx">Bộ lọc đang áp dụng:</p>
                  <p className="text-mu">{filterSummary || 'Đang lọc theo tiêu chí hiện tại trên bảng.'}</p>
                </div>
              )}

              {mode === 'selected' && (
                <div className="rounded-xl border border-bdr bg-act/40 p-3.5 text-xs space-y-1">
                  <p className="font-semibold text-tx">
                    Xóa chính xác {selectedEntries.length.toLocaleString('vi-VN')} bản ghi đã tích chọn trên bảng
                  </p>
                  <p className="text-mu">
                    Phù hợp khi dọn nhanh các dòng test lẻ mà không ảnh hưởng tới phần nhật ký vận hành còn lại.
                  </p>
                </div>
              )}

              {/* Preview Count + Protection Toggles */}
              <div className="rounded-xl border border-bdr bg-act/35 p-3.5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-mu">Số bản ghi sẽ được xóa:</span>
                  {mode === 'retention' && loadingCount ? (
                    <span className="inline-flex items-center gap-1 text-mu">
                      <Loader2 size={12} className="animate-spin" /> Đang đếm...
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-dgr font-tabular">
                      {activeTargetCount.toLocaleString('vi-VN')} bản ghi
                    </span>
                  )}
                </div>

                {/* Toggle: Preserve WORKER_HARD_DELETE tombstones */}
                <label className="flex items-start gap-2.5 text-xs cursor-pointer select-none pt-2 border-t border-bdr">
                  <input
                    type="checkbox"
                    checked={preserveHardDelete}
                    onChange={e => {
                      setPreserveHardDelete(e.target.checked);
                      setConfirmText('');
                    }}
                    className="mt-0.5 rounded border-bdr accent-pri2 cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-tx flex items-center gap-1.5">
                      <ShieldCheck size={13} className="text-ok shrink-0" />
                      Giữ lại bản ghi bảo vệ xóa triệt để (<span className="font-mono">WORKER_HARD_DELETE</span>)
                    </span>
                    <p className="text-[11px] text-mu leading-relaxed">
                      Khuyên BẬT khi hệ thống đang chạy thật để ngăn đồng bộ phiên cũ khôi phục công nhân đã check-out.
                      {mode !== 'retention' && hardDeleteInListCount > 0
                        ? ` (Hiện có ${hardDeleteInListCount} dòng loại này trong phạm vi đang chọn).`
                        : ' Chỉ tắt khi bạn muốn xóa trắng hoàn toàn trước ngày vận hành chính thức.'}
                    </p>
                  </div>
                </label>

                {!preserveHardDelete && (
                  <div className="rounded-lg border border-dgr/40 tint-dgr p-2.5 flex items-start gap-2 text-[11px] text-dgr">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      Đang chọn <strong>xóa cả bản ghi WORKER_HARD_DELETE</strong>. Chỉ nên dùng khi bạn đã dọn xong dữ liệu test và muốn làm mới sạch hệ thống về 0.
                    </span>
                  </div>
                )}

                {mode === 'retention' && days === 0 && (
                  <label className="flex items-start gap-2.5 text-xs cursor-pointer select-none pt-2 border-t border-bdr">
                    <input
                      type="checkbox"
                      checked={leaveEmptyOnReset}
                      onChange={e => setLeaveEmptyOnReset(e.target.checked)}
                      className="mt-0.5 rounded border-bdr accent-pri2 cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <span className="font-semibold text-tx">Để bảng nhật ký trống hoàn toàn (0 bản ghi)</span>
                      <p className="text-[11px] text-mu">
                        Không ghi thêm dòng &ldquo;Đã dọn nhật ký&rdquo; sau khi xóa — phù hợp khi bàn giao hệ thống mới tinh.
                      </p>
                    </div>
                  </label>
                )}
              </div>

              {/* Step 1: Backup */}
              <div className="rounded-xl border border-bdr p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-tx">Bước 1: Sao lưu Excel trước khi xóa</span>
                  {backupCompleted && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok">
                      <CheckCircle2 size={13} /> Đã sao lưu
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleBackupDownload}
                  disabled={exporting || (mode === 'retention' && loadingCount) || activeTargetCount === 0}
                  className="w-full py-2 px-3 rounded-lg border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-tx flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>
                    {exporting
                      ? 'Đang đóng gói file sao lưu...'
                      : `Tải file Excel sao lưu (${activeTargetCount.toLocaleString('vi-VN')} bản ghi)`}
                  </span>
                </button>
                <label className="flex items-center gap-2 text-[11px] text-mu cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipBackupForTest}
                    onChange={e => setSkipBackupForTest(e.target.checked)}
                    className="rounded border-bdr accent-pri2 cursor-pointer"
                  />
                  <span>Đây là dữ liệu thử nghiệm (test), bỏ qua bước tải file sao lưu</span>
                </label>
              </div>

              {/* Step 2: Confirmation (when required) */}
              {requiredPhrase && (
                <div
                  className={`rounded-xl border p-3.5 space-y-2 transition-opacity ${
                    step1Ready ? 'border-dgr/40 bg-surf' : 'border-bdr opacity-55'
                  }`}
                >
                  <span className="text-xs font-bold text-dgr block">Bước 2: Xác nhận xóa vĩnh viễn</span>
                  <p className="text-[11px] text-mu">
                    Nhập chính xác <strong className="font-mono text-tx">{requiredPhrase}</strong> để xóa vĩnh viễn{' '}
                    <strong className="text-tx font-tabular">{activeTargetCount.toLocaleString('vi-VN')}</strong> bản ghi khỏi cơ sở dữ liệu.
                  </p>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    disabled={!step1Ready || purging}
                    placeholder={`Nhập ${requiredPhrase}...`}
                    className="input-field py-2 text-xs w-full font-mono uppercase"
                  />
                </div>
              )}

              {errorMsg && (
                <div className="rounded-xl border border-dgr/40 tint-dgr p-3 flex items-start gap-2 text-xs text-dgr">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-bdr flex items-center justify-end gap-2 bg-surf shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={purging}
                className="px-3.5 py-2 rounded-lg border border-bdr text-xs font-semibold text-tx hover:bg-act transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                disabled={!canExecute}
                className="px-4 py-2 rounded-lg bg-dgr text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              >
                {purging ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>
                  {purging
                    ? 'Đang xóa...'
                    : mode === 'retention' && days === 0
                      ? 'Làm mới sạch toàn bộ'
                      : `Xóa ${activeTargetCount.toLocaleString('vi-VN')} bản ghi`}
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
