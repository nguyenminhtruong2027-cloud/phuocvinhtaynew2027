'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  X,
  ArrowRight,
  CheckCircle2,
  Printer,
  Download,
  Loader2,
  Building2,
  Users,
  DoorOpen,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import {
  FacilityItem,
  formatRoomDisplay,
  RoomCapacityMap,
} from '@/lib/facilityCapacity';
import { loadSavedRoomGenderMap, fetchRoomLabelsAuthoritative } from '@/lib/roomGender';
import {
  buildConsolidationOrderHtml,
  computeConsolidationPlan,
  ConsolidationMoveGroup,
} from '@/lib/roomConsolidation';
import { reconcileBedsWithWorkers, releaseBedByLocation } from '@/lib/bedSync';
import { printHtmlViaIframe } from '@/lib/printHtml';
import { exportToExcel } from '@/lib/exportExcel';
import { getVNDateString } from '@/lib/vnDate';
import { StatusTag } from '@/components/ui/StatusTag';

interface RoomConsolidationModalProps {
  onClose: () => void;
  facilities: FacilityItem[];
  capacities: RoomCapacityMap;
  ktxList: string[];
  defaultKtx?: string;
  onExecuted?: () => Promise<void> | void;
}

export default function RoomConsolidationModal({
  onClose,
  facilities,
  capacities,
  ktxList,
  defaultKtx = 'all',
  onExecuted,
}: RoomConsolidationModalProps) {
  const { currentUser, isAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();
  const { workers, refreshWorkers } = useWorkers();

  const [ktxFilter, setKtxFilter] = useState<string>(defaultKtx || 'all');
  const [maxFillPercent, setMaxFillPercent] = useState<number>(35);
  const [sameDayOnly, setSameDayOnly] = useState<boolean>(false);
  const [sameContractorPriority, setSameContractorPriority] = useState<boolean>(true);
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>(
    () => loadSavedRoomGenderMap()
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);
  const [executedMoves, setExecutedMoves] = useState<ConsolidationMoveGroup[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchRoomLabelsAuthoritative()
      .then(res => {
        if (active && res.ok) {
          setRoomGenderMap(prev => ({ ...prev, ...res.data }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const plan = useMemo(
    () =>
      computeConsolidationPlan(workers, facilities, capacities, roomGenderMap, {
        ktxFilter,
        maxFillPercent,
        sameDayOnly,
        sameContractorPriority,
        allowBlockFn: isAdmin ? undefined : (day, ktx) => canWriteBlock(day, ktx),
      }),
    [workers, facilities, capacities, roomGenderMap, ktxFilter, maxFillPercent, sameDayOnly, sameContractorPriority, isAdmin, canWriteBlock]
  );

  // Sync selection whenever plan changes
  useEffect(() => {
    setSelectedIds(new Set(plan.moves.map(m => m.id)));
  }, [plan]);

  const selectedMoves = useMemo(
    () => plan.moves.filter(m => selectedIds.has(m.id)),
    [plan.moves, selectedIds]
  );

  const selectedWorkersCount = useMemo(
    () => selectedMoves.reduce((s, m) => s + m.workerMoves.length, 0),
    [selectedMoves]
  );

  const toggleMove = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrintOrder = (movesToPrint: ConsolidationMoveGroup[]) => {
    if (movesToPrint.length === 0) return;
    const html = buildConsolidationOrderHtml(
      movesToPrint,
      currentUser?.name || currentUser?.email || 'Ban Quản Lý KTX'
    );
    printHtmlViaIframe(html);
  };

  const handleExportExcel = (movesToExport: ConsolidationMoveGroup[]) => {
    const rows = movesToExport.flatMap((group, gIdx) =>
      group.workerMoves.map((wm, idx) => ({
        'LỆNH #': gIdx + 1,
        STT: idx + 1,
        'HỌ VÀ TÊN': wm.worker.hoVaTen,
        'MÃ NV': wm.worker.maNV || '',
        'ĐƠN VỊ': wm.worker.donVi || '',
        KTX: group.ktx,
        'DÃY CŨ': wm.fromDay,
        'PHÒNG CŨ': formatRoomDisplay(wm.fromRoom),
        'GIƯỜNG CŨ': wm.fromBed || '',
        'DÃY MỚI': wm.toDay,
        'PHÒNG MỚI': formatRoomDisplay(wm.toRoom),
        'GIƯỜNG MỚI': wm.suggestedBed,
        'TỔ TRƯỞNG': wm.worker.toTruong || '',
      }))
    );
    const today = getVNDateString().replace(/-/g, '');
    exportToExcel(rows, `Lenh_Don_Phong_KTX_${today}.xlsx`, 'Lenh_Don_Phong');
    toast.success(`Đã xuất Excel danh sách ${rows.length} công nhân chuyển phòng.`);
  };

  const handleExecuteConsolidation = async () => {
    if (selectedMoves.length === 0 || executing) return;
    setExecuting(true);
    const supabase = createClient();
    const snapshotMoves = [...selectedMoves];

    try {
      let movedOk = 0;
      const allWorkerMoves = snapshotMoves.flatMap(g => g.workerMoves);

      for (const wm of allWorkerMoves) {
        const khoaTraCuu = `${wm.toKtx}|${wm.toDay}|${wm.toRoom}`;
        const { error } = await supabase
          .from('workers')
          .update({
            ktx: wm.toKtx,
            day: wm.toDay,
            phong_so: wm.toRoom,
            giuong: wm.suggestedBed,
            khoa_tra_cuu: khoaTraCuu,
          })
          .eq('id', wm.worker.id);

        if (!error) {
          movedOk++;
          if (wm.fromBed) {
            await releaseBedByLocation(supabase, {
              workerIds: [wm.worker.id],
              ktx: wm.worker.ktx || wm.toKtx,
              day: wm.fromDay,
              phongSo: wm.fromRoom,
              giuong: wm.fromBed,
            }).catch(() => {});
          }
        }
      }

      // Reconcile beds table cleanly with updated workers
      await reconcileBedsWithWorkers(supabase).catch(() => {});

      addLog(
        currentUser?.email || currentUser?.name || 'system',
        'ROOM_CONSOLIDATION',
        `Dồn phòng thông minh: giải phóng ${snapshotMoves.length} phòng trống nguyên căn, điều chuyển ${movedOk} công nhân`
      );

      await refreshWorkers();
      if (onExecuted) await onExecuted();
      setExecutedMoves(snapshotMoves);
      toast.success(
        `Đã thực thi dồn phòng: giải phóng ${snapshotMoves.length} phòng trống (${movedOk} công nhân đã chuyển vị trí).`
      );
    } catch (err) {
      toast.error(`Lỗi khi thực thi dồn phòng: ${err instanceof Error ? err.message : 'Không xác định'}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-bdr flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk shrink-0">
              <Layers size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-tx">Động cơ Dồn phòng Thông minh (Tối ưu Quỹ giường)</h2>
              <p className="text-xs text-mu mt-0.5">
                Tự động gộp phòng thưa cùng giới tính & ưu tiên cùng nhà thầu để giải phóng phòng trống nguyên căn
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Completed execution view */}
        {executedMoves ? (
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            <div className="rounded-2xl bg-okbg border border-ok2/35 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={24} className="text-ok shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-bold text-ok">
                    Đã hoàn tất Dồn phòng & Đồng bộ sơ đồ giường
                  </h3>
                  <p className="text-xs text-tx mt-1">
                    Giải phóng thành công <strong>{executedMoves.length} phòng trống nguyên căn</strong> và cập nhật vị trí giường mới cho{' '}
                    <strong>{executedMoves.reduce((s, m) => s + m.workerMoves.length, 0)} công nhân</strong>. Hãy in Lệnh điều chuyển để giao Bảo vệ & Tổ trưởng triển khai thực tế.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handlePrintOrder(executedMoves)}
                  className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer size={14} />
                  <span>In Lệnh Điều Chuyển (A4)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportExcel(executedMoves)}
                  className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Download size={14} />
                  <span>Xuất Excel</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {executedMoves.map((m, idx) => (
                <div key={m.id} className="p-3 rounded-xl border border-bdr bg-surf flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-tx">
                    <span className="font-tabular text-mu">#{idx + 1}</span>
                    <span>{m.sourceDay} · {formatRoomDisplay(m.sourceRoom)}</span>
                    <ArrowRight size={13} className="text-pri2" />
                    <span className="text-lnk">{m.targetDay} · {formatRoomDisplay(m.targetRoom)}</span>
                  </div>
                  <span className="text-ok font-semibold font-tabular">
                    Đã chuyển {m.workerMoves.length} người · Phòng nguồn trống 100%
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="btn-primary text-xs">
                Đóng cửa sổ
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tuning Controls */}
            <div className="px-5 py-3.5 bg-act/40 border-b border-bdr flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Building2 size={14} className="text-mu" />
                  <select
                    value={ktxFilter}
                    onChange={e => setKtxFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-surf border border-bdr2 text-tx"
                  >
                    <option value="all">Tất cả KTX</option>
                    {ktxList.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1 text-xs">
                  <span className="text-mu font-medium mr-1">Ngưỡng phòng thưa:</span>
                  {[25, 35, 50].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setMaxFillPercent(pct)}
                      className={`px-2.5 py-1 rounded-lg font-bold font-tabular border cursor-pointer ${
                        maxFillPercent === pct
                          ? 'bg-pri text-white border-pri'
                          : 'bg-surf text-tx border-bdr2 hover:bg-act'
                      }`}
                    >
                      ≤ {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-tx font-medium">
                  <input
                    type="checkbox"
                    checked={sameContractorPriority}
                    onChange={e => setSameContractorPriority(e.target.checked)}
                    className="rounded"
                  />
                  <span>Ưu tiên cùng nhà thầu</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-tx font-medium">
                  <input
                    type="checkbox"
                    checked={sameDayOnly}
                    onChange={e => setSameDayOnly(e.target.checked)}
                    className="rounded"
                  />
                  <span>Chỉ dồn trong cùng Dãy</span>
                </label>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Outcome Metrics Strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-okbg border border-ok2/35">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-ok uppercase">
                    <DoorOpen size={13} /> Phòng trống giải phóng
                  </div>
                  <div className="text-2xl font-extrabold text-ok font-tabular mt-1">
                    {selectedMoves.length} <span className="text-xs font-semibold">phòng</span>
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-surf border border-bdr">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-mu uppercase">
                    <Users size={13} /> Công nhân cần di chuyển
                  </div>
                  <div className="text-2xl font-extrabold text-tx font-tabular mt-1">
                    {selectedWorkersCount} <span className="text-xs font-semibold text-mu">người</span>
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-surf border border-bdr">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-mu uppercase">
                    <Layers size={13} /> Tổng phòng thưa quét được
                  </div>
                  <div className="text-2xl font-extrabold text-tx font-tabular mt-1">
                    {plan.summary.sparseRoomsCount} <span className="text-xs font-semibold text-mu">phòng</span>
                  </div>
                </div>
              </div>

              {plan.skippedMixedRooms.length > 0 && (
                <div className="p-3 rounded-xl tint-wn border border-wn/35 flex items-start gap-2 text-xs text-wn">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Bỏ qua tự động <strong>{plan.skippedMixedRooms.length} phòng</strong> đang ghi nhận cả Nam và Nữ ở chung để tránh ghép sai giới tính.
                  </span>
                </div>
              )}

              {plan.moves.length === 0 ? (
                <div className="py-12 text-center space-y-2 border border-dashed border-bdr2 rounded-2xl">
                  <CheckCircle2 size={32} className="mx-auto text-ok opacity-80" />
                  <p className="text-sm font-bold text-tx">Quỹ phòng hiện đã gọn, chưa có phương án dồn phòng phù hợp</p>
                  <p className="text-xs text-mu max-w-md mx-auto">
                    Thử nâng ngưỡng phòng thưa lên ≤ 50% hoặc bỏ giới hạn &quot;Chỉ dồn trong cùng Dãy&quot; để tìm thêm phương án tối ưu.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {plan.moves.map((group, idx) => {
                    const checked = selectedIds.has(group.id);
                    return (
                      <div
                        key={group.id}
                        className={`rounded-xl border transition-colors ${
                          checked ? 'border-pri2/50 bg-surf' : 'border-bdr bg-surf/40 opacity-60'
                        }`}
                      >
                        <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-bdr">
                          <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMove(group.id)}
                              className="rounded w-4 h-4"
                            />
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-bold text-mu font-tabular">#{idx + 1}</span>
                              <span className="font-bold text-tx">
                                {group.sourceDay} · {formatRoomDisplay(group.sourceRoom)}
                              </span>
                              <span className="text-mu font-tabular">
                                ({group.sourceOccupied}/{group.sourceCapacity})
                              </span>
                              <ArrowRight size={14} className="text-pri2" />
                              <span className="font-bold text-lnk">
                                {group.targetDay} · {formatRoomDisplay(group.targetRoom)}
                              </span>
                              <span className="text-ok font-bold font-tabular">
                                ({group.targetOccupiedBefore} → {group.targetOccupiedAfter}/{group.targetCapacity})
                              </span>
                            </div>
                          </label>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusTag tone={group.gender === 'female' ? 'pink' : 'blue'} size="sm">
                              {group.gender === 'female' ? 'Phòng Nữ' : 'Phòng Nam'}
                            </StatusTag>
                            {group.sameContractor && (
                              <StatusTag tone="teal" size="sm">Cùng nhà thầu</StatusTag>
                            )}
                            {group.sameDay && (
                              <StatusTag tone="slate" size="sm">Cùng dãy</StatusTag>
                            )}
                          </div>
                        </div>

                        <div className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mu">
                          {group.workerMoves.map(wm => (
                            <span key={wm.worker.id} className="inline-flex items-center gap-1">
                              <strong className="text-tx">{wm.worker.hoVaTen}</strong>
                              <span>({wm.worker.donVi || '—'})</span>
                              <span className="text-lnk font-tabular">→ G{wm.suggestedBed}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-bdr flex flex-wrap items-center justify-between gap-3 shrink-0 bg-surf">
              <div className="flex items-center gap-2">
                {selectedMoves.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePrintOrder(selectedMoves)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf border border-bdr2 text-tx text-xs font-semibold hover:bg-act cursor-pointer"
                    >
                      <Printer size={13} />
                      <span>Xem trước lệnh in A4</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportExcel(selectedMoves)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf border border-bdr2 text-tx text-xs font-semibold hover:bg-act cursor-pointer"
                    >
                      <Download size={13} />
                      <span>Xuất Excel</span>
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="btn-secondary text-xs" disabled={executing}>
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleExecuteConsolidation}
                  disabled={selectedMoves.length === 0 || executing}
                  className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {executing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>
                    {executing
                      ? 'Đang chuyển phòng & đồng bộ...'
                      : `Thực thi dồn ${selectedMoves.length} phòng (${selectedWorkersCount} người)`}
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
