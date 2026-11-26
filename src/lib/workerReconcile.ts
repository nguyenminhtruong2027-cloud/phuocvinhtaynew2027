'use client';

import * as XLSX from 'xlsx';
import { Worker, removeAccents } from '@/data/workers';
import { exportMultiSheetExcel } from '@/lib/exportExcel';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { getVNDateString } from '@/lib/vnDate';

export interface ParsedIdentifierToken {
  raw: string;
  normalized: string;
  digitsOnly: string;
  lineNumber: number;
}

export interface BatchCheckoutMatchItem {
  token: ParsedIdentifierToken;
  worker: Worker;
  matchedBy: 'cccd' | 'maNV' | 'hoVaTen';
}

export interface BatchCheckoutAmbiguousItem {
  token: ParsedIdentifierToken;
  candidates: Worker[];
}

export interface BatchCheckoutAnalysis {
  matched: BatchCheckoutMatchItem[];
  ambiguous: BatchCheckoutAmbiguousItem[];
  notFound: ParsedIdentifierToken[];
  totalTokens: number;
}

export interface RosterRow {
  rowIndex: number;
  hoVaTen: string;
  maNV: string;
  cccd: string;
  donVi: string;
  tieuDoan: string;
  toTruong: string;
  soDienThoai: string;
}

export interface ParsedRosterFile {
  fileName: string;
  headers: string[];
  rows: RosterRow[];
  detectedColumns: {
    hoVaTen: string;
    maNV: string;
    cccd: string;
    donVi: string;
    tieuDoan: string;
    toTruong: string;
    soDienThoai: string;
  };
}

export interface RosterUnitSummary {
  unit: string;
  totalKtx: number;
  matchedCount: number;
  inKtxNotInRosterCount: number;
  matchRate: number;
}

export interface RosterReconcileResult {
  matched: Array<{ worker: Worker; roster: RosterRow; matchedBy: 'cccd' | 'maNV' | 'hoVaTen' }>;
  inKtxNotInRoster: Worker[];
  inRosterNotInKtx: RosterRow[];
  byUnitSummary: RosterUnitSummary[];
  totalKtxActive: number;
  totalRosterRows: number;
}

const IGNORED_CODES = new Set(['', '-', '—', 'chưa có', 'chua co', 'chờ mã', 'cho ma', 'n/a', 'null', 'none']);

function normCode(raw?: string | null): string {
  const s = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '')
    .trim()
    .toLowerCase();
  if (IGNORED_CODES.has(s)) return '';
  return s;
}

function normDigits(raw?: string | null): string {
  const d = String(raw ?? '').replace(/\D+/g, '');
  return d.length >= 8 ? d : '';
}

function normName(raw?: string | null): string {
  const cleaned = removeAccents(String(raw ?? ''))
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return cleaned;
}

function isCheckedOutWorker(w: Worker): boolean {
  return Boolean(
    w.ngayRaKTX ||
    w.ghiChu?.includes('[Đã Check-out') ||
    w.ghiChu?.includes('[CHECKOUT]')
  );
}

/**
 * Parses pasted lines (from Zalo, Excel column copy, CSV, or free-form list) into deduplicated tokens.
 */
export function parseBatchIdentifiers(rawText: string): ParsedIdentifierToken[] {
  const lines = String(rawText || '').split(/\r?\n/);
  const seen = new Set<string>();
  const out: ParsedIdentifierToken[] = [];

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    // Allow users to paste multiple cells separated by tab or semicolon; prioritize first non-empty cell or extract CCCD if present
    const parts = trimmed.split(/[\t;]+/).map(p => p.trim()).filter(Boolean);
    const chosen = parts.length > 1
      ? (parts.find(p => p.replace(/\D/g, '').length >= 9) ?? parts.find(p => /^[a-z0-9\-_]{4,}$/i.test(p)) ?? parts[0])
      : trimmed;

    // Strip leading bullet or numbering like "1. ", "2) ", "- "
    const cleanRaw = chosen.replace(/^(?:\d+[.)]\s*|[-•*]\s*)/, '').trim();
    if (!cleanRaw) return;

    const normalized = normName(cleanRaw);
    const digitsOnly = normDigits(cleanRaw);
    const dedupeKey = digitsOnly || normCode(cleanRaw) || normalized;
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    out.push({
      raw: cleanRaw,
      normalized,
      digitsOnly,
      lineNumber: idx + 1,
    });
  });

  return out;
}

