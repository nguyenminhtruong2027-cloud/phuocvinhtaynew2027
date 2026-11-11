'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Search, Edit2, Check, X, Plus, Loader2, BedDouble, Wind, Package, Fan,
  Zap, Tv, Lightbulb, UtensilsCrossed, ChevronDown, ChevronUp, Upload,
  AlertCircle, CheckCircle2, Download, Trash2, Filter, Snowflake, AlertTriangle, CheckSquare, Square
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportToExcel } from '@/lib/exportExcel';
import { useKtxStructure } from '@/lib/ktxStructure';
import { compareKtxNames, naturalSortCompare } from '@/data/workers';

interface FacilityRow {
  id: string;
  ktx: string;
  day: string;
  phong_khu_vuc: string;
  giuong: number;
  dieu_hoa: number;
  tu: number;
  quat: number;
  o_cam_dien: number;
  remote: number;
  bong_tuyp: number;
  ban_an: number;
  ghe_an: number;
  ghi_chu: string;
  room_type: 'accommodation' | 'functional';
  is_visible: boolean;
}

interface EditingRow {
  id: string;
  giuong: number;
  dieu_hoa: number;
  tu: number;
  quat: number;
  o_cam_dien: number;
  remote: number;
  bong_tuyp: number;
  ban_an: number;
  ghe_an: number;
  ghi_chu: string;
  room_type: 'accommodation' | 'functional';
  is_visible: boolean;
}

interface MetricCard {
  label: string;
  key: keyof Pick<FacilityRow, 'giuong' | 'dieu_hoa' | 'tu' | 'quat' | 'o_cam_dien' | 'remote' | 'bong_tuyp' | 'ban_an' | 'ghe_an'>;
  icon: React.ReactNode;
  color: string;
}

interface ImportResult {
  success: boolean;
  message: string;
  inserted: number;
  updated: number;
}

const METRIC_CARDS: MetricCard[] = [
  { label: 'Giường', key: 'giuong', icon: <BedDouble size={18} />, color: 'text-lnk bg-bdg' },
  { label: 'Điều hòa', key: 'dieu_hoa', icon: <Snowflake size={18} />, color: 'text-ok bg-okbg' },
  { label: 'Tủ', key: 'tu', icon: <Package size={18} />, color: 'text-wn tint-wn' },
  { label: 'Quạt', key: 'quat', icon: <Fan size={18} />, color: 'text-ok bg-okbg' },
  { label: 'Ổ cắm điện', key: 'o_cam_dien', icon: <Zap size={18} />, color: 'text-wn tint-wn' },
  { label: 'Remote', key: 'remote', icon: <Tv size={18} />, color: 'text-lnk bg-bdg' },
  { label: 'Bóng tuýp', key: 'bong_tuyp', icon: <Lightbulb size={18} />, color: 'text-pri2 bg-bdg' },
  { label: 'Bàn ăn', key: 'ban_an', icon: <UtensilsCrossed size={18} />, color: 'text-ok bg-okbg' },
  { label: 'Ghế ăn', key: 'ghe_an', icon: <UtensilsCrossed size={18} />, color: 'text-mu bg-act' },
];

const NUMERIC_FIELDS: (keyof EditingRow)[] = ['giuong', 'dieu_hoa', 'tu', 'quat', 'o_cam_dien', 'remote', 'bong_tuyp', 'ban_an', 'ghe_an'];

