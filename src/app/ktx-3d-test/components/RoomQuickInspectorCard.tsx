'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BedDouble,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  PlusCircle,
  Send,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  createInternalMaintenanceTicket,
  getTicketCategoryShortLabel,
  getTicketSlaStatus,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_META,
  type MaintenanceTicket,
  type TicketCategory,
  type TicketPriority,
} from '@/lib/maintenanceTickets';
import {
  deduplicateBedRows,
  normalizeBedLabel,
  normalizeDayKey,
  normalizeKtxCompact,
} from '@/lib/bedSync';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';
import type { CampusRoomNode } from '../types';

interface MiniBedSlot {
  bedNum: number;
  label: string;
  tier: 'bottom' | 'top';
  status: 'occupied' | 'empty' | 'maintenance' | 'checkout_pending';
  occupantName?: string | null;
  occupantMaNV?: string | null;
}

interface RoomQuickInspectorCardProps {
  room: CampusRoomNode;
  roomTickets: MaintenanceTicket[];
  isLight: boolean;
  hudCard: string;
  hudMuted: string;
  hudSubtleBtn: string;
  roomStatusBusy: boolean;
  equipmentOpen: boolean;
  reporterName: string;
  canCreateTicket: boolean;
  onClose: () => void;
  onEnterRoom: (room: CampusRoomNode) => void;
  onEnterRoomAtBed: (room: CampusRoomNode, bedNumber: number) => void;
  onToggleEquipment: () => void;
  onToggleVisibility: (room: CampusRoomNode) => void;
  onToggleRoomType: (room: CampusRoomNode) => void;
  onTicketCreated: (ticket: MaintenanceTicket) => void;
}

