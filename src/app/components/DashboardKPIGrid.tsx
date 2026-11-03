'use client';
import React from 'react';
import { Users, Building2, Shield, AlertCircle, Calendar } from 'lucide-react';
import { calcSoNgay, getProfileStatus } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';
import Icon from '@/components/ui/AppIcon';



function StatCard({
  label, value, sub, icon: Icon, color, alert, span2,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string; alert?: boolean; span2?: boolean;
}) {
  return (
    <div className={`card p-5 flex flex-col gap-3 ${alert ? 'border-dgr bg-dgrbg' : ''} ${span2 ? 'md:col-span-2' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <div>
        <p className={`font-tabular font-bold ${alert ? 'text-dgr' : 'text-foreground'} ${span2 ? 'metric-value-lg' : 'metric-value'}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardKPIGrid() {
  const { workers, totalWorkerCount } = useWorkers();
  // Use totalWorkerCount (exact DB count) for the main KPI card — accurate even for 6000+ records
  const total = totalWorkerCount > 0 ? totalWorkerCount : workers.length;
  const buildingCounts = workers.reduce<Record<string, number>>((acc, w) => {
    if (!w.day) return acc;
    const key = w.ktx ? `${w.ktx} · ${w.day}` : w.day;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const platoonCounts = workers.reduce<Record<string, number>>((acc, w) => {
    if (w.tieuDoan) acc[w.tieuDoan] = (acc[w.tieuDoan] || 0) + 1;
    return acc;
  }, {});
  const missingData = workers.filter(w => getProfileStatus(w) !== 'full').length;
  const newThisWeek = workers.filter(w => {
    const days = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
    return days !== null && days <= 7;
  }).length;

  const buildings = Object.entries(buildingCounts);
  const platoons = Object.entries(platoonCounts).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard label="Tổng Công Nhân" value={total.toLocaleString('vi-VN')} sub={`${buildings.length} dãy nhà`} icon={Users} color="bg-primary" span2 />
      {buildings.slice(0, 2).map(([day, count]) => (
        <StatCard key={day} label={day} value={count} sub={`${total > 0 ? ((count / total) * 100).toFixed(0) : 0}% tổng số`} icon={Building2} color={day.includes('3') ? 'bg-pri2' : 'bg-bdg'} />
      ))}
      {platoons.map(([td, count]) => (
        <StatCard key={td} label={`Tiểu Đoàn ${td}`} value={count} sub="Đơn vị XD" icon={Shield} color={td === '8' ? 'bg-bdg' : td === '111' ? 'bg-bdg' : 'bg-ok2'} />
      ))}
      <StatCard label="Thiếu Dữ Liệu" value={missingData} sub="Cần bổ sung hồ sơ" icon={AlertCircle} color="bg-dgr" alert />
      <StatCard label="Mới Vào Tuần Này" value={newThisWeek} sub="Trong 7 ngày qua" icon={Calendar} color="bg-wn" />
    </div>
  );
}