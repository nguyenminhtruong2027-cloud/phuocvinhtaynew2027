'use client';
import React, { useState, useMemo } from 'react';
import { useAudit, AuditAction } from '@/context/AuditContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Filter, Clock, User, Activity, Calendar, X } from 'lucide-react';

const ACTION_COLORS: Record<AuditAction, string> = {
  'Thêm': 'bg-green-100 text-green-700 border-green-200',
  'Sửa': 'bg-blue-100 text-blue-700 border-blue-200',
  'Xóa': 'bg-red-100 text-red-700 border-red-200',
  'Chuyển phòng': 'bg-orange-100 text-orange-700 border-orange-200',
  'Đổi trạng thái tạm trú': 'bg-purple-100 text-purple-700 border-purple-200',
  'Import': 'bg-cyan-100 text-cyan-700 border-cyan-200',
};

const ALL_ACTIONS: AuditAction[] = ['Thêm', 'Sửa', 'Xóa', 'Chuyển phòng', 'Đổi trạng thái tạm trú', 'Import'];

/** Format ISO timestamp using Vietnam time (UTC+7). */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/** Parse YYYY-MM-DD string to start-of-day Date in UTC+7 */
function parseFilterDate(dateStr: string, endOfDay = false): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + (endOfDay ? 'T23:59:59+07:00' : 'T00:00:00+07:00'));
  return isNaN(d.getTime()) ? null : d;
}

export default function AuditLogClient() {
  const { logs, loading } = useAudit();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [filterAccount, setFilterAccount] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const uniqueAccounts = useMemo(() => [...new Set(logs.map(l => l.account))].sort(), [logs]);

  const filtered = useMemo(() => {
    const fromDate = parseFilterDate(filterDateFrom, false);
    const toDate = parseFilterDate(filterDateTo, true);

    return logs.filter(l => {
      if (filterAccount && l.account !== filterAccount) return false;
      if (filterAction && l.action !== filterAction) return false;
      // Staff name/email search (partial match)
      if (filterStaff) {
        const staffLower = filterStaff.toLowerCase();
        if (!l.account.toLowerCase().includes(staffLower) && !l.detail.toLowerCase().includes(staffLower)) return false;
      }
      // Date range filter
      if (fromDate || toDate) {
        const logDate = new Date(l.timestamp);
        if (!isNaN(logDate.getTime())) {
          if (fromDate && logDate < fromDate) return false;
          if (toDate && logDate > toDate) return false;
        }
      }
      return true;
    });
  }, [logs, filterAccount, filterAction, filterStaff, filterDateFrom, filterDateTo]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const hasActiveFilter = filterAccount || filterAction || filterStaff || filterDateFrom || filterDateTo;

  const clearFilters = () => {
    setFilterAccount('');
    setFilterAction('');
    setFilterStaff('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(1);
  };

  // Route protection
  if (!isAdmin) {
    if (typeof window !== 'undefined') {
      router.replace('/');
    }
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <Activity size={24} className="text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-2">Không có quyền truy cập</h2>
          <p className="text-sm text-muted-foreground">Chỉ Admin mới có thể xem Nhật ký Hệ thống</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Đang tải nhật ký hệ thống...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-6 max-w-screen-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Nhật Ký Hệ Thống</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{filtered.length} bản ghi · Tất cả tài khoản Admin</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 w-fit">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-xs font-semibold text-red-700">Admin Only</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-3 sm:p-4 mb-4 space-y-3">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2.5 sm:gap-3">
          {/* Account filter */}
          <div className="relative w-full sm:min-w-[180px] sm:flex-1">
            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <select
              value={filterAccount}
              onChange={e => { setFilterAccount(e.target.value); setPage(1); }}
              className="input-field pl-8 py-2 text-sm w-full"
            >
              <option value="">Tất cả tài khoản</option>
              {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Action filter */}
          <div className="relative w-full sm:min-w-[180px] sm:flex-1">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(1); }}
              className="input-field pl-8 py-2 text-sm w-full"
            >
              <option value="">Tất cả hành động</option>
              {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Staff name/email search */}
          <div className="relative w-full sm:min-w-[200px] sm:flex-1">
            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm theo tên/email người quản lý..."
              value={filterStaff}
              onChange={e => { setFilterStaff(e.target.value); setPage(1); }}
              className="input-field pl-8 py-2 text-sm w-full"
            />
          </div>
        </div>

        {/* Date range filter */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 items-start sm:items-center pt-1 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Calendar size={13} />
            Khoảng ngày:
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
              className="input-field py-1.5 text-xs flex-1 sm:w-36"
              placeholder="Từ ngày"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
              className="input-field py-1.5 text-xs flex-1 sm:w-36"
              placeholder="Đến ngày"
            />
          </div>
          {hasActiveFilter && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold border border-border transition-colors w-full sm:w-auto justify-center"
            >
              <X size={12} />Xóa bộ lọc
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center gap-1"><Clock size={12} />Thời gian (UTC+7)</div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center gap-1"><User size={12} />Tài khoản thực hiện</div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Hành động</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    Không có bản ghi nào
                  </td>
                </tr>
              ) : paginated.map(log => (
                <tr key={log.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-xs font-tabular text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(log.timestamp)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-foreground">{log.account}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-md">{log.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{filtered.length} bản ghi</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">‹</button>
              <span className="text-xs text-muted-foreground px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
