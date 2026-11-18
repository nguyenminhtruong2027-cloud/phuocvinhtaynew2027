'use client';
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ShieldAlert, FileWarning, Users, X, ArrowRight, CheckCircle2, Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { getProfileStatus, Worker } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';
import { normalizeGender } from '@/lib/roomGender';
import { formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
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
  const { workers } = useWorkers();
  const [showConflictModal, setShowConflictModal] = useState(false);

  const scopedWorkers = useMemo(() => {
    const list = Array.isArray(workers) ? workers : [];
    const active = list.filter(
      w =>
        !w?.ngayRaKTX &&
        !w?.ghiChu?.includes('[Đã Check-out') &&
        !w?.ghiChu?.includes('[CHECKOUT]')
    );
    if (!selectedKtx || selectedKtx === 'all') return active;
    return active.filter(w => (w?.ktx || '').trim() === selectedKtx.trim());
  }, [workers, selectedKtx]);

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
      { ktx: string; day: string; room: string; maleCount: number; femaleCount: number }
    >();

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
          });
        }
        const bucket = roomBuckets.get(key)!;
        const g = normalizeGender(w.gioiTinh);
        if (g === 'nam') bucket.maleCount++;
        else if (g === 'nu') bucket.femaleCount++;
      }
    }

    const genderConflicts: GenderConflictRoom[] = [];
    roomBuckets.forEach((b) => {
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
    };
  }, [scopedWorkers, roomGenderMap]);

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
    metrics.noRoom > 0;

  if (!hasAnyAlert || scopedWorkers.length === 0) {
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
                Phát hiện nhanh tạm trú quá hạn, phòng lệch giới tính và hồ sơ công nhân còn thiếu thông tin.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {metrics.unregisteredTamTru > 0 && (
              <Link
                href={`/worker-management?tamTru=unregistered${selectedKtx !== 'all' ? `&ktx=${encodeURIComponent(selectedKtx)}` : ''}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl tint-wn border border-wn text-wn text-xs font-bold hover:opacity-90 transition-opacity"
              >
                <FileWarning size={13} />
                <span>
                  {metrics.unregisteredTamTru.toLocaleString('vi-VN')} chưa ĐK tạm trú
                  {metrics.overdueTamTru > 0 ? ` (${metrics.overdueTamTru.toLocaleString('vi-VN')} quá 7 ngày)` : ''}
                </span>
              </Link>
            )}

            {metrics.genderConflicts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConflictModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl tint-dgr border border-dgr text-dgr text-xs font-bold hover:opacity-90 transition-opacity"
              >
                <Users size={13} />
                <span>{metrics.genderConflicts.length} phòng lệch / hỗn hợp giới tính</span>
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
              onClick={handleExportAlerts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-okbg border border-bdr2 text-ok text-xs font-bold hover:opacity-90 transition-opacity"
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
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
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
    </>
  );
}