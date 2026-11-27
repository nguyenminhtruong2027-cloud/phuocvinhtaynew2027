'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  ShieldAlert,
  Phone,
  Copy,
  Check,
  Users,
  Sparkles,
  Zap,
  Loader2,
  UserX,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Worker, compareKtxNames, naturalSortCompare } from '@/data/workers';
import { FacilityItem, formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_META,
  TicketCategory,
  createInternalMaintenanceTicket,
} from '@/lib/maintenanceTickets';
import {
  DISCIPLINE_CATEGORY_META,
  DisciplineCategory,
  createDisciplineRecord,
} from '@/lib/disciplineService';
import { getVNDateString, getVNDateTimeDisplay } from '@/lib/vnDate';
import { StatusTag, MonoChip } from '@/components/ui/StatusTag';
import { normalizeBedLabel } from '@/lib/bedSync';

interface RoomInspectRecord {
  checked: boolean;
  headcountOk: boolean;
  cleanOk: boolean;
  electricalOk: boolean;
  absentWorkerIds: string[];
  note: string;
  ticketsCreated: string[];
  disciplinesCreated: string[];
}

const DEFAULT_ROOM_INSPECT: RoomInspectRecord = {
  checked: false,
  headcountOk: true,
  cleanOk: true,
  electricalOk: true,
  absentWorkerIds: [],
  note: '',
  ticketsCreated: [],
  disciplinesCreated: [],
};

interface Props {
  workers: Worker[];
  facilities: FacilityItem[];
  isAdmin: boolean;
  canWriteBlock: (day: string, ktx?: string) => boolean;
  actorName: string;
  actorEmail: string;
  onLog: (
    action: 'MAINTENANCE_TICKET_CREATE' | 'DISCIPLINE_CREATE',
    detail: string
  ) => void;
  onClose: () => void;
}

