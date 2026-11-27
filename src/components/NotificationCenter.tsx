'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Wrench,
  AlertTriangle,
  QrCode,
  LogOut,
  Clock,
  CheckCircle2,
  RefreshCw,
  Volume2,
  VolumeX,
  ArrowRight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { subscribeTablesChanges } from '@/lib/realtimeHub';
import { useAuth } from '@/context/AuthContext';
import { useWorkers } from '@/context/WorkerContext';
import {
  MaintenanceTicket,
  fetchMaintenanceTickets,
  getTicketCategoryShortLabel,
  getTicketSlaStatus,
  playUrgentAlertChime,
} from '@/lib/maintenanceTickets';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { daysSinceVN } from '@/lib/vnDate';

interface NotificationCenterProps {
  compact?: boolean;
  collapsed?: boolean;
}

interface ActionAlertItem {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  count: number;
  href: string;
}

const SOUND_PREF_KEY = 'ktx_urgent_sound_enabled';
const alertedUrgentTicketIds = new Set<string>();

export default function NotificationCenter({
  compact = false,
  collapsed = false,
}: NotificationCenterProps) {
  const router = useRouter();
  const { currentUser, isAdmin, isTechnician, canWriteBlock, canAccessMaintenanceBlock } = useAuth();
  const { workers } = useWorkers();
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activeTickets, setActiveTickets] = useState<MaintenanceTicket[]>([]);
  const [pendingRegCount, setPendingRegCount] = useState(0);
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState(0);
  const initialLoadedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const loadAlertsRef = useRef<() => Promise<void>>(async () => {});
  const [popoverPos, setPopoverPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOUND_PREF_KEY);
      if (saved === '0') setSoundEnabled(false);
    } catch {}
  }, []);

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0');
      } catch {}
      if (next) playUrgentAlertChime();
      return next;
    });
  };

  const loadAlerts = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const ticketPromise = fetchMaintenanceTickets({ activeOnly: true }).catch(() => ({
        tickets: [] as MaintenanceTicket[],
        tableMissing: true,
      }));

      const qrPromise = isTechnician
        ? Promise.resolve({ data: null as null | Array<{ id: string; ktx: string; day: string; ghi_chu: string | null }>, error: null })
        : supabase
            .from('worker_registrations')
            .select('id, ktx, day, ghi_chu')
            .eq('status', 'pending');

      const [ticketRes, qrRes] = await Promise.all([ticketPromise, qrPromise]);

      const scopedTickets = ticketRes.tickets.filter(
        t => isAdmin || (isTechnician ? canAccessMaintenanceBlock(t.day, t.ktx) : canWriteBlock(t.day, t.ktx) || true)
      );
      setActiveTickets(scopedTickets);

      // Alert on newly arrived urgent ticket after initial load (deduplicated across Desktop + Mobile instances)
      const urgentTickets = scopedTickets.filter(t => t.priority === 'urgent' && t.status === 'open');
      if (initialLoadedRef.current) {
        const newlyArrived = urgentTickets.filter(t => !alertedUrgentTicketIds.has(t.id));
        if (newlyArrived.length > 0) {
          newlyArrived.forEach(t => alertedUrgentTicketIds.add(t.id));
          const latest = newlyArrived[0];
          if (soundEnabled) playUrgentAlertChime();
          toast.error(
            `Phiếu KHẨN CẤP mới: ${latest.day} · ${formatRoomDisplay(latest.phong_so)} (${getTicketCategoryShortLabel(latest.category)})`,
            {
              description: latest.description,
              duration: 7000,
              action: {
                label: 'Xem ngay',
                onClick: () => router.push('/maintenance'),
              },
            }
          );
        }
      } else {
        urgentTickets.forEach(t => alertedUrgentTicketIds.add(t.id));
      }
      initialLoadedRef.current = true;

      if (!isTechnician && !qrRes.error && qrRes.data) {
        let reg = 0;
        let chk = 0;
        for (const r of qrRes.data) {
          if (!(isAdmin || canWriteBlock(r.day, r.ktx))) continue;
          if (r.ghi_chu?.startsWith('[CHECKOUT]')) chk += 1;
          else reg += 1;
        }
        setPendingRegCount(reg);
        setPendingCheckoutCount(chk);
      } else {
        setPendingRegCount(0);
        setPendingCheckoutCount(0);
      }
    } finally {
      setLoading(false);
    }
  }, [currentUser, isAdmin, isTechnician, canWriteBlock, canAccessMaintenanceBlock, supabase, soundEnabled, router]);

  useEffect(() => {
    loadAlertsRef.current = loadAlerts;
  }, [loadAlerts]);

  useEffect(() => {
    if (!currentUser) return;
    void loadAlertsRef.current();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadAlertsRef.current();
      }, 400);
    };

    const watchedTables = isTechnician
      ? ['maintenance_tickets']
      : ['maintenance_tickets', 'worker_registrations'];

    const unsubscribe = subscribeTablesChanges(watchedTables, schedule);

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [currentUser, isTechnician]);

  // Compute floating portal position so sidebar overflow never clips the popover
  const updatePopoverPosition = useCallback(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    const rect = containerRef.current.getBoundingClientRect();
    if (compact) {
      setPopoverPos({
        top: Math.max(56, rect.bottom + 8),
        right: 12,
      });
    } else {
      const popoverWidth = 380;
      const preferredLeft = rect.right + 12;
      const maxLeft = Math.max(12, window.innerWidth - popoverWidth - 12);
      const clampedTop = Math.max(12, Math.min(rect.top, window.innerHeight - 340));
      setPopoverPos({
        top: clampedTop,
        left: Math.min(preferredLeft, maxLeft),
      });
    }
  }, [compact]);

  // Close on Escape or outside click & keep portal position synced
  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);
      if (!insideTrigger && !insidePopover) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, updatePopoverPosition]);

  // Overdue temporary residence (> 7 days) for Admin & Staff
  const overdueTamTruCount = useMemo(() => {
    if (isTechnician || workers.length === 0) return 0;
    let count = 0;
    for (const w of workers) {
      if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) continue;
      if (w.tamTruStatus === 'registered') continue;
      if (!isAdmin && !canWriteBlock(w.day, w.ktx)) continue;
      const days = daysSinceVN(w.ngayVaoKTX || w.createdAt);
      if (days !== null && days > 7) count += 1;
    }
    return count;
  }, [isTechnician, isAdmin, canWriteBlock, workers]);

  const urgentTickets = useMemo(
    () => activeTickets.filter(t => t.priority === 'urgent'),
    [activeTickets]
  );

  const slaOverdueTickets = useMemo(
    () => activeTickets.filter(t => getTicketSlaStatus(t).state === 'overdue'),
    [activeTickets]
  );

  const items = useMemo<ActionAlertItem[]>(() => {
    const list: ActionAlertItem[] = [];

    if (urgentTickets.length > 0) {
      list.push({
        id: 'urgent-maint',
        tone: 'danger',
        icon: AlertTriangle,
        title: `${urgentTickets.length} phiếu báo hỏng KHẨN CẤP`,
        subtitle: urgentTickets
          .slice(0, 2)
          .map(t => `${t.day} ${formatRoomDisplay(t.phong_so)} (${getTicketCategoryShortLabel(t.category)})`)
          .join(' · '),
        count: urgentTickets.length,
        href: '/maintenance',
      });
    }

    if (slaOverdueTickets.length > 0) {
      list.push({
        id: 'sla-overdue',
        tone: 'danger',
        icon: Clock,
        title: `${slaOverdueTickets.length} phiếu bảo trì quá hạn SLA`,
        subtitle: 'Khẩn cấp > 2 giờ hoặc thường > 24 giờ chưa hoàn thành',
        count: slaOverdueTickets.length,
        href: '/maintenance',
      });
    }

    const normalOpen = activeTickets.length - urgentTickets.length;
    if (normalOpen > 0) {
      list.push({
        id: 'normal-maint',
        tone: 'warning',
        icon: Wrench,
        title: `${normalOpen} phiếu báo hỏng đang chờ / đang sửa`,
        subtitle: 'Nhấn để mở Trung tâm Kỹ thuật & Bảo trì',
        count: normalOpen,
        href: '/maintenance',
      });
    }

    if (!isTechnician && pendingRegCount > 0) {
      list.push({
        id: 'qr-reg',
        tone: 'warning',
        icon: QrCode,
        title: `${pendingRegCount} hồ sơ QR đăng ký chờ duyệt`,
        subtitle: 'Công nhân mới quét mã chờ phân phòng & xác nhận',
        count: pendingRegCount,
        href: '/qr-portal?tab=registration',
      });
    }

    if (!isTechnician && pendingCheckoutCount > 0) {
      list.push({
        id: 'qr-checkout',
        tone: 'danger',
        icon: LogOut,
        title: `${pendingCheckoutCount} yêu cầu Check-out chờ duyệt`,
        subtitle: 'Công nhân báo rời KTX cần kiểm tra trả giường',
        count: pendingCheckoutCount,
        href: '/qr-portal?tab=checkout_approval',
      });
    }

    if (!isTechnician && overdueTamTruCount > 0) {
      list.push({
        id: 'overdue-tamtru',
        tone: 'info',
        icon: Clock,
        title: `${overdueTamTruCount} công nhân quá hạn tạm trú (> 7 ngày)`,
        subtitle: 'Cần bổ sung đăng ký tạm trú theo quy định',
        count: overdueTamTruCount,
        href: '/report-dashboard',
      });
    }

    return list;
  }, [
    urgentTickets,
    slaOverdueTickets,
    activeTickets.length,
    isTechnician,
    pendingRegCount,
    pendingCheckoutCount,
    overdueTamTruCount,
  ]);

  const totalActionCount =
    activeTickets.length + pendingRegCount + pendingCheckoutCount + (overdueTamTruCount > 0 ? 1 : 0);
  const hasCritical = urgentTickets.length > 0 || slaOverdueTickets.length > 0 || pendingCheckoutCount > 0;

  const navigateTo = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={containerRef} className="relative">
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="relative p-2 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100 cursor-pointer"
          title="Trung tâm thông báo"
          aria-label="Mở trung tâm thông báo"
        >
          <Bell size={17} className={hasCritical ? 'text-dgr' : 'text-tx'} />
          {totalActionCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center font-tabular ${
                hasCritical ? 'bg-dgr' : 'bg-amber-500'
              }`}
            >
              {totalActionCount > 99 ? '99+' : totalActionCount}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          title="Trung tâm thông báo & việc cần xử lý"
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs text-tx transition-colors cursor-pointer ${
            collapsed ? 'justify-center px-2 relative' : ''
          }`}
          style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
        >
          <Bell size={14} className={hasCritical ? 'text-dgr shrink-0' : 'text-lnk shrink-0'} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left truncate font-semibold">Thông báo</span>
              {totalActionCount > 0 ? (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono font-tabular ${
                    hasCritical
                      ? 'bg-dgrbg text-dgr border border-dgr/40'
                      : 'tint-wn text-wn border border-wn/40'
                  }`}
                >
                  {totalActionCount > 99 ? '99+' : totalActionCount}
                </span>
              ) : (
                <span className="text-[10px] text-ok font-semibold">Ổn định</span>
              )}
            </>
          )}
          {collapsed && totalActionCount > 0 && (
            <span
              className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                hasCritical ? 'bg-dgr' : 'bg-wn'
              }`}
            />
          )}
        </button>
      )}

      {open &&
        popoverPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              top: popoverPos.top,
              left: popoverPos.left,
              right: popoverPos.right,
            }}
            className="fixed z-[90] w-[min(380px,calc(100vw-24px))] rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
          >
            {/* Popover Header */}
            <div className="px-4 py-3 border-b border-bdr bg-side flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Bell size={15} className="text-lnk shrink-0" />
                <span className="text-xs sm:text-sm font-bold text-tx truncate">
                  Việc cần xử lý ngay
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={toggleSound}
                  title={soundEnabled ? 'Đang bật chuông báo phiếu Khẩn cấp' : 'Đang tắt chuông báo'}
                  className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
                >
                  {soundEnabled ? <Volume2 size={14} className="text-ok" /> : <VolumeX size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => void loadAlerts()}
                  disabled={loading}
                  title="Làm mới thông báo"
                  className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin text-pri2' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Đóng"
                  className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Items List */}
            <div className="max-h-[65vh] overflow-y-auto divide-y divide-bdr">
              {items.length === 0 ? (
                <div className="py-10 px-5 text-center space-y-2">
                  <CheckCircle2 size={32} className="mx-auto text-ok" />
                  <p className="text-sm font-bold text-tx">Mọi thứ đều ổn định</p>
                  <p className="text-xs text-mu leading-relaxed">
                    Không có phiếu báo hỏng, hồ sơ QR hay cảnh báo tồn đọng cần xử lý ngay.
                  </p>
                </div>
              ) : (
                items.map(item => {
                  const Icon = item.icon;
                  const badgeTone =
                    item.tone === 'danger'
                      ? 'bg-dgrbg text-dgr border-dgr/35'
                      : item.tone === 'warning'
                      ? 'tint-wn text-wn border-wn/35'
                      : 'bg-bdg text-lnk border-bdr2';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateTo(item.href)}
                      className="w-full px-4 py-3 text-left hover:bg-act/70 transition-colors flex items-start gap-3 cursor-pointer"
                    >
                      <span
                        className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${badgeTone}`}
                      >
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-bold text-tx leading-snug">{item.title}</p>
                        <p className="text-[11px] text-mu mt-0.5 line-clamp-2">{item.subtitle}</p>
                      </div>
                      <ArrowRight size={14} className="text-ic shrink-0 mt-1" />
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
