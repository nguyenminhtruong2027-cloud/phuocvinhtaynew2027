'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  Ban,
  Ghost,
  Plus,
  Search,
  RefreshCw,
  Download,
  CheckCircle2,
  Trash2,
  X,
  AlertTriangle,
  Undo2,
  ExternalLink,
  Copy,
  Check,
  FileWarning,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { Worker } from '@/data/workers';
import { exportToExcel } from '@/lib/exportExcel';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { getVNDateString } from '@/lib/vnDate';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { StatusTag } from '@/components/ui/StatusTag';
import {
  BlacklistRecord,
  createDisciplineRecord,
  deleteDisciplineRecord,
  detectGhostWorkers,
  DISCIPLINE_CATEGORY_META,
  DISCIPLINE_SEVERITY_META,
  DisciplineCategory,
  DisciplineRecord,
  DisciplineSeverity,
  fetchBlacklist,
  fetchDisciplines,
  GhostWorkerCandidate,
  isBlacklistRecordEffective,
  addToBlacklist,
  revokeBlacklistRecord,
  updateDisciplineStatus,
} from '@/lib/disciplineService';

type SecurityTab = 'disciplines' | 'blacklist' | 'ghost';

const MIGRATION_PATH = 'supabase/migrations/20261130000000_discipline_and_blacklist.sql';

