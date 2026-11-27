'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { compareKtxNames } from '@/data/workers';
import { fetchFacilitiesList } from '@/lib/facilityCapacity';
import { subscribeTableChanges } from '@/lib/realtimeHub';

export interface KtxBlockGroup {
  ktx: string;
  color: 'blue' | 'orange' | 'emerald' | 'purple' | 'cyan' | 'amber' | 'rose';
  days: string[];
  blocks: string[]; // Format: "KTX X - Dãy Y"
}

const COLOR_PALETTE: ('blue' | 'orange' | 'emerald' | 'purple' | 'cyan' | 'amber' | 'rose')[] = [
  'blue',
  'orange',
  'emerald',
  'purple',
  'cyan',
  'amber',
  'rose',
];

/**
 * Natural sort helper for day/building names: "Dãy 2" before "Dãy 10"
 */
export function compareDayNames(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });
}

/**
 * Normalizes KTX label (e.g. "ktx3", "KTX3", "ktx 3" -> "KTX 3")
 */
export function normalizeKtxLabel(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^ktx\s*(\d+)$/i);
  if (match) return `KTX ${match[1]}`;
  return trimmed;
}

/**
 * Normalizes day name (e.g. "1" -> "Dãy 1", "dãy 1" -> "Dãy 1")
 */
export function normalizeDayLabel(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^(dãy|day)\s+/i.test(trimmed)) {
    const rest = trimmed.replace(/^(dãy|day)\s+/i, '').trim();
    return `Dãy ${rest}`;
  }
  if (/^\d+$/.test(trimmed)) return `Dãy ${trimmed}`;
  return trimmed;
}

// Module-level cache to ensure fast single-fetch across all mounting components
let _cachedKtxStructure: KtxBlockGroup[] | null = null;
let _inflightPromise: Promise<KtxBlockGroup[]> | null = null;

export function invalidateKtxStructureCache(): void {
  _cachedKtxStructure = null;
  _inflightPromise = null;
}

/**
 * Fetches dynamic KTX & block structure 100% directly from Supabase (Single Source of Truth):
 * 1. `facilities` (cached via facilityCapacity)
 * 2. `room_units` table (ktx, day_nha)
 * 3. `workers` table (ktx, day)
 * 4. `profiles` table (assigned_blocks)
 */
