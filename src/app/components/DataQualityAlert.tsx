'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ShieldAlert,
  FileWarning,
  Users,
  X,
  ArrowRight,
  CheckCircle2,
  Download,
  Activity,
  RefreshCw,
  BedDouble,
} from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_ROOM_CAPACITY, getProfileStatus, Worker } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { normalizeGender } from '@/lib/roomGender';
import {
  fetchRoomCapacities,
  formatRoomDisplay,
  getRoomCapacity,
  normalizeRoomLabel,
  RoomCapacityMap,
} from '@/lib/facilityCapacity';
import { normalizeBedLabel, reconcileBedsWithWorkers } from '@/lib/bedSync';
import { exportMultiSheetExcel } from '@/lib/exportExcel';
import { daysSinceVN } from '@/lib/vnDate';

interface GenderConflictRoom {
  ktx: string;
  day: string;
  room: string;
  maleCount: number;
  femaleCount: number;
  adminLabel?: 'male' | 'female' | 'auto';
  reason: string;
}

interface DuplicateSlotIssue {
  ktx: string;
  day: string;
  room: string;
  bed: string;
  workers: Worker[];
}

interface DuplicateCccdIssue {
  cccd: string;
  workers: Worker[];
}

interface OverloadedRoomIssue {
  ktx: string;
  day: string;
  room: string;
  count: number;
  capacity: number;
}

interface DataQualityAlertProps {
  selectedKtx?: string;
  roomGenderMap?: Record<string, 'male' | 'female' | 'auto'>;
  onSelectRoom?: (ktx: string, building: string, room: string) => void;
}

