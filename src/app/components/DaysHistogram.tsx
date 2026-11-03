'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { calcSoNgay } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';
import { Clock } from 'lucide-react';

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surf border border-bdr2 rounded-xl shadow-modal px-3 py-2 text-xs">
        <p className="font-bold text-tx">{label} ngày</p>
        <p className="text-mu mt-0.5">Số công nhân: <span className="font-tabular font-bold text-ok">{payload[0].value}</span></p>
      </div>
    );
  }
  return null;
};

export default function DaysHistogram() {
  const { workers } = useWorkers();
  const workerList = Array.isArray(workers) ? workers : [];
  const buckets = [
    { label: '1–7', min: 1, max: 7 },
    { label: '8–14', min: 8, max: 14 },
    { label: '15–21', min: 15, max: 21 },
    { label: '22–30', min: 22, max: 30 },
    { label: '31–40', min: 31, max: 40 },
    { label: '41+', min: 41, max: 999 },
  ];

  const data = buckets.map(b => ({
    name: b.label,
    count: workerList.filter(w => {
      const d = calcSoNgay(w?.ngayVaoKTX, w?.ngayRaKTX);
      return d !== null && d >= b.min && d <= b.max;
    }).length,
  }));

  return (
    <div className="bg-surf border border-bdr rounded-2xl shadow-xl p-5 transition-all duration-200 hover:border-bdr2">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-xl bg-okbg border border-bdr2 flex items-center justify-center text-ok">
          <Clock size={18} />
        </div>
        <div>
          <h2 className="text-base font-bold text-tx tracking-tight">Số Ngày Lưu Trú</h2>
          <p className="text-xs text-mu">Phân bổ công nhân theo số ngày đã ở KTX</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={165}>
        <BarChart data={data} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr2)" vertical={false} opacity={0.6} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--mu)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--mu)' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" fill="var(--ok2)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
