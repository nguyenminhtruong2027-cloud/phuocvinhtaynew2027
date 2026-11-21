'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Archive, Download, Trash2, ShieldCheck, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { AuditEntry } from '@/context/AuditContext';
import { buildStructuredExportRows, type ResolvedActor } from '@/lib/auditParser';
import { exportToExcel } from '@/lib/exportExcel';
import { getVNDateString } from '@/lib/vnDate';

interface AuditArchiveModalProps {
  open: boolean;
  onClose: () => void;
  resolveActor: (rawAccount: string) => ResolvedActor;
  onPurged: () => Promise<void>;
}

const RETENTION_OPTIONS = [
  { days: 90, label: 'Cũ hơn 90 ngày (3 tháng)' },
  { days: 180, label: 'Cũ hơn 180 ngày (6 tháng)' },
  { days: 365, label: 'Cũ hơn 365 ngày (1 năm)' },
];

export default function AuditArchiveModal({
  open,
  onClose,
  resolveActor,
  onPurged,
}: AuditArchiveModalProps) {
  const [days, setDays] = useState(90);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backedUpForDays, setBackedUpForDays] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const cutoffIso = useCallback((d: number) => {
    return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  }, []);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoadingCount(true);
    setErrorMsg('');
    setConfirmText('');
    const supabase = createClient();
    const cutoff = cutoffIso(days);

    const loadCount = async () => {
      try {
        const { count, error } = await supabase
          .from('audit_logs')
          .select('id', { count: 'exact', head: true })
          .lt('timestamp', cutoff)
          .neq('action', 'WORKER_HARD_DELETE')
          .neq('action', 'AUDIT_ARCHIVE_PURGE');
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
  }, [open, days, cutoffIso]);

  const handleBackupDownload = async () => {
    setExporting(true);
    setErrorMsg('');
    try {
      const supabase = createClient();
      const cutoff = cutoffIso(days);
      const collected: AuditEntry[] = [];
      const PAGE = 1000;

      for (let page = 0; page < 20; page++) {
        const from = page * PAGE;
        const { data, error } = await supabase
          .from('audit_logs')
          .select('*')
          .lt('timestamp', cutoff)
          .neq('action', 'WORKER_HARD_DELETE')
          .neq('action', 'AUDIT_ARCHIVE_PURGE')
          .order('timestamp', { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) throw new Error(error.message);
        const list = (data ?? []) as AuditEntry[];
        collected.push(...list);
        if (list.length < PAGE) break;
      }

      if (collected.length === 0) {
        toast.info(`Không có bản ghi nào cũ hơn ${days} ngày để sao lưu.`);
        setBackedUpForDays(null);
        return;
      }

      const rows = buildStructuredExportRows(collected, resolveActor);
      exportToExcel(rows, `SaoLuu_NhatKy_CuHon${days}Ngay_${getVNDateString()}.xlsx`, 'Sao lưu nhật ký');
      setBackedUpForDays(days);
      toast.success(`Đã tải file sao lưu ${collected.length.toLocaleString('vi-VN')} bản ghi cũ hơn ${days} ngày.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải file sao lưu.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handlePurge = async () => {
    if (backedUpForDays !== days) {
      toast.warning('Vui lòng tải file Excel sao lưu ở Bước 1 trước khi dọn nhật ký.');
      return;
    }
    if (confirmText.trim().toUpperCase() !== 'XAC NHAN') {
      toast.warning('Vui lòng nhập chính xác "XAC NHAN" để tiếp tục.');
      return;
    }
    setPurging(true);
    setErrorMsg('');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('purge_old_audit_logs', { p_days: days });
      if (error) {
        if (error.message.toLowerCase().includes('purge_old_audit_logs') && error.message.toLowerCase().includes('could not find')) {
          throw new Error(
            'Chưa cài đặt hàm SQL dọn nhật ký (purge_old_audit_logs) trên Supabase. Vui lòng chạy file migration 20261126000000 trong Supabase SQL Editor.'
          );
        }
        throw new Error(error.message);
      }
      const deleted = typeof (data as { deleted_count?: number } | null)?.deleted_count === 'number'
        ? (data as { deleted_count: number }).deleted_count
        : eligibleCount ?? 0;

      toast.success(`Đã dọn ${deleted.toLocaleString('vi-VN')} bản ghi cũ hơn ${days} ngày (giữ nguyên toàn bộ log xác minh xóa triệt để).`);
      await onPurged();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dọn nhật ký thất bại.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setPurging(false);
    }
  };

  const backupReady = backedUpForDays === days && (eligibleCount ?? 0) > 0;
  const canPurge = backupReady && confirmText.trim().toUpperCase() === 'XAC NHAN' && !purging;

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
            className="w-full max-w-lg rounded-2xl bg-surf border border-bdr shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-bdr flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Archive size={18} className="text-lnk shrink-0" />
                <div>
                  <h2 className="text-base font-bold text-tx">Lưu trữ & Dọn nhật ký cũ</h2>
                  <p className="text-xs text-mu">Quy trình 2 bước an toàn dành riêng cho Quản trị tối cao</p>
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

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Retention Picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-tx">Chọn mốc thời gian cần lưu trữ</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {RETENTION_OPTIONS.map(opt => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => {
                        setDays(opt.days);
                        setBackedUpForDays(null);
                        setConfirmText('');
                      }}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors cursor-pointer ${
                        days === opt.days
                          ? 'bg-pri2/10 border-pri2 text-lnk'
                          : 'bg-surf border-bdr text-tx hover:bg-act'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Count Preview & Protection Note */}
              <div className="rounded-xl border border-bdr bg-act/40 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-mu">Số bản ghi đủ điều kiện lưu trữ:</span>
                  {loadingCount ? (
                    <span className="inline-flex items-center gap-1 text-mu">
                      <Loader2 size={12} className="animate-spin" /> Đang đếm...
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-tx font-tabular">
                      {(eligibleCount ?? 0).toLocaleString('vi-VN')} bản ghi
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-2 text-[11px] text-mu leading-relaxed">
                  <ShieldCheck size={14} className="text-ok shrink-0 mt-0.5" />
                  <span>
                    Hệ thống <strong className="text-tx">tự động bảo toàn 100%</strong> các bản ghi xác minh xóa triệt để (<span className="font-mono">WORKER_HARD_DELETE</span>) để đảm bảo công nhân đã check-out không bao giờ bị khôi phục lại.
                  </span>
                </div>
              </div>

              {/* Step 1: Backup */}
              <div className="rounded-xl border border-bdr p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-tx">Bước 1: Tải file Excel sao lưu</span>
                  {backupReady && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok">
                      <CheckCircle2 size={13} /> Đã sao lưu
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleBackupDownload}
                  disabled={exporting || loadingCount || (eligibleCount ?? 0) === 0}
                  className="w-full py-2 px-3 rounded-lg border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-tx flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>
                    {exporting
                      ? 'Đang đóng gói file sao lưu...'
                      : `Tải file Excel sao lưu (${(eligibleCount ?? 0).toLocaleString('vi-VN')} bản ghi)`}
                  </span>
                </button>
              </div>

              {/* Step 2: Confirm & Purge */}
              <div className={`rounded-xl border p-3.5 space-y-2.5 transition-opacity ${backupReady ? 'border-dgr/40 bg-surf' : 'border-bdr opacity-55'}`}>
                <span className="text-xs font-bold text-dgr block">Bước 2: Xác nhận dọn dữ liệu đã sao lưu</span>
                <p className="text-[11px] text-mu">
                  Nhập <strong className="font-mono text-tx">XAC NHAN</strong> để xóa vĩnh viễn các bản ghi cũ hơn {days} ngày khỏi cơ sở dữ liệu sau khi đã lưu file Excel.
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  disabled={!backupReady || purging}
                  placeholder="Nhập XAC NHAN..."
                  className="input-field py-2 text-xs w-full font-mono uppercase"
                />
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-dgr/40 tint-dgr p-3 flex items-start gap-2 text-xs text-dgr">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-bdr flex items-center justify-end gap-2 bg-surf">
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
                onClick={handlePurge}
                disabled={!canPurge}
                className="px-4 py-2 rounded-lg bg-dgr text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              >
                {purging ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>{purging ? 'Đang dọn...' : 'Dọn nhật ký cũ'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
