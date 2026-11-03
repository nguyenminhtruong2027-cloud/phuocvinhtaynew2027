'use client';
import React from 'react';
import { Worker, calcSoNgay, getProfileStatus } from '@/data/workers';
import { Eye, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

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
  return (
    <span className="badge">
      TD {value}
    </span>
  );
}

function MaNVCell({ value }: { value: string }) {
  if (!value) return <span className="text-xs text-mu italic whitespace-nowrap">Chưa có</span>;
  if (value.toLowerCase().startsWith('chờ')) {
    return (
      <span className="badge tint-wn !text-wn !border-wn font-tabular">
        {value}
      </span>
    );
  }
  return <span className="text-xs font-tabular font-bold text-tx whitespace-nowrap">{value}</span>;
}

function CCCDCell({ value }: { value: string | undefined }) {
  if (!value) {
    return (
      <span className="badge !bg-dgrbg !text-dgr !border-dgr">
        Thiếu CCCD
      </span>
    );
  }
  return <span className="text-xs font-tabular text-tx whitespace-nowrap">{value}</span>;
}

function ProfileStatusTag({ worker }: { worker: Worker }) {
  const status = getProfileStatus(worker);
  if (status === 'full') return (
    <span className="badge bg-okbg !text-ok !border-bdr2">
      <span className="w-1.5 h-1.5 rounded-full bg-ok2 shrink-0" />Đủ hồ sơ
    </span>
  );
  if (status === 'missing_cccd_sdt') return (
    <span className="badge bg-dgrbg !text-dgr !border-dgr">
      <span className="w-1.5 h-1.5 rounded-full bg-dgr shrink-0" />Thiếu CCCD/SĐT
    </span>
  );
  const missing: string[] = [];
  if (!worker.tieuDoan) missing.push('Tiểu đoàn');
  if (!worker.ktx) missing.push('Khu KTX');
  if (!worker.day) missing.push('Dãy nhà');
  if (!worker.phongSo) missing.push('Phòng');
  if (!worker.ngaySinh) missing.push('Ngày sinh');
  if (!worker.gioiTinh) missing.push('Giới tính');

  const label = missing.length > 0
    ? `Thiếu: ${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ` +${missing.length - 2}` : ''}`
    : 'Chưa phân bổ';

  return (
    <span
      className="badge tint-wn !text-wn !border-wn"
      title={missing.length > 0 ? `Thiếu thông tin: ${missing.join(', ')}` : 'Chưa phân bổ đầy đủ'}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-wn shrink-0" />{label}
    </span>
  );
}

function TamTruTag({ worker, onToggle }: { worker: Worker; onToggle?: (w: Worker) => void }) {
  const isRegistered = worker.tamTruStatus === 'registered';
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle?.(worker); }}
      title={`Click để đổi → ${isRegistered ? 'Chưa đăng ký' : 'Đã đăng ký'}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all whitespace-nowrap shrink-0 ${
        isRegistered
          ? 'bg-okbg text-ok border-bdr2 hover:opacity-90'
          : 'tint-wn text-wn border-wn hover:opacity-90'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isRegistered ? 'bg-ok2' : 'bg-wn'}`} />
      {isRegistered ? 'Đã ĐK' : 'Chưa ĐK'}
    </button>
  );
}

