'use client';

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Printer,
  ShieldAlert,
  Wrench,
  TrendingUp,
  Layers,
} from 'lucide-react';
import type { OperationalRiskReport } from '@/lib/riskRadar';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { StatusTag } from '@/components/ui/StatusTag';

interface RiskCommandRadarProps {
  report: OperationalRiskReport;
  onPrintExecutiveA4: () => void;
}

export default function RiskCommandRadar({
  report,
  onPrintExecutiveA4,
}: RiskCommandRadarProps) {
  return (
    <div className="space-y-5">
      {/* Top Executive Action Strip */}
      <div className="surface-elevated rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-extrabold text-tx tracking-tight">
            Radar Rủi ro & Cảnh báo Điều hành Chủ động
          </h2>
          <p className="text-xs text-mu mt-0.5">
            Tổng hợp tự động các điểm nóng pháp lý tạm trú, dự báo cạn quỹ giường Nam/Nữ, sự cố kỹ thuật lặp lại và an ninh kỷ luật.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            href="/bed-management?action=consolidate"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surf border border-bdr2 text-tx text-xs font-semibold hover:bg-act transition-colors whitespace-nowrap"
          >
            <Layers size={14} className="text-pri2" />
            <span>Dồn phòng thông minh</span>
          </Link>
          <button
            type="button"
            onClick={onPrintExecutiveA4}
            className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Printer size={14} />
            <span>Xuất Báo cáo Trình ký A4</span>
          </button>
        </div>
      </div>

      {/* 3 Severity Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="surface-elevated rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-dgr">Cảnh báo Nguy cấp</p>
            <p className="text-2xl font-extrabold text-dgr font-tabular mt-1">{report.counts.critical}</p>
            <p className="text-xs text-mu mt-0.5">Cần xử lý ngay trong ngày</p>
          </div>
          <AlertTriangle size={22} className="text-dgr opacity-80" />
        </div>
        <div className="surface-elevated rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-wn">Ưu tiên Cao</p>
            <p className="text-2xl font-extrabold text-wn font-tabular mt-1">{report.counts.high}</p>
            <p className="text-xs text-mu mt-0.5">Cần điều phối trong 48 giờ</p>
          </div>
          <ShieldAlert size={22} className="text-wn opacity-80" />
        </div>
        <div className="surface-elevated rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-lnk">Điểm cần tối ưu</p>
            <p className="text-2xl font-extrabold text-tx font-tabular mt-1">{report.counts.medium}</p>
            <p className="text-xs text-mu mt-0.5">Phòng thưa & chuẩn hóa hồ sơ</p>
          </div>
          <TrendingUp size={22} className="text-pri2 opacity-80" />
        </div>
      </div>

      {/* Gender Capacity Runway Forecast */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {report.runway.map(item => {
          const pct =
            item.estimatedCapacity > 0
              ? Math.min(100, Math.round((item.occupied / item.estimatedCapacity) * 100))
              : 0;
          return (
            <div key={item.gender} className="surface-elevated rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-tx">{item.label}</h3>
                  <p className="text-xs text-mu">
                    Tốc độ nhập 14 ngày qua: <strong className="text-tx font-tabular">+{item.recent14dInflow}</strong> người ({item.avgDailyInflow}/ngày)
                  </p>
                </div>
                <StatusTag
                  tone={item.status === 'critical' ? 'rose' : item.status === 'watch' ? 'amber' : 'teal'}
                  size="sm"
                >
                  {item.estimatedDaysRemaining !== null
                    ? `Dự báo kín sau ~${item.estimatedDaysRemaining} ngày`
                    : item.status === 'critical'
                    ? 'Sắp hết chỗ'
                    : 'Ổn định'}
                </StatusTag>
              </div>
              <div className="w-full h-2 rounded-full bg-act overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    item.status === 'critical'
                      ? 'bg-dgr'
                      : item.status === 'watch'
                      ? 'bg-wn'
                      : 'bg-pri2'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-mu font-tabular">
                <span>
                  Đang ở: <strong className="text-tx">{item.occupied.toLocaleString('vi-VN')}</strong> / {item.estimatedCapacity.toLocaleString('vi-VN')} ({pct}%)
                </span>
                <span>
                  Còn trống: <strong className="text-ok">{item.vacant.toLocaleString('vi-VN')} chỗ</strong>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Priority Risk Feed */}
      <div className="surface-elevated rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-bdr flex items-center justify-between">
          <h3 className="text-sm font-bold text-tx">Danh sách Điểm nóng Ưu tiên Xử lý</h3>
          <span className="text-xs text-mu font-tabular">{report.counts.total} hạng mục</span>
        </div>

        {report.risks.length === 0 ? (
          <div className="py-12 text-center space-y-2 px-4">
            <CheckCircle2 size={32} className="mx-auto text-ok opacity-85" />
            <p className="text-sm font-bold text-tx">Hệ thống vận hành ổn định, không có rủi ro nghiêm trọng</p>
            <p className="text-xs text-mu">Tạm trú, quỹ giường, an ninh kỷ luật và bảo trì kỹ thuật đều đang nằm trong ngưỡng an toàn.</p>
          </div>
        ) : (
          <div className="divide-y divide-bdr">
            {report.risks.map(risk => (
              <div
                key={risk.id}
                className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-act/30 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusTag
                      tone={risk.severity === 'critical' ? 'rose' : risk.severity === 'high' ? 'amber' : 'blue'}
                      size="sm"
                    >
                      {risk.severity === 'critical' ? 'Nguy cấp' : risk.severity === 'high' ? 'Ưu tiên cao' : 'Cần tối ưu'}
                    </StatusTag>
                    <span className="text-xs text-mu">{risk.categoryLabel}</span>
                    <span className="text-mu">·</span>
                    <span className="text-xs font-bold font-tabular text-tx">{risk.metricValue}</span>
                  </div>
                  <p className="text-sm font-bold text-tx">{risk.title}</p>
                  <p className="text-xs text-mu leading-relaxed">{risk.detail}</p>
                </div>

                <Link
                  href={risk.href}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surf border border-bdr2 text-xs font-semibold text-lnk hover:bg-act transition-colors shrink-0 self-start sm:self-center whitespace-nowrap"
                >
                  <span>{risk.actionLabel}</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Repeat-Failure Maintenance Rooms */}
      {report.repeatFailureRooms.length > 0 && (
        <div className="surface-elevated rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-bdr flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench size={15} className="text-wn" />
              <h3 className="text-sm font-bold text-tx">Phòng phát sinh sự cố lặp lại (30 ngày qua)</h3>
            </div>
            <Link href="/maintenance" className="text-xs font-semibold text-lnk hover:underline">
              Mở Trung tâm Kỹ thuật →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-act text-mu uppercase tracking-wider text-[11px] font-bold border-b border-bdr2">
                <tr>
                  <th className="px-4 py-2.5">Khu / Dãy / Phòng</th>
                  <th className="px-4 py-2.5 text-right">Số lần báo hỏng (30 ngày)</th>
                  <th className="px-4 py-2.5 text-right">Đang chưa xong</th>
                  <th className="px-4 py-2.5">Hạng mục gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bdr">
                {report.repeatFailureRooms.slice(0, 8).map((r, i) => (
                  <tr key={`${r.ktx}-${r.day}-${r.room}-${i}`} className="hover:bg-act/40">
                    <td className="px-4 py-2.5 font-semibold text-tx">
                      {r.ktx} · {r.day} · {formatRoomDisplay(r.room)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-tabular font-bold text-dgr">
                      {r.ticketCount30d} lần
                    </td>
                    <td className="px-4 py-2.5 text-right font-tabular text-tx">{r.openCount}</td>
                    <td className="px-4 py-2.5 text-mu">{r.latestCategory}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
