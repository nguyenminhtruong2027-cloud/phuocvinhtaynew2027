'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  BookmarkCheck,
  Calendar,
  Trash2,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Database,
  Plus,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { normalizeBedLabel } from '@/lib/bedSync';
import { getVNDateString } from '@/lib/vnDate';
import {
  BED_RESERVATIONS_SETUP_SQL,
  BedReservation,
  BedReservationSlotInput,
  buildReservationSlotKey,
  cancelBedReservation,
  cancelBedReservationsBatch,
  createBedReservations,
  isReservationOverdue,
} from '@/lib/bedReservations';

export interface EmptyBedOption {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
}

interface Props {
  emptyBeds: EmptyBedOption[];
  activeReservations: BedReservation[];
  missingTable: boolean;
  initialMode?: 'create' | 'manage';
  preselectedSlots?: BedReservationSlotInput[];
  onClose: () => void;
  onUpdated: () => Promise<void> | void;
}

function getTomorrowVN(): string {
  const now = new Date();
  const vnOffset = 7 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const tomorrow = new Date(utc + vnOffset * 60000 + 24 * 60 * 60 * 1000);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function BedReserveModal({
  emptyBeds,
  activeReservations,
  missingTable,
  initialMode = 'create',
  preselectedSlots = [],
  onClose,
  onUpdated,
}: Props) {
  const { currentUser, isAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();

  const [mode, setMode] = useState<'create' | 'manage'>(initialMode);
  const [groupName, setGroupName] = useState('');
  const [expectedDate, setExpectedDate] = useState(getTomorrowVN());
  const [note, setNote] = useState('');
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<Set<string>>(() => {
    return new Set(
      preselectedSlots.map(s => buildReservationSlotKey(s.ktx, s.day, s.phong_so, s.giuong))
    );
  });
  const [filterDay, setFilterDay] = useState<string>('all');
  const [filterRoom, setFilterRoom] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const activeKeySet = useMemo(() => {
    const s = new Set<string>();
    activeReservations.forEach(r => {
      s.add(buildReservationSlotKey(r.ktx, r.day, r.phong_so, r.giuong));
    });
    return s;
  }, [activeReservations]);

  // Only show truly available (empty + unreserved + manageable by user) beds
  const availableBeds = useMemo(() => {
    return emptyBeds.filter(b => {
      if (!isAdmin && !canWriteBlock(b.day || '', b.ktx || '')) return false;
      const key = buildReservationSlotKey(b.ktx, b.day, b.phong_so, b.giuong);
      return !activeKeySet.has(key);
    });
  }, [emptyBeds, activeKeySet, isAdmin, canWriteBlock]);

  const uniqueDays = useMemo(() => {
    return Array.from(new Set(availableBeds.map(b => b.day))).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [availableBeds]);

  // Group available beds by KTX + Day + Room for easy "Select whole room"
  const groupedRooms = useMemo(() => {
    const map = new Map<string, { ktx: string; day: string; phong_so: string; beds: EmptyBedOption[] }>();
    const qRoom = filterRoom.trim().toLowerCase();
    for (const b of availableBeds) {
      if (filterDay !== 'all' && b.day !== filterDay) continue;
      if (qRoom && !formatRoomDisplay(b.phong_so).toLowerCase().includes(qRoom) && !b.phong_so.toLowerCase().includes(qRoom)) {
        continue;
      }
      const key = `${b.ktx}||${b.day}||${normalizeRoomLabel(b.phong_so)}`;
      const entry = map.get(key);
      if (entry) {
        entry.beds.push(b);
      } else {
        map.set(key, { ktx: b.ktx, day: b.day, phong_so: b.phong_so, beds: [b] });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const d = a.day.localeCompare(b.day, 'vi', { numeric: true });
      if (d !== 0) return d;
      return a.phong_so.localeCompare(b.phong_so, 'vi', { numeric: true });
    });
  }, [availableBeds, filterDay, filterRoom]);

  // Group active reservations by (group_name + expected_date) for management tab
  const reservationGroups = useMemo(() => {
    const map = new Map<string, { key: string; groupName: string; expectedDate: string; note: string; overdue: boolean; items: BedReservation[] }>();
    for (const r of activeReservations) {
      const k = `${r.group_name}||${r.expected_date}`;
      const existing = map.get(k);
      if (existing) {
        existing.items.push(r);
      } else {
        map.set(k, {
          key: k,
          groupName: r.group_name,
          expectedDate: r.expected_date,
          note: r.note || '',
          overdue: isReservationOverdue(r),
          items: [r],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  }, [activeReservations]);

  const toggleBed = (b: EmptyBedOption) => {
    const key = buildReservationSlotKey(b.ktx, b.day, b.phong_so, b.giuong);
    setSelectedSlotKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleWholeRoom = (roomBeds: EmptyBedOption[]) => {
    const keys = roomBeds.map(b => buildReservationSlotKey(b.ktx, b.day, b.phong_so, b.giuong));
    const allSelected = keys.every(k => selectedSlotKeys.has(k));
    setSelectedSlotKeys(prev => {
      const next = new Set(prev);
      if (allSelected) {
        keys.forEach(k => next.delete(k));
      } else {
        keys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(BED_RESERVATIONS_SETUP_SQL);
      setCopiedSql(true);
      toast.success('Đã chép mã SQL khởi tạo bảng bed_reservations. Dán vào Supabase SQL Editor và bấm Run.');
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      toast.error('Không thể chép tự động vào clipboard.');
    }
  };

  const handleCreate = async () => {
    const chosenBeds = availableBeds.filter(b =>
      selectedSlotKeys.has(buildReservationSlotKey(b.ktx, b.day, b.phong_so, b.giuong))
    );
    if (!groupName.trim()) {
      toast.warning('Vui lòng nhập tên đoàn hoặc đơn vị giữ chỗ.');
      return;
    }
    if (chosenBeds.length === 0) {
      toast.warning('Vui lòng chọn ít nhất 1 giường trống để giữ chỗ.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createBedReservations({
        slots: chosenBeds.map(b => ({
          ktx: b.ktx,
          day: b.day,
          phong_so: b.phong_so,
          giuong: b.giuong,
        })),
        groupName: groupName.trim(),
        expectedDate,
        note: note.trim(),
        createdBy: currentUser?.email || currentUser?.name || 'Admin',
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      addLog(
        currentUser?.email || currentUser?.name || 'Admin',
        'RESERVE_BED',
        JSON.stringify({
          event: 'RESERVE_BED',
          group_name: groupName.trim(),
          expected_date: expectedDate,
          count: res.created.length,
          summary: `Giữ chỗ ${res.created.length} giường cho đoàn "${groupName.trim()}" (dự kiến vào ${expectedDate})`,
        })
      );
      toast.success(`Đã giữ chỗ ${res.created.length} giường cho "${groupName.trim()}".`);
      setSelectedSlotKeys(new Set());
      setGroupName('');
      setNote('');
      await onUpdated();
      setMode('manage');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelGroup = async (groupTitle: string, ids: string[]) => {
    setSubmitting(true);
    try {
      const res = await cancelBedReservationsBatch(ids);
      if (!res.ok) {
        toast.error(res.error || 'Không thể hủy giữ chỗ.');
        return;
      }
      addLog(
        currentUser?.email || currentUser?.name || 'Admin',
        'CANCEL_RESERVE_BED',
        JSON.stringify({
          event: 'CANCEL_RESERVE_BED',
          group_name: groupTitle,
          count: res.count,
          summary: `Hủy giữ chỗ ${res.count} giường của đoàn "${groupTitle}"`,
        })
      );
      toast.success(`Đã giải phóng ${res.count} suất giữ chỗ của "${groupTitle}".`);
      await onUpdated();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSingle = async (r: BedReservation) => {
    setSubmitting(true);
    try {
      const res = await cancelBedReservation(r.id);
      if (!res.ok) {
        toast.error(res.error || 'Không thể hủy giữ chỗ.');
        return;
      }
      addLog(
        currentUser?.email || currentUser?.name || 'Admin',
        'CANCEL_RESERVE_BED',
        JSON.stringify({
          event: 'CANCEL_RESERVE_BED',
          group_name: r.group_name,
          ktx: r.ktx,
          day: r.day,
          phong_so: r.phong_so,
          giuong: r.giuong,
          summary: `Hủy giữ chỗ giường ${r.day} · ${formatRoomDisplay(r.phong_so)} · G${normalizeBedLabel(r.giuong) || r.giuong} (${r.group_name})`,
        })
      );
      toast.success('Đã hủy giữ chỗ giường.');
      await onUpdated();
    } finally {
      setSubmitting(false);
    }
  };

  const todayVN = getVNDateString();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-3 sm:p-5 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-surf border border-bdr2 shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 text-purple-400 border border-purple-500/35 flex items-center justify-center shrink-0">
              <BookmarkCheck size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-tx truncate">
                Đặt Giữ Chỗ Giường Cho Đoàn Sắp Vào
              </h2>
              <p className="text-xs text-mu mt-0.5">
                Khoanh sẵn phòng/giường trống để tránh xếp nhầm người khác · Tự động giải phóng khi công nhân vào giường
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 py-3 border-b border-bdr bg-page/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <SlidingTabs<'create' | 'manage'>
            layoutId="bed-reserve-mode-tabs"
            compact
            value={mode}
            onChange={setMode}
            tabs={[
              { id: 'create', label: 'Tạo Giữ Chỗ Mới', icon: Plus, count: selectedSlotKeys.size || undefined },
              { id: 'manage', label: 'Đang Giữ Chỗ', icon: BookmarkCheck, count: activeReservations.length },
            ]}
          />
          <span className="text-[11px] text-mu">
            Giường trống khả dụng: <strong className="text-tx font-mono">{availableBeds.length}</strong>
          </span>
        </div>

        {/* Missing table guidance banner */}
        {missingTable && (
          <div className="mx-5 mt-4 rounded-xl tint-wn border border-wn/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-wn">
              <Database size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Bảng dữ liệu `bed_reservations` chưa được tạo trên Supabase</p>
                <p className="opacity-90 mt-0.5">
                  Bấm nút bên cạnh để chép mã SQL, dán vào Supabase SQL Editor và bấm Run để bật tính năng Giữ chỗ.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopySql}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wn text-white text-xs font-bold shrink-0 cursor-pointer hover:opacity-95"
            >
              {copiedSql ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedSql ? 'Đã chép mã SQL' : 'Chép mã SQL'}</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {mode === 'create' ? (
            <div className="space-y-4">
              {/* Group details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1 space-y-1">
                  <label className="text-xs font-bold text-tx">Tên đoàn / Đơn vị *</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder="VD: Đoàn ME anh Hùng (15 người)"
                    className="w-full rounded-xl bg-page border border-bdr2 px-3 py-2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/40"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx">Ngày dự kiến vào KTX *</label>
                  <input
                    type="date"
                    min={todayVN}
                    value={expectedDate}
                    onChange={e => setExpectedDate(e.target.value)}
                    className="w-full rounded-xl bg-page border border-bdr2 px-3 py-2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/40"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx">Ghi chú thêm</label>
                  <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="VD: Chỉ xếp nam, ưu tiên tầng 1..."
                    className="w-full rounded-xl bg-page border border-bdr2 px-3 py-2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/40"
                  />
                </div>
              </div>

              {/* Filter room/day */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={filterDay}
                    onChange={e => setFilterDay(e.target.value)}
                    className="rounded-xl bg-page border border-bdr2 px-3 py-1.5 text-xs text-tx font-semibold"
                  >
                    <option value="all">Tất cả Dãy ({uniqueDays.length})</option>
                    {uniqueDays.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={filterRoom}
                    onChange={e => setFilterRoom(e.target.value)}
                    placeholder="Lọc số phòng..."
                    className="rounded-xl bg-page border border-bdr2 px-3 py-1.5 text-xs text-tx w-36"
                  />
                </div>
                {selectedSlotKeys.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedSlotKeys(new Set())}
                    className="text-xs text-dgr font-semibold hover:underline cursor-pointer"
                  >
                    Bỏ chọn {selectedSlotKeys.size} giường
                  </button>
                )}
              </div>

              {/* Rooms grid with bed chips */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1">
                {groupedRooms.length === 0 ? (
                  <div className="col-span-full rounded-xl border border-dashed border-bdr2 p-8 text-center text-xs text-mu">
                    Không có giường trống khả dụng trong bộ lọc này.
                  </div>
                ) : (
                  groupedRooms.map(room => {
                    const roomKeys = room.beds.map(b => buildReservationSlotKey(b.ktx, b.day, b.phong_so, b.giuong));
                    const selectedInRoom = roomKeys.filter(k => selectedSlotKeys.has(k)).length;
                    const allSelected = selectedInRoom === room.beds.length && room.beds.length > 0;
                    return (
                      <div key={`${room.ktx}-${room.day}-${room.phong_so}`} className="rounded-xl border border-bdr bg-page/50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-tx">
                            <Building2 size={13} className="text-lnk" />
                            <span>{room.day} · {formatRoomDisplay(room.phong_so)}</span>
                            <span className="text-[11px] font-normal text-mu">({room.beds.length} trống)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleWholeRoom(room.beds)}
                            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold cursor-pointer border transition-colors ${
                              allSelected
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-surf text-lnk border-bdr2 hover:bg-act'
                            }`}
                          >
                            {allSelected ? 'Bỏ cả phòng' : 'Chọn cả phòng'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {room.beds.map(b => {
                            const key = buildReservationSlotKey(b.ktx, b.day, b.phong_so, b.giuong);
                            const active = selectedSlotKeys.has(key);
                            return (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => toggleBed(b)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-all cursor-pointer ${
                                  active
                                    ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                                    : 'bg-surf text-tx border-bdr2 hover:border-purple-400'
                                }`}
                              >
                                G{normalizeBedLabel(b.giuong) || b.giuong}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* MANAGE TAB */
            <div className="space-y-3">
              {reservationGroups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-bdr2 p-10 text-center space-y-2">
                  <BookmarkCheck size={28} className="mx-auto text-mu/60" />
                  <p className="text-sm font-bold text-tx">Hiện chưa có giường nào đang giữ chỗ</p>
                  <p className="text-xs text-mu">
                    Chuyển sang tab &ldquo;Tạo Giữ Chỗ Mới&rdquo; để khoanh sẵn giường trống cho đoàn công nhân sắp đến.
                  </p>
                </div>
              ) : (
                reservationGroups.map(grp => (
                  <div
                    key={grp.key}
                    className={`rounded-2xl border overflow-hidden ${
                      grp.overdue ? 'border-dgr/50 bg-dgrbg/20' : 'border-purple-500/35 bg-surf'
                    }`}
                  >
                    <div className="px-4 py-3 border-b border-bdr flex flex-wrap items-center justify-between gap-2 bg-page/60">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-tx">{grp.groupName}</span>
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                            {grp.items.length} giường
                          </span>
                          {grp.overdue && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-dgrbg text-dgr border border-dgr/35">
                              <AlertTriangle size={11} /> Quá ngày dự kiến
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-mu flex flex-wrap items-center gap-x-2">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={11} /> Dự kiến vào: <strong className="text-tx">{grp.expectedDate}</strong>
                          </span>
                          {grp.note && <span>· {grp.note}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleCancelGroup(grp.groupName, grp.items.map(i => i.id))}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-dgrbg hover:bg-dgr text-dgr hover:text-white border border-dgr/35 text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                        <span>Hủy cả đoàn</span>
                      </button>
                    </div>
                    <div className="p-3 flex flex-wrap gap-2">
                      {grp.items.map(item => (
                        <span
                          key={item.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-page border border-bdr2 text-xs text-tx"
                        >
                          <span className="font-semibold">
                            {item.day} · {formatRoomDisplay(item.phong_so)} · G{normalizeBedLabel(item.giuong) || item.giuong}
                          </span>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleCancelSingle(item)}
                            className="text-mu hover:text-dgr cursor-pointer"
                            title="Hủy giữ chỗ giường này"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-bdr bg-side flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-mu">
            {mode === 'create'
              ? `Đang chọn ${selectedSlotKeys.size} giường để giữ chỗ`
              : `Tổng cộng ${activeReservations.length} giường đang giữ chỗ`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
            >
              Đóng
            </button>
            {mode === 'create' && (
              <button
                type="button"
                disabled={submitting || selectedSlotKeys.size === 0 || !groupName.trim() || missingTable}
                onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer disabled:opacity-45"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <BookmarkCheck size={14} />}
                <span>Xác nhận Giữ chỗ ({selectedSlotKeys.size} giường)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
