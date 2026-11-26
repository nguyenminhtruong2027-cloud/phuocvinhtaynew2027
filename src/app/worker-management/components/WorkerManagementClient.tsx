'use client';
import React, { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Worker, getProfileStatus, calcSoNgay, DEFAULT_ROOM_CAPACITY, removeAccents } from '@/data/workers';
import WorkerTable from './WorkerTable';
import WorkerFilters from './WorkerFilters';
import BulkActionBar from './BulkActionBar';
import { Plus, Download, Upload, X, FileText, AlertCircle, AlertTriangle, FileCheck, ChevronLeft, ChevronRight, Trash2, Building2, CheckSquare, Filter, Users, ArrowRightLeft, ShieldAlert, UserMinus } from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportToExcel } from '@/lib/exportExcel';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { useSearchParams } from 'next/navigation';
import { useKtxStructure } from '@/lib/ktxStructure';
import { FacilityItem, fetchFacilitiesList, fetchRoomCapacities, getRoomCapacity, normalizeRoomLabel, RoomCapacityMap } from '@/lib/facilityCapacity';
import { loadSavedRoomGenderMap, fetchRoomLabelsAuthoritative, normalizeGender } from '@/lib/roomGender';
import { BatchAssignmentPlanItem } from '@/lib/smartRoomAssign';
import { daysSinceVN } from '@/lib/vnDate';
import { fetchBlacklist, matchBlacklistInMemory, type BlacklistRecord } from '@/lib/disciplineService';
import { CACHE_KEYS, getCachedData, setCachedData } from '@/lib/clientCache';

const WorkerFormModal = dynamic(() => import('./WorkerFormModal'), { ssr: false });
const WorkerDetailModal = dynamic(() => import('./WorkerDetailModal'), { ssr: false });
const DeleteConfirmModal = dynamic(() => import('./DeleteConfirmModal'), { ssr: false });
const BatchSmartAssignModal = dynamic(() => import('./BatchSmartAssignModal'), { ssr: false });
const BatchCheckoutReconcileModal = dynamic(() => import('./BatchCheckoutReconcileModal'), { ssr: false });

export interface FilterState {
  search: string;
  ktx: string;
  building: string;
  room: string;
  platoon: string;
  profileStatus: string;
  toTruong: string;
  province: string;
  tamTruStatus: string;
}

const DEFAULT_FILTERS: FilterState = {
  search: '', ktx: '', building: '', room: '', platoon: '',
  profileStatus: '', toTruong: '', province: '', tamTruStatus: '',
};

/** Get current Vietnam time (UTC+7) as ISO string */
function nowVN(): string {
  const now = new Date();
  const vnOffset = 7 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + vnOffset * 60000).toISOString();
}

/** Format a date string to DD/MM/YYYY in UTC+7 */
function formatDateVN(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const vnOffset = 7 * 60;
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const vnDate = new Date(utc + vnOffset * 60000);
  return `${vnDate.getDate().toString().padStart(2,'0')}/${(vnDate.getMonth()+1).toString().padStart(2,'0')}/${vnDate.getFullYear()}`;
}

/**
 * Format ngaySinh to DD/MM/YYYY.
 * Handles: ISO timestamp (YYYY-MM-DDTHH:mm:ss.sssZ), ISO date (YYYY-MM-DD),
 *          DD/MM/YYYY, D/M/YYYY, M/D/YYYY, year-only, empty/null.
 * Returns "-" if value is empty or unparseable.
 */
function formatNgaySinh(raw: string | number | undefined | null): string {
  if (raw === null || raw === undefined) return '-';
  const s = String(raw).trim();
  if (s === '' || s === 'null' || s === 'undefined') return '-';

  // ISO timestamp: YYYY-MM-DDTHH:mm:ss... (e.g. 2000-01-15T00:00:00.000Z)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }
  }

  // ISO date: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // Already DD/MM/YYYY (two-digit day and month)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

  // Slash-separated: M/D/YYYY or D/M/YYYY or MM/DD/YYYY
  const slashParts = s.split('/');
  if (slashParts.length === 3) {
    const [a, b, c] = slashParts;
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    const numC = parseInt(c, 10);
    if (!isNaN(numA) && !isNaN(numB) && !isNaN(numC) && numC > 1000) {
      // If first part > 12, it must be day (DD/MM/YYYY)
      if (numA > 12) {
        return `${String(numA).padStart(2, '0')}/${String(numB).padStart(2, '0')}/${numC}`;
      }
      // If second part > 12, it must be day in position 2 → M/D/YYYY
      if (numB > 12) {
        return `${String(numB).padStart(2, '0')}/${String(numA).padStart(2, '0')}/${numC}`;
      }
      // Both ≤ 12: ambiguous — treat as DD/MM/YYYY (Vietnamese convention)
      return `${String(numA).padStart(2, '0')}/${String(numB).padStart(2, '0')}/${numC}`;
    }
  }

  // Numeric timestamp (milliseconds)
  if (/^\d{10,13}$/.test(s)) {
    const ts = parseInt(s, 10);
    const d = new Date(s.length === 10 ? ts * 1000 : ts);
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }
  }

  // Year only (e.g. "1985")
  if (/^\d{4}$/.test(s)) return s;

  // Fallback: return as-is if non-empty
  return s;
}

