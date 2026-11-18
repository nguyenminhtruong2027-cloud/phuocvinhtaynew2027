'use client';
import React from 'react';

/**
 * AppLayout — Pass-through compatibility wrapper.
 * Khung Sidebar & CommandPalette bền vững đã được chuyển lên AppShell ở RootLayout
 * để tránh hủy/dựng lại toàn bộ menu khi chuyển trang.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}