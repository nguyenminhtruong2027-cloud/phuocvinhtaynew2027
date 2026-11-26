'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';

const PUBLIC_PATHS = ['/sign-up-login', '/login', '/register', '/checkout', '/attendance', '/report-issue'];

export type AuditAction =
  | 'Thêm'
  | 'Sửa'
  | 'Xóa'
  | 'Chuyển phòng'
  | 'Đổi trạng thái tạm trú'
  | 'Import'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'IMPORT'
  | 'CHECKOUT_REQUEST'
  | 'CHECKOUT_APPROVED'
  | 'BED_REASSIGN'
  | 'BED_INSPECT_CONFIRM'
  | 'APPROVE_REGISTRATION'
  | 'FACILITY_CREATE'
  | 'FACILITY_UPDATE'
  | 'FACILITY_DELETE'
  | 'ATTENDANCE_SESSION'
  | 'ATTENDANCE_UPDATE'
  | 'USER_PASSWORD_RESET'
  | 'WORKER_HARD_DELETE'
  | 'AUDIT_ARCHIVE_PURGE'
  | 'MAINTENANCE_TICKET_CREATE'
  | 'MAINTENANCE_TICKET_UPDATE'
  | 'MAINTENANCE_TICKET_RESOLVE'
  | 'MAINTENANCE_TICKET_DELETE'
  | 'SYSTEM_BACKUP'
  | 'DISCIPLINE_CREATE'
  | 'BLACKLIST_ADD'
  | 'BLACKLIST_REVOKE'
  | 'ROOM_CONSOLIDATION'
  | 'BATCH_CHECKOUT'
  | 'SWAP_BEDS'
  | 'RESERVE_BED'
  | 'CANCEL_RESERVE_BED';

export interface AuditEntry {
  id: string;
  timestamp: string;
  account: string;
  action: AuditAction;
  detail: string;
}

import { dedupeById } from '@/lib/dedupe';