// ─── Excel column header → DB field mapping ───────────────────────────────────
function normalizeHeader(h: string): string {
  return h.toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function normalizeLoose(h: string): string {
  return stripDiacritics(normalizeHeader(h));
}

type DbField = keyof Omit<FacilityRow, 'id'>;

const COLUMN_MAP_EXACT: Record<string, DbField> = {
  // KTX
  'ktx': 'ktx', 'ký túc xá': 'ktx', 'ky tuc xa': 'ktx', 'cơ sở': 'ktx', 'co so': 'ktx',
  // Dãy
  'dãy': 'day', 'day': 'day', 'dây': 'day', 'dãy/khu': 'day', 'day/khu': 'day', 'dãy nhà': 'day', 'day nha': 'day',
  // Loại phòng (Phân loại chức năng / phòng ở) — MUST BE MAPPED BEFORE general 'phong'
  'loại phòng': 'room_type', 'loai phong': 'room_type', 'loại': 'room_type', 'loai': 'room_type',
  'phân loại': 'room_type', 'phan loai': 'room_type', 'phân loại phòng': 'room_type', 'phan loai phong': 'room_type',
  'chức năng': 'room_type', 'chuc nang': 'room_type', 'room type': 'room_type', 'room_type': 'room_type',
  // Hiển thị sơ đồ (Ẩn/Hiện trên map grid)
  'hiển thị sơ đồ': 'is_visible', 'hien thi so do': 'is_visible', 'hiển thị': 'is_visible', 'hien thi': 'is_visible',
  'hiển thị trên sơ đồ': 'is_visible', 'hien thi tren so do': 'is_visible', 'sơ đồ': 'is_visible', 'so do': 'is_visible',
  'ẩn/hiện': 'is_visible', 'an/hien': 'is_visible', 'is_visible': 'is_visible', 'visible': 'is_visible',
  // Phòng / Khu vực (Tên/Số phòng thực tế: Phòng 1, Phòng 2, Nhà ăn 1...)
  'phòng/khu vực': 'phong_khu_vuc', 'phong/khu vuc': 'phong_khu_vuc',
  'phòng': 'phong_khu_vuc', 'phong': 'phong_khu_vuc',
  'phòng số': 'phong_khu_vuc', 'phong so': 'phong_khu_vuc',
  'tên phòng': 'phong_khu_vuc', 'ten phong': 'phong_khu_vuc',
  'số phòng': 'phong_khu_vuc', 'so phong': 'phong_khu_vuc',
  'khu vực': 'phong_khu_vuc', 'khu vuc': 'phong_khu_vuc',
  'phòng/khu': 'phong_khu_vuc', 'phong khu vuc': 'phong_khu_vuc',
  // Thiết bị & CSVC
  'giường': 'giuong', 'giuong': 'giuong', 'số giường': 'giuong', 'so giuong': 'giuong', 'sức chứa': 'giuong', 'suc chua': 'giuong',
  'điều hòa': 'dieu_hoa', 'dieu hoa': 'dieu_hoa', 'điều hoà': 'dieu_hoa', 'ac': 'dieu_hoa',
  'dieu hòa': 'dieu_hoa', 'điều hoa': 'dieu_hoa',
  'tủ': 'tu', 'tu': 'tu', 'số tủ': 'tu',
  'quạt': 'quat', 'quat': 'quat', 'số quạt': 'quat',
  'ổ cắm': 'o_cam_dien', 'o cam': 'o_cam_dien', 'ổ cắm điện': 'o_cam_dien', 'o cam dien': 'o_cam_dien',
  'ổ điện': 'o_cam_dien', 'o dien': 'o_cam_dien', 'ổ cắm dien': 'o_cam_dien',
  'remote': 'remote', 'điều khiển': 'remote', 'dieu khien': 'remote', 'điều khiên': 'remote',
  'bóng tuýp': 'bong_tuyp', 'bong tuyp': 'bong_tuyp', 'bóng đèn': 'bong_tuyp', 'bong den': 'bong_tuyp',
  'tuýp': 'bong_tuyp', 'tuyp': 'bong_tuyp', 'bóng tuyp': 'bong_tuyp', 'bong tuýp': 'bong_tuyp',
  'bàn ăn': 'ban_an', 'ban an': 'ban_an', 'bàn': 'ban_an',
  'ghế ăn': 'ghe_an', 'ghe an': 'ghe_an', 'ghế': 'ghe_an',
  'ghi chú': 'ghi_chu', 'ghi chu': 'ghi_chu', 'note': 'ghi_chu', 'notes': 'ghi_chu',
};

const COLUMN_MAP_LOOSE: Record<string, DbField> = {
  'ktx': 'ktx', 'co so': 'ktx',
  'day': 'day', 'day/khu': 'day', 'day nha': 'day',
  'loai phong': 'room_type', 'phan loai': 'room_type', 'chuc nang': 'room_type',
  'hien thi so do': 'is_visible', 'hien thi': 'is_visible', 'an/hien': 'is_visible', 'so do': 'is_visible',
  'phong': 'phong_khu_vuc', 'phong/khu vuc': 'phong_khu_vuc', 'khu vuc': 'phong_khu_vuc',
  'phong/khu': 'phong_khu_vuc', 'phong so': 'phong_khu_vuc', 'ten phong': 'phong_khu_vuc',
  'giuong': 'giuong', 'so giuong': 'giuong', 'suc chua': 'giuong',
  'dieu hoa': 'dieu_hoa', 'ac': 'dieu_hoa',
  'tu': 'tu', 'so tu': 'tu',
  'quat': 'quat', 'so quat': 'quat',
  'o cam': 'o_cam_dien', 'o cam dien': 'o_cam_dien', 'o dien': 'o_cam_dien',
  'remote': 'remote', 'dieu khien': 'remote',
  'bong tuyp': 'bong_tuyp', 'bong den': 'bong_tuyp', 'tuyp': 'bong_tuyp',
  'ban an': 'ban_an', 'ban': 'ban_an',
  'ghe an': 'ghe_an', 'ghe': 'ghe_an',
  'ghi chu': 'ghi_chu', 'note': 'ghi_chu', 'notes': 'ghi_chu',
};

function normalizeDayNha(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^(?:dãy|day)\s+/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `Dãy ${trimmed}`;
  return trimmed;
}

function normalizeKtxName(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const match = trimmed.match(/^ktx\s*(\d+)$/i);
  if (match) return `KTX ${match[1]}`;
  if (/^\d+$/.test(trimmed)) return `KTX ${trimmed}`;
  return trimmed;
}

function resolveColumnField(rawHeader: string): DbField | 'stt' | null {
  const norm = normalizeHeader(rawHeader);
  const loose = normalizeLoose(rawHeader);
  if (norm === 'stt' || loose === 'stt') return 'stt';
  if (COLUMN_MAP_EXACT[norm]) return COLUMN_MAP_EXACT[norm];
  if (COLUMN_MAP_LOOSE[loose]) return COLUMN_MAP_LOOSE[loose];

  // Specific compound checks BEFORE checking general substring 'phong':
  if (loose.includes('loai phong') || loose.includes('phan loai') || loose.includes('chuc nang') || loose === 'loai') return 'room_type';
  if (loose.includes('hien thi') || loose.includes('an/hien') || (loose.includes('so do') && !loose.includes('phong'))) return 'is_visible';
  if (loose === 'ktx' || loose.includes('ky tuc xa') || loose.includes('co so')) return 'ktx';
  if (loose.includes('day') || loose.includes('khu nha')) return 'day';
  if (loose.includes('giuong') || loose.includes('suc chua')) return 'giuong';
  if (loose.includes('dieu hoa') || loose.includes('dieu hòa')) return 'dieu_hoa';
  if (loose.includes('o cam') || loose.includes('o dien')) return 'o_cam_dien';
  if (loose.includes('bong tuyp') || loose.includes('bong den') || loose.includes('tuyp')) return 'bong_tuyp';
  if (loose.includes('ban an') || loose.includes('ban')) return 'ban_an';
  if (loose.includes('ghe an') || loose.includes('ghe')) return 'ghe_an';
  if (loose.includes('remote') || loose.includes('dieu khien')) return 'remote';
  if (loose.includes('quat')) return 'quat';
  if (loose.includes('ghi chu') || loose.includes('note')) return 'ghi_chu';

  // Room / khu vuc ONLY after checking room_type, is_visible, etc.:
  if (loose.includes('phong') || loose.includes('khu vuc')) return 'phong_khu_vuc';
  return null;
}

function resolveKtxFromSheetName(sheetName: string): string | null {
  const loose = normalizeLoose(sheetName).replace(/\s+/g, '');
  const match = loose.match(/ktx\s*(\d+)/);
  if (match) return `KTX ${match[1]}`;
  const numMatch = loose.match(/(\d+)/);
  if (numMatch) return `KTX ${numMatch[1]}`;
  return null;
}

function parseSheetToRows(sheet: XLSX.WorkSheet, ktxName: string): Omit<FacilityRow, 'id'>[] {
  const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!jsonData || jsonData.length < 2) return [];
  const SEARCH_LIMIT = Math.min(10, jsonData.length);
  let headerRowIdx = -1;
  let headerMap: Record<number, DbField> = {};
  let sttColIdx = -1;

  for (let i = 0; i < SEARCH_LIMIT; i++) {
    const row = jsonData[i];
    const hasStt = row.some((cell: any) => normalizeHeader(String(cell ?? '')) === 'stt');
    if (hasStt) { headerRowIdx = i; break; }
  }

  if (headerRowIdx === -1) {
    let bestMatchCount = 0;
    for (let i = 0; i < SEARCH_LIMIT; i++) {
      const row = jsonData[i];
      let matchCount = 0;
      row.forEach((cell: any) => {
        const field = resolveColumnField(String(cell ?? ''));
        if (field && field !== 'stt') matchCount++;
      });
      if (matchCount > bestMatchCount) { bestMatchCount = matchCount; headerRowIdx = i; }
    }
    if (bestMatchCount < 2) headerRowIdx = Math.min(6, jsonData.length - 1);
  }

  const headerRow = jsonData[headerRowIdx] || [];
  headerRow.forEach((cell: any, colIdx: number) => {
    const field = resolveColumnField(String(cell ?? ''));
    if (field === 'stt') {
      sttColIdx = colIdx;
    } else if (field) {
      headerMap[colIdx] = field as DbField;
    }
  });

  const dataStartIdx = headerRowIdx + 1;
  const results: Omit<FacilityRow, 'id'>[] = [];

  for (let i = dataStartIdx; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.every((c: any) => c === '' || c === null || c === undefined)) continue;
    const record: Omit<FacilityRow, 'id'> = {
      ktx: ktxName,
      day: '',
      phong_khu_vuc: '',
      giuong: 0,
      dieu_hoa: 0,
      tu: 0,
      quat: 0,
      o_cam_dien: 0,
      remote: 0,
      bong_tuyp: 0,
      ban_an: 0,
      ghe_an: 0,
      ghi_chu: '',
      room_type: 'accommodation',
      is_visible: true,
    };
    let hasExplicitRoomType = false;
    let hasExplicitVisibility = false;

    Object.entries(headerMap).forEach(([colIdxStr, field]) => {
      const colIdx = Number(colIdxStr);
      const cellVal = row[colIdx];
      if (cellVal === undefined || cellVal === null) return;
      const strVal = String(cellVal).trim();

      if (field === 'ktx') {
        if (strVal) record.ktx = normalizeKtxName(strVal);
      } else if (field === 'day') {
        if (strVal) record.day = normalizeDayNha(strVal);
      } else if (field === 'phong_khu_vuc') {
        if (strVal) record.phong_khu_vuc = strVal;
      } else if (field === 'room_type') {
        const lower = strVal.toLowerCase();
        if (lower.includes('chức năng') || lower.includes('chuc nang') || lower.includes('functional') || lower.includes('bql') || lower.includes('kho') || lower.includes('y tế') || lower.includes('y te')) {
          record.room_type = 'functional';
          hasExplicitRoomType = true;
        } else if (lower.includes('ở') || lower.includes('o') || lower.includes('accommodation') || lower.includes('công nhân') || lower.includes('cong nhan')) {
          record.room_type = 'accommodation';
          hasExplicitRoomType = true;
        }
      } else if (field === 'is_visible') {
        const lower = strVal.toLowerCase();
        if (lower === 'ẩn' || lower === 'an' || lower === 'hide' || lower === 'hidden' || lower === 'false' || lower === '0' || lower === 'không' || lower === 'khong') {
          record.is_visible = false;
          hasExplicitVisibility = true;
        } else if (lower === 'hiện' || lower === 'hien' || lower === 'show' || lower === 'true' || lower === '1' || lower === 'có' || lower === 'co') {
          record.is_visible = true;
          hasExplicitVisibility = true;
        }
      } else if (field === 'ghi_chu') {
        record.ghi_chu = strVal;
      } else {
        const num = Number(cellVal);
        (record as any)[field] = isNaN(num) ? 0 : num;
      }
    });

    // Safeguard: Check if phong_khu_vuc was mistakenly filled with "Phòng ở" or "Phòng chức năng"
    const normPhong = normalizeLoose(record.phong_khu_vuc);
    if (normPhong === 'phong o' || normPhong === 'phong chuc nang') {
      const sttVal = sttColIdx >= 0 ? String(row[sttColIdx] ?? '').trim() : '';
      if (sttVal && /^\d+$/.test(sttVal)) {
        record.phong_khu_vuc = `Phòng ${sttVal}`;
        if (!hasExplicitRoomType) {
          record.room_type = normPhong === 'phong chuc nang' ? 'functional' : 'accommodation';
        }
      }
    }

    // Auto-detect functional rooms by name if not explicit (e.g. Nhà ăn, Y tế, BQL...)
    const lowerName = stripDiacritics(record.phong_khu_vuc.toLowerCase());
    if (
      lowerName.includes('nha an') ||
      lowerName.includes('y te') ||
      lowerName.includes('kho') ||
      lowerName.includes('bql') ||
      lowerName.includes('bao ve') ||
      lowerName.includes('hanh chinh') ||
      lowerName.includes('chuc nang')
    ) {
      if (!hasExplicitRoomType) {
        record.room_type = 'functional';
      }
      if (!hasExplicitVisibility) {
        record.is_visible = false;
      }
    }

    // Skip summary / total rows (e.g. "TỔNG CỘNG", "65 phòng", etc.)
    const rawKtxLower = (record.ktx || '').toLowerCase();
    const rawDayLower = (record.day || '').toLowerCase();
    const rawPhongLower = (record.phong_khu_vuc || '').toLowerCase();
    if (
      rawKtxLower.includes('tổng') || rawKtxLower.includes('tong') ||
      rawDayLower.includes('tổng') || rawDayLower.includes('tong') ||
      rawPhongLower.includes('tổng cộng') || rawPhongLower.includes('tong cong') ||
      /^\d+\s*phòng$/i.test(rawPhongLower.trim())
    ) {
      continue;
    }

    if (!record.day && !record.phong_khu_vuc) continue;
    results.push(record);
  }
  return results;
}

