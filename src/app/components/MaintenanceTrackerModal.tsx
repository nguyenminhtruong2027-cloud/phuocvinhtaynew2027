'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Wrench,
  BedDouble,
  CheckCircle2,
  Box,
  Loader2,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import {
  FacilityItem,
  formatRoomDisplay,
  invalidateFacilitiesCache,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { hasFacilityIssueNote } from '@/lib/smartRoomAssign';
import { naturalSortCompare } from '@/data/workers';

export interface MaintenanceBedItem {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
}

interface Props {
  facilities: FacilityItem[];
  maintenanceBeds: MaintenanceBedItem[];
  onClose: () => void;
  onResolved: () => void;
}

interface UnifiedMaintenanceRow {
  uid: string;
  kind: 'facility' | 'bed';
  ktx: string;
  day: string;
  room: string;
  bedLabel?: string;
  description: string;
  recordId: string;
}

export default function MaintenanceTrackerModal({
  facilities,
  maintenanceBeds,
  onClose,
  onResolved,
}: Props) {
  const { currentUser, isAdmin, isTechnician, canWriteBlock, canAccessMaintenanceBlock } = useAuth();
  const { addLog } = useAudit();
  const supabase = useMemo(() => createClient(), []);

  const [typeFilter, setTypeFilter] = useState<'all' | 'facility' | 'bed'>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [resolvingUid, setResolvingUid] = useState<string | null>(null);

  const allRows = useMemo<UnifiedMaintenanceRow[]>(() => {
    const rows: UnifiedMaintenanceRow[] = [];

    for (const f of facilities) {
      if (f.id && hasFacilityIssueNote(f.ghi_chu)) {
        rows.push({
          uid: `fac-${f.id}`,
          kind: 'facility',
          ktx: f.ktx,
          day: f.day,
          room: normalizeRoomLabel(f.phong_khu_vuc),
          description: (f.ghi_chu || '').trim(),
          recordId: f.id,
        });
      }
    }

    for (const b of maintenanceBeds) {
      rows.push({
        uid: `bed-${b.id}`,
        kind: 'bed',
        ktx: b.ktx,
        day: b.day,
        room: normalizeRoomLabel(b.phong_so),
        bedLabel: b.giuong,
        description: `Giường ${b.giuong} đang ở trạng thái bảo trì`,
        recordId: b.id,
      });
    }

    return rows.sort((a, b) => {
      const dCmp = naturalSortCompare(a.day, b.day);
      if (dCmp !== 0) return dCmp;
      return naturalSortCompare(a.room, b.room);
    });
  }, [facilities, maintenanceBeds]);

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach(r => { if (r.day) set.add(r.day); });
    return Array.from(set).sort(naturalSortCompare);
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(r => {
      if (typeFilter !== 'all' && r.kind !== typeFilter) return false;
      if (dayFilter !== 'all' && r.day !== dayFilter) return false;
      if (q) {
        const hay = `${r.day} phòng ${r.room} ${r.bedLabel || ''} ${r.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, typeFilter, dayFilter, search]);

  const facilityCount = allRows.filter(r => r.kind === 'facility').length;
  const bedCount = allRows.filter(r => r.kind === 'bed').length;

  const handleMarkResolved = async (row: UnifiedMaintenanceRow) => {
    const hasPerm = isAdmin || (isTechnician ? canAccessMaintenanceBlock(row.day, row.ktx) : canWriteBlock(row.day, row.ktx));
    if (!hasPerm) {
      toast.error('Bạn không có quyền cập nhật bảo trì cho Dãy này.');
      return;
    }

    setResolvingUid(row.uid);
    try {
      const actor = currentUser?.name || currentUser?.email || 'Quản trị viên';
      if (row.kind === 'facility') {
        const { error } = await supabase
          .from('facilities')
          .update({ ghi_chu: '' })
          .eq('id', row.recordId);
        if (error) throw error;

        invalidateFacilitiesCache();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ktx_facilities_updated'));
        }
        addLog(
          actor,
          'FACILITY_UPDATE',
          `Đánh dấu đã khắc phục sự cố CSVC tại ${row.ktx} - ${row.day} - ${formatRoomDisplay(row.room)} (trước đó: ${row.description})`
        );
        toast.success(`Đã đánh dấu khắc phục sự cố tại ${row.day} · ${formatRoomDisplay(row.room)}`);
      } else {
        const { error } = await supabase
          .from('beds')
          .update({ status: 'empty', worker_id: null, ma_nv: null, ho_va_ten: null })
          .eq('id', row.recordId);
        if (error) throw error;

        addLog(
          actor,
          'UPDATE',
          `Hoàn tất bảo trì giường ${row.bedLabel} tại ${row.ktx} - ${row.day} - ${formatRoomDisplay(row.room)}`
        );
        toast.success(`Đã mở lại Giường ${row.bedLabel} (${row.day} · ${formatRoomDisplay(row.room)})`);
      }

      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể cập nhật trạng thái khắc phục');
    } finally {
      setResolvingUid(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr bg-side">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl tint-wn text-wn border border-wn/30 flex items-center justify-center shrink-0">
              <Wrench size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-tx truncate">
                Theo dõi Sự cố CSVC & Bảo trì tập trung
              </h3>
              <p className="text-xs text-mu tabular-nums mt-0.5">
                {facilityCount} phòng báo hỏng thiết bị · {bedCount} giường đang bảo trì · Đồng bộ trực tiếp với Bản đồ 3D
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

        {/* Filter Bar */}
        <div className="px-5 py-3 border-b border-bdr bg-page/50 flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-act border border-bdr">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                typeFilter === 'all' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              Tất cả ({allRows.length})
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('facility')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                typeFilter === 'facility' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              Thiết bị phòng ({facilityCount})
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('bed')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                typeFilter === 'bed' ? 'bg-surf text-tx shadow-sm' : 'text-mu hover:text-tx'
              }`}
            >
              Giường bảo trì ({bedCount})
            </button>
          </div>

          <select
            value={dayFilter}
            onChange={e => setDayFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-surf border border-bdr text-xs text-tx focus:outline-none focus:border-pri2"
          >
            <option value="all">Tất cả Dãy</option>
            {availableDays.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm phòng, nội dung hỏng..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surf border border-bdr text-xs text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
            />
          </div>
        </div>

        {/* List Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-bdr px-5">
          {filteredRows.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CheckCircle2 size={32} className="mx-auto text-ok" />
              <p className="text-sm font-semibold text-tx">Không có sự cố tồn đọng</p>
              <p className="text-xs text-mu">
                Tất cả thiết bị phòng ở và giường đều đang hoạt động bình thường.
              </p>
            </div>
          ) : (
            filteredRows.map(row => {
              const isBusy = resolvingUid === row.uid;
              const href3D = `/ktx-3d?ktx=${encodeURIComponent(row.ktx)}&day=${encodeURIComponent(row.day)}&room=${encodeURIComponent(row.room)}`;
              return (
                <div
                  key={row.uid}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-tx">
                      {row.kind === 'facility' ? (
                        <AlertTriangle size={15} className="text-wn shrink-0" />
                      ) : (
                        <BedDouble size={15} className="text-dgr shrink-0" />
                      )}
                      <span>
                        {row.day} · {formatRoomDisplay(row.room)}
                        {row.bedLabel ? ` · Giường ${row.bedLabel}` : ''}
                      </span>
                      <span className="text-[11px] font-medium text-mu">
                        · {row.kind === 'facility' ? 'Thiết bị CSVC' : 'Giường bảo trì'}
                      </span>
                    </div>
                    <p className="text-xs text-mu mt-1 break-words">{row.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={href3D}
                      onClick={onClose}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-act hover:bg-bdg text-xs font-semibold text-tx border border-bdr transition-colors whitespace-nowrap"
                    >
                      <Box size={13} className="text-lnk" />
                      <span>Mở 3D</span>
                    </Link>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleMarkResolved(row)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-okbg hover:opacity-90 text-ok border border-ok2/35 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
                    >
                      {isBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      <span>Đã khắc phục</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
