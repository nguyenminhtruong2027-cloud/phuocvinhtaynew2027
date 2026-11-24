'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { toast } from 'sonner';
import {
  Search, Edit2, Check, X, Plus, Loader2, BedDouble, Wind, Package, Fan,
  Zap, Tv, Lightbulb, UtensilsCrossed, ChevronDown, ChevronUp, Upload,
  AlertCircle, CheckCircle2, Download, Trash2, Filter, Snowflake, AlertTriangle, CheckSquare, Square, Lock, Building2, Box, Eye, EyeOff, Layers,
} from 'lucide-react';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import Sync3DBlueprintModal from './Sync3DBlueprintModal';
import BulkEquipmentModal, { EquipmentNumericField } from './BulkEquipmentModal';
import * as XLSX from 'xlsx';
import { exportToExcel } from '@/lib/exportExcel';
import {
  useKtxStructure,
  invalidateKtxStructureCache,
  normalizeKtxLabel,
  normalizeDayLabel,
} from '@/lib/ktxStructure';
import { compareKtxNames, naturalSortCompare } from '@/data/workers';
import { getVNDateString } from '@/lib/vnDate';
import { syncBedsForFacilityRoom } from '@/lib/bedSync';
import { invalidateFacilitiesCache, normalizeRoomLabel } from '@/lib/facilityCapacity';

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

const ISSUE_NOTE_REGEX = /hỏng|hư|sửa|bảo trì|lỗi|thay|kém|yếu|chập/i;

