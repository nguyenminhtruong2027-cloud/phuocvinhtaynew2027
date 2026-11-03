'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Users, LayoutGrid, Percent, AlertCircle, VenusAndMars, HardHat,
  Building2, TrendingUp, TrendingDown, UserPlus, UserMinus, ArrowRightLeft,
  Calendar, Clock, RefreshCw, Filter, X, Building, BarChart2, CheckCircle2
} from 'lucide-react';
import { useWorkers } from '@/context/WorkerContext';
import { Worker, DEFAULT_ROOM_CAPACITY, getUniqueBuildings, getUniqueRooms, countUniqueBuildings } from '@/data/workers';
import { getActiveKtxList } from '@/lib/systemMetrics';
import { createClient } from '@/lib/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────
type GenderFilter = 'all' | 'male' | 'female';
type UnitFilter = 'all' | 'xd' | 'me' | 'vinalpha' | 'other';
type KtxFilter = string;
type ActiveTab = 'tong-quan' | 'bien-dong';
type FluctuationType = 'all' | 'tang' | 'giam' | 'rong';
type CutoffMode = 'realtime' | '14h';

interface FilterState {
  gender: GenderFilter;
  unit: UnitFilter;
  ktx: KtxFilter;
  building: string;
  room: string;
}

interface FluctuationFilter {
  dateFrom: string;
  dateTo: string;
  ktx: string;
  day: string;
  type: FluctuationType;
  cutoffMode: CutoffMode;
}

interface DailyFluctuation {
  ngay: string;
  so_tang: number;
  so_giam: number;
  bien_dong_rong: number;
}

interface FluctuationSummary {
  tong_tang: number;
  tong_giam: number;
  bien_dong_rong: number;
  so_ngay_co_bien_dong: number;
}

