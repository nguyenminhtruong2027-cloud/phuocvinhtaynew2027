'use client';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useWorkers } from '@/context/WorkerContext';
import { getUniqueKTX, getUniqueBuildings, getUniqueRooms, countUniqueBuildings, aggregateKtxOccupancy, ROOM_CAPACITY } from '@/data/workers';
import KtxOccupancyBreakdown from './components/KtxOccupancyBreakdown';
import {
  Users, LayoutGrid, FileSpreadsheet, Wifi,
  ChevronDown, Search, X, Download, UserPlus, AlertTriangle,
  TrendingUp, TrendingDown, XCircle, GitBranch, HardHat,
  VenusAndMars, Sparkles, Building, Layers, UserCheck
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import WorkerFormModal from '@/app/worker-management/components/WorkerFormModal';
import ExecutiveSpecialistsCard from './components/ExecutiveSpecialistsCard';
import { SpecialistWithDuty } from '@/lib/dutyRoster';
import {
  getRoomGenderInfo,
  loadSavedRoomGenderMap,
  saveRoomGenderMap,
  fetchRoomLabelsFromSupabase,
  syncRoomGenderToSupabase,
  RoomGenderInfo,
  normalizeGender,
} from '@/lib/roomGender';
import { computeSystemMetrics, getActiveKtxList } from '@/lib/systemMetrics';
import { useKtxStructure } from '@/lib/ktxStructure';
import { exportToExcel } from '@/lib/exportExcel';

const RoomDrawer = dynamic(() => import('./components/RoomDrawer'), { ssr: false });
const DashboardCharts = dynamic(() => import('./components/DashboardCharts'), { ssr: false });
const RecentEntriesFeed = dynamic(() => import('./components/RecentEntriesFeed'), { ssr: false });

// ─── Room heatmap color helpers (Executive Dark Mode) ──────────────────────
function getRoomHeatColor(count: number, capacity: number): { bg: string; border: string; label: string; dot: string; textColor: string } {
  if (count === 0) {
    return {
      bg: 'bg-gray-800/90 hover:bg-gray-750',
      border: 'border-gray-700 hover:border-gray-500',
      label: 'Trống',
      dot: 'bg-gray-500',
      textColor: 'text-gray-400',
    };
  }
  const pct = count / capacity;
  if (pct > 1) {
    return {
      bg: 'bg-rose-950/50 hover:bg-rose-900/60',
      border: 'border-rose-500/60 hover:border-rose-400',
      label: 'Quá tải',
      dot: 'bg-rose-500 shadow-sm shadow-rose-500/50',
      textColor: 'text-rose-300',
    };
  }
  if (pct >= 1) {
    return {
      bg: 'bg-amber-950/40 hover:bg-amber-900/50',
      border: 'border-amber-500/50 hover:border-amber-400',
      label: 'Đầy 100%',
      dot: 'bg-amber-400 shadow-sm shadow-amber-400/50',
      textColor: 'text-amber-300',
    };
  }
  return {
    bg: 'bg-emerald-950/40 hover:bg-emerald-900/50',
    border: 'border-emerald-500/40 hover:border-emerald-400',
    label: 'Còn trống',
    dot: 'bg-emerald-400 shadow-sm shadow-emerald-400/50',
    textColor: 'text-emerald-300',
  };
}

// ─── Circular Progress Ring Component ─────────────────────────────────────
function ProgressRing({
  radius = 36,
  stroke = 6,
  progress = 0,
  color = '#10B981',
  trackColor = '#374151',
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
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
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
          style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.8s ease-in-out' }}
          strokeLinecap="round"
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
  icon: Icon,
  iconBg,
  iconColor,
  iconBorder,
  alert,
  onClick,
  badge,
  bottomInfo,
  rightVisual,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconBg: string;
  iconColor: string;
  iconBorder: string;
  alert?: boolean;
  onClick?: () => void;
  badge?: string;
  bottomInfo?: React.ReactNode;
  rightVisual?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 flex flex-col justify-between shadow-xl transition-all duration-300 relative overflow-hidden group w-full ${
        alert
          ? 'bg-rose-950/30 border-rose-500/50 hover:border-rose-400'
          : 'bg-[#1F2937] border-gray-700/60 hover:border-blue-500/40 hover:shadow-blue-500/5'
      } ${onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''}`}
      onClick={onClick}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400 group-hover:text-gray-300 transition-colors block truncate">
              {label}
            </span>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className={`text-2xl sm:text-3xl lg:text-4xl font-extrabold font-tabular tracking-tight whitespace-nowrap ${alert ? 'text-rose-400' : 'text-white'}`}>
                {value}
              </p>
              {badge && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 whitespace-nowrap">
                  {badge}
                </span>
              )}
            </div>
            {sub && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{sub}</p>}
          </div>

          {rightVisual ? (
            rightVisual
          ) : (
            <div className={`w-12 h-12 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center flex-shrink-0 border transition-colors duration-100 ${iconBg} ${iconColor} ${iconBorder}`}>
              <Icon size={24} className="sm:w-[26px] sm:h-[26px]" />
            </div>
          )}
        </div>
      </div>

      {bottomInfo && <div className="mt-3.5 pt-3 border-t border-gray-700/60">{bottomInfo}</div>}
    </div>
  );
}

// ─── Executive Alert Card ─────────────────────────────────────────────────
function ExecutiveAlertCard({
  icon: Icon,
  label,
  value,
  colorBg,
  colorText,
  colorBorder,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  colorBg: string;
  colorText: string;
  colorBorder: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 sm:gap-3.5 rounded-xl sm:rounded-2xl border px-3 sm:px-4 py-2.5 sm:py-3.5 bg-[#1F2937] border-gray-700/60 shadow-lg transition-all duration-150 group w-full min-w-0 ${
        onClick ? 'cursor-pointer hover:border-blue-500/40 hover:bg-gray-800' : 'hover:border-gray-600'
      }`}
      onClick={onClick}
    >
      <div className={`w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 border transition-colors duration-100 ${colorBg} ${colorText} ${colorBorder}`}>
        <Icon size={18} className="sm:w-5 sm:h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] sm:text-xs text-gray-400 font-medium truncate whitespace-nowrap group-hover:text-gray-300 transition-colors">{label}</p>
        <p className="text-sm sm:text-lg font-bold text-white font-tabular tracking-tight whitespace-nowrap truncate">{value}</p>
      </div>
    </div>
  );
}

