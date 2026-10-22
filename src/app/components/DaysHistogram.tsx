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
      <div className="bg-gray-800/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-xl px-3 py-2 text-xs">
        <p className="font-bold text-white">{label} ngày</p>
        <p className="text-gray-300 mt-0.5">Số công nhân: <span className="font-tabular font-bold text-emerald-400">{payload[0].value}</span></p>
      </div>
    );
  }
  return null;
};

export default function DaysHistogram() {
  const { workers } = useWorkers();
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
    count: workers.filter(w => {
      const d = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
      return d !== null && d >= b.min && d <= b.max;
    }).length,
  }));

  return (
    <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl shadow-xl p-5 transition-all duration-200 hover:border-gray-600/80">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
          <Clock size={18} />
        </div>
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">Số Ngày Lưu Trú</h2>
          <p className="text-xs text-gray-400">Phân bổ công nhân theo số ngày đã ở KTX</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={165}>
        <BarChart data={data} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.6} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
