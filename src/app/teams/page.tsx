import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import TeamsManagementClient from './components/TeamsManagementClient';

export default function TeamsPage() {
  return (
    <AppLayout>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-pri border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <TeamsManagementClient />
      </Suspense>
    </AppLayout>
  );
}