// ─── Global Search Bar (Longer, Top Header Beside Title) ───────────────────
function GlobalSearchBar({ onSelectWorker }: { onSelectWorker: (id: string) => void }) {
  const { workers } = useWorkers();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    const q = query.toLowerCase();
    return workers.filter(w =>
      w.hoVaTen?.toLowerCase().includes(q) ||
      w.maNV?.toLowerCase().includes(q) ||
      w.cccd?.toLowerCase().includes(q) ||
      w.phongSo?.toLowerCase().includes(q) ||
      w.soDienThoai?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [query, workers]);

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
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Tìm nhanh theo họ tên, mã NV, CCCD, số phòng, SĐT..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full pl-10 pr-9 py-2.5 text-sm bg-gray-800/90 text-gray-100 placeholder-gray-400 border border-gray-700/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#1F2937] border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden backdrop-blur-md">
          <div className="px-3 py-1.5 border-b border-gray-700/60 bg-gray-800/50">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Kết quả tìm kiếm ({results.length})
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {results.map(w => (
              <button
                key={w.id}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/70 text-left transition-colors border-b border-gray-700/30 last:border-b-0"
                onClick={() => { onSelectWorker(w.id); setQuery(''); setOpen(false); }}
              >
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-blue-400">{w.hoVaTen?.charAt(0) || '?'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white whitespace-normal break-words leading-tight">{w.hoVaTen}</p>
                  <p className="text-xs text-gray-400 whitespace-normal break-words mt-0.5">
                    {[w.maNV ? `#${w.maNV}` : null, w.ktx, w.day && w.phongSo ? `Phòng ${w.phongSo}` : null, w.donVi].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#1F2937] border border-gray-700 rounded-xl shadow-2xl z-50 px-4 py-3 text-sm text-gray-400 text-center">
          Không tìm thấy công nhân phù hợp với từ khóa
        </div>
      )}
    </div>
  );
}

// ─── Room Tooltip (Dark Theme) ─────────────────────────────────────────────
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
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-gray-900 border border-gray-700 text-white rounded-xl shadow-2xl p-3 text-xs">
      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-800">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-white">Phòng {room}</span>
          {genderInfo && (
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border inline-flex items-center gap-0.5 ${
              genderInfo.gender === 'female'
                ? 'bg-pink-500/25 text-pink-300 border-pink-500/40'
                : genderInfo.gender === 'male'
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                : 'bg-gray-800 text-gray-400 border-gray-700'
            }`}>
              <span>{genderInfo.gender === 'female' ? '♀' : genderInfo.gender === 'male' ? '♂' : '•'}</span>
              <span>{genderInfo.label}</span>
              {genderInfo.isCustom && <span className="text-[8px] opacity-75">(Admin)</span>}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>
      {workers.length === 0 ? (
        <p className="text-gray-400 py-1">Phòng trống (0 người)</p>
      ) : (
        <ul className="space-y-1.5 max-h-44 overflow-y-auto scrollbar-thin pr-1">
          {workers.map((w, i) => {
            const isF = (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';
            return (
              <li key={i} className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isF ? 'bg-pink-400' : 'bg-blue-400'}`} />
                  <span className="truncate text-gray-200">{w.hoVaTen}</span>
                  <span className={`text-[9px] px-1 rounded font-bold ${isF ? 'text-pink-300 bg-pink-500/15' : 'text-blue-300 bg-blue-500/15'}`}>
                    {isF ? 'Nữ' : 'Nam'}
                  </span>
                </div>
                {w.maNV && <span className="text-[10px] text-gray-400 flex-shrink-0 font-tabular">#{w.maNV}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
    </div>
  );
}

// ─── Heatmap Room Cell (Ultra Compact 2-Row Design) ────────────────────────
function HeatmapRoomCell({
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
  const { bg, border, label, dot, textColor } = getRoomHeatColor(count, capacity);

  const isFemaleRoom = genderInfo.gender === 'female';
  const isMaleRoom = genderInfo.gender === 'male';
  const isMixedRoom = genderInfo.gender === 'mixed';

  // Close quick menu on click outside
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
  const fullTooltip = `P.${room} · ${count}/${capacity} (${occupancyPercent}%) · ${label}${genderInfo.isCustom ? ` (Phòng ${genderInfo.gender === 'male' ? 'Nam' : genderInfo.gender === 'female' ? 'Nữ' : ''})` : ''}${unitName ? ` · ĐV: ${unitName}` : ''}`;

  return (
    <div className="relative min-w-0 w-full overflow-visible">
      <div
        className={`border rounded-lg p-1.5 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.02] active:scale-95 flex flex-col justify-between gap-1 min-w-0 w-full overflow-hidden select-none ${bg} ${
          isFemaleRoom
            ? 'border-pink-500/60 hover:border-pink-400 ring-1 ring-pink-500/35 bg-pink-950/25'
            : isMaleRoom
            ? 'border-blue-500/50 hover:border-blue-400 ring-1 ring-blue-500/25 bg-blue-950/25'
            : isMixedRoom
            ? 'border-amber-500/40 hover:border-amber-400 ring-1 ring-amber-500/20 bg-amber-950/20'
            : border
        }`}
        onClick={() => onClickRoom(ktx, building, room)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={fullTooltip}
      >
        {/* Dòng 1: Chấm trạng thái + Tên phòng P.1 bên trái, Icon giới tính bên phải */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0 truncate">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
            <span className="text-xs font-bold text-white tracking-tight tabular-nums truncate">
              P.{room}
            </span>
          </div>

          {/* Biểu tượng giới tính CHỈ LÀ ICON/KÝ HIỆU (♂ / ♀ / ⚡ / •) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={handleGenderTagClick}
              title={`Đổi công năng: ${isFemaleRoom ? 'Phòng Nữ' : isMaleRoom ? 'Phòng Nam' : isMixedRoom ? 'Hỗn hợp' : 'Tự động'}`}
              className={`text-[10px] font-bold w-4 h-4 rounded transition-transform active:scale-90 inline-flex items-center justify-center shrink-0 leading-none ${
                isFemaleRoom
                  ? 'bg-pink-500/25 text-pink-300 border border-pink-500/50 shadow-sm shadow-pink-500/20'
                  : isMaleRoom
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                  : isMixedRoom
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-750'
              }`}
            >
              {isFemaleRoom ? '♀' : isMaleRoom ? '♂' : isMixedRoom ? '⚡' : '•'}
            </button>

            {/* Quick Admin Gender Popover */}
            {showMenu && (
              <div
                ref={menuRef}
                onClick={e => e.stopPropagation()}
                className="absolute right-0 top-full mt-1 z-50 w-36 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl p-1 space-y-1 backdrop-blur-md"
              >
                <div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-800 pb-0.5 mb-0.5">
                  Đổi công năng P.{room}
                </div>
                <button
                  type="button"
                  onClick={(e) => handleSelectGender(e, 'male')}
                  className={`w-full text-left px-2 py-1 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${
                    isMaleRoom ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-300 hover:bg-blue-500/20'
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
                    isFemaleRoom ? 'bg-pink-600 text-white shadow-sm' : 'text-pink-300 hover:bg-pink-500/20'
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
                  className="w-full text-left px-2 py-1 rounded-lg text-[11px] font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors flex items-center justify-between"
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

        {/* Dòng 2: Số lượng (20/20) bên trái, Tỷ lệ % (100%) bên phải */}
        <div className="flex items-center justify-between gap-1 min-w-0 font-tabular">
          <span className="text-[11px] font-semibold text-gray-200 tabular-nums truncate">
            {count}/{capacity}
          </span>
          <span className="text-[10px] text-gray-400 opacity-80 shrink-0 font-medium">
            {occupancyPercent}%
          </span>
        </div>
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
}

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
  const assigned = assignments.find(a => a.blockKey.toLowerCase() === blockKey.toLowerCase());
  const staffLabel = assigned ? `Phụ trách: ${assigned.staffName}` : 'Chưa gán';

  return (
    <div className="mb-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="text-sm font-bold text-white shrink-0">{building}</span>
          <span className={`text-[11px] font-medium flex items-center gap-1 min-w-0 truncate ${assigned ? 'text-blue-400' : 'text-gray-400'}`} title={staffLabel}>
            <GitBranch size={10} className="shrink-0" />
            <span className="truncate">{staffLabel}</span>
          </span>
        </div>
        <span className="text-xs text-gray-400 font-tabular font-medium shrink-0 self-end sm:self-auto">
          {buildingWorkerCount}/{totalCap} · {Math.round(occupancyPct * 100)}% đầy
        </span>
      </div>
      <div className="w-full h-1.5 sm:h-2 bg-gray-700/80 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${Math.min(occupancyPct * 100, 100)}%` }} />
      </div>
    </div>
  );
}

// ─── Main Executive Dashboard Page ─────────────────────────────────────────
export default function OccupancyDashboardPage() {
  const { workers, loading, addWorker } = useWorkers();
  const { ktxNames } = useKtxStructure();
  const router = useRouter();
  const [selectedKTX, setSelectedKTX] = useState<string>('all');
  const [drawerRoom, setDrawerRoom] = useState<{ ktx: string; building: string; room: string } | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [todayStats, setTodayStats] = useState<{ entered: number; left: number }>({ entered: 0, left: 0 });
  const [blockAssignments, setBlockAssignments] = useState<BlockAssignment[]>([]);
  const [specialists, setSpecialists] = useState<{ id: string; name: string; email?: string; role: 'admin' | 'staff'; assignedBlocks?: string[] }[]>([]);
  const [dutyRoster, setDutyRoster] = useState<SpecialistWithDuty[]>([]);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [roomUnitMap, setRoomUnitMap] = useState<Record<string, string>>({});
  const [roomGenderMap, setRoomGenderMap] = useState<Record<string, 'male' | 'female' | 'auto'>>({});

  // Load and sync room gender designations
  useEffect(() => {
    const saved = loadSavedRoomGenderMap();
    setRoomGenderMap(saved);

    fetchRoomLabelsFromSupabase().then(dbLabels => {
      if (Object.keys(dbLabels).length > 0) {
        setRoomGenderMap(prev => {
          const merged = { ...dbLabels, ...prev };
          saveRoomGenderMap(merged);
          return merged;
        });
      }
    });
  }, []);

  const isEmpty = !loading && workers.length === 0;

  // ── Unified Single Source of Truth for all operational metrics ───────────
  const systemMetrics = useMemo(() => {
    return computeSystemMetrics(workers, roomGenderMap, selectedKTX, ktxNames);
  }, [workers, roomGenderMap, selectedKTX, ktxNames]);

  // Dynamically retrieved KTX list that actually exist in the database (Supabase)
  // Guaranteed NO hardcoded, virtual, or empty KTXs (no KTX 4, KTX 5).
  // Guaranteed KTX 1, KTX 2, and KTX 3 are fully displayed.
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

  // Filtered workers by selected KTX
  const filteredWorkers = useMemo(() =>
    selectedKTX === 'all' ? workers : workers.filter(w => w.ktx === selectedKTX),
    [workers, selectedKTX]
  );

  const allBuildings = useMemo(() => getUniqueBuildings(filteredWorkers), [filteredWorkers]);

  // ── Load block assignments & specialists from profiles ───────────────────
  useEffect(() => {
    const DEFAULT_STAFF_PROFILES = [
      {
        id: 'admin-pvt-master',
        full_name: 'Quản Trị Viên Phước Vĩnh Tây',
        email: 'adminpvt@ktx.com',
        role: 'admin',
        assigned_blocks: [],
      },
      {
        id: 'staff-pvt-01',
        full_name: 'Nguyễn Văn Hùng (Bảo Vệ / Quản Lý)',
        email: 'staffpvt@ktx.com',
        role: 'staff',
        assigned_blocks: ['KTX 1 - Dãy 1', 'KTX 1 - Dãy 2', 'KTX 1 - Dãy 3'],
      },
      {
        id: 'staff-pvt-02',
        full_name: 'Trần Văn Toàn (Quản Lý Dãy)',
        email: 'toantran@ktx.com',
        role: 'staff',
        assigned_blocks: ['KTX 2 - Dãy 1', 'KTX 2 - Dãy 2'],
      },
      {
        id: 'staff-pvt-03',
        full_name: 'Lê Thị Mai (Quản Lý Dãy)',
        email: 'maile@ktx.com',
        role: 'staff',
        assigned_blocks: ['KTX 3 - Dãy 1', 'KTX 3 - Dãy 2'],
      },
    ];

    const loadStaff = async () => {
      let rawProfiles: any[] = [];
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_profiles') : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) rawProfiles = parsed;
        }
      } catch {}

      if (rawProfiles.length === 0) {
        rawProfiles = DEFAULT_STAFF_PROFILES;
      }

      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, email, role, assigned_blocks');

        if (!error && data && data.length > 0) {
          const map = new Map<string, any>();
          rawProfiles.forEach(p => { if (p.email) map.set(p.email.toLowerCase(), p); });
          data.forEach(p => { if (p.email) map.set(p.email.toLowerCase(), p); });
          rawProfiles = Array.from(map.values());
        }
      } catch {}

      const assignments: BlockAssignment[] = [];
      const list = rawProfiles.map((profile, idx) => {
        const blocks: string[] = Array.isArray(profile.assigned_blocks) ? profile.assigned_blocks : [];
        blocks.forEach(block => {
          if (block && profile.full_name) {
            assignments.push({ blockKey: block, staffName: profile.full_name });
          }
        });
        return {
          id: profile.id || `sp-${idx}`,
          name: profile.full_name || profile.name || profile.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
          email: profile.email,
          role: (profile.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff',
          assignedBlocks: blocks,
        };
      });

      setBlockAssignments(assignments);
      setSpecialists(list);
    };

    loadStaff();
    window.addEventListener('ktx_profiles_updated', loadStaff);
    return () => {
      window.removeEventListener('ktx_profiles_updated', loadStaff);
    };
  }, []);

  // ── Load room → don_vi mapping ─────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    const fetchRoomUnits = async () => {
      let allData: { ktx: string; day: string; phong_so: string; don_vi: string }[] = [];
      let from = 0;
      const SIZE = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .from('workers')
          .select('ktx, day, phong_so, don_vi')
          .not('phong_so', 'is', null)
          .not('don_vi', 'is', null)
          .range(from, from + SIZE - 1);
        if (!batch || batch.length === 0) { hasMore = false; break; }
        allData = allData.concat(batch as { ktx: string; day: string; phong_so: string; don_vi: string }[]);
        if (batch.length < SIZE) hasMore = false; else from += SIZE;
      }
      const map: Record<string, string> = {};
      allData.forEach(row => {
        if (!row.ktx || !row.day || !row.phong_so || !row.don_vi?.trim()) return;
        const key = `${row.ktx}||${row.day}||${row.phong_so}`;
        if (!map[key]) map[key] = row.don_vi.trim();
      });
      setRoomUnitMap(map);
    };
    fetchRoomUnits();
  }, [workers.length]);

  // ── KPI calculations from Single Source of Truth ─────────────────────────
  const totalCapacityAll = systemMetrics.capacity;
  const totalRoomsAll = systemMetrics.roomCount;
  const totalBuildingsAll = systemMetrics.buildingCount;
  const totalKTXAll = allKTX.length;

  const workersWithRoom = useMemo(() => workers.filter(w => w.day && w.phongSo), [workers]);
  const fillRateAll = systemMetrics.fillRate;

  const ktxOccupancy = useMemo(() => aggregateKtxOccupancy(workers), [workers]);
  const totalVacant = systemMetrics.vacantSpots;

  const filteredBuildingCount = systemMetrics.buildingCount;
  const filteredRoomCount = systemMetrics.roomCount;
  const filteredCapacity = systemMetrics.capacity;
  const filteredWithRoom = systemMetrics.workersWithRoom;
  const filteredFillRate = systemMetrics.fillRate;
  const filteredTotal = systemMetrics.selectedWorkersCount;

  const missingData = useMemo(() => filteredWorkers.filter(w => !w.day || !w.phongSo).length, [filteredWorkers]);

  // ── Operational Alerts ────────────────────────────────────────────────────
  const roomWorkerMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredWorkers.forEach(w => {
      if (w.day && w.phongSo) {
        const key = `${w.ktx}||${w.day}||${w.phongSo}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [filteredWorkers]);

  const overloadedRooms = useMemo(() => {
    let count = 0;
    roomWorkerMap.forEach(v => { if (v > ROOM_CAPACITY) count++; });
    return count;
  }, [roomWorkerMap]);

  useEffect(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let entered = 0;
    let left = 0;
    workers.forEach(w => {
      if (w.ngayVaoKTX) {
        const d = new Date(w.ngayVaoKTX);
        if (!isNaN(d.getTime())) {
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (ds === todayStr) entered++;
        }
      }
      if (w.ngayRaKTX) {
        const d = new Date(w.ngayRaKTX);
        if (!isNaN(d.getTime())) {
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (ds === todayStr) left++;
        }
      }
    });
    setTodayStats({ entered, left });
  }, [workers]);

  const ktxListForGrid = useMemo(() => {
    if (selectedKTX !== 'all') return [selectedKTX];
    return allKTX;
  }, [selectedKTX, allKTX]);

  const drawerWorkers = useMemo(() => {
    if (!drawerRoom) return [];
    return workers.filter(w =>
      w.ktx === drawerRoom.ktx &&
      w.day === drawerRoom.building &&
      w.phongSo === drawerRoom.room
    );
  }, [drawerRoom, workers]);

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

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#111827] text-[#E5E7EB] transition-colors duration-200">
        <div className="px-2.5 sm:px-6 lg:px-8 xl:px-10 py-3.5 sm:py-7 max-w-screen-2xl mx-auto space-y-4 sm:space-y-6 w-full overflow-hidden">

          {/* ── 1. Header & Long Global Search Bar on Top Right ── */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 pb-3 sm:pb-4 border-b border-gray-800 w-full">
            {/* Title Section */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 p-0.5 shadow-lg shadow-blue-500/20 shrink-0">
                <div className="w-full h-full bg-gray-900 rounded-[14px] flex items-center justify-center">
                  <Building size={20} className="text-blue-400 sm:w-[22px] sm:h-[22px]" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-2xl font-extrabold text-white tracking-tight whitespace-nowrap">
                    KÝ TÚC XÁ PHƯỚC VĨNH TÂY
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
                    <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Thời Gian Thực
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-gray-400 mt-0.5 truncate">
                  Trung tâm dữ liệu và quản trị vận hành ký túc xá
                </p>
              </div>
            </div>

            {/* Long Search Bar in Header */}
            <div className="flex-1 max-w-xl lg:mx-4">
              <GlobalSearchBar
                onSelectWorker={(id) => {
                  const w = workers.find(x => x.id === id);
                  if (w?.ktx && w?.day && w?.phongSo) {
                    setDrawerRoom({ ktx: w.ktx, building: w.day, room: w.phongSo });
                  }
                }}
              />
            </div>

            {/* Status & KTX Selection Filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800/90 text-gray-300 text-xs font-semibold border border-gray-700">
                <Wifi size={13} className="text-emerald-400 animate-pulse" />
                Supabase Connected
              </span>

              {/* KTX Selector Dropdown */}
              {!isEmpty && allKTX.length > 0 && (
                <div className="relative">
                  <select
                    value={selectedKTX}
                    onChange={e => { setSelectedKTX(e.target.value); setSelectedBuilding(null); }}
                    className="appearance-none bg-gray-800 border border-gray-700 rounded-xl pl-3.5 pr-8 py-2 text-xs font-bold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer min-w-[130px]"
                  >
                    <option value="all">Tất cả KTX</option>
                    {allKTX.map(ktx => (
                      <option key={ktx} value={ktx}>{ktx}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              )}
            </div>
          </div>

          {/* ── 2. Unified Action Buttons Bar (Gradient Blues) ── */}
          <div className="flex flex-col sm:flex-row flex-wrap items-center gap-2.5 sm:gap-3 w-full">
            <button
              onClick={() => setShowQuickAdd(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-500/20 transition-colors duration-100 active:opacity-90"
            >
              <UserPlus size={16} />
              <span>Xếp phòng nhanh</span>
              {missingData > 0 && (
                <span className="bg-white/20 text-white text-xs font-bold rounded-full px-2 py-0.5 leading-none">
                  {missingData}
                </span>
              )}
            </button>

            <button
              onClick={() => router.push('/worker-management')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-500/20 transition-colors duration-100 active:opacity-90"
            >
              <FileSpreadsheet size={16} />
              <span>Import Excel</span>
            </button>

            <button
              onClick={handleExportReport}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-emerald-500/20 transition-colors duration-100 active:opacity-90"
            >
              <Download size={16} />
              <span>Xuất Báo Cáo Ngày</span>
            </button>

            {loading && (
              <span className="text-xs text-blue-400 font-medium flex items-center gap-1.5 sm:ml-auto">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                Đang đồng bộ dữ liệu...
              </span>
            )}
          </div>

          {/* ── 3. Top 3 Unified Stats Cards (Balanced 3-Column Grid) ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            {/* Card 1: Tổng Công Nhân */}
            <ExecutiveKPICard
              label="Tổng Công Nhân"
              value={kpiWorkers.toLocaleString('vi-VN')}
              sub={selectedKTX !== 'all'
                ? `${selectedKTX} · ${kpiBuildings} dãy hiện hữu`
                : `${totalKTXAll} ký túc xá · ${kpiBuildings} dãy nhà`}
              icon={Users}
              iconBg="bg-blue-500/10"
              iconColor="text-blue-400"
              iconBorder="border-blue-500/25"
              bottomInfo={
                <div className="flex items-center justify-between text-xs text-gray-400 font-medium">
                  <span>Trạng thái hệ thống:</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1.5 font-tabular">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Đang hoạt động
                  </span>
                </div>
              }
            />

            {/* Card 2: Quy Mô Cơ Sở */}
            <ExecutiveKPICard
              label="Quy Mô Cơ Sở"
              value={`${kpiBuildings} Dãy / ${kpiRooms} Phòng`}
              sub={`Tổng sức chứa thiết kế: ${kpiCapacity.toLocaleString('vi-VN')} chỗ`}
              icon={LayoutGrid}
              iconBg="bg-indigo-500/10"
              iconColor="text-indigo-400"
              iconBorder="border-indigo-500/25"
              bottomInfo={
                <div className="flex items-center justify-between text-xs text-gray-400 font-medium">
                  <span>Định mức thiết kế:</span>
                  <span className="text-indigo-300 font-semibold font-tabular">
                    {ROOM_CAPACITY} người / phòng
                  </span>
                </div>
              }
            />

            {/* Card 3: Tỷ Lệ Lấp Đầy with Circular Progress Ring */}
            <ExecutiveKPICard
              label="Tỷ Lệ Lấp Đầy"
              value={`${kpiFillRate}%`}
              sub={`${kpiWithRoom.toLocaleString('vi-VN')}/${kpiCapacity.toLocaleString('vi-VN')} chỗ sử dụng · Trống ${kpiVacant.toLocaleString('vi-VN')} chỗ`}
              icon={Layers}
              iconBg="bg-emerald-500/10"
              iconColor="text-emerald-400"
              iconBorder="border-emerald-500/25"
              rightVisual={
                <ProgressRing progress={kpiFillRate} radius={32} stroke={5} color="#10B981" trackColor="#374151">
                  <span className="text-xs font-extrabold text-emerald-400 font-tabular">{kpiFillRate}%</span>
                </ProgressRing>
              }
              bottomInfo={
                <div className="w-full space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 font-medium">Tiến độ lấp đầy:</span>
                    <span className="text-emerald-400 font-bold font-tabular">{kpiFillRate}% công suất</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        kpiFillRate > 100 ? 'bg-rose-500' : kpiFillRate >= 90 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(kpiFillRate, 100)}%` }}
                    />
                  </div>
                </div>
              }
            />
          </div>

          {/* ── 4. Specialists Duty Card & Operational Alerts (Balanced 2-Column Row) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 w-full">
            {/* Left: Specialists Card */}
            <div className="lg:col-span-1">
              <ExecutiveSpecialistsCard
                specialists={specialists}
                onDutyRosterChange={setDutyRoster}
              />
            </div>

            {/* Right: Operational Alerts Grid + KTX Breakdown */}
            <div className="lg:col-span-2 flex flex-col justify-between gap-3.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <ExecutiveAlertCard
                  icon={XCircle}
                  label="Phòng Trống (0 người)"
                  value={`${Array.from(roomWorkerMap.values()).filter(v => v === 0).length} phòng`}
                  colorBg="bg-gray-800"
                  colorText="text-gray-400"
                  colorBorder="border-gray-700"
                  onClick={handleEmptyRoomsClick}
                />
                <ExecutiveAlertCard
                  icon={AlertTriangle}
                  label="Phòng Quá Tải (> 10)"
                  value={`${overloadedRooms} phòng`}
                  colorBg={overloadedRooms > 0 ? "bg-rose-500/10" : "bg-gray-800"}
                  colorText={overloadedRooms > 0 ? "text-rose-400" : "text-gray-500"}
                  colorBorder={overloadedRooms > 0 ? "border-rose-500/30" : "border-gray-700"}
                />
                <ExecutiveAlertCard
                  icon={TrendingUp}
                  label="Vào Hôm Nay"
                  value={`+${todayStats.entered} người`}
                  colorBg="bg-emerald-500/10"
                  colorText="text-emerald-400"
                  colorBorder="border-emerald-500/30"
                />
                <ExecutiveAlertCard
                  icon={TrendingDown}
                  label="Ra Hôm Nay"
                  value={`-${todayStats.left} người`}
                  colorBg="bg-amber-500/10"
                  colorText="text-amber-400"
                  colorBorder="border-amber-500/30"
                />
              </div>

              {/* KTX Occupancy Breakdown Quick Card */}
              <div className="rounded-2xl border border-gray-700/60 bg-[#1F2937] p-4 sm:p-5 shadow-xl flex-1 flex flex-col justify-between hover:border-blue-500/40 transition-all">
                <KtxOccupancyBreakdown
                  items={ktxOccupancy}
                  selectedKtx={selectedKTX}
                  onSelectKtx={(ktx) => { setSelectedKTX(ktx); setSelectedBuilding(null); }}
                />
              </div>
            </div>
          </div>

          {/* ── 5. Detailed Statistics: Gender & Contractors ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Gender Stats */}
            <div className="rounded-2xl border border-gray-700/60 bg-[#1F2937] p-4 sm:p-5 shadow-xl transition-all duration-200 hover:border-gray-600/80">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <VenusAndMars size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white tracking-tight">Thống Kê Giới Tính & Công Năng Phòng</h2>
                    <p className="text-xs text-gray-400">Tự động quét toàn bộ KTX · Cơ cấu nhân sự và số lượng phòng</p>
                  </div>
                </div>
                <span className="text-xs text-gray-400 font-semibold font-tabular">
                  Tổng: {(genderStats.male + genderStats.female).toLocaleString('vi-VN')}
                </span>
              </div>

              {/* Overall totals with Room counts */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl bg-blue-950/40 border border-blue-500/30 p-3.5 hover:bg-blue-900/40 transition-colors">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <p className="text-xs text-blue-300 font-semibold">Nam (Toàn hệ thống)</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      {overallRoomTotals.maleRooms} Phòng Nam
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-blue-400 font-tabular mt-1">
                    {genderStats.male.toLocaleString('vi-VN')} <span className="text-xs font-normal text-blue-300/80">người</span>
                  </p>
                </div>

                <div className="rounded-xl bg-pink-950/40 border border-pink-500/30 p-3.5 hover:bg-pink-900/40 transition-colors">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <p className="text-xs text-pink-300 font-semibold">Nữ (Toàn hệ thống)</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
                      {overallRoomTotals.femaleRooms} Phòng Nữ
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-pink-400 font-tabular mt-1">
                    {genderStats.female.toLocaleString('vi-VN')} <span className="text-xs font-normal text-pink-300/80">người</span>
                  </p>
                </div>
              </div>

              {/* Per-KTX detailed breakdown table (Dynamically scans all active KTXs from Supabase) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Chi tiết theo từng khu vực KTX
                  </p>
                  <span className="text-[11px] text-gray-500 font-medium font-tabular">
                    {allKTX.length} KTX · {overallRoomTotals.totalRooms} phòng
                  </span>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
                  {ktxGenderRoomStats.map(stat => (
                    <div
                      key={stat.ktx}
                      className="rounded-xl border border-gray-700/60 bg-gray-800/70 p-3 hover:bg-gray-750 hover:border-blue-500/40 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        {/* KTX Name and personnel count */}
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                            stat.ktx === 'KTX 1' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                            stat.ktx === 'KTX 2' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                            stat.ktx === 'KTX 3' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                            'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                          }`}>
                            {stat.ktx}
                          </span>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-blue-300 font-medium">
                              Nam: <strong className="font-tabular text-blue-400">{stat.male}</strong>
                            </span>
                            <span className="text-gray-500">·</span>
                            <span className="text-pink-300 font-medium">
                              Nữ: <strong className="font-tabular text-pink-400">{stat.female}</strong>
                            </span>
                            <span className="text-gray-500 font-tabular">({stat.male + stat.female} người)</span>
                          </div>
                        </div>

                        {/* Room breakdown badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/30 font-tabular">
                            <span>♂ {stat.maleRooms} P.Nam</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-pink-500/15 text-pink-300 border border-pink-500/30 font-tabular">
                            <span>♀ {stat.femaleRooms} P.Nữ</span>
                          </span>
                          {stat.mixedRooms > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 font-tabular">
                              <span>{stat.mixedRooms} Hỗn hợp</span>
                            </span>
                          )}
                          <span className="text-[10px] text-gray-500 font-tabular">
                            ({stat.totalRooms} phòng)
                          </span>
                        </div>
                      </div>

                      {/* Visual mini ratio bar for male rooms vs female rooms */}
                      <div className="w-full h-1.5 bg-gray-700/80 rounded-full overflow-hidden flex mt-2">
                        {stat.totalRooms > 0 ? (
                          <>
                            <div
                              className="h-full bg-blue-500 transition-all duration-300"
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
                                className="h-full bg-amber-500 transition-all duration-300"
                                style={{ width: `${(stat.mixedRooms / stat.totalRooms) * 100}%` }}
                                title={`Hỗn hợp: ${stat.mixedRooms}/${stat.totalRooms}`}
                              />
                            )}
                          </>
                        ) : (
                          <div className="h-full w-full bg-gray-650/40 text-center" title="Chưa có dữ liệu phòng" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Contractor/Unit Stats */}
            <div className="rounded-2xl border border-gray-700/60 bg-[#1F2937] p-5 shadow-xl transition-all duration-200 hover:border-gray-600/80">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <HardHat size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white tracking-tight">Đơn Vị & Nhà Thầu</h2>
                    <p className="text-xs text-gray-400">Phân bố quân số theo nhà thầu thi công</p>
                  </div>
                </div>
                <span className="text-xs text-gray-400 font-semibold font-tabular">
                  Top 6 đơn vị
                </span>
              </div>

              {/* Overall totals grid */}
              <div className="mb-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Tổng quân số lớn nhất</p>
                <div className="grid grid-cols-2 gap-2">
                  {contractorStats.length > 0 ? contractorStats.map(([name, count]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-xl bg-gray-800/80 border border-gray-700/60 px-3.5 py-2.5 hover:bg-gray-700/70 hover:border-amber-500/40 transition-all duration-150"
                    >
                      <span className="text-xs font-semibold text-gray-200 truncate mr-2">{name}</span>
                      <span className="text-sm font-bold text-amber-400 font-tabular">{count}</span>
                    </div>
                  )) : (
                    <p className="text-xs text-gray-500 col-span-2 py-3 text-center">Chưa có dữ liệu đơn vị</p>
                  )}
                </div>
              </div>

              {/* Per-KTX breakdown */}
              {Object.keys(contractorByKtx).sort().length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Phân theo từng KTX</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {Object.keys(contractorByKtx).sort().map(ktxKey => (
                      <div
                        key={ktxKey}
                        className="rounded-xl border border-gray-700/50 bg-gray-800/60 px-3.5 py-2.5 hover:bg-gray-700/60 hover:border-blue-500/40 transition-all duration-150"
                      >
                        <p className="text-xs font-bold text-white mb-1.5">{ktxKey}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {contractorByKtx[ktxKey].map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between rounded-lg bg-gray-900/60 px-2.5 py-1">
                              <span className="text-xs text-gray-300 truncate mr-1">{name}</span>
                              <span className="text-xs font-bold text-amber-400 font-tabular">{count}</span>
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

          {/* ── 6. Heatmap Room Grid ── */}
          <div className="bg-[#1F2937] rounded-2xl border border-gray-700/60 shadow-xl p-5 sm:p-6 transition-all duration-200 hover:border-gray-600/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <LayoutGrid size={20} />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">Sơ Đồ Phòng Trực Quan (Heatmap)</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selectedKTX !== 'all' ? selectedKTX : 'Toàn bộ Ký Túc Xá'} · Nhấp hoặc rê chuột vào ô phòng để xem danh sách
                  </p>
                </div>
              </div>

              {!isEmpty && allBuildings.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setSelectedBuilding(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      selectedBuilding === null
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                        : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-750'
                    }`}
                  >
                    Tất cả dãy
                  </button>
                  {allBuildings.map(b => (
                    <button
                      key={b}
                      onClick={() => setSelectedBuilding(b)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                        selectedBuilding === b
                          ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                          : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-750'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Heatmap Legend: Room Gender Function & Occupancy */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-700/60">
              {/* Legend 1: Room Gender Function */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Công năng:</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/35">
                  <span>♂ Phòng Nam</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-pink-500/20 text-pink-300 border border-pink-500/40">
                  <span>♀ Phòng Nữ</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/35">
                  <span>⚡ Hỗn hợp</span>
                </span>
                <span className="text-[11px] text-gray-400 italic hidden sm:inline ml-1">
                  (Nhấp vào nhãn trên ô phòng để đổi nhanh)
                </span>
              </div>

              {/* Legend 2: Occupancy Status */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Công suất:</span>
                {[
                  { label: 'Còn trống', dot: 'bg-emerald-400', badge: 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300' },
                  { label: 'Đầy 100%', dot: 'bg-amber-400', badge: 'bg-amber-950/50 border-amber-500/40 text-amber-300' },
                  { label: 'Quá tải (>10)', dot: 'bg-rose-400', badge: 'bg-rose-950/50 border-rose-500/40 text-rose-300' },
                  { label: 'Trống (0)', dot: 'bg-gray-400', badge: 'bg-gray-800 border-gray-700 text-gray-400' },
                ].map(leg => (
                  <div key={leg.label} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] font-medium ${leg.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${leg.dot}`} />
                    <span>{leg.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {isEmpty && (
              <div className="rounded-2xl border-2 border-dashed border-gray-700 bg-gray-800/30 p-10 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <FileSpreadsheet size={28} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">Chưa có dữ liệu phòng KTX</h3>
                  <p className="text-sm text-gray-400 max-w-md">
                    Vui lòng bấm <span className="font-semibold text-blue-400">&quot;Import Excel&quot;</span> để tải danh sách công nhân vào hệ thống.
                  </p>
                </div>
                <button
                  onClick={() => router.push('/worker-management')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-500/25"
                >
                  <FileSpreadsheet size={16} />
                  Đến trang Quản Lý Công Nhân
                </button>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-gray-400">Đang đồng bộ dữ liệu phòng từ Supabase...</p>
                </div>
              </div>
            )}

            {/* Heatmap Grid */}
            {!isEmpty && !loading && ktxListForGrid.length > 0 && (
              <div className="space-y-6">
                {ktxListForGrid.map(ktx => {
                  const ktxWorkers = workers.filter(w => w.ktx === ktx);
                  const ktxBuildings = getUniqueBuildings(ktxWorkers).filter(b => !selectedBuilding || b === selectedBuilding);
                  if (ktxBuildings.length === 0) {
                    if (selectedKTX === ktx) {
                      return (
                        <div key={ktx} className="p-8 rounded-xl bg-gray-850/50 border border-gray-800/80 text-center space-y-3">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-xs font-bold px-3 py-1 rounded-lg border bg-blue-500/20 text-blue-300 border-blue-500/30">
                              {ktx}
                            </span>
                            <span className="text-xs text-gray-400 font-medium">0 công nhân · 0 dãy phòng</span>
                          </div>
                          <p className="text-sm text-gray-400 max-w-md mx-auto">
                            Khu vực {ktx} hiện đang sẵn sàng tiếp nhận nhân sự và chưa có dữ liệu lưu trú. Bạn có thể sử dụng tính năng &quot;Xếp phòng nhanh&quot; hoặc &quot;Import Excel&quot; để bổ sung công nhân vào {ktx}.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }
                  return (
                    <div key={ktx} className="p-3.5 sm:p-4 rounded-xl bg-gray-850/50 border border-gray-800/80 overflow-x-auto w-full scrollbar-thin">
                      {/* KTX Title + Dynamic Daily Duty Personnel Info */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5 pb-2.5 border-b border-gray-800">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className={`text-xs font-bold px-3 py-1 rounded-lg border ${
                            ktx === 'KTX 1'
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                              : ktx === 'KTX 2'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : ktx === 'KTX 3'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                          }`}>
                            {ktx}
                          </span>
                          <span className="text-xs text-gray-400 font-medium font-tabular">
                            {ktxWorkers.length} công nhân · {ktxBuildings.length} dãy
                          </span>
                        </div>

                        {/* Dynamic Specialists on Duty at this KTX today */}
                        {(() => {
                          const ktxOnDuty = dutyRoster.filter(s => s.status === 'on_duty' && s.dutyKtx === ktx);
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-semibold text-gray-400 flex items-center gap-1">
                                <UserCheck size={13} className="text-emerald-400" />
                                <span>Trực ban hôm nay ({ktx}):</span>
                              </span>
                              {ktxOnDuty.length > 0 ? (
                                ktxOnDuty.map(s => (
                                  <span
                                    key={s.id}
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <span>{s.name}</span>
                                    {s.role === 'admin' && (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
                                        Admin
                                      </span>
                                    )}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] text-gray-500 italic bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/60">
                                  Chưa phân công ca trực hôm nay
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 min-w-0 w-full items-start">
                        {ktxBuildings.map(building => {
                          const buildingWorkers = ktxWorkers.filter(w => w.day === building);
                          const rooms = getUniqueRooms(ktxWorkers, building);
                          const totalCap = rooms.length * ROOM_CAPACITY;
                          const occupancyPct = totalCap > 0 ? buildingWorkers.length / totalCap : 0;
                          const barColor = occupancyPct > 1 ? 'bg-rose-500' : occupancyPct >= 1 ? 'bg-amber-400' : occupancyPct >= 0.5 ? 'bg-emerald-400' : 'bg-blue-400';
                          return (
                            <div key={building} className="rounded-2xl bg-gray-900/60 border border-gray-800/90 p-3 sm:p-4 flex flex-col justify-start shadow-md hover:border-gray-700/80 transition-all h-auto self-start">
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
                                {rooms.map(room => {
                                  const roomWorkers = buildingWorkers.filter(w => w.phongSo === room);
                                  const roomKey = `${ktx}||${building}||${room}`;
                                  const unitName = roomUnitMap[roomKey];
                                  const adminGender = roomGenderMap[roomKey];
                                  const gInfo = getRoomGenderInfo(
                                    roomWorkers,
                                    adminGender === 'male' ? 'Nam' : adminGender === 'female' ? 'Nữ' : null
                                  );
                                  return (
                                    <HeatmapRoomCell
                                      key={`${ktx}-${building}-${room}`}
                                      room={room}
                                      count={roomWorkers.length}
                                      capacity={ROOM_CAPACITY}
                                      ktx={ktx}
                                      building={building}
                                      workers={roomWorkers.map(w => ({ hoVaTen: w.hoVaTen, maNV: w.maNV, gioiTinh: w.gioiTinh }))}
                                      onClickRoom={handleRoomClick}
                                      unitName={unitName}
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

          {/* ── 7. Charts + Recent Entries Feed ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <DashboardCharts />
            </div>
            <div className="xl:col-span-1">
              <RecentEntriesFeed />
            </div>
          </div>

        </div>

        {/* Room Drawer Modal */}
        {drawerRoom && (
          <RoomDrawer
            ktx={drawerRoom.ktx}
            building={drawerRoom.building}
            room={drawerRoom.room}
            workers={drawerWorkers}
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
      </div>
    </AppLayout>
  );
}
