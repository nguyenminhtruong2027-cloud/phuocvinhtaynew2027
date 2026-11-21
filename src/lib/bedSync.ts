import { SupabaseClient } from '@supabase/supabase-js';
import type { Worker } from '@/data/workers';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';

export function normalizeBedLabel(raw?: string | null): string {
  if (!raw) return '';
  let cleaned = String(raw).normalize('NFC').trim();
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:giường|giuong|g[.\s]*)\s*/i, '').trim();
  }
  if (/^\d+$/.test(cleaned)) {
    return String(parseInt(cleaned, 10));
  }
  return cleaned.toLowerCase();
}

export function normalizeKtxCompact(raw?: string | null): string {
  if (!raw) return '';
  return String(raw).normalize('NFC').replace(/[\s\-_.]+/g, '').toLowerCase();
}

export function normalizeDayKey(raw?: string | null): string {
  if (!raw) return '';
  let cleaned = String(raw).normalize('NFC').trim();
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:dãy|day|khu|block|d[.\s]*)\s*/i, '').trim();
  }
  if (/^\d+$/.test(cleaned)) {
    return String(parseInt(cleaned, 10));
  }
  return cleaned.toLowerCase();
}

export function buildCanonicalBedKey(
  ktx?: string | null,
  day?: string | null,
  phongSo?: string | null,
  giuong?: string | null
): string {
  return `${normalizeKtxCompact(ktx)}||${normalizeDayKey(day)}||${normalizeRoomLabel(String(phongSo || ''))}||${normalizeBedLabel(giuong)}`;
}

export interface CanonicalBedLike {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: string;
  worker_id?: string | null;
}

function bedRowPriority(row: CanonicalBedLike): number {
  let score = 0;
  if (row.status === 'occupied') score += 100;
  else if (row.status === 'maintenance') score += 60;
  if (row.worker_id && String(row.worker_id).trim()) score += 30;
  const canonBed = normalizeBedLabel(row.giuong);
  const canonRoom = normalizeRoomLabel(row.phong_so);
  if (canonBed && String(row.giuong || '').trim() === canonBed) score += 10;
  if (canonRoom && String(row.phong_so || '').trim() === canonRoom) score += 5;
  return score;
}

/**
 * Deduplicates bed rows sharing the same canonical (ktx, day, phong_so, giuong) slot.
 * Always keeps the authoritative row (occupied > maintenance > worker-linked > canonical format).
 */
export function deduplicateBedRows<T extends CanonicalBedLike>(
  rows: T[]
): { kept: T[]; duplicateRows: T[] } {
  const byKey = new Map<string, T>();
  const duplicateRows: T[] = [];

  for (const row of rows) {
    const key = buildCanonicalBedKey(row.ktx, row.day, row.phong_so, row.giuong);
    if (!key || key === '||||||') {
      byKey.set(`__raw__${row.id}`, row);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    if (bedRowPriority(row) > bedRowPriority(existing)) {
      duplicateRows.push(existing);
      byKey.set(key, row);
    } else {
      duplicateRows.push(row);
    }
  }

  return { kept: Array.from(byKey.values()), duplicateRows };
}

const BED_PAGE_SIZE = 1000;

interface BedSyncRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: string;
  worker_id: string | null;
  ma_nv: string | null;
  ho_va_ten: string | null;
}

interface WorkerSyncRow {
  id: string;
  ho_va_ten: string | null;
  ma_nv: string | null;
  ktx: string | null;
  day: string | null;
  phong_so: string | null;
  giuong: string | null;
}

/**
 * Releases any beds currently occupied by the given worker IDs back to `empty`.
 * Leaves `maintenance` beds untouched unless they were explicitly linked to that worker.
 */
export async function releaseBedsForWorkers(
  supabase: SupabaseClient,
  workerIds: string[]
): Promise<number> {
  const cleanIds = Array.from(new Set(workerIds.map(id => String(id || '').trim()).filter(Boolean)));
  if (cleanIds.length === 0) return 0;

  let released = 0;
  const CHUNK = 200;
  for (let i = 0; i < cleanIds.length; i += CHUNK) {
    const chunk = cleanIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('beds')
      .update({
        status: 'empty',
        worker_id: null,
        ma_nv: null,
        ho_va_ten: null,
      })
      .in('worker_id', chunk)
      .select('id');

    if (error) {
      console.warn('[bedSync] releaseBedsForWorkers error:', error.message);
    } else if (Array.isArray(data)) {
      released += data.length;
    }
  }
  return released;
}

