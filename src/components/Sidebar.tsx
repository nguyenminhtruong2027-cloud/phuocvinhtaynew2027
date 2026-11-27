'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Users2, ChevronLeft, ChevronRight, LogOut, BarChart2,
  ClipboardList, UserCog, RefreshCw, Building2, QrCode, Menu, X, BedDouble, ShieldCheck, ShieldAlert, Search, Box, Wrench
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useWorkers } from '@/context/WorkerContext';
import { createClient } from '@/lib/supabase/client';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { openCommandPalette } from '@/components/ui/CommandPalette';
import NotificationCenter from '@/components/NotificationCenter';
import PWAInstallButton from '@/components/PWAInstallButton';

type NavGroupKey = 'executive' | 'residents' | 'operations' | 'admin';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  adminOnly?: boolean;
  dynamicBadge?: boolean;
  group: NavGroupKey;
}

const NAV_GROUPS: Array<{ key: NavGroupKey; label: string }> = [
  { key: 'executive', label: 'Điều hành' },
  { key: 'residents', label: 'Nhân sự & Lưu trú' },
  { key: 'operations', label: 'Cơ sở & Vận hành' },
  { key: 'admin', label: 'Quản trị hệ thống' },
];

const NAV_ITEMS: NavItem[] = [
  { id: 'nav-dashboard', label: 'Tổng Quan', href: '/', icon: LayoutDashboard, group: 'executive' },
  { id: 'nav-report', label: 'Báo Cáo Biến Động', href: '/report-dashboard', icon: BarChart2, group: 'executive' },
  { id: 'nav-workers', label: 'Quản Lý Công Nhân', href: '/worker-management', icon: Users, dynamicBadge: true, group: 'residents' },
  { id: 'nav-teams', label: 'Quản Lý Tổ Đội', href: '/teams', icon: Users2, group: 'residents' },
  { id: 'nav-beds', label: 'Quản Lý Giường', href: '/bed-management', icon: BedDouble, group: 'residents' },
  { id: 'nav-qr', label: 'QR Portal', href: '/qr-portal', icon: QrCode, group: 'residents' },
  { id: 'nav-facilities', label: 'Cơ Sở Vật Chất', href: '/facilities', icon: Building2, group: 'operations' },
  { id: 'nav-ktx-3d', label: 'Bản Đồ 3D KTX', href: '/ktx-3d', icon: Box, group: 'operations' },
  { id: 'nav-maintenance', label: 'Kỹ Thuật & Bảo Trì', href: '/maintenance', icon: Wrench, group: 'operations' },
  { id: 'nav-security', label: 'An Ninh & Kỷ Luật', href: '/security', icon: ShieldAlert, group: 'operations' },
  { id: 'nav-user-mgmt', label: 'Quản Lý Tài Khoản', href: '/user-management', icon: UserCog, adminOnly: true, group: 'admin' },
  { id: 'nav-audit', label: 'Nhật Ký Hệ Thống', href: '/audit-log', icon: ClipboardList, adminOnly: true, group: 'admin' },
];

const TECHNICIAN_NAV_IDS = new Set(['nav-maintenance', 'nav-ktx-3d', 'nav-facilities']);

