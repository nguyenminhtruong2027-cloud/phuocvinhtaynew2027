'use client';
import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Building2, ShieldCheck } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '@/context/AuthContext';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { PageReveal } from '@/components/ui/MotionPrimitives';
import CommandPalette from '@/components/ui/CommandPalette';
import OfflineIndicator from '@/components/OfflineIndicator';

const PUBLIC_PATHS = ['/sign-up-login', '/login', '/register', '/checkout', '/attendance', '/report-issue'];
const TECHNICIAN_ALLOWED_PATHS = ['/maintenance', '/ktx-3d', '/facilities', '/profile'];

/**
 * AppShell — Khung điều hướng bền vững (mounted 1 lần ở RootLayout),
 * không hủy Sidebar / CommandPalette khi chuyển giữa các chức năng.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { currentUser, isTechnician, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));
  const isTechnicianRestricted =
    Boolean(currentUser) &&
    isTechnician &&
    !isPublicPath &&
    !TECHNICIAN_ALLOWED_PATHS.some(p => pathname?.startsWith(p));

  useEffect(() => {
    if (!loading && !currentUser && !isPublicPath) {
      router.replace('/sign-up-login');
    } else if (!loading && isTechnicianRestricted) {
      router.replace('/maintenance');
    }
  }, [loading, currentUser, isPublicPath, isTechnicianRestricted, router]);

  if (isPublicPath) {
    return (
      <div className="bg-architectural min-h-screen" suppressHydrationWarning>
        {children}
        <OfflineIndicator />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-architectural" suppressHydrationWarning>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <CraftIconBadge icon={Building2} badgeIcon={ShieldCheck} tone="blue" size="xl" interactive={false} />
            <span className="absolute -inset-2 rounded-3xl border border-pri2/30 animate-ping opacity-30 pointer-events-none" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-tx tracking-tight">KTX Phước Vĩnh Tây</p>
            <p className="text-xs text-mu">Đang xác thực phiên làm việc...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser || isTechnicianRestricted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-architectural" suppressHydrationWarning>
        <div className="flex flex-col items-center gap-4">
          <CraftIconBadge icon={Building2} tone="blue" size="lg" interactive={false} />
          <p className="text-xs font-medium text-mu">
            {isTechnicianRestricted ? 'Đang chuyển đến Trung tâm Kỹ thuật & Bảo trì...' : 'Đang chuyển hướng...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-architectural" suppressHydrationWarning>
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <main
          className="flex-1 min-w-0 overflow-x-hidden pt-14 lg:pt-0"
          suppressHydrationWarning
        >
          <PageReveal routeKey={pathname || '/'}>{children}</PageReveal>
        </main>
      </div>
      <CommandPalette />
      <OfflineIndicator />
    </div>
  );
}
