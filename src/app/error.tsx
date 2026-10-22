'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center" suppressHydrationWarning>
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4" suppressHydrationWarning>
        <div className="w-12 h-12 bg-red-100 dark:bg-red-950/40 text-red-600 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle size={28} />
        </div>
        <h2 className="text-xl font-bold text-foreground">Đã xảy ra lỗi</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Hệ thống gặp sự cố tạm thời khi tải dữ liệu. Vui lòng thử tải lại hoặc quay về trang chủ.
        </p>
        <div className="flex gap-2 pt-2" suppressHydrationWarning>
          <button
            type="button"
            onClick={() => reset()}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer"
            suppressHydrationWarning
          >
            <RefreshCw size={14} /> Thử lại
          </button>
          <Link
            href="/"
            className="flex-1 py-2.5 bg-muted text-foreground rounded-xl text-xs font-semibold hover:bg-muted/80 transition-colors flex items-center justify-center gap-1.5"
          >
            <Home size={14} /> Trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
