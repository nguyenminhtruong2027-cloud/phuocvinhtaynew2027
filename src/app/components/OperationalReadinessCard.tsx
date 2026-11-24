'use client';

import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  EyeOff,
  ClipboardCheck,
  Wrench,
  Building2,
  Users,
  VenusAndMars,
  BedDouble,
} from 'lucide-react';

export interface ReadinessCheckItem {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  severity: 'ok' | 'warning' | 'info';
  actionLabel?: string;
  onAction?: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface Props {
  totalRooms: number;
  totalCapacity: number;
  roomsMissingEquipment: number;
  unassignedBuildingsCount: number;
  totalBuildings: number;
  genderLockedRoomsCount: number;
  missingWorkerDataCount: number;
  facilityIssuesCount: number;
  maintenanceBedsCount: number;
  activeMaintenanceTicketsCount?: number;
  onGoFacilities: () => void;
  onGoUserMgmt: () => void;
  onGoWorkers: () => void;
  onOpenBulkGender: () => void;
  onOpenMaintenance: () => void;
  onDismiss: () => void;
}

export default function OperationalReadinessCard({
  totalRooms,
  totalCapacity,
  roomsMissingEquipment,
  unassignedBuildingsCount,
  totalBuildings,
  genderLockedRoomsCount,
  missingWorkerDataCount,
  facilityIssuesCount,
  maintenanceBedsCount,
  activeMaintenanceTicketsCount = 0,
  onGoFacilities,
  onGoUserMgmt,
  onGoWorkers,
  onOpenBulkGender,
  onOpenMaintenance,
  onDismiss,
}: Props) {
  const totalIssues = facilityIssuesCount + maintenanceBedsCount + activeMaintenanceTicketsCount;

  const items: ReadinessCheckItem[] = [
    {
      id: 'structure',
      title: 'Cấu trúc phòng & sức chứa',
      detail: `${totalRooms} phòng ở · ${totalCapacity.toLocaleString('vi-VN')} chỗ (Chuẩn Vincons: 90 phòng / 1.800 chỗ)`,
      done: totalRooms >= 90 && totalCapacity >= 1800,
      severity: totalRooms >= 90 && totalCapacity >= 1800 ? 'ok' : 'warning',
      actionLabel: 'Kiểm tra CSVC',
      onAction: onGoFacilities,
      icon: BedDouble,
    },
    {
      id: 'equipment',
      title: 'Định mức thiết bị phòng ở',
      detail:
        roomsMissingEquipment === 0
          ? '100% phòng ở đã được khai báo định mức thiết bị'
          : `${roomsMissingEquipment}/${totalRooms} phòng đang để 0 điều hòa, tủ, quạt & đèn`,
      done: totalRooms > 0 && roomsMissingEquipment === 0,
      severity: roomsMissingEquipment === 0 ? 'ok' : 'warning',
      actionLabel: 'Áp định mức',
      onAction: onGoFacilities,
      icon: Building2,
    },
    {
      id: 'staff',
      title: 'Phân công chuyên viên phụ trách Dãy',
      detail:
        unassignedBuildingsCount === 0 && totalBuildings > 0
          ? `Đã phân công đầy đủ ${totalBuildings}/${totalBuildings} Dãy nhà`
          : `Còn ${unassignedBuildingsCount}/${totalBuildings} Dãy chưa gán chuyên viên phụ trách`,
      done: totalBuildings > 0 && unassignedBuildingsCount === 0,
      severity: unassignedBuildingsCount === 0 ? 'ok' : 'warning',
      actionLabel: 'Phân công',
      onAction: onGoUserMgmt,
      icon: Users,
    },
    {
      id: 'gender',
      title: 'Khóa công năng phòng Nam / Nữ',
      detail:
        genderLockedRoomsCount > 0
          ? `Đã khóa công năng giới tính cho ${genderLockedRoomsCount}/${totalRooms} phòng`
          : 'Chưa khóa công năng Nam/Nữ trước khi xếp quân (đang để Tự động)',
      done: genderLockedRoomsCount > 0,
      severity: genderLockedRoomsCount > 0 ? 'ok' : 'info',
      actionLabel: 'Gán hàng loạt',
      onAction: onOpenBulkGender,
      icon: VenusAndMars,
    },
    {
      id: 'quality-maintenance',
      title: 'Hồ sơ công nhân & Bảo trì CSVC',
      detail:
        missingWorkerDataCount === 0 && totalIssues === 0
          ? 'Không có hồ sơ thiếu phòng hoặc sự cố bảo trì tồn đọng'
          : `${missingWorkerDataCount} hồ sơ chưa xếp phòng · ${activeMaintenanceTicketsCount} phiếu QR · ${facilityIssuesCount} phòng CSVC · ${maintenanceBedsCount} giường bảo trì`,
      done: missingWorkerDataCount === 0 && totalIssues === 0,
      severity: missingWorkerDataCount === 0 && totalIssues === 0 ? 'ok' : 'warning',
      actionLabel: totalIssues > 0 ? 'Xem sự cố' : 'Xem hồ sơ',
      onAction: totalIssues > 0 ? onOpenMaintenance : onGoWorkers,
      icon: Wrench,
    },
  ];

  const completedCount = items.filter(i => i.done).length;
  const pct = Math.round((completedCount / items.length) * 100);

  return (
    <section className="rounded-2xl bg-surf border border-bdr p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-bdr">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-bdg text-lnk flex items-center justify-center shrink-0">
            <ClipboardCheck size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-tx leading-tight">
              Bảng kiểm sẵn sàng vận hành
            </h2>
            <p className="text-xs text-mu mt-0.5 tabular-nums">
              Hoàn tất {completedCount}/{items.length} hạng mục ({pct}%) · Tự động đối soát từ dữ liệu thực tế
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:block w-32 h-2 rounded-full bg-act overflow-hidden border border-bdr">
            <div
              className="h-full bg-pri transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-mu hover:text-tx hover:bg-act transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Ẩn bảng kiểm (có thể mở lại trên thanh công cụ)"
          >
            <EyeOff size={13} />
            <span>Ẩn bảng kiểm</span>
          </button>
        </div>
      </div>

      <div className="divide-y divide-bdr mt-1">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className={`mt-0.5 shrink-0 ${
                    item.done
                      ? 'text-ok'
                      : item.severity === 'warning'
                      ? 'text-wn'
                      : 'text-lnk'
                  }`}
                >
                  {item.done ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-tx">
                    <Icon size={13} className="text-mu shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </div>
                  <p className="text-xs text-mu mt-0.5 tabular-nums">{item.detail}</p>
                </div>
              </div>

              {item.onAction && item.actionLabel && (
                <button
                  type="button"
                  onClick={item.onAction}
                  className={`self-start sm:self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    item.done
                      ? 'bg-act text-mu hover:text-tx border border-bdr'
                      : 'bg-bdg text-lnk hover:opacity-90 border border-bdr2'
                  }`}
                >
                  <span>{item.actionLabel}</span>
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
