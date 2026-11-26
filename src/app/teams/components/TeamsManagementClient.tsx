'use client';

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users2,
  Search,
  Copy,
  Check,
  FileSpreadsheet,
  Phone,
  AlertTriangle,
  Building2,
  MessageSquare,
  X,
  ChevronRight,
  BedDouble,
  Clock,
  Layers,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWorkers } from '@/context/WorkerContext';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { StatusTag } from '@/components/ui/StatusTag';
import { Worker, compareKtxNames, naturalSortCompare, removeAccents } from '@/data/workers';
import { formatRoomDisplay } from '@/lib/facilityCapacity';
import { CACHE_KEYS, getCachedData, setCachedData } from '@/lib/clientCache';
import {
  TeamGroupDimension,
  TeamGroupSummary,
  buildBlockSummaryZaloMessage,
  buildTeamIssueZaloMessage,
  buildTeamRosterZaloMessage,
  buildTeamTamTruZaloMessage,
  buildTeamGroups,
  exportTeamWorkersExcel,
} from '@/lib/teamAnalytics';

type QuickFilter = 'all' | 'scattered' | 'tamtru' | 'issues';

export default function TeamsManagementClient() {
  const { workers, loading, refreshing, refreshWorkers } = useWorkers();
  const { isAdmin, canWriteBlock } = useAuth();

  const [dimension, setDimension] = useState<TeamGroupDimension>('toTruong');
  const [ktxFilter, setKtxFilter] = useState<string>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedGroup, setSelectedGroup] = useState<TeamGroupSummary | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [zaloPreview, setZaloPreview] = useState<{ title: string; text: string } | null>(null);
  const [recentAbsentIds, setRecentAbsentIds] = useState<Set<string>>(() => {
    const cached = getCachedData<string[]>(CACHE_KEYS.TEAMS_ABSENT_IDS);
    return new Set(cached ?? []);
  });

  // Fetch latest attendance session absences (best-effort, silent if empty/unavailable)
  useEffect(() => {
    let active = true;
    const loadLatestAbsences = async () => {
      try {
        const supabase = createClient();
        const { data: latestSession } = await supabase
          .from('attendance_sessions')
          .select('id')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestSession?.id || !active) return;

        const { data: absentRows } = await supabase
          .from('attendance_records')
          .select('worker_id')
          .eq('session_id', latestSession.id)
          .in('status', ['absent', 'vắng', 'vang']);

        if (active && Array.isArray(absentRows)) {
          const ids = absentRows.map((r: { worker_id?: string }) => String(r.worker_id || '')).filter(Boolean);
          setCachedData(CACHE_KEYS.TEAMS_ABSENT_IDS, ids);
          setRecentAbsentIds(new Set(ids));
        }
      } catch {
        // Non-blocking
      }
    };
    loadLatestAbsences();
    return () => {
      active = false;
    };
  }, []);

  // Scope workers to user's manageable blocks if non-admin
  const scopedWorkers = useMemo(() => {
    return workers.filter(w => {
      if (!isAdmin && !canWriteBlock(w.day || '', w.ktx || '')) return false;
      if (ktxFilter !== 'all' && (w.ktx || '').trim() !== ktxFilter) return false;
      if (dayFilter !== 'all' && (w.day || '').trim() !== dayFilter) return false;
      return true;
    });
  }, [workers, isAdmin, canWriteBlock, ktxFilter, dayFilter]);

  const ktxOptions = useMemo(() => {
    const set = new Set<string>();
    workers.forEach(w => {
      if (w.ktx?.trim()) set.add(w.ktx.trim());
    });
    return Array.from(set).sort(compareKtxNames);
  }, [workers]);

  const dayOptions = useMemo(() => {
    const set = new Set<string>();
    workers.forEach(w => {
      if (ktxFilter !== 'all' && (w.ktx || '').trim() !== ktxFilter) return;
      if (w.day?.trim()) set.add(w.day.trim());
    });
    return Array.from(set).sort(naturalSortCompare);
  }, [workers, ktxFilter]);

  const allGroups = useMemo(() => {
    return buildTeamGroups(scopedWorkers, dimension, recentAbsentIds);
  }, [scopedWorkers, dimension, recentAbsentIds]);

  const filteredGroups = useMemo(() => {
    const q = removeAccents(deferredSearchQuery.trim()).toLowerCase();
    return allGroups.filter(g => {
      if (quickFilter === 'scattered' && g.dispersionLevel !== 'scattered') return false;
      if (quickFilter === 'tamtru' && g.unregisteredTamTru.length === 0) return false;
      if (quickFilter === 'issues' && g.noBedWorkers.length === 0 && g.recentAbsentIds.size === 0) return false;
      if (!q) return true;
      const hay = removeAccents(
        `${g.name} ${g.leaderPhone} ${g.primaryUnits.join(' ')} ${g.primaryBattalions.join(' ')} ${g.rooms.map(r => `${r.day} ${r.roomDisplay}`).join(' ')}`
      ).toLowerCase();
      return hay.includes(q);
    });
  }, [allGroups, quickFilter, deferredSearchQuery]);

  const kpis = useMemo(() => {
    const assignedGroups = allGroups.filter(g => !g.isUnassignedGroup);
    const scatteredCount = assignedGroups.filter(g => g.dispersionLevel === 'scattered').length;
    const tamTruAlertTeams = assignedGroups.filter(g => g.overdueTamTru.length > 0).length;
    const totalWorkers = allGroups.reduce((s, g) => s + g.totalWorkers, 0);
    return {
      totalTeams: assignedGroups.length,
      scatteredCount,
      tamTruAlertTeams,
      totalWorkers,
    };
  }, [allGroups]);

  const copyText = async (text: string, idKey: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(idKey);
      toast.success(`Đã copy ${label} — dán thẳng vào Zalo!`);
      setTimeout(() => setCopiedId(prev => (prev === idKey ? null : prev)), 2000);
    } catch {
      toast.error('Trình duyệt không hỗ trợ copy tự động. Hãy mở xem trước để sao chép.');
    }
  };

  const openBlockSummaryZalo = () => {
    const msg = buildBlockSummaryZaloMessage(ktxFilter, dayFilter, scopedWorkers);
    setZaloPreview({
      title: 'Báo cáo nhanh Quân số theo Dãy (Gửi nhóm BQL Zalo)',
      text: msg,
    });
  };

  const renderWorkerRow = (w: Worker) => {
    const isAbsent = recentAbsentIds.has(w.id);
    return (
      <div
        key={w.id}
        className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-act/40 transition-colors"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-tx">{w.hoVaTen}</span>
            {w.giuong && (
              <span className="px-1.5 py-0.5 rounded bg-bdg text-lnk font-mono font-bold text-[10px]">
                G{w.giuong}
              </span>
            )}
            {w.tamTruStatus !== 'registered' && (
              <span className="px-1.5 py-0.5 rounded tint-wn text-wn text-[10px] font-semibold">
                Chưa ĐK tạm trú
              </span>
            )}
            {isAbsent && (
              <span className="px-1.5 py-0.5 rounded bg-dgrbg text-dgr text-[10px] font-semibold">
                Vắng ĐD gần nhất
              </span>
            )}
          </div>
          <div className="text-[11px] text-mu mt-0.5 flex flex-wrap gap-x-2">
            <span>{w.maNV || '—'}</span>
            {w.soDienThoai && <span>· {w.soDienThoai}</span>}
            {w.donVi && <span>· {w.donVi}</span>}
          </div>
        </div>
        <Link
          href={`/worker-management?search=${encodeURIComponent(w.cccd || w.maNV || w.hoVaTen)}`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-act border border-bdr text-[11px] font-semibold text-mu hover:text-tx shrink-0"
        >
          <span>Hồ sơ</span>
          <ExternalLink size={11} />
        </Link>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-bdr">
        <div className="flex items-center gap-3">
          <CraftIconBadge icon={Users2} badgeIcon={MessageSquare} tone="blue" size="md" />
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">
              Quản Lý Tổ Đội & Báo Cáo Zalo
            </h1>
            <p className="text-xs sm:text-sm text-mu mt-0.5">
              Điều hành quân số theo Tổ trưởng · Tiểu đoàn · Đơn vị, phát hiện phân tán phòng & copy tin nhắn Zalo 1 chạm
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => refreshWorkers()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surf border border-bdr2 text-tx text-xs font-semibold hover:bg-act cursor-pointer"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-lnk' : 'text-mu'} />
            <span>Làm mới</span>
          </button>
          <button
            type="button"
            onClick={openBlockSummaryZalo}
            className="btn-glow-primary inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
          >
            <MessageSquare size={14} />
            <span>Báo cáo nhanh Dãy (Zalo)</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface-elevated rounded-2xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-mu">
            {dimension === 'toTruong' ? 'Tổng Tổ Trưởng' : dimension === 'tieuDoan' ? 'Tổng Tiểu Đoàn' : 'Tổng Đơn Vị'}
          </div>
          <div className="text-2xl font-extrabold font-mono text-tx mt-1">{kpis.totalTeams}</div>
          <p className="text-[11px] text-mu mt-0.5">Đang có công nhân lưu trú</p>
        </div>
        <div className="surface-elevated rounded-2xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-mu">Quân số phạm vi</div>
          <div className="text-2xl font-extrabold font-mono text-lnk mt-1">{kpis.totalWorkers.toLocaleString('vi-VN')}</div>
          <p className="text-[11px] text-mu mt-0.5">Cư dân đang lưu trú</p>
        </div>
        <button
          type="button"
          onClick={() => setQuickFilter(prev => (prev === 'scattered' ? 'all' : 'scattered'))}
          className={`surface-elevated rounded-2xl p-4 text-left transition-all cursor-pointer ${
            quickFilter === 'scattered' ? 'ring-2 ring-wn/50' : ''
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-wn flex items-center gap-1">
            <Layers size={12} /> Phân tán phòng cao
          </div>
          <div className="text-2xl font-extrabold font-mono text-wn mt-1">{kpis.scatteredCount}</div>
          <p className="text-[11px] text-mu mt-0.5">Đội đang rải rác nhiều phòng</p>
        </button>
        <button
          type="button"
          onClick={() => setQuickFilter(prev => (prev === 'tamtru' ? 'all' : 'tamtru'))}
          className={`surface-elevated rounded-2xl p-4 text-left transition-all cursor-pointer ${
            quickFilter === 'tamtru' ? 'ring-2 ring-dgr/50' : ''
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-dgr flex items-center gap-1">
            <AlertTriangle size={12} /> Quá hạn tạm trú
          </div>
          <div className="text-2xl font-extrabold font-mono text-dgr mt-1">{kpis.tamTruAlertTeams}</div>
          <p className="text-[11px] text-mu mt-0.5">Đội có người &gt;7 ngày chưa ĐK</p>
        </button>
      </div>

      {/* Controls Bar */}
      <div className="surface-elevated rounded-2xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SlidingTabs<TeamGroupDimension>
          layoutId="teams-dimension-tabs"
          compact
          value={dimension}
          onChange={d => {
            setDimension(d);
            setSelectedGroup(null);
          }}
          tabs={[
            { id: 'toTruong', label: 'Theo Tổ Trưởng' },
            { id: 'tieuDoan', label: 'Theo Tiểu Đoàn / Đội' },
            { id: 'donVi', label: 'Theo Đơn Vị' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={ktxFilter}
            onChange={e => {
              setKtxFilter(e.target.value);
              setDayFilter('all');
            }}
            className="rounded-xl bg-page border border-bdr2 px-3 py-1.5 text-xs text-tx font-semibold"
          >
            <option value="all">Tất cả KTX</option>
            {ktxOptions.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>

          <select
            value={dayFilter}
            onChange={e => setDayFilter(e.target.value)}
            className="rounded-xl bg-page border border-bdr2 px-3 py-1.5 text-xs text-tx font-semibold"
          >
            <option value="all">Tất cả Dãy</option>
            {dayOptions.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <select
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value as QuickFilter)}
            className="rounded-xl bg-page border border-bdr2 px-3 py-1.5 text-xs text-tx font-semibold"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="scattered">Phân tán phòng cao</option>
            <option value="tamtru">Có người chưa ĐK tạm trú</option>
            <option value="issues">Có người thiếu giường / vắng ĐD</option>
          </select>

          <div className="relative flex-1 sm:w-56 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm tên tổ, SĐT, phòng..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-page border border-bdr2 text-xs text-tx focus:outline-none focus:ring-2 focus:ring-pri/35"
            />
          </div>
        </div>
      </div>

      {/* Team Cards Grid */}
      {loading ? (
        <div className="py-16 text-center text-xs text-mu">Đang tổng hợp dữ liệu Tổ Đội...</div>
      ) : filteredGroups.length === 0 ? (
        <div className="surface-elevated rounded-2xl p-12 text-center space-y-2">
          <Users2 size={30} className="mx-auto text-mu/60" />
          <p className="text-sm font-bold text-tx">Không có tổ đội nào khớp bộ lọc</p>
          <p className="text-xs text-mu">Thử đổi KTX/Dãy hoặc xóa từ khóa tìm kiếm.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredGroups.map(group => {
            const rosterCopyKey = `roster-${group.id}`;
            const tamTruCopyKey = `tamtru-${group.id}`;
            return (
              <div
                key={group.id}
                className="surface-elevated rounded-2xl border border-bdr hover:border-bdr3 transition-all flex flex-col overflow-hidden"
              >
                {/* Card top */}
                <div className="p-4 space-y-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedGroup(group)}
                        className="text-left text-sm font-extrabold text-tx hover:text-lnk transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <span className="truncate">{group.name}</span>
                        <ChevronRight size={14} className="shrink-0 text-mu" />
                      </button>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-mu">
                        {group.primaryUnits.length > 0 && (
                          <span className="font-semibold text-tx">{group.primaryUnits.slice(0, 2).join(' · ')}</span>
                        )}
                        {group.leaderPhone && (
                          <button
                            type="button"
                            onClick={() => copyText(group.leaderPhone, `phone-${group.id}`, `SĐT ${group.leaderPhone}`)}
                            className="inline-flex items-center gap-1 text-lnk hover:underline cursor-pointer font-mono"
                            title="Bấm để copy SĐT Tổ trưởng"
                          >
                            <Phone size={11} />
                            <span>{group.leaderPhone}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-extrabold font-mono text-tx leading-none">
                        {group.totalWorkers}
                      </div>
                      <div className="text-[10px] text-mu mt-0.5">
                        {group.maleCount}N · {group.femaleCount}Nữ
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusTag tone="blue" size="sm" icon={Building2}>
                      {group.roomCount} phòng · {group.buildingCount} dãy
                    </StatusTag>
                    {group.dispersionLevel === 'scattered' && (
                      <StatusTag tone="amber" size="sm" icon={Layers}>
                        Phân tán cao ({group.avgPerRoom} ng/P)
                      </StatusTag>
                    )}
                    {group.overdueTamTru.length > 0 ? (
                      <StatusTag tone="rose" size="sm" icon={Clock}>
                        {group.overdueTamTru.length} quá hạn tạm trú
                      </StatusTag>
                    ) : group.unregisteredTamTru.length > 0 ? (
                      <StatusTag tone="amber" size="sm" icon={Clock}>
                        {group.unregisteredTamTru.length} chưa tạm trú
                      </StatusTag>
                    ) : (
                      <StatusTag tone="teal" size="sm">
                        100% tạm trú
                      </StatusTag>
                    )}
                    {group.noBedWorkers.length > 0 && (
                      <StatusTag tone="amber" size="sm" icon={BedDouble}>
                        {group.noBedWorkers.length} chưa giường
                      </StatusTag>
                    )}
                    {group.recentAbsentIds.size > 0 && (
                      <StatusTag tone="rose" size="sm">
                        {group.recentAbsentIds.size} vắng ĐD
                      </StatusTag>
                    )}
                  </div>

                  {/* Room distribution preview */}
                  {group.rooms.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {group.rooms.slice(0, 5).map(r => (
                        <span
                          key={`${r.day}-${r.phongSo}`}
                          className="px-2 py-0.5 rounded-md bg-page border border-bdr text-[11px] text-mu"
                        >
                          <strong className="text-tx">{r.day}</strong> · {r.roomDisplay} ({r.workers.length})
                        </span>
                      ))}
                      {group.rooms.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setSelectedGroup(group)}
                          className="px-2 py-0.5 rounded-md bg-act text-[11px] font-semibold text-lnk cursor-pointer"
                        >
                          +{group.rooms.length - 5} phòng
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick Actions Footer */}
                <div className="px-3.5 py-2.5 border-t border-bdr bg-side/70 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyText(buildTeamRosterZaloMessage(group), rosterCopyKey, `báo cáo Zalo tổ ${group.name}`)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-bdg hover:opacity-90 text-lnk border border-pri2/25 text-[11px] font-bold cursor-pointer"
                    title="Copy tin nhắn danh sách quân số & phòng gửi Zalo"
                  >
                    {copiedId === rosterCopyKey ? <Check size={12} /> : <Copy size={12} />}
                    <span>Zalo Quân số</span>
                  </button>

                  {group.unregisteredTamTru.length > 0 && (
                    <button
                      type="button"
                      onClick={() => copyText(buildTeamTamTruZaloMessage(group), tamTruCopyKey, `nhắc tạm trú tổ ${group.name}`)}
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg tint-wn hover:opacity-90 text-wn border border-wn/30 text-[11px] font-bold cursor-pointer"
                      title="Copy danh sách nhắc nộp tạm trú gửi Zalo"
                    >
                      {copiedId === tamTruCopyKey ? <Check size={12} /> : <MessageSquare size={12} />}
                      <span>Nhắc tạm trú</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const ok = exportTeamWorkersExcel(group);
                      if (ok) toast.success(`Đã xuất Excel tổ "${group.name}".`);
                    }}
                    className="p-1.5 rounded-lg bg-surf border border-bdr2 text-ok hover:bg-okbg cursor-pointer"
                    title="Xuất Excel danh sách tổ này"
                  >
                    <FileSpreadsheet size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedGroup(group)}
                    className="px-2.5 py-1.5 rounded-lg bg-act border border-bdr text-tx text-[11px] font-semibold hover:bg-surf cursor-pointer"
                  >
                    Chi tiết
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Team Detail Slide-Over Drawer */}
      {selectedGroup && (
        <div
          className="fixed inset-0 z-50 flex justify-end modal-backdrop-scrim fade-in"
          onClick={() => setSelectedGroup(null)}
        >
          <div
            className="w-full max-w-2xl bg-surf border-l border-bdr2 shadow-2xl h-full flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-extrabold text-tx truncate">{selectedGroup.name}</h2>
                <p className="text-xs text-mu mt-0.5">
                  {selectedGroup.totalWorkers} người ({selectedGroup.maleCount} Nam · {selectedGroup.femaleCount} Nữ) · {selectedGroup.roomCount} phòng
                  {selectedGroup.leaderPhone ? ` · SĐT: ${selectedGroup.leaderPhone}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGroup(null)}
                className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Action strip inside drawer */}
            <div className="px-5 py-3 border-b border-bdr bg-page/60 flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setZaloPreview({
                    title: `Tin nhắn Zalo: Quân số & phòng — ${selectedGroup.name}`,
                    text: buildTeamRosterZaloMessage(selectedGroup),
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pri text-white text-xs font-bold cursor-pointer hover:opacity-95"
              >
                <MessageSquare size={13} />
                <span>Zalo Quân số</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setZaloPreview({
                    title: `Tin nhắn Zalo: Nhắc Tạm trú — ${selectedGroup.name}`,
                    text: buildTeamTamTruZaloMessage(selectedGroup),
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl tint-wn border border-wn/35 text-wn text-xs font-bold cursor-pointer"
              >
                <Clock size={13} />
                <span>Zalo Nhắc tạm trú ({selectedGroup.unregisteredTamTru.length})</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setZaloPreview({
                    title: `Tin nhắn Zalo: Vắng ĐD & Thiếu giường — ${selectedGroup.name}`,
                    text: buildTeamIssueZaloMessage(selectedGroup),
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-act border border-bdr2 text-tx text-xs font-semibold cursor-pointer"
              >
                <AlertTriangle size={13} />
                <span>Zalo Rà soát</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const ok = exportTeamWorkersExcel(selectedGroup);
                  if (ok) toast.success(`Đã xuất Excel tổ "${selectedGroup.name}".`);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-okbg border border-ok2/35 text-ok text-xs font-bold cursor-pointer ml-auto"
              >
                <FileSpreadsheet size={13} />
                <span>Xuất Excel</span>
              </button>
            </div>

            {/* Room-by-room worker list */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {selectedGroup.dispersionLevel === 'scattered' && (
                <div className="rounded-xl tint-wn border border-wn/40 p-3 text-xs text-wn flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">Gợi ý gom phòng cho tổ này</p>
                    <p className="opacity-90 mt-0.5">
                      Đội đang trải rộng qua {selectedGroup.roomCount} phòng (trung bình {selectedGroup.avgPerRoom} người/phòng). Có thể dùng công cụ Dồn phòng ở trang Quản lý Giường để gom lại cho dễ quản lý.
                    </p>
                  </div>
                  <Link
                    href="/bed-management?action=consolidate"
                    className="px-2.5 py-1.5 rounded-lg bg-wn text-white text-[11px] font-bold shrink-0"
                  >
                    Mở Dồn phòng
                  </Link>
                </div>
              )}

              {selectedGroup.noBedWorkers.length > 0 && (
                <div className="rounded-xl border border-wn/40 overflow-hidden">
                  <div className="px-3.5 py-2 tint-wn border-b border-wn/30 text-xs font-bold text-wn">
                    Chưa xếp phòng / giường ({selectedGroup.noBedWorkers.length} người)
                  </div>
                  <div className="divide-y divide-bdr bg-surf">
                    {selectedGroup.noBedWorkers.map(renderWorkerRow)}
                  </div>
                </div>
              )}

              {selectedGroup.rooms.map(room => (
                <div key={`${room.day}-${room.phongSo}`} className="rounded-xl border border-bdr overflow-hidden">
                  <div className="px-3.5 py-2 bg-act/70 border-b border-bdr flex items-center justify-between text-xs">
                    <span className="font-bold text-tx">
                      {room.ktx ? `${room.ktx} · ` : ''}{room.day} · {room.roomDisplay}
                    </span>
                    <span className="font-mono font-bold text-lnk">{room.workers.length} người</span>
                  </div>
                  <div className="divide-y divide-bdr bg-surf">
                    {room.workers.map(renderWorkerRow)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Zalo Message Preview & Copy Modal */}
      {zaloPreview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center modal-backdrop-scrim p-4 fade-in"
          onClick={() => setZaloPreview(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-bdr bg-side flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare size={16} className="text-lnk shrink-0" />
                <h3 className="text-sm font-bold text-tx truncate">{zaloPreview.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setZaloPreview(null)}
                className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <textarea
                value={zaloPreview.text}
                onChange={e => setZaloPreview(prev => (prev ? { ...prev, text: e.target.value } : null))}
                rows={15}
                className="w-full rounded-xl bg-page border border-bdr2 p-3.5 text-xs font-mono text-tx leading-relaxed focus:outline-none focus:ring-2 focus:ring-pri/40"
              />
              <p className="text-[11px] text-mu mt-2">
                Anh có thể chỉnh sửa trực tiếp nội dung trên trước khi bấm Copy gửi vào nhóm Zalo.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-bdr bg-side flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setZaloPreview(null)}
                className="px-3.5 py-2 rounded-xl bg-act border border-bdr text-xs font-semibold text-mu hover:text-tx cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => copyText(zaloPreview.text, 'zalo-modal', 'nội dung báo cáo Zalo')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri text-white text-xs font-bold cursor-pointer hover:opacity-95"
              >
                {copiedId === 'zalo-modal' ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedId === 'zalo-modal' ? 'Đã chép vào Clipboard!' : 'Copy gửi Zalo'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
