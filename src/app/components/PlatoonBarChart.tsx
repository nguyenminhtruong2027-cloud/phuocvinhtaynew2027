'use client';
import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useWorkers } from '@/context/WorkerContext';
import { getUniquePlatoons, getUniqueBuildings } from '@/data/workers';
import { Building2 } from 'lucide-react';

const COLORS = [
  '#3B82F6', // Blue 500
  '#10B981', // Emerald 500
  '#06B6D4', // Cyan 500
  '#8B5CF6', // Purple 500
  '#F59E0B', // Amber 500
  '#EC4899', // Pink 500
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-800/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-xl p-3 text-xs z-50">
        <p className="font-bold text-white mb-1.5 pb-1 border-b border-gray-700">{label}</p>
        <div className="space-y-1">
          {payload.map((p, i) => (
            <div key={`tt-${i}`} className="flex items-center justify-between gap-4">
              <span className="text-gray-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || COLORS[i % COLORS.length] }} />
                {p.name}:
              </span>
              <span className="font-tabular font-bold text-white">{p.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function PlatoonBarChart() {
  const { workers } = useWorkers();

  const platoons = useMemo(() => getUniquePlatoons(workers), [workers]);
  const buildings = useMemo(() => getUniqueBuildings(workers), [workers]);

  const data = useMemo(() => {
    const platoonList = platoons.length > 0 ? platoons : ['8', '111', '113'];
    return platoonList.map(td => {
      const entry: Record<string, string | number> = { name: `Tiểu Đoàn ${td}` };
      buildings.forEach(b => {
        entry[b] = workers.filter(w => w.tieuDoan === td && w.day === b).length;
      });
      return entry;
    });
  }, [workers, platoons, buildings]);

  const displayBuildings = buildings.length > 0 ? buildings : ['Dãy 3', 'Dãy 4'];

  return (
    <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl shadow-xl p-5 transition-all duration-200 hover:border-gray-600/80">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Building2 size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Phân Bổ Theo Tiểu Đoàn</h2>
            <p className="text-xs text-gray-400">Số công nhân mỗi tiểu đoàn theo dãy nhà</p>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} barGap={4} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.6} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: '#D1D5DB', paddingTop: '8px' }}
            formatter={(value) => <span className="text-gray-300 text-xs font-medium">{value}</span>}
          />
          {displayBuildings.map((b, i) => (
            <Bar
              key={b}
              dataKey={b}
              fill={COLORS[i % COLORS.length]}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
