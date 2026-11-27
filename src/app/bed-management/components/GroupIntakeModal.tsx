'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  Users,
  BedDouble,
  Sparkles,
  Copy,
  Check,
  BookmarkCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wand2,
  Search,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Worker, compareKtxNames, naturalSortCompare, removeAccents } from '@/data/workers';
import { FacilityItem, formatRoomDisplay } from '@/lib/facilityCapacity';
import { BedReservation, createBedReservations, fulfillReservationForBed } from '@/lib/bedReservations';
import {
  BatchBedAssignmentItem,
  IntakeBedRow,
  planBatchBedAssignment,
  planGroupCapacity,
} from '@/lib/groupIntakePlanner';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { MonoChip, StatusTag } from '@/components/ui/StatusTag';
import { getVNDateString } from '@/lib/vnDate';
import { createClient } from '@/lib/supabase/client';
import { syncBedForWorkerSave } from '@/lib/bedSync';

interface Props {
  facilities: FacilityItem[];
  beds: IntakeBedRow[];
  workers: Worker[];
  reservations: BedReservation[];
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>;
  isAdmin: boolean;
  canWriteBlock: (day: string, ktx?: string) => boolean;
  actorName: string;
  onLog: (action: 'RESERVE_BED' | 'BED_REASSIGN', detail: string) => void;
  onCompleted: () => Promise<void> | void;
  onClose: () => void;
}

