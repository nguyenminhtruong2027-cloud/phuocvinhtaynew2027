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
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchWorkerHierarchy,
  WorkerHierarchyData,
  checkDuplicateWorker,
} from '@/lib/workerHierarchy';

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
    badgeCls: 'bg-[#fdf1e4] text-[#c9690f] border border-[#c9690f]/30',
    icon: <Clock size={12} />,
  },
  approved: {
    label: 'Đã duyệt',
    badgeCls: 'bg-[#eaf6ef] text-[#1f7a45] border border-[#1f7a45]/30',
    icon: <CheckCircle2 size={12} />,
  },
  rejected: {
    label: 'Từ chối',
    badgeCls: 'bg-[#fbebe9] text-[#b3362b] border border-[#b3362b]/30',
    icon: <XCircle size={12} />,
  },
};

const inputCls =
  'w-full px-2.5 py-1.5 text-xs sm:text-sm border border-[#dde1e6] dark:border-[#2a333e] rounded bg-white dark:bg-[#11151a] text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]';
const labelCls = 'text-xs text-[#4b5563] dark:text-[#9ca3af] mb-1 block font-medium';

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
}: {
  reg: WorkerRegistration;
  onClose: () => void;
  onApprove: (updatedReg: WorkerRegistration) => void;
  onReject: (id: string) => void;
  processing: string | null;
  hierarchy: WorkerHierarchyData;
}) {
  const isProcessing = processing === reg.id;
  const cfg = STATUS_CONFIG[reg.status];
  const isPending = reg.status === 'pending';

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

  const availableKtx = hierarchy.ktxList;

  const availableDays = useMemo(() => {
    if (!editForm.ktx) return [];
    return hierarchy.daysByKtx[editForm.ktx] || [];
  }, [hierarchy, editForm.ktx]);

  const availableRooms = useMemo(() => {
    if (!editForm.ktx || !editForm.day) return [];
    return hierarchy.roomsByKtxDay[`${editForm.ktx}__${editForm.day}`] || [];
  }, [hierarchy, editForm.ktx, editForm.day]);

  useEffect(() => {
    if (isPending) {
      if (availableDays.length > 0 && !availableDays.includes(editForm.day)) {
        const nextDay = availableDays[0];
        const nextRooms = hierarchy.roomsByKtxDay[`${editForm.ktx}__${nextDay}`] || [];
        setEditForm(prev => ({
          ...prev,
          day: nextDay,
          phong_so: nextRooms.includes(prev.phong_so) ? prev.phong_so : (nextRooms[0] || ''),
        }));
      }
    }
  }, [editForm.ktx, availableDays, hierarchy, isPending]);

  const handleKtxChange = (newKtx: string) => {
    const days = hierarchy.daysByKtx[newKtx] || [];
    const nextDay = days.includes(editForm.day) ? editForm.day : (days[0] || '');
    const rooms = hierarchy.roomsByKtxDay[`${newKtx}__${nextDay}`] || [];
    const nextRoom = rooms.includes(editForm.phong_so) ? editForm.phong_so : (rooms[0] || '');
    setEditForm(prev => ({
      ...prev,
      ktx: newKtx,
      day: nextDay,
      phong_so: nextRoom,
    }));
  };

  const handleDayChange = (newDay: string) => {
    const rooms = hierarchy.roomsByKtxDay[`${editForm.ktx}__${newDay}`] || [];
    const nextRoom = rooms.includes(editForm.phong_so) ? editForm.phong_so : (rooms[0] || '');
    setEditForm(prev => ({
      ...prev,
      day: newDay,
      phong_so: nextRoom,
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

  const dupMatch = useMemo(() => {
    return checkDuplicateWorker(hierarchy.workers, editForm.so_cccd, editForm.so_dien_thoai);
  }, [hierarchy.workers, editForm.so_cccd, editForm.so_dien_thoai]);

  const handleApproveSubmit = () => {
    const finalUnit = isCustomUnit ? customUnit.trim() : editForm.don_vi.trim();
    onApprove({
      ...reg,
      ...editForm,
      don_vi: finalUnit,
      que_quan: editForm.ho_khau_tinh,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Navy Header */}
        <div className="flex items-center justify-between p-4 bg-[#1b2430] text-white border-b border-[#2a333e]">
          <div>
            <h3 className="font-bold text-sm tracking-wide">
              {isPending ? 'CHỈNH SỬA & DUYỆT HỒ SƠ ĐĂNG KÝ' : 'CHI TIẾT HỒ SƠ ĐĂNG KÝ'}
            </h3>
            <p className="text-xs text-gray-300 mt-0.5 font-normal">
              Mã hồ sơ: <span className="font-mono text-[#f39c55]">{reg.id}</span> · Đăng ký lúc: {new Date(reg.created_at).toLocaleString('vi-VN')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-gray-300 hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-[#dde1e6] dark:border-[#2a333e]">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${cfg.badgeCls}`}>
              {cfg.icon} {cfg.label}
            </div>
            {isPending && (
              <span className="text-xs text-[#4b5563] dark:text-[#9ca3af]">
                * Người duyệt có thể trực tiếp sửa thông tin trước khi duyệt
              </span>
            )}
          </div>

          {/* Cảnh báo trùng hồ sơ (Cam + Đỏ) */}
          {dupMatch && (
            <div className="p-3 border-l-[3px] border-l-[#c9690f] bg-[#fdf1e4] dark:bg-[#281d14] border border-[#c9690f]/30 rounded text-xs text-[#853d07] dark:text-[#f39c55] space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[#b3362b] dark:text-red-400">
                <AlertTriangle size={14} />
                <span>⚠ Cảnh báo: Có thể trùng với hồ sơ công nhân đã có trong hệ thống</span>
              </div>
              <p className="font-semibold text-[#1b2430] dark:text-white">
                {dupMatch.worker.hoVaTen} — Mã NV [{dupMatch.worker.maNV || 'Chưa có'}]
              </p>
              <p className="text-[11px] text-[#4b5563] dark:text-gray-300">
                Vị trí hiện tại: {dupMatch.worker.ktx} - {dupMatch.worker.day} - Phòng {dupMatch.worker.phongSo} · Khớp theo {dupMatch.field}: <span className="font-mono font-bold text-[#b3362b] dark:text-red-400">{dupMatch.matchedValue}</span>
              </p>
            </div>
          )}

          {isPending ? (
            <div className="space-y-4">
              <div className="text-xs font-bold text-[#1b2430] dark:text-white uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-[#dde1e6] dark:border-[#2a333e]">
                <User size={13} className="text-[#c9690f]" /> 1. Thông tin công nhân
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Họ và tên <span className="text-[#b3362b]">*</span></label>
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
                  <label className={labelCls}>Số CCCD <span className="text-[#b3362b]">*</span></label>
                  <input
                    type="text"
                    value={editForm.so_cccd}
                    onChange={e => setEditForm(prev => ({ ...prev, so_cccd: e.target.value }))}
                    className={`${inputCls} font-mono`}
                  />
                </div>

                <div>
                  <label className={labelCls}>Số điện thoại <span className="text-[#b3362b]">*</span></label>
                  <input
                    type="tel"
                    value={editForm.so_dien_thoai}
                    onChange={e => setEditForm(prev => ({ ...prev, so_dien_thoai: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Ngày sinh (DD/MM/YYYY) <span className="text-[#b3362b]">*</span></label>
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
              <div className="text-xs font-bold text-[#1b2430] dark:text-white uppercase tracking-wider flex items-center gap-1.5 pt-2 pb-1 border-b border-[#dde1e6] dark:border-[#2a333e]">
                <Home size={13} className="text-[#c9690f]" /> 2. Vị trí phòng lưu trú (Liên kết từ dữ liệu công nhân)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Khu KTX <span className="text-[#b3362b]">*</span></label>
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
                  <label className={labelCls}>Dãy nhà <span className="text-[#b3362b]">*</span></label>
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
                  <label className={labelCls}>Phòng số <span className="text-[#b3362b]">*</span></label>
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
            <div className="grid grid-cols-2 gap-3 text-xs bg-[#f3f4f6] dark:bg-[#11151a] p-3.5 rounded border border-[#dde1e6] dark:border-[#2a333e]">
              <div className="col-span-2">
                <span className="text-gray-500 block">Họ và tên</span>
                <p className="font-bold text-sm text-[#1b2430] dark:text-white mt-0.5">{reg.ho_va_ten}</p>
              </div>
              <div>
                <span className="text-gray-500 block">Mã nhân viên</span>
                <p className="font-mono font-semibold mt-0.5">{reg.ma_nv || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 block">Số CCCD</span>
                <p className="font-mono font-semibold mt-0.5">{reg.so_cccd}</p>
              </div>
              <div>
                <span className="text-gray-500 block">Số điện thoại</span>
                <p className="font-semibold mt-0.5">{reg.so_dien_thoai}</p>
              </div>
              <div>
                <span className="text-gray-500 block">Đơn vị</span>
                <p className="font-semibold mt-0.5">{reg.don_vi || '—'}</p>
              </div>
              <div className="col-span-2 pt-2 border-t border-[#dde1e6] dark:border-[#2a333e]">
                <span className="text-gray-500 block">Vị trí phòng ở</span>
                <p className="font-bold mt-0.5">
                  {reg.ktx} — {reg.day} — Phòng {reg.phong_so} {reg.giuong ? `(G.${reg.giuong})` : ''}
                </p>
              </div>
            </div>
          )}

          {reg.cccd_image_url && (
            <div>
              <span className="text-xs text-gray-500 block mb-1">Ảnh chụp CCCD</span>
              <img
                src={reg.cccd_image_url}
                alt={`Ảnh CCCD của ${reg.ho_va_ten}`}
                className="w-full rounded border border-[#dde1e6] dark:border-[#2a333e] object-cover max-h-48"
              />
            </div>
          )}

          {isPending && (
            <div className="flex gap-2.5 pt-3 border-t border-[#dde1e6] dark:border-[#2a333e]">
              <button
                type="button"
                onClick={() => onReject(reg.id)}
                disabled={isProcessing}
                className="flex-1 py-2 px-3 border border-[#b3362b] text-[#b3362b] hover:bg-[#fbebe9] dark:hover:bg-[#3b1814] rounded text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer text-center"
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <XCircle size={13} className="inline mr-1" />}
                Từ chối hồ sơ
              </button>
              <button
                type="button"
                onClick={handleApproveSubmit}
                disabled={isProcessing}
                className="flex-1 py-2 px-3 bg-[#1f7a45] hover:bg-[#186036] text-white rounded text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer text-center"
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <CheckCircle2 size={13} className="inline mr-1" />}
                Duyệt hồ sơ (Lưu bản chỉnh sửa)
              </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#fbebe9] text-[#b3362b] flex items-center justify-center shrink-0">
            <Trash2 size={16} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-[#1b2430] dark:text-white">Xóa hồ sơ đăng ký</h3>
            <p className="text-xs text-[#4b5563] dark:text-[#9ca3af]">Thao tác không thể hoàn tác</p>
          </div>
        </div>
        <p className="text-xs text-[#1b2430] dark:text-gray-300">
          Bạn có chắc chắn muốn xóa hồ sơ của <strong>{name}</strong> khỏi hệ thống?
        </p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 py-1.5 border border-[#dde1e6] dark:border-[#2a333e] rounded text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 py-1.5 bg-[#b3362b] hover:bg-[#8f2b22] text-white rounded text-xs font-bold transition-colors cursor-pointer"
          >
            {deleting ? 'Đang xóa...' : 'Xác nhận xóa'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QRCodeDisplay({ url }: { url: string }) {
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}&margin=10&color=1b2430&bgcolor=ffffff`;
  const qrLargeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(url)}&margin=20&color=1b2430&bgcolor=ffffff`;
  const [showPrintView, setShowPrintView] = useState(false);

  const handleDownload = async () => {
    try {
      const response = await fetch(qrLargeUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'qr-dang-ky-cu-tru.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(qrLargeUrl, '_blank');
    }
  };

  const handlePrint = () => {
    setShowPrintView(true);
    setTimeout(() => {
      window.print();
      setShowPrintView(false);
    }, 300);
  };

  return (
    <>
      {showPrintView && (
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center p-8 print:block text-black" id="print-area">
          <div className="text-center space-y-4 max-w-sm mx-auto">
            <h2 className="text-xl font-bold uppercase tracking-wider">Đăng Ký Cư Trú KTX Phước Vĩnh Tây</h2>
            <p className="text-xs text-gray-600">Quét mã QR dưới đây để điền thông tin</p>
            <img src={qrLargeUrl} alt="QR Code" className="w-56 h-56 mx-auto border-2 border-black p-2" />
            <p className="text-xs font-mono break-all">{url}</p>
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md p-4">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="shrink-0 flex flex-col items-center gap-2.5">
            <div className="p-2 border border-[#dde1e6] dark:border-[#2a333e] bg-white rounded">
              <img src={qrApiUrl} alt="QR Code đăng ký" width={160} height={160} className="w-36 h-36" />
            </div>
            <div className="flex gap-1.5 w-full">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-[#1b2430] hover:bg-[#2a3749] text-white rounded text-[11px] font-semibold cursor-pointer"
              >
                <Download size={12} /> Tải mã
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 border border-[#dde1e6] dark:border-[#2a333e] hover:bg-gray-100 dark:hover:bg-gray-800 text-[#1b2430] dark:text-gray-300 rounded text-[11px] font-semibold cursor-pointer"
              >
                <Printer size={12} /> In ấn
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-2 text-center sm:text-left">
            <div>
              <span className="text-[11px] font-bold uppercase text-[#c9690f] tracking-wider">Mã Tiếp Nhận Công Nhân Mới</span>
              <h3 className="font-bold text-sm text-[#1b2430] dark:text-white mt-0.5">Mã QR Đăng Ký Cư Trú Trực Tuyến</h3>
              <p className="text-xs text-[#4b5563] dark:text-[#9ca3af] mt-1 leading-relaxed">
                Niêm yết tại cổng bảo vệ hoặc văn phòng KTX. Công nhân sử dụng Zalo hoặc camera điện thoại quét mã để khai báo họ tên, CCCD, phòng ở và đơn vị công tác.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-xs text-gray-500 font-mono bg-[#f3f4f6] dark:bg-[#11151a] px-2 py-1 rounded border border-[#dde1e6] dark:border-[#2a333e] break-all">
                {url}
              </span>
              <a
                href="/register"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#c9690f] hover:underline font-semibold"
              >
                <ExternalLink size={12} /> Mở trang đăng ký
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function QRPortalClient() {
  const [registrations, setRegistrations] = useState<WorkerRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const [detailReg, setDetailReg] = useState<WorkerRegistration | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [registerUrl, setRegisterUrl] = useState('/register');
  const [deleteTarget, setDeleteTarget] = useState<WorkerRegistration | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bộ lọc theo KTX / Dãy / Phòng (Requirement 3)
  const [selectedKtx, setSelectedKtx] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<string>('all');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Phân cấp KTX / Dãy / Phòng từ dữ liệu công nhân (workers)
  const [hierarchy, setHierarchy] = useState<WorkerHierarchyData>({
    units: [],
    ktxList: [],
    daysByKtx: {},
    roomsByKtxDay: {},
    workers: [],
  });

  const { currentUser, isAdmin, canWriteBlock } = useAuth();
  const supabase = createClient();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRegisterUrl(`${window.location.origin}/register`);
    }
    fetchWorkerHierarchy().then(setHierarchy).catch(err => {
      console.warn('QRPortalClient fetchWorkerHierarchy error:', err);
    });
  }, []);

  const fetchRegistrations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('worker_registrations')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error) {
        setRegistrations((data || []).filter(r => !r.ghi_chu?.startsWith('[CHECKOUT]')));
      }
    } catch (e: any) {
      console.error('Fetch registrations error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  // Phân quyền Staff (Requirement 5)
  const scopedRegistrations = useMemo(() => {
    return registrations.filter(r => isAdmin || canWriteBlock(r.day, r.ktx));
  }, [registrations, isAdmin, canWriteBlock]);

  // Phê duyệt hồ sơ — Lưu bản chỉnh sửa (Requirement 2)
  const handleApprove = async (regToApprove: WorkerRegistration) => {
    setProcessing(regToApprove.id);
    try {
      const nowStr = new Date().toISOString();

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
          ktx: regToApprove.ktx || '',
          day: regToApprove.day || '',
          phong_so: regToApprove.phong_so || '',
          giuong: regToApprove.giuong || '',
          ngay_vao_ktx: regToApprove.ngay_vao_ktx || '',
          ghi_chu: regToApprove.ghi_chu || '',
          status: 'approved',
          reviewed_by: currentUser?.id,
          reviewed_at: nowStr,
        })
        .eq('id', regToApprove.id);

      if (updateErr) throw new Error(updateErr.message);

      const workerId = `reg-${regToApprove.id}`;
      const { error: insertErr } = await supabase.from('workers').upsert({
        id: workerId,
        stt: 0,
        ho_va_ten: regToApprove.ho_va_ten || '',
        ma_nv: regToApprove.ma_nv || '',
        tieu_doan: regToApprove.tieu_doan || '',
        ktx: regToApprove.ktx || '',
        don_vi: regToApprove.don_vi || '',
        gioi_tinh: regToApprove.gioi_tinh || '',
        ngay_sinh: regToApprove.ngay_sinh || '',
        so_dien_thoai: regToApprove.so_dien_thoai || '',
        day: regToApprove.day || '',
        phong_so: regToApprove.phong_so || '',
        giuong: regToApprove.giuong || '',
        cccd: regToApprove.so_cccd || '',
        ho_khau_tinh: regToApprove.ho_khau_tinh || regToApprove.que_quan || '',
        to_truong: regToApprove.to_truong || '',
        sdt_to_truong: regToApprove.sdt_to_truong || '',
        ngay_vao_ktx: regToApprove.ngay_vao_ktx || '',
        ngay_ra_ktx: '',
        ghi_chu: regToApprove.ghi_chu || '',
        khoa_tra_cuu: `${regToApprove.day || ''}|${regToApprove.phong_so || ''}|${regToApprove.giuong || ''}`,
        avatar: regToApprove.cccd_image_url || '',
        tam_tru_status: 'registered',
      }, { onConflict: 'id' });

      if (insertErr) {
        console.warn('Insert to workers warning:', insertErr.message);
      }

      setRegistrations(prev =>
        prev.map(r => (r.id === regToApprove.id ? { ...regToApprove, status: 'approved', reviewed_at: nowStr } : r))
      );
      if (detailReg?.id === regToApprove.id) {
        setDetailReg({ ...regToApprove, status: 'approved', reviewed_at: nowStr });
      }
    } catch (e: any) {
      console.error('Approve error:', e.message);
      alert(`Lỗi khi phê duyệt: ${e?.message || 'Không thể cập nhật'}`);
    } finally {
      setProcessing(null);
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
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('worker_registrations')
        .delete()
        .eq('id', deleteTarget.id);
      if (!error) {
        setRegistrations(prev => prev.filter(r => r.id !== deleteTarget.id));
        if (detailReg?.id === deleteTarget.id) setDetailReg(null);
      }
    } catch (e: any) {
      console.error('Delete error:', e.message);
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
  }, [scopedRegistrations, filterStatus, selectedKtx, selectedDay, selectedRoom, searchQuery]);

  const counts = {
    pending: scopedRegistrations.filter(r => r.status === 'pending').length,
    approved: scopedRegistrations.filter(r => r.status === 'approved').length,
    rejected: scopedRegistrations.filter(r => r.status === 'rejected').length,
  };

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

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-[#1b2430] dark:text-white uppercase">
            HỒ SƠ ĐĂNG KÝ CƯ TRÚ
          </h1>
          <p className="text-xs text-[#4b5563] dark:text-[#9ca3af] mt-0.5">
            Duyệt và phân bổ phòng cho công nhân mới quét mã đăng ký trực tuyến
          </p>
        </div>
        <button
          onClick={() => fetchRegistrations(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#dde1e6] dark:border-[#2a333e] bg-white dark:bg-[#181d24] text-[#1b2430] dark:text-gray-300 rounded text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60 cursor-pointer w-fit"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Phân quyền Staff */}
      {!isAdmin && (
        <div className="p-2.5 bg-[#fdf1e4] dark:bg-[#281d14] border border-[#c9690f]/30 rounded text-xs text-[#853d07] dark:text-[#f39c55] flex items-center gap-2">
          <Building2 size={14} className="shrink-0 text-[#c9690f]" />
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
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md grid grid-cols-3 divide-x divide-[#dde1e6] dark:divide-[#2a333e] overflow-hidden">
        {[
          {
            key: 'pending',
            label: 'Chờ duyệt',
            count: counts.pending,
            activeColor: 'bg-[#fdf1e4] dark:bg-[#281d14] text-[#c9690f]',
            numColor: 'text-[#c9690f]',
          },
          {
            key: 'approved',
            label: 'Đã duyệt',
            count: counts.approved,
            activeColor: 'bg-[#eaf6ef] dark:bg-[#103320] text-[#1f7a45]',
            numColor: 'text-[#1f7a45]',
          },
          {
            key: 'rejected',
            label: 'Từ chối',
            count: counts.rejected,
            activeColor: 'bg-[#fbebe9] dark:bg-[#3b1814] text-[#b3362b]',
            numColor: 'text-[#b3362b]',
          },
        ].map(s => {
          const isSelected = filterStatus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setFilterStatus(s.key as any)}
              className={`p-3 text-center transition-colors cursor-pointer ${
                isSelected ? s.activeColor : 'hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              <div className={`text-2xl font-bold font-mono ${s.numColor}`}>
                {s.count}
              </div>
              <div className="text-xs font-semibold mt-0.5 uppercase tracking-wider text-[#4b5563] dark:text-[#9ca3af]">
                {s.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* THANH BỘ LỌC LIỀN KHỐI (Requirement: Segmented filter button group + console filters) */}
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Nhóm nút lọc trạng thái liền khối (Navy #1b2430 khi active) */}
          <div className="inline-flex border border-[#dde1e6] dark:border-[#2a333e] rounded overflow-hidden divide-x divide-[#dde1e6] dark:divide-[#2a333e]">
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
                      ? 'bg-[#1b2430] text-white'
                      : 'bg-white dark:bg-[#181d24] text-[#4b5563] dark:text-[#9ca3af] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Ô tìm kiếm console */}
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm tên, CCCD, SĐT, mã NV..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Bộ lọc vị trí KTX / Dãy / Phòng */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2.5 border-t border-[#dde1e6] dark:border-[#2a333e]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap min-w-[50px]">Khu KTX:</span>
            <select
              value={selectedKtx}
              onChange={e => {
                setSelectedKtx(e.target.value);
                setSelectedDay('all');
                setSelectedRoom('all');
              }}
              className="flex-1 py-1 px-2 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            >
              <option value="all">Tất cả KTX</option>
              {hierarchy.ktxList.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap min-w-[50px]">Dãy nhà:</span>
            <select
              value={selectedDay}
              onChange={e => {
                setSelectedDay(e.target.value);
                setSelectedRoom('all');
              }}
              className="flex-1 py-1 px-2 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            >
              <option value="all">Tất cả Dãy</option>
              {filterAvailableDays.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap min-w-[50px]">Phòng số:</span>
            <select
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              className="flex-1 py-1 px-2 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            >
              <option value="all">Tất cả Phòng</option>
              {filterAvailableRooms.map(p => (
                <option key={p} value={p}>Phòng {p}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* BẢNG DANH SÁCH (TABLE) THAY VÌ CARD STACK (Requirement: Operations Table View) */}
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500 text-xs">
            <Loader2 size={18} className="animate-spin mr-2 text-[#c9690f]" />
            <span>Đang tải danh sách hồ sơ...</span>
          </div>
        ) : filtered.length === 0 ? (
          /* TRẠNG THÁI RỖNG (Requirement: Khung viền đứt nét, icon đơn giản, tiêu đề in đậm) */
          <div className="p-10 border border-dashed border-[#dde1e6] dark:border-[#2a333e] m-4 rounded text-center space-y-1.5">
            <Inbox size={32} className="mx-auto text-gray-400 stroke-1" />
            <h4 className="font-bold text-sm text-[#1b2430] dark:text-white">Không có hồ sơ nào phù hợp</h4>
            <p className="text-xs text-[#4b5563] dark:text-[#9ca3af] max-w-sm mx-auto">
              Không tìm thấy hồ sơ đăng ký nào theo bộ lọc hoặc từ khóa hiện tại. Thử chọn &quot;Tất cả&quot; hoặc xóa điều kiện lọc.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#f3f4f6] dark:bg-[#11151a] border-b border-[#dde1e6] dark:border-[#2a333e] text-[11px] font-bold text-[#4b5563] dark:text-[#9ca3af] uppercase tracking-wider">
                  <th className="py-2.5 px-3">CÔNG NHÂN</th>
                  <th className="py-2.5 px-3">LIÊN HỆ & CCCD</th>
                  <th className="py-2.5 px-3">ĐƠN VỊ / TỔ</th>
                  <th className="py-2.5 px-3">VỊ TRÍ ĐĂNG KÝ</th>
                  <th className="py-2.5 px-3">NGÀY GỬI</th>
                  <th className="py-2.5 px-3">TRẠNG THÁI</th>
                  <th className="py-2.5 px-3 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dde1e6] dark:divide-[#2a333e]">
                {filtered.map(reg => {
                  const cfg = STATUS_CONFIG[reg.status];
                  const isProcessing = processing === reg.id;
                  const isDone = reg.status === 'approved' || reg.status === 'rejected';
                  const dupMatch = checkDuplicateWorker(hierarchy.workers, reg.so_cccd, reg.so_dien_thoai);

                  return (
                    <tr
                      key={reg.id}
                      className={`transition-colors ${
                        dupMatch
                          ? 'border-l-[3px] border-l-[#c9690f] bg-[#fdf1e4]/25 dark:bg-[#281d14]/25 hover:bg-[#fdf1e4]/40 dark:hover:bg-[#281d14]/40'
                          : 'hover:bg-[#f9fafb] dark:hover:bg-[#1e242d]'
                      }`}
                    >
                      {/* Cột 1: Tên & Mã NV */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-[#1b2430] dark:text-white text-xs sm:text-sm">
                          {reg.ho_va_ten}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {reg.ma_nv ? (
                            <span className="font-mono text-[11px] text-gray-500 bg-gray-100 dark:bg-gray-800 px-1 rounded">
                              {reg.ma_nv}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">Chưa có mã</span>
                          )}
                          {reg.gioi_tinh && (
                            <span className="text-[11px] text-gray-400">· {reg.gioi_tinh}</span>
                          )}
                        </div>
                        {/* Nhãn cảnh báo trùng màu đỏ nổi bật (Requirement) */}
                        {dupMatch && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#fbebe9] text-[#b3362b] border border-[#b3362b]/30">
                              <AlertTriangle size={10} /> Trùng {dupMatch.field}
                            </span>
                            <p className="text-[10px] text-[#b3362b] dark:text-red-400 mt-0.5 font-medium leading-tight">
                              Khớp với: {dupMatch.worker.hoVaTen} [{dupMatch.worker.maNV || '—'}] ({dupMatch.worker.ktx} - {dupMatch.worker.day} - P.{dupMatch.worker.phongSo})
                            </p>
                          </div>
                        )}
                      </td>

                      {/* Cột 2: CCCD & SĐT */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="font-mono font-medium text-xs text-[#1b2430] dark:text-gray-200">
                          {reg.so_cccd || '—'}
                        </div>
                        <div className="text-[11px] text-[#4b5563] dark:text-gray-400 mt-0.5 flex items-center gap-1">
                          <Phone size={10} />
                          <span>{reg.so_dien_thoai || '—'}</span>
                        </div>
                      </td>

                      {/* Cột 3: Đơn vị / Tổ */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-semibold text-xs text-[#1b2430] dark:text-gray-200">
                          {reg.don_vi || '—'}
                        </div>
                        {reg.tieu_doan && (
                          <div className="text-[11px] text-[#4b5563] dark:text-gray-400 mt-0.5">
                            TĐ: {reg.tieu_doan}
                          </div>
                        )}
                      </td>

                      {/* Cột 4: Vị trí đăng ký */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-xs text-[#1b2430] dark:text-white">
                          {reg.ktx} — {reg.day}
                        </div>
                        <div className="text-[11px] text-[#4b5563] dark:text-gray-400 mt-0.5">
                          Phòng {reg.phong_so} {reg.giuong ? `(Giường ${reg.giuong})` : ''}
                        </div>
                      </td>

                      {/* Cột 5: Ngày gửi */}
                      <td className="py-2.5 px-3 align-top text-[11px] text-[#4b5563] dark:text-gray-400 whitespace-nowrap">
                        {new Date(reg.created_at).toLocaleDateString('vi-VN')}
                        <div className="text-[10px] text-gray-400">
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
                            className="inline-flex items-center gap-1 px-2 py-1 border border-[#dde1e6] dark:border-[#2a333e] bg-white dark:bg-[#181d24] text-[#374151] dark:text-[#d1d5db] hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-xs font-medium cursor-pointer"
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
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-[#b3362b] text-[#b3362b] hover:bg-[#fbebe9] dark:hover:bg-[#3b1814] rounded text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                                title="Từ chối hồ sơ"
                              >
                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                <span>Từ chối</span>
                              </button>
                              <button
                                onClick={() => handleApprove(reg)}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1f7a45] hover:bg-[#186036] text-white rounded text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
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
                              className="p-1 border border-[#dde1e6] dark:border-[#2a333e] text-gray-400 hover:text-[#b3362b] hover:border-[#b3362b] rounded cursor-pointer transition-colors"
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
