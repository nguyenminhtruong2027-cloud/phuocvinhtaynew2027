import React, { Suspense } from 'react';

export const metadata = {
  title: 'Đăng Ký Cư Trú — KTX Phước Vĩnh Tây',
  description: 'Trang đăng ký cư trú công khai cho công nhân KTX Phước Vĩnh Tây',
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div suppressHydrationWarning>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-background" suppressHydrationWarning>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        {children}
      </Suspense>
    </div>
  );
}
