'use client';

import type { Worker } from '@/data/workers';
import { DEFAULT_ROOM_CAPACITY, naturalSortCompare } from '@/data/workers';
import {
  FacilityItem,
  formatRoomDisplay,
  getRoomCapacity,
  normalizeRoomLabel,
  RoomCapacityMap,
} from '@/lib/facilityCapacity';
import { getRoomGenderInfo } from '@/lib/roomGender';
import { escapeHtml } from '@/lib/printHtml';
import { getVNDateTimeDisplay } from '@/lib/vnDate';

export interface ConsolidationOptions {
  ktxFilter?: string; // '' or 'all' for all
  maxFillPercent: number; // e.g., 35 means rooms <= 35% occupancy are sparse candidates
  sameDayOnly: boolean;
  sameContractorPriority: boolean;
  allowBlockFn?: (day: string, ktx: string) => boolean;
}

export interface ConsolidationRoomBucket {
  key: string;
  ktx: string;
  day: string;
  room: string;
  capacity: number;
  gender: 'male' | 'female' | 'mixed' | 'empty';
  dominantContractor: string;
  workers: Worker[];
  usedBedNumbers: Set<number>;
}

export interface ConsolidationWorkerMove {
  worker: Worker;
  fromDay: string;
  fromRoom: string;
  fromBed: string;
  toKtx: string;
  toDay: string;
  toRoom: string;
  suggestedBed: string;
}

export interface ConsolidationMoveGroup {
  id: string;
  ktx: string;
  gender: 'male' | 'female';
  sourceDay: string;
  sourceRoom: string;
  sourceOccupied: number;
  sourceCapacity: number;
  targetDay: string;
  targetRoom: string;
  targetOccupiedBefore: number;
  targetOccupiedAfter: number;
  targetCapacity: number;
  sameDay: boolean;
  sameContractor: boolean;
  sourceContractor: string;
  targetContractor: string;
  freesSourceRoom: boolean;
  workerMoves: ConsolidationWorkerMove[];
}

export interface ConsolidationPlan {
  moves: ConsolidationMoveGroup[];
  skippedMixedRooms: { ktx: string; day: string; room: string; count: number }[];
  summary: {
    sparseRoomsCount: number;
    freedRoomsCount: number;
    movedWorkersCount: number;
    targetRoomsUsedCount: number;
  };
}

function getDominantContractor(workers: Worker[]): string {
  const counts = new Map<string, number>();
  workers.forEach(w => {
    const unit = (w.donVi || '').trim();
    if (!unit) return;
    counts.set(unit, (counts.get(unit) || 0) + 1);
  });
  let top = '';
  let max = 0;
  counts.forEach((c, name) => {
    if (c > max) {
      max = c;
      top = name;
    }
  });
  return top;
}

function parseBedNumber(raw?: string | null): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function allocateNextBed(used: Set<number>, capacity: number): string {
  for (let i = 1; i <= Math.max(capacity, used.size + 4); i++) {
    if (!used.has(i)) {
      used.add(i);
      return String(i);
    }
  }
  const fallback = used.size + 1;
  used.add(fallback);
  return String(fallback);
}

/**
 * Computes an optimal, strictly gender-safe Room Defragmentation / Consolidation plan.
 * Picks sparse rooms (<= maxFillPercent) and merges their residents into compatible rooms
 * so entire rooms become 100% vacant and ready for new incoming contractor groups.
 */