/**
 * Matches pasted CCCD / Mã NV / Full Name tokens against active KTX workers.
 * Priority: exact CCCD -> exact Mã NV -> exact normalized full name (if multiple, moves to `ambiguous`).
 */
export function matchBatchCheckoutTargets(
  tokens: ParsedIdentifierToken[],
  workers: Worker[]
): BatchCheckoutAnalysis {
  const activeWorkers = workers.filter(w => !isCheckedOutWorker(w));

  const byCccd = new Map<string, Worker[]>();
  const byMaNv = new Map<string, Worker[]>();
  const byName = new Map<string, Worker[]>();

  for (const w of activeWorkers) {
    const cccd = normDigits(w.cccd);
    if (cccd) {
      const list = byCccd.get(cccd) ?? [];
      list.push(w);
      byCccd.set(cccd, list);
    }
    const ma = normCode(w.maNV);
    if (ma) {
      const list = byMaNv.get(ma) ?? [];
      list.push(w);
      byMaNv.set(ma, list);
    }
    const nm = normName(w.hoVaTen);
    if (nm) {
      const list = byName.get(nm) ?? [];
      list.push(w);
      byName.set(nm, list);
    }
  }

  const matched: BatchCheckoutMatchItem[] = [];
  const ambiguous: BatchCheckoutAmbiguousItem[] = [];
  const notFound: ParsedIdentifierToken[] = [];
  const matchedWorkerIds = new Set<string>();

  for (const token of tokens) {
    // 1. Exact CCCD
    if (token.digitsOnly && byCccd.has(token.digitsOnly)) {
      const cands = byCccd.get(token.digitsOnly)!;
      if (cands.length === 1) {
        if (!matchedWorkerIds.has(cands[0].id)) {
          matchedWorkerIds.add(cands[0].id);
          matched.push({ token, worker: cands[0], matchedBy: 'cccd' });
        }
        continue;
      }
      ambiguous.push({ token, candidates: cands });
      continue;
    }

    // 2. Exact Mã NV
    const codeKey = normCode(token.raw);
    if (codeKey && byMaNv.has(codeKey)) {
      const cands = byMaNv.get(codeKey)!;
      if (cands.length === 1) {
        if (!matchedWorkerIds.has(cands[0].id)) {
          matchedWorkerIds.add(cands[0].id);
          matched.push({ token, worker: cands[0], matchedBy: 'maNV' });
        }
        continue;
      }
      ambiguous.push({ token, candidates: cands });
      continue;
    }

    // 3. Exact normalized Full Name
    if (token.normalized && byName.has(token.normalized)) {
      const cands = byName.get(token.normalized)!;
      if (cands.length === 1) {
        if (!matchedWorkerIds.has(cands[0].id)) {
          matchedWorkerIds.add(cands[0].id);
          matched.push({ token, worker: cands[0], matchedBy: 'hoVaTen' });
        }
        continue;
      }
      ambiguous.push({ token, candidates: cands });
      continue;
    }

    notFound.push(token);
  }

  return {
    matched,
    ambiguous,
    notFound,
    totalTokens: tokens.length,
  };
}

function cellToStringSafe(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : String(val);
  }
  return String(val).trim();
}

