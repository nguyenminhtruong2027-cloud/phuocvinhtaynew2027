'use client';

import React, { useMemo, useState } from 'react';
import { X, Layers, CheckCircle2, Loader2 } from 'lucide-react';
import { naturalSortCompare } from '@/data/workers';

export type EquipmentNumericField =
  | 'giuong'
  | 'dieu_hoa'
  | 'tu'
  | 'quat'
  | 'o_cam_dien'
  | 'remote'
  | 'bong_tuyp'
  | 'ban_an'
  | 'ghe_an';

export interface BulkEquipmentRowLite {
  id: string;
  ktx: string;
  day: string;
  phong_khu_vuc: string;
  room_type: 'accommodation' | 'functional';
  is_visible: boolean;
}

interface Props {
  allRows: BulkEquipmentRowLite[];
  selectedIds: Set<string>;
  activeKtx: string;
  applying: boolean;
  onApply: (
    targetIds: string[],
    patch: Partial<Record<EquipmentNumericField, number>>
  ) => Promise<void>;
  onClose: () => void;
}

const FIELD_META: Array<{ key: EquipmentNumericField; label: string }> = [
  { key: 'giuong', label: 'Giường (chỗ)' },
  { key: 'dieu_hoa', label: 'Điều hòa' },
  { key: 'tu', label: 'Tủ cá nhân' },
  { key: 'quat', label: 'Quạt treo' },
  { key: 'o_cam_dien', label: 'Ổ cắm điện' },
  { key: 'remote', label: 'Remote ĐH' },
  { key: 'bong_tuyp', label: 'Bóng tuýp' },
  { key: 'ban_an', label: 'Bàn ăn' },
  { key: 'ghe_an', label: 'Ghế ăn' },
];

const PRESETS: Array<{
  id: string;
  label: string;
  sub: string;
  values: Record<EquipmentNumericField, number>;
  enabled: EquipmentNumericField[];
}> = [
  {
    id: 'std-20',
    label: 'Phòng 20 chỗ tiêu chuẩn',
    sub: '2 ĐH · 20 Tủ · 4 Quạt · 10 Ổ cắm · 2 Remote · 6 Đèn',
    values: {
      giuong: 20,
      dieu_hoa: 2,
      tu: 20,
      quat: 4,
      o_cam_dien: 10,
      remote: 2,
      bong_tuyp: 6,
      ban_an: 0,
      ghe_an: 0,
    },
    enabled: ['dieu_hoa', 'tu', 'quat', 'o_cam_dien', 'remote', 'bong_tuyp'],
  },
  {
    id: 'basic-20',
    label: 'Phòng 20 chỗ cơ bản',
    sub: '2 ĐH · 10 Tủ · 4 Quạt · 8 Ổ cắm · 2 Remote · 4 Đèn',
    values: {
      giuong: 20,
      dieu_hoa: 2,
      tu: 10,
      quat: 4,
      o_cam_dien: 8,
      remote: 2,
      bong_tuyp: 4,
      ban_an: 0,
      ghe_an: 0,
    },
    enabled: ['dieu_hoa', 'tu', 'quat', 'o_cam_dien', 'remote', 'bong_tuyp'],
  },
  {
    id: 'full-20',
    label: 'Cả giường + toàn bộ thiết bị',
    sub: 'Ghi đè cả 20 giường và toàn bộ thiết bị chuẩn',
    values: {
      giuong: 20,
      dieu_hoa: 2,
      tu: 20,
      quat: 4,
      o_cam_dien: 10,
      remote: 2,
      bong_tuyp: 6,
      ban_an: 0,
      ghe_an: 0,
    },
    enabled: ['giuong', 'dieu_hoa', 'tu', 'quat', 'o_cam_dien', 'remote', 'bong_tuyp', 'ban_an', 'ghe_an'],
  },
];

