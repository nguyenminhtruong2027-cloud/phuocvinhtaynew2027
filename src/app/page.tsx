'use client';
import React, { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useWorkers } from '@/context/WorkerContext';
import { getUniqueKTX, getUniqueBuildings, getUniqueRooms, countUniqueBuildings, aggregateKtxOccupancy, DEFAULT_ROOM_CAPACITY, naturalSortCompare, compareKtxNames } from '@/data/workers';
import { buildRoomCapacityMapFromFacilities, fetchFacilitiesList, FacilityItem, getRoomCapacity, RoomCapacityMap, normalizeRoomLabel, formatRoomDisplay } from '@/lib/facilityCapacity';
import KtxOccupancyBreakdown, { type BuildingOccupancyItem } from './components/KtxOccupancyBreakdown';
import {
  Users, LayoutGrid, FileSpreadsheet, Radio,
  ChevronDown, Search, X, Download, UserPlus, AlertTriangle,
  TrendingUp, TrendingDown, XCircle, GitBranch, HardHat,
  VenusAndMars, Building2, Layers, UserCheck, CheckCircle, ArrowRight, Activity,
  Wrench, Printer, FileText, ClipboardCheck, ShieldAlert, MoreHorizontal,
} from 'lucide-react';
import { CraftIconBadge, type CraftTone } from '@/components/ui/CraftIcon';
import { AnimatedNumber, SlidingTabs, StaggerGrid, StaggerItem } from '@/components/ui/MotionPrimitives';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { subscribeTableChanges } from '@/lib/realtimeHub';
import ExecutiveSpecialistsCard from './components/ExecutiveSpecialistsCard';
import DataQualityAlert from './components/DataQualityAlert';
import OperationalReadinessCard from './components/OperationalReadinessCard';
import type { MaintenanceBedItem } from './components/MaintenanceTrackerModal';
import type { BulkRoomDescriptor } from './components/BulkGenderAndPrintModal';
import RiskCommandRadar from './components/RiskCommandRadar';
import { SpecialistWithDuty } from '@/lib/dutyRoster';
import {
  getRoomGenderInfo,
  loadSavedRoomGenderMap,
  saveRoomGenderMap,
  fetchRoomLabelsAuthoritative,
  syncRoomGenderToSupabase,
  RoomGenderInfo,
  normalizeGender,
} from '@/lib/roomGender';
import { computeSystemMetrics, getActiveKtxList } from '@/lib/systemMetrics';
import { useKtxStructure } from '@/lib/ktxStructure';
import { exportToExcel } from '@/lib/exportExcel';
import { fetchWorkerFluctuationReport, getVNDateString } from '@/lib/workerFluctuation';
import { hasFacilityIssueNote } from '@/lib/smartRoomAssign';
import { daysSinceVN } from '@/lib/vnDate';
import type { DailyBriefingInput } from '@/lib/dailyBriefing';
import {
  fetchMaintenanceTickets,
  getTicketSlaStatus,
  type MaintenanceTicket,
} from '@/lib/maintenanceTickets';
import {
  fetchBlacklist,
  fetchDisciplines,
  type BlacklistRecord,
  type DisciplineRecord,
} from '@/lib/disciplineService';
import { computeOperationalRisks } from '@/lib/riskRadar';
import {
  printExecutiveReportA4,
  type ExecutiveReportBuildingRow,
} from '@/lib/executiveReportPrint';
import { CACHE_KEYS, getCachedData, setCachedData } from '@/lib/clientCache';

const RoomDrawer = dynamic(() => import('./components/RoomDrawer'), { ssr: false });
const TopUnitsRankingCard = dynamic(() => import('./components/TopUnitsRankingCard'), { ssr: false });
const RecentEntriesFeed = dynamic(() => import('./components/RecentEntriesFeed'), { ssr: false });
const WorkerFormModal = dynamic(() => import('@/app/worker-management/components/WorkerFormModal'), { ssr: false });
const MaintenanceTrackerModal = dynamic(() => import('./components/MaintenanceTrackerModal'), { ssr: false });
const DailyBriefingModal = dynamic(() => import('./components/DailyBriefingModal'), { ssr: false });
const BulkGenderAndPrintModal = dynamic(() => import('./components/BulkGenderAndPrintModal'), { ssr: false });
const HallwayInspectorModal = dynamic(() => import('@/components/HallwayInspectorModal'), { ssr: false });

interface DashboardSupportCache {
  maintenanceBeds: MaintenanceBedItem[];
  pendingQrSummary: { registrations: number; checkouts: number };
  allMaintenanceTickets: MaintenanceTicket[];
  disciplineRecords: DisciplineRecord[];
  blacklistRecords: BlacklistRecord[];
}

const EMPTY_TOOLTIP_WORKERS: { hoVaTen: string; maNV: string; gioiTinh?: string }[] = [];

// ─── Room heatmap color helpers (Executive Dark Mode) ──────────────────────
function getRoomHeatColor(count: number, capacity: number): { bg: string; border: string; label: string; dot: string; textColor: string } {
  if (count === 0) {
    return {
      bg: 'bg-act hover:bg-act',
      border: 'border-bdr hover:border-bdr2',
      label: 'Trống',
      dot: 'bg-ic',
      textColor: 'text-mu',
    };
  }
  const pct = count / capacity;
  if (pct > 1) {
    return {
      bg: 'tint-dgr hover:bg-act',
      border: 'border-dgr hover:border-dgr',
      label: 'Quá tải',
      dot: 'bg-dgr shadow-sm shadow-rose-500/50',
      textColor: 'text-dgr',
    };
  }
  if (pct >= 1) {
    return {
      bg: 'tint-wn hover:bg-act',
      border: 'border-wn hover:border-wn',
      label: 'Đầy 100%',
      dot: 'bg-wn shadow-sm shadow-amber-400/50',
      textColor: 'text-wn',
    };
  }
  return {
    bg: 'tint-info',
    border: 'border-bdr2 hover:border-ok2',
    label: 'Còn trống',
    dot: 'bg-ok2 shadow-sm shadow-emerald-400/50',
    textColor: 'text-ok',
  };
}

