'use client';

import type { Worker } from '@/data/workers';
import { DEFAULT_ROOM_CAPACITY, getProfileStatus } from '@/data/workers';
import {
  FacilityItem,
  formatRoomDisplay,
  getRoomCapacity,
  normalizeRoomLabel,
  RoomCapacityMap,
} from '@/lib/facilityCapacity';
import { getRoomGenderInfo, normalizeGender } from '@/lib/roomGender';
import { daysSinceVN } from '@/lib/vnDate';
import type { MaintenanceTicket } from '@/lib/maintenanceTickets';
import { getTicketSlaStatus } from '@/lib/maintenanceTickets';
import type { BlacklistRecord, DisciplineRecord } from '@/lib/disciplineService';
import { isBlacklistRecordEffective } from '@/lib/disciplineService';

export type RiskSeverity = 'critical' | 'high' | 'medium';

export interface OperationalRiskItem {
  id: string;
  severity: RiskSeverity;
  category: 'legal' | 'capacity' | 'maintenance' | 'security' | 'data';
  categoryLabel: string;
  title: string;
  detail: string;
  metricValue: string;
  actionLabel: string;
  href: string;
}

export interface GenderRunwayForecast {
  gender: 'male' | 'female';
  label: string;
  occupied: number;
  estimatedCapacity: number;
  vacant: number;
  recent14dInflow: number;
  avgDailyInflow: number;
  estimatedDaysRemaining: number | null; // null if inflow == 0
  status: 'safe' | 'watch' | 'critical';
}

export interface RepeatFailureRoom {
  ktx: string;
  day: string;
  room: string;
  ticketCount30d: number;
  openCount: number;
  latestCategory: string;
}

export interface OperationalRiskReport {
  risks: OperationalRiskItem[];
  counts: {
    critical: number;
    high: number;
    medium: number;
    total: number;
  };
  runway: GenderRunwayForecast[];
  repeatFailureRooms: RepeatFailureRoom[];
  sparseRoomsCount: number;
  overdueTamTruCount: number;
  approachingTamTruCount: number;
  incompleteProfilesCount: number;
  activeBlacklistCount: number;
  recent30dDisciplinesCount: number;
  overdueSlaCount: number;
}

