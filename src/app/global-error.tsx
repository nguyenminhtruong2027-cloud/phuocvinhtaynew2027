'use client';

import React, { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global Error:', error);
  }, [error]);

  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 font-sans" suppressHydrationWarning>
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 shadow-sm text-center space-y-4" suppressHydrationWarning>
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle size={28} />
          </div>
          <h2 className="text-xl font-bold">Lỗi toàn cục hệ thống</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Đã xảy ra sự cố không mong muốn. Vui lòng bấm làm mới để thử lại.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 cursor-pointer"
            suppressHydrationWarning
          >
            <RefreshCw size={14} /> Làm mới ứng dụng
          </button>
        </div>
      </body>
    </html>
  );
}
