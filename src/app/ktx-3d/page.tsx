'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';

// Strictly code-split Three.js bundle: only downloaded when visiting /ktx-3d
const Ktx3DTestClient = dynamic(
  () => import('../ktx-3d-test/components/Ktx3DTestClient'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[calc(100vh-3.5rem)] lg:h-screen flex flex-col items-center justify-center gap-3 bg-[#0b1220] text-slate-300">
        <Loader2 size={28} className="animate-spin text-blue-400" />
        <p className="text-sm font-semibold">Đang khởi tạo Bản Đồ 3D Ký Túc Xá...</p>
        <p className="text-xs text-slate-400">Đồng bộ trực tiếp với Cơ sở vật chất & Danh sách công nhân</p>
      </div>
    ),
  }
);

interface BoundaryState {
  hasError: boolean;
  message: string;
}

class Ktx3DErrorBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Lỗi khởi tạo không gian 3D.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-[calc(100vh-3.5rem)] lg:h-screen flex items-center justify-center p-6 bg-[#0b1220]">
          <div className="max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 text-center space-y-3 text-slate-100">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/35 text-amber-300 flex items-center justify-center mx-auto">
              <AlertTriangle size={24} />
            </div>
            <h2 className="text-base font-bold">Không thể hiển thị Bản Đồ 3D</h2>
            <p className="text-xs text-slate-400 leading-relaxed">{this.state.message}</p>
            <div className="pt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold transition-colors"
              >
                Tải lại trang
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
              >
                <ArrowLeft size={14} />
                <span>Quay lại Tổng Quan 2D</span>
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Ktx3DPage() {
  return (
    <Ktx3DErrorBoundary>
      <Suspense
        fallback={
          <div className="w-full h-[calc(100vh-3.5rem)] lg:h-screen flex flex-col items-center justify-center gap-3 bg-[#0b1220] text-slate-300">
            <Loader2 size={28} className="animate-spin text-blue-400" />
            <p className="text-sm font-semibold">Đang khởi tạo Bản Đồ 3D Ký Túc Xá...</p>
          </div>
        }
      >
        <Ktx3DTestClient />
      </Suspense>
    </Ktx3DErrorBoundary>
  );
}
