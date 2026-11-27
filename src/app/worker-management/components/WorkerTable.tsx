'use client';
import React, { useState } from 'react';
import { Worker, calcSoNgay, getProfileStatus } from '@/data/workers';
import {
  Eye,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  AlertCircle,
  Shield,
  AlertTriangle,
  Phone,
  MapPin,
  CreditCard,
  Users,
  LayoutList,
  Table2,
  BedDouble,
} from 'lucide-react';
import { StatusTag, MonoChip } from '@/components/ui/StatusTag';
import { normalizeBedLabel } from '@/lib/bedSync';

interface Props {
  workers: Worker[];
  sortKey: keyof Worker;
  sortDir: 'asc' | 'desc';
  onSort: (key: keyof Worker) => void;
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;
  allIds: string[];
  onView: (w: Worker) => void;
  onEdit: (w: Worker) => void;
  onDelete?: (w: Worker) => void;
  onToggleTamTru?: (w: Worker) => void;
  /** Optional: function to check if current user can write to a specific KTX+block combination */
  canWriteBlock?: (blockName: string, ktxName?: string) => boolean;
  /** Sequential row number offset for renumbering after filter (0-based index of first row) */
  rowOffset?: number;
}

const COLUMNS: { key: keyof Worker; label: string; width?: string }[] = [
  { key: 'stt', label: 'STT', width: 'w-12' },
  { key: 'hoVaTen', label: 'Họ và Tên', width: 'min-w-[230px]' },
  { key: 'maNV', label: 'Mã NV', width: 'w-28' },
  { key: 'tieuDoan', label: 'TD', width: 'w-20' },
  { key: 'ktx', label: 'KTX', width: 'w-20' },
  { key: 'day', label: 'Dãy', width: 'w-20' },
  { key: 'phongSo', label: 'Phòng', width: 'w-16' },
  { key: 'giuong', label: 'Giường', width: 'w-16' },
  { key: 'soDienThoai', label: 'SĐT', width: 'w-32' },
  { key: 'cccd', label: 'CCCD', width: 'w-36' },
  { key: 'hoKhauTinh', label: 'Tỉnh/TP', width: 'min-w-[120px]' },
  { key: 'toTruong', label: 'Tổ Trưởng', width: 'min-w-[130px]' },
  { key: 'ngayVaoKTX', label: 'Ngày Vào', width: 'w-28' },
  { key: 'ngayVaoKTX', label: 'Số Ngày', width: 'w-20' },
];

const MOBILE_SORT_OPTIONS: { key: keyof Worker; label: string }[] = [
  { key: 'stt', label: 'STT' },
  { key: 'hoVaTen', label: 'Họ và Tên' },
  { key: 'phongSo', label: 'Phòng' },
  { key: 'ngayVaoKTX', label: 'Ngày vào KTX' },
  { key: 'maNV', label: 'Mã NV' },
];

function PlatoonBadge({ value }: { value: string }) {
  if (!value) return <span className="text-xs text-mu">—</span>;
  const tone = value === '113' ? 'teal' : value === '111' ? 'pink' : 'blue';
  return (
    <StatusTag tone={tone} icon={Shield}>
      TD {value}
    </StatusTag>
  );
}

function MaNVCell({ value }: { value: string }) {
  if (!value) return <span className="text-xs text-mu italic whitespace-nowrap">Chưa có</span>;
  if (value.toLowerCase().startsWith('chờ')) {
    return (
      <StatusTag tone="amber" icon={Clock} mono>
        {value}
      </StatusTag>
    );
  }
  return <MonoChip tone="blue">{value}</MonoChip>;
}

function CCCDCell({ value }: { value: string | undefined }) {
  if (!value) {
    return (
      <StatusTag tone="rose" icon={AlertCircle}>
        Thiếu CCCD
      </StatusTag>
    );
  }
  return <span className="text-xs font-mono font-tabular text-tx whitespace-nowrap">{value}</span>;
}

