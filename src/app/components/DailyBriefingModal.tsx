'use client';

import React, { useMemo, useState } from 'react';
import { X, Copy, Check, Printer, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  DailyBriefingInput,
  buildZaloDailyBriefing,
  buildPrintableDailyBriefingHtml,
} from '@/lib/dailyBriefing';
import { printHtmlViaIframe } from '@/lib/printHtml';

interface Props {
  data: DailyBriefingInput;
  onClose: () => void;
}

export default function DailyBriefingModal({ data, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const zaloText = useMemo(() => buildZaloDailyBriefing(data), [data]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(zaloText);
      setCopied(true);
      toast.success('Đã sao chép bản tin giao ban — sẵn sàng dán vào Zalo Ban Chỉ Huy!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Trình duyệt chặn tự động sao chép, vui lòng bôi đen và nhấn Ctrl+C.');
    }
  };

  const handlePrintPdf = () => {
    const html = buildPrintableDailyBriefingHtml(data);
    const ok = printHtmlViaIframe(html);
    if (!ok) {
      toast.error('Không thể mở hộp thoại in báo cáo.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-side">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-bdg text-lnk flex items-center justify-center shrink-0">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                Bản tin Giao ban cuối ngày
              </h3>
              <p className="text-xs text-mu mt-0.5">
                Tự động tổng hợp từ dữ liệu thực tế · Copy gửi Zalo hoặc in PDF 1 trang
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          <pre className="w-full p-4 rounded-xl bg-page border border-bdr text-xs sm:text-[13px] text-tx font-mono whitespace-pre-wrap leading-relaxed select-all">
            {zaloText}
          </pre>
        </div>

        <div className="px-5 py-3.5 border-t border-bdr bg-side flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-act hover:bg-act/80 border border-bdr text-xs font-semibold text-mu hover:text-tx transition-colors cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs font-bold text-tx transition-colors cursor-pointer"
          >
            <Printer size={14} />
            <span>In báo cáo 1 trang (PDF)</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Đã sao chép Zalo' : 'Copy bản tin gửi Zalo'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
