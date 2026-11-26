'use client';
import React from 'react';
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
  { key: 'hoVaTen', label: 'Họ và Tên', width: 'min-w-[240px]' },
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

function ProfileStatusTag({ worker }: { worker: Worker }) {
  const status = getProfileStatus(worker);
  if (status === 'full') {
    return (
      <StatusTag tone="teal" icon={CheckCircle2}>
        Đủ hồ sơ
      </StatusTag>
    );
  }
  if (status === 'missing_cccd_sdt') {
    return (
      <StatusTag tone="rose" icon={AlertCircle}>
        Thiếu CCCD/SĐT
      </StatusTag>
    );
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

  return (
    <StatusTag
      tone="amber"
      icon={AlertTriangle}
      title={missing.length > 0 ? `Thiếu thông tin: ${missing.join(', ')}` : 'Chưa phân bổ đầy đủ'}
    >
      {label}
    </StatusTag>
  );
}

function TamTruTag({ worker, onToggle }: { worker: Worker; onToggle?: (w: Worker) => void }) {
  const isRegistered = worker.tamTruStatus === 'registered';
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onToggle?.(worker);
      }}
      title={`Click để đổi → ${isRegistered ? 'Chưa đăng ký' : 'Đã đăng ký'}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-95 ${
        isRegistered
          ? 'bg-okbg text-ok border-ok2/35 hover:opacity-90'
          : 'tint-wn text-wn border-wn/40 hover:opacity-90'
      }`}
      style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
    >
      {isRegistered ? <CheckCircle2 size={11} strokeWidth={2.3} /> : <Clock size={11} strokeWidth={2.3} />}
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
      <div className="surface-elevated rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <div className="w-14 h-14 rounded-2xl craft-icon-slate flex items-center justify-center mb-3">
          <Eye size={24} />
        </div>
        <p className="text-base font-bold text-tx">Không tìm thấy công nhân</p>
        <p className="text-xs text-mu mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm bên trên</p>
      </div>
    );
  }

  return (
    <div className="surface-elevated rounded-2xl overflow-hidden">
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
                    i === 1 ? 'sticky left-[88px] z-30' : ''
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
                      ? 'bg-bdg/70 border-l-2 border-l-pri2'
                      : idx % 2 === 0
                      ? 'bg-surf border-l-2 border-l-transparent hover:border-l-pri2/40'
                      : 'bg-act/35 border-l-2 border-l-transparent hover:border-l-pri2/40'
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
                    className={`px-3 py-3 whitespace-nowrap sticky left-0 z-10 transition-colors ${
                      isSelected ? 'bg-bdg' : 'bg-surf group-hover:bg-act'
                    }`}
                    onClick={e => e.stopPropagation()}
                  >
                    <span className="text-xs font-mono font-tabular text-mu font-semibold">{displayStt}</span>
                  </td>
                  <td
                    className={`px-3.5 py-3 whitespace-nowrap min-w-[240px] sticky left-[52px] z-10 transition-colors ${
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
  );
});

export default WorkerTable;