function normalizeHeaderKey(h: string): string {
  return removeAccents(String(h || ''))
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findHeaderByPatterns(headers: string[], patterns: RegExp[]): string {
  for (const pat of patterns) {
    const found = headers.find(h => pat.test(normalizeHeaderKey(h)));
    if (found) return found;
  }
  return '';
}

/**
 * Parses an uploaded Excel (.xlsx/.xls) or CSV file containing either a batch check-out list
 * or a full site HR active roster. Auto-detects the header row within the first 10 rows.
 */
export async function parseRosterFile(file: File): Promise<ParsedRosterFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('File Excel không có trang tính nào.');
  }
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (!matrix || matrix.length === 0) {
    throw new Error('File Excel trống, không có dữ liệu.');
  }

  // Locate best header row among first 10 rows
  let headerRowIdx = 0;
  let bestScore = -1;
  const maxScan = Math.min(matrix.length, 10);
  const headerKeywords = /(ho\s*va\s*ten|ho\s*ten|ten\s*nv|cccd|cmnd|ma\s*nv|ma\s*nhan\s*vien|don\s*vi|tieu\s*doan|to\s*truong|dien\s*thoai|sdt)/i;
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] || [];
    let score = 0;
    for (const cell of row) {
      const k = normalizeHeaderKey(cellToStringSafe(cell));
      if (k && headerKeywords.test(k)) score += 2;
      else if (k) score += 0.1;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = i;
    }
  }

  const rawHeaders = (matrix[headerRowIdx] || []).map((c, idx) => {
    const txt = cellToStringSafe(c);
    return txt || `Cột ${idx + 1}`;
  });

  // Deduplicate header names
  const seenHeaders = new Map<string, number>();
  const headers = rawHeaders.map(h => {
    const count = seenHeaders.get(h) ?? 0;
    seenHeaders.set(h, count + 1);
    return count === 0 ? h : `${h} (${count + 1})`;
  });

  const detectedColumns = {
    hoVaTen: findHeaderByPatterns(headers, [/^ho\s*(va\s*)?ten$/, /ho\s*(va\s*)?ten/, /ten\s*(cong\s*nhan|nhan\s*vien|nv)/, /full\s*name/, /^ten$/]),
    maNV: findHeaderByPatterns(headers, [/^ma\s*(nv|nhan\s*vien|cn)$/, /ma\s*nv/, /ma\s*nhan\s*vien/, /worker\s*code/, /employee\s*id/, /^mnv$/]),
    cccd: findHeaderByPatterns(headers, [/cccd/, /cmnd/, /can\s*cuoc/, /so\s*dinh\s*danh/, /id\s*card/]),
    donVi: findHeaderByPatterns(headers, [/don\s*vi/, /nha\s*thau/, /bo\s*phan/, /cong\s*ty/, /company/, /unit/]),
    tieuDoan: findHeaderByPatterns(headers, [/tieu\s*doan/, /doi\s*thi\s*cong/, /ban\s*chi\s*huy/, /^doi$/]),
    toTruong: findHeaderByPatterns(headers, [/to\s*truong/, /nhom\s*truong/, /team\s*leader/]),
    soDienThoai: findHeaderByPatterns(headers, [/so\s*dien\s*thoai/, /dien\s*thoai/, /^sdt$/, /phone/]),
  };

  // Fallback: if single-column file with no recognized header, treat column 0 as identifier
  const idxMap = new Map<string, number>();
  headers.forEach((h, i) => idxMap.set(h, i));

  const getCell = (row: unknown[], colName: string) => {
    if (!colName) return '';
    const idx = idxMap.get(colName);
    if (idx === undefined) return '';
    return cellToStringSafe(row[idx]);
  };

  const rows: RosterRow[] = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const rawRow = matrix[r] || [];
    const hoVaTen = getCell(rawRow, detectedColumns.hoVaTen);
    const maNV = getCell(rawRow, detectedColumns.maNV);
    const cccd = getCell(rawRow, detectedColumns.cccd);
    const donVi = getCell(rawRow, detectedColumns.donVi);
    const tieuDoan = getCell(rawRow, detectedColumns.tieuDoan);
    const toTruong = getCell(rawRow, detectedColumns.toTruong);
    const soDienThoai = getCell(rawRow, detectedColumns.soDienThoai);

    // If none of the key columns detected, fallback to first non-empty cell as identifier
    if (!detectedColumns.hoVaTen && !detectedColumns.maNV && !detectedColumns.cccd) {
      const firstVal = cellToStringSafe(rawRow[0]);
      if (!firstVal) continue;
      const digits = normDigits(firstVal);
      rows.push({
        rowIndex: r + 1,
        hoVaTen: digits ? '' : firstVal,
        maNV: digits ? '' : firstVal,
        cccd: digits,
        donVi: '',
        tieuDoan: '',
        toTruong: '',
        soDienThoai: '',
      });
      continue;
    }

    if (!hoVaTen && !maNV && !cccd) continue;
    rows.push({
      rowIndex: r + 1,
      hoVaTen,
      maNV,
      cccd,
      donVi,
      tieuDoan,
      toTruong,
      soDienThoai,
    });
  }

  return {
    fileName: file.name,
    headers,
    rows,
    detectedColumns,
  };
}

