'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Calendar,
  Flag,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Copy,
  Check,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import {
  FluctuationBaselineConfig,
  countFluctuationLogsBeforeDate,
  getVNDateString,
  isValidIsoDate,
  purgeFluctuationLogsBeforeDate,
  saveFluctuationBaselineConfig,
} from '@/lib/workerFluctuation';

interface Props {
  currentConfig: FluctuationBaselineConfig;
  onClose: () => void;
  onSaved: (cfg: FluctuationBaselineConfig) => void;
  onPurged: () => void;
}

const DEFAULT_GOLIVE_DATE = '2026-11-26';

function formatVN(iso: string): string {
  if (!isValidIsoDate(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const PURGE_RPC_SQL = `CREATE OR REPLACE FUNCTION public.purge_fluctuation_logs_before_date(p_before_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_role text;
  cutoff_ts timestamptz;
  deleted_exits integer := 0;
  deleted_entries integer := 0;
BEGIN
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Chỉ Quản trị tối cao mới có quyền xóa lịch sử biến động thử nghiệm.';
  END IF;
  cutoff_ts := (p_before_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  IF to_regclass('public.worker_deletion_log') IS NOT NULL THEN
    DELETE FROM public.worker_deletion_log WHERE deleted_at < cutoff_ts;
    GET DIAGNOSTICS deleted_exits = ROW_COUNT;
  END IF;
  IF to_regclass('public.worker_entry_log') IS NOT NULL THEN
    DELETE FROM public.worker_entry_log WHERE entered_at < cutoff_ts;
    GET DIAGNOSTICS deleted_entries = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('deleted_exits', deleted_exits, 'deleted_entries', deleted_entries);
END;
$$;
GRANT EXECUTE ON FUNCTION public.purge_fluctuation_logs_before_date(date) TO authenticated;`;

export default function FluctuationBaselineModal({
  currentConfig,
  onClose,
  onSaved,
  onPurged,
}: Props) {
  const { currentUser, isAdmin, isSuperAdmin } = useAuth();
  const { addLog } = useAudit();

  const [selectedDate, setSelectedDate] = useState<string>(
    currentConfig.baselineDate || DEFAULT_GOLIVE_DATE
  );
  const [saving, setSaving] = useState(false);

  const [countsLoading, setCountsLoading] = useState(false);
  const [counts, setCounts] = useState({ exitsCount: 0, entriesCount: 0, localCacheCount: 0 });
  const [confirmPurgeStep, setConfirmPurgeStep] = useState(false);
  const [purging, setPurging] = useState(false);
  const [showRpcSqlHint, setShowRpcSqlHint] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (!isValidIsoDate(selectedDate)) return;
    let active = true;
    setCountsLoading(true);
    setConfirmPurgeStep(false);
    countFluctuationLogsBeforeDate(selectedDate)
      .then(res => {
        if (active) setCounts(res);
      })
      .finally(() => {
        if (active) setCountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDate]);

  const handleSaveBaseline = async (targetDate: string | null) => {
    if (!isAdmin) {
      toast.error('Chỉ Quản trị viên mới có quyền thiết lập cột mốc vận hành.');
      return;
    }
    if (targetDate && !isValidIsoDate(targetDate)) {
      toast.error('Vui lòng chọn ngày cột mốc hợp lệ.');
      return;
    }

    setSaving(true);
    try {
      const actor = currentUser?.name || currentUser?.email || 'Quản trị viên';
      const { savedRemote, config } = await saveFluctuationBaselineConfig(targetDate, actor);
      addLog(
        actor,
        'UPDATE',
        targetDate
          ? `Thiết lập cột mốc bắt đầu vận hành Biến động vào/ra từ ngày ${formatVN(targetDate)} (loại bỏ dữ liệu thử nghiệm trước mốc).`
          : 'Gỡ bỏ cột mốc vận hành Biến động vào/ra (hiển thị lại toàn bộ lịch sử).'
      );
      if (targetDate) {
        toast.success(
          savedRemote
            ? `Đã chốt cột mốc vận hành từ ${formatVN(targetDate)} và đồng bộ toàn hệ thống.`
            : `Đã chốt cột mốc vận hành từ ${formatVN(targetDate)} trên thiết bị này.`
        );
      } else {
        toast.success('Đã gỡ bỏ cột mốc vận hành.');
      }
      onSaved(config);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu cột mốc vận hành.');
    } finally {
      setSaving(false);
    }
  };

  const handlePurgeTestLogs = async () => {
    if (!isSuperAdmin) {
      toast.error('Chỉ Quản trị tối cao mới có quyền xóa triệt để bản ghi lịch sử trên CSDL.');
      return;
    }
    if (!isValidIsoDate(selectedDate)) {
      toast.error('Ngày cột mốc không hợp lệ.');
      return;
    }

    setPurging(true);
    try {
      const res = await purgeFluctuationLogsBeforeDate(selectedDate);
      if (res.ok) {
        toast.success(
          `Đã dọn sạch ${res.deletedExits.toLocaleString('vi-VN')} lượt rời khỏi, ${res.deletedEntries.toLocaleString('vi-VN')} lượt vào ở và ${res.clearedLocal.toLocaleString('vi-VN')} bản ghi đệm trước ${formatVN(selectedDate)}.`
        );
        setCounts({ exitsCount: 0, entriesCount: 0, localCacheCount: 0 });
        setConfirmPurgeStep(false);
        setShowRpcSqlHint(false);
        onPurged();
      } else if (res.rpcMissing) {
        setShowRpcSqlHint(true);
        setConfirmPurgeStep(false);
        toast.info(
          res.clearedLocal > 0
            ? `Đã dọn ${res.clearedLocal} bản ghi đệm trình duyệt. Cột mốc ${formatVN(selectedDate)} đã tự động lọc sạch toàn bộ dữ liệu cũ; nếu cần xóa vật lý trên CSDL, vui lòng chạy đoạn SQL bên dưới.`
            : `Cột mốc ${formatVN(selectedDate)} đã tự động lọc sạch toàn bộ dữ liệu cũ trên mọi máy. Chạy đoạn SQL hỗ trợ bên dưới nếu muốn xóa vật lý bảng log.`
        );
        onPurged();
      } else {
        toast.error(res.errorMessage || 'Không thể dọn dữ liệu biến động.');
      }
    } finally {
      setPurging(false);
    }
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(PURGE_RPC_SQL);
      setCopiedSql(true);
      toast.success('Đã sao chép đoạn SQL cài đặt lệnh dọn dữ liệu.');
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      toast.error('Không thể tự động sao chép.');
    }
  };

  const totalOldLogs = counts.exitsCount + counts.entriesCount + counts.localCacheCount;
  const todayVN = getVNDateString();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-side">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-bdg text-lnk border border-pri2/25 flex items-center justify-center shrink-0">
              <Flag size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                Cột mốc Vận hành & Dọn dữ liệu thử nghiệm
              </h3>
              <p className="text-xs text-mu mt-0.5">
                Tách riêng dữ liệu test cũ để Biến động vào/ra bắt đầu chính xác từ ngày vận hành
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Safety Guarantee */}
          <div className="p-3.5 rounded-xl bg-okbg border border-ok2/30 text-xs text-tx flex items-start gap-2.5">
            <ShieldCheck size={16} className="text-ok shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-ok">An toàn tuyệt đối dữ liệu hiện hữu:</strong> Thiết lập cột mốc hoặc dọn lịch sử biến động <strong>chỉ tác động lên sổ ghi nhận vào/ra thử nghiệm trước ngày mốc</strong> — hoàn toàn không xóa danh sách công nhân hiện tại, sơ đồ phòng ở, giường hay cơ sở vật chất.
            </div>
          </div>

          {/* Section 1: Go-Live Baseline Date */}
          <div className="rounded-xl border border-bdr bg-page p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h4 className="text-sm font-bold text-tx flex items-center gap-1.5">
                  <Calendar size={15} className="text-lnk" />
                  <span>1. Chốt ngày cột mốc bắt đầu vận hành</span>
                </h4>
                <p className="text-xs text-mu mt-0.5">
                  Mọi biến động trước 00:00 ngày mốc sẽ tự động loại khỏi Báo cáo, Biểu đồ, Tổng Quan và Bản tin Giao ban trên tất cả thiết bị.
                </p>
              </div>
              {currentConfig.baselineDate && (
                <span className="px-2.5 py-1 rounded-lg bg-okbg text-ok border border-ok2/30 text-xs font-bold tabular-nums">
                  Đang áp dụng: {formatVN(currentConfig.baselineDate)}
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
              <div className="flex-1">
                <label className="text-[11px] font-bold text-mu uppercase tracking-wider block mb-1">
                  Ngày bắt đầu tính biến động chính thức
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surf border border-bdr2 text-sm font-bold text-tx tabular-nums focus:outline-none focus:ring-2 focus:ring-pri2/50"
                />
              </div>

              <button
                type="button"
                disabled={saving || !isAdmin || !isValidIsoDate(selectedDate)}
                onClick={() => handleSaveBaseline(selectedDate)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold transition-opacity cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>Chốt mốc {isValidIsoDate(selectedDate) ? formatVN(selectedDate) : ''}</span>
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <span className="text-[11px] text-mu font-semibold">Chọn nhanh:</span>
              <button
                type="button"
                onClick={() => setSelectedDate(DEFAULT_GOLIVE_DATE)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  selectedDate === DEFAULT_GOLIVE_DATE
                    ? 'bg-bdg text-lnk border-pri2'
                    : 'bg-surf text-tx border-bdr hover:bg-act'
                }`}
              >
                26/11/2026 (Bắt đầu vận hành)
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(todayVN)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  selectedDate === todayVN
                    ? 'bg-bdg text-lnk border-pri2'
                    : 'bg-surf text-tx border-bdr hover:bg-act'
                }`}
              >
                Hôm nay ({formatVN(todayVN)})
              </button>
              {currentConfig.baselineDate && isAdmin && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSaveBaseline(null)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-bdr bg-surf text-mu hover:text-dgr hover:border-dgr/40 transition-colors cursor-pointer ml-auto"
                >
                  <RotateCcw size={12} />
                  <span>Gỡ cột mốc</span>
                </button>
              )}
            </div>
          </div>

          {/* Section 2: Optional Physical Purge of Pre-Baseline Test Logs */}
          <div className="rounded-xl border border-bdr bg-page p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-tx flex items-center gap-1.5">
                  <Trash2 size={15} className="text-dgr" />
                  <span>2. Dọn sạch bản ghi thử nghiệm trước {isValidIsoDate(selectedDate) ? formatVN(selectedDate) : 'mốc'}</span>
                </h4>
                <p className="text-xs text-mu mt-0.5">
                  Tùy chọn cho Quản trị tối cao: xóa vật lý các dòng nhật ký vào/ra thử nghiệm cũ để CSDL gọn sạch 100%.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-lg bg-surf border border-bdr">
                <div className="text-[11px] text-mu font-semibold">Lượt rời khỏi cũ</div>
                <div className="text-lg font-extrabold text-wn tabular-nums mt-0.5">
                  {countsLoading ? '…' : counts.exitsCount.toLocaleString('vi-VN')}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-surf border border-bdr">
                <div className="text-[11px] text-mu font-semibold">Lượt vào ở cũ</div>
                <div className="text-lg font-extrabold text-lnk tabular-nums mt-0.5">
                  {countsLoading ? '…' : counts.entriesCount.toLocaleString('vi-VN')}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-surf border border-bdr">
                <div className="text-[11px] text-mu font-semibold">Đệm trình duyệt</div>
                <div className="text-lg font-extrabold text-tx tabular-nums mt-0.5">
                  {countsLoading ? '…' : counts.localCacheCount.toLocaleString('vi-VN')}
                </div>
              </div>
            </div>

            {isSuperAdmin ? (
              !confirmPurgeStep ? (
                <button
                  type="button"
                  disabled={purging || countsLoading || totalOldLogs === 0}
                  onClick={() => setConfirmPurgeStep(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-dgr/50 text-dgr hover:bg-dgrbg text-xs font-bold transition-colors cursor-pointer disabled:opacity-45"
                >
                  <Trash2 size={14} />
                  <span>
                    {totalOldLogs === 0
                      ? `Không còn dữ liệu thử nghiệm nào trước ${formatVN(selectedDate)}`
                      : `Xóa sạch ${totalOldLogs.toLocaleString('vi-VN')} bản ghi biến động trước ${formatVN(selectedDate)}`}
                  </span>
                </button>
              ) : (
                <div className="p-3 rounded-xl bg-dgrbg border border-dgr/40 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs text-dgr font-semibold">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <span>
                      Xác nhận xóa vĩnh viễn toàn bộ {totalOldLogs.toLocaleString('vi-VN')} bản ghi lịch sử vào/ra trước ngày {formatVN(selectedDate)}? (Danh sách công nhân hiện tại được giữ nguyên).
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={purging}
                      onClick={() => setConfirmPurgeStep(false)}
                      className="px-3 py-1.5 rounded-lg bg-surf border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      disabled={purging}
                      onClick={handlePurgeTestLogs}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-dgr hover:opacity-90 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {purging ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      <span>{purging ? 'Đang dọn...' : 'Xác nhận dọn sạch'}</span>
                    </button>
                  </div>
                </div>
              )
            ) : (
              <p className="text-[11px] text-mu italic">
                Chỉ tài khoản Quản trị tối cao mới có quyền xóa vật lý bản ghi lịch sử trên CSDL.
              </p>
            )}

            {showRpcSqlHint && (
              <div className="p-3 rounded-xl bg-surf border border-wn/40 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-wn">
                    Cần kích hoạt hàm dọn log 1 lần trên Supabase SQL Editor
                  </span>
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-act border border-bdr text-tx font-semibold hover:bg-bdg cursor-pointer"
                  >
                    {copiedSql ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                    <span>{copiedSql ? 'Đã copy SQL' : 'Copy SQL'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-mu">
                  Lưu ý: Việc chốt cột mốc ở Mục 1 đã ẩn 100% dữ liệu test cũ trên mọi máy. Chỉ cần chạy đoạn SQL trên nếu bạn muốn xóa vật lý các dòng log cũ khỏi CSDL.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bdr bg-side flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-tx hover:bg-bdg transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
