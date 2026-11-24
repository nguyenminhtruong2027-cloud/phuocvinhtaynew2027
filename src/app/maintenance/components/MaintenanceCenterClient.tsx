'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Wrench,
  Plus,
  QrCode,
  RefreshCw,
  FileSpreadsheet,
  Search,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Play,
  RotateCcw,
  Trash2,
  Box,
  BedDouble,
  Building2,
  Copy,
  Download,
  Printer,
  X,
  Loader2,
  Database,
  ShieldCheck,
  CheckSquare,
  Square,
  Phone,
  User,
  BarChart3,
  Layers,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import {
  MAINTENANCE_SETUP_SQL,
  MaintenanceTicket,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_META,
  TicketCategory,
  TicketPriority,
  acceptMaintenanceTicket,
  buildRoomIssueQrUrl,
  bulkDeleteResolvedTickets,
  computeMaintenanceAnalytics,
  createInternalMaintenanceTicket,
  deleteMaintenanceTicket,
  fetchMaintenanceTickets,
  formatDurationVi,
  getTicketCategoryLabel,
  getTicketCategoryShortLabel,
  getTicketSlaStatus,
  reopenMaintenanceTicket,
  resolveMaintenanceTicket,
} from '@/lib/maintenanceTickets';
import {
  FacilityItem,
  fetchFacilitiesList,
  formatRoomDisplay,
  invalidateFacilitiesCache,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { hasFacilityIssueNote } from '@/lib/smartRoomAssign';
import { useKtxStructure } from '@/lib/ktxStructure';
import { naturalSortCompare } from '@/data/workers';
import { QrCodeImage, downloadQrPng } from '@/components/QrCodeImage';
import {
  BatchRoomQrItem,
  PosterPaperSize,
  printBatchRoomIssueQrStickers,
  printQrBulletinPoster,
} from '@/lib/qrPosterPrint';
import { exportToExcel } from '@/lib/exportExcel';

interface MaintenanceBedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
}

type StatusFilter = 'active' | 'overdue' | 'open' | 'in_progress' | 'resolved' | 'all';

function formatVnDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function MaintenanceCenterClient() {
  const {
    currentUser,
    isAdmin,
    isTechnician,
    isStaff,
    canOperateMaintenance,
    canCreateMaintenanceTicket,
    canDeleteResolvedTicket,
    canAccessMaintenanceBlock,
  } = useAuth();
  const { addLog } = useAudit();
  const { ktxGroups } = useKtxStructure();
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<'tickets' | 'facilities_beds'>('tickets');
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Facilities & maintenance beds for Tab 2
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [maintenanceBeds, setMaintenanceBeds] = useState<MaintenanceBedRow[]>([]);
  const [resolvingInfraUid, setResolvingInfraUid] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Busy states & selection
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [selectedResolvedIds, setSelectedResolvedIds] = useState<Set<string>>(new Set());

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [resolvingTicket, setResolvingTicket] = useState<MaintenanceTicket | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [deletingTicket, setDeletingTicket] = useState<MaintenanceTicket | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Create ticket form
  const [createKtx, setCreateKtx] = useState('');
  const [createDay, setCreateDay] = useState('');
  const [createRoom, setCreateRoom] = useState('');
  const [createCategory, setCreateCategory] = useState<TicketCategory>('electric');
  const [createPriority, setCreatePriority] = useState<TicketPriority>('normal');
  const [createDesc, setCreateDesc] = useState('');
  const [createReporterPhone, setCreateReporterPhone] = useState('');
  const [creating, setCreating] = useState(false);

  // QR generator state
  const [qrKtx, setQrKtx] = useState('');
  const [qrDay, setQrDay] = useState('');
  const [qrRoom, setQrRoom] = useState('');
  const [posterPaperSize, setPosterPaperSize] = useState<PosterPaperSize>('A5');
  const [printingPoster, setPrintingPoster] = useState(false);
  const [printingBatch, setPrintingBatch] = useState(false);

  // Analytics & live SLA clock
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const actorLabel = currentUser?.name || currentUser?.email || 'Kỹ thuật viên';

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const [ticketRes, facList, bedsRes] = await Promise.all([
          fetchMaintenanceTickets(),
          fetchFacilitiesList(isRefresh).catch(() => [] as FacilityItem[]),
          supabase
            .from('beds')
            .select('id, ktx, day, phong_so, giuong')
            .eq('status', 'maintenance'),
        ]);

        setTableMissing(ticketRes.tableMissing);
        setTickets(ticketRes.tickets);
        setFacilities((facList || []).filter(f => f.is_visible !== false));
        setMaintenanceBeds((bedsRes.data || []) as MaintenanceBedRow[]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không thể tải dữ liệu bảo trì.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  // Realtime subscription on maintenance_tickets
  useEffect(() => {
    if (tableMissing) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadAll(true);
      }, 350);
    };
    const channel = supabase
      .channel('maintenance_center_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_tickets' }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, tableMissing, loadAll]);

  // Scope-filtered tickets
  const scopedTickets = useMemo(() => {
    return tickets.filter(t => {
      if (isAdmin) return true;
      if (isTechnician) return canAccessMaintenanceBlock(t.day, t.ktx);
      // Staff can monitor tickets across blocks or within their assigned blocks (all visible from RLS)
      return true;
    });
  }, [tickets, isAdmin, isTechnician, canAccessMaintenanceBlock]);

  // Analytics & SLA metrics
  const analytics = useMemo(
    () => computeMaintenanceAnalytics(scopedTickets, nowTick),
    [scopedTickets, nowTick]
  );

  // KPI metrics
  const kpis = useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let urgentActive = 0;
    let resolved = 0;
    for (const t of scopedTickets) {
      if (t.status === 'open') open += 1;
      else if (t.status === 'in_progress') inProgress += 1;
      else if (t.status === 'resolved') resolved += 1;
      if (t.priority === 'urgent' && t.status !== 'resolved') urgentActive += 1;
    }
    return {
      open,
      inProgress,
      urgentActive,
      resolved,
      active: open + inProgress,
      slaOverdue: analytics.slaOverdueCount,
    };
  }, [scopedTickets, analytics.slaOverdueCount]);

  // Available KTX / Day / Room options from facilities + ktxGroups
  const ktxOptions = useMemo(() => {
    const set = new Set<string>();
    ktxGroups.forEach(g => {
      if (g.ktx) set.add(g.ktx);
    });
    facilities.forEach(f => {
      if (f.ktx) set.add(f.ktx);
    });
    return Array.from(set).sort(naturalSortCompare);
  }, [ktxGroups, facilities]);

  const getDaysForKtx = useCallback(
    (selectedKtx: string) => {
      const set = new Set<string>();
      ktxGroups.find(g => g.ktx === selectedKtx)?.days.forEach(d => set.add(d));
      facilities
        .filter(f => !selectedKtx || f.ktx === selectedKtx)
        .forEach(f => {
          if (f.day) set.add(f.day);
        });
      return Array.from(set).sort(naturalSortCompare);
    },
    [ktxGroups, facilities]
  );

  const getRoomsForKtxDay = useCallback(
    (selectedKtx: string, selectedDay: string) => {
      const set = new Set<string>();
      facilities
        .filter(f => (!selectedKtx || f.ktx === selectedKtx) && (!selectedDay || f.day === selectedDay))
        .forEach(f => {
          const norm = normalizeRoomLabel(f.phong_khu_vuc);
          if (norm) set.add(norm);
        });
      return Array.from(set).sort(naturalSortCompare);
    },
    [facilities]
  );

  // Initialize create & QR defaults once options load
  useEffect(() => {
    if (!createKtx && ktxOptions.length > 0) setCreateKtx(ktxOptions[0]);
    if (!qrKtx && ktxOptions.length > 0) setQrKtx(ktxOptions[0]);
  }, [ktxOptions, createKtx, qrKtx]);

  const createDays = useMemo(() => getDaysForKtx(createKtx), [getDaysForKtx, createKtx]);
  const createRooms = useMemo(() => getRoomsForKtxDay(createKtx, createDay), [getRoomsForKtxDay, createKtx, createDay]);

  useEffect(() => {
    if (!createDay && createDays.length > 0) setCreateDay(createDays[0]);
  }, [createDay, createDays]);

  useEffect(() => {
    if (!createRoom && createRooms.length > 0) setCreateRoom(createRooms[0]);
  }, [createRoom, createRooms]);

  const qrDays = useMemo(() => getDaysForKtx(qrKtx), [getDaysForKtx, qrKtx]);
  const qrRooms = useMemo(() => getRoomsForKtxDay(qrKtx, qrDay), [getRoomsForKtxDay, qrKtx, qrDay]);

  useEffect(() => {
    if (!qrDay && qrDays.length > 0) setQrDay(qrDays[0]);
  }, [qrDay, qrDays]);

  useEffect(() => {
    if (!qrRoom && qrRooms.length > 0) setQrRoom(qrRooms[0]);
  }, [qrRoom, qrRooms]);

  const filterDays = useMemo(() => {
    const set = new Set<string>();
    scopedTickets.forEach(t => {
      if (t.day) set.add(t.day);
    });
    return Array.from(set).sort(naturalSortCompare);
  }, [scopedTickets]);

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedTickets
      .filter(t => {
        if (statusFilter === 'active' && t.status === 'resolved') return false;
        if (statusFilter === 'overdue') {
          if (t.status === 'resolved') return false;
          if (getTicketSlaStatus(t, nowTick).state !== 'overdue') return false;
        } else if (statusFilter !== 'all' && statusFilter !== 'active' && t.status !== statusFilter) {
          return false;
        }
        if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
        if (dayFilter !== 'all' && t.day !== dayFilter) return false;
        if (q) {
          const hay = `${t.ticket_code} ${t.ktx} ${t.day} phòng ${t.phong_so} ${t.description} ${t.reporter_name} ${t.assigned_to_name || ''} ${t.resolution_note || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Active SLA overdue & urgent tickets first, then open/in_progress before resolved, then newest
        const prioScore = (t: MaintenanceTicket) => {
          if (t.status === 'resolved') return 4;
          const sla = getTicketSlaStatus(t, nowTick);
          if (sla.state === 'overdue') return 0;
          if (t.priority === 'urgent') return 1;
          return t.status === 'open' ? 2 : 3;
        };
        const diff = prioScore(a) - prioScore(b);
        if (diff !== 0) return diff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [scopedTickets, statusFilter, categoryFilter, dayFilter, search, nowTick]);

  // Deletable resolved tickets among currently visible list
  const deletableResolvedVisible = useMemo(() => {
    if (!canDeleteResolvedTicket) return [];
    return filteredTickets.filter(
      t => t.status === 'resolved' && (isAdmin || canAccessMaintenanceBlock(t.day, t.ktx))
    );
  }, [filteredTickets, canDeleteResolvedTicket, isAdmin, canAccessMaintenanceBlock]);

  const canDeleteSingleTicket = useCallback(
    (t: MaintenanceTicket): boolean => {
      if (isAdmin) return true;
      if (isTechnician) {
        return t.status === 'resolved' && canAccessMaintenanceBlock(t.day, t.ktx);
      }
      return false;
    },
    [isAdmin, isTechnician, canAccessMaintenanceBlock]
  );

  const canOperateTicket = useCallback(
    (t: MaintenanceTicket): boolean => {
      if (!canOperateMaintenance) return false;
      return isAdmin || canAccessMaintenanceBlock(t.day, t.ktx);
    },
    [canOperateMaintenance, isAdmin, canAccessMaintenanceBlock]
  );

  // Clean up stale selections when list changes
  useEffect(() => {
    const validIds = new Set(deletableResolvedVisible.map(t => t.id));
    setSelectedResolvedIds(prev => {
      const next = new Set<string>();
      prev.forEach(id => {
        if (validIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [deletableResolvedVisible]);

  // Infrastructure rows (Tab 2: facilities issue notes + maintenance beds)
  const infraRows = useMemo(() => {
    const list: Array<{
      uid: string;
      kind: 'facility' | 'bed';
      ktx: string;
      day: string;
      room: string;
      bedLabel?: string;
      description: string;
      recordId: string;
    }> = [];

    for (const f of facilities) {
      if (f.id && hasFacilityIssueNote(f.ghi_chu)) {
        if (isAdmin || !isTechnician || canAccessMaintenanceBlock(f.day, f.ktx)) {
          list.push({
            uid: `fac-${f.id}`,
            kind: 'facility',
            ktx: f.ktx,
            day: f.day,
            room: normalizeRoomLabel(f.phong_khu_vuc),
            description: (f.ghi_chu || '').trim(),
            recordId: f.id,
          });
        }
      }
    }

    for (const b of maintenanceBeds) {
      if (isAdmin || !isTechnician || canAccessMaintenanceBlock(b.day, b.ktx)) {
        list.push({
          uid: `bed-${b.id}`,
          kind: 'bed',
          ktx: b.ktx,
          day: b.day,
          room: normalizeRoomLabel(b.phong_so),
          bedLabel: b.giuong,
          description: `Giường ${b.giuong} đang khóa bảo trì`,
          recordId: b.id,
        });
      }
    }

    return list.sort((a, b) => naturalSortCompare(a.day, b.day) || naturalSortCompare(a.room, b.room));
  }, [facilities, maintenanceBeds, isAdmin, isTechnician, canAccessMaintenanceBlock]);

  // Ticket operations
  const handleAccept = async (ticket: MaintenanceTicket) => {
    if (!currentUser || !canOperateTicket(ticket)) {
      toast.error('Bạn không có quyền tiếp nhận phiếu tại dãy này.');
      return;
    }
    setBusyTicketId(ticket.id);
    try {
      const updated = await acceptMaintenanceTicket(ticket.id, currentUser.id, actorLabel);
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      addLog(
        actorLabel,
        'MAINTENANCE_TICKET_UPDATE',
        `Tiếp nhận xử lý phiếu ${ticket.ticket_code} (${ticket.day} - ${formatRoomDisplay(ticket.phong_so)} · ${getTicketCategoryShortLabel(ticket.category)})`
      );
      toast.success(`Đã tiếp nhận phiếu ${ticket.ticket_code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể tiếp nhận phiếu.');
    } finally {
      setBusyTicketId(null);
    }
  };

  const handleConfirmResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !resolvingTicket) return;
    setBusyTicketId(resolvingTicket.id);
    try {
      const updated = await resolveMaintenanceTicket(
        resolvingTicket.id,
        currentUser.id,
        actorLabel,
        resolutionNote || 'Đã kiểm tra và khắc phục xong.'
      );
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      addLog(
        actorLabel,
        'MAINTENANCE_TICKET_RESOLVE',
        `Hoàn thành phiếu ${resolvingTicket.ticket_code} (${resolvingTicket.day} - ${formatRoomDisplay(resolvingTicket.phong_so)}): ${resolutionNote || 'Đã khắc phục xong'}`
      );
      toast.success(`Đã hoàn thành phiếu ${resolvingTicket.ticket_code}`);
      setResolvingTicket(null);
      setResolutionNote('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể cập nhật hoàn thành.');
    } finally {
      setBusyTicketId(null);
    }
  };

  const handleReopen = async (ticket: MaintenanceTicket) => {
    if (!canOperateTicket(ticket)) return;
    setBusyTicketId(ticket.id);
    try {
      const updated = await reopenMaintenanceTicket(ticket.id);
      setTickets(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      addLog(
        actorLabel,
        'MAINTENANCE_TICKET_UPDATE',
        `Mở lại phiếu ${ticket.ticket_code} (${ticket.day} - ${formatRoomDisplay(ticket.phong_so)})`
      );
      toast.success(`Đã mở lại phiếu ${ticket.ticket_code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể mở lại phiếu.');
    } finally {
      setBusyTicketId(null);
    }
  };

  const handleConfirmDeleteSingle = async () => {
    if (!deletingTicket) return;
    const target = deletingTicket;
    setBusyTicketId(target.id);
    try {
      await deleteMaintenanceTicket(target.id);
      setTickets(prev => prev.filter(t => t.id !== target.id));
      setSelectedResolvedIds(prev => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      addLog(
        actorLabel,
        'MAINTENANCE_TICKET_DELETE',
        `Xóa bản ghi phiếu bảo trì ${target.ticket_code} (${target.day} - ${formatRoomDisplay(target.phong_so)} · ${getTicketCategoryShortLabel(target.category)} · trạng thái: ${target.status})`
      );
      toast.success(`Đã xóa bản ghi ${target.ticket_code}`);
      setDeletingTicket(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể xóa bản ghi này.');
    } finally {
      setBusyTicketId(null);
    }
  };

  const targetBulkDeleteIds = useMemo(() => {
    if (selectedResolvedIds.size > 0) return Array.from(selectedResolvedIds);
    return deletableResolvedVisible.map(t => t.id);
  }, [selectedResolvedIds, deletableResolvedVisible]);

  const handleConfirmBulkDeleteResolved = async () => {
    if (targetBulkDeleteIds.length === 0) return;
    setBulkDeleting(true);
    try {
      const count = await bulkDeleteResolvedTickets(targetBulkDeleteIds);
      const removedSet = new Set(targetBulkDeleteIds);
      setTickets(prev => prev.filter(t => !removedSet.has(t.id)));
      setSelectedResolvedIds(new Set());
      addLog(
        actorLabel,
        'MAINTENANCE_TICKET_DELETE',
        `Dọn xóa hàng loạt ${count} phiếu bảo trì đã hoàn thành`
      );
      toast.success(`Đã xóa gọn ${count} bản ghi bảo trì đã hoàn thành.`);
      setShowBulkDeleteConfirm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể xóa hàng loạt phiếu đã hoàn thành.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleCreateInternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createKtx || !createDay || !createRoom) {
      toast.error('Vui lòng chọn đầy đủ KTX, Dãy và Phòng.');
      return;
    }
    if (!isAdmin && !canAccessMaintenanceBlock(createDay, createKtx)) {
      toast.error('Bạn chỉ có thể tạo phiếu cho dãy thuộc phạm vi phụ trách.');
      return;
    }
    setCreating(true);
    try {
      const created = await createInternalMaintenanceTicket({
        ktx: createKtx,
        day: createDay,
        phong_so: createRoom,
        category: createCategory,
        priority: createPriority,
        description: createDesc,
        reporter_name: actorLabel,
        reporter_phone: createReporterPhone,
      });
      setTickets(prev => [created, ...prev]);
      addLog(
        actorLabel,
        'MAINTENANCE_TICKET_CREATE',
        `Tạo phiếu bảo trì ${created.ticket_code} tại ${created.day} - ${formatRoomDisplay(created.phong_so)} (${getTicketCategoryShortLabel(created.category)}): ${created.description}`
      );
      toast.success(`Đã tạo phiếu ${created.ticket_code}`);
      setCreateDesc('');
      setCreateReporterPhone('');
      setCreatePriority('normal');
      setShowCreateModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể tạo phiếu báo hỏng.');
    } finally {
      setCreating(false);
    }
  };

  const handleResolveInfraRow = async (row: (typeof infraRows)[number]) => {
    if (!canOperateMaintenance || (!isAdmin && !canAccessMaintenanceBlock(row.day, row.ktx))) {
      toast.error('Bạn không có quyền xử lý bảo trì cho dãy này.');
      return;
    }
    setResolvingInfraUid(row.uid);
    try {
      if (row.kind === 'facility') {
        const { error } = await supabase.from('facilities').update({ ghi_chu: '' }).eq('id', row.recordId);
        if (error) throw error;
        invalidateFacilitiesCache();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
        addLog(
          actorLabel,
          'FACILITY_UPDATE',
          `Khắc phục sự cố CSVC tại ${row.ktx} - ${row.day} - ${formatRoomDisplay(row.room)} (trước đó: ${row.description})`
        );
        toast.success(`Đã đánh dấu khắc phục sự cố tại ${row.day} · ${formatRoomDisplay(row.room)}`);
      } else {
        const { error } = await supabase
          .from('beds')
          .update({ status: 'empty', worker_id: null, ma_nv: null, ho_va_ten: null })
          .eq('id', row.recordId);
        if (error) throw error;
        addLog(
          actorLabel,
          'UPDATE',
          `Hoàn tất bảo trì giường ${row.bedLabel} tại ${row.ktx} - ${row.day} - ${formatRoomDisplay(row.room)}`
        );
        toast.success(`Đã mở lại Giường ${row.bedLabel} (${row.day} · ${formatRoomDisplay(row.room)})`);
      }
      await loadAll(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể cập nhật khắc phục.');
    } finally {
      setResolvingInfraUid(null);
    }
  };

  const handleExportExcel = () => {
    const rows = filteredTickets.map((t, idx) => ({
      STT: idx + 1,
      'Mã phiếu': t.ticket_code,
      'Khu KTX': t.ktx,
      Dãy: t.day,
      Phòng: formatRoomDisplay(t.phong_so),
      'Hạng mục': getTicketCategoryLabel(t.category),
      'Ưu tiên': t.priority === 'urgent' ? 'Khẩn cấp' : 'Bình thường',
      'Mô tả sự cố': t.description,
      'Người báo': t.reporter_name || (t.source === 'qr' ? 'Công nhân (QR)' : ''),
      'SĐT liên hệ': t.reporter_phone || '',
      'Trạng thái':
        t.status === 'open' ? 'Mới báo' : t.status === 'in_progress' ? 'Đang sửa' : 'Đã xử lý',
      'Kỹ thuật tiếp nhận': t.assigned_to_name || '',
      'Người hoàn thành': t.resolved_by_name || '',
      'Ghi chú xử lý': t.resolution_note || '',
      'Thời gian báo': formatVnDateTime(t.created_at),
      'Thời gian xong': formatVnDateTime(t.resolved_at),
    }));
    exportToExcel(rows, 'Bao_cao_bao_tri_KTX', 'PhieuBaoTri');
    toast.success(`Đã xuất ${rows.length} phiếu bảo trì ra file Excel.`);
  };

  const qrOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const generatedQrUrl = useMemo(
    () => buildRoomIssueQrUrl(qrOrigin, qrKtx, qrDay, qrRoom),
    [qrOrigin, qrKtx, qrDay, qrRoom]
  );

  const handlePrintDoorPoster = async () => {
    if (!qrKtx || !qrDay || !qrRoom) {
      toast.error('Vui lòng chọn KTX, Dãy và Phòng cần in mã QR.');
      return;
    }
    setPrintingPoster(true);
    try {
      const ok = await printQrBulletinPoster({
        url: generatedQrUrl,
        paperSize: posterPaperSize,
        badgeText: 'KỸ THUẬT & BẢO TRÌ KTX',
        title: `QUÉT QR BÁO HỎNG — ${qrDay.toUpperCase()} · ${formatRoomDisplay(qrRoom).toUpperCase()}`,
        subtitle: 'Điều hòa · Quạt · Đèn điện · Nước · Giường tủ · Khóa cửa',
        accentHex: '#b45309',
        steps: [
          { title: 'Mở Zalo hoặc Camera điện thoại', detail: 'Quét mã QR dán trên cửa phòng này.' },
          { title: 'Chọn thiết bị bị hỏng', detail: 'Phòng của bạn đã tự động điền sẵn, không cần đăng nhập.' },
          { title: 'Nhấn Gửi báo hỏng', detail: 'Tổ Kỹ thuật KTX sẽ nhận thông báo ngay và đến kiểm tra.' },
        ],
        footerNote: `${qrKtx} — ${qrDay} — ${formatRoomDisplay(qrRoom)} · Hỗ trợ kỹ thuật 24/7`,
        metaLine: generatedQrUrl,
      });
      if (!ok) toast.error('Không thể tạo bản in poster QR.');
    } finally {
      setPrintingPoster(false);
    }
  };

  const allRoomsInQrKtx = useMemo<BatchRoomQrItem[]>(() => {
    if (!qrKtx) return [];
    const seen = new Set<string>();
    const list: BatchRoomQrItem[] = [];
    const days = getDaysForKtx(qrKtx);
    for (const d of days) {
      const rooms = getRoomsForKtxDay(qrKtx, d);
      for (const r of rooms) {
        const key = `${qrKtx}||${d}||${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          ktx: qrKtx,
          day: d,
          roomLabel: formatRoomDisplay(r),
          url: buildRoomIssueQrUrl(qrOrigin, qrKtx, d, r),
        });
      }
    }
    return list;
  }, [qrKtx, qrOrigin, getDaysForKtx, getRoomsForKtxDay]);

  const handlePrintBatchQr = async (scope: 'day' | 'ktx') => {
    const items: BatchRoomQrItem[] =
      scope === 'day'
        ? qrRooms.map(r => ({
            ktx: qrKtx,
            day: qrDay,
            roomLabel: formatRoomDisplay(r),
            url: buildRoomIssueQrUrl(qrOrigin, qrKtx, qrDay, r),
          }))
        : allRoomsInQrKtx;

    if (items.length === 0) {
      toast.error('Không có danh sách phòng để in tem QR hàng loạt.');
      return;
    }

    setPrintingBatch(true);
    try {
      const title =
        scope === 'day'
          ? `TEM QR BÁO HỎNG CỬA PHÒNG — ${qrKtx} · ${qrDay} (${items.length} phòng)`
          : `TEM QR BÁO HỎNG CỬA PHÒNG — TOÀN BỘ ${qrKtx} (${items.length} phòng)`;
      const ok = await printBatchRoomIssueQrStickers(items, title);
      if (ok) {
        toast.success(`Đã mở bản in A4 gồm ${items.length} tem QR (${Math.ceil(items.length / 6)} trang).`);
      } else {
        toast.error('Không thể tạo bản in tem QR hàng loạt.');
      }
    } finally {
      setPrintingBatch(false);
    }
  };

  const toggleSelectResolved = (id: string) => {
    setSelectedResolvedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleResolvedSelected =
    deletableResolvedVisible.length > 0 &&
    deletableResolvedVisible.every(t => selectedResolvedIds.has(t.id));

  const toggleSelectAllVisibleResolved = () => {
    if (allVisibleResolvedSelected) {
      setSelectedResolvedIds(new Set());
    } else {
      setSelectedResolvedIds(new Set(deletableResolvedVisible.map(t => t.id)));
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/35 text-amber-500 flex items-center justify-center shrink-0">
            <Wrench size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">
                Trung Tâm Kỹ Thuật & Bảo Trì
              </h1>
              {isTechnician && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/35">
                  <ShieldCheck size={12} />
                  Kỹ thuật viên
                  {currentUser?.assignedBlocks?.length
                    ? ` · ${currentUser.assignedBlocks.length} dãy phụ trách`
                    : ' · Toàn khu KTX'}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-mu mt-0.5">
              Tiếp nhận phiếu báo hỏng từ QR cửa phòng, theo dõi sửa chữa thiết bị & đồng bộ trực tiếp lên Bản đồ 3D KTX.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateMaintenanceTicket && !tableMissing && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-pri hover:bg-pri2 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer"
            >
              <Plus size={16} />
              <span>Tạo phiếu mới</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAnalytics(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              showAnalytics
                ? 'bg-bdg text-lnk border-pri2/50'
                : 'bg-surf hover:bg-act text-tx border-bdr2'
            }`}
          >
            <BarChart3 size={16} className="text-lnk" />
            <span>Thống kê SLA</span>
          </button>
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surf hover:bg-act text-tx border border-bdr2 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            <QrCode size={16} className="text-amber-500" />
            <span>QR cửa phòng</span>
          </button>
          <Link
            href="/ktx-3d?mode=maintenance"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surf hover:bg-act text-tx border border-bdr2 text-xs sm:text-sm font-bold transition-colors"
          >
            <Box size={16} className="text-lnk" />
            <span>Bản đồ 3D Bảo trì</span>
          </Link>
          {!tableMissing && filteredTickets.length > 0 && (
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surf hover:bg-act text-tx border border-bdr2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              <FileSpreadsheet size={15} className="text-ok" />
              <span className="hidden sm:inline">Xuất Excel</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadAll(true)}
            disabled={refreshing}
            className="p-2 rounded-xl bg-surf hover:bg-act text-nav hover:text-tx border border-bdr2 transition-colors cursor-pointer disabled:opacity-50"
            title="Làm mới dữ liệu"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin text-pri2' : ''} />
          </button>
        </div>
      </div>

      {/* Setup Banner if table is not migrated yet */}
      {tableMissing && (
        <div className="rounded-2xl bg-surf border border-wn/40 p-5 space-y-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl tint-wn text-wn border border-wn/35 flex items-center justify-center shrink-0">
              <Database size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-tx">
                Cần chạy SQL khởi tạo bảng Phiếu Bảo Trì & Quyền Kỹ Thuật Viên (1 lần duy nhất)
              </h2>
              <p className="text-xs sm:text-sm text-mu mt-1 leading-relaxed">
                Cơ sở dữ liệu Supabase hiện chưa có bảng phiếu báo hỏng mới.{' '}
                {isAdmin
                  ? 'Hãy sao chép đoạn SQL bên dưới và dán chạy trong Supabase SQL Editor, sau đó bấm Làm mới.'
                  : 'Vui lòng báo Quản trị viên chạy lệnh khởi tạo trên Supabase.'}
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(MAINTENANCE_SETUP_SQL);
                    toast.success('Đã sao chép SQL khởi tạo! Hãy dán và chạy trong Supabase SQL Editor.');
                  } catch {
                    toast.error('Không thể tự động sao chép.');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold cursor-pointer"
              >
                <Copy size={14} />
                <span>Sao chép SQL khởi tạo</span>
              </button>
              <button
                type="button"
                onClick={() => void loadAll(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-act hover:bg-bdg text-tx border border-bdr2 text-xs font-bold cursor-pointer"
              >
                <RefreshCw size={14} />
                <span>Kiểm tra lại</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Staff Read/Create Notice */}
      {isStaff && !tableMissing && (
        <div className="rounded-xl bg-act/80 border border-bdr2 px-4 py-2.5 text-xs text-mu flex items-center gap-2">
          <ShieldCheck size={15} className="text-lnk shrink-0" />
          <span>
            <strong className="text-tx">Quyền Chuyên viên:</strong> Bạn có thể tạo phiếu báo hỏng hộ công nhân và theo dõi tiến độ; thao tác tiếp nhận, hoàn thành và xóa bản ghi thuộc quyền Kỹ thuật viên & Quản trị viên.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => {
            setActiveTab('tickets');
            setStatusFilter('open');
          }}
          className="rounded-2xl bg-surf border border-bdr2 hover:border-wn/50 p-4 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mu">Mới báo (Chờ xử lý)</span>
            <Clock size={16} className="text-wn" />
          </div>
          <p className="text-2xl font-extrabold text-tx font-tabular mt-1.5">{kpis.open}</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('tickets');
            setStatusFilter('in_progress');
          }}
          className="rounded-2xl bg-surf border border-bdr2 hover:border-pri2/60 p-4 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mu">Đang sửa chữa</span>
            <Wrench size={16} className="text-lnk" />
          </div>
          <p className="text-2xl font-extrabold text-tx font-tabular mt-1.5">{kpis.inProgress}</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('tickets');
            setStatusFilter('active');
          }}
          className="rounded-2xl bg-surf border border-bdr2 hover:border-dgr/50 p-4 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mu">Khẩn cấp chưa xong</span>
            <AlertTriangle size={16} className="text-dgr" />
          </div>
          <p className={`text-2xl font-extrabold font-tabular mt-1.5 ${kpis.urgentActive > 0 ? 'text-dgr' : 'text-tx'}`}>
            {kpis.urgentActive}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('tickets');
            setStatusFilter('overdue');
          }}
          className={`rounded-2xl bg-surf border p-4 text-left transition-colors cursor-pointer ${
            kpis.slaOverdue > 0
              ? 'border-dgr/50 hover:border-dgr'
              : 'border-bdr2 hover:border-bdr'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mu">Quá hạn SLA</span>
            <Timer size={16} className={kpis.slaOverdue > 0 ? 'text-dgr' : 'text-mu'} />
          </div>
          <p className={`text-2xl font-extrabold font-tabular mt-1.5 ${kpis.slaOverdue > 0 ? 'text-dgr' : 'text-tx'}`}>
            {kpis.slaOverdue}
          </p>
          <p className="text-[10.5px] text-mu mt-0.5">Khẩn &gt; 2g · Thường &gt; 24g</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('tickets');
            setStatusFilter('resolved');
          }}
          className="rounded-2xl bg-surf border border-bdr2 hover:border-ok2/50 p-4 text-left transition-colors cursor-pointer col-span-2 md:col-span-1"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mu">Đã hoàn thành</span>
            <CheckCircle2 size={16} className="text-ok" />
          </div>
          <p className="text-2xl font-extrabold text-ok font-tabular mt-1.5">{kpis.resolved}</p>
          {analytics.avgResolveMinutes !== null && (
            <p className="text-[10.5px] text-mu mt-0.5 font-tabular">
              TB xử lý: {formatDurationVi(analytics.avgResolveMinutes)}
            </p>
          )}
        </button>
      </div>

      {/* Collapsible Maintenance & SLA Analytics Panel */}
      {showAnalytics && !tableMissing && (
        <section className="rounded-2xl bg-surf border border-bdr2 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bdr pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={17} className="text-lnk" />
              <div>
                <h2 className="text-sm font-bold text-tx">Thống kê Thiết bị hay hỏng & Hiệu suất SLA</h2>
                <p className="text-[11px] text-mu">
                  Định mức SLA chuẩn: Khẩn cấp ≤ 2 giờ · Bình thường ≤ 24 giờ · Tổng hợp từ {analytics.totalTickets} phiếu trong phạm vi
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-page border border-bdr font-tabular">
                TB xử lý:{' '}
                <strong className="text-tx">
                  {analytics.avgResolveMinutes !== null ? formatDurationVi(analytics.avgResolveMinutes) : 'Chưa có dữ liệu'}
                </strong>
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-page border border-bdr font-tabular">
                Đạt chuẩn SLA:{' '}
                <strong className={analytics.slaCompliancePct !== null && analytics.slaCompliancePct >= 85 ? 'text-ok' : 'text-wn'}>
                  {analytics.slaCompliancePct !== null ? `${analytics.slaCompliancePct}%` : '—'}
                </strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Top Categories */}
            <div className="rounded-xl bg-page border border-bdr p-3.5 space-y-2.5">
              <p className="text-xs font-bold text-tx">Hạng mục phát sinh nhiều nhất</p>
              {analytics.topCategories.length === 0 ? (
                <p className="text-xs text-mu">Chưa có dữ liệu phiếu bảo trì.</p>
              ) : (
                <div className="space-y-2">
                  {analytics.topCategories.slice(0, 5).map(cat => (
                    <div key={cat.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-tx">{cat.label}</span>
                        <span className="text-mu font-tabular">
                          {cat.count} phiếu ({cat.pct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-act overflow-hidden">
                        <div
                          className="h-full rounded-full bg-pri2"
                          style={{ width: `${Math.max(6, cat.pct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Rooms */}
            <div className="rounded-xl bg-page border border-bdr p-3.5 space-y-2.5">
              <p className="text-xs font-bold text-tx">Top phòng báo hỏng nhiều nhất</p>
              {analytics.topRooms.length === 0 ? (
                <p className="text-xs text-mu">Chưa có dữ liệu.</p>
              ) : (
                <div className="divide-y divide-bdr">
                  {analytics.topRooms.map((r, idx) => (
                    <div
                      key={`${r.ktx}-${r.day}-${r.phong_so}`}
                      className="py-1.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-tx font-semibold truncate">
                        {idx + 1}. {r.day} · {formatRoomDisplay(r.phong_so)}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-act border border-bdr font-bold text-lnk font-tabular shrink-0">
                        {r.count} lượt
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Days */}
            <div className="rounded-xl bg-page border border-bdr p-3.5 space-y-2.5">
              <p className="text-xs font-bold text-tx">Phân bổ sự cố theo Dãy nhà</p>
              {analytics.topDays.length === 0 ? (
                <p className="text-xs text-mu">Chưa có dữ liệu.</p>
              ) : (
                <div className="divide-y divide-bdr">
                  {analytics.topDays.map((d, idx) => (
                    <div key={d.day} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                      <span className="text-tx font-semibold truncate">
                        {idx + 1}. {d.day}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-act border border-bdr font-bold text-tx font-tabular shrink-0">
                        {d.count} phiếu
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Main Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bdr pb-2">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-act border border-bdr2">
          <button
            type="button"
            onClick={() => setActiveTab('tickets')}
            className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'tickets' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
            }`}
          >
            <Wrench size={15} />
            <span>Phiếu báo hỏng QR ({scopedTickets.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('facilities_beds')}
            className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'facilities_beds' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
            }`}
          >
            <BedDouble size={15} />
            <span>Giường & Ghi chú CSVC ({infraRows.length})</span>
          </button>
        </div>

        {/* Bulk Cleanup Action for Completed Tickets */}
        {activeTab === 'tickets' && canDeleteResolvedTicket && deletableResolvedVisible.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAllVisibleResolved}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs font-semibold text-tx cursor-pointer"
            >
              {allVisibleResolvedSelected ? <CheckSquare size={14} className="text-lnk" /> : <Square size={14} className="text-mu" />}
              <span>
                {allVisibleResolvedSelected
                  ? `Bỏ chọn (${selectedResolvedIds.size})`
                  : `Chọn phiếu đã xong (${deletableResolvedVisible.length})`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-dgrbg hover:opacity-90 border border-dgr/35 text-xs font-bold text-dgr cursor-pointer"
            >
              <Trash2 size={14} />
              <span>
                {selectedResolvedIds.size > 0
                  ? `Xóa ${selectedResolvedIds.size} phiếu đã chọn`
                  : `Dọn xóa ${deletableResolvedVisible.length} phiếu đã xong`}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: MAINTENANCE TICKETS */}
      {activeTab === 'tickets' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="rounded-2xl bg-surf border border-bdr2 p-3.5 flex flex-wrap items-center gap-2.5">
            <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-page border border-bdr">
              {(
                [
                  { id: 'active', label: `Chưa xong (${kpis.active})` },
                  { id: 'overdue', label: `Quá hạn SLA (${kpis.slaOverdue})` },
                  { id: 'open', label: `Mới báo (${kpis.open})` },
                  { id: 'in_progress', label: `Đang sửa (${kpis.inProgress})` },
                  { id: 'resolved', label: `Đã xong (${kpis.resolved})` },
                  { id: 'all', label: `Tất cả (${scopedTickets.length})` },
                ] as const
              ).map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    statusFilter === f.id
                      ? f.id === 'overdue' && kpis.slaOverdue > 0
                        ? 'bg-dgrbg text-dgr border border-dgr/40 shadow-sm'
                        : 'bg-act text-tx shadow-sm border border-bdr2'
                      : f.id === 'overdue' && kpis.slaOverdue > 0
                      ? 'text-dgr hover:bg-dgrbg/50'
                      : 'text-mu hover:text-tx'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-page border border-bdr text-xs text-tx focus:outline-none focus:border-pri2"
            >
              <option value="all">Tất cả hạng mục</option>
              {TICKET_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_META[c].shortLabel}
                </option>
              ))}
            </select>

            <select
              value={dayFilter}
              onChange={e => setDayFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-page border border-bdr text-xs text-tx focus:outline-none focus:border-pri2"
            >
              <option value="all">Tất cả dãy</option>
              {filterDays.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm mã phiếu, phòng, mô tả, kỹ thuật viên..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-page border border-bdr text-xs sm:text-sm text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
              />
            </div>
          </div>

          {/* Ticket List */}
          {loading ? (
            <div className="rounded-2xl bg-surf border border-bdr2 p-12 flex flex-col items-center gap-3 text-mu">
              <Loader2 size={26} className="animate-spin text-lnk" />
              <p className="text-xs font-medium">Đang tải danh sách phiếu bảo trì...</p>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="rounded-2xl bg-surf border border-bdr2 p-12 text-center space-y-2">
              <CheckCircle2 size={36} className="mx-auto text-ok" />
              <p className="text-sm sm:text-base font-bold text-tx">Không có phiếu báo hỏng nào trong mục này</p>
              <p className="text-xs text-mu">
                {statusFilter === 'active'
                  ? 'Tất cả sự cố đã được xử lý gọn gàng. Bạn có thể in mã QR cửa phòng hoặc chuyển sang tab Đã xong để xem lịch sử.'
                  : 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredTickets.map(ticket => {
                const isBusy = busyTicketId === ticket.id;
                const canOp = canOperateTicket(ticket);
                const canDel = canDeleteSingleTicket(ticket);
                const isSelectedResolved = selectedResolvedIds.has(ticket.id);
                const sla = getTicketSlaStatus(ticket, nowTick);
                const href3D = `/ktx-3d?mode=maintenance&ktx=${encodeURIComponent(ticket.ktx)}&day=${encodeURIComponent(ticket.day)}&room=${encodeURIComponent(normalizeRoomLabel(ticket.phong_so))}`;

                return (
                  <div
                    key={ticket.id}
                    className={`rounded-2xl bg-surf border p-4 transition-colors ${
                      sla.state === 'overdue' || (ticket.priority === 'urgent' && ticket.status !== 'resolved')
                        ? 'border-dgr/50'
                        : isSelectedResolved
                        ? 'border-pri2 bg-act/40'
                        : 'border-bdr2'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3.5">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {canDeleteResolvedTicket && ticket.status === 'resolved' && canDel && (
                          <button
                            type="button"
                            onClick={() => toggleSelectResolved(ticket.id)}
                            className="mt-0.5 text-mu hover:text-lnk cursor-pointer shrink-0"
                            title="Chọn để xóa hàng loạt"
                          >
                            {isSelectedResolved ? (
                              <CheckSquare size={18} className="text-lnk" />
                            ) : (
                              <Square size={18} />
                            )}
                          </button>
                        )}

                        <div className="min-w-0 flex-1 space-y-2">
                          {/* Top Meta Row */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-act border border-bdr2 text-lnk">
                              {ticket.ticket_code}
                            </span>

                            <span className="text-xs sm:text-sm font-extrabold text-tx">
                              {ticket.day} · {formatRoomDisplay(ticket.phong_so)}
                            </span>

                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-page border border-bdr text-tx">
                              {getTicketCategoryShortLabel(ticket.category)}
                            </span>

                            {ticket.priority === 'urgent' && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-dgrbg text-dgr border border-dgr/35">
                                <AlertTriangle size={11} />
                                Khẩn cấp
                              </span>
                            )}

                            {ticket.status === 'open' && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md tint-wn text-wn border border-wn/35">
                                Mới báo
                              </span>
                            )}
                            {ticket.status === 'in_progress' && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-pri/15 text-lnk border border-pri2/35">
                                Đang sửa chữa
                              </span>
                            )}
                            {ticket.status === 'resolved' && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-okbg text-ok border border-ok2/35">
                                Đã hoàn thành
                              </span>
                            )}

                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md font-tabular border ${
                                sla.state === 'overdue'
                                  ? 'bg-dgrbg text-dgr border-dgr/40'
                                  : sla.state === 'warning'
                                  ? 'tint-wn text-wn border-wn/40'
                                  : sla.state === 'resolved'
                                  ? 'bg-page text-mu border-bdr'
                                  : 'bg-page text-mu border-bdr'
                              }`}
                            >
                              <Timer size={11} />
                              {sla.label}
                            </span>

                            <span className="text-[11px] text-mu ml-auto sm:ml-0">
                              {ticket.source === 'qr' ? 'Quét QR cửa phòng' : 'Tạo nội bộ'} · {formatVnDateTime(ticket.created_at)}
                            </span>
                          </div>

                          {/* Description */}
                          <p className="text-xs sm:text-sm text-tx leading-relaxed break-words">
                            {ticket.description}
                          </p>

                          {/* Reporter & Assignee Metadata */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs text-mu">
                            {ticket.reporter_name && (
                              <span className="inline-flex items-center gap-1">
                                <User size={12} />
                                Người báo: <strong className="text-tx">{ticket.reporter_name}</strong>
                              </span>
                            )}
                            {ticket.reporter_phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone size={12} />
                                SĐT: <strong className="text-tx font-tabular">{ticket.reporter_phone}</strong>
                              </span>
                            )}
                            {ticket.assigned_to_name && (
                              <span>
                                Tiếp nhận: <strong className="text-tx">{ticket.assigned_to_name}</strong>
                                {ticket.started_at ? ` (${formatVnDateTime(ticket.started_at)})` : ''}
                              </span>
                            )}
                            {ticket.status === 'resolved' && ticket.resolved_by_name && (
                              <span className="text-ok">
                                Hoàn thành bởi <strong>{ticket.resolved_by_name}</strong> lúc {formatVnDateTime(ticket.resolved_at)}
                              </span>
                            )}
                          </div>

                          {/* Resolution Note */}
                          {ticket.status === 'resolved' && ticket.resolution_note && (
                            <div className="rounded-xl bg-okbg/60 border border-ok2/25 px-3 py-2 text-xs text-tx">
                              <span className="font-bold text-ok">Kết quả xử lý: </span>
                              <span>{ticket.resolution_note}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Link
                          href={href3D}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-act hover:bg-bdg border border-bdr text-xs font-semibold text-tx transition-colors"
                          title="Định vị phòng trên Bản đồ 3D"
                        >
                          <Box size={13} className="text-lnk" />
                          <span>3D</span>
                        </Link>

                        {canOp && ticket.status === 'open' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleAccept(ticket)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pri hover:bg-pri2 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                          >
                            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                            <span>Tiếp nhận</span>
                          </button>
                        )}

                        {canOp && ticket.status !== 'resolved' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setResolvingTicket(ticket);
                              setResolutionNote('');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-okbg hover:opacity-90 text-ok border border-ok2/35 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                          >
                            <CheckCircle2 size={13} />
                            <span>Hoàn thành</span>
                          </button>
                        )}

                        {canOp && ticket.status === 'resolved' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReopen(ticket)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-act hover:bg-bdg text-tx border border-bdr text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
                          >
                            <RotateCcw size={13} />
                            <span>Mở lại</span>
                          </button>
                        )}

                        {canDel && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setDeletingTicket(ticket)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-dgrbg hover:opacity-90 text-dgr border border-dgr/35 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
                            title={
                              isTechnician
                                ? 'Xóa bản ghi đã hoàn thành để dọn gọn danh sách'
                                : 'Xóa phiếu bảo trì'
                            }
                          >
                            <Trash2 size={13} />
                            <span>Xóa</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FACILITIES & MAINTENANCE BEDS */}
      {activeTab === 'facilities_beds' && (
        <div className="rounded-2xl bg-surf border border-bdr2 overflow-hidden">
          {infraRows.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <CheckCircle2 size={36} className="mx-auto text-ok" />
              <p className="text-sm font-bold text-tx">Không có giường bảo trì hoặc ghi chú CSVC tồn đọng</p>
              <p className="text-xs text-mu">
                Các giường đang khóa bảo trì hoặc phòng có ghi chú hỏng thiết bị sẽ tự động hiển thị tại đây.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-bdr">
              {infraRows.map(row => {
                const isBusy = resolvingInfraUid === row.uid;
                const href3D = `/ktx-3d?mode=maintenance&ktx=${encodeURIComponent(row.ktx)}&day=${encodeURIComponent(row.day)}&room=${encodeURIComponent(row.room)}`;
                return (
                  <div
                    key={row.uid}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-tx">
                        {row.kind === 'facility' ? (
                          <Building2 size={15} className="text-wn shrink-0" />
                        ) : (
                          <BedDouble size={15} className="text-dgr shrink-0" />
                        )}
                        <span>
                          {row.day} · {formatRoomDisplay(row.room)}
                          {row.bedLabel ? ` · Giường ${row.bedLabel}` : ''}
                        </span>
                        <span className="text-[11px] font-medium text-mu">
                          · {row.kind === 'facility' ? 'Ghi chú CSVC phòng' : 'Giường đang bảo trì'}
                        </span>
                      </div>
                      <p className="text-xs text-mu break-words">{row.description}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={href3D}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-act hover:bg-bdg border border-bdr text-xs font-semibold text-tx"
                      >
                        <Box size={13} className="text-lnk" />
                        <span>Mở 3D</span>
                      </Link>
                      {canOperateMaintenance && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleResolveInfraRow(row)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-okbg hover:opacity-90 text-ok border border-ok2/35 text-xs font-bold cursor-pointer disabled:opacity-60"
                        >
                          {isBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                          <span>Đã khắc phục</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: RESOLVE TICKET */}
      {resolvingTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4"
          onClick={() => setResolvingTicket(null)}
        >
          <form
            onSubmit={handleConfirmResolve}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-bdr flex items-center justify-between bg-side">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-tx">Xác nhận hoàn thành sửa chữa</h3>
                <p className="text-xs text-mu mt-0.5">
                  {resolvingTicket.ticket_code} · {resolvingTicket.day} · {formatRoomDisplay(resolvingTicket.phong_so)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResolvingTicket(null)}
                className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded-xl bg-page border border-bdr p-3 text-xs text-mu">
                <strong className="text-tx">Nội dung báo hỏng: </strong>
                {resolvingTicket.description}
              </div>
              <div>
                <label className="text-xs font-semibold text-tx block mb-1.5">
                  Ghi chú kết quả xử lý / vật tư đã thay (không bắt buộc)
                </label>
                <textarea
                  rows={3}
                  maxLength={600}
                  value={resolutionNote}
                  onChange={e => setResolutionNote(e.target.value)}
                  placeholder="VD: Đã thay tụ quạt và vệ sinh cánh quạt, thiết bị hoạt động ổn định."
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm text-tx placeholder:text-mu focus:outline-none focus:border-pri2 resize-none"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-bdr bg-side/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setResolvingTicket(null)}
                className="px-3.5 py-2 rounded-xl bg-act text-tx text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busyTicketId === resolvingTicket.id}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-ok text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {busyTicketId === resolvingTicket.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>Hoàn thành phiếu</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: CONFIRM SINGLE DELETE */}
      {deletingTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4"
          onClick={() => setDeletingTicket(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surf border border-dgr/40 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-bdr flex items-center gap-3 bg-dgrbg/40">
              <div className="w-9 h-9 rounded-xl bg-dgrbg text-dgr border border-dgr/35 flex items-center justify-center shrink-0">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-tx">Xóa bản ghi phiếu bảo trì?</h3>
                <p className="text-xs text-mu">
                  {deletingTicket.ticket_code} · {deletingTicket.day} · {formatRoomDisplay(deletingTicket.phong_so)}
                </p>
              </div>
            </div>
            <div className="p-5 text-xs sm:text-sm text-mu space-y-2">
              <p>
                Bản ghi này sẽ bị xóa vĩnh viễn khỏi danh sách bảo trì để giúp bảng theo dõi gọn gàng hơn. Thao tác xóa vẫn được lưu vết trong Nhật ký hệ thống.
              </p>
              <div className="rounded-xl bg-page border border-bdr p-3 text-xs text-tx">
                {deletingTicket.description}
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-bdr bg-side/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingTicket(null)}
                className="px-3.5 py-2 rounded-xl bg-act text-tx text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busyTicketId === deletingTicket.id}
                onClick={() => void handleConfirmDeleteSingle()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-dgr text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {busyTicketId === deletingTicket.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Xác nhận xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CONFIRM BULK DELETE RESOLVED */}
      {showBulkDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4"
          onClick={() => setShowBulkDeleteConfirm(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surf border border-dgr/40 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-bdr flex items-center gap-3 bg-dgrbg/40">
              <div className="w-9 h-9 rounded-xl bg-dgrbg text-dgr border border-dgr/35 flex items-center justify-center shrink-0">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-tx">Dọn xóa hàng loạt phiếu đã xử lý?</h3>
                <p className="text-xs text-mu">Số lượng sẽ xóa: {targetBulkDeleteIds.length} phiếu đã hoàn thành</p>
              </div>
            </div>
            <div className="p-5 text-xs sm:text-sm text-mu leading-relaxed">
              Chỉ các phiếu có trạng thái <strong className="text-ok">Đã hoàn thành</strong> mới bị xóa. Các phiếu đang mở hoặc đang sửa chữa hoàn toàn không bị ảnh hưởng.
            </div>
            <div className="px-5 py-3.5 border-t border-bdr bg-side/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-3.5 py-2 rounded-xl bg-act text-tx text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => void handleConfirmBulkDeleteResolved()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-dgr text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {bulkDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Xóa {targetBulkDeleteIds.length} phiếu</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CREATE INTERNAL TICKET */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <form
            onSubmit={handleCreateInternal}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-tx">Tạo phiếu báo hỏng nội bộ</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Khu KTX</label>
                  <select
                    value={createKtx}
                    onChange={e => {
                      setCreateKtx(e.target.value);
                      setCreateDay('');
                      setCreateRoom('');
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm text-tx"
                    required
                  >
                    {ktxOptions.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Dãy</label>
                  <select
                    value={createDay}
                    onChange={e => {
                      setCreateDay(e.target.value);
                      setCreateRoom('');
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm text-tx"
                    required
                  >
                    {createDays.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Phòng</label>
                  <select
                    value={createRoom}
                    onChange={e => setCreateRoom(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm text-tx"
                    required
                  >
                    {createRooms.map(r => (
                      <option key={r} value={r}>
                        {formatRoomDisplay(r)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Hạng mục thiết bị</label>
                  <select
                    value={createCategory}
                    onChange={e => setCreateCategory(e.target.value as TicketCategory)}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm text-tx"
                  >
                    {TICKET_CATEGORIES.map(c => (
                      <option key={c} value={c}>
                        {TICKET_CATEGORY_META[c].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Mức độ ưu tiên</label>
                  <select
                    value={createPriority}
                    onChange={e => setCreatePriority(e.target.value as TicketPriority)}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs sm:text-sm text-tx"
                  >
                    <option value="normal">Bình thường</option>
                    <option value="urgent">Khẩn cấp</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-mu block mb-1">
                  Mô tả sự cố <span className="text-dgr">*</span>
                </label>
                <textarea
                  rows={3}
                  maxLength={600}
                  value={createDesc}
                  onChange={e => setCreateDesc(e.target.value)}
                  placeholder="Mô tả chi tiết hỏng hóc cần kiểm tra..."
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm text-tx placeholder:text-mu resize-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-mu block mb-1">
                  SĐT liên hệ tại phòng (không bắt buộc)
                </label>
                <input
                  type="tel"
                  maxLength={30}
                  value={createReporterPhone}
                  onChange={e => setCreateReporterPhone(e.target.value)}
                  placeholder="VD: 09xx..."
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm text-tx"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-bdr bg-side/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-2 rounded-xl bg-act text-tx text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>Tạo phiếu</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 5: ROOM ISSUE QR GENERATOR */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <QrCode size={18} className="text-amber-500" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-tx">Mã QR Báo Hỏng Dán Cửa Phòng</h3>
                  <p className="text-[11px] text-mu">Công nhân quét mã → tự điền sẵn số phòng, gửi báo hỏng 10 giây</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Khu KTX</label>
                  <select
                    value={qrKtx}
                    onChange={e => {
                      setQrKtx(e.target.value);
                      setQrDay('');
                      setQrRoom('');
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs text-tx"
                  >
                    {ktxOptions.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Dãy</label>
                  <select
                    value={qrDay}
                    onChange={e => {
                      setQrDay(e.target.value);
                      setQrRoom('');
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs text-tx"
                  >
                    {qrDays.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Phòng</label>
                  <select
                    value={qrRoom}
                    onChange={e => setQrRoom(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs text-tx"
                  >
                    {qrRooms.map(r => (
                      <option key={r} value={r}>
                        {formatRoomDisplay(r)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col items-center gap-3 rounded-2xl bg-page border border-bdr p-4">
                <div className="bg-white p-3 rounded-xl shadow-sm">
                  <QrCodeImage value={generatedQrUrl} size={184} className="w-44 h-44 object-contain" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-extrabold text-tx">
                    {qrDay || '—'} · {qrRoom ? formatRoomDisplay(qrRoom) : '—'}
                  </p>
                  <p className="text-[11px] text-mu break-all mt-0.5 max-w-sm">{generatedQrUrl}</p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(generatedQrUrl);
                        toast.success('Đã sao chép đường dẫn báo hỏng của phòng!');
                      } catch {
                        toast.error('Không thể sao chép.');
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf hover:bg-act border border-bdr2 text-xs font-semibold text-tx cursor-pointer"
                  >
                    <Copy size={13} />
                    <span>Sao chép link</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      downloadQrPng(
                        generatedQrUrl,
                        `QR_BaoHong_${qrDay}_${qrRoom}.png`.replace(/\s+/g, '_')
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf hover:bg-act border border-bdr2 text-xs font-semibold text-tx cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Tải ảnh PNG</span>
                  </button>

                  <select
                    value={posterPaperSize}
                    onChange={e => setPosterPaperSize(e.target.value as PosterPaperSize)}
                    className="px-2 py-1.5 rounded-lg bg-surf border border-bdr2 text-xs text-tx"
                  >
                    <option value="A5">Khổ A5</option>
                    <option value="A4">Khổ A4</option>
                  </select>

                  <button
                    type="button"
                    disabled={printingPoster}
                    onClick={() => void handlePrintDoorPoster()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pri hover:bg-pri2 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {printingPoster ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                    <span>In poster dán cửa</span>
                  </button>
                </div>
              </div>

              {/* Batch 6-up A4 Room QR Printing */}
              <div className="rounded-xl bg-act/60 border border-bdr2 p-3.5 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-tx">
                  <Layers size={14} className="text-amber-500 shrink-0" />
                  <span>In hàng loạt tem QR dán cửa (Khổ A4 · 6 tem/trang có nét cắt)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={printingBatch || qrRooms.length === 0}
                    onClick={() => void handlePrintBatchQr('day')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf hover:bg-bdg border border-bdr2 text-xs font-bold text-tx cursor-pointer disabled:opacity-50"
                  >
                    {printingBatch ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} className="text-amber-500" />}
                    <span>In cả {qrDay || 'Dãy'} ({qrRooms.length} phòng)</span>
                  </button>
                  <button
                    type="button"
                    disabled={printingBatch || allRoomsInQrKtx.length === 0}
                    onClick={() => void handlePrintBatchQr('ktx')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf hover:bg-bdg border border-bdr2 text-xs font-bold text-tx cursor-pointer disabled:opacity-50"
                  >
                    {printingBatch ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} className="text-lnk" />}
                    <span>In toàn bộ {qrKtx || 'KTX'} ({allRoomsInQrKtx.length} phòng)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
