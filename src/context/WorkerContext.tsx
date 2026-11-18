'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Worker } from '@/data/workers';
import { createClient } from '@/lib/supabase/client';
import { preserveDeletedWorkerEntries } from '@/lib/workerFluctuation';
import {
  reconcileBedsWithWorkers,
  releaseAllOccupiedBeds,
  releaseBedsForWorkers,
  syncBedForWorkerSave,
} from '@/lib/bedSync';
import { useAuth } from '@/context/AuthContext';

const PUBLIC_PATHS = ['/sign-up-login', '/login', '/register', '/checkout', '/attendance'];

// ─── DB row ↔ Worker mapping ───────────────────────────────────────────────

function generateWorkerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dbRowToWorker(row: Record<string, unknown>): Worker {
  return {
    id: String(row.id ?? ''),
    stt: Number(row.stt ?? 0),
    hoVaTen: String(row.full_name ?? row.ho_va_ten ?? ''),
    maNV: String(row.worker_code ?? row.ma_nv ?? ''),
    tieuDoan: String(row.battalion ?? row.tieu_doan ?? ''),
    ktx: String(row.ktx ?? ''),
    donVi: String(row.company ?? row.unit ?? row.don_vi ?? ''),
    gioiTinh: String(row.gender ?? row.gioi_tinh ?? ''),
    ngaySinh: String(row.birth_date ?? row.ngay_sinh ?? row.date_of_birth ?? row.dob ?? ''),
    soDienThoai: String(row.phone ?? row.so_dien_thoai ?? ''),
    day: String(row.ktx_block_id ?? row.day ?? ''),
    phongSo: String(row.phong_so ?? ''),
    giuong: String(row.bed_id ?? row.giuong ?? ''),
    cccd: String(row.id_card ?? row.cccd ?? ''),
    hoKhauTinh: String(row.hometown ?? row.ho_khau_tinh ?? ''),
    toTruong: String(row.team_leader ?? row.to_truong ?? ''),
    sdtToTruong: String(row.team_leader_phone ?? row.sdt_to_truong ?? ''),
    ngayVaoKTX: String(row.ktx_join_date ?? row.ngay_vao_ktx ?? ''),
    ngayRaKTX: row.ngay_ra_ktx ? String(row.ngay_ra_ktx) : undefined,
    ghiChu: String(row.notes ?? row.ghi_chu ?? ''),
    khoaTraCuu: String(row.khoa_tra_cuu ?? ''),
    avatar: row.avatar ? String(row.avatar) : undefined,
    tamTruStatus: (row.status ?? row.tam_tru_status ?? 'unregistered') as 'registered' | 'unregistered',
    createdAt: row.created_at ? String(row.created_at) : undefined,
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
  };
}

function workerToDbRow(w: Worker): Record<string, unknown> {
  const row: Record<string, unknown> = {
    stt: w.stt,
    ho_va_ten: w.hoVaTen,
    ma_nv: w.maNV,
    tieu_doan: w.tieuDoan,
    ktx: w.ktx,
    don_vi: w.donVi,
    gioi_tinh: w.gioiTinh,
    ngay_sinh: w.ngaySinh,
    so_dien_thoai: w.soDienThoai,
    day: w.day,
    phong_so: w.phongSo,
    giuong: w.giuong ?? '',
    cccd: w.cccd,
    ho_khau_tinh: w.hoKhauTinh,
    to_truong: w.toTruong,
    sdt_to_truong: w.sdtToTruong,
    ngay_vao_ktx: w.ngayVaoKTX,
    ngay_ra_ktx: w.ngayRaKTX ?? null,
    ghi_chu: w.ghiChu,
    khoa_tra_cuu: w.khoaTraCuu || `${w.ktx}|${w.day}|${w.phongSo}`,
    avatar: w.avatar ?? '',
    tam_tru_status: w.tamTruStatus ?? 'unregistered',
  };

  // Only include id if it is a valid UUID; insert paths generate a new id when absent.
  if (w.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(w.id)) {
    row.id = w.id;
  }

  return row;
}

// ─── Context types ─────────────────────────────────────────────────────────