const SidebarNavLink = React.memo(function SidebarNavLink({
  item,
  pathname,
  collapsed,
  workerCount,
  pendingQrCount = 0,
  pendingMaintenanceCount = 0,
  isMobile = false,
  onMobileClose,
}: {
  item: NavItem;
  pathname: string | null;
  collapsed: boolean;
  workerCount: number;
  pendingQrCount?: number;
  pendingMaintenanceCount?: number;
  isMobile?: boolean;
  onMobileClose?: () => void;
}) {
  const IconComponent = item.icon;
  const isActive = pathname === item.href;
  const isQrPending = item.id === 'nav-qr' && pendingQrCount > 0;
  const isMaintPending = item.id === 'nav-maintenance' && pendingMaintenanceCount > 0;
  const badge = item.dynamicBadge
    ? workerCount
    : isQrPending
    ? pendingQrCount
    : isMaintPending
    ? pendingMaintenanceCount
    : undefined;

  if (isMobile) {
    return (
      <Link
        href={item.href}
        onClick={onMobileClose}
        className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors duration-120 ${
          isActive
            ? 'bg-act text-tx font-bold border border-bdr2'
            : 'text-nav hover:bg-act/60 hover:text-tx border border-transparent'
        }`}
      >
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isActive ? 'craft-icon-blue' : 'bg-surf/70 border border-bdr text-ic'
        }`}>
          <IconComponent size={16} strokeWidth={isActive ? 2.2 : 1.9} />
        </span>
        <span className="text-[13.5px] flex-1 truncate">{item.label}</span>
        {badge !== undefined && badge > 0 && (
          <span
            className={`text-[11px] rounded-md px-1.5 py-0.5 font-bold font-mono font-tabular ${
              isQrPending
                ? 'tint-wn text-wn border border-wn/35'
                : isMaintPending
                ? 'tint-dgr text-dgr border border-dgr/35'
                : isActive
                ? 'bg-pri text-white'
                : 'bg-surf text-mu border border-bdr'
            }`}
          >
            {badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[12.5px] font-medium transition-colors duration-120 ${
        isActive
          ? 'text-tx font-semibold'
          : 'text-nav hover:text-tx'
      }`}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-act border border-bdr2"
          style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-act/0 group-hover:bg-act/55 transition-colors duration-120"
        />
      )}

      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full z-10 bg-pri2"
        />
      )}

      <span
        className={`relative z-10 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors duration-120 ${
          isActive ? 'text-lnk bg-bdg/80' : 'text-ic group-hover:text-tx'
        }`}
      >
        <IconComponent size={15} strokeWidth={isActive ? 2.2 : 1.9} />
      </span>

      {!collapsed && (
        <span className="relative z-10 flex-1 leading-snug truncate">
          {item.label}
        </span>
      )}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span
          className={`relative z-10 text-[10.5px] rounded-md px-1.5 py-0.5 font-mono font-tabular font-bold ${
            isQrPending
              ? 'tint-wn text-wn border border-wn/35'
              : isMaintPending
              ? 'tint-dgr text-dgr border border-dgr/35'
              : 'bg-bdg/90 text-lnk border border-bdr2'
          }`}
          title={
            isQrPending
              ? `${badge} hồ sơ QR chờ duyệt`
              : isMaintPending
              ? `${badge} phiếu báo hỏng đang mở`
              : undefined
          }
        >
          {badge}
        </span>
      )}
      {collapsed && badge !== undefined && badge > 0 && (
        <span
          className={`absolute top-1.5 right-1.5 z-10 w-1.5 h-1.5 rounded-full ${
            isQrPending ? 'bg-wn' : isMaintPending ? 'bg-dgr' : 'bg-pri2'
          }`}
        />
      )}
    </Link>
  );
});

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, isAdmin, isTechnician, canWriteBlock, canAccessMaintenanceBlock, signOut } = useAuth();
  const { workerCount, refreshWorkers, refreshing } = useWorkers();
  const [pendingQrCount, setPendingQrCount] = useState(0);
  const [pendingMaintenanceCount, setPendingMaintenanceCount] = useState(0);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!currentUser || isTechnician) {
      setPendingQrCount(0);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const supabase = createClient();

    const loadPending = async () => {
      try {
        const { data, error } = await supabase
          .from('worker_registrations')
          .select('id, day, ktx')
          .eq('status', 'pending');
        if (!active || error || !data) return;
        const count = data.filter(r => isAdmin || canWriteBlock(r.day, r.ktx)).length;
        setPendingQrCount(count);
      } catch {
        // non-blocking
      }
    };

    const scheduleLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) void loadPending();
      }, 450);
    };

    void loadPending();
    const channel = supabase
      .channel('sidebar_pending_qr_count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_registrations' }, scheduleLoad)
      .subscribe();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [currentUser, isAdmin, isTechnician, canWriteBlock]);

  useEffect(() => {
    if (!currentUser) {
      setPendingMaintenanceCount(0);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const supabase = createClient();

    const loadMaintenancePending = async () => {
      try {
        const { data, error } = await supabase
          .from('maintenance_tickets')
          .select('id, ktx, day, status')
          .in('status', ['open', 'in_progress']);
        if (!active || error || !data) return;
        const count = data.filter(t => isAdmin || canAccessMaintenanceBlock(t.day, t.ktx)).length;
        setPendingMaintenanceCount(count);
      } catch {
        // Table may not be migrated yet; fail silently
      }
    };

    const scheduleLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) void loadMaintenancePending();
      }, 450);
    };

    void loadMaintenancePending();
    const channel = supabase
      .channel('sidebar_pending_maintenance_count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_tickets' }, scheduleLoad)
      .subscribe();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [currentUser, isAdmin, canAccessMaintenanceBlock]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen]);

  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (isTechnician) return TECHNICIAN_NAV_IDS.has(item.id);
    return !item.adminOnly || isAdmin;
  });
  const groupedNavSections = NAV_GROUPS.map(g => ({
    ...g,
    items: visibleNavItems.filter(i => i.group === g.key),
  })).filter(g => g.items.length > 0);

  const handleLogout = async () => {
    try { await signOut(); } catch {}
    router.replace('/sign-up-login');
    setMobileOpen(false);
  };

  if (!currentUser) return null;

  const displayName = currentUser.name || currentUser.email || 'Người dùng';
  const roleLabel =
    currentUser.role === 'super_admin'
      ? 'Quản trị tối cao'
      : currentUser.role === 'admin'
      ? 'Quản trị viên'
      : currentUser.role === 'technician'
      ? 'Kỹ thuật viên'
      : 'Chuyên viên';
  const avatarColor =
    currentUser.role === 'super_admin'
      ? 'bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-600'
      : currentUser.role === 'admin'
      ? 'bg-gradient-to-tr from-rose-600 to-red-500'
      : currentUser.role === 'technician'
      ? 'bg-gradient-to-tr from-amber-500 to-orange-600'
      : 'bg-gradient-to-tr from-blue-600 to-indigo-600';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside className={`hidden lg:flex flex-col bg-side border-r border-bdr h-screen sticky top-0 overflow-hidden shadow-xl transition-[width] duration-150 ease-out z-30 ${collapsed ? 'w-[70px]' : 'w-64'}`}>
        {/* Brand Header */}
        <div className={`flex items-center border-b border-bdr px-4 py-4 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <CraftIconBadge
            icon={Building2}
            badgeIcon={ShieldCheck}
            tone="blue"
            size="md"
          />
          {!collapsed && (
            <div className="min-w-0">
              <span className="font-extrabold text-sm text-tx tracking-tight block leading-tight">KÝ TÚC XÁ</span>
              <span className="text-[11px] text-lnk font-semibold tracking-wider">PHƯỚC VĨNH TÂY</span>
            </div>
          )}
        </div>

        {/* Navigation List */}
        <nav className="flex-1 px-2.5 pt-3 pb-4 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
          {/* Quick Command Palette + Notification Row */}
          <div className={`mb-2.5 flex items-center gap-1.5 ${collapsed ? 'flex-col' : ''}`}>
            <button
              type="button"
              onClick={openCommandPalette}
              title="Tìm kiếm nhanh (Ctrl + K)"
              className={`flex-1 flex items-center gap-2 px-2.5 py-2 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs text-mu hover:text-tx transition-colors cursor-pointer min-w-0 ${
                collapsed ? 'w-full justify-center px-2' : ''
              }`}
              style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
            >
              <Search size={14} className="text-lnk shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left truncate font-medium">Tìm nhanh...</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-act border border-bdr text-[10px] font-mono font-semibold text-ic shrink-0">
                    ⌘K
                  </kbd>
                </>
              )}
            </button>
            <div className={collapsed ? 'w-full' : 'shrink-0'}>
              <NotificationCenter compact={!collapsed} collapsed={collapsed} />
            </div>
          </div>

          {groupedNavSections.map((section, idx) => (
            <div key={section.key} className={idx > 0 ? 'mt-3' : ''}>
              {!collapsed ? (
                <p className="px-2.5 pb-1 text-[10px] font-bold text-ic tracking-wider uppercase">
                  {section.label}
                </p>
              ) : (
                idx > 0 && <div className="my-2 border-t border-bdr mx-1.5" />
              )}
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <SidebarNavLink
                    key={item.id}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                    workerCount={workerCount}
                    pendingQrCount={pendingQrCount}
                    pendingMaintenanceCount={pendingMaintenanceCount}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Compact Utility Strip + User Card */}
        <div className="border-t border-bdr px-2.5 py-2.5 bg-surf/50 space-y-2">
          {/* Compact Utility Controls */}
          <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-between gap-1 px-0.5'}`}>
            <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'gap-0.5'}`}>
              {!isTechnician && (
                <button
                  type="button"
                  onClick={() => { void refreshWorkers(); }}
                  disabled={refreshing}
                  title={refreshing ? 'Đang đồng bộ dữ liệu...' : 'Đồng bộ lại dữ liệu'}
                  className="p-2 rounded-xl text-nav hover:text-tx hover:bg-act border border-transparent hover:border-bdr2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={15} className={refreshing ? 'animate-spin text-pri2' : ''} />
                </button>
              )}
              <ThemeSwitcher compact />
              <PWAInstallButton compact />
            </div>

            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
              aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
              className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act border border-transparent hover:border-bdr2 transition-colors cursor-pointer"
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          </div>

          {!collapsed ? (
            <div className="w-full p-2 rounded-xl bg-act/80 border border-bdr2 flex items-center gap-2 hover:border-pri2/40 transition-colors" style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}>
              <Link
                href="/profile"
                title="Mở hồ sơ cá nhân & cài đặt phiên"
                className="flex items-center gap-2.5 flex-1 min-w-0 p-0.5 rounded-lg hover:opacity-90 transition-opacity"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm ${avatarColor}`}>
                  {avatarInitial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-tx truncate">{displayName}</p>
                  <p className="text-[11px] text-mu truncate">{roleLabel}</p>
                </div>
              </Link>
              <button
                className="p-1.5 rounded-lg text-mu hover:text-dgr hover:bg-surf transition-colors shrink-0 cursor-pointer"
                title="Đăng xuất"
                onClick={handleLogout}
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-0.5">
              <Link
                href="/profile"
                title={`${displayName} — Hồ sơ cá nhân`}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm hover:scale-105 transition-transform ${avatarColor}`}
              >
                {avatarInitial}
              </Link>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-mu hover:text-dgr hover:bg-surf transition-colors cursor-pointer"
                title="Đăng xuất"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Mobile Top Bar ── */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-side border-b border-bdr flex items-center justify-between gap-2 px-3 h-14 shadow-md w-full max-w-full">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 -ml-1 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100 focus:outline-none shrink-0"
            aria-label="Mở menu điều hướng"
            title="Mở menu"
          >
            <Menu size={21} className="text-tx" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <CraftIconBadge icon={Building2} tone="blue" size="xs" interactive={false} />
            <div className="min-w-0">
              <span className="font-extrabold text-xs text-tx tracking-tight block leading-tight truncate whitespace-nowrap">KÝ TÚC XÁ</span>
              <span className="text-[10px] text-lnk font-semibold tracking-wide block leading-tight truncate whitespace-nowrap">PHƯỚC VĨNH TÂY</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <NotificationCenter compact />
          <PWAInstallButton compact />
          <button
            type="button"
            onClick={openCommandPalette}
            className="p-1.5 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100"
            title="Tìm nhanh (Ctrl + K)"
            aria-label="Tìm nhanh"
          >
            <Search size={16} />
          </button>
          <ThemeSwitcher compact />
          {!isTechnician && (
            <button
              onClick={refreshWorkers}
              disabled={refreshing}
              className="p-1.5 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100 disabled:opacity-50"
              title="Tải lại dữ liệu"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin text-pri2' : ''} />
            </button>
          )}
          <Link
            href="/profile"
            title="Hồ sơ cá nhân"
            className={`w-7 h-7 ml-0.5 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm active:scale-95 transition-transform shrink-0 ${avatarColor}`}
          >
            {avatarInitial}
          </Link>
        </div>
      </header>

      {/* ── Mobile Slide-Over Drawer (Zero-lag CSS animated) ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 overflow-hidden">
          <div
            className="fixed inset-0 modal-backdrop-scrim fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          <div
            className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-side border-r border-bdr shadow-2xl flex flex-col z-50 animate-slide-in-left"
          >
              <div className="flex items-center justify-between px-4 py-4 border-b border-bdr bg-surf/60">
                <div className="flex items-center gap-2.5">
                  <CraftIconBadge icon={Building2} badgeIcon={ShieldCheck} tone="blue" size="sm" interactive={false} />
                  <div>
                    <span className="font-extrabold text-sm text-tx tracking-tight block leading-tight">KÝ TÚC XÁ</span>
                    <span className="text-[11px] text-lnk font-semibold tracking-wider">PHƯỚC VĨNH TÂY</span>
                  </div>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors duration-100"
                  aria-label="Đóng menu"
                  title="Đóng menu"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 px-3 py-3.5 space-y-3.5 overflow-y-auto scrollbar-thin">
                {groupedNavSections.map(section => (
                  <div key={`m-${section.key}`} className="space-y-1">
                    <p className="px-3 pb-0.5 text-[10px] font-bold text-ic uppercase tracking-wider">
                      {section.label}
                    </p>
                    {section.items.map(item => (
                      <SidebarNavLink
                        key={`m-${item.id}`}
                        item={item}
                        pathname={pathname}
                        collapsed={false}
                        workerCount={workerCount}
                        pendingQrCount={pendingQrCount}
                        pendingMaintenanceCount={pendingMaintenanceCount}
                        isMobile
                        onMobileClose={() => setMobileOpen(false)}
                      />
                    ))}
                  </div>
                ))}

                <div className="pt-3 border-t border-bdr space-y-1">
                  <PWAInstallButton />
                  {!isTechnician && (
                    <button
                      onClick={() => { refreshWorkers(); setMobileOpen(false); }}
                      disabled={refreshing}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-nav hover:bg-act hover:text-tx transition-colors duration-100 disabled:opacity-60 text-sm font-semibold"
                    >
                      <RefreshCw size={17} className={refreshing ? 'animate-spin text-pri2' : ''} />
                      <span>{refreshing ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 border-t border-bdr bg-surf/60">
                <Link
                  href="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 flex items-center gap-3 bg-act border border-bdr2 hover:border-pri2/40 rounded-xl mb-2 transition-colors"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${avatarColor}`}>
                    {avatarInitial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-tx truncate">{displayName}</p>
                    <p className="text-xs text-mu truncate">{roleLabel} · Xem hồ sơ</p>
                  </div>
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-dgr bg-dgrbg hover:opacity-90 border border-dgr/25 transition-colors duration-100 text-sm font-bold"
                >
                  <LogOut size={16} />
                  <span>Đăng xuất tài khoản</span>
                </button>
              </div>
            </div>
        </div>
      )}
    </>
  );
}