export default function BulkEquipmentModal({
  allRows,
  selectedIds,
  activeKtx,
  applying,
  onApply,
  onClose,
}: Props) {
  const ktxRows = useMemo(
    () =>
      allRows.filter(
        r => !activeKtx || activeKtx === 'all' || r.ktx.trim() === activeKtx.trim()
      ),
    [allRows, activeKtx]
  );

  const days = useMemo(() => {
    const set = new Set<string>();
    ktxRows.forEach(r => { if (r.day) set.add(r.day); });
    return Array.from(set).sort(naturalSortCompare);
  }, [ktxRows]);

  const [scope, setScope] = useState<'selected' | 'day' | 'all_accommodation'>(() =>
    selectedIds.size > 0 ? 'selected' : 'all_accommodation'
  );
  const [selectedDay, setSelectedDay] = useState<string>(() => days[0] || '');

  const [values, setValues] = useState<Record<EquipmentNumericField, number>>({
    giuong: 20,
    dieu_hoa: 2,
    tu: 20,
    quat: 4,
    o_cam_dien: 10,
    remote: 2,
    bong_tuyp: 6,
    ban_an: 0,
    ghe_an: 0,
  });

  const [enabledFields, setEnabledFields] = useState<Set<EquipmentNumericField>>(
    () => new Set(['dieu_hoa', 'tu', 'quat', 'o_cam_dien', 'remote', 'bong_tuyp'])
  );

  const targetRows = useMemo(() => {
    if (scope === 'selected') {
      return ktxRows.filter(r => selectedIds.has(r.id));
    }
    if (scope === 'day') {
      return ktxRows.filter(
        r => r.day === selectedDay && r.room_type === 'accommodation'
      );
    }
    return ktxRows.filter(r => r.room_type === 'accommodation');
  }, [scope, ktxRows, selectedIds, selectedDay]);

  const toggleField = (k: EquipmentNumericField) => {
    setEnabledFields(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setValues(preset.values);
    setEnabledFields(new Set(preset.enabled));
  };

  const handleConfirm = async () => {
    if (targetRows.length === 0 || enabledFields.size === 0) return;
    const patch: Partial<Record<EquipmentNumericField, number>> = {};
    enabledFields.forEach(k => {
      patch[k] = Math.max(0, Math.floor(Number(values[k]) || 0));
    });
    await onApply(
      targetRows.map(r => r.id),
      patch
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
      onClick={() => { if (!applying) onClose(); }}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-side">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-bdg text-lnk flex items-center justify-center shrink-0">
              <Layers size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                Áp định mức thiết bị hàng loạt
              </h3>
              <p className="text-xs text-mu mt-0.5">
                Cập nhật nhanh số lượng thiết bị cho nhiều phòng hoặc cả Dãy cùng lúc
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={applying}
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Scope Selector */}
          <div>
            <label className="block text-xs font-semibold text-mu mb-1.5">Phạm vi áp dụng</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => setScope('selected')}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer disabled:opacity-45 ${
                  scope === 'selected'
                    ? 'bg-bdg border-pri2 text-tx font-bold'
                    : 'bg-page border-bdr text-mu hover:text-tx'
                }`}
              >
                <div>Phòng đang chọn</div>
                <div className="text-[11px] font-mono tabular-nums mt-0.5">
                  {selectedIds.size} phòng
                </div>
              </button>

              <button
                type="button"
                onClick={() => setScope('day')}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  scope === 'day'
                    ? 'bg-bdg border-pri2 text-tx font-bold'
                    : 'bg-page border-bdr text-mu hover:text-tx'
                }`}
              >
                <div>Theo từng Dãy</div>
                <div className="text-[11px] text-mu mt-0.5">Chọn Dãy cụ thể</div>
              </button>

              <button
                type="button"
                onClick={() => setScope('all_accommodation')}
                className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer ${
                  scope === 'all_accommodation'
                    ? 'bg-bdg border-pri2 text-tx font-bold'
                    : 'bg-page border-bdr text-mu hover:text-tx'
                }`}
              >
                <div>Toàn bộ phòng ở</div>
                <div className="text-[11px] font-mono tabular-nums mt-0.5">
                  {ktxRows.filter(r => r.room_type === 'accommodation').length} phòng
                </div>
              </button>
            </div>

            {scope === 'day' && (
              <div className="mt-2.5">
                <select
                  value={selectedDay}
                  onChange={e => setSelectedDay(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr text-xs sm:text-sm text-tx focus:outline-none focus:border-pri2"
                >
                  {days.map(d => (
                    <option key={d} value={d}>
                      {d} ({ktxRows.filter(r => r.day === d && r.room_type === 'accommodation').length} phòng ở)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-semibold text-mu mb-1.5">Mẫu định mức nhanh</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="p-2.5 rounded-xl bg-page hover:bg-act border border-bdr text-left transition-colors cursor-pointer"
                >
                  <div className="text-xs font-bold text-tx">{p.label}</div>
                  <div className="text-[11px] text-mu mt-0.5 leading-snug">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Numeric Fields with Per-Field Checkbox */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-mu">
                Tích chọn các hạng mục muốn ghi đè ({enabledFields.size}/9)
              </label>
              <span className="text-[11px] text-mu">
                Các mục bỏ tích sẽ giữ nguyên dữ liệu cũ
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {FIELD_META.map(field => {
                const checked = enabledFields.has(field.key);
                return (
                  <div
                    key={field.key}
                    className={`p-2.5 rounded-xl border transition-colors ${
                      checked
                        ? 'bg-page border-pri2/60'
                        : 'bg-act/40 border-bdr opacity-65'
                    }`}
                  >
                    <label className="flex items-center gap-2 text-xs font-semibold text-tx cursor-pointer mb-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleField(field.key)}
                        className="rounded border-bdr accent-pri"
                      />
                      <span className="truncate">{field.label}</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      disabled={!checked}
                      value={values[field.key]}
                      onChange={e =>
                        setValues(prev => ({
                          ...prev,
                          [field.key]: Math.max(0, parseInt(e.target.value, 10) || 0),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surf border border-bdr text-sm font-bold font-mono tabular-nums text-tx focus:outline-none focus:border-pri2 disabled:opacity-50"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-bdr bg-side flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-mu tabular-nums">
            Sẽ cập nhật <strong className="text-tx">{targetRows.length} phòng</strong> · {enabledFields.size} hạng mục thiết bị
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={applying}
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={applying || targetRows.length === 0 || enabledFields.size === 0}
              onClick={handleConfirm}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              <span>{applying ? 'Đang cập nhật...' : `Áp dụng cho ${targetRows.length} phòng`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