/**
 * Reconciles an external HR active site roster against currently active KTX workers.
 */
export function reconcileRosterWithKtx(
  rosterRows: RosterRow[],
  workers: Worker[]
): RosterReconcileResult {
  const activeWorkers = workers.filter(w => !isCheckedOutWorker(w));

  const rosterByCccd = new Map<string, RosterRow>();
  const rosterByMaNv = new Map<string, RosterRow>();
  const rosterByName = new Map<string, RosterRow[]>();

  for (const row of rosterRows) {
    const c = normDigits(row.cccd);
    if (c && !rosterByCccd.has(c)) rosterByCccd.set(c, row);
    const m = normCode(row.maNV);
    if (m && !rosterByMaNv.has(m)) rosterByMaNv.set(m, row);
    const n = normName(row.hoVaTen);
    if (n) {
      const list = rosterByName.get(n) ?? [];
      list.push(row);
      rosterByName.set(n, list);
    }
  }

  const matched: RosterReconcileResult['matched'] = [];
  const inKtxNotInRoster: Worker[] = [];
  const matchedRosterIndices = new Set<number>();

  for (const w of activeWorkers) {
    const wCccd = normDigits(w.cccd);
    const wMa = normCode(w.maNV);
    const wName = normName(w.hoVaTen);

    let hit: { row: RosterRow; by: 'cccd' | 'maNV' | 'hoVaTen' } | null = null;
    if (wCccd && rosterByCccd.has(wCccd)) {
      hit = { row: rosterByCccd.get(wCccd)!, by: 'cccd' };
    } else if (wMa && rosterByMaNv.has(wMa)) {
      hit = { row: rosterByMaNv.get(wMa)!, by: 'maNV' };
    } else if (wName && rosterByName.has(wName)) {
      const list = rosterByName.get(wName)!;
      const unused = list.find(r => !matchedRosterIndices.has(r.rowIndex)) ?? list[0];
      hit = { row: unused, by: 'hoVaTen' };
    }

    if (hit) {
      matchedRosterIndices.add(hit.row.rowIndex);
      matched.push({ worker: w, roster: hit.row, matchedBy: hit.by });
    } else {
      inKtxNotInRoster.push(w);
    }
  }

  const inRosterNotInKtx = rosterRows.filter(r => !matchedRosterIndices.has(r.rowIndex));

  // Build unit-level summary
  const unitMap = new Map<string, { totalKtx: number; matchedCount: number; inKtxNotInRosterCount: number }>();
  for (const w of activeWorkers) {
    const unit = (w.donVi || 'Chưa phân đơn vị').trim();
    if (!unitMap.has(unit)) {
      unitMap.set(unit, { totalKtx: 0, matchedCount: 0, inKtxNotInRosterCount: 0 });
    }
    unitMap.get(unit)!.totalKtx += 1;
  }
  for (const m of matched) {
    const unit = (m.worker.donVi || 'Chưa phân đơn vị').trim();
    if (unitMap.has(unit)) unitMap.get(unit)!.matchedCount += 1;
  }
  for (const w of inKtxNotInRoster) {
    const unit = (w.donVi || 'Chưa phân đơn vị').trim();
    if (unitMap.has(unit)) unitMap.get(unit)!.inKtxNotInRosterCount += 1;
  }

  const byUnitSummary: RosterUnitSummary[] = Array.from(unitMap.entries())
    .map(([unit, v]) => ({
      unit,
      totalKtx: v.totalKtx,
      matchedCount: v.matchedCount,
      inKtxNotInRosterCount: v.inKtxNotInRosterCount,
      matchRate: v.totalKtx > 0 ? Math.round((v.matchedCount / v.totalKtx) * 100) : 0,
    }))
    .sort((a, b) => b.inKtxNotInRosterCount - a.inKtxNotInRosterCount || b.totalKtx - a.totalKtx);

  return {
    matched,
    inKtxNotInRoster,
    inRosterNotInKtx,
    byUnitSummary,
    totalKtxActive: activeWorkers.length,
    totalRosterRows: rosterRows.length,
  };
}

