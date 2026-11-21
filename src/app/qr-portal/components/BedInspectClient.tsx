'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  BedDouble, RefreshCw, Search, X, User, UserCheck, UserX, Loader2,
  Wrench, DoorOpen, Phone, Briefcase, VenusAndMars, Calendar,
  CheckCircle2, AlertCircle, ScanLine, Printer, ArrowRightLeft,
  Camera, ArrowLeft, Clock, Building2, QrCode,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import {
  releaseBedsForWorkers,
  releaseBedByLocation,
  normalizeBedLabel,
  normalizeDayKey,
  normalizeKtxCompact,
  deduplicateBedRows,
} from '@/lib/bedSync';
import {
  normalizeRoomLabel,
  extractRoomNumber,
  invalidateFacilitiesCache,
  fetchFacilitiesList,
  FacilityItem,
} from '@/lib/facilityCapacity';
import { preserveDeletedWorkerEntries } from '@/lib/workerFluctuation';
import { verifyWorkerDeletionIntegrity } from '@/lib/workerDeletionIntegrity';
import { invalidateWorkerHierarchyCache } from '@/lib/workerHierarchy';
import { invalidateKtxStructureCache } from '@/lib/ktxStructure';
import { toast } from 'sonner';
import BedQrPrintModal from '@/app/bed-management/components/BedQrPrintModal';
import BedTransferModal from '@/app/bed-management/components/BedTransferModal';
import BedQrCameraScanner from './BedQrCameraScanner';

interface BedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'empty' | 'occupied' | 'maintenance';
  ma_nv: string | null;
  ho_va_ten: string | null;
  worker_id: string | null;
}

interface WorkerLite {
  id: string;
  hoVaTen: string;
  maNV: string;
  cccd: string;
  donVi: string;
  gioiTinh: string;
  soDienThoai: string;
  ngayVaoKTX: string;
  ktx: string;
  day: string;
  phongSo: string;
  giuong: string;
}

interface RecentInspectionItem {
  id: string;
  timestamp: string;
  account: string;
  bedId: string;
  ktx: string;
  day: string;
  phongSo: string;
  giuong: string;
  hoVaTen: string;
  maNv: string;
}

interface BedLookup {
  ktx: string;
  day: string;
  phong: string;
  giuong: string;
  qr: string;
}

function parseRawQrInput(rawInput: string): BedLookup {
  const cleaned = rawInput.trim();
  if (!cleaned) return { ktx: '', day: '', phong: '', giuong: '', qr: '' };

  try {
    if (cleaned.includes('?') || cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      const parsed = new URL(cleaned.startsWith('http') ? cleaned : `https://local.ktx/${cleaned.replace(/^\/+/, '')}`);
      const ktx = (parsed.searchParams.get('ktx') || '').trim();
      const day = (parsed.searchParams.get('day') || '').trim();
      const phong = (parsed.searchParams.get('phong_so') || parsed.searchParams.get('phong') || '').trim();
      const giuong = (parsed.searchParams.get('giuong') || parsed.searchParams.get('bed') || '').trim();
      const bedQr = (parsed.searchParams.get('bed_qr') || '').trim();
      const qr = bedQr || (ktx && day && phong && giuong ? `${ktx}|${day}|${phong}|${giuong}` : '');
      if (qr) return { ktx, day, phong, giuong, qr };
    }
  } catch {
    // fallback to raw code
  }

  return { ktx: '', day: '', phong: '', giuong: '', qr: cleaned };
}

function renderSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 animate-pulse" suppressHydrationWarning>
      <div className="h-10 w-64 bg-surf border border-bdr rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 h-80 bg-surf border border-bdr rounded-xl" />
        <div className="lg:col-span-5 h-80 bg-surf border border-bdr rounded-xl" />
      </div>
    </div>
  );
}

