'use client';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Worker, getProfileStatus, calcSoNgay, ROOM_CAPACITY, removeAccents } from '@/data/workers';
import WorkerTable from './WorkerTable';
import WorkerFilters from './WorkerFilters';
import WorkerFormModal from './WorkerFormModal';
import WorkerDetailModal from './WorkerDetailModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import BulkActionBar from './BulkActionBar';
import { Plus, Download, Upload, X, FileText, AlertCircle, FileCheck, ChevronLeft, ChevronRight, Trash2, Building2, CheckSquare, Filter, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportToExcel } from '@/lib/exportExcel';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { useSearchParams } from 'next/navigation';
import { useKtxStructure } from '@/lib/ktxStructure';

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

/** Normalize room number: strip leading zeros, keep as string */
function normalizePhong(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num)) return String(num);
  return trimmed;
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

const PREVIEW_HEADERS = ['KTX', 'Họ và Tên', 'Mã NV', 'CCCD', 'SĐT', 'Dãy', 'Phòng', 'Ngày Sinh', 'Quê Quán', 'Tổ Trưởng', 'Ngày Vào KTX', 'Ghi Chú'];
const PREVIEW_PAGE_SIZE = 20;

function ExcelImportModal({ onClose, onImport }: { onClose: () => void; onImport: (rows: Worker[]) => Promise<void> }) {
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
  const fileRef = useRef<HTMLInputElement>(null);

  const previewTotalPages = Math.ceil(parsedRows.length / PREVIEW_PAGE_SIZE);
  const previewRows = parsedRows.slice((previewPage - 1) * PREVIEW_PAGE_SIZE, previewPage * PREVIEW_PAGE_SIZE);

  const parseExcelFile = (file: File) => {
    setFileName(file.name);
    setParseError('');
    setParsedRows([]);
    setTotal(0);
    setPreviewPage(1);
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

  const getEffectiveKtx = (row: ParsedWorkerRow): string => {
    if (hasKtxColumn && row.ktxFromExcel) return row.ktxFromExcel;
    return selectedKtx || (ktxNames[0] || '');
  };

  const canConfirm = parsedRows.length > 0 && (hasKtxColumn || selectedKtx !== '');

  const handleConfirm = async () => {
    if (!canConfirm) {
      toast.error('Vui lòng chọn KTX trước khi nhập dữ liệu.');
      return;
    }
    const workers: Worker[] = parsedRows.map((r, i) => {
      const ktxValue = getEffectiveKtx(r);
      const dayNorm = normalizeDayNha(r.dayNha);
      const phongNorm = normalizePhong(r.soPhong);
      return {
        id: `import-${Date.now()}-${i}`,
        stt: 0,
        hoVaTen: r.hoTen,
        maNV: r.maCongNhan,
        tieuDoan: r.tieuDoan || '',
        ktx: ktxValue,
        donVi: r.donVi || '',
        gioiTinh: r.gioiTinh || '',
        ngaySinh: r.ngaySinh,
        soDienThoai: r.soDienThoai,
        day: dayNorm,
        phongSo: phongNorm,
        giuong: r.giuong || '',
        cccd: r.soCCCD,
        hoKhauTinh: r.queQuan,
        toTruong: r.toTruong,
        sdtToTruong: r.sdtToTruong,
        ngayVaoKTX: r.ngayVao,
        ghiChu: r.ghiChu,
        khoaTraCuu: `${ktxValue}|${dayNorm}|${phongNorm}`,
        tamTruStatus: 'unregistered' as const,
      };
    });
    setImporting(true);
    try {
      await onImport(workers);
      onClose();
    } catch {
      toast.error('Lỗi khi nhập dữ liệu. Vui lòng thử lại.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-modal w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">Nhập từ Excel</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Hỗ trợ file .xlsx / .xls — Tự động nhận diện tiêu đề từ hàng 3</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="p-4 rounded-xl border-2 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={16} className="text-primary" />
              <p className="text-sm font-bold text-foreground">Chọn KTX để nhập dữ liệu <span className="text-red-500">*</span></p>
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
              <div className="mt-2 flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                <FileCheck size={12} />
                <span>File Excel có cột KTX — hệ thống sẽ ưu tiên đọc từ cột đó.</span>
              </div>
            )}
            {!hasKtxColumn && selectedKtx === '' && parsedRows.length > 0 && (
              <p className="mt-2 text-xs text-red-600 font-semibold">⚠ Vui lòng chọn KTX trước khi xác nhận nhập.</p>
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

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-2">
              <FileText size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-700 space-y-0.5">
                <p className="font-semibold">Cột được nhận diện tự động:</p>
                <p>KTX · HỌ VÀ TÊN · MÃ NV · GIỚI TÍNH · ĐƠN VỊ · TIỂU ĐOÀN · CCCD · SỐ ĐIỆN THOẠI · DÃY · PHÒNG SỐ · SỐ GIƯỜNG · NGÀY SINH · HỘ KHẨU · TỔ TRƯỞNG · SĐT TỔ TRƯỞNG · NGÀY VÀO KTX · GHI CHÚ</p>
              </div>
            </div>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">{parseError}</p>
            </div>
          )}

          {parsedRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold border border-green-200">
                    ✓ Đã tìm thấy {total} công nhân
                  </span>
                  <span className="text-xs text-muted-foreground">(Trang {previewPage}/{previewTotalPages})</span>
                </div>
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
                    {previewRows.map((row, i) => {
                      const effectiveKtx = getEffectiveKtx(row);
                      return (
                        <tr key={i} className="border-t border-border hover:bg-muted/20">
                          <td className="px-2 py-1.5 text-muted-foreground">{(previewPage - 1) * PREVIEW_PAGE_SIZE + i + 1}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                              {effectiveKtx || '—'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-foreground font-medium whitespace-nowrap max-w-[160px] truncate">{row.hoTen || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.maCongNhan || '—'}</td>
                          <td className="px-2 py-1.5 font-tabular text-foreground whitespace-nowrap">{row.soCCCD || '—'}</td>
                          <td className="px-2 py-1.5 font-tabular text-foreground whitespace-nowrap">{row.soDienThoai || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{normalizeDayNha(row.dayNha) || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{normalizePhong(row.soPhong) || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.ngaySinh || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[120px] truncate">{row.queQuan || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[120px] truncate">{row.toTruong || '—'}</td>
                          <td className="px-2 py-1.5 text-foreground whitespace-nowrap">{row.ngayVao || '—'}</td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap max-w-[100px] truncate">{row.ghiChu || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {previewTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <button onClick={() => setPreviewPage(p => Math.max(1, p - 1))} disabled={previewPage === 1} className="p-1 rounded hover:bg-muted disabled:opacity-40">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-muted-foreground">{previewPage} / {previewTotalPages}</span>
                  <button onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))} disabled={previewPage === previewTotalPages} className="p-1 rounded hover:bg-muted disabled:opacity-40">
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
              <span className="text-green-700 font-semibold">{total} công nhân sẵn sàng nhập</span>
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
              {importing ? 'Đang nhập...' : `Xác nhận nhập ${total > 0 ? `${total} công nhân` : ''}`}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <CheckSquare size={18} className="text-primary" />
              Gán nhanh KTX cho công nhân chưa có KTX
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{noKtxWorkers.length} công nhân chưa được gán KTX</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X size={16} /></button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-modal w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">Xuất file Tạm Trú (Excel)</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X size={16} /></button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-modal w-full max-w-md border border-red-200">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-red-100 bg-red-50 rounded-t-xl">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle size={20} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-red-700">CẢNH BÁO: Xóa toàn bộ dữ liệu</h2>
            <p className="text-xs text-red-500">Hành động này không thể hoàn tác</p>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-foreground font-medium">
            Bạn có chắc chắn muốn xóa <span className="text-red-600 font-bold">TOÀN BỘ</span> danh sách công nhân hiện tại không?
          </p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs text-red-700 font-semibold">⚠ Hành động này không thể hoàn tác!</p>
            <ul className="mt-1 text-xs text-red-600 space-y-0.5 list-disc list-inside">
              <li>Toàn bộ dữ liệu công nhân sẽ bị xóa vĩnh viễn</li>
              <li>Dữ liệu trên Supabase sẽ bị xóa hoàn toàn</li>
              <li>Bạn sẽ cần Import lại từ file Excel mới</li>
            </ul>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="btn-secondary text-sm">Hủy bỏ</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-modal w-full max-w-lg border border-red-200">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-red-100 bg-red-50 rounded-t-xl">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <Trash2 size={20} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-red-700">Xóa hàng loạt theo bộ lọc</h2>
            <p className="text-xs text-red-500">Chỉ Admin mới có quyền thực hiện</p>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-red-100"><X size={16} /></button>
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filterType === t ? 'bg-red-600 text-white border-red-600' : 'bg-card text-foreground border-border hover:border-red-300'}`}
                >
                  {t === 'ktx' ? 'Theo KTX' : t === 'day' ? 'Theo Dãy' : 'Theo Phòng'}
                </button>
              ))}
            </div>
          </div>

          {/* Selectors */}
          <div className="flex flex-wrap gap-3">
            <div className="form-group min-w-[130px]">
              <label className="label-field">KTX <span className="text-red-500">*</span></label>
              <select value={selKtx} onChange={e => { setSelKtx(e.target.value); setSelDay(''); setSelPhong(''); setConfirmed(false); }} className="input-field">
                <option value="">Chọn KTX</option>
                {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {(filterType === 'day' || filterType === 'phong') && (
              <div className="form-group min-w-[130px]">
                <label className="label-field">Dãy <span className="text-red-500">*</span></label>
                <select value={selDay} onChange={e => { setSelDay(e.target.value); setSelPhong(''); setConfirmed(false); }} className="input-field" disabled={!selKtx}>
                  <option value="">Chọn Dãy</option>
                  {dayList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            {filterType === 'phong' && (
              <div className="form-group min-w-[110px]">
                <label className="label-field">Phòng <span className="text-red-500">*</span></label>
                <select value={selPhong} onChange={e => { setSelPhong(e.target.value); setConfirmed(false); }} className="input-field" disabled={!selDay}>
                  <option value="">Chọn Phòng</option>
                  {phongList.map(p => <option key={p} value={p}>P.{p}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Preview count */}
          {targetWorkers.length > 0 && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm font-semibold text-red-700">
                Sẽ xóa <span className="text-xl font-bold">{targetWorkers.length}</span> công nhân thuộc {filterLabel}
              </p>
              <p className="text-xs text-red-500 mt-1">⚠ Hành động này không thể hoàn tác!</p>
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
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            {deleting ? 'Đang xóa...' : `Xóa ${targetWorkers.length} công nhân`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkerManagementClient() {
  const { workers, loading, addWorker, updateWorker, deleteWorkers, deleteAllWorkers, importWorkers, updateTamTruStatus, bulkUpdateKtx, refreshWorkers } = useWorkers();
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
  const [showBulkDeleteFilter, setShowBulkDeleteFilter] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Worker | Worker[] | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const { currentUser, canDeleteSingle, canBulkDelete, canDeleteAll, isAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();

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

  // Handle URL filter param from dashboard
  useEffect(() => {
    const filterParam = searchParams?.get('filter');
    const ktxParam = searchParams?.get('ktx');
    if (filterParam === 'missing_room' || filterParam === 'no_room') {
      setFilters(prev => ({
        ...prev,
        profileStatus: 'no_room',
        ...(ktxParam ? { ktx: ktxParam } : {}),
      }));
    } else if (ktxParam) {
      setFilters(prev => ({ ...prev, ktx: ktxParam }));
    }
  }, [searchParams]);

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

  const filtered = useMemo(() => {
    let list = [...workers];
    const s = removeAccents(filters.search);
    if (s) {
      list = list.filter(w =>
        removeAccents(w.hoVaTen).includes(s) ||
        removeAccents(w.maNV).includes(s) ||
        removeAccents(w.cccd || '').includes(s) ||
        removeAccents(w.soDienThoai || '').includes(s) ||
        removeAccents(w.toTruong || '').includes(s) ||
        removeAccents(w.day || '').includes(s) ||
        removeAccents(w.phongSo || '').includes(s) ||
        removeAccents(w.hoKhauTinh || '').includes(s)
      );
    }
    if (filters.ktx) list = list.filter(w => w.ktx === filters.ktx);
    if (filters.building) list = list.filter(w => w.day === filters.building);
    if (filters.room) list = list.filter(w => w.phongSo === filters.room);
    if (filters.platoon === '__none__') list = list.filter(w => !w.tieuDoan);
    else if (filters.platoon) list = list.filter(w => w.tieuDoan === filters.platoon);
    if (filters.profileStatus) list = list.filter(w => getProfileStatus(w) === filters.profileStatus);
    // Tổ Trưởng filter: exact match or accent-insensitive match
    if (filters.toTruong) {
      const target = removeAccents(filters.toTruong);
      list = list.filter(w => removeAccents(w.toTruong || '') === target || removeAccents(w.toTruong || '').includes(target));
    }
    if (filters.province) list = list.filter(w => removeAccents(w.hoKhauTinh || '').includes(removeAccents(filters.province)));
    if (filters.tamTruStatus) list = list.filter(w => (w.tamTruStatus || 'unregistered') === filters.tamTruStatus);
    list.sort((a, b) => {
      const av = String(a[sortKey] ?? '');
      const bv = String(b[sortKey] ?? '');
      const cmp = av.localeCompare(bv, 'vi');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [workers, filters, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  // Row offset for sequential STT: first row on current page = (page-1)*pageSize + 1
  const rowOffset = (page - 1) * pageSize;

  const handleSort = useCallback((key: keyof Worker) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  const checkRoomCapacity = useCallback((ktx: string, day: string, phongSo: string, excludeId?: string): { count: number; overCapacity: boolean } => {
    const count = workers.filter(w =>
      w.ktx === ktx && w.day === day && w.phongSo === phongSo && w.id !== excludeId
    ).length;
    return { count, overCapacity: count >= ROOM_CAPACITY };
  }, [workers]);

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
        const { count, overCapacity } = checkRoomCapacity(data.ktx, data.day, data.phongSo, data.id);
        if (overCapacity) {
          toast.warning(`⚠️ Phòng quá tải: ${count + 1}/${ROOM_CAPACITY} người — vẫn lưu được.`);
        }
      }
    } else {
      const { count, overCapacity } = checkRoomCapacity(data.ktx, data.day, data.phongSo);
      if (overCapacity) {
        toast.warning(`⚠️ Phòng quá tải: ${count + 1}/${ROOM_CAPACITY} người — vẫn lưu được.`);
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
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    writeAuditLog('UPDATE', `Gán ${ids.length} công nhân về ${ktxValue}`);
  }, [bulkUpdateKtx, writeAuditLog, currentUser]);

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
    // Force a full re-fetch so dashboard stats and all views sync immediately
    await refreshWorkers();
    const userEmail = currentUser?.email ?? 'unknown';
    const userName = currentUser?.name ?? userEmail;
    const now = formatDateVN(nowVN());
    writeAuditLog('IMPORT', `Import ${rows.length} công nhân từ file Excel/CSV`);
    toast.success(`Đã nhập thành công ${rows.length} công nhân vào hệ thống`);
  }, [currentUser, writeAuditLog, importWorkers, refreshWorkers]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111827] text-gray-400 p-12 flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium animate-pulse">Đang tải dữ liệu từ Supabase...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111827] text-[#E5E7EB]">
      <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-5 sm:py-7 max-w-screen-2xl mx-auto space-y-5">
        {/* ── Header with Global Subtitle ── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 p-0.5 shadow-lg shadow-blue-500/20 flex-shrink-0">
              <div className="w-full h-full bg-gray-900 rounded-[14px] flex items-center justify-center">
                <Users size={22} className="text-blue-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  KÝ TÚC XÁ PHƯỚC VĨNH TÂY
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  Quản Lý Công Nhân
                </span>
                <span className="text-xs text-blue-400 font-bold px-3 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 font-tabular">
                  {workers.length.toLocaleString('vi-VN')}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
                Trung tâm dữ liệu và quản trị vận hành ký túc xá
              </p>
            </div>
          </div>

          {/* ── Clear Action Button Color-Coding (Red delete, Blue add/edit, Green export) ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Đỏ xóa: Xóa bộ lọc / Xóa tất cả */}
            {canDeleteAll && (
              <>
                <button
                  onClick={() => setShowBulkDeleteFilter(true)}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-rose-600/25 active:opacity-85"
                >
                  <Filter size={15} />
                  <span>Xóa theo bộ lọc</span>
                </button>
                <button
                  onClick={() => setShowDeleteAll(true)}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-rose-700/25 active:opacity-85"
                >
                  <Trash2 size={15} />
                  <span>Xóa tất cả</span>
                </button>
              </>
            )}

            {/* Gán KTX */}
            {isAdmin && (
              <button
                onClick={() => setShowBulkAssignKtx(true)}
                className="relative flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-amber-600/25 active:opacity-85"
              >
                <Building2 size={15} />
                <span>Gán KTX</span>
                {noKtxCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 shadow-sm">
                    {noKtxCount}
                  </span>
                )}
              </button>
            )}

            {/* Xanh lá xuất file */}
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-emerald-600/25 active:opacity-85"
            >
              <Download size={15} />
              <span>Xuất Excel</span>
            </button>
            <button
              onClick={() => setShowTamTruExport(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-teal-600/25 active:opacity-85"
            >
              <FileCheck size={15} />
              <span>Xuất Tạm Trú</span>
            </button>

            {/* Nhập từ Excel */}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-cyan-600/25 active:opacity-85"
            >
              <Upload size={15} />
              <span>Nhập từ Excel</span>
            </button>

            {/* Xanh dương thêm công nhân */}
            {(isAdmin || (currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0)) && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs sm:text-sm font-semibold transition-colors duration-100 shadow-md shadow-blue-500/25 active:opacity-85"
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
        <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-400">
          <span>Hiển thị</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500">
            {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>bản ghi (Tổng: <strong className="text-white font-tabular">{filtered.length.toLocaleString('vi-VN')}</strong>)</span>
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
      {showImport && <ExcelImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
      {showTamTruExport && <TamTruExportModal workers={filtered} onClose={() => setShowTamTruExport(false)} />}
      {showBulkAssignKtx && isAdmin && <BulkAssignKtxModal workers={workers} onClose={() => setShowBulkAssignKtx(false)} onAssign={handleBulkAssignKtx} />}
      {showDeleteAll && isAdmin && <DeleteAllConfirmModal onConfirm={handleDeleteAll} onClose={() => setShowDeleteAll(false)} loading={deleteAllLoading} />}
      {showBulkDeleteFilter && isAdmin && <BulkDeleteByFilterModal workers={workers} onClose={() => setShowBulkDeleteFilter(false)} onDelete={handleBulkDeleteByFilter} />}
      </div>
    </div>
  );
}
