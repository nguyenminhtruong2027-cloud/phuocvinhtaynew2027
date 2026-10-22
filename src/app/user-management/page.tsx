import React from 'react';
import AppLayout from '@/components/AppLayout';
import UserManagementClient from './components/UserManagementClient';

export default function UserManagementPage() {
  return (
    <AppLayout>
      <UserManagementClient />
    </AppLayout>
  );
}
