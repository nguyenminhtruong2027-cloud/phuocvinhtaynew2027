'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Search, Edit2, Check, X, Plus, Loader2, BedDouble, Wind, Package, Fan,
  Zap, Tv, Lightbulb, UtensilsCrossed, ChevronDown, ChevronUp, Upload,
  AlertCircle, CheckCircle2, Download, Trash2, Filter
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportToExcel } from '@/lib/exportExcel';
import { useKtxStructure } from '@/lib/ktxStructure';
import { compareKtxNames } from '@/data/workers';

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
  { label: 'Giường', key: 'giuong', icon: <BedDouble size={18} />, color: 'text-blue-600 bg-blue-50' },
  { label: 'Điều hòa', key: 'dieu_hoa', icon: <Wind size={18} />, color: 'text-cyan-600 bg-cyan-50' },
  { label: 'Tủ', key: 'tu', icon: <Package size={18} />, color: 'text-amber-600 bg-amber-50' },
  { label: 'Quạt', key: 'quat', icon: <Fan size={18} />, color: 'text-green-600 bg-green-50' },
  { label: 'Ổ cắm điện', key: 'o_cam_dien', icon: <Zap size={18} />, color: 'text-yellow-600 bg-yellow-50' },
  { label: 'Remote', key: 'remote', icon: <Tv size={18} />, color: 'text-purple-600 bg-purple-50' },
  { label: 'Bóng tuýp', key: 'bong_tuyp', icon: <Lightbulb size={18} />, color: 'text-orange-600 bg-orange-50' },
  { label: 'Bàn ăn', key: 'ban_an', icon: <UtensilsCrossed size={18} />, color: 'text-rose-600 bg-rose-50' },
  { label: 'Ghế ăn', key: 'ghe_an', icon: <UtensilsCrossed size={18} />, color: 'text-pink-600 bg-pink-50' },
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

type DbField = keyof Omit<FacilityRow, 'id' | 'ktx'>;

