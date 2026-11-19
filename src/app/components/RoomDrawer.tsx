'use client';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Worker, calcSoNgay, getProfileStatus } from '@/data/workers';
import {
  X,
  Users,
  Phone,
  CreditCard,
  MapPin,
  Calendar,
  FileText,
  VenusAndMars,
  CheckCircle2,
  Printer,
  DoorOpen,
  Shield,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { printHtmlViaIframe, escapeHtml } from '@/lib/printHtml';
import { getVNDateTimeDisplay } from '@/lib/vnDate';
import {
  getRoomGenderInfo,
  syncRoomGenderToSupabase,
  loadSavedRoomGenderMap,
  saveRoomGenderMap,
} from '@/lib/roomGender';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { StatusTag, MonoChip } from '@/components/ui/StatusTag';

interface Props {
  ktx: string;
  building: string;
  buildingRaw?: string;
  room: string;
  workers: Worker[];
  capacity?: number;
  adminAssignedUnit?: string;
  roomNote?: string | null;
  assignedGender?: 'male' | 'female' | 'auto';
  onClose: () => void;
  onUnitUpdated?: (newUnit: string | null) => void;
  onRoomNoteUpdated?: (newNote: string | null) => void;
  onRoomGenderUpdated?: (newGender: 'male' | 'female' | 'auto') => void;
}

function StatusDot({ worker }: { worker: Worker }) {
  const s = getProfileStatus(worker);
  if (s === 'full') return <span className="w-2 h-2 rounded-full bg-ok2 flex-shrink-0" title="Đủ hồ sơ" />;
  if (s === 'missing_cccd_sdt') return <span className="w-2 h-2 rounded-full bg-dgr flex-shrink-0" title="Thiếu CCCD/SĐT" />;
  return <span className="w-2 h-2 rounded-full bg-wn flex-shrink-0" title="Chưa phân phòng" />;
}

export default function RoomDrawer({
  ktx,
  building,
  buildingRaw,
  room,
  workers,
  capacity,
  adminAssignedUnit,
  roomNote,
  assignedGender: propAssignedGender,
  onClose,
  onRoomNoteUpdated,
  onRoomGenderUpdated,
}: Props) {
  const { isAdmin, canWriteBlock } = useAuth();

  // --- Room Note state ---
  const [noteInput, setNoteInput] = useState(roomNote ?? '');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSuccess, setNoteSuccess] = useState(false);
  const [loadingNote, setLoadingNote] = useState(false);

  // --- Room Gender state ---
  const roomStorageKey = useMemo(() => `${ktx.trim()}||${building.trim()}||${room.trim()}`, [ktx, building, room]);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | 'auto'>(() => {
    if (propAssignedGender) return propAssignedGender;
    const savedMap = loadSavedRoomGenderMap();
    return savedMap[roomStorageKey] || 'auto';
  });
  const [savingGender, setSavingGender] = useState(false);
  const [genderToast, setGenderToast] = useState<string | null>(null);

  /** Resolve the effective day_nha value for Supabase queries */
  const resolveEffectiveDayNha = useCallback((): string => {
    if (buildingRaw && buildingRaw.trim()) return buildingRaw.trim();
    if (building && building.trim()) {
      const afterDot = building.match(/·\s*(.+)$/);
      if (afterDot) return afterDot[1].trim();
      return building.trim();
    }
    const titleMatch = building.match(/^(Dãy\s*\S+)/i);
    if (titleMatch) return titleMatch[1].trim();
    return building || '';
  }, [buildingRaw, building]);

  // Compute live gender info from workers & current assignment
  const genderInfo = useMemo(() => {
    const overrideLabel = selectedGender === 'male' ? 'Nam' : selectedGender === 'female' ? 'Nữ' : null;
    return getRoomGenderInfo(workers, overrideLabel);
  }, [workers, selectedGender]);

  // On open: fetch the latest room_note & room_label from Supabase
  useEffect(() => {
    setNoteInput(roomNote ?? '');

    const fetchFreshData = async () => {
      setLoadingNote(true);
      try {
        const supabase = createClient();
        const effectiveDayNha = resolveEffectiveDayNha();
        const { data, error } = await supabase
          .from('room_units')
          .select('room_note, room_label')
          .eq('ktx', ktx)
          .eq('day_nha', effectiveDayNha)
          .eq('phong_so', room)
          .maybeSingle();

        if (!error && data) {
          if (data.room_note !== undefined) {
            setNoteInput(data.room_note ?? '');
          }
          if (data.room_label) {
            const norm = data.room_label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (norm === 'nam' || norm === 'phong nam') {
              setSelectedGender('male');
            } else if (norm === 'nu' || norm === 'phong nu') {
              setSelectedGender('female');
            }
          }
        }
      } catch {
        // Silently keep current state
      } finally {
        setLoadingNote(false);
      }
    };

    fetchFreshData();
  }, [ktx, room, buildingRaw, building, roomNote, resolveEffectiveDayNha]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const canEditRoomGender = useMemo(
    () => isAdmin || canWriteBlock(resolveEffectiveDayNha(), ktx),
    [isAdmin, canWriteBlock, resolveEffectiveDayNha, ktx]
  );

  /** Change room gender assignment */
  const handleSelectGender = async (gender: 'male' | 'female' | 'auto') => {
    if (!canEditRoomGender) return;
    setSelectedGender(gender);
    setSavingGender(true);

    const map = loadSavedRoomGenderMap();
    if (gender === 'auto') {
      delete map[roomStorageKey];
    } else {
      map[roomStorageKey] = gender;
    }
    saveRoomGenderMap(map);
    onRoomGenderUpdated?.(gender);

    const effectiveDayNha = resolveEffectiveDayNha();
    await syncRoomGenderToSupabase(ktx, effectiveDayNha, room, gender);
    setSavingGender(false);

    const label = gender === 'female' ? 'Phòng Nữ' : gender === 'male' ? 'Phòng Nam' : 'Tự động theo nhân sự';
    setGenderToast(`Đã cập nhật: ${label}`);
    setTimeout(() => setGenderToast(null), 2500);
  };

  /** Save room_note to room_units table */
  const handleSaveRoomNote = useCallback(async () => {
    setSavingNote(true);
    setNoteError(null);
    setNoteSuccess(false);
    try {
      const supabase = createClient();
      const trimmed = noteInput.trim();
      const effectiveDayNha = resolveEffectiveDayNha();

      const { data: updateData, error: updateError } = await supabase
        .from('room_units')
        .update({ room_note: trimmed || null, updated_at: new Date().toISOString() })
        .eq('ktx', ktx)
        .eq('day_nha', effectiveDayNha)
        .eq('phong_so', room)
        .select();

      if (updateError) {
        throw new Error(`Lỗi cập nhật ghi chú: ${updateError.message}`);
      }

      if (!updateData || updateData.length === 0) {
        const { error: insertError } = await supabase.from('room_units').insert({
          ktx,
          day_nha: effectiveDayNha,
          phong_so: room,
          unit: adminAssignedUnit ?? '',
          room_note: trimmed || null,
        });

        if (insertError) {
          await supabase.from('room_units').upsert(
            {
              ktx,
              day_nha: effectiveDayNha,
              phong_so: room,
              unit: adminAssignedUnit ?? '',
              room_note: trimmed || null,
            },
            { onConflict: 'ktx,day_nha,phong_so' }
          );
        }
      }

      onRoomNoteUpdated?.(trimmed || null);
      setNoteSuccess(true);
      setTimeout(() => setNoteSuccess(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setNoteError(msg || 'Lỗi lưu ghi chú — vui lòng thử lại');
    } finally {
      setSavingNote(false);
    }
  }, [ktx, room, noteInput, adminAssignedUnit, resolveEffectiveDayNha, onRoomNoteUpdated]);

  const handlePrintRoster = useCallback(() => {
    const roomTitle = room?.trim().startsWith('Phòng') || room?.trim().startsWith('P.') ? room.trim() : `Phòng ${room}`;
    const dayLabel = resolveEffectiveDayNha() || building;
    const rowsHtml = workers
      .map((w, idx) => {
        const gender =
          (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu' ? 'Nữ' : 'Nam';
        return `<tr>
          <td style="text-align:center">${idx + 1}</td>
          <td style="font-weight:600">${escapeHtml(w.hoVaTen || '')}</td>
          <td style="font-family:monospace">${escapeHtml(w.maNV || '—')}</td>
          <td style="text-align:center">${escapeHtml(gender)}</td>
          <td style="font-family:monospace">${escapeHtml(w.soDienThoai || '—')}</td>
          <td>${escapeHtml(w.donVi || '—')}</td>
          <td style="text-align:center">${escapeHtml(w.tieuDoan || '—')}</td>
          <td style="text-align:center">${escapeHtml(w.giuong || '—')}</td>
          <td style="font-family:monospace">${escapeHtml(w.ngayVaoKTX || '—')}</td>
          <td></td>
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1e293b;padding-bottom:10px;margin-bottom:14px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#475569">Ký túc xá Phước Vĩnh Tây</div>
          <h1 style="font-size:18px;font-weight:800;margin:4px 0 0;color:#0f172a">DANH SÁCH NHÂN KHẨU PHÒNG — ${escapeHtml(roomTitle)}</h1>
          <div style="font-size:12px;color:#334155;margin-top:4px">
            <strong>Khu vực:</strong> ${escapeHtml(ktx)} · ${escapeHtml(dayLabel)} · <strong>Phân loại:</strong> ${escapeHtml(genderInfo.label)}
          </div>
        </div>
        <div style="text-align:right;font-size:11px;color:#475569">
          <div>Tổng quân số: <strong style="color:#0f172a">${workers.length} người</strong> (${genderInfo.maleCount} Nam · ${genderInfo.femaleCount} Nữ)</div>
          <div>Ngày in: ${escapeHtml(getVNDateTimeDisplay())}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:32px;text-align:center">STT</th>
            <th>Họ và tên</th>
            <th>Mã NV</th>
            <th style="width:45px;text-align:center">Giới</th>
            <th>Số điện thoại</th>
            <th>Đơn vị</th>
            <th style="width:45px;text-align:center">TĐ</th>
            <th style="width:55px;text-align:center">Giường</th>
            <th style="width:82px">Ngày vào</th>
            <th style="width:85px">Ký nhận / Ghi chú</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:24px;font-size:11px;color:#334155;padding:0 16px">
        <div style="text-align:center"><strong>Trưởng phòng / Tổ trưởng</strong><br/><span style="color:#64748b">(Ký và ghi rõ họ tên)</span></div>
        <div style="text-align:center"><strong>Cán bộ quản lý KTX</strong><br/><span style="color:#64748b">(Ký và ghi rõ họ tên)</span></div>
      </div>
    `;

    const htmlDoc = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Danh sách ${escapeHtml(roomTitle)} - ${escapeHtml(ktx)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; color: #1e293b; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;

    printHtmlViaIframe(htmlDoc);
  }, [room, resolveEffectiveDayNha, building, workers, ktx, genderInfo]);

  const effectiveCap = capacity && capacity > 0 ? capacity : 0;
  const occPct = effectiveCap > 0 ? Math.min(100, Math.round((workers.length / effectiveCap) * 100)) : 0;
  const isOver = effectiveCap > 0 && workers.length > effectiveCap;
  const isFull = effectiveCap > 0 && workers.length === effectiveCap;

  return (
    <>
      {/* Toast */}
      {genderToast && (
        <div className="fixed top-5 right-5 z-[100] flex items-center gap-2 px-4 py-2.5 bg-surf border border-bdr2 text-tx rounded-xl shadow-2xl text-xs font-bold">
          <CheckCircle2 size={16} className="text-ok shrink-0" />
          <span>{genderToast}</span>
        </div>
      )}

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 modal-backdrop-scrim fade-in"
        onClick={onClose}
      />

      {/* Drawer / Bottom Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 max-h-[88vh] sm:max-h-full sm:top-0 sm:right-0 sm:left-auto sm:inset-x-auto sm:h-full z-50 w-full sm:max-w-md bg-surf border-t sm:border-t-0 sm:border-l border-bdr2 text-tx shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none overflow-hidden animate-slide-in-right"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-bdr bg-act/55 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3 min-w-0">
              <CraftIconBadge
                icon={DoorOpen}
                tone={genderInfo.gender === 'female' ? 'pink' : 'blue'}
                size="sm"
                interactive={false}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-extrabold text-tx tracking-tight">
                    {building} —{' '}
                    {room?.trim().startsWith('Phòng') || room?.trim().startsWith('P.') ? room.trim() : `Phòng ${room}`}
                  </h2>
                  <StatusTag
                    tone={genderInfo.gender === 'female' ? 'pink' : genderInfo.gender === 'male' ? 'blue' : 'slate'}
                  >
                    {genderInfo.gender === 'female' ? '♀' : genderInfo.gender === 'male' ? '♂' : '•'} {genderInfo.label}
                  </StatusTag>
                </div>
                <p className="text-xs text-mu mt-0.5 font-tabular">
                  {workers.length} công nhân ({genderInfo.maleCount} Nam · {genderInfo.femaleCount} Nữ)
                  {effectiveCap > 0 && ` · Định mức ${effectiveCap} giường`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {workers.length > 0 && (
                <button
                  type="button"
                  onClick={handlePrintRoster}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs font-semibold text-tx transition-colors cursor-pointer"
                  title="In danh sách nhân khẩu phòng (A4)"
                >
                  <Printer size={14} className="text-lnk" />
                  <span className="hidden sm:inline">In</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Live Occupancy Progress Bar */}
          {effectiveCap > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span className="text-mu">Mức lấp đầy phòng</span>
                <span
                  className={`font-mono font-tabular ${
                    isOver ? 'text-dgr' : isFull ? 'text-wn' : 'text-ok'
                  }`}
                >
                  {workers.length}/{effectiveCap} ({occPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-surf border border-bdr overflow-hidden">
                <div
                  style={{ width: `${occPct}%` }}
                  className={`h-full rounded-full transition-[width] duration-300 ease-out ${isOver ? 'bg-dgr' : isFull ? 'bg-wn' : 'bg-ok2'}`}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Room Gender Classification Admin Control ── */}
        <div className="px-5 py-3.5 border-b border-bdr bg-act/60">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <VenusAndMars size={14} className="text-lnk" />
              <span className="text-xs font-bold uppercase tracking-wider text-mu">
                Phân Loại Công Năng Phòng
              </span>
            </div>
            <StatusTag tone={genderInfo.isCustom ? 'teal' : 'slate'}>
              {genderInfo.isCustom ? 'Admin đã gán' : 'Tự động theo nhân sự'}
            </StatusTag>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectGender('male')}
                disabled={savingGender || !canEditRoomGender}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                  selectedGender === 'male'
                    ? 'bg-pri text-white border-pri2 shadow-md'
                    : 'bg-surf text-mu border-bdr hover:bg-act hover:text-tx'
                }`}
              >
                <span className="text-sm">♂</span>
                <span>Phòng Nam</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectGender('female')}
                disabled={savingGender || !canEditRoomGender}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                  selectedGender === 'female'
                    ? 'tint-pink text-pink-tone border-pink-tint shadow-md'
                    : 'bg-surf text-mu border-bdr hover:bg-act hover:text-tx'
                }`}
              >
                <span className="text-sm">♀</span>
                <span>Phòng Nữ</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectGender('auto')}
                disabled={savingGender || !canEditRoomGender}
                className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                  selectedGender === 'auto'
                    ? 'bg-okbg text-ok border-ok2/40 shadow-sm'
                    : 'bg-surf text-mu border-bdr hover:bg-act hover:text-tx'
                }`}
              >
                <span>⚡</span>
                <span>Tự động</span>
              </button>
            </div>

            <p className="text-[11px] text-mu italic">
              {selectedGender === 'male' && 'Đã cố định là Phòng Nam trên sơ đồ và thống kê.'}
              {selectedGender === 'female' && 'Đã cố định là Phòng Nữ trên sơ đồ và thống kê.'}
              {selectedGender === 'auto' && 'Hệ thống tự động nhận diện theo giới tính công nhân trong phòng.'}
            </p>
          </div>
        </div>

        {/* Room Note section */}
        {isAdmin && (
          <div className="px-5 py-3 border-b border-bdr tint-wn">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={13} className="text-wn flex-shrink-0" />
              <span className="text-xs font-bold text-wn">Ghi chú phòng</span>
              {loadingNote && <span className="text-[10px] text-wn/70 ml-auto">Đang tải...</span>}
            </div>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              placeholder="Điền thông tin: loại đơn vị, ghi chú đặc biệt..."
              rows={2}
              className="w-full text-xs border border-bdr2 rounded-xl px-3 py-2 bg-surf text-tx placeholder-mu focus:outline-none focus:ring-1 focus:ring-wn disabled:opacity-50 resize-none"
              disabled={savingNote || loadingNote}
            />
            <div className="flex items-center justify-between mt-2">
              <div>
                {noteError && <p className="text-xs text-dgr">{noteError}</p>}
                {noteSuccess && (
                  <p className="text-xs text-ok font-semibold flex items-center gap-1">
                    <CheckCircle2 size={12} /> Đã lưu ghi chú thành công!
                  </p>
                )}
              </div>
              <button
                onClick={handleSaveRoomNote}
                disabled={savingNote || loadingNote}
                className="flex-shrink-0 px-3.5 py-1.5 rounded-lg bg-wn hover:opacity-90 text-wn-fg text-xs font-bold transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
              >
                {savingNote ? 'Đang lưu...' : 'Lưu ghi chú'}
              </button>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-bdr bg-act/35 text-[11px] text-mu flex-wrap">
          <StatusTag tone="teal" icon={CheckCircle2}>
            Đủ hồ sơ
          </StatusTag>
          <StatusTag tone="rose" icon={AlertCircle}>
            Thiếu CCCD/SĐT
          </StatusTag>
          <StatusTag tone="amber" icon={Clock}>
            Chưa phân phòng
          </StatusTag>
        </div>

        {/* Worker list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {workers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-14 h-14 rounded-2xl craft-icon-slate flex items-center justify-center mb-3">
                <Users size={26} />
              </div>
              <p className="text-sm font-bold text-tx">Phòng trống</p>
              <p className="text-xs text-mu mt-1">Chưa có công nhân nào được xếp vào phòng này</p>
            </div>
          ) : (
            <div className="divide-y divide-bdr">
              {workers.map((w, idx) => {
                const soNgay = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
                const isFemaleWorker =
                  (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';
                return (
                  <div key={w.id} className="px-5 py-3 hover:bg-act/60 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                        <span className="text-xs text-ic w-5 text-right font-mono font-tabular">{idx + 1}</span>
                        <StatusDot worker={w} />
                        <div
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold ${
                            isFemaleWorker
                              ? 'tint-pink border-pink-tint text-pink-tone'
                              : 'bg-bdg border-bdr2 text-lnk'
                          }`}
                        >
                          {w.hoVaTen.split(' ').pop()?.charAt(0) ?? '?'}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-bold text-tx whitespace-normal break-words leading-tight">
                              {w.hoVaTen}
                            </p>
                            <StatusTag tone={isFemaleWorker ? 'pink' : 'blue'}>
                              {isFemaleWorker ? 'Nữ' : 'Nam'}
                            </StatusTag>
                          </div>
                          {w.tieuDoan && (
                            <StatusTag tone="blue" icon={Shield}>
                              TD {w.tieuDoan}
                            </StatusTag>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {w.maNV ? (
                            <MonoChip>#{w.maNV}</MonoChip>
                          ) : (
                            <span className="text-xs text-mu italic">Chưa có mã NV</span>
                          )}
                          {w.giuong && <MonoChip tone="blue">Giường {w.giuong}</MonoChip>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {w.soDienThoai && (
                            <span className="flex items-center gap-1 text-mu font-mono font-tabular whitespace-nowrap">
                              <Phone size={11} className="text-ic shrink-0" />
                              {w.soDienThoai}
                            </span>
                          )}
                          {w.cccd && (
                            <span className="flex items-center gap-1 text-mu font-mono font-tabular whitespace-nowrap">
                              <CreditCard size={11} className="text-ic shrink-0" />
                              {w.cccd.slice(0, 3)}****{w.cccd.slice(-3)}
                            </span>
                          )}
                          {w.hoKhauTinh && (
                            <span className="flex items-center gap-1 text-mu whitespace-nowrap">
                              <MapPin size={11} className="text-ic shrink-0" />
                              {w.hoKhauTinh}
                            </span>
                          )}
                          {soNgay !== null && (
                            <span className="flex items-center gap-1 text-ok font-semibold font-tabular whitespace-nowrap">
                              <Calendar size={11} className="text-ok shrink-0" />
                              {soNgay} ngày
                            </span>
                          )}
                        </div>
                        {w.toTruong && <p className="text-xs text-mu mt-1">Tổ trưởng: {w.toTruong}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
