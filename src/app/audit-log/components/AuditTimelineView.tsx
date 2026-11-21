'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  History,
  Download,
  Clock,
  MapPin,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AuditEntry, AuditFilterParams } from '@/context/AuditContext';
import {
  getActionMeta,
  parseAuditDetail,
  detectAuditAnomaly,
  formatTimestampVN,
  formatRelativeTimeVN,
  buildStructuredExportRows,
  type ResolvedActor,
} from '@/lib/auditParser';
import { exportToExcel } from '@/lib/exportExcel';
import { getVNDateString } from '@/lib/vnDate';

interface AuditTimelineViewProps {
  initialQuery: string;
  recentLogs: AuditEntry[];
  fetchFilteredLogs: (filters: AuditFilterParams) => Promise<AuditEntry[]>;
  resolveActor: (rawAccount: string) => ResolvedActor;
  onSelectEntry: (entry: AuditEntry) => void;
}

export default function AuditTimelineView({
  initialQuery,
  recentLogs,
  fetchFilteredLogs,
  resolveActor,
  onSelectEntry,
}: AuditTimelineViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [results, setResults] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (initialQuery && initialQuery !== activeQuery) {
      setQuery(initialQuery);
      setActiveQuery(initialQuery);
    }
  }, [initialQuery, activeQuery]);

  // Quick worker suggestions extracted from recent audit entries
  const recentWorkerSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ label: string; token: string }> = [];
    for (const log of recentLogs) {
      const p = parseAuditDetail(log);
      const token = p.maNv || p.cccd || p.workerName;
      if (!token || token.length < 2) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        label: p.workerName && p.maNv ? `${p.workerName} (${p.maNv})` : p.workerName || token,
        token,
      });
      if (list.length >= 6) break;
    }
    return list;
  }, [recentLogs]);

  useEffect(() => {
    const kw = activeQuery.trim();
    if (!kw) {
      setResults([]);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    fetchFilteredLogs({ keyword: kw, limit: 1500 })
      .then(rows => {
        if (!mounted) return;
        const kwLower = kw.toLowerCase();
        const filtered = rows.filter(r => r.detail.toLowerCase().includes(kwLower));
        setResults(filtered);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeQuery, fetchFilteredLogs]);

  const orderedTimeline = useMemo(() => {
    const copy = [...results];
    copy.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return sortOrder === 'asc' ? ta - tb : tb - ta;
    });
    return copy;
  }, [results, sortOrder]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(query.trim());
  };

  const handleExportTimeline = () => {
    if (orderedTimeline.length === 0) {
      toast.warning('Không có dữ liệu dòng thời gian để xuất.');
      return;
    }
    const rows = buildStructuredExportRows(orderedTimeline, resolveActor);
    const safeName = activeQuery.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF_-]/g, '_').slice(0, 32);
    exportToExcel(rows, `TruyVet_${safeName || 'CongNhan'}_${getVNDateString()}.xlsx`, 'Dòng thời gian');
    toast.success(`Đã xuất ${rows.length} mốc lịch sử cho "${activeQuery}".`);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="surface-elevated rounded-2xl p-4 space-y-3">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mu" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Nhập tên công nhân, Mã NV hoặc số CCCD để truy vết vòng đời cư trú..."
              className="input-field pl-9 pr-9 py-2.5 text-sm w-full"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setActiveQuery('');
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-mu hover:text-tx p-0.5 cursor-pointer"
                aria-label="Xóa từ khóa"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!query.trim() || loading}
            className="px-4 py-2.5 rounded-xl bg-pri2 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
            <span>Truy vết toàn lịch sử</span>
          </button>
        </form>

        {recentWorkerSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-mu font-medium">Gợi ý gần đây:</span>
            {recentWorkerSuggestions.map(s => (
              <button
                key={s.token}
                type="button"
                onClick={() => {
                  setQuery(s.token);
                  setActiveQuery(s.token);
                }}
                className={`px-2.5 py-1 rounded-lg border text-xs transition-colors cursor-pointer ${
                  activeQuery.toLowerCase() === s.token.toLowerCase()
                    ? 'bg-pri2/10 border-pri2 text-lnk font-semibold'
                    : 'bg-surf border-bdr text-tx hover:bg-act'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results Header + Timeline */}
      {!activeQuery ? (
        <div className="surface-elevated rounded-2xl p-10 text-center space-y-2">
          <History size={28} className="mx-auto text-mu" />
          <p className="text-sm font-semibold text-tx">Tra cứu vòng đời cư trú theo từng công nhân</p>
          <p className="text-xs text-mu max-w-md mx-auto leading-relaxed">
            Nhập họ tên, Mã NV hoặc CCCD ở phía trên để xem đầy đủ các mốc từ lúc duyệt vào KTX, gán/đổi giường, kiểm tra QR cho đến lúc check-out và xóa triệt để.
          </p>
        </div>
      ) : loading ? (
        <div className="surface-elevated rounded-2xl p-10 text-center space-y-2">
          <Loader2 size={24} className="mx-auto text-lnk animate-spin" />
          <p className="text-xs text-mu">Đang truy xuất toàn bộ lịch sử cho “{activeQuery}”...</p>
        </div>
      ) : orderedTimeline.length === 0 ? (
        <div className="surface-elevated rounded-2xl p-10 text-center space-y-2">
          <p className="text-sm font-semibold text-tx">Không tìm thấy mốc nhật ký nào cho “{activeQuery}”</p>
          <p className="text-xs text-mu">Thử tìm bằng Mã NV ngắn gọn hơn hoặc một phần họ tên công nhân.</p>
        </div>
      ) : (
        <div className="surface-elevated rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-bdr flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-mu font-tabular">
              Tìm thấy <strong className="text-tx">{orderedTimeline.length}</strong> sự kiện cho{' '}
              <strong className="text-tx">“{activeQuery}”</strong>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center p-0.5 rounded-lg bg-act border border-bdr">
                <button
                  type="button"
                  onClick={() => setSortOrder('asc')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    sortOrder === 'asc' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  Cũ → Mới
                </button>
                <button
                  type="button"
                  onClick={() => setSortOrder('desc')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    sortOrder === 'desc' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  Mới → Cũ
                </button>
              </div>
              <button
                type="button"
                onClick={handleExportTimeline}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-bdr bg-surf text-tx text-xs font-semibold hover:bg-act transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download size={13} />
                <span>Xuất Excel</span>
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <ol className="relative border-l border-bdr2 ml-3 space-y-5">
              {orderedTimeline.map((entry, idx) => {
                const meta = getActionMeta(entry.action);
                const parsed = parseAuditDetail(entry);
                const actor = resolveActor(entry.account);
                const anomaly = detectAuditAnomaly(entry, parsed);

                const nodeColor =
                  meta.severity === 'critical'
                    ? 'bg-dgr border-dgr/30'
                    : meta.severity === 'warning'
                      ? 'bg-wn border-wn/30'
                      : 'bg-ok2 border-ok2/30';

                return (
                  <li key={entry.id} className="pl-6 relative">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 ${nodeColor}`}
                    />
                    <button
                      type="button"
                      onClick={() => onSelectEntry(entry)}
                      className="w-full text-left rounded-xl border border-bdr bg-surf hover:bg-act/40 p-3.5 transition-colors cursor-pointer group"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-mu tabular-nums">#{idx + 1}</span>
                          <span
                            className={`font-bold ${
                              meta.severity === 'critical'
                                ? 'text-dgr'
                                : meta.severity === 'warning'
                                  ? 'text-wn'
                                  : 'text-ok'
                            }`}
                          >
                            {meta.labelVi}
                          </span>
                          {anomaly.isAnomalous && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-dgr">
                              <AlertTriangle size={12} />
                              Bất thường
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-mu font-tabular">
                          <Clock size={12} />
                          <span>{formatTimestampVN(entry.timestamp)}</span>
                          <span className="hidden sm:inline">· {formatRelativeTimeVN(entry.timestamp)}</span>
                          <ChevronRight size={14} className="text-mu group-hover:text-tx transition-colors" />
                        </div>
                      </div>

                      <p className="text-sm text-tx mt-1.5 leading-relaxed break-words">{parsed.summary}</p>

                      {parsed.beforeAfter && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-mu">
                          <span className="font-medium text-tx/80">{parsed.beforeAfter.before}</span>
                          <ArrowRight size={12} className="text-lnk shrink-0" />
                          <span className="font-semibold text-lnk">{parsed.beforeAfter.after}</span>
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mu">
                        <span>Người thực hiện: <strong className="text-tx font-medium">{actor.displayName}</strong></span>
                        {parsed.locationText && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 font-tabular">
                              <MapPin size={11} />
                              {parsed.locationText}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
