import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import QRPortalTabsWrapper from './components/QRPortalTabsWrapper';

export default function QRPortalPage() {
  return (
    <AppLayout>
      <Suspense fallback={
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <QRPortalTabsWrapper />
      </Suspense>
    </AppLayout>
  );
}
