'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAudit, AuditAction, AuditEntry } from '@/context/AuditContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import {
  Filter,
  Clock,
  User,
  Activity,
  Calendar,
  X,
  Download,
  ClipboardList,
  Shield,
  RefreshCw,
  Search,
  AlertTriangle,
  History,
  Radio,
  Archive,
  Layers,
  EyeOff,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  ArrowRight,
  ArrowLeftRight,
  Table2,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { exportToExcel } from '@/lib/exportExcel';
import { getVNDateString } from '@/lib/vnDate';
import { toast } from 'sonner';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import {
  AUDIT_ACTION_META,
  CATEGORY_ACTIONS,
  getActionMeta,
  parseAuditDetail,
  buildAccountResolver,
  detectAuditAnomaly,
  groupAuditEntries,
  getQuickDateRange,
  formatTimestampVN,
  formatRelativeTimeVN,
  buildStructuredExportRows,
  type AuditCategory,
  type QuickDatePreset,
  type ProfileLite,
  type GroupedAuditRow,
} from '@/lib/auditParser';
import AuditDetailDrawer from './AuditDetailDrawer';
import AuditTimelineView from './AuditTimelineView';
import AuditArchiveModal, { type CleanupMode } from './AuditArchiveModal';

const ALL_ACTIONS: AuditAction[] = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'IMPORT',
  'BED_REASSIGN',
  'BED_INSPECT_CONFIRM',
  'CHECKOUT_REQUEST',
  'CHECKOUT_APPROVED',
  'APPROVE_REGISTRATION',
  'FACILITY_CREATE',
  'FACILITY_UPDATE',
  'FACILITY_DELETE',
  'ATTENDANCE_SESSION',
  'ATTENDANCE_UPDATE',
  'USER_PASSWORD_RESET',
  'WORKER_HARD_DELETE',
  'AUDIT_ARCHIVE_PURGE',
  'Đổi trạng thái tạm trú',
  'Chuyển phòng',
  'Thêm',
  'Sửa',
  'Xóa',
  'Import',
];

const DATE_PRESETS: Array<{ id: QuickDatePreset; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'today', label: 'Hôm nay' },
  { id: 'yesterday', label: 'Hôm qua' },
  { id: '7d', label: '7 ngày qua' },
  { id: '30d', label: '30 ngày qua' },
  { id: 'this_month', label: 'Tháng này' },
];

const CATEGORY_TABS: Array<{ id: AuditCategory; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'sensitive', label: 'Nhạy cảm (Xóa / Check-out)' },
  { id: 'qr', label: 'Duyệt QR & Nhập' },
  { id: 'bed', label: 'Giường & Phòng' },
  { id: 'facility', label: 'Cơ sở vật chất' },
  { id: 'account', label: 'Tài khoản' },
  { id: 'anomaly', label: 'Cảnh báo bất thường' },
];