// ─── Circular Progress Ring Component (Motion Animated) ───────────────────
function ProgressRing({
  radius = 36,
  stroke = 6,
  progress = 0,
  color = 'var(--ok2)',
  trackColor = 'var(--bdr2)',
  children,
}: {
  radius?: number;
  stroke?: number;
  progress: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const clampedProgress = Math.min(Math.max(progress, 0), 100);
  const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center flex-shrink-0">
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90 drop-shadow-sm">
        <circle
          stroke={trackColor}
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500 ease-out"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Executive KPI Card ───────────────────────────────────────────────────
function ExecutiveKPICard({
  label,
  value,
  sub,
  icon,
  badgeIcon,
  tone = 'blue',
  alert,
  onClick,
  badge,
  bottomInfo,
  rightVisual,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  badgeIcon?: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  tone?: CraftTone;
  alert?: boolean;
  onClick?: () => void;
  badge?: string;
  bottomInfo?: React.ReactNode;
  rightVisual?: React.ReactNode;
}) {
  const glowClass =
    tone === 'teal'
      ? 'kpi-glow-teal'
      : tone === 'amber'
      ? 'kpi-glow-amber'
      : tone === 'rose'
      ? 'kpi-glow-rose'
      : tone === 'slate'
      ? 'kpi-glow-slate'
      : 'kpi-glow-blue';

  return (
    <div
      className={`rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between relative overflow-hidden group w-full h-full ${
        alert
          ? 'tint-dgr border border-dgr'
          : 'surface-elevated'
      } ${onClick ? 'cursor-pointer hover:-translate-y-0.5 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]' : ''}`}
      onClick={onClick}
    >
      {!alert && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 ${glowClass} opacity-65 group-hover:opacity-100 transition-opacity duration-150`}
        />
      )}
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2.5 sm:gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <span className="text-[11px] font-semibold tracking-wide text-mu block truncate">
              {label}
            </span>
            <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
              <div className={`text-xl sm:text-3xl lg:text-[34px] font-extrabold font-tabular tracking-tight whitespace-nowrap leading-tight ${alert ? 'text-dgr' : 'text-tx'}`}>
                {value}
              </div>
              {badge && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold tint-dgr text-dgr border border-dgr whitespace-nowrap">
                  {badge}
                </span>
              )}
            </div>
            {sub && <p className="text-[11px] sm:text-xs text-mu mt-0.5 line-clamp-2 leading-snug">{sub}</p>}
          </div>

          {rightVisual ? (
            rightVisual
          ) : (
            <div className="hidden sm:block shrink-0">
              <CraftIconBadge
                icon={icon}
                badgeIcon={badgeIcon}
                tone={tone}
                size="md"
              />
            </div>
          )}
        </div>
      </div>

      {bottomInfo && <div className="relative z-10 mt-3 sm:mt-3.5 pt-2.5 sm:pt-3 border-t border-bdr">{bottomInfo}</div>}
    </div>
  );
}

// ─── Executive Alert Card ─────────────────────────────────────────────────
function ExecutiveAlertCard({
  icon,
  tone = 'slate',
  label,
  value,
  onClick,
  className = '',
}: {
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  tone?: CraftTone;
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 sm:gap-3 rounded-xl sm:rounded-2xl px-3 sm:px-3.5 py-2.5 sm:py-3 surface-elevated group w-full min-w-0 ${
        onClick ? 'cursor-pointer hover:-translate-y-0.5 active:scale-[0.98] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]' : ''
      } ${className}`}
      onClick={onClick}
    >
      <CraftIconBadge icon={icon} tone={tone} size="sm" interactive={false} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] sm:text-xs text-mu font-medium truncate whitespace-nowrap">{label}</p>
        <p className="text-sm sm:text-base font-extrabold text-tx font-tabular tracking-tight whitespace-nowrap truncate">{value}</p>
      </div>
    </div>
  );
}

// ─── Global Search Bar (Longer, Top Header Beside Title) ───────────────────
function GlobalSearchBar({ onSelectWorker }: { onSelectWorker: (id: string) => void }) {
  const { workers } = useWorkers();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!deferredQuery.trim() || deferredQuery.length < 2) return [];
    const q = deferredQuery.toLowerCase();
    return workers.filter(w =>
      w.hoVaTen?.toLowerCase().includes(q) ||
      w.maNV?.toLowerCase().includes(q) ||
      w.cccd?.toLowerCase().includes(q) ||
      w.phongSo?.toLowerCase().includes(q) ||
      w.soDienThoai?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [deferredQuery, workers]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative w-full">
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
        <input
          type="text"
          placeholder="Tìm nhanh theo họ tên, mã NV, CCCD, số phòng, SĐT..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full pl-10 pr-9 py-2.5 text-sm bg-act text-tx placeholder-gray-400 border border-bdr/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-pri2 transition-all shadow-inner"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-mu hover:text-tx transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-surf border border-bdr rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-bdr bg-act">
            <span className="text-[11px] font-semibold text-mu uppercase tracking-wider">
              Kết quả tìm kiếm ({results.length})
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {results.map(w => (
              <button
                key={w.id}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-act/70 text-left transition-colors border-b border-bdr/30 last:border-b-0"
                onClick={() => { onSelectWorker(w.id); setQuery(''); setOpen(false); }}
              >
                <div className="w-8 h-8 rounded-lg bg-bdg border border-bdr2 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-lnk">{w.hoVaTen?.charAt(0) || '?'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-tx whitespace-normal break-words leading-tight">{w.hoVaTen}</p>
                  <p className="text-xs text-mu whitespace-normal break-words mt-0.5">
                    {[w.maNV ? `#${w.maNV}` : null, w.ktx, w.day && w.phongSo ? `Phòng ${w.phongSo}` : null, w.donVi].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-surf border border-bdr rounded-xl shadow-2xl z-50 px-4 py-3 text-sm text-mu text-center">
          Không tìm thấy công nhân phù hợp với từ khóa
        </div>
      )}
    </div>
  );
}

// ─── Room Tooltip (Theme-aware Glass Popover) ─────────────────────────────
function RoomTooltip({
  workers,
  room,
  genderInfo,
  onClose,
}: {
  workers: { hoVaTen: string; maNV: string; gioiTinh?: string }[];
  room: string;
  genderInfo?: RoomGenderInfo;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-surf border border-bdr2 text-tx rounded-xl p-3 text-xs fade-in"
      style={{ boxShadow: 'inset 0 1px 0 var(--specular), 0 16px 36px -8px var(--sh)' }}
    >
      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-bdr">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold font-mono text-tx">Phòng {room}</span>
          {genderInfo && (
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border inline-flex items-center gap-0.5 ${
              genderInfo.gender === 'female'
                ? 'tint-pink text-pink-tone border-pink-tint'
                : genderInfo.gender === 'male'
                ? 'bg-bdg text-lnk border-bdr2'
                : 'bg-act text-mu border-bdr'
            }`}>
              <span>{genderInfo.gender === 'female' ? '♀' : genderInfo.gender === 'male' ? '♂' : '•'}</span>
              <span>{genderInfo.label}</span>
              {genderInfo.isCustom && <span className="text-[8px] opacity-75">(Admin)</span>}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-mu hover:text-tx transition-colors">
          <X size={13} />
        </button>
      </div>
      {workers.length === 0 ? (
        <p className="text-mu py-1">Phòng trống (0 người)</p>
      ) : (
        <ul className="space-y-1.5 max-h-44 overflow-y-auto scrollbar-thin pr-1">
          {workers.map((w, i) => {
            const isF = (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';
            return (
              <li key={i} className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isF ? 'bg-pink-500' : 'bg-pri2'}`} />
                  <span className="truncate text-tx">{w.hoVaTen}</span>
                  <span className={`text-[9px] px-1 rounded font-bold ${isF ? 'tint-pink text-pink-tone' : 'text-lnk bg-bdg'}`}>
                    {isF ? 'Nữ' : 'Nam'}
                  </span>
                </div>
                {w.maNV && <span className="text-[10px] text-mu flex-shrink-0 font-mono">#{w.maNV}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-bdr2" />
    </div>
  );
}

// ─── Heatmap Room Cell (Architectural Tactile Room Tile) ────────────────────
const HeatmapRoomCell = React.memo(function HeatmapRoomCell({
  room, count, capacity, ktx, building, workers, onClickRoom, unitName, genderInfo, onQuickAssignGender
}: {
  room: string; count: number; capacity: number;
  ktx: string; building: string;
  workers: { hoVaTen: string; maNV: string; gioiTinh?: string }[];
  onClickRoom: (ktx: string, building: string, room: string) => void;
  unitName?: string;
  genderInfo: RoomGenderInfo;
  onQuickAssignGender?: (ktx: string, building: string, room: string, gender: 'male' | 'female' | 'auto') => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { bg, border, label, dot } = getRoomHeatColor(count, capacity);

  const isFemaleRoom = genderInfo.gender === 'female';
  const isMaleRoom = genderInfo.gender === 'male';
  const isMixedRoom = genderInfo.gender === 'mixed';

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleGenderTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(prev => !prev);
  };

  const handleSelectGender = (e: React.MouseEvent, g: 'male' | 'female' | 'auto') => {
    e.stopPropagation();
    onQuickAssignGender?.(ktx, building, room, g);
    setShowMenu(false);
  };

  const occupancyPercent = capacity > 0 ? Math.round((count / capacity) * 100) : 0;
  const clampedPct = Math.min(occupancyPercent, 100);
  const progressBarTone =
    occupancyPercent > 100
      ? 'bg-dgr'
      : occupancyPercent >= 100
      ? 'bg-wn'
      : isFemaleRoom
      ? 'bg-pink-500'
      : 'bg-pri2';
  const roomLabel = formatRoomDisplay(room);
  const fullTooltip = `${roomLabel} · ${count}/${capacity} (${occupancyPercent}%) · ${label}${genderInfo.isCustom ? ` (Phòng ${genderInfo.gender === 'male' ? 'Nam' : genderInfo.gender === 'female' ? 'Nữ' : ''})` : ''}${unitName ? ` · ĐV: ${unitName}` : ''}`;

  return (
    <div className="relative min-w-0 w-full overflow-visible">
      <div
        className={`relative border rounded-xl px-2 pt-1.5 pb-2 cursor-pointer flex flex-col justify-between gap-1 min-w-0 w-full overflow-hidden select-none shadow-sm hover:shadow-[inset_0_1px_0_var(--specular),0_8px_18px_-6px_var(--sh)] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 active:scale-[0.97] ${bg} ${
          isFemaleRoom
            ? 'tint-pink border-pink-tint'
            : isMaleRoom
            ? 'tint-info border-pri2/40'
            : isMixedRoom
            ? 'tint-wn border-wn'
            : border
        }`}
        style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
        onClick={() => onClickRoom(ktx, building, room)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={fullTooltip}
      >
        {/* Dòng 1: Chấm trạng thái + Tên phòng P.1 bên trái, Icon giới tính bên phải */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0 truncate">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
            <span className="text-xs font-bold font-mono text-tx tracking-tight truncate">
              {roomLabel}
            </span>
          </div>

          {/* Biểu tượng giới tính */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={handleGenderTagClick}
              title={`Đổi công năng: ${isFemaleRoom ? 'Phòng Nữ' : isMaleRoom ? 'Phòng Nam' : isMixedRoom ? 'Hỗn hợp' : 'Tự động'}`}
              className={`text-[10px] font-bold w-4.5 h-4.5 px-1 rounded-md transition-transform active:scale-90 inline-flex items-center justify-center shrink-0 leading-none ${
                isFemaleRoom
                  ? 'tint-pink text-pink-tone border border-pink-tint'
                  : isMaleRoom
                  ? 'bg-bdg text-lnk border border-pri2/35'
                  : isMixedRoom
                  ? 'tint-wn text-wn border border-wn'
                  : 'bg-surf text-mu border border-bdr hover:bg-act'
              }`}
            >
              {isFemaleRoom ? '♀' : isMaleRoom ? '♂' : isMixedRoom ? '⚡' : '•'}
            </button>

            {showMenu && (
              <div
                ref={menuRef}
                onClick={e => e.stopPropagation()}
                className="absolute right-0 top-full mt-1 z-50 w-36 rounded-xl bg-surf border border-bdr2 shadow-modal p-1 space-y-1 fade-in"
              >
                <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-mu border-b border-bdr pb-0.5 mb-0.5">
                  Đổi công năng {roomLabel}
                </div>
                <button
                  type="button"
                  onClick={(e) => handleSelectGender(e, 'male')}
                  className={`w-full text-left px-2 py-1 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${
                    isMaleRoom ? 'bg-pri text-white shadow-sm' : 'text-lnk hover:bg-bdg'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <span>♂</span>
                    <span>Phòng Nam</span>
                  </span>
                  {isMaleRoom && <span className="text-[10px]">✓</span>}
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSelectGender(e, 'female')}
                  className={`w-full text-left px-2 py-1 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${
                    isFemaleRoom ? 'bg-pink-600 text-white shadow-sm' : 'text-pink-tone hover:tint-pink'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <span>♀</span>
                    <span>Phòng Nữ</span>
                  </span>
                  {isFemaleRoom && <span className="text-[10px]">✓</span>}
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSelectGender(e, 'auto')}
                  className="w-full text-left px-2 py-1 rounded-lg text-[11px] font-medium text-mu hover:text-tx hover:bg-act transition-colors flex items-center justify-between"
                >
                  <span className="flex items-center gap-1">
                    <span>⚡</span>
                    <span>Tự động</span>
                  </span>
                  {!genderInfo.isCustom && <span className="text-[10px]">✓</span>}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dòng 2: Số lượng + Tỷ lệ % */}
        <div className="flex items-center justify-between gap-1 min-w-0 font-tabular">
          <span className="text-[11px] font-bold text-tx tabular-nums truncate">
            {count}/{capacity}
          </span>
          <span className="text-[10px] text-mu shrink-0 font-semibold">
            {occupancyPercent}%
          </span>
        </div>

        {/* Bottom micro capacity bar */}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-bdr/70 overflow-hidden">
          <span
            className={`block h-full transition-all duration-300 ${progressBarTone}`}
            style={{ width: `${clampedPct}%` }}
          />
        </span>
      </div>

      {showTooltip && !showMenu && (
        <RoomTooltip
          workers={workers}
          room={room}
          genderInfo={genderInfo}
          onClose={() => setShowTooltip(false)}
        />
      )}
    </div>
  );
});

// ─── Block Title With Staff Name ──────────────────────────────────────────
interface BlockAssignment {
  blockKey: string;
  staffName: string;
}

function BlockTitle({
  ktx, building, assignments, buildingWorkerCount, totalCap, occupancyPct, barColor
}: {
  ktx: string; building: string;
  assignments: BlockAssignment[];
  buildingWorkerCount: number; totalCap: number; occupancyPct: number; barColor: string;
}) {
  const blockKey = `${ktx} - ${building}`;
  const assigned = (assignments || []).find(a => a?.blockKey?.toLowerCase() === blockKey.toLowerCase());
  const staffLabel = assigned ? `Phụ trách: ${assigned.staffName ?? ''}` : 'Chưa gán';

  return (
    <div className="mb-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="text-sm font-bold text-tx shrink-0">{building}</span>
          <span className={`text-[11px] font-medium flex items-center gap-1 min-w-0 truncate ${assigned ? 'text-lnk' : 'text-mu'}`} title={staffLabel}>
            <GitBranch size={10} className="shrink-0" />
            <span className="truncate">{staffLabel}</span>
          </span>
        </div>
        <span className="text-xs text-mu font-tabular font-medium shrink-0 self-end sm:self-auto">
          {buildingWorkerCount}/{totalCap} · {Math.round(occupancyPct * 100)}% đầy
        </span>
      </div>
      <div className="w-full h-1.5 sm:h-2 bg-bdr rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${Math.min(occupancyPct * 100, 100)}%` }} />
      </div>
    </div>
  );
}

// ─── Main Executive Dashboard Page ─────────────────────────────────────────
export default function OccupancyDashboardPage() {
  const { currentUser, isAdmin, canWriteBlock, isTechnician } = useAuth();
  const { addLog } = useAudit();
  const { workers, loading, addWorker } = useWorkers();
  const { ktxNames } = useKtxStructure();
  const router = useRouter();
  const [selectedKTX, setSelectedKTX] = useState<string>('all');
  const [drawerRoom, setDrawerRoom] = useState<{ ktx: string; building: string; room: string } | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const cachedDashboardSupport = getCachedData<DashboardSupportCache>(CACHE_KEYS.DASHBOARD_SUPPORT);
  const cachedDashboardFacilities = getCachedData<FacilityItem[]>(CACHE_KEYS.DASHBOARD_FACILITIES);
  const [todayStats, setTodayStats] = useState<{ entered: number; left: number }>(
    () => getCachedData<{ entered: number; left: number }>(CACHE_KEYS.DASHBOARD_TODAY_STATS) ?? { entered: 0, left: 0 }
  );
  const [blockAssignments, setBlockAssignments] = useState<BlockAssignment[]>([]);
  const [specialists, setSpecialists] = useState<{ id: string; name: string; email?: string; role: 'super_admin' | 'admin' | 'staff'; assignedBlocks?: string[] }[]>([]);
  const [dutyRoster, setDutyRoster] = useState<SpecialistWithDuty[]>([]);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>({});
  const [capacities, setCapacities] = useState<RoomCapacityMap>(() =>
    cachedDashboardFacilities ? buildRoomCapacityMapFromFacilities(cachedDashboardFacilities) : {}
  );
  const [activeMaintenanceTickets, setActiveMaintenanceTickets] = useState<MaintenanceTicket[]>(() =>
    cachedDashboardSupport
      ? cachedDashboardSupport.allMaintenanceTickets.filter(t => t.status === 'open' || t.status === 'in_progress')
      : []
  );
  const [allMaintenanceTickets, setAllMaintenanceTickets] = useState<MaintenanceTicket[]>(
    () => cachedDashboardSupport?.allMaintenanceTickets ?? []
  );
  const [disciplineRecords, setDisciplineRecords] = useState<DisciplineRecord[]>(
    () => cachedDashboardSupport?.disciplineRecords ?? []
  );
  const [blacklistRecords, setBlacklistRecords] = useState<BlacklistRecord[]>(
    () => cachedDashboardSupport?.blacklistRecords ?? []
  );
  const [facilitiesList, setFacilitiesList] = useState<FacilityItem[]>(() => cachedDashboardFacilities ?? []);
  const [roomFilterMode, setRoomFilterMode] = useState<'all' | 'overloaded' | 'empty'>('all');
  const [showOverloadedModal, setShowOverloadedModal] = useState(false);
  const [showReadinessCard, setShowReadinessCard] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('ktx_hide_readiness_checklist_v1') !== '1';
  });
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showBriefingModal, setShowBriefingModal] = useState(false);
  const [showHallwayInspector, setShowHallwayInspector] = useState(false);
  const [bulkModalMode, setBulkModalMode] = useState<'gender' | 'print' | null>(null);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'heatmap' | 'analytics' | 'risk'>('overview');
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const [maintenanceBeds, setMaintenanceBeds] = useState<MaintenanceBedItem[]>(
    () => cachedDashboardSupport?.maintenanceBeds ?? []
  );

  useEffect(() => {
    if (!showToolsMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showToolsMenu]);
  const [pendingQrSummary, setPendingQrSummary] = useState<{ registrations: number; checkouts: number }>(
    () => cachedDashboardSupport?.pendingQrSummary ?? { registrations: 0, checkouts: 0 }
  );

  // Load and sync room gender designations (Supabase room_units is authoritative)
  useEffect(() => {
    let active = true;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const saved = loadSavedRoomGenderMap();
    setRoomGenderMap(saved);

    const syncLabels = () => {
      fetchRoomLabelsAuthoritative().then(({ data: dbLabels, ok }) => {
        if (!active || !ok) return;
        setRoomGenderMap(dbLabels);
        saveRoomGenderMap(dbLabels);
      });
    };

    const scheduleSyncLabels = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        if (active) syncLabels();
      }, 250);
    };

    syncLabels();

    const unsubscribe = subscribeTableChanges('room_units', scheduleSyncLabels);

    return () => {
      active = false;
      if (syncTimer) clearTimeout(syncTimer);
      unsubscribe();
    };
  }, []);

  // Load room capacities and physical facilities catalog + realtime (single query)
  useEffect(() => {
    let active = true;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const load = async (force = false) => {
      try {
        const facs = await fetchFacilitiesList(force);
        if (active) {
          setCachedData(CACHE_KEYS.DASHBOARD_FACILITIES, facs);
          setFacilitiesList(facs);
          setCapacities(buildRoomCapacityMapFromFacilities(facs));
        }
      } catch (err) {
        console.warn('[Dashboard] load facilities error:', err);
      }
    };
    const scheduleLoad = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (active) load(true);
      }, 250);
    };
    load(false);
    const unsubscribe = subscribeTableChanges('facilities', scheduleLoad);
    const onFacilitiesUpdated = () => { scheduleLoad(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('ktx_facilities_updated', onFacilitiesUpdated);
    }
    return () => {
      active = false;
      if (reloadTimer) clearTimeout(reloadTimer);
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('ktx_facilities_updated', onFacilitiesUpdated);
      }
    };
  }, []);

  // Load maintenance beds + QR maintenance tickets + pending QR + discipline/blacklist
  const reloadOperationalSupportData = useCallback(async () => {
    try {
      const supabase = createClient();
      const [bedsRes, qrRes, allTicketsRes, discRes, blRes] = await Promise.all([
        supabase
          .from('beds')
          .select('id, ktx, day, phong_so, giuong')
          .eq('status', 'maintenance'),
        supabase
          .from('worker_registrations')
          .select('id, ghi_chu')
          .eq('status', 'pending'),
        fetchMaintenanceTickets({ activeOnly: false }).catch(() => ({
          tickets: [] as MaintenanceTicket[],
          tableMissing: true,
        })),
        fetchDisciplines().catch(() => ({
          data: [] as DisciplineRecord[],
          tableMissing: true,
        })),
        fetchBlacklist().catch(() => ({
          data: [] as BlacklistRecord[],
          tableMissing: true,
        })),
      ]);
      const nextSupport: DashboardSupportCache = {
        maintenanceBeds: (!bedsRes.error && bedsRes.data ? (bedsRes.data as MaintenanceBedItem[]) : (getCachedData<DashboardSupportCache>(CACHE_KEYS.DASHBOARD_SUPPORT)?.maintenanceBeds ?? [])),
        pendingQrSummary: getCachedData<DashboardSupportCache>(CACHE_KEYS.DASHBOARD_SUPPORT)?.pendingQrSummary ?? { registrations: 0, checkouts: 0 },
        allMaintenanceTickets: !allTicketsRes.tableMissing ? allTicketsRes.tickets : (getCachedData<DashboardSupportCache>(CACHE_KEYS.DASHBOARD_SUPPORT)?.allMaintenanceTickets ?? []),
        disciplineRecords: !discRes.tableMissing ? discRes.data : (getCachedData<DashboardSupportCache>(CACHE_KEYS.DASHBOARD_SUPPORT)?.disciplineRecords ?? []),
        blacklistRecords: !blRes.tableMissing ? blRes.data : (getCachedData<DashboardSupportCache>(CACHE_KEYS.DASHBOARD_SUPPORT)?.blacklistRecords ?? []),
      };
      if (!bedsRes.error && bedsRes.data) {
        setMaintenanceBeds(nextSupport.maintenanceBeds);
      }
      if (!qrRes.error && qrRes.data) {
        let reg = 0;
        let chk = 0;
        for (const r of qrRes.data) {
          if (r.ghi_chu?.startsWith('[CHECKOUT]')) chk++;
          else reg++;
        }
        nextSupport.pendingQrSummary = { registrations: reg, checkouts: chk };
        setPendingQrSummary(nextSupport.pendingQrSummary);
      }
      if (!allTicketsRes.tableMissing) {
        setAllMaintenanceTickets(nextSupport.allMaintenanceTickets);
        setActiveMaintenanceTickets(
          nextSupport.allMaintenanceTickets.filter(t => t.status === 'open' || t.status === 'in_progress')
        );
      }
      if (!discRes.tableMissing) {
        setDisciplineRecords(nextSupport.disciplineRecords);
      }
      if (!blRes.tableMissing) {
        setBlacklistRecords(nextSupport.blacklistRecords);
      }
      setCachedData(CACHE_KEYS.DASHBOARD_SUPPORT, nextSupport);
    } catch {
      // non-blocking
    }
  }, []);

  useEffect(() => {
    void reloadOperationalSupportData();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void reloadOperationalSupportData();
      }, 450);
    };
    const unsubscribe = subscribeTableChanges('maintenance_tickets', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [reloadOperationalSupportData]);

  const isEmpty = !loading && workers.length === 0 && facilitiesList.length === 0;

  // ── Unified Single Source of Truth for all operational metrics ───────────
  const systemMetrics = useMemo(() => {
    const getCap = (k: string, b: string, r: string) => getRoomCapacity(capacities, k, b, r) || DEFAULT_ROOM_CAPACITY;
    return computeSystemMetrics(workers, roomGenderMap, selectedKTX, ktxNames, getCap, facilitiesList);
  }, [workers, roomGenderMap, selectedKTX, ktxNames, capacities, facilitiesList]);

  // ── Khối E: Operational Risk Command Radar ───────────────────────────────
  const riskReport = useMemo(() => {
    return computeOperationalRisks({
      workers,
      facilities: facilitiesList,
      capacities,
      roomGenderMap,
      tickets: allMaintenanceTickets,
      disciplines: disciplineRecords,
      blacklist: blacklistRecords,
      ktxFilter: selectedKTX,
    });
  }, [
    workers,
    facilitiesList,
    capacities,
    roomGenderMap,
    allMaintenanceTickets,
    disciplineRecords,
    blacklistRecords,
    selectedKTX,
  ]);

  const handlePrintExecutiveA4 = useCallback(() => {
    const scopeFacilities = (facilitiesList || []).filter(
      f =>
        (f.room_type || 'accommodation') === 'accommodation' &&
        f.is_visible !== false &&
        (selectedKTX === 'all' || f.ktx === selectedKTX)
    );
    const scopeWorkers = (workers || []).filter(w => {
      if (w.ngayRaKTX || w.ghiChu?.includes('[Đã Check-out') || w.ghiChu?.includes('[CHECKOUT]')) return false;
      if (selectedKTX !== 'all' && w.ktx !== selectedKTX) return false;
      return true;
    });

    // Group by (ktx, day)
    const dayMap = new Map<
      string,
      {
        ktx: string;
        day: string;
        roomSet: Set<string>;
        occupiedRooms: Set<string>;
        capacity: number;
        occupied: number;
        male: number;
        female: number;
      }
    >();

    scopeFacilities.forEach(f => {
      const normR = normalizeRoomLabel(f.phong_khu_vuc);
      if (!normR) return;
      const key = `${f.ktx}||${f.day}`;
      const cur = dayMap.get(key) || {
        ktx: f.ktx,
        day: f.day,
        roomSet: new Set<string>(),
        occupiedRooms: new Set<string>(),
        capacity: 0,
        occupied: 0,
        male: 0,
        female: 0,
      };
      if (!cur.roomSet.has(normR)) {
        cur.roomSet.add(normR);
        cur.capacity += getRoomCapacity(capacities, f.ktx, f.day, normR) || DEFAULT_ROOM_CAPACITY;
      }
      dayMap.set(key, cur);
    });

    scopeWorkers.forEach(w => {
      if (!w.ktx || !w.day) return;
      const key = `${w.ktx}||${w.day}`;
      const cur = dayMap.get(key) || {
        ktx: w.ktx,
        day: w.day,
        roomSet: new Set<string>(),
        occupiedRooms: new Set<string>(),
        capacity: 0,
        occupied: 0,
        male: 0,
        female: 0,
      };
      const normR = normalizeRoomLabel(w.phongSo);
      if (normR) {
        if (!cur.roomSet.has(normR)) {
          cur.roomSet.add(normR);
          cur.capacity += getRoomCapacity(capacities, w.ktx, w.day, normR) || DEFAULT_ROOM_CAPACITY;
        }
        cur.occupiedRooms.add(normR);
      }
      cur.occupied++;
      const g = normalizeGender(w.gioiTinh);
      if (g === 'nu') cur.female++;
      else cur.male++;
      dayMap.set(key, cur);
    });

    const buildingRows: ExecutiveReportBuildingRow[] = Array.from(dayMap.values())
      .sort((a, b) => naturalSortCompare(`${a.ktx} ${a.day}`, `${b.ktx} ${b.day}`))
      .map(d => {
        const blockKey = `${d.ktx} - ${d.day}`.toLowerCase();
        const staff = blockAssignments.find(a => a.blockKey.toLowerCase() === blockKey)?.staffName;
        return {
          day: selectedKTX === 'all' ? `${d.ktx} · ${d.day}` : d.day,
          rooms: d.roomSet.size,
          emptyRooms: Math.max(0, d.roomSet.size - d.occupiedRooms.size),
          occupied: d.occupied,
          capacity: d.capacity,
          male: d.male,
          female: d.female,
          staffName: staff,
        };
      });

    printExecutiveReportA4({
      ktxLabel: selectedKTX === 'all' ? 'Toàn khu KTX Phước Vĩnh Tây' : selectedKTX,
      actorName: currentUser?.name || currentUser?.email || 'Ban Quản Lý KTX',
      workers: scopeWorkers,
      buildingRows,
      todayEntered: todayStats.entered,
      todayLeft: todayStats.left,
      tickets: allMaintenanceTickets,
      riskReport,
    });
  }, [
    facilitiesList,
    workers,
    selectedKTX,
    capacities,
    blockAssignments,
    currentUser?.name,
    currentUser?.email,
    todayStats.entered,
    todayStats.left,
    allMaintenanceTickets,
    riskReport,
  ]);

  // Dynamically retrieved KTX list across facilities + active workers (e.g. KTX 1, KTX 2, KTX 3, KTX 4)
  const allKTX = systemMetrics.activeKtxList;
  const ktxGenderRoomStats = systemMetrics.ktxBreakdown;
  const overallRoomTotals = systemMetrics.overallRoomTotals;
  const genderStats = useMemo(() => ({
    male: systemMetrics.maleWorkers,
    female: systemMetrics.femaleWorkers,
  }), [systemMetrics.maleWorkers, systemMetrics.femaleWorkers]);
  const contractorStats = systemMetrics.contractors;
  const contractorByKtx = systemMetrics.contractorByKtx;
  const genderByKtx = systemMetrics.genderByKtx;
  const dashboardTotal = systemMetrics.totalWorkersAll;

  // Handler for quick 1-click room gender assignment directly from Heatmap
  const handleQuickAssignGender = useCallback(async (
    ktx: string,
    building: string,
    room: string,
    gender: 'male' | 'female' | 'auto'
  ) => {
    const key = `${ktx.trim()}||${building.trim()}||${room.trim()}`;
    setRoomGenderMap(prev => {
      const next = { ...prev };
      if (gender === 'auto') {
        delete next[key];
      } else {
        next[key] = gender;
      }
      saveRoomGenderMap(next);
      return next;
    });

    // Persist to Supabase
    await syncRoomGenderToSupabase(ktx, building, room, gender);
  }, []);

  const handleBulkAssignGender = useCallback(
    async (
      targets: Array<{ ktx: string; day: string; room: string }>,
      gender: 'male' | 'female' | 'auto'
    ) => {
      setRoomGenderMap(prev => {
        const next = { ...prev };
        for (const t of targets) {
          const key = `${t.ktx.trim()}||${t.day.trim()}||${t.room.trim()}`;
          if (gender === 'auto') delete next[key];
          else next[key] = gender;
        }
        saveRoomGenderMap(next);
        return next;
      });
      const BATCH = 12;
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        await Promise.all(
          slice.map(t => syncRoomGenderToSupabase(t.ktx, t.day, t.room, gender))
        );
      }
    },
    []
  );

  const toggleReadinessCard = useCallback((show: boolean) => {
    setShowReadinessCard(show);
    try {
      if (show) localStorage.removeItem('ktx_hide_readiness_checklist_v1');
      else localStorage.setItem('ktx_hide_readiness_checklist_v1', '1');
    } catch {}
  }, []);

  // Filtered workers by selected KTX
  const filteredWorkers = useMemo(() =>
    selectedKTX === 'all'
      ? (workers || [])
      : (workers || []).filter(w => w?.ktx === selectedKTX),
    [workers, selectedKTX]
  );

  // Active accommodation facilities (excluding functional and hidden)
  const accommodationFacilities = useMemo(() => {
    return (facilitiesList || []).filter(f =>
      (f.room_type || 'accommodation') === 'accommodation' &&
      f.is_visible !== false
    );
  }, [facilitiesList]);

  const hiddenOrFunctionalKeys = useMemo(() => {
    const set = new Set<string>();
    (facilitiesList || []).forEach(f => {
      if ((f.room_type || 'accommodation') !== 'accommodation' || f.is_visible === false) {
        const k = (f.ktx ?? '').trim();
        const b = (f.day ?? '').trim();
        const r = normalizeRoomLabel(f.phong_khu_vuc ?? '');
        if (k && b && r) set.add(`${k}||${b}||${r}`);
      }
    });
    return set;
  }, [facilitiesList]);

  const allBuildings = useMemo(() => {
    const set = new Set<string>();
    accommodationFacilities.forEach(f => {
      if (selectedKTX === 'all' || f.ktx === selectedKTX) {
        if (f.day) set.add(f.day.trim());
      }
    });
    filteredWorkers.forEach(w => {
      if (w.day?.trim()) set.add(w.day.trim());
    });
    return Array.from(set).sort(naturalSortCompare);
  }, [accommodationFacilities, filteredWorkers, selectedKTX]);

  // ── Load block assignments & specialists from profiles ───────────────────
  useEffect(() => {
    const loadStaff = async () => {
      let rawProfiles: any[] = [];
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_profiles') : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) rawProfiles = parsed;
        }
      } catch {}

      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, email, role, assigned_blocks');

        if (!error && data && data.length > 0) {
          rawProfiles = data;
          try {
            localStorage.setItem('ktx_local_profiles', JSON.stringify(data));
          } catch {}
        }
      } catch {}

      const assignments: BlockAssignment[] = [];
      const listById = new Map<string, { id: string; name: string; email?: string; role: 'super_admin' | 'admin' | 'staff'; assignedBlocks?: string[] }>();
      rawProfiles.forEach((profile, idx) => {
        const id = String(profile?.id || `sp-${idx}`);
        const blocks: string[] = Array.isArray(profile?.assigned_blocks) ? profile.assigned_blocks : [];
        const resolvedRole: 'super_admin' | 'admin' | 'staff' =
          profile?.role === 'super_admin' ? 'super_admin' : profile?.role === 'admin' ? 'admin' : 'staff';
        if (!listById.has(id) && resolvedRole === 'staff') {
          blocks.forEach(block => {
            if (block && profile?.full_name) {
              assignments.push({ blockKey: block, staffName: profile.full_name });
            }
          });
        }
        listById.set(id, {
          id,
          name: profile?.full_name || profile?.name || profile?.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
          email: profile?.email,
          role: resolvedRole,
          assignedBlocks: blocks,
        });
      });

      setBlockAssignments(assignments);
      setSpecialists(Array.from(listById.values()));
    };

    loadStaff();
    window.addEventListener('ktx_profiles_updated', loadStaff);
    return () => {
      window.removeEventListener('ktx_profiles_updated', loadStaff);
    };
  }, []);

  // ── Derive room → don_vi mapping directly from loaded workers (zero extra queries) ──
  const roomUnitMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    (workers || []).forEach(w => {
      const ktx = (w?.ktx || '').trim();
      const day = (w?.day || '').trim();
      const room = normalizeRoomLabel(w?.phongSo || '');
      const unit = (w?.donVi || '').trim();
      if (!ktx || !day || !room || !unit) return;
      const key = `${ktx}||${day}||${room}`;
      if (!map[key]) map[key] = unit;
    });
    return map;
  }, [workers]);

  // ── KPI calculations from Single Source of Truth ─────────────────────────
  const totalCapacityAll = systemMetrics.capacity;
  const totalRoomsAll = systemMetrics.roomCount;
  const totalBuildingsAll = systemMetrics.buildingCount;
  const totalKTXAll = allKTX.length;

  const workersWithRoom = useMemo(() => workers.filter(w => w.day && w.phongSo), [workers]);
  const fillRateAll = systemMetrics.fillRate;

  const ktxOccupancy = useMemo(() => {
    return systemMetrics.ktxBreakdown.map(k => ({
      ktx: k.ktx,
      rooms: k.totalRooms,
      capacity: k.capacity,
      occupied: k.totalWorkers,
      vacant: k.vacant,
      overflow: k.overflow,
      fillRate: k.capacity > 0 ? k.totalWorkers / k.capacity : 0,
    }));
  }, [systemMetrics.ktxBreakdown]);
  const totalVacant = systemMetrics.vacantSpots;

  const filteredBuildingCount = systemMetrics.buildingCount;
  const filteredRoomCount = systemMetrics.roomCount;
  const filteredCapacity = systemMetrics.capacity;
  const filteredWithRoom = systemMetrics.workersWithRoom;
  const filteredFillRate = systemMetrics.fillRate;
  const filteredTotal = systemMetrics.selectedWorkersCount;

  const missingData = useMemo(() => filteredWorkers.filter(w => !w.day || !w.phongSo).length, [filteredWorkers]);

  // ── Operational Alerts (normalized room keys matching computeSystemMetrics) ──
  const roomWorkerMap = useMemo(() => {
    const map = new Map<string, { ktx: string; building: string; room: string; count: number }>();
    filteredWorkers.forEach(w => {
      const k = (w.ktx || '').trim();
      const b = (w.day || '').trim();
      const rawRoom = (w.phongSo || '').trim();
      if (!b || !rawRoom) return;
      const normR = normalizeRoomLabel(rawRoom);
      const normKey = `${k}||${b}||${normR}`;
      if (hiddenOrFunctionalKeys.has(normKey)) return;
      const existing = map.get(normKey);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(normKey, { ktx: k, building: b, room: rawRoom, count: 1 });
      }
    });
    return map;
  }, [filteredWorkers, hiddenOrFunctionalKeys]);

  const overloadedRooms = systemMetrics.overloadedRooms;

  const overloadedRoomsList = useMemo(() => {
    const list: { ktx: string; building: string; room: string; count: number; capacity: number; overflow: number }[] = [];
    roomWorkerMap.forEach(entry => {
      const cap = getRoomCapacity(capacities, entry.ktx, entry.building, entry.room) || DEFAULT_ROOM_CAPACITY;
      if (entry.count > cap) {
        list.push({
          ktx: entry.ktx,
          building: entry.building,
          room: entry.room,
          count: entry.count,
          capacity: cap,
          overflow: entry.count - cap,
        });
      }
    });
    return list.sort((a, b) => b.overflow - a.overflow);
  }, [roomWorkerMap, capacities]);

  const preloadedFluctuationRows = useMemo(
    () =>
      (workers || []).map(w => ({
        id: w.id,
        ho_va_ten: w.hoVaTen,
        ma_nv: w.maNV,
        ktx: w.ktx,
        day: w.day,
        created_at: w.createdAt || null,
        deleted_at: w.deletedAt || null,
      })),
    [workers]
  );

  useEffect(() => {
    if (loading) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadTodayStats = async () => {
      try {
        const todayVN = getVNDateString();
        const report = await fetchWorkerFluctuationReport({
          dateFrom: todayVN,
          dateTo: todayVN,
          ktx: selectedKTX === 'all' ? '' : selectedKTX,
          day: selectedBuilding || '',
          cutoffMode: 'realtime',
          preloadedWorkerRows: preloadedFluctuationRows,
        });
        if (active) {
          const nextStats = {
            entered: report.today.so_tang,
            left: report.today.so_giam,
          };
          if (selectedKTX === 'all' && !selectedBuilding) {
            setCachedData(CACHE_KEYS.DASHBOARD_TODAY_STATS, nextStats);
          }
          setTodayStats(nextStats);
        }
      } catch (err) {
        console.warn('[Dashboard] load todayStats warning:', err);
      }
    };

    loadTodayStats();

    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) loadTodayStats();
      }, 250);
    };

    const unsubscribe = subscribeTableChanges('worker_deletion_log', scheduleReload);

    window.addEventListener('ktx_fluctuation_baseline_updated', scheduleReload);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('ktx_fluctuation_baseline_updated', scheduleReload);
    };
  }, [loading, preloadedFluctuationRows, selectedKTX, selectedBuilding]);

  const ktxListForGrid = useMemo(() => {
    if (selectedKTX !== 'all') {
      return allKTX.filter(k => k === selectedKTX);
    }
    return allKTX;
  }, [selectedKTX, allKTX]);

  // Pre-index all workers & rooms into O(1) lookup Maps for fast heatmap rendering
  const heatmapIndex = useMemo(() => {
    const ktxWorkersMap = new Map<string, typeof workers>();
    const buildingWorkersMap = new Map<string, typeof workers>();
    const roomWorkersMap = new Map<string, typeof workers>();
    const roomTooltipWorkersMap = new Map<string, { hoVaTen: string; maNV: string; gioiTinh?: string }[]>();
    const roomGenderByKeyMap = new Map<string, RoomGenderInfo>();
    const ktxBuildingsSetMap = new Map<string, Set<string>>();
    const buildingRoomsMap = new Map<string, Map<string, string>>();

    const addBuildingToKtx = (ktx: string, day: string) => {
      let set = ktxBuildingsSetMap.get(ktx);
      if (!set) {
        set = new Set();
        ktxBuildingsSetMap.set(ktx, set);
      }
      set.add(day);
    };

    (accommodationFacilities || []).forEach(f => {
      const ktx = (f.ktx ?? '').trim();
      const day = (f.day ?? '').trim();
      if (!ktx || !day) return;
      addBuildingToKtx(ktx, day);
      const rawRoom = (f.phong_khu_vuc ?? '').trim();
      if (!rawRoom) return;
      const norm = normalizeRoomLabel(rawRoom);
      if (!norm) return;
      const bKey = `${ktx}||${day}`;
      let rMap = buildingRoomsMap.get(bKey);
      if (!rMap) {
        rMap = new Map();
        buildingRoomsMap.set(bKey, rMap);
      }
      if (!rMap.has(norm)) rMap.set(norm, rawRoom);
    });

    (workers || []).forEach(w => {
      const ktx = (w.ktx ?? '').trim();
      if (!ktx) return;
      let kList = ktxWorkersMap.get(ktx);
      if (!kList) {
        kList = [];
        ktxWorkersMap.set(ktx, kList);
      }
      kList.push(w);

      const day = (w.day ?? '').trim();
      if (!day) return;
      addBuildingToKtx(ktx, day);
      const bKey = `${ktx}||${day}`;
      let bList = buildingWorkersMap.get(bKey);
      if (!bList) {
        bList = [];
        buildingWorkersMap.set(bKey, bList);
      }
      bList.push(w);

      const rawRoom = (w.phongSo ?? '').trim();
      if (!rawRoom) return;
      const norm = normalizeRoomLabel(rawRoom);
      if (!norm) return;
      const fullNormKey = `${ktx}||${day}||${norm}`;
      if (!hiddenOrFunctionalKeys.has(fullNormKey)) {
        let rMap = buildingRoomsMap.get(bKey);
        if (!rMap) {
          rMap = new Map();
          buildingRoomsMap.set(bKey, rMap);
        }
        if (!rMap.has(norm)) rMap.set(norm, rawRoom);
      }
      let rwList = roomWorkersMap.get(fullNormKey);
      if (!rwList) {
        rwList = [];
        roomWorkersMap.set(fullNormKey, rwList);
      }
      rwList.push(w);

      let twList = roomTooltipWorkersMap.get(fullNormKey);
      if (!twList) {
        twList = [];
        roomTooltipWorkersMap.set(fullNormKey, twList);
      }
      twList.push({ hoVaTen: w.hoVaTen, maNV: w.maNV, gioiTinh: w.gioiTinh });
    });

    const ktxBuildingsSortedMap = new Map<string, string[]>();
    ktxBuildingsSetMap.forEach((set, ktx) => {
      ktxBuildingsSortedMap.set(ktx, Array.from(set).sort(naturalSortCompare));
    });

    const buildingRoomsSortedMap = new Map<string, string[]>();
    buildingRoomsMap.forEach((rMap, bKey) => {
      const [ktx, building] = bKey.split('||');
      const sorted = Array.from(rMap.values()).sort(naturalSortCompare);
      buildingRoomsSortedMap.set(bKey, sorted);
      sorted.forEach(room => {
        const normR = normalizeRoomLabel(room);
        const fullNormKey = `${ktx}||${building}||${normR}`;
        const rawKey = `${ktx}||${building}||${room}`;
        const rwList = roomWorkersMap.get(fullNormKey) || [];
        const adminGender = roomGenderMap[rawKey];
        roomGenderByKeyMap.set(
          rawKey,
          getRoomGenderInfo(rwList, adminGender === 'male' ? 'Nam' : adminGender === 'female' ? 'Nữ' : null)
        );
      });
    });

    return {
      ktxWorkersMap,
      buildingWorkersMap,
      roomWorkersMap,
      roomTooltipWorkersMap,
      roomGenderByKeyMap,
      ktxBuildingsSortedMap,
      buildingRoomsSortedMap,
    };
  }, [workers, accommodationFacilities, hiddenOrFunctionalKeys, roomGenderMap]);

  const drawerWorkers = useMemo(() => {
    if (!drawerRoom) return [];
    const normR = normalizeRoomLabel(drawerRoom.room);
    return heatmapIndex.roomWorkersMap.get(`${drawerRoom.ktx}||${drawerRoom.building}||${normR}`) || [];
  }, [drawerRoom, heatmapIndex]);

  const handleExportReport = useCallback(() => {
    const today = new Date();
    const dateStr = `${today.getDate().toString().padStart(2, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getFullYear()}`;
    const rows = filteredWorkers.map(w => ({
      'STT': w.stt,
      'Họ và Tên': w.hoVaTen,
      'Mã NV': w.maNV,
      'KTX': w.ktx,
      'Dãy': w.day,
      'Phòng': w.phongSo,
      'Giường': w.giuong || '',
      'CCCD': w.cccd,
      'SĐT': w.soDienThoai,
      'Ngày vào KTX': w.ngayVaoKTX,
      'Ngày ra KTX': w.ngayRaKTX || '',
      'Ghi chú': w.ghiChu,
    }));
    const fileName = `BaoCao_${selectedKTX === 'all' ? 'TatCa' : selectedKTX.replace(' ', '')}_${dateStr}.xlsx`;
    exportToExcel(rows, fileName, 'Báo Cáo');
  }, [filteredWorkers, selectedKTX]);

  const handleMissingDataClick = useCallback(() => {
    const params = new URLSearchParams({ filter: 'missing_room' });
    if (selectedKTX !== 'all') params.set('ktx', selectedKTX);
    router.push(`/worker-management?${params.toString()}`);
  }, [router, selectedKTX]);

  const handleEmptyRoomsClick = useCallback(() => {
    const params = new URLSearchParams({ filter: 'no_room' });
    if (selectedKTX !== 'all') params.set('ktx', selectedKTX);
    router.push(`/worker-management?${params.toString()}`);
  }, [router, selectedKTX]);

  const handleRoomClick = useCallback((ktx: string, building: string, room: string) => {
    setDrawerRoom({ ktx, building, room });
  }, []);

  const kpiWorkers = selectedKTX === 'all' ? dashboardTotal : filteredTotal;
  const kpiBuildings = selectedKTX === 'all' ? totalBuildingsAll : filteredBuildingCount;
  const kpiRooms = selectedKTX === 'all' ? totalRoomsAll : filteredRoomCount;
  const kpiCapacity = selectedKTX === 'all' ? totalCapacityAll : filteredCapacity;
  const kpiFillRate = selectedKTX === 'all' ? fillRateAll : filteredFillRate;
  const kpiWithRoom = selectedKTX === 'all' ? workersWithRoom.length : filteredWithRoom;
  const kpiVacant = selectedKTX === 'all' ? totalVacant : Math.max(0, filteredCapacity - filteredWithRoom);

  const scopedFacilities = useMemo(
    () =>
      facilitiesList.filter(
        f => selectedKTX === 'all' || f.ktx.trim() === selectedKTX.trim()
      ),
    [facilitiesList, selectedKTX]
  );

  const scopedMaintenanceBeds = useMemo(
    () =>
      maintenanceBeds.filter(
        b => selectedKTX === 'all' || b.ktx.trim() === selectedKTX.trim()
      ),
    [maintenanceBeds, selectedKTX]
  );

  const facilityIssuesCount = useMemo(
    () => scopedFacilities.filter(f => hasFacilityIssueNote(f.ghi_chu)).length,
    [scopedFacilities]
  );

  const scopedActiveTickets = useMemo(
    () =>
      activeMaintenanceTickets.filter(
        t => selectedKTX === 'all' || t.ktx.trim() === selectedKTX.trim()
      ),
    [activeMaintenanceTickets, selectedKTX]
  );

  const urgentTicketsCount = useMemo(
    () => scopedActiveTickets.filter(t => t.priority === 'urgent').length,
    [scopedActiveTickets]
  );

  const overdueSlaTicketsCount = useMemo(
    () => scopedActiveTickets.filter(t => getTicketSlaStatus(t).state === 'overdue').length,
    [scopedActiveTickets]
  );

  const totalMaintenanceCount =
    facilityIssuesCount + scopedMaintenanceBeds.length + scopedActiveTickets.length;

  const roomsMissingEquipment = useMemo(() => {
    return accommodationFacilities.filter(f => {
      if (selectedKTX !== 'all' && f.ktx.trim() !== selectedKTX.trim()) return false;
      return (
        (f.dieu_hoa || 0) === 0 &&
        (f.tu || 0) === 0 &&
        (f.quat || 0) === 0 &&
        (f.bong_tuyp || 0) === 0
      );
    }).length;
  }, [accommodationFacilities, selectedKTX]);

  const unassignedBuildingsCount = useMemo(() => {
    const assignedSet = new Set(blockAssignments.map(a => a.blockKey.toLowerCase()));
    let unassigned = 0;
    for (const ktx of ktxListForGrid) {
      const bList = heatmapIndex.ktxBuildingsSortedMap.get(ktx) || [];
      for (const b of bList) {
        if (!assignedSet.has(`${ktx} - ${b}`.toLowerCase())) unassigned++;
      }
    }
    return unassigned;
  }, [blockAssignments, ktxListForGrid, heatmapIndex.ktxBuildingsSortedMap]);

  const genderLockedRoomsCount = useMemo(() => {
    let locked = 0;
    for (const f of accommodationFacilities) {
      if (selectedKTX !== 'all' && f.ktx.trim() !== selectedKTX.trim()) continue;
      const rawKey = `${f.ktx.trim()}||${f.day.trim()}||${f.phong_khu_vuc.trim()}`;
      const normKey = `${f.ktx.trim()}||${f.day.trim()}||${normalizeRoomLabel(f.phong_khu_vuc)}`;
      if (roomGenderMap[rawKey] || roomGenderMap[normKey]) locked++;
    }
    return locked;
  }, [accommodationFacilities, selectedKTX, roomGenderMap]);

  const bulkRoomDescriptors = useMemo<BulkRoomDescriptor[]>(() => {
    const list: BulkRoomDescriptor[] = [];
    for (const ktx of ktxListForGrid) {
      const bList = heatmapIndex.ktxBuildingsSortedMap.get(ktx) || [];
      for (const building of bList) {
        const bKey = `${ktx}||${building}`;
        const rooms = heatmapIndex.buildingRoomsSortedMap.get(bKey) || [];
        for (const room of rooms) {
          const normR = normalizeRoomLabel(room);
          const roomWorkers = heatmapIndex.roomWorkersMap.get(`${bKey}||${normR}`) || [];
          const gInfo = heatmapIndex.roomGenderByKeyMap.get(`${bKey}||${room}`) || getRoomGenderInfo([], null);
          const cap = getRoomCapacity(capacities, ktx, building, room) || DEFAULT_ROOM_CAPACITY;
          list.push({
            ktx,
            day: building,
            room,
            capacity: cap,
            workers: roomWorkers,
            genderLabel: gInfo.label,
          });
        }
      }
    }
    return list;
  }, [ktxListForGrid, heatmapIndex, capacities]);

  const buildingOccupancyItems = useMemo<BuildingOccupancyItem[]>(() => {
    const rows: BuildingOccupancyItem[] = [];
    for (const ktx of ktxListForGrid) {
      const bList = heatmapIndex.ktxBuildingsSortedMap.get(ktx) || [];
      for (const b of bList) {
        const bKey = `${ktx}||${b}`;
        const rooms = heatmapIndex.buildingRoomsSortedMap.get(bKey) || [];
        const bWorkers = heatmapIndex.buildingWorkersMap.get(bKey) || [];
        let cap = 0;
        let empty = 0;
        let overflow = 0;
        for (const r of rooms) {
          const normR = normalizeRoomLabel(r);
          const cnt = (heatmapIndex.roomWorkersMap.get(`${bKey}||${normR}`) || []).length;
          const rCap = getRoomCapacity(capacities, ktx, b, r) || DEFAULT_ROOM_CAPACITY;
          cap += rCap;
          if (cnt === 0) empty++;
          if (cnt > rCap) overflow += cnt - rCap;
        }
        const occupied = bWorkers.length;
        rows.push({
          ktx,
          building: b,
          rooms: rooms.length,
          emptyRooms: empty,
          occupied,
          capacity: cap,
          vacant: Math.max(0, cap - occupied),
          overflow,
          fillRate: cap > 0 ? occupied / cap : 0,
        });
      }
    }
    return rows;
  }, [ktxListForGrid, heatmapIndex, capacities]);

  const dailyBriefingData = useMemo<DailyBriefingInput>(() => {
    const activeScopedWorkers = filteredWorkers.filter(
      w => !w.ngayRaKTX && !w.ghiChu?.includes('[Đã Check-out') && !w.ghiChu?.includes('[CHECKOUT]')
    );
    const unregisteredTamTru = activeScopedWorkers.filter(w => w.tamTruStatus !== 'registered').length;
    const overdueTamTru = activeScopedWorkers.filter(w => {
      if (w.tamTruStatus === 'registered') return false;
      const d = daysSinceVN(w.ngayVaoKTX || w.createdAt);
      return d !== null && d > 7;
    }).length;

    const assignedMap = new Map<string, string>();
    blockAssignments.forEach(a => assignedMap.set(a.blockKey.toLowerCase(), a.staffName));

    const buildingStats: DailyBriefingInput['buildingStats'] = [];
    for (const ktx of ktxListForGrid) {
      const bList = heatmapIndex.ktxBuildingsSortedMap.get(ktx) || [];
      for (const b of bList) {
        const bKey = `${ktx}||${b}`;
        const rooms = heatmapIndex.buildingRoomsSortedMap.get(bKey) || [];
        const bWorkers = heatmapIndex.buildingWorkersMap.get(bKey) || [];
        let cap = 0;
        let empty = 0;
        for (const r of rooms) {
          const normR = normalizeRoomLabel(r);
          const cnt = (heatmapIndex.roomWorkersMap.get(`${bKey}||${normR}`) || []).length;
          cap += getRoomCapacity(capacities, ktx, b, r) || DEFAULT_ROOM_CAPACITY;
          if (cnt === 0) empty++;
        }
        buildingStats.push({
          day: ktxListForGrid.length > 1 ? `${ktx} · ${b}` : b,
          workers: bWorkers.length,
          capacity: cap,
          rooms: rooms.length,
          emptyRooms: empty,
          staffName: assignedMap.get(`${ktx} - ${b}`.toLowerCase()),
        });
      }
    }

    return {
      ktxLabel: selectedKTX === 'all' ? (allKTX[0] || 'KTX Phước Vĩnh Tây') : selectedKTX,
      totalWorkers: kpiWorkers,
      totalCapacity: kpiCapacity,
      totalRooms: kpiRooms,
      emptyRooms: systemMetrics.emptyRooms,
      overloadedRooms,
      maleWorkers: genderStats.male,
      femaleWorkers: genderStats.female,
      todayEntered: todayStats.entered,
      todayLeft: todayStats.left,
      unregisteredTamTru,
      overdueTamTru,
      facilityIssuesCount,
      maintenanceBedsCount: scopedMaintenanceBeds.length,
      activeMaintenanceTicketsCount: scopedActiveTickets.length,
      urgentMaintenanceTicketsCount: urgentTicketsCount,
      overdueSlaTicketsCount,
      pendingRegistrationsCount: pendingQrSummary.registrations,
      pendingCheckoutsCount: pendingQrSummary.checkouts,
      buildingStats,
    };
  }, [
    filteredWorkers,
    blockAssignments,
    ktxListForGrid,
    heatmapIndex,
    capacities,
    selectedKTX,
    allKTX,
    kpiWorkers,
    kpiCapacity,
    kpiRooms,
    systemMetrics.emptyRooms,
    overloadedRooms,
    genderStats.male,
    genderStats.female,
    todayStats.entered,
    todayStats.left,
    facilityIssuesCount,
    scopedMaintenanceBeds.length,
    scopedActiveTickets.length,
    urgentTicketsCount,
    overdueSlaTicketsCount,
    pendingQrSummary,
  ]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-transparent text-tx transition-colors duration-200">
        <div className="px-2.5 sm:px-6 lg:px-8 xl:px-10 py-3 sm:py-5 max-w-screen-2xl mx-auto space-y-4 sm:space-y-5 w-full overflow-hidden">

          {/* ── 1. Sticky Executive Command Header ── */}
          <div className="lg:sticky lg:top-0 lg:z-20 -mx-2.5 sm:-mx-6 lg:-mx-8 xl:-mx-10 px-2.5 sm:px-6 lg:px-8 xl:px-10 pt-2 pb-3 bg-page/95 border-b border-bdr space-y-2.5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3 w-full">
              {/* Title Section */}
              <div className="flex items-center justify-between gap-3 min-w-0 shrink-0">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <CraftIconBadge icon={Building2} tone="blue" size="md" />
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-extrabold text-tx tracking-tight whitespace-nowrap leading-tight">
                      Trung Tâm Điều Hành KTX
                    </h1>
                    <p className="text-[11px] text-mu font-medium whitespace-nowrap truncate">
                      Phước Vĩnh Tây · {selectedKTX === 'all' ? `${totalKTXAll} khu KTX` : selectedKTX} · {kpiWorkers.toLocaleString('vi-VN')} công nhân
                    </p>
                  </div>
                </div>
                {loading && (
                  <span className="lg:hidden text-[11px] text-lnk font-medium inline-flex items-center gap-1 shrink-0">
                    <Activity size={13} className="animate-spin text-pri2" />
                  </span>
                )}
              </div>

              {/* Global Search Bar */}
              <div className="flex-1 max-w-lg lg:mx-2">
                <GlobalSearchBar
                  onSelectWorker={(id) => {
                    const w = workers.find(x => x.id === id);
                    if (w?.ktx && w?.day && w?.phongSo) {
                      setDrawerRoom({ ktx: w.ktx, building: w.day, room: w.phongSo });
                    }
                  }}
                />
              </div>

              {/* Right Controls: KTX Filter + Primary CTA */}
              <div className="flex items-center gap-2 shrink-0">
                {!isEmpty && allKTX.length > 0 && (
                  <div className="relative flex-1 sm:flex-none">
                    <select
                      value={selectedKTX}
                      onChange={e => { setSelectedKTX(e.target.value); setSelectedBuilding(null); }}
                      aria-label="Lọc theo KTX"
                      className="w-full sm:w-auto appearance-none bg-surf border border-bdr2 rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-tx focus:outline-none focus:ring-2 focus:ring-pri2/50 cursor-pointer sm:min-w-[124px]"
                    >
                      <option value="all">Tất cả KTX</option>
                      {allKTX.map(ktx => (
                        <option key={ktx} value={ktx}>{ktx}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowQuickAdd(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl btn-glow-primary text-xs font-bold cursor-pointer active:scale-[0.98] whitespace-nowrap shrink-0"
                >
                  <UserPlus size={15} />
                  <span>Xếp phòng nhanh</span>
                  {missingData > 0 && (
                    <span className="bg-white/20 text-white text-[11px] font-bold rounded-md px-1.5 py-0.5 leading-none font-tabular">
                      {missingData}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Row 2: Executive Tab Switcher + Clean Consolidated Action Menu */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 overflow-x-auto scrollbar-thin">
                <SlidingTabs
                  layoutId="dashboard-main-tabs"
                  compact
                  value={dashboardTab}
                  onChange={setDashboardTab}
                  tabs={[
                    {
                      id: 'overview',
                      label: 'Điều hành',
                      count: totalMaintenanceCount > 0 ? totalMaintenanceCount : undefined,
                      tone: urgentTicketsCount > 0 || overdueSlaTicketsCount > 0 ? 'danger' : 'default',
                    },
                    {
                      id: 'heatmap',
                      label: 'Sơ đồ phòng',
                      count: kpiRooms,
                      tone: overloadedRooms > 0 ? 'danger' : 'default',
                    },
                    {
                      id: 'analytics',
                      label: 'Phân tích',
                    },
                    {
                      id: 'risk',
                      label: 'Radar Rủi ro',
                      icon: ShieldAlert,
                      count:
                        riskReport.counts.critical + riskReport.counts.high > 0
                          ? riskReport.counts.critical + riskReport.counts.high
                          : undefined,
                      tone: riskReport.counts.critical > 0 ? 'danger' : 'default',
                    },
                  ]}
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!isTechnician && (
                  <button
                    type="button"
                    onClick={() => setShowHallwayInspector(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-ok2/45 bg-okbg/40 text-ok hover:bg-okbg/70 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    title="Kiểm phòng hành lang từng phòng P101 → P102 → P103 (quân số, điện nước, báo hỏng & xuất Zalo)"
                  >
                    <ClipboardCheck size={14} />
                    <span>Kiểm phòng</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowBriefingModal(true)}
                  className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf text-tx hover:bg-act text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  title="Tạo bản tin giao ban cuối ngày gửi Zalo Ban Chỉ Huy hoặc in PDF 1 trang"
                >
                  <FileText size={14} className="text-lnk" />
                  <span>Giao ban</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintExecutiveA4}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-bdr2 bg-surf text-tx hover:bg-act text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  title="Xuất & In Báo cáo Lãnh đạo Trình ký khổ A4 chuẩn văn bản hành chính"
                >
                  <Printer size={14} className="text-pri2" />
                  <span>Báo cáo A4</span>
                </button>

                <div ref={toolsMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setShowToolsMenu(prev => !prev)}
                    className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      showToolsMenu
                        ? 'bg-act border-pri2/50 text-tx'
                        : 'bg-surf border-bdr2 text-tx hover:bg-act'
                    }`}
                    aria-expanded={showToolsMenu}
                    aria-label="Mở công cụ báo cáo và xuất dữ liệu"
                  >
                    <MoreHorizontal size={15} className="text-mu" />
                    <span className="hidden sm:inline">Công cụ</span>
                  </button>

                  {showToolsMenu && (
                    <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl dropdown-menu-panel p-1.5 z-40 fade-in space-y-0.5">
                      <button
                        type="button"
                        onClick={() => { setShowToolsMenu(false); setShowBriefingModal(true); }}
                        className="md:hidden w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-tx hover:bg-act transition-colors text-left cursor-pointer"
                      >
                        <FileText size={14} className="text-lnk shrink-0" />
                        <span>Bản tin giao ban Zalo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowToolsMenu(false); handlePrintExecutiveA4(); }}
                        className="sm:hidden w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-tx hover:bg-act transition-colors text-left cursor-pointer"
                      >
                        <Printer size={14} className="text-pri2 shrink-0" />
                        <span>In Báo cáo Lãnh đạo A4</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowToolsMenu(false); handleExportReport(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-tx hover:bg-act transition-colors text-left cursor-pointer"
                      >
                        <Download size={14} className="text-lnk shrink-0" />
                        <span>Xuất báo cáo Excel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowToolsMenu(false); router.push('/worker-management'); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-tx hover:bg-act transition-colors text-left cursor-pointer"
                      >
                        <FileSpreadsheet size={14} className="text-ok shrink-0" />
                        <span>Quản lý &amp; Import công nhân</span>
                      </button>
                      {!showReadinessCard && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowToolsMenu(false);
                            setDashboardTab('overview');
                            toggleReadinessCard(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-tx hover:bg-act transition-colors text-left cursor-pointer"
                        >
                          <ClipboardCheck size={14} className="text-wn shrink-0" />
                          <span>Hiện bảng kiểm vận hành</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {loading && (
                  <span className="hidden lg:inline-flex text-xs text-lnk font-medium items-center gap-1.5 ml-0.5">
                    <Activity size={13} className="animate-spin text-pri2" />
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ══════════════════ TAB 1: ĐIỀU HÀNH NHANH (OVERVIEW) ══════════════════ */}
          {dashboardTab === 'overview' && (
          <>
          {/* ── 3. Top 3 Unified Stats Cards (2-col Compact Mobile / 3-col Desktop) ── */}
          <StaggerGrid className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 w-full">
            <StaggerItem>
              <ExecutiveKPICard
                label="Tổng Công Nhân"
                value={<AnimatedNumber value={kpiWorkers} />}
                sub={selectedKTX !== 'all'
                  ? `${selectedKTX} · ${kpiBuildings} dãy`
                  : `${totalKTXAll} KTX · ${kpiBuildings} dãy nhà`}
                icon={Users}
                tone="blue"
                bottomInfo={
                  <div className="flex items-center justify-between text-[11px] sm:text-xs text-mu font-medium gap-1">
                    <span className="truncate">Hệ thống:</span>
                    <span className="text-ok font-semibold inline-flex items-center gap-1 font-tabular shrink-0">
                      <CheckCircle size={12} />
                      Hoạt động
                    </span>
                  </div>
                }
              />
            </StaggerItem>

            <StaggerItem>
              <ExecutiveKPICard
                label="Quy Mô Cơ Sở"
                value={
                  <span className="inline-flex items-baseline gap-1">
                    <AnimatedNumber value={kpiBuildings} />
                    <span className="text-xs sm:text-lg font-bold text-mu">Dãy /</span>
                    <AnimatedNumber value={kpiRooms} />
                    <span className="text-xs sm:text-lg font-bold text-mu">P</span>
                  </span>
                }
                sub={`Sức chứa: ${kpiCapacity.toLocaleString('vi-VN')} chỗ`}
                icon={LayoutGrid}
                tone="slate"
                bottomInfo={
                  <div className="flex items-center justify-between text-[11px] sm:text-xs text-mu font-medium gap-1">
                    <span className="truncate">Định mức:</span>
                    <span className="text-lnk font-semibold font-tabular shrink-0">
                      Theo giường thực tế
                    </span>
                  </div>
                }
              />
            </StaggerItem>

            <StaggerItem className="col-span-2 md:col-span-1">
              <ExecutiveKPICard
                label="Tỷ Lệ Lấp Đầy"
                value={<AnimatedNumber value={kpiFillRate} format={n => `${Math.round(n)}%`} />}
                sub={`${kpiWithRoom.toLocaleString('vi-VN')}/${kpiCapacity.toLocaleString('vi-VN')} đang ở · Trống ${kpiVacant.toLocaleString('vi-VN')} chỗ`}
                icon={Layers}
                tone="teal"
                rightVisual={
                  <ProgressRing progress={kpiFillRate} radius={32} stroke={5} color="var(--ok2)" trackColor="var(--bdr2)">
                    <span className="text-[11px] font-extrabold text-ok font-tabular">{kpiFillRate}%</span>
                  </ProgressRing>
                }
                bottomInfo={
                  <div className="w-full space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] sm:text-xs">
                      <span className="text-mu font-medium">Tiến độ lấp đầy</span>
                      <span className="text-ok font-bold font-tabular">{kpiFillRate}% công suất</span>
                    </div>
                    <div className="w-full h-1.5 bg-bdr rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          kpiFillRate > 100 ? 'bg-dgr' : kpiFillRate >= 90 ? 'bg-wn' : 'bg-ok2'
                        }`}
                        style={{ width: `${Math.min(kpiFillRate, 100)}%` }}
                      />
                    </div>
                  </div>
                }
              />
            </StaggerItem>
          </StaggerGrid>

          {/* ── 3a. Pre-flight Operational Readiness Checklist ── */}
          {!loading && showReadinessCard && (
            <OperationalReadinessCard
              totalRooms={kpiRooms}
              totalCapacity={kpiCapacity}
              roomsMissingEquipment={roomsMissingEquipment}
              unassignedBuildingsCount={unassignedBuildingsCount}
              totalBuildings={kpiBuildings}
              genderLockedRoomsCount={genderLockedRoomsCount}
              missingWorkerDataCount={missingData}
              facilityIssuesCount={facilityIssuesCount}
              maintenanceBedsCount={scopedMaintenanceBeds.length}
              activeMaintenanceTicketsCount={scopedActiveTickets.length}
              onGoFacilities={() => router.push('/facilities')}
              onGoUserMgmt={() => router.push('/user-management')}
              onGoWorkers={handleMissingDataClick}
              onOpenBulkGender={() => setBulkModalMode('gender')}
              onOpenMaintenance={() => setShowMaintenanceModal(true)}
              onDismiss={() => toggleReadinessCard(false)}
            />
          )}

          {/* ── 3b. Smart Operational Alerts ── */}
          {!isEmpty && (
            <DataQualityAlert
              selectedKtx={selectedKTX}
              roomGenderMap={roomGenderMap}
              onSelectRoom={handleRoomClick}
            />
          )}

          {/* ── 4. Band 1: Full-Width 5 Operational Alert Cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 w-full">
            <ExecutiveAlertCard
              className="col-span-2 sm:col-span-1"
              icon={XCircle}
              tone="slate"
              label="Phòng Trống (0 người)"
              value={`${systemMetrics.emptyRooms} phòng`}
              onClick={() => {
                setRoomFilterMode('empty');
                setDashboardTab('heatmap');
              }}
            />
            <ExecutiveAlertCard
              icon={AlertTriangle}
              tone={overloadedRooms > 0 ? 'rose' : 'slate'}
              label="Phòng Quá Tải"
              value={`${overloadedRooms} phòng`}
              onClick={() => {
                setShowOverloadedModal(true);
                setRoomFilterMode('overloaded');
                setDashboardTab('heatmap');
              }}
            />
            <ExecutiveAlertCard
              icon={Wrench}
              tone={
                urgentTicketsCount > 0 || overdueSlaTicketsCount > 0
                  ? 'rose'
                  : totalMaintenanceCount > 0
                  ? 'amber'
                  : 'slate'
              }
              label="Sự cố & Bảo trì"
              value={`${totalMaintenanceCount} mục`}
              onClick={() => setShowMaintenanceModal(true)}
            />
            <ExecutiveAlertCard
              icon={TrendingUp}
              tone="teal"
              label="Vào Hôm Nay"
              value={`+${todayStats.entered} người`}
              onClick={() => router.push('/report-dashboard?tab=bien-dong')}
            />
            <ExecutiveAlertCard
              icon={TrendingDown}
              tone="amber"
              label="Ra Hôm Nay"
              value={`-${todayStats.left} người`}
              onClick={() => router.push('/report-dashboard?tab=bien-dong')}
            />
          </div>

          {/* ── 5. Band 2: Full-Width KTX & Building Occupancy Breakdown ── */}
          <div className="rounded-2xl surface-elevated p-4 sm:p-5 w-full">
            <KtxOccupancyBreakdown
              items={ktxOccupancy}
              selectedKtx={selectedKTX}
              onSelectKtx={(ktx) => {
                setSelectedKTX(ktx);
                setSelectedBuilding(null);
              }}
              buildings={buildingOccupancyItems}
              onSelectBuilding={(ktx, building) => {
                setSelectedKTX(ktx);
                setSelectedBuilding(building);
                setRoomFilterMode('all');
                setDashboardTab('heatmap');
              }}
            />
          </div>

          {/* ── 6. Band 3: Full-Width Specialists Duty Roster (2–3 Col Grid) ── */}
          <div className="w-full">
            <ExecutiveSpecialistsCard
              specialists={specialists}
              onDutyRosterChange={setDutyRoster}
            />
          </div>

          {/* Quick Jump Strip to Heatmap & Analytics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setDashboardTab('heatmap')}
              className="surface-elevated rounded-2xl p-4 flex items-center justify-between gap-4 text-left hover:-translate-y-0.5 transition-transform cursor-pointer group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <CraftIconBadge icon={LayoutGrid} tone="blue" size="md" interactive={false} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-tx">Mở Sơ Đồ Phòng Trực Quan (Heatmap)</p>
                  <p className="text-xs text-mu mt-0.5 truncate">
                    {kpiRooms} phòng · {systemMetrics.emptyRooms} trống · {overloadedRooms} quá tải · Đổi Nam/Nữ & in cửa phòng
                  </p>
                </div>
              </div>
              <ArrowRight size={17} className="text-mu group-hover:text-lnk group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => setDashboardTab('analytics')}
              className="surface-elevated rounded-2xl p-4 flex items-center justify-between gap-4 text-left hover:-translate-y-0.5 transition-transform cursor-pointer group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <CraftIconBadge icon={HardHat} tone="amber" size="md" interactive={false} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-tx">Xem Phân Tích Giới Tính, Nhà Thầu & Lịch Sử Vào</p>
                  <p className="text-xs text-mu mt-0.5 truncate">
                    Nam {genderStats.male.toLocaleString('vi-VN')} · Nữ {genderStats.female.toLocaleString('vi-VN')} · {contractorStats.length} nhóm nhà thầu chính
                  </p>
                </div>
              </div>
              <ArrowRight size={17} className="text-mu group-hover:text-lnk group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          </div>
          </>
          )}

          {/* ══════════════════ TAB 3: PHÂN TÍCH & CƠ CẤU (ANALYTICS) ══════════════════ */}
          {dashboardTab === 'analytics' && (
          <>
          {/* ── 5. Detailed Statistics: Gender & Contractors ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Gender Stats */}
            <div className="rounded-2xl surface-elevated p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CraftIconBadge icon={VenusAndMars} tone="blue" size="md" />
                  <div>
                    <h2 className="text-base font-bold text-tx tracking-tight">Thống Kê Giới Tính & Công Năng Phòng</h2>
                    <p className="text-xs text-mu">Tự động quét toàn bộ KTX · Cơ cấu nhân sự và số lượng phòng</p>
                  </div>
                </div>
                <span className="text-xs text-mu font-semibold font-tabular">
                  Tổng: {(genderStats.male + genderStats.female).toLocaleString('vi-VN')}
                </span>
              </div>

              {/* Overall totals with Room counts (Theme-aware contrast for Light & Dark) */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl tint-info border border-bdr2 p-3.5 hover:border-pri2/40 transition-colors">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <p className="text-xs text-lnk font-semibold">Nam (Toàn hệ thống)</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-bdg text-lnk border border-bdr2">
                      {overallRoomTotals.maleRooms} Phòng Nam
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-lnk font-tabular mt-1">
                    {genderStats.male.toLocaleString('vi-VN')} <span className="text-xs font-normal text-mu">người</span>
                  </p>
                </div>

                <div className="rounded-xl tint-pink border border-pink-tint p-3.5 transition-colors">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <p className="text-xs text-pink-tone font-semibold">Nữ (Toàn hệ thống)</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full tint-pink text-pink-tone border border-pink-tint">
                      {overallRoomTotals.femaleRooms} Phòng Nữ
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-pink-tone font-tabular mt-1">
                    {genderStats.female.toLocaleString('vi-VN')} <span className="text-xs font-normal text-mu">người</span>
                  </p>
                </div>
              </div>

              {/* Per-KTX detailed breakdown table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">
                    Chi tiết theo từng khu vực KTX
                  </p>
                  <span className="text-[11px] text-mu font-medium font-tabular">
                    {allKTX.length} KTX · {overallRoomTotals.totalRooms} phòng
                  </span>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
                  {ktxGenderRoomStats.map(stat => (
                    <div
                      key={stat.ktx}
                      className="rounded-xl border border-bdr bg-act/60 p-3 hover:bg-act hover:border-pri2/40 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                            stat.ktx === 'KTX 1' ? 'bg-bdg text-lnk border-bdr2' :
                            stat.ktx === 'KTX 2' ? 'tint-wn text-wn border-wn' :
                            stat.ktx === 'KTX 3' ? 'bg-okbg text-ok border-bdr2' :
                            'bg-bdg text-lnk border-bdr2'
                          }`}>
                            {stat.ktx}
                          </span>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-lnk font-medium">
                              Nam: <strong className="font-tabular text-lnk">{stat.male}</strong>
                            </span>
                            <span className="text-mu">·</span>
                            <span className="text-pink-tone font-medium">
                              Nữ: <strong className="font-tabular text-pink-tone">{stat.female}</strong>
                            </span>
                            <span className="text-mu font-tabular">({stat.male + stat.female} người)</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-bdg text-lnk border border-bdr2 font-tabular">
                            <span>♂ {stat.maleRooms} P.Nam</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md tint-pink text-pink-tone border border-pink-tint font-tabular">
                            <span>♀ {stat.femaleRooms} P.Nữ</span>
                          </span>
                          {stat.mixedRooms > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md tint-wn text-wn border border-wn font-tabular">
                              <span>{stat.mixedRooms} Hỗn hợp</span>
                            </span>
                          )}
                          <span className="text-[10px] text-mu font-tabular">
                            ({stat.totalRooms} phòng)
                          </span>
                        </div>
                      </div>

                      {/* Visual mini ratio bar for male rooms vs female rooms */}
                      <div className="w-full h-1.5 bg-bdr rounded-full overflow-hidden flex mt-2">
                        {stat.totalRooms > 0 ? (
                          <>
                            <div
                              className="h-full bg-pri2 transition-all duration-300"
                              style={{ width: `${(stat.maleRooms / stat.totalRooms) * 100}%` }}
                              title={`Phòng Nam: ${stat.maleRooms}/${stat.totalRooms}`}
                            />
                            <div
                              className="h-full bg-pink-500 transition-all duration-300"
                              style={{ width: `${(stat.femaleRooms / stat.totalRooms) * 100}%` }}
                              title={`Phòng Nữ: ${stat.femaleRooms}/${stat.totalRooms}`}
                            />
                            {stat.mixedRooms > 0 && (
                              <div
                                className="h-full bg-wn transition-all duration-300"
                                style={{ width: `${(stat.mixedRooms / stat.totalRooms) * 100}%` }}
                                title={`Hỗn hợp: ${stat.mixedRooms}/${stat.totalRooms}`}
                              />
                            )}
                          </>
                        ) : (
                          <div className="h-full w-full bg-bdr/60 text-center" title="Chưa có dữ liệu phòng" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Contractor/Unit Stats */}
            <div className="rounded-2xl surface-elevated p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CraftIconBadge icon={HardHat} tone="amber" size="md" />
                  <div>
                    <h2 className="text-base font-bold text-tx tracking-tight">Đơn Vị & Nhà Thầu</h2>
                    <p className="text-xs text-mu">Phân bố quân số theo nhà thầu thi công</p>
                  </div>
                </div>
                <span className="text-xs text-mu font-semibold font-tabular">
                  Top 6 đơn vị
                </span>
              </div>

              {/* Overall totals grid */}
              <div className="mb-4">
                <p className="text-xs font-bold text-mu uppercase tracking-wider mb-2">Tổng quân số lớn nhất</p>
                <div className="grid grid-cols-2 gap-2">
                  {contractorStats.length > 0 ? contractorStats.map(([name, count]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-xl bg-act border border-bdr px-3.5 py-2.5 hover:bg-act/70 hover:border-wn transition-all duration-150"
                    >
                      <span className="text-xs font-semibold text-tx truncate mr-2">{name}</span>
                      <span className="text-sm font-bold text-wn font-tabular">{count}</span>
                    </div>
                  )) : (
                    <p className="text-xs text-mu col-span-2 py-3 text-center">Chưa có dữ liệu đơn vị</p>
                  )}
                </div>
              </div>

              {/* Per-KTX breakdown */}
              {Object.keys(contractorByKtx).sort().length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">Phân theo từng KTX</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {Object.keys(contractorByKtx).sort().map(ktxKey => (
                      <div
                        key={ktxKey}
                        className="rounded-xl border border-bdr bg-act px-3.5 py-2.5 hover:bg-act/60 hover:border-pri2/40 transition-all duration-150"
                      >
                        <p className="text-xs font-bold text-tx mb-1.5">{ktxKey}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {contractorByKtx[ktxKey].map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between rounded-lg bg-act px-2.5 py-1">
                              <span className="text-xs text-mu truncate mr-1">{name}</span>
                              <span className="text-xs font-bold text-wn font-tabular">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── 7. Top Units / Platoons Ranking + Recent Entries Feed (50/50) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            <TopUnitsRankingCard
              workers={filteredWorkers}
              selectedKTX={selectedKTX}
            />
            <RecentEntriesFeed
              workers={filteredWorkers}
              selectedKTX={selectedKTX}
              onSelectRoom={handleRoomClick}
            />
          </div>
          </>
          )}

          {/* ══════════════════ TAB 2: SƠ ĐỒ HEATMAP (LAZY MOUNTED) ══════════════════ */}
          {dashboardTab === 'heatmap' && (
          <div className="surface-elevated rounded-2xl p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-3">
                <CraftIconBadge icon={LayoutGrid} badgeIcon={Layers} tone="blue" size="md" />
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-tx tracking-tight">Sơ Đồ Phòng Trực Quan (Heatmap)</h2>
                  <p className="text-xs text-mu mt-0.5">
                    {selectedKTX !== 'all' ? selectedKTX : 'Toàn bộ Ký Túc Xá'} · Nhấp hoặc rê chuột vào ô phòng để xem danh sách
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 flex-wrap">
                {!isEmpty && bulkRoomDescriptors.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setBulkModalMode('gender')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs font-bold text-tx transition-colors whitespace-nowrap cursor-pointer"
                      title="Gán nhanh công năng Phòng Nam / Phòng Nữ cho cả Dãy hoặc cụm phòng"
                    >
                      <VenusAndMars size={13} className="text-lnk" />
                      <span>Gán Nam/Nữ hàng loạt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkModalMode('print')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surf hover:bg-act border border-bdr2 text-xs font-bold text-tx transition-colors whitespace-nowrap cursor-pointer"
                      title="In bảng danh sách niêm yết cửa phòng hàng loạt theo Dãy (khổ A4)"
                    >
                      <Printer size={13} className="text-ok" />
                      <span>In bảng cửa phòng</span>
                    </button>
                  </div>
                )}

                <SlidingTabs
                  layoutId="dashboard-heatmap-filter"
                  compact
                  value={roomFilterMode}
                  onChange={setRoomFilterMode}
                  tabs={[
                    { id: 'all', label: 'Tất cả', count: systemMetrics.roomCount, tone: 'default' },
                    { id: 'overloaded', label: 'Quá tải', count: overloadedRooms > 0 ? overloadedRooms : undefined, tone: 'danger' },
                    { id: 'empty', label: 'Trống', count: systemMetrics.emptyRooms, tone: 'muted' },
                  ]}
                />

                {/* Building Filters (Instant active pills) */}
                {!isEmpty && allBuildings.length > 0 && (
                  <div className="inline-flex items-center gap-1 flex-wrap p-1 rounded-xl bg-act/80 border border-bdr2">
                    <button
                      type="button"
                      onClick={() => setSelectedBuilding(null)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        selectedBuilding === null
                          ? 'bg-pri text-white border border-pri2 shadow-sm'
                          : 'text-mu hover:text-tx hover:bg-surf/60 border border-transparent'
                      }`}
                    >
                      Tất cả dãy
                    </button>
                    {allBuildings.map(b => {
                      const active = selectedBuilding === b;
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setSelectedBuilding(b)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            active
                              ? 'bg-pri text-white border border-pri2 shadow-sm'
                              : 'text-mu hover:text-tx hover:bg-surf/60 border border-transparent'
                          }`}
                        >
                          {b}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Heatmap Legend (Clean typographic key) */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-3.5 mb-4 border-b border-bdr text-xs">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                <span className="text-[11px] font-semibold text-mu">Công năng:</span>
                <span className="inline-flex items-center gap-1 font-semibold text-lnk">
                  <span>♂</span> Phòng Nam
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-pink-tone">
                  <span>♀</span> Phòng Nữ
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-wn">
                  <span>⚡</span> Hỗn hợp
                </span>
                <span className="text-[11px] text-mu hidden sm:inline">
                  · Bấm ký hiệu trên ô phòng để đổi nhanh
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                <span className="text-[11px] font-semibold text-mu">Công suất:</span>
                {[
                  { label: 'Còn trống', dot: 'bg-ok2', tone: 'text-ok' },
                  { label: 'Đầy 100%', dot: 'bg-wn', tone: 'text-wn' },
                  { label: 'Quá tải', dot: 'bg-dgr', tone: 'text-dgr' },
                  { label: 'Trống (0)', dot: 'bg-ic', tone: 'text-mu' },
                ].map(leg => (
                  <span key={leg.label} className={`inline-flex items-center gap-1.5 font-semibold ${leg.tone}`}>
                    <span className={`w-2 h-2 rounded-full ${leg.dot}`} />
                    <span>{leg.label}</span>
                  </span>
                ))}
              </div>
            </div>

            {isEmpty && (
              <div className="rounded-2xl border-2 border-dashed border-bdr bg-act/30 p-10 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-bdg border border-pri2/20 flex items-center justify-center">
                  <FileSpreadsheet size={28} className="text-lnk" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-tx mb-1">Chưa có dữ liệu phòng KTX</h3>
                  <p className="text-sm text-mu max-w-md">
                    Vui lòng bấm <span className="font-semibold text-lnk">&quot;Import Excel&quot;</span> để tải danh sách công nhân vào hệ thống.
                  </p>
                </div>
                <button
                  onClick={() => router.push('/worker-management')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pri hover:bg-pri2 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-500/25"
                >
                  <FileSpreadsheet size={16} />
                  Đến trang Quản Lý Công Nhân
                </button>
              </div>
            )}

            {loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 py-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-2xl bg-act border border-bdr p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="h-4 w-24 rounded-md skeleton-pulse" />
                      <div className="h-3 w-16 rounded-md skeleton-pulse" />
                    </div>
                    <div className="h-1.5 w-full rounded-full skeleton-pulse" />
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3, 4, 5, 6].map(c => (
                        <div key={c} className="h-12 rounded-lg skeleton-pulse" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Heatmap Grid */}
            {!loading && ktxListForGrid.length === 0 && !isEmpty && (
              <div className="p-8 sm:p-12 rounded-2xl bg-act/40 border border-bdr text-center space-y-3">
                <CraftIconBadge icon={Building2} tone="blue" size="lg" className="mx-auto" />
                <h3 className="text-base font-bold text-tx">Sơ đồ phòng đang trống (0 phòng)</h3>
                <p className="text-sm text-mu max-w-md mx-auto">
                  Hiện tại chưa có phòng ở nào trong Cơ sở vật chất hoặc danh sách công nhân.
                </p>
                <div className="pt-1">
                  <button
                    onClick={() => router.push('/facilities')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri text-white text-xs font-semibold hover:bg-pri2 transition-colors shadow-md"
                  >
                    <span>Đến Quản lý Cơ sở vật chất để thêm phòng</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {!isEmpty && !loading && ktxListForGrid.length > 0 && (
              <div className="space-y-6">
                {ktxListForGrid.map(ktx => {
                  const ktxWorkers = heatmapIndex.ktxWorkersMap.get(ktx) || [];
                  const allKtxBuildings = heatmapIndex.ktxBuildingsSortedMap.get(ktx) || [];
                  const ktxBuildings = selectedBuilding
                    ? allKtxBuildings.filter(b => b === selectedBuilding)
                    : allKtxBuildings;

                  if (ktxBuildings.length === 0) {
                    if (selectedKTX === ktx) {
                      return (
                        <div key={ktx} className="p-8 rounded-xl bg-act/50 border border-bdr text-center space-y-3">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-xs font-bold px-3 py-1 rounded-lg border bg-bdg text-lnk border-bdr2">
                              {ktx}
                            </span>
                            <span className="text-xs text-mu font-medium">{ktxWorkers.length} công nhân · 0 dãy nhà</span>
                          </div>
                          <p className="text-sm text-mu max-w-md mx-auto">
                            Khu vực {ktx} hiện chưa có dữ liệu dãy/phòng. Vui lòng thêm phòng tại trang Quản lý Cơ sở vật chất.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }
                  return (
                    <div key={ktx} className="p-3.5 sm:p-4 rounded-xl bg-act/50 border border-bdr overflow-x-auto w-full scrollbar-thin">
                      {/* KTX Title + Dynamic Daily Duty Personnel Info */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5 pb-2.5 border-b border-bdr">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className={`text-xs font-bold px-3 py-1 rounded-lg border ${
                            ktx === 'KTX 1'
                              ? 'bg-bdg text-lnk border-bdr2'
                              : ktx === 'KTX 2'
                              ? 'tint-wn text-wn border-wn'
                              : ktx === 'KTX 3'
                              ? 'bg-okbg text-ok border-bdr2'
                              : 'bg-bdg text-lnk border-bdr2'
                          }`}>
                            {ktx}
                          </span>
                          <span className="text-xs text-mu font-medium font-tabular">
                            {ktxWorkers.length} công nhân · {ktxBuildings.length} dãy
                          </span>
                        </div>

                        {/* Dynamic Specialists on Duty at this KTX today */}
                        {(() => {
                          const ktxOnDuty = dutyRoster.filter(s => s.status === 'on_duty' && s.dutyKtx === ktx);
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-semibold text-mu flex items-center gap-1">
                                <UserCheck size={13} className="text-ok" />
                                <span>Trực ban hôm nay ({ktx}):</span>
                              </span>
                              {ktxOnDuty.length > 0 ? (
                                ktxOnDuty.map(s => (
                                  <span
                                    key={s.id}
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-okbg text-ok border border-bdr2"
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-ok2" />
                                    <span>{s.name}</span>
                                    {(s.role === 'super_admin' || s.role === 'admin') && (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-bdg text-lnk border border-bdr2 font-medium">
                                        {s.role === 'super_admin' ? 'Chủ HT' : 'Admin'}
                                      </span>
                                    )}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] text-mu italic bg-act px-2 py-0.5 rounded border border-bdr">
                                  Chưa phân công ca trực hôm nay
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 min-w-0 w-full items-start">
                        {ktxBuildings.map(building => {
                          const bKey = `${ktx}||${building}`;
                          const buildingWorkers = heatmapIndex.buildingWorkersMap.get(bKey) || [];
                          const allRooms = heatmapIndex.buildingRoomsSortedMap.get(bKey) || [];

                          const totalCap = allRooms.reduce(
                            (sum, room) => sum + (getRoomCapacity(capacities, ktx, building, room) || DEFAULT_ROOM_CAPACITY),
                            0
                          );
                          const occupancyPct = totalCap > 0 ? buildingWorkers.length / totalCap : 0;
                          const barColor = occupancyPct > 1 ? 'bg-dgr' : occupancyPct >= 1 ? 'bg-wn' : occupancyPct >= 0.5 ? 'bg-ok2' : 'bg-pri2';

                          // Apply active roomFilterMode using O(1) Map lookup
                          let displayRooms = allRooms;
                          if (roomFilterMode === 'overloaded') {
                            displayRooms = allRooms.filter(room => {
                              const normR = normalizeRoomLabel(room);
                              const count = (heatmapIndex.roomWorkersMap.get(`${bKey}||${normR}`) || []).length;
                              const cap = getRoomCapacity(capacities, ktx, building, room) || DEFAULT_ROOM_CAPACITY;
                              return count > cap;
                            });
                          } else if (roomFilterMode === 'empty') {
                            displayRooms = allRooms.filter(room => {
                              const normR = normalizeRoomLabel(room);
                              const count = (heatmapIndex.roomWorkersMap.get(`${bKey}||${normR}`) || []).length;
                              return count === 0;
                            });
                          }

                          if (displayRooms.length === 0 && roomFilterMode !== 'all') {
                            return null;
                          }

                          return (
                            <div key={building} className="rounded-2xl bg-act border border-bdr2 p-3 sm:p-4 flex flex-col justify-start shadow-md hover:border-bdr3 transition-colors h-auto self-start">
                              <BlockTitle
                                ktx={ktx}
                                building={building}
                                assignments={blockAssignments}
                                buildingWorkerCount={buildingWorkers.length}
                                totalCap={totalCap}
                                occupancyPct={occupancyPct}
                                barColor={barColor}
                              />
                              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(88px,1fr))] sm:gap-2 mt-2.5 items-start">
                                {displayRooms.map(room => {
                                  const normR = normalizeRoomLabel(room);
                                  const fullNormKey = `${bKey}||${normR}`;
                                  const roomKey = `${bKey}||${room}`;
                                  const tooltipWorkers = heatmapIndex.roomTooltipWorkersMap.get(fullNormKey) || EMPTY_TOOLTIP_WORKERS;
                                  const gInfo = heatmapIndex.roomGenderByKeyMap.get(roomKey) || getRoomGenderInfo([], null);
                                  return (
                                    <HeatmapRoomCell
                                      key={`${ktx}-${building}-${room}`}
                                      room={room}
                                      count={tooltipWorkers.length}
                                      capacity={getRoomCapacity(capacities, ktx, building, room) || DEFAULT_ROOM_CAPACITY}
                                      ktx={ktx}
                                      building={building}
                                      workers={tooltipWorkers}
                                      onClickRoom={handleRoomClick}
                                      unitName={roomUnitMap[roomKey]}
                                      genderInfo={gInfo}
                                      onQuickAssignGender={handleQuickAssignGender}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* ══════════════════ TAB 4: RADAR RỦI RO ĐIỀU HÀNH (KHỐI E) ══════════════════ */}
          {dashboardTab === 'risk' && (
            <RiskCommandRadar
              report={riskReport}
              onPrintExecutiveA4={handlePrintExecutiveA4}
            />
          )}

        </div>

        {/* Room Drawer Modal */}
        {drawerRoom && (
          <RoomDrawer
            key={`${drawerRoom.ktx}-${drawerRoom.building}-${drawerRoom.room}`}
            ktx={drawerRoom.ktx}
            building={drawerRoom.building}
            room={drawerRoom.room}
            workers={drawerWorkers}
            capacity={getRoomCapacity(capacities, drawerRoom.ktx, drawerRoom.building, drawerRoom.room) || DEFAULT_ROOM_CAPACITY}
            adminAssignedUnit={roomUnitMap[`${drawerRoom.ktx}||${drawerRoom.building}||${drawerRoom.room}`]}
            assignedGender={roomGenderMap[`${drawerRoom.ktx}||${drawerRoom.building}||${drawerRoom.room}`]}
            onRoomGenderUpdated={(newGender) => {
              const key = `${drawerRoom.ktx}||${drawerRoom.building}||${drawerRoom.room}`;
              setRoomGenderMap(prev => {
                const next = { ...prev };
                if (newGender === 'auto') {
                  delete next[key];
                } else {
                  next[key] = newGender;
                }
                saveRoomGenderMap(next);
                return next;
              });
            }}
            onClose={() => setDrawerRoom(null)}
          />
        )}

        {/* Overloaded Rooms Modal */}
        {showOverloadedModal && (
          <div className="fixed inset-0 z-50 modal-backdrop-scrim fade-in flex items-center justify-center p-4" onClick={() => setShowOverloadedModal(false)}>
            <div className="surface-elevated rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden modal-enter" onClick={e => e.stopPropagation()}>
              <div className="p-4 sm:p-5 border-b border-bdr flex items-center justify-between bg-act/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl tint-dgr border border-dgr flex items-center justify-center text-dgr">
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-tx">
                      Danh Sách Phòng Quá Tải
                    </h3>
                    <p className="text-xs text-mu mt-0.5">
                      {overloadedRoomsList.length} phòng có số công nhân vượt định mức số giường
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowOverloadedModal(false)}
                  className="p-2 rounded-xl text-mu hover:text-tx hover:bg-act transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 scrollbar-thin">
                {overloadedRoomsList.length === 0 ? (
                  <div className="text-center py-10 space-y-2">
                    <div className="w-12 h-12 rounded-full bg-okbg text-ok border border-bdr2 flex items-center justify-center mx-auto">
                      <CheckCircle size={24} />
                    </div>
                    <p className="text-sm font-semibold text-tx">Không có phòng quá tải</p>
                    <p className="text-xs text-mu">Tất cả các phòng trong hệ thống đều nằm trong giới hạn sức chứa thiết kế.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {overloadedRoomsList.map((item, idx) => {
                      const pct = Math.round((item.count / item.capacity) * 100);
                      return (
                        <div
                          key={`${item.ktx}-${item.building}-${item.room}-${idx}`}
                          className="rounded-xl border border-dgr/40 tint-dgr p-3.5 flex flex-col justify-between gap-3 hover:border-dgr transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-xs font-bold text-tx">
                                {item.ktx} · {item.building}
                              </span>
                              <p className="text-base font-extrabold text-dgr mt-0.5">
                                Phòng {item.room}
                              </p>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold tint-dgr text-dgr border border-dgr">
                              +{item.overflow} người ({pct}%)
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-rose-500/20 text-xs">
                            <span className="text-mu">
                              Đang ở: <strong className="text-tx font-tabular">{item.count}</strong> / {item.capacity} chỗ
                            </span>
                            <button
                              onClick={() => {
                                setShowOverloadedModal(false);
                                handleRoomClick(item.ktx, item.building, item.room);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-pri hover:bg-pri2 text-white font-semibold text-xs transition-colors flex items-center gap-1 shadow-sm"
                            >
                              <span>Xem phòng</span>
                              <ArrowRight size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-3.5 sm:p-4 border-t border-bdr bg-act/50 flex items-center justify-between">
                <span className="text-xs text-mu">
                  Định mức: Căn cứ theo số giường thực tế tại Quản lý Cơ sở vật chất
                </span>
                <button
                  onClick={() => setShowOverloadedModal(false)}
                  className="px-4 py-2 rounded-xl bg-act hover:bg-act border border-bdr text-xs font-bold text-tx transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Maintenance & Facility Issues Tracker Modal */}
        {showMaintenanceModal && (
          <MaintenanceTrackerModal
            facilities={scopedFacilities}
            maintenanceBeds={scopedMaintenanceBeds}
            maintenanceTickets={scopedActiveTickets}
            onClose={() => setShowMaintenanceModal(false)}
            onResolved={() => {
              void reloadOperationalSupportData();
            }}
          />
        )}

        {/* Executive Daily Briefing Modal (Zalo / PDF) */}
        {showBriefingModal && (
          <DailyBriefingModal
            data={dailyBriefingData}
            onClose={() => setShowBriefingModal(false)}
          />
        )}

        {/* Bulk Room Gender Assignment & Batch Door Poster Print Modal */}
        {bulkModalMode && (
          <BulkGenderAndPrintModal
            mode={bulkModalMode}
            rooms={bulkRoomDescriptors}
            onApplyBulkGender={handleBulkAssignGender}
            onClose={() => setBulkModalMode(null)}
          />
        )}

        {/* Quick Add Modal */}
        {showQuickAdd && (
          <WorkerFormModal
            worker={null}
            allWorkers={workers}
            onSave={async (w) => {
              try {
                await addWorker(w);
              } catch (err) {
                console.error('Quick-add worker error:', err);
              }
              setShowQuickAdd(false);
            }}
            onClose={() => setShowQuickAdd(false)}
          />
        )}

        {/* Mobile Hallway Inspector Modal (Gói 4) */}
        {showHallwayInspector && (
          <HallwayInspectorModal
            workers={workers}
            facilities={facilitiesList}
            isAdmin={isAdmin}
            canWriteBlock={canWriteBlock}
            actorName={currentUser?.name || currentUser?.email || 'Ban Quản Lý KTX'}
            actorEmail={currentUser?.email || ''}
            onLog={(action, detail) => {
              addLog(currentUser?.email || currentUser?.name || 'Admin', action, detail);
            }}
            onClose={() => {
              setShowHallwayInspector(false);
              void reloadOperationalSupportData();
            }}
          />
        )}
      </div>
    </AppLayout>
  );
}
