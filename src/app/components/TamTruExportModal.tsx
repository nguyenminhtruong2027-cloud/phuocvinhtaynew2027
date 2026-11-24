'use client';

import React, { useMemo, useState } from 'react';
import { X, FileSpreadsheet, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Worker } from '@/data/workers';
import {
  TamTruExportScope,
  exportTamTruDeclaration,
  filterWorkersForTamTru,
} from '@/lib/tamTruExport';

interface Props {
  workers: Worker[];
  ktxFilter?: string;
  onClose: () => void;
}

const SCOPES: Array<{
  id: TamTruExportScope;
  label: string;
  desc: string;
  tone: 'warning' | 'danger' | 'info' | 'neutral';
}> = [
  {
    id: 'unregistered',
    label: 'Chưa đăng ký tạm trú',
    desc: 'Tất cả công nhân đang lưu trú nhưng chưa hoàn tất khai báo tạm trú',
    tone: 'warning',
  },
  {
    id: 'overdue',
    label: 'Quá hạn tạm trú (> 7 ngày)',
    desc: 'Ưu tiên nộp gấp cho Công an xã các trường hợp vào KTX quá 7 ngày chưa ĐK',
    tone: 'danger',
  },
  {
    id: 'today',
    label: 'Công nhân vào mới hôm nay',
    desc: 'Danh sách tiếp nhận trong ngày để khai báo tạm trú định kỳ hàng ngày',
    tone: 'info',
  },
  {
    id: 'all',
    label: 'Toàn bộ công nhân đang lưu trú',
    desc: 'Xuất đầy đủ danh sách nhân khẩu lưu trú hiện tại để đối chiếu định kỳ',
    tone: 'neutral',
  },
];

export default function TamTruExportModal({ workers, ktxFilter, onClose }: Props) {
  const [scope, setScope] = useState<TamTruExportScope>('unregistered');

  const counts = useMemo(() => {
    return {
      unregistered: filterWorkersForTamTru(workers, 'unregistered', ktxFilter).length,
      overdue: filterWorkersForTamTru(workers, 'overdue', ktxFilter).length,
      today: filterWorkersForTamTru(workers, 'today', ktxFilter).length,
      all: filterWorkersForTamTru(workers, 'all', ktxFilter).length,
    };
  }, [workers, ktxFilter]);

  const selectedCount = counts[scope];

  const handleExport = () => {
    const res = exportTamTruDeclaration(workers, scope, ktxFilter);
    if (!res.ok) {
      toast.warning('Không có công nhân nào phù hợp trong nhóm đã chọn để xuất file.');
      return;
    }
    toast.success(`Đã xuất danh sách khai báo tạm trú (${res.count} công nhân).`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-side">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-okbg text-ok border border-ok2/30 flex items-center justify-center shrink-0">
              <FileSpreadsheet size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                Xuất danh sách Khai báo Tạm trú
              </h3>
              <p className="text-xs text-mu mt-0.5">
                Chuẩn cột nộp Công an địa phương · Tự động sắp theo Dãy & Phòng
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-2.5">
          {SCOPES.map(item => {
            const active = scope === item.id;
            const c = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setScope(item.id)}
                className={`w-full p-3.5 rounded-xl border text-left transition-colors cursor-pointer flex items-start justify-between gap-3 ${
                  active
                    ? 'bg-bdg border-pri2'
                    : 'bg-page border-bdr hover:bg-act/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold text-tx">
                    {active ? (
                      <CheckCircle2 size={15} className="text-lnk shrink-0" />
                    ) : item.tone === 'danger' && c > 0 ? (
                      <AlertTriangle size={15} className="text-dgr shrink-0" />
                    ) : null}
                    <span>{item.label}</span>
                  </div>
                  <p className="text-xs text-mu mt-0.5">{item.desc}</p>
                </div>
                <span
                  className={`font-mono tabular-nums text-sm font-extrabold shrink-0 ${
                    item.tone === 'danger' && c > 0
                      ? 'text-dgr'
                      : item.tone === 'warning' && c > 0
                      ? 'text-wn'
                      : 'text-tx'
                  }`}
                >
                  {c.toLocaleString('vi-VN')}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3.5 border-t border-bdr bg-side flex items-center justify-between gap-2">
          <span className="text-xs text-mu tabular-nums">
            Số dòng xuất: <strong className="text-tx">{selectedCount}</strong> công nhân
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <Download size={14} />
              <span>Xuất Excel (.xlsx)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
