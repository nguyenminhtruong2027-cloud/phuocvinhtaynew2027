'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { DEFAULT_ROOM_CAPACITY, naturalSortCompare, compareKtxNames } from '@/data/workers';
import {
  fetchRoomCapacities,
  fetchFacilitiesList,
  FacilityItem,
  getRoomCapacity,
  RoomCapacityMap,
  formatRoomDisplay,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { useWorkers } from '@/context/WorkerContext';
import { Users, Building } from 'lucide-react';
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
  if (pct >= 0.9) return 'bg-dgr';
  if (pct >= 0.7) return 'bg-wn';
  if (pct >= 0.4) return 'bg-ok2';
  return 'bg-pri2';
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
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(true);
  const [selectedKtx, setSelectedKtx] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [drawerRoom, setDrawerRoom] = useState<{ ktx: string; building: string; room: string } | null>(null);
  const [roomUnitAssignments, setRoomUnitAssignments] = useState<RoomUnitAssignment[]>([]);
  const [capacities, setCapacities] = useState<RoomCapacityMap>({});

  // Fetch facilities catalog — strictly 100% from DB
  const loadFacilities = useCallback(async () => {
    try {
      const data = await fetchFacilitiesList();
      // Only accommodation rooms and visible rooms
      const activeAccommodations = (data || []).filter(
        f => (f.room_type || 'accommodation') === 'accommodation' && f.is_visible !== false
      );
      setFacilities(activeAccommodations);
    } catch (err) {
      console.error('[RoomOccupancyGrid] Lỗi tải facilities:', err);
    } finally {
      setLoadingFacilities(false);
    }
  }, []);

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

  const fetchCapacities = useCallback(async () => {
    const map = await fetchRoomCapacities();
    setCapacities(map);
  }, []);

  useEffect(() => {
    loadFacilities();
    fetchRoomUnitAssignments();
    fetchCapacities();

    const supabase = createClient();
    const channel = supabase
      .channel('room_occupancy_grid_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, () => {
        loadFacilities();
        fetchCapacities();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_units' }, () => {
        fetchRoomUnitAssignments();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => {
        fetchRoomUnitAssignments();
      })
      .subscribe();

    const handleFacUpdate = () => {
      loadFacilities();
      fetchCapacities();
    };
    window.addEventListener('ktx_facilities_updated', handleFacUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('ktx_facilities_updated', handleFacUpdate);
    };
  }, [loadFacilities, fetchRoomUnitAssignments, fetchCapacities]);

  // Build unique KTX list strictly from physical facilities
  const ktxList = useMemo(() => {
    return Array.from(new Set(facilities.map(f => f.ktx).filter(Boolean))).sort(compareKtxNames);
  }, [facilities]);

  // Build unique [KTX + Building] groups strictly from physical facilities
  const buildingGroups = useMemo((): BuildingGroup[] => {
    const seen = new Set<string>();
    const groups: BuildingGroup[] = [];
    facilities.forEach(f => {
      if (!f.day) return;
      const ktx = f.ktx || '';
      const key = `${ktx}|${f.day}`;
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({ ktx, building: f.day, key });
      }
    });
    return groups.sort((a, b) => {
      const ktxCmp = compareKtxNames(a.ktx, b.ktx);
      if (ktxCmp !== 0) return ktxCmp;
      return naturalSortCompare(a.building, b.building);
    });
  }, [facilities]);

  // Filter groups by selected KTX and/or building
  const filteredGroups = useMemo(() => {
    return buildingGroups.filter(g => {
      if (selectedKtx && g.ktx !== selectedKtx) return false;
      if (selectedBuilding && g.building !== selectedBuilding) return false;
      return true;
    });
  }, [buildingGroups, selectedKtx, selectedBuilding]);

  // Get unique rooms for a specific KTX+Building combination strictly from facilities
  const getRoomsForGroup = useCallback((ktx: string, building: string): string[] => {
    const rooms = Array.from(new Set(
      facilities
        .filter(f => f.ktx === ktx && f.day === building && f.phong_khu_vuc)
        .map(f => f.phong_khu_vuc)
    ));
    return rooms.sort(naturalSortCompare);
  }, [facilities]);

  /**
   * Get display unit label for a room:
   * 1. Admin-assigned label from room_units (priority)
   * 2. Auto-detected from workers: single unit name or "Đa đơn vị"
   */
  const getRoomUnitLabel = useCallback((ktx: string, building: string, room: string): string | null => {
    const normR = normalizeRoomLabel(room);
    // Priority 1: admin-assigned from room_units
    const assigned = roomUnitAssignments.find(
      a => a.ktx === ktx && a.day_nha === building && (a.phong_so === room || normalizeRoomLabel(a.phong_so) === normR)
    );
    if (assigned) return assigned.unit;

    // Priority 2: auto-detect from workers
    const roomWorkers = workers.filter(
      w => w.ktx === ktx && w.day === building && (w.phongSo === room || normalizeRoomLabel(w.phongSo) === normR) && w.donVi
    );
    if (roomWorkers.length === 0) return null;
    const units = Array.from(new Set(roomWorkers.map(w => w.donVi).filter(Boolean)));
    if (units.length === 1) return units[0] as string;
    if (units.length > 1) return 'Đa đơn vị';
    return null;
  }, [roomUnitAssignments, workers]);

  const drawerWorkers = useMemo(() => {
    if (!drawerRoom) return [];
    const normR = normalizeRoomLabel(drawerRoom.room);
    return workers.filter(w =>
      w.ktx === drawerRoom.ktx &&
      w.day === drawerRoom.building &&
      (w.phongSo === drawerRoom.room || normalizeRoomLabel(w.phongSo) === normR)
    );
  }, [drawerRoom, workers]);

  // Unique building names for filter buttons (across filtered KTX or all KTX)
  const availableBuildings = useMemo(() => {
    const relevant = selectedKtx
      ? buildingGroups.filter(g => g.ktx === selectedKtx)
      : buildingGroups;
    return Array.from(new Set(relevant.map(g => g.building))).sort(naturalSortCompare);
  }, [buildingGroups, selectedKtx]);

  // Get admin-assigned unit for drawer room
  const drawerAdminUnit = useMemo(() => {
    if (!drawerRoom) return undefined;
    const normR = normalizeRoomLabel(drawerRoom.room);
    const a = roomUnitAssignments.find(
      x => x.ktx === drawerRoom.ktx && x.day_nha === drawerRoom.building && (x.phong_so === drawerRoom.room || normalizeRoomLabel(x.phong_so) === normR)
    );
    return a?.unit;
  }, [drawerRoom, roomUnitAssignments]);

  // Get room_note for drawer room
  const drawerRoomNote = useMemo(() => {
    if (!drawerRoom) return null;
    const normR = normalizeRoomLabel(drawerRoom.room);
    const a = roomUnitAssignments.find(
      x => x.ktx === drawerRoom.ktx && x.day_nha === drawerRoom.building && (x.phong_so === drawerRoom.room || normalizeRoomLabel(x.phong_so) === normR)
    );
    return a?.room_note ?? null;
  }, [drawerRoom, roomUnitAssignments]);

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
    fetchRoomUnitAssignments();
  }, [drawerRoom, fetchRoomUnitAssignments]);

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
            <p className="text-xs text-muted-foreground mt-0.5">Quét 100% từ danh mục cơ sở vật chất cố định</p>
          </div>
          {facilities.length > 0 && (
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
              {selectedKtx && availableBuildings.length > 1 && (
                <div className="flex items-center gap-1 border-l border-border pl-2">
                  <button
                    onClick={() => setSelectedBuilding(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedBuilding === null ? 'bg-secondary text-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
                  >Tất cả Dãy</button>
                  {availableBuildings.map(b => (
                    <button
                      key={b}
                      onClick={() => setSelectedBuilding(b)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedBuilding === b ? 'bg-secondary text-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
                    >{b}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {loadingFacilities ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-2">
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">Đang tải danh mục cơ sở vật chất...</p>
            </div>
          </div>
        ) : facilities.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mx-auto">
              <Building size={24} />
            </div>
            <h4 className="text-sm font-bold text-foreground">Sơ đồ phòng đang trống (0 phòng)</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Hiện tại danh mục cơ sở vật chất chưa có phòng nào. Sơ đồ phòng tuân thủ quét trực tiếp 100% từ bảng cơ sở vật chất cố định.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            {filteredGroups.map((group) => {
              const rooms = getRoomsForGroup(group.ktx, group.building);
              const groupWorkers = workers.filter(w => {
                if (w.ktx !== group.ktx || w.day !== group.building) return false;
                const normW = normalizeRoomLabel(w.phongSo);
                return rooms.some(r => r === w.phongSo || normalizeRoomLabel(r) === normW);
              });
              const totalCapacity = rooms.reduce(
                (sum, room) => sum + (getRoomCapacity(capacities, group.ktx, group.building, room) || DEFAULT_ROOM_CAPACITY),
                0
              );
              const occupancyPct = totalCapacity > 0 ? groupWorkers.length / totalCapacity : 0;

              return (
                <div key={group.key} className="flex-1 min-w-[280px]">
                  {/* Building header with KTX badge */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{group.building}</span>
                        {group.ktx && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${group.ktx === 'KTX 1' ? 'bg-bdg text-lnk' : 'tint-wn text-wn'}`}>
                            {group.ktx}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground font-tabular">{groupWorkers.length}/{totalCapacity} · {Math.round(occupancyPct * 100)}% đầy</span>
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
                      const normR = normalizeRoomLabel(room);
                      const count = workers.filter(
                        w => w.ktx === group.ktx && w.day === group.building && (w.phongSo === room || normalizeRoomLabel(w.phongSo) === normR)
                      ).length;
                      const roomCap = getRoomCapacity(capacities, group.ktx, group.building, room) || DEFAULT_ROOM_CAPACITY;
                      const pct = roomCap > 0 ? count / roomCap : 0;
                      const roomClass = getRoomClass(pct);
                      const barColor = getRoomBarColor(pct);
                      const unitLabel = getRoomUnitLabel(group.ktx, group.building, room);
                      const isAdminAssigned = roomUnitAssignments.some(
                        a => a.ktx === group.ktx && a.day_nha === group.building && (a.phong_so === room || normalizeRoomLabel(a.phong_so) === normR)
                      );
                      const roomDisplay = formatRoomDisplay(room);

                      return (
                        <div
                          key={`room-${group.key}-${room}`}
                          className={`border rounded-lg p-3 cursor-pointer hover:shadow-md transition-colors duration-100 ${roomClass}`}
                          onClick={() => {
                            if (!group.building) return;
                            setDrawerRoom({ ktx: group.ktx, building: group.building, room });
                          }}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-foreground truncate">{roomDisplay}</span>
                            <span className="text-xs font-tabular font-semibold text-foreground">{count}/{roomCap}</span>
                          </div>
                          <div className="w-full h-1.5 bg-white/50 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                          </div>
                          <div className="mt-1.5 flex items-center gap-1">
                            <Users size={10} className="text-muted-foreground" />
                            <span className="text-xs text-muted-foreground font-tabular">{Math.round(pct * 100)}% đầy</span>
                          </div>
                          {unitLabel && (
                            <div className="mt-1.5">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-normal break-words max-w-full ${isAdminAssigned ? 'bg-bdg text-lnk' : 'bg-act text-mu'}`}>
                                {isAdminAssigned && <span className="w-1.5 h-1.5 rounded-full bg-bdg flex-shrink-0" />}
                                {unitLabel}
                              </span>
                            </div>
                          )}
                          {(() => {
                            const noteData = roomUnitAssignments.find(
                              a => a.ktx === group.ktx && a.day_nha === group.building && (a.phong_so === room || normalizeRoomLabel(a.phong_so) === normR)
                            );
                            return noteData?.room_note ? (
                              <div className="mt-1.5">
                                <p className="text-[10px] tint-wn text-wn border border-wn rounded px-1.5 py-0.5 leading-tight line-clamp-2 break-words">
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
        )}

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 pt-3 border-t border-border">
          {[
            { label: '≥ 90% (Đầy)', cls: 'bg-dgr' },
            { label: '70–89% (Cao)', cls: 'bg-wn' },
            { label: '40–69% (Trung bình)', cls: 'bg-ok2' },
            { label: '< 40% (Thấp)', cls: 'bg-pri2' },
          ].map((leg) => (
            <div key={leg.label} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${leg.cls}`} />
              <span className="text-xs text-muted-foreground">{leg.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-bdg" />
            <span className="text-xs text-muted-foreground">Đơn vị (Admin gán)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-okbg border border-bdr2" />
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