/**
 * Releases beds matching workerIds and/or a normalized (ktx, day, phongSo, giuong) slot.
 * Throws if Supabase explicitly rejects the update so callers never silently report false success.
 */
export async function releaseBedByLocation(
  supabase: SupabaseClient,
  params: {
    workerIds?: string[];
    ktx?: string | null;
    day?: string | null;
    phongSo?: string | null;
    giuong?: string | null;
    bedId?: string | null;
  }
): Promise<{ releasedIds: string[] }> {
  const releasedSet = new Set<string>();
  const cleanWorkerIds = Array.from(
    new Set((params.workerIds || []).map(id => String(id || '').trim()).filter(Boolean))
  );

  // 1. Release any bed linked directly by worker_id
  if (cleanWorkerIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < cleanWorkerIds.length; i += CHUNK) {
      const chunk = cleanWorkerIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('beds')
        .update({
          status: 'empty',
          worker_id: null,
          ma_nv: null,
          ho_va_ten: null,
        })
        .in('worker_id', chunk)
        .select('id');

      if (error) {
        throw new Error(`Không thể giải phóng giường theo mã công nhân: ${error.message}`);
      }
      (data || []).forEach((row: any) => {
        if (row?.id) releasedSet.add(String(row.id));
      });
    }
  }

  // 2. Release specific bed row if bedId is known
  if (params.bedId && params.bedId.trim()) {
    const { data, error } = await supabase
      .from('beds')
      .update({
        status: 'empty',
        worker_id: null,
        ma_nv: null,
        ho_va_ten: null,
      })
      .eq('id', params.bedId.trim())
      .select('id');

    if (error) {
      throw new Error(`Không thể giải phóng giường ${params.bedId}: ${error.message}`);
    }
    (data || []).forEach((row: any) => {
      if (row?.id) releasedSet.add(String(row.id));
    });
  }

  // 3. Fallback: release by normalized KTX + Dãy + Phòng + Giường
  const ktx = (params.ktx || '').trim();
  const normDay = normalizeDayKey(params.day || '');
  const normRoom = normalizeRoomLabel(params.phongSo || '');
  const normBed = normalizeBedLabel(params.giuong || '');

  if (ktx && normRoom && normBed) {
    const { data: candidateBeds, error: queryErr } = await supabase
      .from('beds')
      .select('id, day, phong_so, giuong, status')
      .ilike('ktx', ktx)
      .neq('status', 'maintenance');

    if (queryErr) {
      throw new Error(`Không thể kiểm tra giường tại ${ktx}${params.day ? ` · ${params.day}` : ''}: ${queryErr.message}`);
    }

    const slotIds = (candidateBeds || [])
      .filter(
        (b: any) =>
          !releasedSet.has(String(b?.id)) &&
          b?.status === 'occupied' &&
          (!normDay || !b?.day || normalizeDayKey(String(b.day)) === normDay) &&
          normalizeRoomLabel(String(b?.phong_so ?? '')) === normRoom &&
          normalizeBedLabel(String(b?.giuong ?? '')) === normBed
      )
      .map((b: any) => String(b.id));

    if (slotIds.length > 0) {
      const { data: updatedRows, error: slotErr } = await supabase
        .from('beds')
        .update({
          status: 'empty',
          worker_id: null,
          ma_nv: null,
          ho_va_ten: null,
        })
        .in('id', slotIds)
        .select('id');

      if (slotErr) {
        throw new Error(`Không thể cập nhật trạng thái trống cho giường: ${slotErr.message}`);
      }
      (updatedRows || []).forEach((row: any) => {
        if (row?.id) releasedSet.add(String(row.id));
      });
    }
  }

  return { releasedIds: Array.from(releasedSet) };
}

/**
 * Releases all occupied beds back to `empty` (preserves `maintenance` beds).
 */