function hasFacilityIssue(note?: string | null): boolean {
  return Boolean(note && ISSUE_NOTE_REGEX.test(note));
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
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
          <div className="tint-wn border border-wn/35 rounded-xl p-3.5 text-xs text-wn space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-wn">
              <AlertCircle size={14} className="shrink-0" />
              <span>Phát hiện {occupiedCount} phòng đang có {totalWorkers} công nhân cư trú:</span>
            </p>
            <p className="text-mu">
              Theo quy tắc bảo toàn dữ liệu lưu trú, hệ thống <strong className="text-tx">sẽ giữ lại</strong> {occupiedCount} phòng này và chỉ tiến hành xóa các phòng trống. {isAllOccupied ? 'Hiện không có phòng trống nào đủ điều kiện xóa.' : `Chỉ ${safeCount} phòng còn lại đang trống (0 người) sẽ bị xóa.`}
            </p>
          </div>
        )}

        <div className="bg-muted/50 border border-border rounded-xl p-3 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Tổng số phòng yêu cầu xóa:</span>
            <span className="font-bold text-foreground">{targets.length} phòng</span>
          </div>
          {occupiedCount > 0 && (
            <div className="flex justify-between items-center text-wn">
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


function normalizeAddKtxName(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) return `KTX ${trimmed}`;
  return normalizeKtxLabel(trimmed);
}

// ─── Add Room Modal ───────────────────────────────────────────────────────────
function AddRoomModal({ activeKtx, ktxOptions, existingRows, onSave, onClose, saving }: {
  activeKtx: string;
  ktxOptions: string[];
  existingRows: FacilityRow[];
  onSave: (row: Omit<FacilityRow, 'id'>, keepOpen?: boolean) => Promise<boolean>;
  onClose: () => void;
  saving: boolean;
}) {
  const { ktxGroups, ktxNames } = useKtxStructure();
  const allKtxChoices = Array.from(
    new Set([...ktxOptions, ...ktxNames, activeKtx].map(s => (s || '').trim()).filter(Boolean))
  ).sort(compareKtxNames);

  const defaultKtx = (activeKtx || allKtxChoices[0] || '').trim();
  const [isCustomKtx, setIsCustomKtx] = useState(!defaultKtx);
  const [newKtxInput, setNewKtxInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const [form, setForm] = useState<Omit<FacilityRow, 'id'>>({
    ktx: defaultKtx, day: '', phong_khu_vuc: '', giuong: 20, dieu_hoa: 2, tu: 4,
    quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, ghi_chu: '',
    room_type: 'accommodation', is_visible: true
  });

  const customKtxInputRef = useRef<HTMLInputElement>(null);
  const dayInputRef = useRef<HTMLInputElement>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);

  const resolvedPreviewKtx = normalizeAddKtxName(isCustomKtx ? newKtxInput : form.ktx);
  const suggestedDays = ktxGroups.find(g => g.ktx === resolvedPreviewKtx)?.days || [];

  const handleSubmit = async (keepOpen: boolean) => {
    setValidationError(null);
    const finalKtx = normalizeAddKtxName(isCustomKtx ? newKtxInput : form.ktx);
    const finalDay = normalizeDayLabel(form.day.trim());
    const finalRoom = form.phong_khu_vuc.trim();

    if (!finalKtx) {
      setValidationError('Vui lòng chọn hoặc nhập tên Khu KTX (VD: KTX 3, KTX 4).');
      if (isCustomKtx) customKtxInputRef.current?.focus();
      return;
    }
    if (!finalDay) {
      setValidationError('Vui lòng nhập tên Dãy (VD: Dãy 1).');
      dayInputRef.current?.focus();
      return;
    }
    if (!finalRoom) {
      setValidationError('Vui lòng nhập tên Phòng/Khu vực (VD: Phòng 1 hoặc 1).');
      roomInputRef.current?.focus();
      return;
    }

    const normRoom = normalizeRoomLabel(finalRoom);
    const duplicate = existingRows.find(
      r =>
        (r.ktx || '').trim() === finalKtx &&
        normalizeDayLabel(r.day || '') === finalDay &&
        normalizeRoomLabel(r.phong_khu_vuc || '') === normRoom
    );
    if (duplicate) {
      setValidationError(`Phòng "${duplicate.phong_khu_vuc}" tại ${finalKtx} - ${finalDay} đã tồn tại trong Cơ sở vật chất.`);
      roomInputRef.current?.focus();
      return;
    }

    const ok = await onSave(
      {
        ...form,
        ktx: finalKtx,
        day: finalDay,
        phong_khu_vuc: finalRoom,
      },
      keepOpen
    );

    if (ok && keepOpen) {
      setIsCustomKtx(false);
      setNewKtxInput('');
      setForm(prev => ({
        ...prev,
        ktx: finalKtx,
        day: finalDay,
        phong_khu_vuc: '',
        ghi_chu: '',
      }));
      setTimeout(() => roomInputRef.current?.focus(), 30);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Thêm phòng/khu vực mới</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {validationError && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-dgr/40 bg-dgrbg text-xs text-dgr font-medium">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            <span>{validationError}</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* KTX selector — required field */}
          <div className="col-span-2 sm:col-span-3">
            <label className="text-xs text-muted-foreground mb-1 block font-medium">Khu KTX *</label>
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <select
                value={isCustomKtx ? '__new__' : form.ktx}
                onChange={e => {
                  const val = e.target.value;
                  setValidationError(null);
                  if (val === '__new__') {
                    setIsCustomKtx(true);
                    setForm(r => ({ ...r, ktx: newKtxInput }));
                    setTimeout(() => customKtxInputRef.current?.focus(), 20);
                  } else {
                    setIsCustomKtx(false);
                    setForm(r => ({ ...r, ktx: val }));
                  }
                }}
                className="flex-1 min-w-[180px] px-2.5 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {allKtxChoices.map(k => <option key={k} value={k}>{k}</option>)}
                <option value="__new__">+ Nhập KTX khác...</option>
              </select>
              {isCustomKtx && (
                <input
                  ref={customKtxInputRef}
                  type="text"
                  placeholder="VD: KTX 3"
                  value={newKtxInput}
                  onChange={e => {
                    const val = e.target.value;
                    setValidationError(null);
                    setNewKtxInput(val);
                    setForm(r => ({ ...r, ktx: val }));
                  }}
                  className="w-full sm:w-44 px-2.5 py-1.5 text-sm border border-primary rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Dãy *</label>
            <input
              ref={dayInputRef}
              list="facility_day_suggestions"
              type="text"
              value={form.day}
              onChange={e => { setValidationError(null); setForm(r => ({ ...r, day: e.target.value })); }}
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="VD: Dãy 1"
            />
            {suggestedDays.length > 0 && (
              <datalist id="facility_day_suggestions">
                {suggestedDays.map(d => <option key={d} value={d} />)}
              </datalist>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Phòng/Khu vực *</label>
            <input
              ref={roomInputRef}
              type="text"
              value={form.phong_khu_vuc}
              onChange={e => { setValidationError(null); setForm(r => ({ ...r, phong_khu_vuc: e.target.value })); }}
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="VD: Phòng 1 hoặc 1"
            />
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
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Ghi chú..." />
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
        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
            Hủy
          </button>
          <button type="button" onClick={() => handleSubmit(true)} disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-primary/50 text-primary bg-primary/10 rounded-lg text-sm font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Lưu &amp; Thêm tiếp
          </button>
          <button type="button" onClick={() => handleSubmit(false)} disabled={saving}
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
  const { isAdmin, isTechnician, canDeleteAll, canWriteBlock, canAccessMaintenanceBlock, currentUser } = useAuth();
  const { addLog } = useAudit();
  const { workers } = useWorkers();
  const [rows, setRows] = useState<FacilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKtx, setActiveKtx] = useState<string>('');

  // Filters
  const [filterDay, setFilterDay] = useState<string>('');
  const [filterRoomType, setFilterRoomType] = useState<'all' | 'accommodation' | 'functional'>('all');
  const [filterVisibility, setFilterVisibility] = useState<'all' | 'visible' | 'hidden'>('all');
  const [searchPhong, setSearchPhong] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalInitialKtx, setAddModalInitialKtx] = useState<string | null>(null);
  const [addingRow, setAddingRow] = useState(false);

  const { ktxNames: structureKtxNames, reload: reloadKtxStructure } = useKtxStructure();
  const activeKtxRef = useRef(activeKtx);
  activeKtxRef.current = activeKtx;

  // Delete & Hide guard modals
  const [deleteTarget, setDeleteTarget] = useState<FacilityRow | null>(null);
  const [blockedTarget, setBlockedTarget] = useState<{ row: FacilityRow; count: number } | null>(null);
  const [hideConfirmTarget, setHideConfirmTarget] = useState<{ row: FacilityRow; count: number } | null>(null);
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Multi-select & Bulk Actions state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteModal, setBulkDeleteModal] = useState<{
    mode: 'selected' | 'all';
    targets: FacilityRow[];
    occupiedCount: number;
    totalWorkers: number;
    safeToDelete: FacilityRow[];
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkActionSuccess, setBulkActionSuccess] = useState<string | null>(null);

  const [sortField, setSortField] = useState<keyof FacilityRow>('day');
  const [sortAsc, setSortAsc] = useState(true);

  // Import Excel & 3D Blueprint Sync modal state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showSync3DModal, setShowSync3DModal] = useState(false);
  const [showBulkEquipmentModal, setShowBulkEquipmentModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  const canWriteFacility = useCallback(
    (ktx?: string, day?: string) =>
      isAdmin || (isTechnician ? canAccessMaintenanceBlock(day || '', ktx || '') : canWriteBlock(day || '', ktx || '')),
    [isAdmin, isTechnician, canWriteBlock, canAccessMaintenanceBlock]
  );

  const fetchFacilities = useCallback(async () => {
    setLoading(true);
    try {
      const PAGE_SIZE = 1000;
      const allData: any[] = [];
      let from = 0;
      for (let page = 0; page < 30; page++) {
        const { data, error } = await supabase
          .from('facilities')
          .select('*')
          .order('day', { ascending: true })
          .order('phong_khu_vuc', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error('Fetch facilities error:', error.message);
          break;
        }
        const chunk = data || [];
        allData.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const byId = new Map<string, FacilityRow>();
      allData.forEach((r: any, idx: number) => {
        const id = String(r?.id ?? `fac-${idx}`);
        byId.set(id, {
          ...r,
          id,
          room_type: (r.room_type || 'accommodation') as 'accommodation' | 'functional',
          is_visible: r.is_visible !== false,
        });
      });
      const fetched: FacilityRow[] = Array.from(byId.values()).sort(
        (a, b) =>
          compareKtxNames(a.ktx || '', b.ktx || '') ||
          naturalSortCompare(a.day || '', b.day || '') ||
          naturalSortCompare(a.phong_khu_vuc || '', b.phong_khu_vuc || '')
      );
      setRows(fetched);
      if (fetched.length > 0 && !activeKtxRef.current) {
        const firstKtx = Array.from(new Set(fetched.map((r: FacilityRow) => r.ktx).filter(Boolean))).sort(compareKtxNames)[0];
        if (firstKtx) setActiveKtx(firstKtx as string);
      }
    } catch (e: any) {
      console.error('Fetch error:', e.message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

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

  const missingFacilityKtxs = structureKtxNames.filter(
    k => k && !(k.startsWith('__') && k.endsWith('__')) && !allKtxTabs.includes(k)
  );

  // If activeKtx not in tabs (e.g. after data load or deleting last room of a tab), reset to first
  useEffect(() => {
    if (allKtxTabs.length > 0 && (!activeKtx || !allKtxTabs.includes(activeKtx))) {
      setActiveKtx(allKtxTabs[0]);
      setFilterDay('');
      setSearchPhong('');
    }
  }, [allKtxTabs, activeKtx]);

  // ─── Derived filter options scoped to active KTX tab ─────────────────────
  const ktxScopedRows = rows.filter(r => r.ktx === activeKtx);
  const allDayOptions = Array.from(new Set(
    ktxScopedRows.map(r => r.day).filter(Boolean)
  )).sort(naturalSortCompare);

  const issueCountInKtx = ktxScopedRows.filter(r => hasFacilityIssue(r.ghi_chu)).length;
  const functionalCountInKtx = ktxScopedRows.filter(r => r.room_type === 'functional').length;
  const accommodationCountInKtx = ktxScopedRows.length - functionalCountInKtx;
  const hiddenCountInKtx = ktxScopedRows.filter(r => r.is_visible === false).length;
  const visibleCountInKtx = ktxScopedRows.length - hiddenCountInKtx;

  // ─── Filtered rows — always scoped to activeKtx tab ──────────────────────
  const filteredRows = ktxScopedRows.filter(r => {
    if (filterDay && r.day !== filterDay) return false;
    if (filterRoomType === 'functional' && r.room_type !== 'functional') return false;
    if (filterRoomType === 'accommodation' && r.room_type === 'functional') return false;
    if (filterVisibility === 'hidden' && r.is_visible !== false) return false;
    if (filterVisibility === 'visible' && r.is_visible === false) return false;
    if (onlyIssues && !hasFacilityIssue(r.ghi_chu)) return false;
    if (searchPhong.trim()) {
      const q = searchPhong.toLowerCase();
      if (
        !r.phong_khu_vuc?.toLowerCase().includes(q) &&
        !r.day?.toLowerCase().includes(q) &&
        !r.ghi_chu?.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    let diff = 0;
    if (typeof av === 'number' && typeof bv === 'number') {
      diff = sortAsc ? av - bv : bv - av;
    } else if (typeof av === 'boolean' && typeof bv === 'boolean') {
      diff = sortAsc
        ? (av === bv ? 0 : av ? -1 : 1)
        : (av === bv ? 0 : av ? 1 : -1);
    } else {
      diff = sortAsc
        ? naturalSortCompare(String(av ?? ''), String(bv ?? ''))
        : naturalSortCompare(String(bv ?? ''), String(av ?? ''));
    }
    if (diff !== 0) return diff;
    return (
      naturalSortCompare(a.day || '', b.day || '') ||
      naturalSortCompare(a.phong_khu_vuc || '', b.phong_khu_vuc || '')
    );
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
    if (!isAdmin) {
      toast.error('Chỉ Quản trị viên (Admin) mới có quyền Import Excel hàng loạt.');
      return;
    }
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

      // Paginated read of existing facilities to support >1,000 rows safely
      const existingData: any[] = [];
      let exFrom = 0;
      const EX_PAGE = 1000;
      for (let p = 0; p < 30; p++) {
        const { data: exChunk, error: fetchErr } = await supabase
          .from('facilities')
          .select('id, ktx, day, phong_khu_vuc')
          .order('id', { ascending: true })
          .range(exFrom, exFrom + EX_PAGE - 1);
        if (fetchErr) throw new Error(fetchErr.message);
        const list = exChunk || [];
        existingData.push(...list);
        if (list.length < EX_PAGE) break;
        exFrom += EX_PAGE;
      }

      const existingMap = new Map<string, string>();
      existingData.forEach((r: any) => existingMap.set(`${r.ktx}||${r.day}||${r.phong_khu_vuc}`, r.id));
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
        const UPDATE_CHUNK = 10;
        for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
          const chunk = toUpdate.slice(i, i + UPDATE_CHUNK);
          const results = await Promise.all(
            chunk.map(async row => {
              const { id, ...updateData } = row;
              const { error: updateErr } = await supabase.from('facilities').update(updateData).eq('id', id);
              return { row, updateErr };
            })
          );
          for (const { row, updateErr } of results) {
            if (updateErr) errors.push(`Update error (${row.day} - ${row.phong_khu_vuc}): ${updateErr.message}`);
            else updatedCount++;
          }
        }
      }

      // Synchronize beds for imported accommodation rooms in parallel chunks
      const syncTargets = [...toInsert, ...toUpdate];
      for (let i = 0; i < syncTargets.length; i += 10) {
        await Promise.all(syncTargets.slice(i, i + 10).map(r => syncBedsForFacilityRoom(supabase, r)));
      }

      if (errors.length > 0) {
        setImportResult({ success: false, message: `Có lỗi xảy ra: ${errors.slice(0, 2).join('; ')}`, inserted: insertedCount, updated: updatedCount });
      } else {
        setImportResult({ success: true, message: `Import thành công! Đã thêm ${insertedCount} dòng mới, cập nhật ${updatedCount} dòng.`, inserted: insertedCount, updated: updatedCount });
      }
      invalidateKtxStructureCache();
      reloadKtxStructure(true);
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
    const fileName = `CSVC_KTX_PhuocVinhTay${filterLabel}_${getVNDateString()}.xlsx`;
    exportToExcel(exportData, fileName, 'Cơ sở vật chất');
  };

  // ─── Add row ──────────────────────────────────────────────────────────────
  const handleAddRow = async (newRow: Omit<FacilityRow, 'id'>, keepOpen = false): Promise<boolean> => {
    if (!canWriteFacility(newRow.ktx, newRow.day)) {
      toast.error(`Bạn không có quyền thêm phòng tại ${newRow.ktx} - ${newRow.day}.`);
      return false;
    }
    setAddingRow(true);
    try {
      const { data, error } = await supabase.from('facilities').insert(newRow).select().single();
      if (error) {
        toast.error(`Lỗi thêm phòng: ${error.message}`);
        return false;
      }
      if (data) {
        await syncBedsForFacilityRoom(supabase, data as FacilityRow);
        const insertedRow: FacilityRow = {
          ...(data as any),
          room_type: ((data as any).room_type || 'accommodation') as 'accommodation' | 'functional',
          is_visible: (data as any).is_visible !== false,
        };
        setRows(prev =>
          prev.some(r => r.id === insertedRow.id)
            ? prev.map(r => (r.id === insertedRow.id ? insertedRow : r))
            : [...prev, insertedRow]
        );
        setActiveKtx(insertedRow.ktx);
        setFilterDay('');
        setSearchPhong('');
        if (!keepOpen) {
          setShowAddModal(false);
          setAddModalInitialKtx(null);
        }
        invalidateKtxStructureCache();
        reloadKtxStructure(true);
        try {
          addLog(
            currentUser?.email || 'system',
            'FACILITY_CREATE',
            `Thêm phòng: ${insertedRow.ktx} · ${insertedRow.day} · ${insertedRow.phong_khu_vuc} (${insertedRow.giuong} giường, ${insertedRow.room_type === 'functional' ? 'Phòng chức năng' : 'Phòng ở'})`
          );
        } catch {}
        toast.success(`Đã thêm ${insertedRow.phong_khu_vuc} (${insertedRow.ktx} - ${insertedRow.day})`);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
        return true;
      }
      return false;
    } catch (e: any) {
      toast.error(`Lỗi thêm phòng: ${e.message}`);
      return false;
    } finally {
      setAddingRow(false);
    }
  };

  // ─── Edit row ─────────────────────────────────────────────────────────────
  const startEdit = (row: FacilityRow) => {
    if (!canWriteFacility(row.ktx, row.day)) {
      toast.error(`Bạn không có quyền chỉnh sửa phòng tại ${row.ktx} - ${row.day}.`);
      return;
    }
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

  const getRoomOccupantCount = useCallback(
    (ktx: string, day: string, room: string) => {
      const k = (ktx || '').trim();
      const d = (day || '').trim();
      const r = normalizeRoomLabel(room);
      if (!k || !d || !r) return 0;
      return workers.filter(
        w =>
          !(w.ngayRaKTX || '').trim() &&
          !w.ghiChu?.includes('[CHECKOUT]') &&
          (w.ktx || '').trim() === k &&
          (w.day || '').trim() === d &&
          normalizeRoomLabel(w.phongSo) === r
      ).length;
    },
    [workers]
  );

  const saveEdit = async () => {
    if (!editingRow) return;
    const targetRow = rows.find(r => r.id === editingRow.id);
    if (targetRow && !canWriteFacility(targetRow.ktx, targetRow.day)) {
      toast.error(`Bạn không có quyền chỉnh sửa phòng tại ${targetRow.ktx} - ${targetRow.day}.`);
      return;
    }
    if (targetRow) {
      const occupantCount = getRoomOccupantCount(targetRow.ktx, targetRow.day, targetRow.phong_khu_vuc);
      if (editingRow.room_type === 'functional' && occupantCount > 0) {
        const msg = `Phòng ${targetRow.phong_khu_vuc} đang có ${occupantCount} công nhân ở. Hãy chuyển phòng trước khi đổi sang Phòng chức năng.`;
        setSaveError(msg);
        toast.error(msg);
        return;
      }
      const nextBeds = Number(editingRow.giuong) || 0;
      if (editingRow.room_type === 'accommodation' && nextBeds < occupantCount) {
        const msg = `Số giường mới (${nextBeds}) nhỏ hơn số công nhân đang ở (${occupantCount} người). Hãy chuyển bớt người trước khi giảm sức chứa.`;
        setSaveError(msg);
        toast.error(msg);
        return;
      }
    }
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
        const updatedRow = targetRow ? ({ ...targetRow, ...updatePayload } as FacilityRow) : null;
        if (updatedRow) {
          await syncBedsForFacilityRoom(supabase, updatedRow);
        }
        setRows(prev => prev.map(r => r.id === editingRow.id ? { ...r, ...updatePayload } as FacilityRow : r));
        setEditingId(null);
        setEditingRow(null);
        try {
          const roomLabel = targetRow ? `${targetRow.ktx} · ${targetRow.day} · ${targetRow.phong_khu_vuc}` : editingRow.id;
          addLog(
            currentUser?.email || 'system',
            'FACILITY_UPDATE',
            `Cập nhật CSVC phòng: ${roomLabel} (Giường: ${editingRow.giuong}, ${editingRow.room_type === 'functional' ? 'Phòng chức năng' : 'Phòng ở'}, ${editingRow.is_visible ? 'Hiện sơ đồ' : 'Ẩn sơ đồ'})`
          );
        } catch {}
        toast.success('Đã cập nhật trang thiết bị và đồng bộ giường');
        invalidateKtxStructureCache();
        reloadKtxStructure(true);
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
  const executeToggleVisibility = async (row: FacilityRow, nextVisible: boolean) => {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_visible: nextVisible } : r));
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ is_visible: nextVisible })
        .eq('id', row.id);
      if (error) {
        console.warn('Update is_visible error:', error.message);
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_visible: !nextVisible } : r));
        toast.error(`Không thể cập nhật trạng thái hiển thị: ${error.message}`);
      } else {
        await syncBedsForFacilityRoom(supabase, { ...row, is_visible: nextVisible });
        try {
          addLog(
            currentUser?.email || 'system',
            'FACILITY_UPDATE',
            `${nextVisible ? 'Hiện' : 'Ẩn'} phòng trên sơ đồ: ${row.ktx} · ${row.day} · ${row.phong_khu_vuc}`
          );
        } catch {}
        toast.success(nextVisible ? `Đã hiện ${row.phong_khu_vuc} trên sơ đồ` : `Đã ẩn ${row.phong_khu_vuc} khỏi sơ đồ`);
        invalidateFacilitiesCache();
        invalidateKtxStructureCache();
        reloadKtxStructure(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
      }
    } catch {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, is_visible: !nextVisible } : r));
    }
  };

  const toggleVisibility = async (row: FacilityRow) => {
    if (!canWriteFacility(row.ktx, row.day)) {
      toast.error(`Bạn không có quyền thay đổi hiển thị phòng tại ${row.ktx} - ${row.day}.`);
      return;
    }
    const nextVisible = row.is_visible === false ? true : false;
    if (!nextVisible) {
      const occ = getRoomOccupantCount(row.ktx, row.day, row.phong_khu_vuc);
      if (occ > 0) {
        setHideConfirmTarget({ row, count: occ });
        return;
      }
    }
    await executeToggleVisibility(row, nextVisible);
  };

  // ─── 1-Click Toggle room_type directly (Phòng ở <-> Chức năng) ────────────
  const toggleRoomType = async (row: FacilityRow) => {
    if (!canWriteFacility(row.ktx, row.day)) {
      toast.error(`Bạn không có quyền thay đổi loại phòng tại ${row.ktx} - ${row.day}.`);
      return;
    }
    const nextType: 'accommodation' | 'functional' =
      row.room_type === 'functional' ? 'accommodation' : 'functional';
    if (nextType === 'functional') {
      const occ = getRoomOccupantCount(row.ktx, row.day, row.phong_khu_vuc);
      if (occ > 0) {
        toast.error(
          `Không thể chuyển ${row.day} · ${row.phong_khu_vuc} sang Phòng chức năng vì đang có ${occ} công nhân lưu trú.`
        );
        return;
      }
    }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, room_type: nextType } : r));
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ room_type: nextType })
        .eq('id', row.id);
      if (error) {
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, room_type: row.room_type } : r));
        toast.error(`Không thể cập nhật loại phòng: ${error.message}`);
      } else {
        await syncBedsForFacilityRoom(supabase, { ...row, room_type: nextType });
        try {
          addLog(
            currentUser?.email || 'system',
            'FACILITY_UPDATE',
            `Đổi loại phòng: ${row.ktx} · ${row.day} · ${row.phong_khu_vuc} -> ${
              nextType === 'functional' ? 'Phòng chức năng' : 'Phòng ở'
            }`
          );
        } catch {}
        toast.success(
          nextType === 'functional'
            ? `Đã chuyển ${row.day} · ${row.phong_khu_vuc} thành Phòng chức năng`
            : `Đã chuyển ${row.day} · ${row.phong_khu_vuc} về Phòng ở`
        );
        invalidateFacilitiesCache();
        invalidateKtxStructureCache();
        reloadKtxStructure(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
      }
    } catch {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, room_type: row.room_type } : r));
    }
  };

  // ─── Delete guard & check ─────────────────────────────────────────────────
  const handleRequestDelete = async (row: FacilityRow) => {
    if (!canWriteFacility(row.ktx, row.day)) {
      toast.error(`Bạn không có quyền xóa phòng tại ${row.ktx} - ${row.day}.`);
      return;
    }
    setCheckingDeleteId(row.id);
    try {
      const { count, error } = await supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('ktx', row.ktx)
        .eq('day', row.day)
        .eq('phong_so', row.phong_khu_vuc);

      const occupantCount = (!error && typeof count === 'number') ? count : 0;

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
      const deletedTarget = deleteTarget;
      const { error } = await supabase.from('facilities').delete().eq('id', deletedTarget.id);
      if (!error) {
        await syncBedsForFacilityRoom(supabase, {
          ...deletedTarget,
          giuong: 0,
          is_visible: false,
        });
        setRows(prev => prev.filter(r => r.id !== deletedTarget.id));
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(deletedTarget.id);
          return next;
        });
        setDeleteTarget(null);
        try {
          addLog(
            currentUser?.email || 'system',
            'FACILITY_DELETE',
            `Xóa phòng: ${deletedTarget.ktx} · ${deletedTarget.day} · ${deletedTarget.phong_khu_vuc}`
          );
        } catch {}
        invalidateKtxStructureCache();
        reloadKtxStructure(true);
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
      const workersList: any[] = [];
      let from = 0;
      const PAGE_SIZE = 1000;
      while (true) {
        const { data: workerRows, error } = await supabase
          .from('workers')
          .select('ktx, day, phong_so')
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error || !workerRows || workerRows.length === 0) break;
        workersList.push(...workerRows);
        if (workerRows.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
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
    const targets = sortedRows.filter(r => selectedIds.has(r.id) && canWriteFacility(r.ktx, r.day));
    if (targets.length === 0) {
      toast.error('Bạn không có quyền xóa các phòng đã chọn.');
      return;
    }
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
  }, [sortedRows, selectedIds, canWriteFacility, checkRoomsOccupancy]);

  // Batch Hide / Show selected rooms (safely skips occupied rooms when hiding)
  const handleBulkUpdateVisibility = useCallback(async (nextVisible: boolean) => {
    const targets = sortedRows.filter(r => selectedIds.has(r.id) && canWriteFacility(r.ktx, r.day));
    if (targets.length === 0) {
      toast.error('Bạn không có quyền thay đổi hiển thị các phòng đã chọn.');
      return;
    }
    setBulkUpdating(true);
    try {
      let eligible = targets;
      let skippedCount = 0;
      if (!nextVisible) {
        const occResult = await checkRoomsOccupancy(targets);
        eligible = occResult.safeToDelete;
        skippedCount = occResult.occupiedCount;
      }
      if (eligible.length === 0) {
        toast.warning(
          `Không thể ẩn vì cả ${skippedCount} phòng đã chọn đều đang có công nhân lưu trú.`
        );
        return;
      }
      const ids = eligible.map(r => r.id);
      const { error } = await supabase
        .from('facilities')
        .update({ is_visible: nextVisible })
        .in('id', ids);
      if (error) {
        toast.error(`Lỗi cập nhật hiển thị hàng loạt: ${error.message}`);
        return;
      }
      const idSet = new Set(ids);
      setRows(prev => prev.map(r => idSet.has(r.id) ? { ...r, is_visible: nextVisible } : r));
      for (const room of eligible) {
        await syncBedsForFacilityRoom(supabase, { ...room, is_visible: nextVisible });
      }
      try {
        addLog(
          currentUser?.email || 'system',
          'FACILITY_UPDATE',
          `${nextVisible ? 'Hiện' : 'Ẩn'} hàng loạt ${eligible.length} phòng tại ${activeKtx}`
        );
      } catch {}
      invalidateFacilitiesCache();
      invalidateKtxStructureCache();
      reloadKtxStructure(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
      }
      setSelectedIds(new Set());
      const msg = skippedCount > 0
        ? `Đã ${nextVisible ? 'hiện' : 'ẩn'} ${eligible.length} phòng (bỏ qua ${skippedCount} phòng đang có công nhân).`
        : `Đã ${nextVisible ? 'hiện' : 'ẩn'} thành công ${eligible.length} phòng.`;
      setBulkActionSuccess(msg);
      toast.success(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật hàng loạt');
    } finally {
      setBulkUpdating(false);
    }
  }, [sortedRows, selectedIds, canWriteFacility, checkRoomsOccupancy, supabase, addLog, currentUser, activeKtx, reloadKtxStructure]);

  // Batch switch room_type (Phòng ở <-> Chức năng) for selected rooms
  const handleBulkUpdateRoomType = useCallback(async (nextType: 'accommodation' | 'functional') => {
    const targets = sortedRows.filter(r => selectedIds.has(r.id) && canWriteFacility(r.ktx, r.day));
    if (targets.length === 0) {
      toast.error('Bạn không có quyền đổi loại các phòng đã chọn.');
      return;
    }
    setBulkUpdating(true);
    try {
      let eligible = targets;
      let skippedCount = 0;
      if (nextType === 'functional') {
        const occResult = await checkRoomsOccupancy(targets);
        eligible = occResult.safeToDelete;
        skippedCount = occResult.occupiedCount;
      }
      if (eligible.length === 0) {
        toast.warning(
          `Không thể chuyển sang Phòng chức năng vì cả ${skippedCount} phòng đã chọn đang có công nhân lưu trú.`
        );
        return;
      }
      const ids = eligible.map(r => r.id);
      const { error } = await supabase
        .from('facilities')
        .update({ room_type: nextType })
        .in('id', ids);
      if (error) {
        toast.error(`Lỗi đổi loại phòng hàng loạt: ${error.message}`);
        return;
      }
      const idSet = new Set(ids);
      setRows(prev => prev.map(r => idSet.has(r.id) ? { ...r, room_type: nextType } : r));
      for (const room of eligible) {
        await syncBedsForFacilityRoom(supabase, { ...room, room_type: nextType });
      }
      try {
        addLog(
          currentUser?.email || 'system',
          'FACILITY_UPDATE',
          `Đổi loại hàng loạt ${eligible.length} phòng tại ${activeKtx} -> ${
            nextType === 'functional' ? 'Phòng chức năng' : 'Phòng ở'
          }`
        );
      } catch {}
      invalidateFacilitiesCache();
      invalidateKtxStructureCache();
      reloadKtxStructure(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
      }
      setSelectedIds(new Set());
      const label = nextType === 'functional' ? 'Phòng chức năng' : 'Phòng ở';
      const msg = skippedCount > 0
        ? `Đã chuyển ${eligible.length} phòng thành ${label} (bỏ qua ${skippedCount} phòng đang có công nhân).`
        : `Đã chuyển ${eligible.length} phòng thành ${label}.`;
      setBulkActionSuccess(msg);
      toast.success(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi đổi loại phòng hàng loạt');
    } finally {
      setBulkUpdating(false);
    }
  }, [sortedRows, selectedIds, canWriteFacility, checkRoomsOccupancy, supabase, addLog, currentUser, activeKtx, reloadKtxStructure]);

  const handleBulkApplyEquipment = useCallback(
    async (
      targetIds: string[],
      patch: Partial<Record<EquipmentNumericField, number>>
    ) => {
      const targetRows = rows.filter(
        r => targetIds.includes(r.id) && canWriteFacility(r.ktx, r.day)
      );
      if (targetRows.length === 0) {
        toast.error('Bạn không có quyền cập nhật thiết bị cho các phòng đã chọn.');
        return;
      }
      setBulkUpdating(true);
      try {
        const ids = targetRows.map(r => r.id);
        const BATCH = 50;
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunk = ids.slice(i, i + BATCH);
          const { error } = await supabase
            .from('facilities')
            .update(patch)
            .in('id', chunk);
          if (error) throw error;
        }

        // If giuong capacity changed, sync beds table for updated rooms
        if (typeof patch.giuong === 'number') {
          for (const room of targetRows) {
            if (room.giuong !== patch.giuong) {
              await syncBedsForFacilityRoom(supabase, {
                ...room,
                giuong: patch.giuong,
              });
            }
          }
        }

        setRows(prev =>
          prev.map(r => (ids.includes(r.id) ? { ...r, ...patch } : r))
        );

        const changedLabels = Object.entries(patch)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        try {
          addLog(
            currentUser?.email || 'system',
            'FACILITY_UPDATE',
            `Áp định mức thiết bị hàng loạt cho ${targetRows.length} phòng (${activeKtx}): ${changedLabels}`
          );
        } catch {}

        invalidateFacilitiesCache();
        invalidateKtxStructureCache();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }

        setShowBulkEquipmentModal(false);
        setSelectedIds(new Set());
        const msg = `Đã áp định mức thiết bị cho ${targetRows.length} phòng thành công.`;
        setBulkActionSuccess(msg);
        setTimeout(() => setBulkActionSuccess(null), 7000);
        toast.success(msg);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Lỗi cập nhật định mức thiết bị hàng loạt'
        );
      } finally {
        setBulkUpdating(false);
      }
    },
    [rows, canWriteFacility, supabase, addLog, currentUser, activeKtx]
  );

  // Request deletion of all rooms in active view/tab (Super Admin only)
  const handleRequestDeleteAll = useCallback(async () => {
    if (!canDeleteAll) {
      toast.error('Chỉ Quản trị tối cao (Super Admin) mới có quyền xóa toàn bộ danh mục.');
      return;
    }
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
  }, [canDeleteAll, sortedRows, checkRoomsOccupancy]);

  // Confirm and execute bulk deletion
  const handleConfirmBulkDelete = useCallback(async () => {
    if (!bulkDeleteModal || bulkDeleteModal.safeToDelete.length === 0) return;
    setBulkDeleting(true);
    try {
      const safeRooms = bulkDeleteModal.safeToDelete;
      const idsToDelete = safeRooms.map(r => r.id);
      const { error } = await supabase
        .from('facilities')
        .delete()
        .in('id', idsToDelete);

      if (error) throw new Error(error.message);

      for (let i = 0; i < safeRooms.length; i += 10) {
        await Promise.all(
          safeRooms.slice(i, i + 10).map(r =>
            syncBedsForFacilityRoom(supabase, { ...r, giuong: 0, is_visible: false })
          )
        );
      }

      setRows(prev => prev.filter(r => !idsToDelete.includes(r.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        idsToDelete.forEach(id => next.delete(id));
        return next;
      });
      setBulkDeleteModal(null);

      try {
        const ktxListLabel = Array.from(new Set(safeRooms.map(r => r.ktx).filter(Boolean))).join(', ');
        addLog(
          currentUser?.email || 'system',
          'FACILITY_DELETE',
          `${bulkDeleteModal.mode === 'all' ? 'Xóa toàn bộ phòng trống' : 'Xóa hàng loạt phòng'}: ${idsToDelete.length} phòng${ktxListLabel ? ` (${ktxListLabel})` : ''}`
        );
      } catch {}

      // Trigger sync event for Dashboard & KTX structure cache
      invalidateKtxStructureCache();
      reloadKtxStructure(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
      }

      setBulkActionSuccess(`✓ Đã xóa thành công ${idsToDelete.length} phòng/khu vực khỏi cơ sở vật chất.`);
      setTimeout(() => setBulkActionSuccess(null), 6000);
    } catch (err: any) {
      toast.error(`Lỗi khi xóa: ${err?.message || 'Không thể xóa dữ liệu'}`);
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleteModal, supabase, reloadKtxStructure, addLog, currentUser]);

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

  const hasActiveFilters = Boolean(
    filterDay || filterRoomType !== 'all' || filterVisibility !== 'all' || searchPhong.trim() || onlyIssues
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Modals */}
      {showAddModal && (
        <AddRoomModal
          activeKtx={addModalInitialKtx || activeKtx}
          ktxOptions={allKtxTabs}
          existingRows={rows}
          onSave={handleAddRow}
          onClose={() => { setShowAddModal(false); setAddModalInitialKtx(null); }}
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
      {hideConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={() => setHideConfirmTarget(null)}>
          <div className="surface-elevated rounded-2xl shadow-modal w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl tint-wn border border-wn/30 flex items-center justify-center text-wn shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-tx">Cảnh báo ẩn phòng đang có người ở</h3>
                <p className="text-xs text-mu leading-relaxed">
                  <strong>{hideConfirmTarget.row.ktx} · {hideConfirmTarget.row.day} · {hideConfirmTarget.row.phong_khu_vuc}</strong> hiện đang có{' '}
                  <strong className="text-wn">{hideConfirmTarget.count} công nhân</strong> đang lưu trú. Nếu ẩn phòng, phòng này sẽ không xuất hiện trên sơ đồ tổng quan và báo cáo sức chứa.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-bdr">
              <button
                type="button"
                onClick={() => setHideConfirmTarget(null)}
                className="px-3.5 py-2 rounded-xl border border-bdr2 bg-surf text-tx text-xs font-semibold hover:bg-act cursor-pointer"
              >
                Giữ hiển thị
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = hideConfirmTarget.row;
                  setHideConfirmTarget(null);
                  await executeToggleVisibility(target, false);
                }}
                className="px-3.5 py-2 rounded-xl bg-wn text-wn-fg text-xs font-semibold hover:opacity-90 cursor-pointer"
              >
                Vẫn ẩn phòng này
              </button>
            </div>
          </div>
        </div>
      )}

      {showSync3DModal && isAdmin && (
        <Sync3DBlueprintModal
          existingRows={rows}
          workerCount={workers.length}
          actorEmail={currentUser?.email || 'admin'}
          onAuditLog={details => {
            try {
              addLog(currentUser?.email || 'system', 'FACILITY_UPDATE', details);
            } catch {}
          }}
          onCompleted={async summary => {
            setShowSync3DModal(false);
            setActiveKtx(summary.ktxName);
            setFilterDay('');
            setSearchPhong('');
            await fetchFacilities();
            reloadKtxStructure(true);
            toast.success(
              `Đã khởi tạo xong ${summary.ktxName}: ${summary.roomCount} phòng · ${summary.bedCount.toLocaleString('vi-VN')} giường trống khớp 1:1 với Sơ đồ 3D!`
            );
            if (summary.staleStaffCount > 0) {
              toast.info(
                `Lưu ý: Có ${summary.staleStaffCount} tài khoản Nhân viên đang gắn tên dãy cũ — hãy cập nhật lại trong Quản lý Tài khoản.`,
                { duration: 8000 }
              );
            }
            setBulkActionSuccess(
              `✓ Đã đồng bộ hoàn tất ${summary.ktxName} (${summary.roomCount} phòng · ${summary.bedCount.toLocaleString('vi-VN')} chỗ) khớp 1:1 với Bản đồ 3D.`
            );
            setTimeout(() => setBulkActionSuccess(null), 9000);
          }}
          onClose={() => setShowSync3DModal(false)}
        />
      )}

      {showBulkEquipmentModal && (
        <BulkEquipmentModal
          allRows={rows}
          selectedIds={selectedIds}
          activeKtx={activeKtx}
          applying={bulkUpdating}
          onApply={handleBulkApplyEquipment}
          onClose={() => setShowBulkEquipmentModal(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 pb-3 border-b border-bdr">
        <div className="flex items-center gap-3">
          <CraftIconBadge icon={Building2} badgeIcon={BedDouble} tone="blue" size="md" />
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-tx tracking-tight">Quản lý Cơ sở vật chất</h1>
            <p className="text-xs sm:text-sm text-mu mt-0.5">Theo dõi và cập nhật trang thiết bị từng phòng/khu vực</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} />
          {isAdmin && (
            <button
              onClick={() => setShowSync3DModal(true)}
              disabled={loading || importing || deleting}
              title="Khởi tạo đồng bộ 90 phòng chuẩn KTX Phước Vĩnh Tây (6 Dãy × 15 Phòng × 20 giường) khớp 1:1 với Sơ đồ 3D"
              className="flex items-center justify-center gap-1.5 px-3 py-2 border border-pri/45 bg-pri/10 text-pri hover:bg-pri/20 rounded-xl text-xs sm:text-sm font-bold disabled:opacity-60 transition-colors flex-1 sm:flex-initial shadow-sm cursor-pointer"
            >
              <Box size={15} />
              <span>Đồng bộ chuẩn 3D</span>
            </button>
          )}
          {(isAdmin || (!isTechnician && currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0)) && rows.length > 0 && (
            <button
              type="button"
              onClick={() => setShowBulkEquipmentModal(true)}
              disabled={loading || bulkUpdating}
              title="Áp định mức điều hòa, tủ, quạt, bóng tuýp... hàng loạt cho nhiều phòng hoặc cả Dãy"
              className="flex items-center justify-center gap-1.5 px-3 py-2 border border-bdr2 bg-bdg text-lnk hover:opacity-90 rounded-xl text-xs sm:text-sm font-bold disabled:opacity-60 transition-colors flex-1 sm:flex-initial shadow-sm cursor-pointer"
            >
              <Layers size={15} />
              <span>Áp định mức hàng loạt</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center justify-center gap-2 px-3 py-2 border border-bdr2 bg-surf text-tx rounded-xl text-xs sm:text-sm font-semibold hover:bg-act disabled:opacity-60 transition-colors flex-1 sm:flex-initial shadow-sm"
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} className="text-ok" />}
              {importing ? 'Đang import...' : 'Import Excel'}
            </button>
          )}
          <button
            onClick={handleExportExcel}
            disabled={loading || sortedRows.length === 0}
            className="flex items-center justify-center gap-2 px-3 py-2 border border-bdr2 bg-surf text-tx rounded-xl text-xs sm:text-sm font-semibold hover:bg-act disabled:opacity-60 transition-colors flex-1 sm:flex-initial shadow-sm"
          >
            <Download size={15} className="text-lnk" />
            Xuất Excel
          </button>
          {canDeleteAll && (
            <button
              onClick={handleRequestDeleteAll}
              disabled={loading || sortedRows.length === 0 || deleting}
              title={hasActiveFilters ? "Xóa tất cả các phòng đang hiển thị theo bộ lọc" : `Xóa tất cả ${sortedRows.length} phòng trong danh mục`}
              className="flex items-center justify-center gap-1.5 px-3 py-2 border border-dgr/40 tint-dgr text-dgr hover:opacity-90 rounded-xl text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50 flex-1 sm:flex-initial"
            >
              <Trash2 size={15} />
              <span>Xóa tất cả</span>
            </button>
          )}
          {(isAdmin || (!isTechnician && currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0)) && (
            <button
              onClick={() => { setAddModalInitialKtx(null); setShowAddModal(true); }}
              className="flex items-center justify-center gap-2 px-4 py-2 btn-glow-primary rounded-xl text-xs sm:text-sm font-semibold flex-1 sm:flex-initial cursor-pointer"
            >
              <Plus size={15} />
              <span>Thêm phòng mới</span>
            </button>
          )}
        </div>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bdg border border-bdr2 text-xs text-lnk">
          <Lock size={14} className="shrink-0" />
          <span>
            {isTechnician ? (
              <>
                <strong>Chế độ Kỹ thuật viên:</strong> bạn có thể cập nhật số lượng thiết bị & ghi chú bảo trì cho phạm vi phụ trách (
                <strong>{currentUser?.assignedBlocks?.length ? currentUser.assignedBlocks.join(', ') : 'Toàn bộ KTX'}</strong>).
              </>
            ) : (
              <>
                Chế độ phân quyền: bạn chỉ có thể thêm, sửa hoặc xóa phòng thuộc phạm vi phụ trách (
                <strong>{currentUser?.assignedBlocks?.length ? currentUser.assignedBlocks.join(', ') : 'Chỉ xem'}</strong>).
              </>
            )}
          </span>
        </div>
      )}

      {/* Missing facility KTX prompt banner (e.g. KTX 3 / KTX 4 already has workers) */}
      {!loading && !isTechnician && missingFacilityKtxs.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl border border-wn/35 tint-wn text-xs">
          <div className="flex items-center gap-2 text-wn font-medium">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              Phát hiện dữ liệu công nhân tại <strong>{missingFacilityKtxs.join(', ')}</strong> chưa có danh mục phòng cơ sở vật chất:
            </span>
          </div>
          {(isAdmin || (currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0)) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {missingFacilityKtxs.map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setAddModalInitialKtx(k); setShowAddModal(true); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Plus size={12} />
                  <span>Thêm phòng {k}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
        <div className="flex gap-1 bg-act rounded-xl p-1 w-fit border border-bdr">
          {[1, 2].map(i => <div key={i} className="w-20 h-8 bg-surf/60 rounded-lg animate-pulse" />)}
        </div>
      ) : allKtxTabs.length > 0 ? (
        <SlidingTabs<string>
          layoutId="facilities-ktx-tabs"
          value={activeKtx}
          onChange={ktx => {
            setActiveKtx(ktx);
            setEditingId(null);
            setEditingRow(null);
            setFilterDay('');
            setSearchPhong('');
            setSelectedIds(new Set());
          }}
          tabs={allKtxTabs.map(ktx => ({ id: ktx, label: ktx, icon: Building2 }))}
        />
      ) : null}

      {/* Filters scoped to active KTX tab */}
      <div className="flex flex-wrap gap-2.5 items-center">
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
        <select
          value={filterRoomType}
          onChange={e => setFilterRoomType(e.target.value as 'all' | 'accommodation' | 'functional')}
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">Tất cả loại ({ktxScopedRows.length})</option>
          <option value="accommodation">Phòng ở ({accommodationCountInKtx})</option>
          <option value="functional">Chức năng ({functionalCountInKtx})</option>
        </select>
        <select
          value={filterVisibility}
          onChange={e => setFilterVisibility(e.target.value as 'all' | 'visible' | 'hidden')}
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">Tất cả hiển thị</option>
          <option value="visible">Đang hiện ({visibleCountInKtx})</option>
          <option value="hidden">Đang ẩn ({hiddenCountInKtx})</option>
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Tìm phòng / ghi chú..."
            value={searchPhong}
            onChange={e => setSearchPhong(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-44"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyIssues(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            onlyIssues
              ? 'tint-wn text-wn border-wn'
              : 'bg-background text-muted-foreground border-border hover:text-foreground'
          }`}
          title="Lọc nhanh các phòng có ghi chú hỏng hóc / sửa chữa / bảo trì"
        >
          <AlertTriangle size={13} />
          <span>Chỉ hiện phòng có sự cố</span>
          {issueCountInKtx > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-wn font-tabular">
              {issueCountInKtx}
            </span>
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={() => {
              setFilterDay('');
              setFilterRoomType('all');
              setFilterVisibility('all');
              setSearchPhong('');
              setOnlyIssues(false);
            }}
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
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => setShowBulkEquipmentModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-pri hover:opacity-90 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Layers size={13} />
              <span>Áp thiết bị ({selectedIds.size})</span>
            </button>
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => handleBulkUpdateVisibility(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <Eye size={13} />
              <span>Hiện ({selectedIds.size})</span>
            </button>
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => handleBulkUpdateVisibility(false)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <EyeOff size={13} />
              <span>Ẩn ({selectedIds.size})</span>
            </button>
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => handleBulkUpdateRoomType('functional')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <Building2 size={13} />
              <span>Đặt Chức năng</span>
            </button>
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => handleBulkUpdateRoomType('accommodation')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <BedDouble size={13} />
              <span>Đặt Phòng ở</span>
            </button>
            <button
              type="button"
              disabled={bulkUpdating || deleting}
              onClick={handleRequestBulkDelete}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              <Trash2 size={13} />
              <span>Xóa ({selectedIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="surface-elevated rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bdr flex items-center justify-between flex-wrap gap-2 bg-act/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-tx">
              {activeKtx} — {sortedRows.length} phòng/khu vực
              {hasActiveFilters && <span className="ml-2 text-xs tint-wn text-wn border border-wn/40 px-2 py-0.5 rounded-md font-semibold">đang lọc</span>}
            </span>
            {selectedIds.size > 0 && (
              <span className="text-xs bg-bdg text-lnk border border-pri2/35 font-semibold px-2 py-0.5 rounded-md">
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
                {canDeleteAll && (
                  <button
                    type="button"
                    onClick={handleRequestDeleteAll}
                    disabled={sortedRows.length === 0}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Chỉ Quản trị tối cao (Super Admin) có quyền xóa toàn bộ danh mục"
                  >
                    <Trash2 size={13} />
                    <span>Xóa hết ({sortedRows.length})</span>
                  </button>
                )}
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
              <thead className="bg-act border-b border-bdr2 sticky top-0 z-10">
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
                  const isHiddenRow = row.is_visible === false;
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        isEditing
                          ? 'bg-primary/5'
                          : isSelected
                            ? 'bg-primary/10'
                            : isHiddenRow
                              ? 'bg-muted/25 opacity-70 hover:opacity-100'
                              : 'hover:bg-muted/30'
                      }`}
                    >
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

                      {/* Loại phòng — 1-click toggle */}
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
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleRoomType(row)}
                            title={
                              row.room_type === 'functional'
                                ? 'Bấm để chuyển về Phòng ở'
                                : 'Bấm để chuyển thành Phòng chức năng'
                            }
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-80 ${
                              row.room_type === 'functional'
                                ? 'tint-pink text-pink-tone border border-pink-tint'
                                : 'bg-bdg text-lnk border border-bdr2'
                            }`}
                          >
                            {row.room_type === 'functional' ? 'Chức năng' : 'Phòng ở'}
                          </button>
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
                            <span className={`w-1.5 h-1.5 rounded-full ${row.is_visible !== false ? 'bg-ok2' : 'bg-gray-400'}`} />
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
                          <td className={`${tdClass} max-w-[160px]`} title={row.ghi_chu || ''}>
                            {hasFacilityIssue(row.ghi_chu) ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tint-wn text-wn border border-wn max-w-full truncate">
                                <AlertTriangle size={11} className="shrink-0" />
                                <span className="truncate">{row.ghi_chu}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground truncate block">{row.ghi_chu || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                href={`/ktx-3d?ktx=${encodeURIComponent(row.ktx)}&day=${encodeURIComponent(row.day)}&room=${encodeURIComponent(normalizeRoomLabel(row.phong_khu_vuc))}`}
                                className="p-1.5 rounded-lg text-lnk hover:bg-bdg transition-colors"
                                title="Mở phòng này trên Bản đồ 3D"
                              >
                                <Box size={14} />
                              </Link>
                              {canWriteFacility(row.ktx, row.day) ? (
                                <>
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
                                </>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60" title="Chỉ xem">
                                  <Lock size={12} />
                                </span>
                              )}
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
        <span className="font-medium">Hướng dẫn Import Excel:</span> Hỗ trợ file <code className="bg-muted px-1 rounded">.xlsx</code> có 1 hoặc nhiều sheet (ví dụ: KTX Phước Vĩnh Tây). Hàng tiêu đề tự động nhận dạng qua từ khóa <strong>STT</strong>. Các cột nhận dạng tự động: <em>Dãy, Phòng/Khu vực, Giường, Điều hòa, Tủ, Quạt, Ổ cắm điện, Remote, Bóng tuýp, Bàn ăn, Ghế ăn</em>.
      </div>
    </div>
  );
}