function resolveSheets(workbook: XLSX.WorkBook): { sheetName: string; ktxName: string }[] {
  const sheets = workbook.SheetNames;
  if (sheets.length === 1) {
    const ktx = resolveKtxFromSheetName(sheets[0]) ?? sheets[0];
    return [{ sheetName: sheets[0], ktxName: ktx }];
  }
  const result: { sheetName: string; ktxName: string }[] = [];
  for (const sheetName of sheets) {
    const ktx = resolveKtxFromSheetName(sheetName) ?? sheetName;
    if (ktx) result.push({ sheetName, ktxName: ktx });
  }
  return result;
}

// ─── Blocked Delete Modal (Workers still present) ─────────────────────────────
function BlockedDeleteModal({ row, workerCount, onClose }: {
  row: FacilityRow;
  workerCount: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-dgrbg flex items-center justify-center flex-shrink-0 text-dgr border border-dgr">
            <AlertCircle size={24} />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-base">Không thể xóa phòng này!</h3>
            <p className="text-xs text-dgr font-semibold">Phòng đang có {workerCount} công nhân lưu trú</p>
          </div>
        </div>
        <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1.5">
          <p><strong className="text-foreground">Vị trí:</strong> {row.day} — {row.phong_khu_vuc} ({row.ktx})</p>
          <p><strong className="text-foreground">Quy tắc an toàn:</strong> Không được xóa phòng khi sĩ số &gt; 0 để tránh mất dữ liệu lưu trú. Vui lòng chuyển phòng hoặc duyệt check-out toàn bộ công nhân trước khi xóa phòng vật lý.</p>
        </div>
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Đã hiểu, đóng thông báo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ row, onConfirm, onCancel, deleting }: {
  row: FacilityRow;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-dgrbg flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-dgr" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Xóa phòng/khu vực</h3>
            <p className="text-sm text-muted-foreground">Phòng đang trống (0 công nhân). Hành động này không thể hoàn tác.</p>
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
          <span className="font-medium">{row.day}</span> — <span>{row.phong_khu_vuc}</span>
          <span className="ml-2 text-muted-foreground text-xs">({row.ktx})</span>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={deleting}
            className="px-4 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
            Hủy
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 bg-dgr hover:opacity-90 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-opacity">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Xóa vĩnh viễn
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk & All Delete Confirmation Modal ─────────────────────────────────────
function BulkDeleteModal({
  mode,
  targets,
  occupiedCount,
  totalWorkers,
  onConfirm,
  onCancel,
  deleting,
}: {
  mode: 'selected' | 'all';
  targets: FacilityRow[];
  occupiedCount: number;
  totalWorkers: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const safeCount = targets.length - occupiedCount;
  const isAllOccupied = targets.length > 0 && safeCount === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg p-5 sm:p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-dgr">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-base sm:text-lg">
              {mode === 'all' ? 'Xác nhận xóa tất cả cơ sở vật chất' : `Xác nhận xóa hàng loạt (${targets.length} phòng)`}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === 'all'
                ? 'Hành động này sẽ xóa toàn bộ các phòng hợp lệ đang hiển thị'
                : `Hành động này sẽ xóa ${targets.length} phòng/khu vực bạn đã chọn`}
            </p>
          </div>
        </div>

        {occupiedCount > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 text-xs text-amber-300 space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-amber-400">
              <AlertCircle size={14} className="shrink-0" />
              <span>Phát hiện {occupiedCount} phòng đang có {totalWorkers} công nhân cư trú:</span>
            </p>
            <p className="text-muted-foreground">
              Theo quy tắc bảo toàn dữ liệu lưu trú, hệ thống <strong className="text-amber-200">sẽ giữ lại</strong> {occupiedCount} phòng này và chỉ tiến hành xóa các phòng trống. {isAllOccupied ? 'Hiện không có phòng trống nào đủ điều kiện xóa.' : `Chỉ ${safeCount} phòng còn lại đang trống (0 người) sẽ bị xóa.`}
            </p>
          </div>
        )}

        <div className="bg-muted/50 border border-border rounded-xl p-3 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Tổng số phòng yêu cầu xóa:</span>
            <span className="font-bold text-foreground">{targets.length} phòng</span>
          </div>
          {occupiedCount > 0 && (
            <div className="flex justify-between items-center text-amber-400">
              <span>Bảo vệ (đang có công nhân):</span>
              <span className="font-bold">Giữ lại {occupiedCount} phòng</span>
            </div>
          )}
          <div className="flex justify-between items-center border-t border-border pt-2">
            <span className="text-foreground font-semibold">Thực tế sẽ xóa vĩnh viễn:</span>
            <span className="font-extrabold text-dgr text-sm">{safeCount} phòng (trống)</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground italic">
          * Lưu ý: Thao tác này không thể hoàn tác. Các phòng bị xóa sẽ mất khỏi danh mục và sơ đồ phòng.
        </p>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted text-foreground transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting || isAllOccupied}
            className="flex items-center gap-2 px-4 py-2 bg-dgr hover:bg-dgr/90 text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition-opacity shadow-sm"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            <span>{isAllOccupied ? 'Không có phòng đủ điều kiện xóa' : `Xác nhận xóa ${safeCount} phòng`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Add Room Modal ───────────────────────────────────────────────────────────
function AddRoomModal({ activeKtx, ktxOptions, onSave, onClose, saving }: {
  activeKtx: string;
  ktxOptions: string[];
  onSave: (row: Omit<FacilityRow, 'id'>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { ktxNames } = useKtxStructure();
  const [form, setForm] = useState<Omit<FacilityRow, 'id'>>({
    ktx: activeKtx, day: '', phong_khu_vuc: '', giuong: 20, dieu_hoa: 2, tu: 4,
    quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, ghi_chu: '',
    room_type: 'accommodation', is_visible: true
  });
  const [newKtxInput, setNewKtxInput] = useState('');
  const canSave = form.day.trim() && form.phong_khu_vuc.trim() && form.ktx.trim();

  const allKtxChoices = Array.from(new Set([...ktxOptions, ...ktxNames])).sort(compareKtxNames);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Thêm phòng/khu vực mới</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* KTX selector — required field */}
          <div className="col-span-2 sm:col-span-3">
            <label className="text-xs text-muted-foreground mb-1 block font-medium">Khu KTX *</label>
            <div className="flex gap-2">
              <select
                value={form.ktx}
                onChange={e => setForm(r => ({ ...r, ktx: e.target.value }))}
                className="flex-1 px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {allKtxChoices.map(k => <option key={k} value={k}>{k}</option>)}
                <option value="__new__">+ Nhập KTX khác...</option>
              </select>
              {form.ktx === '__new__' && (
                <input
                  type="text"
                  placeholder="VD: KTX 6"
                  value={newKtxInput}
                  onChange={e => { setNewKtxInput(e.target.value); setForm(r => ({ ...r, ktx: e.target.value })); }}
                  className="w-32 px-2 py-1.5 text-sm border border-primary rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Dãy *</label>
            <input type="text" value={form.day} onChange={e => setForm(r => ({ ...r, day: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Dãy 1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Phòng/Khu vực *</label>
            <input type="text" value={form.phong_khu_vuc} onChange={e => setForm(r => ({ ...r, phong_khu_vuc: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="1" />
          </div>

          {/* Room Type Classification */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Loại phòng</label>
            <select
              value={form.room_type}
              onChange={e => setForm(r => ({
                ...r,
                room_type: e.target.value as 'accommodation' | 'functional',
                giuong: e.target.value === 'functional' ? 0 : (r.giuong || 20)
              }))}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-medium"
            >
              <option value="accommodation">Phòng ở (Tính sức chứa & sơ đồ)</option>
              <option value="functional">Phòng chức năng (BQL, Y tế, Kho...)</option>
            </select>
          </div>

          {NUMERIC_FIELDS.map(f => (
            <div key={f as string}>
              <label className="text-xs text-muted-foreground mb-1 block">{METRIC_CARDS.find(m => m.key === f)?.label || f as string}</label>
              <input type="number" min={0} value={(form as any)[f as string]}
                onChange={e => setForm(r => ({ ...r, [f as string]: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-center" />
            </div>
          ))}

          <div className="col-span-2 sm:col-span-3">
            <label className="text-xs text-muted-foreground mb-1 block">Ghi chú</label>
            <input type="text" value={form.ghi_chu} onChange={e => setForm(r => ({ ...r, ghi_chu: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Ghi chú..." />
          </div>

          <div className="col-span-2 sm:col-span-3 flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="add_is_visible"
              checked={form.is_visible !== false}
              onChange={e => setForm(r => ({ ...r, is_visible: e.target.checked }))}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="add_is_visible" className="text-xs text-foreground cursor-pointer font-medium select-none">
              Hiển thị phòng này trên Bảng điều khiển và Sơ đồ phòng
            </label>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
            Hủy
          </button>
          <button onClick={() => onSave(form)} disabled={saving || !canSave}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Lưu phòng
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FacilitiesClient() {
  const [rows, setRows] = useState<FacilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKtx, setActiveKtx] = useState<string>('');

  // Filters
  const [filterDay, setFilterDay] = useState<string>('');
  const [searchPhong, setSearchPhong] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingRow, setAddingRow] = useState(false);

  // Delete modal & guard
  const [deleteTarget, setDeleteTarget] = useState<FacilityRow | null>(null);
  const [blockedTarget, setBlockedTarget] = useState<{ row: FacilityRow; count: number } | null>(null);
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Multi-select & Bulk Delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteModal, setBulkDeleteModal] = useState<{
    mode: 'selected' | 'all';
    targets: FacilityRow[];
    occupiedCount: number;
    totalWorkers: number;
    safeToDelete: FacilityRow[];
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkActionSuccess, setBulkActionSuccess] = useState<string | null>(null);

  const [sortField, setSortField] = useState<keyof FacilityRow>('day');
  const [sortAsc, setSortAsc] = useState(true);

  // Import Excel state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  const fetchFacilities = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('facilities')
        .select('*')
        .order('day', { ascending: true })
        .order('phong_khu_vuc', { ascending: true });
      if (error) console.error('Fetch facilities error:', error.message);
      else {
        const fetched: FacilityRow[] = (data || []).map((r: any) => ({
          ...r,
          room_type: (r.room_type || 'accommodation') as 'accommodation' | 'functional',
          is_visible: r.is_visible !== false,
        }));
        setRows(fetched);
        // Auto-set activeKtx to first available KTX from DB
        if (fetched.length > 0 && !activeKtx) {
          const firstKtx = Array.from(new Set(fetched.map((r: FacilityRow) => r.ktx).filter(Boolean))).sort(compareKtxNames)[0];
          if (firstKtx) setActiveKtx(firstKtx as string);
        }
      }
    } catch (e: any) {
      console.error('Fetch error:', e.message);
    } finally {
      setLoading(false);
    }
  }, [activeKtx, supabase]);

  useEffect(() => { fetchFacilities(); }, [fetchFacilities]);

  // Realtime: keep facilities list in sync across devices.
  useEffect(() => {
    const channel = supabase
      .channel('facilities_realtime_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, () => {
        fetchFacilities();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchFacilities, supabase]);

  // ─── Derived KTX tabs from actual DB data ────────────────────────────────
  const allKtxTabs = Array.from(
    new Set(
      rows
        .map(r => (r.ktx || '').trim())
        .filter(k => k && !k.toLowerCase().includes('tổng') && !k.toLowerCase().includes('tong') && !k.toLowerCase().includes('cơ sở vật chất'))
    )
  ).sort(compareKtxNames);

  // If activeKtx not in tabs (e.g. after data load), reset to first
  useEffect(() => {
    if (allKtxTabs.length > 0 && !allKtxTabs.includes(activeKtx)) {
      setActiveKtx(allKtxTabs[0]);
      setFilterDay('');
      setSearchPhong('');
    }
  }, [allKtxTabs, activeKtx]);

  // ─── Derived filter options scoped to active KTX tab ─────────────────────
  const allDayOptions = Array.from(new Set(
    rows.filter(r => r.ktx === activeKtx).map(r => r.day).filter(Boolean)
  )).sort(naturalSortCompare);

  // ─── Filtered rows — always scoped to activeKtx tab ──────────────────────
  const filteredRows = rows.filter(r => {
    if (r.ktx !== activeKtx) return false;
    if (filterDay && r.day !== filterDay) return false;
    if (searchPhong.trim()) {
      const q = searchPhong.toLowerCase();
      if (!r.phong_khu_vuc?.toLowerCase().includes(q) && !r.day?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
    if (typeof av === 'boolean' && typeof bv === 'boolean') return sortAsc ? (av === bv ? 0 : av ? -1 : 1) : (av === bv ? 0 : av ? 1 : -1);
    return sortAsc
      ? naturalSortCompare(String(av ?? ''), String(bv ?? ''))
      : naturalSortCompare(String(bv ?? ''), String(av ?? ''));
  });

  // Metrics calculated from filtered rows
  const totals = filteredRows.reduce((acc, r) => {
    METRIC_CARDS.forEach(m => { acc[m.key] = (acc[m.key] || 0) + (r[m.key] || 0); });
    return acc;
  }, {} as Record<string, number>);

  // ─── Import Excel ─────────────────────────────────────────────────────────
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImporting(true);
    setImportResult(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetMappings = resolveSheets(workbook);
      let allParsedRows: Omit<FacilityRow, 'id'>[] = [];
      for (const { sheetName, ktxName } of sheetMappings) {
        const sheet = workbook.Sheets[sheetName];
        const parsed = parseSheetToRows(sheet, ktxName);
        allParsedRows = allParsedRows.concat(parsed);
      }
      if (allParsedRows.length === 0) {
        setImportResult({ success: false, message: `Không tìm thấy dữ liệu hợp lệ trong file. Kiểm tra lại file Excel (sheet: ${workbook.SheetNames.join(', ')}).`, inserted: 0, updated: 0 });
        setImporting(false);
        return;
      }
      // Clean up any legacy corrupted rows where phong_khu_vuc was literally saved as 'Phòng ở' or 'Phòng chức năng'
      await supabase
        .from('facilities')
        .delete()
        .in('phong_khu_vuc', ['Phòng ở', 'Phòng chức năng']);

      const { data: existingData, error: fetchErr } = await supabase.from('facilities').select('id, ktx, day, phong_khu_vuc');
      if (fetchErr) throw new Error(fetchErr.message);
      const existingMap = new Map<string, string>();
      (existingData || []).forEach((r: any) => existingMap.set(`${r.ktx}||${r.day}||${r.phong_khu_vuc}`, r.id));
      const toInsert: Omit<FacilityRow, 'id'>[] = [];
      const toUpdate: (Omit<FacilityRow, 'id'> & { id: string })[] = [];
      allParsedRows.forEach(row => {
        const key = `${row.ktx}||${row.day}||${row.phong_khu_vuc}`;
        const existingId = existingMap.get(key);
        if (existingId) toUpdate.push({ ...row, id: existingId });
        else toInsert.push(row);
      });
      let insertedCount = 0, updatedCount = 0;
      const errors: string[] = [];
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += 50) {
          const batch = toInsert.slice(i, i + 50);
          const { error: insertErr } = await supabase.from('facilities').insert(batch);
          if (insertErr) errors.push(`Insert error: ${insertErr.message}`);
          else insertedCount += batch.length;
        }
      }
      if (toUpdate.length > 0) {
        for (const row of toUpdate) {
          const { id, ...updateData } = row;
          const { error: updateErr } = await supabase.from('facilities').update(updateData).eq('id', id);
          if (updateErr) errors.push(`Update error (${row.day} - ${row.phong_khu_vuc}): ${updateErr.message}`);
          else updatedCount++;
        }
      }
      if (errors.length > 0) {
        setImportResult({ success: false, message: `Có lỗi xảy ra: ${errors.slice(0, 2).join('; ')}`, inserted: insertedCount, updated: updatedCount });
      } else {
        setImportResult({ success: true, message: `Import thành công! Đã thêm ${insertedCount} dòng mới, cập nhật ${updatedCount} dòng.`, inserted: insertedCount, updated: updatedCount });
      }
      await fetchFacilities();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
      }
    } catch (err: any) {
      setImportResult({ success: false, message: `Lỗi đọc file: ${err.message}`, inserted: 0, updated: 0 });
    } finally {
      setImporting(false);
    }
  };

  // ─── Export Excel ─────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    const exportData = sortedRows.map(r => ({
      'KTX': r.ktx,
      'Dãy': r.day,
      'Phòng/Khu vực': r.phong_khu_vuc,
      'Loại phòng': r.room_type === 'functional' ? 'Phòng chức năng' : 'Phòng ở',
      'Hiển thị sơ đồ': r.is_visible ? 'Hiện' : 'Ẩn',
      'Giường': r.giuong,
      'Điều hòa': r.dieu_hoa,
      'Tủ': r.tu,
      'Quạt': r.quat,
      'Ổ cắm điện': r.o_cam_dien,
      'Remote': r.remote,
      'Bóng tuýp': r.bong_tuyp,
      'Bàn ăn': r.ban_an,
      'Ghế ăn': r.ghe_an,
      'Ghi chú': r.ghi_chu || '',
    }));
    exportData.push({
      'KTX': 'TỔNG CỘNG',
      'Dãy': '',
      'Phòng/Khu vực': `${filteredRows.length} phòng`,
      'Loại phòng': '',
      'Hiển thị sơ đồ': '',
      'Giường': totals['giuong'] || 0,
      'Điều hòa': totals['dieu_hoa'] || 0,
      'Tủ': totals['tu'] || 0,
      'Quạt': totals['quat'] || 0,
      'Ổ cắm điện': totals['o_cam_dien'] || 0,
      'Remote': totals['remote'] || 0,
      'Bóng tuýp': totals['bong_tuyp'] || 0,
      'Bàn ăn': totals['ban_an'] || 0,
      'Ghế ăn': totals['ghe_an'] || 0,
      'Ghi chú': '',
    });
    const filterLabel = activeKtx ? `_${activeKtx.replace(' ', '')}` : '';
    const fileName = `CSVC_KTX_PhuocVinhTay${filterLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    exportToExcel(exportData, fileName, 'Cơ sở vật chất');
  };

  // ─── Add row ──────────────────────────────────────────────────────────────
  const handleAddRow = async (newRow: Omit<FacilityRow, 'id'>) => {
    setAddingRow(true);
    try {
      const { data, error } = await supabase.from('facilities').insert(newRow).select().single();
      if (error) console.error('Add row error:', error.message);
      else if (data) {
        setRows(prev => [...prev, data]);
        // Switch to the KTX tab of the newly added room
        setActiveKtx(newRow.ktx);
        setFilterDay('');
        setSearchPhong('');
        setShowAddModal(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
      }
    } catch (e: any) {
      console.error('Add error:', e.message);
    } finally {
      setAddingRow(false);
    }
  };

  // ─── Edit row ─────────────────────────────────────────────────────────────
  const startEdit = (row: FacilityRow) => {
    setEditingId(row.id);
    setEditingRow({
      id: row.id,
      giuong: row.giuong,
      dieu_hoa: row.dieu_hoa,
      tu: row.tu,
      quat: row.quat,
      o_cam_dien: row.o_cam_dien,
      remote: row.remote,
      bong_tuyp: row.bong_tuyp,
      ban_an: row.ban_an,
      ghe_an: row.ghe_an,
      ghi_chu: row.ghi_chu || '',
      room_type: row.room_type || 'accommodation',
      is_visible: row.is_visible !== false,
    });
    setSaveError(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditingRow(null); setSaveError(null); };

  const saveEdit = async () => {
    if (!editingRow) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updatePayload: Record<string, any> = {};
      NUMERIC_FIELDS.forEach(f => { updatePayload[f as string] = Number(editingRow[f]) || 0; });
      updatePayload['ghi_chu'] = editingRow.ghi_chu;
      updatePayload['room_type'] = editingRow.room_type;
      updatePayload['is_visible'] = editingRow.is_visible;

      const { error } = await supabase.from('facilities').update(updatePayload).eq('id', editingRow.id);
      if (error) setSaveError(error.message);
      else {
        setRows(prev => prev.map(r => r.id === editingRow.id ? { ...r, ...updatePayload } as FacilityRow : r));
        setEditingId(null);
        setEditingRow(null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
      }
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Toggle is_visible directly ───────────────────────────────────────────
  const toggleVisibility = async (row: FacilityRow) => {
    const nextVisible = row.is_visible === false ? true : false;
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_visible: nextVisible } : r));
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ is_visible: nextVisible })
        .eq('id', row.id);
      if (error) {
        console.warn('Update is_visible error:', error.message);
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_visible: !nextVisible } : r));
      } else {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
      }
    } catch (err) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_visible: !nextVisible } : r));
    }
  };

  // ─── Delete guard & check ─────────────────────────────────────────────────
  const handleRequestDelete = async (row: FacilityRow) => {
    setCheckingDeleteId(row.id);
    try {
      const { count, error } = await supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('ktx', row.ktx)
        .eq('day', row.day)
        .eq('phong_so', row.phong_khu_vuc);

      let occupantCount = (!error && typeof count === 'number') ? count : 0;

      // Fallback check in mock storage if count is 0
      if (occupantCount === 0 && typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('ktx_mock_db_workers');
          if (stored) {
            const list = JSON.parse(stored);
            if (Array.isArray(list)) {
              occupantCount = list.filter((w: any) =>
                (w.ktx ?? '').trim() === (row.ktx ?? '').trim() &&
                (w.day ?? '').trim() === (row.day ?? '').trim() &&
                (w.phong_so ?? '').trim() === (row.phong_khu_vuc ?? '').trim()
              ).length;
            }
          }
        } catch {}
      }

      if (occupantCount > 0) {
        setBlockedTarget({ row, count: occupantCount });
        return;
      }
      setDeleteTarget(row);
    } catch (err) {
      console.warn('Check workers before delete failed:', err);
      setDeleteTarget(row);
    } finally {
      setCheckingDeleteId(null);
    }
  };

  // ─── Delete row ───────────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('facilities').delete().eq('id', deleteTarget.id);
      if (!error) {
        setRows(prev => prev.filter(r => r.id !== deleteTarget.id));
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(deleteTarget.id);
          return next;
        });
        setDeleteTarget(null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
      }
    } catch (e: any) {
      console.error('Delete error:', e.message);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Check Occupancy across multiple rooms ────────────────────────────────
  const checkRoomsOccupancy = useCallback(async (roomTargets: FacilityRow[]) => {
    try {
      const { data: workerRows, error } = await supabase
        .from('workers')
        .select('ktx, day, phong_so');

      let workersList: any[] = [];
      if (!error && workerRows) {
        workersList = workerRows;
      } else if (typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('ktx_mock_db_workers');
          if (stored) workersList = JSON.parse(stored) || [];
        } catch {}
      }

      const occMap = new Map<string, number>();
      workersList.forEach((w: any) => {
        const k = (w.ktx || '').trim();
        const b = (w.day || '').trim();
        const r = (w.phong_so || w.phongSo || '').trim();
        if (k && b && r) {
          const key = `${k}||${b}||${r}`;
          occMap.set(key, (occMap.get(key) || 0) + 1);
        }
      });

      let occupiedRoomsCount = 0;
      let totalOccWorkers = 0;
      const safeToDelete: FacilityRow[] = [];
      const blockedRooms: FacilityRow[] = [];

      roomTargets.forEach(row => {
        const key = `${(row.ktx || '').trim()}||${(row.day || '').trim()}||${(row.phong_khu_vuc || '').trim()}`;
        const count = occMap.get(key) || 0;
        if (count > 0) {
          occupiedRoomsCount++;
          totalOccWorkers += count;
          blockedRooms.push(row);
        } else {
          safeToDelete.push(row);
        }
      });

      return {
        safeToDelete,
        blockedRooms,
        occupiedCount: occupiedRoomsCount,
        totalWorkers: totalOccWorkers,
      };
    } catch (err) {
      console.warn('Check rooms occupancy error:', err);
      return {
        safeToDelete: roomTargets,
        blockedRooms: [],
        occupiedCount: 0,
        totalWorkers: 0,
      };
    }
  }, [supabase]);

  // Request batch deletion of selected rooms
  const handleRequestBulkDelete = useCallback(async () => {
    const targets = sortedRows.filter(r => selectedIds.has(r.id));
    if (targets.length === 0) return;
    setDeleting(true);
    const result = await checkRoomsOccupancy(targets);
    setDeleting(false);
    setBulkDeleteModal({
      mode: 'selected',
      targets,
      occupiedCount: result.occupiedCount,
      totalWorkers: result.totalWorkers,
      safeToDelete: result.safeToDelete,
    });
  }, [sortedRows, selectedIds, checkRoomsOccupancy]);

  // Request deletion of all rooms in active view/tab
  const handleRequestDeleteAll = useCallback(async () => {
    if (sortedRows.length === 0) return;
    setDeleting(true);
    const result = await checkRoomsOccupancy(sortedRows);
    setDeleting(false);
    setBulkDeleteModal({
      mode: 'all',
      targets: sortedRows,
      occupiedCount: result.occupiedCount,
      totalWorkers: result.totalWorkers,
      safeToDelete: result.safeToDelete,
    });
  }, [sortedRows, checkRoomsOccupancy]);

  // Confirm and execute bulk deletion
  const handleConfirmBulkDelete = useCallback(async () => {
    if (!bulkDeleteModal || bulkDeleteModal.safeToDelete.length === 0) return;
    setBulkDeleting(true);
    try {
      const idsToDelete = bulkDeleteModal.safeToDelete.map(r => r.id);
      const { error } = await supabase
        .from('facilities')
        .delete()
        .in('id', idsToDelete);

      if (error) throw new Error(error.message);

      setRows(prev => prev.filter(r => !idsToDelete.includes(r.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        idsToDelete.forEach(id => next.delete(id));
        return next;
      });
      setBulkDeleteModal(null);

      // Trigger sync event for Dashboard
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
      }

      setBulkActionSuccess(`✓ Đã xóa thành công ${idsToDelete.length} phòng/khu vực khỏi cơ sở vật chất.`);
      setTimeout(() => setBulkActionSuccess(null), 6000);
    } catch (err: any) {
      alert(`Lỗi khi xóa: ${err?.message || 'Không thể xóa dữ liệu'}`);
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleteModal, supabase]);

  // Checkbox selection helpers
  const isAllSelected = sortedRows.length > 0 && sortedRows.every(r => selectedIds.has(r.id));
  const isSomeSelected = sortedRows.some(r => selectedIds.has(r.id)) && !isAllSelected;

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<string>();
      sortedRows.forEach(r => next.add(r.id));
      setSelectedIds(next);
    }
  }, [isAllSelected, sortedRows]);

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSort = (field: keyof FacilityRow) => {
    if (sortField === field) setSortAsc(prev => !prev);
    else { setSortField(field); setSortAsc(true); }
  };

  const SortIcon = ({ field }: { field: keyof FacilityRow }) => {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp size={12} className="inline ml-0.5" /> : <ChevronDown size={12} className="inline ml-0.5" />;
  };

  const thClass = "px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground select-none";
  const tdClass = "px-3 py-2 text-sm text-foreground whitespace-nowrap";
  const inputClass = "w-16 px-1.5 py-0.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-center";

  const hasActiveFilters = filterDay || searchPhong.trim();

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Modals */}
      {showAddModal && (
        <AddRoomModal
          activeKtx={activeKtx}
          ktxOptions={allKtxTabs}
          onSave={handleAddRow}
          onClose={() => setShowAddModal(false)}
          saving={addingRow}
        />
      )}
      {blockedTarget && (
        <BlockedDeleteModal
          row={blockedTarget.row}
          workerCount={blockedTarget.count}
          onClose={() => setBlockedTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          row={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
      {bulkDeleteModal && (
        <BulkDeleteModal
          mode={bulkDeleteModal.mode}
          targets={bulkDeleteModal.targets}
          occupiedCount={bulkDeleteModal.occupiedCount}
          totalWorkers={bulkDeleteModal.totalWorkers}
          onConfirm={handleConfirmBulkDelete}
          onCancel={() => setBulkDeleteModal(null)}
          deleting={bulkDeleting}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Quản lý Cơ sở vật chất</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Theo dõi và cập nhật trang thiết bị từng phòng/khu vực</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center justify-center gap-2 px-3 py-2 border border-bdr3 bg-transparent text-tx rounded-lg text-xs sm:text-sm font-medium hover:bg-act disabled:opacity-60 transition-colors flex-1 sm:flex-initial"
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {importing ? 'Đang import...' : 'Import Excel'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={loading || sortedRows.length === 0}
            className="flex items-center justify-center gap-2 px-3 py-2 border border-bdr3 bg-transparent text-tx rounded-lg text-xs sm:text-sm font-medium hover:bg-act disabled:opacity-60 transition-colors flex-1 sm:flex-initial"
          >
            <Download size={15} />
            Xuất Excel
          </button>
          <button
            onClick={handleRequestDeleteAll}
            disabled={loading || sortedRows.length === 0 || deleting}
            title={hasActiveFilters ? "Xóa tất cả các phòng đang hiển thị theo bộ lọc" : `Xóa tất cả ${sortedRows.length} phòng trong danh mục`}
            className="flex items-center justify-center gap-1.5 px-3 py-2 border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50 flex-1 sm:flex-initial"
          >
            <Trash2 size={15} />
            <span>Xóa tất cả</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs sm:text-sm font-medium hover:opacity-90 transition-opacity flex-1 sm:flex-initial"
          >
            <Plus size={15} />
            Thêm phòng mới
          </button>
        </div>
      </div>

      {/* Import Result Banner */}
      {importResult && (
        <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${importResult.success ? 'bg-okbg border-bdr2 text-ok' : 'bg-dgrbg border-dgr text-dgr'}`}>
          {importResult.success ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" /> : <AlertCircle size={18} className="mt-0.5 shrink-0 text-dgr" />}
          <div className="flex-1">
            <p className="font-medium">{importResult.message}</p>
            {importResult.success && <p className="text-xs mt-0.5 text-ok">Thêm mới: {importResult.inserted} dòng &nbsp;|&nbsp; Cập nhật: {importResult.updated} dòng</p>}
          </div>
          <button onClick={() => setImportResult(null)} className="shrink-0 opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      {/* Dynamic KTX Sub-tabs — auto-generated from DB */}
      {loading ? (
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
          {[1, 2].map(i => <div key={i} className="w-20 h-8 bg-muted-foreground/20 rounded-md animate-pulse" />)}
        </div>
      ) : allKtxTabs.length > 0 ? (
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit flex-wrap">
          {allKtxTabs.map(ktx => (
            <button
              key={ktx}
              onClick={() => { setActiveKtx(ktx); setEditingId(null); setEditingRow(null); setFilterDay(''); setSearchPhong(''); setSelectedIds(new Set()); }}
              className={`px-5 py-2 rounded-md text-sm font-semibold transition-all ${activeKtx === ktx ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {ktx}
            </button>
          ))}
        </div>
      ) : null}

      {/* Filters scoped to active KTX tab */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter size={13} />
          <span className="font-medium">Bộ lọc:</span>
        </div>
        <select
          value={filterDay}
          onChange={e => setFilterDay(e.target.value)}
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Tất cả Dãy</option>
          {allDayOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Tìm phòng..."
            value={searchPhong}
            onChange={e => setSearchPhong(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-40"
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterDay(''); setSearchPhong(''); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <X size={12} /> Xóa lọc
          </button>
        )}
      </div>

      {/* Metrics — calculated from filtered rows */}
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {METRIC_CARDS.map(m => (
            <div key={m.key} className="bg-card border border-border rounded-xl p-3 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-6 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {METRIC_CARDS.map(m => (
            <div key={m.key} className="bg-card border border-border rounded-xl p-3 flex flex-col gap-1.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${m.color}`}>{m.icon}</div>
              <p className="text-xs text-muted-foreground leading-tight">{m.label}</p>
              <p className="text-lg font-bold text-foreground font-tabular">{(totals[m.key] || 0).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bulk Action Success Notification */}
      {bulkActionSuccess && (
        <div className="flex items-center gap-2 p-3 bg-okbg border border-bdr2 text-ok text-sm rounded-lg animate-in fade-in">
          <CheckCircle2 size={16} className="shrink-0" />
          <span className="flex-1 font-medium">{bulkActionSuccess}</span>
          <button onClick={() => setBulkActionSuccess(null)} className="opacity-60 hover:opacity-100">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Floating / Sticky Bulk Selection Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/30 rounded-xl text-sm flex-wrap gap-2 animate-in fade-in">
          <div className="flex items-center gap-2 text-foreground font-medium">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
              {selectedIds.size}
            </span>
            <span>Đã chọn <strong>{selectedIds.size}</strong> / {sortedRows.length} phòng đang hiển thị</span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground underline ml-2"
            >
              Bỏ chọn
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRequestBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Trash2 size={14} />
              <span>Xóa {selectedIds.size} phòng đã chọn</span>
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {activeKtx} — {sortedRows.length} phòng/khu vực
              {hasActiveFilters && <span className="ml-2 text-xs tint-wn text-wn border border-wn px-1.5 py-0.5 rounded-full">đang lọc</span>}
            </span>
            {selectedIds.size > 0 && (
              <span className="text-xs bg-primary/20 text-primary font-medium px-2 py-0.5 rounded-full">
                Đã chọn {selectedIds.size}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {saveError && <span className="text-xs text-dgr">{saveError}</span>}
            {sortedRows.length > 0 && (
              <>
                {selectedIds.size > 0 ? (
                  <button
                    type="button"
                    onClick={handleRequestBulkDelete}
                    className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-md shadow-sm transition-colors"
                  >
                    <Trash2 size={13} />
                    <span>Xóa ({selectedIds.size}) đã chọn</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <CheckSquare size={13} />
                    <span>Chọn tất cả</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRequestDeleteAll}
                  disabled={sortedRows.length === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors disabled:opacity-50"
                  title="Xóa toàn bộ danh mục phòng hiển thị"
                >
                  <Trash2 size={13} />
                  <span>Xóa hết ({sortedRows.length})</span>
                </button>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-primary" /></div>
        ) : sortedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package size={40} className="mb-3 opacity-30" />
            <p className="text-sm">{hasActiveFilters ? 'Không tìm thấy kết quả phù hợp' : `Chưa có dữ liệu cho ${activeKtx}`}</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-3 py-2.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={el => {
                        if (el) el.indeterminate = isSomeSelected;
                      }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-border text-primary cursor-pointer align-middle"
                      title={isAllSelected ? "Bỏ chọn tất cả" : "Chọn tất cả phòng hiển thị"}
                    />
                  </th>
                  <th className={thClass} onClick={() => handleSort('ktx')}>KTX <SortIcon field="ktx" /></th>
                  <th className={thClass} onClick={() => handleSort('day')}>Dãy <SortIcon field="day" /></th>
                  <th className={thClass} onClick={() => handleSort('phong_khu_vuc')}>Phòng/Khu vực <SortIcon field="phong_khu_vuc" /></th>
                  <th className={thClass} onClick={() => handleSort('room_type')}>Loại phòng <SortIcon field="room_type" /></th>
                  <th className={thClass} onClick={() => handleSort('is_visible')}>Hiển thị <SortIcon field="is_visible" /></th>
                  <th className={thClass} onClick={() => handleSort('giuong')}>Giường <SortIcon field="giuong" /></th>
                  <th className={thClass} onClick={() => handleSort('dieu_hoa')}>Điều hòa <SortIcon field="dieu_hoa" /></th>
                  <th className={thClass} onClick={() => handleSort('tu')}>Tủ <SortIcon field="tu" /></th>
                  <th className={thClass} onClick={() => handleSort('quat')}>Quạt <SortIcon field="quat" /></th>
                  <th className={thClass} onClick={() => handleSort('o_cam_dien')}>Ổ cắm <SortIcon field="o_cam_dien" /></th>
                  <th className={thClass} onClick={() => handleSort('remote')}>Remote <SortIcon field="remote" /></th>
                  <th className={thClass} onClick={() => handleSort('bong_tuyp')}>Bóng tuýp <SortIcon field="bong_tuyp" /></th>
                  <th className={thClass} onClick={() => handleSort('ban_an')}>Bàn ăn <SortIcon field="ban_an" /></th>
                  <th className={thClass} onClick={() => handleSort('ghe_an')}>Ghế ăn <SortIcon field="ghe_an" /></th>
                  <th className={thClass}>Ghi chú</th>
                  <th className={`${thClass} text-right`}>Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedRows.map(row => {
                  const isEditing = editingId === row.id;
                  const isSelected = selectedIds.has(row.id);
                  return (
                    <tr key={row.id} className={`transition-colors ${isEditing ? 'bg-primary/5' : isSelected ? 'bg-primary/10' : 'hover:bg-muted/30'}`}>
                      <td className="px-3 py-2 w-10 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(row.id)}
                          className="w-4 h-4 rounded border-border text-primary cursor-pointer align-middle"
                          title={`Chọn phòng ${row.phong_khu_vuc}`}
                        />
                      </td>
                      <td className={tdClass}><span className="text-xs bg-muted px-1.5 py-0.5 rounded font-medium">{row.ktx}</span></td>
                      <td className={tdClass}><span className="font-medium">{row.day}</span></td>
                      <td className={tdClass}>{row.phong_khu_vuc}</td>

                      {/* Loại phòng */}
                      <td className={tdClass}>
                        {isEditing && editingRow ? (
                          <select
                            value={editingRow.room_type}
                            onChange={e => setEditingRow(r => r ? { ...r, room_type: e.target.value as any } : r)}
                            className="px-2 py-1 text-xs border border-border rounded bg-background text-foreground"
                          >
                            <option value="accommodation">Phòng ở</option>
                            <option value="functional">Chức năng</option>
                          </select>
                        ) : row.room_type === 'functional' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-950/40 text-purple-300 border border-purple-500/30">
                            🏢 Chức năng
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-bdg text-lnk border border-bdr2">
                            🛏️ Phòng ở
                          </span>
                        )}
                      </td>

                      {/* Hiển thị */}
                      <td className={tdClass}>
                        {isEditing && editingRow ? (
                          <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={editingRow.is_visible}
                              onChange={e => setEditingRow(r => r ? { ...r, is_visible: e.target.checked } : r)}
                              className="w-3.5 h-3.5 rounded border-border text-primary"
                            />
                            <span>{editingRow.is_visible ? 'Hiện' : 'Ẩn'}</span>
                          </label>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleVisibility(row)}
                            title={row.is_visible !== false ? 'Bấm để ẩn khỏi Dashboard & KPI' : 'Bấm để hiện lên Dashboard & KPI'}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold transition-all border ${
                              row.is_visible !== false
                                ? 'bg-okbg text-ok border-bdr2 hover:opacity-85'
                                : 'bg-muted text-muted-foreground border-border opacity-70 hover:opacity-100'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${row.is_visible !== false ? 'bg-ok2 animate-pulse' : 'bg-gray-400'}`} />
                            <span>{row.is_visible !== false ? 'Hiện' : 'Ẩn'}</span>
                          </button>
                        )}
                      </td>

                      {isEditing && editingRow ? (
                        <>
                          {NUMERIC_FIELDS.map(f => (
                            <td key={f as string} className="px-2 py-1.5">
                              <input type="number" min={0} value={(editingRow as any)[f as string]}
                                onChange={e => setEditingRow(r => r ? { ...r, [f as string]: Number(e.target.value) } : r)}
                                className={inputClass} />
                            </td>
                          ))}
                          <td className="px-2 py-1.5">
                            <input type="text" value={editingRow.ghi_chu}
                              onChange={e => setEditingRow(r => r ? { ...r, ghi_chu: e.target.value } : r)}
                              className="w-28 px-1.5 py-0.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={saveEdit} disabled={saving}
                                className="p-1.5 rounded-lg bg-okbg text-ok hover:opacity-90 transition-colors disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              </button>
                              <button onClick={cancelEdit} className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
                                <X size={14} />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`${tdClass} text-center font-tabular`}>{row.giuong}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.dieu_hoa}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.tu}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.quat}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.o_cam_dien}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.remote}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.bong_tuyp}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.ban_an}</td>
                          <td className={`${tdClass} text-center font-tabular`}>{row.ghe_an}</td>
                          <td className={`${tdClass} text-muted-foreground max-w-[120px] truncate`}>{row.ghi_chu || '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => startEdit(row)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Sửa">
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleRequestDelete(row)}
                                disabled={checkingDeleteId === row.id}
                                className="p-1.5 rounded-lg text-mu hover:bg-dgrbg hover:text-dgr transition-colors disabled:opacity-50"
                                title="Xóa phòng (Chỉ cho phép khi 0 công nhân)"
                              >
                                {checkingDeleteId === row.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/60 border-t-2 border-border">
                <tr>
                  <td className="px-3 py-2.5 text-xs font-bold text-foreground" colSpan={6}>TỔNG CỘNG ({filteredRows.length} phòng)</td>
                  {METRIC_CARDS.map(m => (
                    <td key={m.key} className="px-3 py-2.5 text-center text-sm font-bold text-foreground font-tabular">
                      {(totals[m.key] || 0).toLocaleString()}
                    </td>
                  ))}
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Import Help */}
      <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
        <span className="font-medium">Hướng dẫn Import Excel:</span> Hỗ trợ file <code className="bg-muted px-1 rounded">.xlsx</code> có 1 hoặc nhiều sheet với tên bất kỳ (KTX 1, KTX 2, KTX 3...). Hàng tiêu đề tự động nhận dạng qua từ khóa <strong>STT</strong>. Các cột nhận dạng tự động: <em>Dãy, Phòng/Khu vực, Giường, Điều hòa, Tủ, Quạt, Ổ cắm điện, Remote, Bóng tuýp, Bàn ăn, Ghế ăn</em>.
      </div>
    </div>
  );
}