function getProfileMissingSummary(worker: Worker): { status: ReturnType<typeof getProfileStatus>; label: string; title: string } {
  const status = getProfileStatus(worker);
  if (status === 'full') {
    return { status, label: 'Đủ hồ sơ', title: 'Đủ thông tin hồ sơ' };
  }
  if (status === 'missing_cccd_sdt') {
    return { status, label: 'Thiếu CCCD/SĐT', title: 'Thiếu CCCD hoặc Số điện thoại' };
  }
  const missing: string[] = [];
  if (!worker.tieuDoan) missing.push('Tiểu đoàn');
  if (!worker.ktx) missing.push('Khu KTX');
  if (!worker.day) missing.push('Dãy nhà');
  if (!worker.phongSo) missing.push('Phòng');
  if (!worker.ngaySinh) missing.push('Ngày sinh');
  if (!worker.gioiTinh) missing.push('Giới tính');

  const label =
    missing.length > 0
      ? `Thiếu: ${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ` +${missing.length - 2}` : ''}`
      : 'Chưa phân bổ';
  const title = missing.length > 0 ? `Thiếu thông tin: ${missing.join(', ')}` : 'Chưa phân bổ đầy đủ';
  return { status, label, title };
}

function ProfileStatusTag({ worker }: { worker: Worker }) {
  const { status, label, title } = getProfileMissingSummary(worker);
  if (status === 'full') {
    return (
      <StatusTag tone="teal" icon={CheckCircle2}>
        {label}
      </StatusTag>
    );
  }
  if (status === 'missing_cccd_sdt') {
    return (
      <StatusTag tone="rose" icon={AlertCircle}>
        {label}
      </StatusTag>
    );
  }
  return (
    <StatusTag tone="amber" icon={AlertTriangle} title={title}>
      {label}
    </StatusTag>
  );
}

function TamTruTag({
  worker,
  onToggle,
  compact = false,
}: {
  worker: Worker;
  onToggle?: (w: Worker) => void;
  compact?: boolean;
}) {
  const isRegistered = worker.tamTruStatus === 'registered';
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onToggle?.(worker);
      }}
      title={`Click để đổi → ${isRegistered ? 'Chưa đăng ký' : 'Đã đăng ký'}`}
      className={`inline-flex items-center gap-1 rounded-lg font-semibold border transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 ${
        compact ? 'px-2.5 py-1.5 text-[11px] min-h-[32px]' : 'px-2 py-0.5 text-[11px] rounded-md'
      } ${
        isRegistered
          ? 'bg-okbg text-ok border-ok2/35 hover:opacity-90'
          : 'tint-wn text-wn border-wn/40 hover:opacity-90'
      }`}
      style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
    >
      {isRegistered ? <CheckCircle2 size={12} strokeWidth={2.3} /> : <Clock size={12} strokeWidth={2.3} />}
      <span>{isRegistered ? 'Đã ĐK' : 'Chưa ĐK'}</span>
    </button>
  );
}

