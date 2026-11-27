import React, { Suspense } from 'react';
import MaintenanceCenterClient from './components/MaintenanceCenterClient';

export const metadata = {
  title: 'Kỹ Thuật & Bảo Trì | KTX Phước Vĩnh Tây',
};

export default function MaintenancePage() {
  return (
    <Suspense fallback={null}>
      <MaintenanceCenterClient />
    </Suspense>
  );
}
