'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search,
  LayoutDashboard,
  BarChart2,
  Users,
  Building2,
  BedDouble,
  QrCode,
  UserCog,
  ClipboardList,
  Sun,
  Moon,
  RefreshCw,
  ArrowRight,
  Command,
  X,
  UserCheck,
} from 'lucide-react';
import { useWorkers } from '@/context/WorkerContext';
import { useAuth } from '@/context/AuthContext';
import { MonoChip, StatusTag } from '@/components/ui/StatusTag';

interface CommandItem {
  id: string;
  group: 'worker' | 'route' | 'action';
  label: string;
  sublabel?: string;
  badge?: React.ReactNode;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  onSelect: () => void;
}

function stripVN(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function openCommandPalette() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ktx:open-command-palette'));
  }
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { workers, refreshWorkers, refreshing } = useWorkers();
  const { isAdmin } = useAuth();
  const [themeMode, setThemeMode] = useState<'midnight' | 'light'>('midnight');

  useEffect(() => {
    const syncTheme = () => {
      const current = document.documentElement.getAttribute('data-theme');
      setThemeMode(current === 'light' ? 'light' : 'midnight');
    };
    syncTheme();
    window.addEventListener('ktx:theme-changed', syncTheme);
    return () => window.removeEventListener('ktx:theme-changed', syncTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = themeMode === 'light' ? 'midnight' : 'light';
    try {
      localStorage.setItem('ktx-theme', next);
    } catch {}
    document.documentElement.setAttribute('data-theme', next);
    setThemeMode(next);
    window.dispatchEvent(new CustomEvent('ktx:theme-changed'));
  }, [themeMode]);

  // Global keyboard shortcut (Ctrl+K / Cmd+K) + custom trigger event
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onCustomOpen = () => setOpen(true);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('ktx:open-command-palette', onCustomOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('ktx:open-command-palette', onCustomOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const routeItems: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      {
        id: 'route-dashboard',
        group: 'route',
        label: 'Tổng Quan KTX',
        sublabel: 'Sơ đồ nhiệt phòng, KPI & trực ban',
        icon: LayoutDashboard,
        onSelect: () => navigate('/'),
      },
      {
        id: 'route-report',
        group: 'route',
        label: 'Báo Cáo Biến Động',
        sublabel: 'Thống kê tạm trú, vào/ra & xuất báo cáo',
        icon: BarChart2,
        onSelect: () => navigate('/report-dashboard'),
      },
      {
        id: 'route-workers',
        group: 'route',
        label: 'Quản Lý Công Nhân',
        sublabel: `${workers.length.toLocaleString('vi-VN')} hồ sơ đang lưu`,
        icon: Users,
        onSelect: () => navigate('/worker-management'),
      },
      {
        id: 'route-facilities',
        group: 'route',
        label: 'Cơ Sở Vật Chất',
        sublabel: 'Danh mục phòng, thiết bị & định mức giường',
        icon: Building2,
        onSelect: () => navigate('/facilities'),
      },
      {
        id: 'route-beds',
        group: 'route',
        label: 'Quản Lý Giường',
        sublabel: 'Sơ đồ giường trống, kiểm tra có mặt & chuyển giường',
        icon: BedDouble,
        onSelect: () => navigate('/bed-management'),
      },
      {
        id: 'route-qr',
        group: 'route',
        label: 'QR Portal',
        sublabel: 'Mã QR tự đăng ký, check-out & điểm danh',
        icon: QrCode,
        onSelect: () => navigate('/qr-portal'),
      },
    ];
    if (isAdmin) {
      list.push(
        {
          id: 'route-users',
          group: 'route',
          label: 'Quản Lý Tài Khoản',
          sublabel: 'Phân quyền Admin / Staff & KTX phụ trách',
          icon: UserCog,
          onSelect: () => navigate('/user-management'),
        },
        {
          id: 'route-audit',
          group: 'route',
          label: 'Nhật Ký Hệ Thống',
          sublabel: 'Audit Log truy vết thao tác',
          icon: ClipboardList,
          onSelect: () => navigate('/audit-log'),
        }
      );
    }
    return list;
  }, [isAdmin, navigate, workers.length]);

  const actionItems: CommandItem[] = useMemo(
    () => [
      {
        id: 'action-theme',
        group: 'action',
        label: themeMode === 'midnight' ? 'Chuyển sang Giao diện Sáng (Light)' : 'Chuyển sang Giao diện Tối (Midnight)',
        sublabel: 'Thay đổi chế độ hiển thị toàn hệ thống',
        icon: themeMode === 'midnight' ? Sun : Moon,
        onSelect: () => {
          toggleTheme();
          setOpen(false);
        },
      },
      {
        id: 'action-sync',
        group: 'action',
        label: refreshing ? 'Đang đồng bộ dữ liệu...' : 'Đồng bộ lại toàn bộ dữ liệu',
        sublabel: 'Tải mới danh sách công nhân & phòng từ Supabase',
        icon: RefreshCw,
        onSelect: () => {
          refreshWorkers();
          setOpen(false);
        },
      },
    ],
    [themeMode, toggleTheme, refreshWorkers, refreshing]
  );

  const workerMatches: CommandItem[] = useMemo(() => {
    const q = stripVN(query.trim());
    if (!q) return [];
    const matched = workers
      .filter(w => {
        const hay = stripVN(
          `${w.hoVaTen || ''} ${w.maNV || ''} ${w.cccd || ''} ${w.day || ''} ${w.phongSo || ''} ${w.ktx || ''}`
        );
        return hay.includes(q);
      })
      .slice(0, 6);

    return matched.map(w => {
      const loc = [w.ktx, w.day, w.phongSo ? `P.${w.phongSo}` : '', w.giuong ? `G${w.giuong}` : '']
        .filter(Boolean)
        .join(' · ');
      return {
        id: `worker-${w.id}`,
        group: 'worker',
        label: w.hoVaTen || 'Không tên',
        sublabel: w.toTruong ? `Tổ trưởng: ${w.toTruong}` : w.donVi || 'Công nhân KTX',
        badge: (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {loc && <MonoChip tone="blue">{loc}</MonoChip>}
            {w.maNV && <MonoChip>#{w.maNV}</MonoChip>}
            <StatusTag tone={w.tamTruStatus === 'registered' ? 'teal' : 'amber'}>
              {w.tamTruStatus === 'registered' ? 'Tạm trú' : 'Chưa ĐK'}
            </StatusTag>
          </div>
        ),
        icon: UserCheck,
        onSelect: () => navigate(`/worker-management?view=${encodeURIComponent(w.id)}`),
      };
    });
  }, [query, workers, navigate]);

  const filteredRoutes = useMemo(() => {
    const q = stripVN(query.trim());
    if (!q) return routeItems;
    return routeItems.filter(
      r => stripVN(r.label).includes(q) || stripVN(r.sublabel || '').includes(q)
    );
  }, [query, routeItems]);

  const filteredActions = useMemo(() => {
    const q = stripVN(query.trim());
    if (!q) return actionItems;
    return actionItems.filter(
      a => stripVN(a.label).includes(q) || stripVN(a.sublabel || '').includes(q)
    );
  }, [query, actionItems]);

  const allItems = useMemo(
    () => [...workerMatches, ...filteredRoutes, ...filteredActions],
    [workerMatches, filteredRoutes, filteredActions]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (allItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % allItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + allItems.length) % allItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = allItems[activeIndex];
      if (target) target.onSelect();
    }
  };

  let runningIndex = -1;

  const renderSection = (title: string, items: CommandItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="py-1.5">
        <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ic">{title}</p>
        <div className="space-y-0.5 px-1.5">
          {items.map(item => {
            runningIndex += 1;
            const idx = runningIndex;
            const isSelected = idx === activeIndex;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={item.onSelect}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-act border border-bdr2 text-tx shadow-sm'
                    : 'border border-transparent text-nav hover:bg-act/50 hover:text-tx'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isSelected ? 'craft-icon-blue' : 'bg-surf border border-bdr text-ic'
                  }`}
                >
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-semibold text-tx truncate">{item.label}</p>
                  {item.sublabel && (
                    <p className="text-[11px] text-mu truncate mt-0.5">{item.sublabel}</p>
                  )}
                </div>
                {item.badge ? (
                  <div className="shrink-0 hidden sm:block">{item.badge}</div>
                ) : (
                  <ArrowRight
                    size={14}
                    className={`shrink-0 transition-transform ${
                      isSelected ? 'text-lnk translate-x-0.5' : 'text-ic opacity-40'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] sm:pt-[12vh] px-3 sm:px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/65 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Palette Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ type: 'spring', stiffness: 440, damping: 32 }}
            role="dialog"
            aria-label="Tìm kiếm nhanh toàn hệ thống"
            className="relative z-10 w-full max-w-2xl surface-elevated rounded-2xl overflow-hidden shadow-2xl border border-bdr3"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-bdr bg-surf/95">
              <Search size={18} className="text-lnk shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Tìm công nhân (tên, mã NV, CCCD, phòng), chuyển trang hoặc thao tác nhanh..."
                className="flex-1 bg-transparent text-sm text-tx placeholder:text-mu focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-1 rounded-md text-mu hover:text-tx hover:bg-act transition-colors"
                  title="Xóa từ khóa"
                >
                  <X size={14} />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md bg-act border border-bdr2 text-[10px] font-mono font-semibold text-mu">
                ESC
              </kbd>
            </div>

            {/* Results List */}
            <div className="max-h-[62vh] overflow-y-auto scrollbar-thin py-1.5 bg-surf/90">
              {allItems.length === 0 ? (
                <div className="py-12 text-center space-y-1.5">
                  <p className="text-sm font-semibold text-tx">Không tìm thấy kết quả phù hợp</p>
                  <p className="text-xs text-mu">
                    Thử nhập họ tên, mã nhân viên, số CCCD, hoặc tên chức năng (vd: Giường, QR, Báo cáo)
                  </p>
                </div>
              ) : (
                <>
                  {renderSection(`Công nhân (${workerMatches.length})`, workerMatches)}
                  {renderSection('Điều hướng nhanh', filteredRoutes)}
                  {renderSection('Tiện ích hệ thống', filteredActions)}
                </>
              )}
            </div>

            {/* Footer Hints */}
            <div className="px-4 py-2.5 border-t border-bdr bg-act/60 flex items-center justify-between text-[11px] text-mu">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-surf border border-bdr2 font-mono text-[10px]">↑↓</kbd>
                  <span>Di chuyển</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-surf border border-bdr2 font-mono text-[10px]">↵</kbd>
                  <span>Mở</span>
                </span>
              </div>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-ic">
                <Command size={11} />
                <span>{pathname === '/' ? 'Tổng quan' : pathname}</span>
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
