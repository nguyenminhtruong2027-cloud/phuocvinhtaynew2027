'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BedDouble,
  Box,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { invalidateFacilitiesCache, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { invalidateKtxStructureCache } from '@/lib/ktxStructure';
import { normalizeDayKey } from '@/lib/bedSync';
import { toast } from 'sonner';

export interface ExistingFacilitySnapshot {
  id: string;
  ktx: string;
  day: string;
  phong_khu_vuc: string;
  giuong: number;
  dieu_hoa: number;
  tu: number;
  quat: number;
  o_cam_dien: number;
  remote: number;
  bong_tuyp: number;
  ban_an: number;
  ghe_an: number;
  ghi_chu: string;
  room_type: 'accommodation' | 'functional';
  is_visible: boolean;
}

interface EquipmentProfile {
  dieu_hoa: number;
  tu: number;
  quat: number;
  o_cam_dien: number;
  remote: number;
  bong_tuyp: number;
  ban_an: number;
  ghe_an: number;
}

interface Sync3DBlueprintModalProps {
  existingRows: ExistingFacilitySnapshot[];
  workerCount: number;
  actorEmail: string;
  onAuditLog: (details: string) => void;
  onCompleted: (summary: {
    ktxName: string;
    roomCount: number;
    bedCount: number;
    staleStaffCount: number;
  }) => Promise<void>;
  onClose: () => void;
}

const OFFICIAL_KTX_NAME = 'KTX Phước Vĩnh Tây';
const OFFICIAL_DAY_COUNT = 6;
const OFFICIAL_ROOMS_PER_DAY = 15;
const OFFICIAL_BEDS_PER_ROOM = 20;
const OFFICIAL_TOTAL_ROOMS = OFFICIAL_DAY_COUNT * OFFICIAL_ROOMS_PER_DAY; // 90
const OFFICIAL_TOTAL_BEDS = OFFICIAL_TOTAL_ROOMS * OFFICIAL_BEDS_PER_ROOM; // 1,800

const EQUIPMENT_FIELDS: Array<{ key: keyof EquipmentProfile; label: string }> = [
  { key: 'dieu_hoa', label: 'Điều hòa' },
  { key: 'tu', label: 'Tủ đồ' },
  { key: 'quat', label: 'Quạt' },
  { key: 'o_cam_dien', label: 'Ổ cắm điện' },
  { key: 'remote', label: 'Remote' },
  { key: 'bong_tuyp', label: 'Bóng tuýp' },
  { key: 'ban_an', label: 'Bàn ăn' },
  { key: 'ghe_an', label: 'Ghế ăn' },
];

function computeMostCommonNumber(values: number[]): number {
  if (values.length === 0) return 0;
  const freq = new Map<number, number>();
  values.forEach(v => {
    const clean = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    freq.set(clean, (freq.get(clean) || 0) + 1);
  });
  let bestVal = 0;
  let bestCount = -1;
  freq.forEach((count, val) => {
    if (count > bestCount || (count === bestCount && val > bestVal)) {
      bestCount = count;
      bestVal = val;
    }
  });
  return bestVal;
}

function detectDefaultEquipment(rows: ExistingFacilitySnapshot[]): EquipmentProfile {
  const accRows = rows.filter(r => (r.room_type || 'accommodation') === 'accommodation');
  return {
    dieu_hoa: computeMostCommonNumber(accRows.map(r => Number(r.dieu_hoa) || 0)),
    tu: computeMostCommonNumber(accRows.map(r => Number(r.tu) || 0)),
    quat: computeMostCommonNumber(accRows.map(r => Number(r.quat) || 0)),
    o_cam_dien: computeMostCommonNumber(accRows.map(r => Number(r.o_cam_dien) || 0)),
    remote: computeMostCommonNumber(accRows.map(r => Number(r.remote) || 0)),
    bong_tuyp: computeMostCommonNumber(accRows.map(r => Number(r.bong_tuyp) || 0)),
    ban_an: computeMostCommonNumber(accRows.map(r => Number(r.ban_an) || 0)),
    ghe_an: computeMostCommonNumber(accRows.map(r => Number(r.ghe_an) || 0)),
  };
}

export default function Sync3DBlueprintModal({
  existingRows,
  workerCount,
  onAuditLog,
  onCompleted,
  onClose,
}: Sync3DBlueprintModalProps) {
  const detectedDefaults = useMemo(() => detectDefaultEquipment(existingRows), [existingRows]);

  const [fallbackEquip, setFallbackEquip] = useState<EquipmentProfile>(detectedDefaults);
  const [preservePerRoomEquip, setPreservePerRoomEquip] = useState(true);
  const [cleanOldLabelsAndBeds, setCleanOldLabelsAndBeds] = useState(true);
  const [acknowledgeWorkers, setAcknowledgeWorkers] = useState(false);

  const [running, setRunning] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [statusStep, setStatusStep] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const existingAccCount = useMemo(
    () => existingRows.filter(r => (r.room_type || 'accommodation') === 'accommodation').length,
    [existingRows]
  );

  // Build map of existing per-room equipment keyed by (dayNum||roomNum) to preserve old equipment numbers cleanly
  const existingEquipByDayRoom = useMemo(() => {
    const map = new Map<string, EquipmentProfile>();
    const accRows = existingRows.filter(r => (r.room_type || 'accommodation') === 'accommodation');
    for (const r of accRows) {
      const dNum = normalizeDayKey(r.day);
      const rNum = normalizeRoomLabel(r.phong_khu_vuc);
      if (!dNum || !rNum) continue;
      const key = `${dNum}||${rNum}`;
      if (!map.has(key)) {
        map.set(key, {
          dieu_hoa: Number(r.dieu_hoa) || 0,
          tu: Number(r.tu) || 0,
          quat: Number(r.quat) || 0,
          o_cam_dien: Number(r.o_cam_dien) || 0,
          remote: Number(r.remote) || 0,
          bong_tuyp: Number(r.bong_tuyp) || 0,
          ban_an: Number(r.ban_an) || 0,
          ghe_an: Number(r.ghe_an) || 0,
        });
      }
    }
    return map;
  }, [existingRows]);

  const canStart = !running && (workerCount === 0 || acknowledgeWorkers);

  const handleRunSync = async () => {
    if (!canStart) return;
    setRunning(true);
    setErrorMsg(null);
    setProgressPct(5);

    const supabase = createClient();

    try {
      // 1. Fetch ALL current facility IDs from Supabase and delete cleanly in chunks
      setStatusStep('1/6 · Đang xóa danh mục Cơ sở vật chất mẫu cũ...');
      const oldFacIds: string[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('facilities')
          .select('id')
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`Không thể đọc danh mục cũ: ${error.message}`);
        if (!data || data.length === 0) break;
        data.forEach((r: { id: string }) => {
          if (r.id) oldFacIds.push(String(r.id));
        });
        if (data.length < PAGE) break;
        from += PAGE;
      }

      for (let i = 0; i < oldFacIds.length; i += 200) {
        const chunk = oldFacIds.slice(i, i + 200);
        const { error: delErr } = await supabase.from('facilities').delete().in('id', chunk);
        if (delErr) throw new Error(`Lỗi xóa danh mục cũ: ${delErr.message}`);
      }
      setProgressPct(22);

      // 2. Clean stale non-system `room_units` labels (preserving __SYSTEM__ 3D layout config!)
      if (cleanOldLabelsAndBeds) {
        setStatusStep('2/6 · Đang dọn nhãn phòng mẫu cũ (giữ nguyên cấu hình 3D)...');
        const nonSystemKtxs = new Set<string>();
        let ruFrom = 0;
        while (true) {
          const { data: ruRows, error: ruErr } = await supabase
            .from('room_units')
            .select('ktx')
            .range(ruFrom, ruFrom + PAGE - 1);
          if (ruErr || !ruRows || ruRows.length === 0) break;
          ruRows.forEach((r: { ktx?: string | null }) => {
            const k = (r.ktx || '').trim();
            if (k && !(k.startsWith('__') && k.endsWith('__'))) {
              nonSystemKtxs.add(k);
            }
          });
          if (ruRows.length < PAGE) break;
          ruFrom += PAGE;
        }
        const ktxToClear = Array.from(nonSystemKtxs);
        if (ktxToClear.length > 0) {
          await supabase.from('room_units').delete().in('ktx', ktxToClear);
        }
      }
      setProgressPct(35);

      // 3. Clean stale old `beds` rows so Quản lý Giường & QR Portal match 100%
      if (cleanOldLabelsAndBeds) {
        setStatusStep('3/6 · Đang dọn dữ liệu giường mẫu cũ...');
        const oldBedIds: string[] = [];
        let bFrom = 0;
        while (true) {
          const query = supabase
            .from('beds')
            .select('id, status, worker_id')
            .range(bFrom, bFrom + PAGE - 1);
          const { data: bRows, error: bErr } = await query;
          if (bErr || !bRows || bRows.length === 0) break;
          bRows.forEach((b: { id: string; status?: string; worker_id?: string | null }) => {
            // If 0 workers remain, wipe all stale test beds; otherwise only wipe empty beds safely
            if (workerCount === 0 || (b.status === 'empty' && !b.worker_id)) {
              if (b.id) oldBedIds.push(String(b.id));
            }
          });
          if (bRows.length < PAGE) break;
          bFrom += PAGE;
        }
        for (let i = 0; i < oldBedIds.length; i += 250) {
          const chunk = oldBedIds.slice(i, i + 250);
          await supabase.from('beds').delete().in('id', chunk);
        }
      }
      setProgressPct(52);

      // 4. Insert the 90 official rooms (KTX Phước Vĩnh Tây · Dãy 1–6 · Phòng 1–15 · 20 giường/phòng)
      setStatusStep('4/6 · Đang khởi tạo 90 phòng chuẩn KTX Phước Vĩnh Tây...');
      const newFacilities: Array<Omit<ExistingFacilitySnapshot, 'id'>> = [];
      for (let d = 1; d <= OFFICIAL_DAY_COUNT; d++) {
        const dayLabel = `Dãy ${d}`;
        for (let p = 1; p <= OFFICIAL_ROOMS_PER_DAY; p++) {
          const matchedEquip = preservePerRoomEquip
            ? existingEquipByDayRoom.get(`${d}||${p}`)
            : undefined;
          const eq = matchedEquip || fallbackEquip;

          newFacilities.push({
            ktx: OFFICIAL_KTX_NAME,
            day: dayLabel,
            phong_khu_vuc: `Phòng ${p}`,
            giuong: OFFICIAL_BEDS_PER_ROOM,
            dieu_hoa: eq.dieu_hoa,
            tu: eq.tu,
            quat: eq.quat,
            o_cam_dien: eq.o_cam_dien,
            remote: eq.remote,
            bong_tuyp: eq.bong_tuyp,
            ban_an: eq.ban_an,
            ghe_an: eq.ghe_an,
            ghi_chu: '',
            room_type: 'accommodation',
            is_visible: true,
          });
        }
      }

      const { error: insFacErr } = await supabase.from('facilities').insert(newFacilities);
      if (insFacErr) {
        throw new Error(`Lỗi khởi tạo 90 phòng mới: ${insFacErr.message}`);
      }
      setProgressPct(70);

      // 5. Batch-generate 1,800 clean empty beds (90 rooms × 20 beds) for Bed Management, QR & 3D Room View
      setStatusStep('5/6 · Đang khởi tạo đồng bộ 1.800 giường trống (10 bộ giường tầng/phòng)...');
      const newBeds: Array<{
        ktx: string;
        day: string;
        phong_so: string;
        giuong: string;
        status: string;
      }> = [];
      for (let d = 1; d <= OFFICIAL_DAY_COUNT; d++) {
        const dayLabel = `Dãy ${d}`;
        for (let p = 1; p <= OFFICIAL_ROOMS_PER_DAY; p++) {
          for (let g = 1; g <= OFFICIAL_BEDS_PER_ROOM; g++) {
            newBeds.push({
              ktx: OFFICIAL_KTX_NAME,
              day: dayLabel,
              phong_so: String(p),
              giuong: String(g),
              status: 'empty',
            });
          }
        }
      }

      const BED_BATCH = 400;
      for (let i = 0; i < newBeds.length; i += BED_BATCH) {
        const chunk = newBeds.slice(i, i + BED_BATCH);
        const { error: bedErr } = await supabase
          .from('beds')
          .upsert(chunk, { onConflict: 'ktx,day,phong_so,giuong', ignoreDuplicates: true });
        if (bedErr) {
          console.warn('[Sync3DBlueprintModal] Bed batch warning:', bedErr.message);
        }
        setProgressPct(70 + Math.round(((i + chunk.length) / newBeds.length) * 22));
      }

      // 6. Check if any Staff profiles still have assigned_blocks pointing to old test KTX names
      setStatusStep('6/6 · Kiểm tra phân quyền & làm mới bộ nhớ đệm toàn hệ thống...');
      let staleStaffCount = 0;
      try {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, role, assigned_blocks');
        if (Array.isArray(profiles)) {
          profiles.forEach((p: { role?: string; assigned_blocks?: unknown }) => {
            if (p.role === 'admin' || p.role === 'super_admin') return;
            if (Array.isArray(p.assigned_blocks) && p.assigned_blocks.length > 0) {
              const hasOldBlock = p.assigned_blocks.some(
                (blk: unknown) =>
                  typeof blk === 'string' && !blk.trim().startsWith(`${OFFICIAL_KTX_NAME} - `)
              );
              if (hasOldBlock) staleStaffCount++;
            }
          });
        }
      } catch {
        // non-blocking
      }

      // Clear local room-gender cache & invalidate global structure/facilities caches
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem('ktx_room_gender_labels_v1');
        } catch {}
      }
      invalidateFacilitiesCache();
      invalidateKtxStructureCache();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
      }

      onAuditLog(
        `Khởi tạo đồng bộ chuẩn 3D: ${OFFICIAL_KTX_NAME} (${OFFICIAL_DAY_COUNT} Dãy × ${OFFICIAL_ROOMS_PER_DAY} Phòng = ${OFFICIAL_TOTAL_ROOMS} phòng, ${OFFICIAL_BEDS_PER_ROOM} giường/phòng = ${OFFICIAL_TOTAL_BEDS.toLocaleString('vi-VN')} chỗ)`
      );

      setProgressPct(100);
      await onCompleted({
        ktxName: OFFICIAL_KTX_NAME,
        roomCount: OFFICIAL_TOTAL_ROOMS,
        bedCount: OFFICIAL_TOTAL_BEDS,
        staleStaffCount,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi đồng bộ';
      setErrorMsg(message);
      toast.error(message);
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-xl rounded-2xl border border-bdr2 bg-surf shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-act/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-pri/15 text-pri flex items-center justify-center shrink-0">
              <Box size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-tx truncate">
                Khởi tạo Cơ sở vật chất chuẩn theo Sơ đồ 3D
              </h2>
              <p className="text-xs text-mu truncate">
                Đồng bộ 1:1 với bản vẽ vận hành chính thức (25/11/2026)
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act disabled:opacity-40 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs sm:text-sm">
          {/* Official Blueprint Spec Summary */}
          <div className="rounded-xl border border-pri/30 bg-pri/5 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-pri font-bold text-xs uppercase tracking-wider">
              <BedDouble size={14} />
              <span>Cấu trúc mục tiêu khớp bản vẽ 3D (1 tầng)</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-surf border border-bdr p-2.5">
                <div className="text-mu text-[11px]">Tên Khu KTX chính thức</div>
                <div className="font-extrabold text-tx mt-0.5">{OFFICIAL_KTX_NAME}</div>
              </div>
              <div className="rounded-lg bg-surf border border-bdr p-2.5">
                <div className="text-mu text-[11px]">Quy mô phòng ở (đúng bản vẽ)</div>
                <div className="font-extrabold text-tx mt-0.5 font-tabular">
                  6 Dãy × 15 Phòng = 90 phòng
                </div>
              </div>
              <div className="rounded-lg bg-surf border border-bdr p-2.5">
                <div className="text-mu text-[11px]">Sức chứa mỗi phòng</div>
                <div className="font-extrabold text-ok mt-0.5 font-tabular">
                  20 chỗ (10 giường tầng)
                </div>
              </div>
              <div className="rounded-lg bg-surf border border-bdr p-2.5">
                <div className="text-mu text-[11px]">Tổng sức chứa toàn KTX</div>
                <div className="font-extrabold text-pri mt-0.5 font-tabular">
                  1.800 giường trống
                </div>
              </div>
            </div>
            <p className="text-[11px] text-mu leading-relaxed">
              Đánh số chuẩn: <strong>Dãy 1 → Dãy 6</strong> (3 dãy phía Bắc + 3 dãy phía Nam khu Nhà ăn), mỗi dãy 1 hàng liền nhau từ{' '}
              <strong>Phòng 1 → Phòng 15</strong> (1 tầng). Chưa thêm khu chức năng (sẽ bổ sung sau khi cần).
            </p>
          </div>

          {/* Pre-flight Worker Check */}
          {workerCount === 0 ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-ok/35 bg-okbg p-3 text-xs text-ok">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Dữ liệu công nhân hiện đã về 0 — Rất an toàn để đồng bộ!</p>
                <p className="opacity-90 mt-0.5">
                  Hệ thống sẽ thay thế toàn bộ {existingRows.length} dòng CSVC mẫu cũ, dọn nhãn phòng &amp; giường mẫu cũ và nạp mới đúng 90 phòng (1.800 giường trống).
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-wn/45 tint-wn p-3.5 space-y-2.5 text-xs">
              <div className="flex items-start gap-2 text-wn">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">
                    Đang còn {workerCount.toLocaleString('vi-VN')} công nhân mẫu trong hệ thống
                  </p>
                  <p className="text-tx/85 leading-relaxed">
                    Khuyên bạn vào <strong>Quản lý Công nhân → Xóa tất cả</strong> trước để đưa danh sách công nhân về 0, sau đó quay lại bấm Đồng bộ để dữ liệu sạch 100%.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Link
                  href="/worker-management"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surf border border-bdr2 text-tx font-semibold hover:bg-act text-[11px]"
                >
                  <span>Mở Quản lý Công nhân</span>
                  <ExternalLink size={12} />
                </Link>
                <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] font-semibold text-tx">
                  <input
                    type="checkbox"
                    checked={acknowledgeWorkers}
                    onChange={e => setAcknowledgeWorkers(e.target.checked)}
                    disabled={running}
                    className="rounded accent-blue-600"
                  />
                  <span>Vẫn đồng bộ Cơ sở vật chất ngay (xóa công nhân sau)</span>
                </label>
              </div>
            </div>
          )}

          {/* Preserved Equipment Settings */}
          <div className="rounded-xl border border-bdr p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-tx text-xs">
                Trang thiết bị giữ lại từ dữ liệu cũ ({existingAccCount} phòng hiện có)
              </span>
            </div>
            <label className="flex items-start gap-2 text-xs text-tx cursor-pointer">
              <input
                type="checkbox"
                checked={preservePerRoomEquip}
                onChange={e => setPreservePerRoomEquip(e.target.checked)}
                disabled={running}
                className="mt-0.5 rounded accent-blue-600"
              />
              <span>
                Giữ nguyên số lượng thiết bị cũ theo đúng từng cặp <strong>Dãy – Phòng</strong> (các phòng mới bổ sung như P.14–P.15 sẽ áp dụng mức chuẩn bên dưới):
              </span>
            </label>
            <div className="grid grid-cols-4 gap-2 pt-1">
              {EQUIPMENT_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-semibold text-mu mb-1">{f.label}</label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    disabled={running}
                    value={fallbackEquip[f.key]}
                    onChange={e =>
                      setFallbackEquip(prev => ({
                        ...prev,
                        [f.key]: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-full rounded-lg border border-bdr2 bg-act/40 px-2 py-1 text-xs font-mono font-tabular text-tx focus:outline-none focus:border-pri"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Cleanup Checkbox */}
          <label className="flex items-start gap-2.5 rounded-xl border border-bdr p-3 text-xs text-tx cursor-pointer">
            <input
              type="checkbox"
              checked={cleanOldLabelsAndBeds}
              onChange={e => setCleanOldLabelsAndBeds(e.target.checked)}
              disabled={running}
              className="mt-0.5 rounded accent-blue-600"
            />
            <span>
              <strong>Dọn sạch nhãn phòng mẫu cũ (Nam/Nữ, Đơn vị, Ghi chú) &amp; giường mẫu cũ</strong>{' '}
              để các khu mẫu cũ (KTX 1, KTX 2) biến mất hoàn toàn khỏi bộ lọc và khởi tạo đúng 1.800 giường trống cho <strong>{OFFICIAL_KTX_NAME}</strong>.
            </span>
          </label>

          {/* Progress / Error */}
          {running && (
            <div className="rounded-xl border border-pri/30 bg-pri/5 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-pri">
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  {statusStep}
                </span>
                <span className="font-mono font-tabular">{progressPct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-act overflow-hidden">
                <div
                  className="h-full bg-pri transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-xl border border-dgr bg-dgrbg p-3 text-xs text-dgr">
              <ShieldAlert size={15} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-bdr bg-act/30">
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-bdr2 bg-surf text-tx text-xs font-semibold hover:bg-act disabled:opacity-50 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={!canStart}
            onClick={handleRunSync}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl btn-glow-primary text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            <span>{running ? 'Đang đồng bộ...' : 'Xác nhận khởi tạo 90 phòng (1.800 chỗ)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
