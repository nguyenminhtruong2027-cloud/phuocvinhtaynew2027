'use client';

import { createClient } from '@/lib/supabase/client';
import { exportMultiSheetExcel, ExcelSheetInput } from '@/lib/exportExcel';

export interface BackupTableSummary {
  key: string;
  label: string;
  sheetName: string;
  count: number;
  ok: boolean;
  error?: string;
}

export interface FullSystemBackupSnapshot {
  schemaVersion: string;
  systemName: string;
  generatedAt: string;
  generatedAtVN: string;
  actor: string;
  totalRecords: number;
  summaries: BackupTableSummary[];
  tables: Record<string, Record<string, unknown>[]>;
}

const BACKUP_TABLES: {
  key: string;
  label: string;
  sheetName: string;
  maxRows?: number;
  orderBy?: string;
}[] = [
  { key: 'workers', label: 'Danh sách Công nhân', sheetName: 'Cong_Nhan', maxRows: 15000 },
  { key: 'beds', label: 'Quản lý Giường', sheetName: 'Giuong', maxRows: 15000 },
  { key: 'bed_reservations', label: 'Giữ chỗ giường đoàn sắp vào', sheetName: 'Giu_Cho_Giuong', maxRows: 5000, orderBy: 'created_at' },
  { key: 'facilities', label: 'Cơ sở vật chất', sheetName: 'Co_So_Vat_Chat', maxRows: 10000 },
  { key: 'room_units', label: 'Cấu hình Phòng & Giới tính', sheetName: 'Cau_Hinh_Phong', maxRows: 5000 },
  { key: 'maintenance_tickets', label: 'Phiếu Kỹ thuật & Bảo trì', sheetName: 'Phieu_Bao_Tri', maxRows: 5000, orderBy: 'created_at' },
  { key: 'worker_registrations', label: 'Hồ sơ Đăng ký QR', sheetName: 'Ho_So_QR', maxRows: 5000, orderBy: 'created_at' },
  { key: 'worker_entry_log', label: 'Nhật ký Biến động Vào-Ra', sheetName: 'Bien_Dong_Vao_Ra', maxRows: 5000, orderBy: 'created_at' },
  { key: 'worker_disciplines', label: 'Sổ Vi phạm & Kỷ luật KTX', sheetName: 'Vi_Pham_Ky_Luat', maxRows: 5000, orderBy: 'created_at' },
  { key: 'worker_blacklist', label: 'Danh sách Đen (Blacklist)', sheetName: 'Danh_Sach_Den', maxRows: 5000, orderBy: 'created_at' },
  { key: 'profiles', label: 'Tài khoản & Phân quyền', sheetName: 'Tai_Khoan', maxRows: 1000 },
  { key: 'audit_logs', label: 'Nhật ký Hệ thống (gần nhất)', sheetName: 'Nhat_Ky_He_Thong', maxRows: 2000, orderBy: 'created_at' },
];

