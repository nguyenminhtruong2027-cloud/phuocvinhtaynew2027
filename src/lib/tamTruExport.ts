import { Worker, naturalSortCompare } from '@/data/workers';
import { exportToExcel } from '@/lib/exportExcel';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { daysSinceVN, getVNDateString } from '@/lib/vnDate';

export type TamTruExportScope = 'unregistered' | 'overdue' | 'today' | 'all';

export interface TamTruExportResult {
  ok: boolean;
  count: number;
  fileName: string;
}

function isCheckedOut(w: Worker): boolean {
  return Boolean(
    w.ngayRaKTX ||
    w.ghiChu?.includes('[Đã Check-out') ||
    w.ghiChu?.includes('[CHECKOUT]')
  );
}

function matchesEnteredToday(w: Worker, todayVN: string): boolean {
  const [y, m, d] = todayVN.split('-');
  const ddmmyyyy = `${d}/${m}/${y}`;
  const raw = (w.ngayVaoKTX || '').trim();
  if (raw === todayVN || raw === ddmmyyyy || raw.startsWith(todayVN)) return true;
  if (w.createdAt) {
    const days = daysSinceVN(w.createdAt);
    if (days === 0) return true;
  }
  return false;
}

export function filterWorkersForTamTru(
  workers: Worker[],
  scope: TamTruExportScope,
  ktxFilter?: string
): Worker[] {
  const todayVN = getVNDateString();
  const active = workers.filter(w => {
    if (isCheckedOut(w)) return false;
    if (ktxFilter && ktxFilter !== 'all' && (w.ktx || '').trim() !== ktxFilter.trim()) {
      return false;
    }
    return true;
  });

  let filtered: Worker[];
  if (scope === 'unregistered') {
    filtered = active.filter(w => w.tamTruStatus !== 'registered');
  } else if (scope === 'overdue') {
    filtered = active.filter(w => {
      if (w.tamTruStatus === 'registered') return false;
      const days = daysSinceVN(w.ngayVaoKTX || w.createdAt);
      return days !== null && days > 7;
    });
  } else if (scope === 'today') {
    filtered = active.filter(w => matchesEnteredToday(w, todayVN));
  } else {
    filtered = active;
  }

  return filtered.sort((a, b) => {
    const dCmp = naturalSortCompare(a.day || '', b.day || '');
    if (dCmp !== 0) return dCmp;
    const rCmp = naturalSortCompare(a.phongSo || '', b.phongSo || '');
    if (rCmp !== 0) return rCmp;
    return (a.hoVaTen || '').localeCompare(b.hoVaTen || '', 'vi');
  });
}

/**
 * Exports standard Vietnamese temporary-residence declaration Excel sheet
 * for submission to local police (Công an xã Phước Vĩnh Tây).
 */
export function exportTamTruDeclaration(
  workers: Worker[],
  scope: TamTruExportScope,
  ktxFilter?: string
): TamTruExportResult {
  const todayVN = getVNDateString();
  const list = filterWorkersForTamTru(workers, scope, ktxFilter);

  const scopeSlug =
    scope === 'unregistered'
      ? 'ChuaDK_TamTru'
      : scope === 'overdue'
      ? 'QuaHan7Ngay_TamTru'
      : scope === 'today'
      ? 'VaoMoiHomNay_TamTru'
      : 'ToanBo_TamTru';

  const fileName = `KhaiBao_TamTru_${scopeSlug}_${todayVN}.xlsx`;

  if (list.length === 0) {
    return { ok: false, count: 0, fileName };
  }

  const rows = list.map((w, idx) => {
    const stayDays = daysSinceVN(w.ngayVaoKTX || w.createdAt);
    const isOverdue = w.tamTruStatus !== 'registered' && stayDays !== null && stayDays > 7;
    return {
      'STT': idx + 1,
      'Họ và tên': w.hoVaTen || '',
      'Ngày sinh': w.ngaySinh || '',
      'Giới tính': w.gioiTinh || '',
      'Số CCCD / CMND': w.cccd || '',
      'Số điện thoại': w.soDienThoai || '',
      'Hộ khẩu thường trú (Tỉnh/TP)': w.hoKhauTinh || '',
      'Nơi tạm trú (KTX)': w.ktx || 'KTX Phước Vĩnh Tây',
      'Dãy nhà': w.day || '',
      'Phòng': w.phongSo ? formatRoomDisplay(w.phongSo) : '',
      'Giường': w.giuong || '',
      'Ngày vào KTX': w.ngayVaoKTX || '',
      'Số ngày lưu trú': stayDays !== null ? stayDays : '',
      'Mã NV': w.maNV || '',
      'Đơn vị / Nhà thầu': w.donVi || '',
      'Tiểu đoàn / Đội': w.tieuDoan || '',
      'Trạng thái tạm trú':
        w.tamTruStatus === 'registered'
          ? 'Đã đăng ký'
          : isOverdue
          ? `Quá hạn (${stayDays} ngày)`
          : 'Chưa đăng ký',
      'Ghi chú': w.ghiChu || '',
    };
  });

  const ok = exportToExcel(rows, fileName, 'KhaiBaoTamTru');
  return { ok, count: list.length, fileName };
}
