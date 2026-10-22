import React from 'react';
import Link from 'next/link';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 font-sans text-foreground">
      <div className="text-center max-w-md space-y-4">
        <div className="flex justify-center mb-2">
          <h1 className="text-8xl font-bold text-primary opacity-20">404</h1>
        </div>
        <h2 className="text-2xl font-bold">Trang Không Tìm Thấy</h2>
        <p className="text-muted-foreground text-sm">
          Trang bạn đang tìm kiếm không tồn tại hoặc đã được di chuyển.
        </p>
        <div className="pt-4 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity shadow-sm text-sm"
          >
            <Home size={16} />
            Về Trang Chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