function formatLocationShort(ktx?: string, day?: string, phong?: string, giuong?: string): string {
  const roomNum = extractRoomNumber(phong || '') || (phong || '').trim();
  const bedNum = normalizeBedLabel(giuong || '') || (giuong || '').trim();
  return [
    ktx,
    day,
    roomNum ? `P.${roomNum}` : '',
    bedNum ? `G.${bedNum}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function BedInspectClient() {
  const { isAdmin, canWriteBlock, currentUser } = useAuth();
  const { addLog } = useAudit();
  const [isMounted, setIsMounted] = useState(false);

  // Active inspected bed state
  const [bed, setBed] = useState<BedRow | null>(null);
  const [worker, setWorker] = useState<WorkerLite | null>(null);
  const [bedLookup, setBedLookup] = useState<BedLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState('');

  // Directory / Picker / History state (when browsing without QR or switching beds)
  const [allBeds, setAllBeds] = useState<BedRow[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [pickerKtx, setPickerKtx] = useState('');
  const [pickerDay, setPickerDay] = useState('');
  const [pickerRoom, setPickerRoom] = useState('');
  const [quickSearch, setQuickSearch] = useState('');
  const [pasteQrCode, setPasteQrCode] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  // Recent inspection logs
  const [recentLogs, setRecentLogs] = useState<RecentInspectionItem[]>([]);
  const [recentLogsLoading, setRecentLogsLoading] = useState(false);

  // Action modals
  const [showAssign, setShowAssign] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [workers, setWorkers] = useState<WorkerLite[]>([]);
  const [bedOccupiedWorkerIds, setBedOccupiedWorkerIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showQrPrint, setShowQrPrint] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const hasActiveQuery = Boolean(
    bedLookup &&
      (bedLookup.qr || (bedLookup.ktx && bedLookup.day && bedLookup.phong && bedLookup.giuong))
  );

  // Sync URL query params cleanly without reloading
  const syncUrlBedQr = useCallback((qrValue: string | null) => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'bed_inspect');
      if (qrValue) {
        url.searchParams.set('bed_qr', qrValue);
      } else {
        url.searchParams.delete('bed_qr');
        url.searchParams.delete('ktx');
        url.searchParams.delete('day');
        url.searchParams.delete('phong_so');
        url.searchParams.delete('phong');
        url.searchParams.delete('giuong');
        url.searchParams.delete('bed');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {}
  }, []);

  // 1. Read URL params on mount
  useEffect(() => {
    setIsMounted(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const ktx = (params.get('ktx') || '').trim();
      const day = (params.get('day') || '').trim();
      const phong = (params.get('phong_so') || params.get('phong') || '').trim();
      const giuong = (params.get('giuong') || params.get('bed') || '').trim();
      const bedQr = (params.get('bed_qr') || '').trim();
      const qr = bedQr || (ktx && day && phong && giuong ? `${ktx}|${day}|${phong}|${giuong}` : '');
      setBedLookup({ ktx, day, phong, giuong, qr });
    } catch (err) {
      console.warn('[bed-inspector] parse url failed:', err);
      setBedLookup({ ktx: '', day: '', phong: '', giuong: '', qr: '' });
    }
  }, []);

  // Load beds directory + facilities for lookup workspace
  const loadDirectoryBeds = useCallback(async () => {
    setDirectoryLoading(true);
    try {
      const PAGE = 1000;
      const collected: BedRow[] = [];
      let from = 0;
      for (let p = 0; p < 15; p++) {
        const { data, error } = await supabase
          .from('beds')
          .select('id, ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten, worker_id')
          .order('ktx', { ascending: true })
          .order('day', { ascending: true })
          .order('phong_so', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) break;
        const rows = (data || []).map(mapBed).filter((b): b is BedRow => Boolean(b && b.id));
        collected.push(...rows);
        if ((data || []).length < PAGE) break;
        from += PAGE;
      }
      const { kept } = deduplicateBedRows(collected);
      setAllBeds(kept);
    } catch (err) {
      console.warn('[bed-inspector] load directory beds failed:', err);
    } finally {
      setDirectoryLoading(false);
    }
  }, [supabase]);

  const loadRecentInspections = useCallback(async () => {
    setRecentLogsLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, timestamp, account, detail')
        .eq('action', 'BED_INSPECT_CONFIRM')
        .order('timestamp', { ascending: false })
        .limit(12);
      if (!error && data) {
        const parsed: RecentInspectionItem[] = [];
        for (const row of data as any[]) {
          let meta: Record<string, any> = {};
          try {
            if (typeof row.detail === 'string' && row.detail.trim().startsWith('{')) {
              meta = JSON.parse(row.detail);
            }
          } catch {}
          parsed.push({
            id: String(row.id),
            timestamp: String(row.timestamp || meta.confirmed_at || ''),
            account: String(row.account || ''),
            bedId: String(meta.bed_id || ''),
            ktx: String(meta.ktx || ''),
            day: String(meta.day || ''),
            phongSo: String(meta.phong_so || ''),
            giuong: String(meta.giuong || ''),
            hoVaTen: String(meta.ho_va_ten || ''),
            maNv: String(meta.ma_nv || ''),
          });
        }
        setRecentLogs(parsed);
      }
    } catch (err) {
      console.warn('[bed-inspector] load recent inspections failed:', err);
    } finally {
      setRecentLogsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!isMounted) return;
    loadDirectoryBeds();
    loadRecentInspections();
    fetchFacilitiesList()
      .then(rows => setFacilities(rows))
      .catch(() => {});
  }, [isMounted, loadDirectoryBeds, loadRecentInspections]);

  // Resolve bed by UUID, encoded "ktx|day|phong|giuong" or 4 params (with canonical fallback)
  const findBed = useCallback(
    async (lookup: BedLookup | null): Promise<BedRow | null> => {
      if (!lookup || !supabase) return null;
      const hasAny = Boolean(lookup.qr || (lookup.ktx && lookup.day && lookup.phong && lookup.giuong));
      if (!hasAny) return null;

      try {
        let targetKtx = lookup.ktx;
        let targetDay = lookup.day;
        let targetRoom = lookup.phong;
        let targetBed = lookup.giuong;

        if (lookup.qr) {
          const qr = String(lookup.qr).trim();
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qr);
          if (isUuid) {
            const { data, error } = await supabase.from('beds').select('*').eq('id', qr).maybeSingle();
            if (!error && data) return mapBed(data);
          }
          const parts = qr.split('|').map((p: string) => p.trim());
          if (parts.length === 4 && parts.every(Boolean)) {
            [targetKtx, targetDay, targetRoom, targetBed] = parts;
          }
        }

        if (targetKtx && targetDay && targetRoom && targetBed) {
          // Exact match first
          const { data, error } = await supabase
            .from('beds')
            .select('*')
            .eq('ktx', targetKtx)
            .eq('day', targetDay)
            .eq('phong_so', targetRoom)
            .eq('giuong', targetBed)
            .maybeSingle();
          if (!error && data) return mapBed(data);

          // Canonical fallback match (handles "Phòng 3" vs "3", "G8" vs "8", "Dãy 1" vs "1")
          const { data: ktxRows } = await supabase
            .from('beds')
            .select('*')
            .ilike('ktx', targetKtx.trim())
            .limit(1000);
          const normKtx = normalizeKtxCompact(targetKtx);
          const normDay = normalizeDayKey(targetDay);
          const normRoom = normalizeRoomLabel(targetRoom);
          const normBed = normalizeBedLabel(targetBed);
          const canonicalHit = (ktxRows || []).find((r: any) =>
            normalizeKtxCompact(String(r?.ktx || '')) === normKtx &&
            normalizeDayKey(String(r?.day || '')) === normDay &&
            normalizeRoomLabel(String(r?.phong_so || '')) === normRoom &&
            normalizeBedLabel(String(r?.giuong || '')) === normBed
          );
          if (canonicalHit) return mapBed(canonicalHit);
        }
      } catch (err) {
        console.warn('[bed-inspector] find bed failed:', err);
      }
      return null;
    },
    [supabase]
  );

  const loadBedData = useCallback(
    async (silent = false) => {
      if (!bedLookup) return;
      const hasAny = Boolean(bedLookup.qr || (bedLookup.ktx && bedLookup.day && bedLookup.phong && bedLookup.giuong));
      if (!hasAny) {
        setBed(null);
        setWorker(null);
        setNotFound(false);
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      try {
        const found = await findBed(bedLookup);
        if (!found) {
          setNotFound(true);
          setBed(null);
          setWorker(null);
        } else {
          setNotFound(false);
          setBed(found);
          let w: WorkerLite | null = null;
          try {
            if (found.worker_id) {
              const { data } = await supabase.from('workers').select('*').eq('id', found.worker_id).maybeSingle();
              if (data) w = mapWorker(data);
            }
            if (!w && found.ma_nv && !['-', '—', 'chờ mã', 'chưa có'].includes(found.ma_nv.trim().toLowerCase())) {
              const { data } = await supabase.from('workers').select('*').eq('ma_nv', found.ma_nv.trim()).limit(1);
              if (data && data[0]) w = mapWorker(data[0]);
            }
            if (!w && found.ktx) {
              const normRoom = normalizeRoomLabel(found.phong_so);
              const normBed = normalizeBedLabel(found.giuong);
              const normName = (found.ho_va_ten || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
              const PAGE = 1000;
              let from = 0;
              let matched: any = null;
              while (!matched) {
                const { data: ktxWorkers, error: kwErr } = await supabase
                  .from('workers')
                  .select('*')
                  .ilike('ktx', found.ktx.trim())
                  .order('id', { ascending: true })
                  .range(from, from + PAGE - 1);
                if (kwErr || !ktxWorkers || ktxWorkers.length === 0) break;
                matched = ktxWorkers.find((row: any) => {
                  const sameDay = !found.day || !row?.day || normalizeDayKey(String(row.day)) === normalizeDayKey(found.day);
                  const sameRoom = normalizeRoomLabel(String(row?.phong_so || '')) === normRoom;
                  const sameBed = normBed && normalizeBedLabel(String(row?.giuong || '')) === normBed;
                  const sameName = normName && String(row?.ho_va_ten || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ') === normName;
                  return sameDay && sameRoom && (sameBed || sameName);
                });
                if (matched || ktxWorkers.length < PAGE) break;
                from += PAGE;
              }
              if (matched) w = mapWorker(matched);
            }
          } catch (err) {
            console.warn('[bed-inspector] load worker failed:', err);
          }
          setWorker(w);
        }
      } catch (err) {
        console.warn('[bed-inspector] load bed failed:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [bedLookup, findBed, supabase]
  );

  const loadWorkers = useCallback(async () => {
    try {
      const PAGE = 1000;
      const byId = new Map<string, WorkerLite>();
      let from = 0;
      for (let page = 0; page < 30; page++) {
        const { data, error } = await supabase
          .from('workers')
          .select('id, ho_va_ten, ma_nv, cccd, don_vi, gioi_tinh, so_dien_thoai, ngay_vao_ktx, ktx, day, phong_so, giuong')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) break;
        const chunk = (data || []).map(mapWorker).filter((w): w is WorkerLite => Boolean(w && w.id));
        chunk.forEach(w => byId.set(w.id, w));
        if ((data || []).length < PAGE) break;
        from += PAGE;
      }
      setWorkers(Array.from(byId.values()));
      try {
        const { data: occBeds } = await supabase
          .from('beds')
          .select('worker_id')
          .not('worker_id', 'is', null);
        const occSet = new Set<string>();
        (occBeds || []).forEach((b: any) => {
          if (b?.worker_id) occSet.add(String(b.worker_id));
        });
        setBedOccupiedWorkerIds(occSet);
      } catch {}
    } catch (err) {
      console.warn('[bed-inspector] load workers failed:', err);
    }
  }, [supabase]);

  // Realtime sync with beds table
  useEffect(() => {
    if (!isMounted || !bedLookup) return;
    loadBedData();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('bed_inspect_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => {
          loadBedData(true);
          loadDirectoryBeds();
        })
        .subscribe();
    } catch (err) {
      console.warn('[bed-inspector] realtime failed:', err);
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, bedLookup]);

  useEffect(() => {
    if (showAssign && workers.length === 0) {
      loadWorkers();
    }
  }, [showAssign, workers.length, loadWorkers]);

  const handleSelectBed = useCallback(
    (target: BedRow) => {
      setMessage('');
      setNotFound(false);
      setBedLookup({
        ktx: target.ktx,
        day: target.day,
        phong: target.phong_so,
        giuong: target.giuong,
        qr: target.id,
      });
      syncUrlBedQr(target.id);
    },
    [syncUrlBedQr]
  );

  const handleResetToLookup = useCallback(() => {
    setMessage('');
    setNotFound(false);
    setBed(null);
    setWorker(null);
    setBedLookup({ ktx: '', day: '', phong: '', giuong: '', qr: '' });
    syncUrlBedQr(null);
  }, [syncUrlBedQr]);

  const handleQrDecoded = useCallback(
    (rawText: string) => {
      setShowCameraScanner(false);
      const parsed = parseRawQrInput(rawText);
      if (!parsed.qr) {
        toast.error('Mã QR không hợp lệ hoặc không chứa định danh giường.');
        return;
      }
      setMessage('');
      setBedLookup(parsed);
      syncUrlBedQr(parsed.qr);
      toast.success('Đã quét mã QR giường.');
    },
    [syncUrlBedQr]
  );

  const handlePasteQrSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteQrCode.trim()) return;
    handleQrDecoded(pasteQrCode);
    setPasteQrCode('');
  };

  // Cascading picker options derived from beds + facilities
  const ktxOptions = useMemo(() => {
    const set = new Set<string>();
    allBeds.forEach(b => { if (b.ktx) set.add(b.ktx); });
    facilities.forEach(f => { if (f.ktx) set.add(f.ktx); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [allBeds, facilities]);

  // Auto-select first KTX for smooth UX when beds load
  useEffect(() => {
    if (!pickerKtx && ktxOptions.length > 0) {
      setPickerKtx(ktxOptions[0]);
    }
  }, [ktxOptions, pickerKtx]);

  const dayOptions = useMemo(() => {
    if (!pickerKtx) return [];
    const set = new Set<string>();
    allBeds.filter(b => b.ktx === pickerKtx && b.day).forEach(b => set.add(b.day));
    facilities.filter(f => f.ktx === pickerKtx && f.day).forEach(f => set.add(f.day));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [allBeds, facilities, pickerKtx]);

  useEffect(() => {
    if (dayOptions.length > 0 && (!pickerDay || !dayOptions.includes(pickerDay))) {
      setPickerDay(dayOptions[0]);
    } else if (dayOptions.length === 0 && pickerDay) {
      setPickerDay('');
    }
  }, [dayOptions, pickerDay]);

  const roomOptions = useMemo(() => {
    if (!pickerKtx || !pickerDay) return [];
    const set = new Set<string>();
    allBeds
      .filter(b => b.ktx === pickerKtx && b.day === pickerDay && b.phong_so)
      .forEach(b => set.add(extractRoomNumber(b.phong_so) || b.phong_so));
    facilities
      .filter(f => f.ktx === pickerKtx && f.day === pickerDay && f.phong)
      .forEach(f => set.add(extractRoomNumber(f.phong) || f.phong));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [allBeds, facilities, pickerKtx, pickerDay]);

  useEffect(() => {
    if (roomOptions.length > 0 && (!pickerRoom || !roomOptions.includes(pickerRoom))) {
      setPickerRoom(roomOptions[0]);
    } else if (roomOptions.length === 0 && pickerRoom) {
      setPickerRoom('');
    }
  }, [roomOptions, pickerRoom]);

  const roomBeds = useMemo(() => {
    if (!pickerKtx || !pickerDay || !pickerRoom) return [];
    const normRoom = normalizeRoomLabel(pickerRoom);
    return allBeds
      .filter(
        b =>
          b.ktx === pickerKtx &&
          b.day === pickerDay &&
          normalizeRoomLabel(b.phong_so) === normRoom
      )
      .sort((a, b) => {
        const na = parseInt(normalizeBedLabel(a.giuong), 10);
        const nb = parseInt(normalizeBedLabel(b.giuong), 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.giuong.localeCompare(b.giuong, 'vi', { numeric: true });
      });
  }, [allBeds, pickerKtx, pickerDay, pickerRoom]);

  const quickSearchResults = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return [];
    return allBeds
      .filter(b => {
        const roomLabel = `p.${extractRoomNumber(b.phong_so) || b.phong_so}`;
        const bedLabel = `g.${normalizeBedLabel(b.giuong) || b.giuong}`;
        const hay = [b.ho_va_ten, b.ma_nv, b.ktx, b.day, b.phong_so, b.giuong, roomLabel, bedLabel]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [allBeds, quickSearch]);

  const canWriteBed = useMemo(() => {
    if (!bed) return false;
    return isAdmin || canWriteBlock(bed.day, bed.ktx);
  }, [bed, isAdmin, canWriteBlock]);

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const setBedStatus = useCallback(
    async (status: 'maintenance' | 'empty') => {
      if (!bed) return;
      if (!canWriteBed) {
        toast.error(`Bạn không có quyền cập nhật giường tại ${bed.ktx} - ${bed.day}.`);
        return;
      }
      setBusy(true);
      setMessage('');
      try {
        const { error } = await supabase.from('beds').update({ status }).eq('id', bed.id);
        if (error) throw new Error(error.message);
        const msg = status === 'maintenance' ? 'Đã chuyển giường sang trạng thái bảo trì.' : 'Giường đã sẵn sàng sử dụng lại.';
        setMessage(msg);
        toast.success(msg);
        await Promise.all([loadBedData(true), loadDirectoryBeds()]);
      } catch (err: any) {
        console.error('[bed-inspector] set status failed:', err);
        setMessage(err?.message || 'Không thể cập nhật trạng thái giường.');
      } finally {
        setBusy(false);
      }
    },
    [bed, canWriteBed, loadBedData, loadDirectoryBeds, supabase]
  );

  const confirmPresence = useCallback(async () => {
    if (!bed) return;
    if (!canWriteBed) {
      toast.error(`Bạn không có quyền xác nhận giường tại ${bed.ktx} - ${bed.day}.`);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const logId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`;
      const actorName = currentUser?.name || currentUser?.email || 'Kiểm tra giường';
      const { error } = await supabase.from('audit_logs').insert({
        id: logId,
        timestamp: new Date().toISOString(),
        account: actorName,
        action: 'BED_INSPECT_CONFIRM',
        detail: JSON.stringify({
          bed_id: bed.id,
          ktx: bed.ktx,
          day: bed.day,
          phong_so: bed.phong_so,
          giuong: bed.giuong,
          ma_nv: bed.ma_nv || worker?.maNV || '',
          ho_va_ten: bed.ho_va_ten || worker?.hoVaTen || '',
          don_vi: worker?.donVi || '',
          ngay_vao_ktx: worker?.ngayVaoKTX || '',
          confirmed_at: new Date().toISOString(),
        }),
      });
      if (error) throw new Error(error.message);
      setMessage('Đã xác nhận công nhân có mặt tại giường và lưu nhật ký kiểm tra.');
      toast.success('Đã xác nhận có mặt.');
      loadRecentInspections();
    } catch (err: any) {
      console.error('[bed-inspector] confirm presence failed:', err);
      setMessage(err?.message || 'Không thể lưu log xác nhận.');
    } finally {
      setBusy(false);
    }
  }, [bed, canWriteBed, currentUser, worker, supabase, loadRecentInspections]);

  const checkoutImmediate = useCallback(async () => {
    if (!bed) return;
    if (!canWriteBed) {
      toast.error(`Bạn không có quyền check-out giường tại ${bed.ktx} - ${bed.day}.`);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const targetWorkerId = bed.worker_id || worker?.id || null;
      const targetName = bed.ho_va_ten || worker?.hoVaTen || '';
      const targetMaNv = bed.ma_nv || worker?.maNV || '';
      const targetCccd = worker?.cccd || '';
      const targetPhoneDigits = String(worker?.soDienThoai || '').replace(/\D/g, '');
      const now = new Date().toISOString();

      const collectedMap = new Map<string, { id: string; hoVaTen: string; maNV: string; ktx: string; day: string }>();
      if (targetWorkerId) {
        collectedMap.set(targetWorkerId, {
          id: targetWorkerId,
          hoVaTen: targetName,
          maNV: targetMaNv,
          ktx: bed.ktx || '',
          day: bed.day || '',
        });
      }

      const isValidCode = (raw?: string | null) => {
        const s = String(raw || '').normalize('NFC').replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '').toLowerCase();
        return Boolean(s && !['-', '—', 'chờmã', 'chưacó', 'n/a', 'null'].includes(s));
      };
      const normTargetName = targetName.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
      const rawCodes = Array.from(new Set([targetMaNv.trim(), targetCccd.trim()].filter(v => isValidCode(v))));

      for (const code of rawCodes) {
        const [{ data: sameMa }, { data: sameCccd }] = await Promise.all([
          supabase.from('workers').select('id, ho_va_ten, ma_nv, ktx, day').eq('ma_nv', code),
          supabase.from('workers').select('id, ho_va_ten, ma_nv, ktx, day').eq('cccd', code),
        ]);
        [...(sameMa || []), ...(sameCccd || [])].forEach((r: any) => {
          if (!r?.id) return;
          const rName = String(r.ho_va_ten || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
          if (!normTargetName || rName === normTargetName || code.replace(/\D/g, '').length >= 9) {
            collectedMap.set(String(r.id), {
              id: String(r.id),
              hoVaTen: r.ho_va_ten || targetName,
              maNV: r.ma_nv || targetMaNv,
              ktx: r.ktx || bed.ktx || '',
              day: r.day || bed.day || '',
            });
          }
        });
      }

      if (normTargetName && targetPhoneDigits.length >= 8) {
        const cleanToken = targetName.trim().replace(/\s+/g, ' ').replace(/[%_]/g, '');
        if (cleanToken) {
          const { data: sameNameRows } = await supabase
            .from('workers')
            .select('id, ho_va_ten, ma_nv, so_dien_thoai, ktx, day')
            .ilike('ho_va_ten', `%${cleanToken}%`);
          (sameNameRows || []).forEach((r: any) => {
            if (!r?.id) return;
            const rName = String(r.ho_va_ten || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
            const rPhone = String(r.so_dien_thoai || '').replace(/\D/g, '');
            if (rName === normTargetName && rPhone === targetPhoneDigits) {
              collectedMap.set(String(r.id), {
                id: String(r.id),
                hoVaTen: r.ho_va_ten || targetName,
                maNV: r.ma_nv || targetMaNv,
                ktx: r.ktx || bed.ktx || '',
                day: r.day || bed.day || '',
              });
            }
          });
        }
      }

      const normKtx = (bed.ktx || '').trim().toLowerCase();
      const normDay = normalizeDayKey(bed.day || '');
      const normRoom = normalizeRoomLabel(bed.phong_so || '');
      const normBed = normalizeBedLabel(bed.giuong || '');
      if (normKtx && normRoom) {
        const { data: ktxRows } = await supabase
          .from('workers')
          .select('id, ho_va_ten, ma_nv, ktx, day, phong_so, giuong')
          .ilike('ktx', bed.ktx.trim());
        (ktxRows || []).forEach((r: any) => {
          if (!r?.id) return;
          const sameDay = !normDay || !r.day || normalizeDayKey(String(r.day)) === normDay;
          const sameRoom = normalizeRoomLabel(String(r.phong_so || '')) === normRoom;
          const sameBed = normBed && normalizeBedLabel(String(r.giuong || '')) === normBed;
          const rName = String(r.ho_va_ten || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
          const sameName = normTargetName && rName === normTargetName;
          if (sameDay && sameRoom && ((sameBed && (!normTargetName || sameName)) || (sameName && !r.giuong))) {
            collectedMap.set(String(r.id), {
              id: String(r.id),
              hoVaTen: r.ho_va_ten || targetName,
              maNV: r.ma_nv || targetMaNv,
              ktx: r.ktx || bed.ktx || '',
              day: r.day || bed.day || '',
            });
          }
        });
      }

      const idsToDelete = Array.from(collectedMap.keys());
      let verifiedDeletedIds: string[] = [];

      if (idsToDelete.length > 0) {
        try {
          await supabase.from('worker_deletion_log').insert(
            Array.from(collectedMap.values()).map(item => ({
              worker_id: item.id,
              ho_va_ten: item.hoVaTen || null,
              ma_nv: item.maNV || null,
              ktx: item.ktx || null,
              day: item.day || null,
              deleted_at: now,
            }))
          );
        } catch {}

        const { data: deletedRows, error: delErr } = await supabase
          .from('workers')
          .delete()
          .in('id', idsToDelete)
          .select('id');

        if (delErr) throw new Error(delErr.message);

        const { data: survivors, error: verifyErr } = await supabase
          .from('workers')
          .select('id')
          .in('id', idsToDelete);
        if (verifyErr) throw new Error(verifyErr.message);
        if (survivors && survivors.length > 0) {
          throw new Error(`Không thể xóa ${survivors.length} hồ sơ công nhân khỏi CSDL (kiểm tra quyền RLS tại ${bed.ktx} · ${bed.day}).`);
        }

        verifiedDeletedIds = (deletedRows || []).map((r: any) => String(r.id)).filter(Boolean);
        if (verifiedDeletedIds.length === 0) verifiedDeletedIds = idsToDelete;

        preserveDeletedWorkerEntries(Array.from(collectedMap.values()));
      }

      await releaseBedByLocation(supabase, {
        workerIds: verifiedDeletedIds,
        bedId: bed.id,
        ktx: bed.ktx,
        day: bed.day,
        phongSo: bed.phong_so,
        giuong: bed.giuong,
      });

      const actor = currentUser?.name || currentUser?.email || 'Admin';
      const deleteTargets = Array.from(collectedMap.values()).map(item => ({
        id: item.id,
        hoVaTen: item.hoVaTen,
        maNV: item.maNV,
        cccd: targetCccd,
        soDienThoai: worker?.soDienThoai,
        ktx: item.ktx,
        day: item.day,
        phongSo: bed.phong_so,
        giuong: bed.giuong,
      }));
      const integrity = await verifyWorkerDeletionIntegrity(supabase, {
        workerIds: verifiedDeletedIds.length > 0 ? verifiedDeletedIds : idsToDelete,
        codes: rawCodes,
        hoVaTen: targetName,
        soDienThoai: worker?.soDienThoai,
        account: actor,
        sourceContext: 'BedInspectClient.checkoutImmediate',
        targets: deleteTargets,
      });
      if (!integrity.isClean) {
        throw new Error(integrity.message);
      }

      addLog(
        actor,
        'CHECKOUT_APPROVED',
        `Check-out qua QR Giường: ${targetName || '—'} (${targetMaNv || '—'}) tại ${bed.ktx} · ${bed.day} · P.${extractRoomNumber(bed.phong_so) || bed.phong_so} · G.${normalizeBedLabel(bed.giuong) || bed.giuong}`
      );

      invalidateWorkerHierarchyCache();
      invalidateKtxStructureCache();
      invalidateFacilitiesCache();
      if (typeof window !== 'undefined' && verifiedDeletedIds.length > 0) {
        window.dispatchEvent(new CustomEvent('ktx_workers_deleted', { detail: { ids: verifiedDeletedIds } }));
        window.dispatchEvent(new CustomEvent('ktx_workers_updated'));
      }

      const bedDisp = normalizeBedLabel(bed.giuong) || bed.giuong;
      setMessage(`Đã check-out "${targetName || 'công nhân'}" và giải phóng Giường ${bedDisp} tức thì.`);
      toast.success(`Đã giải phóng Giường ${bedDisp}.`);
      await Promise.all([loadBedData(true), loadDirectoryBeds()]);
    } catch (err: any) {
      console.error('[bed-inspector] immediate checkout failed:', err);
      const msg = err?.message || 'Không thể check-out trực tiếp.';
      setMessage(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [bed, canWriteBed, worker, supabase, currentUser, addLog, loadBedData, loadDirectoryBeds]);

  const requestCheckout = useCallback(async () => {
    if (!bed) return;
    if (!canWriteBed) {
      toast.error(`Bạn không có quyền check-out giường tại ${bed.ktx} - ${bed.day}.`);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const targetWorkerId = bed.worker_id || worker?.id || null;
      const targetMaNv = bed.ma_nv || worker?.maNV || '';
      const { data: existingPending } = await supabase
        .from('worker_registrations')
        .select('id')
        .eq('status', 'pending')
        .like('ghi_chu', '[CHECKOUT]%')
        .eq('ktx', bed.ktx)
        .eq('day', bed.day)
        .eq('phong_so', bed.phong_so)
        .eq('giuong', bed.giuong)
        .limit(1);
      if (existingPending && existingPending.length > 0) {
        setMessage('Giường này đã có yêu cầu check-out đang chờ duyệt.');
        return;
      }

      const now = new Date().toISOString();
      const note = `[CHECKOUT] Lý do: Qua Kiểm Tra Giường QR${now ? ` | Ngày dự kiến dọn ra: ${now.split('T')[0]}` : ''}`;
      const { error } = await supabase.from('worker_registrations').insert({
        type: 'CHECKOUT',
        worker_id: targetWorkerId,
        ho_va_ten: bed.ho_va_ten || worker?.hoVaTen || '',
        ma_nv: targetMaNv,
        so_cccd: worker?.cccd || '',
        so_dien_thoai: worker?.soDienThoai || '',
        ktx: bed.ktx,
        day: bed.day,
        phong_so: bed.phong_so,
        giuong: bed.giuong,
        status: 'pending',
        ghi_chu: note,
      });
      if (error) throw new Error(error.message);
      setMessage('Đã tạo yêu cầu check-out — giường sẽ giải phóng sau khi quản lý duyệt.');
      toast.success('Đã gửi yêu cầu check-out.');
    } catch (err: any) {
      console.error('[bed-inspector] checkout request failed:', err);
      setMessage(err?.message || 'Không thể tạo yêu cầu check-out.');
    } finally {
      setBusy(false);
    }
  }, [bed, canWriteBed, worker, supabase]);

  const handleAssign = useCallback(
    async (candidate: WorkerLite) => {
      if (!bed) return;
      if (!canWriteBed) {
        toast.error(`Bạn không có quyền gán công nhân tại ${bed.ktx} - ${bed.day}.`);
        return;
      }
      setBusy(true);
      setMessage('');
      try {
        await releaseBedsForWorkers(supabase, [candidate.id]);
        const { error: workerErr } = await supabase
          .from('workers')
          .update({ ktx: bed.ktx, day: bed.day, phong_so: bed.phong_so, giuong: bed.giuong })
          .eq('id', candidate?.id ?? '');
        if (workerErr) throw new Error(workerErr.message);

        const { error: bedErr } = await supabase
          .from('beds')
          .update({
            status: 'occupied',
            worker_id: candidate.id,
            ma_nv: candidate.maNV || null,
            ho_va_ten: candidate.hoVaTen || null,
          })
          .eq('id', bed.id);
        if (bedErr) throw new Error(bedErr.message);

        setShowAssign(false);
        setAssignSearch('');
        setMessage('Đã gán công nhân vào giường và đồng bộ hệ thống.');
        toast.success(`Đã gán ${candidate.hoVaTen} vào giường.`);
        await Promise.all([loadBedData(true), loadWorkers(), loadDirectoryBeds()]);
      } catch (err: any) {
        console.error('[bed-inspector] assign failed:', err);
        setMessage(err?.message || 'Không thể gán công nhân.');
      } finally {
        setBusy(false);
      }
    },
    [bed, canWriteBed, loadBedData, loadWorkers, loadDirectoryBeds, supabase]
  );

  const occupiedIds = useMemo(() => {
    const set = new Set<string>(bedOccupiedWorkerIds);
    (workers || []).forEach(w => {
      if (w?.id && w?.ktx && w?.day && w?.phongSo && w?.giuong) set.add(w.id);
    });
    return set;
  }, [workers, bedOccupiedWorkerIds]);

  const candidates = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    return (workers || []).filter(w => {
      if (!w?.id) return false;
      if (occupiedIds.has(w.id)) return false;
      if (!q) return true;
      return [w.hoVaTen, w.maNV, w.cccd, w.donVi].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [workers, occupiedIds, assignSearch]);

  if (!isMounted) return renderSkeleton();

  const female = (() => {
    const g = (worker?.gioiTinh || '').toLowerCase();
    return g.includes('nữ') || g === 'nu' || g === 'female';
  })();
  const name = bed?.ho_va_ten || worker?.hoVaTen || '';
  const maNv = bed?.ma_nv || worker?.maNV || '';
  const roomShort = bed ? extractRoomNumber(bed.phong_so) || bed.phong_so : '';
  const bedShort = bed ? normalizeBedLabel(bed.giuong) || bed.giuong : '';

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5" suppressHydrationWarning>
      {/* Camera QR Scanner Modal */}
      <BedQrCameraScanner
        open={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onDecoded={handleQrDecoded}
      />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-bdr">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-tx">
            Kiểm Tra Giường QR
          </h1>
          <p className="text-xs text-mu mt-0.5">
            Quét tem QR dán tại đầu giường hoặc chọn nhanh vị trí KTX để đối chiếu công nhân, bảo trì và check-out tức thì
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasActiveQuery && (
            <button
              type="button"
              onClick={handleResetToLookup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-bdr bg-surf hover:bg-act text-tx rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              <ArrowLeft size={13} />
              <span>Chọn giường khác</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCameraScanner(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-pri hover:opacity-90 text-white rounded-lg text-xs font-semibold cursor-pointer transition-opacity whitespace-nowrap"
          >
            <Camera size={14} />
            <span>Quét mã QR bằng Camera</span>
          </button>
          {bed && (
            <button
              type="button"
              onClick={() => setShowQrPrint(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-bdr bg-surf hover:bg-act text-tx rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              <Printer size={13} />
              <span>In tem QR</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (hasActiveQuery) loadBedData();
              loadDirectoryBeds();
              loadRecentInspections();
            }}
            disabled={loading || directoryLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-bdr bg-surf hover:bg-act text-mu hover:text-tx rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw size={13} className={loading || directoryLoading ? 'animate-spin' : ''} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Loading active bed */}
      {loading && (
        <div className="bg-surf border border-bdr rounded-xl p-12 flex flex-col items-center justify-center gap-2 text-mu">
          <Loader2 size={24} className="animate-spin text-pri2" />
          <span className="text-xs">Đang truy xuất thông tin giường...</span>
        </div>
      )}

      {/* Invalid QR Not Found (ONLY when user actually scanned/supplied a bed_qr that didn't exist) */}
      {!loading && hasActiveQuery && notFound && (
        <div className="bg-surf border border-wn/50 rounded-xl p-6 max-w-xl mx-auto text-center space-y-3">
          <div className="w-10 h-10 rounded-full tint-wn text-wn mx-auto flex items-center justify-center">
            <AlertCircle size={20} />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-tx">Không tìm thấy mã giường tương ứng</h2>
            <p className="text-xs text-mu leading-relaxed">
              Mã <code className="px-1.5 py-0.5 rounded bg-page border border-bdr font-mono text-tx">{bedLookup?.qr || '—'}</code> chưa khớp với bản ghi giường nào. Hãy đồng bộ sơ đồ giường hoặc chọn trực tiếp từ danh sách bên dưới.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowCameraScanner(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-pri hover:opacity-90 text-white rounded-lg text-xs font-semibold cursor-pointer"
            >
              <Camera size={13} /> Quét lại mã QR
            </button>
            <button
              type="button"
              onClick={handleResetToLookup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-bdr bg-page hover:bg-act text-tx rounded-lg text-xs font-semibold cursor-pointer"
            >
              Mở tra cứu giường
            </button>
          </div>
        </div>
      )}

      {/* ─── IDLE / LOOKUP WORKSPACE (when no bed_qr is active) ─── */}
      {!loading && !hasActiveQuery && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Quick Search + Cascading Room/Bed Picker */}
          <div className="lg:col-span-7 space-y-4">
            {/* Search & Scanner input card */}
            <div className="bg-surf border border-bdr rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
                  <input
                    type="text"
                    value={quickSearch}
                    onChange={e => setQuickSearch(e.target.value)}
                    placeholder="Tìm nhanh công nhân, Mã NV, Phòng hoặc Giường (VD: P.3, G.8)..."
                    className="w-full pl-9 pr-8 py-2 text-xs bg-page border border-bdr rounded-lg text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
                  />
                  {quickSearch && (
                    <button
                      type="button"
                      onClick={() => setQuickSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mu hover:text-tx cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <form onSubmit={handlePasteQrSubmit} className="flex gap-1.5 sm:w-64">
                  <div className="relative flex-1">
                    <QrCode size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
                    <input
                      type="text"
                      value={pasteQrCode}
                      onChange={e => setPasteQrCode(e.target.value)}
                      placeholder="Dán mã QR / máy quét..."
                      className="w-full pl-8 pr-2 py-2 text-xs bg-page border border-bdr rounded-lg text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!pasteQrCode.trim()}
                    className="px-2.5 py-2 border border-bdr bg-side hover:bg-act text-tx rounded-lg text-xs font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    Mở
                  </button>
                </form>
              </div>

              {/* Search results dropdown-like list */}
              {quickSearch.trim() && (
                <div className="border-t border-bdr pt-3 space-y-1.5">
                  <p className="text-[11px] font-semibold text-mu">
                    Kết quả tìm kiếm ({quickSearchResults.length})
                  </p>
                  {quickSearchResults.length === 0 ? (
                    <p className="text-xs text-mu py-4 text-center">
                      Không tìm thấy giường hoặc công nhân khớp từ khóa &ldquo;{quickSearch}&rdquo;.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                      {quickSearchResults.map(item => {
                        const rShort = extractRoomNumber(item.phong_so) || item.phong_so;
                        const bShort = normalizeBedLabel(item.giuong) || item.giuong;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleSelectBed(item)}
                            className="text-left p-2.5 rounded-lg border border-bdr bg-page hover:border-pri2 hover:bg-act transition-colors cursor-pointer flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-tx truncate">
                                {item.ho_va_ten || 'Giường trống'}
                              </p>
                              <p className="text-[11px] text-mu font-tabular truncate">
                                {item.ktx} · {item.day} · P.{rShort} · G.{bShort}
                              </p>
                            </div>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                                item.status === 'occupied'
                                  ? 'bg-okbg text-ok'
                                  : item.status === 'maintenance'
                                  ? 'tint-wn text-wn'
                                  : 'bg-bdg text-lnk'
                              }`}
                            >
                              {item.status === 'occupied' ? 'Đã ở' : item.status === 'maintenance' ? 'Bảo trì' : 'Trống'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Cascading KTX -> Day -> Room -> Beds Grid */}
            <div className="bg-surf border border-bdr rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Building2 size={15} className="text-pri2" />
                  <h2 className="text-sm font-bold text-tx">Chọn giường theo sơ đồ phòng</h2>
                </div>
                <span className="text-xs text-mu font-tabular">
                  {allBeds.length.toLocaleString('vi-VN')} giường trong hệ thống
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] font-medium text-mu mb-1 block">Khu KTX</label>
                  <select
                    value={pickerKtx}
                    onChange={e => setPickerKtx(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-page border border-bdr rounded-lg text-tx focus:outline-none focus:border-pri2"
                  >
                    {ktxOptions.length === 0 && <option value="">Chưa có dữ liệu</option>}
                    {ktxOptions.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mu mb-1 block">Dãy nhà</label>
                  <select
                    value={pickerDay}
                    onChange={e => setPickerDay(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-page border border-bdr rounded-lg text-tx focus:outline-none focus:border-pri2"
                  >
                    {dayOptions.length === 0 && <option value="">-- Chọn Dãy --</option>}
                    {dayOptions.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mu mb-1 block">Phòng số</label>
                  <select
                    value={pickerRoom}
                    onChange={e => setPickerRoom(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-page border border-bdr rounded-lg text-tx focus:outline-none focus:border-pri2"
                  >
                    {roomOptions.length === 0 && <option value="">-- Chọn Phòng --</option>}
                    {roomOptions.map(r => (
                      <option key={r} value={r}>Phòng {r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {directoryLoading ? (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-mu">
                  <Loader2 size={16} className="animate-spin text-pri2" />
                  <span>Đang tải sơ đồ giường...</span>
                </div>
              ) : roomBeds.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-bdr rounded-lg text-xs text-mu">
                  Phòng này chưa có bản ghi giường. Vào mục <strong>Quản Lý Giường</strong> để đồng bộ dữ liệu phòng.
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-mu">
                    <span>
                      Danh sách giường <strong className="text-tx">{pickerKtx} · {pickerDay} · P.{pickerRoom}</strong>
                    </span>
                    <span className="font-tabular">
                      {roomBeds.filter(b => b.status === 'occupied').length}/{roomBeds.length} đã ở
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {roomBeds.map(item => {
                      const bNum = normalizeBedLabel(item.giuong) || item.giuong;
                      const isOcc = item.status === 'occupied';
                      const isMaint = item.status === 'maintenance';
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectBed(item)}
                          className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                            isOcc
                              ? 'border-bdr2 bg-page hover:border-ok'
                              : isMaint
                              ? 'border-wn/40 tint-wn hover:border-wn'
                              : 'border-dashed border-bdr bg-page hover:border-pri2'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-mono font-bold text-tx font-tabular">G.{bNum}</span>
                            <span
                              className={`text-[10px] font-semibold ${
                                isOcc ? 'text-ok' : isMaint ? 'text-wn' : 'text-lnk'
                              }`}
                            >
                              {isOcc ? 'Đã ở' : isMaint ? 'Bảo trì' : 'Trống'}
                            </span>
                          </div>
                          <p className="text-[11px] text-mu truncate mt-1">
                            {item.ho_va_ten || 'Chưa có người'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Recent Bed Inspections History */}
          <div className="lg:col-span-5 bg-surf border border-bdr rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-bdr flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-pri2" />
                <h2 className="text-sm font-bold text-tx">Lịch sử kiểm tra gần đây</h2>
              </div>
              <span className="text-[11px] text-mu font-tabular">{recentLogs.length} lượt</span>
            </div>

            {recentLogsLoading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-xs text-mu">
                <Loader2 size={15} className="animate-spin text-pri2" />
                <span>Đang tải lịch sử...</span>
              </div>
            ) : recentLogs.length === 0 ? (
              <div className="p-8 text-center space-y-1.5">
                <ScanLine size={24} className="mx-auto text-mu/60" />
                <p className="text-xs font-semibold text-tx">Chưa có lượt xác nhận giường nào</p>
                <p className="text-[11px] text-mu">
                  Khi quản lý hoặc bảo vệ quét QR và bấm &ldquo;Xác nhận có mặt&rdquo;, lịch sử sẽ hiện tại đây.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-bdr max-h-[460px] overflow-y-auto">
                {recentLogs.map(log => {
                  const locText = formatLocationShort(log.ktx, log.day, log.phongSo, log.giuong);
                  const canOpen = Boolean(log.bedId || (log.ktx && log.day && log.phongSo && log.giuong));
                  return (
                    <div key={log.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-act/50 transition-colors">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-bold text-tx truncate">
                          {log.hoVaTen || 'Kiểm tra giường'}
                          {log.maNv ? <span className="font-mono font-normal text-mu ml-1.5">({log.maNv})</span> : null}
                        </p>
                        <p className="text-[11px] text-mu font-tabular truncate">
                          {locText || 'Không rõ vị trí'}
                        </p>
                        <p className="text-[10px] text-mu font-tabular">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString('vi-VN') : '—'}
                          {log.account ? ` · ${log.account}` : ''}
                        </p>
                      </div>
                      {canOpen && (
                        <button
                          type="button"
                          onClick={() => {
                            const qr = log.bedId || `${log.ktx}|${log.day}|${log.phongSo}|${log.giuong}`;
                            setBedLookup({
                              ktx: log.ktx,
                              day: log.day,
                              phong: log.phongSo,
                              giuong: log.giuong,
                              qr,
                            });
                            syncUrlBedQr(qr);
                          }}
                          className="px-2.5 py-1 border border-bdr bg-page hover:bg-act text-tx rounded-lg text-[11px] font-semibold cursor-pointer shrink-0 whitespace-nowrap"
                        >
                          Xem lại
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── ACTIVE BED INSPECTION VIEW ─── */}
      {!loading && bed && (() => {
        const occupied = bed.status === 'occupied';
        const maintenance = bed.status === 'maintenance';
        return (
          <div className="max-w-4xl mx-auto space-y-4">
            {message && (
              <div className="rounded-xl border border-bdr2 bg-bdg p-3.5 text-xs font-semibold text-lnk flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="shrink-0" />
                  <span>{message}</span>
                </div>
                <button type="button" onClick={() => setMessage('')} className="text-lnk hover:opacity-70 cursor-pointer">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              {/* Left Column: Bed Identity + Worker Info */}
              <div className="md:col-span-7 space-y-4">
                <div
                  className={`rounded-xl border p-5 bg-surf ${
                    occupied
                      ? 'border-bdr2'
                      : maintenance
                      ? 'border-wn/60'
                      : 'border-dashed border-pri2'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-bold text-lnk font-tabular flex items-center gap-1.5">
                      <BedDouble size={14} /> Giường {bedShort || '—'}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded border ${
                        occupied
                          ? 'bg-okbg text-ok border-bdr2'
                          : maintenance
                          ? 'tint-wn text-wn border-wn/40'
                          : 'bg-bdg text-lnk border-pri2/40'
                      }`}
                    >
                      {occupied ? 'Đang có người ở' : maintenance ? 'Đang bảo trì' : 'Giường trống sẵn sàng'}
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-tx font-tabular">Phòng {roomShort || '—'}</p>
                  <p className="text-xs text-mu font-tabular mt-1">
                    {bed.ktx || '—'} · {bed.day || '—'} · P.{roomShort || '—'} · G.{bedShort || '—'}
                  </p>
                </div>

                {occupied && name && (
                  <div className="rounded-xl border border-bdr bg-surf p-5">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ${
                          female ? 'bg-bdg text-pri2 border border-bdr2' : 'bg-okbg text-ok border border-bdr2'
                        }`}
                      >
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-base font-bold text-tx flex items-center gap-2 truncate">
                          {name}
                          {female && <VenusAndMars size={14} className="text-pri2 shrink-0" />}
                        </p>
                        <p className="text-xs text-tx font-tabular flex items-center gap-1.5">
                          <User size={12} className="shrink-0 text-mu" />
                          <span>Mã NV: <strong className="text-lnk font-mono">{maNv || '—'}</strong></span>
                        </p>
                        <p className="text-xs text-mu flex items-center gap-1.5 truncate">
                          <Briefcase size={12} className="shrink-0" /> {worker?.donVi || '—'}
                        </p>
                        <p className="text-xs text-mu font-tabular flex items-center gap-1.5">
                          <Phone size={12} className="shrink-0" /> {worker?.soDienThoai || '—'}
                        </p>
                        <p className="text-xs text-mu font-tabular flex items-center gap-1.5">
                          <Calendar size={12} className="shrink-0" /> Ngày vào: {worker?.ngayVaoKTX || '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Action Controls */}
              <div className="md:col-span-5 rounded-xl border border-bdr bg-surf p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-mu pb-1 border-b border-bdr">
                  Thao tác kiểm tra &amp; quản lý giường
                </h3>

                {!canWriteBed ? (
                  <p className="text-xs text-wn font-medium text-center py-4">
                    Chế độ chỉ xem — Bạn không phụ trách {bed.day} ({bed.ktx}).
                  </p>
                ) : (
                  <>
                    {occupied && name && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={confirmPresence}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-ok2 hover:opacity-90 text-ok2-fg text-xs font-bold transition-opacity disabled:opacity-50 cursor-pointer"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          <span>Xác nhận có mặt</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setShowTransfer(true)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-pri hover:opacity-90 text-white text-xs font-bold transition-opacity disabled:opacity-50 cursor-pointer"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                          <span>Chuyển / Đổi giường</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setBedStatus('maintenance')}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-wn hover:opacity-90 text-wn-fg text-xs font-bold transition-opacity disabled:opacity-50 cursor-pointer"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                          <span>Báo hỏng / Bảo trì</span>
                        </button>
                        <div className="pt-2 border-t border-bdr space-y-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={checkoutImmediate}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-dgr hover:opacity-90 text-white text-xs font-bold transition-opacity disabled:opacity-50 cursor-pointer"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                            <span>Check-out &amp; Trả giường ngay</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={requestCheckout}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-dgr/40 tint-dgr text-dgr hover:opacity-90 text-xs font-semibold transition-opacity disabled:opacity-50 cursor-pointer"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <DoorOpen size={13} />}
                            <span>Gửi yêu cầu check-out để duyệt</span>
                          </button>
                        </div>
                      </>
                    )}

                    {maintenance ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setBedStatus('empty')}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-ok2 hover:opacity-90 text-ok2-fg text-xs font-bold disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        <span>Hoàn tất bảo trì</span>
                      </button>
                    ) : (
                      !occupied && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setShowAssign(true);
                              setAssignSearch('');
                            }}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-pri hover:opacity-90 text-white text-xs font-bold transition-opacity disabled:opacity-50 cursor-pointer"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                            <span>Gán nhanh công nhân</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setBedStatus('maintenance')}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-wn hover:opacity-90 text-wn-fg text-xs font-bold transition-opacity disabled:opacity-50 cursor-pointer"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                            <span>Báo hỏng / Bảo trì</span>
                          </button>
                        </>
                      )
                    )}

                    {busy && (
                      <p className="text-[11px] text-mu flex items-center gap-1.5 pt-1">
                        <Loader2 size={11} className="animate-spin" /> Đang xử lý...
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Print QR Modal ─── */}
      <BedQrPrintModal
        open={showQrPrint}
        onClose={() => setShowQrPrint(false)}
        lockedBed={
          bed
            ? {
                id: bed.id || '',
                ktx: bed.ktx || '',
                day: bed.day || '',
                phong_so: bed.phong_so || '',
                giuong: bed.giuong || '',
                status: bed.status || 'empty',
                ma_nv: bed.ma_nv,
                ho_va_ten: bed.ho_va_ten,
              }
            : null
        }
      />

      {/* ─── Transfer Modal ─── */}
      <BedTransferModal
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        workerId={bed?.worker_id || worker?.id || null}
        sourceBed={
          bed
            ? { id: bed.id || '', ktx: bed.ktx || '', day: bed.day || '', phong_so: bed.phong_so || '', giuong: bed.giuong || '' }
            : null
        }
        onTransferred={() => {
          loadBedData(false);
          loadDirectoryBeds();
          setMessage('Dữ liệu giường đã được cập nhật sau khi chuyển giường.');
        }}
      />

      {/* ─── Quick Assign Modal ─── */}
      {showAssign && bed && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowAssign(false)}
        >
          <div
            className="bg-surf border border-bdr rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-bdr">
              <div>
                <h3 className="font-bold text-sm text-tx flex items-center gap-2">
                  <UserCheck size={16} className="text-pri2" /> Gán nhanh công nhân
                </h3>
                <p className="text-xs text-mu font-tabular mt-0.5">
                  {bed.ktx} · {bed.day} · P.{roomShort} · G.{bedShort}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                className="p-2 rounded-lg hover:bg-act text-mu hover:text-tx cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 pt-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ic" />
                <input
                  autoFocus
                  value={assignSearch}
                  onChange={e => setAssignSearch(e.target.value)}
                  placeholder="Tên / Mã NV / Số CCCD..."
                  className="w-full bg-page border border-bdr text-tx placeholder:text-mu rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-pri2"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {candidates.length === 0 ? (
                <p className="text-xs text-mu italic text-center py-8">Không tìm thấy công nhân chưa có giường.</p>
              ) : (
                candidates.slice(0, 80).map(w => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssign(w)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border border-bdr hover:border-pri2/60 hover:bg-act transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                        (w?.gioiTinh || '').toLowerCase().includes('nữ')
                          ? 'bg-bdg text-pri2 border border-bdr2'
                          : 'bg-bdg text-lnk border border-bdr2'
                      }`}
                    >
                      {String(w?.hoVaTen || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-tx truncate">{w?.hoVaTen || '(Không tên)'}</p>
                      <p className="text-[11px] text-mu font-tabular truncate">
                        {w?.maNV || '—'} · CCCD {w?.cccd ? `${w.cccd.slice(0, 4)}****${w.cccd.slice(-3)}` : '—'} · {w?.donVi || '—'}
                      </p>
                    </div>
                    <UserCheck size={15} className="text-pri2 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mappers (null-safe) ─────────────────────────────────────────────────────
function mapBed(r: Record<string, unknown> | null): BedRow | null {
  if (!r) return null;
  return {
    id: String(r?.id ?? ''),
    ktx: String(r?.ktx ?? ''),
    day: String(r?.day ?? ''),
    phong_so: String(r?.phong_so ?? ''),
    giuong: String(r?.giuong ?? ''),
    status: r?.status === 'occupied' ? 'occupied' : r?.status === 'maintenance' ? 'maintenance' : 'empty',
    ma_nv: r?.ma_nv ? String(r.ma_nv) : null,
    ho_va_ten: r?.ho_va_ten ? String(r.ho_va_ten) : null,
    worker_id: r?.worker_id ? String(r.worker_id) : null,
  };
}

function mapWorker(r: Record<string, unknown> | null): WorkerLite | null {
  if (!r) return null;
  return {
    id: String(r?.id ?? ''),
    hoVaTen: String(r?.ho_va_ten ?? ''),
    maNV: String(r?.ma_nv ?? ''),
    cccd: String(r?.cccd ?? ''),
    donVi: String(r?.don_vi ?? ''),
    gioiTinh: String(r?.gioi_tinh ?? ''),
    soDienThoai: String(r?.so_dien_thoai ?? ''),
    ngayVaoKTX: String(r?.ngay_vao_ktx ?? ''),
    ktx: String(r?.ktx ?? ''),
    day: String(r?.day ?? ''),
    phongSo: String(r?.phong_so ?? ''),
    giuong: String(r?.giuong ?? ''),
  };
}