export default function GroupIntakeModal({
  facilities,
  beds,
  workers,
  reservations,
  roomGenderMap,
  isAdmin,
  canWriteBlock,
  actorName,
  onLog,
  onCompleted,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<'forecast' | 'auto_assign'>('forecast');

  // Shared scope filters
  const [ktxFilter, setKtxFilter] = useState<string>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');

  // Tab 1: Forecast & Reserve
  const [maleCount, setMaleCount] = useState<number>(20);
  const [femaleCount, setFemaleCount] = useState<number>(0);
  const [groupName, setGroupName] = useState<string>('');
  const [expectedDate, setExpectedDate] = useState<string>(() => getVNDateString());
  const [reserving, setReserving] = useState(false);
  const [copiedZalo, setCopiedZalo] = useState(false);

  // Tab 2: Batch Auto-Assign for unbedded workers
  const [workerSearch, setWorkerSearch] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(() => {
    const unbedded = workers.filter(
      w =>
        !w.ngayRaKTX &&
        !w.ghiChu?.includes('[Đã Check-out') &&
        !w.ghiChu?.includes('[CHECKOUT]') &&
        !(w.giuong || '').trim() &&
        (isAdmin || !w.day || canWriteBlock(w.day, w.ktx))
    );
    return new Set(unbedded.slice(0, 40).map(w => w.id));
  });
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState('');

  const allowedBlockFn = useMemo(
    () => (day: string, ktx?: string) => isAdmin || canWriteBlock(day, ktx),
    [isAdmin, canWriteBlock]
  );

  const ktxOptions = useMemo(() => {
    const s = new Set<string>();
    facilities.forEach(f => {
      if (f.is_visible !== false && f.ktx?.trim()) s.add(f.ktx.trim());
    });
    return Array.from(s).sort(compareKtxNames);
  }, [facilities]);

  const dayOptions = useMemo(() => {
    const s = new Set<string>();
    facilities.forEach(f => {
      if (f.is_visible === false) return;
      if (ktxFilter !== 'all' && f.ktx?.trim() !== ktxFilter) return;
      if (f.day?.trim() && allowedBlockFn(f.day.trim(), f.ktx?.trim())) {
        s.add(f.day.trim());
      }
    });
    return Array.from(s).sort(naturalSortCompare);
  }, [facilities, ktxFilter, allowedBlockFn]);

  // Live capacity forecast
  const forecast = useMemo(
    () =>
      planGroupCapacity({
        maleCount,
        femaleCount,
        groupName,
        expectedDate,
        ktxFilter,
        dayFilter,
        facilities,
        beds,
        workers,
        reservations,
        roomGenderMap,
        allowedBlockFn,
      }),
    [
      maleCount,
      femaleCount,
      groupName,
      expectedDate,
      ktxFilter,
      dayFilter,
      facilities,
      beds,
      workers,
      reservations,
      roomGenderMap,
      allowedBlockFn,
    ]
  );

  // Unbedded workers eligible for batch assignment
  const unbeddedWorkers = useMemo(() => {
    const q = removeAccents(workerSearch.trim()).toLowerCase();
    return workers.filter(w => {
      if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) return false;
      if ((w.giuong || '').trim()) return false;
      if (!isAdmin && w.day && !canWriteBlock(w.day, w.ktx)) return false;
      if (!q) return true;
      const hay = removeAccents(`${w.hoVaTen} ${w.maNV} ${w.donVi} ${w.toTruong} ${w.cccd}`).toLowerCase();
      return hay.includes(q);
    });
  }, [workers, workerSearch, isAdmin, canWriteBlock]);

  const selectedUnbeddedWorkers = useMemo(
    () => unbeddedWorkers.filter(w => selectedWorkerIds.has(w.id)),
    [unbeddedWorkers, selectedWorkerIds]
  );

  const batchPlan = useMemo(
    () =>
      planBatchBedAssignment({
        targetWorkers: selectedUnbeddedWorkers,
        facilities,
        beds,
        allWorkers: workers,
        reservations,
        roomGenderMap,
        ktxFilter,
        dayFilter,
        allowedBlockFn,
      }),
    [selectedUnbeddedWorkers, facilities, beds, workers, reservations, roomGenderMap, ktxFilter, dayFilter, allowedBlockFn]
  );

  const activeAssignments = useMemo(
    () => batchPlan.assignments.filter(a => !skippedIds.has(a.worker.id)),
    [batchPlan.assignments, skippedIds]
  );

  const handleCopyZalo = async () => {
    try {
      await navigator.clipboard.writeText(forecast.zaloReportText);
      setCopiedZalo(true);
      toast.success('Đã copy phương án tiếp nhận — dán thẳng vào Zalo!');
      setTimeout(() => setCopiedZalo(false), 2000);
    } catch {
      toast.error('Không thể tự động copy.');
    }
  };

  const handleReserveAllPlan = async () => {
    if (forecast.slotsToReserve.length === 0) {
      toast.error('Không có giường nào trong phương án để đặt giữ chỗ.');
      return;
    }
    const cleanGroup = groupName.trim() || `Đoàn ${maleCount}N/${femaleCount}Nữ (${expectedDate})`;
    setReserving(true);
    try {
      const res = await createBedReservations({
        slots: forecast.slotsToReserve,
        groupName: cleanGroup,
        expectedDate,
        note: `Tự động khoanh chỗ từ Trợ lý Đón đoàn (${forecast.allocatedMale} Nam, ${forecast.allocatedFemale} Nữ)`,
        createdBy: actorName,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      onLog(
        'RESERVE_BED',
        `Đặt giữ chỗ ${res.created.length} giường cho đoàn "${cleanGroup}" (dự kiến ${expectedDate}) qua Trợ lý Đón đoàn`
      );
      toast.success(`Đã khoanh giữ chỗ ${res.created.length} giường cho "${cleanGroup}"!`);
      await onCompleted();
    } finally {
      setReserving(false);
    }
  };

  const handleCommitBatchAssign = async () => {
    if (activeAssignments.length === 0) return;
    setCommitting(true);
    const supabase = createClient();
    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < activeAssignments.length; i++) {
        const item: BatchBedAssignmentItem = activeAssignments[i];
        setCommitProgress(`Đang xếp giường ${i + 1}/${activeAssignments.length}: ${item.worker.hoVaTen}...`);

        const { error: wErr } = await supabase
          .from('workers')
          .update({
            ktx: item.ktx,
            day: item.day,
            phong_so: item.phongSo,
            giuong: item.giuong,
            khoa_tra_cuu: `${item.ktx}|${item.day}|${item.phongSo}`,
          })
          .eq('id', item.worker.id);

        if (wErr) {
          failCount++;
          continue;
        }

        await syncBedForWorkerSave(
          supabase,
          item.worker,
          {
            ...item.worker,
            ktx: item.ktx,
            day: item.day,
            phongSo: item.phongSo,
            giuong: item.giuong,
          }
        ).catch(() => {});

        await fulfillReservationForBed(
          {
            ktx: item.ktx,
            day: item.day,
            phong_so: item.phongSo,
            giuong: item.giuong,
          },
          item.worker.id,
          supabase
        ).catch(() => {});

        successCount++;
      }

      if (successCount > 0) {
        onLog(
          'BED_REASSIGN',
          `Tự động xếp giường hàng loạt thành công cho ${successCount} công nhân chưa gắn giường`
        );
        toast.success(`Đã xếp giường thành công cho ${successCount} công nhân${failCount > 0 ? ` (${failCount} lỗi)` : ''}!`);
        await onCompleted();
        onClose();
      } else {
        toast.error('Không thể cập nhật xếp giường. Vui lòng thử lại.');
      }
    } finally {
      setCommitting(false);
      setCommitProgress('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={() => !reserving && !committing && onClose()}
    >
      <div
        className="surface-elevated rounded-t-3xl sm:rounded-2xl shadow-2xl border border-bdr3 w-full max-w-4xl max-h-[93vh] sm:max-h-[90vh] flex flex-col overflow-hidden sheet-enter-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-bdr2" />
        </div>

        {/* Header */}
        <div className="px-5 py-3.5 sm:py-4 border-b border-bdr flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk shrink-0">
              <Sparkles size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-tx truncate">Trợ Lý Tiếp Nhận &amp; Xếp Giường Đoàn Mới</h2>
              <p className="text-xs text-mu">
                Dự báo sức chứa, khoanh giữ chỗ và tự động xếp giường liền kề đúng giới tính &amp; đơn vị
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={reserving || committing}
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs + Scope Filter Bar */}
        <div className="px-5 py-3 border-b border-bdr bg-act/30 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <SlidingTabs
            layoutId="group-intake-tabs"
            compact
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'forecast', label: '1. Dự báo & Giữ chỗ', icon: Building2 },
              {
                id: 'auto_assign',
                label: '2. Xếp giường hàng loạt',
                icon: Wand2,
                count: unbeddedWorkers.length > 0 ? unbeddedWorkers.length : undefined,
              },
            ]}
          />

          <div className="flex items-center gap-2">
            <select
              value={ktxFilter}
              onChange={e => {
                setKtxFilter(e.target.value);
                setDayFilter('all');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-surf border border-bdr2 text-xs text-tx"
            >
              <option value="all">Toàn khu KTX</option>
              {ktxOptions.map(k => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={dayFilter}
              onChange={e => setDayFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-surf border border-bdr2 text-xs text-tx"
            >
              <option value="all">Tất cả Dãy</option>
              {dayOptions.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {activeTab === 'forecast' ? (
            <>
              {/* Input Panel */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-2xl border border-bdr bg-surf p-3.5">
                <div>
                  <label className="text-[11px] font-semibold text-mu block mb-1">Số công nhân Nam</label>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={maleCount}
                    onChange={e => setMaleCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm font-bold font-tabular text-tx"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-mu block mb-1">Số công nhân Nữ</label>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={femaleCount}
                    onChange={e => setFemaleCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm font-bold font-tabular text-tx"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-mu block mb-1">Tên đoàn / Nhà thầu</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder="VD: Nhà thầu ME đợt 2"
                    className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm text-tx"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-mu block mb-1">Ngày dự kiến vào</label>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={e => setExpectedDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm font-tabular text-tx"
                  />
                </div>
              </div>

              {/* Capacity Summary Banner */}
              <div
                className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  forecast.enoughAll ? 'bg-okbg/25 border-ok2/50' : 'tint-dgr border-dgr/40'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {forecast.enoughAll ? (
                    <CheckCircle2 size={20} className="text-ok shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={20} className="text-dgr shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-0.5">
                    <div className="text-sm font-bold text-tx">
                      {forecast.enoughAll
                        ? `Đủ chỗ tiếp nhận trọn đoàn (${forecast.allocatedMale + forecast.allocatedFemale} giường trên ${forecast.allocations.length} phòng)`
                        : `Thiếu ${forecast.shortageMale + forecast.shortageFemale} giường (${
                            forecast.shortageMale > 0 ? `Nam thiếu ${forecast.shortageMale}` : ''
                          }${forecast.shortageMale > 0 && forecast.shortageFemale > 0 ? ' · ' : ''}${
                            forecast.shortageFemale > 0 ? `Nữ thiếu ${forecast.shortageFemale}` : ''
                          })`}
                    </div>
                    <p className="text-xs text-mu font-tabular">
                      Quỹ giường trống thực (đã trừ bảo trì &amp; giữ chỗ): Nam{' '}
                      <strong className="text-tx">{forecast.totalFreeMale}</strong> · Nữ{' '}
                      <strong className="text-tx">{forecast.totalFreeFemale}</strong> · Phòng trống linh hoạt{' '}
                      <strong className="text-tx">{forecast.totalFreeFlex}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyZalo}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-surf border border-bdr2 hover:bg-act text-xs font-bold text-tx cursor-pointer shrink-0"
                >
                  {copiedZalo ? <Check size={13} className="text-ok" /> : <Copy size={13} className="text-lnk" />}
                  <span>{copiedZalo ? 'Đã copy Zalo' : 'Copy báo cáo Zalo'}</span>
                </button>
              </div>

              {/* Proposed Allocation Table */}
              {forecast.allocations.length > 0 ? (
                <div className="rounded-2xl border border-bdr overflow-hidden divide-y divide-bdr">
                  <div className="px-4 py-2.5 bg-act/60 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-mu">
                    <span>Phương án phân bổ phòng tối ưu</span>
                    <span>{forecast.slotsToReserve.length} giường</span>
                  </div>
                  {forecast.allocations.map(a => (
                    <div
                      key={`${a.ktx}-${a.day}-${a.phongSo}-${a.forGender}`}
                      className="px-4 py-2.5 bg-surf flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-tx">
                          {a.ktx} · {a.day} · {a.roomDisplay}
                        </span>
                        <StatusTag tone={a.forGender === 'Nữ' ? 'pink' : 'blue'}>{a.forGender}</StatusTag>
                        {a.wasFlexRoom && <StatusTag tone="teal">Phòng trống mới mở</StatusTag>}
                      </div>
                      <div className="flex items-center gap-2 font-tabular">
                        <MonoChip tone="blue">{a.assignedBeds.length} giường</MonoChip>
                        <span className="text-[11px] text-mu truncate max-w-[200px]">
                          {a.assignedBeds.slice(0, 6).map(b => `G${b}`).join(', ')}
                          {a.assignedBeds.length > 6 ? ` +${a.assignedBeds.length - 6}` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-mu rounded-2xl border border-dashed border-bdr2">
                  Nhập số lượng công nhân Nam hoặc Nữ ở trên để hệ thống tính phương án phân bổ phòng.
                </div>
              )}
            </>
          ) : (
            <>
              {/* Tab 2: Batch Auto-Assign for Unbedded Workers */}
              {unbeddedWorkers.length === 0 ? (
                <div className="py-14 text-center space-y-2">
                  <CheckCircle2 size={34} className="mx-auto text-ok" />
                  <p className="text-sm font-bold text-tx">Tất cả công nhân đang ở đều đã có số giường!</p>
                  <p className="text-xs text-mu">Không có hồ sơ nào bị trống giường trong phạm vi quản lý.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Left: Select Unbedded Workers */}
                  <div className="lg:col-span-5 rounded-2xl border border-bdr bg-surf flex flex-col overflow-hidden max-h-[420px]">
                    <div className="p-3 border-b border-bdr space-y-2 bg-act/30">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-tx flex items-center gap-1.5">
                          <Users size={13} className="text-lnk" />
                          Chưa gắn giường ({selectedUnbeddedWorkers.length}/{unbeddedWorkers.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedUnbeddedWorkers.length === unbeddedWorkers.length) {
                              setSelectedWorkerIds(new Set());
                            } else {
                              setSelectedWorkerIds(new Set(unbeddedWorkers.map(w => w.id)));
                            }
                          }}
                          className="text-[11px] font-semibold text-lnk hover:underline cursor-pointer"
                        >
                          {selectedUnbeddedWorkers.length === unbeddedWorkers.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                        </button>
                      </div>
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mu" />
                        <input
                          type="text"
                          value={workerSearch}
                          onChange={e => setWorkerSearch(e.target.value)}
                          placeholder="Tìm theo tên, đơn vị, mã NV..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-page border border-bdr2 text-xs text-tx"
                        />
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-bdr">
                      {unbeddedWorkers.map(w => {
                        const checked = selectedWorkerIds.has(w.id);
                        return (
                          <label
                            key={w.id}
                            className="px-3 py-2 flex items-center gap-2.5 text-xs hover:bg-act/50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedWorkerIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(w.id)) next.delete(w.id);
                                  else next.add(w.id);
                                  return next;
                                });
                              }}
                              className="rounded accent-pri2 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-tx truncate">{w.hoVaTen}</div>
                              <div className="text-[11px] text-mu truncate">
                                {w.gioiTinh || 'Nam'} · {w.donVi || 'Chưa rõ đơn vị'}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: Auto-Assigned Preview */}
                  <div className="lg:col-span-7 rounded-2xl border border-bdr bg-surf flex flex-col overflow-hidden max-h-[420px]">
                    <div className="px-3.5 py-2.5 border-b border-bdr bg-act/30 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-tx flex items-center gap-1.5">
                        <BedDouble size={14} className="text-ok" />
                        Phương án đề xuất ({activeAssignments.length} công nhân)
                      </span>
                      {batchPlan.unassigned.length > 0 && (
                        <StatusTag tone="rose">Thiếu {batchPlan.unassigned.length} giường</StatusTag>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-bdr">
                      {batchPlan.assignments.length === 0 ? (
                        <div className="py-12 text-center text-xs text-mu">
                          Hãy chọn công nhân ở danh sách bên trái để hệ thống tự xếp giường.
                        </div>
                      ) : (
                        batchPlan.assignments.map(a => {
                          const isSkipped = skippedIds.has(a.worker.id);
                          return (
                            <div
                              key={a.worker.id}
                              className={`px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs ${
                                isSkipped ? 'opacity-45 bg-act/20' : ''
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-tx truncate">{a.worker.hoVaTen}</div>
                                <div className="text-[11px] text-mu flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <span>{a.worker.donVi || '—'}</span>
                                  <span>·</span>
                                  <span className="text-lnk font-semibold">
                                    {a.ktx} · {a.day} · {a.roomDisplay} · G{a.giuong}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <StatusTag
                                  tone={
                                    a.matchReason === 'reservation'
                                      ? 'amber'
                                      : a.matchReason === 'same_unit'
                                      ? 'teal'
                                      : 'blue'
                                  }
                                >
                                  {a.matchReason === 'reservation'
                                    ? 'Giữ chỗ'
                                    : a.matchReason === 'same_unit'
                                    ? 'Cùng ĐV'
                                    : a.matchReason === 'flex_room'
                                    ? 'Phòng mới'
                                    : 'Khớp GT'}
                                </StatusTag>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSkippedIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(a.worker.id)) next.delete(a.worker.id);
                                      else next.add(a.worker.id);
                                      return next;
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg bg-act text-[11px] font-semibold text-mu hover:text-tx cursor-pointer"
                                >
                                  {isSkipped ? 'Bật lại' : 'Bỏ qua'}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bdr bg-surf flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-mu font-tabular">
            {commitProgress ||
              (activeTab === 'forecast'
                ? `Phương án đề xuất: ${forecast.slotsToReserve.length} giường (${forecast.allocations.length} phòng)`
                : `Sẵn sàng xếp giường: ${activeAssignments.length} công nhân`)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={reserving || committing}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-bdr2 bg-surf hover:bg-act text-xs font-semibold text-tx cursor-pointer"
            >
              Đóng
            </button>
            {activeTab === 'forecast' ? (
              <button
                type="button"
                disabled={reserving || forecast.slotsToReserve.length === 0}
                onClick={handleReserveAllPlan}
                className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {reserving ? <Loader2 size={13} className="animate-spin" /> : <BookmarkCheck size={13} />}
                <span>Đặt giữ chỗ toàn bộ ({forecast.slotsToReserve.length} giường)</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={committing || activeAssignments.length === 0}
                onClick={handleCommitBatchAssign}
                className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {committing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                <span>Xác nhận xếp {activeAssignments.length} giường</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