const WorkerTable = React.memo(function WorkerTable({
  workers,
  sortKey,
  sortDir,
  onSort,
  selectedIds,
  onSelectChange,
  allIds,
  onView,
  onEdit,
  onDelete,
  onToggleTamTru,
  canWriteBlock,
  rowOffset = 0,
}: Props) {
  const [mobileMode, setMobileMode] = useState<'cards' | 'table'>('cards');

  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someSelected = allIds.some(id => selectedIds.has(id)) && !allSelected;

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allSelected) {
      allIds.forEach(id => next.delete(id));
    } else {
      allIds.forEach(id => next.add(id));
    }
    onSelectChange(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectChange(next);
  };

  const SortIcon = ({ col }: { col: keyof Worker }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp size={12} className="text-lnk" /> : <ArrowDown size={12} className="text-lnk" />;
  };

  if (workers.length === 0) {
    return (
      <div className="surface-elevated rounded-2xl p-12 sm:p-16 flex flex-col items-center justify-center text-center">
        <div className="w-14 h-14 rounded-2xl craft-icon-slate flex items-center justify-center mb-3">
          <Eye size={24} />
        </div>
        <p className="text-base font-bold text-tx">Không tìm thấy công nhân</p>
        <p className="text-xs text-mu mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm bên trên</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Mobile Utility Bar (< md): Select All + Sort + Card/Table Switcher ── */}
      <div className="md:hidden flex items-center justify-between gap-2 bg-surf border border-bdr rounded-xl px-2.5 py-2">
        <label className="flex items-center gap-2 min-h-[36px] px-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-bdr2 bg-act text-pri focus:ring-pri2 cursor-pointer"
          />
          <span className="text-xs font-bold text-tx whitespace-nowrap">
            Chọn ({workers.length})
          </span>
        </label>

        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center bg-act border border-bdr rounded-lg overflow-hidden">
            <select
              aria-label="Sắp xếp theo"
              value={MOBILE_SORT_OPTIONS.some(o => o.key === sortKey) ? String(sortKey) : 'stt'}
              onChange={e => onSort(e.target.value as keyof Worker)}
              className="bg-transparent text-tx text-[11px] font-semibold pl-2 pr-1 py-1.5 focus:outline-none cursor-pointer"
            >
              {MOBILE_SORT_OPTIONS.map(opt => (
                <option key={String(opt.key)} value={String(opt.key)}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onSort(sortKey)}
              title={sortDir === 'asc' ? 'Đang tăng dần — bấm để giảm dần' : 'Đang giảm dần — bấm để tăng dần'}
              className="px-1.5 py-1.5 text-lnk hover:bg-surf/70 border-l border-bdr transition-colors cursor-pointer"
            >
              {sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            </button>
          </div>

          <div className="inline-flex items-center bg-act border border-bdr rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMode('cards')}
              title="Dạng thẻ dễ đọc trên điện thoại"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                mobileMode === 'cards' ? 'bg-pri text-white shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              <LayoutList size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMobileMode('table')}
              title="Dạng bảng cuộn ngang"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                mobileMode === 'table' ? 'bg-pri text-white shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              <Table2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── MOBILE CARD LIST (< md when mobileMode === 'cards') ── */}
      {mobileMode === 'cards' && (
        <div className="md:hidden space-y-2.5">
          {workers.map((w, idx) => {
            const isSelected = selectedIds.has(w.id);
            const soNgay = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
            const displayStt = rowOffset + idx + 1;
            const isFemale =
              (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';
            const canEditRow = !canWriteBlock || canWriteBlock(w.day, w.ktx);
            const profileInfo = getProfileMissingSummary(w);
            const bedLabel = w.giuong ? `G${normalizeBedLabel(w.giuong) || w.giuong}` : '';
            const locationParts = [
              w.ktx || null,
              w.day || null,
              w.phongSo ? `P.${w.phongSo}` : null,
              bedLabel || null,
            ].filter(Boolean);

            return (
              <div
                key={w.id}
                onClick={() => onView(w)}
                className={`surface-elevated rounded-2xl p-3.5 transition-colors active:scale-[0.995] cursor-pointer border ${
                  isSelected ? 'border-pri2 bg-bdg/30 ring-1 ring-pri2/40' : 'border-bdr'
                }`}
              >
                {/* Header: Checkbox + Avatar + Name + Tạm trú toggle */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div
                      className="pt-0.5 -ml-1 flex items-center justify-center min-w-[32px] min-h-[36px]"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(w.id)}
                        aria-label={`Chọn ${w.hoVaTen}`}
                        className="w-4 h-4 rounded border-bdr2 bg-act text-pri focus:ring-pri2 cursor-pointer"
                      />
                    </div>

                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center text-sm font-bold shrink-0 ${
                        isFemale
                          ? 'tint-pink border-pink-tint text-pink-tone'
                          : 'bg-bdg border-bdr2 text-lnk'
                      }`}
                    >
                      {w.hoVaTen.split(' ').pop()?.charAt(0) ?? '?'}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-mono font-tabular font-semibold text-mu shrink-0">
                          #{displayStt}
                        </span>
                        <h3 className="text-[15px] font-bold text-tx truncate leading-snug">
                          {w.hoVaTen}
                        </h3>
                      </div>
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-xs text-mu">
                        <span className={`font-mono font-tabular font-semibold ${w.maNV ? 'text-lnk' : 'italic'}`}>
                          {w.maNV || 'Chưa có mã NV'}
                        </span>
                        {w.tieuDoan && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-tx">TD {w.tieuDoan}</span>
                          </>
                        )}
                        {w.gioiTinh && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{w.gioiTinh}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div onClick={e => e.stopPropagation()} className="shrink-0">
                    <TamTruTag worker={w} onToggle={onToggleTamTru} compact />
                  </div>
                </div>

                {/* Location & Stay Strip */}
                <div className="mt-2.5 flex items-center justify-between gap-2 bg-act/70 border border-bdr/70 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 min-w-0 text-xs">
                    <BedDouble size={14} className="text-lnk shrink-0" />
                    {locationParts.length > 0 ? (
                      <span className="font-bold text-tx truncate font-tabular">
                        {locationParts.join(' · ')}
                      </span>
                    ) : (
                      <span className="font-semibold text-wn">Chưa xếp phòng / giường</span>
                    )}
                  </div>
                  {soNgay !== null && (
                    <span className="text-[11px] font-mono font-tabular font-bold text-mu shrink-0">
                      {soNgay} ngày
                    </span>
                  )}
                </div>

                {/* Essential Info Grid (2 clean columns — zero overflow) */}
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-mu uppercase tracking-wider flex items-center gap-1">
                      <Phone size={10} /> SĐT
                    </p>
                    {w.soDienThoai ? (
                      <a
                        href={`tel:${w.soDienThoai.replace(/\s+/g, '')}`}
                        onClick={e => e.stopPropagation()}
                        className="font-mono font-tabular font-semibold text-lnk hover:underline mt-0.5 block truncate"
                      >
                        {w.soDienThoai}
                      </a>
                    ) : (
                      <p className="text-mu mt-0.5">—</p>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-mu uppercase tracking-wider flex items-center gap-1">
                      <CreditCard size={10} /> CCCD
                    </p>
                    {w.cccd ? (
                      <p className="font-mono font-tabular font-semibold text-tx mt-0.5 truncate">{w.cccd}</p>
                    ) : (
                      <p className="font-semibold text-dgr mt-0.5">Thiếu CCCD</p>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-mu uppercase tracking-wider flex items-center gap-1">
                      <Users size={10} /> Tổ trưởng
                    </p>
                    <p className="font-medium text-tx mt-0.5 truncate">{w.toTruong || '—'}</p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-mu uppercase tracking-wider flex items-center gap-1">
                      <MapPin size={10} /> Quê quán / Ngày vào
                    </p>
                    <p className="font-medium text-mu mt-0.5 truncate font-tabular">
                      {[w.hoKhauTinh || null, w.ngayVaoKTX || null].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </div>

                {/* Profile Warning Line (only shown if incomplete) */}
                {profileInfo.status !== 'full' && (
                  <div
                    className={`mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border ${
                      profileInfo.status === 'missing_cccd_sdt'
                        ? 'bg-dgrbg/60 text-dgr border-dgr/30'
                        : 'tint-wn text-wn border-wn/30'
                    }`}
                  >
                    {profileInfo.status === 'missing_cccd_sdt' ? (
                      <AlertCircle size={12} className="shrink-0" />
                    ) : (
                      <AlertTriangle size={12} className="shrink-0" />
                    )}
                    <span className="truncate">{profileInfo.title}</span>
                  </div>
                )}

                {/* Touch-Friendly Action Footer */}
                <div
                  className="mt-3 pt-2.5 border-t border-bdr flex items-center gap-2"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onView(w)}
                    className="flex-1 flex items-center justify-center gap-1.5 min-h-[38px] px-3 rounded-xl bg-act hover:bg-bdg text-tx hover:text-lnk border border-bdr text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Eye size={14} />
                    <span>Chi tiết</span>
                  </button>
                  {canEditRow && (
                    <button
                      type="button"
                      onClick={() => onEdit(w)}
                      className="flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-bdg/80 hover:bg-bdg text-lnk border border-bdr2 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Pencil size={14} />
                      <span>Sửa</span>
                    </button>
                  )}
                  {onDelete && canEditRow && (
                    <button
                      type="button"
                      onClick={() => onDelete(w)}
                      aria-label={`Xóa ${w.hoVaTen}`}
                      className="flex items-center justify-center min-h-[38px] min-w-[40px] px-2.5 rounded-xl bg-dgrbg/70 hover:bg-dgrbg text-dgr border border-dgr/25 transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── DESKTOP TABLE (and optional mobile free-scroll table without sticky overlay bug) ── */}
      <div className={`${mobileMode === 'table' ? 'block' : 'hidden md:block'} surface-elevated rounded-2xl overflow-hidden`}>
        {mobileMode === 'table' && (
          <div className="md:hidden px-3 py-1.5 bg-act/80 border-b border-bdr text-[11px] text-mu flex items-center justify-between">
            <span>Vuốt ngang để xem đầy đủ các cột</span>
            <span className="font-mono font-tabular font-semibold text-lnk">{workers.length} dòng</span>
          </div>
        )}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse min-w-[1250px] text-left table-auto">
            <thead>
              <tr className="bg-act border-b border-bdr2 sticky top-0 z-20">
                <th className="px-3 py-3 w-10 text-center bg-act z-20">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="rounded border-bdr2 bg-surf text-pri focus:ring-pri2 cursor-pointer"
                  />
                </th>
                {COLUMNS.map((col, i) => (
                  <th
                    key={`th-${col.key}-${i}`}
                    className={`px-3 py-3 text-[11px] font-bold text-mu uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-tx transition-colors bg-act z-20 ${col.width || ''} ${
                      i === 0
                        ? 'lg:sticky lg:left-0 lg:z-30'
                        : i === 1
                        ? 'lg:sticky lg:left-[52px] lg:z-30 lg:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.28)]'
                        : ''
                    }`}
                    onClick={() => onSort(col.key)}
                  >
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span>{col.label}</span>
                      <SortIcon col={col.key} />
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 text-[11px] font-bold text-mu uppercase tracking-wider w-24 whitespace-nowrap bg-act z-20">
                  Tạm trú
                </th>
                <th className="px-3 py-3 text-[11px] font-bold text-mu uppercase tracking-wider w-28 text-right pr-4 whitespace-nowrap bg-act z-20">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bdr">
              {workers.map((w, idx) => {
                const isSelected = selectedIds.has(w.id);
                const soNgay = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
                const displayStt = rowOffset + idx + 1;
                const isFemale =
                  (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';

                return (
                  <tr
                    key={w.id}
                    className={`transition-colors cursor-pointer group ${
                      isSelected
                        ? 'bg-bdg/70'
                        : idx % 2 === 0
                        ? 'bg-surf'
                        : 'bg-act/35'
                    } hover:bg-act/75`}
                    onClick={() => onView(w)}
                  >
                    <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(w.id)}
                        className="rounded border-bdr2 bg-surf text-pri focus:ring-pri2 cursor-pointer"
                      />
                    </td>
                    <td
                      className={`px-3 py-3 whitespace-nowrap lg:sticky lg:left-0 lg:z-10 transition-colors ${
                        isSelected ? 'bg-bdg' : 'bg-surf group-hover:bg-act'
                      }`}
                      onClick={e => e.stopPropagation()}
                    >
                      <span className="text-xs font-mono font-tabular text-mu font-semibold">{displayStt}</span>
                    </td>
                    <td
                      className={`px-3.5 py-3 whitespace-nowrap min-w-[230px] lg:sticky lg:left-[52px] lg:z-10 lg:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.22)] transition-colors ${
                        isSelected ? 'bg-bdg' : 'bg-surf group-hover:bg-act'
                      }`}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-nowrap whitespace-nowrap">
                          <div
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold shrink-0 ${
                              isFemale
                                ? 'tint-pink border-pink-tint text-pink-tone'
                                : 'bg-bdg border-bdr2 text-lnk'
                            }`}
                          >
                            {w.hoVaTen.split(' ').pop()?.charAt(0) ?? '?'}
                          </div>
                          <p className="text-sm font-bold text-tx whitespace-nowrap group-hover:text-lnk transition-colors">
                            {w.hoVaTen}
                          </p>
                        </div>
                        <div className="whitespace-nowrap flex items-center">
                          <ProfileStatusTag worker={w} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <MaNVCell value={w.maNV} />
                    </td>
                    <td className="px-3 py-3">
                      <PlatoonBadge value={w.tieuDoan} />
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-mu font-semibold whitespace-nowrap">{w.ktx || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-bold text-tx whitespace-nowrap">{w.day || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      {w.phongSo ? <MonoChip tone="blue">P.{w.phongSo}</MonoChip> : <span className="text-xs text-mu">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {w.giuong ? <MonoChip>G{normalizeBedLabel(w.giuong) || w.giuong}</MonoChip> : <span className="text-xs text-mu">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-mono font-tabular text-mu">{w.soDienThoai || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <CCCDCell value={w.cccd} />
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-mu truncate max-w-[120px] block">{w.hoKhauTinh || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-mu truncate max-w-[130px] block">{w.toTruong || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-mono font-tabular text-mu">{w.ngayVaoKTX || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      {soNgay !== null ? (
                        <StatusTag tone={soNgay <= 7 ? 'teal' : 'slate'} mono>
                          {soNgay}n
                        </StatusTag>
                      ) : (
                        <span className="text-ic text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <TamTruTag worker={w} onToggle={onToggleTamTru} />
                    </td>
                    <td className="px-3 py-3 text-right pr-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onView(w)}
                          title="Xem chi tiết"
                          className="p-1.5 rounded-lg text-lnk hover:text-pri2 hover:bg-bdg transition-colors cursor-pointer"
                        >
                          <Eye size={15} />
                        </button>
                        {!canWriteBlock || canWriteBlock(w.day, w.ktx) ? (
                          <button
                            onClick={() => onEdit(w)}
                            title="Sửa"
                            className="p-1.5 rounded-lg text-lnk hover:text-pri2 hover:bg-bdg transition-colors cursor-pointer"
                          >
                            <Pencil size={15} />
                          </button>
                        ) : (
                          <button disabled title="Không có quyền sửa" className="p-1.5 rounded-lg text-ic cursor-not-allowed">
                            <Pencil size={15} />
                          </button>
                        )}
                        {onDelete &&
                          (!canWriteBlock || canWriteBlock(w.day, w.ktx) ? (
                            <button
                              onClick={() => onDelete(w)}
                              title="Xóa"
                              className="p-1.5 rounded-lg text-dgr hover:opacity-80 hover:bg-dgrbg transition-colors cursor-pointer"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : (
                            <button disabled title="Không có quyền xóa" className="p-1.5 rounded-lg text-ic cursor-not-allowed">
                              <Trash2 size={15} />
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});

export default WorkerTable;