export function computeConsolidationPlan(
  workers: Worker[],
  facilities: FacilityItem[],
  capacities: RoomCapacityMap,
  roomGenderMap: Record<string, 'male' | 'female' | 'auto'>,
  options: ConsolidationOptions
): ConsolidationPlan {
  const activeWorkers = workers.filter(w => {
    if (
      w.ngayRaKTX ||
      w.ghiChu?.includes('[Đã Check-out') ||
      w.ghiChu?.includes('[CHECKOUT]')
    ) {
      return false;
    }
    if (!w.ktx || !w.day || !w.phongSo) return false;
    if (options.ktxFilter && options.ktxFilter !== 'all' && w.ktx.trim() !== options.ktxFilter.trim()) {
      return false;
    }
    if (options.allowBlockFn && !options.allowBlockFn(w.day, w.ktx)) {
      return false;
    }
    return true;
  });

  // Group workers by room
  const roomMap = new Map<string, ConsolidationRoomBucket>();

  // Seed rooms from facilities so capacity is exact
  facilities.forEach(f => {
    if (!f.ktx || !f.day || !f.phong) return;
    if (options.ktxFilter && options.ktxFilter !== 'all' && f.ktx.trim() !== options.ktxFilter.trim()) {
      return;
    }
    if (options.allowBlockFn && !options.allowBlockFn(f.day, f.ktx)) {
      return;
    }
    const normRoom = normalizeRoomLabel(f.phong);
    const key = `${f.ktx.trim()}||${f.day.trim()}||${normRoom}`;
    if (!roomMap.has(key)) {
      roomMap.set(key, {
        key,
        ktx: f.ktx.trim(),
        day: f.day.trim(),
        room: normRoom,
        capacity: f.giuong || getRoomCapacity(capacities, f.ktx, f.day, normRoom) || DEFAULT_ROOM_CAPACITY,
        gender: 'empty',
        dominantContractor: '',
        workers: [],
        usedBedNumbers: new Set<number>(),
      });
    }
  });

  activeWorkers.forEach(w => {
    const normRoom = normalizeRoomLabel(w.phongSo);
    const key = `${w.ktx.trim()}||${w.day.trim()}||${normRoom}`;
    let bucket = roomMap.get(key);
    if (!bucket) {
      bucket = {
        key,
        ktx: w.ktx.trim(),
        day: w.day.trim(),
        room: normRoom,
        capacity: getRoomCapacity(capacities, w.ktx, w.day, normRoom) || DEFAULT_ROOM_CAPACITY,
        gender: 'empty',
        dominantContractor: '',
        workers: [],
        usedBedNumbers: new Set<number>(),
      };
      roomMap.set(key, bucket);
    }
    bucket.workers.push(w);
    const bedNum = parseBedNumber(w.giuong);
    if (bedNum !== null) bucket.usedBedNumbers.add(bedNum);
  });

  // Resolve room genders & dominant contractors
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

  const skippedMixedRooms: { ktx: string; day: string; room: string; count: number }[] = [];

  roomMap.forEach((bucket, key) => {
    const adminLabel = normalizedGenderLabels.get(key);
    const adminLabelStr = adminLabel === 'male' ? 'Nam' : adminLabel === 'female' ? 'Nữ' : null;
    const gInfo = getRoomGenderInfo(bucket.workers, adminLabelStr);
    bucket.gender = gInfo.gender;
    bucket.dominantContractor = getDominantContractor(bucket.workers);
    if (bucket.gender === 'mixed' && bucket.workers.length > 0) {
      skippedMixedRooms.push({
        ktx: bucket.ktx,
        day: bucket.day,
        room: bucket.room,
        count: bucket.workers.length,
      });
    }
  });

  // Partition into (ktx, gender) groups for male & female rooms that currently have residents
  const partitions = new Map<string, ConsolidationRoomBucket[]>();
  roomMap.forEach(bucket => {
    if (bucket.workers.length === 0) return;
    if (bucket.gender !== 'male' && bucket.gender !== 'female') return;
    const pKey = `${bucket.ktx}||${bucket.gender}`;
    if (!partitions.has(pKey)) partitions.set(pKey, []);
    partitions.get(pKey)!.push(bucket);
  });

  const maxRatio = Math.max(0.1, Math.min(0.8, options.maxFillPercent / 100));
  const moves: ConsolidationMoveGroup[] = [];
  let sparseRoomsCount = 0;
  const targetRoomKeysUsed = new Set<string>();

  partitions.forEach((buckets) => {
    // Working copies of remaining counts & used bed numbers
    const state = new Map<
      string,
      {
        bucket: ConsolidationRoomBucket;
        currentCount: number;
        usedBeds: Set<number>;
        emptied: boolean;
        receivedIncoming: boolean;
      }
    >();

    buckets.forEach(b => {
      state.set(b.key, {
        bucket: b,
        currentCount: b.workers.length,
        usedBeds: new Set(b.usedBedNumbers),
        emptied: false,
        receivedIncoming: false,
      });
    });

    // Sparse source candidates: 0 < occupied <= capacity * maxRatio, sorted ascending by worker count
    const sparseCandidates = buckets
      .filter(b => b.workers.length > 0 && b.workers.length / Math.max(1, b.capacity) <= maxRatio)
      .sort((a, b) => {
        if (a.workers.length !== b.workers.length) return a.workers.length - b.workers.length;
        const dCmp = naturalSortCompare(a.day, b.day);
        if (dCmp !== 0) return dCmp;
        return naturalSortCompare(a.room, b.room);
      });

    sparseRoomsCount += sparseCandidates.length;

    for (const source of sparseCandidates) {
      const srcState = state.get(source.key);
      if (!srcState || srcState.emptied || srcState.receivedIncoming) continue;

      const need = srcState.currentCount;
      if (need <= 0) continue;

      // Find best single target room that can absorb ALL residents from `source` cleanly
      let bestTargetKey: string | null = null;
      let bestScore = -Infinity;

      state.forEach((cand, candKey) => {
        if (candKey === source.key) return;
        if (cand.emptied) return;
        const freeBeds = cand.bucket.capacity - cand.currentCount;
        if (freeBeds < need) return;
        if (options.sameDayOnly && cand.bucket.day !== source.day) return;

        let score = 0;
        // Prefer rooms that are already fuller (consolidate upward into anchor rooms)
        score += (cand.currentCount / Math.max(1, cand.bucket.capacity)) * 40;
        // Prefer same contractor
        if (
          options.sameContractorPriority &&
          source.dominantContractor &&
          cand.bucket.dominantContractor &&
          source.dominantContractor.toLowerCase() === cand.bucket.dominantContractor.toLowerCase()
        ) {
          score += 55;
        }
        // Prefer same building/day
        if (cand.bucket.day === source.day) {
          score += 30;
        }
        // Prefer tight bin-packing (smaller leftover)
        const leftover = freeBeds - need;
        score += Math.max(0, 20 - leftover);

        if (score > bestScore) {
          bestScore = score;
          bestTargetKey = candKey;
        }
      });

      if (!bestTargetKey) continue;

      const tgtState = state.get(bestTargetKey)!;
      const beforeCount = tgtState.currentCount;

      const workerMoves: ConsolidationWorkerMove[] = source.workers.map(w => ({
        worker: w,
        fromDay: source.day,
        fromRoom: source.room,
        fromBed: w.giuong || '',
        toKtx: tgtState.bucket.ktx,
        toDay: tgtState.bucket.day,
        toRoom: tgtState.bucket.room,
        suggestedBed: allocateNextBed(tgtState.usedBeds, tgtState.bucket.capacity),
      }));

      tgtState.currentCount += need;
      tgtState.receivedIncoming = true;
      srcState.emptied = true;
      srcState.currentCount = 0;
      targetRoomKeysUsed.add(bestTargetKey);

      moves.push({
        id: `${source.key}=>${bestTargetKey}`,
        ktx: source.ktx,
        gender: source.gender as 'male' | 'female',
        sourceDay: source.day,
        sourceRoom: source.room,
        sourceOccupied: source.workers.length,
        sourceCapacity: source.capacity,
        targetDay: tgtState.bucket.day,
        targetRoom: tgtState.bucket.room,
        targetOccupiedBefore: beforeCount,
        targetOccupiedAfter: tgtState.currentCount,
        targetCapacity: tgtState.bucket.capacity,
        sameDay: source.day === tgtState.bucket.day,
        sameContractor: Boolean(
          source.dominantContractor &&
            tgtState.bucket.dominantContractor &&
            source.dominantContractor.toLowerCase() === tgtState.bucket.dominantContractor.toLowerCase()
        ),
        sourceContractor: source.dominantContractor || 'Chưa phân loại',
        targetContractor: tgtState.bucket.dominantContractor || 'Chưa phân loại',
        freesSourceRoom: true,
        workerMoves,
      });
    }
  });

  moves.sort((a, b) => {
    const kCmp = naturalSortCompare(a.ktx, b.ktx);
    if (kCmp !== 0) return kCmp;
    const dCmp = naturalSortCompare(a.sourceDay, b.sourceDay);
    if (dCmp !== 0) return dCmp;
    return naturalSortCompare(a.sourceRoom, b.sourceRoom);
  });

  const movedWorkersCount = moves.reduce((sum, m) => sum + m.workerMoves.length, 0);

  return {
    moves,
    skippedMixedRooms,
    summary: {
      sparseRoomsCount,
      freedRoomsCount: moves.length,
      movedWorkersCount,
      targetRoomsUsedCount: targetRoomKeysUsed.size,
    },
  };
}

