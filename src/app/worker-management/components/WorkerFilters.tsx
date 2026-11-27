'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import type { FilterState } from './WorkerManagementClient';
import {
  Worker,
  getUniqueKTX,
  getUniqueBuildings,
  getUniqueRooms,
  getUniquePlatoons,
  getUniqueToTruongList,
  removeAccents,
  compareKtxNames,
} from '@/data/workers';
import { useKtxStructure } from '@/lib/ktxStructure';

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  workers: Worker[];
}

/** Combobox with autocomplete & keyboard navigation for Tổ Trưởng filter */
function ToTruongCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync internal inputValue whenever value prop changes (e.g., cleared externally)
  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  // Filter options based on accent-insensitive typing
  const filteredOptions = useMemo(() => {
    const query = removeAccents(inputValue.trim());
    if (!query) return options;
    return options.filter(opt => removeAccents(opt).includes(query));
  }, [inputValue, options]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Reset display text to value if nothing was selected
        if (value) {
          setInputValue(value);
        } else if (!inputValue || !options.includes(inputValue.trim())) {
          setInputValue('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, inputValue, options]);

  // Scroll highlighted item into view when navigating with keyboard
  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('li');
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const selectOption = (opt: string) => {
    onChange(opt);
    setInputValue(opt);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setInputValue('');
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        setIsOpen(true);
        return;
      }
    }

    const totalItems = filteredOptions.length + 1; // +1 for "Tất cả Tổ Trưởng" at index 0

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < totalItems - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : totalItems - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex === 0) {
        selectOption('');
      } else if (highlightedIndex > 0 && highlightedIndex <= filteredOptions.length) {
        selectOption(filteredOptions[highlightedIndex - 1]);
      } else if (filteredOptions.length > 0) {
        selectOption(filteredOptions[0]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setInputValue(value || '');
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onChange={e => {
            setInputValue(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Tìm tổ trưởng..."
          className="w-full bg-act border border-bdr text-tx placeholder-mu rounded-xl pl-2.5 pr-7 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50"
        />
        {(inputValue || value) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-white p-0.5 rounded cursor-pointer transition-colors"
            title="Xóa bộ lọc Tổ Trưởng"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-surf border border-bdr rounded-xl shadow-modal py-1 text-xs text-tx divide-y divide-bdr"
        >
          {/* Top option: Tất cả Tổ Trưởng */}
          <li
            onClick={() => selectOption('')}
            onMouseEnter={() => setHighlightedIndex(0)}
            className={`px-3 py-2 cursor-pointer font-bold flex items-center justify-between transition-colors ${
              !value && highlightedIndex === 0
                ? 'bg-pri text-white'
                : !value
                ? 'text-lnk bg-act'
                : highlightedIndex === 0
                ? 'bg-act text-tx'
                : 'text-mu hover:bg-act'
            }`}
          >
            <span>Tất cả Tổ Trưởng</span>
            {!value && <span className="text-[10px] opacity-80">✓</span>}
          </li>

          {/* Dynamic options */}
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2.5 text-mu text-center italic">
              Không tìm thấy tổ trưởng nào
            </li>
          ) : (
            filteredOptions.map((opt, idx) => {
              const itemIndex = idx + 1;
              const isSelected = value === opt;
              const isHighlighted = highlightedIndex === itemIndex;

              return (
                <li
                  key={opt}
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setHighlightedIndex(itemIndex)}
                  className={`px-3 py-2 cursor-pointer flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-pri text-white font-bold'
                      : isHighlighted
                      ? 'bg-act text-tx font-semibold'
                      : 'hover:bg-act/70 text-tx'
                  }`}
                >
                  <span className="truncate">{opt}</span>
                  {isSelected && <span className="text-[10px] ml-1 shrink-0">✓</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

export default function WorkerFilters({ filters, onChange, workers }: Props) {
  const set = (key: keyof FilterState, val: string | boolean) =>
    onChange({ ...filters, [key]: val });

  const { ktxNames, ktxGroups } = useKtxStructure();
  const ktxList = useMemo(() => {
    const set = new Set([...getUniqueKTX(workers), ...ktxNames]);
    return Array.from(set).sort(compareKtxNames);
  }, [workers, ktxNames]);
  const ktxScopedWorkers = useMemo(
    () => (filters.ktx ? workers.filter(w => w.ktx === filters.ktx) : workers),
    [workers, filters.ktx]
  );
  const buildingList = useMemo(() => {
    const set = new Set(getUniqueBuildings(ktxScopedWorkers));
    if (filters.ktx) {
      ktxGroups.find(g => g.ktx === filters.ktx)?.days.forEach(d => {
        if (d) set.add(d);
      });
    } else {
      ktxGroups.forEach(g => g.days.forEach(d => {
        if (d) set.add(d);
      }));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
  }, [ktxScopedWorkers, ktxGroups, filters.ktx]);
  const roomList = useMemo(
    () => getUniqueRooms(ktxScopedWorkers, filters.building || undefined),
    [ktxScopedWorkers, filters.building]
  );
  const platoonList = useMemo(() => getUniquePlatoons(workers), [workers]);
  const toTruongList = useMemo(() => getUniqueToTruongList(workers), [workers]);

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const activeAdvancedFilterCount = [
    filters.ktx,
    filters.building,
    filters.room,
    filters.platoon,
    filters.profileStatus,
    filters.toTruong,
    filters.province,
    filters.tamTruStatus,
  ].filter(Boolean).length;

  const hasActive = Boolean(filters.search || activeAdvancedFilterCount > 0);

  const resetAllFilters = () =>
    onChange({
      search: '',
      ktx: '',
      building: '',
      room: '',
      platoon: '',
      profileStatus: '',
      toTruong: '',
      province: '',
      tamTruStatus: '',
    });

  return (
    <div className="bg-surf border border-bdr rounded-2xl p-3 sm:p-5 shadow-xl mb-4 sm:mb-5 space-y-3 sm:space-y-4">
      {/* ── Top Search Bar + Mobile Filter Toggle ── */}
      <div className="relative w-full">
        <label className="hidden md:flex text-xs font-bold text-tx uppercase tracking-wider mb-1.5 items-center gap-1.5">
          <Search size={14} className="text-blue-400" />
          <span>Tìm kiếm nhanh công nhân</span>
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm họ tên, mã NV, tổ trưởng, CCCD, SĐT, phòng..."
              value={filters.search}
              onChange={e => set('search', e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 sm:py-3 text-sm bg-act/60 sm:bg-surf border border-bdr text-tx placeholder-mu rounded-xl focus:outline-none focus:ring-2 focus:ring-pri2/50 focus:border-pri2 transition-all"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => set('search', '')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-mu hover:text-tx transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileFiltersOpen(prev => !prev)}
            className={`md:hidden shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              mobileFiltersOpen || activeAdvancedFilterCount > 0
                ? 'bg-bdg text-lnk border-pri2/50'
                : 'bg-act text-tx border-bdr hover:bg-act/80'
            }`}
          >
            <SlidersHorizontal size={15} />
            <span>Bộ lọc{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ''}</span>
            {mobileFiltersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* ── Mobile 1-Tap Quick Filters (Always compact, 1 single scrollable line) ── */}
        <div className="md:hidden flex items-center gap-1.5 overflow-x-auto scrollbar-thin pt-2.5 -mx-0.5 px-0.5">
          {[
            {
              id: 'all',
              label: 'Tất cả',
              active: !filters.profileStatus && !filters.tamTruStatus,
              onClick: () => onChange({ ...filters, profileStatus: '', tamTruStatus: '' }),
            },
            {
              id: 'no_room',
              label: 'Chưa phòng',
              active: filters.profileStatus === 'no_room',
              onClick: () =>
                onChange({ ...filters, profileStatus: filters.profileStatus === 'no_room' ? '' : 'no_room' }),
            },
            {
              id: 'missing',
              label: 'Thiếu CCCD/SĐT',
              active: filters.profileStatus === 'missing_cccd_sdt',
              onClick: () =>
                onChange({
                  ...filters,
                  profileStatus: filters.profileStatus === 'missing_cccd_sdt' ? '' : 'missing_cccd_sdt',
                }),
            },
            {
              id: 'unreg',
              label: 'Chưa ĐK tạm trú',
              active: filters.tamTruStatus === 'unregistered',
              onClick: () =>
                onChange({
                  ...filters,
                  tamTruStatus: filters.tamTruStatus === 'unregistered' ? '' : 'unregistered',
                }),
            },
            {
              id: 'overdue',
              label: 'Quá hạn >7 ngày',
              active: filters.tamTruStatus === 'overdue',
              onClick: () =>
                onChange({ ...filters, tamTruStatus: filters.tamTruStatus === 'overdue' ? '' : 'overdue' }),
            },
          ].map(chip => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onClick}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                chip.active
                  ? 'bg-pri text-white border-pri shadow-sm'
                  : 'bg-act/80 text-mu border-bdr hover:text-tx'
              }`}
            >
              {chip.label}
            </button>
          ))}

          {hasActive && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 bg-dgrbg/70 text-dgr border border-dgr/30 cursor-pointer flex items-center gap-1"
            >
              <X size={12} />
              <span>Xóa lọc</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Multi-attribute Filter Grid (Collapsible on mobile, always expanded on md+) ── */}
      <div
        className={`${
          mobileFiltersOpen ? 'grid' : 'hidden md:grid'
        } grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3 items-end pt-2 border-t border-bdr3`}
      >
        {/* KTX */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">KTX</label>
          <select
            value={filters.ktx}
            onChange={e => onChange({ ...filters, ktx: e.target.value, building: '', room: '' })}
            className="bg-surf border border-bdr text-tx rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full cursor-pointer"
          >
            <option value="">Tất cả KTX</option>
            {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        {/* Building/Dãy */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Dãy</label>
          <select
            value={filters.building}
            onChange={e => onChange({ ...filters, building: e.target.value, room: '' })}
            className="bg-surf border border-bdr text-tx rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full cursor-pointer"
          >
            <option value="">Tất cả dãy</option>
            {buildingList.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Room */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Phòng</label>
          <select
            value={filters.room}
            onChange={e => set('room', e.target.value)}
            className="bg-surf border border-bdr text-tx rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full cursor-pointer"
          >
            <option value="">Tất cả phòng</option>
            {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
          </select>
        </div>

        {/* Platoon */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Tiểu đoàn</label>
          <select
            value={filters.platoon}
            onChange={e => set('platoon', e.target.value)}
            className="bg-surf border border-bdr text-tx rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full cursor-pointer"
          >
            <option value="">Tất cả TD</option>
            {platoonList.map(p => <option key={p} value={p}>TD {p}</option>)}
            <option value="__none__">Chưa phân</option>
          </select>
        </div>

        {/* Tổ Trưởng filter — Combobox with search & suggestions */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Tổ Trưởng</label>
          <ToTruongCombobox
            value={filters.toTruong}
            onChange={val => set('toTruong', val)}
            options={toTruongList}
          />
        </div>

        {/* Profile status */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Hồ sơ</label>
          <select
            value={filters.profileStatus}
            onChange={e => set('profileStatus', e.target.value)}
            className="bg-surf border border-bdr text-tx rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full cursor-pointer"
          >
            <option value="">Tất cả</option>
            <option value="full">✅ Đủ hồ sơ</option>
            <option value="missing_cccd_sdt">🔴 Thiếu CCCD/SĐT</option>
            <option value="no_room">🟡 Chưa phòng</option>
          </select>
        </div>

        {/* Tạm trú status */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Tạm trú</label>
          <select
            value={filters.tamTruStatus}
            onChange={e => set('tamTruStatus', e.target.value)}
            className="bg-surf border border-bdr text-tx rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full cursor-pointer"
          >
            <option value="">Tất cả</option>
            <option value="registered">🟢 Đã ĐK</option>
            <option value="unregistered">🟠 Chưa ĐK</option>
            <option value="overdue">🔴 Quá hạn (&gt;7 ngày)</option>
          </select>
        </div>

        {/* Province / Reset */}
        <div className="flex flex-col gap-1">
          {hasActive ? (
            <button
              onClick={() => onChange({ search: '', ktx: '', building: '', room: '', platoon: '', profileStatus: '', toTruong: '', province: '', tamTruStatus: '' })}
              className="flex items-center justify-center gap-1 text-xs text-rose-300 hover:text-white px-2.5 py-2 rounded-xl bg-rose-500/20 border border-rose-500/30 hover:bg-rose-500/30 transition-all font-semibold cursor-pointer"
            >
              <X size={13} /> Xóa lọc
            </button>
          ) : (
            <input
              type="text"
              placeholder="Tỉnh/TP..."
              value={filters.province}
              onChange={e => set('province', e.target.value)}
              className="bg-surf border border-bdr text-tx placeholder-gray-400 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pri2/50 w-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
