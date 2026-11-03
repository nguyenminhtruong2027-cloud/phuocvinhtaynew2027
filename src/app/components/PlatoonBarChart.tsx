'use client';
import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useWorkers } from '@/context/WorkerContext';
import { getUniquePlatoons, getUniqueBuildings } from '@/data/workers';
import { Building2 } from 'lucide-react';

const COLORS = [
  'var(--pri2)',
  'var(--ok2)',
  'var(--lnk)',
  'var(--wn)',
  'var(--ic)',
  'var(--mu)',
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surf border border-bdr2 rounded-xl shadow-modal p-3 text-xs z-50">
        <p className="font-bold text-tx mb-1.5 pb-1 border-b border-bdr">{label}</p>
        <div className="space-y-1">
          {payload.map((p, i) => (
            <div key={`tt-${i}`} className="flex items-center justify-between gap-4">
              <span className="text-mu flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || COLORS[i % COLORS.length] }} />
                {p.name}:
              </span>
              <span className="font-tabular font-bold text-tx">{p.value}</span>
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

  const platoons = useMemo(() => getUniquePlatoons(workers || []), [workers]);
  const buildings = useMemo(() => getUniqueBuildings(workers || []), [workers]);

  const data = useMemo(() => {
    const platoonList = platoons || [];
    const safeWorkers = workers || [];
    return platoonList.map(td => {
      const entry: Record<string, string | number> = { name: `Tiểu Đoàn ${td}` };
      buildings.forEach(b => {
        entry[b] = safeWorkers.filter(w => w?.tieuDoan === td && w?.day === b).length;
      });
      return entry;
    });
  }, [workers, platoons, buildings]);

  const displayBuildings = buildings || [];

  return (
    <div className="bg-surf border border-bdr rounded-2xl shadow-xl p-5 transition-all duration-200 hover:border-bdr2">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk">
            <Building2 size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-tx tracking-tight">Phân Bổ Theo Tiểu Đoàn</h2>
            <p className="text-xs text-mu">Số công nhân mỗi tiểu đoàn theo dãy nhà</p>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} barGap={4} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr2)" vertical={false} opacity={0.6} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--mu)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--mu)' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'var(--nav)', paddingTop: '8px' }}
            formatter={(value) => <span className="text-mu text-xs font-medium">{value}</span>}
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