export default function HallwayInspectorModal({
  workers,
  facilities,
  isAdmin,
  canWriteBlock,
  actorName,
  actorEmail,
  onLog,
  onClose,
}: Props) {
  const todayVN = useMemo(() => getVNDateString(), []);

  // Build available KTX -> Days -> Rooms catalog
  const catalog = useMemo(() => {
    const ktxMap = new Map<string, Map<string, Set<string>>>();
    const addRoom = (ktx?: string | null, day?: string | null, room?: string | null) => {
      const k = (ktx || '').trim();
      const d = (day || '').trim();
      const r = normalizeRoomLabel(room || '');
      if (!k || !d || !r) return;
      if (!isAdmin && !canWriteBlock(d, k)) return;
      if (!ktxMap.has(k)) ktxMap.set(k, new Map());
      const dMap = ktxMap.get(k)!;
      if (!dMap.has(d)) dMap.set(d, new Set());
      dMap.get(d)!.add(r);
    };

    facilities.forEach(f => {
      if (f.is_visible !== false) addRoom(f.ktx, f.day, f.phong_khu_vuc);
    });
    workers.forEach(w => {
      if (!w.ngayRaKTX) addRoom(w.ktx, w.day, w.phongSo);
    });

    const ktxList = Array.from(ktxMap.keys()).sort(compareKtxNames);
    return { ktxMap, ktxList };
  }, [facilities, workers, isAdmin, canWriteBlock]);

  const [selectedKtx, setSelectedKtx] = useState<string>(() => catalog.ktxList[0] || '');
  const dayList = useMemo(() => {
    const dMap = catalog.ktxMap.get(selectedKtx);
    return dMap ? Array.from(dMap.keys()).sort(naturalSortCompare) : [];
  }, [catalog, selectedKtx]);

  const [selectedDay, setSelectedDay] = useState<string>(() => dayList[0] || '');

  useEffect(() => {
    if (!selectedKtx && catalog.ktxList.length > 0) {
      setSelectedKtx(catalog.ktxList[0]);
    }
  }, [selectedKtx, catalog.ktxList]);

  useEffect(() => {
    if (dayList.length > 0 && !dayList.includes(selectedDay)) {
      setSelectedDay(dayList[0]);
    }
  }, [dayList, selectedDay]);

  const roomsInDay = useMemo(() => {
    const set = catalog.ktxMap.get(selectedKtx)?.get(selectedDay);
    return set ? Array.from(set).sort(naturalSortCompare) : [];
  }, [catalog, selectedKtx, selectedDay]);

  const [roomIdx, setRoomIdx] = useState(0);
  useEffect(() => {
    setRoomIdx(0);
  }, [selectedKtx, selectedDay]);

  const currentRoom = roomsInDay[roomIdx] || '';

  // Persist inspection state per KTX + Day + Date in localStorage
  const storageKey = `ktx_hallway_inspect_v1:${todayVN}:${selectedKtx}:${selectedDay}`;
  const [records, setRecords] = useState<Record<string, RoomInspectRecord>>({});

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedKtx || !selectedDay) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        setRecords(JSON.parse(raw) as Record<string, RoomInspectRecord>);
      } else {
        setRecords({});
      }
    } catch {
      setRecords({});
    }
  }, [storageKey, selectedKtx, selectedDay]);

  const updateRoomRecord = (room: string, updater: (prev: RoomInspectRecord) => RoomInspectRecord) => {
    if (!room) return;
    setRecords(prev => {
      const nextRec = updater(prev[room] || DEFAULT_ROOM_INSPECT);
      const next = { ...prev, [room]: nextRec };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  // Active workers in current room
  const roomWorkersMap = useMemo(() => {
    const map = new Map<string, Worker[]>();
    for (const w of workers) {
      if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) continue;
      if ((w.ktx || '').trim() !== selectedKtx || (w.day || '').trim() !== selectedDay) continue;
      const r = normalizeRoomLabel(w.phongSo);
      if (!r) continue;
      const arr = map.get(r) || [];
      arr.push(w);
      map.set(r, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => naturalSortCompare(a.giuong || '999', b.giuong || '999'));
    }
    return map;
  }, [workers, selectedKtx, selectedDay]);

  const currentWorkers = roomWorkersMap.get(currentRoom) || [];
  const currentFacility = useMemo(
    () =>
      facilities.find(
        f =>
          f.ktx.trim() === selectedKtx &&
          f.day.trim() === selectedDay &&
          normalizeRoomLabel(f.phong_khu_vuc) === currentRoom
      ) || null,
    [facilities, selectedKtx, selectedDay, currentRoom]
  );

  const curRec = records[currentRoom] || DEFAULT_ROOM_INSPECT;

  // Quick inline ticket & discipline sub-forms
  const [quickPanel, setQuickPanel] = useState<'none' | 'ticket' | 'discipline' | 'summary'>('none');
  const [ticketCat, setTicketCat] = useState<TicketCategory>('electric');
  const [ticketDesc, setTicketDesc] = useState('');
  const [submittingQuick, setSubmittingQuick] = useState(false);

  const [discWorkerId, setDiscWorkerId] = useState('');
  const [discCat, setDiscCat] = useState<DisciplineCategory>('curfew');
  const [discTitle, setDiscTitle] = useState('');
  const [copiedSummary, setCopiedSummary] = useState(false);

  const stats = useMemo(() => {
    let checked = 0;
    let issues = 0;
    let totalAbsent = 0;
    for (const r of roomsInDay) {
      const rec = records[r];
      if (!rec?.checked) continue;
      checked++;
      const hasIssue =
        !rec.headcountOk ||
        !rec.cleanOk ||
        !rec.electricalOk ||
        rec.absentWorkerIds.length > 0 ||
        Boolean(rec.note.trim());
      if (hasIssue) issues++;
      totalAbsent += rec.absentWorkerIds.length;
    }
    return { checked, issues, totalAbsent };
  }, [roomsInDay, records]);

  const zaloSummaryText = useMemo(() => {
    const lines: string[] = [
      `🔦 BÁO CÁO KIỂM PHÒNG THỰC ĐỊA — ${selectedKtx} · ${selectedDay}`,
      `⏰ Thời điểm: ${getVNDateTimeDisplay()} | Cán bộ: ${actorName}`,
      `📊 Tiến độ: Đã kiểm ${stats.checked}/${roomsInDay.length} phòng · Phát hiện ${stats.issues} phòng cần lưu ý · Vắng ${stats.totalAbsent} người`,
    ];

    const issueLines: string[] = [];
    for (const r of roomsInDay) {
      const rec = records[r];
      if (!rec?.checked) continue;
      const flags: string[] = [];
      if (!rec.headcountOk) flags.push('Thiếu quân số');
      if (!rec.cleanOk) flags.push('Chưa gọn/vệ sinh');
      if (!rec.electricalOk) flags.push('Cảnh báo điện/PCCC');
      if (rec.absentWorkerIds.length > 0) {
        const rWorkers = roomWorkersMap.get(r) || [];
        const names = rec.absentWorkerIds
          .map(id => rWorkers.find(w => w.id === id)?.hoVaTen)
          .filter(Boolean)
          .join(', ');
        flags.push(`Vắng ${rec.absentWorkerIds.length}${names ? ` (${names})` : ''}`);
      }
      if (rec.note.trim()) flags.push(`Ghi chú: ${rec.note.trim()}`);
      if (rec.ticketsCreated.length > 0) flags.push(`Đã báo hỏng: ${rec.ticketsCreated.join(', ')}`);
      if (rec.disciplinesCreated.length > 0) flags.push(`Vi phạm: ${rec.disciplinesCreated.join(', ')}`);
      if (flags.length > 0) {
        issueLines.push(`• ${formatRoomDisplay(r)}: ${flags.join(' | ')}`);
      }
    }

    if (issueLines.length > 0) {
      lines.push('', '⚠️ CHI TIẾT PHÒNG CÓ VẤN ĐỀ:', ...issueLines);
    } else if (stats.checked > 0) {
      lines.push('', '✅ Toàn bộ các phòng đã kiểm đều ổn định, sạch sẽ và an toàn.');
    }
    return lines.join('\n');
  }, [selectedKtx, selectedDay, actorName, stats, roomsInDay, records, roomWorkersMap]);

  const handleCreateQuickTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !ticketDesc.trim()) {
      toast.error('Vui lòng nhập mô tả ngắn sự cố hỏng hóc.');
      return;
    }
    setSubmittingQuick(true);
    try {
      const created = await createInternalMaintenanceTicket({
        ktx: selectedKtx,
        day: selectedDay,
        phong_so: currentRoom,
        category: ticketCat,
        priority: ticketCat === 'electric' || ticketCat === 'plumbing' ? 'urgent' : 'normal',
        description: `[Kiểm phòng] ${ticketDesc.trim()}`,
        reporter_name: actorName,
      });
      onLog(
        'MAINTENANCE_TICKET_CREATE',
        `Tạo nhanh phiếu ${created.ticket_code} khi đi kiểm phòng ${selectedDay} - ${formatRoomDisplay(currentRoom)}: ${ticketDesc.trim()}`
      );
      updateRoomRecord(currentRoom, prev => ({
        ...prev,
        checked: true,
        ticketsCreated: [...prev.ticketsCreated, `${created.ticket_code} (${TICKET_CATEGORY_META[ticketCat].shortLabel})`],
      }));
      toast.success(`Đã tạo phiếu bảo trì ${created.ticket_code}`);
      setTicketDesc('');
      setQuickPanel('none');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể tạo phiếu bảo trì.');
    } finally {
      setSubmittingQuick(false);
    }
  };

  const handleCreateQuickDiscipline = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetWorker = currentWorkers.find(w => w.id === discWorkerId) || currentWorkers[0];
    if (!targetWorker || !discTitle.trim()) {
      toast.error('Vui lòng chọn công nhân và nhập nội dung vi phạm.');
      return;
    }
    setSubmittingQuick(true);
    try {
      const res = await createDisciplineRecord({
        worker_id: targetWorker.id,
        ho_va_ten: targetWorker.hoVaTen,
        ma_nv: targetWorker.maNV,
        cccd: targetWorker.cccd || '',
        so_dien_thoai: targetWorker.soDienThoai || '',
        don_vi: targetWorker.donVi,
        ktx: selectedKtx,
        day: selectedDay,
        phong_so: currentRoom,
        category: discCat,
        severity: 'warning',
        title: discTitle.trim(),
        description: `Ghi nhận trực tiếp khi đi kiểm phòng ${selectedKtx} · ${selectedDay} · ${formatRoomDisplay(currentRoom)}`,
        action_taken: 'Nhắc nhở trực tiếp tại phòng',
        incident_date: todayVN,
        recorded_by: actorName,
        recorded_by_email: actorEmail,
      });
      if (!res.record) {
        toast.error(res.error || 'Không thể lưu biên bản vi phạm.');
        return;
      }
      onLog(
        'DISCIPLINE_CREATE',
        `Ghi nhận vi phạm khi kiểm phòng ${selectedDay} - ${formatRoomDisplay(currentRoom)}: ${targetWorker.hoVaTen} — ${discTitle.trim()}`
      );
      updateRoomRecord(currentRoom, prev => ({
        ...prev,
        checked: true,
        disciplinesCreated: [...prev.disciplinesCreated, `${targetWorker.hoVaTen}: ${discTitle.trim()}`],
      }));
      toast.success(`Đã lưu biên bản vi phạm cho ${targetWorker.hoVaTen}`);
      setDiscTitle('');
      setQuickPanel('none');
    } finally {
      setSubmittingQuick(false);
    }
  };

  const markCheckedAndNext = () => {
    if (!currentRoom) return;
    updateRoomRecord(currentRoom, prev => ({ ...prev, checked: true }));
    if (roomIdx < roomsInDay.length - 1) {
      setRoomIdx(roomIdx + 1);
      setQuickPanel('none');
    } else {
      setQuickPanel('summary');
      toast.success(`Đã hoàn tất kiểm tra ${roomsInDay.length} phòng tại ${selectedDay}!`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface-elevated rounded-t-3xl sm:rounded-2xl shadow-2xl border border-bdr3 w-full max-w-2xl h-[94vh] sm:h-[88vh] flex flex-col overflow-hidden sheet-enter-bottom"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-bdr flex items-center justify-between gap-2 shrink-0 bg-surf">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-okbg text-ok border border-ok2/40 flex items-center justify-center shrink-0">
              <ClipboardCheck size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-tx truncate">Kiểm Phòng Thực Địa (Hành Lang)</h2>
              <p className="text-[11px] text-mu font-tabular">
                Đã kiểm <strong className="text-ok">{stats.checked}</strong>/{roomsInDay.length} phòng · Lưu ý:{' '}
                <strong className={stats.issues > 0 ? 'text-wn' : 'text-tx'}>{stats.issues}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setQuickPanel(p => (p === 'summary' ? 'none' : 'summary'))}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                quickPanel === 'summary'
                  ? 'bg-pri text-white border-pri'
                  : 'bg-surf border-bdr2 text-lnk hover:bg-act'
              }`}
            >
              Tổng kết Zalo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Block selector + horizontal room strip */}
        <div className="px-4 py-2.5 border-b border-bdr bg-act/30 space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <select
              value={selectedKtx}
              onChange={e => setSelectedKtx(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-surf border border-bdr2 text-xs font-semibold text-tx"
            >
              {catalog.ktxList.map(k => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={selectedDay}
              onChange={e => setSelectedDay(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-surf border border-bdr2 text-xs font-semibold text-tx"
            >
              {dayList.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setRecords({});
                try {
                  window.localStorage.removeItem(storageKey);
                } catch {}
                toast.info('Đã đặt lại lượt kiểm phòng hôm nay cho dãy này.');
              }}
              title="Làm mới lượt kiểm dãy này"
              className="p-1.5 rounded-lg bg-surf border border-bdr2 text-mu hover:text-tx cursor-pointer"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          {/* Room jumper pills */}
          {roomsInDay.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {roomsInDay.map((r, idx) => {
                const rec = records[r];
                const isCur = idx === roomIdx;
                const hasIssue =
                  rec?.checked &&
                  (!rec.headcountOk ||
                    !rec.cleanOk ||
                    !rec.electricalOk ||
                    rec.absentWorkerIds.length > 0 ||
                    Boolean(rec.note.trim()));
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRoomIdx(idx);
                      if (quickPanel === 'summary') setQuickPanel('none');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono shrink-0 border transition-all cursor-pointer ${
                      isCur
                        ? 'bg-pri text-white border-pri shadow-sm'
                        : hasIssue
                        ? 'tint-wn text-wn border-wn/40'
                        : rec?.checked
                        ? 'bg-okbg/40 text-ok border-ok2/40'
                        : 'bg-surf text-mu border-bdr hover:bg-act'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {quickPanel === 'summary' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-tx">Bản tin tổng kết kiểm phòng (Chuẩn Zalo)</h3>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(zaloSummaryText);
                      setCopiedSummary(true);
                      toast.success('Đã copy báo cáo kiểm phòng — dán ngay vào Zalo!');
                      setTimeout(() => setCopiedSummary(false), 2000);
                    } catch {
                      toast.error('Không thể tự copy.');
                    }
                  }}
                  className="btn-glow-primary px-3.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedSummary ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedSummary ? 'Đã copy' : 'Copy gửi Zalo'}</span>
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed font-sans bg-surf border border-bdr2 rounded-2xl p-4 text-tx select-all">
                {zaloSummaryText}
              </pre>
            </div>
          ) : !currentRoom ? (
            <div className="py-16 text-center text-xs text-mu">
              Không có phòng nào trong phạm vi quản lý.
            </div>
          ) : (
            <>
              {/* Current Room Header */}
              <div className="rounded-2xl border border-bdr2 bg-surf p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-extrabold text-tx">
                        {formatRoomDisplay(currentRoom)}
                      </h3>
                      <MonoChip tone="blue">
                        {currentWorkers.length}/{currentFacility?.giuong || 20} người
                      </MonoChip>
                      {curRec.checked && <StatusTag tone="teal">Đã kiểm</StatusTag>}
                    </div>
                    <p className="text-xs text-mu mt-0.5">
                      {selectedKtx} · {selectedDay} · Phòng {roomIdx + 1}/{roomsInDay.length}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setQuickPanel(p => (p === 'ticket' ? 'none' : 'ticket'))}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1 cursor-pointer ${
                        quickPanel === 'ticket'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'tint-wn text-wn border-wn/40'
                      }`}
                    >
                      <Wrench size={12} />
                      <span>Báo hỏng</span>
                    </button>
                    {currentWorkers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setDiscWorkerId(currentWorkers[0]?.id || '');
                          setQuickPanel(p => (p === 'discipline' ? 'none' : 'discipline'));
                        }}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1 cursor-pointer ${
                          quickPanel === 'discipline'
                            ? 'bg-dgr text-white border-dgr'
                            : 'tint-dgr text-dgr border-dgr/40'
                        }`}
                      >
                        <ShieldAlert size={12} />
                        <span>Vi phạm</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 3 Quick Check Toggles */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateRoomRecord(currentRoom, prev => ({
                        ...prev,
                        checked: true,
                        headcountOk: !prev.headcountOk,
                      }))
                    }
                    className={`py-2 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer transition-colors ${
                      curRec.headcountOk
                        ? 'bg-okbg/30 border-ok2/50 text-ok'
                        : 'tint-dgr border-dgr/45 text-dgr'
                    }`}
                  >
                    <Users size={15} />
                    <span>{curRec.headcountOk ? 'Đủ quân số' : 'Thiếu người'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateRoomRecord(currentRoom, prev => ({
                        ...prev,
                        checked: true,
                        cleanOk: !prev.cleanOk,
                      }))
                    }
                    className={`py-2 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer transition-colors ${
                      curRec.cleanOk
                        ? 'bg-okbg/30 border-ok2/50 text-ok'
                        : 'tint-wn border-wn/45 text-wn'
                    }`}
                  >
                    <Sparkles size={15} />
                    <span>{curRec.cleanOk ? 'Vệ sinh đạt' : 'Chưa sạch'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateRoomRecord(currentRoom, prev => ({
                        ...prev,
                        checked: true,
                        electricalOk: !prev.electricalOk,
                      }))
                    }
                    className={`py-2 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer transition-colors ${
                      curRec.electricalOk
                        ? 'bg-okbg/30 border-ok2/50 text-ok'
                        : 'tint-dgr border-dgr/45 text-dgr'
                    }`}
                  >
                    <Zap size={15} />
                    <span>{curRec.electricalOk ? 'Điện an toàn' : 'Lỗi điện/PCCC'}</span>
                  </button>
                </div>

                {/* Quick room note */}
                <input
                  type="text"
                  value={curRec.note}
                  onChange={e =>
                    updateRoomRecord(currentRoom, prev => ({ ...prev, checked: true, note: e.target.value }))
                  }
                  placeholder="Ghi chú nhanh tại phòng (VD: bóng đèn nhấp nháy, cửa khóa lỏng)..."
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-xs text-tx"
                />
              </div>

              {/* Inline Quick Maintenance Ticket Form */}
              {quickPanel === 'ticket' && (
                <form
                  onSubmit={handleCreateQuickTicket}
                  className="rounded-2xl border border-wn/45 tint-wn p-3.5 space-y-2.5"
                >
                  <div className="text-xs font-bold text-wn flex items-center gap-1.5">
                    <Wrench size={14} />
                    <span>Báo hỏng nhanh tại {formatRoomDisplay(currentRoom)}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={ticketCat}
                      onChange={e => setTicketCat(e.target.value as TicketCategory)}
                      className="px-2.5 py-2 rounded-xl bg-surf border border-bdr2 text-xs text-tx"
                    >
                      {TICKET_CATEGORIES.map(c => (
                        <option key={c} value={c}>
                          {TICKET_CATEGORY_META[c].label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={ticketDesc}
                      onChange={e => setTicketDesc(e.target.value)}
                      placeholder="Mô tả thiết bị hỏng..."
                      className="sm:col-span-2 px-3 py-2 rounded-xl bg-surf border border-bdr2 text-xs text-tx"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setQuickPanel('none')}
                      className="px-3 py-1.5 rounded-lg bg-surf text-xs font-semibold text-mu cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={submittingQuick}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {submittingQuick && <Loader2 size={12} className="animate-spin" />}
                      <span>Gửi phiếu bảo trì</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Inline Quick Discipline Form */}
              {quickPanel === 'discipline' && (
                <form
                  onSubmit={handleCreateQuickDiscipline}
                  className="rounded-2xl border border-dgr/45 tint-dgr p-3.5 space-y-2.5"
                >
                  <div className="text-xs font-bold text-dgr flex items-center gap-1.5">
                    <ShieldAlert size={14} />
                    <span>Ghi nhận vi phạm tại {formatRoomDisplay(currentRoom)}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={discWorkerId}
                      onChange={e => setDiscWorkerId(e.target.value)}
                      className="px-2.5 py-2 rounded-xl bg-surf border border-bdr2 text-xs text-tx"
                    >
                      {currentWorkers.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.hoVaTen} {w.giuong ? `(G${normalizeBedLabel(w.giuong)})` : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      value={discCat}
                      onChange={e => setDiscCat(e.target.value as DisciplineCategory)}
                      className="px-2.5 py-2 rounded-xl bg-surf border border-bdr2 text-xs text-tx"
                    >
                      {(Object.keys(DISCIPLINE_CATEGORY_META) as DisciplineCategory[]).map(c => (
                        <option key={c} value={c}>
                          {DISCIPLINE_CATEGORY_META[c].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    required
                    value={discTitle}
                    onChange={e => setDiscTitle(e.target.value)}
                    placeholder="Tóm tắt hành vi vi phạm (VD: Nấu ăn trong phòng, hút thuốc, quá giờ giới nghiêm)..."
                    className="w-full px-3 py-2 rounded-xl bg-surf border border-bdr2 text-xs text-tx"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setQuickPanel('none')}
                      className="px-3 py-1.5 rounded-lg bg-surf text-xs font-semibold text-mu cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={submittingQuick}
                      className="px-3.5 py-1.5 rounded-lg bg-dgr text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {submittingQuick && <Loader2 size={12} className="animate-spin" />}
                      <span>Lưu biên bản</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Resident list in current room */}
              <div className="rounded-2xl border border-bdr bg-surf overflow-hidden divide-y divide-bdr">
                <div className="px-3.5 py-2 bg-act/50 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-mu">
                  <span>Danh sách nhân sự trong phòng ({currentWorkers.length})</span>
                  <span>Bấm để đánh dấu Vắng</span>
                </div>
                {currentWorkers.length === 0 ? (
                  <div className="py-8 text-center text-xs text-mu">Phòng đang trống.</div>
                ) : (
                  currentWorkers.map(w => {
                    const isAbsent = curRec.absentWorkerIds.includes(w.id);
                    const bedNum = normalizeBedLabel(w.giuong);
                    return (
                      <div
                        key={w.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs ${
                          isAbsent ? 'tint-dgr' : ''
                        }`}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <MonoChip tone={isAbsent ? 'slate' : 'blue'}>{bedNum ? `G${bedNum}` : '—'}</MonoChip>
                          <div className="min-w-0">
                            <div className="font-bold text-tx truncate">{w.hoVaTen}</div>
                            <div className="text-[11px] text-mu truncate">
                              {w.donVi || '—'} {w.maNV ? `· #${w.maNV}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {w.soDienThoai && (
                            <a
                              href={`tel:${w.soDienThoai.replace(/\s+/g, '')}`}
                              className="p-1.5 rounded-lg bg-act text-lnk hover:opacity-80"
                              title={`Gọi ${w.soDienThoai}`}
                            >
                              <Phone size={13} />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              updateRoomRecord(currentRoom, prev => {
                                const has = prev.absentWorkerIds.includes(w.id);
                                const nextIds = has
                                  ? prev.absentWorkerIds.filter(id => id !== w.id)
                                  : [...prev.absentWorkerIds, w.id];
                                return {
                                  ...prev,
                                  checked: true,
                                  headcountOk: nextIds.length === 0,
                                  absentWorkerIds: nextIds,
                                };
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border cursor-pointer ${
                              isAbsent
                                ? 'bg-dgr text-white border-dgr'
                                : 'bg-surf text-mu border-bdr2 hover:text-tx'
                            }`}
                          >
                            {isAbsent ? <UserX size={12} /> : <CheckCircle2 size={12} />}
                            <span>{isAbsent ? 'Vắng mặt' : 'Có mặt'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Bottom Thumb Navigation Bar */}
        <div className="px-4 py-3 border-t border-bdr bg-surf flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            disabled={roomIdx <= 0}
            onClick={() => {
              setRoomIdx(i => Math.max(0, i - 1));
              setQuickPanel('none');
            }}
            className="px-3.5 py-2.5 rounded-xl bg-act text-tx text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
          >
            <ChevronLeft size={15} />
            <span>Phòng trước</span>
          </button>

          <button
            type="button"
            disabled={!currentRoom}
            onClick={markCheckedAndNext}
            className="flex-1 btn-glow-primary py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <CheckCircle2 size={15} />
            <span>
              {roomIdx < roomsInDay.length - 1 ? 'Xác nhận & Phòng tiếp' : 'Hoàn tất dãy & Tổng kết'}
            </span>
            {roomIdx < roomsInDay.length - 1 && <ChevronRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
