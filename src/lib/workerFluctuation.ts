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
}

export interface FluctuationReportResult {
  daily: DailyFluctuation[]; // sorted ascending by ngay
  summary: FluctuationSummary;
  today: DailyFluctuation;
  availableKtx: string[];
  availableDays: string[];
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
const MAX_PRESERVED_ENTRIES = 5000;
const PAGE_SIZE = 1000;

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

export function aggregateWorkerFluctuation(
  workerRows: RawWorkerRow[],
  deletionLogRows: RawDeletionLogRow[],
  preservedEntries: PreservedWorkerEntry[],
  filters: FluctuationFilterParams
): FluctuationReportResult {
  const filterKtx = (filters.ktx || '').trim();
  const filterDay = (filters.day || '').trim();
  const dateFrom = (filters.dateFrom || '').trim();
  const dateTo = (filters.dateTo || '').trim();
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

  const inDateRange = (vnDate: string) => {
    if (!vnDate) return false;
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
    if (!ngay) return;

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
    if (!ngay) return;
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

  // 2. Preserved entries of workers deleted in this browser so "Vào" stays accurate
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

export async function fetchWorkerFluctuationReport(
  filters: FluctuationFilterParams
): Promise<FluctuationReportResult> {
  const [workerRows, deletionLogRows] = await Promise.all([
    fetchAllWorkerEntries(),
    fetchDeletionLogsInRange(filters.dateFrom, filters.dateTo),
  ]);

  const preservedEntries = loadPreservedWorkerEntries();
  return aggregateWorkerFluctuation(
    workerRows,
    deletionLogRows,
    preservedEntries,
    filters
  );
}