export default function RoomQuickInspectorCard({
  room,
  roomTickets,
  isLight,
  hudCard,
  hudMuted,
  hudSubtleBtn,
  roomStatusBusy,
  equipmentOpen,
  reporterName,
  canCreateTicket,
  onClose,
  onEnterRoom,
  onEnterRoomAtBed,
  onToggleEquipment,
  onToggleVisibility,
  onToggleRoomType,
  onTicketCreated,
}: RoomQuickInspectorCardProps) {
  const [beds, setBeds] = useState<MiniBedSlot[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>('electric');
  const [ticketPriority, setTicketPriority] = useState<TicketPriority>('normal');
  const [ticketDesc, setTicketDesc] = useState('');
  const [submittingTicket, setSubmittingTicket] = useState(false);

  // Load mini bunk-bed layout whenever focused room changes
  useEffect(() => {
    let active = true;
    if (room.roomType !== 'accommodation' || room.capacity <= 0) {
      setBeds([]);
      return;
    }

    const loadMiniBeds = async () => {
      setBedsLoading(true);
      try {
        const supabase = createClient();
        const normRoom = normalizeRoomLabel(room.roomRaw);
        const normKtx = normalizeKtxCompact(room.ktx);
        const normDay = normalizeDayKey(room.day);

        const { data } = await supabase
          .from('beds')
          .select('id, ktx, day, phong_so, giuong, status, worker_id, ma_nv, ho_va_ten')
          .ilike('phong_so', `%${normRoom}%`);

        if (!active) return;

        const matchingRows = (data || []).filter(
          (r: any) =>
            normalizeKtxCompact(r.ktx) === normKtx &&
            normalizeDayKey(r.day) === normDay &&
            normalizeRoomLabel(r.phong_so) === normRoom
        );
        const deduped = deduplicateBedRows(matchingRows);
        const bedByNum = new Map<number, any>();
        deduped.kept.forEach(row => {
          const n = parseInt(normalizeBedLabel(row.giuong), 10);
          if (Number.isFinite(n) && n > 0) bedByNum.set(n, row);
        });

        const workerByBed = new Map<number, { hoVaTen: string; maNV: string }>();
        room.workers.forEach(w => {
          const n = parseInt(normalizeBedLabel(w.giuong), 10);
          if (Number.isFinite(n) && n > 0 && !workerByBed.has(n)) {
            workerByBed.set(n, { hoVaTen: w.hoVaTen, maNV: w.maNV });
          }
        });

        const maxBed = Math.max(
          room.capacity,
          ...Array.from(bedByNum.keys()),
          ...Array.from(workerByBed.keys())
        );

        const built: MiniBedSlot[] = [];
        for (let i = 1; i <= Math.min(maxBed, 24); i++) {
          const dbRow = bedByNum.get(i);
          const wRow = workerByBed.get(i);
          let status: MiniBedSlot['status'] = 'empty';
          if (dbRow?.status === 'maintenance') {
            status = 'maintenance';
          } else if (dbRow?.status === 'checkout_pending') {
            status = 'checkout_pending';
          } else if (wRow || dbRow?.status === 'occupied' || dbRow?.worker_id) {
            status = 'occupied';
          }
          built.push({
            bedNum: i,
            label: `G${i}`,
            tier: i % 2 === 1 ? 'bottom' : 'top',
            status,
            occupantName: wRow?.hoVaTen || dbRow?.ho_va_ten || null,
            occupantMaNV: wRow?.maNV || dbRow?.ma_nv || null,
          });
        }

        if (active) setBeds(built);
      } catch {
        // Fallback to worker-only view
        if (active) {
          const fallback: MiniBedSlot[] = [];
          const wMap = new Map<number, { hoVaTen: string; maNV: string }>();
          room.workers.forEach(w => {
            const n = parseInt(normalizeBedLabel(w.giuong), 10);
            if (Number.isFinite(n) && n > 0) wMap.set(n, { hoVaTen: w.hoVaTen, maNV: w.maNV });
          });
          for (let i = 1; i <= Math.min(room.capacity, 24); i++) {
            const w = wMap.get(i);
            fallback.push({
              bedNum: i,
              label: `G${i}`,
              tier: i % 2 === 1 ? 'bottom' : 'top',
              status: w ? 'occupied' : 'empty',
              occupantName: w?.hoVaTen || null,
              occupantMaNV: w?.maNV || null,
            });
          }
          setBeds(fallback);
        }
      } finally {
        if (active) setBedsLoading(false);
      }
    };

    setShowTicketForm(false);
    void loadMiniBeds();
    return () => {
      active = false;
    };
  }, [room.key, room.ktx, room.day, room.roomRaw, room.roomType, room.capacity, room.workers]);

  const handleSubmitQuickTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketDesc.trim() || ticketDesc.trim().length < 3) {
      toast.error('Vui lòng nhập mô tả sự cố (tối thiểu 3 ký tự)');
      return;
    }
    setSubmittingTicket(true);
    try {
      const created = await createInternalMaintenanceTicket({
        ktx: room.ktx,
        day: room.day,
        phong_so: room.roomRaw,
        category: ticketCategory,
        priority: ticketPriority,
        description: ticketDesc.trim(),
        reporter_name: reporterName || 'Quản lý 3D',
      });
      setTicketDesc('');
      setTicketPriority('normal');
      setShowTicketForm(false);
      onTicketCreated(created);
      toast.success(`Đã tạo phiếu bảo trì ${created.ticket_code} cho ${room.day} · ${room.roomLabel}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể tạo phiếu bảo trì');
    } finally {
      setSubmittingTicket(false);
    }
  };

  const occupiedCount = beds.filter(b => b.status === 'occupied').length;
  const emptyCount = beds.filter(b => b.status === 'empty').length;
  const maintCount = beds.filter(b => b.status === 'maintenance').length;

  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border px-3.5 py-3 text-xs max-w-xl ${hudCard}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <MapPin
            size={14}
            className={
              !room.isVisible
                ? 'text-slate-400 shrink-0'
                : room.roomType === 'functional'
                  ? 'text-violet-400 shrink-0'
                  : 'text-sky-500 shrink-0'
            }
          />
          <span className="font-bold truncate">
            {room.ktx} · {room.day} · {room.roomLabel}
          </span>
          {room.roomType === 'functional' ? (
            <span className="px-1.5 py-0.5 rounded bg-violet-500/20 border border-violet-500/40 text-[10px] font-bold text-violet-400">
              Phòng chức năng
            </span>
          ) : (
            <span className={`font-tabular shrink-0 ${hudMuted}`}>
              {room.occupied}/{room.capacity} chỗ
              {room.dominantContractor || room.dominantUnit
                ? ` · ${room.dominantContractor || room.dominantUnit}`
                : ''}
            </span>
          )}
          {!room.isVisible && (
            <span className="px-1.5 py-0.5 rounded bg-slate-500/20 border border-slate-500/40 text-[10px] font-bold text-slate-400">
              Đang ẩn
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`p-1 rounded-lg ${hudMuted} hover:text-blue-500 shrink-0`}
          aria-label="Đóng thẻ phòng đang chọn"
        >
          <X size={13} />
        </button>
      </div>

      {/* Equipment & Notes Line */}
      {(room.ghiChu || room.facility) && (
        <div className={`text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1 ${hudMuted}`}>
          {room.facility && (
            <span className="font-tabular">
              {[
                Number(room.facility.giuong) > 0 ? `${room.facility.giuong} giường` : null,
                Number(room.facility.dieu_hoa) > 0 ? `${room.facility.dieu_hoa} ĐH` : null,
                Number(room.facility.tu) > 0 ? `${room.facility.tu} tủ` : null,
                Number(room.facility.quat) > 0 ? `${room.facility.quat} quạt` : null,
                Number(room.facility.ban_an) > 0 ? `${room.facility.ban_an} bàn` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Chưa khai báo thiết bị'}
            </span>
          )}
          {room.ghiChu && <span className="italic truncate max-w-full">Ghi chú: {room.ghiChu}</span>}
        </div>
      )}

      {/* Active Maintenance Tickets Strip */}
      {roomTickets.length > 0 && (
        <div
          className={`rounded-lg border px-2.5 py-2 space-y-1 ${
            isLight
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-rose-950/40 border-rose-500/35 text-rose-100'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
            <span className="inline-flex items-center gap-1 text-rose-500">
              <AlertTriangle size={12} />
              <span>{roomTickets.length} phiếu bảo trì đang mở</span>
            </span>
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto scrollbar-thin pr-1">
            {roomTickets.slice(0, 3).map(t => {
              const sla = getTicketSlaStatus(t);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <span className="truncate">
                    <strong className="font-mono">{t.ticket_code}</strong> ·{' '}
                    {getTicketCategoryShortLabel(t.category)}: {t.description}
                  </span>
                  <span
                    className={`shrink-0 font-tabular font-bold inline-flex items-center gap-0.5 text-[10px] ${
                      sla.state === 'overdue'
                        ? 'text-rose-500'
                        : t.priority === 'urgent'
                          ? 'text-amber-500'
                          : hudMuted
                    }`}
                  >
                    <Clock size={10} />
                    {sla.state === 'overdue' ? 'Quá SLA' : sla.elapsedLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Visual Mini Bunk-Bed Map */}
      {room.roomType === 'accommodation' && room.isVisible && (
        <div
          className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${
            isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-900/75 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-bold inline-flex items-center gap-1.5">
              <BedDouble size={12} className="text-sky-500" />
              <span>Sơ đồ giường tầng</span>
            </span>
            {bedsLoading ? (
              <span className={`inline-flex items-center gap-1 ${hudMuted}`}>
                <Loader2 size={11} className="animate-spin" /> Đang tải...
              </span>
            ) : (
              <span className={`font-tabular text-[10px] ${hudMuted}`}>
                Ở: {occupiedCount} · Trống: {emptyCount}
                {maintCount > 0 ? ` · Bảo trì: ${maintCount}` : ''}
              </span>
            )}
          </div>

          {!bedsLoading && beds.length > 0 && (
            <div className="grid grid-cols-5 sm:grid-cols-6 gap-1">
              {beds.map(b => {
                const tileCls =
                  b.status === 'occupied'
                    ? isLight
                      ? 'bg-blue-100 border-blue-300 text-blue-900 hover:bg-blue-200'
                      : 'bg-blue-500/20 border-blue-400/40 text-blue-200 hover:bg-blue-500/30'
                    : b.status === 'maintenance'
                      ? isLight
                        ? 'bg-rose-100 border-rose-300 text-rose-800 hover:bg-rose-200'
                        : 'bg-rose-500/25 border-rose-400/45 text-rose-200 hover:bg-rose-500/35'
                      : b.status === 'checkout_pending'
                        ? isLight
                          ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                          : 'bg-amber-500/20 border-amber-400/45 text-amber-200 hover:bg-amber-500/30'
                        : isLight
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                          : 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300 hover:bg-emerald-500/25';

                const tip =
                  b.status === 'occupied'
                    ? `${b.label} (${b.tier === 'bottom' ? 'Tầng 1' : 'Tầng 2'}): ${b.occupantName || 'Đang ở'}${b.occupantMaNV ? ` (#${b.occupantMaNV})` : ''} — Nhấp để soi trong 3D`
                    : b.status === 'maintenance'
                      ? `${b.label}: Đang bảo trì — Nhấp để xem trong 3D`
                      : b.status === 'checkout_pending'
                        ? `${b.label}: Chờ check-out`
                        : `${b.label} (${b.tier === 'bottom' ? 'Tầng 1' : 'Tầng 2'}): Giường trống — Nhấp để xếp giường trong 3D`;

                return (
                  <button
                    key={b.bedNum}
                    type="button"
                    onClick={() => onEnterRoomAtBed(room, b.bedNum)}
                    title={tip}
                    className={`px-1.5 py-1 rounded-md border text-[10px] font-mono font-bold transition-colors flex flex-col items-center leading-tight cursor-pointer ${tileCls}`}
                  >
                    <span>{b.label}</span>
                    <span className="text-[8px] font-sans font-normal opacity-80 truncate max-w-full">
                      {b.status === 'occupied'
                        ? (b.occupantName || 'Ở').split(' ').slice(-1)[0]
                        : b.status === 'maintenance'
                          ? 'Sửa'
                          : b.status === 'checkout_pending'
                            ? 'Trả'
                            : 'Trống'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Inline Quick Create Maintenance Ticket Form */}
      {showTicketForm && (
        <form
          onSubmit={handleSubmitQuickTicket}
          className={`rounded-lg border p-2.5 space-y-2 ${
            isLight ? 'bg-amber-50/70 border-amber-300' : 'bg-slate-900/95 border-amber-500/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-500 inline-flex items-center gap-1">
              <Wrench size={12} />
              <span>Tạo phiếu bảo trì nhanh · {room.day} {room.roomLabel}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowTicketForm(false)}
              className={`p-0.5 rounded ${hudMuted} hover:text-tx`}
            >
              <X size={12} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={ticketCategory}
              onChange={e => setTicketCategory(e.target.value as TicketCategory)}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-900'
                  : 'bg-slate-800 border-slate-700 text-slate-100'
              }`}
            >
              {TICKET_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {TICKET_CATEGORY_META[cat].label}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setTicketPriority('normal')}
                className={`rounded-lg border py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                  ticketPriority === 'normal'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : hudSubtleBtn
                }`}
              >
                Thường
              </button>
              <button
                type="button"
                onClick={() => setTicketPriority('urgent')}
                className={`rounded-lg border py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                  ticketPriority === 'urgent'
                    ? 'bg-rose-600 border-rose-500 text-white'
                    : hudSubtleBtn
                }`}
              >
                Khẩn (2g)
              </button>
            </div>
          </div>

          <input
            type="text"
            value={ticketDesc}
            onChange={e => setTicketDesc(e.target.value)}
            placeholder="Mô tả ngắn gọn sự cố (VD: Hỏng điều hòa, cháy bóng đèn giường G3)..."
            className={`w-full rounded-lg border px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-amber-500 ${
              isLight
                ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
                : 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-400'
            }`}
          />

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setShowTicketForm(false)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${hudSubtleBtn}`}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submittingTicket || ticketDesc.trim().length < 3}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold disabled:opacity-50 transition-colors cursor-pointer"
            >
              {submittingTicket ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Send size={11} />
              )}
              <span>Gửi phiếu ngay</span>
            </button>
          </div>
        </form>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {room.roomType === 'accommodation' && room.isVisible && (
          <button
            type="button"
            onClick={() => onEnterRoom(room)}
            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors cursor-pointer"
          >
            Vào phòng 3D →
          </button>
        )}

        {canCreateTicket && (
          <button
            type="button"
            onClick={() => setShowTicketForm(v => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold transition-colors cursor-pointer ${
              showTicketForm
                ? 'bg-amber-600 border-amber-500 text-white'
                : hudSubtleBtn
            }`}
          >
            <PlusCircle size={12} className={showTicketForm ? '' : 'text-amber-500'} />
            <span>Tạo phiếu bảo trì</span>
          </button>
        )}

        {room.hasWriteAccess && room.facility?.id && (
          <>
            <button
              type="button"
              onClick={onToggleEquipment}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold transition-colors cursor-pointer ${
                equipmentOpen
                  ? 'bg-orange-600 border-orange-500 text-white'
                  : hudSubtleBtn
              }`}
            >
              <Wrench size={12} className={equipmentOpen ? '' : 'text-orange-500'} />
              <span>CSVC</span>
            </button>

            <button
              type="button"
              disabled={roomStatusBusy}
              onClick={() => onToggleVisibility(room)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
                room.isVisible
                  ? hudSubtleBtn
                  : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white'
              }`}
            >
              {room.isVisible ? <EyeOff size={12} /> : <Eye size={12} />}
              <span>{room.isVisible ? 'Ẩn' : 'Hiện'}</span>
            </button>

            <button
              type="button"
              disabled={roomStatusBusy}
              onClick={() => onToggleRoomType(room)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
                room.roomType === 'functional'
                  ? 'bg-blue-600/20 border-blue-500/45 text-blue-400 hover:bg-blue-600/30'
                  : 'bg-violet-600/20 border-violet-500/45 text-violet-400 hover:bg-violet-600/30'
              }`}
            >
              <Building2 size={12} />
              <span>{room.roomType === 'functional' ? 'Đổi Phòng ở' : 'Phòng CN'}</span>
            </button>
          </>
        )}

        {roomTickets.length === 0 && room.maintenanceBedCount === 0 && !room.hasFacilityIssue && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
            <CheckCircle2 size={11} />
            <span>Ổn định</span>
          </span>
        )}
      </div>
    </div>
  );
}
