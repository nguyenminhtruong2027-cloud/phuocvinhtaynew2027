import { SupabaseClient } from '@supabase/supabase-js';
import { releaseBedsForWorkers } from '@/lib/bedSync';

export interface WorkerDeletionTarget {
  id: string;
  hoVaTen?: string | null;
  maNV?: string | null;
  cccd?: string | null;
  soDienThoai?: string | null;
  ktx?: string | null;
  day?: string | null;
  phongSo?: string | null;
  giuong?: string | null;
}

export interface WorkerDeletionIntegrityResult {
  isClean: boolean;
  remainingWorkerIds: string[];
  orphanBedIds: string[];
  auditedDeletedIds: string[];
  message: string;
}

const TOMBSTONE_STORAGE_KEY = 'ktx_hard_deleted_worker_tombstones_v1';
const TOMBSTONE_CHANNEL_NAME = 'ktx_worker_tombstones_channel';
const LOCAL_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUTHORITATIVE_CACHE_TTL_MS = 10_000; // 10s
const RECENT_AUDITED_TTL_MS = 30_000; // 30s

const memoryTombstones = new Map<string, number>();
const recentlyAuditedIds = new Map<string, number>();

// Session-level caches to avoid repeating 404/PGRST202 calls when optional SQL RPCs aren't deployed yet
let rpcVerifyAvailable: boolean | null = null;
let rpcTombstonesAvailable: boolean | null = null;

// Short-lived cache + inflight deduplication for authoritative tombstone sync
let cachedAuthoritativeTombstones: Map<string, number> | null = null;
let cachedAuthoritativeAt = 0;
let inflightAuthoritativeFetch: Promise<Map<string, number>> | null = null;

function isMissingRpcError(err: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST202') return true;
  if (err.code === '42883') return false;
  const msg = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return (
    msg.includes('could not find the function') ||
    (msg.includes('function') && msg.includes('does not exist'))
  );
}

function normalizeNameBasic(raw?: string | null): string {
  return String(raw || '')
    .normalize('NFC')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeCodeBasic(raw?: string | null): string {
  const s = String(raw || '')
    .normalize('NFC')
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '')
    .toLowerCase();
  if (!s || ['-', '—', 'chờmã', 'chưacó', 'n/a', 'null'].includes(s)) return '';
  return s;
}

function pruneTombstoneMap(map: Map<string, number>, now = Date.now()) {
  for (const [id, ts] of map.entries()) {
    if (!id || !Number.isFinite(ts) || now - ts > LOCAL_TOMBSTONE_TTL_MS) {
      map.delete(id);
    }
  }
}

export function getLocalDeletedTombstones(): Map<string, number> {
  const now = Date.now();
  pruneTombstoneMap(memoryTombstones, now);
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(TOMBSTONE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (parsed && typeof parsed === 'object') {
          for (const [id, ts] of Object.entries(parsed)) {
            if (id && typeof ts === 'number' && now - ts <= LOCAL_TOMBSTONE_TTL_MS) {
              const existing = memoryTombstones.get(id) ?? 0;
              if (ts > existing) memoryTombstones.set(id, ts);
            }
          }
        }
      }
    } catch {
      // Ignore storage quota or malformed JSON
    }
  }
  return new Map(memoryTombstones);
}

export function recordLocalDeletedTombstones(ids: string[], deletedAtMs = Date.now()): void {
  const cleanIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)));
  if (cleanIds.length === 0) return;

  const merged = getLocalDeletedTombstones();
  cleanIds.forEach(id => {
    const prev = merged.get(id) ?? 0;
    const nextTs = Math.max(prev, deletedAtMs);
    merged.set(id, nextTs);
    memoryTombstones.set(id, nextTs);
    if (cachedAuthoritativeTombstones) {
      cachedAuthoritativeTombstones.set(id, Math.max(cachedAuthoritativeTombstones.get(id) ?? 0, nextTs));
    }
  });
  pruneTombstoneMap(merged, Date.now());

  if (typeof window !== 'undefined') {
    try {
      const obj: Record<string, number> = {};
      merged.forEach((ts, id) => {
        obj[id] = ts;
      });
      window.localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Ignore storage write errors
    }

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const ch = new BroadcastChannel(TOMBSTONE_CHANNEL_NAME);
        ch.postMessage({ type: 'WORKER_HARD_DELETE', ids: cleanIds, deletedAtMs });
        ch.close();
      }
    } catch {
      // BroadcastChannel unavailable
    }
  }
}