interface WorkerContextValue {
  workers: Worker[];
  workerCount: number;
  totalWorkerCount: number;
  loading: boolean;
  refreshing: boolean;
  addWorker: (worker: Worker) => Promise<void>;
  updateWorker: (worker: Worker) => Promise<void>;
  deleteWorker: (id: string) => Promise<void>;
  deleteWorkers: (ids: string[]) => Promise<void>;
  deleteAllWorkers: () => Promise<void>;
  importWorkers: (rows: Worker[]) => Promise<void>;
  updateTamTruStatus: (id: string, status: 'registered' | 'unregistered') => Promise<void>;
  bulkUpdateKtx: (ids: string[], ktxValue: string) => Promise<void>;
  bulkUpdateWorkers: (
    ids: string[],
    patch: {
      tamTruStatus?: 'registered' | 'unregistered';
      ktx?: string;
      day?: string;
      phongSo?: string;
      tieuDoan?: string;
      clearBedOnMove?: boolean;
    }
  ) => Promise<void>;
  refreshWorkers: () => Promise<void>;
  setWorkers: React.Dispatch<React.SetStateAction<Worker[]>>;
}

const WorkerContext = createContext<WorkerContextValue | null>(null);

const FETCH_PAGE_SIZE = 1000;

export function WorkerProvider({ children }: { children: React.ReactNode }) {
  const { currentUser, isAdmin, canWriteBlock, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));
  const shouldLoadWorkers = !authLoading && Boolean(currentUser) && !isPublicPath;

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [totalWorkerCount, setTotalWorkerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const workerMetaByIdRef = useRef<Map<string, Worker>>(new Map());
  const lastFetchedAtRef = useRef<number>(0);

  const fetchCount = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('workers')
        .select('*', { count: 'exact', head: true });
      if (!error && count !== null) {
        setTotalWorkerCount(count);
      }
    } catch (err) {
      console.warn('fetchCount warning:', err);
    }
  }, [supabase]);

  const fetchWorkers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const allRows: Worker[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const to = from + FETCH_PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from('workers')
          .select('*')
          .order('id', { ascending: true })
          .range(from, to);

        if (error) {
          throw new Error(error.message);
        }

        const batch = (data ?? []).map(dbRowToWorker);
        allRows.push(...batch);

        if (batch.length < FETCH_PAGE_SIZE) {
          hasMore = false;
        } else {
          from += FETCH_PAGE_SIZE;
        }
      }

      const metaMap = new Map<string, Worker>();
      const noIdRows: Worker[] = [];
      allRows.forEach(w => {
        if (w.id) metaMap.set(w.id, w);
        else noIdRows.push(w);
      });
      const uniqueRows = [...Array.from(metaMap.values()), ...noIdRows];
      uniqueRows.sort((a, b) => (a.stt ?? 0) - (b.stt ?? 0) || a.hoVaTen.localeCompare(b.hoVaTen));
      workerMetaByIdRef.current = metaMap;
      lastFetchedAtRef.current = Date.now();
      setWorkers(uniqueRows);
      setTotalWorkerCount(uniqueRows.length);
    } catch (err: any) {
      console.warn('Load workers warning:', err?.message || err);
      if (!isRefresh) {
        setWorkers([]);
        setTotalWorkerCount(0);
      }
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading) return;
    if (!shouldLoadWorkers) {
      workerMetaByIdRef.current.clear();
      setWorkers([]);
      setTotalWorkerCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchWorkers(false);
  }, [authLoading, shouldLoadWorkers, fetchWorkers]);

  useEffect(() => {
    if (!shouldLoadWorkers) return;

    const workersChannel = supabase
      .channel('workers_realtime_v2')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workers' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newWorker = dbRowToWorker(payload.new as Record<string, unknown>);
            if (newWorker.id) workerMetaByIdRef.current.set(newWorker.id, newWorker);
            setWorkers(prev => {
              if (prev.some(w => w.id === newWorker.id)) return prev;
              const next = [...prev, newWorker].sort((a, b) => (a.stt ?? 0) - (b.stt ?? 0) || a.hoVaTen.localeCompare(b.hoVaTen));
              setTotalWorkerCount(next.length);
              return next;
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = dbRowToWorker(payload.new as Record<string, unknown>);
            if (updated.id) workerMetaByIdRef.current.set(updated.id, updated);
            setWorkers(prev => prev.map(w => w.id === updated.id ? updated : w));
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as Record<string, unknown>).id as string;
            const prevMeta = workerMetaByIdRef.current.get(deletedId);
            if (prevMeta) {
              preserveDeletedWorkerEntries([prevMeta]);
              workerMetaByIdRef.current.delete(deletedId);
            }
            setWorkers(prev => {
              const next = prev.filter(w => w.id !== deletedId);
              setTotalWorkerCount(next.length);
              return next;
            });
          }
        }
      )
      .subscribe();

    channelRef.current = workersChannel;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchedAtRef.current > 45_000) {
        fetchWorkers(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(workersChannel);
    };
  }, [shouldLoadWorkers, supabase, fetchWorkers]);

  const refreshWorkers = useCallback(async () => {
    await fetchWorkers(true);
    await fetchCount();
  }, [fetchWorkers, fetchCount]);

  const addWorker = useCallback(async (worker: Worker) => {
    const dbRow = workerToDbRow(worker);
    const id = dbRow.id ? String(dbRow.id) : generateWorkerId();
    dbRow.id = id;
    const { data: insertedRow, error } = await supabase
      .from('workers')
      .insert(dbRow)
      .select('created_at')
      .maybeSingle();
    if (error) throw new Error(error.message);
    const savedWorker: Worker = {
      ...worker,
      id,
      khoaTraCuu: String(dbRow.khoa_tra_cuu || `${worker.ktx}|${worker.day}|${worker.phongSo}`),
      createdAt: insertedRow?.created_at ? String(insertedRow.created_at) : (worker.createdAt || new Date().toISOString()),
    };
    await syncBedForWorkerSave(supabase, undefined, savedWorker);
    workerMetaByIdRef.current.set(id, savedWorker);
    setWorkers(prev => {
      if (prev.some(w => w.id === id)) return prev.map(w => (w.id === id ? savedWorker : w));
      const next = [...prev, savedWorker].sort((a, b) => (a.stt ?? 0) - (b.stt ?? 0) || a.hoVaTen.localeCompare(b.hoVaTen));
      setTotalWorkerCount(next.length);
      return next;
    });
  }, [supabase]);

  const updateWorker = useCallback(async (worker: Worker) => {
    const prevWorker = workerMetaByIdRef.current.get(worker.id) || workers.find(w => w.id === worker.id);
    const dbRow = workerToDbRow(worker);
    const { error } = await supabase
      .from('workers')
      .update(dbRow)
      .eq('id', worker.id);
    if (error) throw new Error(error.message);
    await syncBedForWorkerSave(supabase, prevWorker, worker);
    const updatedWorker: Worker = {
      ...prevWorker,
      ...worker,
      khoaTraCuu: String(dbRow.khoa_tra_cuu || `${worker.ktx}|${worker.day}|${worker.phongSo}`),
    };
    workerMetaByIdRef.current.set(worker.id, updatedWorker);
    setWorkers(prev => prev.map(w => (w.id === worker.id ? updatedWorker : w)));
  }, [workers, supabase]);

  const deleteWorker = useCallback(async (id: string) => {
    const workerToDelete = workerMetaByIdRef.current.get(id) || workers.find(w => w.id === id);
    if (workerToDelete) {
      preserveDeletedWorkerEntries([workerToDelete]);
      await supabase
        .from('worker_deletion_log')
        .insert({
          worker_id: id,
          ho_va_ten: workerToDelete.hoVaTen || null,
          ma_nv: workerToDelete.maNV || null,
          ktx: workerToDelete.ktx || null,
          day: workerToDelete.day || null,
          deleted_at: new Date().toISOString(),
        });
    }
    const { error } = await supabase
      .from('workers')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
    await releaseBedsForWorkers(supabase, [id]);
    workerMetaByIdRef.current.delete(id);
    setWorkers(prev => {
      const next = prev.filter(w => w.id !== id);
      setTotalWorkerCount(next.length);
      return next;
    });
  }, [workers, supabase]);

  const deleteWorkers = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const workersToDelete = ids
      .map(id => workerMetaByIdRef.current.get(id) || workers.find(wk => wk.id === id))
      .filter((w): w is Worker => Boolean(w));
    if (workersToDelete.length > 0) {
      preserveDeletedWorkerEntries(workersToDelete);
    }
    const logRows = ids.map(id => {
      const w = workerMetaByIdRef.current.get(id) || workers.find(wk => wk.id === id);
      return {
        worker_id: id,
        ho_va_ten: w?.hoVaTen || null,
        ma_nv: w?.maNV || null,
        ktx: w?.ktx || null,
        day: w?.day || null,
        deleted_at: now,
      };
    });
    if (logRows.length > 0) {
      await supabase.from('worker_deletion_log').insert(logRows);
    }
    const { error } = await supabase
      .from('workers')
      .delete()
      .in('id', ids);
    if (error) throw new Error(error.message);
    await releaseBedsForWorkers(supabase, ids);
    const idSet = new Set(ids);
    ids.forEach(id => workerMetaByIdRef.current.delete(id));
    setWorkers(prev => {
      const next = prev.filter(w => !idSet.has(w.id));
      setTotalWorkerCount(next.length);
      return next;
    });
  }, [workers, supabase]);

  const deleteAllWorkers = useCallback(async () => {
    const now = new Date().toISOString();
    if (workers && workers.length > 0) {
      preserveDeletedWorkerEntries(workers);
    }
    const ids = (workers || []).map(w => w?.id).filter(Boolean) as string[];
    if (ids.length === 0) {
      await releaseAllOccupiedBeds(supabase);
      setWorkers([]);
      setTotalWorkerCount(0);
      return;
    }

    // Log deletions in batches before removing rows.
    const LOG_BATCH = 200;
    for (let i = 0; i < ids.length; i += LOG_BATCH) {
      const batch = ids.slice(i, i + LOG_BATCH).map(id => {
        const w = workers.find(wk => wk.id === id);
        return {
          worker_id: id,
          ho_va_ten: w?.hoVaTen || null,
          ma_nv: w?.maNV || null,
          ktx: w?.ktx || null,
          day: w?.day || null,
          deleted_at: now,
        };
      });
      try {
        await supabase.from('worker_deletion_log').insert(batch);
      } catch (logErr) {
        console.warn('[WorkerContext] Deletion log insert failed:', logErr);
      }
    }

    // Delete by explicit id chunks — never rely on `.neq('id', ...)` sentinel
    // (avoids uuid/text cast errors and oversized URL filters).
    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const { error } = await supabase
        .from('workers')
        .delete()
        .in('id', chunk);
      if (error) throw new Error(error.message);
    }

    await releaseAllOccupiedBeds(supabase);
    setWorkers([]);
    setTotalWorkerCount(0);
  }, [workers, supabase]);

  const importWorkers = useCallback(async (rows: Worker[]) => {
    if (rows.length === 0) return;
    let nextStt = workers.length > 0 ? Math.max(...workers.map(w => w.stt || 0)) : 0;
    const rowsWithStt = rows.map(r => {
      if (r.stt && r.stt > 0) return r;
      nextStt += 1;
      return { ...r, stt: nextStt };
    });

    // Ensure each row has a valid primary key so upsert can dedupe by id
    const dbRows = rowsWithStt.map(w => {
      const row = workerToDbRow(w);
      if (!row.id) row.id = generateWorkerId();
      return row;
    });

    // Batch size of 500 rows using upsert on the primary key
    const BATCH = 500;
    for (let i = 0; i < dbRows.length; i += BATCH) {
      const batch = dbRows.slice(i, i + BATCH);
      const { error } = await supabase
        .from('workers')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }

    if (rows.some(r => (r.giuong || '').trim() !== '' || workers.some(existing => existing.id === r.id))) {
      try {
        await reconcileBedsWithWorkers(supabase, { isAdmin, canWriteBlock });
      } catch (syncErr) {
        console.warn('[WorkerContext] Post-import bed reconcile warning:', syncErr);
      }
    }
    await fetchWorkers(true);
  }, [workers, fetchWorkers, supabase, isAdmin, canWriteBlock]);

  const updateTamTruStatus = useCallback(async (id: string, status: 'registered' | 'unregistered') => {
    const { error } = await supabase
      .from('workers')
      .update({ tam_tru_status: status })
      .eq('id', id);
    if (error) throw new Error(error.message);
    setWorkers(prev => prev.map(w => w.id === id ? { ...w, tamTruStatus: status } : w));
  }, [supabase]);

  const bulkUpdateKtx = useCallback(async (ids: string[], ktxValue: string) => {
    if (ids.length === 0) return;
    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batchIds = ids.slice(i, i + BATCH);
      const { error } = await supabase
        .from('workers')
        .update({ ktx: ktxValue, giuong: '' })
        .in('id', batchIds);
      if (error) throw new Error(error.message);
    }
    await releaseBedsForWorkers(supabase, ids);
    const idSet = new Set(ids);
    setWorkers(prev =>
      prev.map(w =>
        idSet.has(w.id)
          ? {
              ...w,
              ktx: ktxValue,
              giuong: '',
              khoaTraCuu: `${ktxValue}|${w.day}|${w.phongSo}`,
            }
          : w
      )
    );
  }, [supabase]);

  const bulkUpdateWorkers = useCallback(async (
    ids: string[],
    patch: {
      tamTruStatus?: 'registered' | 'unregistered';
      ktx?: string;
      day?: string;
      phongSo?: string;
      tieuDoan?: string;
      clearBedOnMove?: boolean;
    }
  ) => {
    if (ids.length === 0) return;
    const dbPatch: Record<string, unknown> = {};
    if (patch.tamTruStatus !== undefined) dbPatch.tam_tru_status = patch.tamTruStatus;
    if (patch.ktx !== undefined) dbPatch.ktx = patch.ktx;
    if (patch.day !== undefined) dbPatch.day = patch.day;
    if (patch.phongSo !== undefined) dbPatch.phong_so = patch.phongSo;
    if (patch.tieuDoan !== undefined) dbPatch.tieu_doan = patch.tieuDoan;

    const isMovingRoom = patch.ktx !== undefined || patch.day !== undefined || patch.phongSo !== undefined;
    if (isMovingRoom && patch.clearBedOnMove !== false) {
      dbPatch.giuong = '';
    }

    if (Object.keys(dbPatch).length === 0) return;

    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batchIds = ids.slice(i, i + BATCH);
      const { error } = await supabase
        .from('workers')
        .update(dbPatch)
        .in('id', batchIds);
      if (error) throw new Error(error.message);
    }

    if (isMovingRoom) {
      await releaseBedsForWorkers(supabase, ids);
    }

    const idSet = new Set(ids);
    setWorkers(prev =>
      prev.map(w => {
        if (!idSet.has(w.id)) return w;
        const nextKtx = patch.ktx !== undefined ? patch.ktx : w.ktx;
        const nextDay = patch.day !== undefined ? patch.day : w.day;
        const nextRoom = patch.phongSo !== undefined ? patch.phongSo : w.phongSo;
        return {
          ...w,
          ...(patch.tamTruStatus !== undefined ? { tamTruStatus: patch.tamTruStatus } : {}),
          ...(patch.ktx !== undefined ? { ktx: patch.ktx } : {}),
          ...(patch.day !== undefined ? { day: patch.day } : {}),
          ...(patch.phongSo !== undefined ? { phongSo: patch.phongSo } : {}),
          ...(patch.tieuDoan !== undefined ? { tieuDoan: patch.tieuDoan } : {}),
          ...(isMovingRoom && patch.clearBedOnMove !== false ? { giuong: '' } : {}),
          khoaTraCuu: `${nextKtx}|${nextDay}|${nextRoom}`,
        };
      })
    );
  }, [supabase]);

  return (
    <WorkerContext.Provider value={{
      workers,
      workerCount: workers.length,
      totalWorkerCount,
      loading,
      refreshing,
      addWorker,
      updateWorker,
      deleteWorker,
      deleteWorkers,
      deleteAllWorkers,
      importWorkers,
      updateTamTruStatus,
      bulkUpdateKtx,
      bulkUpdateWorkers,
      refreshWorkers,
      setWorkers,
    }}>
      {children}
    </WorkerContext.Provider>
  );
}

export function useWorkers() {
  const ctx = useContext(WorkerContext);
  if (!ctx) throw new Error('useWorkers must be used within WorkerProvider');
  return ctx;
}
