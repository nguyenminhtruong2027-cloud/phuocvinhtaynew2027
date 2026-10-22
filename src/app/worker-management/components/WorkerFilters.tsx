'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
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
          className="w-full bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-400 rounded-xl pl-2.5 pr-7 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
        {(inputValue || value) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5 rounded cursor-pointer transition-colors"
            title="Xóa bộ lọc Tổ Trưởng"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl shadow-2xl py-1 text-xs text-gray-100 divide-y divide-gray-750/60"
        >
          {/* Top option: Tất cả Tổ Trưởng */}
          <li
            onClick={() => selectOption('')}
            onMouseEnter={() => setHighlightedIndex(0)}
            className={`px-3 py-2 cursor-pointer font-bold flex items-center justify-between transition-colors ${
              !value && highlightedIndex === 0
                ? 'bg-blue-600 text-white'
                : !value
                ? 'text-blue-400 bg-blue-500/10'
                : highlightedIndex === 0
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700/80'
            }`}
          >
            <span>Tất cả Tổ Trưởng</span>
            {!value && <span className="text-[10px] opacity-80">✓</span>}
          </li>

          {/* Dynamic options */}
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2.5 text-gray-400 text-center italic">
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
                      ? 'bg-blue-600 text-white font-bold'
                      : isHighlighted
                      ? 'bg-gray-700 text-white'
                      : 'hover:bg-gray-700/80 text-gray-200'
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

  const { ktxNames } = useKtxStructure();
  const ktxList = useMemo(() => {
    const set = new Set([...getUniqueKTX(workers), ...ktxNames]);
    return Array.from(set).sort(compareKtxNames);
  }, [workers, ktxNames]);
  const buildingList = getUniqueBuildings(workers);
  const roomList = getUniqueRooms(workers, filters.building || undefined);
  const platoonList = getUniquePlatoons(workers);
  const toTruongList = useMemo(() => getUniqueToTruongList(workers), [workers]);

  const hasActive =
    filters.search ||
    filters.ktx ||
    filters.building ||
    filters.room ||
    filters.platoon ||
    filters.profileStatus ||
    filters.toTruong ||
    filters.province ||
    filters.tamTruStatus;

  return (
    <div className="bg-[#1F2937] border border-gray-700/60 rounded-2xl p-4 sm:p-5 shadow-xl mb-5 space-y-4">
      {/* ── Spacious Top Search Bar ── */}
      <div className="relative w-full">
        <label className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
          <Search size={14} className="text-blue-400" />
          <span>Tìm kiếm nhanh công nhân</span>
        </label>
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Nhập họ tên, mã nhân viên, tổ trưởng, số CCCD, SĐT, số phòng..."
            value={filters.search}
            onChange={e => set('search', e.target.value)}
            className="w-full pl-11 pr-10 py-3 text-sm bg-gray-800 border border-gray-700 text-white placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 shadow-inner transition-all"
          />
          {filters.search && (
            <button
              onClick={() => set('search', '')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Multi-attribute Filter Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3 items-end pt-2 border-t border-gray-750">
        {/* KTX */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">KTX</label>
          <select
            value={filters.ktx}
            onChange={e => set('ktx', e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full cursor-pointer"
          >
            <option value="">Tất cả KTX</option>
            {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        {/* Building/Dãy */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Dãy</label>
          <select
            value={filters.building}
            onChange={e => { set('building', e.target.value); onChange({ ...filters, building: e.target.value, room: '' }); }}
            className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full cursor-pointer"
          >
            <option value="">Tất cả dãy</option>
            {buildingList.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Room */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Phòng</label>
          <select
            value={filters.room}
            onChange={e => set('room', e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full cursor-pointer"
          >
            <option value="">Tất cả phòng</option>
            {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
          </select>
        </div>

        {/* Platoon */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tiểu đoàn</label>
          <select
            value={filters.platoon}
            onChange={e => set('platoon', e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full cursor-pointer"
          >
            <option value="">Tất cả TD</option>
            {platoonList.map(p => <option key={p} value={p}>TD {p}</option>)}
            <option value="__none__">Chưa phân</option>
          </select>
        </div>

        {/* Tổ Trưởng filter — Combobox with search & suggestions */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tổ Trưởng</label>
          <ToTruongCombobox
            value={filters.toTruong}
            onChange={val => set('toTruong', val)}
            options={toTruongList}
          />
        </div>

        {/* Profile status */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Hồ sơ</label>
          <select
            value={filters.profileStatus}
            onChange={e => set('profileStatus', e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full cursor-pointer"
          >
            <option value="">Tất cả</option>
            <option value="full">✅ Đủ hồ sơ</option>
            <option value="missing_cccd_sdt">🔴 Thiếu CCCD/SĐT</option>
            <option value="no_room">🟡 Chưa phòng</option>
          </select>
        </div>

        {/* Tạm trú status */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tạm trú</label>
          <select
            value={filters.tamTruStatus}
            onChange={e => set('tamTruStatus', e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-100 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full cursor-pointer"
          >
            <option value="">Tất cả</option>
            <option value="registered">🟢 Đã ĐK</option>
            <option value="unregistered">🟠 Chưa ĐK</option>
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
              className="bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-400 rounded-xl px-2.5 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
