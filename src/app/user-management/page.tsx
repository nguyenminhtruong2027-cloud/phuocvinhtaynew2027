import React from 'react';
import AppLayout from '@/components/AppLayout';
import UserManagementClient from './components/UserManagementClient';

export default function UserManagementPage() {
  return (
    <AppLayout>
      <div className="px-4 sm:px-6 py-5 max-w-6xl mx-auto w-full">
        <UserManagementClient />
      </div>
    </AppLayout>
  );
}