export default function SecurityDisciplineClient() {
  const { currentUser, isAdmin, isTechnician } = useAuth();
  const { addLog } = useAudit();
  const { workers } = useWorkers();

  const [activeTab, setActiveTab] = useState<SecurityTab>('disciplines');
  const [disciplines, setDisciplines] = useState<DisciplineRecord[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | DisciplineSeverity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [blacklistView, setBlacklistView] = useState<'active' | 'all'>('active');

  // Ghost worker detector state
  const [ghostThreshold, setGhostThreshold] = useState<number>(2);
  const [ghostLoading, setGhostLoading] = useState(false);
  const [ghostLoaded, setGhostLoaded] = useState(false);
  const [ghostCandidates, setGhostCandidates] = useState<GhostWorkerCandidate[]>([]);
  const [ghostMeta, setGhostMeta] = useState<{ sessionsAnalyzed: number; latestSessionDate: string | null }>({
    sessionsAnalyzed: 0,
    latestSessionDate: null,
  });

  // Modals
  const [showDisciplineModal, setShowDisciplineModal] = useState(false);
  const [showBlacklistModal, setShowBlacklistModal] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<BlacklistRecord | null>(null);
  const [revokeNote, setRevokeNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Discipline form state
  const [workerPickerQuery, setWorkerPickerQuery] = useState('');
  const [discForm, setDiscForm] = useState({
    worker_id: '',
    ho_va_ten: '',
    ma_nv: '',
    cccd: '',
    so_dien_thoai: '',
    don_vi: '',
    ktx: '',
    day: '',
    phong_so: '',
    category: 'alcohol' as DisciplineCategory,
    severity: 'warning' as DisciplineSeverity,
    title: '',
    description: '',
    action_taken: '',
    incident_date: getVNDateString(),
    alsoBlacklist: false,
    blacklistSeverity: 'permanent' as 'permanent' | 'temporary',
    banned_until: '',
  });

  // Blacklist form state
  const [blForm, setBlForm] = useState({
    ho_va_ten: '',
    cccd: '',
    ma_nv: '',
    don_vi: '',
    reason: '',
    severity: 'permanent' as 'permanent' | 'temporary',
    banned_until: '',
  });

  const activeWorkers = useMemo(
    () =>
      workers.filter(
        w =>
          !w.ngayRaKTX &&
          !w.ghiChu?.includes('[Đã Check-out') &&
          !w.ghiChu?.includes('[CHECKOUT]')
      ),
    [workers]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [discRes, blRes] = await Promise.all([fetchDisciplines(), fetchBlacklist()]);
      setDisciplines(discRes.data);
      setBlacklist(blRes.data);
      setTableMissing(discRes.tableMissing || blRes.tableMissing);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runGhostScan = useCallback(
    async (threshold = ghostThreshold) => {
      setGhostLoading(true);
      try {
        const res = await detectGhostWorkers(activeWorkers, threshold);
        setGhostCandidates(res.candidates);
        setGhostMeta({
          sessionsAnalyzed: res.sessionsAnalyzed,
          latestSessionDate: res.latestSessionDate,
        });
        setGhostLoaded(true);
        if (res.error) {
          toast.error(`Lỗi quét điểm danh: ${res.error}`);
        }
      } finally {
        setGhostLoading(false);
      }
    },
    [activeWorkers, ghostThreshold]
  );

  useEffect(() => {
    if (activeTab === 'ghost' && !ghostLoaded && !ghostLoading) {
      void runGhostScan(ghostThreshold);
    }
  }, [activeTab, ghostLoaded, ghostLoading, ghostThreshold, runGhostScan]);

  const workerPickerMatches = useMemo(() => {
    const q = workerPickerQuery.trim().toLowerCase();
    if (!q) return [];
    return activeWorkers
      .filter(
        w =>
          w.hoVaTen.toLowerCase().includes(q) ||
          (w.maNV || '').toLowerCase().includes(q) ||
          (w.cccd || '').includes(q) ||
          (w.phongSo || '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [workerPickerQuery, activeWorkers]);

  const pickWorkerForDiscipline = (w: Worker) => {
    setDiscForm(prev => ({
      ...prev,
      worker_id: w.id,
      ho_va_ten: w.hoVaTen,
      ma_nv: w.maNV || '',
      cccd: w.cccd || '',
      so_dien_thoai: w.soDienThoai || '',
      don_vi: w.donVi || '',
      ktx: w.ktx || '',
      day: w.day || '',
      phong_so: w.phongSo || '',
    }));
    setWorkerPickerQuery('');
  };

  const activeBlacklistList = useMemo(
    () => blacklist.filter(isBlacklistRecordEffective),
    [blacklist]
  );

  // KPI metrics
  const kpis = useMemo(() => {
    const openCount = disciplines.filter(d => d.status === 'open').length;
    const expulsionCount = disciplines.filter(d => d.severity === 'expulsion').length;
    const contractorCounts = new Map<string, number>();
    disciplines.forEach(d => {
      const u = (d.don_vi || '').trim();
      if (!u) return;
      contractorCounts.set(u, (contractorCounts.get(u) || 0) + 1);
    });
    let topContractor = 'Chưa có';
    let topCount = 0;
    contractorCounts.forEach((c, name) => {
      if (c > topCount) {
        topCount = c;
        topContractor = name;
      }
    });
    return {
      totalDisciplines: disciplines.length,
      openCount,
      expulsionCount,
      activeBlacklist: activeBlacklistList.length,
      topContractor,
      topCount,
    };
  }, [disciplines, activeBlacklistList]);

  const filteredDisciplines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return disciplines.filter(d => {
      if (severityFilter !== 'all' && d.severity !== severityFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        d.ho_va_ten.toLowerCase().includes(q) ||
        d.cccd.toLowerCase().includes(q) ||
        d.ma_nv.toLowerCase().includes(q) ||
        d.don_vi.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q)
      );
    });
  }, [disciplines, severityFilter, statusFilter, searchQuery]);

  const filteredBlacklist = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return blacklist.filter(b => {
      if (blacklistView === 'active' && !isBlacklistRecordEffective(b)) return false;
      if (!q) return true;
      return (
        b.ho_va_ten.toLowerCase().includes(q) ||
        b.cccd.toLowerCase().includes(q) ||
        b.ma_nv.toLowerCase().includes(q) ||
        b.don_vi.toLowerCase().includes(q) ||
        b.reason.toLowerCase().includes(q)
      );
    });
  }, [blacklist, blacklistView, searchQuery]);

  const handleSaveDiscipline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discForm.ho_va_ten.trim() || !discForm.title.trim()) {
      toast.error('Vui lòng nhập Họ tên công nhân và Tóm tắt vụ việc.');
      return;
    }
    if (discForm.alsoBlacklist && !discForm.cccd.trim()) {
      toast.error('Cần có số CCCD để đưa công nhân vào Danh sách Đen.');
      return;
    }

    setSubmitting(true);
    try {
      const actorName = currentUser?.name || currentUser?.email || 'Ban Quản Lý';
      const actorEmail = currentUser?.email || '';
      const res = await createDisciplineRecord({
        worker_id: discForm.worker_id || null,
        ho_va_ten: discForm.ho_va_ten,
        ma_nv: discForm.ma_nv,
        cccd: discForm.cccd,
        so_dien_thoai: discForm.so_dien_thoai,
        don_vi: discForm.don_vi,
        ktx: discForm.ktx,
        day: discForm.day,
        phong_so: discForm.phong_so,
        category: discForm.category,
        severity: discForm.severity,
        title: discForm.title,
        description: discForm.description,
        action_taken: discForm.action_taken,
        incident_date: discForm.incident_date,
        recorded_by: actorName,
        recorded_by_email: actorEmail,
      });

      if (!res.record) {
        toast.error(res.error || 'Không thể lưu biên bản vi phạm.');
        return;
      }

      setDisciplines(prev => [res.record!, ...prev]);
      addLog(
        actorEmail || actorName,
        'DISCIPLINE_CREATE',
        `Lập hồ sơ vi phạm (${DISCIPLINE_SEVERITY_META[discForm.severity].label}): ${discForm.ho_va_ten} — ${discForm.title}`
      );

      if (discForm.alsoBlacklist) {
        const blRes = await addToBlacklist({
          cccd: discForm.cccd,
          ma_nv: discForm.ma_nv,
          ho_va_ten: discForm.ho_va_ten,
          don_vi: discForm.don_vi,
          reason: `${DISCIPLINE_CATEGORY_META[discForm.category].shortLabel}: ${discForm.title}`,
          severity: discForm.blacklistSeverity,
          banned_until: discForm.blacklistSeverity === 'temporary' ? discForm.banned_until : null,
          banned_by: actorName,
          banned_by_email: actorEmail,
        });
        if (blRes.record) {
          setBlacklist(prev => [blRes.record!, ...prev]);
          addLog(
            actorEmail || actorName,
            'BLACKLIST_ADD',
            `Đưa vào Danh sách Đen: ${discForm.ho_va_ten} (CCCD: ${discForm.cccd}) — ${discForm.title}`
          );
        }
      }

      toast.success(
        discForm.alsoBlacklist
          ? 'Đã lưu biên bản vi phạm và kích hoạt chốt chặn Danh sách Đen.'
          : 'Đã ghi nhận biên bản vi phạm nội quy.'
      );
      setShowDisciplineModal(false);
      setDiscForm({
        worker_id: '',
        ho_va_ten: '',
        ma_nv: '',
        cccd: '',
        so_dien_thoai: '',
        don_vi: '',
        ktx: '',
        day: '',
        phong_so: '',
        category: 'alcohol',
        severity: 'warning',
        title: '',
        description: '',
        action_taken: '',
        incident_date: getVNDateString(),
        alsoBlacklist: false,
        blacklistSeverity: 'permanent',
        banned_until: '',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blForm.ho_va_ten.trim() || !blForm.cccd.trim() || !blForm.reason.trim()) {
      toast.error('Vui lòng nhập đầy đủ Họ tên, Số CCCD và Lý do cấm tái nhập.');
      return;
    }
    setSubmitting(true);
    try {
      const actorName = currentUser?.name || currentUser?.email || 'Ban Quản Lý';
      const actorEmail = currentUser?.email || '';
      const res = await addToBlacklist({
        ho_va_ten: blForm.ho_va_ten,
        cccd: blForm.cccd,
        ma_nv: blForm.ma_nv,
        don_vi: blForm.don_vi,
        reason: blForm.reason,
        severity: blForm.severity,
        banned_until: blForm.severity === 'temporary' ? blForm.banned_until : null,
        banned_by: actorName,
        banned_by_email: actorEmail,
      });
      if (!res.record) {
        toast.error(res.error || 'Không thể thêm vào Danh sách Đen.');
        return;
      }
      setBlacklist(prev => [res.record!, ...prev]);
      addLog(
        actorEmail || actorName,
        'BLACKLIST_ADD',
        `Thêm Danh sách Đen: ${blForm.ho_va_ten} (CCCD: ${blForm.cccd}) — ${blForm.reason}`
      );
      toast.success(`Đã đưa ${blForm.ho_va_ten} vào Danh sách Đen.`);
      setShowBlacklistModal(false);
      setBlForm({
        ho_va_ten: '',
        cccd: '',
        ma_nv: '',
        don_vi: '',
        reason: '',
        severity: 'permanent',
        banned_until: '',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    setSubmitting(true);
    try {
      const actorName = currentUser?.name || currentUser?.email || 'Admin';
      const res = await revokeBlacklistRecord(
        revokeTarget.id,
        actorName,
        revokeNote || 'Gỡ lệnh hạn chế theo quyết định Ban Quản Lý'
      );
      if (!res.ok) {
        toast.error(res.error || 'Không thể gỡ lệnh cấm.');
        return;
      }
      setBlacklist(prev =>
        prev.map(b =>
          b.id === revokeTarget.id
            ? {
                ...b,
                is_active: false,
                revoked_by: actorName,
                revoked_at: new Date().toISOString(),
                revoke_note: revokeNote || 'Gỡ lệnh hạn chế',
              }
            : b
        )
      );
      addLog(
        currentUser?.email || actorName,
        'BLACKLIST_REVOKE',
        `Gỡ Danh sách Đen cho ${revokeTarget.ho_va_ten} (CCCD: ${revokeTarget.cccd})`
      );
      toast.success(`Đã gỡ lệnh cấm cho ${revokeTarget.ho_va_ten}.`);
      setRevokeTarget(null);
      setRevokeNote('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleDisciplineStatus = async (rec: DisciplineRecord) => {
    const nextStatus = rec.status === 'open' ? 'resolved' : 'open';
    const res = await updateDisciplineStatus(rec.id, nextStatus);
    if (!res.ok) {
      toast.error(res.error || 'Không thể cập nhật trạng thái.');
      return;
    }
    setDisciplines(prev => prev.map(d => (d.id === rec.id ? { ...d, status: nextStatus } : d)));
    toast.success(nextStatus === 'resolved' ? 'Đã đánh dấu xử lý xong.' : 'Đã mở lại theo dõi.');
  };

  const handleDeleteDiscipline = async (rec: DisciplineRecord) => {
    if (!isAdmin) return;
    const res = await deleteDisciplineRecord(rec.id);
    if (!res.ok) {
      toast.error(res.error || 'Không thể xóa biên bản.');
      return;
    }
    setDisciplines(prev => prev.filter(d => d.id !== rec.id));
    toast.success('Đã xóa bản ghi vi phạm.');
  };

  const handleExportCurrentTab = () => {
    const today = getVNDateString().replace(/-/g, '');
    if (activeTab === 'disciplines') {
      const rows = filteredDisciplines.map((d, idx) => ({
        STT: idx + 1,
        'Ngày xảy ra': d.incident_date,
        'Họ và tên': d.ho_va_ten,
        'Mã NV': d.ma_nv,
        CCCD: d.cccd,
        'Đơn vị / Nhà thầu': d.don_vi,
        'Vị trí': [d.ktx, d.day, d.phong_so ? formatRoomDisplay(d.phong_so) : ''].filter(Boolean).join(' · '),
        'Nhóm vi phạm': DISCIPLINE_CATEGORY_META[d.category]?.label || d.category,
        'Mức độ': DISCIPLINE_SEVERITY_META[d.severity]?.label || d.severity,
        'Nội dung vụ việc': d.title,
        'Biện pháp xử lý': d.action_taken,
        'Trạng thái': d.status === 'resolved' ? 'Đã xử lý' : 'Đang theo dõi',
        'Người lập': d.recorded_by,
      }));
      exportToExcel(rows, `So_Vi_Pham_Ky_Luat_KTX_${today}.xlsx`, 'Vi_Pham_Ky_Luat');
      toast.success(`Đã xuất ${rows.length} biên bản vi phạm.`);
    } else if (activeTab === 'blacklist') {
      const rows = filteredBlacklist.map((b, idx) => ({
        STT: idx + 1,
        'Họ và tên': b.ho_va_ten,
        CCCD: b.cccd,
        'Mã NV': b.ma_nv,
        'Đơn vị / Nhà thầu': b.don_vi,
        'Lý do cấm': b.reason,
        'Thời hạn': b.severity === 'permanent' ? 'Vĩnh viễn' : `Đến ${b.banned_until || '—'}`,
        'Hiệu lực': isBlacklistRecordEffective(b) ? 'Đang chặn' : 'Đã gỡ / Hết hạn',
        'Người đưa vào': b.banned_by,
        'Người gỡ': b.revoked_by || '',
      }));
      exportToExcel(rows, `Danh_Sach_Den_KTX_${today}.xlsx`, 'Blacklist_KTX');
      toast.success(`Đã xuất ${rows.length} bản ghi Danh sách Đen.`);
    } else {
      const rows = ghostCandidates.map((g, idx) => ({
        STT: idx + 1,
        'Họ và tên': g.worker.hoVaTen,
        'Mã NV': g.worker.maNV || '',
        CCCD: g.worker.cccd || '',
        SĐT: g.worker.soDienThoai || '',
        'Đơn vị / Nhà thầu': g.worker.donVi || '',
        KTX: g.worker.ktx || '',
        Dãy: g.worker.day || '',
        Phòng: g.worker.phongSo ? formatRoomDisplay(g.worker.phongSo) : '',
        Giường: g.worker.giuong || '',
        'Vắng liên tiếp': g.consecutiveMissed,
        'Tổng phiên vắng': `${g.missedCount}/${g.totalSessionsInScope}`,
        'Lần điểm danh gần nhất': g.lastPresentDate || 'Chưa ghi nhận',
      }));
      exportToExcel(rows, `Ra_Soat_Cong_Nhan_Ao_${today}.xlsx`, 'Cong_Nhan_Ao');
      toast.success(`Đã xuất ${rows.length} hồ sơ cần rà soát.`);
    }
  };

  if (isTechnician) {
    return (
      <div className="p-6 max-w-xl mx-auto mt-16 text-center space-y-3">
        <CraftIconBadge icon={ShieldAlert} tone="amber" size="lg" interactive={false} className="mx-auto" />
        <h2 className="text-lg font-bold text-tx">Khu vực dành cho Ban Quản Lý KTX</h2>
        <p className="text-sm text-mu">Tài khoản Kỹ thuật viên không có quyền truy cập hồ sơ an ninh và kỷ luật công nhân.</p>
        <Link href="/maintenance" className="btn-primary inline-flex items-center gap-2 text-xs">
          Về Trung tâm Kỹ thuật & Bảo trì
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 max-w-[1440px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-bdr">
        <div className="flex items-center gap-3">
          <CraftIconBadge icon={ShieldAlert} badgeIcon={Ban} tone="rose" size="md" />
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">
              An Ninh, Kỷ Luật & Blacklist
            </h1>
            <p className="text-xs sm:text-sm text-mu mt-0.5">
              Quản lý vi phạm nội quy · Chốt chặn CCCD cấm tái nhập (3 cửa ngõ) · Quét công nhân ảo chiếm giường
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCurrentTab}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surf border border-bdr2 text-tx text-xs font-semibold hover:bg-act transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download size={14} className="text-mu" />
            <span>Xuất Excel</span>
          </button>
          <button
            type="button"
            onClick={() => setShowBlacklistModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl tint-dgr border border-dgr/40 text-dgr text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
          >
            <Ban size={14} />
            <span>Thêm Blacklist</span>
          </button>
          <button
            type="button"
            onClick={() => setShowDisciplineModal(true)}
            className="btn-glow-primary px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Plus size={14} />
            <span>Lập biên bản vi phạm</span>
          </button>
        </div>
      </div>

      {/* SQL migration notice if table not created yet */}
      {tableMissing && (
        <div className="rounded-xl tint-wn border border-wn/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-wn">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Chưa chạy bản vá SQL khởi tạo bảng Kỷ luật & Danh sách Đen trên Supabase</p>
              <p className="opacity-90 mt-0.5">
                Dữ liệu hiện đang lưu tạm trên trình duyệt. Hãy chạy file <code className="font-mono px-1 py-0.5 rounded bg-black/10">{MIGRATION_PATH}</code> trong Supabase SQL Editor để đồng bộ đa thiết bị và bật chốt chặn QR công khai.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(MIGRATION_PATH);
              setCopiedPath(true);
              setTimeout(() => setCopiedPath(false), 2000);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf border border-wn/40 text-wn text-xs font-semibold shrink-0 cursor-pointer"
          >
            {copiedPath ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedPath ? 'Đã chép đường dẫn SQL' : 'Chép path SQL'}</span>
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="surface-elevated rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-mu uppercase tracking-wider">Tổng hồ sơ vi phạm</p>
          <p className="text-2xl font-extrabold text-tx font-tabular mt-1">{kpis.totalDisciplines}</p>
          <p className="text-xs text-mu mt-1">
            Đang theo dõi: <span className="font-semibold text-wn font-tabular">{kpis.openCount}</span> · Buộc rời:{' '}
            <span className="font-semibold text-dgr font-tabular">{kpis.expulsionCount}</span>
          </p>
        </div>
        <div className="surface-elevated rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-mu uppercase tracking-wider">Danh sách Đen hiệu lực</p>
          <p className="text-2xl font-extrabold text-dgr font-tabular mt-1">{kpis.activeBlacklist}</p>
          <p className="text-xs text-mu mt-1">Tự động chặn tại QR · Duyệt hồ sơ · Excel</p>
        </div>
        <div className="surface-elevated rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-mu uppercase tracking-wider">Nhà thầu vi phạm nhiều</p>
          <p className="text-base font-extrabold text-tx truncate mt-1.5" title={kpis.topContractor}>
            {kpis.topContractor}
          </p>
          <p className="text-xs text-mu mt-1">
            {kpis.topCount > 0 ? `${kpis.topCount} biên bản ghi nhận` : 'Chưa có thống kê'}
          </p>
        </div>
        <div className="surface-elevated rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-mu uppercase tracking-wider">Rà soát công nhân ảo</p>
          <p className="text-2xl font-extrabold text-tx font-tabular mt-1">
            {ghostLoaded ? ghostCandidates.length : '—'}
          </p>
          <p className="text-xs text-mu mt-1">
            {ghostLoaded
              ? `Quét từ ${ghostMeta.sessionsAnalyzed} phiên điểm danh`
              : 'Mở tab Quét công nhân ảo để rà soát'}
          </p>
        </div>
      </div>

      {/* Tabs + Filter Toolbar */}
      <div className="surface-elevated rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 pt-3.5 pb-3 border-b border-bdr flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SlidingTabs<SecurityTab>
            layoutId="security-center-tabs"
            compact
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'disciplines', label: 'Sổ Vi phạm & Kỷ luật', count: disciplines.length, icon: FileWarning },
              { id: 'blacklist', label: 'Danh sách Đen (Blacklist)', count: activeBlacklistList.length, icon: Ban },
              { id: 'ghost', label: 'Quét Công nhân ảo', count: ghostLoaded ? ghostCandidates.length : undefined, icon: Ghost },
            ]}
          />

          <div className="flex flex-wrap items-center gap-2">
            {activeTab !== 'ghost' && (
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Tìm tên, CCCD, Mã NV, nhà thầu..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg border border-bdr2 rounded-lg text-tx focus:outline-none focus:ring-2 focus:ring-pri2/35"
                />
              </div>
            )}

            {activeTab === 'disciplines' && (
              <>
                <select
                  value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value as 'all' | DisciplineSeverity)}
                  className="px-2.5 py-1.5 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                >
                  <option value="all">Tất cả mức độ</option>
                  <option value="reminder">Nhắc nhở</option>
                  <option value="warning">Cảnh cáo</option>
                  <option value="record">Lập biên bản</option>
                  <option value="expulsion">Buộc rời KTX</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as 'all' | 'open' | 'resolved')}
                  className="px-2.5 py-1.5 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                >
                  <option value="all">Mọi trạng thái</option>
                  <option value="open">Đang theo dõi</option>
                  <option value="resolved">Đã xử lý</option>
                </select>
              </>
            )}

            {activeTab === 'blacklist' && (
              <div className="flex items-center gap-1 bg-act p-1 rounded-lg border border-bdr">
                <button
                  type="button"
                  onClick={() => setBlacklistView('active')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                    blacklistView === 'active' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  Đang chặn ({activeBlacklistList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBlacklistView('all')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                    blacklistView === 'all' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
                  }`}
                >
                  Tất cả ({blacklist.length})
                </button>
              </div>
            )}

            {activeTab === 'ghost' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-mu">Ngưỡng vắng liên tiếp:</span>
                {[2, 3, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setGhostThreshold(n);
                      void runGhostScan(n);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                      ghostThreshold === n
                        ? 'bg-pri text-white border-pri'
                        : 'bg-surf text-tx border-bdr2 hover:bg-act'
                    }`}
                  >
                    ≥ {n} phiên
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void runGhostScan(ghostThreshold)}
                  disabled={ghostLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf border border-bdr2 text-xs font-semibold text-tx hover:bg-act cursor-pointer"
                >
                  <RefreshCw size={13} className={ghostLoading ? 'animate-spin text-pri2' : ''} />
                  <span>Quét lại</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tab 1: Disciplines */}
        {activeTab === 'disciplines' && (
          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-16 text-center text-xs text-mu flex flex-col items-center gap-2">
                <RefreshCw size={22} className="animate-spin text-pri2" />
                <span>Đang tải sổ kỷ luật...</span>
              </div>
            ) : filteredDisciplines.length === 0 ? (
              <div className="py-14 text-center space-y-2 px-4">
                <ShieldCheck size={32} className="mx-auto text-ok opacity-80" />
                <p className="text-sm font-bold text-tx">Chưa có biên bản vi phạm nào phù hợp bộ lọc</p>
                <p className="text-xs text-mu">Nhấn &quot;Lập biên bản vi phạm&quot; khi phát sinh sự việc cần ghi nhận kỷ luật.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-act text-mu uppercase tracking-wider text-[11px] font-bold border-b border-bdr2">
                  <tr>
                    <th className="px-4 py-3">Ngày</th>
                    <th className="px-4 py-3">Công nhân & Vị trí</th>
                    <th className="px-4 py-3">Nhóm & Mức độ</th>
                    <th className="px-4 py-3">Nội dung & Biện pháp</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bdr">
                  {filteredDisciplines.map(rec => {
                    const sev = DISCIPLINE_SEVERITY_META[rec.severity];
                    const cat = DISCIPLINE_CATEGORY_META[rec.category];
                    return (
                      <tr key={rec.id} className="hover:bg-act/40 transition-colors">
                        <td className="px-4 py-3 font-tabular text-mu whitespace-nowrap">
                          {rec.incident_date}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-tx">{rec.ho_va_ten}</div>
                          <div className="text-[11px] text-mu mt-0.5">
                            {rec.cccd ? `CCCD: ${rec.cccd}` : 'Chưa có CCCD'}
                            {rec.don_vi ? ` · ${rec.don_vi}` : ''}
                          </div>
                          {(rec.day || rec.phong_so) && (
                            <div className="text-[11px] text-lnk mt-0.5">
                              {[rec.ktx, rec.day, rec.phong_so ? formatRoomDisplay(rec.phong_so) : ''].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="space-y-1">
                            <StatusTag tone={sev.tone} size="sm">
                              {sev.label}
                            </StatusTag>
                            <div className="text-[11px] text-mu">{cat?.shortLabel || rec.category}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-md">
                          <div className="font-semibold text-tx">{rec.title}</div>
                          {rec.description && <p className="text-mu mt-0.5 line-clamp-2">{rec.description}</p>}
                          {rec.action_taken && (
                            <p className="text-[11px] text-lnk mt-1">Xử lý: {rec.action_taken}</p>
                          )}
                          <p className="text-[10px] text-mu mt-1">Ghi nhận bởi: {rec.recorded_by}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {rec.status === 'resolved' ? (
                            <StatusTag tone="teal" size="sm">Đã xử lý</StatusTag>
                          ) : (
                            <StatusTag tone="amber" size="sm">Đang theo dõi</StatusTag>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleToggleDisciplineStatus(rec)}
                              title={rec.status === 'open' ? 'Đánh dấu đã xử lý' : 'Mở lại theo dõi'}
                              className="p-1.5 rounded-lg hover:bg-act text-mu hover:text-ok transition-colors cursor-pointer"
                            >
                              <CheckCircle2 size={15} />
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteDiscipline(rec)}
                                title="Xóa bản ghi"
                                className="p-1.5 rounded-lg hover:bg-dgrbg text-mu hover:text-dgr transition-colors cursor-pointer"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 2: Blacklist */}
        {activeTab === 'blacklist' && (
          <div className="overflow-x-auto">
            <div className="px-4 sm:px-5 py-2.5 bg-act/50 border-b border-bdr text-xs text-mu flex flex-wrap items-center justify-between gap-2">
              <span>
                Chốt chặn tự động đang bảo vệ 3 cửa ngõ: <strong className="text-tx">Form đăng ký QR công khai</strong> · <strong className="text-tx">Duyệt hồ sơ QR</strong> · <strong className="text-tx">Nhập Excel & Thêm công nhân</strong>
              </span>
            </div>
            {filteredBlacklist.length === 0 ? (
              <div className="py-14 text-center space-y-2 px-4">
                <ShieldCheck size={32} className="mx-auto text-ok opacity-80" />
                <p className="text-sm font-bold text-tx">Danh sách Đen đang trống</p>
                <p className="text-xs text-mu">Các số CCCD bị cấm tái nhập KTX sẽ hiển thị tại đây và được tự động khóa trên toàn hệ thống.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-act text-mu uppercase tracking-wider text-[11px] font-bold border-b border-bdr2">
                  <tr>
                    <th className="px-4 py-3">Đối tượng bị hạn chế</th>
                    <th className="px-4 py-3">CCCD / Mã NV</th>
                    <th className="px-4 py-3">Lý do cấm tái nhập</th>
                    <th className="px-4 py-3">Hiệu lực</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bdr">
                  {filteredBlacklist.map(item => {
                    const effective = isBlacklistRecordEffective(item);
                    return (
                      <tr key={item.id} className={`hover:bg-act/40 transition-colors ${!effective ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-bold text-tx">{item.ho_va_ten}</div>
                          <div className="text-[11px] text-mu mt-0.5">{item.don_vi || 'Chưa rõ nhà thầu'}</div>
                        </td>
                        <td className="px-4 py-3 font-mono font-tabular whitespace-nowrap">
                          <div className="font-bold text-dgr">{item.cccd}</div>
                          {item.ma_nv && <div className="text-[11px] text-mu">MN: {item.ma_nv}</div>}
                        </td>
                        <td className="px-4 py-3 max-w-md">
                          <div className="text-tx font-medium">{item.reason}</div>
                          <div className="text-[11px] text-mu mt-0.5">
                            Đưa vào bởi: {item.banned_by} · {new Date(item.created_at).toLocaleDateString('vi-VN')}
                          </div>
                          {item.revoked_by && (
                            <div className="text-[11px] text-ok mt-0.5">
                              Đã gỡ bởi {item.revoked_by}: {item.revoke_note || '—'}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {effective ? (
                            <StatusTag tone="rose" size="sm" icon={Ban}>
                              {item.severity === 'permanent' ? 'Cấm vĩnh viễn' : `Đến ${item.banned_until}`}
                            </StatusTag>
                          ) : (
                            <StatusTag tone="slate" size="sm">Đã gỡ / Hết hạn</StatusTag>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {effective && isAdmin ? (
                            <button
                              type="button"
                              onClick={() => {
                                setRevokeTarget(item);
                                setRevokeNote('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surf border border-bdr2 text-tx hover:bg-act text-[11px] font-semibold cursor-pointer"
                            >
                              <Undo2 size={12} />
                              <span>Gỡ lệnh cấm</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-mu">{effective ? 'Chỉ Admin gỡ' : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 3: Ghost Worker Detector */}
        {activeTab === 'ghost' && (
          <div className="overflow-x-auto">
            <div className="px-4 sm:px-5 py-2.5 bg-act/50 border-b border-bdr text-xs text-mu flex flex-wrap items-center justify-between gap-2">
              <span>
                Đối chiếu danh sách đang lưu trú với <strong className="text-tx font-tabular">{ghostMeta.sessionsAnalyzed}</strong> phiên điểm danh gần nhất
                {ghostMeta.latestSessionDate ? ` (gần nhất: ${ghostMeta.latestSessionDate})` : ''}.
              </span>
              <Link href="/qr-portal" className="text-lnk font-semibold hover:underline inline-flex items-center gap-1">
                <span>Mở quản lý phiên điểm danh</span>
                <ExternalLink size={12} />
              </Link>
            </div>
            {ghostLoading ? (
              <div className="py-16 text-center text-xs text-mu flex flex-col items-center gap-2">
                <RefreshCw size={22} className="animate-spin text-pri2" />
                <span>Đang đối chiếu lịch sử điểm danh với sơ đồ giường...</span>
              </div>
            ) : ghostMeta.sessionsAnalyzed === 0 ? (
              <div className="py-14 text-center space-y-2 px-4">
                <Ghost size={32} className="mx-auto text-mu opacity-60" />
                <p className="text-sm font-bold text-tx">Chưa có dữ liệu phiên điểm danh để đối chiếu</p>
                <p className="text-xs text-mu max-w-md mx-auto">
                  Khi Ban Quản Lý mở các phiên điểm danh QR trong mục QR Portal, hệ thống sẽ tự động đối chiếu để phát hiện công nhân vắng mặt dài ngày chiếm giường trống.
                </p>
              </div>
            ) : ghostCandidates.length === 0 ? (
              <div className="py-14 text-center space-y-2 px-4">
                <ShieldCheck size={32} className="mx-auto text-ok opacity-80" />
                <p className="text-sm font-bold text-tx">Không phát hiện công nhân vắng liên tiếp ≥ {ghostThreshold} phiên</p>
                <p className="text-xs text-mu">Quân số hiện diện đang khớp tốt với các phiên điểm danh gần đây.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-act text-mu uppercase tracking-wider text-[11px] font-bold border-b border-bdr2">
                  <tr>
                    <th className="px-4 py-3">Công nhân</th>
                    <th className="px-4 py-3">Đơn vị / Nhà thầu</th>
                    <th className="px-4 py-3">Vị trí đang giữ giường</th>
                    <th className="px-4 py-3 text-right">Vắng liên tiếp</th>
                    <th className="px-4 py-3 text-right">Tổng phiên vắng</th>
                    <th className="px-4 py-3">Lần thấy gần nhất</th>
                    <th className="px-4 py-3 text-right">Kiểm tra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bdr">
                  {ghostCandidates.map(cand => (
                    <tr key={cand.worker.id} className="hover:bg-act/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-tx">{cand.worker.hoVaTen}</div>
                        <div className="text-[11px] text-mu font-tabular">
                          {cand.worker.maNV || '—'} · {cand.worker.soDienThoai || 'Chưa có SĐT'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-tx">{cand.worker.donVi || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-semibold text-tx">
                          {cand.worker.day} · {formatRoomDisplay(cand.worker.phongSo)}
                        </span>
                        {cand.worker.giuong && <span className="text-mu ml-1">· G{cand.worker.giuong}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-tabular">
                        <StatusTag tone={cand.riskLevel === 'high' ? 'rose' : 'amber'} size="sm">
                          {cand.consecutiveMissed} phiên
                        </StatusTag>
                      </td>
                      <td className="px-4 py-3 text-right font-tabular font-semibold text-tx">
                        {cand.missedCount}/{cand.totalSessionsInScope}
                      </td>
                      <td className="px-4 py-3 text-mu font-tabular whitespace-nowrap">
                        {cand.lastPresentDate || 'Chưa từng điểm danh'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link
                          href={`/worker-management?search=${encodeURIComponent(cand.worker.maNV || cand.worker.hoVaTen)}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surf border border-bdr2 text-lnk hover:bg-act text-[11px] font-semibold"
                        >
                          <span>Rà soát hồ sơ</span>
                          <ExternalLink size={11} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modal: Create Discipline Record */}
      {showDisciplineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 overflow-y-auto">
          <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden my-auto">
            <div className="px-5 py-4 border-b border-bdr flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-tx">Lập biên bản Vi phạm & Kỷ luật KTX</h2>
                <p className="text-xs text-mu mt-0.5">Chọn nhanh công nhân đang ở hoặc nhập trực tiếp thông tin</p>
              </div>
              <button type="button" onClick={() => setShowDisciplineModal(false)} className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSaveDiscipline} className="p-5 space-y-3.5 overflow-y-auto flex-1">
              {/* Quick Worker Picker */}
              <div className="relative">
                <label className="block text-xs font-semibold text-mu mb-1">Tìm nhanh công nhân đang ở KTX (tự điền thông tin)</label>
                <input
                  type="text"
                  value={workerPickerQuery}
                  onChange={e => setWorkerPickerQuery(e.target.value)}
                  placeholder="Gõ tên, Mã NV, CCCD hoặc số phòng..."
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx focus:outline-none focus:ring-2 focus:ring-pri2/40"
                />
                {workerPickerMatches.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl bg-surf border border-bdr2 shadow-xl overflow-hidden">
                    {workerPickerMatches.map(w => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => pickWorkerForDiscipline(w)}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-act flex items-center justify-between gap-2 border-b border-bdr last:border-b-0 cursor-pointer"
                      >
                        <div>
                          <span className="font-bold text-tx">{w.hoVaTen}</span>
                          <span className="text-mu ml-2">{w.donVi || '—'}</span>
                        </div>
                        <span className="text-[11px] font-tabular text-lnk shrink-0">
                          {w.day} · {formatRoomDisplay(w.phongSo)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Họ và tên *</label>
                  <input
                    required
                    value={discForm.ho_va_ten}
                    onChange={e => setDiscForm(f => ({ ...f, ho_va_ten: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                    placeholder="Nguyễn Văn A"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Số CCCD</label>
                  <input
                    value={discForm.cccd}
                    onChange={e => setDiscForm(f => ({ ...f, cccd: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx font-mono"
                    placeholder="12 chữ số"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Đơn vị / Nhà thầu</label>
                  <input
                    value={discForm.don_vi}
                    onChange={e => setDiscForm(f => ({ ...f, don_vi: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Ngày xảy ra</label>
                  <input
                    type="date"
                    value={discForm.incident_date}
                    onChange={e => setDiscForm(f => ({ ...f, incident_date: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Nhóm vi phạm</label>
                  <select
                    value={discForm.category}
                    onChange={e => setDiscForm(f => ({ ...f, category: e.target.value as DisciplineCategory }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  >
                    {Object.entries(DISCIPLINE_CATEGORY_META).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Mức độ kỷ luật</label>
                  <select
                    value={discForm.severity}
                    onChange={e => {
                      const nextSev = e.target.value as DisciplineSeverity;
                      setDiscForm(f => ({
                        ...f,
                        severity: nextSev,
                        alsoBlacklist: nextSev === 'expulsion' ? true : f.alsoBlacklist,
                      }));
                    }}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  >
                    <option value="reminder">Nhắc nhở</option>
                    <option value="warning">Cảnh cáo</option>
                    <option value="record">Lập biên bản</option>
                    <option value="expulsion">Buộc rời KTX (Nghiêm trọng)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-mu mb-1">Tóm tắt sự việc *</label>
                <input
                  required
                  value={discForm.title}
                  onChange={e => setDiscForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  placeholder="VD: Nấu ăn bằng bếp gas mini trong phòng 104..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-mu mb-1">Diễn biến chi tiết</label>
                <textarea
                  rows={2}
                  value={discForm.description}
                  onChange={e => setDiscForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-mu mb-1">Biện pháp xử lý / Cam kết</label>
                <input
                  value={discForm.action_taken}
                  onChange={e => setDiscForm(f => ({ ...f, action_taken: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  placeholder="VD: Thu giữ thiết bị, thông báo Tổ trưởng ký cam kết..."
                />
              </div>

              {/* Direct Blacklist escalation option */}
              <div className="p-3 rounded-xl tint-dgr border border-dgr/35 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-dgr cursor-pointer">
                  <input
                    type="checkbox"
                    checked={discForm.alsoBlacklist}
                    onChange={e => setDiscForm(f => ({ ...f, alsoBlacklist: e.target.checked }))}
                    className="rounded"
                  />
                  <span>Đồng thời đưa CCCD này vào Danh sách Đen (cấm tái nhập KTX)</span>
                </label>
                {discForm.alsoBlacklist && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <select
                      value={discForm.blacklistSeverity}
                      onChange={e => setDiscForm(f => ({ ...f, blacklistSeverity: e.target.value as 'permanent' | 'temporary' }))}
                      className="px-2.5 py-1.5 text-xs bg-surf border border-dgr/40 rounded-lg text-tx"
                    >
                      <option value="permanent">Cấm vĩnh viễn</option>
                      <option value="temporary">Cấm có thời hạn</option>
                    </select>
                    {discForm.blacklistSeverity === 'temporary' && (
                      <input
                        type="date"
                        value={discForm.banned_until}
                        onChange={e => setDiscForm(f => ({ ...f, banned_until: e.target.value }))}
                        className="px-2.5 py-1.5 text-xs bg-surf border border-dgr/40 rounded-lg text-tx"
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-bdr">
                <button type="button" onClick={() => setShowDisciplineModal(false)} className="btn-secondary text-xs">
                  Hủy
                </button>
                <button type="submit" disabled={submitting} className="btn-primary text-xs">
                  {submitting ? 'Đang lưu...' : 'Lưu biên bản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Direct Blacklist */}
      {showBlacklistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
          <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-bdr flex items-center justify-between">
              <h2 className="text-base font-bold text-dgr flex items-center gap-2">
                <Ban size={17} /> Thêm vào Danh sách Đen
              </h2>
              <button type="button" onClick={() => setShowBlacklistModal(false)} className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSaveBlacklist} className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-mu mb-1">Họ và tên *</label>
                <input
                  required
                  value={blForm.ho_va_ten}
                  onChange={e => setBlForm(f => ({ ...f, ho_va_ten: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Số CCCD *</label>
                  <input
                    required
                    value={blForm.cccd}
                    onChange={e => setBlForm(f => ({ ...f, cccd: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx font-mono"
                    placeholder="12 chữ số"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Mã NV (nếu có)</label>
                  <input
                    value={blForm.ma_nv}
                    onChange={e => setBlForm(f => ({ ...f, ma_nv: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-mu mb-1">Đơn vị / Nhà thầu</label>
                <input
                  value={blForm.don_vi}
                  onChange={e => setBlForm(f => ({ ...f, don_vi: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-mu mb-1">Mức độ cấm</label>
                  <select
                    value={blForm.severity}
                    onChange={e => setBlForm(f => ({ ...f, severity: e.target.value as 'permanent' | 'temporary' }))}
                    className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  >
                    <option value="permanent">Vĩnh viễn</option>
                    <option value="temporary">Có thời hạn</option>
                  </select>
                </div>
                {blForm.severity === 'temporary' && (
                  <div>
                    <label className="block text-xs font-semibold text-mu mb-1">Cấm đến ngày</label>
                    <input
                      type="date"
                      required
                      value={blForm.banned_until}
                      onChange={e => setBlForm(f => ({ ...f, banned_until: e.target.value }))}
                      className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-mu mb-1">Lý do cấm tái nhập KTX *</label>
                <textarea
                  required
                  rows={2}
                  value={blForm.reason}
                  onChange={e => setBlForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
                  placeholder="Ghi rõ lý do để hiển thị cảnh báo cho cán bộ trực..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-bdr">
                <button type="button" onClick={() => setShowBlacklistModal(false)} className="btn-secondary text-xs">Hủy</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-dgr text-white text-xs font-bold hover:opacity-90 cursor-pointer">
                  {submitting ? 'Đang khóa...' : 'Kích hoạt chốt chặn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Revoke Blacklist */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
          <div className="surface-elevated rounded-2xl shadow-2xl border border-bdr3 w-full max-w-md p-5 space-y-4">
            <h3 className="text-base font-bold text-tx">Gỡ lệnh cấm Danh sách Đen</h3>
            <p className="text-xs text-mu leading-relaxed">
              Xác nhận cho phép <strong className="text-tx">{revokeTarget.ho_va_ten}</strong> (CCCD: <code className="font-mono">{revokeTarget.cccd}</code>) được đăng ký lưu trú trở lại?
            </p>
            <div>
              <label className="block text-xs font-semibold text-mu mb-1">Lý do gỡ bỏ</label>
              <input
                value={revokeNote}
                onChange={e => setRevokeNote(e.target.value)}
                placeholder="VD: Đã hết thời hạn kỷ luật, nhà thầu bảo lãnh..."
                className="w-full px-3 py-2 text-xs bg-bg border border-bdr2 rounded-lg text-tx"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRevokeTarget(null)} className="btn-secondary text-xs">Hủy</button>
              <button type="button" onClick={handleConfirmRevoke} disabled={submitting} className="btn-primary text-xs">
                {submitting ? 'Đang xử lý...' : 'Xác nhận gỡ lệnh'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
