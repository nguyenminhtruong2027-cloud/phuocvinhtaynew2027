'use client';

import React, { useMemo, useState } from 'react';
import { X, VenusAndMars, Printer, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Worker, naturalSortCompare } from '@/data/workers';
import { formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
import { printBatchRoomDoorPosters } from '@/lib/batchRoomDoorPrint';

export interface BulkRoomDescriptor {
  ktx: string;
  day: string;
  room: string;
  capacity: number;
  workers: Worker[];
  genderLabel: string;
  note?: string | null;
}

interface Props {
  mode: 'gender' | 'print';
  rooms: BulkRoomDescriptor[];
  onApplyBulkGender?: (
    targets: Array<{ ktx: string; day: string; room: string }>,
    gender: 'male' | 'female' | 'auto'
  ) => Promise<void>;
  onClose: () => void;
}

export default function BulkGenderAndPrintModal({
  mode,
  rooms,
  onApplyBulkGender,
  onClose,
}: Props) {
  const days = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach(r => set.add(r.day));
    return Array.from(set).sort(naturalSortCompare);
  }, [rooms]);

  const [selectedDay, setSelectedDay] = useState<string>(() => days[0] || 'all');
  const [fromRoomNum, setFromRoomNum] = useState<string>('1');
  const [toRoomNum, setToRoomNum] = useState<string>('15');
  const [targetGender, setTargetGender] = useState<'male' | 'female' | 'auto'>('male');
  const [onlyOccupied, setOnlyOccupied] = useState<boolean>(false);
  const [applying, setApplying] = useState(false);

  const matchedRooms = useMemo(() => {
    const fromN = parseInt(fromRoomNum, 10);
    const toN = parseInt(toRoomNum, 10);
    const hasRange = !isNaN(fromN) && !isNaN(toN) && fromN > 0 && toN >= fromN;

    return rooms
      .filter(r => {
        if (selectedDay !== 'all' && r.day !== selectedDay) return false;
        if (mode === 'print' && onlyOccupied && r.workers.length === 0) return false;
        if (hasRange) {
          const numMatch = normalizeRoomLabel(r.room).match(/^(\d+)$/);
          if (numMatch) {
            const n = parseInt(numMatch[1], 10);
            if (n < fromN || n > toN) return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const dCmp = naturalSortCompare(a.day, b.day);
        if (dCmp !== 0) return dCmp;
        return naturalSortCompare(a.room, b.room);
      });
  }, [rooms, selectedDay, fromRoomNum, toRoomNum, mode, onlyOccupied]);

  const handleSubmit = async () => {
    if (matchedRooms.length === 0) {
      toast.warning('Không có phòng nào phù hợp với phạm vi đã chọn.');
      return;
    }

    if (mode === 'gender') {
      if (!onApplyBulkGender) return;
      setApplying(true);
      try {
        await onApplyBulkGender(
          matchedRooms.map(r => ({ ktx: r.ktx, day: r.day, room: r.room })),
          targetGender
        );
        const label =
          targetGender === 'male'
            ? 'Phòng Nam'
            : targetGender === 'female'
            ? 'Phòng Nữ'
            : 'Tự động';
        toast.success(`Đã cập nhật ${matchedRooms.length} phòng sang công năng "${label}".`);
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi gán công năng hàng loạt');
      } finally {
        setApplying(false);
      }
      return;
    }

    const ok = printBatchRoomDoorPosters(
      matchedRooms.map(r => ({
        ktx: r.ktx,
        day: r.day,
        room: r.room,
        capacity: r.capacity,
        genderLabel: r.genderLabel,
        workers: r.workers,
        note: r.note,
      }))
    );
    if (ok) {
      toast.success(`Đang chuẩn bị in ${matchedRooms.length} bảng niêm yết cửa phòng (khổ A4).`);
      onClose();
    } else {
      toast.error('Không thể khởi tạo lệnh in.');
    }
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
            <div className="w-9 h-9 rounded-xl bg-bdg text-lnk flex items-center justify-center shrink-0">
              {mode === 'gender' ? <VenusAndMars size={18} /> : <Printer size={18} />}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                {mode === 'gender'
                  ? 'Gán công năng phòng Nam / Nữ hàng loạt'
                  : 'In bảng niêm yết cửa phòng hàng loạt'}
              </h3>
              <p className="text-xs text-mu mt-0.5">
                {mode === 'gender'
                  ? 'Khóa nhanh công năng giới tính cho cả Dãy hoặc cụm phòng'
                  : 'Xuất mỗi phòng 1 trang A4 chuẩn để dán trực tiếp lên cửa phòng'}
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

        <div className="p-5 space-y-4">
          {/* Select Dãy */}
          <div>
            <label className="block text-xs font-semibold text-mu mb-1.5">Chọn Dãy nhà</label>
            <select
              value={selectedDay}
              onChange={e => setSelectedDay(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-page border border-bdr text-sm text-tx focus:outline-none focus:border-pri2"
            >
              <option value="all">Toàn bộ các Dãy ({days.length} Dãy)</option>
              {days.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Room Number Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-mu mb-1.5">Từ phòng số</label>
              <input
                type="number"
                min={1}
                max={99}
                value={fromRoomNum}
                onChange={e => setFromRoomNum(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-page border border-bdr text-sm text-tx font-mono tabular-nums focus:outline-none focus:border-pri2"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-mu mb-1.5">Đến phòng số</label>
              <input
                type="number"
                min={1}
                max={99}
                value={toRoomNum}
                onChange={e => setToRoomNum(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-page border border-bdr text-sm text-tx font-mono tabular-nums focus:outline-none focus:border-pri2"
              />
            </div>
          </div>

          {mode === 'gender' ? (
            <div>
              <label className="block text-xs font-semibold text-mu mb-1.5">
                Công năng giới tính áp dụng
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setTargetGender('male')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    targetGender === 'male'
                      ? 'bg-pri text-white border-pri'
                      : 'bg-page text-tx border-bdr hover:bg-act'
                  }`}
                >
                  ♂ Phòng Nam
                </button>
                <button
                  type="button"
                  onClick={() => setTargetGender('female')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    targetGender === 'female'
                      ? 'bg-pink-600 text-white border-pink-600'
                      : 'bg-page text-tx border-bdr hover:bg-act'
                  }`}
                >
                  ♀ Phòng Nữ
                </button>
                <button
                  type="button"
                  onClick={() => setTargetGender('auto')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    targetGender === 'auto'
                      ? 'bg-act text-tx border-pri2'
                      : 'bg-page text-mu border-bdr hover:bg-act'
                  }`}
                >
                  Tự động
                </button>
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-page border border-bdr cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOccupied}
                onChange={e => setOnlyOccupied(e.target.checked)}
                className="rounded border-bdr accent-pri"
              />
              <span className="text-xs font-medium text-tx">
                Chỉ in các phòng đang có công nhân (bỏ qua phòng trống hoàn toàn)
              </span>
            </label>
          )}

          {/* Target Summary */}
          <div className="p-3 rounded-xl bg-page border border-bdr text-xs text-mu">
            <div className="flex items-center justify-between font-semibold text-tx mb-1">
              <span>Phạm vi áp dụng</span>
              <span className="font-mono tabular-nums text-lnk">{matchedRooms.length} phòng</span>
            </div>
            {matchedRooms.length > 0 ? (
              <p className="line-clamp-2 leading-relaxed">
                {matchedRooms
                  .slice(0, 12)
                  .map(r => `${r.day} ${formatRoomDisplay(r.room)}`)
                  .join(', ')}
                {matchedRooms.length > 12 ? ` ... (+${matchedRooms.length - 12} phòng nữa)` : ''}
              </p>
            ) : (
              <p className="text-wn">Không có phòng nào khớp với điều kiện lọc.</p>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-bdr bg-side flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={applying || matchedRooms.length === 0}
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:opacity-95 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            {applying ? (
              <Loader2 size={14} className="animate-spin" />
            ) : mode === 'gender' ? (
              <CheckCircle2 size={14} />
            ) : (
              <Printer size={14} />
            )}
            <span>
              {mode === 'gender'
                ? `Áp dụng cho ${matchedRooms.length} phòng`
                : `In ${matchedRooms.length} trang A4`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
