'use client';
import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';
import { useAuth } from '@/context/AuthContext';

const PUBLIC_PATHS = ['/sign-up-login', '/login', '/register', '/checkout', '/attendance'];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));

  useEffect(() => {
    if (!loading && !currentUser && !isPublicPath) {
      router.replace('/sign-up-login');
    }
  }, [loading, currentUser, isPublicPath, router]);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" suppressHydrationWarning>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Đang kiểm tra đăng nhập...</p>
        </div>
      </div>
    );
  }

  // Public pages (login, register, checkout...) — no sidebar
  if (isPublicPath) {
    return <div suppressHydrationWarning>{children}</div>;
  }

  // Not authenticated — redirect happening, show nothing
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" suppressHydrationWarning>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Đang chuyển hướng...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-page" suppressHydrationWarning>
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky header nội bộ: chỉ chứa ThemeSwitcher (Bước 2) */}
        <header className="hidden lg:flex sticky top-0 z-30 h-12 items-center justify-end gap-2 px-4 bg-side border-b border-bdr backdrop-blur-sm">
          <ThemeSwitcher />
        </header>
        <main className="flex-1 min-w-0 overflow-x-hidden pt-14 lg:pt-0" suppressHydrationWarning>
          {children}
        </main>
      </div>
    </div>
  );
}