const COLUMN_MAP_EXACT: Record<string, DbField> = {
  'dãy': 'day', 'day': 'day', 'dây': 'day', 'dãy/khu': 'day',
  'phòng': 'phong_khu_vuc', 'phòng/khu vực': 'phong_khu_vuc', 'khu vực': 'phong_khu_vuc',
  'phong': 'phong_khu_vuc', 'phong/khu vuc': 'phong_khu_vuc', 'khu vuc': 'phong_khu_vuc',
  'phòng/khu': 'phong_khu_vuc', 'phong khu vuc': 'phong_khu_vuc',
  'phòng/khu vuc': 'phong_khu_vuc', 'phong/khu vực': 'phong_khu_vuc',
  'giường': 'giuong', 'giuong': 'giuong', 'số giường': 'giuong', 'so giuong': 'giuong',
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
  'day': 'day', 'day/khu': 'day',
  'phong': 'phong_khu_vuc', 'phong/khu vuc': 'phong_khu_vuc', 'khu vuc': 'phong_khu_vuc',
  'phong/khu': 'phong_khu_vuc',
  'giuong': 'giuong', 'so giuong': 'giuong',
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

function resolveColumnField(rawHeader: string): DbField | 'stt' | null {
  const norm = normalizeHeader(rawHeader);
  const loose = normalizeLoose(rawHeader);
  if (norm === 'stt' || loose === 'stt') return 'stt';
  if (COLUMN_MAP_EXACT[norm]) return COLUMN_MAP_EXACT[norm];
  if (COLUMN_MAP_LOOSE[loose]) return COLUMN_MAP_LOOSE[loose];
  if (loose.includes('giuong')) return 'giuong';
  if (loose.includes('dieu hoa') || loose.includes('dieu hòa')) return 'dieu_hoa';
  if (loose.includes('o cam')) return 'o_cam_dien';
  if (loose.includes('bong tuyp') || loose.includes('bong den')) return 'bong_tuyp';
  if (loose.includes('ban an')) return 'ban_an';
  if (loose.includes('ghe an')) return 'ghe_an';
  if (loose.includes('remote') || loose.includes('dieu khien')) return 'remote';
  if (loose.includes('quat')) return 'quat';
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
    if (field && field !== 'stt') headerMap[colIdx] = field as DbField;
  });

  const dataStartIdx = headerRowIdx + 1;
  const results: Omit<FacilityRow, 'id'>[] = [];

  for (let i = dataStartIdx; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.every((c: any) => c === '' || c === null || c === undefined)) continue;
    const record: Omit<FacilityRow, 'id'> = {
      ktx: ktxName, day: '', phong_khu_vuc: '', giuong: 0, dieu_hoa: 0, tu: 0,
      quat: 0, o_cam_dien: 0, remote: 0, bong_tuyp: 0, ban_an: 0, ghe_an: 0, ghi_chu: '',
    };
    Object.entries(headerMap).forEach(([colIdxStr, field]) => {
      const colIdx = Number(colIdxStr);
      const cellVal = row[colIdx];
      if (field === 'day' || field === 'phong_khu_vuc' || field === 'ghi_chu') {
        (record as any)[field] = String(cellVal ?? '').trim();
      } else {
        const num = Number(cellVal);
        (record as any)[field] = isNaN(num) ? 0 : num;
      }
    });
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
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Xóa phòng/khu vực</h3>
            <p className="text-sm text-muted-foreground">Hành động này không thể hoàn tác.</p>
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
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Xóa
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
    ktx: activeKtx, day: '', phong_khu_vuc: '', giuong: 0, dieu_hoa: 0, tu: 0,
    quat: 0, o_cam_dien: 0, remote: 0, bong_tuyp: 0, ban_an: 0, ghe_an: 0, ghi_chu: ''
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
            {form.ktx && form.ktx !== '__new__' && (
              <p className="text-xs text-primary mt-1">Phòng sẽ được thêm vào: <strong>{form.ktx}</strong></p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Dãy *</label>
            <input type="text" value={form.day} onChange={e => setForm(r => ({ ...r, day: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Dãy A" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Phòng/Khu vực *</label>
            <input type="text" value={form.phong_khu_vuc} onChange={e => setForm(r => ({ ...r, phong_khu_vuc: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="A101" />
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

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<FacilityRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        const fetched = data || [];
        setRows(fetched);
        // Auto-set activeKtx to first available KTX from DB
        if (fetched.length > 0 && !activeKtx) {
          const firstKtx = Array.from(new Set(fetched.map((r: FacilityRow) => r.ktx).filter(Boolean))).sort()[0];
          if (firstKtx) setActiveKtx(firstKtx as string);
        }
      }
    } catch (e: any) {
      console.error('Fetch error:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFacilities(); }, [fetchFacilities]);

  // ─── Derived KTX tabs from actual DB data ────────────────────────────────
  const allKtxTabs = Array.from(new Set(rows.map(r => r.ktx).filter(Boolean))).sort();

  // If activeKtx not in tabs (e.g. after data load), reset to first
  useEffect(() => {
    if (allKtxTabs.length > 0 && !allKtxTabs.includes(activeKtx)) {
      setActiveKtx(allKtxTabs[0]);
      setFilterDay('');
      setSearchPhong('');
    }
  }, [allKtxTabs.join(',')]);

  // ─── Derived filter options scoped to active KTX tab ─────────────────────
  const allDayOptions = Array.from(new Set(
    rows.filter(r => r.ktx === activeKtx).map(r => r.day).filter(Boolean)
  )).sort();

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
    return sortAsc ? String(av ?? '').localeCompare(String(bv ?? '')) : String(bv ?? '').localeCompare(String(av ?? ''));
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
    setEditingRow({ id: row.id, giuong: row.giuong, dieu_hoa: row.dieu_hoa, tu: row.tu, quat: row.quat, o_cam_dien: row.o_cam_dien, remote: row.remote, bong_tuyp: row.bong_tuyp, ban_an: row.ban_an, ghe_an: row.ghe_an, ghi_chu: row.ghi_chu || '' });
    setSaveError(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditingRow(null); setSaveError(null); };

  const saveEdit = async () => {
    if (!editingRow) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updatePayload: Record<string, number | string> = {};
      NUMERIC_FIELDS.forEach(f => { updatePayload[f as string] = Number(editingRow[f]) || 0; });
      updatePayload['ghi_chu'] = editingRow.ghi_chu;
      const { error } = await supabase.from('facilities').update(updatePayload).eq('id', editingRow.id);
      if (error) setSaveError(error.message);
      else {
        setRows(prev => prev.map(r => r.id === editingRow.id ? { ...r, ...updatePayload } as FacilityRow : r));
        setEditingId(null);
        setEditingRow(null);
      }
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
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
        setDeleteTarget(null);
      }
    } catch (e: any) {
      console.error('Delete error:', e.message);
    } finally {
      setDeleting(false);
    }
  };

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
      {deleteTarget && (
        <DeleteConfirmModal
          row={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
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
            className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors flex-1 sm:flex-initial"
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {importing ? 'Đang import...' : 'Import Excel'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={loading || sortedRows.length === 0}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors flex-1 sm:flex-initial"
          >
            <Download size={15} />
            Xuất Excel
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
        <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${importResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {importResult.success ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />}
          <div className="flex-1">
            <p className="font-medium">{importResult.message}</p>
            {importResult.success && <p className="text-xs mt-0.5 text-emerald-700">Thêm mới: {importResult.inserted} dòng &nbsp;|&nbsp; Cập nhật: {importResult.updated} dòng</p>}
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
              onClick={() => { setActiveKtx(ktx); setEditingId(null); setEditingRow(null); setFilterDay(''); setSearchPhong(''); }}
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

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold text-foreground">
            {activeKtx} — {sortedRows.length} phòng/khu vực
            {hasActiveFilters && <span className="ml-2 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">đang lọc</span>}
          </span>
          {saveError && <span className="text-xs text-red-500">{saveError}</span>}
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
                  <th className={thClass} onClick={() => handleSort('ktx')}>KTX <SortIcon field="ktx" /></th>
                  <th className={thClass} onClick={() => handleSort('day')}>Dãy <SortIcon field="day" /></th>
                  <th className={thClass} onClick={() => handleSort('phong_khu_vuc')}>Phòng/Khu vực <SortIcon field="phong_khu_vuc" /></th>
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
                  return (
                    <tr key={row.id} className={`transition-colors ${isEditing ? 'bg-primary/5' : 'hover:bg-muted/30'}`}>
                      <td className={tdClass}><span className="text-xs bg-muted px-1.5 py-0.5 rounded font-medium">{row.ktx}</span></td>
                      <td className={tdClass}><span className="font-medium">{row.day}</span></td>
                      <td className={tdClass}>{row.phong_khu_vuc}</td>
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
                                className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50">
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
                              <button onClick={() => setDeleteTarget(row)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors" title="Xóa">
                                <Trash2 size={14} />
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
                  <td className="px-3 py-2.5 text-xs font-bold text-foreground" colSpan={3}>TỔNG CỘNG ({filteredRows.length} phòng)</td>
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