export async function releaseAllOccupiedBeds(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase
      .from('beds')
      .update({
        status: 'empty',
        worker_id: null,
        ma_nv: null,
        ho_va_ten: null,
      })
      .eq('status', 'occupied');

    await supabase
      .from('beds')
      .update({
        status: 'empty',
        worker_id: null,
        ma_nv: null,
        ho_va_ten: null,
      })
      .not('worker_id', 'is', null)
      .neq('status', 'maintenance');
  } catch (err) {
    console.warn('[bedSync] releaseAllOccupiedBeds warning:', err);
  }
}

/**
 * Keeps the `beds` table synchronized when a worker is added or updated.
 * - If room/bed assignment changed (or was cleared), releases the previous bed held by `worker.id`.
 * - If `newWorker` has KTX + Dãy + Phòng + Giường, assigns the matching bed if available.
 */
export async function syncBedForWorkerSave(
  supabase: SupabaseClient,
  oldWorker: Worker | undefined,
  newWorker: Worker
): Promise<void> {
  if (!newWorker?.id) return;

  const newKtx = (newWorker.ktx || '').trim();
  const newDay = (newWorker.day || '').trim();
  const newRoom = normalizeRoomLabel(newWorker.phongSo || '');
  const newBed = normalizeBedLabel(newWorker.giuong || '');

  const oldKtx = (oldWorker?.ktx || '').trim();
  const oldDay = (oldWorker?.day || '').trim();
  const oldRoom = normalizeRoomLabel(oldWorker?.phongSo || '');
  const oldBed = normalizeBedLabel(oldWorker?.giuong || '');

  const locationChanged =
    !oldWorker ||
    oldKtx !== newKtx ||
    oldDay !== newDay ||
    oldRoom !== newRoom ||
    oldBed !== newBed;

  const infoChanged =
    !oldWorker ||
    (oldWorker.hoVaTen || '') !== (newWorker.hoVaTen || '') ||
    (oldWorker.maNV || '') !== (newWorker.maNV || '');

  try {
    if (locationChanged) {
      // Clear any previous bed assigned to this worker
      await releaseBedsForWorkers(supabase, [newWorker.id]);
    }

    if (newKtx && newDay && newRoom && newBed) {
      const { data: candidateBeds, error } = await supabase
        .from('beds')
        .select('id, ktx, day, phong_so, giuong, status, worker_id')
        .eq('ktx', newKtx)
        .eq('day', newDay);

      if (!error && Array.isArray(candidateBeds)) {
        const match = candidateBeds.find(
          (b: any) =>
            normalizeRoomLabel(String(b?.phong_so ?? '')) === newRoom &&
            normalizeBedLabel(String(b?.giuong ?? '')) === newBed
        );

        if (
          match &&
          match.status !== 'maintenance' &&
          (!match.worker_id || match.worker_id === newWorker.id || match.status === 'empty')
        ) {
          if (locationChanged || infoChanged || match.worker_id !== newWorker.id || match.status !== 'occupied') {
            await supabase
              .from('beds')
              .update({
                status: 'occupied',
                worker_id: newWorker.id,
                ma_nv: newWorker.maNV || null,
                ho_va_ten: newWorker.hoVaTen || null,
              })
              .eq('id', match.id);
          }
        }
      }
    } else if (infoChanged && !locationChanged) {
      await supabase
        .from('beds')
        .update({
          ma_nv: newWorker.maNV || null,
          ho_va_ten: newWorker.hoVaTen || null,
        })
        .eq('worker_id', newWorker.id);
    }
  } catch (err) {
    console.warn('[bedSync] syncBedForWorkerSave warning:', err);
  }
}

/**
 * Full 2-way reconciliation between `beds` and `workers`:
 * 1. Releases `occupied` (or worker-linked) beds whose worker no longer exists, moved room/KTX, or changed bed.
 * 2. Syncs `ma_nv` / `ho_va_ten` for valid occupied beds when out of date.
 * 3. Assigns `empty` beds to workers who explicitly specify `ktx + day + phong_so + giuong` without a linked bed.
 */
export interface ReconcileBedsOptions {
  isAdmin?: boolean;
  canWriteBlock?: (day: string, ktx?: string) => boolean;
}

