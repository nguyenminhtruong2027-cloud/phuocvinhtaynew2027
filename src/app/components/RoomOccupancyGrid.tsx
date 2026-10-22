'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ROOM_CAPACITY } from '@/data/workers';
import { useWorkers } from '@/context/WorkerContext';
import { Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';

const RoomDrawer = dynamic(() => import('./RoomDrawer'), { ssr: false });

function getRoomClass(pct: number): string {
  if (pct >= 0.9) return 'room-card-full';
  if (pct >= 0.7) return 'room-card-high';
  if (pct >= 0.4) return 'room-card-medium';
  return 'room-card-low';
}

function getRoomBarColor(pct: number): string {
  if (pct >= 0.9) return 'bg-red-400';
  if (pct >= 0.7) return 'bg-amber-400';
  if (pct >= 0.4) return 'bg-green-400';
  return 'bg-blue-400';
}

/** Group key: KTX + Dãy combination to avoid overlap between KTX 1 and KTX 2 */
interface BuildingGroup {
  ktx: string;
  building: string;
  key: string; // "KTX 1|Dãy 3"
}

/** Admin-assigned unit label per room */
interface RoomUnitAssignment {
  ktx: string;
  day_nha: string;
  phong_so: string;
  unit: string;
  room_note?: string | null;
}

export default function RoomOccupancyGrid() {
  const { workers } = useWorkers();
  const [selectedKtx, setSelectedKtx] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [drawerRoom, setDrawerRoom] = useState<{ ktx: string; building: string; room: string } | null>(null);
  const [roomUnitAssignments, setRoomUnitAssignments] = useState<RoomUnitAssignment[]>([]);

  // Fetch admin-assigned unit labels from Supabase
  const fetchRoomUnitAssignments = useCallback(async () => {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('room_units')
      .select('ktx, day_nha, phong_so, unit, room_note');

    if (error) {
      console.error('[RoomOccupancyGrid] Lỗi tải room_units:', error);
      return;
    }

    if (data) {
      setRoomUnitAssignments(data as RoomUnitAssignment[]);
    }
  }, []);

  useEffect(() => {
    fetchRoomUnitAssignments();
  }, [fetchRoomUnitAssignments]);

  // Build unique KTX list
  const ktxList = useMemo(() => {
    return [...new Set(workers.map(w => w.ktx).filter(Boolean))].sort();
  }, [workers]);

  // Build unique [KTX + Building] groups
  const buildingGroups = useMemo((): BuildingGroup[] => {
    const seen = new Set<string>();
    const groups: BuildingGroup[] = [];
    workers.forEach(w => {
      if (!w.day) return;
      const ktx = w.ktx || '';
      const key = `${ktx}|${w.day}`;
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({ ktx, building: w.day, key });
      }
    });
    return groups.sort((a, b) => {
      const ktxCmp = a.ktx.localeCompare(b.ktx, 'vi');
      if (ktxCmp !== 0) return ktxCmp;
      return a.building.localeCompare(b.building, 'vi');
    });
  }, [workers]);

  // Filter groups by selected KTX and/or building
  const filteredGroups = useMemo(() => {
    return buildingGroups.filter(g => {
      if (selectedKtx && g.ktx !== selectedKtx) return false;
      if (selectedBuilding && g.building !== selectedBuilding) return false;
      return true;
    });
  }, [buildingGroups, selectedKtx, selectedBuilding]);

  // Get unique rooms for a specific KTX+Building combination
  const getRoomsForGroup = (ktx: string, building: string): string[] => {
    const rooms = [...new Set(
      workers
        .filter(w => w.ktx === ktx && w.day === building && w.phongSo)
        .map(w => w.phongSo)
    )];
    return rooms.sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  };

  /**
   * Get display unit label for a room:
   * 1. Admin-assigned label from room_units (priority)
   * 2. Auto-detected from workers: single unit name or "Đa đơn vị"
   */
  const getRoomUnitLabel = useCallback((ktx: string, building: string, room: string): string | null => {
    // Priority 1: admin-assigned from room_units
    const assigned = roomUnitAssignments.find(
      a => a.ktx === ktx && a.day_nha === building && a.phong_so === room
    );
    if (assigned) return assigned.unit;

    // Priority 2: auto-detect from workers
    const roomWorkers = workers.filter(
      w => w.ktx === ktx && w.day === building && w.phongSo === room && w.donVi
    );
    if (roomWorkers.length === 0) return null;
    const units = [...new Set(roomWorkers.map(w => w.donVi).filter(Boolean))];
    if (units.length === 1) return units[0] as string;
    if (units.length > 1) return 'Đa đơn vị';
    return null;
  }, [roomUnitAssignments, workers]);

  const drawerWorkers = useMemo(() => {
    if (!drawerRoom) return [];
    return workers.filter(w =>
      w.ktx === drawerRoom.ktx &&
      w.day === drawerRoom.building &&
      w.phongSo === drawerRoom.room
    );
  }, [drawerRoom, workers]);

  // Unique building names for filter buttons (across all KTX)
  const allBuildings = useMemo(() => {
    return [...new Set(buildingGroups.map(g => g.building))].sort();
  }, [buildingGroups]);

  // Get admin-assigned unit for drawer room
  const drawerAdminUnit = useMemo(() => {
    if (!drawerRoom) return undefined;
    const a = roomUnitAssignments.find(
      x => x.ktx === drawerRoom.ktx && x.day_nha === drawerRoom.building && x.phong_so === drawerRoom.room
    );
    return a?.unit;
  }, [drawerRoom, roomUnitAssignments]);

  // Get room_note for drawer room
  const drawerRoomNote = useMemo(() => {
    if (!drawerRoom) return null;
    const a = roomUnitAssignments.find(
      x => x.ktx === drawerRoom.ktx && x.day_nha === drawerRoom.building && x.phong_so === drawerRoom.room
    );
    return a?.room_note ?? null;
  }, [drawerRoom, roomUnitAssignments]);

  // Optimistically update roomUnitAssignments after admin saves a unit
  const handleUnitUpdated = useCallback((newUnit: string | null) => {
    if (!drawerRoom) return;
    const { ktx, building: day_nha, room: phong_so } = drawerRoom;
    setRoomUnitAssignments(prev => {
      const existing = prev.find(a => a.ktx === ktx && a.day_nha === day_nha && a.phong_so === phong_so);
      const filtered = prev.filter(
        a => !(a.ktx === ktx && a.day_nha === day_nha && a.phong_so === phong_so)
      );
      if (newUnit) {
        return [...filtered, { ktx, day_nha, phong_so, unit: newUnit, room_note: existing?.room_note ?? null }];
      }
      return filtered;
    });
    // Background re-fetch to stay in sync with DB
    fetchRoomUnitAssignments();
  }, [drawerRoom, fetchRoomUnitAssignments]);

  // Optimistically update room_note after admin saves it
  const handleRoomNoteUpdated = useCallback((newNote: string | null) => {
    if (!drawerRoom) return;
    const { ktx, building: day_nha, room: phong_so } = drawerRoom;
    setRoomUnitAssignments(prev => {
      const existing = prev.find(a => a.ktx === ktx && a.day_nha === day_nha && a.phong_so === phong_so);
      const filtered = prev.filter(
        a => !(a.ktx === ktx && a.day_nha === day_nha && a.phong_so === phong_so)
      );
      return [...filtered, { ktx, day_nha, phong_so, unit: existing?.unit ?? '', room_note: newNote }];
    });
    fetchRoomUnitAssignments();
  }, [drawerRoom, fetchRoomUnitAssignments]);

  return (
    <>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sơ Đồ Phòng</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Click vào phòng để xem danh sách công nhân</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* KTX filter */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setSelectedKtx(null); setSelectedBuilding(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedKtx === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
              >Tất cả KTX</button>
              {ktxList.map(ktx => (
                <button
                  key={ktx}
                  onClick={() => { setSelectedKtx(ktx); setSelectedBuilding(null); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedKtx === ktx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
                >{ktx}</button>
              ))}
            </div>
            {/* Building filter (only shown when a KTX is selected) */}
            {selectedKtx && allBuildings.length > 1 && (
              <div className="flex items-center gap-1 border-l border-border pl-2">
                <button
                  onClick={() => setSelectedBuilding(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedBuilding === null ? 'bg-secondary text-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
                >Tất cả Dãy</button>
                {buildingGroups.filter(g => g.ktx === selectedKtx).map(g => (
                  <button
                    key={g.key}
                    onClick={() => setSelectedBuilding(g.building)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedBuilding === g.building ? 'bg-secondary text-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
                  >{g.building}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          {filteredGroups.map((group) => {
            const groupWorkers = workers.filter(w => w.ktx === group.ktx && w.day === group.building);
            const rooms = getRoomsForGroup(group.ktx, group.building);
            const totalCapacity = rooms.length * ROOM_CAPACITY;
            const occupancyPct = totalCapacity > 0 ? groupWorkers.length / totalCapacity : 0;

            return (
              <div key={group.key} className="flex-1 min-w-[280px]">
                {/* Building header with KTX badge */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{group.building}</span>
                      {group.ktx && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${group.ktx === 'KTX 1' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {group.ktx}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{groupWorkers.length}/{totalCapacity} · {Math.round(occupancyPct * 100)}% đầy</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getRoomBarColor(occupancyPct)}`}
                      style={{ width: `${Math.min(occupancyPct * 100, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {rooms.map((room) => {
                    const count = workers.filter(w => w.ktx === group.ktx && w.day === group.building && w.phongSo === room).length;
                    const pct = count / ROOM_CAPACITY;
                    const roomClass = getRoomClass(pct);
                    const barColor = getRoomBarColor(pct);
                    const unitLabel = getRoomUnitLabel(group.ktx, group.building, room);
                    const isAdminAssigned = roomUnitAssignments.some(
                      a => a.ktx === group.ktx && a.day_nha === group.building && a.phong_so === room
                    );
                    return (
                      <div
                        key={`room-${group.key}-${room}`}
                        className={`border rounded-lg p-3 cursor-pointer hover:shadow-md transition-colors duration-100 ${roomClass}`}
                        onClick={() => {
                          if (!group.building) return; // guard: skip if building is empty
                          setDrawerRoom({ ktx: group.ktx, building: group.building, room });
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-foreground">Phòng {room}</span>
                          <span className="text-xs font-tabular font-semibold text-foreground">{count}/{ROOM_CAPACITY}</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/50 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-1">
                          <Users size={10} className="text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{Math.round(pct * 100)}% đầy</span>
                        </div>
                        {unitLabel && (
                          <div className="mt-1.5">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-normal break-words max-w-full ${isAdminAssigned ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}>
                              {isAdminAssigned && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                              {unitLabel}
                            </span>
                          </div>
                        )}
                        {(() => {
                          const noteData = roomUnitAssignments.find(
                            a => a.ktx === group.ktx && a.day_nha === group.building && a.phong_so === room
                          );
                          return noteData?.room_note ? (
                            <div className="mt-1.5">
                              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-tight line-clamp-2 break-words">
                                {noteData.room_note}
                              </p>
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 pt-3 border-t border-border">
          {[
            { label: '≥ 90% (Đầy)', cls: 'bg-red-300' },
            { label: '70–89% (Cao)', cls: 'bg-amber-300' },
            { label: '40–69% (Trung bình)', cls: 'bg-green-300' },
            { label: '< 40% (Thấp)', cls: 'bg-blue-300' },
          ].map((leg) => (
            <div key={leg.label} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${leg.cls}`} />
              <span className="text-xs text-muted-foreground">{leg.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-indigo-200" />
            <span className="text-xs text-muted-foreground">Đơn vị (Admin gán)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-teal-200" />
            <span className="text-xs text-muted-foreground">Đơn vị (Tự động)</span>
          </div>
        </div>
      </div>

      {/* Room Drawer */}
      {drawerRoom && (
        <RoomDrawer
          ktx={drawerRoom.ktx}
          building={`${drawerRoom.ktx ? drawerRoom.ktx + ' · ' : ''}${drawerRoom.building}`}
          buildingRaw={drawerRoom.building}
          room={drawerRoom.room}
          workers={drawerWorkers}
          adminAssignedUnit={drawerAdminUnit}
          roomNote={drawerRoomNote}
          onClose={() => setDrawerRoom(null)}
          onUnitUpdated={handleUnitUpdated}
          onRoomNoteUpdated={handleRoomNoteUpdated}
        />
      )}
    </>
  );
}