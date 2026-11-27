'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export interface RealtimeTablePayload {
  eventType?: string;
  schema?: string;
  table?: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}

type RealtimeListener = (payload: RealtimeTablePayload) => void;

interface TableHubEntry {
  listeners: Set<RealtimeListener>;
  channel: RealtimeChannel | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const tableHubs = new Map<string, TableHubEntry>();
const CHANNEL_IDLE_TEARDOWN_MS = 2500;

function ensureTableChannel(table: string, entry: TableHubEntry) {
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }
  if (entry.channel) return;

  try {
    const supabase = createClient();
    const channel = supabase
      .channel(`ktx_shared_hub_${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload: RealtimeTablePayload) => {
          entry.listeners.forEach(fn => {
            try {
              fn(payload);
            } catch (err) {
              console.warn(`[realtimeHub] listener error on ${table}:`, err);
            }
          });
        }
      )
      .subscribe();

    entry.channel = channel;
  } catch (err) {
    console.warn(`[realtimeHub] failed to subscribe to ${table}:`, err);
  }
}

/**
 * Subscribe to Supabase postgres_changes for a table using a single shared channel
 * across the entire browser session. Prevents duplicate WebSocket channels when
 * Sidebar, NotificationCenter, Dashboard, and module pages watch the same table.
 */
export function subscribeTableChanges(
  table: string,
  listener: RealtimeListener
): () => void {
  const normalizedTable = table.trim();
  if (!normalizedTable || typeof window === 'undefined') {
    return () => {};
  }

  let entry = tableHubs.get(normalizedTable);
  if (!entry) {
    entry = { listeners: new Set(), channel: null, cleanupTimer: null };
    tableHubs.set(normalizedTable, entry);
  }

  entry.listeners.add(listener);
  ensureTableChannel(normalizedTable, entry);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;

    const current = tableHubs.get(normalizedTable);
    if (!current) return;
    current.listeners.delete(listener);

    if (current.listeners.size === 0 && !current.cleanupTimer) {
      current.cleanupTimer = setTimeout(() => {
        const latest = tableHubs.get(normalizedTable);
        if (!latest || latest.listeners.size > 0) return;
        if (latest.channel) {
          try {
            const supabase = createClient();
            void supabase.removeChannel(latest.channel);
          } catch {
            // non-blocking cleanup
          }
          latest.channel = null;
        }
        latest.cleanupTimer = null;
        tableHubs.delete(normalizedTable);
      }, CHANNEL_IDLE_TEARDOWN_MS);
    }
  };
}

/**
 * Subscribe to multiple tables with one callback and return a single unsubscribe handle.
 */
export function subscribeTablesChanges(
  tables: string[],
  listener: (table: string, payload: RealtimeTablePayload) => void
): () => void {
  const unsubs = tables.map(table =>
    subscribeTableChanges(table, payload => listener(table, payload))
  );
  return () => {
    unsubs.forEach(fn => fn());
  };
}