export async function reconcileBedsWithWorkers(
  supabase: SupabaseClient,
  options?: ReconcileBedsOptions
): Promise<{
  releasedCount: number;
  assignedCount: number;
  updatedInfoCount: number;
  deduplicatedCount: number;
}> {
  const canTouch = (ktx: string, day: string) => {
    if (!options || options.isAdmin !== false || !options.canWriteBlock) return true;
    if (!day.trim()) return true;
    return options.canWriteBlock(day, ktx);
  };

  const bedsById = new Map<string, BedSyncRow>();
  let from = 0;
  for (let p = 0; p < 30; p++) {
    const { data, error } = await supabase
      .from('beds')
      .select('id, ktx, day, phong_so, giuong, status, worker_id, ma_nv, ho_va_ten')
      .order('id', { ascending: true })
      .range(from, from + BED_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const list = (data ?? []) as BedSyncRow[];
    for (const b of list) {
      if (b?.id) bedsById.set(b.id, b);
    }
    if (list.length < BED_PAGE_SIZE) break;
    from += BED_PAGE_SIZE;
  }

  // Pass 0: Detect & permanently delete duplicate bed rows sharing the same canonical slot
  const { kept: dedupedBeds, duplicateRows } = deduplicateBedRows(Array.from(bedsById.values()));
  const duplicateIdsToDelete = duplicateRows
    .filter(b => canTouch(b.ktx || '', b.day || ''))
    .map(b => b.id);

  let deduplicatedCount = 0;
  const DEDUP_CHUNK = 200;
  for (let i = 0; i < duplicateIdsToDelete.length; i += DEDUP_CHUNK) {
    const chunk = duplicateIdsToDelete.slice(i, i + DEDUP_CHUNK);
    const { error: delErr } = await supabase.from('beds').delete().in('id', chunk);
    if (delErr) {
      console.warn('[bedSync] duplicate bed delete warning:', delErr.message);
    } else {
      deduplicatedCount += chunk.length;
    }
  }
  const allBeds = dedupedBeds;

  const workersById = new Map<string, WorkerSyncRow>();
  from = 0;
  for (let p = 0; p < 30; p++) {
    const { data, error } = await supabase
      .from('workers')
      .select('id, ho_va_ten, ma_nv, ktx, day, phong_so, giuong')
      .order('id', { ascending: true })
      .range(from, from + BED_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const list = (data ?? []) as WorkerSyncRow[];
    for (const w of list) {
      if (w?.id) workersById.set(w.id, w);
    }
    if (list.length < BED_PAGE_SIZE) break;
    from += BED_PAGE_SIZE;
  }
  const allWorkers = Array.from(workersById.values());

  const workerById = new Map<string, WorkerSyncRow>();
  allWorkers.forEach(w => {
    if (w?.id) workerById.set(w.id, w);
  });

  const idsToRelease: string[] = [];
  const validLinkedWorkers = new Set<string>();
  const infoUpdates: Array<{ bedId: string; ma_nv: string | null; ho_va_ten: string | null }> = [];
  const bedStatusAfterPass1 = new Map<string, 'empty' | 'occupied' | 'maintenance'>();

  for (const bed of allBeds) {
    if (bed.status === 'maintenance') {
      bedStatusAfterPass1.set(bed.id, 'maintenance');
      continue;
    }

    const isOccupiedOrLinked = bed.status === 'occupied' || Boolean(bed.worker_id);
    if (!isOccupiedOrLinked) {
      bedStatusAfterPass1.set(bed.id, 'empty');
      continue;
    }

    const bKtx = (bed.ktx || '').trim();
    const bDay = (bed.day || '').trim();
    const w = bed.worker_id ? workerById.get(bed.worker_id) : undefined;
    if (!w) {
      if (canTouch(bKtx, bDay)) {
        idsToRelease.push(bed.id);
      }
      bedStatusAfterPass1.set(bed.id, 'empty');
      continue;
    }

    const wKtx = (w.ktx || '').trim().toLowerCase();
    const wDay = normalizeDayKey(w.day || '');
    const wRoom = normalizeRoomLabel(w.phong_so || '');
    const wBed = normalizeBedLabel(w.giuong || '');

    const bRoom = normalizeRoomLabel(bed.phong_so || '');
    const bBed = normalizeBedLabel(bed.giuong || '');
    const normBDay = normalizeDayKey(bDay);

    const sameRoom = Boolean(wKtx && wDay && wRoom && wKtx === bKtx.toLowerCase() && wDay === normBDay && wRoom === bRoom);
    const sameBed = !wBed || wBed === bBed;

    if (!sameRoom || !sameBed || validLinkedWorkers.has(w.id)) {
      if (canTouch(bKtx, bDay)) {
        idsToRelease.push(bed.id);
      }
      bedStatusAfterPass1.set(bed.id, 'empty');
      continue;
    }

    validLinkedWorkers.add(w.id);
    bedStatusAfterPass1.set(bed.id, 'occupied');

    const expectedName = w.ho_va_ten || null;
    const expectedMaNv = w.ma_nv || null;
    if (canTouch(bKtx, bDay) && (bed.status !== 'occupied' || bed.ho_va_ten !== expectedName || bed.ma_nv !== expectedMaNv)) {
      infoUpdates.push({
        bedId: bed.id,
        ho_va_ten: expectedName,
        ma_nv: expectedMaNv,
      });
    }
  }

  // Pass 1 execution: release stale beds in batches
  const CHUNK = 200;
  for (let i = 0; i < idsToRelease.length; i += CHUNK) {
    const chunk = idsToRelease.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('beds')
      .update({
        status: 'empty',
        worker_id: null,
        ma_nv: null,
        ho_va_ten: null,
      })
      .in('id', chunk);
    if (error) throw new Error(error.message);
  }

  // Pass 2: link unlinked workers who have explicit ktx + day + phong_so + giuong to empty beds
  const emptyBedIndex = new Map<string, BedSyncRow>();
  for (const bed of allBeds) {
    if (bedStatusAfterPass1.get(bed.id) === 'empty') {
      const key = buildCanonicalBedKey(bed.ktx, bed.day, bed.phong_so, bed.giuong);
      if (!emptyBedIndex.has(key)) {
        emptyBedIndex.set(key, bed);
      }
    }
  }

  const assignments: Array<{ bedId: string; worker: WorkerSyncRow }> = [];
  for (const w of allWorkers) {
    if (!w?.id || validLinkedWorkers.has(w.id)) continue;
    const wKtx = (w.ktx || '').trim();
    const wDay = (w.day || '').trim();
    const wDayNorm = normalizeDayKey(wDay);
    const wRoom = normalizeRoomLabel(w.phong_so || '');
    const wBed = normalizeBedLabel(w.giuong || '');
    if (!wKtx || !wDayNorm || !wRoom || !wBed) continue;

    const key = buildCanonicalBedKey(wKtx, wDay, wRoom, wBed);
    const targetBed = emptyBedIndex.get(key);
    if (targetBed && canTouch(targetBed.ktx || wKtx, targetBed.day || wDay)) {
      emptyBedIndex.delete(key);
      validLinkedWorkers.add(w.id);
      assignments.push({ bedId: targetBed.id, worker: w });
    }
  }

  // Execute info updates & assignments in parallel batches to avoid N+1 serial latency
  const UPDATE_CONCURRENCY = 20;
  for (let i = 0; i < infoUpdates.length; i += UPDATE_CONCURRENCY) {
    const batch = infoUpdates.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      batch.map(async (u) => {
        const { error } = await supabase
          .from('beds')
          .update({
            status: 'occupied',
            ma_nv: u.ma_nv,
            ho_va_ten: u.ho_va_ten,
          })
          .eq('id', u.bedId);
        if (error) console.warn('[bedSync] info update warning:', error.message);
      })
    );
  }

  for (let i = 0; i < assignments.length; i += UPDATE_CONCURRENCY) {
    const batch = assignments.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      batch.map(async (a) => {
        const { error } = await supabase
          .from('beds')
          .update({
            status: 'occupied',
            worker_id: a.worker.id,
            ma_nv: a.worker.ma_nv || null,
            ho_va_ten: a.worker.ho_va_ten || null,
          })
          .eq('id', a.bedId);
        if (error) console.warn('[bedSync] assign update warning:', error.message);
      })
    );
  }

  return {
    releasedCount: idsToRelease.length,
    assignedCount: assignments.length,
    updatedInfoCount: infoUpdates.length,
    deduplicatedCount,
  };
}