/** Normalize a header string: remove newlines, trim whitespace, uppercase for comparison */
function normalizeHeader(h: string): string {
  return String(h ?? '').replace(/\n/g, ' ').replace(/\r/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Safely convert a cell value to string, preserving leading zeros for CCCD/SĐT */
function cellToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/** Normalize building/day name: "3" → "Dãy 3", "Dãy 3" stays as-is */
function normalizeDayNha(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (/^(dãy|day)\s+/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `Dãy ${trimmed}`;
  return trimmed;
}

/** Normalize room number: strip "Phòng", "P.", leading zeros: "Phòng 1" -> "1", "P.02" -> "2", "1" -> "1" */
function normalizePhong(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const clean = trimmed.replace(/^(?:phòng|p[.\s]*)\s*/i, '').trim();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && /^\d+$/.test(clean)) return String(num);
  return clean || trimmed;
}

/** Normalize KTX value from Excel to standard format (e.g. "KTX 1", "KTX 2", "KTX 10") */
function normalizeKtxValue(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  const match = s.match(/^ktx\s*(\d+)$/i);
  if (match) return `KTX ${match[1]}`;
  return s;
}

/** Parsed row from real Excel file */
interface ParsedWorkerRow {
  hoTen: string;
  maCongNhan: string;
  soCCCD: string;
  soDienThoai: string;
  dayNha: string;
  soPhong: string;
  ngaySinh: string;
  queQuan: string;
  toTruong: string;
  sdtToTruong: string;
  ngayVao: string;
  ghiChu: string;
  ktxFromExcel: string;
  gioiTinh: string;
  donVi: string;
  tieuDoan: string;
  giuong: string;
}

const PREVIEW_HEADERS = ['Trạng thái & Cảnh báo', 'KTX', 'Họ và Tên', 'Giới tính', 'Mã NV', 'CCCD', 'SĐT', 'Dãy', 'Phòng', 'Ngày Sinh', 'Quê Quán', 'Tổ Trưởng', 'Ngày Vào KTX', 'Ghi Chú'];
const PREVIEW_PAGE_SIZE = 20;

type DuplicateResolutionMode = 'skip' | 'update' | 'add_all';
type ImportPreviewFilter = 'all' | 'new' | 'duplicate' | 'warning';

function normDupMaNV(val?: string | null): string {
  const s = (val || '').trim().toLowerCase();
  if (!s || s === '-' || s === 'chờ mã' || s === 'cho ma') return '';
  return s;
}

function normDupCCCD(val?: string | null): string {
  const s = (val || '').trim().replace(/\s+/g, '');
  if (!s || s === '-') return '';
  return s;
}

interface RowAnalysis {
  status: 'new' | 'dup_system' | 'dup_in_file';
  reason: string;
  matchedWorker?: Worker;
}

interface OverloadPreviewItem {
  ktx: string;
  day: string;
  room: string;
  existingCount: number;
  incomingCount: number;
  projectedCount: number;
  capacity: number;
}

function ExcelImportModal({
  onClose,
  onImport,
  existingWorkers,
}: {
  onClose: () => void;
  onImport: (rows: Worker[]) => Promise<void>;
  existingWorkers: Worker[];
}) {
  const { ktxNames } = useKtxStructure();
  const [parsedRows, setParsedRows] = useState<ParsedWorkerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [previewPage, setPreviewPage] = useState(1);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedKtx, setSelectedKtx] = useState<string>('');
  const [hasKtxColumn, setHasKtxColumn] = useState(false);
  const [dupMode, setDupMode] = useState<DuplicateResolutionMode>('skip');
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>(() => loadSavedRoomGenderMap());
  const [previewFilter, setPreviewFilter] = useState<ImportPreviewFilter>('all');
  const [showOverloadDetails, setShowOverloadDetails] = useState(false);
  const [blacklistRecords, setBlacklistRecords] = useState<BlacklistRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetchRoomCapacities()
      .then(map => {
        if (active) setCapacities(map);
      })
      .catch(() => {});
    fetchRoomLabelsAuthoritative()
      .then(res => {
        if (active && res.ok) {
          setRoomGenderMap(prev => ({ ...prev, ...res.data }));
        }
      })
      .catch(() => {});
    fetchBlacklist()
      .then(res => {
        if (active && !res.tableMissing) {
          setBlacklistRecords(res.data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const existingByMaNV = useMemo(() => {
    const map = new Map<string, Worker>();
    existingWorkers.forEach(w => {
      const k = normDupMaNV(w.maNV);
      if (k && !map.has(k)) map.set(k, w);
    });
    return map;
  }, [existingWorkers]);

  const existingByCCCD = useMemo(() => {
    const map = new Map<string, Worker>();
    existingWorkers.forEach(w => {
      const k = normDupCCCD(w.cccd);
      if (k && !map.has(k)) map.set(k, w);
    });
    return map;
  }, [existingWorkers]);

  const rowAnalyses = useMemo<RowAnalysis[]>(() => {
    const seenMaNV = new Set<string>();
    const seenCCCD = new Set<string>();

    return parsedRows.map(row => {
      const mKey = normDupMaNV(row.maCongNhan);
      const cKey = normDupCCCD(row.soCCCD);

      const inFileMa = mKey ? seenMaNV.has(mKey) : false;
      const inFileCCCD = cKey ? seenCCCD.has(cKey) : false;
      if (mKey) seenMaNV.add(mKey);
      if (cKey) seenCCCD.add(cKey);

      if (inFileMa || inFileCCCD) {
        return {
          status: 'dup_in_file',
          reason: inFileMa && inFileCCCD ? 'Trùng Mã NV & CCCD trong file' : inFileMa ? 'Trùng Mã NV trong file' : 'Trùng CCCD trong file',
        };
      }

      const matchMa = mKey ? existingByMaNV.get(mKey) : undefined;
      const matchCCCD = cKey ? existingByCCCD.get(cKey) : undefined;
      const matched = matchMa || matchCCCD;
      if (matched) {
        return {
          status: 'dup_system',
          reason: matchMa && matchCCCD ? 'Trùng Mã NV & CCCD' : matchMa ? 'Trùng Mã NV' : 'Trùng CCCD',
          matchedWorker: matched,
        };
      }

      return { status: 'new', reason: 'Mới' };
    });
  }, [parsedRows, existingByMaNV, existingByCCCD]);

  const dupStats = useMemo(() => {
    let newCount = 0;
    let sysDupCount = 0;
    let fileDupCount = 0;
    rowAnalyses.forEach(a => {
      if (a.status === 'new') newCount++;
      else if (a.status === 'dup_system') sysDupCount++;
      else fileDupCount++;
    });
    return { newCount, sysDupCount, fileDupCount };
  }, [rowAnalyses]);

  const parseExcelFile = (file: File) => {
    setFileName(file.name);
    setParseError('');
    setParsedRows([]);
    setTotal(0);
    setPreviewPage(1);
    setPreviewFilter('all');
    setHasKtxColumn(false);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'array', cellText: true, cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawAoA: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

        if (!rawAoA || rawAoA.length === 0) {
          setParseError('File trống hoặc không đọc được dữ liệu.');
          return;
        }

        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(10, rawAoA.length); i++) {
          const rowNormalized = (rawAoA[i] as unknown[]).map(c => normalizeHeader(String(c)));
          if (rowNormalized.some(h => h.includes('HỌ VÀ TÊN') || h.includes('HO VA TEN') || h === 'HỌ VÀ TÊN')) {
            headerRowIndex = i;
            break;
          }
        }
        if (headerRowIndex === -1) headerRowIndex = 2;

        const headerRow = (rawAoA[headerRowIndex] as unknown[]).map(c => normalizeHeader(String(c)));
        const colMap: Record<string, number> = {};
        headerRow.forEach((h, idx) => { colMap[h] = idx; });

        const findCol = (...names: string[]): number => {
          for (const name of names) {
            const normalized = normalizeHeader(name);
            if (colMap[normalized] !== undefined) return colMap[normalized];
            const found = Object.keys(colMap).find(k => k.includes(normalized) || normalized.includes(k));
            if (found !== undefined) return colMap[found];
          }
          return -1;
        };

        const iHoTen = findCol('HỌ VÀ TÊN', 'HO VA TEN', 'HỌ TÊN', 'HO TEN');
        const iMaNV = findCol('MÃ NV', 'MA NV', 'MÃ NHÂN VIÊN', 'MA NHAN VIEN', 'MANV');
        const iCCCD = findCol('CCCD', 'SỐ CCCD', 'SO CCCD', 'CMND', 'CCCD/CMND');
        const iSDT = findCol('SỐ ĐIỆN THOẠI', 'SO DIEN THOAI', 'SĐT', 'SDT', 'ĐIỆN THOẠI', 'DIEN THOAI');
        const iDay = findCol('DÃY', 'DAY', 'DÃY NHÀ', 'DAY NHA');
        const iPhong = findCol('PHÒNG SỐ', 'PHONG SO', 'PHÒNG', 'PHONG', 'SỐ PHÒNG', 'SO PHONG');
        const iNgaySinh = findCol('NGÀY SINH', 'NGAY SINH', 'NS');
        const iQueQuan = findCol('HỘ KHẨU (TỈNH/TP)', 'HO KHAU (TINH/TP)', 'HỘ KHẨU', 'HO KHAU', 'TỈNH/TP', 'TINH/TP', 'QUÊ QUÁN', 'QUE QUAN');
        const iToTruong = findCol('TỔ TRƯỞNG', 'TO TRUONG');
        const iSdtToTruong = findCol('SĐT TỔ TRƯỞNG', 'SDT TO TRUONG', 'SĐT TỔ TRƯỞNG');
        const iNgayVao = findCol('NGÀY VÀO KTX', 'NGAY VAO KTX', 'NGÀY VÀO', 'NGAY VAO');
        const iGhiChu = findCol('GHI CHÚ', 'GHI CHU', 'GHICHU');
        const iKtx = findCol('KTX', 'KÝ TÚC XÁ', 'KY TUC XA', 'KÝ TÚC XÁ', 'KTX_NAME');
        const iGioiTinh = findCol('GIỚI TÍNH', 'GIOI TINH', 'GIOITINH', 'GENDER', 'GT');
        const iDonVi = findCol('ĐƠN VỊ', 'DON VI', 'DONVI', 'NHÀ THẦU', 'NHA THAU', 'UNIT');
        const iTieuDoan = findCol('TIỂU ĐOÀN', 'TIEU DOAN', 'TRUNG ĐOÀN', 'TRUNG DOAN', 'TIEUDOAN');
        const iGiuong = findCol('SỐ GIƯỜNG', 'SO GIUONG', 'GIƯỜNG', 'GIUONG', 'BED', 'GIƯỜNG SỐ');

        const foundKtxCol = iKtx >= 0;
        setHasKtxColumn(foundKtxCol);

        const dataRows: ParsedWorkerRow[] = [];
        for (let i = headerRowIndex + 1; i < rawAoA.length; i++) {
          const row = rawAoA[i] as unknown[];
          const hoTen = iHoTen >= 0 ? cellToString(row[iHoTen]) : '';
          if (!hoTen) continue;

          let cccdRaw = iCCCD >= 0 ? cellToString(row[iCCCD]) : '';
          if (cccdRaw && /^\d+$/.test(cccdRaw) && cccdRaw.length < 12) {
            cccdRaw = cccdRaw.padStart(12, '0');
          }

          let sdtRaw = iSDT >= 0 ? cellToString(row[iSDT]) : '';
          if (sdtRaw && /^\d+$/.test(sdtRaw) && !sdtRaw.startsWith('0') && sdtRaw.length === 9) {
            sdtRaw = '0' + sdtRaw;
          }

          let sdtTTRaw = iSdtToTruong >= 0 ? cellToString(row[iSdtToTruong]) : '';
          if (sdtTTRaw && /^\d+$/.test(sdtTTRaw) && !sdtTTRaw.startsWith('0') && sdtTTRaw.length === 9) {
            sdtTTRaw = '0' + sdtTTRaw;
          }

          const parseExcelDate = (val: unknown): string => {
            if (!val) return '';
            const s = cellToString(val);
            if (!s) return '';
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
              return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
            }
            return s;
          };

          const ktxFromExcel = foundKtxCol ? normalizeKtxValue(cellToString(row[iKtx])) : '';

          dataRows.push({
            hoTen,
            maCongNhan: iMaNV >= 0 ? cellToString(row[iMaNV]) : '',
            soCCCD: cccdRaw,
            soDienThoai: sdtRaw,
            dayNha: iDay >= 0 ? cellToString(row[iDay]) : '',
            soPhong: iPhong >= 0 ? cellToString(row[iPhong]) : '',
            ngaySinh: iNgaySinh >= 0 ? parseExcelDate(row[iNgaySinh]) : '',
            queQuan: iQueQuan >= 0 ? cellToString(row[iQueQuan]) : '',
            toTruong: iToTruong >= 0 ? cellToString(row[iToTruong]) : '',
            sdtToTruong: sdtTTRaw,
            ngayVao: iNgayVao >= 0 ? parseExcelDate(row[iNgayVao]) : '',
            ghiChu: iGhiChu >= 0 ? cellToString(row[iGhiChu]) : '',
            ktxFromExcel,
            gioiTinh: iGioiTinh >= 0 ? cellToString(row[iGioiTinh]) : '',
            donVi: iDonVi >= 0 ? cellToString(row[iDonVi]) : '',
            tieuDoan: iTieuDoan >= 0 ? cellToString(row[iTieuDoan]) : '',
            giuong: iGiuong >= 0 ? cellToString(row[iGiuong]) : '',
          });
        }

        if (dataRows.length === 0) {
          setParseError('Không tìm thấy dữ liệu. Hãy kiểm tra lại cấu trúc file (tiêu đề cột phải có "HỌ VÀ TÊN").');
          return;
        }

        setParsedRows(dataRows);
        setTotal(dataRows.length);
      } catch (err) {
        setParseError(`Lỗi đọc file: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseExcelFile(file);
  };

  const getEffectiveKtx = useCallback((row: ParsedWorkerRow): string => {
    if (hasKtxColumn && row.ktxFromExcel) return row.ktxFromExcel;
    return selectedKtx || (ktxNames[0] || '');
  }, [hasKtxColumn, selectedKtx, ktxNames]);

  const rowBlacklistMatches = useMemo(() => {
    return parsedRows.map(row => {
      const res = matchBlacklistInMemory(blacklistRecords, row.soCCCD, row.maCongNhan);
      return res.isBanned ? (res.matchedRecord ?? null) : null;
    });
  }, [parsedRows, blacklistRecords]);

  const effectiveImportIndices = useMemo(() => {
    const idxs: number[] = [];
    parsedRows.forEach((_, idx) => {
      const analysis = rowAnalyses[idx];
      if (!analysis) return;
      // Blacklist Guard: always auto-skip workers in active Blacklist
      if (rowBlacklistMatches[idx]) return;
      if (dupMode === 'skip') {
        if (analysis.status === 'new') idxs.push(idx);
      } else if (dupMode === 'update') {
        if (analysis.status === 'new' || analysis.status === 'dup_system') idxs.push(idx);
      } else {
        idxs.push(idx);
      }
    });
    return idxs;
  }, [parsedRows, rowAnalyses, rowBlacklistMatches, dupMode]);

  const capacityCheck = useMemo(() => {
    const updatedExistingIds = new Set<string>();
    if (dupMode === 'update') {
      effectiveImportIndices.forEach(idx => {
        const matched = rowAnalyses[idx]?.matchedWorker;
        if (matched?.id) updatedExistingIds.add(matched.id);
      });
    }

    const existingByRoom = new Map<string, number>();
    existingWorkers.forEach(w => {
      if (updatedExistingIds.has(w.id)) return;
      if (!w.ktx || !w.day || !w.phongSo) return;
      const key = `${w.ktx.trim()}||${w.day.trim()}||${normalizeRoomLabel(w.phongSo)}`;
      existingByRoom.set(key, (existingByRoom.get(key) || 0) + 1);
    });

    const incomingByRoom = new Map<string, { ktx: string; day: string; room: string; count: number }>();
    effectiveImportIndices.forEach(idx => {
      const row = parsedRows[idx];
      const ktx = getEffectiveKtx(row).trim();
      const day = normalizeDayNha(row.dayNha).trim();
      const roomNormDisplay = normalizePhong(row.soPhong).trim();
      if (!ktx || !day || !roomNormDisplay) return;
      const key = `${ktx}||${day}||${normalizeRoomLabel(roomNormDisplay)}`;
      const cur = incomingByRoom.get(key);
      if (cur) cur.count++;
      else incomingByRoom.set(key, { ktx, day, room: roomNormDisplay, count: 1 });
    });

    const overloadedList: OverloadPreviewItem[] = [];
    const overloadedRoomKeys = new Set<string>();
    incomingByRoom.forEach((info, key) => {
      const existingCount = existingByRoom.get(key) || 0;
      const projectedCount = existingCount + info.count;
      const cap = getRoomCapacity(capacities, info.ktx, info.day, info.room) || DEFAULT_ROOM_CAPACITY;
      if (projectedCount > cap) {
        overloadedRoomKeys.add(key);
        overloadedList.push({
          ktx: info.ktx,
          day: info.day,
          room: info.room,
          existingCount,
          incomingCount: info.count,
          projectedCount,
          capacity: cap,
        });
      }
    });

    overloadedList.sort((a, b) => (b.projectedCount - b.capacity) - (a.projectedCount - a.capacity));
    return { overloadedList, overloadedRoomKeys };
  }, [effectiveImportIndices, rowAnalyses, dupMode, existingWorkers, parsedRows, getEffectiveKtx, capacities]);

  const rowDiagnostics = useMemo(() => {
    const existingGenderByRoom = new Map<string, { male: number; female: number }>();
    existingWorkers.forEach(w => {
      if (!w.ktx || !w.day || !w.phongSo) return;
      const key = `${w.ktx.trim()}||${w.day.trim()}||${normalizeRoomLabel(w.phongSo)}`;
      const entry = existingGenderByRoom.get(key) || { male: 0, female: 0 };
      const g = normalizeGender(w.gioiTinh);
      if (g === 'nam') entry.male++;
      else if (g === 'nu') entry.female++;
      existingGenderByRoom.set(key, entry);
    });

    const incomingGenderByRoom = new Map<string, { male: number; female: number }>();
    parsedRows.forEach(row => {
      const ktx = getEffectiveKtx(row).trim();
      const day = normalizeDayNha(row.dayNha).trim();
      const phong = normalizePhong(row.soPhong).trim();
      if (!ktx || !day || !phong) return;
      const key = `${ktx}||${day}||${normalizeRoomLabel(phong)}`;
      const entry = incomingGenderByRoom.get(key) || { male: 0, female: 0 };
      const g = normalizeGender(row.gioiTinh);
      if (g === 'nam') entry.male++;
      else if (g === 'nu') entry.female++;
      incomingGenderByRoom.set(key, entry);
    });

    const normalizedSavedGender = new Map<string, 'male' | 'female'>();
    Object.entries(roomGenderMap).forEach(([rawKey, val]) => {
      if (val !== 'male' && val !== 'female') return;
      const parts = rawKey.split('||');
      if (parts.length === 3) {
        normalizedSavedGender.set(
          `${parts[0].trim()}||${parts[1].trim()}||${normalizeRoomLabel(parts[2])}`,
          val
        );
      }
    });

    return parsedRows.map((row, idx) => {
      const analysis = rowAnalyses[idx];
      const ktx = getEffectiveKtx(row).trim();
      const dayNorm = normalizeDayNha(row.dayNha).trim();
      const phongNorm = normalizePhong(row.soPhong).trim();
      const roomKey = ktx && dayNorm && phongNorm ? `${ktx}||${dayNorm}||${normalizeRoomLabel(phongNorm)}` : '';
      const isOverloaded = roomKey ? capacityCheck.overloadedRoomKeys.has(roomKey) : false;

      let genderMismatch: string | null = null;
      const rowGender = normalizeGender(row.gioiTinh);
      if (roomKey && rowGender !== 'other') {
        const assigned = normalizedSavedGender.get(roomKey);
        if (assigned === 'male' && rowGender === 'nu') {
          genderMismatch = 'Lệch giới tính (Phòng Nam)';
        } else if (assigned === 'female' && rowGender === 'nam') {
          genderMismatch = 'Lệch giới tính (Phòng Nữ)';
        } else {
          const existingG = existingGenderByRoom.get(roomKey);
          if (existingG) {
            if (existingG.male > 0 && existingG.female === 0 && rowGender === 'nu') {
              genderMismatch = 'Lệch giới tính (Đang ở Nam)';
            } else if (existingG.female > 0 && existingG.male === 0 && rowGender === 'nam') {
              genderMismatch = 'Lệch giới tính (Đang ở Nữ)';
            }
          }
          if (!genderMismatch) {
            const incomingG = incomingGenderByRoom.get(roomKey);
            if (incomingG && incomingG.male > 0 && incomingG.female > 0) {
              genderMismatch = 'Trộn Nam/Nữ trong cùng phòng';
            }
          }
        }
      }

      const fieldWarnings: string[] = [];
      if (!dayNorm || !phongNorm) {
        fieldWarnings.push('Thiếu Dãy/Phòng');
      }
      if (!normDupMaNV(row.maCongNhan) && !normDupCCCD(row.soCCCD)) {
        fieldWarnings.push('Thiếu Mã NV & CCCD');
      }
      const cccdDigits = (row.soCCCD || '').replace(/\D/g, '');
      if (row.soCCCD && cccdDigits.length > 0 && cccdDigits.length !== 9 && cccdDigits.length !== 12) {
        fieldWarnings.push('CCCD chưa đúng 9/12 số');
      }
      const phoneDigits = (row.soDienThoai || '').replace(/\D/g, '');
      if (row.soDienThoai && phoneDigits.length > 0 && (phoneDigits.length < 9 || phoneDigits.length > 11)) {
        fieldWarnings.push('SĐT chưa hợp lệ');
      }

      let roomChangeNote: string | null = null;
      if (analysis?.matchedWorker && dayNorm && phongNorm) {
        const oldLoc = `${analysis.matchedWorker.day || '?'} - P.${analysis.matchedWorker.phongSo || '?'}`;
        const newLoc = `${dayNorm} - P.${phongNorm}`;
        if (oldLoc !== newLoc) {
          roomChangeNote = `Đổi phòng: ${oldLoc} → ${newLoc}`;
        }
      }

      const blacklistMatch = rowBlacklistMatches[idx] || null;
      const blacklistReason = blacklistMatch
        ? `DANH SÁCH ĐEN: ${blacklistMatch.reason}`
        : null;

      const hasWarning = Boolean(blacklistReason || genderMismatch || isOverloaded || fieldWarnings.length > 0);
      const issueReasons: string[] = [];
      if (blacklistReason) issueReasons.push(blacklistReason);
      if (analysis && analysis.status !== 'new') issueReasons.push(analysis.reason);
      if (genderMismatch) issueReasons.push(genderMismatch);
      if (isOverloaded) issueReasons.push('Phòng vượt sức chứa');
      if (fieldWarnings.length > 0) issueReasons.push(...fieldWarnings);

      return {
        blacklistReason,
        isOverloaded,
        genderMismatch,
        fieldWarnings,
        roomChangeNote,
        hasWarning,
        hasAnyIssue: Boolean(blacklistReason) || (analysis ? analysis.status !== 'new' : false) || hasWarning,
        issueReasons,
      };
    });
  }, [parsedRows, rowAnalyses, rowBlacklistMatches, existingWorkers, roomGenderMap, getEffectiveKtx, capacityCheck.overloadedRoomKeys]);

  const warningStats = useMemo(() => {
    let warningCount = 0;
    let genderMismatchCount = 0;
    let blacklistCount = 0;
    let issueExportCount = 0;
    rowDiagnostics.forEach(d => {
      if (d.hasWarning) warningCount++;
      if (d.genderMismatch) genderMismatchCount++;
      if (d.blacklistReason) blacklistCount++;
      if (d.hasAnyIssue) issueExportCount++;
    });
    return { warningCount, genderMismatchCount, blacklistCount, issueExportCount };
  }, [rowDiagnostics]);

  const filteredPreviewIndices = useMemo(() => {
    const out: number[] = [];
    parsedRows.forEach((_, idx) => {
      const analysis = rowAnalyses[idx];
      const diag = rowDiagnostics[idx];
      if (previewFilter === 'all') out.push(idx);
      else if (previewFilter === 'new' && analysis?.status === 'new') out.push(idx);
      else if (previewFilter === 'duplicate' && analysis?.status !== 'new') out.push(idx);
      else if (previewFilter === 'warning' && diag?.hasWarning) out.push(idx);
    });
    return out;
  }, [parsedRows, rowAnalyses, rowDiagnostics, previewFilter]);

  const previewTotalPages = Math.max(1, Math.ceil(filteredPreviewIndices.length / PREVIEW_PAGE_SIZE));
  const safePreviewPage = Math.min(previewPage, previewTotalPages);
  const previewIndicesPage = filteredPreviewIndices.slice(
    (safePreviewPage - 1) * PREVIEW_PAGE_SIZE,
    safePreviewPage * PREVIEW_PAGE_SIZE
  );

  const handleExportIssueRows = () => {
    const issueRows = parsedRows
      .map((row, idx) => {
        const analysis = rowAnalyses[idx];
        const diag = rowDiagnostics[idx];
        if (!diag?.hasAnyIssue) return null;
        return {
          'DÒNG': idx + 1,
          'TRẠNG THÁI': analysis?.status === 'new' ? 'Mới (Có cảnh báo)' : analysis?.reason || 'Trùng lặp',
          'CẢNH BÁO / LÝ DO': diag.issueReasons.join(' | '),
          'KTX': getEffectiveKtx(row),
          'HỌ VÀ TÊN': row.hoTen,
          'GIỚI TÍNH': row.gioiTinh,
          'MÃ NV': row.maCongNhan,
          'CCCD': row.soCCCD,
          'SĐT': row.soDienThoai,
          'DÃY': normalizeDayNha(row.dayNha),
          'PHÒNG': normalizePhong(row.soPhong),
          'SỐ GIƯỜNG': row.giuong,
          'ĐƠN VỊ': row.donVi,
          'GHI CHÚ': row.ghiChu,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (issueRows.length === 0) {
      toast.info('Không có dòng lỗi hoặc cảnh báo nào để xuất.');
      return;
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    exportToExcel(issueRows, `Dong_loi_canh_bao_import_${today}.xlsx`, 'Dong_Loi_Canh_Bao');
    toast.success(`Đã xuất ${issueRows.length} dòng lỗi/cảnh báo ra file Excel.`);
  };

  const canConfirm = parsedRows.length > 0 && effectiveImportIndices.length > 0 && (hasKtxColumn || selectedKtx !== '');

  const handleConfirm = async () => {
    if (!hasKtxColumn && selectedKtx === '') {
      toast.error('Vui lòng chọn KTX trước khi nhập dữ liệu.');
      return;
    }
    if (effectiveImportIndices.length === 0) {
      toast.warning('Không có dòng hợp lệ nào để nhập theo chế độ xử lý trùng lặp hiện tại.');
      return;
    }
    const batchTs = Date.now();
    const workersToCommit: Worker[] = effectiveImportIndices.map((idx, seq) => {
      const r = parsedRows[idx];
      const analysis = rowAnalyses[idx];
      const matched = dupMode === 'update' ? analysis?.matchedWorker : undefined;
      const ktxValue = getEffectiveKtx(r);
      const dayNorm = normalizeDayNha(r.dayNha);
      const phongNorm = normalizePhong(r.soPhong);
      return {
        id: matched?.id || `import-${batchTs}-${seq}`,
        stt: matched?.stt || 0,
        hoVaTen: r.hoTen,
        maNV: r.maCongNhan || matched?.maNV || '',
        tieuDoan: r.tieuDoan || matched?.tieuDoan || '',
        ktx: ktxValue,
        donVi: r.donVi || matched?.donVi || '',
        gioiTinh: r.gioiTinh || matched?.gioiTinh || '',
        ngaySinh: r.ngaySinh || matched?.ngaySinh || '',
        soDienThoai: r.soDienThoai || matched?.soDienThoai || '',
        day: dayNorm || matched?.day || '',
        phongSo: phongNorm || matched?.phongSo || '',
        giuong: r.giuong || matched?.giuong || '',
        cccd: r.soCCCD || matched?.cccd || '',
        hoKhauTinh: r.queQuan || matched?.hoKhauTinh || '',
        toTruong: r.toTruong || matched?.toTruong || '',
        sdtToTruong: r.sdtToTruong || matched?.sdtToTruong || '',
        ngayVaoKTX: r.ngayVao || matched?.ngayVaoKTX || '',
        ghiChu: r.ghiChu || matched?.ghiChu || '',
        khoaTraCuu: `${ktxValue}|${dayNorm || matched?.day || ''}|${phongNorm || matched?.phongSo || ''}`,
        tamTruStatus: matched?.tamTruStatus ?? ('unregistered' as const),
      };
    });

    setImporting(true);
    try {
      await onImport(workersToCommit);
      if (capacityCheck.overloadedList.length > 0) {
        toast.warning(`Lưu ý: Có ${capacityCheck.overloadedList.length} phòng vượt sức chứa sau khi nhập.`);
      }
      onClose();
    } catch {
      toast.error('Lỗi khi nhập dữ liệu. Vui lòng thử lại.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">Nhập từ Excel</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Hỗ trợ file .xlsx / .xls — Tự động nhận diện tiêu đề từ hàng 3</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="p-4 rounded-xl border-2 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={16} className="text-primary" />
              <p className="text-sm font-bold text-foreground">Chọn KTX để nhập dữ liệu <span className="text-dgr">*</span></p>
            </div>
            <div className="flex gap-3 flex-wrap">
              {ktxNames.map(ktx => (
                <label key={ktx} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all font-semibold text-sm ${selectedKtx === ktx ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/50'}`}>
                  <input type="radio" name="ktx-select" value={ktx} checked={selectedKtx === ktx} onChange={() => setSelectedKtx(ktx)} className="hidden" />
                  {ktx}
                </label>
              ))}
            </div>
            {hasKtxColumn && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-ok bg-okbg border border-ok2/35 rounded-lg px-3 py-1.5">
                <FileCheck size={12} />
                <span>File Excel có cột KTX — hệ thống sẽ ưu tiên đọc từ cột đó.</span>
              </div>
            )}
            {!hasKtxColumn && selectedKtx === '' && parsedRows.length > 0 && (
              <p className="mt-2 text-xs text-dgr font-semibold">⚠ Vui lòng chọn KTX trước khi xác nhận nhập.</p>
            )}
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'}`}
          >
            <Upload size={32} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Kéo thả file vào đây</p>
            <p className="text-xs text-muted-foreground mt-1">hoặc click để chọn file · Hỗ trợ .xlsx và .xls</p>
            {fileName && <p className="text-xs text-primary mt-2 font-semibold">📄 {fileName}</p>}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) parseExcelFile(f); }}
            />
          </div>

          <div className="p-3 rounded-lg tint-info border border-bdr2">
            <div className="flex items-start gap-2">
              <FileText size={14} className="text-lnk mt-0.5 flex-shrink-0" />
              <div className="text-xs text-lnk space-y-0.5">
                <p className="font-semibold">Cột được nhận diện tự động:</p>
                <p className="text-tx/85">KTX · HỌ VÀ TÊN · MÃ NV · GIỚI TÍNH · ĐƠN VỊ · TIỂU ĐOÀN · CCCD · SỐ ĐIỆN THOẠI · DÃY · PHÒNG SỐ · SỐ GIƯỜNG · NGÀY SINH · HỘ KHẨU · TỔ TRƯỞNG · SĐT TỔ TRƯỞNG · NGÀY VÀO KTX · GHI CHÚ</p>
              </div>
            </div>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg tint-dgr border border-dgr/35">
              <AlertCircle size={14} className="text-dgr mt-0.5 flex-shrink-0" />
              <p className="text-xs text-dgr">{parseError}</p>
            </div>
          )}

          {parsedRows.length > 0 && (
            <div className="space-y-3">
              {/* Smart diagnostics summary */}
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-okbg text-ok text-xs font-bold border border-ok2/35">
                      ✓ Đọc {total} dòng · Mới hợp lệ: {dupStats.newCount}
                    </span>
                    {dupStats.sysDupCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md tint-wn text-wn text-xs font-bold border border-wn/40">
                        <AlertTriangle size={12} /> Trùng hệ thống: {dupStats.sysDupCount}
                      </span>
                    )}
                    {dupStats.fileDupCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md tint-wn text-wn text-xs font-bold border border-wn/40">
                        <AlertCircle size={12} /> Trùng trong file: {dupStats.fileDupCount}
                      </span>
                    )}
                    {capacityCheck.overloadedList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowOverloadDetails(v => !v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md tint-dgr text-dgr text-xs font-bold border border-dgr/40 hover:opacity-90 transition-opacity"
                      >
                        <AlertTriangle size={12} />
                        <span>Cảnh báo quá tải: {capacityCheck.overloadedList.length} phòng</span>
                      </button>
                    )}
                    {warningStats.blacklistCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-dgr text-white text-xs font-extrabold shadow-sm">
                        <ShieldAlert size={12} /> Chặn Blacklist: {warningStats.blacklistCount} (tự động bỏ qua)
                      </span>
                    )}
                    {warningStats.genderMismatchCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md tint-dgr text-dgr text-xs font-bold border border-dgr/40">
                        <AlertTriangle size={12} /> Lệch giới tính: {warningStats.genderMismatchCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {warningStats.issueExportCount > 0 && (
                      <button
                        type="button"
                        onClick={handleExportIssueRows}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-dgr/40 text-dgr hover:bg-dgrbg text-xs font-semibold transition-colors cursor-pointer"
                        title="Tải về file Excel chỉ chứa các dòng trùng lặp hoặc có cảnh báo để kiểm tra lại"
                      >
                        <Download size={12} />
                        <span>Xuất {warningStats.issueExportCount} dòng lỗi/cảnh báo</span>
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground font-tabular">(Trang {safePreviewPage}/{previewTotalPages})</span>
                  </div>
                </div>

                {/* Preview filter tabs */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {([
                    { id: 'all', label: 'Tất cả', count: total },
                    { id: 'new', label: 'Mới hợp lệ', count: dupStats.newCount },
                    { id: 'duplicate', label: 'Trùng lặp', count: dupStats.sysDupCount + dupStats.fileDupCount },
                    { id: 'warning', label: 'Cảnh báo', count: warningStats.warningCount },
                  ] as { id: ImportPreviewFilter; label: string; count: number }[]).map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setPreviewFilter(tab.id);
                        setPreviewPage(1);
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        previewFilter === tab.id
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-tabular ${
                        previewFilter === tab.id ? 'bg-white/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Duplicate resolution options */}
                {(dupStats.sysDupCount > 0 || dupStats.fileDupCount > 0) && (
                  <div className="pt-2 border-t border-border/70 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                    <span className="text-xs font-semibold text-foreground">Xử lý dòng trùng Mã NV / CCCD:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { id: 'skip', label: 'Bỏ qua dòng trùng (Khuyến nghị)' },
                        { id: 'update', label: 'Cập nhật ghi đè hồ sơ cũ' },
                        { id: 'add_all', label: 'Vẫn thêm mới tất cả' },
                      ] as { id: DuplicateResolutionMode; label: string }[]).map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDupMode(opt.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                            dupMode === opt.id
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card text-foreground border-border hover:border-primary/50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expandable overloaded rooms preview */}
                {capacityCheck.overloadedList.length > 0 && showOverloadDetails && (
                  <div className="pt-2 border-t border-dgr/30 space-y-1.5 max-h-36 overflow-y-auto">
                    <p className="text-xs font-semibold text-dgr">
                      Các phòng dự kiến vượt định mức giường (hệ thống vẫn cho phép lưu nếu cần thiết):
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {capacityCheck.overloadedList.map((item, idx) => (
                        <div key={idx} className="text-xs px-2.5 py-1.5 rounded-lg tint-dgr border border-dgr/35 text-dgr flex items-center justify-between">
                          <span className="font-semibold">{item.ktx} · {item.day} · P.{item.room}</span>
                          <span className="font-tabular font-bold">
                            {item.existingCount}+{item.incomingCount} = {item.projectedCount}/{item.capacity}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap w-8">#</th>
                      {PREVIEW_HEADERS.map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewIndicesPage.length === 0 ? (
                      <tr>
                        <td colSpan={PREVIEW_HEADERS.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                          Không có dòng nào thuộc bộ lọc này.
                        </td>
                      </tr>
                    ) : (
                      previewIndicesPage.map((absIdx) => {
                        const row = parsedRows[absIdx];
                        const analysis = rowAnalyses[absIdx];
                        const diag = rowDiagnostics[absIdx];
                        const effectiveKtx = getEffectiveKtx(row);
                        const dayNorm = normalizeDayNha(row.dayNha);
                        const phongNorm = normalizePhong(row.soPhong);
                        const willSkip =
                          Boolean(diag?.blacklistReason) ||
                          (dupMode === 'skip' && analysis?.status !== 'new') ||
                          (dupMode === 'update' && analysis?.status === 'dup_in_file');

                        return (
                          <tr key={absIdx} className={`border-t border-border hover:bg-muted/20 ${diag?.blacklistReason ? 'tint-dgr/40' : ''} ${willSkip ? 'opacity-65' : ''}`}>
                            <td className="px-2 py-1.5 text-muted-foreground font-tabular">{absIdx + 1}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <div className="flex items-center gap-1 flex-wrap max-w-[230px]">
                                {diag?.blacklistReason ? (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-dgr text-white" title={diag.blacklistReason}>
                                    BLACKLIST · Bỏ qua
                                  </span>
                                ) : analysis?.status === 'new' ? (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-okbg text-ok border border-ok2/35">Mới</span>
                                ) : analysis?.status === 'dup_system' ? (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tint-wn text-wn border border-wn/40" title={diag?.roomChangeNote || analysis.reason}>
                                    {analysis.reason}
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tint-wn text-wn border border-wn/40" title={analysis?.reason}>
                                    Trùng file
                                  </span>
                                )}
                                {diag?.roomChangeNote && dupMode === 'update' && (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-bdg text-lnk border border-bdr2" title={diag.roomChangeNote}>
                                    Đổi phòng
                                  </span>
                                )}
                                {diag?.genderMismatch && !willSkip && (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tint-dgr text-dgr border border-dgr/40" title={diag.genderMismatch}>
                                    Lệch GT
                                  </span>
                                )}
                                {diag?.isOverloaded && !willSkip && (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tint-dgr text-dgr border border-dgr/40" title="Phòng sẽ quá tải">
                                    Quá tải
                                  </span>
                                )}
                                {diag?.fieldWarnings && diag.fieldWarnings.length > 0 && (
                                  <span
                                    className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tint-wn text-wn border border-wn/40"
                                    title={diag.fieldWarnings.join(' · ')}
                                  >
                                    {diag.fieldWarnings[0]}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                                {effectiveKtx || '—'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-foreground font-medium whitespace-nowrap max-w-[160px] truncate">{row.hoTen || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.gioiTinh || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.maCongNhan || '—'}</td>
                            <td className="px-2 py-1.5 font-tabular text-foreground whitespace-nowrap">{row.soCCCD || '—'}</td>
                            <td className="px-2 py-1.5 font-tabular text-foreground whitespace-nowrap">{row.soDienThoai || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{dayNorm || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{phongNorm || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.ngaySinh || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[120px] truncate">{row.queQuan || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[120px] truncate">{row.toTruong || '—'}</td>
                            <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.ngayVao || '—'}</td>
                            <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap max-w-[100px] truncate">{row.ghiChu || '—'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {previewTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <button onClick={() => setPreviewPage(p => Math.max(1, p - 1))} disabled={safePreviewPage === 1} className="p-1 rounded hover:bg-muted disabled:opacity-40">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-muted-foreground font-tabular">{safePreviewPage} / {previewTotalPages}</span>
                  <button onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))} disabled={safePreviewPage === previewTotalPages} className="p-1 rounded hover:bg-muted disabled:opacity-40">
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-muted-foreground">
            {total > 0 ? (
              <span className={effectiveImportIndices.length > 0 ? 'text-ok font-semibold' : 'text-wn font-semibold'}>
                {effectiveImportIndices.length > 0
                  ? `${effectiveImportIndices.length}/${total} công nhân sẽ được ${dupMode === 'update' ? 'thêm / cập nhật' : 'nhập'}`
                  : 'Không có dòng nào sẽ được nhập (tất cả bị trùng đang ở chế độ Bỏ qua)'}
              </span>
            ) : 'Chưa có file nào được chọn'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-xs" disabled={importing}>Hủy</button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || importing}
              className="btn-primary text-xs disabled:opacity-50"
            >
              <FileCheck size={14} />
              {importing ? 'Đang nhập...' : `Xác nhận nhập ${effectiveImportIndices.length > 0 ? `${effectiveImportIndices.length} công nhân` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Bulk Assign KTX Modal
function BulkAssignKtxModal({
  workers,
  onClose,
  onAssign,
}: {
  workers: Worker[];
  onClose: () => void;
  onAssign: (ids: string[], ktx: string) => Promise<void>;
}) {
  const { ktxNames } = useKtxStructure();
  const noKtxWorkers = useMemo(
    () =>
      workers.filter(
        w =>
          (!w.ktx || w.ktx.trim() === '') &&
          !w.ngayRaKTX &&
          !w.ghiChu?.includes('[Đã Check-out') &&
          !w.ghiChu?.includes('[CHECKOUT]')
      ),
    [workers]
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(noKtxWorkers.map(w => w.id)));
  const [targetKtx, setTargetKtx] = useState<string>(() => ktxNames[0] || '');
  const [assigning, setAssigning] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (ktxNames.length > 0 && (!targetKtx || !ktxNames.includes(targetKtx))) {
      setTargetKtx(ktxNames[0]);
    }
  }, [ktxNames, targetKtx]);

  const totalPages = Math.ceil(noKtxWorkers.length / PAGE_SIZE);
  const pageRows = noKtxWorkers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleAll = () => {
    if (selectedIds.size === noKtxWorkers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(noKtxWorkers.map(w => w.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAssign = async () => {
    if (selectedIds.size === 0) {
      toast.error('Chưa chọn công nhân nào.');
      return;
    }
    setAssigning(true);
    try {
      await onAssign(Array.from(selectedIds), targetKtx);
      toast.success(`Đã gán ${selectedIds.size} công nhân về ${targetKtx}`);
      onClose();
    } catch (err) {
      toast.error(`Lỗi: ${err instanceof Error ? err.message : 'Không thể cập nhật'}`);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <CheckSquare size={18} className="text-primary" />
              Gán nhanh KTX cho công nhân chưa có KTX
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{noKtxWorkers.length} công nhân chưa được gán KTX</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="p-4 rounded-xl border-2 border-primary/30 bg-primary/5">
            <p className="text-sm font-bold text-foreground mb-3">Gán về KTX:</p>
            <div className="flex gap-3 flex-wrap">
              {ktxNames.map(ktx => (
                <label key={ktx} className={`flex items-center gap-2 px-5 py-2.5 rounded-lg border-2 cursor-pointer transition-all font-bold text-sm ${targetKtx === ktx ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/50'}`}>
                  <input type="radio" name="bulk-ktx" value={ktx} checked={targetKtx === ktx} onChange={() => setTargetKtx(ktx)} className="hidden" />
                  {ktx}
                </label>
              ))}
            </div>
          </div>

          {noKtxWorkers.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckSquare size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-semibold">Tất cả công nhân đã có KTX!</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === noKtxWorkers.length && noKtxWorkers.length > 0}
                    onChange={toggleAll}
                    className="w-4 h-4 accent-primary rounded"
                  />
                  <span className="text-sm font-semibold text-foreground">Chọn tất cả ({noKtxWorkers.length} công nhân)</span>
                </label>
                <span className="text-xs text-muted-foreground">Đã chọn: {selectedIds.size}</span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Họ và Tên</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Mã NV</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Dãy</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Phòng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((w, i) => (
                      <tr key={w.id} className={`border-t border-border hover:bg-muted/20 ${selectedIds.has(w.id) ? 'bg-primary/5' : ''}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(w.id)}
                            onChange={() => toggleOne(w.id)}
                            className="w-4 h-4 accent-primary rounded"
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2 font-medium text-foreground max-w-[180px] truncate">{w.hoVaTen}</td>
                        <td className="px-3 py-2 text-foreground">{w.maNV || '—'}</td>
                        <td className="px-3 py-2 text-foreground">{w.day || '—'}</td>
                        <td className="px-3 py-2 text-foreground">{w.phongSo || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-muted disabled:opacity-40"><ChevronLeft size={14} /></button>
                  <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 rounded hover:bg-muted disabled:opacity-40"><ChevronRight size={14} /></button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-muted-foreground">
            {selectedIds.size > 0 ? (
              <span className="text-primary font-semibold">Sẽ gán {selectedIds.size} công nhân → {targetKtx}</span>
            ) : 'Chưa chọn công nhân nào'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-xs" disabled={assigning}>Hủy</button>
            <button
              onClick={handleAssign}
              disabled={selectedIds.size === 0 || assigning || noKtxWorkers.length === 0}
              className="btn-primary text-xs disabled:opacity-50"
            >
              <CheckSquare size={14} />
              {assigning ? 'Đang gán...' : `Gán ${selectedIds.size} công nhân về ${targetKtx}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// TamTru Export Modal
function TamTruExportModal({ workers, onClose }: { workers: Worker[]; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'unregistered'>('all');

  const handleExport = () => {
    let list = filter === 'all' ? workers : workers.filter(w => w.tamTruStatus !== 'registered');
    const data = list.map(w => ({
      'Họ và tên': w.hoVaTen,
      'Ngày sinh': w.ngaySinh,
      'CCCD': w.cccd,
      'SĐT': w.soDienThoai,
      'Quê quán': w.hoKhauTinh,
      'KTX': w.ktx,
      'Dãy': w.day,
      'Phòng': w.phongSo,
      'Ngày vào KTX': w.ngayVaoKTX,
      'Trạng thái tạm trú': w.tamTruStatus === 'registered' ? 'Đã đăng ký' : 'Chưa đăng ký',
    }));
    const vnDate = formatDateVN(nowVN()).replace(/\//g, '-');
    const fileName = `KTX_TamTru_${filter === 'all' ? 'TatCa' : 'ChuaDangKy'}_${vnDate}.xlsx`;
    exportToExcel(data, fileName, 'Tạm trú');
    toast.success(`Đã xuất ${data.length} bản ghi tạm trú`);
    onClose();
  };

  const unregisteredCount = workers.filter(w => w.tamTruStatus !== 'registered').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">Xuất file Tạm Trú (Excel)</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">Chọn danh sách cần xuất (theo bộ lọc hiện tại):</p>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/30">
            <input type="radio" name="tamtru-filter" value="all" checked={filter === 'all'} onChange={() => setFilter('all')} className="accent-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Tất cả (theo bộ lọc)</p>
              <p className="text-xs text-muted-foreground">{workers.length} bản ghi</p>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/30">
            <input type="radio" name="tamtru-filter" value="unregistered" checked={filter === 'unregistered'} onChange={() => setFilter('unregistered')} className="accent-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Chỉ &quot;Chưa đăng ký&quot; (theo bộ lọc)</p>
              <p className="text-xs text-muted-foreground">{unregisteredCount} bản ghi</p>
            </div>
          </label>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-xs">Hủy</button>
          <button onClick={handleExport} className="btn-primary text-xs">
            <FileCheck size={14} />Xuất Excel
          </button>
        </div>
      </div>
    </div>
  );
}

// Delete All Confirm Modal
function DeleteAllConfirmModal({ onConfirm, onClose, loading }: { onConfirm: () => void; onClose: () => void; loading?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="surface-elevated rounded-2xl shadow-2xl w-full max-w-md border border-dgr/40 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-dgr/25 tint-dgr">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl craft-icon-rose flex items-center justify-center">
            <AlertCircle size={20} />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-dgr">CẢNH BÁO: Xóa toàn bộ dữ liệu</h2>
            <p className="text-xs text-mu">Hành động này không thể hoàn tác</p>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-tx font-medium">
            Bạn có chắc chắn muốn xóa <span className="text-dgr font-bold">TOÀN BỘ</span> danh sách công nhân hiện tại không?
          </p>
          <div className="tint-dgr border border-dgr/35 rounded-xl p-3">
            <p className="text-xs text-dgr font-bold">Hành động này không thể hoàn tác!</p>
            <ul className="mt-1 text-xs text-mu space-y-0.5 list-disc list-inside">
              <li>Toàn bộ dữ liệu công nhân sẽ bị xóa vĩnh viễn</li>
              <li>Dữ liệu trên Supabase sẽ bị xóa hoàn toàn</li>
              <li>Bạn sẽ cần Import lại từ file Excel mới</li>
            </ul>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-bdr flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="btn-secondary text-sm">Hủy bỏ</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-dgr hover:opacity-90 text-white text-sm font-semibold transition-opacity disabled:opacity-60 cursor-pointer"
          >
            <Trash2 size={14} />
            {loading ? 'Đang xóa...' : 'Đồng ý xóa'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Delete by Filter Modal ───────────────────────────────────────────
function BulkDeleteByFilterModal({
  workers,
  onClose,
  onDelete,
}: {
  workers: Worker[];
  onClose: () => void;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const [filterType, setFilterType] = useState<'ktx' | 'day' | 'phong'>('ktx');
  const [selKtx, setSelKtx] = useState('');
  const [selDay, setSelDay] = useState('');
  const [selPhong, setSelPhong] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const ktxList = [...new Set(workers.map(w => w.ktx).filter(Boolean))].sort();
  const dayList = useMemo(() => {
    let base = selKtx ? workers.filter(w => w.ktx === selKtx) : workers;
    return [...new Set(base.map(w => w.day).filter(Boolean))].sort();
  }, [workers, selKtx]);
  const phongList = useMemo(() => {
    let base = workers;
    if (selKtx) base = base.filter(w => w.ktx === selKtx);
    if (selDay) base = base.filter(w => w.day === selDay);
    return [...new Set(base.map(w => w.phongSo).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  }, [workers, selKtx, selDay]);

  const targetWorkers = useMemo(() => {
    let list = workers;
    if (filterType === 'ktx') {
      if (!selKtx) return [];
      list = list.filter(w => w.ktx === selKtx);
    } else if (filterType === 'day') {
      if (!selKtx || !selDay) return [];
      list = list.filter(w => w.ktx === selKtx && w.day === selDay);
    } else {
      if (!selKtx || !selDay || !selPhong) return [];
      list = list.filter(w => w.ktx === selKtx && w.day === selDay && w.phongSo === selPhong);
    }
    return list;
  }, [workers, filterType, selKtx, selDay, selPhong]);

  const handleDelete = async () => {
    if (targetWorkers.length === 0) return;
    setDeleting(true);
    try {
      await onDelete(targetWorkers.map(w => w.id));
      toast.success(`Đã xóa ${targetWorkers.length} công nhân`);
      onClose();
    } catch (err) {
      toast.error(`Lỗi xóa: ${err instanceof Error ? err.message : 'Không thể xóa'}`);
    } finally {
      setDeleting(false);
    }
  };

  const filterLabel = filterType === 'ktx' ? (selKtx ||'—')
    : filterType === 'day'
    ? `${selKtx || '—'} · ${selDay || '—'}`
    : `${selKtx || '—'} · ${selDay || '—'} · P.${selPhong || '—'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="surface-elevated rounded-2xl shadow-2xl w-full max-w-lg border border-dgr/40 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-dgr/25 tint-dgr">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl craft-icon-rose flex items-center justify-center">
            <Trash2 size={20} />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-dgr">Xóa hàng loạt theo bộ lọc</h2>
            <p className="text-xs text-mu">Chỉ Admin mới có quyền thực hiện</p>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-lg text-mu hover:text-tx hover:bg-act"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Filter type */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Xóa theo:</p>
            <div className="flex gap-2">
              {(['ktx', 'day', 'phong'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setFilterType(t); setConfirmed(false); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filterType === t ? 'bg-dgr text-white border-dgr' : 'bg-surf text-tx border-bdr hover:border-dgr/40'}`}
                >
                  {t === 'ktx' ? 'Theo KTX' : t === 'day' ? 'Theo Dãy' : 'Theo Phòng'}
                </button>
              ))}
            </div>
          </div>

          {/* Selectors */}
          <div className="flex flex-wrap gap-3">
            <div className="form-group min-w-[130px]">
              <label className="label-field">KTX <span className="text-dgr">*</span></label>
              <select value={selKtx} onChange={e => { setSelKtx(e.target.value); setSelDay(''); setSelPhong(''); setConfirmed(false); }} className="input-field">
                <option value="">Chọn KTX</option>
                {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {(filterType === 'day' || filterType === 'phong') && (
              <div className="form-group min-w-[130px]">
                <label className="label-field">Dãy <span className="text-dgr">*</span></label>
                <select value={selDay} onChange={e => { setSelDay(e.target.value); setSelPhong(''); setConfirmed(false); }} className="input-field" disabled={!selKtx}>
                  <option value="">Chọn Dãy</option>
                  {dayList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            {filterType === 'phong' && (
              <div className="form-group min-w-[110px]">
                <label className="label-field">Phòng <span className="text-dgr">*</span></label>
                <select value={selPhong} onChange={e => { setSelPhong(e.target.value); setConfirmed(false); }} className="input-field" disabled={!selDay}>
                  <option value="">Chọn Phòng</option>
                  {phongList.map(p => <option key={p} value={p}>P.{p}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Preview count */}
          {targetWorkers.length > 0 && (
            <div className="p-3 rounded-xl tint-dgr border border-dgr/35">
              <p className="text-sm font-semibold text-dgr">
                Sẽ xóa <span className="text-xl font-bold font-tabular">{targetWorkers.length}</span> công nhân thuộc {filterLabel}
              </p>
              <p className="text-xs text-mu mt-1">⚠ Hành động này không thể hoàn tác!</p>
            </div>
          )}
          {targetWorkers.length === 0 && selKtx && (
            <p className="text-xs text-muted-foreground">Không có công nhân nào phù hợp với bộ lọc đã chọn.</p>
          )}

          {/* Confirm checkbox */}
          {targetWorkers.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="w-4 h-4 accent-red-600 rounded"
              />
              <span className="text-sm text-foreground">
                Tôi xác nhận muốn xóa <strong>{targetWorkers.length}</strong> công nhân thuộc <strong>{filterLabel}</strong>
              </span>
            </label>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} disabled={deleting} className="btn-secondary text-sm">Hủy</button>
          <button
            onClick={handleDelete}
            disabled={!confirmed || targetWorkers.length === 0 || deleting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-dgr hover:opacity-90 text-white text-sm font-semibold transition-opacity disabled:opacity-50 cursor-pointer"
          >
            <Trash2 size={14} />
            {deleting ? 'Đang xóa...' : `Xóa ${targetWorkers.length} công nhân`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Transfer Workers Modal (Room / Building / Battalion) ───────────────
function BulkTransferWorkersModal({
  selectedWorkers,
  allWorkers,
  roomCapacities,
  onClose,
  onTransfer,
  isAdmin,
  canWriteBlock,
}: {
  selectedWorkers: Worker[];
  allWorkers: Worker[];
  roomCapacities: RoomCapacityMap;
  onClose: () => void;
  onTransfer: (target: {
    ktx: string;
    day: string;
    phongSo: string;
    tieuDoanMode: 'keep' | 'clear' | 'set';
    tieuDoan: string;
  }) => Promise<void>;
  isAdmin: boolean;
  canWriteBlock: (day: string, ktx?: string) => boolean;
}) {
  const { ktxGroups, ktxNames } = useKtxStructure();

  const ktxOptions = useMemo(() => {
    const set = new Set<string>(ktxNames);
    allWorkers.forEach(w => { if (w.ktx?.trim()) set.add(w.ktx.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [ktxNames, allWorkers]);

  const authorizedSelected = useMemo(
    () => selectedWorkers.filter(w => isAdmin || canWriteBlock(w.day, w.ktx)),
    [selectedWorkers, isAdmin, canWriteBlock]
  );
  const skippedCount = selectedWorkers.length - authorizedSelected.length;

  const [targetKtx, setTargetKtx] = useState<string>(() => ktxOptions[0] || 'KTX Phước Vĩnh Tây');
  const [targetDay, setTargetDay] = useState<string>('');
  const [targetRoom, setTargetRoom] = useState<string>('');
  const [tieuDoanMode, setTieuDoanMode] = useState<'keep' | 'clear' | 'set'>('keep');
  const [targetTieuDoan, setTargetTieuDoan] = useState<string>('8');
  const [submitting, setSubmitting] = useState(false);

  const dayOptions = useMemo(() => {
    const set = new Set<string>();
    const group = ktxGroups.find(g => g.ktx === targetKtx);
    if (group) {
      group.blocks.forEach(b => {
        const d = b.includes(' - ') ? b.split(' - ').slice(1).join(' - ').trim() : b;
        if (d) set.add(d);
      });
    }
    allWorkers.forEach(w => {
      if (w.ktx === targetKtx && w.day?.trim()) set.add(w.day.trim());
    });
    return [...set]
      .filter(d => isAdmin || canWriteBlock(d, targetKtx))
      .sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [ktxGroups, allWorkers, targetKtx, isAdmin, canWriteBlock]);

  useEffect(() => {
    if (dayOptions.length > 0 && (!targetDay || !dayOptions.includes(targetDay))) {
      setTargetDay(dayOptions[0]);
    }
  }, [dayOptions, targetDay]);

  const roomOptions = useMemo(() => {
    const set = new Set<string>();
    allWorkers.forEach(w => {
      if (w.ktx === targetKtx && w.day === targetDay && w.phongSo?.trim()) {
        set.add(w.phongSo.trim());
      }
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [allWorkers, targetKtx, targetDay]);

  const currentTargetCount = useMemo(() => {
    if (!targetKtx || !targetDay || !targetRoom.trim()) return 0;
    const normR = normalizePhong(targetRoom.trim());
    const authIds = new Set(authorizedSelected.map(w => w.id));
    return allWorkers.filter(
      w =>
        !authIds.has(w.id) &&
        w.ktx === targetKtx &&
        w.day === targetDay &&
        normalizePhong(w.phongSo) === normR
    ).length;
  }, [allWorkers, authorizedSelected, targetKtx, targetDay, targetRoom]);

  const targetCapacity = useMemo(() => {
    if (!targetKtx || !targetDay || !targetRoom.trim()) return DEFAULT_ROOM_CAPACITY;
    return getRoomCapacity(roomCapacities, targetKtx, targetDay, targetRoom.trim()) || DEFAULT_ROOM_CAPACITY;
  }, [roomCapacities, targetKtx, targetDay, targetRoom]);

  const projectedCount = currentTargetCount + authorizedSelected.length;
  const targetAuthorized = isAdmin || (targetDay.trim() ? canWriteBlock(targetDay.trim(), targetKtx.trim()) : false);
  const canSubmit =
    authorizedSelected.length > 0 &&
    Boolean(targetKtx.trim() && targetDay.trim() && targetRoom.trim()) &&
    targetAuthorized &&
    !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onTransfer({
        ktx: targetKtx.trim(),
        day: targetDay.trim(),
        phongSo: targetRoom.trim(),
        tieuDoanMode,
        tieuDoan: targetTieuDoan.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 fade-in">
      <div className="modal-enter bg-card border border-border rounded-2xl shadow-modal w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk">
              <ArrowRightLeft size={17} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Chuyển phòng / Dãy / Tiểu đoàn hàng loạt</h2>
              <p className="text-xs text-muted-foreground">Áp dụng cho {selectedWorkers.length} công nhân đã chọn</p>
            </div>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {skippedCount > 0 && (
            <div className="p-3 rounded-xl tint-wn border border-wn text-xs text-wn">
              Có <strong>{skippedCount}</strong> công nhân thuộc khu vực ngoài phạm vi phụ trách sẽ được bỏ qua. Chỉ chuyển <strong>{authorizedSelected.length}</strong> công nhân hợp lệ.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">KTX đích *</label>
              <select
                value={targetKtx}
                onChange={e => { setTargetKtx(e.target.value); setTargetDay(''); }}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
              >
                {ktxOptions.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Dãy đích *</label>
              {dayOptions.length > 0 ? (
                <select
                  value={targetDay}
                  onChange={e => setTargetDay(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                >
                  {dayOptions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : (
                <input
                  value={targetDay}
                  onChange={e => setTargetDay(e.target.value)}
                  placeholder="VD: Dãy 1"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Phòng đích * (chọn nhanh hoặc nhập tên phòng)</label>
            <input
              list="bulk-transfer-room-list"
              value={targetRoom}
              onChange={e => setTargetRoom(e.target.value)}
              placeholder="VD: Phòng 1 hoặc 1"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
            />
            <datalist id="bulk-transfer-room-list">
              {roomOptions.map(r => <option key={r} value={r} />)}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Tiểu đoàn</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'keep', label: 'Giữ nguyên' },
                { value: 'set', label: 'Gán TĐ mới' },
                { value: 'clear', label: 'Xóa TĐ' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTieuDoanMode(opt.value)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-colors ${
                    tieuDoanMode === opt.value
                      ? 'bg-bdg text-lnk border-bdr2'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {tieuDoanMode === 'set' && (
              <input
                value={targetTieuDoan}
                onChange={e => setTargetTieuDoan(e.target.value)}
                placeholder="VD: 8, 111, 113..."
                className="mt-2 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
              />
            )}
          </div>

          {targetRoom.trim() && targetDay.trim() && (
            <div className={`p-3 rounded-xl border text-xs space-y-1 ${
              projectedCount > targetCapacity
                ? 'tint-wn border-wn text-wn'
                : 'bg-muted/40 border-border text-muted-foreground'
            }`}>
              <p>
                Phòng đích <strong className="text-foreground">{targetKtx} · {targetDay} · {targetRoom}</strong> hiện có{' '}
                <strong className="text-foreground font-tabular">{currentTargetCount}</strong> người → sau khi chuyển:{' '}
                <strong className="font-tabular">{projectedCount}/{targetCapacity}</strong> người.
              </p>
              {projectedCount > targetCapacity && (
                <p className="font-semibold">⚠ Sẽ vượt định mức giường của phòng ({targetCapacity} người) — hệ thống vẫn cho phép lưu.</p>
              )}
              <p className="opacity-80">Giường cũ của các công nhân được chuyển sẽ tự động được giải phóng.</p>
            </div>
          )}

          {!targetAuthorized && targetDay.trim() && (
            <p className="text-xs text-dgr font-medium">Bạn không có quyền ghi vào {targetKtx} - {targetDay}.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary text-xs">Hủy</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="btn-primary text-xs disabled:opacity-50"
          >
            <ArrowRightLeft size={13} />
            {submitting ? 'Đang chuyển...' : `Chuyển ${authorizedSelected.length} công nhân`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkerManagementClient() {
  const { workers, loading, addWorker, updateWorker, deleteWorkers, deleteAllWorkers, importWorkers, updateTamTruStatus, bulkUpdateKtx, bulkUpdateWorkers } = useWorkers();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<keyof Worker>('stt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [viewingWorker, setViewingWorker] = useState<Worker | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTamTruExport, setShowTamTruExport] = useState(false);
  const [showBulkAssignKtx, setShowBulkAssignKtx] = useState(false);
  const [showBulkTransfer, setShowBulkTransfer] = useState(false);
  const [showBulkDeleteFilter, setShowBulkDeleteFilter] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Worker | Worker[] | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const { currentUser, canDeleteSingle, canBulkDelete, canDeleteAll, isAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();
  const [roomCapacities, setRoomCapacities] = useState<RoomCapacityMap>(() => getCachedData<RoomCapacityMap>(CACHE_KEYS.BEDS_CAPACITIES) ?? {});
  const [facilitiesCatalog, setFacilitiesCatalog] = useState<FacilityItem[]>(() => getCachedData<FacilityItem[]>(CACHE_KEYS.BEDS_FACILITIES) ?? []);
  const [showBatchSmartAssign, setShowBatchSmartAssign] = useState(false);
  const [applyingSmartAssign, setApplyingSmartAssign] = useState(false);
  const [batchReconcileTab, setBatchReconcileTab] = useState<'batch-checkout' | 'reconcile' | null>(() => {
    const act = searchParams?.get('action');
    if (act === 'batch-checkout') return 'batch-checkout';
    if (act === 'reconcile') return 'reconcile';
    return null;
  });

  useEffect(() => {
    let active = true;
    const loadCapacities = () => {
      fetchRoomCapacities()
        .then(map => {
          if (active) {
            setCachedData(CACHE_KEYS.BEDS_CAPACITIES, map);
            setRoomCapacities(map);
          }
        })
        .catch(() => {});
      fetchFacilitiesList(false)
        .then(list => {
          if (active && list) {
            setCachedData(CACHE_KEYS.BEDS_FACILITIES, list);
            setFacilitiesCatalog(list);
          }
        })
        .catch(() => {});
    };
    loadCapacities();
    if (typeof window !== 'undefined') {
      window.addEventListener('ktx_facilities_updated', loadCapacities);
    }
    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('ktx_facilities_updated', loadCapacities);
      }
    };
  }, []);

  // Audit logging must never interrupt the primary operation.
  const writeAuditLog = useCallback((actionType: 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT', details: string) => {
    try {
      const performerEmail = currentUser?.email ?? 'unknown';
      const timestamp = formatDateVN(nowVN());
      addLog(performerEmail, actionType, `[${timestamp}] ${details}`);
    } catch {
      // Logging failure is intentionally ignored so the user operation succeeds.
    }
  }, [addLog, currentUser]);

  // Handle URL filter params from dashboard / operational alerts / Command Palette & URL reload
  const lastSyncedQsRef = useRef<string | null>(null);
  const urlHydratedRef = useRef(false);

  useEffect(() => {
    const rawQs = searchParams?.toString() || '';
    if (lastSyncedQsRef.current !== null && rawQs === lastSyncedQsRef.current) {
      return;
    }

    const filterParam = searchParams?.get('filter');
    const ktxParam = searchParams?.get('ktx');
    const buildingParam = searchParams?.get('building');
    const roomParam = searchParams?.get('room');
    const platoonParam = searchParams?.get('platoon');
    const toTruongParam = searchParams?.get('toTruong');
    const provinceParam = searchParams?.get('province');
    const tamTruParam = searchParams?.get('tamTru');
    const searchParam = searchParams?.get('search');
    const pageParam = searchParams?.get('page');

    const hasAnyFilterParam = Boolean(
      filterParam ||
      ktxParam ||
      buildingParam ||
      roomParam ||
      platoonParam ||
      toTruongParam ||
      provinceParam ||
      tamTruParam ||
      searchParam ||
      pageParam
    );

    if (hasAnyFilterParam || urlHydratedRef.current) {
      setFilters({
        ...DEFAULT_FILTERS,
        ...(filterParam === 'missing_room' || filterParam === 'no_room'
          ? { profileStatus: 'no_room' }
          : filterParam === 'missing_cccd_sdt' || filterParam === 'full'
          ? { profileStatus: filterParam }
          : {}),
        ...(ktxParam ? { ktx: ktxParam } : {}),
        ...(buildingParam ? { building: buildingParam } : {}),
        ...(roomParam ? { room: roomParam } : {}),
        ...(platoonParam ? { platoon: platoonParam } : {}),
        ...(toTruongParam ? { toTruong: toTruongParam } : {}),
        ...(provinceParam ? { province: provinceParam } : {}),
        ...(tamTruParam === 'registered' || tamTruParam === 'unregistered' || tamTruParam === 'overdue'
          ? { tamTruStatus: tamTruParam }
          : {}),
        ...(searchParam ? { search: searchParam } : {}),
      });
      const parsedPage = pageParam ? parseInt(pageParam, 10) : 1;
      setPage(Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1);
    }
    urlHydratedRef.current = true;
    lastSyncedQsRef.current = rawQs;
  }, [searchParams]);

  // Sync current filters & page back to URL cleanly without triggering Next navigation reload
  useEffect(() => {
    if (!urlHydratedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams();
    const viewParam = searchParams?.get('view');
    if (viewParam) params.set('view', viewParam);
    if (filters.search) params.set('search', filters.search);
    if (filters.ktx) params.set('ktx', filters.ktx);
    if (filters.building) params.set('building', filters.building);
    if (filters.room) params.set('room', filters.room);
    if (filters.platoon) params.set('platoon', filters.platoon);
    if (filters.profileStatus) params.set('filter', filters.profileStatus);
    if (filters.toTruong) params.set('toTruong', filters.toTruong);
    if (filters.province) params.set('province', filters.province);
    if (filters.tamTruStatus) params.set('tamTru', filters.tamTruStatus);
    if (page > 1) params.set('page', String(page));

    const nextQs = params.toString();
    if (nextQs === lastSyncedQsRef.current) return;
    lastSyncedQsRef.current = nextQs;
    const nextUrl = nextQs ? `${window.location.pathname}?${nextQs}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  }, [filters, page, searchParams]);

  // Open WorkerDetailModal directly once per ?view=workerId param from CommandPalette
  const lastHandledViewRef = useRef<string | null>(null);
  useEffect(() => {
    const viewId = searchParams?.get('view');
    if (!viewId) {
      lastHandledViewRef.current = null;
      return;
    }
    if (lastHandledViewRef.current === viewId || workers.length === 0) return;
    const match = workers.find(w => w.id === viewId);
    if (match) {
      lastHandledViewRef.current = viewId;
      setViewingWorker(match);
    }
  }, [searchParams, workers]);

  const noKtxCount = useMemo(
    () =>
      workers.filter(
        w =>
          (!w.ktx || w.ktx.trim() === '') &&
          !w.ngayRaKTX &&
          !w.ghiChu?.includes('[Đã Check-out') &&
          !w.ghiChu?.includes('[CHECKOUT]')
      ).length,
    [workers]
  );

  const searchIndexById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) {
      map.set(
        w.id,
        removeAccents(
          `${w.hoVaTen || ''} ${w.maNV || ''} ${w.cccd || ''} ${w.soDienThoai || ''} ${w.toTruong || ''} ${w.day || ''} ${w.phongSo || ''} ${w.hoKhauTinh || ''}`
        )
      );
    }
    return map;
  }, [workers]);

  const deferredSearch = useDeferredValue(filters.search);

  const filtered = useMemo(() => {
    let list = [...workers];
    const s = removeAccents(deferredSearch);
    if (s) {
      list = list.filter(w => (searchIndexById.get(w.id) || '').includes(s));
    }
    if (filters.ktx) list = list.filter(w => w.ktx === filters.ktx);
    if (filters.building) list = list.filter(w => w.day === filters.building);
    if (filters.room) {
      const normR = normalizePhong(filters.room);
      list = list.filter(w => w.phongSo === filters.room || normalizePhong(w.phongSo) === normR);
    }
    if (filters.platoon === '__none__') list = list.filter(w => !w.tieuDoan);
    else if (filters.platoon) list = list.filter(w => w.tieuDoan === filters.platoon);
    if (filters.profileStatus) list = list.filter(w => getProfileStatus(w) === filters.profileStatus);
    // Tổ Trưởng filter: exact match or accent-insensitive match
    if (filters.toTruong) {
      const target = removeAccents(filters.toTruong);
      list = list.filter(w => removeAccents(w.toTruong || '') === target || removeAccents(w.toTruong || '').includes(target));
    }
    if (filters.province) {
      const targetProv = removeAccents(filters.province);
      list = list.filter(w => removeAccents(w.hoKhauTinh || '').includes(targetProv));
    }
    if (filters.tamTruStatus === 'overdue') {
      list = list.filter(w => {
        if ((w.tamTruStatus || 'unregistered') === 'registered') return false;
        if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) return false;
        const days = daysSinceVN(w.ngayVaoKTX || w.createdAt);
        return days !== null && days > 7;
      });
    } else if (filters.tamTruStatus) {
      list = list.filter(w => (w.tamTruStatus || 'unregistered') === filters.tamTruStatus);
    }
    list.sort((a, b) => {
      if (sortKey === 'stt') {
        const cmp = Number(a.stt ?? 0) - Number(b.stt ?? 0);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = String(a[sortKey] ?? '');
      const bv = String(b[sortKey] ?? '');
      const cmp = av.localeCompare(bv, 'vi', { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [workers, searchIndexById, deferredSearch, filters.ktx, filters.building, filters.room, filters.platoon, filters.profileStatus, filters.toTruong, filters.province, filters.tamTruStatus, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  // Row offset for sequential STT: first row on current page = (page-1)*pageSize + 1
  const rowOffset = (page - 1) * pageSize;

  const handleSort = useCallback((key: keyof Worker) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  const checkRoomCapacity = useCallback((ktx: string, day: string, phongSo: string, excludeId?: string): { count: number; capacity: number; overCapacity: boolean } => {
    const normP = normalizePhong(phongSo);
    const count = workers.filter(w =>
      w.ktx === ktx && w.day === day && (w.phongSo === phongSo || normalizePhong(w.phongSo) === normP) && w.id !== excludeId
    ).length;
    const capacity = getRoomCapacity(roomCapacities, ktx, day, phongSo) || DEFAULT_ROOM_CAPACITY;
    return { count, capacity, overCapacity: count >= capacity };
  }, [workers, roomCapacities]);

  const handleSave = useCallback(async (data: Worker) => {
    const isNew = !workers.some(w => w.id === data.id);

    if (!isAdmin && !canWriteBlock(data.day, data.ktx)) {
      toast.error(`Bạn không có quyền ${isNew ? 'thêm' : 'sửa'} công nhân ở ${data.ktx} - ${data.day}.`);
      return;
    }

    // Soft capacity warning
    if (!isNew) {
      const old = workers.find(w => w.id === data.id);
      const isRoomChange = old && (old.ktx !== data.ktx || old.day !== data.day || old.phongSo !== data.phongSo);
      if (isRoomChange) {
        const { count, capacity, overCapacity } = checkRoomCapacity(data.ktx, data.day, data.phongSo, data.id);
        if (overCapacity) {
          toast.warning(`⚠️ Phòng quá tải: ${count + 1}/${capacity} người — vẫn lưu được.`);
        }
      }
    } else {
      const { count, capacity, overCapacity } = checkRoomCapacity(data.ktx, data.day, data.phongSo);
      if (overCapacity) {
        toast.warning(`⚠️ Phòng quá tải: ${count + 1}/${capacity} người — vẫn lưu được.`);
      }
    }

    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());

    try {
      if (isNew) {
        await addWorker(data);
        // Instant movement log: +Vào
        writeAuditLog('CREATE', `Thêm công nhân: ${data.hoVaTen} (Mã NV: ${data.maNV || data.cccd || 'N/A'})`);
        toast.success('Đã thêm công nhân mới');
      } else {
        const old = workers.find(w => w.id === data.id);
        const isRoomChange = old && (old.ktx !== data.ktx || old.day !== data.day || old.phongSo !== data.phongSo);
        await updateWorker(data);
        if (isRoomChange) {
          // Instant movement log: Chuyển phòng
          writeAuditLog('UPDATE', `Cập nhật công nhân: ${data.hoVaTen} (Mã NV: ${data.maNV || data.cccd || 'N/A'}) — chuyển phòng`);
        } else {
          writeAuditLog('UPDATE', `Cập nhật công nhân: ${data.hoVaTen} (Mã NV: ${data.maNV || data.cccd || 'N/A'})`);
        }
        toast.success('Đã cập nhật thông tin công nhân');
      }
    } catch (err) {
      toast.error(`Lỗi: ${err instanceof Error ? err.message : 'Không thể lưu dữ liệu'}`);
      return;
    }

    setEditingWorker(null);
    setShowAddModal(false);
  }, [workers, currentUser, writeAuditLog, checkRoomCapacity, addWorker, updateWorker, isAdmin, canWriteBlock]);

  const handleDelete = useCallback(async (targets: Worker | Worker[]) => {
    const arr = Array.isArray(targets) ? targets : [targets];
    const ids = arr.map(t => t.id);
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    try {
      await deleteWorkers(ids);
      setSelectedIds(new Set());
      setDeleteTarget(null);
      // Log each deleted worker with name + maNV/CCCD
      arr.forEach(w => {
        writeAuditLog('DELETE', `Xóa công nhân: ${w.hoVaTen} (Mã NV: ${w.maNV || w.cccd || 'N/A'})`);
      });
      toast.success(`Đã xóa ${ids.length} công nhân`);
    } catch (err) {
      toast.error(`Lỗi xóa: ${err instanceof Error ? err.message : 'Không thể xóa'}`);
    }
  }, [currentUser, writeAuditLog, deleteWorkers]);

  const handleBulkDeleteByFilter = useCallback(async (ids: string[]) => {
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    const targets = workers.filter(w => ids.includes(w.id));
    await deleteWorkers(ids);
    setSelectedIds(new Set());
    writeAuditLog('DELETE', `Xóa hàng loạt ${ids.length} công nhân theo bộ lọc`);
    targets.forEach(w => {
      writeAuditLog('DELETE', `Xóa công nhân: ${w.hoVaTen} (Mã NV: ${w.maNV || w.cccd || 'N/A'})`);
    });
  }, [currentUser, writeAuditLog, deleteWorkers, workers]);

  const handleDeleteAll = useCallback(async () => {
    setDeleteAllLoading(true);
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    try {
      await deleteAllWorkers();
      writeAuditLog('DELETE', 'Xóa toàn bộ danh sách công nhân');
      setShowDeleteAll(false);
      setSelectedIds(new Set());
      setPage(1);
      toast.success('Đã xóa sạch dữ liệu công nhân.', { duration: 5000 });
    } catch (err) {
      toast.error(`Lỗi xóa tất cả: ${err instanceof Error ? err.message : 'Không thể xóa'}`);
    } finally {
      setDeleteAllLoading(false);
    }
  }, [currentUser, writeAuditLog, deleteAllWorkers]);

  const handleToggleTamTru = useCallback(async (worker: Worker) => {
    const newStatus = worker.tamTruStatus === 'registered' ? 'unregistered' : 'registered';
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    try {
      await updateTamTruStatus(worker.id, newStatus);
      addLog(
        `${userName} (${userEmail})`,
        'Đổi trạng thái tạm trú',
        `[${now}] ${worker.hoVaTen} (${worker.maNV || 'N/A'}): ${worker.tamTruStatus === 'registered' ? 'Đã ĐK → Chưa ĐK' : 'Chưa ĐK → Đã ĐK'}`
      );
      toast.success(`Đã đổi trạng thái tạm trú: ${newStatus === 'registered' ? 'Đã đăng ký' : 'Chưa đăng ký'}`);
    } catch (err) {
      toast.error(`Lỗi: ${err instanceof Error ? err.message : 'Không thể cập nhật'}`);
    }
  }, [currentUser, addLog, updateTamTruStatus]);

  const handleBulkAssignKtx = useCallback(async (ids: string[], ktxValue: string) => {
    await bulkUpdateKtx(ids, ktxValue);
    writeAuditLog('UPDATE', `Gán ${ids.length} công nhân về ${ktxValue}`);
  }, [bulkUpdateKtx, writeAuditLog]);

  const handleBulkTamTru = useCallback(async (status: 'registered' | 'unregistered') => {
    const selected = workers.filter(w => selectedIds.has(w.id));
    const authorized = selected.filter(w => isAdmin || canWriteBlock(w.day, w.ktx));
    if (authorized.length === 0) {
      toast.error('Bạn không có quyền cập nhật trạng thái tạm trú cho các công nhân đã chọn.');
      return;
    }
    const ids = authorized.map(w => w.id);
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    try {
      await bulkUpdateWorkers(ids, { tamTruStatus: status });
      addLog(
        `${userName} (${userEmail})`,
        'Đổi trạng thái tạm trú',
        `[${now}] Cập nhật hàng loạt ${ids.length} công nhân → ${status === 'registered' ? 'Đã ĐK tạm trú' : 'Chưa ĐK tạm trú'}`
      );
      setSelectedIds(new Set());
      toast.success(
        `Đã cập nhật ${ids.length} công nhân sang "${status === 'registered' ? 'Đã ĐK tạm trú' : 'Chưa ĐK tạm trú'}"`
      );
    } catch (err) {
      toast.error(`Lỗi cập nhật hàng loạt: ${err instanceof Error ? err.message : 'Không thể cập nhật'}`);
    }
  }, [workers, selectedIds, isAdmin, canWriteBlock, currentUser, bulkUpdateWorkers, addLog]);

  const handleBulkTransfer = useCallback(async (target: {
    ktx: string;
    day: string;
    phongSo: string;
    tieuDoanMode: 'keep' | 'clear' | 'set';
    tieuDoan: string;
  }) => {
    const selected = workers.filter(w => selectedIds.has(w.id));
    const authorized = selected.filter(w => isAdmin || canWriteBlock(w.day, w.ktx));
    if (authorized.length === 0) {
      toast.error('Không có công nhân hợp lệ trong phạm vi quyền của bạn.');
      return;
    }
    if (!isAdmin && !canWriteBlock(target.day, target.ktx)) {
      toast.error(`Bạn không có quyền chuyển công nhân sang ${target.ktx} - ${target.day}.`);
      return;
    }

    const ids = authorized.map(w => w.id);
    const authIdSet = new Set(ids);
    const normR = normalizePhong(target.phongSo);
    const currentDestCount = workers.filter(
      w =>
        !authIdSet.has(w.id) &&
        w.ktx === target.ktx &&
        w.day === target.day &&
        normalizePhong(w.phongSo) === normR
    ).length;

    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());

    try {
      await bulkUpdateWorkers(ids, {
        ktx: target.ktx,
        day: target.day,
        phongSo: target.phongSo,
        ...(target.tieuDoanMode === 'set'
          ? { tieuDoan: target.tieuDoan }
          : target.tieuDoanMode === 'clear'
          ? { tieuDoan: '' }
          : {}),
        clearBedOnMove: true,
      });

      addLog(
        `${userName} (${userEmail})`,
        'Chuyển phòng',
        `[${now}] Chuyển hàng loạt ${ids.length} công nhân sang ${target.ktx} · ${target.day} · ${target.phongSo}${
          target.tieuDoanMode === 'set' ? ` (TĐ ${target.tieuDoan})` : target.tieuDoanMode === 'clear' ? ' (Xóa TĐ)' : ''
        }`
      );

      setSelectedIds(new Set());
      setShowBulkTransfer(false);

      const targetCapacity = getRoomCapacity(roomCapacities, target.ktx, target.day, target.phongSo) || DEFAULT_ROOM_CAPACITY;
      if (currentDestCount + ids.length > targetCapacity) {
        toast.warning(
          `Đã chuyển ${ids.length} công nhân sang ${target.day} - ${target.phongSo} (Quá tải: ${currentDestCount + ids.length}/${targetCapacity} người)`
        );
      } else {
        toast.success(`Đã chuyển ${ids.length} công nhân sang ${target.ktx} · ${target.day} · ${target.phongSo}`);
      }
    } catch (err) {
      toast.error(`Lỗi chuyển phòng hàng loạt: ${err instanceof Error ? err.message : 'Không thể cập nhật'}`);
    }
  }, [workers, selectedIds, isAdmin, canWriteBlock, currentUser, bulkUpdateWorkers, addLog, roomCapacities]);

  const handleApplyBatchSmartAssign = useCallback(
    async (plan: BatchAssignmentPlanItem[]) => {
      const valid = plan.filter(p => p.assigned !== null);
      if (valid.length === 0) return;
      setApplyingSmartAssign(true);
      let okCount = 0;
      let skipCount = 0;
      try {
        for (const item of valid) {
          const target = item.assigned!;
          const existing = workers.find(w => w.id === item.workerId);
          if (!existing) {
            skipCount++;
            continue;
          }
          if (!(isAdmin || (canWriteBlock(existing.day, existing.ktx) && canWriteBlock(target.day, target.ktx)))) {
            skipCount++;
            continue;
          }
          await updateWorker({
            ...existing,
            ktx: target.ktx,
            day: target.day,
            phongSo: target.room,
            giuong: target.bed,
            khoaTraCuu: `${target.ktx}|${target.day}|${target.room}`,
          });
          okCount++;
        }
        writeAuditLog(
          'UPDATE',
          `Xếp phòng & giường tự động thông minh cho ${okCount} công nhân${skipCount > 0 ? ` (bỏ qua ${skipCount})` : ''}`
        );
        setSelectedIds(new Set());
        setShowBatchSmartAssign(false);
        toast.success(`Đã xếp phòng & giường tự động cho ${okCount} công nhân!`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi xếp phòng tự động');
      } finally {
        setApplyingSmartAssign(false);
      }
    },
    [workers, isAdmin, canWriteBlock, updateWorker, writeAuditLog]
  );

  const handleExport = useCallback(() => {
    const data = filtered.map((w, idx) => {
      const soNgay = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
      return {
        'STT': idx + 1, // Sequential STT in export
        'Họ và Tên': w.hoVaTen,
        'Mã NV': w.maNV,
        'Tiểu Đoàn': w.tieuDoan,
        'Đơn vị': w.donVi || '',
        'KTX': w.ktx,
        'Dãy': w.day,
        'Phòng': w.phongSo,
        'Giới tính': w.gioiTinh || '',
        'SĐT': w.soDienThoai,
        'CCCD': w.cccd,
        'Ngày Tháng Năm Sinh': formatNgaySinh(w.ngaySinh),
        'Ngày Vào KTX': w.ngayVaoKTX,
        'Ngày Ra KTX': w.ngayRaKTX || '',
        'Số Ngày Lưu Trú': soNgay ?? '',
        'Tỉnh/TP': w.hoKhauTinh,
        'Tổ Trưởng': w.toTruong,
        'SĐT Tổ Trưởng': w.sdtToTruong || '',
        'Trạng thái tạm trú': w.tamTruStatus === 'registered' ? 'Đã đăng ký' : 'Chưa đăng ký',
      };
    });
    const vnDate = formatDateVN(nowVN()).replace(/\//g, '-');
    const fileName = `KTX_CongNhan_${vnDate}.xlsx`;
    exportToExcel(data, fileName, 'Danh sách');
    toast.success(`Đã xuất ${filtered.length} bản ghi (theo bộ lọc hiện tại)`);
  }, [filtered]);

  const handleImport = useCallback(async (rows: Worker[]) => {
    await importWorkers(rows);
    writeAuditLog('IMPORT', `Import ${rows.length} công nhân từ file Excel/CSV`);
    toast.success(`Đã nhập thành công ${rows.length} công nhân vào hệ thống`);
  }, [writeAuditLog, importWorkers]);

  if (loading) {
    return (
      <div className="min-h-screen bg-page text-tx">
        <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-5 max-w-screen-2xl mx-auto space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-bdr">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl skeleton-pulse" />
              <div className="h-6 w-48 rounded-lg skeleton-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-28 rounded-xl skeleton-pulse" />
              <div className="h-9 w-36 rounded-xl skeleton-pulse" />
            </div>
          </div>
          <div className="h-14 rounded-2xl border border-bdr bg-surf p-3 flex gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-8 flex-1 rounded-lg skeleton-pulse" />)}
          </div>
          <div className="rounded-2xl border border-bdr bg-surf p-4 space-y-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div key={i} className="h-10 w-full rounded-lg skeleton-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-tx">
      <div className={`px-3 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-5 max-w-screen-2xl mx-auto space-y-4 transition-[padding] duration-150 ${selectedIds.size > 0 ? 'pb-24' : ''}`}>
        {/* ── Compact Module Header ── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3.5 border-b border-bdr">
          <div className="flex items-center gap-3">
            <CraftIconBadge icon={Users} badgeIcon={FileCheck} tone="blue" size="md" />
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg sm:text-xl font-extrabold text-tx tracking-tight">
                Quản Lý Công Nhân
              </h1>
              <span className="text-xs text-lnk font-bold px-2.5 py-0.5 rounded-md bg-bdg border border-bdr2 font-mono font-tabular">
                {workers.length.toLocaleString('vi-VN')} hồ sơ
              </span>
            </div>
          </div>

          {/* ── Action Buttons (dgr = delete only, pri = add, outline = rest) ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Đỏ xóa: Xóa theo bộ lọc (Admin + Super Admin) / Xóa tất cả (chỉ Super Admin) */}
            {(canBulkDelete || canDeleteAll) && (
              <>
                {canBulkDelete && (
                  <button
                    onClick={() => setShowBulkDeleteFilter(true)}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-dgr hover:opacity-90 text-white text-xs sm:text-sm font-semibold transition-opacity duration-100 active:opacity-85"
                  >
                    <Filter size={15} />
                    <span>Xóa theo bộ lọc</span>
                  </button>
                )}
                {canDeleteAll && (
                  <button
                    onClick={() => setShowDeleteAll(true)}
                    title="Chỉ Quản trị tối cao (Super Admin) có quyền xóa toàn bộ danh sách công nhân"
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-dgr hover:opacity-90 text-white text-xs sm:text-sm font-semibold transition-opacity duration-100 active:opacity-85"
                  >
                    <Trash2 size={15} />
                    <span>Xóa tất cả</span>
                  </button>
                )}
              </>
            )}

            {/* Gán KTX */}
            {isAdmin && (
              <button
                onClick={() => setShowBulkAssignKtx(true)}
                className="relative flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-bdr3 bg-transparent text-tx text-xs sm:text-sm font-semibold hover:bg-act transition-colors duration-100"
              >
                <Building2 size={15} />
                <span>Gán KTX</span>
                {noKtxCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-dgr text-white text-[10px] font-bold px-1 shadow-sm">
                    {noKtxCount}
                  </span>
                )}
              </button>
            )}

            {/* Outline exports */}
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-bdr3 bg-transparent text-tx text-xs sm:text-sm font-semibold hover:bg-act transition-colors duration-100"
            >
              <Download size={15} />
              <span>Xuất Excel</span>
            </button>
            <button
              onClick={() => setShowTamTruExport(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-bdr3 bg-transparent text-tx text-xs sm:text-sm font-semibold hover:bg-act transition-colors duration-100"
            >
              <FileCheck size={15} />
              <span>Xuất Tạm Trú</span>
            </button>

            {/* Nhập từ Excel */}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-bdr3 bg-transparent text-tx text-xs sm:text-sm font-semibold hover:bg-act transition-colors duration-100"
            >
              <Upload size={15} />
              <span>Nhập từ Excel</span>
            </button>

            {/* Đối soát quân số & Check-out hàng loạt */}
            {(isAdmin || (currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0)) && (
              <button
                onClick={() => setBatchReconcileTab('batch-checkout')}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-dgr/40 bg-dgrbg/60 text-dgr text-xs sm:text-sm font-bold hover:bg-dgrbg transition-colors duration-100 cursor-pointer"
                title="Dán danh sách CCCD/Mã NV nghỉ việc để Check-out loạt hoặc đối chiếu file Nhân sự công trường"
              >
                <UserMinus size={15} />
                <span>Đối soát & Check-out loạt</span>
              </button>
            )}

            {/* Nút chính: Thêm công nhân */}
            {(isAdmin || (currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0)) && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl btn-glow-primary text-xs sm:text-sm font-semibold cursor-pointer"
              >
                <Plus size={16} />
                <span>Thêm Công Nhân</span>
              </button>
            )}
          </div>
        </div>

      <WorkerFilters filters={filters} onChange={f => { setFilters(f); setPage(1); }} workers={workers} />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onDelete={canBulkDelete ? () => setDeleteTarget(workers.filter(w => selectedIds.has(w.id))) : undefined}
        onBulkTamTru={handleBulkTamTru}
        onBulkSmartAssign={() => setShowBatchSmartAssign(true)}
        onBulkMove={() => setShowBulkTransfer(true)}
        onClear={() => setSelectedIds(new Set())}
      />

      <WorkerTable
        workers={paginated}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
        allIds={paginated.map(w => w.id)}
        onView={setViewingWorker}
        onEdit={setEditingWorker}
        onDelete={canDeleteSingle ? w => setDeleteTarget(w) : undefined}
        onToggleTamTru={handleToggleTamTru}
        canWriteBlock={canWriteBlock}
        rowOffset={rowOffset}
      />

      {/* Pagination */}
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs sm:text-sm text-mu">
          <span>Hiển thị</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-surf border border-bdr text-tx rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-pri2">
            {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>bản ghi (Tổng: <strong className="text-tx font-tabular">{filtered.length.toLocaleString('vi-VN')}</strong>)</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(1)} disabled={page === 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">‹</button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
            return (
              <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${page === p ? 'bg-primary text-primary-foreground' : 'btn-ghost'}`}>{p}</button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">›</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages || totalPages === 0} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">»</button>
        </div>
      </div>

      {showAddModal && <WorkerFormModal worker={null} onSave={handleSave} onClose={() => setShowAddModal(false)} allWorkers={workers} />}
      {editingWorker && <WorkerFormModal worker={editingWorker} onSave={handleSave} onClose={() => setEditingWorker(null)} allWorkers={workers} />}
      {viewingWorker && <WorkerDetailModal worker={viewingWorker} onClose={() => setViewingWorker(null)} onEdit={w => { setViewingWorker(null); setEditingWorker(w); }} canEdit={canWriteBlock(viewingWorker.day, viewingWorker.ktx)} onDelete={canDeleteSingle && canWriteBlock(viewingWorker.day, viewingWorker.ktx) ? w => { setViewingWorker(null); setDeleteTarget(w); } : undefined} />}
      {deleteTarget && canDeleteSingle && <DeleteConfirmModal target={deleteTarget} onConfirm={() => handleDelete(deleteTarget)} onClose={() => setDeleteTarget(null)} />}
      {showImport && <ExcelImportModal onClose={() => setShowImport(false)} onImport={handleImport} existingWorkers={workers} />}
      {showTamTruExport && <TamTruExportModal workers={filtered} onClose={() => setShowTamTruExport(false)} />}
      {showBulkAssignKtx && isAdmin && <BulkAssignKtxModal workers={workers} onClose={() => setShowBulkAssignKtx(false)} onAssign={handleBulkAssignKtx} />}
      {showBulkTransfer && (
        <BulkTransferWorkersModal
          selectedWorkers={workers.filter(w => selectedIds.has(w.id))}
          allWorkers={workers}
          roomCapacities={roomCapacities}
          onClose={() => setShowBulkTransfer(false)}
          onTransfer={handleBulkTransfer}
          isAdmin={isAdmin}
          canWriteBlock={canWriteBlock}
        />
      )}
      {showBatchSmartAssign && (
        <BatchSmartAssignModal
          selectedWorkers={workers.filter(w => selectedIds.has(w.id))}
          allWorkers={workers}
          facilities={facilitiesCatalog}
          roomGenderMap={loadSavedRoomGenderMap()}
          applying={applyingSmartAssign}
          onApplyPlan={handleApplyBatchSmartAssign}
          onClose={() => setShowBatchSmartAssign(false)}
        />
      )}
      {batchReconcileTab && (
        <BatchCheckoutReconcileModal
          workers={workers}
          initialTab={batchReconcileTab}
          onClose={() => setBatchReconcileTab(null)}
        />
      )}
      {showDeleteAll && isAdmin && <DeleteAllConfirmModal onConfirm={handleDeleteAll} onClose={() => setShowDeleteAll(false)} loading={deleteAllLoading} />}
      {showBulkDeleteFilter && isAdmin && <BulkDeleteByFilterModal workers={workers} onClose={() => setShowBulkDeleteFilter(false)} onDelete={handleBulkDeleteByFilter} />}
      </div>
    </div>
  );
}
