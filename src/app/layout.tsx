import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import '../styles/tailwind.css';
import '@/styles/index.css';
import { AuthProvider } from '@/context/AuthContext';
import { AuditProvider } from '@/context/AuditContext';
import { WorkerProvider } from '@/context/WorkerContext';
import { MotionProvider } from '@/components/ui/MotionPrimitives';
import AppShell from '@/components/AppShell';

const jakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'KTX Phước Vĩnh Tây — Quản Lý Ký Túc Xá Công Nhân',
  description: 'Hệ thống quản lý ký túc xá nội bộ cho công nhân xây dựng — theo dõi phòng, công nhân và tổ trưởng tại KTX Phước Vĩnh Tây.',
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
  },
};

export const dynamic = 'force-dynamic';

// Áp data-theme trước khi render để không bị nháy sai màu (no-flash).
const THEME_NO_FLASH_SCRIPT = `(function(){try{var raw=localStorage.getItem('ktx-theme');var t=(raw==='light'||raw==='midnight')?raw:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'midnight');if(raw&&raw!==t){localStorage.setItem('ktx-theme',t);}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','midnight');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${jakartaSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className={jakartaSans.className} suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
        <MotionProvider>
          <AuthProvider>
            <AuditProvider>
              <WorkerProvider>
                <AppShell>{children}</AppShell>
              </WorkerProvider>
            </AuditProvider>
          </AuthProvider>
        </MotionProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}