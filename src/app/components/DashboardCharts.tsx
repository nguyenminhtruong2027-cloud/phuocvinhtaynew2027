'use client';
import React from 'react';
import dynamic from 'next/dynamic';

const PlatoonBarChart = dynamic(() => import('./PlatoonBarChart'), { ssr: false });
const DaysHistogram = dynamic(() => import('./DaysHistogram'), { ssr: false });

export default function DashboardCharts() {
  return (
    <div className="flex flex-col gap-6">
      <PlatoonBarChart />
      <DaysHistogram />
    </div>
  );
}