'use client';

import { Worker, naturalSortCompare } from '@/data/workers';
import { exportToExcel } from '@/lib/exportExcel';
import { formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { daysSinceVN, getVNDateString } from '@/lib/vnDate';

export type TeamGroupDimension = 'toTruong' | 'tieuDoan' | 'donVi';

export interface TeamRoomBreakdown {
  ktx: string;
  day: string;
  phongSo: string;
  roomDisplay: string;
  workers: Worker[];
}

export interface TeamGroupSummary {
  id: string;
  dimension: TeamGroupDimension;
  name: string;
  isUnassignedGroup: boolean;
  leaderPhone: string;
  primaryUnits: string[];
  primaryBattalions: string[];
  workers: Worker[];
  totalWorkers: number;
  maleCount: number;
  femaleCount: number;
  rooms: TeamRoomBreakdown[];
  roomCount: number;
  buildingCount: number;
  /** Average workers per room; lower value on larger teams means scattered */
  avgPerRoom: number;
  dispersionLevel: 'compact' | 'moderate' | 'scattered';
  unregisteredTamTru: Worker[];
  overdueTamTru: Worker[];
  noBedWorkers: Worker[];
  recentAbsentIds: Set<string>;
}

function isCheckedOut(w: Worker): boolean {
  return Boolean(
    w.ngayRaKTX ||
    w.ghiChu?.includes('[Đã Check-out') ||
    w.ghiChu?.includes('[CHECKOUT]')
  );
}

function formatDateVNDisplay(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function buildTeamGroups(
  workers: Worker[],
  dimension: TeamGroupDimension,
  recentAbsentWorkerIds?: Set<string>
): TeamGroupSummary[] {
  const active = workers.filter(w => !isCheckedOut(w));
  const map = new Map<string, { displayName: string; isUnassigned: boolean; items: Worker[] }>();

  for (const w of active) {
    const rawVal =
      dimension === 'toTruong'
        ? (w.toTruong || '').trim()
        : dimension === 'tieuDoan'
        ? (w.tieuDoan || '').trim()
        : (w.donVi || '').trim();

    const isEmpty = !rawVal || rawVal === '-' || rawVal === '—';
    const fallbackLabel =
      dimension === 'toTruong'
        ? 'Chưa gán Tổ trưởng'
        : dimension === 'tieuDoan'
        ? 'Chưa gán Tiểu đoàn / Đội'
        : 'Chưa gán Đơn vị';

    const displayName = isEmpty ? fallbackLabel : rawVal;
    const key = isEmpty ? '__unassigned__' : displayName.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

    const existing = map.get(key);
    if (existing) {
      existing.items.push(w);
    } else {
      map.set(key, { displayName, isUnassigned: isEmpty, items: [w] });
    }
  }

  const groups: TeamGroupSummary[] = [];

  for (const [key, entry] of map.entries()) {
    const list = [...entry.items].sort((a, b) => {
      const dCmp = naturalSortCompare(a.day || '', b.day || '');
      if (dCmp !== 0) return dCmp;
      const rCmp = naturalSortCompare(a.phongSo || '', b.phongSo || '');
      if (rCmp !== 0) return rCmp;
      return (a.hoVaTen || '').localeCompare(b.hoVaTen || '', 'vi');
    });

    let maleCount = 0;
    let femaleCount = 0;
    let leaderPhone = '';
    const unitCounts = new Map<string, number>();
    const battalionCounts = new Map<string, number>();
    const roomMap = new Map<string, TeamRoomBreakdown>();
    const buildingSet = new Set<string>();
    const unregisteredTamTru: Worker[] = [];
    const overdueTamTru: Worker[] = [];
    const noBedWorkers: Worker[] = [];
    const recentAbsentIds = new Set<string>();

    for (const w of list) {
      const g = (w.gioiTinh || '').toLowerCase();
      if (g.includes('nữ') || g.includes('nu')) femaleCount += 1;
      else if (g.includes('nam')) maleCount += 1;

      if (!leaderPhone && w.sdtToTruong && w.sdtToTruong.trim() && w.sdtToTruong.trim() !== '-') {
        leaderPhone = w.sdtToTruong.trim();
      }
      if (w.donVi && w.donVi.trim()) {
        const u = w.donVi.trim();
        unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
      }
      if (w.tieuDoan && w.tieuDoan.trim()) {
        const td = w.tieuDoan.trim();
        battalionCounts.set(td, (battalionCounts.get(td) ?? 0) + 1);
      }

      if (w.tamTruStatus !== 'registered') {
        unregisteredTamTru.push(w);
        const days = daysSinceVN(w.ngayVaoKTX || w.createdAt);
        if (days !== null && days > 7) {
          overdueTamTru.push(w);
        }
      }

      if (!w.phongSo?.trim() || !w.giuong?.trim()) {
        noBedWorkers.push(w);
      }

      if (recentAbsentWorkerIds?.has(w.id)) {
        recentAbsentIds.add(w.id);
      }

      const normRoom = normalizeRoomLabel(w.phongSo || '');
      if (w.day?.trim() && normRoom) {
        const bKey = `${w.ktx || ''}|${w.day.trim()}`;
        buildingSet.add(bKey);
        const rKey = `${bKey}|${normRoom}`;
        const existingRoom = roomMap.get(rKey);
        if (existingRoom) {
          existingRoom.workers.push(w);
        } else {
          roomMap.set(rKey, {
            ktx: (w.ktx || '').trim(),
            day: w.day.trim(),
            phongSo: normRoom,
            roomDisplay: formatRoomDisplay(normRoom),
            workers: [w],
          });
        }
      }
    }

    const rooms = Array.from(roomMap.values()).sort((a, b) => {
      const dCmp = naturalSortCompare(a.day, b.day);
      if (dCmp !== 0) return dCmp;
      return naturalSortCompare(a.phongSo, b.phongSo);
    });

    const roomCount = rooms.length;
    const assignedCount = list.length - noBedWorkers.length;
    const avgPerRoom = roomCount > 0 ? Math.round((assignedCount / roomCount) * 10) / 10 : 0;

    // Dispersion heuristic: if a team has >= 6 workers scattered across >= 4 rooms with avg <= 2.5 workers/room
    let dispersionLevel: 'compact' | 'moderate' | 'scattered' = 'compact';
    if (!entry.isUnassigned && assignedCount >= 6 && roomCount >= 4 && avgPerRoom <= 2.5) {
      dispersionLevel = 'scattered';
    } else if (!entry.isUnassigned && assignedCount >= 5 && roomCount >= 3 && avgPerRoom <= 3.5) {
      dispersionLevel = 'moderate';
    }

    const primaryUnits = Array.from(unitCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([u]) => u);

    const primaryBattalions = Array.from(battalionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([td]) => td);

    groups.push({
      id: `${dimension}:${key}`,
      dimension,
      name: entry.displayName,
      isUnassignedGroup: entry.isUnassigned,
      leaderPhone,
      primaryUnits,
      primaryBattalions,
      workers: list,
      totalWorkers: list.length,
      maleCount,
      femaleCount,
      rooms,
      roomCount,
      buildingCount: buildingSet.size,
      avgPerRoom,
      dispersionLevel,
      unregisteredTamTru,
      overdueTamTru,
      noBedWorkers,
      recentAbsentIds,
    });
  }

  return groups.sort((a, b) => {
    if (a.isUnassignedGroup !== b.isUnassignedGroup) return a.isUnassignedGroup ? 1 : -1;
    return b.totalWorkers - a.totalWorkers || a.name.localeCompare(b.name, 'vi');
  });
}

function dimensionPrefix(d: TeamGroupDimension): string {
  if (d === 'toTruong') return 'Tổ trưởng';
  if (d === 'tieuDoan') return 'Tiểu đoàn / Đội';
  return 'Đơn vị';
}

/** Template 1: Full team headcount & room roster for Zalo */
export function buildTeamRosterZaloMessage(group: TeamGroupSummary): string {
  const today = formatDateVNDisplay(getVNDateString());
  const lines: string[] = [
    `📋 BÁO CÁO QUÂN SỐ KTX PHƯỚC VĨNH TÂY (${today})`,
    `👤 ${dimensionPrefix(group.dimension)}: ${group.name}${group.leaderPhone ? ` (${group.leaderPhone})` : ''}`,
    `👥 Tổng quân số: ${group.totalWorkers} người (${group.maleCount} Nam · ${group.femaleCount} Nữ)`,
    `🏠 Đang ở: ${group.roomCount} phòng (${group.buildingCount} dãy) | Chưa xếp giường: ${group.noBedWorkers.length}`,
    `📄 Chưa ĐK tạm trú: ${group.unregisteredTamTru.length} (Quá hạn >7 ngày: ${group.overdueTamTru.length})`,
    ``,
    `📍 CHI TIẾT PHÂN BỔ PHÒNG:`,
  ];

  group.rooms.forEach(r => {
    const names = r.workers
      .map(w => `${w.hoVaTen}${w.giuong ? ` (G${w.giuong})` : ''}`)
      .join(', ');
    lines.push(`• ${r.day} - ${r.roomDisplay} (${r.workers.length} người): ${names}`);
  });

  if (group.noBedWorkers.length > 0) {
    lines.push(``);
    lines.push(`⚠️ CHƯA XẾP PHÒNG/GIƯỜNG (${group.noBedWorkers.length}):`);
    group.noBedWorkers.forEach((w, idx) => {
      lines.push(`${idx + 1}. ${w.hoVaTen}${w.maNV ? ` (${w.maNV})` : ''}`);
    });
  }

  lines.push(``);
  lines.push(`Nhờ anh/chị đối chiếu lại quân số thực tế giúp Ban Quản lý KTX. Trân trọng!`);
  return lines.join('\n');
}

/** Template 2: Temporary Residence reminder for Zalo */
export function buildTeamTamTruZaloMessage(group: TeamGroupSummary): string {
  const today = formatDateVNDisplay(getVNDateString());
  const list = group.unregisteredTamTru;
  if (list.length === 0) {
    return `✅ THÔNG BÁO TẠM TRÚ (${today})\n${dimensionPrefix(group.dimension)} ${group.name}: 100% quân số (${group.totalWorkers} người) đã hoàn tất đăng ký tạm trú. Xin cảm ơn!`;
  }

  const lines: string[] = [
    `⚠️ NHẮC NHỞ ĐĂNG KÝ TẠM TRÚ KTX (${today})`,
    `👤 ${dimensionPrefix(group.dimension)}: ${group.name}`,
    `📌 Có ${list.length}/${group.totalWorkers} công nhân chưa hoàn tất tạm trú (${group.overdueTamTru.length} quá hạn > 7 ngày):`,
    ``,
  ];

  list.forEach((w, idx) => {
    const days = daysSinceVN(w.ngayVaoKTX || w.createdAt);
    const loc = w.day && w.phongSo ? `${w.day} - ${formatRoomDisplay(w.phongSo)}` : 'Chưa xếp phòng';
    const overdueTag = days !== null && days > 7 ? ` [QUÁ HẠN ${days} NGÀY]` : days !== null ? ` (${days} ngày)` : '';
    lines.push(`${idx + 1}. ${w.hoVaTen} · ${loc}${overdueTag}`);
  });

  lines.push(``);
  lines.push(`Nhờ anh/chị đôn đốc anh em bổ sung CCCD/thông tin với Ban Quản lý KTX trong hôm nay để kịp khai báo Công an xã.`);
  return lines.join('\n');
}

/** Template 3: Unassigned bed or absent workers reminder for Zalo */
export function buildTeamIssueZaloMessage(group: TeamGroupSummary): string {
  const today = formatDateVNDisplay(getVNDateString());
  const absentList = group.workers.filter(w => group.recentAbsentIds.has(w.id));
  const lines: string[] = [
    `🔔 RÀ SOÁT QUÂN SỐ CẦN LƯU Ý (${today})`,
    `👤 ${dimensionPrefix(group.dimension)}: ${group.name} (${group.totalWorkers} người)`,
  ];

  if (absentList.length > 0) {
    lines.push(``);
    lines.push(`🚫 VẮNG ĐIỂM DANH GẦN NHẤT (${absentList.length} người):`);
    absentList.forEach((w, idx) => {
      const loc = w.day && w.phongSo ? `${w.day} - ${formatRoomDisplay(w.phongSo)}` : 'Chưa rõ phòng';
      lines.push(`${idx + 1}. ${w.hoVaTen} (${loc})`);
    });
  }

  if (group.noBedWorkers.length > 0) {
    lines.push(``);
    lines.push(`🛏️ CHƯA XẾP PHÒNG / GIƯỜNG (${group.noBedWorkers.length} người):`);
    group.noBedWorkers.forEach((w, idx) => {
      lines.push(`${idx + 1}. ${w.hoVaTen}${w.maNV ? ` · ${w.maNV}` : ''}`);
    });
  }

  if (absentList.length === 0 && group.noBedWorkers.length === 0) {
    lines.push(``);
    lines.push(`✅ Hiện không có công nhân vắng điểm danh hoặc thiếu giường.`);
  } else {
    lines.push(``);
    lines.push(`Nhờ anh/chị xác nhận tình trạng thực tế (đi ca đêm / nghỉ phép / đã nghỉ việc) để KTX cập nhật lại giường.`);
  }
  return lines.join('\n');
}

/** Template 4: Quick Block / Building Executive Summary for Management Zalo group */
export function buildBlockSummaryZaloMessage(
  ktxFilter: string,
  dayFilter: string,
  workers: Worker[]
): string {
  const today = formatDateVNDisplay(getVNDateString());
  const active = workers.filter(w => {
    if (isCheckedOut(w)) return false;
    if (ktxFilter && ktxFilter !== 'all' && (w.ktx || '').trim() !== ktxFilter.trim()) return false;
    if (dayFilter && dayFilter !== 'all' && (w.day || '').trim() !== dayFilter.trim()) return false;
    return true;
  });

  const scopeLabel =
    dayFilter && dayFilter !== 'all'
      ? `${ktxFilter && ktxFilter !== 'all' ? `${ktxFilter} - ` : ''}${dayFilter}`
      : ktxFilter && ktxFilter !== 'all'
      ? ktxFilter
      : 'Toàn bộ KTX Phước Vĩnh Tây';

  const byDay = new Map<string, { count: number; rooms: Set<string>; unregistered: number }>();
  let male = 0;
  let female = 0;
  let totalUnreg = 0;
  let totalOverdue = 0;

  for (const w of active) {
    const g = (w.gioiTinh || '').toLowerCase();
    if (g.includes('nữ') || g.includes('nu')) female += 1;
    else if (g.includes('nam')) male += 1;

    const dKey = (w.day || 'Chưa gán dãy').trim();
    if (!byDay.has(dKey)) byDay.set(dKey, { count: 0, rooms: new Set(), unregistered: 0 });
    const stat = byDay.get(dKey)!;
    stat.count += 1;
    if (w.phongSo?.trim()) stat.rooms.add(normalizeRoomLabel(w.phongSo));
    if (w.tamTruStatus !== 'registered') {
      stat.unregistered += 1;
      totalUnreg += 1;
      const days = daysSinceVN(w.ngayVaoKTX || w.createdAt);
      if (days !== null && days > 7) totalOverdue += 1;
    }
  }

  const lines: string[] = [
    `📊 BÁO CÁO NHANH QUÂN SỐ KTX (${today})`,
    `🏢 Phạm vi: ${scopeLabel}`,
    `👥 Tổng quân số: ${active.length} người (Nam: ${male} | Nữ: ${female})`,
    `📄 Tạm trú: ${active.length - totalUnreg} đã ĐK | ${totalUnreg} chưa ĐK (${totalOverdue} quá hạn >7 ngày)`,
    ``,
    `📌 PHÂN BỔ THEO DÃY:`,
  ];

  Array.from(byDay.entries())
    .sort((a, b) => naturalSortCompare(a[0], b[0]))
    .forEach(([dayName, stat]) => {
      lines.push(`• ${dayName}: ${stat.count} người (${stat.rooms.size} phòng có người · ${stat.unregistered} chưa tạm trú)`);
    });

  return lines.join('\n');
}

export function exportTeamWorkersExcel(group: TeamGroupSummary): boolean {
  const today = getVNDateString();
  const safeSlug = group.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 32);
  const fileName = `DanhSach_${safeSlug}_${today}.xlsx`;

  const rows = group.workers.map((w, idx) => ({
    'STT': idx + 1,
    'Họ và tên': w.hoVaTen || '',
    'Mã NV': w.maNV || '',
    'CCCD': w.cccd || '',
    'Giới tính': w.gioiTinh || '',
    'Ngày sinh': w.ngaySinh || '',
    'SĐT': w.soDienThoai || '',
    'Đơn vị': w.donVi || '',
    'Tiểu đoàn / Đội': w.tieuDoan || '',
    'Tổ trưởng': w.toTruong || '',
    'KTX': w.ktx || '',
    'Dãy': w.day || '',
    'Phòng': w.phongSo ? formatRoomDisplay(w.phongSo) : '',
    'Giường': w.giuong || '',
    'Ngày vào KTX': w.ngayVaoKTX || '',
    'Tạm trú': w.tamTruStatus === 'registered' ? 'Đã đăng ký' : 'Chưa đăng ký',
  }));

  return exportToExcel(rows, fileName, 'DanhSachToDoi');
}
