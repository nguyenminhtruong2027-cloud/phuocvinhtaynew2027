'use client';
import React from 'react';
import { calcSoNgay } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';
import { UserPlus, MapPin, Sparkles } from 'lucide-react';

export default function RecentEntriesFeed() {
  const { workers } = useWorkers();
  const recent = [...workers]?.filter(w => {
      const d = calcSoNgay(w?.ngayVaoKTX, w?.ngayRaKTX);
      return w?.ngayVaoKTX && d !== null && d <= 10;
    })?.sort((a, b) => {
      const da = calcSoNgay(a?.ngayVaoKTX, a?.ngayRaKTX) ?? 999;
      const db = calcSoNgay(b?.ngayVaoKTX, b?.ngayRaKTX) ?? 999;
      return da - db;
    })?.slice(0, 8);

  return (
    <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl shadow-xl p-5 h-full flex flex-col transition-all duration-200 hover:border-gray-600/80">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Mới Vào Gần Đây</h2>
            <p className="text-xs text-gray-400">Trong 10 ngày qua</p>
          </div>
        </div>
        <span className="text-xs bg-blue-500/20 border border-blue-500/30 text-blue-300 font-semibold px-2.5 py-1 rounded-full font-tabular">
          {recent?.length} người
        </span>
      </div>

      {recent?.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-2">
            <UserPlus size={22} className="text-gray-500" />
          </div>
          <p className="text-sm font-medium text-gray-300">Không có công nhân mới</p>
          <p className="text-xs text-gray-500 mt-1">Chưa có ai vào KTX trong 10 ngày qua</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {recent?.map(w => (
            <div
              key={w?.id}
              className="flex items-start gap-3 p-3 rounded-xl bg-gray-800/60 border border-gray-700/40 hover:bg-gray-700/60 hover:border-blue-500/40 transition-all duration-150 group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-blue-400 transition-colors duration-100">
                <UserPlus size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors whitespace-normal break-words leading-tight">
                  {w?.hoVaTen}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <MapPin size={11} className="text-gray-400 flex-shrink-0" />
                  <p className="text-xs text-gray-400 font-tabular whitespace-normal break-words">{w?.day} · Phòng {w?.phongSo}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-xs font-tabular font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                  {calcSoNgay(w?.ngayVaoKTX, w?.ngayRaKTX)} ngày
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
