'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { fetchWorkerHierarchy, WorkerHierarchyData } from '@/lib/workerHierarchy';
import {
  CheckCircle2,
  Clock,
  LogOut,
  Building2,
  Search,
  RefreshCw,
  Trash2,
  Eye,
  Loader2,
  X,
  Phone,
  XCircle,
  Inbox,
  AlertCircle,
} from 'lucide-react';

export interface CheckoutRequest {
  id: string;
  ho_va_ten: string;
  ma_nv: string;
  so_cccd: string;
  so_dien_thoai: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  ghi_chu: string;
  created_at: string;
}

const STATUS_CONFIG = {
  pending: {
    label: 'Chờ duyệt dọn ra',
    badgeCls: 'bg-[#fdf1e4] text-[#c9690f] border border-[#c9690f]/30',
    icon: <Clock size={12} />,
  },
  approved: {
    label: 'Đã giải phóng',
    badgeCls: 'bg-[#eaf6ef] text-[#1f7a45] border border-[#1f7a45]/30',
    icon: <CheckCircle2 size={12} />,
  },
  rejected: {
    label: 'Từ chối',
    badgeCls: 'bg-[#fbebe9] text-[#b3362b] border border-[#b3362b]/30',
    icon: <XCircle size={12} />,
  },
};

/** Clean [CHECKOUT] prefix from note */
function parseCheckoutNote(rawNote: string = '') {
  const note = rawNote.replace(/^\[CHECKOUT\]\s*/i, '');
  return note || 'Khai báo dọn ra KTX';
}