export interface AuditFilterParams {
  account?: string;
  accounts?: string[];
  action?: string;
  actions?: string[];
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

interface AuditContextValue {
  logs: AuditEntry[];
  totalLogCount: number;
  addLog: (account: string, action: AuditAction, detail: string) => void;
  prependRealtimeEntry: (entry: AuditEntry) => void;
  loading: boolean;
  refetchLogs: () => Promise<void>;
  fetchLogsPage: (page: number, pageSize: number) => Promise<{ entries: AuditEntry[]; total: number }>;
  fetchFilteredLogs: (filters: AuditFilterParams) => Promise<AuditEntry[]>;
}

const AuditContext = createContext<AuditContextValue | null>(null);

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const { currentUser, isAdmin, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));
  const isAuditPage = Boolean(pathname?.startsWith('/audit-log'));
  const shouldLoadAudit = !authLoading && Boolean(currentUser) && isAdmin && !isPublicPath;

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [totalLogCount, setTotalLogCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const hasLoadedLogsRef = useRef(false);
  const supabase = useMemo(() => createClient(), []);

  const fetchLogs = useCallback(async () => {
    if (!hasLoadedLogsRef.current) setLoading(true);
    try {
      const { data, count, error } = await supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false })
        .limit(500);
      if (!error && data) {
        const mapped = data.map(row => ({
          id: row.id,
          timestamp: row.timestamp,
          account: row.account,
          action: row.action as AuditAction,
          detail: row.detail,
        }));
        hasLoadedLogsRef.current = true;
        setLogs(dedupeById(mapped));
        if (typeof count === 'number') setTotalLogCount(count);
        else setTotalLogCount(mapped.length);
      }
    } catch (err) {
      console.warn('[AuditContext] fetchLogs warning:', err);
    }
    setLoading(false);
  }, [supabase]);

  const fetchLogsPage = useCallback(
    async (page: number, pageSize: number): Promise<{ entries: AuditEntry[]; total: number }> => {
      try {
        const from = Math.max(0, (page - 1) * pageSize);
        const to = from + pageSize - 1;
        const { data, count, error } = await supabase
          .from('audit_logs')
          .select('*', { count: 'exact' })
          .order('timestamp', { ascending: false })
          .range(from, to);
        if (error || !data) {
          return { entries: [], total: totalLogCount };
        }
        const entries = dedupeById(
          data.map(row => ({
            id: row.id,
            timestamp: row.timestamp,
            account: row.account,
            action: row.action as AuditAction,
            detail: row.detail,
          }))
        );
        const total = typeof count === 'number' ? count : entries.length;
        setTotalLogCount(total);
        return { entries, total };
      } catch (err) {
        console.warn('[AuditContext] fetchLogsPage warning:', err);
        return { entries: [], total: totalLogCount };
      }
    },
    [supabase, totalLogCount]
  );

  const fetchFilteredLogs = useCallback(async (filters: AuditFilterParams): Promise<AuditEntry[]> => {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(Math.min(Math.max(filters.limit ?? 2000, 100), 5000));

      if (filters.accounts && filters.accounts.length > 0) {
        query = query.in('account', filters.accounts);
      } else if (filters.account) {
        query = query.eq('account', filters.account);
      }

      if (filters.actions && filters.actions.length > 0) {
        query = query.in('action', filters.actions);
      } else if (filters.action) {
        query = query.eq('action', filters.action);
      }

      if (filters.dateFrom) {
        const fromIso = new Date(`${filters.dateFrom}T00:00:00+07:00`).toISOString();
        query = query.gte('timestamp', fromIso);
      }
      if (filters.dateTo) {
        const toIso = new Date(`${filters.dateTo}T23:59:59+07:00`).toISOString();
        query = query.lte('timestamp', toIso);
      }
      const kw = (filters.keyword || '').trim();
      if (kw) {
        const safeKw = kw.replace(/[,%()]/g, ' ').trim();
        if (safeKw) {
          query = query.or(`account.ilike.%${safeKw}%,detail.ilike.%${safeKw}%`);
        }
      }

      const { data, error } = await query;
      if (error || !data) return [];
      return dedupeById(
        data.map(row => ({
          id: row.id,
          timestamp: row.timestamp,
          account: row.account,
          action: row.action as AuditAction,
          detail: row.detail,
        }))
      );
    } catch {
      return [];
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading) return;
    if (!shouldLoadAudit) {
      hasLoadedLogsRef.current = false;
      setLogs([]);
      setTotalLogCount(0);
      setLoading(false);
      return;
    }
    if (isAuditPage) {
      void fetchLogs();
    }
  }, [authLoading, shouldLoadAudit, isAuditPage, fetchLogs]);

  const prependRealtimeEntry = useCallback((entry: AuditEntry) => {
    if (!entry?.id) return;
    setLogs(prev => {
      if (prev.some(item => item.id === entry.id)) return prev;
      return [entry, ...prev].slice(0, 600);
    });
    setTotalLogCount(prev => prev + 1);
  }, []);

  const addLog = useCallback(async (account: string, action: AuditAction, detail: string) => {
    const entry: AuditEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      account,
      action,
      detail,
    };
    setLogs(prev => [entry, ...prev]);
    setTotalLogCount(prev => prev + 1);
    try {
      const { error } = await supabase.from('audit_logs').insert({
        account,
        action,
        detail,
      });
      if (error) {
        console.warn('[AuditContext] Ghi nhật ký thất bại:', error.message);
      }
    } catch (err) {
      console.warn('[AuditContext] Ghi nhật ký gặp sự cố:', err);
    }
  }, [supabase]);

  const contextValue = useMemo<AuditContextValue>(
    () => ({
      logs,
      totalLogCount,
      addLog,
      prependRealtimeEntry,
      loading,
      refetchLogs: fetchLogs,
      fetchLogsPage,
      fetchFilteredLogs,
    }),
    [logs, totalLogCount, addLog, prependRealtimeEntry, loading, fetchLogs, fetchLogsPage, fetchFilteredLogs]
  );

  return (
    <AuditContext.Provider value={contextValue}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error('useAudit must be used within AuditProvider');
  return ctx;
}