export function subscribeCrossTabTombstones(
  onDeleted: (ids: string[], deletedAtMs: number) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(TOMBSTONE_CHANNEL_NAME);
      channel.onmessage = (evt: MessageEvent) => {
        const data = evt?.data;
        if (data?.type === 'WORKER_HARD_DELETE' && Array.isArray(data.ids)) {
          const ts = typeof data.deletedAtMs === 'number' ? data.deletedAtMs : Date.now();
          data.ids.forEach((id: unknown) => {
            const clean = String(id || '').trim();
            if (clean) memoryTombstones.set(clean, Math.max(memoryTombstones.get(clean) ?? 0, ts));
          });
          onDeleted(
            data.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean),
            ts
          );
        }
      };
    }
  } catch {
    channel = null;
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== TOMBSTONE_STORAGE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as Record<string, number>;
      const now = Date.now();
      const freshIds: string[] = [];
      let maxTs = now;
      Object.entries(parsed || {}).forEach(([id, ts]) => {
        if (id && typeof ts === 'number' && now - ts <= LOCAL_TOMBSTONE_TTL_MS) {
          const prev = memoryTombstones.get(id) ?? 0;
          if (ts > prev) {
            memoryTombstones.set(id, ts);
            freshIds.push(id);
            if (ts > maxTs) maxTs = ts;
          }
        }
      });
      if (freshIds.length > 0) {
        onDeleted(freshIds, maxTs);
      }
    } catch {
      // Ignore parse error
    }
  };

  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    try {
      channel?.close();
    } catch {
      // Ignore close error
    }
  };
}

export function isWorkerTombstoned(
  workerId?: string | null,
  createdAtIso?: string | null,
  tombstones?: Map<string, number>
): boolean {
  const id = String(workerId || '').trim();
  if (!id) return false;
  const map = tombstones ?? getLocalDeletedTombstones();
  const tombstoneAt = map.get(id);
  if (!tombstoneAt) return false;

  if (createdAtIso) {
    const createdMs = new Date(createdAtIso).getTime();
    if (!Number.isNaN(createdMs)) {
      return tombstoneAt >= createdMs - 1000;
    }
  }
  return true;
}

/**
 * Ensures every hard-deleted worker record has a structured WORKER_HARD_DELETE entry
 * in `audit_logs`. Idempotent: avoids duplicating entries already written by the SQL trigger.
 */
