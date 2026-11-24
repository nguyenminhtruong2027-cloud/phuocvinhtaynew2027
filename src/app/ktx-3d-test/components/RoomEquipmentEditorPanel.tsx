'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Edit3, Loader2, Save, Wrench, X } from 'lucide-react';
import type { CampusRoomNode } from '../types';

export interface FacilityEquipmentPatch {
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

interface RoomEquipmentEditorPanelProps {
  room: CampusRoomNode;
  isLight: boolean;
  saving: boolean;
  defaultEditing?: boolean;
  onSave: (room: CampusRoomNode, patch: FacilityEquipmentPatch) => Promise<boolean>;
  onClose: () => void;
}

const QUICK_ISSUE_TEMPLATES = [
  'Hỏng điều hòa',
  'Hỏng quạt treo tường',
  'Cháy bóng đèn tuýp',
  'Hỏng ổ cắm / điện',
  'Hỏng khóa cửa / tủ',
  'Rò rỉ nước / thấm dột',
];

const EQUIPMENT_FIELDS: {
  key: keyof Omit<FacilityEquipmentPatch, 'ghi_chu'>;
  label: string;
  max: number;
}[] = [
  { key: 'giuong', label: 'Giường', max: 40 },
  { key: 'dieu_hoa', label: 'Điều hòa', max: 10 },
  { key: 'quat', label: 'Quạt', max: 20 },
  { key: 'tu', label: 'Tủ cá nhân', max: 30 },
  { key: 'bong_tuyp', label: 'Bóng đèn', max: 30 },
  { key: 'o_cam_dien', label: 'Ổ cắm', max: 30 },
  { key: 'remote', label: 'Remote ĐH', max: 10 },
  { key: 'ban_an', label: 'Bàn', max: 30 },
  { key: 'ghe_an', label: 'Ghế', max: 100 },
];

function buildInitialForm(room: CampusRoomNode): FacilityEquipmentPatch {
  const f = room.facility;
  return {
    giuong: Number(f?.giuong ?? room.capacity ?? 0) || 0,
    dieu_hoa: Number(f?.dieu_hoa ?? 0) || 0,
    tu: Number(f?.tu ?? 0) || 0,
    quat: Number(f?.quat ?? 0) || 0,
    o_cam_dien: Number(f?.o_cam_dien ?? 0) || 0,
    remote: Number(f?.remote ?? 0) || 0,
    bong_tuyp: Number(f?.bong_tuyp ?? 0) || 0,
    ban_an: Number(f?.ban_an ?? 0) || 0,
    ghe_an: Number(f?.ghe_an ?? 0) || 0,
    ghi_chu: (f?.ghi_chu || '').trim(),
  };
}

export default function RoomEquipmentEditorPanel({
  room,
  isLight,
  saving,
  defaultEditing = false,
  onSave,
  onClose,
}: RoomEquipmentEditorPanelProps) {
  const canEdit = Boolean(room.hasWriteAccess && room.facility?.id);
  const [editing, setEditing] = useState(defaultEditing && canEdit);
  const [form, setForm] = useState<FacilityEquipmentPatch>(() => buildInitialForm(room));

  useEffect(() => {
    setForm(buildInitialForm(room));
    setEditing(defaultEditing && Boolean(room.hasWriteAccess && room.facility?.id));
  }, [room, defaultEditing]);

  const hudCard = isLight
    ? 'bg-white/95 border-slate-300 text-slate-900 shadow-lg'
    : 'bg-[#0f172a]/95 border-slate-700/85 text-slate-100 shadow-2xl';
  const hudMuted = isLight ? 'text-slate-600' : 'text-slate-400';
  const hudDivider = isLight ? 'border-slate-200' : 'border-slate-800';
  const hudSubtleBtn = isLight
    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200';
  const tileBg = isLight
    ? 'bg-slate-50 border-slate-200'
    : 'bg-slate-900/75 border-slate-800';
  const inputCls = isLight
    ? 'bg-white border-slate-300 text-slate-900 focus:border-blue-500'
    : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-blue-500';

  const updateNum = (key: keyof Omit<FacilityEquipmentPatch, 'ghi_chu'>, nextVal: number, max: number) => {
    const clamped = Math.max(0, Math.min(max, Math.floor(Number.isFinite(nextVal) ? nextVal : 0)));
    setForm(prev => ({ ...prev, [key]: clamped }));
  };

  const appendIssueTemplate = (snippet: string) => {
    setForm(prev => {
      const curr = prev.ghi_chu.trim();
      if (!curr) return { ...prev, ghi_chu: snippet };
      if (curr.toLowerCase().includes(snippet.toLowerCase())) return prev;
      return { ...prev, ghi_chu: `${curr}; ${snippet}` };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || saving) return;
    const ok = await onSave(room, {
      ...form,
      ghi_chu: form.ghi_chu.trim(),
    });
    if (ok) {
      setEditing(false);
    }
  };

  return (
    <div className={`rounded-2xl border p-3.5 w-full max-w-md max-h-[78vh] overflow-y-auto scrollbar-thin ${hudCard}`}>
      <div className={`flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b ${hudDivider}`}>
        <div className="min-w-0">
          <span className="text-xs font-bold flex items-center gap-1.5">
            <Wrench size={13} className="text-blue-500 shrink-0" />
            <span className="truncate">
              Cơ sở vật chất · {room.day} · {room.roomLabel}
            </span>
          </span>
          {(room.maintenanceBedCount > 0 || room.hasFacilityIssue) && (
            <p className="text-[11px] font-semibold text-orange-500 mt-0.5 flex items-center gap-1">
              <AlertTriangle size={11} className="shrink-0" />
              <span>
                {[
                  room.maintenanceBedCount > 0
                    ? `${room.maintenanceBedCount} giường đang bảo trì`
                    : null,
                  room.hasFacilityIssue ? 'Có ghi chú sự cố thiết bị' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
            >
              <Edit3 size={11} />
              <span>Sửa / Báo hỏng</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded-lg ${hudMuted} hover:text-blue-500`}
            aria-label="Đóng bảng thiết bị"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!room.facility ? (
        <p className={`text-xs py-2 ${hudMuted}`}>
          Phòng này chưa có bản ghi thiết bị trong trang Cơ sở vật chất. Mô hình 3D đang dùng cấu hình mặc định.
        </p>
      ) : editing ? (
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-3 gap-1.5 font-tabular">
            {EQUIPMENT_FIELDS.map(field => {
              const disabled = field.key === 'giuong' && room.roomType === 'functional';
              return (
                <div key={field.key} className={`rounded-xl border px-2 py-1.5 ${tileBg}`}>
                  <label
                    htmlFor={`eq-${field.key}`}
                    className={`block text-[10px] font-semibold mb-1 ${hudMuted}`}
                  >
                    {field.label}
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={disabled || saving || form[field.key] <= 0}
                      onClick={() => updateNum(field.key, form[field.key] - 1, field.max)}
                      className={`w-5 h-6 rounded border text-xs font-bold flex items-center justify-center disabled:opacity-40 ${hudSubtleBtn}`}
                      aria-label={`Giảm ${field.label}`}
                    >
                      -
                    </button>
                    <input
                      id={`eq-${field.key}`}
                      type="number"
                      min={0}
                      max={field.max}
                      disabled={disabled || saving}
                      value={form[field.key]}
                      onChange={e => updateNum(field.key, parseInt(e.target.value, 10) || 0, field.max)}
                      className={`w-full min-w-0 h-6 rounded border px-1 text-center text-xs font-bold focus:outline-none ${inputCls}`}
                    />
                    <button
                      type="button"
                      disabled={disabled || saving || form[field.key] >= field.max}
                      onClick={() => updateNum(field.key, form[field.key] + 1, field.max)}
                      className={`w-5 h-6 rounded border text-xs font-bold flex items-center justify-center disabled:opacity-40 ${hudSubtleBtn}`}
                      aria-label={`Tăng ${field.label}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="eq-ghi-chu" className="text-[11px] font-bold">
                Ghi chú / Báo hỏng sự cố CSVC
              </label>
              {form.ghi_chu.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, ghi_chu: '' }))}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500 hover:underline"
                >
                  <Check size={10} />
                  <span>Đã khắc phục (xóa ghi chú)</span>
                </button>
              )}
            </div>

            <textarea
              id="eq-ghi-chu"
              rows={2}
              value={form.ghi_chu}
              disabled={saving}
              onChange={e => setForm(prev => ({ ...prev, ghi_chu: e.target.value }))}
              placeholder="VD: Hỏng điều hòa số 1, cháy 2 bóng đèn tuýp..."
              className={`w-full rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none resize-none ${inputCls}`}
            />

            <div className="flex flex-wrap gap-1">
              {QUICK_ISSUE_TEMPLATES.map(tpl => (
                <button
                  key={tpl}
                  type="button"
                  disabled={saving}
                  onClick={() => appendIssueTemplate(tpl)}
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-colors ${hudSubtleBtn}`}
                >
                  + {tpl}
                </button>
              ))}
            </div>
          </div>

          <div className={`flex items-center justify-end gap-2 pt-2 border-t ${hudDivider}`}>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(buildInitialForm(room));
                setEditing(false);
              }}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${hudSubtleBtn}`}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              <span>Lưu &amp; Đồng bộ 3D</span>
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-2.5 text-xs">
          <div className="grid grid-cols-3 gap-1.5 font-tabular">
            {EQUIPMENT_FIELDS.map(field => {
              const val = Number(room.facility?.[field.key]) || 0;
              return (
                <div key={field.key} className={`rounded-xl border px-2 py-1.5 ${tileBg}`}>
                  <span className={`block text-[10px] ${hudMuted}`}>{field.label}</span>
                  <span className="font-bold text-xs">{val}</span>
                </div>
              );
            })}
          </div>

          {room.facility.ghi_chu ? (
            <div
              className={`text-[11px] rounded-xl border px-2.5 py-2 ${
                room.hasFacilityIssue
                  ? isLight
                    ? 'bg-orange-50 border-orange-300 text-orange-900'
                    : 'bg-orange-950/50 border-orange-500/40 text-orange-200'
                  : isLight
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
              }`}
            >
              <span className="font-bold">Ghi chú / Sự cố:</span> {room.facility.ghi_chu}
            </div>
          ) : (
            <p className={`text-[11px] ${hudMuted}`}>
              Thiết bị ổn định · Chưa có ghi chú sự cố nào.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
