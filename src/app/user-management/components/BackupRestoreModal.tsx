'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  Upload,
  FileJson,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Database,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  FullSystemBackupSnapshot,
  TableDiffResult,
  RestoreMode,
  BackupRestoreTableOutcome,
  parseAndValidateBackupJson,
  diffBackupAgainstLive,
  restoreBackupTables,
} from '@/lib/systemBackup';

interface Props {
  onClose: () => void;
  onRestoreComplete: (summaryText: string) => void;
}

export default function BackupRestoreModal({ onClose, onRestoreComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [snapshot, setSnapshot] = useState<FullSystemBackupSnapshot | null>(null);
  const [diffs, setDiffs] = useState<TableDiffResult[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [parseError, setParseError] = useState('');

  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RestoreMode>('missing_only');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [outcomes, setOutcomes] = useState<BackupRestoreTableOutcome[] | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setOutcomes(null);
    setFileName(file.name);
    setAnalyzing(true);

    try {
      const text = await file.text();
      const parsed = parseAndValidateBackupJson(text);
      if (!parsed.snapshot) {
        setSnapshot(null);
        setDiffs([]);
        setParseError(parsed.error || 'Tệp sao lưu không hợp lệ.');
        return;
      }

      setSnapshot(parsed.snapshot);
      const diffResults = await diffBackupAgainstLive(parsed.snapshot);
      setDiffs(diffResults);

      // Auto-select tables that have missing records
      const autoSelected = new Set<string>(
        diffResults.filter(d => d.available && d.missingCount > 0).map(d => d.key)
      );
      setSelectedTables(autoSelected);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Không thể đọc tệp sao lưu.');
    } finally {
      setAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleTable = (key: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalToRestore = useMemo(() => {
    return diffs
      .filter(d => selectedTables.has(d.key) && d.available)
      .reduce((sum, d) => sum + (mode === 'missing_only' ? d.missingCount : d.backupCount), 0);
  }, [diffs, selectedTables, mode]);

  const handleRunRestore = async () => {
    if (!snapshot || selectedTables.size === 0 || totalToRestore === 0) return;
    if (mode === 'upsert' && !confirmOverwrite) {
      toast.error('Vui lòng tích xác nhận trước khi khôi phục ghi đè.');
      return;
    }

    setRestoring(true);
    setOutcomes(null);
    try {
      const res = await restoreBackupTables({
        diffs,
        selectedTableKeys: Array.from(selectedTables),
        mode,
        onProgress: (label, cur, total) => setProgressText(`Đang xử lý (${cur}/${total}): ${label}...`),
      });
      setOutcomes(res);
      const totalRestored = res.reduce((s, r) => s + r.restored, 0);
      const failed = res.filter(r => !r.ok);

      if (failed.length === 0) {
        toast.success(`Đã khôi phục thành công ${totalRestored.toLocaleString('vi-VN')} bản ghi!`);
      } else {
        toast.warning(
          `Khôi phục ${totalRestored.toLocaleString('vi-VN')} bản ghi, có ${failed.length} bảng gặp lỗi phân quyền/ràng buộc.`
        );
      }

      const tableDesc = res
        .filter(r => r.restored > 0)
        .map(r => `${r.label}: +${r.restored}`)
        .join(', ');
      onRestoreComplete(
        `Khôi phục từ ${fileName} (${mode === 'missing_only' ? 'Chỉ bổ sung bản ghi thiếu' : 'Ghi đè bản ghi trùng ID'}): ${tableDesc || '0 bản ghi mới'}`
      );

      // Re-run diff so numbers immediately reflect the new live state
      const refreshed = await diffBackupAgainstLive(snapshot);
      setDiffs(refreshed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi trong quá trình khôi phục dữ liệu.');
    } finally {
      setRestoring(false);
      setProgressText('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={() => !restoring && onClose()}
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
              <RotateCcw size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-tx truncate">Kiểm tra &amp; Khôi phục từ Backup JSON</h2>
              <p className="text-xs text-mu">
                Đối chiếu chênh lệch với dữ liệu hiện tại trước khi khôi phục an toàn (Super Admin)
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={restoring}
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* File Drop / Picker */}
          <div className="rounded-2xl border border-dashed border-bdr2 bg-act/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileJson size={24} className="text-pri2 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-tx truncate">
                  {fileName || 'Chọn file sao lưu hệ thống (.json)'}
                </p>
                <p className="text-[11px] text-mu">
                  {snapshot
                    ? `Sao lưu lúc ${snapshot.generatedAtVN} bởi ${snapshot.actor} · ${snapshot.totalRecords.toLocaleString('vi-VN')} bản ghi`
                    : 'Tệp xuất từ nút "Tải gói phục hồi (.json)" — Không ghi đè tài khoản & nhật ký hệ thống.'}
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={analyzing || restoring}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-surf border border-bdr2 text-tx hover:bg-act text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50"
            >
              {analyzing ? <RefreshCw size={13} className="animate-spin text-pri2" /> : <Upload size={13} />}
              <span>{analyzing ? 'Đang đối chiếu...' : snapshot ? 'Chọn file khác' : 'Tải file .json'}</span>
            </button>
          </div>

          {parseError && (
            <div className="rounded-xl tint-dgr border border-dgr/35 px-3.5 py-2.5 text-xs text-dgr font-medium flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Diff Table */}
          {snapshot && diffs.length > 0 && (
            <>
              {/* Mode Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label
                  className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                    mode === 'missing_only'
                      ? 'bg-okbg/25 border-ok2/60'
                      : 'bg-surf border-bdr hover:bg-act/40'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="restore-mode"
                      checked={mode === 'missing_only'}
                      onChange={() => {
                        setMode('missing_only');
                        setConfirmOverwrite(false);
                      }}
                      className="mt-0.5 accent-ok2"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-tx flex items-center gap-1.5">
                        <ShieldCheck size={13} className="text-ok" />
                        <span>Chỉ bổ sung bản ghi bị thiếu (Khuyên dùng)</span>
                      </div>
                      <p className="text-[11px] text-mu leading-relaxed">
                        Chỉ chèn lại những bản ghi đã bị xóa khỏi hệ thống. Giữ nguyên 100% dữ liệu đang có.
                      </p>
                    </div>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                    mode === 'upsert'
                      ? 'tint-wn border-wn/60'
                      : 'bg-surf border-bdr hover:bg-act/40'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="restore-mode"
                      checked={mode === 'upsert'}
                      onChange={() => setMode('upsert')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-tx flex items-center gap-1.5">
                        <AlertTriangle size={13} className="text-wn" />
                        <span>Khôi phục &amp; Ghi đè bản ghi trùng ID</span>
                      </div>
                      <p className="text-[11px] text-mu leading-relaxed">
                        Cập nhật lại dữ liệu các bản ghi trùng ID về đúng trạng thái trong file sao lưu.
                      </p>
                    </div>
                  </div>
                </label>
              </div>

              {/* Per-Table Diff List */}
              <div className="rounded-2xl border border-bdr overflow-hidden divide-y divide-bdr">
                <div className="px-3.5 py-2 bg-act/60 flex items-center justify-between text-[11px] font-bold text-mu uppercase tracking-wider">
                  <span>Bảng dữ liệu (Chọn bảng cần khôi phục)</span>
                  <span>Trong file / Hiện tại / Bị thiếu</span>
                </div>
                {diffs.map(d => {
                  const checked = selectedTables.has(d.key);
                  const countInMode = mode === 'missing_only' ? d.missingCount : d.backupCount;
                  const disabled = !d.available || countInMode === 0;
                  return (
                    <label
                      key={d.key}
                      className={`px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs transition-colors ${
                        disabled ? 'opacity-55 cursor-not-allowed bg-surf' : 'cursor-pointer hover:bg-act/40 bg-surf'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked && !disabled}
                          disabled={disabled}
                          onChange={() => toggleTable(d.key)}
                          className="rounded border-bdr accent-pri2 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-tx flex items-center gap-1.5">
                            <Database size={12} className="text-mu shrink-0" />
                            <span className="truncate">{d.label}</span>
                          </div>
                          {!d.available && d.error && (
                            <div className="text-[10px] text-dgr truncate">{d.error}</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-tabular shrink-0 text-[11px]">
                        <span className="text-mu">{d.backupCount.toLocaleString('vi-VN')}</span>
                        <span className="text-mu">/</span>
                        <span className="text-tx font-medium">{d.liveCount.toLocaleString('vi-VN')}</span>
                        <span className="text-mu">/</span>
                        <span
                          className={`px-2 py-0.5 rounded-md font-bold ${
                            d.missingCount > 0 ? 'tint-wn text-wn' : 'bg-okbg/40 text-ok'
                          }`}
                        >
                          {d.missingCount > 0 ? `-${d.missingCount.toLocaleString('vi-VN')} thiếu` : 'Đủ'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>

              {mode === 'upsert' && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl tint-wn border border-wn/40 text-xs text-tx cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmOverwrite}
                    onChange={e => setConfirmOverwrite(e.target.checked)}
                    className="mt-0.5 rounded accent-amber-500"
                  />
                  <span>
                    Tôi hiểu rằng chế độ ghi đè sẽ khôi phục các bản ghi trùng ID của các bảng đã chọn về đúng thời điểm sao lưu <strong>{snapshot.generatedAtVN}</strong>.
                  </span>
                </label>
              )}
            </>
          )}

          {/* Outcomes */}
          {outcomes && (
            <div className="rounded-xl border border-bdr2 bg-act/50 p-3.5 space-y-2">
              <div className="text-xs font-bold text-tx flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-ok" />
                <span>Kết quả khôi phục</span>
              </div>
              <div className="space-y-1">
                {outcomes.map(o => (
                  <div key={o.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-tx font-medium">{o.label}</span>
                    {o.ok ? (
                      <span className="text-ok font-bold font-tabular">
                        +{o.restored.toLocaleString('vi-VN')} bản ghi
                      </span>
                    ) : (
                      <span className="text-dgr font-medium truncate max-w-[260px]" title={o.error}>
                        Lỗi ({o.restored}/{o.attempted}): {o.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bdr bg-surf flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-mu font-tabular">
            {progressText ||
              (snapshot
                ? `Sẽ khôi phục: ${totalToRestore.toLocaleString('vi-VN')} bản ghi (${selectedTables.size} bảng)`
                : 'Chưa chọn tệp sao lưu')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={restoring}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-tx cursor-pointer disabled:opacity-40"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={
                restoring ||
                analyzing ||
                !snapshot ||
                totalToRestore === 0 ||
                (mode === 'upsert' && !confirmOverwrite)
              }
              onClick={handleRunRestore}
              className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {restoring ? <RefreshCw size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              <span>{restoring ? 'Đang khôi phục...' : 'Tiến hành khôi phục'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