export function computeOperationalRisks(input: {
  workers: Worker[];
  facilities: FacilityItem[];
  capacities: RoomCapacityMap;
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>;
  tickets: MaintenanceTicket[];
  disciplines: DisciplineRecord[];
  blacklist: BlacklistRecord[];
  ktxFilter?: string;
}): OperationalRiskReport {
  const {
    workers,
    facilities,
    capacities,
    roomGenderMap,
    tickets,
    disciplines,
    blacklist,
    ktxFilter,
  } = input;

  const activeWorkers = workers.filter(w => {
    if (
      w.ngayRaKTX ||
      w.ghiChu?.includes('[Đã Check-out') ||
      w.ghiChu?.includes('[CHECKOUT]')
    ) {
      return false;
    }
    if (ktxFilter && ktxFilter !== 'all' && (w.ktx || '').trim() !== ktxFilter.trim()) {
      return false;
    }
    return true;
  });

  const scopedFacilities = facilities.filter(f => {
    if (ktxFilter && ktxFilter !== 'all' && (f.ktx || '').trim() !== ktxFilter.trim()) {
      return false;
    }
    return true;
  });

  const scopedTickets = tickets.filter(t => {
    if (ktxFilter && ktxFilter !== 'all' && (t.ktx || '').trim() !== ktxFilter.trim()) {
      return false;
    }
    return true;
  });

  const risks: OperationalRiskItem[] = [];

  // 1. Temporary residence compliance (Legal risk)
  let overdueTamTruCount = 0;
  let approachingTamTruCount = 0;
  let incompleteProfilesCount = 0;
  let male14d = 0;
  let female14d = 0;

  activeWorkers.forEach(w => {
    const stayDays = daysSinceVN(w.ngayVaoKTX || w.createdAt);
    if (w.tamTruStatus !== 'registered' && stayDays !== null) {
      if (stayDays > 7) overdueTamTruCount++;
      else if (stayDays >= 5) approachingTamTruCount++;
    }
    if (getProfileStatus(w) === 'incomplete') {
      incompleteProfilesCount++;
    }
    if (stayDays !== null && stayDays >= 0 && stayDays <= 14) {
      const g = normalizeGender(w.gioiTinh);
      if (g === 'nam') male14d++;
      else if (g === 'nu') female14d++;
    }
  });

  if (overdueTamTruCount > 0) {
    risks.push({
      id: 'tamtru-overdue',
      severity: 'critical',
      category: 'legal',
      categoryLabel: 'Pháp lý tạm trú',
      title: `${overdueTamTruCount} công nhân quá hạn 7 ngày chưa khai báo tạm trú`,
      detail: 'Nguy cơ bị xử phạt hành chính khi Công an địa phương kiểm tra đột xuất. Cần xuất file khai báo và nộp ngay.',
      metricValue: `${overdueTamTruCount} hồ sơ`,
      actionLabel: 'Lọc hồ sơ quá hạn',
      href: '/worker-management?tamTru=unregistered',
    });
  }

  if (approachingTamTruCount > 0) {
    risks.push({
      id: 'tamtru-approaching',
      severity: 'high',
      category: 'legal',
      categoryLabel: 'Pháp lý tạm trú',
      title: `${approachingTamTruCount} công nhân sắp chạm mốc 7 ngày tạm trú (ngày 5–7)`,
      detail: 'Cần đôn đốc thu thập CCCD và chốt khai báo trong 48 giờ tới trước khi chuyển sang quá hạn.',
      metricValue: `${approachingTamTruCount} hồ sơ`,
      actionLabel: 'Xem danh sách',
      href: '/worker-management?tamTru=unregistered',
    });
  }

  // 2. Room occupancy, gender mixing, overload, fragmentation & gender capacity runway
  const workersByRoom = new Map<string, Worker[]>();
  activeWorkers.forEach(w => {
    if (!w.ktx || !w.day || !w.phongSo) return;
    const key = `${w.ktx.trim()}||${w.day.trim()}||${normalizeRoomLabel(w.phongSo)}`;
    if (!workersByRoom.has(key)) workersByRoom.set(key, []);
    workersByRoom.get(key)!.push(w);
  });

  const normalizedGenderLabels = new Map<string, 'male' | 'female'>();
  Object.entries(roomGenderMap).forEach(([rawKey, val]) => {
    if (val !== 'male' && val !== 'female') return;
    const parts = rawKey.split('||');
    if (parts.length === 3) {
      normalizedGenderLabels.set(
        `${parts[0].trim()}||${parts[1].trim()}||${normalizeRoomLabel(parts[2])}`,
        val
      );
    }
  });

  const allRoomKeys = new Set<string>(workersByRoom.keys());
  scopedFacilities.forEach(f => {
    if (f.ktx && f.day && f.phong) {
      allRoomKeys.add(`${f.ktx.trim()}||${f.day.trim()}||${normalizeRoomLabel(f.phong)}`);
    }
  });

  let overloadedRoomsCount = 0;
  let mixedGenderRoomsCount = 0;
  let sparseRoomsCount = 0;
  let maleCap = 0;
  let femaleCap = 0;
  let neutralEmptyCap = 0;
  let maleOccupied = 0;
  let femaleOccupied = 0;

  allRoomKeys.forEach(key => {
    const [ktx, day, room] = key.split('||');
    const roomWorkers = workersByRoom.get(key) || [];
    const cap = getRoomCapacity(capacities, ktx, day, room) || DEFAULT_ROOM_CAPACITY;
    const adminLabel = normalizedGenderLabels.get(key);
    const adminStr = adminLabel === 'male' ? 'Nam' : adminLabel === 'female' ? 'Nữ' : null;
    const gInfo = getRoomGenderInfo(roomWorkers, adminStr);

    if (roomWorkers.length > cap) overloadedRoomsCount++;
    if (gInfo.gender === 'mixed') mixedGenderRoomsCount++;
    if (roomWorkers.length > 0 && roomWorkers.length / Math.max(1, cap) <= 0.35) {
      sparseRoomsCount++;
    }

    if (gInfo.gender === 'male') {
      maleCap += cap;
      maleOccupied += roomWorkers.length;
    } else if (gInfo.gender === 'female') {
      femaleCap += cap;
      femaleOccupied += roomWorkers.length;
    } else if (gInfo.gender === 'empty') {
      neutralEmptyCap += cap;
    } else {
      maleCap += Math.ceil(cap / 2);
      femaleCap += Math.floor(cap / 2);
      maleOccupied += gInfo.maleCount;
      femaleOccupied += gInfo.femaleCount;
    }
  });

  // Allocate neutral empty capacity proportionally when estimating gender runway
  const totalAssigned = maleCap + femaleCap;
  const maleShare = totalAssigned > 0 ? maleCap / totalAssigned : 0.75;
  const estMaleCap = Math.round(maleCap + neutralEmptyCap * maleShare);
  const estFemaleCap = Math.round(femaleCap + neutralEmptyCap * (1 - maleShare));

  const buildRunway = (
    gender: 'male' | 'female',
    label: string,
    occupied: number,
    estimatedCapacity: number,
    inflow14d: number
  ): GenderRunwayForecast => {
    const vacant = Math.max(0, estimatedCapacity - occupied);
    const avgDailyInflow = Number((inflow14d / 14).toFixed(1));
    const estimatedDaysRemaining =
      avgDailyInflow > 0 ? Math.max(0, Math.round(vacant / avgDailyInflow)) : null;
    const fillPct = estimatedCapacity > 0 ? (occupied / estimatedCapacity) * 100 : 0;
    const status: 'safe' | 'watch' | 'critical' =
      (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 7) || fillPct >= 92
        ? 'critical'
        : (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 21) || fillPct >= 82
        ? 'watch'
        : 'safe';
    return {
      gender,
      label,
      occupied,
      estimatedCapacity,
      vacant,
      recent14dInflow: inflow14d,
      avgDailyInflow,
      estimatedDaysRemaining,
      status,
    };
  };

  const runway: GenderRunwayForecast[] = [
    buildRunway('male', 'Quỹ giường Nam', maleOccupied, estMaleCap, male14d),
    buildRunway('female', 'Quỹ giường Nữ', femaleOccupied, estFemaleCap, female14d),
  ];

  runway.forEach(r => {
    if (r.status === 'critical') {
      risks.push({
        id: `runway-${r.gender}`,
        severity: 'critical',
        category: 'capacity',
        categoryLabel: 'Dự báo quỹ giường',
        title: `${r.label} sắp cạn kiệt (còn ${r.vacant} chỗ trống)`,
        detail:
          r.estimatedDaysRemaining !== null
            ? `Với tốc độ vào trung bình +${r.avgDailyInflow} người/ngày (14 ngày qua), dự kiến kín giường sau ~${r.estimatedDaysRemaining} ngày.`
            : `Tỷ lệ lấp đầy đã vượt ngưỡng 92%. Cần lên phương án mở thêm phòng hoặc dồn phòng.`,
        metricValue: r.estimatedDaysRemaining !== null ? `~${r.estimatedDaysRemaining} ngày` : `Còn ${r.vacant} chỗ`,
        actionLabel: 'Mở Quản lý Giường',
        href: '/bed-management',
      });
    } else if (r.status === 'watch') {
      risks.push({
        id: `runway-${r.gender}`,
        severity: 'high',
        category: 'capacity',
        categoryLabel: 'Dự báo quỹ giường',
        title: `${r.label} đang tiệm cận ngưỡng cao (còn ${r.vacant} chỗ)`,
        detail:
          r.estimatedDaysRemaining !== null
            ? `Tốc độ tăng quân +${r.avgDailyInflow} người/ngày — dự báo lấp đầy trong khoảng ${r.estimatedDaysRemaining} ngày.`
            : 'Nên chủ động rà soát phòng thưa để chuẩn bị quỹ phòng đón đợt quân mới.',
        metricValue: r.estimatedDaysRemaining !== null ? `~${r.estimatedDaysRemaining} ngày` : `Còn ${r.vacant} chỗ`,
        actionLabel: 'Xem sơ đồ giường',
        href: '/bed-management',
      });
    }
  });

  if (mixedGenderRoomsCount > 0) {
    risks.push({
      id: 'mixed-gender-rooms',
      severity: 'critical',
      category: 'security',
      categoryLabel: 'An toàn bố trí',
      title: `Phát hiện ${mixedGenderRoomsCount} phòng đang có cả Nam & Nữ ở chung`,
      detail: 'Cần kiểm tra lại hồ sơ giới tính hoặc điều chuyển phòng ngay để đảm bảo nội quy KTX.',
      metricValue: `${mixedGenderRoomsCount} phòng`,
      actionLabel: 'Kiểm tra ngay',
      href: '/bed-management',
    });
  }

  if (overloadedRoomsCount > 0) {
    risks.push({
      id: 'overloaded-rooms',
      severity: 'high',
      category: 'capacity',
      categoryLabel: 'Quá tải sức chứa',
      title: `${overloadedRoomsCount} phòng đang vượt định mức giường thiết kế`,
      detail: 'Ảnh hưởng điều kiện sinh hoạt và an toàn PCCC. Nên phân bổ sang các phòng còn trống.',
      metricValue: `${overloadedRoomsCount} phòng`,
      actionLabel: 'Xem phòng quá tải',
      href: '/bed-management',
    });
  }

  if (sparseRoomsCount >= 3) {
    risks.push({
      id: 'fragmented-rooms',
      severity: 'medium',
      category: 'capacity',
      categoryLabel: 'Tối ưu quỹ phòng',
      title: `${sparseRoomsCount} phòng đang ở thưa (≤ 35% công suất)`,
      detail: 'Quân số nằm rải rác gây tốn điện quạt và thiếu phòng trống nguyên căn đón đoàn mới. Nên chạy Dồn phòng thông minh.',
      metricValue: `${sparseRoomsCount} phòng thưa`,
      actionLabel: 'Dồn phòng thông minh',
      href: '/bed-management?action=consolidate',
    });
  }

  // 3. Maintenance SLA & Repeat-Failure Rooms (30 days)
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  let overdueSlaCount = 0;
  const ticketsByRoom30d = new Map<
    string,
    { ktx: string; day: string; room: string; count: number; openCount: number; latestCategory: string }
  >();

  scopedTickets.forEach(t => {
    if (getTicketSlaStatus(t).state === 'overdue') overdueSlaCount++;
    const ts = new Date(t.created_at).getTime();
    if (!Number.isNaN(ts) && ts >= thirtyDaysAgo) {
      const normRoom = normalizeRoomLabel(t.phong_so);
      const key = `${(t.ktx || '').trim()}||${(t.day || '').trim()}||${normRoom}`;
      const cur = ticketsByRoom30d.get(key) || {
        ktx: t.ktx || '',
        day: t.day || '',
        room: normRoom,
        count: 0,
        openCount: 0,
        latestCategory: t.category,
      };
      cur.count++;
      if (t.status === 'open' || t.status === 'in_progress') cur.openCount++;
      ticketsByRoom30d.set(key, cur);
    }
  });

  const repeatFailureRooms: RepeatFailureRoom[] = Array.from(ticketsByRoom30d.values())
    .filter(r => r.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map(r => ({
      ktx: r.ktx,
      day: r.day,
      room: r.room,
      ticketCount30d: r.count,
      openCount: r.openCount,
      latestCategory: r.latestCategory,
    }));

  if (overdueSlaCount > 0) {
    risks.push({
      id: 'maintenance-sla-overdue',
      severity: 'critical',
      category: 'maintenance',
      categoryLabel: 'Bảo trì & SLA',
      title: `${overdueSlaCount} phiếu báo hỏng kỹ thuật đã quá hạn SLA`,
      detail: 'Phiếu Khẩn cấp quá 2 giờ hoặc phiếu Thường quá 24 giờ chưa xử lý xong. Cần đôn đốc Kỹ thuật viên.',
      metricValue: `${overdueSlaCount} phiếu`,
      actionLabel: 'Xử lý bảo trì',
      href: '/maintenance',
    });
  }

  if (repeatFailureRooms.length > 0) {
    const top = repeatFailureRooms[0];
    risks.push({
      id: 'repeat-failure-rooms',
      severity: 'high',
      category: 'maintenance',
      categoryLabel: 'Sự cố lặp lại',
      title: `${repeatFailureRooms.length} phòng phát sinh sự cố lặp lại trong 30 ngày`,
      detail: `Điểm nóng nhất: ${top.day} · ${formatRoomDisplay(top.room)} (${top.ticketCount30d} lần báo hỏng/30 ngày). Cần kiểm tra tổng thể hệ thống điện/nước thay vì sửa chắp vá.`,
      metricValue: `${repeatFailureRooms.length} phòng`,
      actionLabel: 'Mở Trung tâm Kỹ thuật',
      href: '/maintenance',
    });
  }

  // 4. Security & Discipline signals
  const activeBlacklist = blacklist.filter(isBlacklistRecordEffective);
  const recent30dDisciplines = disciplines.filter(d => {
    const ts = new Date(d.created_at).getTime();
    return !Number.isNaN(ts) && ts >= thirtyDaysAgo;
  });
  const openSevereDisciplines = disciplines.filter(
    d => d.status === 'open' && (d.severity === 'record' || d.severity === 'expulsion')
  );

  if (openSevereDisciplines.length > 0) {
    risks.push({
      id: 'open-severe-disciplines',
      severity: 'high',
      category: 'security',
      categoryLabel: 'An ninh & Kỷ luật',
      title: `${openSevereDisciplines.length} biên bản vi phạm nặng chưa đóng xử lý`,
      detail: 'Các vụ việc mức Lập biên bản hoặc Buộc rời KTX cần xác nhận hoàn tất xử lý và cập nhật Danh sách Đen nếu cần.',
      metricValue: `${openSevereDisciplines.length} vụ việc`,
      actionLabel: 'Mở An ninh & Kỷ luật',
      href: '/security',
    });
  }

  // 5. Data integrity risk
  if (incompleteProfilesCount > 0) {
    risks.push({
      id: 'incomplete-profiles',
      severity: 'medium',
      category: 'data',
      categoryLabel: 'Chất lượng hồ sơ',
      title: `${incompleteProfilesCount} công nhân thiếu thông tin định danh (CCCD / SĐT / Ngày sinh)`,
      detail: 'Hồ sơ thiếu dữ liệu gây khó khăn khi khai báo tạm trú và liên hệ khẩn cấp lúc xảy ra sự cố.',
      metricValue: `${incompleteProfilesCount} hồ sơ`,
      actionLabel: 'Bổ sung hồ sơ',
      href: '/worker-management?profileStatus=incomplete',
    });
  }

  const orderMap: Record<RiskSeverity, number> = { critical: 0, high: 1, medium: 2 };
  risks.sort((a, b) => orderMap[a.severity] - orderMap[b.severity]);

  return {
    risks,
    counts: {
      critical: risks.filter(r => r.severity === 'critical').length,
      high: risks.filter(r => r.severity === 'high').length,
      medium: risks.filter(r => r.severity === 'medium').length,
      total: risks.length,
    },
    runway,
    repeatFailureRooms,
    sparseRoomsCount,
    overdueTamTruCount,
    approachingTamTruCount,
    incompleteProfilesCount,
    activeBlacklistCount: activeBlacklist.length,
    recent30dDisciplinesCount: recent30dDisciplines.length,
    overdueSlaCount,
  };
}
