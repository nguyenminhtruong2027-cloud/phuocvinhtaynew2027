import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import BedManagementClient from './components/BedManagementClient';

export default function BedManagementPage() {
  return (
    <AppLayout>
      <Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
        <BedManagementClient />
      </Suspense>
    </AppLayout>
  );
}
