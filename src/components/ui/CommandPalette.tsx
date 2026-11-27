'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
  Box,
  DoorOpen,
  Wrench,
  ShieldAlert,
  Minimize2,
  Users2,
  UserMinus,
  ArrowLeftRight,
  BookmarkCheck,
  Clock,
  Sparkles,
  RotateCcw,
  ClipboardCheck,
} from 'lucide-react';
import { useWorkers } from '@/context/WorkerContext';
import { useAuth } from '@/context/AuthContext';
import { MonoChip, StatusTag } from '@/components/ui/StatusTag';
import {
  FacilityItem,
  fetchFacilitiesList,
  formatRoomDisplay,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { fetchMaintenanceTickets, MaintenanceTicket, getTicketCategoryShortLabel } from '@/lib/maintenanceTickets';

interface RecentCommandRecord {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

const RECENT_CMD_KEY = 'ktx_cmd_recent_v1';

function loadRecentCommands(): RecentCommandRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_CMD_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecentCommand(rec: RecentCommandRecord): RecentCommandRecord[] {
  const prev = loadRecentCommands().filter(r => r.href !== rec.href);
  const next = [rec, ...prev].slice(0, 5);
  try {
    window.localStorage.setItem(RECENT_CMD_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

interface CommandItem {
  id: string;
  group: 'recent' | 'worker' | 'room' | 'team' | 'ticket' | 'route' | 'action';
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
  const { isAdmin, isTechnician } = useAuth();
  const [themeMode, setThemeMode] = useState<'midnight' | 'light'>('midnight');
  const [roomsCatalog, setRoomsCatalog] = useState<FacilityItem[]>([]);
  const [activeTickets, setActiveTickets] = useState<MaintenanceTicket[]>([]);
  const [recentRecords, setRecentRecords] = useState<RecentCommandRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    setRecentRecords(loadRecentCommands());
    let active = true;
    if (roomsCatalog.length === 0) {
      fetchFacilitiesList(false)
        .then(list => {
          if (active && list) setRoomsCatalog(list);
        })
        .catch(() => {});
    }
    fetchMaintenanceTickets({ activeOnly: true })
      .then(res => {
        if (active && !res.tableMissing) setActiveTickets(res.tickets);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [open, roomsCatalog.length]);

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
    (href: string, recentMeta?: { id: string; label: string; sublabel?: string }) => {
      if (recentMeta) {
        setRecentRecords(pushRecentCommand({ ...recentMeta, href }));
      }
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const routeItems: CommandItem[] = useMemo(() => {
    if (isTechnician) {
      return [
        {
          id: 'route-maintenance',
          group: 'route',
          label: 'Kỹ Thuật & Bảo Trì',
          sublabel: 'Tiếp nhận, xử lý phiếu báo hỏng QR & dọn phiếu đã xong',
          icon: Wrench,
          onSelect: () => navigate('/maintenance'),
        },
        {
          id: 'route-ktx-3d',
          group: 'route',
          label: 'Bản Đồ 3D KTX',
          sublabel: 'Xem bản đồ nhiệt bảo trì 3D & vị trí phòng hỏng',
          icon: Box,
          onSelect: () => navigate('/ktx-3d?mode=maintenance'),
        },
        {
          id: 'route-facilities',
          group: 'route',
          label: 'Cơ Sở Vật Chất',
          sublabel: 'Danh mục phòng, thiết bị & ghi chú bảo trì',
          icon: Building2,
          onSelect: () => navigate('/facilities'),
        },
      ];
    }

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
        id: 'route-teams',
        group: 'route',
        label: 'Quản Lý Tổ Đội & Báo Cáo Zalo',
        sublabel: 'Gom nhóm Tổ trưởng / Tiểu đoàn / Đơn vị & copy báo cáo Zalo 1 chạm',
        icon: Users2,
        onSelect: () => navigate('/teams'),
      },
      {
        id: 'action-batch-checkout',
        group: 'action',
        label: 'Check-out Hàng Loạt & Đối Chiếu Quân Số',
        sublabel: 'Dán danh sách nghỉ việc hoặc đối soát Excel nhân sự công trường ↔ KTX',
        icon: UserMinus,
        onSelect: () => navigate('/worker-management?action=batch-checkout'),
      },
      {
        id: 'action-bed-swap',
        group: 'action',
        label: 'Hoán Đổi Giường 2 Công Nhân (A ⇄ B)',
        sublabel: 'Đổi chỗ trực tiếp 2 người ở Quản lý Giường',
        icon: ArrowLeftRight,
        onSelect: () => navigate('/bed-management?action=swap'),
      },
      {
        id: 'action-bed-reserve',
        group: 'action',
        label: 'Đặt Giữ Chỗ Giường Cho Đoàn Sắp Vào',
        sublabel: 'Khoanh trước phòng/giường trống để tránh xếp nhầm',
        icon: BookmarkCheck,
        onSelect: () => navigate('/bed-management?action=reserve'),
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
        id: 'route-ktx-3d',
        group: 'route',
        label: 'Bản Đồ 3D KTX',
        sublabel: 'Mô hình 3D trực quan 6 Dãy × 15 Phòng, nội thất & hạ tầng Vincons',
        icon: Box,
        onSelect: () => navigate('/ktx-3d'),
      },
      {
        id: 'route-maintenance',
        group: 'route',
        label: 'Kỹ Thuật & Bảo Trì',
        sublabel: 'Phiếu báo hỏng QR, phân công xử lý & lịch sử sửa chữa',
        icon: Wrench,
        onSelect: () => navigate('/maintenance'),
      },
      {
        id: 'route-security',
        group: 'route',
        label: 'An Ninh & Kỷ Luật KTX',
        sublabel: 'Sổ vi phạm, Danh sách Đen (Blacklist) & Quét công nhân ảo',
        icon: ShieldAlert,
        onSelect: () => navigate('/security'),
      },
      {
        id: 'route-qr',
        group: 'route',
        label: 'QR Portal',
        sublabel: 'Mã QR tự đăng ký, báo hỏng phòng, check-out & điểm danh',
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
          sublabel: 'Phân quyền Admin / Chuyên viên / Kỹ thuật viên',
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
  }, [isAdmin, isTechnician, navigate, workers.length]);

  const actionItems: CommandItem[] = useMemo(
    () => [
      ...(!isTechnician
        ? [
            {
              id: 'action-hallway-inspect',
              group: 'action' as const,
              label: 'Chế độ Đi Kiểm Phòng Thực Địa (Hành lang)',
              sublabel: 'Kiểm nhanh từng phòng trên điện thoại, báo hỏng & xuất Zalo cuối lượt',
              icon: ClipboardCheck,
              onSelect: () =>
                navigate('/bed-management?action=inspect', {
                  id: 'action-hallway-inspect',
                  label: 'Đi Kiểm Phòng Thực Địa',
                  sublabel: 'Kiểm phòng theo hành lang',
                }),
            },
            {
              id: 'action-group-intake',
              group: 'action' as const,
              label: 'Trợ Lý Đón Đoàn & Tự Động Xếp Giường Hàng Loạt',
              sublabel: 'Dự báo sức chứa Nam/Nữ, đặt giữ chỗ & gán giường liền kề',
              icon: Sparkles,
              onSelect: () =>
                navigate('/bed-management?action=group-intake', {
                  id: 'action-group-intake',
                  label: 'Trợ Lý Đón Đoàn & Xếp Giường',
                  sublabel: 'Dự báo sức chứa & xếp giường hàng loạt',
                }),
            },
            {
              id: 'action-quick-reentry',
              group: 'action' as const,
              label: 'Tái Nhập KTX 1 Chạm / Khôi Phục Check-out',
              sublabel: 'Tìm công nhân đã rời KTX để điền sẵn hồ sơ & kiểm tra Blacklist',
              icon: RotateCcw,
              onSelect: () =>
                navigate('/worker-management?open=reentry', {
                  id: 'action-quick-reentry',
                  label: 'Tái Nhập KTX 1 Chạm',
                  sublabel: 'Khôi phục hồ sơ công nhân cũ',
                }),
            },
            {
              id: 'action-overdue-tamtru',
              group: 'action' as const,
              label: 'Lọc nhanh: Công nhân quá hạn tạm trú (>7 ngày)',
              sublabel: 'Mở ngay danh sách chưa đăng ký tạm trú quá hạn',
              icon: Clock,
              onSelect: () => navigate('/worker-management?quick=overdue_tamtru'),
            },
            {
              id: 'action-no-bed',
              group: 'action' as const,
              label: 'Lọc nhanh: Công nhân chưa gắn giường',
              sublabel: 'Rà soát & bổ sung vị trí giường còn trống',
              icon: BedDouble,
              onSelect: () => navigate('/worker-management?quick=no_bed'),
            },
            {
              id: 'action-hygiene',
              group: 'action' as const,
              label: 'Làm sạch & Chuẩn hóa Dữ liệu (Auto-Fix)',
              sublabel: 'Rà trùng CCCD/SĐT, viết hoa chuẩn tên & gộp tên đơn vị sai chính tả',
              icon: Sparkles,
              onSelect: () => navigate('/worker-management?open=hygiene'),
            },
            {
              id: 'action-consolidate',
              group: 'action' as const,
              label: 'Dồn phòng thông minh (Smart Defragmentation)',
              sublabel: 'Tự động gom phòng thưa người để giải phóng phòng trống nguyên căn',
              icon: Minimize2,
              onSelect: () => navigate('/bed-management?action=consolidate'),
            },
          ]
        : []),
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
    [isTechnician, navigate, themeMode, toggleTheme, refreshWorkers, refreshing]
  );

  const workerMatches: CommandItem[] = useMemo(() => {
    if (isTechnician) return [];
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
      const loc = [w.ktx, w.day, w.phongSo ? `P.${w.phongSo}` : '', w.giuong ? `G${w.giuong.replace(/^(?:giường|giuong|g[.\s]*)\s*/i, '').trim()}` : '']
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
  }, [isTechnician, query, workers, navigate]);

  const roomMatches: CommandItem[] = useMemo(() => {
    const q = stripVN(query.trim());
    if (!q || roomsCatalog.length === 0) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const matched = roomsCatalog
      .filter(f => {
        if (f.is_visible === false) return false;
        const normR = normalizeRoomLabel(f.phong_khu_vuc);
        const hay = stripVN(
          `${f.ktx} ${f.day} phong ${normR} p.${normR} p${normR} ${f.phong_khu_vuc} ${f.ghi_chu || ''}`
        );
        return tokens.every(tok => hay.includes(tok));
      })
      .slice(0, 6);

    return matched.map(f => {
      const normR = normalizeRoomLabel(f.phong_khu_vuc);
      const roomLabel = formatRoomDisplay(f.phong_khu_vuc);
      return {
        id: `room-${f.id}`,
        group: 'room' as const,
        label: `${f.day} · ${roomLabel}`,
        sublabel: `${f.ktx} · ${f.giuong || 20} chỗ · Mở trực tiếp trong Phòng 3D`,
        badge: (
          <div className="flex items-center gap-1.5">
            <MonoChip tone="blue">Phòng 3D</MonoChip>
          </div>
        ),
        icon: DoorOpen,
        onSelect: () =>
          navigate(
            `/ktx-3d?ktx=${encodeURIComponent(f.ktx)}&day=${encodeURIComponent(f.day)}&room=${encodeURIComponent(normR)}`
          ),
      };
    });
  }, [query, roomsCatalog, navigate]);

  const teamMatches: CommandItem[] = useMemo(() => {
    if (isTechnician) return [];
    const q = stripVN(query.trim());
    if (!q || q.length < 2) return [];
    const teamCounts = new Map<string, { label: string; kind: 'Tổ trưởng' | 'Đơn vị'; count: number }>();
    for (const w of workers) {
      if (w.ngayRaKTX) continue;
      if (w.toTruong?.trim()) {
        const key = `tt:${stripVN(w.toTruong.trim())}`;
        const prev = teamCounts.get(key);
        teamCounts.set(key, {
          label: w.toTruong.trim(),
          kind: 'Tổ trưởng',
          count: (prev?.count || 0) + 1,
        });
      }
      if (w.donVi?.trim()) {
        const key = `dv:${stripVN(w.donVi.trim())}`;
        const prev = teamCounts.get(key);
        teamCounts.set(key, {
          label: w.donVi.trim(),
          kind: 'Đơn vị',
          count: (prev?.count || 0) + 1,
        });
      }
    }
    return Array.from(teamCounts.entries())
      .filter(([, v]) => stripVN(v.label).includes(q))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([key, v]) => ({
        id: `team-${key}`,
        group: 'team' as const,
        label: v.label,
        sublabel: `${v.kind} · ${v.count} công nhân đang ở KTX`,
        badge: <MonoChip tone="blue">{v.kind}</MonoChip>,
        icon: Users2,
        onSelect: () =>
          navigate(`/worker-management?search=${encodeURIComponent(v.label)}`, {
            id: `team-${key}`,
            label: `${v.kind}: ${v.label}`,
            sublabel: `${v.count} công nhân`,
          }),
      }));
  }, [isTechnician, query, workers, navigate]);

  const ticketMatches: CommandItem[] = useMemo(() => {
    const q = stripVN(query.trim());
    if (!q || activeTickets.length === 0) return [];
    return activeTickets
      .filter(t => {
        const hay = stripVN(
          `${t.ticket_code} ${t.ktx} ${t.day} ${t.phong_so} ${t.description} ${getTicketCategoryShortLabel(t.category)}`
        );
        return hay.includes(q);
      })
      .slice(0, 4)
      .map(t => ({
        id: `ticket-${t.id}`,
        group: 'ticket' as const,
        label: `${t.ticket_code} · ${t.day} · ${formatRoomDisplay(t.phong_so)}`,
        sublabel: `${getTicketCategoryShortLabel(t.category)} — ${t.description}`,
        badge: (
          <StatusTag tone={t.priority === 'urgent' ? 'rose' : 'amber'}>
            {t.status === 'in_progress' ? 'Đang sửa' : 'Chờ xử lý'}
          </StatusTag>
        ),
        icon: Wrench,
        onSelect: () =>
          navigate('/maintenance', {
            id: `ticket-${t.id}`,
            label: `Phiếu ${t.ticket_code}`,
            sublabel: `${t.day} · ${formatRoomDisplay(t.phong_so)}`,
          }),
      }));
  }, [query, activeTickets, navigate]);

  const recentItems: CommandItem[] = useMemo(() => {
    if (query.trim()) return [];
    return recentRecords.map(r => ({
      id: `recent-${r.id}`,
      group: 'recent' as const,
      label: r.label,
      sublabel: r.sublabel || 'Truy cập gần đây',
      icon: Clock,
      onSelect: () => navigate(r.href),
    }));
  }, [query, recentRecords, navigate]);

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
    () => [
      ...recentItems,
      ...roomMatches,
      ...workerMatches,
      ...teamMatches,
      ...ticketMatches,
      ...filteredRoutes,
      ...filteredActions,
    ],
    [recentItems, roomMatches, workerMatches, teamMatches, ticketMatches, filteredRoutes, filteredActions]
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] sm:pt-[12vh] px-3 sm:px-4">
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        className="fixed inset-0 modal-backdrop-scrim fade-in"
        aria-hidden="true"
      />

      {/* Palette Dialog */}
      <div
        role="dialog"
        aria-label="Tìm kiếm nhanh toàn hệ thống"
        className="relative z-10 w-full max-w-2xl surface-elevated rounded-2xl overflow-hidden shadow-2xl border border-bdr3 modal-enter"
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
                placeholder={
                  isTechnician
                    ? 'Tìm phòng KTX (vd: Dãy 1 P.03), mở bản đồ 3D hoặc Trung tâm kỹ thuật...'
                    : 'Tìm công nhân (tên, mã NV, CCCD, phòng), chuyển trang hoặc thao tác nhanh...'
                }
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
                  {renderSection('Truy cập gần đây', recentItems)}
                  {renderSection(`Phòng KTX → Mở 3D (${roomMatches.length})`, roomMatches)}
                  {renderSection(`Công nhân (${workerMatches.length})`, workerMatches)}
                  {renderSection(`Tổ trưởng & Đơn vị (${teamMatches.length})`, teamMatches)}
                  {renderSection(`Phiếu bảo trì đang mở (${ticketMatches.length})`, ticketMatches)}
                  {renderSection('Điều hướng nhanh', filteredRoutes)}
                  {renderSection('Tiện ích & Lệnh nhanh', filteredActions)}
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
          </div>
        </div>
  );
}
