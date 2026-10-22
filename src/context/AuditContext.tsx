'use client';
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export type AuditAction = 'Thêm' | 'Sửa' | 'Xóa' | 'Chuyển phòng' | 'Đổi trạng thái tạm trú' | 'Import' | 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT';

export interface AuditEntry {
  id: string;
  timestamp: string;
  account: string;
  action: AuditAction;
  detail: string;
}

interface AuditContextValue {
  logs: AuditEntry[];
  addLog: (account: string, action: AuditAction, detail: string) => void;
  loading: boolean;
  refetchLogs: () => Promise<void>;
}

const AuditContext = createContext<AuditContextValue | null>(null);

export function AuditProvider({ children }: { children: React.ReactNode }) {
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
        setLogs(data.map(row => ({
          id: row.id,
          timestamp: row.timestamp,
          account: row.account,
          action: row.action as AuditAction,
          detail: row.detail,
        })));
      }
    } catch {}
    setLoading(false);
  }, [supabase]);

  // Initial fetch on mount
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Re-fetch whenever the auth session is established or refreshed so every
  // admin account always sees the full shared log (not the empty snapshot
  // captured before the session token was ready).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        fetchLogs();
      }
      if (event === 'SIGNED_OUT') {
        setLogs([]);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, fetchLogs]);

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
    <AuditContext.Provider value={{ logs, addLog, loading, refetchLogs: fetchLogs }}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error('useAudit must be used within AuditProvider');
  return ctx;
}