export async function fetchDynamicKtxStructure(forceRefresh = false): Promise<KtxBlockGroup[]> {
  if (!forceRefresh && _cachedKtxStructure) {
    return _cachedKtxStructure;
  }

  if (!forceRefresh && _inflightPromise) {
    return _inflightPromise;
  }

  _inflightPromise = (async () => {
    try {
      const supabase = createClient();
      const ktxMap = new Map<string, Set<string>>();

      const isSystemSentinel = (val?: string | null) => {
        const t = (val || '').trim();
        return t.startsWith('__') && t.endsWith('__');
      };

      const addEntry = (rawKtx: string, rawDay?: string) => {
        if (isSystemSentinel(rawKtx) || isSystemSentinel(rawDay)) return;
        const ktx = normalizeKtxLabel(rawKtx);
        if (!ktx || isSystemSentinel(ktx)) return;
        if (!ktxMap.has(ktx)) {
          ktxMap.set(ktx, new Set());
        }
        if (rawDay) {
          const day = normalizeDayLabel(rawDay);
          if (day && !isSystemSentinel(day)) {
            ktxMap.get(ktx)!.add(day);
          }
        }
      };

      const PAGE_SIZE = 1000;

      const loadFacilities = async () => {
        try {
          const facs = await fetchFacilitiesList(forceRefresh);
          return facs.map(row => ({
            ktx: row.ktx,
            day: row.day,
            room_type: row.room_type,
            is_visible: row.is_visible,
          }));
        } catch (err) {
          console.warn('[ktxStructure] Warning fetching facilities:', err);
          return [];
        }
      };

      const loadRoomUnits = async () => {
        const rows: Array<{ ktx: string; day_nha: string }> = [];
        let from = 0;
        while (true) {
          const { data: roomRows, error: roomErr } = await supabase
            .from('room_units')
            .select('ktx, day_nha')
            .range(from, from + PAGE_SIZE - 1);
          if (roomErr) {
            console.warn('[ktxStructure] Warning fetching room_units:', roomErr.message);
            break;
          }
          if (!roomRows || roomRows.length === 0) break;
          rows.push(...(roomRows as any));
          if (roomRows.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        return rows;
      };

      const loadWorkerLocs = async () => {
        const rows: Array<{ ktx: string; day: string }> = [];
        let from = 0;
        while (true) {
          const { data: workerRows, error: workerErr } = await supabase
            .from('workers')
            .select('ktx, day')
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
          if (workerErr) {
            console.warn('[ktxStructure] Warning fetching workers:', workerErr.message);
            break;
          }
          if (!workerRows || workerRows.length === 0) break;
          rows.push(...(workerRows as any));
          if (workerRows.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        return rows;
      };

      const loadProfiles = async () => {
        try {
          const { data, error } = await supabase.from('profiles').select('assigned_blocks');
          if (error || !data) return [];
          return data;
        } catch {
          return [];
        }
      };

      const [facilityRows, roomRows, workerRows, profileRows] = await Promise.all([
        loadFacilities(),
        loadRoomUnits(),
        loadWorkerLocs(),
        loadProfiles(),
      ]);

      facilityRows.forEach(row => {
        if ((row.room_type || 'accommodation') === 'accommodation' && row.is_visible !== false) {
          addEntry(row.ktx, row.day);
        }
      });

      roomRows.forEach(row => {
        addEntry(row.ktx, row.day_nha);
      });

      workerRows.forEach(row => {
        addEntry(row.ktx, row.day);
      });

      profileRows.forEach((p: any) => {
        if (Array.isArray(p.assigned_blocks)) {
          p.assigned_blocks.forEach((blockStr: string) => {
            if (typeof blockStr === 'string' && blockStr.includes(' - ')) {
              const parts = blockStr.split(' - ');
              const ktx = parts[0];
              const day = parts.slice(1).join(' - ');
              addEntry(ktx, day);
            } else if (typeof blockStr === 'string' && blockStr.trim()) {
              addEntry(blockStr.trim());
            }
          });
        }
      });

      // Strictly dynamic: no static fallback if database has no entries

      if (ktxMap.size === 0) {
        _cachedKtxStructure = [];
        return [];
      }

      // Sort KTX names with natural sorting (KTX 1, KTX 2, KTX 3, KTX 4...)
      const sortedKtxNames = Array.from(ktxMap.keys()).sort(compareKtxNames);

      const result: KtxBlockGroup[] = sortedKtxNames.map((ktx, index) => {
        const days = Array.from(ktxMap.get(ktx)!).sort(compareDayNames);
        const color = COLOR_PALETTE[index % COLOR_PALETTE.length];
        const blocks = days.map(d => `${ktx} - ${d}`);

        return {
          ktx,
          color,
          days,
          blocks,
        };
      });

      _cachedKtxStructure = result;
      return result;
    } catch (err) {
      console.warn('[ktxStructure] Connection error while fetching structure:', err);
      _cachedKtxStructure = [];
      return [];
    } finally {
      _inflightPromise = null;
    }
  })();

  return _inflightPromise;
}

const _structureListeners = new Set<(groups: KtxBlockGroup[]) => void>();
let _sharedRealtimeCleanup: (() => void) | null = null;
let _reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastWorkerInsertTriggerAt = 0;
const WORKER_INSERT_COOLDOWN_MS = 15_000;

function notifyStructureListeners(groups: KtxBlockGroup[]) {
  _structureListeners.forEach(listener => {
    try {
      listener(groups);
    } catch {}
  });
}

function scheduleSharedStructureReload() {
  if (_reloadDebounceTimer) clearTimeout(_reloadDebounceTimer);
  _reloadDebounceTimer = setTimeout(async () => {
    _reloadDebounceTimer = null;
    const data = await fetchDynamicKtxStructure(true);
    notifyStructureListeners(data || []);
  }, 400);
}

function handleWorkerInsertRealtime(payload: { new?: Record<string, unknown> }) {
  const row = payload?.new;
  if (row && _cachedKtxStructure) {
    const ktx = normalizeKtxLabel(String(row.ktx || ''));
    const day = normalizeDayLabel(String(row.day || ''));
    if (ktx) {
      const existingGroup = _cachedKtxStructure.find(g => g.ktx === ktx);
      const dayKnown = !day || Boolean(existingGroup?.days.includes(day));
      if (existingGroup && dayKnown) {
        return; // Structure already includes this KTX & Dãy — avoid expensive full-table refetch
      }
    }
  }
  const now = Date.now();
  if (now - _lastWorkerInsertTriggerAt < WORKER_INSERT_COOLDOWN_MS) return;
  _lastWorkerInsertTriggerAt = now;
  scheduleSharedStructureReload();
}

function ensureSharedRealtimeSubscription() {
  if (_sharedRealtimeCleanup) return;

  const unsubs: Array<() => void> = [];
  try {
    unsubs.push(
      subscribeTableChanges('workers', payload => {
        if (payload.eventType === 'INSERT') {
          handleWorkerInsertRealtime(payload);
        }
      }),
      subscribeTableChanges('facilities', () => scheduleSharedStructureReload()),
      subscribeTableChanges('room_units', payload => {
        const ktxVal = String(payload?.new?.ktx ?? payload?.old?.ktx ?? '').trim();
        if (ktxVal.startsWith('__') && ktxVal.endsWith('__')) return;
        scheduleSharedStructureReload();
      }),
      subscribeTableChanges('profiles', () => scheduleSharedStructureReload())
    );
  } catch (err) {
    console.warn('[ktxStructure] Realtime subscribe failed (table may be missing):', err);
  }

  const onFacilitiesUpdated = () => scheduleSharedStructureReload();
  if (typeof window !== 'undefined') {
    window.addEventListener('ktx_facilities_updated', onFacilitiesUpdated);
  }

  _sharedRealtimeCleanup = () => {
    if (_reloadDebounceTimer) {
      clearTimeout(_reloadDebounceTimer);
      _reloadDebounceTimer = null;
    }
    unsubs.forEach(fn => {
      try {
        fn();
      } catch {}
    });
    if (typeof window !== 'undefined') {
      window.removeEventListener('ktx_facilities_updated', onFacilitiesUpdated);
    }
    _sharedRealtimeCleanup = null;
  };
}

/**
 * React Hook for consuming dynamic KTX and block structure throughout the app
 */
export function useKtxStructure() {
  const [ktxGroups, setKtxGroups] = useState<KtxBlockGroup[]>(() => _cachedKtxStructure || []);
  const [loading, setLoading] = useState(!_cachedKtxStructure);

  const reload = useCallback(async (force = true) => {
    setLoading(true);
    try {
      const data = await fetchDynamicKtxStructure(force);
      const next = data || [];
      setKtxGroups(next);
      notifyStructureListeners(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!_cachedKtxStructure) {
      reload(false);
    }
  }, [reload]);

  useEffect(() => {
    const listener = (groups: KtxBlockGroup[]) => {
      setKtxGroups(groups);
      setLoading(false);
    };
    _structureListeners.add(listener);
    ensureSharedRealtimeSubscription();

    return () => {
      _structureListeners.delete(listener);
      if (_structureListeners.size === 0 && _sharedRealtimeCleanup) {
        _sharedRealtimeCleanup();
      }
    };
  }, []);

  const ktxNames = useMemo(() => ktxGroups.map(g => g.ktx), [ktxGroups]);

  return {
    ktxGroups,
    ktxNames,
    loading,
    reload,
  };
}