function formatVNFileTimestamp(date: Date): string {
  const vnOffset = 7 * 60;
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const vn = new Date(utc + vnOffset * 60000);
  const yyyy = vn.getFullYear();
  const mm = String(vn.getMonth() + 1).padStart(2, '0');
  const dd = String(vn.getDate()).padStart(2, '0');
  const hh = String(vn.getHours()).padStart(2, '0');
  const mi = String(vn.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function flattenRowForExcel(row: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  Object.entries(row).forEach(([k, v]) => {
    if (v === null || v === undefined) {
      out[k] = '';
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
    } else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    }
  });
  return out;
}

async function fetchPagedTable(
  table: string,
  maxRows = 5000,
  orderBy?: string
): Promise<{ rows: Record<string, unknown>[]; ok: boolean; error?: string }> {
  const supabase = createClient();

  // Special case for profiles: prefer SECURITY DEFINER RPC so Super Admin gets all profiles reliably
  if (table === 'profiles') {
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_all_profiles');
      if (!rpcErr && Array.isArray(rpcData)) {
        return { rows: rpcData as Record<string, unknown>[], ok: true };
      }
    } catch {
      // fall through to direct select
    }
  }

  const pageSize = 1000;
  const collected: Record<string, unknown>[] = [];
  let from = 0;

  try {
    while (from < maxRows) {
      const to = Math.min(from + pageSize - 1, maxRows - 1);
      let query = supabase.from(table).select('*').range(from, to);
      if (orderBy) {
        query = query.order(orderBy, { ascending: false });
      }
      const { data, error } = await query;
      if (error) {
        if (collected.length > 0) {
          return { rows: collected, ok: true };
        }
        return { rows: [], ok: false, error: error.message };
      }
      const batch = (data || []) as Record<string, unknown>[];
      collected.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return { rows: collected, ok: true };
  } catch (err) {
    return {
      rows: collected,
      ok: collected.length > 0,
      error: err instanceof Error ? err.message : 'Lỗi kết nối bảng dữ liệu',
    };
  }
}

export async function fetchFullSystemBackupSnapshot(actor: string): Promise<FullSystemBackupSnapshot> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const generatedAtVN = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const results = await Promise.all(
    BACKUP_TABLES.map(async (cfg) => {
      const res = await fetchPagedTable(cfg.key, cfg.maxRows ?? 5000, cfg.orderBy);
      return { cfg, res };
    })
  );

  const tables: Record<string, Record<string, unknown>[]> = {};
  const summaries: BackupTableSummary[] = [];
  let totalRecords = 0;

  results.forEach(({ cfg, res }) => {
    tables[cfg.key] = res.rows;
    totalRecords += res.rows.length;
    summaries.push({
      key: cfg.key,
      label: cfg.label,
      sheetName: cfg.sheetName,
      count: res.rows.length,
      ok: res.ok,
      error: res.error,
    });
  });

  return {
    schemaVersion: '1.0',
    systemName: 'KTX Phước Vĩnh Tây — Quản lý Ký túc xá Công nhân',
    generatedAt,
    generatedAtVN,
    actor,
    totalRecords,
    summaries,
    tables,
  };
}

export async function exportFullSystemExcelBackup(actor: string): Promise<FullSystemBackupSnapshot> {
  const snapshot = await fetchFullSystemBackupSnapshot(actor);
  const stamp = formatVNFileTimestamp(new Date(snapshot.generatedAt));

  const overviewRows = snapshot.summaries.map((s, idx) => ({
    'STT': idx + 1,
    'PHÂN HỆ DỮ LIỆU': s.label,
    'BẢNG DATABASE': s.key,
    'TÊN SHEET': s.sheetName,
    'SỐ BẢN GHI': s.count,
    'TRẠNG THÁI': s.ok ? 'Thành công' : `Chưa khả dụng (${s.error || 'Chưa tạo bảng'})`,
    'NGƯỜI SAO LƯU': snapshot.actor,
    'THỜI GIAN (VN)': snapshot.generatedAtVN,
  }));

  const sheets: ExcelSheetInput[] = [
    {
      name: 'Tong_Quan_Sao_Luu',
      data: overviewRows,
    },
    ...snapshot.summaries.map((s) => ({
      name: s.sheetName,
      data: (snapshot.tables[s.key] || []).map(flattenRowForExcel),
      emptyHeaders: ['GHI_CHU'],
    })),
  ];

  exportMultiSheetExcel(sheets, `KTX_PhuocVinhTay_FullBackup_${stamp}.xlsx`);
  return snapshot;
}

export async function exportFullSystemJsonBackup(actor: string): Promise<FullSystemBackupSnapshot> {
  const snapshot = await fetchFullSystemBackupSnapshot(actor);
  const stamp = formatVNFileTimestamp(new Date(snapshot.generatedAt));
  const jsonContent = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });

  if (typeof window !== 'undefined') {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `KTX_PhuocVinhTay_FullBackup_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 1000);
  }

  return snapshot;
}
