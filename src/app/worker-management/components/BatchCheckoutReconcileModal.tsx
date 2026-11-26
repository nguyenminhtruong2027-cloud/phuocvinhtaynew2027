'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  UserMinus,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Lock,
  Loader2,
  Download,
  ClipboardPaste,
  Search,
  Building2,
  Users,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Worker } from '@/data/workers';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { StatusTag } from '@/components/ui/StatusTag';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import {
  BatchCheckoutAnalysis,
  ParsedRosterFile,
  RosterReconcileResult,
  exportReconcileReportExcel,
  matchBatchCheckoutTargets,
  parseBatchIdentifiers,
  parseRosterFile,
  reconcileRosterWithKtx,
} from '@/lib/workerReconcile';

interface Props {
  workers: Worker[];
  initialTab?: 'batch-checkout' | 'reconcile';
  onClose: () => void;
  onSuccess?: () => void;
}

export default function BatchCheckoutReconcileModal({
  workers,
  initialTab = 'batch-checkout',
  onClose,
  onSuccess,
}: Props) {
  const { currentUser, isAdmin, canWriteBlock } = useAuth();
  const { addLog } = useAudit();
  const { deleteWorkers } = useWorkers();

  const [activeTab, setActiveTab] = useState<'batch-checkout' | 'reconcile'>(initialTab);

  // ── Tab 1: Batch Check-out state ──────────────────────────────────────────
  const [pasteInput, setPasteInput] = useState('');
  const [checkoutReason, setCheckoutReason] = useState('Nghỉ việc công trường / Rời KTX theo danh sách Nhân sự');
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [pickedAmbiguousIds, setPickedAmbiguousIds] = useState<Set<string>>(new Set());
  const [executingCheckout, setExecutingCheckout] = useState(false);
  const batchFileRef = useRef<HTMLInputElement>(null);

  // ── Tab 2: Roster Reconcile state ─────────────────────────────────────────
  const [rosterFile, setRosterFile] = useState<ParsedRosterFile | null>(null);
  const [rosterSubTab, setRosterSubTab] = useState<'only-ktx' | 'only-roster' | 'matched'>('only-ktx');
  const [rosterSearch, setRosterSearch] = useState('');
  const [reconcileSelectedIds, setReconcileSelectedIds] = useState<Set<string>>(new Set());
  const [reconcileReason, setReconcileReason] = useState('Đối soát quân số: Không có trong danh sách đi làm công trường');
  const [executingReconcileCheckout, setExecutingReconcileCheckout] = useState(false);
  const [parsingFile, setParsingFile] = useState(false);
  const rosterFileRef = useRef<HTMLInputElement>(null);

  const canCheckoutWorker = (w: Worker): boolean => {
    if (isAdmin) return true;
    return canWriteBlock(w.day || '', w.ktx || '');
  };

  // Analyze pasted batch tokens live
  const batchAnalysis: BatchCheckoutAnalysis = useMemo(() => {
    const tokens = parseBatchIdentifiers(pasteInput);
    return matchBatchCheckoutTargets(tokens, workers);
  }, [pasteInput, workers]);

  // Compute final selected worker IDs for Tab 1 (strictly within user's RBAC scope)
  const finalBatchWorkers: Worker[] = useMemo(() => {
    const map = new Map<string, Worker>();
    for (const item of batchAnalysis.matched) {
      if (!deselectedIds.has(item.worker.id) && canCheckoutWorker(item.worker)) {
        map.set(item.worker.id, item.worker);
      }
    }
    for (const amb of batchAnalysis.ambiguous) {
      for (const c of amb.candidates) {
        if (pickedAmbiguousIds.has(c.id) && canCheckoutWorker(c)) {
          map.set(c.id, c);
        }
      }
    }
    return Array.from(map.values());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchAnalysis, deselectedIds, pickedAmbiguousIds, isAdmin]);

  // Compute roster reconciliation for Tab 2
  const reconcileResult: RosterReconcileResult | null = useMemo(() => {
    if (!rosterFile) return null;
    return reconcileRosterWithKtx(rosterFile.rows, workers);
  }, [rosterFile, workers]);

  const filteredOnlyKtx = useMemo(() => {
    if (!reconcileResult) return [];
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return reconcileResult.inKtxNotInRoster;
    return reconcileResult.inKtxNotInRoster.filter(w =>
      `${w.hoVaTen} ${w.maNV} ${w.cccd} ${w.donVi} ${w.day} ${w.phongSo}`.toLowerCase().includes(q)
    );
  }, [reconcileResult, rosterSearch]);

  const filteredOnlyRoster = useMemo(() => {
    if (!reconcileResult) return [];
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return reconcileResult.inRosterNotInKtx;
    return reconcileResult.inRosterNotInKtx.filter(r =>
      `${r.hoVaTen} ${r.maNV} ${r.cccd} ${r.donVi} ${r.tieuDoan}`.toLowerCase().includes(q)
    );
  }, [reconcileResult, rosterSearch]);

  const filteredMatched = useMemo(() => {
    if (!reconcileResult) return [];
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return reconcileResult.matched;
    return reconcileResult.matched.filter(m =>
      `${m.worker.hoVaTen} ${m.worker.maNV} ${m.worker.cccd} ${m.worker.donVi} ${m.worker.day} ${m.worker.phongSo}`
        .toLowerCase()
        .includes(q)
    );
  }, [reconcileResult, rosterSearch]);

  const handleUploadBatchExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setParsingFile(true);
    try {
      const parsed = await parseRosterFile(file);
      const lines = parsed.rows
        .map(r => r.cccd || r.maNV || r.hoVaTen)
        .filter(Boolean);
      if (lines.length === 0) {
        toast.warning('Không đọc được CCCD, Mã NV hoặc Họ tên nào trong file.');
      } else {
        setPasteInput(prev => (prev.trim() ? `${prev.trim()}\n${lines.join('\n')}` : lines.join('\n')));
        setDeselectedIds(new Set());
        setPickedAmbiguousIds(new Set());
        toast.success(`Đã nạp ${lines.length} dòng định danh từ file "${file.name}".`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể đọc file Excel.');
    } finally {
      setParsingFile(false);
    }
  };

  const handleUploadRosterExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setParsingFile(true);
    try {
      const parsed = await parseRosterFile(file);
      if (parsed.rows.length === 0) {
        toast.warning('File nhân sự không có dòng dữ liệu hợp lệ nào.');
        return;
      }
      setRosterFile(parsed);
      setReconcileSelectedIds(new Set());
      setRosterSubTab('only-ktx');
      toast.success(`Đã phân tích ${parsed.rows.length} nhân sự từ "${file.name}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể đọc file Excel.');
    } finally {
      setParsingFile(false);
    }
  };

  const executeBatchCheckout = async (targetList: Worker[], reasonText: string, sourceTag: string) => {
    if (targetList.length === 0) {
      toast.warning('Chưa có công nhân hợp lệ nào được chọn để Check-out.');
      return;
    }
    const ids = targetList.map(w => w.id);
    const sampleNames = targetList.slice(0, 6).map(w => `${w.hoVaTen}${w.phongSo ? ` (${formatRoomDisplay(w.phongSo)})` : ''}`);
    try {
      await deleteWorkers(ids);
      addLog(
        currentUser?.email || currentUser?.name || 'Admin',
        'BATCH_CHECKOUT',
        JSON.stringify({
          event: 'BATCH_CHECKOUT',
          source: sourceTag,
          count: ids.length,
          reason: reasonText.trim() || 'Check-out hàng loạt',
          sample: sampleNames,
          summary: `Check-out hàng loạt ${ids.length} công nhân (${reasonText.trim() || 'theo danh sách'}) · Đã giải phóng toàn bộ giường`,
        })
      );
      toast.success(`Đã Check-out thành công ${ids.length} công nhân và giải phóng toàn bộ giường!`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Check-out hàng loạt gặp lỗi.');
    }
  };

  const handleConfirmBatchCheckout = async () => {
    if (finalBatchWorkers.length === 0) return;
    setExecutingCheckout(true);
    try {
      await executeBatchCheckout(finalBatchWorkers, checkoutReason, 'batch_paste_checkout');
    } finally {
      setExecutingCheckout(false);
    }
  };

  const handleConfirmReconcileCheckout = async () => {
    if (!reconcileResult) return;
    const targets = reconcileResult.inKtxNotInRoster.filter(
      w => reconcileSelectedIds.has(w.id) && canCheckoutWorker(w)
    );
    if (targets.length === 0) {
      toast.warning('Hãy tích chọn các công nhân cần Check-out trong danh sách lệch.');
      return;
    }
    setExecutingReconcileCheckout(true);
    try {
      await executeBatchCheckout(targets, reconcileReason, 'roster_reconcile_checkout');
    } finally {
      setExecutingReconcileCheckout(false);
    }
  };

  const toggleAllManageableOnlyKtx = () => {
    const manageable = filteredOnlyKtx.filter(canCheckoutWorker);
    if (manageable.length === 0) return;
    const allSelected = manageable.every(w => reconcileSelectedIds.has(w.id));
    setReconcileSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        manageable.forEach(w => next.delete(w.id));
      } else {
        manageable.forEach(w => next.add(w.id));
      }
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-3 sm:p-5 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-surf border border-bdr2 shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-dgrbg text-dgr border border-dgr/35 flex items-center justify-center shrink-0">
              <UserMinus size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-tx truncate">
                Đối Soát Quân Số & Check-out Hàng Loạt
              </h2>
              <p className="text-xs text-mu mt-0.5">
                Dán danh sách nghỉ việc từ Zalo/Excel để giải phóng giường tức thì hoặc đối chiếu quân số công trường ↔ KTX
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

        {/* Mode Tabs */}
        <div className="px-5 py-3 border-b border-bdr bg-page/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <SlidingTabs<'batch-checkout' | 'reconcile'>
            layoutId="batch-checkout-reconcile-tabs"
            compact
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              {
                id: 'batch-checkout',
                label: 'Check-out Hàng Loạt (Paste / Excel)',
                icon: ClipboardPaste,
                count: finalBatchWorkers.length || undefined,
              },
              {
                id: 'reconcile',
                label: 'Đối Chiếu Quân Số Công Trường ↔ KTX',
                icon: FileSpreadsheet,
                count: reconcileResult?.inKtxNotInRoster.length || undefined,
              },
            ]}
          />
          <span className="text-[11px] text-mu">
            Đang đối chiếu với <strong className="text-tx font-mono">{workers.length.toLocaleString('vi-VN')}</strong> cư dân KTX
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'batch-checkout' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Input Paste + Upload */}
              <div className="lg:col-span-5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-tx">
                    1. Nhập hoặc tải danh sách rời KTX
                  </label>
                  <button
                    type="button"
                    onClick={() => batchFileRef.current?.click()}
                    disabled={parsingFile}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bdg border border-bdr2 text-lnk text-xs font-bold hover:opacity-90 cursor-pointer"
                  >
                    {parsingFile ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    <span>Nạp từ Excel</span>
                  </button>
                  <input
                    ref={batchFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleUploadBatchExcel}
                  />
                </div>

                <textarea
                  value={pasteInput}
                  onChange={e => {
                    setPasteInput(e.target.value);
                    setDeselectedIds(new Set());
                    setPickedAmbiguousIds(new Set());
                  }}
                  rows={10}
                  placeholder={`Dán mỗi dòng 1 số CCCD, Mã NV hoặc Họ tên...\nVí dụ:\n080098001234\nNV-20451\nNguyễn Văn An`}
                  className="w-full rounded-xl bg-page border border-bdr2 px-3.5 py-3 text-xs font-mono text-tx placeholder:text-mu/70 focus:outline-none focus:ring-2 focus:ring-pri/40 resize-none"
                />

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-tx">Lý do Check-out chung (ghi Nhật ký hệ thống)</label>
                  <input
                    type="text"
                    value={checkoutReason}
                    onChange={e => setCheckoutReason(e.target.value)}
                    placeholder="VD: Nghỉ việc công trường đợt 26/11..."
                    className="w-full rounded-xl bg-page border border-bdr2 px-3 py-2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/40"
                  />
                </div>

                {batchAnalysis.totalTokens > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="rounded-xl p-2.5 bg-okbg border border-ok2/30 text-center">
                      <div className="text-lg font-extrabold font-mono text-ok">{batchAnalysis.matched.length}</div>
                      <div className="text-[11px] font-semibold text-ok">Khớp 1–1</div>
                    </div>
                    <div className="rounded-xl p-2.5 tint-wn border border-wn/35 text-center">
                      <div className="text-lg font-extrabold font-mono text-wn">{batchAnalysis.ambiguous.length}</div>
                      <div className="text-[11px] font-semibold text-wn">Trùng tên</div>
                    </div>
                    <div className="rounded-xl p-2.5 bg-act border border-bdr text-center">
                      <div className="text-lg font-extrabold font-mono text-mu">{batchAnalysis.notFound.length}</div>
                      <div className="text-[11px] font-semibold text-mu">Không thấy</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Preview matched / ambiguous / not found */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-tx">
                    2. Xem trước kết quả đối chiếu
                  </span>
                  {pasteInput.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setPasteInput('');
                        setDeselectedIds(new Set());
                        setPickedAmbiguousIds(new Set());
                      }}
                      className="text-xs text-mu hover:text-dgr font-semibold cursor-pointer"
                    >
                      Xóa danh sách nhập
                    </button>
                  )}
                </div>

                {batchAnalysis.totalTokens === 0 ? (
                  <div className="rounded-2xl border border-dashed border-bdr2 bg-page/50 p-10 text-center space-y-2">
                    <ClipboardPaste size={28} className="mx-auto text-mu/60" />
                    <p className="text-sm font-bold text-tx">Chưa có dữ liệu đối chiếu</p>
                    <p className="text-xs text-mu max-w-sm mx-auto leading-relaxed">
                      Copy cột CCCD, Mã NV hoặc Họ tên từ tin nhắn Zalo / file Excel nhân sự rồi dán vào ô bên trái. Hệ thống tự nhận diện phòng & giường trước khi Check-out.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                    {/* Matched 1-1 */}
                    {batchAnalysis.matched.length > 0 && (
                      <div className="rounded-xl border border-bdr overflow-hidden">
                        <div className="px-3.5 py-2 bg-okbg border-b border-ok2/25 flex items-center justify-between">
                          <span className="text-xs font-bold text-ok flex items-center gap-1.5">
                            <CheckCircle2 size={14} />
                            Khớp chính xác ({batchAnalysis.matched.length} người)
                          </span>
                          <span className="text-[11px] text-ok/80">Tích chọn để Check-out</span>
                        </div>
                        <div className="divide-y divide-bdr bg-surf">
                          {batchAnalysis.matched.map(({ token, worker, matchedBy }) => {
                            const allowed = canCheckoutWorker(worker);
                            const checked = allowed && !deselectedIds.has(worker.id);
                            return (
                              <label
                                key={worker.id}
                                className={`flex items-center gap-3 px-3.5 py-2.5 text-xs ${
                                  allowed ? 'hover:bg-act/50 cursor-pointer' : 'opacity-65 bg-act/30 cursor-not-allowed'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={!allowed}
                                  checked={checked}
                                  onChange={() => {
                                    setDeselectedIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(worker.id)) next.delete(worker.id);
                                      else next.add(worker.id);
                                      return next;
                                    });
                                  }}
                                  className="rounded border-bdr2 accent-red-600 w-4 h-4 shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-tx">{worker.hoVaTen}</span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-act text-mu border border-bdr">
                                      {matchedBy === 'cccd' ? `CCCD: ${worker.cccd}` : matchedBy === 'maNV' ? `MNV: ${worker.maNV}` : `Tên (${token.raw})`}
                                    </span>
                                    {!allowed && (
                                      <StatusTag tone="amber" size="sm" icon={Lock}>
                                        Ngoài phạm vi dãy phụ trách
                                      </StatusTag>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-mu mt-0.5 flex flex-wrap items-center gap-x-2">
                                    <span>{worker.donVi || '—'}</span>
                                    <span>·</span>
                                    <span className="text-tx font-semibold">
                                      {worker.day || '—'} {worker.phongSo ? `· ${formatRoomDisplay(worker.phongSo)}` : ''} {worker.giuong ? `· G${worker.giuong}` : ''}
                                    </span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Ambiguous matches */}
                    {batchAnalysis.ambiguous.length > 0 && (
                      <div className="rounded-xl border border-wn/40 overflow-hidden">
                        <div className="px-3.5 py-2 tint-wn border-b border-wn/30 flex items-center justify-between">
                          <span className="text-xs font-bold text-wn flex items-center gap-1.5">
                            <AlertTriangle size={14} />
                            Trùng tên — cần chọn tay ({batchAnalysis.ambiguous.length} dòng)
                          </span>
                          <span className="text-[11px] text-wn/90">Không tự động chọn để tránh xóa nhầm</span>
                        </div>
                        <div className="divide-y divide-bdr bg-surf">
                          {batchAnalysis.ambiguous.map((amb, idx) => (
                            <div key={`${amb.token.raw}-${idx}`} className="p-3 space-y-2">
                              <div className="text-xs font-bold text-tx">
                                Dòng #{amb.token.lineNumber}: &ldquo;{amb.token.raw}&rdquo; khớp {amb.candidates.length} người:
                              </div>
                              <div className="space-y-1.5 pl-2">
                                {amb.candidates.map(cand => {
                                  const allowed = canCheckoutWorker(cand);
                                  const checked = allowed && pickedAmbiguousIds.has(cand.id);
                                  return (
                                    <label
                                      key={cand.id}
                                      className={`flex items-center gap-2.5 p-2 rounded-lg border border-bdr text-xs ${
                                        allowed ? 'hover:bg-act/50 cursor-pointer' : 'opacity-60 cursor-not-allowed'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        disabled={!allowed}
                                        checked={checked}
                                        onChange={() => {
                                          setPickedAmbiguousIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(cand.id)) next.delete(cand.id);
                                            else next.add(cand.id);
                                            return next;
                                          });
                                        }}
                                        className="rounded border-bdr2 accent-red-600 w-4 h-4 shrink-0"
                                      />
                                      <span className="font-bold text-tx">{cand.hoVaTen}</span>
                                      <span className="text-[11px] text-mu font-mono">CCCD: {cand.cccd || '—'}</span>
                                      <span className="text-[11px] text-lnk font-semibold ml-auto">
                                        {cand.day} · {cand.phongSo ? formatRoomDisplay(cand.phongSo) : '—'} {cand.giuong ? `· G${cand.giuong}` : ''}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Not found */}
                    {batchAnalysis.notFound.length > 0 && (
                      <div className="rounded-xl border border-bdr overflow-hidden">
                        <div className="px-3.5 py-2 bg-act border-b border-bdr flex items-center gap-1.5 text-xs font-bold text-mu">
                          <HelpCircle size={14} />
                          Không tìm thấy trong KTX ({batchAnalysis.notFound.length} dòng — có thể đã check-out trước đó)
                        </div>
                        <div className="p-3 bg-surf flex flex-wrap gap-1.5">
                          {batchAnalysis.notFound.map((nf, i) => (
                            <span
                              key={`${nf.raw}-${i}`}
                              className="px-2 py-1 rounded-lg bg-page border border-bdr text-[11px] font-mono text-mu"
                            >
                              {nf.raw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* TAB 2: SITE HR ROSTER RECONCILIATION */
            <div className="space-y-4">
              {/* Upload dropzone / summary strip */}
              <div className="rounded-2xl border border-bdr2 bg-page/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bdg text-lnk border border-pri2/30 flex items-center justify-center shrink-0">
                    <FileSpreadsheet size={19} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-tx">
                      {rosterFile ? `Đã nạp: ${rosterFile.fileName}` : 'Tải file Danh sách Nhân sự đang đi làm ngoài công trường'}
                    </h3>
                    <p className="text-xs text-mu mt-0.5">
                      {rosterFile
                        ? `Đọc được ${rosterFile.rows.length.toLocaleString('vi-VN')} dòng · Tự nhận diện cột: ${
                            [
                              rosterFile.detectedColumns.cccd && `CCCD (${rosterFile.detectedColumns.cccd})`,
                              rosterFile.detectedColumns.maNV && `Mã NV (${rosterFile.detectedColumns.maNV})`,
                              rosterFile.detectedColumns.hoVaTen && `Họ tên (${rosterFile.detectedColumns.hoVaTen})`,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'Cột đầu tiên'
                          }`
                        : 'Hỗ trợ .xlsx, .xls, .csv. Hệ thống tự động đối chiếu theo CCCD → Mã NV → Họ tên để tìm người đã nghỉ việc nhưng còn ở KTX.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {reconcileResult && (
                    <button
                      type="button"
                      onClick={() => {
                        const ok = exportReconcileReportExcel(reconcileResult, rosterFile?.fileName);
                        if (ok) toast.success('Đã xuất báo cáo đối soát 4 sheet (.xlsx).');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-okbg border border-ok2/35 text-ok text-xs font-bold hover:opacity-90 cursor-pointer"
                    >
                      <Download size={14} />
                      <span>Xuất Báo cáo Excel</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => rosterFileRef.current?.click()}
                    disabled={parsingFile}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-pri text-white text-xs font-bold hover:opacity-95 cursor-pointer"
                  >
                    {parsingFile ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    <span>{rosterFile ? 'Đổi file khác' : 'Chọn file Nhân sự (.xlsx)'}</span>
                  </button>
                  <input
                    ref={rosterFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleUploadRosterExcel}
                  />
                </div>
              </div>

              {reconcileResult && (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setRosterSubTab('only-ktx')}
                      className={`rounded-xl p-3.5 border text-left transition-all cursor-pointer ${
                        rosterSubTab === 'only-ktx'
                          ? 'bg-dgrbg border-dgr/60 ring-1 ring-dgr/30'
                          : 'bg-surf border-bdr hover:bg-act/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-dgr">Ở KTX · Không có DS đi làm</span>
                        <AlertTriangle size={15} className="text-dgr" />
                      </div>
                      <div className="text-2xl font-extrabold font-mono text-dgr mt-1">
                        {reconcileResult.inKtxNotInRoster.length.toLocaleString('vi-VN')}
                      </div>
                      <p className="text-[11px] text-mu mt-0.5">Nguy cơ đã nghỉ việc chưa trả giường</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRosterSubTab('only-roster')}
                      className={`rounded-xl p-3.5 border text-left transition-all cursor-pointer ${
                        rosterSubTab === 'only-roster'
                          ? 'tint-wn border-wn/60 ring-1 ring-wn/30'
                          : 'bg-surf border-bdr hover:bg-act/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-wn">Đi làm · Chưa có trong KTX</span>
                        <Users size={15} className="text-wn" />
                      </div>
                      <div className="text-2xl font-extrabold font-mono text-wn mt-1">
                        {reconcileResult.inRosterNotInKtx.length.toLocaleString('vi-VN')}
                      </div>
                      <p className="text-[11px] text-mu mt-0.5">Trọ ngoài hoặc vào KTX chưa khai báo</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRosterSubTab('matched')}
                      className={`rounded-xl p-3.5 border text-left transition-all cursor-pointer ${
                        rosterSubTab === 'matched'
                          ? 'bg-okbg border-ok2/60 ring-1 ring-ok2/30'
                          : 'bg-surf border-bdr hover:bg-act/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-ok">Khớp chuẩn 2 bên</span>
                        <CheckCircle2 size={15} className="text-ok" />
                      </div>
                      <div className="text-2xl font-extrabold font-mono text-ok mt-1">
                        {reconcileResult.matched.length.toLocaleString('vi-VN')}
                      </div>
                      <p className="text-[11px] text-mu mt-0.5">
                        Tỷ lệ khớp KTX:{' '}
                        {reconcileResult.totalKtxActive > 0
                          ? Math.round((reconcileResult.matched.length / reconcileResult.totalKtxActive) * 100)
                          : 0}
                        %
                      </p>
                    </button>
                  </div>

                  {/* Unit summary chips */}
                  {reconcileResult.byUnitSummary.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold text-mu flex items-center gap-1 mr-1">
                        <Building2 size={12} /> Theo đơn vị:
                      </span>
                      {reconcileResult.byUnitSummary.slice(0, 8).map(u => (
                        <span
                          key={u.unit}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-page border border-bdr text-[11px]"
                        >
                          <span className="font-bold text-tx">{u.unit}</span>
                          <span className="text-ok font-mono">{u.matchedCount}/{u.totalKtx}</span>
                          {u.inKtxNotInRosterCount > 0 && (
                            <span className="text-dgr font-bold font-mono">(-{u.inKtxNotInRosterCount} lệch)</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Search + Action Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="relative flex-1 max-w-sm">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
                      <input
                        type="text"
                        value={rosterSearch}
                        onChange={e => setRosterSearch(e.target.value)}
                        placeholder="Lọc theo tên, CCCD, Mã NV, phòng..."
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-page border border-bdr2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/40"
                      />
                    </div>
                    {rosterSubTab === 'only-ktx' && filteredOnlyKtx.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={toggleAllManageableOnlyKtx}
                          className="px-3 py-1.5 rounded-xl bg-act border border-bdr2 text-xs font-semibold text-tx hover:bg-act/80 cursor-pointer"
                        >
                          Chọn / Bỏ chọn tất cả ({filteredOnlyKtx.filter(canCheckoutWorker).length})
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Result Table */}
                  <div className="rounded-xl border border-bdr overflow-hidden">
                    <div className="max-h-[300px] overflow-y-auto">
                      {rosterSubTab === 'only-ktx' && (
                        <table className="w-full text-left text-xs">
                          <thead className="bg-act text-mu text-[11px] uppercase sticky top-0 z-10 border-b border-bdr">
                            <tr>
                              <th className="px-3 py-2.5 w-10">Chọn</th>
                              <th className="px-3 py-2.5">Công nhân</th>
                              <th className="px-3 py-2.5">CCCD / Mã NV</th>
                              <th className="px-3 py-2.5">Đơn vị / Tổ trưởng</th>
                              <th className="px-3 py-2.5">Vị trí KTX</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-bdr bg-surf">
                            {filteredOnlyKtx.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-mu">
                                  Tuyệt vời! Không có công nhân KTX nào bị lệch khỏi danh sách đi làm.
                                </td>
                              </tr>
                            ) : (
                              filteredOnlyKtx.map(w => {
                                const allowed = canCheckoutWorker(w);
                                const checked = allowed && reconcileSelectedIds.has(w.id);
                                return (
                                  <tr key={w.id} className={allowed ? 'hover:bg-act/40' : 'opacity-60'}>
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        disabled={!allowed}
                                        checked={checked}
                                        onChange={() => {
                                          setReconcileSelectedIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(w.id)) next.delete(w.id);
                                            else next.add(w.id);
                                            return next;
                                          });
                                        }}
                                        className="rounded accent-red-600 w-4 h-4 cursor-pointer"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="font-bold text-tx">{w.hoVaTen}</div>
                                      {!allowed && <span className="text-[10px] text-wn">Ngoài phạm vi dãy phụ trách</span>}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-[11px] text-mu">
                                      <div>{w.cccd || '—'}</div>
                                      <div>{w.maNV || '—'}</div>
                                    </td>
                                    <td className="px-3 py-2 text-mu">
                                      <div className="text-tx font-medium">{w.donVi || '—'}</div>
                                      <div className="text-[11px]">{w.toTruong || '—'}</div>
                                    </td>
                                    <td className="px-3 py-2 font-semibold text-lnk">
                                      {w.day || '—'} · {w.phongSo ? formatRoomDisplay(w.phongSo) : '—'} {w.giuong ? `· G${w.giuong}` : ''}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      )}

                      {rosterSubTab === 'only-roster' && (
                        <table className="w-full text-left text-xs">
                          <thead className="bg-act text-mu text-[11px] uppercase sticky top-0 z-10 border-b border-bdr">
                            <tr>
                              <th className="px-3 py-2.5">Họ tên (File Nhân sự)</th>
                              <th className="px-3 py-2.5">CCCD / Mã NV</th>
                              <th className="px-3 py-2.5">Đơn vị / Tiểu đoàn</th>
                              <th className="px-3 py-2.5">SĐT</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-bdr bg-surf">
                            {filteredOnlyRoster.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-mu">
                                  Tất cả nhân sự trong file đã có mặt trên hệ thống KTX.
                                </td>
                              </tr>
                            ) : (
                              filteredOnlyRoster.slice(0, 300).map((r, i) => (
                                <tr key={`${r.rowIndex}-${i}`} className="hover:bg-act/40">
                                  <td className="px-3 py-2 font-bold text-tx">{r.hoVaTen || '(Không có tên)'}</td>
                                  <td className="px-3 py-2 font-mono text-[11px] text-mu">
                                    {r.cccd || '—'} {r.maNV ? `· ${r.maNV}` : ''}
                                  </td>
                                  <td className="px-3 py-2 text-mu">{r.donVi || '—'} {r.tieuDoan ? `· ${r.tieuDoan}` : ''}</td>
                                  <td className="px-3 py-2 font-mono text-mu">{r.soDienThoai || '—'}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      )}

                      {rosterSubTab === 'matched' && (
                        <table className="w-full text-left text-xs">
                          <thead className="bg-act text-mu text-[11px] uppercase sticky top-0 z-10 border-b border-bdr">
                            <tr>
                              <th className="px-3 py-2.5">Công nhân</th>
                              <th className="px-3 py-2.5">Khớp theo</th>
                              <th className="px-3 py-2.5">Đơn vị</th>
                              <th className="px-3 py-2.5">Phòng / Giường</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-bdr bg-surf">
                            {filteredMatched.slice(0, 300).map(m => (
                              <tr key={m.worker.id} className="hover:bg-act/40">
                                <td className="px-3 py-2 font-bold text-tx">{m.worker.hoVaTen}</td>
                                <td className="px-3 py-2">
                                  <span className="px-2 py-0.5 rounded bg-okbg text-ok font-semibold text-[11px]">
                                    {m.matchedBy === 'cccd' ? 'CCCD' : m.matchedBy === 'maNV' ? 'Mã NV' : 'Họ tên'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-mu">{m.worker.donVi || '—'}</td>
                                <td className="px-3 py-2 font-semibold text-tx">
                                  {m.worker.day} · {m.worker.phongSo ? formatRoomDisplay(m.worker.phongSo) : '—'} {m.worker.giuong ? `· G${m.worker.giuong}` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* Direct Checkout Action for Reconcile Mismatches */}
                  {rosterSubTab === 'only-ktx' && reconcileSelectedIds.size > 0 && (
                    <div className="rounded-xl p-3.5 bg-dgrbg border border-dgr/40 flex flex-col sm:flex-row sm:items-center gap-3">
                      <input
                        type="text"
                        value={reconcileReason}
                        onChange={e => setReconcileReason(e.target.value)}
                        className="flex-1 rounded-xl bg-surf border border-bdr2 px-3 py-2 text-xs text-tx"
                        placeholder="Lý do Check-out..."
                      />
                      <button
                        type="button"
                        disabled={executingReconcileCheckout}
                        onClick={handleConfirmReconcileCheckout}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-dgr hover:opacity-95 text-white text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {executingReconcileCheckout ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        <span>Check-out {reconcileSelectedIds.size} người lệch & Giải phóng giường</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-bdr bg-side flex flex-wrap items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-mu">
            Thao tác Check-out tự động giải phóng giường về trạng thái Trống và lưu lịch sử biến động &ldquo;Ra&rdquo;.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
            >
              Đóng
            </button>
            {activeTab === 'batch-checkout' && (
              <button
                type="button"
                disabled={finalBatchWorkers.length === 0 || executingCheckout}
                onClick={handleConfirmBatchCheckout}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-dgr hover:opacity-95 text-white text-xs font-bold cursor-pointer disabled:opacity-45"
              >
                {executingCheckout ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                <span>
                  Xác nhận Check-out ({finalBatchWorkers.length} người)
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