const DEFAULT_FILTERS: FilterState = {
  gender: 'all', unit: 'all', ktx: 'all', building: '', room: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function matchesGender(w: Worker, g: GenderFilter): boolean {
  if (g === 'all') return true;
  const gt = (w.gioiTinh || '').toLowerCase();
  if (g === 'male') return gt.includes('nam');
  if (g === 'female') return gt.includes('nữ') || gt.includes('nu');
  return true;
}

function matchesUnit(w: Worker, u: UnitFilter): boolean {
  if (u === 'all') return true;
  const dv = (w.donVi || '').toLowerCase();
  if (u === 'xd') return dv.includes('xd') || dv.includes('xây') || dv.includes('xay');
  if (u === 'me') return dv.includes('me') || dv.includes('cơ') || dv.includes('co');
  if (u === 'vinalpha') return dv.includes('vinalpha') || dv.includes('alpha');
  if (u === 'other') {
    return !dv.includes('xd') && !dv.includes('xây') && !dv.includes('xay') &&
      !dv.includes('me') && !dv.includes('cơ') && !dv.includes('co') &&
      !dv.includes('vinalpha') && !dv.includes('alpha');
  }
  return true;
}

function matchesKtx(w: Worker, k: string): boolean {
  if (k === 'all' || !k) return true;
  return (w.ktx ?? '').trim() === k.trim();
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

function formatDateVN(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ─── Custom Dark Tooltip ──────────────────────────────────────────────────────
function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-act/95 backdrop-blur-md border border-bdr rounded-xl shadow-xl p-3 text-xs">
      <p className="font-bold text-tx mb-2 pb-1 border-b border-bdr">{formatDateVN(label)}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.fill || p.stroke }} />
            <span className="text-mu">{p.name}:</span>
          </div>
          <span className="font-bold font-tabular" style={{ color: p.fill || p.stroke }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReportDashboard() {
  const { workers, loading: workersLoading } = useWorkers();
  const [activeTab, setActiveTab] = useState<ActiveTab>('tong-quan');

  // ── Tổng quan filters ──
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const set = (key: keyof FilterState, val: string) =>
    setFilters(prev => ({ ...prev, [key]: val }));

  // ── Biến động filters ──
  const defaultRange = getDefaultDateRange();
  const [flFilter, setFlFilter] = useState<FluctuationFilter>({
    dateFrom: defaultRange.from,
    dateTo: defaultRange.to,
    ktx: '',
    day: '',
    type: 'all',
    cutoffMode: '14h',
  });

  // ── Biến động data ──
  const [dailyData, setDailyData] = useState<DailyFluctuation[]>([]);
  const [summary, setSummary] = useState<FluctuationSummary | null>(null);
  const [flLoading, setFlLoading] = useState(false);
  const [flError, setFlError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string>('');

  // ── Unique buildings from workers for filter ──
  const activeKtxList = useMemo(() => getActiveKtxList(workers), [workers]);
  const allBuildings = useMemo(() => getUniqueBuildings(workers), [workers]);
  const flBuildings = useMemo(() => {
    if (!flFilter.ktx) return allBuildings;
    return getUniqueBuildings(workers.filter(w => (w.ktx ?? '').trim() === flFilter.ktx.trim()));
  }, [workers, flFilter.ktx, allBuildings]);

  // ── Fetch fluctuation data ──
  const fetchFluctuation = useCallback(async () => {
    setFlLoading(true);
    setFlError(null);
    const supabase = createClient();
    const cutoffHour = flFilter.cutoffMode === 'realtime' ? -1 : 14;

    try {
      const [dailyRes, summaryRes] = await Promise.all([
        supabase.rpc('get_worker_fluctuation', {
          p_date_from: flFilter.dateFrom || null,
          p_date_to: flFilter.dateTo || null,
          p_ktx: flFilter.ktx || null,
          p_day: flFilter.day || null,
          p_cutoff_hour: cutoffHour,
        }),
        supabase.rpc('get_worker_fluctuation_summary', {
          p_date_from: flFilter.dateFrom || null,
          p_date_to: flFilter.dateTo || null,
          p_ktx: flFilter.ktx || null,
          p_day: flFilter.day || null,
          p_cutoff_hour: cutoffHour,
        }),
      ]);

      if (dailyRes.error) throw new Error(dailyRes.error.message);
      if (summaryRes.error) throw new Error(summaryRes.error.message);

      const rawDaily: DailyFluctuation[] = (dailyRes.data || []).map((r: any) => ({
        ngay: r.ngay,
        so_tang: Number(r.so_tang) || 0,
        so_giam: Number(r.so_giam) || 0,
        bien_dong_rong: Number(r.bien_dong_rong) || 0,
      }));

      setDailyData(rawDaily);

      const s = summaryRes.data?.[0];
      setSummary(s ? {
        tong_tang: Number(s.tong_tang) || 0,
        tong_giam: Number(s.tong_giam) || 0,
        bien_dong_rong: Number(s.bien_dong_rong) || 0,
        so_ngay_co_bien_dong: Number(s.so_ngay_co_bien_dong) || 0,
      } : { tong_tang: 0, tong_giam: 0, bien_dong_rong: 0, so_ngay_co_bien_dong: 0 });

      const now = new Date();
      setLastFetched(now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
    } catch (err: any) {
      setFlError(err.message || 'Lỗi tải dữ liệu biến động');
    } finally {
      setFlLoading(false);
    }
  }, [flFilter]);

  useEffect(() => {
    if (activeTab === 'bien-dong') {
      fetchFluctuation();
    }
  }, [activeTab, fetchFluctuation]);

  // ── Filtered chart data by type ──
  const chartData = useMemo(() => {
    return dailyData.map(d => ({
      date: formatDateVN(d.ngay),
      rawDate: d.ngay,
      'Tăng thực tế': d.so_tang,
      'Giảm thực tế': d.so_giam,
      'Biến động ròng': d.bien_dong_rong,
    }));
  }, [dailyData]);

  const filteredDailyData = useMemo(() => {
    if (flFilter.type === 'all') return dailyData;
    if (flFilter.type === 'tang') return dailyData.filter(d => d.so_tang > 0);
    if (flFilter.type === 'giam') return dailyData.filter(d => d.so_giam > 0);
    if (flFilter.type === 'rong') return dailyData.filter(d => d.bien_dong_rong !== 0);
    return dailyData;
  }, [dailyData, flFilter.type]);

  // ── Tổng quan computed ──
  const filtered = useMemo(() => {
    return workers.filter(w => {
      if (!matchesGender(w, filters.gender)) return false;
      if (!matchesUnit(w, filters.unit)) return false;
      if (!matchesKtx(w, filters.ktx)) return false;
      if (filters.building && w.day !== filters.building) return false;
      if (filters.room && w.phongSo !== filters.room) return false;
      return true;
    });
  }, [workers, filters]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const male = filtered.filter(w => (w.gioiTinh || '').toLowerCase().includes('nam')).length;
    const female = filtered.filter(w => {
      const g = (w.gioiTinh || '').toLowerCase();
      return g.includes('nữ') || g.includes('nu');
    }).length;
    const xd = filtered.filter(w => { const dv = (w.donVi || '').toLowerCase(); return dv.includes('xd') || dv.includes('xây') || dv.includes('xay'); }).length;
    const me = filtered.filter(w => { const dv = (w.donVi || '').toLowerCase(); return dv.includes('me') || dv.includes('cơ') || dv.includes('co'); }).length;
    const vinalpha = filtered.filter(w => { const dv = (w.donVi || '').toLowerCase(); return dv.includes('vinalpha') || dv.includes('alpha'); }).length;
    const otherUnit = Math.max(0, total - xd - me - vinalpha);

    const buildingCount = countUniqueBuildings(filtered);
    const roomSet = new Set(filtered.map(w => `${w.ktx}||${w.day}||${w.phongSo}`).filter(k => !k.startsWith('||')));
    const roomCount = roomSet.size;
    const capacity = roomCount * DEFAULT_ROOM_CAPACITY;
    const workersWithRoom = filtered.filter(w => w.day && w.phongSo).length;
    const fillRate = capacity > 0 ? Math.round((workersWithRoom / capacity) * 100) : 0;
    const missingData = filtered.filter(w => !w.day || !w.phongSo).length;

    return {
      total, male, female, xd, me, vinalpha, otherUnit,
      buildingCount, roomCount, capacity, fillRate, workersWithRoom, missingData
    };
  }, [filtered]);

  const ktxBreakdownCounts = useMemo(() => {
    const map: Record<string, { total: number; male: number; female: number; rooms: number; capacity: number; fillRate: number }> = {};
    const roomsMap: Record<string, Set<string>> = {};

    activeKtxList.forEach(k => {
      map[k] = { total: 0, male: 0, female: 0, rooms: 0, capacity: 0, fillRate: 0 };
      roomsMap[k] = new Set();
    });

    filtered.forEach(w => {
      const k = (w.ktx ?? '').trim();
      if (k && map[k]) {
        map[k].total++;
        const g = (w.gioiTinh || '').toLowerCase();
        if (g.includes('nam')) map[k].male++;
        else if (g.includes('nữ') || g.includes('nu')) map[k].female++;

        if (w.day && w.phongSo) {
          roomsMap[k]?.add(`${w.day}||${w.phongSo}`);
        }
      }
    });

    activeKtxList.forEach(k => {
      const rooms = roomsMap[k]?.size || 0;
      const capacity = rooms * DEFAULT_ROOM_CAPACITY;
      map[k].rooms = rooms;
      map[k].capacity = capacity;
      map[k].fillRate = capacity > 0 ? Math.round((map[k].total / capacity) * 100) : 0;
    });

    return map;
  }, [filtered, activeKtxList]);

  const buildingList = useMemo(() => {
    const list = filters.ktx === 'all' ? workers : workers.filter(w => (w.ktx ?? '').trim() === filters.ktx.trim());
    return getUniqueBuildings(list);
  }, [workers, filters.ktx]);

  const roomList = useMemo(() => {
    const list = filters.ktx === 'all' ? workers : workers.filter(w => (w.ktx ?? '').trim() === filters.ktx.trim());
    return getUniqueRooms(list, filters.building || undefined);
  }, [workers, filters.ktx, filters.building]);

  const hasActiveFilter =
    filters.gender !== 'all' || filters.unit !== 'all' || filters.ktx !== 'all' ||
    filters.building !== '' || filters.room !== '';

  const hasFlFilter = flFilter.ktx || flFilter.day || flFilter.type !== 'all';

  if (workersLoading) {
    return (
      <div className="min-h-screen bg-page text-mu p-12 flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 border-2 border-ok2 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium animate-pulse">Đang đồng bộ dữ liệu biến động từ Supabase...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page text-tx">
      <div className="px-3 sm:px-6 lg:px-8 xl:px-10 py-5 sm:py-7 max-w-screen-2xl mx-auto space-y-6">

        {/* ── Global Header with Unified Subtitle ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-bdr">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 p-0.5 shadow-lg shadow-emerald-500/20 flex-shrink-0">
              <div className="w-full h-full bg-act rounded-[14px] flex items-center justify-center">
                <BarChart2 size={22} className="text-ok" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">
                  KÝ TÚC XÁ PHƯỚC VĨNH TÂY
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-okbg text-ok border border-bdr2">
                  <span className="w-2 h-2 rounded-full bg-ok2 animate-pulse" />
                  Báo Cáo Biến Động
                </span>
              </div>
              <p className="text-xs sm:text-sm text-mu mt-0.5">
                Trung tâm dữ liệu và quản trị vận hành ký túc xá
              </p>
            </div>
          </div>

          {/* Quick Refresh Status */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (activeTab === 'bien-dong') fetchFluctuation();
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-act border border-bdr hover:bg-gray-700 text-xs font-semibold text-tx transition-colors"
            >
              <RefreshCw size={13} className={flLoading ? 'animate-spin text-ok' : 'text-mu'} />
              <span>Làm mới số liệu</span>
            </button>
          </div>
        </div>

        {/* ── Sub-Navigation Tabs ── */}
        <div className="flex items-center gap-2 p-1.5 bg-act rounded-2xl border border-bdr w-fit">
          <button
            onClick={() => setActiveTab('tong-quan')}
            className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all ${
              activeTab === 'tong-quan'
                ? 'bg-pri text-white shadow-md'
                : 'text-mu hover:text-tx hover:bg-act'
            }`}
          >
            <span>📊 Tổng quan đa chiều</span>
          </button>
          <button
            onClick={() => setActiveTab('bien-dong')}
            className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all ${
              activeTab === 'bien-dong'
                ? 'bg-pri text-white shadow-md'
                : 'text-mu hover:text-tx hover:bg-act'
            }`}
          >
            <span>🔄 Biến động vào / ra</span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: TỔNG QUAN                                                      */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'tong-quan' && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="bg-surf rounded-2xl border border-bdr/60 p-4 sm:p-5 shadow-xl">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1 min-w-[130px] flex-1 sm:flex-initial">
                  <label className="text-xs font-bold text-mu uppercase tracking-wider">Giới tính</label>
                  <select
                    value={filters.gender}
                    onChange={e => set('gender', e.target.value)}
                    className="w-full bg-act border border-bdr rounded-xl px-3 py-2 text-xs font-semibold text-tx focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="all">Tất cả</option>
                    <option value="male">Nam</option>
                    <option value="female">Nữ</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[130px] flex-1 sm:flex-initial">
                  <label className="text-xs font-bold text-mu uppercase tracking-wider">Đơn vị / Nhà thầu</label>
                  <select
                    value={filters.unit}
                    onChange={e => set('unit', e.target.value)}
                    className="w-full bg-act border border-bdr rounded-xl px-3 py-2 text-xs font-semibold text-tx focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="all">Tất cả</option>
                    <option value="xd">XD</option>
                    <option value="me">ME</option>
                    <option value="vinalpha">Vinalpha</option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[130px] flex-1 sm:flex-initial">
                  <label className="text-xs font-bold text-mu uppercase tracking-wider">KTX</label>
                  <select
                    value={filters.ktx}
                    onChange={e => { setFilters(prev => ({ ...prev, ktx: e.target.value as KtxFilter, building: '', room: '' })); }}
                    className="w-full bg-act border border-bdr rounded-xl px-3 py-2 text-xs font-semibold text-tx focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="all">Tất cả KTX</option>
                    {activeKtxList.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[130px] flex-1 sm:flex-initial">
                  <label className="text-xs font-bold text-mu uppercase tracking-wider">Dãy nhà</label>
                  <select
                    value={filters.building}
                    onChange={e => { setFilters(prev => ({ ...prev, building: e.target.value, room: '' })); }}
                    className="w-full bg-act border border-bdr rounded-xl px-3 py-2 text-xs font-semibold text-tx focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="">Tất cả dãy</option>
                    {buildingList.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[110px] flex-1 sm:flex-initial">
                  <label className="text-xs font-bold text-mu uppercase tracking-wider">Phòng</label>
                  <select
                    value={filters.room}
                    onChange={e => set('room', e.target.value)}
                    className="w-full bg-act border border-bdr rounded-xl px-3 py-2 text-xs font-semibold text-tx focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="">Tất cả phòng</option>
                    {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
                  </select>
                </div>

                {hasActiveFilter && (
                  <button
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-act text-mu hover:text-tx hover:bg-act text-xs font-semibold border border-bdr transition-all"
                  >
                    <X size={14} /> Xóa bộ lọc
                  </button>
                )}
              </div>
            </div>

            {/* KPI Cards — 4 in a row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">CÔNG NHÂN</p>
                  <h3 className="text-3xl font-extrabold text-tx font-tabular mt-1">{stats.total.toLocaleString('vi-VN')}</h3>
                  <p className="text-xs text-mu mt-1">{stats.buildingCount} dãy hiện hữu</p>
                </div>
                <div className="w-13 h-13 rounded-2xl bg-bdg border border-pri2/20 text-lnk flex items-center justify-center p-3">
                  <Users className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">SỐ DÃY / PHÒNG</p>
                  <h3 className="text-3xl font-extrabold text-tx font-tabular mt-1">{stats.buildingCount} / {stats.roomCount}</h3>
                  <p className="text-xs text-mu mt-1">Sức chứa: {stats.capacity} chỗ</p>
                </div>
                <div className="w-13 h-13 rounded-2xl bg-bdg border border-bdr2 text-lnk flex items-center justify-center p-3">
                  <LayoutGrid className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">TỶ LỆ LẤP ĐẦY</p>
                  <h3 className="text-3xl font-extrabold text-ok font-tabular mt-1">{stats.fillRate}%</h3>
                  <p className="text-xs text-mu mt-1">{stats.workersWithRoom}/{stats.capacity} chỗ đã dùng</p>
                </div>
                <div className="w-13 h-13 rounded-2xl bg-okbg border border-bdr2 text-ok flex items-center justify-center p-3">
                  <Percent className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">THIẾU PHÒNG</p>
                  <h3 className="text-3xl font-extrabold text-dgr font-tabular mt-1">{stats.missingData}</h3>
                  <p className="text-xs text-mu mt-1">Chưa phân phòng / dãy</p>
                </div>
                <div className="w-13 h-13 rounded-2xl tint-dgr border border-dgr text-dgr flex items-center justify-center p-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Detail Stats: Giới tính & Nhà thầu & Khu KTX */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl">
                <h4 className="font-bold text-tx mb-4 flex items-center gap-2 text-sm">
                  <VenusAndMars size={18} className="text-lnk" /> Thống kê giới tính
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-950/40 border border-bdr2 p-4 rounded-xl">
                    <span className="text-xs font-bold text-lnk block mb-1">Nam</span>
                    <span className="text-2xl font-extrabold text-lnk font-tabular">{stats.male}</span>
                  </div>
                  <div className="bg-pink-950/40 border border-pink-500/30 p-4 rounded-xl">
                    <span className="text-xs font-bold text-pink-300 block mb-1">Nữ</span>
                    <span className="text-2xl font-extrabold text-pink-400 font-tabular">{stats.female}</span>
                  </div>
                </div>
              </div>

              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl">
                <h4 className="font-bold text-tx mb-4 flex items-center gap-2 text-sm">
                  <HardHat size={18} className="text-wn" /> Đơn vị / Nhà thầu
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-act/80 border border-bdr px-3 py-2 rounded-xl flex justify-between items-center">
                    <span className="text-xs font-semibold text-mu">XD</span>
                    <span className="text-base font-bold text-wn font-tabular">{stats.xd}</span>
                  </div>
                  <div className="bg-act/80 border border-bdr px-3 py-2 rounded-xl flex justify-between items-center">
                    <span className="text-xs font-semibold text-mu">ME</span>
                    <span className="text-base font-bold text-wn font-tabular">{stats.me}</span>
                  </div>
                  <div className="bg-act/80 border border-bdr px-3 py-2 rounded-xl flex justify-between items-center">
                    <span className="text-xs font-semibold text-mu">Vinalpha</span>
                    <span className="text-base font-bold text-wn font-tabular">{stats.vinalpha}</span>
                  </div>
                  <div className="bg-act/80 border border-bdr px-3 py-2 rounded-xl flex justify-between items-center">
                    <span className="text-xs font-semibold text-mu">Khác</span>
                    <span className="text-base font-bold text-wn font-tabular">{stats.otherUnit}</span>
                  </div>
                </div>
              </div>

              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-tx flex items-center gap-2 text-sm">
                    <Building2 size={18} className="text-ok" /> Phân bổ theo Khu KTX
                  </h4>
                  <span className="text-xs text-mu font-medium font-tabular">
                    {activeKtxList.length} khu KTX hoạt động
                  </span>
                </div>
                <div className={`grid gap-3 ${activeKtxList.length >= 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                  {activeKtxList.map(ktx => {
                    const data = ktxBreakdownCounts[ktx] || { total: 0, male: 0, female: 0, rooms: 0, fillRate: 0 };
                    const isSelected = filters.ktx === ktx;
                    const colorClasses =
                      ktx === 'KTX 1'
                        ? { bg: 'bg-blue-950/40 border-bdr2', title: 'text-lnk', num: 'text-lnk' }
                        : ktx === 'KTX 2'
                        ? { bg: 'tint-wn border-wn', title: 'text-wn', num: 'text-wn' }
                        : ktx === 'KTX 3'
                        ? { bg: 'bg-okbg border-bdr2', title: 'text-ok', num: 'text-ok' }
                        : { bg: 'bg-act border-bdr2', title: 'text-lnk', num: 'text-lnk' };

                    return (
                      <div
                        key={ktx}
                        onClick={() => set('ktx', isSelected ? 'all' : ktx)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer hover:scale-[1.02] ${colorClasses.bg} ${
                          isSelected ? 'ring-2 ring-emerald-500 shadow-lg' : ''
                        }`}
                        title={`Bấm để lọc theo ${ktx}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-bold ${colorClasses.title}`}>{ktx}</span>
                          <span className="text-[10px] font-semibold text-mu font-tabular">
                            {data.rooms} phòng · {data.fillRate}%
                          </span>
                        </div>
                        <span className={`text-2xl font-extrabold ${colorClasses.num} font-tabular`}>
                          {data.total.toLocaleString('vi-VN')}
                        </span>
                        <div className="flex items-center justify-between text-[11px] text-mu mt-1.5 pt-1.5 border-t border-bdr/50">
                          <span className="text-lnk font-medium">Nam: <strong className="text-tx font-tabular">{data.male}</strong></span>
                          <span className="text-pink-300 font-medium">Nữ: <strong className="text-tx font-tabular">{data.female}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: BIẾN ĐỘNG VÀO / RA                                             */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'bien-dong' && (
          <div className="space-y-6">

            {/* ── Compact & Spacious Filter Bar (Green/Orange Highlights) ── */}
            <div className="bg-surf rounded-2xl border border-bdr/60 shadow-xl p-5">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-bdr/60">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg tint-wn border border-wn flex items-center justify-center text-wn">
                    <Filter size={16} />
                  </div>
                  <span className="text-sm font-bold text-tx">Bộ lọc phân tích biến động quân số</span>
                </div>
                {hasFlFilter && (
                  <button
                    onClick={() => setFlFilter(prev => ({ ...prev, ktx: '', day: '', type: 'all' }))}
                    className="flex items-center gap-1 text-xs text-mu hover:text-tx px-2.5 py-1 rounded-lg bg-act border border-bdr transition-colors"
                  >
                    <X size={12} /> Đặt lại lọc
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
                {/* Date From */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Từ ngày</label>
                  <input
                    type="date"
                    value={flFilter.dateFrom}
                    onChange={e => setFlFilter(prev => ({ ...prev, dateFrom: e.target.value }))}
                    className="bg-act border border-bdr text-gray-100 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>

                {/* Date To */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Đến ngày</label>
                  <input
                    type="date"
                    value={flFilter.dateTo}
                    onChange={e => setFlFilter(prev => ({ ...prev, dateTo: e.target.value }))}
                    className="bg-act border border-bdr text-gray-100 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>

                {/* KTX */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Khu vực / KTX</label>
                  <select
                    value={flFilter.ktx}
                    onChange={e => setFlFilter(prev => ({ ...prev, ktx: e.target.value, day: '' }))}
                    className="bg-act border border-bdr text-gray-100 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="">Tất cả KTX</option>
                    {activeKtxList.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>

                {/* Dãy nhà */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Dãy nhà</label>
                  <select
                    value={flFilter.day}
                    onChange={e => setFlFilter(prev => ({ ...prev, day: e.target.value }))}
                    className="bg-act border border-bdr text-gray-100 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="">Tất cả dãy</option>
                    {flBuildings.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                {/* Loại biến động */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Loại biến động</label>
                  <select
                    value={flFilter.type}
                    onChange={e => setFlFilter(prev => ({ ...prev, type: e.target.value as FluctuationType }))}
                    className="bg-act border border-bdr text-gray-100 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  >
                    <option value="all">Tất cả loại</option>
                    <option value="tang">Thực tế tăng</option>
                    <option value="giam">Thực tế giảm</option>
                    <option value="rong">Biến động ròng</option>
                  </select>
                </div>

                {/* Apply Button */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-transparent select-none uppercase">Áp dụng</label>
                  <button
                    onClick={fetchFluctuation}
                    disabled={flLoading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-tx text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-500/20 disabled:opacity-60"
                  >
                    <RefreshCw size={13} className={flLoading ? 'animate-spin' : ''} />
                    <span>{flLoading ? 'Đang tải...' : 'Cập nhật'}</span>
                  </button>
                </div>
              </div>

              {/* Cutoff Mode Selector Bar */}
              <div className="mt-4 pt-3 border-t border-bdr/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-mu font-medium">Chế độ chốt dữ liệu:</span>
                  <div className="inline-flex rounded-xl bg-act p-0.5 border border-bdr">
                    <button
                      onClick={() => setFlFilter(prev => ({ ...prev, cutoffMode: '14h' }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        flFilter.cutoffMode === '14h'
                          ? 'bg-wn text-tx shadow-sm'
                          : 'text-mu hover:text-tx'
                      }`}
                    >
                      <Clock size={12} /> Chốt 14:00
                    </button>
                    <button
                      onClick={() => setFlFilter(prev => ({ ...prev, cutoffMode: 'realtime' }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        flFilter.cutoffMode === 'realtime'
                          ? 'bg-ok2 text-tx shadow-sm'
                          : 'text-mu hover:text-tx'
                      }`}
                    >
                      <RefreshCw size={12} /> Thời gian thực
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-mu">
                  {flFilter.cutoffMode === '14h' ? (
                    <span className="text-wn flex items-center gap-1">
                      <Clock size={12} /> Chốt số liệu 14:00 hàng ngày (phản ánh buổi chiều)
                    </span>
                  ) : (
                    <span className="text-ok flex items-center gap-1">
                      <CheckCircle2 size={12} /> Thời gian thực (bao gồm mọi thay đổi tức thì)
                    </span>
                  )}
                  {lastFetched && <span className="text-ic font-tabular">· Lúc {lastFetched}</span>}
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {flError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl tint-dgr border border-dgr text-sm text-dgr">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{flError}</span>
                <button onClick={fetchFluctuation} className="ml-auto text-xs underline hover:no-underline">Thử lại</button>
              </div>
            )}

            {/* ── KPI Summary Cards (Green/Orange/Emerald Accents) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Tăng thực tế (Green) */}
              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl hover:border-ok2 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-ok uppercase tracking-wider">Tổng Tăng Thực Tế</p>
                  <div className="w-10 h-10 rounded-xl bg-okbg border border-bdr2 flex items-center justify-center text-ok">
                    <UserPlus size={18} />
                  </div>
                </div>
                <p className="text-3xl font-extrabold text-ok font-tabular">
                  {flLoading ? '—' : `+${(summary?.tong_tang ?? 0).toLocaleString('vi-VN')}`}
                </p>
                <p className="text-xs text-mu mt-1">công nhân mới xếp vào</p>
              </div>

              {/* Giảm thực tế (Orange) */}
              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl hover:border-wn transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-wn uppercase tracking-wider">Tổng Giảm Thực Tế</p>
                  <div className="w-10 h-10 rounded-xl tint-wn border border-wn flex items-center justify-center text-wn">
                    <UserMinus size={18} />
                  </div>
                </div>
                <p className="text-3xl font-extrabold text-wn font-tabular">
                  {flLoading ? '—' : `-${(summary?.tong_giam ?? 0).toLocaleString('vi-VN')}`}
                </p>
                <p className="text-xs text-mu mt-1">công nhân đã rời khỏi KTX</p>
              </div>

              {/* Biến động ròng (Net) */}
              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl hover:border-pri2 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-lnk uppercase tracking-wider">Biến Động Ròng</p>
                  <div className="w-10 h-10 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk">
                    {(summary?.bien_dong_rong ?? 0) >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                  </div>
                </div>
                <p className={`text-3xl font-extrabold font-tabular ${(summary?.bien_dong_rong ?? 0) >= 0 ? 'text-lnk' : 'text-wn'}`}>
                  {flLoading ? '—' : (
                    (summary?.bien_dong_rong ?? 0) > 0
                      ? `+${(summary?.bien_dong_rong ?? 0).toLocaleString('vi-VN')}`
                      : (summary?.bien_dong_rong ?? 0).toLocaleString('vi-VN')
                  )}
                </p>
                <p className="text-xs text-mu mt-1">chênh lệch tăng trừ giảm</p>
              </div>

              {/* Số ngày có biến động */}
              <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl hover:border-bdr2 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-mu uppercase tracking-wider">Ngày Có Biến Động</p>
                  <div className="w-10 h-10 rounded-xl bg-act border border-bdr flex items-center justify-center text-mu">
                    <Calendar size={18} />
                  </div>
                </div>
                <p className="text-3xl font-extrabold text-tx font-tabular">
                  {flLoading ? '—' : (summary?.so_ngay_co_bien_dong ?? 0).toLocaleString('vi-VN')}
                </p>
                <p className="text-xs text-mu mt-1">ngày ghi nhận biến động</p>
              </div>
            </div>

            {/* ── Charts: Green (Tăng) vs Orange (Giảm) ── */}
            {flLoading ? (
              <div className="bg-surf rounded-2xl border border-bdr/60 p-12 text-center text-mu animate-pulse shadow-xl">
                Đang tải dữ liệu biểu đồ từ Supabase...
              </div>
            ) : chartData.length === 0 ? (
              <div className="bg-surf rounded-2xl border border-bdr/60 p-12 text-center shadow-xl">
                <ArrowRightLeft size={40} className="mx-auto mb-3 text-ic" />
                <p className="text-sm font-semibold text-mu">Không có dữ liệu biến động trong khoảng thời gian đã chọn</p>
                <p className="text-xs text-ic mt-1">Thử mở rộng khoảng thời gian hoặc bỏ bộ lọc</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Bar chart: Tăng / Giảm */}
                <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl hover:border-bdr2/80 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-okbg border border-bdr2 flex items-center justify-center text-ok">
                        <UserPlus size={16} />
                      </div>
                      <h4 className="font-bold text-tx text-sm">Tăng (Xanh) vs Giảm (Cam) theo ngày</h4>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.6} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomBarTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: '#D1D5DB' }} />
                      <Bar dataKey="Tăng thực tế" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="Giảm thực tế" fill="#f97316" radius={[3, 3, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Line chart: Biến động ròng */}
                <div className="bg-surf rounded-2xl border border-bdr/60 p-5 shadow-xl hover:border-bdr2/80 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-bdg border border-pri2/20 flex items-center justify-center text-lnk">
                        <TrendingUp size={16} />
                      </div>
                      <h4 className="font-bold text-tx text-sm">Xu hướng biến động ròng theo ngày</h4>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.6} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomBarTooltip />} />
                      <ReferenceLine y={0} stroke="#4B5563" strokeDasharray="4 4" />
                      <Line
                        type="monotone"
                        dataKey="Biến động ròng"
                        stroke="#38bdf8"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#38bdf8' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Daily Detail Table (Dark Theme with Row Highlight) ── */}
            {!flLoading && filteredDailyData.length > 0 && (
              <div className="bg-surf rounded-2xl border border-bdr/60 shadow-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-bdr/60 flex items-center justify-between bg-act/60">
                  <h4 className="font-bold text-tx flex items-center gap-2 text-sm">
                    <Calendar size={15} className="text-ok" />
                    Chi tiết biến động theo từng ngày
                  </h4>
                  <span className="text-xs text-mu font-medium font-tabular">{filteredDailyData.length} ngày có dữ liệu</span>
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-sm min-w-[550px]">
                    <thead>
                      <tr className="bg-act/90 border-b border-bdr">
                        <th className="text-left px-5 py-3 text-xs font-bold text-mu uppercase tracking-wider">Ngày</th>
                        <th className="text-center px-4 py-3 text-xs font-bold text-ok uppercase tracking-wider">Tăng thực tế</th>
                        <th className="text-center px-4 py-3 text-xs font-bold text-wn uppercase tracking-wider">Giảm thực tế</th>
                        <th className="text-center px-4 py-3 text-xs font-bold text-lnk uppercase tracking-wider">Biến động ròng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-750">
                      {filteredDailyData.map((row, idx) => (
                        <tr
                          key={row.ngay}
                          className={`hover:bg-act/70 hover:border-l-2 hover:border-l-emerald-500 transition-colors duration-150 ${
                            idx % 2 === 0 ? 'bg-surf' : 'bg-act/40'
                          }`}
                        >
                          <td className="px-5 py-3 font-semibold text-tx font-tabular">{formatDateVN(row.ngay)}</td>
                          <td className="px-4 py-3 text-center">
                            {row.so_tang > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-okbg/20 text-ok border border-bdr2 font-tabular">
                                <UserPlus size={11} /> +{row.so_tang}
                              </span>
                            ) : (
                              <span className="text-ic text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {row.so_giam > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tint-wn text-wn border border-orange-500/30 font-tabular">
                                <UserMinus size={11} /> -{row.so_giam}
                              </span>
                            ) : (
                              <span className="text-ic text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold font-tabular ${
                              row.bien_dong_rong > 0
                                ? 'bg-bdg/20 text-lnk border border-bdr2'
                                : row.bien_dong_rong < 0
                                ? 'tint-wn text-wn border border-wn'
                                : 'bg-act text-mu border border-bdr'
                            }`}>
                              {row.bien_dong_rong > 0 ? <TrendingUp size={11} /> : row.bien_dong_rong < 0 ? <TrendingDown size={11} /> : null}
                              {row.bien_dong_rong > 0 ? `+${row.bien_dong_rong}` : row.bien_dong_rong}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Summary row */}
                    <tfoot>
                      <tr className="bg-act/90 border-t-2 border-bdr font-tabular">
                        <td className="px-5 py-3 text-xs font-bold text-mu uppercase">Tổng cộng kỳ</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-extrabold text-ok">
                            +{filteredDailyData.reduce((s, r) => s + r.so_tang, 0).toLocaleString('vi-VN')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-extrabold text-wn">
                            -{filteredDailyData.reduce((s, r) => s + r.so_giam, 0).toLocaleString('vi-VN')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const net = filteredDailyData.reduce((s, r) => s + r.bien_dong_rong, 0);
                            return (
                              <span className={`text-sm font-extrabold ${net >= 0 ? 'text-lnk' : 'text-wn'}`}>
                                {net > 0 ? `+${net.toLocaleString('vi-VN')}` : net.toLocaleString('vi-VN')}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Info Note */}
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-act/70 border border-bdr/60 text-xs text-mu">
              <TrendingUp size={15} className="text-ok flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-tx">Nguồn dữ liệu thời gian thực:</span> Số liệu biến động được tính toán tự động từ bảng{' '}
                <code className="bg-act text-ok px-1 py-0.5 rounded font-mono">workers</code> dựa trên thời điểm vào ({' '}
                <code className="bg-act text-mu px-1 py-0.5 rounded font-mono">created_at</code>) và ngày ra ({' '}
                <code className="bg-act text-mu px-1 py-0.5 rounded font-mono">deleted_at</code>).
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
