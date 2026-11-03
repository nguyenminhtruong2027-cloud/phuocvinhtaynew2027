'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import {
  LayoutDashboard, Users, ChevronLeft, ChevronRight, LogOut, BarChart2,
  ClipboardList, UserCog, RefreshCw, Building2, QrCode, Menu, X, BedDouble
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useWorkers } from '@/context/WorkerContext';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  adminOnly?: boolean;
  dynamicBadge?: boolean;
  group?: 'main' | 'tools' | 'admin';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'nav-dashboard', label: 'Tổng Quan', href: '/', icon: LayoutDashboard, group: 'main' },
  { id: 'nav-report', label: 'Báo Cáo Biến Động', href: '/report-dashboard', icon: BarChart2, group: 'main' },
  { id: 'nav-workers', label: 'Quản Lý Công Nhân', href: '/worker-management', icon: Users, dynamicBadge: true, group: 'main' },
  { id: 'nav-facilities', label: 'Cơ Sở Vật Chất', href: '/facilities', icon: Building2, group: 'main' },
  { id: 'nav-beds', label: 'Quản Lý Giường', href: '/bed-management', icon: BedDouble, group: 'main' },
  { id: 'nav-qr', label: 'QR Portal', href: '/qr-portal', icon: QrCode, group: 'main' },
  { id: 'nav-user-mgmt', label: 'Quản Lý Tài Khoản', href: '/user-management', icon: UserCog, adminOnly: true, group: 'admin' },
  { id: 'nav-audit', label: 'Nhật Ký Hệ Thống', href: '/audit-log', icon: ClipboardList, adminOnly: true, group: 'admin' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, isAdmin, signOut } = useAuth();
  const { workerCount, refreshWorkers, refreshing } = useWorkers();

  // Automatically close mobile drawer when navigation route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Handle ESC key to close mobile drawer & toggle body overflow
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

  const visibleNavItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);
  const mainItems = visibleNavItems.filter(i => i.group === 'main');
  const adminItems = visibleNavItems.filter(i => i.group === 'admin');

  const handleLogout = async () => {
    try { await signOut(); } catch {}
    router.replace('/sign-up-login');
    setMobileOpen(false);
  };

  if (!currentUser) return null;

  const displayName = currentUser.name || currentUser.email || 'Người dùng';
  const roleLabel = currentUser.role === 'admin' ? 'Quản trị viên' : 'Chuyên viên';
  const avatarColor = currentUser.role === 'admin' ? 'bg-gradient-to-tr from-rose-600 to-red-500' : 'bg-gradient-to-tr from-blue-600 to-indigo-600';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  const NavLink = ({ item, isMobile = false }: { item: NavItem; isMobile?: boolean }) => {
    const IconComponent = item.icon;
    const isActive = pathname === item.href;
    const badge = item.dynamicBadge ? workerCount : undefined;

    if (isMobile) {
      return (
        <Link
          href={item.href}
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-colors duration-100 ${
            isActive
              ? 'bg-act text-tx font-bold border border-bdr2'
              : 'text-nav hover:bg-act hover:text-tx'
          }`}
        >
          <IconComponent size={20} className={isActive ? 'text-pri2' : 'text-ic'} />
          <span className="text-sm flex-1">{item.label}</span>
          {badge !== undefined && badge > 0 && (
            <span
              className={`text-xs rounded-full px-2 py-0.5 font-bold font-tabular ${
                isActive ? 'bg-pri text-white' : 'bg-surf text-mu border border-bdr'
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
        className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-semibold transition-colors duration-100 relative ${
          isActive
            ? 'bg-act text-tx font-bold border border-bdr2'
            : 'text-nav hover:text-tx hover:bg-act/60 border border-transparent'
        }`}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full"
            style={{ background: 'var(--pri2)' }}
          />
        )}
        <IconComponent size={18} className={isActive ? 'text-pri2' : 'text-ic'} />
        {!collapsed && <span className="flex-1 leading-snug">{item.label}</span>}
        {!collapsed && badge !== undefined && badge > 0 && (
          <span className="text-[11px] bg-bdg text-lnk border border-bdr2 rounded-full px-2 py-0.5 font-tabular font-bold">
            {badge}
          </span>
        )}
        {collapsed && badge !== undefined && badge > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-pri2" />
        )}
      </Link>
    );
  };

  return (
    <>
      {/* ── Desktop Sidebar (Spacious Enterprise Executive Layout) ── */}
      <aside className={`hidden lg:flex flex-col bg-side border-r border-bdr h-screen sticky top-0 overflow-hidden shadow-2xl transition-[width] duration-150 ease-out z-30 ${collapsed ? 'w-16' : 'w-64'}`}>
        {/* Brand Header */}
        <div className={`flex items-center border-b border-bdr px-4 py-4.5 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 p-0.5 flex items-center justify-center flex-shrink-0 shadow-md">
            <div className="w-full h-full bg-page rounded-[10px] flex items-center justify-center">
              <Building2 size={19} className="text-pri2" />
            </div>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="font-extrabold text-sm text-tx tracking-tight block leading-tight">KÝ TÚC XÁ</span>
              <span className="text-[11px] text-mu font-semibold tracking-wider">PHƯỚC VĨNH TÂY</span>
            </div>
          )}
        </div>

        {/* Navigation List */}
        <nav className="flex-1 px-3 pt-4 pb-8 flex flex-col gap-1.5 overflow-y-auto scrollbar-thin">
          {!collapsed && (
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold text-ic uppercase tracking-widest">
              CHỨC NĂNG CHÍNH
            </p>
          )}
          {mainItems.map(item => <NavLink key={item.id} item={item} />)}

          {adminItems.length > 0 && (
            <>
              {!collapsed && (
                <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-ic uppercase tracking-widest">
                  QUẢN TRỊ HỆ THỐNG
                </p>
              )}
              {collapsed && <div className="my-2 border-t border-bdr mx-1" />}
              {adminItems.map(item => <NavLink key={item.id} item={item} />)}
            </>
          )}

          {/* Data Sync Tool */}
          <div className="mt-4 pt-3 border-t border-bdr">
            {!collapsed && <p className="px-3 mb-1.5 text-[10px] font-bold text-ic uppercase tracking-widest">TIỆN ÍCH</p>}
            <button
              onClick={refreshWorkers}
              disabled={refreshing}
              title="Đồng bộ lại toàn bộ dữ liệu"
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-nav hover:text-tx hover:bg-act transition-colors duration-100 ${
                refreshing ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              <RefreshCw size={16} className={`text-ic flex-shrink-0 ${refreshing ? 'animate-spin text-pri2' : ''}`} />
              {!collapsed && <span className="truncate">{refreshing ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}</span>}
            </button>
          </div>
        </nav>

        {/* User Card + Collapse Toggle */}
        <div className="border-t border-bdr p-3 bg-surf/60">
          {!collapsed && (
            <div className="w-full p-2.5 rounded-xl bg-act border border-bdr2 flex items-center gap-3 mb-2 shadow-sm">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm ${avatarColor}`}>
                {avatarInitial}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-tx truncate">{displayName}</p>
                <p className="text-[11px] text-mu truncate">{roleLabel}</p>
              </div>
              <button
                className="p-1.5 rounded-lg text-mu hover:text-dgr hover:bg-surf transition-colors duration-100"
                title="Đăng xuất"
                onClick={handleLogout}
              >
                <LogOut size={15} />
              </button>
            </div>
          )}

          {collapsed && (
            <div className="flex flex-col items-center py-1 gap-1.5 mb-1.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm ${avatarColor}`}>
                {avatarInitial}
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-mu hover:text-dgr hover:bg-surf transition-colors duration-100"
                title="Đăng xuất"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-nav hover:text-tx hover:bg-act transition-colors duration-100"
          >
            {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Thu gọn menu</span></>}
          </button>
        </div>
      </aside>

      {/* ── Mobile Top Bar (Responsive Header with Hamburger ☰) ── */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-side border-b border-bdr backdrop-blur-md flex items-center justify-between px-3.5 h-14 shadow-lg w-full max-w-full">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-1 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100 focus:outline-none"
            aria-label="Mở menu điều hướng (Hamburger Menu)"
            title="Mở menu (☰)"
          >
            <Menu size={22} className="text-tx" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Building2 size={15} className="text-white" />
            </div>
            <div>
              <span className="font-extrabold text-xs sm:text-sm text-tx tracking-tight block leading-tight">KÝ TÚC XÁ</span>
              <span className="text-[10px] text-mu font-semibold tracking-wider">PHƯỚC VĨNH TÂY</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <button
            onClick={refreshWorkers}
            disabled={refreshing}
            className="p-2 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100 disabled:opacity-50"
            title="Tải lại dữ liệu"
          >
            <RefreshCw size={17} className={refreshing ? 'animate-spin text-pri2' : ''} />
          </button>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm ${avatarColor}`}>
            {avatarInitial}
          </div>
        </div>
      </header>

      {/* ── Mobile Slide-Over Drawer ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-150"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer container */}
          <div className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-side border-r border-bdr shadow-2xl flex flex-col z-50">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-bdr bg-surf/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Building2 size={18} className="text-white" />
                </div>
                <div>
                  <span className="font-extrabold text-sm text-tx tracking-tight block leading-tight">KÝ TÚC XÁ</span>
                  <span className="text-[11px] text-mu font-semibold tracking-wider">PHƯỚC VĨNH TÂY</span>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors duration-100"
                aria-label="Đóng menu"
                title="Đóng menu (✕)"
              >
                <X size={20} />
              </button>
            </div>

            {/* Drawer Navigation Links */}
            <div className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto scrollbar-thin">
              <p className="px-3 pb-1 text-[10px] font-bold text-ic uppercase tracking-widest">
                Chức năng chính
              </p>
              {mainItems.map(item => (
                <NavLink key={`m-${item.id}`} item={item} isMobile />
              ))}

              {adminItems.length > 0 && (
                <>
                  <p className="px-3 pt-4 pb-1 text-[10px] font-bold text-ic uppercase tracking-widest">
                    Quản trị hệ thống
                  </p>
                  {adminItems.map(item => (
                    <NavLink key={`m-${item.id}`} item={item} isMobile />
                  ))}
                </>
              )}

              <div className="pt-4 border-t border-bdr mt-3 space-y-1">
                <button
                  onClick={() => { refreshWorkers(); setMobileOpen(false); }}
                  disabled={refreshing}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-nav hover:bg-act hover:text-tx transition-colors duration-100 disabled:opacity-60 text-sm font-semibold"
                >
                  <RefreshCw size={18} className={refreshing ? 'animate-spin text-pri2' : ''} />
                  <span>{refreshing ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}</span>
                </button>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-bdr bg-surf/60">
              <div className="px-3 py-2.5 flex items-center gap-3 bg-act border border-bdr2 rounded-xl mb-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${avatarColor}`}>
                  {avatarInitial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-tx truncate">{displayName}</p>
                  <p className="text-xs text-mu truncate">{roleLabel}</p>
                </div>
              </div>
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