function parseFilterDate(dateStr: string, endOfDay = false): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + (endOfDay ? 'T23:59:59+07:00' : 'T00:00:00+07:00'));
  return isNaN(d.getTime()) ? null : d;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  const kw = keyword.trim();
  if (!kw || !text) return <>{text}</>;
  const regex = new RegExp(`(${escapeRegExp(kw)})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, idx) =>
        part.toLowerCase() === kw.toLowerCase() ? (
          <mark
            key={idx}
            className="bg-amber-200/80 dark:bg-amber-500/30 text-tx rounded px-0.5 font-semibold"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export default function AuditLogClient() {
  const {
    logs,
    totalLogCount,
    loading,
    refetchLogs,
    fetchLogsPage,
    fetchFilteredLogs,
    prependRealtimeEntry,
  } = useAudit();
  const { isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  // View mode: table vs worker timeline
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [timelineQuery, setTimelineQuery] = useState('');

  // Profiles for unified account display & multi-alias filtering
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);

  // Filters
  const [filterAccountKey, setFilterAccountKey] = useState('');
  const [filterCategory, setFilterCategory] = useState<AuditCategory>('all');
  const [filterAction, setFilterAction] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [datePreset, setDatePreset] = useState<QuickDatePreset>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Table presentation toggles
  const [groupPairs, setGroupPairs] = useState(true);
  const [hideTechnical, setHideTechnical] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  // Live Realtime feed toggle
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveNewCount, setLiveNewCount] = useState(0);

  // Drawer & Cleanup Modal state
  const [selectedRow, setSelectedRow] = useState<{
    entry: AuditEntry;
    pairedTechnical: AuditEntry[];
  } | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveModalMode, setArchiveModalMode] = useState<CleanupMode>('retention');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [singleDeleteOverride, setSingleDeleteOverride] = useState<AuditEntry[] | null>(null);

  // Server query & pagination state
  const [serverFilteredLogs, setServerFilteredLogs] = useState<AuditEntry[] | null>(null);
  const [searchingServer, setSearchingServer] = useState(false);
  const [pagedEntries, setPagedEntries] = useState<AuditEntry[] | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const pageSize = 25;

  // Load admin/staff profiles once to unify account identities (email <-> display name)
  useEffect(() => {
    if (!isAdmin) return;
    let mounted = true;
    supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .then(({ data }) => {
        if (!mounted || !Array.isArray(data)) return;
        setProfiles(
          data.map((p: Record<string, unknown>) => ({
            id: String(p.id ?? ''),
            email: String(p.email ?? ''),
            full_name: String(p.full_name ?? ''),
            role: String(p.role ?? ''),
          }))
        );
      });
    return () => {
      mounted = false;
    };
  }, [isAdmin, supabase]);

  // Unified account resolver
  const { resolve: resolveActor, options: accountOptions } = useMemo(
    () => buildAccountResolver(profiles, serverFilteredLogs ?? logs),
    [profiles, logs, serverFilteredLogs]
  );

  const selectedAccountAliases = useMemo(() => {
    if (!filterAccountKey) return [];
    const opt = accountOptions.find(o => o.key === filterAccountKey);
    return opt?.aliases ?? [];
  }, [filterAccountKey, accountOptions]);

  const activeCategoryActions = useMemo(() => {
    if (filterCategory === 'all' || filterCategory === 'anomaly') return [];
    return CATEGORY_ACTIONS[filterCategory] ?? [];
  }, [filterCategory]);

  const hasActiveFilter = Boolean(
    filterAccountKey ||
      filterCategory !== 'all' ||
      filterAction ||
      searchKeyword.trim() ||
      filterDateFrom ||
      filterDateTo
  );

  // Server-side filtered fetch
  const selectedAliasesKey = selectedAccountAliases.join('||');
  const categoryActionsKey = activeCategoryActions.join('||');

  useEffect(() => {
    if (!isAdmin || !hasActiveFilter) {
      setServerFilteredLogs(null);
      setSearchingServer(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearchingServer(true);
      const aliases = selectedAliasesKey ? selectedAliasesKey.split('||').filter(Boolean) : [];
      const catActions = categoryActionsKey ? categoryActionsKey.split('||').filter(Boolean) : [];

      fetchFilteredLogs({
        accounts: aliases.length > 0 ? aliases : undefined,
        action: filterAction || undefined,
        actions: !filterAction && catActions.length > 0 ? catActions : undefined,
        keyword: searchKeyword.trim() || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        limit: 2000,
      })
        .then(res => {
          if (active) setServerFilteredLogs(res);
        })
        .finally(() => {
          if (active) setSearchingServer(false);
        });
    }, 240);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    isAdmin,
    hasActiveFilter,
    selectedAliasesKey,
    categoryActionsKey,
    filterAction,
    searchKeyword,
    filterDateFrom,
    filterDateTo,
    fetchFilteredLogs,
  ]);

  // Real DB pagination for unfiltered history beyond cached 500
  useEffect(() => {
    if (!isAdmin || hasActiveFilter) {
      setPagedEntries(null);
      setLoadingPage(false);
      return;
    }
    const endIdx = page * pageSize;
    if (endIdx <= logs.length) {
      setPagedEntries(null);
      setLoadingPage(false);
      return;
    }
    let active = true;
    setLoadingPage(true);
    fetchLogsPage(page, pageSize)
      .then(({ entries }) => {
        if (active) setPagedEntries(entries);
      })
      .finally(() => {
        if (active) setLoadingPage(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, hasActiveFilter, page, pageSize, logs.length, fetchLogsPage]);

  // Realtime Live Feed subscription (when toggled on)
  useEffect(() => {
    if (!isAdmin || !liveEnabled) {
      setLiveConnected(false);
      return;
    }
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('audit_logs_live_feed')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'audit_logs' },
          payload => {
            const r = payload.new as Record<string, unknown> | null;
            if (!r?.id) return;
            const entry: AuditEntry = {
              id: String(r.id),
              timestamp: String(r.timestamp ?? new Date().toISOString()),
              account: String(r.account ?? ''),
              action: String(r.action ?? 'UPDATE') as AuditAction,
              detail: String(r.detail ?? ''),
            };
            prependRealtimeEntry(entry);
            setLiveNewCount(c => c + 1);
          }
        )
        .subscribe(status => {
          setLiveConnected(status === 'SUBSCRIBED');
        });
    } catch (err) {
      console.warn('[AuditLogClient] realtime subscribe error:', err);
      setLiveConnected(false);
    }

    return () => {
      setLiveConnected(false);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {}
      }
    };
  }, [isAdmin, liveEnabled, supabase, prependRealtimeEntry]);

  // Client-side exact refinement
  const filteredEntries = useMemo(() => {
    const source = hasActiveFilter && serverFilteredLogs !== null ? serverFilteredLogs : logs;
    const fromDate = parseFilterDate(filterDateFrom, false);
    const toDate = parseFilterDate(filterDateTo, true);
    const kw = searchKeyword.trim().toLowerCase();

    return source.filter(entry => {
      if (filterAccountKey) {
        const actor = resolveActor(entry.account);
        if (actor.key !== filterAccountKey) return false;
      }
      if (filterAction && entry.action !== filterAction) return false;

      if (filterCategory === 'anomaly') {
        if (!detectAuditAnomaly(entry).isAnomalous) return false;
      } else if (filterCategory !== 'all') {
        const allowed = CATEGORY_ACTIONS[filterCategory];
        if (allowed && !allowed.includes(entry.action)) return false;
      }

      if (kw) {
        const actor = resolveActor(entry.account);
        const meta = getActionMeta(entry.action);
        const hay = `${entry.account} ${actor.displayName} ${actor.email} ${entry.action} ${meta.labelVi} ${entry.detail}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }

      if (fromDate || toDate) {
        const logDate = new Date(entry.timestamp);
        if (!isNaN(logDate.getTime())) {
          if (fromDate && logDate < fromDate) return false;
          if (toDate && logDate > toDate) return false;
        }
      }
      return true;
    });
  }, [
    logs,
    serverFilteredLogs,
    hasActiveFilter,
    filterAccountKey,
    filterAction,
    filterCategory,
    searchKeyword,
    filterDateFrom,
    filterDateTo,
    resolveActor,
  ]);

  // KPI metrics calculated over active dataset (filtered when filtering, cached recent 500 otherwise)
  const kpiStats = useMemo(() => {
    const dataset = filteredEntries;
    const todayRange = getQuickDateRange('today');
    const todayStart = parseFilterDate(todayRange.from, false);

    let todayCount = 0;
    let intakeCount = 0;
    let removalCount = 0;
    let bedEditCount = 0;
    let anomalyCount = 0;
    const actorCounts = new Map<string, { name: string; count: number }>();

    for (const entry of dataset) {
      if (todayStart) {
        const d = new Date(entry.timestamp);
        if (!isNaN(d.getTime()) && d >= todayStart) todayCount++;
      }
      if (['CREATE', 'Thêm', 'APPROVE_REGISTRATION', 'IMPORT', 'Import'].includes(entry.action)) {
        intakeCount++;
      } else if (['DELETE', 'Xóa', 'CHECKOUT_APPROVED', 'CHECKOUT_REQUEST'].includes(entry.action)) {
        removalCount++;
      } else if (['BED_REASSIGN', 'Chuyển phòng', 'UPDATE', 'Sửa', 'FACILITY_UPDATE', 'FACILITY_CREATE'].includes(entry.action)) {
        bedEditCount++;
      }
      if (detectAuditAnomaly(entry).isAnomalous) {
        anomalyCount++;
      }
      if (entry.action !== 'WORKER_HARD_DELETE') {
        const actor = resolveActor(entry.account);
        const curr = actorCounts.get(actor.key);
        if (curr) curr.count += 1;
        else actorCounts.set(actor.key, { name: actor.displayName, count: 1 });
      }
    }

    let topActor: { name: string; count: number } | null = null;
    for (const item of actorCounts.values()) {
      if (!topActor || item.count > topActor.count) topActor = item;
    }

    return { todayCount, intakeCount, removalCount, bedEditCount, anomalyCount, topActor };
  }, [filteredEntries, resolveActor]);

  // Grouped rows for clean table rendering
  const groupedRows = useMemo((): GroupedAuditRow[] => {
    const rawPageSlice =
      !hasActiveFilter && pagedEntries !== null
        ? pagedEntries
        : filteredEntries;
    return groupAuditEntries(rawPageSlice, { groupPairs, hideTechnical });
  }, [hasActiveFilter, pagedEntries, filteredEntries, groupPairs, hideTechnical]);

  const effectiveTotal = hasActiveFilter
    ? groupedRows.length
    : Math.max(totalLogCount, logs.length);
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));

  const visibleRows = useMemo(() => {
    if (!hasActiveFilter && pagedEntries !== null) return groupedRows;
    return groupedRows.slice((page - 1) * pageSize, page * pageSize);
  }, [hasActiveFilter, pagedEntries, groupedRows, page, pageSize]);

  // All entries map for resolving selected rows (including paired technical rows)
  const entryById = useMemo(() => {
    const map = new Map<string, AuditEntry>();
    for (const e of logs) map.set(e.id, e);
    if (serverFilteredLogs) {
      for (const e of serverFilteredLogs) map.set(e.id, e);
    }
    if (pagedEntries) {
      for (const e of pagedEntries) map.set(e.id, e);
    }
    return map;
  }, [logs, serverFilteredLogs, pagedEntries]);

  const selectedEntries = useMemo(() => {
    if (singleDeleteOverride) return singleDeleteOverride;
    const list: AuditEntry[] = [];
    selectedIds.forEach(id => {
      const found = entryById.get(id);
      if (found) list.push(found);
    });
    return list;
  }, [singleDeleteOverride, selectedIds, entryById]);

  const visibleRowEntryIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of visibleRows) {
      ids.push(r.primary.id);
      for (const t of r.pairedTechnical) ids.push(t.id);
    }
    return ids;
  }, [visibleRows]);

  const allVisibleSelected =
    visibleRowEntryIds.length > 0 && visibleRowEntryIds.every(id => selectedIds.has(id));

  const toggleSelectRow = (row: GroupedAuditRow) => {
    const rowIds = [row.primary.id, ...row.pairedTechnical.map(t => t.id)];
    setSelectedIds(prev => {
      const next = new Set(prev);
      const isChecked = next.has(row.primary.id);
      if (isChecked) {
        rowIds.forEach(id => next.delete(id));
      } else {
        rowIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleRowEntryIds.forEach(id => next.delete(id));
      } else {
        visibleRowEntryIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const filterSummaryText = useMemo(() => {
    const parts: string[] = [];
    if (filterCategory !== 'all') {
      const tab = CATEGORY_TABS.find(t => t.id === filterCategory);
      if (tab) parts.push(`Nhóm: ${tab.label}`);
    }
    if (filterAction) {
      parts.push(`Hành động: ${AUDIT_ACTION_META[filterAction as AuditAction]?.labelVi || filterAction}`);
    }
    if (filterAccountKey) {
      const acc = accountOptions.find(a => a.key === filterAccountKey);
      if (acc) parts.push(`Tài khoản: ${acc.displayName}`);
    }
    if (searchKeyword.trim()) {
      parts.push(`Từ khóa: "${searchKeyword.trim()}"`);
    }
    if (filterDateFrom || filterDateTo) {
      parts.push(`Ngày: ${filterDateFrom || '...'} → ${filterDateTo || '...'}`);
    }
    return parts.join(' · ');
  }, [filterCategory, filterAction, filterAccountKey, accountOptions, searchKeyword, filterDateFrom, filterDateTo]);

  const openCleanupModal = (mode: CleanupMode, overrideEntries: AuditEntry[] | null = null) => {
    setSingleDeleteOverride(overrideEntries);
    setArchiveModalMode(mode);
    setShowArchiveModal(true);
  };

  const handleApplyDatePreset = (preset: QuickDatePreset) => {
    setDatePreset(preset);
    const { from, to } = getQuickDateRange(preset);
    setFilterDateFrom(from);
    setFilterDateTo(to);
    setPage(1);
    setSelectedIds(new Set());
  };

  const clearFilters = () => {
    setFilterAccountKey('');
    setFilterCategory('all');
    setFilterAction('');
    setSearchKeyword('');
    setDatePreset('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(1);
    setSelectedIds(new Set());
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setLiveNewCount(0);
    try {
      await refetchLogs();
      toast.success('Đã cập nhật nhật ký hệ thống mới nhất.');
    } finally {
      setRefreshing(false);
    }
  }, [refetchLogs]);

  const handleExportLogs = () => {
    const exportSource = filteredEntries.filter(e => !(hideTechnical && getActionMeta(e.action).isTechnical));
    if (exportSource.length === 0) {
      toast.warning('Không có bản ghi nào để xuất Excel.');
      return;
    }
    const rows = buildStructuredExportRows(exportSource, resolveActor);
    exportToExcel(rows, `NhatKyHeThong_${getVNDateString()}.xlsx`, 'Nhật ký');
    toast.success(`Đã xuất ${rows.length.toLocaleString('vi-VN')} bản ghi (đã bóc tách cột).`);
  };

  const handleTraceWorker = (keyword: string) => {
    setTimelineQuery(keyword);
    setViewMode('timeline');
  };

  // Route protection
  if (!isAdmin) {
    if (typeof window !== 'undefined') {
      router.replace('/');
    }
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-dgrbg flex items-center justify-center mx-auto mb-4">
            <Activity size={24} className="text-dgr" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-2">Không có quyền truy cập</h2>
          <p className="text-sm text-muted-foreground">Chỉ Admin mới có thể xem Nhật ký Hệ thống</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-6 max-w-screen-2xl mx-auto space-y-4">
        <div className="h-12 w-72 rounded-xl skeleton-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 rounded-xl skeleton-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-2xl skeleton-pulse" />
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-6 max-w-screen-2xl mx-auto space-y-4">
      {/* ─── Header ─── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3.5 border-b border-bdr">
        <div className="flex items-center gap-3 min-w-0">
          <CraftIconBadge icon={ClipboardList} badgeIcon={Shield} tone="blue" size="md" />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">Nhật Ký Hệ Thống</h1>
            <p className="text-xs sm:text-sm text-mu mt-0.5 font-tabular">
              {searchingServer || loadingPage
                ? 'Đang truy vấn lịch sử...'
                : `${totalLogCount.toLocaleString('vi-VN')} bản ghi toàn hệ thống`}
              {hasActiveFilter && !searchingServer && (
                <>
                  {' '}· <strong className="text-tx">{filteredEntries.length.toLocaleString('vi-VN')}</strong> khớp bộ lọc
                </>
              )}
              {liveEnabled && liveNewCount > 0 && (
                <>
                  {' '}· <span className="text-ok font-semibold">+{liveNewCount} mới trực tiếp</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode Switch: Table vs Timeline */}
          <div className="inline-flex items-center p-0.5 rounded-xl bg-act border border-bdr">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'table' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              <Table2 size={13} />
              <span>Bảng nhật ký</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'timeline' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              <History size={13} />
              <span>Truy vết công nhân</span>
            </button>
          </div>

          {/* Live Realtime Feed Toggle */}
          <button
            type="button"
            onClick={() => {
              setLiveEnabled(v => {
                const next = !v;
                if (next) toast.info('Đã bật chế độ theo dõi nhật ký trực tiếp.');
                else setLiveNewCount(0);
                return next;
              });
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              liveEnabled
                ? 'border-ok/50 bg-okbg text-ok'
                : 'border-bdr2 bg-surf text-tx hover:bg-act'
            }`}
            title="Tự động nhận bản ghi mới theo thời gian thực qua Supabase Realtime"
          >
            {liveEnabled && liveConnected ? (
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse shrink-0" />
            ) : (
              <Radio size={13} />
            )}
            <span>{liveEnabled ? (liveConnected ? 'Đang trực tiếp' : 'Đang kết nối...') : 'Trực tiếp'}</span>
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf text-tx text-xs font-semibold hover:bg-act transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>Làm mới</span>
          </button>

          <button
            type="button"
            onClick={handleExportLogs}
            disabled={filteredEntries.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf text-tx text-xs font-semibold hover:bg-act transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Download size={13} />
            <span>Xuất Excel</span>
          </button>

          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => openCleanupModal('retention')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf text-tx text-xs font-semibold hover:bg-act transition-colors cursor-pointer whitespace-nowrap"
              title="Dọn nhật ký cũ hoặc làm mới sạch toàn bộ nhật ký"
            >
              <Archive size={13} />
              <span>Dọn & Làm mới log</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── KPI Summary Strip (Single Elevation, Tabular Numerals) ─── */}
      <div className="surface-elevated rounded-2xl grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-bdr overflow-hidden">
        <div className="p-3.5 sm:p-4">
          <p className="text-xs text-mu font-medium">Thao tác hôm nay</p>
          <p className="text-xl font-bold text-tx font-tabular mt-1">
            {kpiStats.todayCount.toLocaleString('vi-VN')}
          </p>
          <p className="text-[11px] text-mu mt-0.5">Trong phạm vi đang xem</p>
        </div>
        <div className="p-3.5 sm:p-4">
          <p className="text-xs text-mu font-medium">Duyệt vào & Thêm mới</p>
          <p className="text-xl font-bold text-ok font-tabular mt-1">
            {kpiStats.intakeCount.toLocaleString('vi-VN')}
          </p>
          <p className="text-[11px] text-mu mt-0.5">QR đăng ký · Thêm · Nhập Excel</p>
        </div>
        <div className="p-3.5 sm:p-4">
          <p className="text-xs text-mu font-medium">Xóa & Check-out</p>
          <p className="text-xl font-bold text-dgr font-tabular mt-1">
            {kpiStats.removalCount.toLocaleString('vi-VN')}
          </p>
          <p className="text-[11px] text-mu mt-0.5">Yêu cầu · Duyệt trả phòng · Xóa</p>
        </div>
        <div className="p-3.5 sm:p-4">
          <p className="text-xs text-mu font-medium">Giường & Cập nhật</p>
          <p className="text-xl font-bold text-lnk font-tabular mt-1">
            {kpiStats.bedEditCount.toLocaleString('vi-VN')}
          </p>
          <p className="text-[11px] text-mu mt-0.5">Đổi giường · Sửa hồ sơ · CSVC</p>
        </div>
        <div className="p-3.5 sm:p-4 col-span-2 lg:col-span-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-mu font-medium">Hoạt động nhiều nhất</p>
            <p className="text-sm font-bold text-tx truncate mt-1.5" title={kpiStats.topActor?.name}>
              {kpiStats.topActor ? kpiStats.topActor.name : '—'}
            </p>
            <p className="text-[11px] text-mu font-tabular mt-0.5">
              {kpiStats.topActor ? `${kpiStats.topActor.count.toLocaleString('vi-VN')} thao tác` : 'Chưa có dữ liệu'}
            </p>
          </div>
          {kpiStats.anomalyCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setViewMode('table');
                setFilterCategory(c => (c === 'anomaly' ? 'all' : 'anomaly'));
                setFilterAction('');
                setPage(1);
              }}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dgr/40 tint-dgr text-dgr text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer font-tabular"
              title="Bấm để lọc riêng các thao tác bất thường"
            >
              <AlertTriangle size={12} />
              <span>{kpiStats.anomalyCount} bất thường</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Main View: Timeline OR Audit Table ─── */}
      {viewMode === 'timeline' ? (
        <AuditTimelineView
          initialQuery={timelineQuery}
          recentLogs={logs}
          fetchFilteredLogs={fetchFilteredLogs}
          resolveActor={resolveActor}
          onSelectEntry={entry => setSelectedRow({ entry, pairedTechnical: [] })}
        />
      ) : (
        <>
          {/* ─── Smart Filters Panel ─── */}
          <div className="surface-elevated rounded-2xl p-3.5 sm:p-4 space-y-3">
            {/* Row 1: Category Quick Tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {CATEGORY_TABS.map(tab => {
                const active = filterCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setFilterCategory(tab.id);
                      if (tab.id !== 'all') setFilterAction('');
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? tab.id === 'anomaly' || tab.id === 'sensitive'
                          ? 'bg-dgr text-white'
                          : 'bg-pri2 text-white'
                        : 'bg-act text-mu hover:text-tx'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Row 2: Full-text Search + Unified Account + Specific Action */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
              <div className="relative md:col-span-5">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
                <input
                  type="text"
                  placeholder="Tìm tên công nhân, mã NV, CCCD, phòng (P.3), người quản lý..."
                  value={searchKeyword}
                  onChange={e => {
                    setSearchKeyword(e.target.value);
                    setPage(1);
                  }}
                  className="input-field pl-8 pr-8 py-2 text-sm w-full"
                />
                {searchKeyword && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchKeyword('');
                      setPage(1);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mu hover:text-tx cursor-pointer"
                    aria-label="Xóa tìm kiếm"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="relative md:col-span-4">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
                <select
                  value={filterAccountKey}
                  onChange={e => {
                    setFilterAccountKey(e.target.value);
                    setPage(1);
                  }}
                  className="input-field pl-8 py-2 text-sm w-full"
                >
                  <option value="">Tất cả tài khoản ({accountOptions.length})</option>
                  {accountOptions.map(opt => (
                    <option key={opt.key} value={opt.key}>
                      {opt.displayName}
                      {opt.email && opt.email !== opt.displayName ? ` (${opt.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative md:col-span-3">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
                <select
                  value={filterAction}
                  onChange={e => {
                    setFilterAction(e.target.value);
                    if (e.target.value) setFilterCategory('all');
                    setPage(1);
                  }}
                  className="input-field pl-8 py-2 text-sm w-full"
                >
                  <option value="">Mọi hành động cụ thể</option>
                  {ALL_ACTIONS.map(a => (
                    <option key={a} value={a}>
                      {AUDIT_ACTION_META[a]?.labelVi || a}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 3: Quick Date Presets + Custom Date Range + View Switches */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 pt-2.5 border-t border-bdr">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-mu">
                  <Calendar size={13} /> Thời gian:
                </span>
                <div className="flex items-center gap-1 flex-wrap">
                  {DATE_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyDatePreset(p.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        datePreset === p.id
                          ? 'bg-pri2/12 text-lnk font-semibold border border-pri2/40'
                          : 'bg-surf text-mu hover:text-tx border border-bdr'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={e => {
                      setFilterDateFrom(e.target.value);
                      setDatePreset('all');
                      setPage(1);
                    }}
                    className="input-field py-1 text-xs w-32"
                    aria-label="Từ ngày"
                  />
                  <span className="text-xs text-mu">—</span>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={e => {
                      setFilterDateTo(e.target.value);
                      setDatePreset('all');
                      setPage(1);
                    }}
                    className="input-field py-1 text-xs w-32"
                    aria-label="Đến ngày"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGroupPairs(v => !v)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    groupPairs
                      ? 'bg-pri2/10 border-pri2/40 text-lnk font-semibold'
                      : 'bg-surf border-bdr text-mu hover:text-tx'
                  }`}
                  title="Gộp dòng WORKER_HARD_DELETE ngay bên dưới thao tác duyệt check-out / xóa tương ứng"
                >
                  <Layers size={12} />
                  <span>Gom cặp Check-out</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHideTechnical(v => !v)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    hideTechnical
                      ? 'bg-pri2/10 border-pri2/40 text-lnk font-semibold'
                      : 'bg-surf border-bdr text-mu hover:text-tx'
                  }`}
                  title="Ẩn riêng các bản ghi xác minh kỹ thuật WORKER_HARD_DELETE"
                >
                  <EyeOff size={12} />
                  <span>Ẩn log kỹ thuật</span>
                </button>
                {hasActiveFilter && isSuperAdmin && filteredEntries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openCleanupModal('filtered')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dgr/40 tint-dgr text-dgr hover:opacity-90 text-xs font-semibold transition-opacity cursor-pointer whitespace-nowrap font-tabular"
                    title="Xóa các bản ghi khớp với bộ lọc đang chọn"
                  >
                    <Trash2 size={12} />
                    <span>Xóa theo bộ lọc ({filteredEntries.length.toLocaleString('vi-VN')})</span>
                  </button>
                )}
                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-act text-tx hover:opacity-80 text-xs font-semibold border border-bdr transition-opacity cursor-pointer whitespace-nowrap"
                  >
                    <X size={12} />
                    <span>Xóa bộ lọc</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ─── Super Admin Bulk Selection Bar ─── */}
          {isSuperAdmin && selectedIds.size > 0 && (
            <div className="rounded-xl border border-dgr/35 bg-surf px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-sm">
              <div className="text-xs text-tx font-tabular">
                Đã chọn <strong className="text-dgr">{selectedIds.size.toLocaleString('vi-VN')}</strong> bản ghi nhật ký
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hasActiveFilter && filteredEntries.length > selectedIds.size && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(filteredEntries.map(e => e.id)))}
                    className="px-2.5 py-1.5 rounded-lg border border-bdr text-xs font-semibold text-lnk hover:bg-act transition-colors cursor-pointer whitespace-nowrap font-tabular"
                  >
                    Chọn tất cả {filteredEntries.length.toLocaleString('vi-VN')} kết quả lọc
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-2.5 py-1.5 rounded-lg border border-bdr text-xs font-medium text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer whitespace-nowrap"
                >
                  Bỏ chọn
                </button>
                <button
                  type="button"
                  onClick={() => openCleanupModal('selected')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dgr text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
                >
                  <Trash2 size={12} />
                  <span>Xóa đã chọn ({selectedIds.size.toLocaleString('vi-VN')})</span>
                </button>
              </div>
            </div>
          )}

          {/* ─── High-Density Audit Log Table ─── */}
          <div className="surface-elevated rounded-2xl overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-act border-b border-bdr2 sticky top-0 z-10">
                  <tr>
                    {isSuperAdmin && (
                      <th className="pl-4 pr-1 py-3 text-left w-9">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          aria-label="Chọn tất cả bản ghi trên trang này"
                          className="rounded border-bdr accent-pri2 cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-mu whitespace-nowrap w-44">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock size={12} /> Thời gian (UTC+7)
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-mu whitespace-nowrap w-56">
                      <span className="inline-flex items-center gap-1.5">
                        <User size={12} /> Người thực hiện
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-mu whitespace-nowrap w-48">
                      Hành động
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-mu">
                      Nội dung tóm tắt
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-mu whitespace-nowrap w-20">
                      Chi tiết
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bdr">
                  {loadingPage || searchingServer ? (
                    Array.from({ length: 6 }).map((_, idx) => (
                      <tr key={`sk-${idx}`}>
                        <td colSpan={isSuperAdmin ? 6 : 5} className="px-4 py-3">
                          <div className="h-5 rounded skeleton-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={isSuperAdmin ? 6 : 5} className="px-4 py-12 text-center space-y-2">
                        <p className="text-sm font-semibold text-tx">Không có bản ghi nhật ký nào phù hợp</p>
                        <p className="text-xs text-mu">Thử nới rộng khoảng thời gian hoặc xóa bộ lọc đang áp dụng.</p>
                        {hasActiveFilter && (
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="mt-2 px-3 py-1.5 rounded-lg bg-pri2 text-white text-xs font-semibold cursor-pointer"
                          >
                            Xóa toàn bộ bộ lọc
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map(row => {
                      const { primary, parsed, anomaly, pairedTechnical } = row;
                      const meta = getActionMeta(primary.action);
                      const actor = resolveActor(primary.account);
                      const isExpanded = Boolean(expandedGroupIds[primary.id]);
                      const traceToken = parsed.cccd || parsed.maNv || parsed.workerName;

                      const actionColorClass =
                        meta.severity === 'critical'
                          ? 'text-dgr'
                          : meta.severity === 'warning'
                            ? 'text-wn'
                            : 'text-ok';

                      return (
                        <React.Fragment key={primary.id}>
                          <tr
                            onClick={() => setSelectedRow({ entry: primary, pairedTechnical })}
                            className={`hover:bg-act/45 transition-colors cursor-pointer group ${
                              isSuperAdmin && selectedIds.has(primary.id) ? 'bg-pri2/5' : ''
                            }`}
                          >
                            {isSuperAdmin && (
                              <td
                                className="pl-4 pr-1 py-3 align-top"
                                onClick={e => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(primary.id)}
                                  onChange={() => toggleSelectRow(row)}
                                  aria-label={`Chọn bản ghi ${meta.labelVi}`}
                                  className="mt-0.5 rounded border-bdr accent-pri2 cursor-pointer"
                                />
                              </td>
                            )}
                            {/* Timestamp */}
                            <td className="px-4 py-3 align-top whitespace-nowrap">
                              <div className="text-xs font-medium text-tx font-tabular">
                                {formatTimestampVN(primary.timestamp)}
                              </div>
                              <div className="text-[11px] text-mu mt-0.5">
                                {formatRelativeTimeVN(primary.timestamp)}
                              </div>
                            </td>

                            {/* Unified Actor */}
                            <td className="px-4 py-3 align-top">
                              <div className="text-xs font-semibold text-tx truncate max-w-[220px]" title={actor.displayName}>
                                <HighlightText text={actor.displayName} keyword={searchKeyword} />
                              </div>
                              {actor.email && actor.email !== actor.displayName && (
                                <div className="text-[11px] text-mu truncate max-w-[220px] mt-0.5">
                                  <HighlightText text={actor.email} keyword={searchKeyword} />
                                </div>
                              )}
                            </td>

                            {/* Action (Clean Vietnamese typography + anomaly signal) */}
                            <td className="px-4 py-3 align-top whitespace-nowrap">
                              <div className={`text-xs font-bold ${actionColorClass}`}>
                                {meta.labelVi}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-mu">
                                <span>
                                  {meta.severity === 'critical'
                                    ? 'Nhạy cảm'
                                    : meta.severity === 'warning'
                                      ? 'Lưu ý'
                                      : 'Thường'}
                                </span>
                                {anomaly.isAnomalous && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span
                                      className="inline-flex items-center gap-0.5 text-dgr font-semibold"
                                      title={anomaly.reasons.join(' | ')}
                                    >
                                      <AlertTriangle size={11} />
                                      Bất thường
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>

                            {/* Clean Human-Readable Summary (NO raw JSON dump) */}
                            <td className="px-4 py-3 align-top">
                              <div className="text-xs text-tx leading-relaxed break-words max-w-xl">
                                <HighlightText text={parsed.summary} keyword={searchKeyword} />
                              </div>

                              {/* Inline Before -> After diff preview */}
                              {parsed.beforeAfter && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-mu">
                                  <span className="truncate max-w-[220px]">{parsed.beforeAfter.before}</span>
                                  {parsed.beforeAfter.isSwap ? (
                                    <ArrowLeftRight size={11} className="text-lnk shrink-0" />
                                  ) : (
                                    <ArrowRight size={11} className="text-lnk shrink-0" />
                                  )}
                                  <span className="font-semibold text-lnk truncate max-w-[240px]">
                                    {parsed.beforeAfter.after}
                                  </span>
                                </div>
                              )}

                              {/* Inline metadata line (zero-pill clean text with separators) */}
                              {(parsed.integrityVerified !== null || pairedTechnical.length > 0 || anomaly.isAnomalous) && (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mu">
                                  {parsed.integrityVerified === true && (
                                    <span className="inline-flex items-center gap-1 text-ok font-medium">
                                      <ShieldCheck size={12} /> Xác minh xóa sạch
                                    </span>
                                  )}
                                  {pairedTechnical.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        setExpandedGroupIds(prev => ({
                                          ...prev,
                                          [primary.id]: !prev[primary.id],
                                        }));
                                      }}
                                      className="inline-flex items-center gap-1 text-lnk hover:text-pri2 font-medium cursor-pointer"
                                    >
                                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                      <ShieldCheck size={11} className="text-ok" />
                                      <span>+{pairedTechnical.length} bản ghi xác minh xóa triệt để</span>
                                    </button>
                                  )}
                                  {anomaly.isAnomalous && (
                                    <span className="text-dgr font-medium">
                                      {anomaly.reasons[0]}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Row Quick Actions */}
                            <td className="px-3 py-3 align-top text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1">
                                {traceToken && (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleTraceWorker(traceToken);
                                    }}
                                    className="p-1.5 rounded-lg text-mu hover:text-lnk hover:bg-act transition-colors cursor-pointer"
                                    title={`Xem dòng thời gian của ${parsed.workerName || traceToken}`}
                                    aria-label="Truy vết công nhân"
                                  >
                                    <History size={14} />
                                  </button>
                                )}
                                <span className="p-1.5 text-mu group-hover:text-tx transition-colors inline-flex">
                                  <ChevronRight size={15} />
                                </span>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Paired Technical Verification Sub-rows */}
                          {isExpanded &&
                            pairedTechnical.map(tech => {
                              const techParsed = parseAuditDetail(tech);
                              return (
                                <tr
                                  key={tech.id}
                                  onClick={() => setSelectedRow({ entry: tech, pairedTechnical: [] })}
                                  className="bg-act/30 hover:bg-act/55 transition-colors cursor-pointer"
                                >
                                  {isSuperAdmin && <td className="pl-4 pr-1 py-2" />}
                                  <td className="px-4 py-2 text-[11px] text-mu font-tabular whitespace-nowrap pl-8">
                                    ↳ {formatTimestampVN(tech.timestamp)}
                                  </td>
                                  <td className="px-4 py-2 text-[11px] text-mu">
                                    {resolveActor(tech.account).displayName}
                                  </td>
                                  <td className="px-4 py-2 text-[11px] font-semibold text-ok whitespace-nowrap">
                                    Xác minh xóa triệt để
                                  </td>
                                  <td className="px-4 py-2 text-[11px] text-tx/90">
                                    {techParsed.summary}
                                  </td>
                                  <td className="px-3 py-2 text-right text-[11px] text-lnk font-medium">
                                    Xem JSON
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-bdr flex flex-wrap items-center justify-between gap-2 font-tabular">
                <span className="text-xs text-mu">
                  Trang <strong className="text-tx">{page}</strong> / {totalPages} ·{' '}
                  {effectiveTotal.toLocaleString('vi-VN')} bản ghi
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded-lg border border-bdr text-xs font-medium text-tx hover:bg-act disabled:opacity-40 cursor-pointer"
                  >
                    Đầu
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded-lg border border-bdr text-xs font-medium text-tx hover:bg-act disabled:opacity-40 cursor-pointer"
                  >
                    ‹ Trước
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1 rounded-lg border border-bdr text-xs font-medium text-tx hover:bg-act disabled:opacity-40 cursor-pointer"
                  >
                    Sau ›
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="px-2.5 py-1 rounded-lg border border-bdr text-xs font-medium text-tx hover:bg-act disabled:opacity-40 cursor-pointer"
                  >
                    Cuối
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Slide-over Detail Drawer ─── */}
      <AuditDetailDrawer
        entry={selectedRow?.entry ?? null}
        pairedTechnical={selectedRow?.pairedTechnical ?? []}
        resolveActor={resolveActor}
        onClose={() => setSelectedRow(null)}
        onTraceWorker={handleTraceWorker}
        onDeleteEntries={
          isSuperAdmin
            ? entries => openCleanupModal('selected', entries)
            : undefined
        }
      />

      {/* ─── Super Admin Cleanup & Reset Modal ─── */}
      <AuditArchiveModal
        open={showArchiveModal}
        initialMode={archiveModalMode}
        selectedEntries={selectedEntries}
        filteredEntries={filteredEntries}
        filterSummary={filterSummaryText}
        hasActiveFilter={hasActiveFilter}
        onClose={() => {
          setShowArchiveModal(false);
          setSingleDeleteOverride(null);
        }}
        resolveActor={resolveActor}
        onPurged={async () => {
          setSelectedIds(new Set());
          setSingleDeleteOverride(null);
          setServerFilteredLogs(null);
          setPagedEntries(null);
          setPage(1);
          await refetchLogs();
          if (hasActiveFilter) {
            const aliases = selectedAliasesKey ? selectedAliasesKey.split('||').filter(Boolean) : [];
            const catActions = categoryActionsKey ? categoryActionsKey.split('||').filter(Boolean) : [];
            const refreshed = await fetchFilteredLogs({
              accounts: aliases.length > 0 ? aliases : undefined,
              action: filterAction || undefined,
              actions: !filterAction && catActions.length > 0 ? catActions : undefined,
              keyword: searchKeyword.trim() || undefined,
              dateFrom: filterDateFrom || undefined,
              dateTo: filterDateTo || undefined,
              limit: 2000,
            });
            setServerFilteredLogs(refreshed);
          }
        }}
      />
    </div>
  );
}