export default function WorkerTable({
  workers, sortKey, sortDir, onSort, selectedIds, onSelectChange, allIds, onView, onEdit, onDelete, onToggleTamTru, canWriteBlock, rowOffset = 0
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
    return sortDir === 'asc' ? <ArrowUp size={12} className="text-blue-400" /> : <ArrowDown size={12} className="text-blue-400" />;
  };

  if (workers.length === 0) {
    return (
      <div className="bg-surf border border-bdr rounded-2xl p-16 flex flex-col items-center justify-center text-center shadow-xl">
        <div className="w-14 h-14 rounded-2xl bg-act border border-bdr flex items-center justify-center mb-3">
          <Eye size={24} className="text-ic" />
        </div>
        <p className="text-base font-bold text-tx">Không tìm thấy công nhân</p>
        <p className="text-xs text-mu mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm bên trên</p>
      </div>
    );
  }

  return (
    <div className="bg-surf border border-bdr rounded-2xl shadow-xl overflow-hidden">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse min-w-[1250px] text-left table-auto">
          <thead>
            <tr className="bg-act border-b border-bdr sticky top-0 z-20">
              <th className="px-3 py-3 w-10 text-center bg-act z-20">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="rounded border-bdr2 bg-surf text-pri focus:ring-pri2"
                />
              </th>
              {COLUMNS.map((col, i) => (
                <th
                  key={`th-${col.key}-${i}`}
                  className={`px-3 py-3 text-xs font-bold text-mu uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-tx transition-colors bg-act z-20 ${col.width || ''} ${i === 1 ? 'sticky left-[88px] z-30' : ''}`}
                  onClick={() => onSort(col.key)}
                >
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span>{col.label}</span>
                    <SortIcon col={col.key} />
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-xs font-bold text-mu uppercase tracking-wider w-24 whitespace-nowrap bg-act z-20">Tạm trú</th>
              <th className="px-3 py-3 text-xs font-bold text-mu uppercase tracking-wider w-28 text-right pr-4 whitespace-nowrap bg-act z-20">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bdr">
            {workers.map((w, idx) => {
              const isSelected = selectedIds.has(w.id);
              const soNgay = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
              const displayStt = rowOffset + idx + 1;
              return (
                <tr
                  key={w.id}
                  className={`transition-colors cursor-pointer group ${
                    isSelected
                      ? 'bg-bdg border-l-2 border-l-pri2'
                      : idx % 2 === 0
                      ? 'bg-surf'
                      : 'bg-act'
                  } hover:bg-act`}
                  onClick={() => onView(w)}
                >
                  <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(w.id)}
                      className="rounded border-bdr2 bg-surf text-pri focus:ring-pri2"
                    />
                  </td>
                  <td className={`px-3 py-3 whitespace-nowrap sticky left-0 z-10 transition-colors ${isSelected ? 'bg-bdg' : 'bg-surf group-hover:bg-act'}`} onClick={e => e.stopPropagation()}>
                    <span className="text-xs font-tabular text-mu font-semibold">{displayStt}</span>
                  </td>
                  <td className={`px-3.5 py-3 whitespace-nowrap min-w-[240px] sticky left-[52px] z-10 transition-colors ${isSelected ? 'bg-bdg' : 'bg-surf group-hover:bg-act'}`}>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-nowrap whitespace-nowrap">
                        <div className="w-7 h-7 rounded-lg bg-bdg border border-bdr2 flex items-center justify-center text-lnk text-xs font-bold shrink-0">
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
                  <td className="px-3 py-3"><MaNVCell value={w.maNV} /></td>
                  <td className="px-3 py-3"><PlatoonBadge value={w.tieuDoan} /></td>
                  <td className="px-3 py-3"><span className="text-xs text-mu font-medium">{w.ktx || '—'}</span></td>
                  <td className="px-3 py-3"><span className="text-xs font-bold text-tx">{w.day}</span></td>
                  <td className="px-3 py-3">
                    <span className="badge font-tabular">
                      {w.phongSo}
                    </span>
                  </td>
                  <td className="px-3 py-3"><span className="text-xs font-tabular text-mu">{w.giuong || '—'}</span></td>
                  <td className="px-3 py-3"><span className="text-xs font-tabular text-mu">{w.soDienThoai || '—'}</span></td>
                  <td className="px-3 py-3"><CCCDCell value={w.cccd} /></td>
                  <td className="px-3 py-3"><span className="text-xs text-mu truncate max-w-[120px] block">{w.hoKhauTinh || '—'}</span></td>
                  <td className="px-3 py-3"><span className="text-xs text-mu truncate max-w-[130px] block">{w.toTruong || '—'}</span></td>
                  <td className="px-3 py-3"><span className="text-xs font-tabular text-mu">{w.ngayVaoKTX || '—'}</span></td>
                  <td className="px-3 py-3">
                    {soNgay !== null ? (
                      <span className={`text-xs font-tabular font-bold ${soNgay <= 7 ? 'text-ok' : 'text-mu'}`}>
                        {soNgay}n
                      </span>
                    ) : <span className="text-ic text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <TamTruTag worker={w} onToggle={onToggleTamTru} />
                  </td>
                  <td className="px-3 py-3 text-right pr-4" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onView(w)}
                        title="Xem chi tiết"
                        className="p-1.5 rounded-lg text-lnk hover:text-pri2 hover:bg-bdg transition-colors"
                      >
                        <Eye size={15} />
                      </button>
                      {(!canWriteBlock || canWriteBlock(w.day, w.ktx)) ? (
                        <button
                          onClick={() => onEdit(w)}
                          title="Sửa"
                          className="p-1.5 rounded-lg text-lnk hover:text-pri2 hover:bg-bdg transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                      ) : (
                        <button disabled title="Không có quyền sửa" className="p-1.5 rounded-lg text-ic cursor-not-allowed">
                          <Pencil size={15} />
                        </button>
                      )}
                      {onDelete && (
                        (!canWriteBlock || canWriteBlock(w.day, w.ktx)) ? (
                          <button
                            onClick={() => onDelete(w)}
                            title="Xóa"
                            className="p-1.5 rounded-lg text-dgr hover:opacity-80 hover:bg-dgrbg transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : (
                          <button disabled title="Không có quyền xóa" className="p-1.5 rounded-lg text-ic cursor-not-allowed">
                            <Trash2 size={15} />
                          </button>
                        )
                      )}
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
}