/**
 * Keeps the `beds` table synchronized when a facility room is created, updated,
 * toggled between accommodation/functional, or toggled visible/hidden.
 * - Accommodation + visible + giuong > 0: ensures beds `1..giuong` exist, deduplicates
 *   duplicate formatted rows for the same bed number, and deletes extra `empty` beds > `giuong`.
 * - Functional or hidden: cleans up any `empty` beds in that room (never deletes occupied/maintenance beds).
 */
export async function syncBedsForFacilityRoom(
  supabase: SupabaseClient,
  room: {
    ktx: string;
    day: string;
    phong_khu_vuc: string;
    giuong: number;
    room_type?: 'accommodation' | 'functional';
    is_visible?: boolean;
  }
): Promise<{ created: number; removed: number }> {
  const ktx = (room.ktx || '').trim();
  const day = (room.day || '').trim();
  const rawRoom = (room.phong_khu_vuc || '').trim();
  if (!ktx || !day || !rawRoom) return { created: 0, removed: 0 };

  const normTarget = normalizeRoomLabel(rawRoom);
  const roomKey = normTarget || rawRoom;
  const targetCap =
    room.room_type === 'functional' || room.is_visible === false
      ? 0
      : Math.max(0, Math.min(200, Math.floor(Number(room.giuong) || 0)));

  try {
    const { data: existingBeds, error } = await supabase
      .from('beds')
      .select('id, ktx, day, phong_so, giuong, status, worker_id')
      .eq('ktx', ktx)
      .eq('day', day);

    if (error || !Array.isArray(existingBeds)) {
      return { created: 0, removed: 0 };
    }

    const roomBeds = (existingBeds as CanonicalBedLike[]).filter(
      b => normalizeRoomLabel(String(b?.phong_so ?? '')) === normTarget
    );

    const { kept: uniqueRoomBeds, duplicateRows } = deduplicateBedRows(roomBeds);
    const existingBedNums = new Set<number>();
    const idsToRemove: string[] = [];

    // Delete any duplicate formatted rows for the same bed number (e.g. 'G1' alongside '1')
    for (const dup of duplicateRows) {
      if (dup.status === 'empty' || !dup.worker_id) {
        idsToRemove.push(String(dup.id));
      }
    }

    for (const b of uniqueRoomBeds) {
      const bedNum = parseInt(normalizeBedLabel(String(b?.giuong ?? '')), 10);
      if (!isNaN(bedNum) && bedNum > 0) {
        existingBedNums.add(bedNum);
        if (b.status === 'empty' && bedNum > targetCap) {
          idsToRemove.push(String(b.id));
        }
      } else if (targetCap === 0 && b.status === 'empty') {
        idsToRemove.push(String(b.id));
      }
    }

    let removed = 0;
    if (idsToRemove.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < idsToRemove.length; i += CHUNK) {
        const chunk = idsToRemove.slice(i, i + CHUNK);
        const { error: delErr } = await supabase.from('beds').delete().in('id', chunk);
        if (!delErr) removed += chunk.length;
      }
    }

    let created = 0;
    if (targetCap > 0) {
      const toInsert: Array<{ ktx: string; day: string; phong_so: string; giuong: string; status: string }> = [];
      for (let n = 1; n <= targetCap; n++) {
        if (!existingBedNums.has(n)) {
          toInsert.push({
            ktx,
            day,
            phong_so: roomKey,
            giuong: String(n),
            status: 'empty',
          });
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('beds')
          .upsert(toInsert, { onConflict: 'ktx,day,phong_so,giuong', ignoreDuplicates: true });
        if (!insErr) created = toInsert.length;
      }
    }

    return { created, removed };
  } catch (err) {
    console.warn('[bedSync] syncBedsForFacilityRoom warning:', err);
    return { created: 0, removed: 0 };
  }
}

