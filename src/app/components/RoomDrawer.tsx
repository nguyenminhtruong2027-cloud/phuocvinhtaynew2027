'use client';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Worker, calcSoNgay, getProfileStatus } from '@/data/workers';
import { X, Users, Phone, CreditCard, MapPin, Calendar, FileText, VenusAndMars, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import {
  getRoomGenderInfo,
  syncRoomGenderToSupabase,
  loadSavedRoomGenderMap,
  saveRoomGenderMap,
  RoomGenderType,
} from '@/lib/roomGender';

interface Props {
  ktx: string;
  building: string;
  buildingRaw?: string;
  room: string;
  workers: Worker[];
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
  if (s === 'full') return <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Đủ hồ sơ" />;
  if (s === 'missing_cccd_sdt') return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Thiếu CCCD/SĐT" />;
  return <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" title="Chưa phân phòng" />;
}

export default function RoomDrawer({
  ktx,
  building,
  buildingRaw,
  room,
  workers,
  adminAssignedUnit,
  roomNote,
  assignedGender: propAssignedGender,
  onClose,
  onUnitUpdated,
  onRoomNoteUpdated,
  onRoomGenderUpdated,
}: Props) {
  const { isAdmin } = useAuth();

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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  /** Change room gender assignment */
  const handleSelectGender = async (gender: 'male' | 'female' | 'auto') => {
    setSelectedGender(gender);
    setSavingGender(true);

    // Save to localStorage immediately
    const map = loadSavedRoomGenderMap();
    if (gender === 'auto') {
      delete map[roomStorageKey];
    } else {
      map[roomStorageKey] = gender;
    }
    saveRoomGenderMap(map);

    // Notify parent
    onRoomGenderUpdated?.(gender);

    // Sync to Supabase
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

      // Step 1: Try UPDATE first
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

      // Step 2: If no row was updated, insert a new row
      if (!updateData || updateData.length === 0) {
        const { error: insertError } = await supabase
          .from('room_units')
          .insert({
            ktx,
            day_nha: effectiveDayNha,
            phong_so: room,
            unit: adminAssignedUnit ?? '',
            room_note: trimmed || null,
          });

        if (insertError) {
          await supabase
            .from('room_units')
            .upsert(
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

  return (
    <>
      {/* Toast */}
      {genderToast && (
        <div className="fixed top-5 right-5 z-[100] flex items-center gap-2 px-4 py-2.5 bg-gray-900 border border-emerald-500/60 text-white rounded-xl shadow-2xl animate-fade-in backdrop-blur-md text-xs font-bold">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>{genderToast}</span>
        </div>
      )}

      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer / Bottom Sheet on Mobile */}
      <div className="fixed inset-x-0 bottom-0 max-h-[85vh] sm:max-h-full sm:top-0 sm:right-0 sm:left-auto sm:inset-x-auto sm:h-full z-50 w-full sm:max-w-md bg-[#1F2937] border-t sm:border-t-0 sm:border-l border-gray-700/80 text-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/80 bg-gray-900/60">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                {building} — Phòng {room}
              </h2>
              {/* Gender badge */}
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold border inline-flex items-center gap-1 ${
                  genderInfo.gender === 'female'
                    ? 'bg-pink-500/25 text-pink-300 border-pink-500/40'
                    : genderInfo.gender === 'male'
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    : 'bg-gray-800 text-gray-400 border-gray-700'
                }`}
              >
                <span>{genderInfo.gender === 'female' ? '♀' : genderInfo.gender === 'male' ? '♂' : '•'}</span>
                <span>{genderInfo.label}</span>
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5 font-tabular">
              {workers.length} công nhân đang lưu trú ({genderInfo.maleCount} Nam · {genderInfo.femaleCount} Nữ)
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* ── Room Gender Classification Admin Control ── */}
        <div className="px-5 py-3.5 border-b border-gray-700/80 bg-gray-850/70">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <VenusAndMars size={14} className="text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">
                Phân Loại Công Năng Phòng
              </span>
            </div>
            {genderInfo.isCustom ? (
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                Admin đã gán
              </span>
            ) : (
              <span className="text-[10px] font-medium text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
                Tự động theo nhân sự
              </span>
            )}
          </div>

          {/* Direct gender classification buttons */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectGender('male')}
                disabled={savingGender}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                  selectedGender === 'male'
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-600/30 ring-1 ring-blue-400'
                    : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-750 hover:text-white'
                }`}
              >
                <span className="text-sm">♂</span>
                <span>Phòng Nam</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectGender('female')}
                disabled={savingGender}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                  selectedGender === 'female'
                    ? 'bg-pink-600 text-white border-pink-400 shadow-md shadow-pink-600/30 ring-1 ring-pink-400'
                    : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-750 hover:text-white'
                }`}
              >
                <span className="text-sm">♀</span>
                <span>Phòng Nữ</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectGender('auto')}
                disabled={savingGender}
                className={`py-2 px-2 rounded-xl text-xs font-medium border transition-all flex items-center justify-center gap-1 ${
                  selectedGender === 'auto'
                    ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 shadow-sm'
                    : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:bg-gray-750 hover:text-gray-300'
                }`}
              >
                <span>⚡</span>
                <span>Tự động</span>
              </button>
            </div>

            <p className="text-[11px] text-gray-400 italic">
              {selectedGender === 'male' && 'Đã cố định là Phòng Nam trên sơ đồ và thống kê.'}
              {selectedGender === 'female' && 'Đã cố định là Phòng Nữ trên sơ đồ và thống kê.'}
              {selectedGender === 'auto' && 'Hệ thống tự động nhận diện theo giới tính công nhân trong phòng.'}
            </p>
          </div>
        </div>

        {/* Room Note section */}
        {isAdmin && (
          <div className="px-5 py-3 border-b border-gray-700/80 bg-amber-950/20">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={13} className="text-amber-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-amber-300">Ghi chú phòng</span>
              {loadingNote && <span className="text-[10px] text-amber-400/70 ml-auto">Đang tải...</span>}
            </div>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              placeholder="Điền thông tin: loại đơn vị, ghi chú đặc biệt..."
              rows={2}
              className="w-full text-xs border border-gray-700 rounded-xl px-3 py-2 bg-gray-900/80 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50 resize-none"
              disabled={savingNote || loadingNote}
            />
            <div className="flex items-center justify-between mt-2">
              <div>
                {noteError && <p className="text-xs text-rose-400">{noteError}</p>}
                {noteSuccess && (
                  <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <span>✓</span> Đã lưu ghi chú thành công!
                  </p>
                )}
              </div>
              <button
                onClick={handleSaveRoomNote}
                disabled={savingNote || loadingNote}
                className="flex-shrink-0 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 shadow-md shadow-amber-500/20"
              >
                {savingNote ? 'Đang lưu...' : 'Lưu ghi chú'}
              </button>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-b border-gray-700/60 bg-gray-900/40 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" />Đủ hồ sơ</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" />Thiếu CCCD/SĐT</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Chưa phân phòng</span>
        </div>

        {/* Worker list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {workers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-3">
                <Users size={28} className="text-gray-500" />
              </div>
              <p className="text-sm font-bold text-white">Phòng trống</p>
              <p className="text-xs text-gray-400 mt-1">Chưa có công nhân nào được xếp vào phòng này</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700/50">
              {workers.map((w, idx) => {
                const soNgay = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
                const isFemaleWorker = (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';
                return (
                  <div key={w.id} className="px-5 py-3 hover:bg-gray-750/70 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                        <span className="text-xs text-gray-500 w-5 text-right font-tabular">{idx + 1}</span>
                        <StatusDot worker={w} />
                        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold ${
                          isFemaleWorker
                            ? 'bg-pink-500/20 border-pink-500/30 text-pink-300'
                            : 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                        }`}>
                          {w.hoVaTen.split(' ').pop()?.charAt(0) ?? '?'}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-white whitespace-normal break-words leading-tight">{w.hoVaTen}</p>
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                              isFemaleWorker
                                ? 'bg-pink-500/20 text-pink-300 border-pink-500/30'
                                : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                            }`}>
                              {isFemaleWorker ? 'Nữ' : 'Nam'}
                            </span>
                          </div>
                          {w.tieuDoan && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap shrink-0">
                              TD {w.tieuDoan}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-tabular whitespace-nowrap truncate mt-0.5">{w.maNV ? `#${w.maNV}` : 'Chưa có mã NV'}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {w.soDienThoai && (
                            <span className="flex items-center gap-1 text-gray-300 font-tabular whitespace-nowrap">
                              <Phone size={11} className="text-gray-400 shrink-0" />{w.soDienThoai}
                            </span>
                          )}
                          {w.cccd && (
                            <span className="flex items-center gap-1 text-gray-400 font-tabular whitespace-nowrap">
                              <CreditCard size={11} className="shrink-0" />{w.cccd.slice(0,3)}****{w.cccd.slice(-3)}
                            </span>
                          )}
                          {w.hoKhauTinh && (
                            <span className="flex items-center gap-1 text-gray-400 whitespace-nowrap">
                              <MapPin size={11} className="shrink-0" />{w.hoKhauTinh}
                            </span>
                          )}
                          {soNgay !== null && (
                            <span className="flex items-center gap-1 text-emerald-400 font-semibold font-tabular whitespace-nowrap">
                              <Calendar size={11} className="text-emerald-500 shrink-0" />{soNgay} ngày
                            </span>
                          )}
                        </div>
                        {w.toTruong && (
                          <p className="text-xs text-gray-400 mt-1">Tổ trưởng: {w.toTruong}</p>
                        )}
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
