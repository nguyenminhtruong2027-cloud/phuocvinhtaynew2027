'use client';
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { getProfileStatus } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';

export default function DataQualityAlert() {
  const { workers } = useWorkers();
  const missingCCCD = workers?.filter(w => !w?.cccd)?.length;
  const missingEntry = workers?.filter(w => !w?.ngayVaoKTX)?.length;
  const pendingCode = workers?.filter(w => w?.maNV === 'Chờ mã' || w?.maNV === 'Chờ Mã' || w?.maNV === '')?.length;
  const noRoom = workers?.filter(w => getProfileStatus(w) === 'no_room')?.length;

  return (
    <div className="mb-5 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
      <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-800">Dữ liệu cần bổ sung</p>
        <p className="text-xs text-amber-700 mt-0.5">
          {missingCCCD} thiếu CCCD · {missingEntry} thiếu ngày vào · {pendingCode} chờ mã NV · {noRoom} chưa phân phòng
        </p>
      </div>
      <a href="/worker-management" className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline flex-shrink-0">
        Xem danh sách
      </a>
    </div>
  );
}