export function exportReconcileReportExcel(result: RosterReconcileResult, sourceFileName?: string): boolean {
  const todayVN = getVNDateString();
  const fileName = `DoiSoat_QuanSo_KTX_${todayVN}.xlsx`;

  const summaryRows = [
    { 'Hạng mục': 'File đối chiếu', 'Giá trị': sourceFileName || 'Danh sách Nhân sự' },
    { 'Hạng mục': 'Ngày đối soát', 'Giá trị': todayVN },
    { 'Hạng mục': 'Tổng quân số đang ở KTX (trong phạm vi)', 'Giá trị': result.totalKtxActive },
    { 'Hạng mục': 'Tổng dòng nhân sự công trường tải lên', 'Giá trị': result.totalRosterRows },
    { 'Hạng mục': 'Khớp cả 2 bên', 'Giá trị': result.matched.length },
    { 'Hạng mục': 'Đang ở KTX nhưng KHÔNG có trong DS đi làm (Cần xác minh)', 'Giá trị': result.inKtxNotInRoster.length },
    { 'Hạng mục': 'Có đi làm nhưng CHƯA có trong KTX', 'Giá trị': result.inRosterNotInKtx.length },
  ];

  const onlyInKtxRows = result.inKtxNotInRoster.map((w, idx) => ({
    'STT': idx + 1,
    'Họ và tên': w.hoVaTen || '',
    'Mã NV': w.maNV || '',
    'CCCD': w.cccd || '',
    'Đơn vị': w.donVi || '',
    'Tiểu đoàn / Đội': w.tieuDoan || '',
    'Tổ trưởng': w.toTruong || '',
    'KTX': w.ktx || '',
    'Dãy': w.day || '',
    'Phòng': w.phongSo ? formatRoomDisplay(w.phongSo) : '',
    'Giường': w.giuong || '',
    'Ngày vào KTX': w.ngayVaoKTX || '',
    'SĐT': w.soDienThoai || '',
    'Trạng thái đối soát': 'Đang ở KTX - Không có trong DS đi làm',
  }));

  const onlyInRosterRows = result.inRosterNotInKtx.map((r, idx) => ({
    'STT': idx + 1,
    'Họ và tên': r.hoVaTen || '',
    'Mã NV': r.maNV || '',
    'CCCD': r.cccd || '',
    'Đơn vị': r.donVi || '',
    'Tiểu đoàn / Đội': r.tieuDoan || '',
    'Tổ trưởng': r.toTruong || '',
    'SĐT': r.soDienThoai || '',
    'Trạng thái đối soát': 'Đang đi làm - Chưa có trong KTX',
  }));

  const matchedRows = result.matched.map((m, idx) => ({
    'STT': idx + 1,
    'Họ và tên': m.worker.hoVaTen || '',
    'Mã NV': m.worker.maNV || '',
    'CCCD': m.worker.cccd || '',
    'Đơn vị': m.worker.donVi || '',
    'Dãy': m.worker.day || '',
    'Phòng': m.worker.phongSo ? formatRoomDisplay(m.worker.phongSo) : '',
    'Giường': m.worker.giuong || '',
    'Khớp theo': m.matchedBy === 'cccd' ? 'CCCD' : m.matchedBy === 'maNV' ? 'Mã NV' : 'Họ tên',
  }));

  return exportMultiSheetExcel(
    [
      { name: 'TongHop', data: summaryRows },
      { name: 'O_KTX_KhongDiLam', data: onlyInKtxRows.length ? onlyInKtxRows : [{ 'Thông báo': 'Không có trường hợp lệch' }] },
      { name: 'DiLam_ChuaCoKTX', data: onlyInRosterRows.length ? onlyInRosterRows : [{ 'Thông báo': 'Không có trường hợp lệch' }] },
      { name: 'KhopChuan', data: matchedRows.length ? matchedRows : [{ 'Thông báo': 'Chưa có bản ghi khớp' }] },
    ],
    fileName
  );
}