export default function DataQualityAlert({
  selectedKtx = 'all',
  roomGenderMap = {},
  onSelectRoom,
}: DataQualityAlertProps) {
  const { workers, refreshWorkers } = useWorkers();
  const { isAdmin, canWriteBlock } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [roomCapacities, setRoomCapacities] = useState<RoomCapacityMap>({});

  useEffect(() => {
    let active = true;
    const loadCaps = () => {
      fetchRoomCapacities()
        .then(map => {
          if (active) setRoomCapacities(map);
        })
        .catch(() => {});
    };
    loadCaps();
    if (typeof window !== 'undefined') {
      window.addEventListener('ktx_facilities_updated', loadCaps);
    }
    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('ktx_facilities_updated', loadCaps);
      }
    };
  }, []);

  const scopedAllWorkers = useMemo(() => {
    const list = Array.isArray(workers) ? workers : [];
    if (!selectedKtx || selectedKtx === 'all') return list;
    return list.filter(w => (w?.ktx || '').trim() === selectedKtx.trim());
  }, [workers, selectedKtx]);

  const scopedWorkers = useMemo(() => {
    return scopedAllWorkers.filter(
      w =>
        !w?.ngayRaKTX &&
        !w?.ghiChu?.includes('[Đã Check-out') &&
        !w?.ghiChu?.includes('[CHECKOUT]')
    );
  }, [scopedAllWorkers]);

  const metrics = useMemo(() => {
    let missingCCCD = 0;
    let missingEntry = 0;
    let pendingCode = 0;
    let noRoom = 0;
    let unregisteredTamTru = 0;
    let overdueTamTru = 0;

    const unregisteredList: Array<{ worker: Worker; days: number | null }> = [];
    const incompleteList: Array<{ worker: Worker; issues: string }> = [];

    const roomBuckets = new Map<
      string,
      { ktx: string; day: string; room: string; maleCount: number; femaleCount: number; count: number }
    >();
    const bedSlotBuckets = new Map<string, DuplicateSlotIssue>();
    const cccdBuckets = new Map<string, Worker[]>();

    for (const w of scopedWorkers) {
      const missingFields: string[] = [];
      if (!w?.cccd) { missingCCCD++; missingFields.push('Thiếu CCCD'); }
      if (!w?.ngayVaoKTX) { missingEntry++; missingFields.push('Thiếu ngày vào'); }
      if (!w?.maNV || w.maNV === 'Chờ mã' || w.maNV === 'Chờ Mã') { pendingCode++; missingFields.push('Chờ mã NV'); }
      if (getProfileStatus(w) === 'no_room') { noRoom++; missingFields.push('Chưa phân phòng'); }
      if (missingFields.length > 0) {
        incompleteList.push({ worker: w, issues: missingFields.join(', ') });
      }

      if (w?.tamTruStatus !== 'registered') {
        unregisteredTamTru++;
        const days = daysSinceVN(w?.ngayVaoKTX || w?.createdAt);
        if (days !== null && days > 7) {
          overdueTamTru++;
        }
        unregisteredList.push({ worker: w, days });
      }

      const cleanCccd = (w?.cccd || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
      if (cleanCccd.length >= 8) {
        const arr = cccdBuckets.get(cleanCccd) || [];
        arr.push(w);
        cccdBuckets.set(cleanCccd, arr);
      }

      if (w?.ktx && w?.day && w?.phongSo) {
        const normRoom = normalizeRoomLabel(w.phongSo) || w.phongSo.trim();
        const key = `${w.ktx.trim()}||${w.day.trim()}||${normRoom}`;
        if (!roomBuckets.has(key)) {
          roomBuckets.set(key, {
            ktx: w.ktx.trim(),
            day: w.day.trim(),
            room: w.phongSo.trim(),
            maleCount: 0,
            femaleCount: 0,
            count: 0,
          });
        }
        const bucket = roomBuckets.get(key)!;
        bucket.count++;
        const g = normalizeGender(w.gioiTinh);
        if (g === 'nam') bucket.maleCount++;
        else if (g === 'nu') bucket.femaleCount++;

        const normBed = normalizeBedLabel(w.giuong || '');
        if (normBed) {
          const slotKey = `${key}||${normBed}`;
          if (!bedSlotBuckets.has(slotKey)) {
            bedSlotBuckets.set(slotKey, {
              ktx: w.ktx.trim(),
              day: w.day.trim(),
              room: w.phongSo.trim(),
              bed: (w.giuong || '').trim(),
              workers: [],
            });
          }
          bedSlotBuckets.get(slotKey)!.workers.push(w);
        }
      }
    }

    const checkedOutHoldingBed = scopedAllWorkers.filter(
      w =>
        (Boolean(w?.ngayRaKTX) ||
          Boolean(w?.ghiChu?.includes('[Đã Check-out')) ||
          Boolean(w?.ghiChu?.includes('[CHECKOUT]'))) &&
        Boolean((w?.giuong || '').trim())
    );

    const duplicateBedSlots: DuplicateSlotIssue[] = [];
    bedSlotBuckets.forEach(item => {
      if (item.workers.length > 1) duplicateBedSlots.push(item);
    });

    const duplicateCccds: DuplicateCccdIssue[] = [];
    cccdBuckets.forEach((arr, cccd) => {
      if (arr.length > 1) duplicateCccds.push({ cccd: arr[0]?.cccd || cccd, workers: arr });
    });

    const overloadedRooms: OverloadedRoomIssue[] = [];
    const genderConflicts: GenderConflictRoom[] = [];
    roomBuckets.forEach((b) => {
      const cap = getRoomCapacity(roomCapacities, b.ktx, b.day, b.room) || DEFAULT_ROOM_CAPACITY;
      if (b.count > cap) {
        overloadedRooms.push({
          ktx: b.ktx,
          day: b.day,
          room: b.room,
          count: b.count,
          capacity: cap,
        });
      }

      const exactKey = `${b.ktx}||${b.day}||${b.room}`;
      const normKey = `${b.ktx}||${b.day}||${normalizeRoomLabel(b.room)}`;
      const adminLabel = roomGenderMap[exactKey] ?? roomGenderMap[normKey];

      if (b.maleCount > 0 && b.femaleCount > 0) {
        genderConflicts.push({
          ...b,
          adminLabel,
          reason: `Có cả ${b.maleCount} Nam & ${b.femaleCount} Nữ trong phòng`,
        });
      } else if (adminLabel === 'male' && b.femaleCount > 0) {
        genderConflicts.push({
          ...b,
          adminLabel,
          reason: `Gán Phòng Nam nhưng có ${b.femaleCount} công nhân Nữ`,
        });
      } else if (adminLabel === 'female' && b.maleCount > 0) {
        genderConflicts.push({
          ...b,
          adminLabel,
          reason: `Gán Phòng Nữ nhưng có ${b.maleCount} công nhân Nam`,
        });
      }
    });

    unregisteredList.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

    const healthIssueCount =
      checkedOutHoldingBed.length +
      duplicateBedSlots.length +
      duplicateCccds.length +
      overloadedRooms.length +
      genderConflicts.length;

    return {
      missingCCCD,
      missingEntry,
      pendingCode,
      noRoom,
      unregisteredTamTru,
      overdueTamTru,
      genderConflicts,
      unregisteredList,
      incompleteList,
      checkedOutHoldingBed,
      duplicateBedSlots,
      duplicateCccds,
      overloadedRooms,
      healthIssueCount,
    };
  }, [scopedWorkers, scopedAllWorkers, roomGenderMap, roomCapacities]);

  const handleAutoReconcile = async () => {
    setReconciling(true);
    try {
      let cleanedCheckoutCount = 0;
      const authorizedCheckoutIds = metrics.checkedOutHoldingBed
        .filter(w => isAdmin || canWriteBlock(w.day, w.ktx))
        .map(w => w.id);

      if (authorizedCheckoutIds.length > 0) {
        const CHUNK = 100;
        for (let i = 0; i < authorizedCheckoutIds.length; i += CHUNK) {
          const chunk = authorizedCheckoutIds.slice(i, i + CHUNK);
          const { error } = await supabase
            .from('workers')
            .update({ giuong: '' })
            .in('id', chunk);
          if (!error) cleanedCheckoutCount += chunk.length;
        }
      }

      const result = await reconcileBedsWithWorkers(supabase, { isAdmin, canWriteBlock });
      await refreshWorkers();

      toast.success(
        `Đã đồng bộ xong: giải phóng ${result.releasedCount} giường lệch, gán ${result.assignedCount} giường, cập nhật ${result.updatedInfoCount} thông tin${
          cleanedCheckoutCount > 0 ? `, dọn ${cleanedCheckoutCount} hồ sơ đã check-out còn giữ giường` : ''
        }.`
      );
    } catch (err: any) {
      toast.error(`Lỗi đồng bộ dữ liệu: ${err?.message || 'Không thể thực hiện'}`);
    } finally {
      setReconciling(false);
    }
  };

  const handleExportAlerts = () => {
    const tamTruRows = metrics.unregisteredList.map((item, idx) => ({
      'STT': idx + 1,
      'Họ và tên': item.worker.hoVaTen || '—',
      'Mã NV': item.worker.maNV || '—',
      'CCCD': item.worker.cccd || '—',
      'SĐT': item.worker.soDienThoai || '—',
      'Đơn vị': item.worker.donVi || '—',
      'KTX': item.worker.ktx || '—',
      'Dãy': item.worker.day || '—',
      'Phòng': item.worker.phongSo || '—',
      'Ngày vào KTX': item.worker.ngayVaoKTX || '—',
      'Số ngày chưa ĐK': item.days !== null ? item.days : '—',
      'Mức độ': item.days !== null && item.days > 7 ? 'Quá hạn (>7 ngày)' : 'Chờ ĐK',
    }));

    const conflictRows = metrics.genderConflicts.map((c, idx) => ({
      'STT': idx + 1,
      'KTX': c.ktx,
      'Dãy': c.day,
      'Phòng': formatRoomDisplay(c.room),
      'Nam': c.maleCount,
      'Nữ': c.femaleCount,
      'Cảnh báo': c.reason,
    }));

    const missingRows = metrics.incompleteList.map((item, idx) => ({
      'STT': idx + 1,
      'Họ và tên': item.worker.hoVaTen || '—',
      'Mã NV': item.worker.maNV || '—',
      'KTX': item.worker.ktx || '—',
      'Dãy': item.worker.day || '—',
      'Phòng': item.worker.phongSo || '—',
      'SĐT': item.worker.soDienThoai || '—',
      'Thông tin còn thiếu': item.issues,
    }));

    const scopeLabel = selectedKtx !== 'all' ? selectedKtx.replace(/\s+/g, '_') : 'TatCa_KTX';
    const today = new Date().toISOString().split('T')[0];
    const ok = exportMultiSheetExcel(
      [
        {
          name: 'Chưa ĐK Tạm Trú',
          data: tamTruRows,
          emptyHeaders: ['STT', 'Họ và tên', 'Mã NV', 'CCCD', 'SĐT', 'Đơn vị', 'KTX', 'Dãy', 'Phòng', 'Ngày vào KTX', 'Số ngày chưa ĐK', 'Mức độ'],
        },
        {
          name: 'Phòng lệch giới tính',
          data: conflictRows,
          emptyHeaders: ['STT', 'KTX', 'Dãy', 'Phòng', 'Nam', 'Nữ', 'Cảnh báo'],
        },
        {
          name: 'Hồ sơ thiếu thông tin',
          data: missingRows,
          emptyHeaders: ['STT', 'Họ và tên', 'Mã NV', 'KTX', 'Dãy', 'Phòng', 'SĐT', 'Thông tin còn thiếu'],
        },
      ],
      `CanhBao_VanHanh_${scopeLabel}_${today}.xlsx`
    );
    if (ok) {
      toast.success('Đã xuất file Excel danh sách cảnh báo vận hành.');
    } else {
      toast.error('Không thể xuất file Excel.');
    }
  };

  const hasAnyAlert =
    metrics.unregisteredTamTru > 0 ||
    metrics.genderConflicts.length > 0 ||
    metrics.missingCCCD > 0 ||
    metrics.missingEntry > 0 ||
    metrics.pendingCode > 0 ||
    metrics.noRoom > 0 ||
    metrics.healthIssueCount > 0;

  if (!hasAnyAlert || (scopedWorkers.length === 0 && metrics.checkedOutHoldingBed.length === 0)) {
    return null;
  }

  return (
    <>
      <div className="rounded-2xl border border-wn/60 bg-surf px-4 py-3.5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-xl tint-wn border border-wn flex items-center justify-center text-wn shrink-0 mt-0.5">
              <ShieldAlert size={16} />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-bold text-tx flex items-center gap-2 flex-wrap">
                <span>Cảnh báo vận hành tự động</span>
                {selectedKtx !== 'all' && (
                  <span className="text-[11px] font-semibold text-mu">({selectedKtx})</span>
                )}
              </p>
              <p className="text-[11px] text-mu mt-0.5">
                Phát hiện nhanh tạm trú quá hạn, sai lệch giường/CCCD, phòng quá tải và hồ sơ còn thiếu thông tin.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {metrics.overdueTamTru > 0 && (
              <Link
                href={`/worker-management?tamTru=overdue${selectedKtx !== 'all' ? `&ktx=${encodeURIComponent(selectedKtx)}` : ''}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl tint-dgr border border-dgr text-dgr text-xs font-bold hover:opacity-90 transition-opacity"
              >
                <FileWarning size={13} />
                <span>{metrics.overdueTamTru.toLocaleString('vi-VN')} quá hạn tạm trú (&gt;7 ngày)</span>
              </Link>
            )}

            {metrics.unregisteredTamTru > 0 && (
              <Link
                href={`/worker-management?tamTru=unregistered${selectedKtx !== 'all' ? `&ktx=${encodeURIComponent(selectedKtx)}` : ''}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl tint-wn border border-wn text-wn text-xs font-bold hover:opacity-90 transition-opacity"
              >
                <FileWarning size={13} />
                <span>{metrics.unregisteredTamTru.toLocaleString('vi-VN')} chưa ĐK tạm trú</span>
              </Link>
            )}

            {metrics.genderConflicts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConflictModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl tint-dgr border border-dgr text-dgr text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Users size={13} />
                <span>{metrics.genderConflicts.length} phòng lệch giới tính</span>
              </button>
            )}

            {metrics.noRoom > 0 && (
              <Link
                href={`/worker-management?filter=no_room${selectedKtx !== 'all' ? `&ktx=${encodeURIComponent(selectedKtx)}` : ''}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-act border border-bdr2 text-lnk text-xs font-bold hover:bg-bdg transition-colors"
              >
                <AlertTriangle size={13} />
                <span>{metrics.noRoom.toLocaleString('vi-VN')} chưa phân phòng</span>
              </Link>
            )}

            {(metrics.missingCCCD > 0 || metrics.missingEntry > 0 || metrics.pendingCode > 0) && (
              <Link
                href={`/worker-management?filter=missing_cccd_sdt${selectedKtx !== 'all' ? `&ktx=${encodeURIComponent(selectedKtx)}` : ''}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-act border border-bdr text-mu hover:text-tx text-xs font-semibold transition-colors"
              >
                <span>
                  Thiếu hồ sơ: {metrics.missingCCCD} CCCD · {metrics.missingEntry} ngày vào · {metrics.pendingCode} chờ mã NV
                </span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setShowHealthModal(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                metrics.healthIssueCount > 0
                  ? 'tint-dgr border-dgr text-dgr hover:opacity-90'
                  : 'bg-act border-bdr2 text-tx hover:bg-bdg'
              }`}
              title="Kiểm tra trùng giường, trùng CCCD, công nhân check-out còn giữ giường và phòng quá tải"
            >
              <Activity size={13} />
              <span>
                Kiểm tra sức khỏe DL{metrics.healthIssueCount > 0 ? ` (${metrics.healthIssueCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={handleExportAlerts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-okbg border border-bdr2 text-ok text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
              title="Xuất file Excel danh sách tạm trú quá hạn, phòng lệch giới tính và hồ sơ còn thiếu"
            >
              <Download size={13} />
              <span>Xuất DS cảnh báo</span>
            </button>
          </div>
        </div>
      </div>

      {/* Gender Conflict Modal */}
      {showConflictModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setShowConflictModal(false)}
        >
          <div
            className="bg-surf border border-bdr rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-bdr flex items-center justify-between bg-act/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl tint-dgr border border-dgr flex items-center justify-center text-dgr">
                  <Users size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-tx">Phòng lệch hoặc hỗn hợp giới tính</h3>
                  <p className="text-xs text-mu mt-0.5">
                    {metrics.genderConflicts.length} phòng cần kiểm tra lại phân bổ Nam / Nữ hoặc nhãn công năng
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConflictModal(false)}
                className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1 scrollbar-thin">
              {metrics.genderConflicts.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <CheckCircle2 size={28} className="mx-auto text-ok" />
                  <p className="text-sm font-semibold text-tx">Không có phòng lệch giới tính</p>
                </div>
              ) : (
                metrics.genderConflicts.map((item, idx) => (
                  <div
                    key={`${item.ktx}-${item.day}-${item.room}-${idx}`}
                    className="rounded-xl border border-dgr/50 bg-act/60 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div>
                      <p className="text-sm font-bold text-tx">
                        {item.ktx} · {item.day} · {formatRoomDisplay(item.room)}
                      </p>
                      <p className="text-xs text-dgr mt-0.5">{item.reason}</p>
                    </div>
                    {onSelectRoom ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowConflictModal(false);
                          onSelectRoom(item.ktx, item.day, item.room);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pri hover:opacity-90 text-white text-xs font-semibold shrink-0"
                      >
                        <span>Kiểm tra phòng</span>
                        <ArrowRight size={12} />
                      </button>
                    ) : (
                      <Link
                        href="/worker-management"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pri hover:opacity-90 text-white text-xs font-semibold shrink-0"
                      >
                        <span>Xem công nhân</span>
                        <ArrowRight size={12} />
                      </Link>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3.5 border-t border-bdr bg-act/50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowConflictModal(false)}
                className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-bold text-tx hover:bg-surf"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Data Health Check Modal */}
      {showHealthModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setShowHealthModal(false)}
        >
          <div
            className="bg-surf border border-bdr rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-bdr flex items-center justify-between gap-3 bg-act/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk">
                  <Activity size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-tx">Kiểm tra sức khỏe & Toàn vẹn dữ liệu</h3>
                  <p className="text-xs text-mu mt-0.5">
                    Tổng hợp bất thường về giường, CCCD, quá tải phòng và trạng thái tạm trú
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHealthModal(false)}
                className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 scrollbar-thin">
              {/* Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-xl border border-bdr bg-act/50 p-3">
                  <div className="text-[11px] text-mu font-semibold">Check-out giữ giường</div>
                  <div className={`text-xl font-bold font-tabular mt-0.5 ${metrics.checkedOutHoldingBed.length > 0 ? 'text-dgr' : 'text-ok'}`}>
                    {metrics.checkedOutHoldingBed.length}
                  </div>
                </div>
                <div className="rounded-xl border border-bdr bg-act/50 p-3">
                  <div className="text-[11px] text-mu font-semibold">Trùng vị trí giường</div>
                  <div className={`text-xl font-bold font-tabular mt-0.5 ${metrics.duplicateBedSlots.length > 0 ? 'text-dgr' : 'text-ok'}`}>
                    {metrics.duplicateBedSlots.length}
                  </div>
                </div>
                <div className="rounded-xl border border-bdr bg-act/50 p-3">
                  <div className="text-[11px] text-mu font-semibold">Trùng số CCCD</div>
                  <div className={`text-xl font-bold font-tabular mt-0.5 ${metrics.duplicateCccds.length > 0 ? 'text-wn' : 'text-ok'}`}>
                    {metrics.duplicateCccds.length}
                  </div>
                </div>
                <div className="rounded-xl border border-bdr bg-act/50 p-3">
                  <div className="text-[11px] text-mu font-semibold">Phòng vượt định mức</div>
                  <div className={`text-xl font-bold font-tabular mt-0.5 ${metrics.overloadedRooms.length > 0 ? 'text-wn' : 'text-ok'}`}>
                    {metrics.overloadedRooms.length}
                  </div>
                </div>
              </div>

              {metrics.healthIssueCount === 0 && (
                <div className="rounded-xl border border-ok/30 bg-okbg p-5 text-center space-y-1.5">
                  <CheckCircle2 size={28} className="mx-auto text-ok" />
                  <p className="text-sm font-bold text-tx">Dữ liệu hiện tại sạch và đồng bộ</p>
                  <p className="text-xs text-mu">
                    Không phát hiện trùng giường, trùng CCCD hay hồ sơ check-out còn giữ giường. Bạn vẫn có thể chạy đồng bộ giường thủ công nếu cần.
                  </p>
                </div>
              )}

              {metrics.checkedOutHoldingBed.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-dgr">
                    1. Công nhân đã check-out nhưng còn gán số giường ({metrics.checkedOutHoldingBed.length})
                  </h4>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {metrics.checkedOutHoldingBed.map(w => (
                      <div key={w.id} className="rounded-lg border border-dgr/40 bg-act/60 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-bold text-tx">{w.hoVaTen}</span>{' '}
                          <span className="font-mono text-mu">({w.maNV || '—'})</span>
                          <div className="text-[11px] text-mu">
                            {w.ktx} · {w.day} · {formatRoomDisplay(w.phongSo)} · Giường {w.giuong}
                          </div>
                        </div>
                        <Link
                          href={`/worker-management?view=${encodeURIComponent(w.id)}`}
                          className="text-lnk font-semibold hover:underline shrink-0"
                        >
                          Mở hồ sơ →
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {metrics.duplicateBedSlots.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-dgr">
                    2. Vị trí giường có từ 2 công nhân trở lên ({metrics.duplicateBedSlots.length})
                  </h4>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {metrics.duplicateBedSlots.map((slot, idx) => (
                      <div key={idx} className="rounded-lg border border-dgr/40 bg-act/60 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-tx">
                            {slot.ktx} · {slot.day} · {formatRoomDisplay(slot.room)} · Giường {slot.bed}
                          </span>
                          <Link
                            href={`/bed-management?ktx=${encodeURIComponent(slot.ktx)}&day=${encodeURIComponent(slot.day)}&room=${encodeURIComponent(slot.room)}`}
                            className="text-lnk font-semibold hover:underline shrink-0"
                          >
                            Mở Sơ đồ giường →
                          </Link>
                        </div>
                        <p className="text-[11px] text-dgr mt-0.5">
                          Đang trùng: {slot.workers.map(w => `${w.hoVaTen} (${w.maNV || 'N/A'})`).join(' & ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {metrics.duplicateCccds.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-wn">
                    3. Số CCCD trùng giữa các hồ sơ đang lưu trú ({metrics.duplicateCccds.length})
                  </h4>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {metrics.duplicateCccds.map((dup, idx) => (
                      <div key={idx} className="rounded-lg border border-wn/40 bg-act/60 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-mono font-bold text-tx">CCCD: {dup.cccd}</span>
                          <p className="text-[11px] text-mu mt-0.5">
                            {dup.workers.map(w => `${w.hoVaTen} (${w.ktx || '—'} ${w.phongSo ? `P.${w.phongSo}` : ''})`).join(' · ')}
                          </p>
                        </div>
                        <Link
                          href={`/worker-management?search=${encodeURIComponent(dup.cccd)}`}
                          className="text-lnk font-semibold hover:underline shrink-0"
                        >
                          Kiểm tra →
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {metrics.overloadedRooms.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-wn">
                    4. Phòng vượt định mức giường ({metrics.overloadedRooms.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                    {metrics.overloadedRooms.map((r, idx) => (
                      <div key={idx} className="rounded-lg border border-wn/40 bg-act/60 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-bold text-tx">
                            {r.ktx} · {r.day} · {formatRoomDisplay(r.room)}
                          </div>
                          <div className="text-[11px] text-wn font-semibold font-tabular">
                            {r.count}/{r.capacity} người
                          </div>
                        </div>
                        {onSelectRoom ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowHealthModal(false);
                              onSelectRoom(r.ktx, r.day, r.room);
                            }}
                            className="text-lnk font-semibold hover:underline shrink-0 cursor-pointer"
                          >
                            Xem phòng →
                          </button>
                        ) : (
                          <Link
                            href={`/bed-management?ktx=${encodeURIComponent(r.ktx)}&day=${encodeURIComponent(r.day)}&room=${encodeURIComponent(r.room)}`}
                            className="text-lnk font-semibold hover:underline shrink-0"
                          >
                            Xem giường →
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 sm:p-4 border-t border-bdr bg-act/50 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAutoReconcile}
                disabled={reconciling}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-pri hover:opacity-90 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
              >
                {reconciling ? <RefreshCw size={13} className="animate-spin" /> : <BedDouble size={13} />}
                <span>{reconciling ? 'Đang đồng bộ...' : 'Tự động đồng bộ giường & dọn lệch'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowHealthModal(false)}
                className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-bold text-tx hover:bg-surf cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}