/**
 * Builds an institutional A4 printable "LỆNH ĐIỀU CHUYỂN & DỒN PHÒNG KTX"
 * for team leaders and security staff to execute smoothly.
 */
export function buildConsolidationOrderHtml(
  selectedMoves: ConsolidationMoveGroup[],
  actorName: string
): string {
  const nowDisplay = getVNDateTimeDisplay();
  const totalWorkers = selectedMoves.reduce((s, m) => s + m.workerMoves.length, 0);

  const sectionsHtml = selectedMoves
    .map((group, idx) => {
      const rows = group.workerMoves
        .map(
          (wm, wIdx) => `
          <tr>
            <td style="text-align:center;">${wIdx + 1}</td>
            <td><strong>${escapeHtml(wm.worker.hoVaTen)}</strong></td>
            <td style="text-align:center;font-family:monospace;">${escapeHtml(wm.worker.maNV || '—')}</td>
            <td>${escapeHtml(wm.worker.donVi || '—')}</td>
            <td style="text-align:center;">${escapeHtml(wm.fromDay)} · ${escapeHtml(formatRoomDisplay(wm.fromRoom))}${wm.fromBed ? ` (G${escapeHtml(wm.fromBed)})` : ''}</td>
            <td style="text-align:center;font-weight:700;color:#1d4ed8;">${escapeHtml(wm.toDay)} · ${escapeHtml(formatRoomDisplay(wm.toRoom))} (G${escapeHtml(wm.suggestedBed)})</td>
            <td style="text-align:center;">${escapeHtml(wm.worker.toTruong || '—')}</td>
            <td></td>
          </tr>`
        )
        .join('');

      return `
        <div class="group-block">
          <div class="group-header">
            <span><strong>Lệnh #${idx + 1}:</strong> ${escapeHtml(group.ktx)} — Dồn <strong>${escapeHtml(group.sourceDay)} · ${escapeHtml(formatRoomDisplay(group.sourceRoom))}</strong> (${group.sourceOccupied} người) → <strong>${escapeHtml(group.targetDay)} · ${escapeHtml(formatRoomDisplay(group.targetRoom))}</strong> (${group.targetOccupiedBefore} → ${group.targetOccupiedAfter}/${group.targetCapacity})</span>
            <span class="tag">${group.gender === 'female' ? 'Phòng Nữ' : 'Phòng Nam'} · Giải phóng 1 phòng trống</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:36px;">STT</th>
                <th>Họ và tên</th>
                <th style="width:90px;">Mã NV</th>
                <th>Đơn vị / Nhà thầu</th>
                <th>Vị trí cũ</th>
                <th>Vị trí mới</th>
                <th>Tổ trưởng</th>
                <th style="width:70px;">Ký nhận</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Lệnh Điều Chuyển & Dồn Phòng KTX Phước Vĩnh Tây</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11.5px; line-height: 1.45; margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; }
    .sub { font-size: 10.5px; color: #475569; margin-top: 2px; }
    .doc-title { text-align: center; margin: 12px 0 14px; }
    .doc-title h1 { font-size: 17px; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
    .doc-title p { font-size: 11px; color: #475569; margin: 4px 0 0; }
    .kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
    .kpi-label { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .kpi-val { font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 2px; }
    .group-block { margin-bottom: 14px; page-break-inside: avoid; }
    .group-header { display: flex; justify-content: space-between; align-items: center; background: #f1f5f9; border: 1px solid #cbd5e1; border-bottom: none; padding: 6px 10px; font-size: 11px; }
    .tag { font-weight: 700; color: #15803d; font-size: 10.5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 10.5px; }
    th { background: #e2e8f0; font-weight: 700; text-align: left; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; text-align: center; page-break-inside: avoid; }
    .sig-title { font-weight: 700; font-size: 11px; text-transform: uppercase; }
    .sig-note { font-size: 10px; color: #64748b; font-style: italic; margin-top: 2px; }
    .sig-space { height: 56px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">BAN QUẢN LÝ KÝ TÚC XÁ PHƯỚC VĨNH TÂY</div>
      <div class="sub">Hệ thống Quản trị & Điều phối Quỹ giường</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:700;">Thời gian lập: ${escapeHtml(nowDisplay)}</div>
      <div class="sub">Người lập lệnh: ${escapeHtml(actorName)}</div>
    </div>
  </div>

  <div class="doc-title">
    <h1>Lệnh Điều Chuyển & Dồn Phòng Ký Túc Xá</h1>
    <p>Tối ưu quỹ phòng trống nguyên căn · Đảm bảo tách biệt giới tính & ổn định tổ đội</p>
  </div>

  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Phòng trống giải phóng</div>
      <div class="kpi-val">${selectedMoves.length} phòng</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Tổng công nhân chuyển</div>
      <div class="kpi-val">${totalWorkers} người</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Trạng thái sơ đồ giường</div>
      <div class="kpi-val">Đã đồng bộ hệ thống</div>
    </div>
  </div>

  ${sectionsHtml}

  <div class="signatures">
    <div>
      <div class="sig-title">Người lập lệnh</div>
      <div class="sig-note">(Ký, ghi rõ họ tên)</div>
      <div class="sig-space"></div>
      <div><strong>${escapeHtml(actorName)}</strong></div>
    </div>
    <div>
      <div class="sig-title">Đại diện Bảo vệ / Tổ trưởng</div>
      <div class="sig-note">(Xác nhận thực hiện di dời)</div>
      <div class="sig-space"></div>
      <div>....................................</div>
    </div>
    <div>
      <div class="sig-title">Trưởng Ban Quản Lý KTX</div>
      <div class="sig-note">(Phê duyệt)</div>
      <div class="sig-space"></div>
      <div>....................................</div>
    </div>
  </div>
</body>
</html>`;
}
