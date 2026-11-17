'use client';
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';

const PUBLIC_PATHS = ['/sign-up-login', '/login', '/register', '/checkout', '/attendance'];

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
  | 'APPROVE_REGISTRATION';

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
  action?: string;
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface AuditContextValue {
  logs: AuditEntry[];
  addLog: (account: string, action: AuditAction, detail: string) => void;
  loading: boolean;
  refetchLogs: () => Promise<void>;
  fetchFilteredLogs: (filters: AuditFilterParams) => Promise<AuditEntry[]>;
}

const AuditContext = createContext<AuditContextValue | null>(null);

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const { currentUser, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));
  const shouldLoadAudit = !authLoading && Boolean(currentUser) && !isPublicPath;

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
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
        setLogs(dedupeById(mapped));
      }
    } catch {}
    setLoading(false);
  }, [supabase]);

  const fetchFilteredLogs = useCallback(async (filters: AuditFilterParams): Promise<AuditEntry[]> => {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(2000);

      if (filters.account) {
        query = query.eq('account', filters.account);
      }
      if (filters.action) {
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
      setLogs([]);
      setLoading(false);
      return;
    }
    fetchLogs();
  }, [authLoading, shouldLoadAudit, fetchLogs]);

  const addLog = useCallback(async (account: string, action: AuditAction, detail: string) => {
    const entry: AuditEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      account,
      action,
      detail,
    };
    // Optimistic update
    setLogs(prev => [entry, ...prev]);
    // Persist to Supabase
    try {
      await supabase.from('audit_logs').insert({
        account,
        action,
        detail,
      });
    } catch {}
  }, [supabase]);

  return (
    <AuditContext.Provider value={{ logs, addLog, loading, refetchLogs: fetchLogs, fetchFilteredLogs }}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error('useAudit must be used within AuditProvider');
  return ctx;
}
