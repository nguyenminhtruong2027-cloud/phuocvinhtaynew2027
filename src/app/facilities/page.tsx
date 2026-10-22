import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import FacilitiesClient from './components/FacilitiesClient';

export default function FacilitiesPage() {
  return (
    <AppLayout>
      <Suspense fallback={
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <FacilitiesClient />
      </Suspense>
    </AppLayout>
  );
}
