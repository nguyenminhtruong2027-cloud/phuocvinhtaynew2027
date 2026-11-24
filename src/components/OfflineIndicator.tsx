'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/usePWAInstall';

export default function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[85] flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-xl border border-amber-400/50"
    >
      <WifiOff size={14} className="shrink-0" />
      <span>Mất kết nối mạng — Một số thao tác lưu dữ liệu sẽ tạm hoãn</span>
    </div>
  );
}
