'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Phone,
  CreditCard,
  Building2,
  Eye,
  X,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Download,
  Printer,
  Trash2,
  AlertTriangle,
  Search,
  Filter,
  User,
  Home,
  Check,
  Inbox,
  Sparkles,
  Copy,
  FileSpreadsheet,
  Calendar,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { toast } from 'sonner';
import { syncBedForWorkerSave, normalizeBedLabel } from '@/lib/bedSync';
import {
  buildRoomKey,
  extractRoomNumber,
  FacilityItem,
  fetchFacilitiesList,
  invalidateFacilitiesCache,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { loadSavedRoomGenderMap, normalizeGender } from '@/lib/roomGender';
import { QrCodeImage, downloadQrPng } from '@/components/QrCodeImage';
import { printQrBulletinPoster, PosterPaperSize } from '@/lib/qrPosterPrint';
import { exportToExcel } from '@/lib/exportExcel';
import { getVNDateString } from '@/lib/vnDate';
import { fetchBlacklist, matchBlacklistInMemory, type BlacklistRecord } from '@/lib/disciplineService';
import {
  buildWorkerHierarchyFromWorkers,
  fetchRoomBedAvailability,
  invalidateWorkerHierarchyCache,
  WorkerHierarchyData,
  RoomBedAvailability,
  WorkerRef,
  checkDuplicateWorker,
} from '@/lib/workerHierarchy';
import {
  useKtxStructure,
  invalidateKtxStructureCache,
  normalizeKtxLabel,
  normalizeDayLabel,
} from '@/lib/ktxStructure';
import {
  hardDeleteWorkerRegistration,
  fetchAuthoritativeDeletedRegistrationTombstones,
  isRegistrationTombstoned,
} from '@/lib/workerDeletionIntegrity';
import { Worker } from '@/data/workers';
import { suggestOptimalRooms } from '@/lib/smartRoomAssign';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toValidWorkerUuid(candidate?: string | null): string {
  const cleaned = (candidate || '').trim();
  if (UUID_REGEX.test(cleaned)) return cleaned;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface WorkerRegistration {
  id: string;
  ho_va_ten: string;
  ma_nv: string;
  so_cccd: string;
  so_dien_thoai: string;
  ngay_sinh: string;
  que_quan: string;
  gioi_tinh: string;
  don_vi: string;
  tieu_doan: string;
  to_truong: string;
  sdt_to_truong: string;
  ho_khau_tinh: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  ngay_vao_ktx: string;
  cccd_image_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  ghi_chu: string;
  created_at: string;
}

const STATUS_CONFIG = {
  pending: {
    label: 'Chờ duyệt',
    badgeCls: 'tint-wn text-wn border border-wn/30',
    icon: <Clock size={12} />,
  },
  approved: {
    label: 'Đã duyệt',
    badgeCls: 'bg-okbg text-ok border border-bdr2',
    icon: <CheckCircle2 size={12} />,
  },
  rejected: {
    label: 'Từ chối',
    badgeCls: 'bg-dgrbg text-dgr border border-dgr/30',
    icon: <XCircle size={12} />,
  },
};

const inputCls =
  'w-full px-2.5 py-1.5 text-xs sm:text-sm border border-bdr rounded bg-surf text-tx focus:outline-none focus:border-wn';
const labelCls = 'text-xs text-mu mb-1 block font-medium';

/**
 * Khung Chi Tiết Hồ Sơ Đăng Ký (Console style)
 */
function DetailModal({
  reg,
  onClose,
  onApprove,
  onReject,
  processing,
  hierarchy,
  workers,
  facilities,
}: {
  reg: WorkerRegistration;
  onClose: () => void;
  onApprove: (updatedReg: WorkerRegistration, tamTruStatus: 'registered' | 'unregistered') => void;
  onReject: (id: string) => void;
  processing: string | null;
  hierarchy: WorkerHierarchyData;
  workers: Worker[];
  facilities: FacilityItem[];
}) {
  const isProcessing = processing === reg.id;
  const cfg = STATUS_CONFIG[reg.status];
  const isPending = reg.status === 'pending';
  const [markTamTruRegistered, setMarkTamTruRegistered] = useState(false);

  const [editForm, setEditForm] = useState({
    ho_va_ten: reg.ho_va_ten || '',
    ma_nv: reg.ma_nv || '',
    so_cccd: reg.so_cccd || '',
    so_dien_thoai: reg.so_dien_thoai || '',
    ngay_sinh: reg.ngay_sinh || '',
    gioi_tinh: reg.gioi_tinh || 'Nam',
    ho_khau_tinh: reg.ho_khau_tinh || reg.que_quan || '',
    don_vi: reg.don_vi || '',
    tieu_doan: reg.tieu_doan || '',
    to_truong: reg.to_truong || '',
    sdt_to_truong: reg.sdt_to_truong || '',
    ktx: reg.ktx || hierarchy.ktxList[0] || '',
    day: reg.day || '',
    phong_so: reg.phong_so || '',
    giuong: reg.giuong || '',
    ngay_vao_ktx: reg.ngay_vao_ktx || '',
    ghi_chu: reg.ghi_chu || '',
  });

  const [isCustomUnit, setIsCustomUnit] = useState(
    Boolean(reg.don_vi && !hierarchy.units.includes(reg.don_vi))
  );
  const [customUnit, setCustomUnit] = useState(
    reg.don_vi && !hierarchy.units.includes(reg.don_vi) ? reg.don_vi : ''
  );

  const { isAdmin, canWriteBlock } = useAuth();
  const { ktxGroups } = useKtxStructure();
  const autoPickFirstBedRef = React.useRef(false);

  const availableKtx = useMemo(() => {
    const set = new Set<string>(hierarchy.ktxList);
    ktxGroups.forEach(g => { if (g.ktx) set.add(g.ktx); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
  }, [hierarchy.ktxList, ktxGroups]);

  const availableDays = useMemo(() => {
    if (!editForm.ktx) return [];
    const set = new Set<string>(hierarchy.daysByKtx[editForm.ktx] || []);
    const group = ktxGroups.find(g => g.ktx === editForm.ktx);
    group?.days.forEach(d => set.add(d));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
  }, [hierarchy.daysByKtx, ktxGroups, editForm.ktx]);

  const availableRooms = useMemo(() => {
    if (!editForm.ktx || !editForm.day) return [];
    return hierarchy.roomsByKtxDay[`${editForm.ktx}__${editForm.day}`] || [];
  }, [hierarchy.roomsByKtxDay, editForm.ktx, editForm.day]);

  const [bedAvail, setBedAvail] = useState<RoomBedAvailability | null>(null);
  const [loadingBeds, setLoadingBeds] = useState(false);

  useEffect(() => {
    if (!isPending || !editForm.ktx || !editForm.day || !editForm.phong_so) {
      setBedAvail(null);
      return;
    }
    let active = true;
    setLoadingBeds(true);
    fetchRoomBedAvailability(editForm.ktx, editForm.day, editForm.phong_so, hierarchy)
      .then(res => {
        if (!active) return;
        setBedAvail(res);
        if (autoPickFirstBedRef.current) {
          autoPickFirstBedRef.current = false;
          if (res.emptyBeds.length > 0) {
            setEditForm(prev => ({ ...prev, giuong: res.emptyBeds[0] }));
          }
        }
      })
      .catch(() => { if (active) setBedAvail(null); })
      .finally(() => { if (active) setLoadingBeds(false); });
    return () => { active = false; };
  }, [isPending, editForm.ktx, editForm.day, editForm.phong_so, hierarchy]);

  useEffect(() => {
    if (isPending && !editForm.day && availableDays.length > 0) {
      const nextDay = availableDays[0];
      const nextRooms = hierarchy.roomsByKtxDay[`${editForm.ktx}__${nextDay}`] || [];
      setEditForm(prev => ({
        ...prev,
        day: nextDay,
        phong_so: prev.phong_so || nextRooms[0] || '',
      }));
    }
  }, [editForm.ktx, editForm.day, availableDays, hierarchy.roomsByKtxDay, isPending]);

  const handleKtxChange = (newKtx: string) => {
    const daySet = new Set<string>(hierarchy.daysByKtx[newKtx] || []);
    ktxGroups.find(g => g.ktx === newKtx)?.days.forEach(d => daySet.add(d));
    const days = Array.from(daySet).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
    const nextDay = days.includes(editForm.day) ? editForm.day : (days[0] || '');
    const rooms = hierarchy.roomsByKtxDay[`${newKtx}__${nextDay}`] || [];
    const nextRoom = rooms.includes(editForm.phong_so) ? editForm.phong_so : (rooms[0] || '');
    setEditForm(prev => ({
      ...prev,
      ktx: newKtx,
      day: nextDay,
      phong_so: nextRoom,
      giuong: '',
    }));
  };

  const handleDayChange = (newDay: string) => {
    const rooms = hierarchy.roomsByKtxDay[`${editForm.ktx}__${newDay}`] || [];
    const nextRoom = rooms.includes(editForm.phong_so) ? editForm.phong_so : (rooms[0] || '');
    setEditForm(prev => ({
      ...prev,
      day: newDay,
      phong_so: nextRoom,
      giuong: '',
    }));
  };

  const handleUnitSelect = (val: string) => {
    if (val === '__other__') {
      setIsCustomUnit(true);
      setEditForm(prev => ({ ...prev, don_vi: customUnit }));
    } else {
      setIsCustomUnit(false);
      setEditForm(prev => ({ ...prev, don_vi: val }));
    }
  };

  const handleCustomUnitChange = (val: string) => {
    setCustomUnit(val);
    setEditForm(prev => ({ ...prev, don_vi: val }));
  };

  const [blacklistRecords, setBlacklistRecords] = useState<BlacklistRecord[]>([]);
  const [adminOverrideBlacklist, setAdminOverrideBlacklist] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBlacklist()
      .then(res => {
        if (active && !res.tableMissing) setBlacklistRecords(res.data);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const blacklistHit = useMemo(() => {
    const res = matchBlacklistInMemory(blacklistRecords, editForm.so_cccd, editForm.ma_nv);
    return res.isBanned ? (res.matchedRecord ?? null) : null;
  }, [blacklistRecords, editForm.so_cccd, editForm.ma_nv]);

  useEffect(() => {
    setAdminOverrideBlacklist(false);
  }, [editForm.so_cccd, editForm.ma_nv]);

  const dupMatch = useMemo(() => {
    return checkDuplicateWorker(hierarchy.workers, editForm.so_cccd, editForm.so_dien_thoai);
  }, [hierarchy.workers, editForm.so_cccd, editForm.so_dien_thoai]);

  const savedGenderMap = useMemo(() => loadSavedRoomGenderMap(), []);

  const roomGenderWarning = useMemo(() => {
    if (!editForm.ktx || !editForm.day || !editForm.phong_so) return null;
    const applicantG = normalizeGender(editForm.gioi_tinh);
    if (applicantG === 'other') return null;

    const normRoom = normalizeRoomLabel(editForm.phong_so);
    const exactKey = `${editForm.ktx.trim()}||${editForm.day.trim()}||${editForm.phong_so.trim()}`;
    const normKey = `${editForm.ktx.trim()}||${editForm.day.trim()}||${normRoom}`;
    const adminLabel = savedGenderMap[exactKey] ?? savedGenderMap[normKey];

    if (adminLabel === 'male' && applicantG === 'nu') {
      return 'Phòng được gắn nhãn Phòng Nam nhưng công nhân khai báo giới tính Nữ.';
    }
    if (adminLabel === 'female' && applicantG === 'nam') {
      return 'Phòng được gắn nhãn Phòng Nữ nhưng công nhân khai báo giới tính Nam.';
    }

    const occupants = hierarchy.workers.filter(
      w =>
        w.ktx.trim() === editForm.ktx.trim() &&
        w.day.trim() === editForm.day.trim() &&
        normalizeRoomLabel(w.phongSo) === normRoom
    );
    const hasMale = occupants.some(w => normalizeGender(w.gioiTinh) === 'nam');
    const hasFemale = occupants.some(w => normalizeGender(w.gioiTinh) === 'nu');

    if (applicantG === 'nam' && hasFemale) {
      return `Phòng ${editForm.phong_so} hiện đang có công nhân Nữ lưu trú. Cân nhắc chọn phòng Nam hoặc phòng trống.`;
    }
    if (applicantG === 'nu' && hasMale) {
      return `Phòng ${editForm.phong_so} hiện đang có công nhân Nam lưu trú. Cân nhắc chọn phòng Nữ hoặc phòng trống.`;
    }
    return null;
  }, [editForm.ktx, editForm.day, editForm.phong_so, editForm.gioi_tinh, savedGenderMap, hierarchy.workers]);

  const smartRoomSuggestions = useMemo(() => {
    if (!isPending) return [];
    const targetUnit = (isCustomUnit ? customUnit : editForm.don_vi).trim();
    const allowedDays = !isAdmin
      ? availableDays.filter(d => canWriteBlock(d, editForm.ktx))
      : undefined;

    return suggestOptimalRooms(
      {
        gioiTinh: editForm.gioi_tinh,
        donVi: targetUnit,
        tieuDoan: editForm.tieu_doan,
        ktx: editForm.ktx || undefined,
      },
      workers,
      facilities,
      savedGenderMap,
      {
        preferPhase1: true,
        allowedDays,
        limit: 4,
      }
    );
  }, [
    isPending,
    editForm.gioi_tinh,
    editForm.don_vi,
    editForm.tieu_doan,
    editForm.ktx,
    isCustomUnit,
    customUnit,
    workers,
    facilities,
    savedGenderMap,
    isAdmin,
    availableDays,
    canWriteBlock,
  ]);

  const selectedBedError = useMemo(() => {
    if (!isPending || loadingBeds || !bedAvail) return null;
    const normBed = normalizeBedLabel(editForm.giuong);
    if (!normBed) return null;
    const match = bedAvail.allBeds.find(b => normalizeBedLabel(b.giuong) === normBed);
    if (!match) return null;
    if (match.status === 'maintenance') {
      return `Giường ${editForm.giuong.trim()} đang bảo trì, không thể xếp công nhân.`;
    }
    if (match.status === 'occupied') {
      return `Giường ${editForm.giuong.trim()} đã có công nhân đang ở. Vui lòng chọn giường trống.`;
    }
    return null;
  }, [isPending, loadingBeds, bedAvail, editForm.giuong]);

  const handleApproveSubmit = () => {
    const finalUnit = isCustomUnit ? customUnit.trim() : editForm.don_vi.trim();
    onApprove(
      {
        ...reg,
        ...editForm,
        don_vi: finalUnit,
        que_quan: editForm.ho_khau_tinh,
      },
      markTamTruRegistered ? 'registered' : 'unregistered'
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim fade-in p-4">
      <div className="modal-enter bg-surf border border-bdr rounded-md w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Navy Header */}
        <div className="flex items-center justify-between p-4 bg-side text-tx border-b border-bdr">
          <div>
            <h3 className="font-bold text-sm tracking-wide">
              {isPending ? 'CHỈNH SỬA & DUYỆT HỒ SƠ ĐĂNG KÝ' : 'CHI TIẾT HỒ SƠ ĐĂNG KÝ'}
            </h3>
            <p className="text-xs text-mu mt-0.5 font-normal">
              Mã hồ sơ: <span className="font-mono text-wn">{reg.id}</span> · Đăng ký lúc: {new Date(reg.created_at).toLocaleString('vi-VN')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-act text-mu hover:text-tx cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-bdr">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${cfg.badgeCls}`}>
              {cfg.icon} {cfg.label}
            </div>
            {isPending && (
              <span className="text-xs text-mu">
                * Người duyệt có thể trực tiếp sửa thông tin trước khi duyệt
              </span>
            )}
          </div>

          {/* CẢNH BÁO AN NINH: DANH SÁCH ĐEN (BLACKLIST GUARD) */}
          {blacklistHit && (
            <div className="p-3.5 rounded-xl tint-dgr border border-dgr text-xs space-y-2">
              <div className="flex items-start gap-2">
                <ShieldAlert size={16} className="text-dgr shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="font-extrabold text-dgr uppercase tracking-wide">
                    CẢNH BÁO AN NINH — CÔNG NHÂN THUỘC DANH SÁCH ĐEN (BLACKLIST)
                  </p>
                  <p className="text-tx font-semibold">
                    {blacklistHit.ho_va_ten} · CCCD: <span className="font-mono">{blacklistHit.cccd}</span>
                    {blacklistHit.ma_nv ? ` · Mã NV: ${blacklistHit.ma_nv}` : ''}
                  </p>
                  <p className="text-dgr font-medium">
                    Lý do cấm: {blacklistHit.reason}
                  </p>
                  <p className="text-[11px] text-mu">
                    Ban hành bởi {blacklistHit.banned_by} · Khuyến nghị từ chối hồ sơ này.
                  </p>
                </div>
              </div>
              {isPending && isAdmin && (
                <label className="flex items-center gap-2 pt-2 border-t border-dgr/30 cursor-pointer select-none text-tx font-semibold">
                  <input
                    type="checkbox"
                    checked={adminOverrideBlacklist}
                    onChange={e => setAdminOverrideBlacklist(e.target.checked)}
                    className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                  />
                  <span>Tôi là Quản trị viên và xác nhận ngoại lệ duyệt lại hồ sơ thuộc Danh sách Đen này</span>
                </label>
              )}
              {isPending && !isAdmin && (
                <p className="pt-1.5 border-t border-dgr/30 text-[11px] font-bold text-dgr">
                  Chuyên viên không được phép duyệt hồ sơ thuộc Danh sách Đen. Vui lòng từ chối hoặc báo cáo Quản trị viên.
                </p>
              )}
            </div>
          )}

          {/* Cảnh báo trùng hồ sơ */}
          {dupMatch && (
            <div className="p-3 tint-wn border border-wn/50 rounded-lg text-xs text-wn space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-dgr">
                <AlertTriangle size={14} />
                <span>Cảnh báo: Có thể trùng với hồ sơ công nhân đã có trong hệ thống</span>
              </div>
              <p className="font-semibold text-tx">
                {dupMatch.worker.hoVaTen} — Mã NV [{dupMatch.worker.maNV || 'Chưa có'}]
              </p>
              <p className="text-[11px] text-mu">
                Vị trí hiện tại: {dupMatch.worker.ktx} · {dupMatch.worker.day} · P.{extractRoomNumber(dupMatch.worker.phongSo) || dupMatch.worker.phongSo} · Khớp theo {dupMatch.field}: <span className="font-mono font-bold text-dgr">{dupMatch.matchedValue}</span>
              </p>
            </div>
          )}

          {isPending ? (
            <div className="space-y-4">
              <div className="text-xs font-bold text-tx uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-bdr">
                <User size={13} className="text-wn" /> 1. Thông tin công nhân
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Họ và tên <span className="text-dgr">*</span></label>
                  <input
                    type="text"
                    value={editForm.ho_va_ten}
                    onChange={e => setEditForm(prev => ({ ...prev, ho_va_ten: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Mã nhân viên</label>
                  <input
                    type="text"
                    value={editForm.ma_nv}
                    onChange={e => setEditForm(prev => ({ ...prev, ma_nv: e.target.value }))}
                    placeholder="VD: NV001"
                    className={`${inputCls} font-mono`}
                  />
                </div>

                <div>
                  <label className={labelCls}>Số CCCD <span className="text-dgr">*</span></label>
                  <input
                    type="text"
                    value={editForm.so_cccd}
                    onChange={e => setEditForm(prev => ({ ...prev, so_cccd: e.target.value }))}
                    className={`${inputCls} font-mono`}
                  />
                </div>

                <div>
                  <label className={labelCls}>Số điện thoại <span className="text-dgr">*</span></label>
                  <input
                    type="tel"
                    value={editForm.so_dien_thoai}
                    onChange={e => setEditForm(prev => ({ ...prev, so_dien_thoai: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Ngày sinh (DD/MM/YYYY) <span className="text-dgr">*</span></label>
                  <input
                    type="text"
                    value={editForm.ngay_sinh}
                    onChange={e => setEditForm(prev => ({ ...prev, ngay_sinh: e.target.value }))}
                    placeholder="DD/MM/YYYY"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Giới tính</label>
                  <select
                    value={editForm.gioi_tinh}
                    onChange={e => setEditForm(prev => ({ ...prev, gioi_tinh: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className={labelCls}>Hộ khẩu thường trú / Tỉnh TP</label>
                  <input
                    type="text"
                    value={editForm.ho_khau_tinh}
                    onChange={e => setEditForm(prev => ({ ...prev, ho_khau_tinh: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Đơn vị / Nhà thầu</label>
                  <select
                    value={isCustomUnit ? '__other__' : editForm.don_vi}
                    onChange={e => handleUnitSelect(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">-- Chọn đơn vị --</option>
                    {hierarchy.units.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                    <option value="__other__">Khác (tự nhập)...</option>
                  </select>
                  {isCustomUnit && (
                    <input
                      type="text"
                      value={customUnit}
                      onChange={e => handleCustomUnitChange(e.target.value)}
                      placeholder="Nhập tên đơn vị khác..."
                      className={`${inputCls} mt-1.5`}
                      autoFocus
                    />
                  )}
                </div>

                <div>
                  <label className={labelCls}>Tiểu đoàn / Trung đoàn</label>
                  <input
                    type="text"
                    value={editForm.tieu_doan}
                    onChange={e => setEditForm(prev => ({ ...prev, tieu_doan: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Họ tên Tổ trưởng</label>
                  <input
                    type="text"
                    value={editForm.to_truong}
                    onChange={e => setEditForm(prev => ({ ...prev, to_truong: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>SĐT Tổ trưởng</label>
                  <input
                    type="tel"
                    value={editForm.sdt_to_truong}
                    onChange={e => setEditForm(prev => ({ ...prev, sdt_to_truong: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Vị trí lưu trú (Dropdown liên kết theo tầng từ dữ liệu công nhân) */}
              <div className="text-xs font-bold text-tx uppercase tracking-wider flex items-center gap-1.5 pt-2 pb-1 border-b border-bdr">
                <Home size={13} className="text-wn" /> 2. Vị trí phòng lưu trú (Liên kết từ dữ liệu công nhân)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Khu KTX <span className="text-dgr">*</span></label>
                  <select
                    value={editForm.ktx}
                    onChange={e => handleKtxChange(e.target.value)}
                    className={inputCls}
                  >
                    {availableKtx.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                    {!availableKtx.includes(editForm.ktx) && editForm.ktx && (
                      <option value={editForm.ktx}>{editForm.ktx} (Khai báo)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Dãy nhà <span className="text-dgr">*</span></label>
                  <select
                    value={editForm.day}
                    onChange={e => handleDayChange(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">-- Chọn Dãy --</option>
                    {availableDays.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                    {!availableDays.includes(editForm.day) && editForm.day && (
                      <option value={editForm.day}>{editForm.day} (Khai báo)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Phòng số <span className="text-dgr">*</span></label>
                  <select
                    value={editForm.phong_so}
                    onChange={e => setEditForm(prev => ({ ...prev, phong_so: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">-- Chọn Phòng --</option>
                    {availableRooms.map(p => (
                      <option key={p} value={p}>Phòng {p}</option>
                    ))}
                    {!availableRooms.includes(editForm.phong_so) && editForm.phong_so && (
                      <option value={editForm.phong_so}>Phòng {editForm.phong_so} (Khai báo)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Số giường</label>
                  <input
                    type="text"
                    value={editForm.giuong}
                    onChange={e => setEditForm(prev => ({ ...prev, giuong: e.target.value }))}
                    placeholder="VD: 1, 2..."
                    className={inputCls}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className={labelCls}>Ngày vào KTX</label>
                  <input
                    type="text"
                    value={editForm.ngay_vao_ktx}
                    onChange={e => setEditForm(prev => ({ ...prev, ngay_vao_ktx: e.target.value }))}
                    placeholder="VD: 01/10/2026"
                    className={inputCls}
                  />
                </div>
              </div>

              {smartRoomSuggestions.length > 0 && (
                <div className="rounded bg-page border border-bdr p-2.5 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 font-semibold text-lnk">
                      <Sparkles size={13} />
                      <span>Gợi ý phòng tối ưu ({editForm.gioi_tinh || 'phù hợp'} · GĐ 1 ưu tiên)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const top = smartRoomSuggestions[0];
                        if (!top) return;
                        autoPickFirstBedRef.current = true;
                        setEditForm(prev => ({
                          ...prev,
                          ktx: top.ktx,
                          day: top.day,
                          phong_so: top.room,
                          giuong: top.firstFreeBed,
                        }));
                        toast.success(`Đã chọn ${top.day} · P.${top.room} · Giường ${top.firstFreeBed}`);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-pri hover:opacity-95 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                    >
                      <Sparkles size={11} />
                      <span>Chọn phòng tối ưu nhất</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {smartRoomSuggestions.map((s, idx) => (
                      <button
                        key={`${s.ktx}-${s.day}-${s.room}-${idx}`}
                        type="button"
                        onClick={() => {
                          autoPickFirstBedRef.current = true;
                          setEditForm(prev => ({
                            ...prev,
                            ktx: s.ktx,
                            day: s.day,
                            phong_so: s.room,
                            giuong: s.firstFreeBed,
                          }));
                        }}
                        className="px-2.5 py-1.5 rounded border border-bdr bg-surf hover:border-lnk hover:bg-bdg/40 text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-tx">
                            {s.day} · P.{s.room} · G.{s.firstFreeBed}
                          </span>
                          <span className="text-[10px] font-mono tabular-nums text-ok font-bold">
                            Trống {s.availableSlots}/{s.capacity}
                          </span>
                        </div>
                        {s.reasons.length > 0 && (
                          <div className="text-[10px] text-mu truncate mt-0.5">
                            {s.reasons.slice(0, 3).join(' · ')}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {roomGenderWarning && (
                <div className="p-2.5 rounded border border-dgr/40 bg-dgrbg text-dgr text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{roomGenderWarning}</span>
                </div>
              )}

              {selectedBedError && (
                <div className="p-2.5 rounded border border-dgr/50 bg-dgrbg text-dgr text-xs font-semibold flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{selectedBedError}</span>
                </div>
              )}

              {editForm.ktx && editForm.day && editForm.phong_so && (loadingBeds || (bedAvail && bedAvail.capacity > 0)) && (
                <div className="rounded bg-page border border-bdr p-2.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-mu font-medium">
                      Giường trống Phòng {editForm.phong_so}:
                    </span>
                    {loadingBeds ? (
                      <span className="text-mu">Đang tải...</span>
                    ) : bedAvail && bedAvail.emptyBeds.length > 0 ? (
                      <span className="text-ok font-semibold">
                        Còn {bedAvail.emptyBeds.length}/{bedAvail.capacity} giường trống
                      </span>
                    ) : (
                      <span className="text-dgr font-semibold">
                        Đã kín ({bedAvail?.occupiedCount}/{bedAvail?.capacity})
                      </span>
                    )}
                  </div>
                  {!loadingBeds && bedAvail && editForm.giuong.trim() && bedAvail.occupiedBeds.includes(normalizeBedLabel(editForm.giuong.trim())) && (
                    <p className="text-[11px] text-wn font-medium">
                      Lưu ý: Giường {editForm.giuong.trim()} hiện đang có công nhân ở. Nên chọn giường trống bên dưới.
                    </p>
                  )}
                  {!loadingBeds && bedAvail && bedAvail.emptyBeds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {bedAvail.emptyBeds.slice(0, 14).map(b => {
                        const selected = normalizeBedLabel(editForm.giuong) === normalizeBedLabel(b);
                        return (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setEditForm(prev => ({ ...prev, giuong: b }))}
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border transition-colors cursor-pointer ${
                              selected
                                ? 'bg-wn text-wn-fg border-wn'
                                : 'bg-surf text-tx border-bdr hover:border-wn'
                            }`}
                          >
                            G.{b}
                          </button>
                        );
                      })}
                      {bedAvail.emptyBeds.length > 14 && (
                        <span className="text-[11px] text-mu self-center">+{bedAvail.emptyBeds.length - 14}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className={labelCls}>Ghi chú</label>
                <textarea
                  value={editForm.ghi_chu}
                  onChange={e => setEditForm(prev => ({ ...prev, ghi_chu: e.target.value }))}
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-xs bg-page p-3.5 rounded border border-bdr">
              <div className="col-span-2">
                <span className="text-ic block">Họ và tên</span>
                <p className="font-bold text-sm text-tx mt-0.5">{reg.ho_va_ten}</p>
              </div>
              <div>
                <span className="text-ic block">Mã nhân viên</span>
                <p className="font-mono font-semibold mt-0.5">{reg.ma_nv || '—'}</p>
              </div>
              <div>
                <span className="text-ic block">Số CCCD</span>
                <p className="font-mono font-semibold mt-0.5">{reg.so_cccd}</p>
              </div>
              <div>
                <span className="text-ic block">Số điện thoại</span>
                <p className="font-semibold mt-0.5">{reg.so_dien_thoai}</p>
              </div>
              <div>
                <span className="text-ic block">Đơn vị</span>
                <p className="font-semibold mt-0.5">{reg.don_vi || '—'}</p>
              </div>
              <div className="col-span-2 pt-2 border-t border-bdr">
                <span className="text-ic block">Vị trí phòng ở</span>
                <p className="font-bold mt-0.5">
                  {reg.ktx} — {reg.day} — Phòng {reg.phong_so} {reg.giuong ? `(G.${reg.giuong})` : ''}
                </p>
              </div>
            </div>
          )}

          {reg.cccd_image_url && (
            <div>
              <span className="text-xs text-ic block mb-1">Ảnh chụp CCCD</span>
              <img
                src={reg.cccd_image_url}
                alt={`Ảnh CCCD của ${reg.ho_va_ten}`}
                className="w-full rounded border border-bdr object-cover max-h-48"
              />
            </div>
          )}

          {isPending && (
            <div className="space-y-3 pt-3 border-t border-bdr">
              <label className="flex items-center gap-2 text-xs text-tx cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={markTamTruRegistered}
                  onChange={e => setMarkTamTruRegistered(e.target.checked)}
                  className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                />
                <span>
                  Đánh dấu <strong className="text-ok">Đã đăng ký tạm trú</strong> ngay khi duyệt (mặc định: <em>Chưa đăng ký</em>)
                </span>
              </label>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => onReject(reg.id)}
                  disabled={isProcessing}
                  className="flex-1 py-2 px-3 border border-dgr text-dgr hover:bg-dgrbg rounded text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer text-center"
                >
                  {isProcessing ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <XCircle size={13} className="inline mr-1" />}
                  Từ chối hồ sơ
                </button>
                <button
                  type="button"
                  onClick={handleApproveSubmit}
                  disabled={
                    isProcessing ||
                    Boolean(selectedBedError) ||
                    Boolean(blacklistHit && (!isAdmin || !adminOverrideBlacklist))
                  }
                  className="flex-1 py-2 px-3 bg-ok2 hover:opacity-90 text-ok2-fg rounded text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer text-center"
                >
                  {isProcessing ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <CheckCircle2 size={13} className="inline mr-1" />}
                  {blacklistHit && !isAdmin
                    ? 'Bị chặn bởi Danh sách Đen'
                    : 'Duyệt hồ sơ (Lưu bản chỉnh sửa)'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  name,
  onConfirm,
  onCancel,
  deleting,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim fade-in p-4">
      <div className="modal-enter bg-surf border border-bdr rounded-md w-full max-w-sm p-5 space-y-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-dgrbg text-dgr flex items-center justify-center shrink-0">
            <Trash2 size={16} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-tx">Xóa hồ sơ đăng ký</h3>
            <p className="text-xs text-mu">Thao tác không thể hoàn tác</p>
          </div>
        </div>
        <p className="text-xs text-tx">
          Bạn có chắc chắn muốn xóa hồ sơ của <strong>{name}</strong> khỏi hệ thống?
        </p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 py-1.5 border border-bdr rounded text-xs font-semibold hover:bg-act transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 py-1.5 bg-dgr hover:opacity-90 text-white rounded text-xs font-bold transition-colors cursor-pointer"
          >
            {deleting ? 'Đang xóa...' : 'Xác nhận xóa'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QRCodeDisplay({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [paperSize, setPaperSize] = useState<PosterPaperSize>('A4');

  const handleDownload = async () => {
    const ok = await downloadQrPng(url, 'qr-dang-ky-cu-tru.png', 640);
    if (!ok) toast.error('Không thể tạo file ảnh QR.');
    else toast.success('Đã tải ảnh QR đăng ký cư trú.');
  };

  const handleCopy = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Đã sao chép đường dẫn đăng ký.');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = async (size: PosterPaperSize = paperSize) => {
    const ok = await printQrBulletinPoster({
      url,
      paperSize: size,
      badgeText: 'Tiếp nhận công nhân mới',
      title: 'Đăng Ký Cư Trú Ký Túc Xá',
      subtitle:
        'Công nhân mới vào lưu trú vui lòng quét mã QR bên dưới để khai báo thông tin cá nhân, đơn vị công tác và vị trí phòng ở.',
      accentHex: '#1d4ed8',
      steps: [
        { title: 'Quét mã QR', detail: 'Dùng Camera điện thoại hoặc Zalo quét mã niêm yết tại cổng / văn phòng KTX.' },
        { title: 'Khai báo hồ sơ', detail: 'Điền đầy đủ Họ tên, CCCD, SĐT, đơn vị và phòng/giường dự kiến.' },
        { title: 'Chờ duyệt nhận phòng', detail: 'Ban quản lý đối chiếu và phê duyệt để đồng bộ sơ đồ giường.' },
      ],
      footerNote: 'Ban Quản Lý KTX Phước Vĩnh Tây · Vui lòng chuẩn bị sẵn CCCD khi làm thủ tục nhận phòng',
    });
    if (!ok) toast.error('Không thể tạo mẫu in Poster QR.');
  };

  return (
    <div className="bg-surf border border-bdr rounded-xl p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="shrink-0 flex flex-col items-center gap-2 w-40">
          <div className="p-2 border border-bdr bg-white rounded-lg">
            <QrCodeImage value={url} size={144} alt="QR Code đăng ký" className="w-36 h-36 object-contain" />
          </div>
          <div className="flex gap-1.5 w-full">
            <button
              type="button"
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-side border border-bdr hover:bg-act text-tx rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <Download size={12} /> Tải mã
            </button>
            <button
              type="button"
              onClick={() => handlePrint(paperSize)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-pri hover:opacity-90 text-white rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-opacity"
              title={`In Poster niêm yết khổ ${paperSize}`}
            >
              <Printer size={12} /> In {paperSize}
            </button>
          </div>
          <div className="inline-flex items-center w-full bg-page border border-bdr rounded-lg p-0.5 text-[11px]">
            {(['A4', 'A5'] as const).map(sz => (
              <button
                key={sz}
                type="button"
                onClick={() => setPaperSize(sz)}
                className={`flex-1 py-1 rounded font-semibold transition-colors cursor-pointer ${
                  paperSize === sz ? 'bg-surf text-tx border border-bdr' : 'text-mu hover:text-tx'
                }`}
              >
                Poster {sz}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-2.5 text-center sm:text-left w-full">
          <div>
            <p className="text-xs font-semibold text-wn">Mã tiếp nhận công nhân mới</p>
            <h3 className="font-bold text-base text-tx mt-0.5">Mã QR Đăng Ký Cư Trú Trực Tuyến</h3>
            <p className="text-xs text-mu mt-1 leading-relaxed">
              Niêm yết mẫu poster khổ A4 hoặc A5 tại cổng bảo vệ hoặc văn phòng KTX. Công nhân sử dụng Zalo hoặc camera điện thoại quét mã để khai báo họ tên, CCCD, phòng ở và đơn vị công tác.
            </p>
          </div>

          <div className="bg-page rounded-lg border border-bdr p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-mu">Đường dẫn đăng ký</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-wn hover:underline font-semibold cursor-pointer whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check size={12} className="text-ok" />
                    <span className="text-ok">Đã sao chép</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    <span>Sao chép link</span>
                  </>
                )}
              </button>
            </div>
            <code className="block text-xs text-tx font-mono bg-surf px-2.5 py-1.5 rounded border border-bdr break-all">
              {url}
            </code>
            <div className="pt-0.5">
              <a
                href="/register"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-wn hover:underline font-semibold"
              >
                <ExternalLink size={12} /> Mở trang đăng ký để kiểm tra giao diện
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1 text-xs text-mu">
            <span className="text-ok font-medium">Tiếp nhận trực tuyến 24/7</span>
            <span aria-hidden="true">·</span>
            <span>Tự động cảnh báo trùng CCCD/SĐT</span>
            <span aria-hidden="true">·</span>
            <span>Đồng bộ sơ đồ giường ngay khi duyệt</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QRPortalClient({
  onPendingCountChange,
}: {
  onPendingCountChange?: (count: number) => void;
} = {}) {
  const [registrations, setRegistrations] = useState<WorkerRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const [detailReg, setDetailReg] = useState<WorkerRegistration | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [registerUrl, setRegisterUrl] = useState('/register');
  const [deleteTarget, setDeleteTarget] = useState<WorkerRegistration | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bộ lọc theo KTX / Dãy / Phòng + Khoảng ngày
  const [selectedKtx, setSelectedKtx] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<string>('all');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);
  const [batchRejecting, setBatchRejecting] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const [facilities, setFacilities] = useState<FacilityItem[]>([]);

  const { currentUser, isAdmin, isSuperAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();
  const { workers, refreshWorkers } = useWorkers();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRegisterUrl(`${window.location.origin}/register`);
    }
    let active = true;
    fetchFacilitiesList()
      .then(rows => {
        if (active) setFacilities(rows);
      })
      .catch(err => {
        console.warn('QRPortalClient fetchFacilitiesList error:', err);
      });
    return () => { active = false; };
  }, []);

  const hierarchy: WorkerHierarchyData = useMemo(() => {
    const activeRefs: WorkerRef[] = workers
      .filter(
        w =>
          !w?.ngayRaKTX &&
          !w?.ghiChu?.includes('[Đã Check-out') &&
          !w?.ghiChu?.includes('[CHECKOUT]')
      )
      .map(w => ({
        hoVaTen: w.hoVaTen || '',
        maNV: w.maNV || '',
        cccd: w.cccd || '',
        soDienThoai: w.soDienThoai || '',
        ktx: w.ktx || '',
        day: w.day || '',
        phongSo: w.phongSo || '',
        donVi: w.donVi || '',
        giuong: w.giuong || '',
        gioiTinh: w.gioiTinh || '',
      }));
    return buildWorkerHierarchyFromWorkers(activeRefs, facilities);
  }, [workers, facilities]);

  const fetchRegistrations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [{ data, error }, tombstones] = await Promise.all([
        supabase
          .from('worker_registrations')
          .select('*')
          .or('ghi_chu.is.null,ghi_chu.not.like.[CHECKOUT]%')
          .order('created_at', { ascending: false }),
        fetchAuthoritativeDeletedRegistrationTombstones(supabase, 48),
      ]);
      if (!error) {
        const deduped = Array.from(
          new Map(
            (data || [])
              .filter(r => !isRegistrationTombstoned(r.id, r.created_at, tombstones))
              .map(r => [r.id, r])
          ).values()
        );
        setRegistrations(deduped);
      }
    } catch (e: any) {
      console.error('Fetch registrations error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fetchRegistrations(true), 400);
    };
    const channel = supabase
      .channel('worker_registrations_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_registrations' }, (payload: any) => {
        const note = String(payload?.new?.ghi_chu ?? payload?.old?.ghi_chu ?? '');
        const regType = String(payload?.new?.type ?? payload?.old?.type ?? '');
        if (note.startsWith('[CHECKOUT]') || regType === 'CHECKOUT') return;
        scheduleReload();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchRegistrations, supabase]);

  // Phân quyền Staff (Requirement 5)
  const scopedRegistrations = useMemo(() => {
    return registrations.filter(r => isAdmin || canWriteBlock(r.day, r.ktx));
  }, [registrations, isAdmin, canWriteBlock]);

  // Core single-registration approval helper (throws on conflict so single or batch caller can handle cleanly)
  const approveSingleRegistration = async (
    regToApprove: WorkerRegistration,
    tamTruStatus: 'registered' | 'unregistered' = 'unregistered',
    options?: { skipPostRefresh?: boolean; nextSttOverride?: number }
  ) => {
    const nowStr = new Date().toISOString();

    const ktxVal = normalizeKtxLabel(regToApprove.ktx || '');
    const dayVal = normalizeDayLabel(regToApprove.day || '');
    if (!isAdmin && !canWriteBlock(dayVal, ktxVal)) {
      throw new Error(`Bạn không có quyền duyệt công nhân vào ${ktxVal} - ${dayVal}.`);
    }

    let nextStt = options?.nextSttOverride ?? 1;
    if (options?.nextSttOverride === undefined) {
      try {
        const { data: maxRow } = await supabase
          .from('workers')
          .select('stt')
          .order('stt', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (maxRow && typeof maxRow.stt === 'number') {
          nextStt = maxRow.stt + 1;
        }
      } catch {}
    }

    const workerId = toValidWorkerUuid(regToApprove.id);
    const rawRoomVal = (regToApprove.phong_so || '').trim();
    const roomVal = extractRoomNumber(rawRoomVal) || rawRoomVal;
    const rawBedVal = (regToApprove.giuong || '').trim();
    const bedVal = normalizeBedLabel(rawBedVal) || rawBedVal;

      // 0a. Live DB duplicate guard against active workers (CCCD & Mã NV)
      const cleanCccd = (regToApprove.so_cccd || '').trim();
      if (cleanCccd.length >= 8) {
        const { data: dupCccdRows } = await supabase
          .from('workers')
          .select('id, ho_va_ten, ma_nv, ktx, day, phong_so, ngay_ra_ktx')
          .eq('cccd', cleanCccd)
          .limit(5);
        const activeDup = (dupCccdRows || []).find(
          (w: any) => w.id !== workerId && !(w.ngay_ra_ktx || '').trim()
        );
        if (activeDup) {
          throw new Error(
            `CCCD ${cleanCccd} đang thuộc về công nhân "${activeDup.ho_va_ten}" (${[activeDup.ktx, activeDup.day, activeDup.phong_so ? `P.${activeDup.phong_so}` : ''].filter(Boolean).join(' · ') || 'Chưa xếp phòng'}). Vui lòng kiểm tra tránh trùng hồ sơ.`
          );
        }
      }

      const cleanMaNv = (regToApprove.ma_nv || '').trim();
      const maNvLower = cleanMaNv.toLowerCase();
      if (cleanMaNv && cleanMaNv !== '-' && maNvLower !== 'chờ mã' && maNvLower !== 'cho ma') {
        const { data: dupMaRows } = await supabase
          .from('workers')
          .select('id, ho_va_ten, ma_nv, ktx, day, phong_so, ngay_ra_ktx')
          .eq('ma_nv', cleanMaNv)
          .limit(5);
        const activeDup = (dupMaRows || []).find(
          (w: any) => w.id !== workerId && !(w.ngay_ra_ktx || '').trim()
        );
        if (activeDup) {
          throw new Error(
            `Mã NV "${cleanMaNv}" đang thuộc về công nhân "${activeDup.ho_va_ten}" (${[activeDup.ktx, activeDup.day, activeDup.phong_so ? `P.${activeDup.phong_so}` : ''].filter(Boolean).join(' · ') || 'Chưa xếp phòng'}).`
          );
        }
      }

      // 0b. Live DB bed conflict guard (prevent concurrent overwrite or assigning to maintenance bed)
      if (ktxVal && dayVal && roomVal && bedVal) {
        const { data: roomBeds } = await supabase
          .from('beds')
          .select('id, phong_so, giuong, status, worker_id, ho_va_ten')
          .eq('ktx', ktxVal)
          .eq('day', dayVal);
        const normTargetRoom = normalizeRoomLabel(roomVal);
        const normTargetBed = normalizeBedLabel(bedVal);
        const matchedBed = (roomBeds || []).find(
          (b: any) =>
            normalizeRoomLabel(b.phong_so || '') === normTargetRoom &&
            normalizeBedLabel(b.giuong || '') === normTargetBed
        );
        if (matchedBed) {
          if (matchedBed.status === 'maintenance') {
            throw new Error(
              `Giường ${bedVal} tại ${ktxVal} · ${dayVal} · Phòng ${roomVal} đang bảo trì, không thể xếp chỗ.`
            );
          }
          if (matchedBed.status === 'occupied' && matchedBed.worker_id && matchedBed.worker_id !== workerId) {
            throw new Error(
              `Giường ${bedVal} tại ${ktxVal} · ${dayVal} · Phòng ${roomVal} đã có ${matchedBed.ho_va_ten || 'công nhân khác'} đang ở. Vui lòng chọn giường trống khác trước khi duyệt.`
            );
          }
        }
      }

      // 1. Insert/upsert into `workers` FIRST using valid UUID so registration is not marked approved if insert fails
      const { error: insertErr } = await supabase.from('workers').upsert({
        id: workerId,
        stt: nextStt,
        ho_va_ten: regToApprove.ho_va_ten || '',
        ma_nv: regToApprove.ma_nv || '',
        tieu_doan: regToApprove.tieu_doan || '',
        ktx: ktxVal,
        don_vi: regToApprove.don_vi || '',
        gioi_tinh: regToApprove.gioi_tinh || '',
        ngay_sinh: regToApprove.ngay_sinh || '',
        so_dien_thoai: regToApprove.so_dien_thoai || '',
        day: dayVal,
        phong_so: roomVal,
        giuong: bedVal,
        cccd: regToApprove.so_cccd || '',
        ho_khau_tinh: regToApprove.ho_khau_tinh || regToApprove.que_quan || '',
        to_truong: regToApprove.to_truong || '',
        sdt_to_truong: regToApprove.sdt_to_truong || '',
        ngay_vao_ktx: regToApprove.ngay_vao_ktx || '',
        ngay_ra_ktx: '',
        ghi_chu: regToApprove.ghi_chu || '',
        khoa_tra_cuu: `${ktxVal}|${dayVal}|${roomVal}`,
        avatar: regToApprove.cccd_image_url || '',
        tam_tru_status: tamTruStatus,
      }, { onConflict: 'id' });

      if (insertErr) {
        throw new Error(`Không thể thêm vào danh sách công nhân: ${insertErr.message}`);
      }

      // 2. Mark registration as approved
      const { error: updateErr } = await supabase
        .from('worker_registrations')
        .update({
          ho_va_ten: regToApprove.ho_va_ten || '',
          ma_nv: regToApprove.ma_nv || '',
          so_cccd: regToApprove.so_cccd || '',
          so_dien_thoai: regToApprove.so_dien_thoai || '',
          ngay_sinh: regToApprove.ngay_sinh || '',
          que_quan: regToApprove.que_quan || regToApprove.ho_khau_tinh || '',
          gioi_tinh: regToApprove.gioi_tinh || '',
          don_vi: regToApprove.don_vi || '',
          tieu_doan: regToApprove.tieu_doan || '',
          to_truong: regToApprove.to_truong || '',
          sdt_to_truong: regToApprove.sdt_to_truong || '',
          ho_khau_tinh: regToApprove.ho_khau_tinh || '',
          ktx: ktxVal,
          day: dayVal,
          phong_so: roomVal,
          giuong: bedVal,
          ngay_vao_ktx: regToApprove.ngay_vao_ktx || '',
          ghi_chu: regToApprove.ghi_chu || '',
          status: 'approved',
          reviewed_by: currentUser?.id,
          reviewed_at: nowStr,
        })
        .eq('id', regToApprove.id);

      if (updateErr) throw new Error(updateErr.message);

      // 2b. Defense-in-depth: detect & purge any rogue duplicate row spawned by a legacy
      // DB trigger on `worker_registrations` when `status` flips to 'approved' (different UUID).
      try {
        const cleanRegName = (regToApprove.ho_va_ten || '').trim().replace(/\s+/g, ' ');
        const safeNameToken = cleanRegName.replace(/[%_]/g, '');
        if (safeNameToken) {
          const recentSinceIso = new Date(Date.now() - 25_000).toISOString();
          const { data: recentSameName } = await supabase
            .from('workers')
            .select('id, ho_va_ten, ktx, day, phong_so, cccd, created_at')
            .ilike('ho_va_ten', `%${safeNameToken}%`)
            .gte('created_at', recentSinceIso)
            .limit(10);

          const normRegName = cleanRegName.normalize('NFC').toLowerCase();
          const normRegKtx = ktxVal.replace(/[\s\-_.]+/g, '').toLowerCase();
          const normRegRoom = normalizeRoomLabel(roomVal);
          const rogueDuplicateIds = (recentSameName || [])
            .filter((r: any) => {
              if (!r?.id || String(r.id) === workerId) return false;
              const rName = String(r.ho_va_ten || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
              const rKtx = String(r.ktx || '').replace(/[\s\-_.]+/g, '').toLowerCase();
              const rRoom = normalizeRoomLabel(String(r.phong_so || ''));
              return (
                rName === normRegName &&
                (!normRegKtx || !rKtx || rKtx === normRegKtx) &&
                (!normRegRoom || !rRoom || rRoom === normRegRoom)
              );
            })
            .map((r: any) => String(r.id));

          if (rogueDuplicateIds.length > 0) {
            console.warn(
              '[QRPortal] Phát hiện trigger CSDL cũ tự nhân bản công nhân khi duyệt worker_registrations. Đang tự dọn bản ghi trùng:',
              rogueDuplicateIds
            );
            await supabase.from('workers').delete().in('id', rogueDuplicateIds);
          }
        }
      } catch (sweepErr) {
        console.warn('[QRPortal] Duplicate-trigger sweep warning:', sweepErr);
      }

      // 3. Sync bed assignment into `beds` table so Bed Management updates immediately
      await syncBedForWorkerSave(supabase, undefined, {
        id: workerId,
        stt: nextStt,
        hoVaTen: regToApprove.ho_va_ten || '',
        maNV: regToApprove.ma_nv || '',
        tieuDoan: regToApprove.tieu_doan || '',
        ktx: ktxVal,
        donVi: regToApprove.don_vi || '',
        gioiTinh: regToApprove.gioi_tinh || '',
        ngaySinh: regToApprove.ngay_sinh || '',
        soDienThoai: regToApprove.so_dien_thoai || '',
        day: dayVal,
        phongSo: roomVal,
        giuong: bedVal,
        cccd: regToApprove.so_cccd || '',
        hoKhauTinh: regToApprove.ho_khau_tinh || regToApprove.que_quan || '',
        toTruong: regToApprove.to_truong || '',
        sdtToTruong: regToApprove.sdt_to_truong || '',
        ngayVaoKTX: regToApprove.ngay_vao_ktx || '',
        ghiChu: regToApprove.ghi_chu || '',
        khoaTraCuu: `${ktxVal}|${dayVal}|${roomVal}`,
        tamTruStatus,
      });

      try {
        addLog(
          currentUser?.email || 'unknown',
          'APPROVE_REGISTRATION',
          `Duyệt hồ sơ QR: ${regToApprove.ho_va_ten} (${regToApprove.ma_nv || regToApprove.so_cccd || 'N/A'}) → ${[ktxVal, dayVal, roomVal ? `P.${roomVal}` : '', bedVal ? `G.${bedVal}` : ''].filter(Boolean).join(' - ')}`
        );
      } catch {}

      invalidateKtxStructureCache();
      invalidateWorkerHierarchyCache();
      invalidateFacilitiesCache();
      if (!options?.skipPostRefresh) {
        refreshWorkers().catch(() => {});
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_workers_updated'));
      }

      const updatedReg: WorkerRegistration = {
        ...regToApprove,
        ktx: ktxVal,
        day: dayVal,
        phong_so: roomVal,
        giuong: bedVal,
        status: 'approved',
        reviewed_at: nowStr,
      };
      setRegistrations(prev =>
        prev.map(r => (r.id === regToApprove.id ? updatedReg : r))
      );
      setSelectedIds(prev => {
        if (!prev.has(regToApprove.id)) return prev;
        const next = new Set(prev);
        next.delete(regToApprove.id);
        return next;
      });
      if (detailReg?.id === regToApprove.id) {
        setDetailReg(updatedReg);
      }
  };

  const handleApprove = async (
    regToApprove: WorkerRegistration,
    tamTruStatus: 'registered' | 'unregistered' = 'unregistered'
  ) => {
    if (processing) return;
    setProcessing(regToApprove.id);
    try {
      await approveSingleRegistration(regToApprove, tamTruStatus);
      toast.success(`Đã duyệt và xếp chỗ cho ${regToApprove.ho_va_ten}`);
    } catch (e: any) {
      console.error('Approve error:', e.message);
      toast.error(`Lỗi khi phê duyệt: ${e?.message || 'Không thể cập nhật'}`);
    } finally {
      setProcessing(null);
    }
  };

  const handleBatchApprove = async (regsToApprove: WorkerRegistration[]) => {
    if (regsToApprove.length === 0) return;
    setBatchApproving(true);
    let nextStt = 1;
    try {
      const { data: maxRow } = await supabase
        .from('workers')
        .select('stt')
        .order('stt', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxRow && typeof maxRow.stt === 'number') {
        nextStt = maxRow.stt + 1;
      }
    } catch {}

    const genderMap = loadSavedRoomGenderMap();
    const extraOccupiedByRoom = new Map<string, number>();
    const extraOccupiedBeds = new Map<string, Set<string>>();
    const extraAssignedGender = new Map<string, 'male' | 'female'>();

    let approvedCount = 0;
    let autoAssignedCount = 0;
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const reg of regsToApprove) {
      try {
        let preparedReg = reg;
        const missingLocation = !reg.day?.trim() || !reg.phong_so?.trim();
        if (missingLocation) {
          const suggestions = suggestOptimalRooms(
            {
              gioiTinh: reg.gioi_tinh,
              donVi: reg.don_vi,
              tieuDoan: reg.tieu_doan,
              ktx: reg.ktx || undefined,
            },
            workers,
            facilities,
            genderMap,
            {
              preferPhase1: true,
              limit: 1,
              extraOccupiedByRoom,
              extraOccupiedBeds,
              extraAssignedGender,
            }
          );
          const best = suggestions[0];
          if (best) {
            preparedReg = {
              ...reg,
              ktx: best.ktx,
              day: best.day,
              phong_so: best.room,
              giuong: reg.giuong?.trim() || best.firstFreeBed,
            };
            autoAssignedCount++;
            const roomKey = `${best.ktx}||${best.day}||${best.room}`;
            extraOccupiedByRoom.set(roomKey, (extraOccupiedByRoom.get(roomKey) || 0) + 1);
            let bedSet = extraOccupiedBeds.get(roomKey);
            if (!bedSet) {
              bedSet = new Set<string>();
              extraOccupiedBeds.set(roomKey, bedSet);
            }
            bedSet.add(preparedReg.giuong);
            const gNorm = normalizeGender(reg.gioi_tinh);
            const gBucket = gNorm === 'nam' ? 'male' : gNorm === 'nu' ? 'female' : null;
            if (gBucket && !extraAssignedGender.has(roomKey)) {
              extraAssignedGender.set(roomKey, gBucket);
            }
          }
        }

        await approveSingleRegistration(preparedReg, 'unregistered', {
          skipPostRefresh: true,
          nextSttOverride: nextStt,
        });
        nextStt++;
        approvedCount++;
      } catch (err: any) {
        skipped.push({
          name: reg.ho_va_ten || reg.id,
          reason: err?.message || 'Xung đột dữ liệu',
        });
      }
    }

    await refreshWorkers().catch(() => {});
    setBatchApproving(false);

    const autoSuffix = autoAssignedCount > 0 ? ` (tự động xếp phòng thông minh ${autoAssignedCount} hồ sơ)` : '';
    if (approvedCount > 0 && skipped.length === 0) {
      toast.success(`Đã duyệt hàng loạt ${approvedCount} hồ sơ thành công${autoSuffix}.`);
    } else if (approvedCount > 0 && skipped.length > 0) {
      toast.warning(
        `Đã duyệt ${approvedCount} hồ sơ${autoSuffix}. Bỏ qua ${skipped.length} hồ sơ có xung đột (${skipped.slice(0, 2).map(s => s.name).join(', ')}).`
      );
    } else if (skipped.length > 0) {
      toast.error(`Không duyệt được hồ sơ nào: ${skipped[0].reason}`);
    }
  };

  const handleReject = async (id: string) => {
    setProcessing(id);
    try {
      const nowStr = new Date().toISOString();
      const { error } = await supabase
        .from('worker_registrations')
        .update({ status: 'rejected', reviewed_by: currentUser?.id, reviewed_at: nowStr })
        .eq('id', id);
      if (!error) {
        setRegistrations(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected', reviewed_at: nowStr } : r));
        if (detailReg?.id === id) setDetailReg(prev => prev ? { ...prev, status: 'rejected', reviewed_at: nowStr } : prev);
      }
    } catch (e: any) {
      console.error('Reject error:', e.message);
    } finally {
      setProcessing(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      await hardDeleteWorkerRegistration(supabase, {
        registration: {
          id: target.id,
          ho_va_ten: target.ho_va_ten,
          ma_nv: target.ma_nv,
          so_cccd: target.so_cccd,
          ktx: target.ktx,
          day: target.day,
          phong_so: target.phong_so,
          giuong: target.giuong,
          ghi_chu: target.ghi_chu,
        },
        account: currentUser?.name || currentUser?.email || 'Quản trị',
        sourceContext: 'qr_portal_registration_delete',
      });
      setRegistrations(prev => prev.filter(r => r.id !== target.id));
      setSelectedIds(prev => {
        if (!prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      if (detailReg?.id === target.id) setDetailReg(null);
      toast.success(`Đã xóa triệt để đơn đăng ký của ${target.ho_va_ten || 'công nhân'} khỏi hệ thống.`);
    } catch (e: any) {
      console.error('Delete error:', e?.message || e);
      toast.error(e?.message || 'Không thể xóa triệt để bản ghi khỏi worker_registrations.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const filterAvailableDays = useMemo(() => {
    if (selectedKtx === 'all') {
      const allDays = new Set<string>();
      Object.values(hierarchy.daysByKtx).forEach(list => list.forEach(d => allDays.add(d)));
      return Array.from(allDays).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    }
    return hierarchy.daysByKtx[selectedKtx] || [];
  }, [hierarchy, selectedKtx]);

  const filterAvailableRooms = useMemo(() => {
    if (selectedKtx !== 'all' && selectedDay !== 'all') {
      return hierarchy.roomsByKtxDay[`${selectedKtx}__${selectedDay}`] || [];
    }
    const allRooms = new Set<string>();
    Object.entries(hierarchy.roomsByKtxDay).forEach(([kd, rooms]) => {
      const [k, d] = kd.split('__');
      if (selectedKtx !== 'all' && k !== selectedKtx) return;
      if (selectedDay !== 'all' && d !== selectedDay) return;
      rooms.forEach(r => allRooms.add(r));
    });
    return Array.from(allRooms).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [hierarchy, selectedKtx, selectedDay]);

  const filtered = useMemo(() => {
    return scopedRegistrations.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (selectedKtx !== 'all' && r.ktx !== selectedKtx) return false;
      if (selectedDay !== 'all' && r.day !== selectedDay) return false;
      if (selectedRoom !== 'all' && r.phong_so !== selectedRoom) return false;
      if (dateFrom || dateTo) {
        const regDay = getVNDateString(new Date(r.created_at));
        if (dateFrom && regDay < dateFrom) return false;
        if (dateTo && regDay > dateTo) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          r.ho_va_ten.toLowerCase().includes(q) ||
          (r.ma_nv && r.ma_nv.toLowerCase().includes(q)) ||
          r.so_cccd.toLowerCase().includes(q) ||
          r.so_dien_thoai.toLowerCase().includes(q) ||
          r.ktx.toLowerCase().includes(q) ||
          r.day.toLowerCase().includes(q) ||
          r.phong_so.toLowerCase().includes(q) ||
          (r.don_vi && r.don_vi.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [scopedRegistrations, filterStatus, selectedKtx, selectedDay, selectedRoom, dateFrom, dateTo, searchQuery]);

  const selectedVisibleRegs = useMemo(
    () => filtered.filter(r => selectedIds.has(r.id)),
    [filtered, selectedIds]
  );

  const selectedPendingRegs = useMemo(
    () => selectedVisibleRegs.filter(r => r.status === 'pending'),
    [selectedVisibleRegs]
  );

  const selectedDeletableRegs = useMemo(
    () => selectedVisibleRegs.filter(r => isSuperAdmin || r.status !== 'pending'),
    [selectedVisibleRegs, isSuperAdmin]
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(r => r.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchReject = async (regsToReject: WorkerRegistration[]) => {
    if (regsToReject.length === 0) return;
    setBatchRejecting(true);
    const nowStr = new Date().toISOString();
    let rejectedCount = 0;
    try {
      const ids = regsToReject.map(r => r.id);
      const { error } = await supabase
        .from('worker_registrations')
        .update({ status: 'rejected', reviewed_by: currentUser?.id, reviewed_at: nowStr })
        .in('id', ids);
      if (error) throw new Error(error.message);
      rejectedCount = ids.length;
      const idSet = new Set(ids);
      setRegistrations(prev =>
        prev.map(r => (idSet.has(r.id) ? { ...r, status: 'rejected' as const, reviewed_at: nowStr } : r))
      );
      setSelectedIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      toast.success(`Đã từ chối hàng loạt ${rejectedCount} hồ sơ đăng ký.`);
    } catch (e: any) {
      toast.error(`Lỗi khi từ chối hàng loạt: ${e?.message || 'Không thể cập nhật'}`);
    } finally {
      setBatchRejecting(false);
    }
  };

  const handleBatchDeleteConfirm = async () => {
    const targets = selectedDeletableRegs;
    if (targets.length === 0) return;
    setBatchDeleting(true);
    const actor = currentUser?.name || currentUser?.email || 'Quản trị';
    let deletedCount = 0;
    let failedCount = 0;
    const deletedSet = new Set<string>();

    for (const target of targets) {
      try {
        await hardDeleteWorkerRegistration(supabase, {
          registration: {
            id: target.id,
            ho_va_ten: target.ho_va_ten,
            ma_nv: target.ma_nv,
            so_cccd: target.so_cccd,
            ktx: target.ktx,
            day: target.day,
            phong_so: target.phong_so,
            giuong: target.giuong,
            ghi_chu: target.ghi_chu,
          },
          account: actor,
          sourceContext: 'qr_portal_registration_batch_delete',
        });
        deletedSet.add(target.id);
        deletedCount++;
      } catch {
        failedCount++;
      }
    }

    if (deletedSet.size > 0) {
      setRegistrations(prev => prev.filter(r => !deletedSet.has(r.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        deletedSet.forEach(id => next.delete(id));
        return next;
      });
      if (detailReg && deletedSet.has(detailReg.id)) setDetailReg(null);
    }

    setBatchDeleting(false);
    setBatchDeleteOpen(false);
    if (deletedCount > 0 && failedCount === 0) {
      toast.success(`Đã xóa triệt để ${deletedCount} hồ sơ đăng ký.`);
    } else if (deletedCount > 0) {
      toast.warning(`Đã xóa ${deletedCount} hồ sơ, còn ${failedCount} hồ sơ chưa xóa được.`);
    } else {
      toast.error('Không thể xóa các hồ sơ đã chọn.');
    }
  };

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      toast.info('Không có hồ sơ nào trong bộ lọc hiện tại để xuất.');
      return;
    }
    const rows = filtered.map((r, i) => {
      const roomNum = extractRoomNumber(r.phong_so) || r.phong_so;
      const bedNum = normalizeBedLabel(r.giuong) || r.giuong;
      return {
        STT: i + 1,
        'Họ và tên': r.ho_va_ten || '',
        'Mã NV': r.ma_nv || '',
        'Giới tính': r.gioi_tinh || '',
        'Ngày sinh': r.ngay_sinh || '',
        'Số CCCD': r.so_cccd || '',
        'Số điện thoại': r.so_dien_thoai || '',
        'Đơn vị': r.don_vi || '',
        'Tiểu đoàn': r.tieu_doan || '',
        'Khu KTX': r.ktx || '',
        'Dãy nhà': r.day || '',
        'Phòng': roomNum ? `P.${roomNum}` : '',
        'Giường': bedNum ? `G.${bedNum}` : '',
        'Ngày vào KTX': r.ngay_vao_ktx || '',
        'Trạng thái': STATUS_CONFIG[r.status]?.label || r.status,
        'Thời gian gửi': new Date(r.created_at).toLocaleString('vi-VN'),
        'Ghi chú': r.ghi_chu || '',
      };
    });
    const ok = exportToExcel(rows, `HoSoDangKyCuTru_${getVNDateString()}.xlsx`, 'Đăng ký cư trú');
    if (ok) toast.success(`Đã xuất ${rows.length} hồ sơ đăng ký ra Excel.`);
  };

  const counts = {
    pending: scopedRegistrations.filter(r => r.status === 'pending').length,
    approved: scopedRegistrations.filter(r => r.status === 'approved').length,
    rejected: scopedRegistrations.filter(r => r.status === 'rejected').length,
  };

  useEffect(() => {
    onPendingCountChange?.(counts.pending);
  }, [counts.pending, onPendingCountChange]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {detailReg && (
        <DetailModal
          reg={detailReg}
          onClose={() => setDetailReg(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          processing={processing}
          hierarchy={hierarchy}
          workers={workers}
          facilities={facilities}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          name={deleteTarget.ho_va_ten}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
      {batchDeleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim fade-in p-4"
          onClick={() => { if (!batchDeleting) setBatchDeleteOpen(false); }}
        >
          <div
            className="modal-enter bg-surf border border-bdr rounded-xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-dgrbg text-dgr flex items-center justify-center shrink-0">
                <Trash2 size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-tx">Xóa hàng loạt hồ sơ đăng ký</h3>
                <p className="text-xs text-mu">Thao tác không thể hoàn tác</p>
              </div>
            </div>
            <p className="text-xs text-tx leading-relaxed">
              Bạn có chắc chắn muốn xóa triệt để <strong className="font-mono text-dgr">{selectedDeletableRegs.length}</strong> hồ sơ đăng ký đã chọn khỏi danh sách? (Lưu ý: thao tác này chỉ xóa đơn đăng ký, không xóa hồ sơ công nhân đang lưu trú).
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setBatchDeleteOpen(false)}
                disabled={batchDeleting}
                className="flex-1 py-2 border border-bdr rounded-lg text-xs font-semibold hover:bg-act transition-colors cursor-pointer disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleBatchDeleteConfirm}
                disabled={batchDeleting}
                className="flex-1 py-2 bg-dgr hover:opacity-90 text-white rounded-lg text-xs font-bold transition-opacity cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1"
              >
                {batchDeleting && <Loader2 size={12} className="animate-spin" />}
                <span>{batchDeleting ? 'Đang xóa...' : `Xóa ${selectedDeletableRegs.length} hồ sơ`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-bdr">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-tx">
            Hồ Sơ Đăng Ký Cư Trú
          </h1>
          <p className="text-xs text-mu mt-0.5">
            Duyệt và phân bổ phòng cho công nhân mới quét mã đăng ký trực tuyến
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-bdr bg-surf text-tx rounded-lg text-xs font-semibold hover:bg-act transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet size={13} className="text-ok" />
            <span>Xuất Excel ({filtered.length})</span>
          </button>
          <button
            type="button"
            onClick={() => fetchRegistrations(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-bdr bg-surf text-tx rounded-lg text-xs font-semibold hover:bg-act transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Phân quyền Staff */}
      {!isAdmin && (
        <div className="p-2.5 tint-wn border border-wn/30 rounded text-xs text-wn flex items-center gap-2">
          <Building2 size={14} className="shrink-0 text-wn" />
          <span>
            {currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0 ? (
              <>
                <strong>Phân quyền phụ trách:</strong> Chỉ hiển thị các hồ sơ đăng ký thuộc dãy:{' '}
                <span className="font-bold underline">{currentUser.assignedBlocks.join(', ')}</span>
              </>
            ) : (
              <span>Tài khoản Staff chưa được phân quyền phụ trách dãy nào. Vui lòng liên hệ Quản trị viên (Admin).</span>
            )}
          </span>
        </div>
      )}

      {/* QR Code Section */}
      <QRCodeDisplay url={registerUrl} />

      {/* DẢI SỐ LIỆU TỔNG QUAN LIỀN KHỐI (Requirement: Segmented stats strip, NO separate floating cards) */}
      <div className="bg-surf border border-bdr rounded-md grid grid-cols-3 divide-x divide-bdr overflow-hidden">
        {[
          {
            key: 'pending',
            label: 'Chờ duyệt',
            count: counts.pending,
            activeColor: 'tint-wn text-wn',
            numColor: 'text-wn',
          },
          {
            key: 'approved',
            label: 'Đã duyệt',
            count: counts.approved,
            activeColor: 'bg-okbg  text-ok',
            numColor: 'text-ok',
          },
          {
            key: 'rejected',
            label: 'Từ chối',
            count: counts.rejected,
            activeColor: 'bg-dgrbg text-dgr',
            numColor: 'text-dgr',
          },
        ].map(s => {
          const isSelected = filterStatus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setFilterStatus(s.key as any)}
              className={`p-3 text-center transition-colors cursor-pointer ${
                isSelected ? s.activeColor : 'hover:bg-act'
              }`}
            >
              <div className={`text-2xl font-bold font-mono ${s.numColor}`}>
                {s.count}
              </div>
              <div className="text-xs font-semibold mt-0.5 uppercase tracking-wider text-mu">
                {s.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* THANH BỘ LỌC LIỀN KHỐI (Requirement: Segmented filter button group + console filters) */}
      <div className="bg-surf border border-bdr rounded-md p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Nhóm nút lọc trạng thái liền khối + Chọn nhanh chờ duyệt */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex border border-bdr rounded overflow-hidden divide-x divide-bdr">
              {[
                { key: 'all', label: `Tất cả (${scopedRegistrations.length})` },
                { key: 'pending', label: `Chờ duyệt (${counts.pending})` },
                { key: 'approved', label: `Đã duyệt (${counts.approved})` },
                { key: 'rejected', label: `Từ chối (${counts.rejected})` },
              ].map(t => {
                const isActive = filterStatus === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilterStatus(t.key as any)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'bg-side text-tx'
                        : 'bg-surf text-mu hover:bg-act'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {counts.pending > 0 && (
              <button
                type="button"
                onClick={() => {
                  const pendingVisible = filtered.filter(r => r.status === 'pending');
                  if (pendingVisible.length === 0) {
                    setFilterStatus('pending');
                    const allPendingIds = scopedRegistrations.filter(r => r.status === 'pending').map(r => r.id);
                    setSelectedIds(new Set(allPendingIds));
                  } else {
                    setSelectedIds(new Set(pendingVisible.map(r => r.id)));
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-ok2/40 bg-okbg text-ok text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 size={12} />
                <span>Chọn tất cả chờ duyệt ({counts.pending})</span>
              </button>
            )}
          </div>

          {/* Ô tìm kiếm console */}
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm tên, CCCD, SĐT, mã NV..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-page border border-bdr rounded text-tx focus:outline-none focus:border-wn"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-black dark:hover:text-tx"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Bộ lọc vị trí KTX / Dãy / Phòng + Khoảng ngày */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-2.5 border-t border-bdr">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ic whitespace-nowrap min-w-[50px]">Khu KTX:</span>
            <select
              value={selectedKtx}
              onChange={e => {
                setSelectedKtx(e.target.value);
                setSelectedDay('all');
                setSelectedRoom('all');
              }}
              className="flex-1 py-1.5 px-2 text-xs bg-page border border-bdr rounded text-tx focus:outline-none focus:border-wn"
            >
              <option value="all">Tất cả KTX</option>
              {hierarchy.ktxList.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ic whitespace-nowrap min-w-[50px]">Dãy nhà:</span>
            <select
              value={selectedDay}
              onChange={e => {
                setSelectedDay(e.target.value);
                setSelectedRoom('all');
              }}
              className="flex-1 py-1.5 px-2 text-xs bg-page border border-bdr rounded text-tx focus:outline-none focus:border-wn"
            >
              <option value="all">Tất cả Dãy</option>
              {filterAvailableDays.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ic whitespace-nowrap min-w-[50px]">Phòng số:</span>
            <select
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              className="flex-1 py-1.5 px-2 text-xs bg-page border border-bdr rounded text-tx focus:outline-none focus:border-wn"
            >
              <option value="all">Tất cả Phòng</option>
              {filterAvailableRooms.map(p => (
                <option key={p} value={p}>Phòng {p}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-ic shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              title="Từ ngày"
              className="flex-1 py-1 px-2 text-xs bg-page border border-bdr rounded text-tx focus:outline-none focus:border-wn font-tabular"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-mu shrink-0">đến</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              title="Đến ngày"
              className="flex-1 py-1 px-2 text-xs bg-page border border-bdr rounded text-tx focus:outline-none focus:border-wn font-tabular"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="p-1 text-mu hover:text-tx cursor-pointer"
                title="Xóa lọc ngày"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedVisibleRegs.length > 0 && (
        <div className="bg-surf border border-bdr2 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-tx">
            Đã chọn <span className="text-lnk font-mono font-tabular">{selectedVisibleRegs.length}</span> hồ sơ
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedPendingRegs.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => handleBatchApprove(selectedPendingRegs)}
                  disabled={batchApproving || batchRejecting || batchDeleting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ok2 hover:opacity-90 text-ok2-fg rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {batchApproving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  <span>{batchApproving ? 'Đang duyệt...' : `Duyệt hàng loạt (${selectedPendingRegs.length})`}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchReject(selectedPendingRegs)}
                  disabled={batchApproving || batchRejecting || batchDeleting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dgr text-dgr hover:bg-dgrbg rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {batchRejecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                  <span>Từ chối ({selectedPendingRegs.length})</span>
                </button>
              </>
            )}
            {selectedDeletableRegs.length > 0 && (isAdmin || isSuperAdmin) && (
              <button
                type="button"
                onClick={() => setBatchDeleteOpen(true)}
                disabled={batchApproving || batchRejecting || batchDeleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-dgr hover:opacity-90 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <Trash2 size={13} />
                <span>Xóa hàng loạt ({selectedDeletableRegs.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={batchApproving || batchRejecting || batchDeleting}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-bdr rounded-lg text-xs font-semibold text-mu hover:text-tx hover:bg-act cursor-pointer whitespace-nowrap"
            >
              <X size={12} /> Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {/* BẢNG DANH SÁCH */}
      <div className="bg-surf border border-bdr rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-ic text-xs">
            <Loader2 size={18} className="animate-spin mr-2 text-wn" />
            <span>Đang tải danh sách hồ sơ...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 border border-dashed border-bdr m-4 rounded-lg text-center space-y-1.5">
            <Inbox size={32} className="mx-auto text-mu stroke-1" />
            <h4 className="font-bold text-sm text-tx">Không có hồ sơ nào phù hợp</h4>
            <p className="text-xs text-mu max-w-sm mx-auto">
              Không tìm thấy hồ sơ đăng ký nào theo bộ lọc hoặc từ khóa hiện tại. Thử chọn &quot;Tất cả&quot; hoặc xóa điều kiện lọc.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-page border-b border-bdr text-[11px] font-bold text-mu uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="rounded border-bdr bg-surf cursor-pointer"
                      title="Chọn tất cả hồ sơ đang hiển thị"
                    />
                  </th>
                  <th className="py-2.5 px-3">Công nhân</th>
                  <th className="py-2.5 px-3">Liên hệ &amp; CCCD</th>
                  <th className="py-2.5 px-3">Đơn vị / Tổ</th>
                  <th className="py-2.5 px-3">Vị trí đăng ký</th>
                  <th className="py-2.5 px-3">Ngày gửi</th>
                  <th className="py-2.5 px-3">Trạng thái</th>
                  <th className="py-2.5 px-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bdr">
                {filtered.map(reg => {
                  const cfg = STATUS_CONFIG[reg.status];
                  const isProcessing = processing === reg.id;
                  const isDone = reg.status === 'approved' || reg.status === 'rejected';
                  const dupMatch = checkDuplicateWorker(hierarchy.workers, reg.so_cccd, reg.so_dien_thoai);
                  const roomShort = extractRoomNumber(reg.phong_so) || reg.phong_so;
                  const bedShort = normalizeBedLabel(reg.giuong) || reg.giuong;

                  return (
                    <tr
                      key={reg.id}
                      className={`transition-colors ${
                        selectedIds.has(reg.id)
                          ? 'bg-bdg/30'
                          : dupMatch
                          ? 'tint-wn hover:bg-act'
                          : 'hover:bg-act'
                      }`}
                    >
                      <td className="py-2.5 px-3 align-top text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(reg.id)}
                          onChange={() => toggleSelectRow(reg.id)}
                          className="rounded border-bdr bg-surf cursor-pointer mt-0.5"
                        />
                      </td>
                      {/* Cột 1: Tên & Mã NV */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-tx text-xs sm:text-sm">
                          {reg.ho_va_ten}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {reg.ma_nv ? (
                            <span className="font-mono text-[11px] text-ic bg-act px-1 rounded">
                              {reg.ma_nv}
                            </span>
                          ) : (
                            <span className="text-[11px] text-mu">Chưa có mã</span>
                          )}
                          {reg.gioi_tinh && (
                            <span className="text-[11px] text-mu">· {reg.gioi_tinh}</span>
                          )}
                        </div>
                        {dupMatch && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-dgrbg text-dgr border border-dgr/30">
                              <AlertTriangle size={10} /> Trùng {dupMatch.field}
                            </span>
                            <p className="text-[10px] text-dgr mt-0.5 font-medium leading-tight">
                              Khớp với: {dupMatch.worker.hoVaTen} [{dupMatch.worker.maNV || '—'}] ({dupMatch.worker.ktx} · {dupMatch.worker.day} · P.{extractRoomNumber(dupMatch.worker.phongSo) || dupMatch.worker.phongSo})
                            </p>
                          </div>
                        )}
                      </td>

                      {/* Cột 2: CCCD & SĐT */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap font-tabular">
                        <div className="font-mono font-medium text-xs text-tx">
                          {reg.so_cccd || '—'}
                        </div>
                        <div className="text-[11px] text-mu mt-0.5 flex items-center gap-1">
                          <Phone size={10} />
                          <span>{reg.so_dien_thoai || '—'}</span>
                        </div>
                      </td>

                      {/* Cột 3: Đơn vị / Tổ */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-semibold text-xs text-tx">
                          {reg.don_vi || '—'}
                        </div>
                        {reg.tieu_doan && (
                          <div className="text-[11px] text-mu mt-0.5">
                            TĐ: {reg.tieu_doan}
                          </div>
                        )}
                      </td>

                      {/* Cột 4: Vị trí đăng ký chuẩn hóa */}
                      <td className="py-2.5 px-3 align-top font-tabular">
                        <div className="font-bold text-xs text-tx">
                          {reg.ktx} · {reg.day}
                        </div>
                        <div className="text-[11px] text-mu mt-0.5">
                          {roomShort ? `P.${roomShort}` : '—'}{bedShort ? ` · G.${bedShort}` : ''}
                        </div>
                      </td>

                      {/* Cột 5: Ngày gửi */}
                      <td className="py-2.5 px-3 align-top text-[11px] text-mu whitespace-nowrap font-tabular">
                        {new Date(reg.created_at).toLocaleDateString('vi-VN')}
                        <div className="text-[10px] text-mu">
                          {new Date(reg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Cột 6: Trạng thái */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${cfg.badgeCls}`}>
                          {cfg.icon}
                          <span>{cfg.label}</span>
                        </span>
                      </td>

                      {/* Cột 7: Nhóm nút hành động căn phải (Requirement: Nút Duyệt xanh lá đặc, Từ chối viền đỏ, Xem trung tính) */}
                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => setDetailReg(reg)}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-bdr bg-surf text-mu hover:bg-act rounded text-xs font-medium cursor-pointer"
                            title={reg.status === 'pending' ? 'Sửa thông tin & duyệt' : 'Xem chi tiết'}
                          >
                            <Eye size={12} />
                            <span>{reg.status === 'pending' ? 'Sửa/Xem' : 'Xem'}</span>
                          </button>

                          {reg.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleReject(reg.id)}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-dgr text-dgr hover:bg-dgrbg rounded text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                                title="Từ chối hồ sơ"
                              >
                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                <span>Từ chối</span>
                              </button>
                              <button
                                onClick={() => handleApprove(reg)}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-ok2 hover:opacity-90 text-ok2-fg rounded text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                                title="Duyệt hồ sơ ngay"
                              >
                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                <span>Duyệt</span>
                              </button>
                            </>
                          )}

                          {isDone && (
                            <button
                              onClick={() => setDeleteTarget(reg)}
                              className="p-1 border border-bdr text-dgr hover:opacity-80 hover:border-dgr rounded cursor-pointer transition-colors"
                              title="Xóa hồ sơ"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
