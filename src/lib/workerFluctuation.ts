import { createClient } from '@/lib/supabase/client';
import { compareKtxNames } from '@/data/workers';

export type FluctuationCutoffMode = 'realtime' | '14h';

export interface FluctuationPerson {
  id: string;
  ho_va_ten: string;
  ma_nv: string;
  ktx: string;
  day: string;
  timestamp: string;
  time_vn: string;
  direction: 'in' | 'out';
}

export interface DailyFluctuation {
  ngay: string; // YYYY-MM-DD (Asia/Ho_Chi_Minh)
  so_tang: number;
  so_giam: number;
  bien_dong_rong: number;
  entries: FluctuationPerson[];
  exits: FluctuationPerson[];
}

export interface FluctuationSummary {
  tong_tang: number;
  tong_giam: number;
  bien_dong_rong: number;
  so_ngay_co_bien_dong: number;
}

export interface FluctuationFilterParams {
  dateFrom: string;
  dateTo: string;
  ktx: string;
  day: string;
  cutoffMode: FluctuationCutoffMode;
  preloadedWorkerRows?: RawWorkerRow[];
  baselineDate?: string | null;
  ignoreBaseline?: boolean;
}

export interface FluctuationReportResult {
  daily: DailyFluctuation[]; // sorted ascending by ngay
  summary: FluctuationSummary;
  today: DailyFluctuation;
  availableKtx: string[];
  availableDays: string[];
  appliedBaselineDate: string | null;
}

export interface FluctuationBaselineConfig {
  baselineDate: string | null; // YYYY-MM-DD (Asia/Ho_Chi_Minh)
  updatedAt?: string;
  updatedBy?: string;
}

export interface PreservedWorkerEntry {
  id: string;
  created_at: string;
  ho_va_ten?: string;
  ma_nv?: string;
  ktx?: string;
  day?: string;
}

const PRESERVED_ENTRIES_STORAGE_KEY = 'ktx_fluctuation_preserved_entries_v1';
const BASELINE_STORAGE_KEY = 'ktx_fluctuation_baseline_v1';
const BASELINE_REMOTE_SENTINEL = {
  ktx: '__SYSTEM_CONFIG__',
  day_nha: '__FLUCTUATION__',
  phong_so: 'baseline_date',
} as const;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PRESERVED_ENTRIES = 5000;
const PAGE_SIZE = 1000;

let cachedBaselineConfig: FluctuationBaselineConfig | null = null;
let cachedBaselineFetchedAt = 0;
const BASELINE_CACHE_TTL_MS = 60_000;

// ─── Vietnam Timezone (Asia/Ho_Chi_Minh, UTC+7) Helpers ───────────────────────

const vnDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const vnTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function getVNDateString(input?: Date | string | null): string {
  const d = input ? (input instanceof Date ? input : new Date(input)) : new Date();
  if (isNaN(d.getTime())) return '';
  return vnDateFormatter.format(d); // YYYY-MM-DD
}

export function getVNTimeString(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  return vnTimeFormatter.format(d); // HH:mm
}

export function isAtOrBefore14hVN(input: Date | string): boolean {
  const timeStr = getVNTimeString(input);
  if (!timeStr) return true;
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  return h < 14 || (h === 14 && m === 0);
}

export function getDefaultVNDateRange(days = 30): { from: string; to: string } {
  const now = new Date();
  const to = getVNDateString(now);
  const fromDate = new Date(now.getTime() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000);
  const from = getVNDateString(fromDate);
  return { from, to };
}

export function vnDateStartToUTCISO(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+07:00`).toISOString();
}

export function vnDateEndToUTCISO(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999+07:00`).toISOString();
}

// ─── Preserved Entry Cache (keeps "Vào" accurate even after hard delete) ─────