/** Detail Modal - Operations console styling */
function CheckoutDetailModal({
  req,
  onClose,
  onApprove,
  onReject,
  processing,
}: {
  req: CheckoutRequest;
  onClose: () => void;
  onApprove: (r: CheckoutRequest) => void;
  onReject: (id: string) => void;
  processing: string | null;
}) {
  const isProcessing = processing === req.id;
  const cfg = STATUS_CONFIG[req.status];
  const cleanNote = parseCheckoutNote(req.ghi_chu);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 bg-[#1b2430] text-white border-b border-[#2a333e]">
          <div>
            <h3 className="font-bold text-sm tracking-wide">CHI TIẾT YÊU CẦU CHECK-OUT</h3>
            <p className="text-xs text-gray-300 mt-0.5 font-normal">
              Mã yêu cầu: <span className="font-mono text-[#f39c55]">{req.id}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-gray-300 hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-[#dde1e6] dark:border-[#2a333e]">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${cfg.badgeCls}`}>
              {cfg.icon} {cfg.label}
            </div>
            <span className="text-xs text-gray-500">
              Gửi lúc: {new Date(req.created_at).toLocaleString('vi-VN')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs bg-[#f3f4f6] dark:bg-[#11151a] p-3.5 rounded border border-[#dde1e6] dark:border-[#2a333e]">
            <div className="col-span-2">
              <span className="text-gray-500 block">Họ và tên công nhân</span>
              <p className="font-bold text-sm text-[#1b2430] dark:text-white mt-0.5">{req.ho_va_ten}</p>
            </div>

            <div>
              <span className="text-gray-500 block">Mã nhân viên</span>
              <p className="font-mono font-semibold mt-0.5">{req.ma_nv || '—'}</p>
            </div>

            <div>
              <span className="text-gray-500 block">Số CCCD</span>
              <p className="font-mono font-semibold mt-0.5">{req.so_cccd || '—'}</p>
            </div>

            <div>
              <span className="text-gray-500 block">Số điện thoại</span>
              <p className="font-semibold mt-0.5">{req.so_dien_thoai || '—'}</p>
            </div>

            <div>
              <span className="text-gray-500 block">Thời gian tiếp nhận</span>
              <p className="font-medium mt-0.5">
                {new Date(req.created_at).toLocaleString('vi-VN')}
              </p>
            </div>

            <div className="col-span-2 pt-2 border-t border-[#dde1e6] dark:border-[#2a333e]">
              <span className="text-xs font-bold text-[#c9690f] block mb-1">
                Vị trí phòng ở cần giải phóng:
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] font-bold">
                  {req.ktx}
                </span>
                <span className="px-2 py-0.5 rounded bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] font-semibold">
                  {req.day}
                </span>
                <span className="px-2 py-0.5 rounded bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] font-bold">
                  Phòng {req.phong_so}
                </span>
                {req.giuong && (
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e]">
                    {req.giuong}
                  </span>
                )}
              </div>
            </div>

            <div className="col-span-2 pt-2 border-t border-[#dde1e6] dark:border-[#2a333e]">
              <span className="text-gray-500 block">Lý do dọn ra & Ghi chú</span>
              <p className="font-medium mt-0.5 whitespace-pre-wrap leading-relaxed">
                {cleanNote}
              </p>
            </div>

            {req.reviewed_at && (
              <div className="col-span-2 pt-2 border-t border-[#dde1e6] dark:border-[#2a333e] text-gray-500">
                Đã xử lý lúc: {new Date(req.reviewed_at).toLocaleString('vi-VN')}
              </div>
            )}
          </div>

          {req.status === 'pending' && (
            <div className="flex gap-2.5 pt-2 border-t border-[#dde1e6] dark:border-[#2a333e]">
              <button
                onClick={() => onReject(req.id)}
                disabled={isProcessing}
                className="flex-1 py-2 px-3 border border-[#b3362b] text-[#b3362b] hover:bg-[#fbebe9] dark:hover:bg-[#3b1814] rounded text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer text-center"
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <XCircle size={13} className="inline mr-1" />}
                Từ chối
              </button>
              <button
                onClick={() => onApprove(req)}
                disabled={isProcessing}
                className="flex-1 py-2 px-3 bg-[#1f7a45] hover:bg-[#186036] text-white rounded text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer text-center"
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <CheckCircle2 size={13} className="inline mr-1" />}
                Duyệt dọn ra & Giải phóng phòng
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CheckoutApprovalPanel({
  onCountChange,
}: {
  onCountChange?: (count: number) => void;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [checkouts, setCheckouts] = useState<CheckoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailReq, setDetailReq] = useState<CheckoutRequest | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CheckoutRequest | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Bộ lọc theo KTX / Dãy / Phòng từ dữ liệu công nhân (Requirement 3)
  const [selectedKtx, setSelectedKtx] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<string>('all');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [hierarchy, setHierarchy] = useState<WorkerHierarchyData>({
    units: [],
    ktxList: [],
    daysByKtx: {},
    roomsByKtxDay: {},
    workers: [],
  });

  const { currentUser, isAdmin, canWriteBlock } = useAuth();
  const supabase = createClient();

  useEffect(() => {
    fetchWorkerHierarchy().then(setHierarchy).catch(err => {
      console.warn('Checkout fetchWorkerHierarchy error:', err);
    });
  }, []);

  const onCountChangeRef = useRef(onCountChange);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const fetchCheckouts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('worker_registrations')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const checkoutRows = (data as CheckoutRequest[]).filter(r =>
          r.ghi_chu?.startsWith('[CHECKOUT]')
        );
        setCheckouts(checkoutRows);
      }
    } catch (e: any) {
      console.error('Fetch checkouts error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchCheckouts();
  }, [fetchCheckouts]);

  // Phân quyền Staff (Requirement 5)
  const scopedCheckouts = useMemo(() => {
    return checkouts.filter(c => isAdmin || canWriteBlock(c.day, c.ktx));
  }, [checkouts, isAdmin, canWriteBlock]);

  const pendingCount = useMemo(
    () => scopedCheckouts.filter(c => c.status === 'pending').length,
    [scopedCheckouts]
  );

  const approvedCount = useMemo(
    () => scopedCheckouts.filter(c => c.status === 'approved').length,
    [scopedCheckouts]
  );

  const rejectedCount = useMemo(
    () => scopedCheckouts.filter(c => c.status === 'rejected').length,
    [scopedCheckouts]
  );

  const availableDays = useMemo(() => {
    if (selectedKtx === 'all') {
      const allDays = new Set<string>();
      Object.values(hierarchy.daysByKtx).forEach(list => list.forEach(d => allDays.add(d)));
      return Array.from(allDays).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    }
    return hierarchy.daysByKtx[selectedKtx] || [];
  }, [hierarchy, selectedKtx]);

  const availableRooms = useMemo(() => {
    if (selectedKtx !== 'all' && selectedDay !== 'all') {
      return hierarchy.roomsByKtxDay[`${selectedKtx}__${selectedDay}`] || [];
    }
    const allRooms = new Set<string>();
    Object.entries(hierarchy.roomsByKtxDay).forEach(([kd, rooms]) => {
      const [k, d] = kd.split('__');
      if (selectedKtx !== 'all' && k !== selectedKtx) return;
      if (selectedDay !== 'all' && d !== selectedDay) return;
      rooms.forEach(r => allRooms.add(r));
    });
    return Array.from(allRooms).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [hierarchy, selectedKtx, selectedDay]);

  useEffect(() => {
    if (!onCountChangeRef.current) return;
    const timer = setTimeout(() => {
      onCountChangeRef.current?.(pendingCount);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingCount]);

  /**
   * Duyệt Check-out:
   * Giữ nguyên 100% logic: Xóa vĩnh viễn khỏi bảng workers để giải phóng phòng/giường trống
   */
  const handleApprove = async (req: CheckoutRequest) => {
    setProcessingId(req.id);
    setActionSuccessMsg(null);
    try {
      const nowStr = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from('worker_registrations')
        .update({
          status: 'approved',
          reviewed_by: currentUser?.id,
          reviewed_at: nowStr,
        })
        .eq('id', req.id);

      if (updateErr) throw new Error(updateErr.message);

      let matchedWorker: any = null;

      if (req.ma_nv && req.ma_nv.trim()) {
        const { data: byCode } = await supabase
          .from('workers')
          .select('*')
          .eq('ma_nv', req.ma_nv.trim())
          .limit(1);
        if (byCode && byCode.length > 0) matchedWorker = byCode[0];
      }

      if (!matchedWorker && req.so_cccd && req.so_cccd.trim()) {
        const { data: byCccd } = await supabase
          .from('workers')
          .select('*')
          .eq('cccd', req.so_cccd.trim())
          .limit(1);
        if (byCccd && byCccd.length > 0) matchedWorker = byCccd[0];
      }

      if (!matchedWorker && req.ho_va_ten && req.phong_so) {
        const { data: byLocation } = await supabase
          .from('workers')
          .select('*')
          .eq('ho_va_ten', req.ho_va_ten.trim())
          .eq('ktx', req.ktx.trim())
          .eq('phong_so', req.phong_so.trim())
          .limit(1);
        if (byLocation && byLocation.length > 0) matchedWorker = byLocation[0];
      }

      if (matchedWorker) {
        try {
          await supabase.from('worker_deletion_log').insert({
            worker_id: matchedWorker.id,
            ho_va_ten: matchedWorker.ho_va_ten || req.ho_va_ten,
            ma_nv: matchedWorker.ma_nv || req.ma_nv,
            ktx: matchedWorker.ktx || req.ktx,
            day: matchedWorker.day || req.day,
            deleted_at: nowStr,
          });
        } catch {
          // ignore log error
        }

        await supabase
          .from('workers')
          .delete()
          .eq('id', matchedWorker.id);
      }

      if (req.ma_nv && req.ma_nv.trim()) {
        await supabase.from('workers').delete().eq('ma_nv', req.ma_nv.trim());
      }
      if (req.so_cccd && req.so_cccd.trim()) {
        await supabase.from('workers').delete().eq('cccd', req.so_cccd.trim());
      }

      setCheckouts(prev =>
        prev.map(c =>
          c.id === req.id ? { ...c, status: 'approved' as const, reviewed_at: nowStr } : c
        )
      );

      if (detailReq?.id === req.id) {
        setDetailReq(prev => (prev ? { ...prev, status: 'approved', reviewed_at: nowStr } : null));
      }

      const roomLiberatedText = `${req.ktx} - ${req.day} - Phòng ${req.phong_so}`;
      setActionSuccessMsg(
        `✓ Đã duyệt check-out cho "${req.ho_va_ten}". Chỗ ở tại ${roomLiberatedText} đã được giải phóng thành công.`
      );
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = setTimeout(() => setActionSuccessMsg(null), 8000);
    } catch (err: any) {
      alert(`Lỗi khi phê duyệt: ${err?.message || 'Không thể cập nhật'}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    try {
      const nowStr = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('worker_registrations')
        .update({
          status: 'rejected',
          reviewed_by: currentUser?.id,
          reviewed_at: nowStr,
        })
        .eq('id', id);

      if (updateErr) throw new Error(updateErr.message);

      setCheckouts(prev =>
        prev.map(c =>
          c.id === id ? { ...c, status: 'rejected' as const, reviewed_at: nowStr } : c
        )
      );

      if (detailReq?.id === id) {
        setDetailReq(prev => (prev ? { ...prev, status: 'rejected', reviewed_at: nowStr } : null));
      }
    } catch (err: any) {
      alert(`Lỗi khi từ chối: ${err?.message || 'Không thể cập nhật'}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from('worker_registrations')
        .delete()
        .eq('id', deleteTarget.id);

      if (error) throw new Error(error.message);

      setCheckouts(prev => prev.filter(c => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      alert(`Lỗi khi xóa: ${err?.message || 'Không thể xóa'}`);
    }
  };

  const filteredCheckouts = useMemo(() => {
    return scopedCheckouts.filter(c => {
      if (filterStatus !== 'all' && c.status !== filterStatus) return false;
      if (selectedKtx !== 'all' && c.ktx !== selectedKtx) return false;
      if (selectedDay !== 'all' && c.day !== selectedDay) return false;
      if (selectedRoom !== 'all' && c.phong_so !== selectedRoom) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          c.ho_va_ten.toLowerCase().includes(q) ||
          (c.ma_nv && c.ma_nv.toLowerCase().includes(q)) ||
          (c.so_cccd && c.so_cccd.toLowerCase().includes(q)) ||
          c.ktx.toLowerCase().includes(q) ||
          c.day.toLowerCase().includes(q) ||
          c.phong_so.toLowerCase().includes(q) ||
          (c.ghi_chu && c.ghi_chu.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [scopedCheckouts, filterStatus, selectedKtx, selectedDay, selectedRoom, searchQuery]);

  if (!isMounted) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto animate-pulse" suppressHydrationWarning>
        <div className="h-20 bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded" />
        <div className="h-12 bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded" />
        <div className="h-64 bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto" suppressHydrationWarning>
      {/* Detail Modal */}
      {detailReq && (
        <CheckoutDetailModal
          req={detailReq}
          onClose={() => setDetailReq(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          processing={processingId}
        />
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-[#fbebe9] text-[#b3362b] flex items-center justify-center shrink-0">
                <Trash2 size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#1b2430] dark:text-white">Xóa yêu cầu Check-out</h3>
                <p className="text-xs text-[#4b5563] dark:text-[#9ca3af]">Thao tác không thể hoàn tác.</p>
              </div>
            </div>
            <p className="text-xs text-[#1b2430] dark:text-gray-300">
              Bạn có chắc muốn xóa bản ghi yêu cầu dọn ra của <strong>{deleteTarget.ho_va_ten}</strong> (Phòng {deleteTarget.phong_so})?
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-1.5 border border-[#dde1e6] dark:border-[#2a333e] rounded text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 py-1.5 bg-[#b3362b] hover:bg-[#8f2b22] text-white rounded text-xs font-bold transition-colors cursor-pointer"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {actionSuccessMsg && (
        <div className="p-3 bg-[#eaf6ef] dark:bg-[#103320] border border-[#1f7a45]/40 rounded-md text-[#1f7a45] dark:text-emerald-300 text-xs font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button
            onClick={() => setActionSuccessMsg(null)}
            className="text-[#1f7a45] hover:opacity-80 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-[#1b2430] dark:text-white uppercase">
            DUYỆT CHECK-OUT & TRẢ PHÒNG KTX
          </h1>
          <p className="text-xs text-[#4b5563] dark:text-[#9ca3af] mt-0.5">
            Xác nhận dọn ra và hoàn trả chỗ ở cho công nhân rời ký túc xá
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchCheckouts(true)}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#dde1e6] dark:border-[#2a333e] bg-white dark:bg-[#181d24] text-[#1b2430] dark:text-gray-300 rounded text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60 cursor-pointer w-fit"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          <span>Làm mới danh sách</span>
        </button>
      </div>

      {/* BANNER THÔNG BÁO GIẢI THÍCH HÀNH VI (Requirement: Nền cam nhạt #fdf1e4, viền cam #c9690f, chữ đen/đậm, KHÔNG dùng icon tam giác to) */}
      <div className="bg-[#fdf1e4] dark:bg-[#281d14] border border-[#c9690f] rounded-md p-3.5 text-xs text-[#1b2430] dark:text-[#f39c55] leading-relaxed">
        <p className="font-bold text-[#c9690f] uppercase tracking-wide mb-0.5">
          Quy trình giải phóng chỗ ở khi duyệt check-out:
        </p>
        <p className="font-medium text-[#2d1b09] dark:text-gray-200">
          Khi bấm <strong>&quot;Duyệt dọn ra&quot;</strong>, hệ thống tự động cập nhật trạng thái đơn thành <strong>Đã duyệt</strong>, đồng thời <strong>xóa hẳn công nhân khỏi danh sách lưu trú</strong> trên Supabase để giải phóng giường và phòng trống ngay lập tức trên Bảng điều khiển và Sơ đồ phòng.
        </p>
      </div>

      {/* Staff Permission Badge */}
      {!isAdmin && (
        <div className="p-2.5 bg-[#fdf1e4] dark:bg-[#281d14] border border-[#c9690f]/30 rounded text-xs text-[#853d07] dark:text-[#f39c55] flex items-center gap-2">
          <Building2 size={14} className="shrink-0 text-[#c9690f]" />
          <span>
            {currentUser?.assignedBlocks && currentUser.assignedBlocks.length > 0 ? (
              <>
                <strong>Phân quyền phụ trách:</strong> Chỉ hiển thị các yêu cầu check-out thuộc dãy:{' '}
                <span className="font-bold underline">{currentUser.assignedBlocks.join(', ')}</span>
              </>
            ) : (
              <span>Tài khoản Staff chưa được phân quyền phụ trách dãy nào. Vui lòng liên hệ Quản trị viên (Admin).</span>
            )}
          </span>
        </div>
      )}

      {/* DẢI SỐ LIỆU TỔNG QUAN LIỀN KHỐI (Requirement: Segmented stats strip, NO separate floating cards) */}
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md grid grid-cols-3 divide-x divide-[#dde1e6] dark:divide-[#2a333e] overflow-hidden">
        {[
          {
            key: 'pending',
            label: 'Chờ duyệt dọn ra',
            count: pendingCount,
            activeColor: 'bg-[#fdf1e4] dark:bg-[#281d14] text-[#c9690f]',
            numColor: 'text-[#c9690f]',
          },
          {
            key: 'approved',
            label: 'Đã duyệt giải phóng',
            count: approvedCount,
            activeColor: 'bg-[#eaf6ef] dark:bg-[#103320] text-[#1f7a45]',
            numColor: 'text-[#1f7a45]',
          },
          {
            key: 'rejected',
            label: 'Từ chối',
            count: rejectedCount,
            activeColor: 'bg-[#fbebe9] dark:bg-[#3b1814] text-[#b3362b]',
            numColor: 'text-[#b3362b]',
          },
        ].map(s => {
          const isSelected = filterStatus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setFilterStatus(s.key as any)}
              className={`p-3 text-center transition-colors cursor-pointer ${
                isSelected ? s.activeColor : 'hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              <div className={`text-2xl font-bold font-mono ${s.numColor}`}>
                {s.count}
              </div>
              <div className="text-xs font-semibold mt-0.5 uppercase tracking-wider text-[#4b5563] dark:text-[#9ca3af]">
                {s.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* THANH BỘ LỌC LIỀN KHỐI (Requirement: Segmented filter button group + console filters) */}
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Nhóm nút lọc trạng thái liền khối (Navy #1b2430 khi active) */}
          <div className="inline-flex border border-[#dde1e6] dark:border-[#2a333e] rounded overflow-hidden divide-x divide-[#dde1e6] dark:divide-[#2a333e]">
            {[
              { key: 'pending', label: `Chờ duyệt (${pendingCount})` },
              { key: 'approved', label: `Đã duyệt (${approvedCount})` },
              { key: 'rejected', label: `Từ chối (${rejectedCount})` },
              { key: 'all', label: `Tất cả (${scopedCheckouts.length})` },
            ].map(tab => {
              const isActive = filterStatus === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterStatus(tab.key as any)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#1b2430] text-white'
                      : 'bg-white dark:bg-[#181d24] text-[#4b5563] dark:text-[#9ca3af] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Ô tìm kiếm console */}
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm theo tên, mã NV, phòng, KTX..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Dropdown Filters KTX / Dãy / Phòng (Requirement 3) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2.5 border-t border-[#dde1e6] dark:border-[#2a333e]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap min-w-[50px]">Khu KTX:</span>
            <select
              value={selectedKtx}
              onChange={e => {
                setSelectedKtx(e.target.value);
                setSelectedDay('all');
                setSelectedRoom('all');
              }}
              className="flex-1 py-1 px-2 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            >
              <option value="all">Tất cả KTX</option>
              {hierarchy.ktxList.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap min-w-[50px]">Dãy nhà:</span>
            <select
              value={selectedDay}
              onChange={e => {
                setSelectedDay(e.target.value);
                setSelectedRoom('all');
              }}
              className="flex-1 py-1 px-2 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            >
              <option value="all">Tất cả Dãy</option>
              {availableDays.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 whitespace-nowrap min-w-[50px]">Phòng số:</span>
            <select
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              className="flex-1 py-1 px-2 text-xs bg-[#f3f4f6] dark:bg-[#11151a] border border-[#dde1e6] dark:border-[#2a333e] rounded text-[#1b2430] dark:text-[#dde1e6] focus:outline-none focus:border-[#c9690f]"
            >
              <option value="all">Tất cả Phòng</option>
              {availableRooms.map(r => (
                <option key={r} value={r}>Phòng {r}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* BẢNG DANH SÁCH (TABLE) (Requirement: Operations Table View) */}
      <div className="bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded-md overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-500 flex items-center justify-center gap-2 text-xs">
            <RefreshCw size={16} className="animate-spin text-[#c9690f]" />
            <span>Đang tải danh sách chờ check-out...</span>
          </div>
        ) : filteredCheckouts.length === 0 ? (
          /* TRẠNG THÁI RỖNG (Requirement: Khung viền đứt nét, icon đơn giản, tiêu đề in đậm) */
          <div className="p-10 border border-dashed border-[#dde1e6] dark:border-[#2a333e] m-4 rounded text-center space-y-1.5">
            <Inbox size={32} className="mx-auto text-gray-400 stroke-1" />
            <h4 className="font-bold text-sm text-[#1b2430] dark:text-white">Không có yêu cầu check-out nào</h4>
            <p className="text-xs text-[#4b5563] dark:text-[#9ca3af] max-w-sm mx-auto">
              {filterStatus === 'pending'
                ? 'Hiện không có công nhân nào đang chờ duyệt dọn ra. Khi công nhân quét mã khai báo, danh sách sẽ hiển thị ngay tại đây.'
                : 'Không tìm thấy yêu cầu nào theo bộ lọc hoặc từ khóa hiện tại.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#f3f4f6] dark:bg-[#11151a] border-b border-[#dde1e6] dark:border-[#2a333e] text-[11px] font-bold text-[#4b5563] dark:text-[#9ca3af] uppercase tracking-wider">
                  <th className="py-2.5 px-3">CÔNG NHÂN</th>
                  <th className="py-2.5 px-3">MÃ NV / CCCD</th>
                  <th className="py-2.5 px-3">VỊ TRÍ TRẢ PHÒNG</th>
                  <th className="py-2.5 px-3">LÝ DO & GHI CHÚ</th>
                  <th className="py-2.5 px-3">NGÀY GỬI</th>
                  <th className="py-2.5 px-3">TRẠNG THÁI</th>
                  <th className="py-2.5 px-3 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dde1e6] dark:divide-[#2a333e]">
                {filteredCheckouts.map(req => {
                  const cfg = STATUS_CONFIG[req.status];
                  const cleanNote = parseCheckoutNote(req.ghi_chu);
                  const isProcessing = processingId === req.id;

                  return (
                    <tr
                      key={req.id}
                      className="hover:bg-[#f9fafb] dark:hover:bg-[#1e242d] transition-colors"
                    >
                      {/* Cột 1: Họ tên & SĐT */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-[#1b2430] dark:text-white text-xs sm:text-sm">
                          {req.ho_va_ten}
                        </div>
                        {req.so_dien_thoai && (
                          <div className="text-[11px] text-[#4b5563] dark:text-gray-400 mt-0.5 flex items-center gap-1">
                            <Phone size={10} />
                            <span>{req.so_dien_thoai}</span>
                          </div>
                        )}
                      </td>

                      {/* Cột 2: Mã công nhân / CCCD */}
                      <td className="py-2.5 px-3 align-top font-mono text-xs whitespace-nowrap">
                        <div className="font-semibold text-[#1b2430] dark:text-gray-200">
                          {req.ma_nv || '—'}
                        </div>
                        {req.so_cccd && (
                          <div className="text-[11px] text-[#4b5563] dark:text-gray-400">
                            CCCD: {req.so_cccd}
                          </div>
                        )}
                      </td>

                      {/* Cột 3: Vị trí phòng ở cần giải phóng */}
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-xs text-[#1b2430] dark:text-white">
                          {req.ktx} — {req.day}
                        </div>
                        <div className="text-[11px] text-[#4b5563] dark:text-gray-400 mt-0.5">
                          Phòng {req.phong_so} {req.giuong ? `(G.${req.giuong})` : ''}
                        </div>
                      </td>

                      {/* Cột 4: Lý do dọn ra */}
                      <td className="py-2.5 px-3 align-top max-w-xs">
                        <p className="text-xs text-[#1b2430] dark:text-gray-300 truncate font-medium" title={cleanNote}>
                          {cleanNote}
                        </p>
                      </td>

                      {/* Cột 5: Thời gian gửi */}
                      <td className="py-2.5 px-3 align-top text-[11px] text-[#4b5563] dark:text-gray-400 whitespace-nowrap">
                        {new Date(req.created_at).toLocaleDateString('vi-VN')}
                        <div className="text-[10px] text-gray-400">
                          {new Date(req.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Cột 6: Trạng thái */}
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${cfg.badgeCls}`}>
                          {cfg.icon}
                          <span>{cfg.label}</span>
                        </span>
                      </td>

                      {/* Cột 7: Thao tác căn phải (Requirement: Duyệt xanh lá đặc, Từ chối viền đỏ, Xem trung tính) */}
                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setDetailReq(req)}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-[#dde1e6] dark:border-[#2a333e] bg-white dark:bg-[#181d24] text-[#374151] dark:text-[#d1d5db] hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-xs font-medium cursor-pointer"
                            title="Xem chi tiết"
                          >
                            <Eye size={12} />
                            <span>Xem</span>
                          </button>

                          {req.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleReject(req.id)}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-[#b3362b] text-[#b3362b] hover:bg-[#fbebe9] dark:hover:bg-[#3b1814] rounded text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                                title="Từ chối yêu cầu dọn ra"
                              >
                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                <span>Từ chối</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApprove(req)}
                                disabled={isProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1f7a45] hover:bg-[#186036] text-white rounded text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                                title="Phê duyệt dọn ra & Giải phóng phòng"
                              >
                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                <span>Duyệt dọn ra</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setDeleteTarget(req)}
                            className="p-1 border border-[#dde1e6] dark:border-[#2a333e] text-gray-400 hover:text-[#b3362b] hover:border-[#b3362b] rounded cursor-pointer transition-colors"
                            title="Xóa bản ghi"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
