'use client';
import React from 'react';
import { Worker, calcSoNgay } from '@/data/workers';
import { X, Pencil, Trash2, Phone, MapPin, Calendar, Building2, Shield, User, CreditCard, Users } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';



interface Props {
  worker: Worker;
  onClose: () => void;
  onEdit: (w: Worker) => void;
  onDelete?: (w: Worker) => void;
  /** If false, Edit buttons are hidden/disabled (read-only mode for staff without write access) */
  canEdit?: boolean;
}

function DetailRow({ label, value, icon: Icon, mono }: { label: string; value: string; icon?: React.ComponentType<{ size?: number; className?: string }>; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      {Icon && <Icon size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={`text-sm text-foreground mt-0.5 ${mono ? 'font-tabular' : 'font-medium'} break-words`}>
          {value || <span className="text-muted-foreground italic text-xs">Chưa có thông tin</span>}
        </p>
      </div>
    </div>
  );
}

export default function WorkerDetailModal({ worker: w, onClose, onEdit, onDelete, canEdit = true }: Props) {
  const tieuDoanClass = w.tieuDoan === '8' ? 'badge-platoon-8' : w.tieuDoan === '111' ? 'badge-platoon-111' : w.tieuDoan === '113' ? 'badge-platoon-113' : 'badge-pending';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm fade-in">
      <div className="modal-enter bg-card rounded-xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-lg font-bold flex-shrink-0">
            {w.hoVaTen.split(' ').pop()?.charAt(0) ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground truncate">{w.hoVaTen}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {w.tieuDoan ? (
                <span className={tieuDoanClass}>TD {w.tieuDoan}</span>
              ) : (
                <span className="badge-pending">Chưa phân bổ</span>
              )}
              <span className="text-xs text-muted-foreground">{w.day} · Phòng {w.phongSo} · Giường {w.giuong || '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canEdit ? (
              <button onClick={() => onEdit(w)} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Chỉnh sửa">
                <Pencil size={15} />
              </button>
            ) : (
              <button disabled title="Bạn không có quyền sửa công nhân thuộc KTX/Dãy này" className="p-2 rounded-lg text-muted-foreground/30 cursor-not-allowed">
                <Pencil size={15} />
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete(w)} className="p-2 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors" title="Xóa">
                <Trash2 size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors ml-1">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-2">Thông tin cá nhân</p>
              <DetailRow label="Họ và Tên" value={w.hoVaTen} icon={User} />
              <DetailRow label="Mã nhân viên" value={w.maNV} icon={CreditCard} mono />
              <DetailRow label="Giới tính" value={w.gioiTinh} />
              <DetailRow label="Ngày sinh" value={w.ngaySinh} icon={Calendar} mono />
              <DetailRow label="Số điện thoại" value={w.soDienThoai} icon={Phone} mono />
              <DetailRow label="CCCD" value={w.cccd} icon={CreditCard} mono />
              <DetailRow label="Hộ khẩu Tỉnh/TP" value={w.hoKhauTinh} icon={MapPin} />
              {w.avatar && (
                <div className="py-2.5 border-b border-border">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">Ảnh CCCD</p>
                  <a href={w.avatar} target="_blank" rel="noopener noreferrer">
                    <img src={w.avatar} alt={`Ảnh CCCD của ${w.hoVaTen}`} className="w-full max-w-[180px] rounded-lg border border-border object-cover hover:opacity-90 transition-opacity cursor-pointer" />
                  </a>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-2">Thông tin KTX</p>
              <DetailRow label="KTX" value={w.ktx} icon={Building2} />
              <DetailRow label="Đơn vị" value={w.donVi} />
              <DetailRow label="Tiểu đoàn" value={w.tieuDoan || 'Chưa phân'} icon={Shield} />
              <DetailRow label="Dãy nhà" value={w.day} icon={Building2} />
              <DetailRow label="Phòng số" value={w.phongSo} />
              <DetailRow label="Số giường" value={w.giuong || '—'} />
              <DetailRow label="Ngày vào KTX" value={w.ngayVaoKTX} icon={Calendar} mono />
              <DetailRow label="Ngày ra KTX" value={w.ngayRaKTX || 'Đang ở'} mono />
              <DetailRow label="Số ngày lưu trú" value={calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX) !== null ? `${calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX)} ngày` : '—'} />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-3">Tổ trưởng</p>
              <DetailRow label="Họ tên tổ trưởng" value={w.toTruong} icon={Users} />
              <DetailRow label="SĐT tổ trưởng" value={w.sdtToTruong} icon={Phone} mono />
              {w.ghiChu && (
                <>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-3">Ghi chú</p>
                  <p className="text-sm text-foreground">{w.ghiChu}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-xs">Đóng</button>
          {canEdit ? (
            <button onClick={() => onEdit(w)} className="btn-primary text-xs">
              <Pencil size={13} />
              Chỉnh sửa
            </button>
          ) : (
            <button disabled className="btn-primary text-xs opacity-40 cursor-not-allowed">
              <Pencil size={13} />
              Chỉ xem
            </button>
          )}
        </div>
      </div>
    </div>
  );
}