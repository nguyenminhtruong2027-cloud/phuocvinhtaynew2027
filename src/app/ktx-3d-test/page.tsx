'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function Legacy3DRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/ktx-3d?${qs}` : '/ktx-3d');
  }, [router, searchParams]);

  return (
    <div className="w-full h-[calc(100vh-3.5rem)] lg:h-screen flex flex-col items-center justify-center gap-3 bg-[#0b1220] text-slate-300">
      <Loader2 size={24} className="animate-spin text-blue-400" />
      <p className="text-xs font-semibold">Đang chuyển sang Bản Đồ 3D chính thức...</p>
    </div>
  );
}

export default function Ktx3DTestRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full h-[calc(100vh-3.5rem)] lg:h-screen flex items-center justify-center bg-[#0b1220] text-slate-300">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      }
    >
      <Legacy3DRedirectInner />
    </Suspense>
  );
}