export function loadPreservedWorkerEntries(): PreservedWorkerEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRESERVED_ENTRIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function preserveDeletedWorkerEntries(
  entries: Array<{
    id?: string;
    createdAt?: string;
    created_at?: string;
    hoVaTen?: string;
    ho_va_ten?: string;
    maNV?: string;
    ma_nv?: string;
    ktx?: string;
    day?: string;
  }>
): void {
  if (typeof window === 'undefined' || !entries || entries.length === 0) return;
  try {
    const existing = loadPreservedWorkerEntries();
    const map = new Map<string, PreservedWorkerEntry>();
    for (const item of existing) {
      if (item?.id && item?.created_at) {
        map.set(item.id, item);
      }
    }
    for (const e of entries) {
      const id = (e.id || '').trim();
      const createdAt = (e.createdAt || e.created_at || '').trim();
      if (!id || !createdAt) continue;
      if (!map.has(id)) {
        map.set(id, {
          id,
          created_at: createdAt,
          ho_va_ten: e.hoVaTen || e.ho_va_ten || '',
          ma_nv: e.maNV || e.ma_nv || '',
          ktx: e.ktx || '',
          day: e.day || '',
        });
      }
    }
    let next = Array.from(map.values());
    if (next.length > MAX_PRESERVED_ENTRIES) {
      next = next.slice(next.length - MAX_PRESERVED_ENTRIES);
    }
    window.localStorage.setItem(PRESERVED_ENTRIES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

// ─── Operational Go-Live Baseline Config (Supabase room_units sentinel + localStorage) ─

export function isValidIsoDate(val?: string | null): val is string {
  return Boolean(val && ISO_DATE_REGEX.test(val.trim()));
}

export function loadLocalFluctuationBaseline(): FluctuationBaselineConfig {
  if (typeof window === 'undefined') return { baselineDate: null };
  try {
    const raw = window.localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return { baselineDate: null };
    const parsed = JSON.parse(raw);
    const baselineDate = isValidIsoDate(parsed?.baselineDate) ? parsed.baselineDate.trim() : null;
    return {
      baselineDate,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : undefined,
      updatedBy: typeof parsed?.updatedBy === 'string' ? parsed.updatedBy : undefined,
    };
  } catch {
    return { baselineDate: null };
  }
}

function saveLocalFluctuationBaseline(cfg: FluctuationBaselineConfig): void {
  cachedBaselineConfig = cfg;
  cachedBaselineFetchedAt = Date.now();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage errors
  }
}

export function invalidateFluctuationBaselineCache(): void {
  cachedBaselineConfig = null;
  cachedBaselineFetchedAt = 0;
}

export async function fetchFluctuationBaselineConfig(
  force = false
): Promise<FluctuationBaselineConfig> {
  if (!force && cachedBaselineConfig && Date.now() - cachedBaselineFetchedAt < BASELINE_CACHE_TTL_MS) {
    return cachedBaselineConfig;
  }
  const local = loadLocalFluctuationBaseline();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('room_units')
      .select('room_label, updated_at')
      .eq('ktx', BASELINE_REMOTE_SENTINEL.ktx)
      .eq('day_nha', BASELINE_REMOTE_SENTINEL.day_nha)
      .eq('phong_so', BASELINE_REMOTE_SENTINEL.phong_so)
      .maybeSingle();

    if (!error) {
      if (!data || !data.room_label) {
        const emptyCfg: FluctuationBaselineConfig = { baselineDate: null };
        saveLocalFluctuationBaseline(emptyCfg);
        return emptyCfg;
      }
      const rawLabel = String(data.room_label).trim();
      if (rawLabel.startsWith('{')) {
        const parsed = JSON.parse(rawLabel);
        const cfg: FluctuationBaselineConfig = {
          baselineDate: isValidIsoDate(parsed?.baselineDate) ? parsed.baselineDate.trim() : null,
          updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : (data.updated_at || undefined),
          updatedBy: typeof parsed?.updatedBy === 'string' ? parsed.updatedBy : undefined,
        };
        saveLocalFluctuationBaseline(cfg);
        return cfg;
      }
      if (isValidIsoDate(rawLabel)) {
        const cfg: FluctuationBaselineConfig = {
          baselineDate: rawLabel,
          updatedAt: data.updated_at || undefined,
        };
        saveLocalFluctuationBaseline(cfg);
        return cfg;
      }
    }
  } catch {
    // fallback to local
  }
  saveLocalFluctuationBaseline(local);
  return local;
}

export function clearPreservedEntriesBeforeDate(beforeDate: string | null): number {
  if (typeof window === 'undefined') return 0;
  try {
    const existing = loadPreservedWorkerEntries();
    if (existing.length === 0) return 0;
    if (!beforeDate) {
      window.localStorage.removeItem(PRESERVED_ENTRIES_STORAGE_KEY);
      return existing.length;
    }
    if (!isValidIsoDate(beforeDate)) return 0;
    const kept = existing.filter(item => {
      const vnDate = getVNDateString(item.created_at);
      return Boolean(vnDate && vnDate >= beforeDate);
    });
    const removedCount = existing.length - kept.length;
    window.localStorage.setItem(PRESERVED_ENTRIES_STORAGE_KEY, JSON.stringify(kept));
    return removedCount;
  } catch {
    return 0;
  }
}

export async function saveFluctuationBaselineConfig(
  baselineDate: string | null,
  actorName?: string
): Promise<{ savedRemote: boolean; config: FluctuationBaselineConfig }> {
  const cleanDate = baselineDate && isValidIsoDate(baselineDate) ? baselineDate.trim() : null;
  const cfg: FluctuationBaselineConfig = {
    baselineDate: cleanDate,
    updatedAt: new Date().toISOString(),
    updatedBy: actorName?.trim() || undefined,
  };

  saveLocalFluctuationBaseline(cfg);
  if (cleanDate) {
    clearPreservedEntriesBeforeDate(cleanDate);
  }

  let savedRemote = false;
  try {
    const supabase = createClient();
    const payload = JSON.stringify(cfg);
    const { data: updated, error: updErr } = await supabase
      .from('room_units')
      .update({
        room_label: payload,
        updated_at: cfg.updatedAt,
      })
      .eq('ktx', BASELINE_REMOTE_SENTINEL.ktx)
      .eq('day_nha', BASELINE_REMOTE_SENTINEL.day_nha)
      .eq('phong_so', BASELINE_REMOTE_SENTINEL.phong_so)
      .select('ktx');

    if (!updErr && updated && updated.length > 0) {
      savedRemote = true;
    } else {
      const { error: upsertErr } = await supabase.from('room_units').upsert(
        {
          ktx: BASELINE_REMOTE_SENTINEL.ktx,
          day_nha: BASELINE_REMOTE_SENTINEL.day_nha,
          phong_so: BASELINE_REMOTE_SENTINEL.phong_so,
          room_label: payload,
        },
        { onConflict: 'ktx,day_nha,phong_so' }
      );
      savedRemote = !upsertErr;
    }
  } catch {
    savedRemote = false;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ktx_fluctuation_baseline_updated', { detail: cfg }));
  }

  return { savedRemote, config: cfg };
}

export async function countFluctuationLogsBeforeDate(beforeDate: string): Promise<{
  exitsCount: number;
  entriesCount: number;
  localCacheCount: number;
}> {
  if (!isValidIsoDate(beforeDate)) {
    return { exitsCount: 0, entriesCount: 0, localCacheCount: 0 };
  }
  const cutoffIso = vnDateStartToUTCISO(beforeDate);
  const localCacheCount = loadPreservedWorkerEntries().filter(item => {
    const d = getVNDateString(item.created_at);
    return Boolean(d && d < beforeDate);
  }).length;

  try {
    const supabase = createClient();
    const [delRes, entRes] = await Promise.all([
      supabase
        .from('worker_deletion_log')
        .select('id', { count: 'exact', head: true })
        .lt('deleted_at', cutoffIso),
      supabase
        .from('worker_entry_log')
        .select('id', { count: 'exact', head: true })
        .lt('entered_at', cutoffIso),
    ]);

    return {
      exitsCount: delRes.error ? 0 : (delRes.count || 0),
      entriesCount: entRes.error ? 0 : (entRes.count || 0),
      localCacheCount,
    };
  } catch {
    return { exitsCount: 0, entriesCount: 0, localCacheCount };
  }
}

export async function purgeFluctuationLogsBeforeDate(beforeDate: string): Promise<{
  ok: boolean;
  rpcMissing?: boolean;
  deletedExits: number;
  deletedEntries: number;
  clearedLocal: number;
  errorMessage?: string;
}> {
  if (!isValidIsoDate(beforeDate)) {
    return {
      ok: false,
      deletedExits: 0,
      deletedEntries: 0,
      clearedLocal: 0,
      errorMessage: 'Ngày cột mốc không hợp lệ.',
    };
  }

  const clearedLocal = clearPreservedEntriesBeforeDate(beforeDate);

  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('purge_fluctuation_logs_before_date', {
      p_before_date: beforeDate,
    });

    if (error) {
      const msg = `${error.message || ''} ${error.details || ''}`.toLowerCase();
      const rpcMissing =
        error.code === 'PGRST202' ||
        msg.includes('could not find the function') ||
        (msg.includes('function') && msg.includes('purge_fluctuation_logs_before_date') && msg.includes('does not exist'));
      return {
        ok: false,
        rpcMissing,
        deletedExits: 0,
        deletedEntries: 0,
        clearedLocal,
        errorMessage: error.message || 'Không thể xóa lịch sử biến động trên máy chủ.',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      ok: true,
      deletedExits: Number(row?.deleted_exits || 0),
      deletedEntries: Number(row?.deleted_entries || 0),
      clearedLocal,
    };
  } catch (err: any) {
    return {
      ok: false,
      deletedExits: 0,
      deletedEntries: 0,
      clearedLocal,
      errorMessage: err?.message || 'Lỗi kết nối khi dọn dữ liệu biến động.',
    };
  }
}

// ─── Pure Aggregation Engine ──────────────────────────────────────────────────

export interface RawWorkerRow {
  id: string;
  ho_va_ten?: string | null;
  ma_nv?: string | null;
  ktx?: string | null;
  day?: string | null;
  created_at?: string | null;
  deleted_at?: string | null;
}

export interface RawDeletionLogRow {
  id: string;
  worker_id?: string | null;
  ho_va_ten?: string | null;
  ma_nv?: string | null;
  ktx?: string | null;
  day?: string | null;
  deleted_at?: string | null;
}

export interface RawEntryLogRow {
  id: string;
  worker_id: string;
  ho_va_ten?: string | null;
  ma_nv?: string | null;
  ktx?: string | null;
  day?: string | null;
  entered_at?: string | null;
}

export function aggregateWorkerFluctuation(
  workerRows: RawWorkerRow[],
  deletionLogRows: RawDeletionLogRow[],
  preservedEntries: PreservedWorkerEntry[],
  filters: FluctuationFilterParams,
  entryLogRows: RawEntryLogRow[] = []
): FluctuationReportResult {
  const filterKtx = (filters.ktx || '').trim();
  const filterDay = (filters.day || '').trim();
  const dateFrom = (filters.dateFrom || '').trim();
  const dateTo = (filters.dateTo || '').trim();
  const effectiveBaseline =
    !filters.ignoreBaseline && isValidIsoDate(filters.baselineDate)
      ? filters.baselineDate.trim()
      : null;
  const is14h = filters.cutoffMode === '14h';
  const todayVN = getVNDateString();

  const ktxSet = new Set<string>();
  const daySet = new Set<string>();

  const collectMeta = (ktxRaw?: string | null, dayRaw?: string | null) => {
    const k = (ktxRaw || '').trim();
    const d = (dayRaw || '').trim();
    if (k) ktxSet.add(k);
    if (d && (!filterKtx || k === filterKtx)) daySet.add(d);
  };

  const matchesScope = (ktxRaw?: string | null, dayRaw?: string | null) => {
    const k = (ktxRaw || '').trim();
    const d = (dayRaw || '').trim();
    if (filterKtx && k !== filterKtx) return false;
    if (filterDay && d !== filterDay) return false;
    return true;
  };

  const passesBaseline = (vnDate: string) => {
    if (!vnDate) return false;
    if (effectiveBaseline && vnDate < effectiveBaseline) return false;
    return true;
  };

  const inDateRange = (vnDate: string) => {
    if (!vnDate) return false;
    if (!passesBaseline(vnDate)) return false;
    if (dateFrom && vnDate < dateFrom) return false;
    if (dateTo && vnDate > dateTo) return false;
    return true;
  };

  const passesCutoff = (ts: string) => {
    if (!is14h) return true;
    return isAtOrBefore14hVN(ts);
  };

  const dayMap = new Map<string, DailyFluctuation>();
  const ensureDay = (ngay: string): DailyFluctuation => {
    let bucket = dayMap.get(ngay);
    if (!bucket) {
      bucket = {
        ngay,
        so_tang: 0,
        so_giam: 0,
        bien_dong_rong: 0,
        entries: [],
        exits: [],
      };
      dayMap.set(ngay, bucket);
    }
    return bucket;
  };

  const todayBucket: DailyFluctuation = {
    ngay: todayVN,
    so_tang: 0,
    so_giam: 0,
    bien_dong_rong: 0,
    entries: [],
    exits: [],
  };

  const seenEntryWorkerIds = new Set<string>();
  const loggedExitWorkerKeys = new Set<string>();

  const recordEntry = (
    id: string,
    createdAt: string | null | undefined,
    hoVaTen: string | null | undefined,
    maNv: string | null | undefined,
    ktx: string | null | undefined,
    day: string | null | undefined
  ) => {
    if (!id || seenEntryWorkerIds.has(id)) return;
    seenEntryWorkerIds.add(id);

    if (!createdAt || !matchesScope(ktx, day) || !passesCutoff(createdAt)) return;
    const ngay = getVNDateString(createdAt);
    if (!ngay || !passesBaseline(ngay)) return;

    const person: FluctuationPerson = {
      id,
      ho_va_ten: (hoVaTen || '').trim() || 'Chưa rõ tên',
      ma_nv: (maNv || '').trim() || '—',
      ktx: (ktx || '').trim(),
      day: (day || '').trim(),
      timestamp: createdAt,
      time_vn: getVNTimeString(createdAt),
      direction: 'in',
    };

    if (ngay === todayVN) {
      todayBucket.so_tang += 1;
      todayBucket.entries.push(person);
    }

    if (inDateRange(ngay)) {
      const bucket = ensureDay(ngay);
      bucket.so_tang += 1;
      bucket.entries.push(person);
    }
  };

  const recordExit = (
    uniqueLogId: string,
    workerId: string | null | undefined,
    deletedAt: string | null | undefined,
    hoVaTen: string | null | undefined,
    maNv: string | null | undefined,
    ktx: string | null | undefined,
    day: string | null | undefined
  ) => {
    if (!deletedAt) return;
    const ngay = getVNDateString(deletedAt);
    if (!ngay || !passesBaseline(ngay)) return;
    if (workerId) {
      loggedExitWorkerKeys.add(`${workerId}::${ngay}`);
    }
    if (!matchesScope(ktx, day) || !passesCutoff(deletedAt)) return;

    const person: FluctuationPerson = {
      id: uniqueLogId,
      ho_va_ten: (hoVaTen || '').trim() || 'Chưa rõ tên',
      ma_nv: (maNv || '').trim() || '—',
      ktx: (ktx || '').trim(),
      day: (day || '').trim(),
      timestamp: deletedAt,
      time_vn: getVNTimeString(deletedAt),
      direction: 'out',
    };

    if (ngay === todayVN) {
      todayBucket.so_giam += 1;
      todayBucket.exits.push(person);
    }

    if (inDateRange(ngay)) {
      const bucket = ensureDay(ngay);
      bucket.so_giam += 1;
      bucket.exits.push(person);
    }
  };

  // 1. Active workers (entries + metadata)
  for (const w of workerRows) {
    collectMeta(w.ktx, w.day);
    recordEntry(w.id, w.created_at, w.ho_va_ten, w.ma_nv, w.ktx, w.day);
  }

  // 2. Authoritative server-side entry log (preserves multi-device "Vào" even after deletions)
  for (const e of entryLogRows) {
    collectMeta(e.ktx, e.day);
    recordEntry(e.worker_id, e.entered_at, e.ho_va_ten, e.ma_nv, e.ktx, e.day);
  }

  // 3. Browser-local preserved entries fallback (when worker_entry_log migration isn't yet applied)
  for (const p of preservedEntries) {
    collectMeta(p.ktx, p.day);
    recordEntry(p.id, p.created_at, p.ho_va_ten, p.ma_nv, p.ktx, p.day);
  }

  // 3. Deletion logs (exits)
  const seenLogIds = new Set<string>();
  for (const log of deletionLogRows) {
    if (!log?.id || seenLogIds.has(log.id)) continue;
    seenLogIds.add(log.id);
    collectMeta(log.ktx, log.day);
    recordExit(
      log.id,
      log.worker_id,
      log.deleted_at,
      log.ho_va_ten,
      log.ma_nv,
      log.ktx,
      log.day
    );
  }

  // 4. Fallback: any soft-deleted workers whose deletion wasn't logged in worker_deletion_log
  for (const w of workerRows) {
    if (!w.deleted_at) continue;
    const ngay = getVNDateString(w.deleted_at);
    if (!ngay) continue;
    if (loggedExitWorkerKeys.has(`${w.id}::${ngay}`)) continue;
    recordExit(
      `soft-${w.id}`,
      w.id,
      w.deleted_at,
      w.ho_va_ten,
      w.ma_nv,
      w.ktx,
      w.day
    );
  }

  // Finalize net calculations & sorting
  todayBucket.bien_dong_rong = todayBucket.so_tang - todayBucket.so_giam;
  todayBucket.entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  todayBucket.exits.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const daily = Array.from(dayMap.values())
    .map(d => {
      d.entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      d.exits.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return {
        ...d,
        bien_dong_rong: d.so_tang - d.so_giam,
      };
    })
    .sort((a, b) => a.ngay.localeCompare(b.ngay));

  let tong_tang = 0;
  let tong_giam = 0;
  let so_ngay_co_bien_dong = 0;
  for (const d of daily) {
    tong_tang += d.so_tang;
    tong_giam += d.so_giam;
    if (d.so_tang > 0 || d.so_giam > 0) {
      so_ngay_co_bien_dong += 1;
    }
  }

  return {
    daily,
    summary: {
      tong_tang,
      tong_giam,
      bien_dong_rong: tong_tang - tong_giam,
      so_ngay_co_bien_dong,
    },
    today: todayBucket,
    availableKtx: Array.from(ktxSet).sort(compareKtxNames),
    availableDays: Array.from(daySet).sort(compareKtxNames),
    appliedBaselineDate: effectiveBaseline,
  };
}

// ─── Supabase Paginated Fetchers ──────────────────────────────────────────────

async function fetchAllWorkerEntries(): Promise<RawWorkerRow[]> {
  const supabase = createClient();
  const rows: RawWorkerRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('workers')
      .select('id, ho_va_ten, ma_nv, ktx, day, created_at, deleted_at')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Lỗi tải bảng workers: ${error.message}`);
    const batch = (data || []) as RawWorkerRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchDeletionLogsInRange(
  dateFrom?: string,
  dateTo?: string
): Promise<RawDeletionLogRow[]> {
  const supabase = createClient();
  const todayVN = getVNDateString();
  const rows: RawDeletionLogRow[] = [];
  let from = 0;

  // Ensure today's logs are included when computing today's live summary
  const effectiveFrom = dateFrom && dateFrom > todayVN ? todayVN : dateFrom;
  const effectiveTo = dateTo && dateTo < todayVN ? todayVN : dateTo;

  while (true) {
    let query = supabase
      .from('worker_deletion_log')
      .select('id, worker_id, ho_va_ten, ma_nv, ktx, day, deleted_at')
      .order('deleted_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (effectiveFrom) {
      query = query.gte('deleted_at', vnDateStartToUTCISO(effectiveFrom));
    }
    if (effectiveTo) {
      query = query.lte('deleted_at', vnDateEndToUTCISO(effectiveTo));
    }

    const { data, error } = await query;
    if (error) throw new Error(`Lỗi tải bảng worker_deletion_log: ${error.message}`);
    const batch = (data || []) as RawDeletionLogRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchEntryLogsInRange(
  dateFrom?: string,
  dateTo?: string
): Promise<RawEntryLogRow[]> {
  try {
    const supabase = createClient();
    const todayVN = getVNDateString();
    const rows: RawEntryLogRow[] = [];
    let from = 0;

    const effectiveFrom = dateFrom && dateFrom > todayVN ? todayVN : dateFrom;
    const effectiveTo = dateTo && dateTo < todayVN ? todayVN : dateTo;

    while (true) {
      let query = supabase
        .from('worker_entry_log')
        .select('id, worker_id, ho_va_ten, ma_nv, ktx, day, entered_at')
        .order('entered_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (effectiveFrom) {
        query = query.gte('entered_at', vnDateStartToUTCISO(effectiveFrom));
      }
      if (effectiveTo) {
        query = query.lte('entered_at', vnDateEndToUTCISO(effectiveTo));
      }

      const { data, error } = await query;
      if (error) {
        console.warn('[workerFluctuation] worker_entry_log unavailable, using fallback:', error.message);
        return [];
      }
      const batch = (data || []) as RawEntryLogRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return rows;
  } catch {
    return [];
  }
}

export async function fetchWorkerFluctuationReport(
  filters: FluctuationFilterParams
): Promise<FluctuationReportResult> {
  const resolvedBaseline = filters.ignoreBaseline
    ? null
    : filters.baselineDate !== undefined
      ? (isValidIsoDate(filters.baselineDate) ? filters.baselineDate.trim() : null)
      : (await fetchFluctuationBaselineConfig()).baselineDate;

  const queryFrom =
    resolvedBaseline && (!filters.dateFrom || filters.dateFrom < resolvedBaseline)
      ? resolvedBaseline
      : filters.dateFrom;

  const [workerRows, deletionLogRows, entryLogRows] = await Promise.all([
    filters.preloadedWorkerRows
      ? Promise.resolve(filters.preloadedWorkerRows)
      : fetchAllWorkerEntries(),
    fetchDeletionLogsInRange(queryFrom, filters.dateTo),
    fetchEntryLogsInRange(queryFrom, filters.dateTo),
  ]);

  const preservedEntries = loadPreservedWorkerEntries();
  return aggregateWorkerFluctuation(
    workerRows,
    deletionLogRows,
    preservedEntries,
    {
      ...filters,
      baselineDate: resolvedBaseline,
    },
    entryLogRows
  );
}