export async function ensureWorkerHardDeleteAuditLogged(
  supabase: SupabaseClient,
  account: string,
  targets: WorkerDeletionTarget[],
  sourceContext: string
): Promise<string[]> {
  const cleanTargets = targets.filter(t => Boolean(t?.id && String(t.id).trim()));
  if (cleanTargets.length === 0) return [];

  const nowMs = Date.now();
  const targetIds = Array.from(new Set(cleanTargets.map(t => String(t.id).trim())));
  recordLocalDeletedTombstones(targetIds, nowMs);

  const alreadyLoggedIds = new Set<string>();
  cleanTargets.forEach(t => {
    const tid = String(t.id).trim();
    const cachedTs = recentlyAuditedIds.get(tid);
    if (cachedTs && nowMs - cachedTs < RECENT_AUDITED_TTL_MS) {
      alreadyLoggedIds.add(tid);
    }
  });

  const uncheckedTargets = cleanTargets.filter(t => !alreadyLoggedIds.has(String(t.id).trim()));
  if (uncheckedTargets.length === 0) {
    return Array.from(alreadyLoggedIds);
  }

  try {
    const recentSince = new Date(nowMs - 20_000).toISOString();
    const { data: recentLogs } = await supabase
      .from('audit_logs')
      .select('detail')
      .eq('action', 'WORKER_HARD_DELETE')
      .gte('timestamp', recentSince)
      .order('timestamp', { ascending: false })
      .limit(50);

    (recentLogs || []).forEach((row: { detail?: string }) => {
      try {
        const raw = String(row?.detail || '').trim();
        if (raw.startsWith('{')) {
          const parsed = JSON.parse(raw);
          if (parsed?.worker_id) {
            const wid = String(parsed.worker_id);
            alreadyLoggedIds.add(wid);
            recentlyAuditedIds.set(wid, nowMs);
          }
        }
      } catch {
        // Ignore unparseable row
      }
    });
  } catch {
    // Proceed to fallback insert if query fails
  }

  const missingTargets = cleanTargets.filter(t => !alreadyLoggedIds.has(String(t.id).trim()));
  if (missingTargets.length > 0) {
    const nowIso = new Date().toISOString();
    const rowsToInsert = missingTargets.map(t => ({
      timestamp: nowIso,
      account: account || 'system',
      action: 'WORKER_HARD_DELETE',
      detail: JSON.stringify({
        event: 'WORKER_HARD_DELETE',
        worker_id: String(t.id).trim(),
        ho_va_ten: t.hoVaTen || '',
        ma_nv: t.maNV || '',
        cccd: t.cccd || '',
        so_dien_thoai: t.soDienThoai || '',
        ktx: t.ktx || '',
        day: t.day || '',
        phong_so: t.phongSo || '',
        giuong: t.giuong || '',
        source: sourceContext,
        deleted_at: nowIso,
        integrity_verified: true,
      }),
    }));

    const CHUNK = 100;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      try {
        await supabase.from('audit_logs').insert(rowsToInsert.slice(i, i + CHUNK));
      } catch {
        // Non-fatal fallback
      }
    }
    missingTargets.forEach(t => {
      const tid = String(t.id).trim();
      alreadyLoggedIds.add(tid);
      recentlyAuditedIds.set(tid, nowMs);
    });
  }

  return Array.from(alreadyLoggedIds);
}

/**
 * Post-delete integrity verifier: confirms zero surviving rows in `workers`, zero orphan
 * references in `beds` (automatically releasing them if detected), and confirms audit tombstones.
 */
