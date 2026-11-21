'use client';

import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Copy,
  Check,
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  ShieldCheck,
  History,
  FileCode2,
  User,
  Clock,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AuditEntry } from '@/context/AuditContext';
import {
  getActionMeta,
  parseAuditDetail,
  detectAuditAnomaly,
  formatTimestampVN,
  formatRelativeTimeVN,
  type ResolvedActor,
} from '@/lib/auditParser';
import { getRoleDisplayLabel } from '@/context/AuthContext';

interface AuditDetailDrawerProps {
  entry: AuditEntry | null;
  pairedTechnical?: AuditEntry[];
  resolveActor: (rawAccount: string) => ResolvedActor;
  onClose: () => void;
  onTraceWorker: (query: string) => void;
}

export default function AuditDetailDrawer({
  entry,
  pairedTechnical = [],
  resolveActor,
  onClose,
  onTraceWorker,
}: AuditDetailDrawerProps) {
  const [copiedKey, setCopiedKey] = useState<'raw' | 'summary' | null>(null);

  useEffect(() => {
    if (!entry) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entry, onClose]);

  const handleCopy = async (text: string, key: 'raw' | 'summary') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(key === 'raw' ? 'Đã sao chép dữ liệu gốc.' : 'Đã sao chép tóm tắt bản ghi.');
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      toast.error('Không thể sao chép vào bộ nhớ tạm.');
    }
  };

  return (
    <AnimatePresence>
      {entry && (() => {
        const meta = getActionMeta(entry.action);
        const parsed = parseAuditDetail(entry);
        const actor = resolveActor(entry.account);
        const anomaly = detectAuditAnomaly(entry, parsed);
        const traceKeyword = parsed.cccd || parsed.maNv || parsed.workerName;
        const prettyRaw = parsed.rawJson ? JSON.stringify(parsed.rawJson, null, 2) : parsed.rawText;

        const severityLabel =
          meta.severity === 'critical'
            ? 'Thao tác nhạy cảm'
            : meta.severity === 'warning'
              ? 'Cần lưu ý'
              : 'Thông thường';

        const severityTextClass =
          meta.severity === 'critical'
            ? 'text-dgr'
            : meta.severity === 'warning'
              ? 'text-wn'
              : 'text-ok';

        return (
          <motion.div
            key="audit-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex justify-end"
          >
            <motion.aside
              key="audit-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-xl h-full bg-surf border-l border-bdr shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="px-5 py-4 border-b border-bdr flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-mu">
                    <span className={`font-semibold ${severityTextClass}`}>{severityLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px]">{entry.action}</span>
                  </div>
                  <h2 className="text-lg font-bold text-tx mt-1 leading-snug">{meta.labelVi}</h2>
                  <p className="text-xs text-mu mt-1 flex items-center gap-1.5 font-tabular">
                    <Clock size={12} className="shrink-0" />
                    <span>{formatTimestampVN(entry.timestamp)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTimeVN(entry.timestamp)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors shrink-0 cursor-pointer"
                  aria-label="Đóng chi tiết"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Anomaly Alert */}
                {anomaly.isAnomalous && (
                  <div className="rounded-xl border border-dgr/40 tint-dgr p-3.5 flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-dgr shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <p className="font-bold text-dgr">Cảnh báo thao tác bất thường</p>
                      <ul className="space-y-0.5 text-tx/90">
                        {anomaly.reasons.map((r, i) => (
                          <li key={i}>• {r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Actor Info */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-mu">Người thực hiện</h3>
                  <div className="rounded-xl border border-bdr bg-act/40 p-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-bdg text-lnk flex items-center justify-center shrink-0">
                        <User size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-tx truncate">{actor.displayName}</p>
                        <div className="flex items-center gap-1.5 text-xs text-mu truncate">
                          {actor.email && <span className="truncate">{actor.email}</span>}
                          {actor.email && actor.role && <span aria-hidden="true">·</span>}
                          {actor.role && <span>{getRoleDisplayLabel(actor.role)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Before -> After Diff Panel */}
                {parsed.beforeAfter && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-mu">
                      {parsed.beforeAfter.isSwap ? 'Hoán đổi vị trí' : 'Thay đổi (Trước → Sau)'}
                    </h3>
                    <div className="rounded-xl border border-bdr bg-act/30 p-3.5 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                      <div className="rounded-lg bg-surf border border-bdr p-2.5">
                        <p className="text-[11px] font-medium text-mu mb-0.5">
                          {parsed.beforeAfter.isSwap ? 'Vị trí A' : 'Trước'}
                        </p>
                        <p className="text-xs font-semibold text-tx break-words">{parsed.beforeAfter.before}</p>
                      </div>
                      <div className="flex justify-center text-lnk">
                        {parsed.beforeAfter.isSwap ? <ArrowLeftRight size={16} /> : <ArrowRight size={16} />}
                      </div>
                      <div className="rounded-lg bg-surf border border-bdr2 p-2.5">
                        <p className="text-[11px] font-medium text-lnk mb-0.5">
                          {parsed.beforeAfter.isSwap ? 'Vị trí B' : 'Sau'}
                        </p>
                        <p className="text-xs font-semibold text-tx break-words">{parsed.beforeAfter.after}</p>
                      </div>
                    </div>
                  </section>
                )}

                {/* Parsed Subject & Location Summary */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-mu">Thông tin bóc tách</h3>
                    {traceKeyword && (
                      <button
                        type="button"
                        onClick={() => {
                          onTraceWorker(traceKeyword);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-lnk hover:text-pri2 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <History size={13} />
                        <span>Xem dòng thời gian công nhân này</span>
                      </button>
                    )}
                  </div>
                  <div className="rounded-xl border border-bdr divide-y divide-bdr text-xs">
                    <div className="px-3.5 py-2.5 flex items-start justify-between gap-4">
                      <span className="text-mu shrink-0">Tóm tắt</span>
                      <span className="font-medium text-tx text-right break-words">{parsed.summary}</span>
                    </div>
                    {parsed.workerName && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="text-mu shrink-0">Công nhân</span>
                        <span className="font-semibold text-tx text-right">{parsed.workerName}</span>
                      </div>
                    )}
                    {parsed.maNv && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="text-mu shrink-0">Mã nhân viên</span>
                        <span className="font-mono font-semibold text-tx tabular-nums">{parsed.maNv}</span>
                      </div>
                    )}
                    {parsed.cccd && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="text-mu shrink-0">Số CCCD</span>
                        <span className="font-mono font-semibold text-tx tabular-nums">{parsed.cccd}</span>
                      </div>
                    )}
                    {parsed.locationText && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="text-mu shrink-0 flex items-center gap-1">
                          <MapPin size={12} /> Vị trí lưu trú
                        </span>
                        <span className="font-semibold text-tx text-right font-tabular">{parsed.locationText}</span>
                      </div>
                    )}
                    {parsed.integrityVerified !== null && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="text-mu shrink-0 flex items-center gap-1">
                          <ShieldCheck size={12} /> Xác minh toàn vẹn
                        </span>
                        <span className={`font-semibold ${parsed.integrityVerified ? 'text-ok' : 'text-dgr'}`}>
                          {parsed.integrityVerified ? 'Đạt — Đã xóa sạch khỏi hệ thống' : 'Cảnh báo — Cần kiểm tra'}
                        </span>
                      </div>
                    )}
                    {parsed.sourceLabel && (
                      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="text-mu shrink-0">Nguồn thực thi</span>
                        <span className="font-mono text-tx text-right">{parsed.sourceLabel}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Paired Technical Records (when grouped) */}
                {pairedTechnical.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-mu">
                      Bản ghi xác minh kỹ thuật đi kèm ({pairedTechnical.length})
                    </h3>
                    <div className="space-y-2">
                      {pairedTechnical.map(tech => {
                        const techParsed = parseAuditDetail(tech);
                        const techPretty = techParsed.rawJson
                          ? JSON.stringify(techParsed.rawJson, null, 2)
                          : techParsed.rawText;
                        return (
                          <div key={tech.id} className="rounded-xl border border-bdr bg-act/30 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-semibold text-tx flex items-center gap-1.5">
                                <ShieldCheck size={13} className="text-ok" />
                                Xác minh xóa triệt để ({tech.action})
                              </span>
                              <span className="text-mu font-tabular">{formatTimestampVN(tech.timestamp)}</span>
                            </div>
                            <p className="text-xs text-tx/90">{techParsed.summary}</p>
                            <pre className="bg-surf border border-bdr rounded-lg p-2.5 text-[11px] font-mono text-tx/90 overflow-x-auto max-h-48 whitespace-pre-wrap break-words">
                              {techPretty}
                            </pre>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Raw Payload / Copyable Detail */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-mu flex items-center gap-1.5">
                      <FileCode2 size={13} />
                      {parsed.isJson ? 'Dữ liệu JSON gốc' : 'Nội dung nhật ký gốc'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleCopy(prettyRaw, 'raw')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-bdr text-xs font-medium text-tx hover:bg-act transition-colors cursor-pointer"
                    >
                      {copiedKey === 'raw' ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                      <span>{copiedKey === 'raw' ? 'Đã chép' : 'Sao chép'}</span>
                    </button>
                  </div>
                  <pre className="bg-act border border-bdr rounded-xl p-3 text-[11px] leading-relaxed font-mono text-tx overflow-x-auto max-h-72 whitespace-pre-wrap break-words">
                    {prettyRaw}
                  </pre>
                </section>
              </div>

              {/* Drawer Footer */}
              <div className="px-5 py-3 border-t border-bdr flex items-center justify-between gap-2 bg-surf">
                <span className="text-[11px] text-mu font-mono truncate">ID: {entry.id}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        `[${formatTimestampVN(entry.timestamp)}] ${actor.displayName} · ${meta.labelVi}: ${parsed.summary}`,
                        'summary'
                      )
                    }
                    className="px-3 py-1.5 rounded-lg border border-bdr text-xs font-semibold text-tx hover:bg-act transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {copiedKey === 'summary' ? 'Đã sao chép' : 'Chép tóm tắt'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-1.5 rounded-lg bg-pri2 text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </motion.aside>
          </motion.div>
        );
      })()}
    </AnimatePresence>
  );
}