export async function verifyWorkerDeletionIntegrity(
  supabase: SupabaseClient,
  params: {
    workerIds: string[];
    codes?: string[];
    hoVaTen?: string | null;
    soDienThoai?: string | null;
    account?: string;
    sourceContext?: string;
    targets?: WorkerDeletionTarget[];
  }
): Promise<WorkerDeletionIntegrityResult> {
  const cleanIds = Array.from(new Set((params.workerIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  const cleanCodes = Array.from(
    new Set((params.codes || []).map(c => String(c || '').trim()).filter(c => normalizeCodeBasic(c) !== ''))
  );

  let remainingWorkerIds: string[] = [];
  let orphanBedIds: string[] = [];
  let auditedDeletedIds: string[] = [];
  let usedRpc = false;

  if (rpcVerifyAvailable !== false) {
    try {
      const { data, error } = await supabase.rpc('verify_worker_deletion_integrity', {
        p_worker_ids: cleanIds,
        p_codes: cleanCodes,
        p_ho_va_ten: params.hoVaTen || null,
        p_so_dien_thoai: params.soDienThoai || null,
        p_since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!error && data) {
        rpcVerifyAvailable = true;
        const row = Array.isArray(data) ? data[0] : data;
        remainingWorkerIds = Array.isArray(row?.remaining_worker_ids)
          ? row.remaining_worker_ids.map((x: unknown) => String(x)).filter(Boolean)
          : [];
        orphanBedIds = Array.isArray(row?.orphan_bed_ids)
          ? row.orphan_bed_ids.map((x: unknown) => String(x)).filter(Boolean)
          : [];
        auditedDeletedIds = Array.isArray(row?.audited_deleted_ids)
          ? row.audited_deleted_ids.map((x: unknown) => String(x)).filter(Boolean)
          : [];
        usedRpc = true;
      } else if (error && isMissingRpcError(error)) {
        rpcVerifyAvailable = false;
      }
    } catch {
      usedRpc = false;
    }
  }

  if (!usedRpc) {
    const survivorSet = new Set<string>();
    const bedSet = new Set<string>();
    const CHUNK = 200;
    const normTargetName = normalizeNameBasic(params.hoVaTen);

    const idChunks: string[][] = [];
    for (let i = 0; i < cleanIds.length; i += CHUNK) {
      idChunks.push(cleanIds.slice(i, i + CHUNK));
    }

    await Promise.all([
      ...idChunks.map(async chunk => {
        const [{ data: wRows }, { data: bRows }] = await Promise.all([
          supabase.from('workers').select('id').in('id', chunk),
          supabase.from('beds').select('id').in('worker_id', chunk),
        ]);
        (wRows || []).forEach((r: { id?: string }) => {
          if (r?.id) survivorSet.add(String(r.id));
        });
        (bRows || []).forEach((b: { id?: string }) => {
          if (b?.id) bedSet.add(String(b.id));
        });
      }),
      ...cleanCodes.map(async code => {
        const [{ data: byMa }, { data: byCccd }] = await Promise.all([
          supabase.from('workers').select('id, ho_va_ten').eq('ma_nv', code),
          supabase.from('workers').select('id, ho_va_ten').eq('cccd', code),
        ]);
        [...(byMa || []), ...(byCccd || [])].forEach((r: { id?: string; ho_va_ten?: string }) => {
          if (!r?.id) return;
          const rName = normalizeNameBasic(r.ho_va_ten);
          if (!normTargetName || rName === normTargetName || code.replace(/\D/g, '').length >= 9) {
            survivorSet.add(String(r.id));
          }
        });
      }),
    ]);

    remainingWorkerIds = Array.from(survivorSet);
    orphanBedIds = Array.from(bedSet);
  }

  // Auto-heal orphan beds if any still reference deleted worker IDs
  if (orphanBedIds.length > 0 && cleanIds.length > 0) {
    try {
      await releaseBedsForWorkers(supabase, cleanIds);
      const { data: recheckBeds } = await supabase
        .from('beds')
        .select('id')
        .in('id', orphanBedIds)
        .not('worker_id', 'is', null);
      orphanBedIds = (recheckBeds || []).map((b: { id?: string }) => String(b.id || '')).filter(Boolean);
    } catch {
      // Preserve detected orphanBedIds for error reporting
    }
  }

  // Ensure audit_logs contains WORKER_HARD_DELETE tombstones for all cleanly removed IDs
  if (remainingWorkerIds.length === 0 && cleanIds.length > 0 && params.targets && params.targets.length > 0) {
    const missingAuditTargets = params.targets.filter(t => !auditedDeletedIds.includes(String(t.id)));
    if (missingAuditTargets.length > 0) {
      const logged = await ensureWorkerHardDeleteAuditLogged(
        supabase,
        params.account || 'system',
        missingAuditTargets,
        params.sourceContext || 'integrity_verifier'
      );
      auditedDeletedIds = Array.from(new Set([...auditedDeletedIds, ...logged]));
    }
  }

  const verifiedIds = cleanIds.filter(id => !remainingWorkerIds.includes(id));
  if (verifiedIds.length > 0) {
    recordLocalDeletedTombstones(verifiedIds);
  }

  const isClean = remainingWorkerIds.length === 0 && orphanBedIds.length === 0;
  const message = isClean
    ? 'Toàn vẹn dữ liệu sau xóa được xác nhận (0 bản ghi tồn, 0 giường treo).'
    : remainingWorkerIds.length > 0
    ? `Phát hiện ${remainingWorkerIds.length} bản ghi công nhân vẫn còn tồn tại trên CSDL.`
    : `Phát hiện ${orphanBedIds.length} giường vẫn còn gắn liên kết công nhân đã xóa.`;

  return {
    isClean,
    remainingWorkerIds,
    orphanBedIds,
    auditedDeletedIds,
    message,
  };
}

/**
 * Fetches authoritative deleted-worker tombstones from `audit_logs` ('WORKER_HARD_DELETE')
 * and `worker_deletion_log`, merged with local cross-tab tombstones, to block stale sessions
 * from restoring deleted records during sync or upsert.
 */
export async function fetchAuthoritativeDeletedTombstones(
  supabase: SupabaseClient,
  sinceHours = 48,
  forceRefresh = false
): Promise<Map<string, number>> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedAuthoritativeTombstones &&
    now - cachedAuthoritativeAt < AUTHORITATIVE_CACHE_TTL_MS
  ) {
    const merged = getLocalDeletedTombstones();
    cachedAuthoritativeTombstones.forEach((ts, id) => {
      merged.set(id, Math.max(merged.get(id) ?? 0, ts));
    });
    return merged;
  }

  if (!forceRefresh && inflightAuthoritativeFetch) {
    return inflightAuthoritativeFetch;
  }

  inflightAuthoritativeFetch = (async () => {
    const merged = getLocalDeletedTombstones();
    const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

    if (rpcTombstonesAvailable !== false) {
      try {
        const { data, error } = await supabase.rpc('get_deleted_worker_tombstones', {
          p_since: sinceIso,
        });
        if (!error && Array.isArray(data)) {
          rpcTombstonesAvailable = true;
          data.forEach((row: { worker_id?: string; deleted_at?: string }) => {
            const wid = String(row?.worker_id || '').trim();
            const ts = row?.deleted_at ? new Date(row.deleted_at).getTime() : Date.now();
            if (wid && !Number.isNaN(ts)) {
              merged.set(wid, Math.max(merged.get(wid) ?? 0, ts));
            }
          });
          cachedAuthoritativeTombstones = new Map(merged);
          cachedAuthoritativeAt = Date.now();
          return merged;
        }
        if (error && isMissingRpcError(error)) {
          rpcTombstonesAvailable = false;
        }
      } catch {
        // Fallback to direct table queries if RPC isn't deployed yet
      }
    }

    try {
      const [auditRes, delLogRes] = await Promise.all([
        supabase
          .from('audit_logs')
          .select('timestamp, detail')
          .eq('action', 'WORKER_HARD_DELETE')
          .gte('timestamp', sinceIso)
          .order('timestamp', { ascending: false })
          .limit(250),
        supabase
          .from('worker_deletion_log')
          .select('worker_id, deleted_at')
          .gte('deleted_at', sinceIso)
          .order('deleted_at', { ascending: false })
          .limit(250),
      ]);

      (auditRes.data || []).forEach((row: { timestamp?: string; detail?: string }) => {
        try {
          const raw = String(row?.detail || '').trim();
          if (!raw.startsWith('{')) return;
          const parsed = JSON.parse(raw);
          const wid = String(parsed?.worker_id || '').trim();
          const ts = row?.timestamp ? new Date(row.timestamp).getTime() : Date.now();
          if (wid && !Number.isNaN(ts)) {
            merged.set(wid, Math.max(merged.get(wid) ?? 0, ts));
          }
        } catch {
          // Ignore non-JSON audit detail
        }
      });

      (delLogRes.data || []).forEach((row: { worker_id?: string; deleted_at?: string }) => {
        const wid = String(row?.worker_id || '').trim();
        const ts = row?.deleted_at ? new Date(row.deleted_at).getTime() : Date.now();
        if (wid && !Number.isNaN(ts)) {
          merged.set(wid, Math.max(merged.get(wid) ?? 0, ts));
        }
      });
    } catch {
      // Keep local tombstones if network query fails
    }

    cachedAuthoritativeTombstones = new Map(merged);
    cachedAuthoritativeAt = Date.now();
    return merged;
  })().finally(() => {
    inflightAuthoritativeFetch = null;
  });

  return inflightAuthoritativeFetch;
}
