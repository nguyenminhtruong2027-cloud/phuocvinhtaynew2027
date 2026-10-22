'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  UserCheck, Users, Shield, CheckCircle2, AlertCircle, Search,
  Phone, Mail, ArrowRight, UserPlus, X,
  Calendar, RefreshCw, Radio, Copy, Check, Database,
  Building2, MapPin, Coffee, Layers, Filter, Sparkles,
  ChevronRight, CheckCircle, Tag
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  DutyKtx,
  SpecialistWithDuty,
  getTodayDateVietnam,
  fetchDutyAssignmentsFromSupabase,
  upsertDutyAssignmentToSupabase,
  batchUpsertDutyAssignmentsToSupabase
} from '@/lib/dutyRoster';
import { useKtxStructure } from '@/lib/ktxStructure';

interface SpecialistItem {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'admin' | 'staff';
  assignedBlocks?: string[];
}

interface ExecutiveSpecialistsCardProps {
  specialists?: SpecialistItem[];
  onDutyRosterChange?: (specialists: SpecialistWithDuty[]) => void;
}

const SQL_SNIPPET = `-- Chạy đoạn mã này trong Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS public.duty_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    duty_date DATE NOT NULL DEFAULT (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    duty_ktx TEXT NOT NULL DEFAULT 'Nghỉ',
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_duty_date_profile UNIQUE (duty_date, profile_id)
);
ALTER TABLE public.duty_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read duty_assignments for all" ON public.duty_assignments;
CREATE POLICY "Allow read duty_assignments for all" ON public.duty_assignments FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admin to insert duty_assignments" ON public.duty_assignments;
CREATE POLICY "Allow admin to insert duty_assignments" ON public.duty_assignments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "Allow admin to update duty_assignments" ON public.duty_assignments;
CREATE POLICY "Allow admin to update duty_assignments" ON public.duty_assignments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "Allow admin to delete duty_assignments" ON public.duty_assignments;
CREATE POLICY "Allow admin to delete duty_assignments" ON public.duty_assignments FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'duty_assignments') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.duty_assignments;
    END IF;
END $$;`;

/** Helper to provide consistent, prominent theme colors for KTX 1, KTX 2, KTX 3, etc. */
function getKtxTheme(ktxName: string) {
  const norm = (ktxName || '').trim().toUpperCase();
  if (norm.includes('1') || norm === 'KTX 1') {
    return {
      name: ktxName,
      badgeBg: 'bg-blue-500/25 text-blue-200 border-blue-400/60 shadow-sm shadow-blue-500/20 font-bold',
      activeTab: 'bg-blue-600 text-white shadow-md shadow-blue-500/30 border-blue-400 font-extrabold',
      headerBg: 'bg-gradient-to-r from-blue-950/70 to-blue-900/40 border-blue-500/50 text-blue-200',
      sectionBg: 'bg-blue-950/20 border-blue-500/30',
      accentColor: 'text-blue-400',
      lightAccent: 'text-blue-200',
      dotColor: 'bg-blue-400',
      borderGlow: 'hover:border-blue-400/70 hover:shadow-blue-500/10',
      ringColor: 'ring-blue-500/40',
      chipBg: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
      solidBadge: 'bg-blue-600 text-white shadow-sm font-bold',
    };
  }
  if (norm.includes('2') || norm === 'KTX 2') {
    return {
      name: ktxName,
      badgeBg: 'bg-amber-500/25 text-amber-200 border-amber-400/60 shadow-sm shadow-amber-500/20 font-bold',
      activeTab: 'bg-amber-600 text-white shadow-md shadow-amber-500/30 border-amber-400 font-extrabold',
      headerBg: 'bg-gradient-to-r from-amber-950/70 to-amber-900/40 border-amber-500/50 text-amber-200',
      sectionBg: 'bg-amber-950/20 border-amber-500/30',
      accentColor: 'text-amber-400',
      lightAccent: 'text-amber-200',
      dotColor: 'bg-amber-400',
      borderGlow: 'hover:border-amber-400/70 hover:shadow-amber-500/10',
      ringColor: 'ring-amber-500/40',
      chipBg: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      solidBadge: 'bg-amber-600 text-white shadow-sm font-bold',
    };
  }
  if (norm.includes('3') || norm === 'KTX 3') {
    return {
      name: ktxName,
      badgeBg: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/60 shadow-sm shadow-emerald-500/20 font-bold',
      activeTab: 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30 border-emerald-400 font-extrabold',
      headerBg: 'bg-gradient-to-r from-emerald-950/70 to-emerald-900/40 border-emerald-500/50 text-emerald-200',
      sectionBg: 'bg-emerald-950/20 border-emerald-500/30',
      accentColor: 'text-emerald-400',
      lightAccent: 'text-emerald-200',
      dotColor: 'bg-emerald-400',
      borderGlow: 'hover:border-emerald-400/70 hover:shadow-emerald-500/10',
      ringColor: 'ring-emerald-500/40',
      chipBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      solidBadge: 'bg-emerald-600 text-white shadow-sm font-bold',
    };
  }
  return {
    name: ktxName,
    badgeBg: 'bg-purple-500/25 text-purple-200 border-purple-400/60 shadow-sm shadow-purple-500/20 font-bold',
    activeTab: 'bg-purple-600 text-white shadow-md shadow-purple-500/30 border-purple-400 font-extrabold',
    headerBg: 'bg-gradient-to-r from-purple-950/70 to-purple-900/40 border-purple-500/50 text-purple-200',
    sectionBg: 'bg-purple-950/20 border-purple-500/30',
    accentColor: 'text-purple-400',
    lightAccent: 'text-purple-200',
    dotColor: 'bg-purple-400',
    borderGlow: 'hover:border-purple-400/70 hover:shadow-purple-500/10',
    ringColor: 'ring-purple-500/40',
    chipBg: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
    solidBadge: 'bg-purple-600 text-white shadow-sm font-bold',
  };
}

const DEFAULT_FALLBACK_SPECIALISTS: SpecialistItem[] = [
  {
    id: 'admin-pvt-master',
    name: 'Quản Trị Viên Phước Vĩnh Tây',
    email: 'adminpvt@ktx.com',
    role: 'admin',
    assignedBlocks: [],
  },
  {
    id: 'staff-pvt-01',
    name: 'Nguyễn Văn Hùng (Bảo Vệ / Quản Lý)',
    email: 'staffpvt@ktx.com',
    role: 'staff',
    assignedBlocks: ['KTX 1 - Dãy 1', 'KTX 1 - Dãy 2', 'KTX 1 - Dãy 3'],
  },
  {
    id: 'staff-pvt-02',
    name: 'Trần Văn Toàn (Quản Lý Dãy)',
    email: 'toantran@ktx.com',
    role: 'staff',
    assignedBlocks: ['KTX 2 - Dãy 1', 'KTX 2 - Dãy 2'],
  },
  {
    id: 'staff-pvt-03',
    name: 'Lê Thị Mai (Quản Lý Dãy)',
    email: 'maile@ktx.com',
    role: 'staff',
    assignedBlocks: ['KTX 3 - Dãy 1', 'KTX 3 - Dãy 2'],
  },
];

export default function ExecutiveSpecialistsCard({
  specialists: propsSpecialists,
  onDutyRosterChange,
}: ExecutiveSpecialistsCardProps) {
  const { user, currentUser, isAdmin } = useAuth();
  const router = useRouter();
  const { ktxNames } = useKtxStructure();

  // Local state
  const [internalProfiles, setInternalProfiles] = useState<SpecialistItem[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_profiles') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p, idx) => ({
            id: p.id || `sp-${idx}`,
            name: p.full_name || p.name || p.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
            email: p.email,
            role: (p.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff',
            assignedBlocks: p.assigned_blocks || [],
          }));
        }
      }
    } catch {}
    return DEFAULT_FALLBACK_SPECIALISTS;
  });
  const [dutyMap, setDutyMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isTableMissing, setIsTableMissing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  
  // Filtering & View Modes
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [cardKtxFilter, setCardKtxFilter] = useState<string>('all');
  const [modalViewMode, setModalViewMode] = useState<'grouped' | 'list'>('grouped');
  const [cardViewMode, setCardViewMode] = useState<'grouped' | 'list'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const todayDate = useMemo(() => getTodayDateVietnam(), []);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  }, []);

  // 1. Fetch profiles directly if not provided via props
  const loadProfiles = useCallback(async () => {
    let localFormatted: SpecialistItem[] = DEFAULT_FALLBACK_SPECIALISTS;
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_profiles') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localFormatted = parsed.map((p, idx) => ({
            id: p.id || `sp-${idx}`,
            name: p.full_name || p.name || p.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
            email: p.email,
            role: (p.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff',
            assignedBlocks: p.assigned_blocks || [],
          }));
        }
      }
    } catch {}

    try {
      const supabase = createClient();
      const fetchPromise = supabase
        .from('profiles')
        .select('id, full_name, email, role, assigned_blocks')
        .order('role', { ascending: true })
        .order('full_name', { ascending: true });

      const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 2500)
      );

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

      if (!error && data && Array.isArray(data) && data.length > 0) {
        const map = new Map<string, SpecialistItem>();
        localFormatted.forEach(s => { if (s.email) map.set(s.email.toLowerCase(), s); });
        data.forEach((p, idx) => {
          const blocks: string[] = Array.isArray(p.assigned_blocks) ? p.assigned_blocks : [];
          const item: SpecialistItem = {
            id: p.id,
            name: p.full_name || p.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
            email: p.email || undefined,
            role: (p.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff',
            assignedBlocks: blocks,
          };
          if (p.email) map.set(p.email.toLowerCase(), item);
        });
        setInternalProfiles(Array.from(map.values()));
      } else {
        setInternalProfiles(localFormatted);
      }
    } catch {
      setInternalProfiles(localFormatted);
    }
  }, []);

  // 2. Fetch duty assignments for today
  const loadDutyAssignments = useCallback(async (showSyncIndicator = false) => {
    if (showSyncIndicator) setSyncing(true);
    try {
      const { data, isTableMissing: missing } = await fetchDutyAssignmentsFromSupabase(todayDate);
      setIsTableMissing(missing);
      if (data) {
        setDutyMap(prev => ({ ...prev, ...data }));
      }
    } finally {
      if (showSyncIndicator) {
        setTimeout(() => setSyncing(false), 500);
      }
      setLoading(false);
    }
  }, [todayDate]);

  // Initial load
  useEffect(() => {
    loadProfiles();
    loadDutyAssignments();
  }, [loadProfiles, loadDutyAssignments]);

  // 3. Supabase Realtime Subscription + Local Storage sync for table `duty_assignments`
  useEffect(() => {
    const supabase = createClient();
    let channel: any = null;
    try {
      channel = supabase
        .channel('duty_assignments_realtime_channel')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'duty_assignments',
          },
          () => {
            loadDutyAssignments();
          }
        )
        .subscribe();
    } catch {
      // Ignore channel setup errors if table is not in publication yet
    }

    const handleFocus = () => {
      loadDutyAssignments();
      loadProfiles();
    };

    const handleDutyEvent = (e: any) => {
      if (e?.detail?.map) {
        setDutyMap(prev => ({ ...prev, ...e.detail.map }));
      }
    };

    const handleProfilesEvent = () => {
      loadProfiles();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('ktx_duty_updated', handleDutyEvent);
    window.addEventListener('ktx_profiles_updated', handleProfilesEvent);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    });

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('ktx_duty_updated', handleDutyEvent);
      window.removeEventListener('ktx_profiles_updated', handleProfilesEvent);
    };
  }, [loadDutyAssignments, loadProfiles]);

  const baseSpecialistsList = useMemo<SpecialistItem[]>(() => {
    if (propsSpecialists && propsSpecialists.length > 0) {
      return propsSpecialists;
    }
    if (internalProfiles && internalProfiles.length > 0) {
      return internalProfiles;
    }
    return DEFAULT_FALLBACK_SPECIALISTS;
  }, [propsSpecialists, internalProfiles]);

  // Merge specialist list with duty assignment from database/localStorage
  // Rule: If no row exists in duty_assignments for today, status is 'off_duty' ('Nghỉ')
  const mergedSpecialists = useMemo<SpecialistWithDuty[]>(() => {
    return baseSpecialistsList.map(sp => {
      const assignedKtx = dutyMap[sp.id];
      const isAssignedOnDuty = Boolean(assignedKtx && assignedKtx !== 'Nghỉ');
      const effectiveDutyKtx = isAssignedOnDuty ? assignedKtx : 'Nghỉ';

      return {
        id: sp.id,
        name: sp.name,
        email: sp.email,
        phone: sp.phone || '0988 123 456',
        role: sp.role,
        assignedBlocks: sp.role === 'admin' ? [] : (sp.assignedBlocks ?? []),
        dutyKtx: effectiveDutyKtx,
        status: isAssignedOnDuty ? 'on_duty' : 'off_duty',
      };
    });
  }, [baseSpecialistsList, dutyMap]);

  useEffect(() => {
    if (onDutyRosterChange) {
      onDutyRosterChange(mergedSpecialists);
    }
  }, [mergedSpecialists, onDutyRosterChange]);

  // Copy SQL helper
  const handleCopySql = () => {
    navigator.clipboard.writeText(SQL_SNIPPET);
    setCopiedSql(true);
    showToast('Đã sao chép câu lệnh SQL vào clipboard!', 'success');
    setTimeout(() => setCopiedSql(false), 2500);
  };

  // Update a single specialist's duty assignment
  const updateDuty = useCallback(async (
    id: string,
    dutyKtx: string,
    specialistName?: string
  ) => {
    const isOff = dutyKtx === 'Nghỉ' || !dutyKtx.trim();
    const targetKtx = isOff ? 'Nghỉ' : dutyKtx.trim();

    // Optimistic UI update - persists in memory and localStorage
    setDutyMap(prev => ({ ...prev, [id]: targetKtx }));

    const res = await upsertDutyAssignmentToSupabase(
      id,
      targetKtx,
      currentUser?.id || user?.id || null,
      todayDate
    );

    if (res.isTableMissing) {
      setIsTableMissing(true);
    } else {
      setIsTableMissing(false);
    }

    const actionText = isOff ? 'Nghỉ ca' : `Trực ${targetKtx}`;
    showToast(`Đã lưu: ${specialistName || 'Chuyên viên'} → ${actionText}`, 'success');
  }, [currentUser?.id, user?.id, todayDate, showToast]);

  // Batch assign duty to all specialists
  const handleBatchDuty = async (targetKtx: string) => {
    const isOff = targetKtx === 'Nghỉ';
    const effectiveKtx = isOff ? 'Nghỉ' : targetKtx.trim();
    const allIds = mergedSpecialists.map(s => s.id);

    // Optimistic update
    const nextMap: Record<string, string> = { ...dutyMap };
    allIds.forEach(id => {
      nextMap[id] = effectiveKtx;
    });
    setDutyMap(nextMap);

    const res = await batchUpsertDutyAssignmentsToSupabase(
      allIds,
      effectiveKtx,
      currentUser?.id || user?.id || null,
      todayDate
    );

    if (res.isTableMissing) {
      setIsTableMissing(true);
    } else {
      setIsTableMissing(false);
    }

    showToast(isOff ? 'Đã chuyển tất cả chuyên viên sang Nghỉ ca' : `Đã phân công tất cả chuyên viên trực ${effectiveKtx}`, 'success');
  };

  const onDutyList = useMemo(() => mergedSpecialists.filter(s => s.status === 'on_duty' && s.dutyKtx !== 'Nghỉ'), [mergedSpecialists]);
  const offDutyList = useMemo(() => mergedSpecialists.filter(s => s.status === 'off_duty' || s.dutyKtx === 'Nghỉ'), [mergedSpecialists]);

  // Unique KTX values currently in use across duty assignments
  const activeKtxList = useMemo(() => {
    const set = new Set<string>();
    mergedSpecialists.forEach(s => {
      if (s.dutyKtx && s.dutyKtx !== 'Nghỉ') set.add(s.dutyKtx);
    });
    return Array.from(set);
  }, [mergedSpecialists]);

  // Dynamic KTX options list: combines ktxStructure and active duty values
  const availableKtxOptions = useMemo(() => {
    const set = new Set<string>(ktxNames);
    activeKtxList.forEach(k => {
      if (k && k !== 'Nghỉ') set.add(k);
    });
    return Array.from(set);
  }, [ktxNames, activeKtxList]);

  // Count specialists per KTX for fast badges
  const countsPerKtx = useMemo(() => {
    const map: Record<string, number> = {};
    availableKtxOptions.forEach(ktx => {
      map[ktx] = mergedSpecialists.filter(s => s.dutyKtx === ktx).length;
    });
    return map;
  }, [availableKtxOptions, mergedSpecialists]);

  // Filtered list for the outside card
  const cardFilteredList = useMemo(() => {
    if (cardKtxFilter === 'all') return mergedSpecialists;
    if (cardKtxFilter === 'off_duty') return offDutyList;
    return mergedSpecialists.filter(s => s.dutyKtx === cardKtxFilter);
  }, [mergedSpecialists, offDutyList, cardKtxFilter]);

  // Filtered list for the detailed modal
  const modalFilteredList = useMemo(() => {
    return mergedSpecialists.filter(sp => {
      const isOnDuty = sp.status === 'on_duty' && sp.dutyKtx !== 'Nghỉ';

      if (activeFilter === 'on_duty' && !isOnDuty) return false;
      if (activeFilter === 'off_duty' && isOnDuty) return false;
      if (activeFilter !== 'all' && activeFilter !== 'on_duty' && activeFilter !== 'off_duty') {
        if (sp.dutyKtx !== activeFilter) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = sp.name.toLowerCase().includes(q);
        const matchEmail = sp.email?.toLowerCase().includes(q);
        const matchDuty = sp.dutyKtx.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchDuty) return false;
      }

      return true;
    });
  }, [mergedSpecialists, activeFilter, searchQuery]);

  // Grouping structure for KTX sections (both in Modal and widget if grouped)
  const groupedSections = useMemo(() => {
    const sections: {
      key: string;
      title: string;
      subtitle: string;
      ktx: string;
      specialists: SpecialistWithDuty[];
      isOffDuty?: boolean;
    }[] = [];

    // Add section for each available KTX
    availableKtxOptions.forEach(ktx => {
      const list = modalFilteredList.filter(s => s.dutyKtx === ktx);
      sections.push({
        key: ktx,
        title: `Khu Vực ${ktx}`,
        subtitle: `${list.length} chuyên viên đang trực hôm nay`,
        ktx,
        specialists: list,
      });
    });

    // Add section for Off-Duty
    const offList = modalFilteredList.filter(s => s.dutyKtx === 'Nghỉ' || s.status === 'off_duty');
    if (offList.length > 0 || availableKtxOptions.length === 0) {
      sections.push({
        key: 'off_duty',
        title: 'Nghỉ Ca / Chưa Phân Công',
        subtitle: `${offList.length} nhân sự nghỉ ca`,
        ktx: 'Nghỉ',
        specialists: offList,
        isOffDuty: true,
      });
    }

    return sections;
  }, [availableKtxOptions, modalFilteredList]);

  // Render a Single Specialist Card (used in modal and list views)
  const renderSpecialistItem = (sp: SpecialistWithDuty, showFullContact = true) => {
    const isAdminUser = sp.role === 'admin';
    const isOnDuty = sp.status === 'on_duty' && sp.dutyKtx !== 'Nghỉ';
    const theme = isOnDuty ? getKtxTheme(sp.dutyKtx) : null;

    return (
      <div
        key={sp.id}
        className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 rounded-xl border transition-all duration-150 gap-3 w-full ${
          isOnDuty
            ? `bg-gray-800/90 border-gray-700/90 ${theme?.borderGlow || 'hover:border-blue-500/50'} shadow-sm`
            : 'bg-gray-800/40 border-gray-750 hover:border-gray-700 opacity-90'
        }`}
      >
        {/* Left: Avatar, Name, Prominent KTX Duty Tag, Role, Contact, Assigned Blocks */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="relative flex-shrink-0 mt-0.5">
            <div className={`w-10 h-10 rounded-xl border font-bold text-sm flex items-center justify-center shadow-inner ${
              isAdminUser
                ? 'bg-purple-600/30 border-purple-500/50 text-purple-200'
                : isOnDuty
                ? `${theme?.badgeBg}`
                : 'bg-blue-600/25 border-blue-500/40 text-blue-300'
            }`}>
              {sp.name.charAt(0).toUpperCase()}
            </div>
            <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-gray-900 shadow-sm ${
              isOnDuty ? `${theme?.dotColor || 'bg-emerald-400'} animate-pulse` : 'bg-gray-500'
            }`} />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm sm:text-base font-bold text-white whitespace-normal break-words leading-snug">
                {sp.name}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                isAdminUser
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
              }`}>
                {isAdminUser ? 'Quản trị viên' : 'Chuyên viên'}
              </span>

              {/* ── HIGH VISIBILITY PROMINENT KTX DUTY BADGE ── */}
              {isOnDuty ? (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border shadow-sm ${theme?.badgeBg}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${theme?.dotColor} animate-ping shrink-0`} />
                  <Building2 size={12} className={theme?.accentColor} />
                  <span>ĐANG TRỰC {sp.dutyKtx.toUpperCase()}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-700/60 text-gray-400 border border-gray-600/40 shrink-0">
                  <Coffee size={11} className="text-gray-400" />
                  <span>Nghỉ ca hôm nay</span>
                </span>
              )}
            </div>

            {/* Contact Information */}
            {showFullContact && (
              <div className="flex items-center gap-x-3 gap-y-1 text-xs text-gray-300 flex-wrap pt-0.5">
                {sp.email && (
                  <span className="flex items-center gap-1 whitespace-normal break-all text-gray-300">
                    <Mail size={12} className="text-gray-400 shrink-0" />
                    <span>{sp.email}</span>
                  </span>
                )}
                {sp.phone && (
                  <span className="flex items-center gap-1 font-tabular text-gray-300">
                    <Phone size={12} className="text-gray-400 shrink-0" />
                    <span>{sp.phone}</span>
                  </span>
                )}
              </div>
            )}

            {/* Staff Assigned Regular Blocks */}
            {!isAdminUser && sp.assignedBlocks && sp.assignedBlocks.length > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-gray-400 flex-wrap pt-0.5">
                <span className="font-semibold text-gray-400">Phụ trách dãy:</span>
                {sp.assignedBlocks.map(b => (
                  <span key={b} className="px-1.5 py-0.5 rounded bg-gray-750 text-gray-300 border border-gray-650 text-[10px] font-semibold">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Dynamic KTX Duty Selector & Quick Action (Admin Only) */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-gray-750/70 w-full sm:w-auto shrink-0">
          <div className="space-y-1 flex-1 sm:flex-initial sm:min-w-[180px]">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              PHÂN CÔNG TRỰC BAN
            </label>
            {isAdmin ? (
              <select
                value={isOnDuty ? sp.dutyKtx : 'Nghỉ'}
                onChange={(e) => updateDuty(sp.id, e.target.value, sp.name)}
                className={`w-full bg-gray-750 border rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer ${
                  isOnDuty
                    ? `${theme?.badgeBg || 'text-blue-300 border-blue-500/40'}`
                    : 'text-gray-400 border-gray-650'
                }`}
              >
                {availableKtxOptions.map(ktx => (
                  <option key={ktx} value={ktx} className="bg-gray-800 text-white font-semibold">
                    Trực {ktx}
                  </option>
                ))}
                {sp.dutyKtx && !availableKtxOptions.includes(sp.dutyKtx) && sp.dutyKtx !== 'Nghỉ' && (
                  <option value={sp.dutyKtx} className="bg-gray-800 text-emerald-300 font-semibold">
                    Trực {sp.dutyKtx}
                  </option>
                )}
                <option value="Nghỉ" className="bg-gray-800 text-gray-400">
                  Nghỉ ca
                </option>
              </select>
            ) : (
              <span className={`inline-block px-3 py-1 rounded-lg text-xs font-bold border ${
                isOnDuty ? `${theme?.badgeBg}` : 'bg-gray-750 text-gray-400 border-gray-650'
              }`}>
                {isOnDuty ? `Trực ${sp.dutyKtx}` : 'Nghỉ ca'}
              </span>
            )}
          </div>

          {/* Quick Action Toggle Button (Admin Only) */}
          {isAdmin && (
            <div className="pt-4 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (isOnDuty) {
                    updateDuty(sp.id, 'Nghỉ', sp.name);
                  } else {
                    const targetKtx = availableKtxOptions[0] || (ktxNames.length > 0 ? ktxNames[0] : 'Trực');
                    updateDuty(sp.id, targetKtx, sp.name);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer select-none active:scale-95 ${
                  isOnDuty
                    ? 'bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25'
                    : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30'
                }`}
              >
                {isOnDuty ? 'Cho nghỉ' : 'Bật trực'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* ── Realtime Toast Notification ── */}
      {toastMessage && (
        <div className={`fixed bottom-5 right-5 z-[100] flex items-center gap-2.5 px-4 py-3 border rounded-xl shadow-2xl animate-fade-in backdrop-blur-md max-w-[90vw] ${
          toastMessage.type === 'error'
            ? 'bg-red-950/95 border-red-500/70 text-red-200'
            : toastMessage.type === 'warning'
            ? 'bg-amber-950/95 border-amber-500/70 text-amber-200'
            : 'bg-gray-900/95 border-emerald-500/60 text-white'
        }`}>
          {toastMessage.type === 'error' ? (
            <AlertCircle size={17} className="text-red-400 flex-shrink-0" />
          ) : toastMessage.type === 'warning' ? (
            <AlertCircle size={17} className="text-amber-400 flex-shrink-0" />
          ) : (
            <CheckCircle2 size={17} className="text-emerald-400 flex-shrink-0" />
          )}
          <span className="text-xs font-semibold whitespace-normal break-words">{toastMessage.text}</span>
          {isTableMissing && (
            <button
              onClick={() => setShowSqlModal(true)}
              className="ml-2 px-2 py-0.5 rounded bg-amber-500/30 text-amber-200 hover:bg-amber-500/50 text-[11px] font-bold underline cursor-pointer shrink-0"
            >
              Xem SQL
            </button>
          )}
        </div>
      )}

      {/* ── Main Executive Card on Dashboard (Widget Thu Gọn Bên Ngoài) ── */}
      <div className="rounded-2xl border border-gray-700/60 bg-[#1F2937] p-3.5 sm:p-5 shadow-xl transition-all duration-200 hover:border-blue-500/40 hover:shadow-2xl flex flex-col justify-between group w-full">
        <div>
          {/* Card Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400 group-hover:text-blue-300 transition-colors block">
                  Danh Sách Các Chuyên Viên
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-medium">
                  <Radio size={10} className="text-emerald-400 animate-pulse" />
                  Realtime
                </span>
                {isTableMissing && isAdmin && (
                  <button
                    onClick={() => setShowSqlModal(true)}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold hover:bg-amber-500/30 cursor-pointer"
                    title="Bảng duty_assignments chưa khởi tạo trên Supabase. Bấm để lấy câu lệnh SQL."
                  >
                    <Database size={10} />
                    <span>Cần chạy SQL</span>
                  </button>
                )}
              </div>

              <div className="flex items-baseline gap-2 sm:gap-2.5 flex-wrap">
                <p className="text-2xl sm:text-4xl font-extrabold font-tabular tracking-tight text-white">
                  {mergedSpecialists.length}
                </p>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    {onDutyList.length} trực ban hôm nay
                  </span>
                  {offDutyList.length > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-700/60 text-gray-400 border border-gray-600/40">
                      {offDutyList.length} nghỉ ca
                    </span>
                  )}
                </div>
              </div>

              {/* Sub-breakdown per KTX Area (KTX 1, KTX 2, KTX 3...) */}
              <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap pt-0.5">
                <span className="font-medium text-gray-400">Phân công ({todayDate}):</span>
                {availableKtxOptions.map(ktx => {
                  const cnt = countsPerKtx[ktx] || 0;
                  const theme = getKtxTheme(ktx);
                  return (
                    <button
                      key={ktx}
                      onClick={() => setCardKtxFilter(ktx)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        cardKtxFilter === ktx
                          ? theme.activeTab
                          : cnt > 0
                          ? `${theme.badgeBg} hover:opacity-90`
                          : 'bg-gray-800 text-gray-400 border-gray-750 hover:text-gray-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cnt > 0 ? theme.dotColor : 'bg-gray-500'}`} />
                      <span>{ktx}: {cnt} trực</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => loadDutyAssignments(true)}
                disabled={syncing}
                title="Đồng bộ dữ liệu Supabase mới nhất"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center border bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white transition-all cursor-pointer shadow-sm"
              >
                <RefreshCw size={15} className={syncing ? 'animate-spin text-blue-400' : ''} />
              </button>

              <button
                onClick={() => setShowModal(true)}
                title="Mở bảng phân công trực ban theo ngày"
                className="w-11 h-11 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center flex-shrink-0 border bg-gradient-to-tr from-indigo-500/15 to-blue-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/25 hover:border-indigo-400 transition-all cursor-pointer shadow-md"
              >
                <UserCheck size={22} className="sm:w-[26px] sm:h-[26px]" />
              </button>
            </div>
          </div>

          {/* ── 1. KTX FILTER TABS INSIDE OUTSIDE CARD ── */}
          <div className="bg-gray-850/80 p-1.5 rounded-xl border border-gray-750/80 mt-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                onClick={() => setCardKtxFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  cardKtxFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                    : 'bg-gray-800/90 text-gray-300 hover:text-white border border-gray-700/60'
                }`}
              >
                Tất cả ({mergedSpecialists.length})
              </button>

              {availableKtxOptions.map(ktx => {
                const theme = getKtxTheme(ktx);
                const count = countsPerKtx[ktx] || 0;
                const isSelected = cardKtxFilter === ktx;
                return (
                  <button
                    key={ktx}
                    onClick={() => setCardKtxFilter(ktx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 border ${
                      isSelected
                        ? theme.activeTab
                        : 'bg-gray-800/90 text-gray-300 hover:text-white border-gray-700/60'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${count > 0 ? theme.dotColor : 'bg-gray-500'}`} />
                    <span>Trực {ktx} ({count})</span>
                  </button>
                );
              })}

              <button
                onClick={() => setCardKtxFilter('off_duty')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 border ${
                  cardKtxFilter === 'off_duty'
                    ? 'bg-gray-700 text-white shadow-sm font-extrabold border-gray-600'
                    : 'bg-gray-800/90 text-gray-400 hover:text-gray-200 border-gray-700/60'
                }`}
              >
                <Coffee size={12} />
                <span>Nghỉ ca ({offDutyList.length})</span>
              </button>
            </div>
          </div>

          {/* Active Filter Scope Header */}
          {cardKtxFilter !== 'all' && (
            <div className="mt-2.5 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/60 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-blue-400" />
                <span className="text-gray-300">
                  Đang lọc: <strong className="text-white">{cardKtxFilter === 'off_duty' ? 'Nghỉ ca' : `Trực ${cardKtxFilter}`}</strong> ({cardFilteredList.length} chuyên viên)
                </span>
              </div>
              <button
                onClick={() => setCardKtxFilter('all')}
                className="text-[11px] text-blue-400 hover:underline cursor-pointer font-semibold"
              >
                Xem tất cả
              </button>
            </div>
          )}

          {/* ── 2. SPECIALISTS LIST IN OUTSIDE CARD WITH PROMINENT KTX BADGES ── */}
          <div className="space-y-2 sm:space-y-2.5 mt-2.5 pt-2.5 border-t border-gray-700/60">
            {cardFilteredList.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 bg-gray-800/40 rounded-xl border border-gray-750">
                <Users size={20} className="mx-auto mb-1.5 text-gray-500" />
                <p className="font-semibold text-gray-300">
                  {cardKtxFilter === 'all'
                    ? 'Chưa có tài khoản chuyên viên trong hệ thống.'
                    : cardKtxFilter === 'off_duty'
                    ? 'Tất cả chuyên viên đều đang có ca trực hôm nay.'
                    : `Chưa có chuyên viên nào được phân công trực tại ${cardKtxFilter} hôm nay.`}
                </p>
                {isAdmin && cardKtxFilter !== 'all' && cardKtxFilter !== 'off_duty' && (
                  <button
                    onClick={() => {
                      setShowModal(true);
                      setActiveFilter(cardKtxFilter);
                    }}
                    className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-600/25 text-blue-300 border border-blue-500/40 text-xs font-bold hover:bg-blue-600/40 transition-colors cursor-pointer"
                  >
                    <span>Phân công trực {cardKtxFilter} ngay</span>
                  </button>
                )}
              </div>
            ) : (
              cardFilteredList.slice(0, 6).map((sp) => {
                const isAdminUser = sp.role === 'admin';
                const isOnDuty = sp.status === 'on_duty' && sp.dutyKtx !== 'Nghỉ';
                const theme = isOnDuty ? getKtxTheme(sp.dutyKtx) : null;

                return (
                  <div
                    key={sp.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between rounded-xl p-2.5 sm:p-3 border transition-all duration-150 gap-2 sm:gap-3 w-full ${
                      isOnDuty
                        ? `bg-gray-800/90 border-gray-700/80 ${theme?.borderGlow || 'hover:border-blue-500/50'} shadow-sm`
                        : 'bg-gray-800/50 border-gray-750 hover:border-gray-700'
                    }`}
                  >
                    {/* Left: Avatar, Name & High-Visibility Duty Label */}
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="relative flex-shrink-0 mt-0.5 sm:mt-0">
                        <div className={`w-8 h-8 rounded-lg border text-xs font-bold flex items-center justify-center ${
                          isAdminUser
                            ? 'bg-purple-600/25 border-purple-500/40 text-purple-300'
                            : isOnDuty
                            ? `${theme?.badgeBg}`
                            : 'bg-blue-600/25 border-blue-500/40 text-blue-300'
                        }`}>
                          {sp.name.charAt(0).toUpperCase()}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${
                          isOnDuty ? `${theme?.dotColor || 'bg-emerald-400'} animate-pulse` : 'bg-gray-500'
                        }`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs sm:text-sm font-bold text-gray-100 whitespace-normal break-words leading-tight">
                            {sp.name}
                          </span>
                          {isAdminUser ? (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold shrink-0">
                              Admin
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-semibold shrink-0">
                              Chuyên viên
                            </span>
                          )}

                          {/* PROMINENT KTX BADGE IN WIDGET */}
                          {isOnDuty ? (
                            <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-extrabold border ${theme?.badgeBg}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${theme?.dotColor} animate-pulse`} />
                              <span>ĐANG TRỰC {sp.dutyKtx.toUpperCase()}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md text-gray-400 bg-gray-750 border border-gray-700 font-medium">
                              <Coffee size={10} />
                              <span>Nghỉ ca</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] sm:text-[11px] text-gray-400 whitespace-normal break-words font-tabular mt-0.5">
                          {sp.email || sp.phone || 'Nhân sự vận hành KTX'}
                        </p>
                      </div>
                    </div>

                    {/* Right: Dynamic KTX Duty Selector (Admin) / Readonly Badge (Non-Admin) */}
                    <div className="flex items-center justify-between sm:justify-end gap-1.5 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-gray-750/60 flex-shrink-0">
                      {isAdmin ? (
                        <select
                          value={isOnDuty ? sp.dutyKtx : 'Nghỉ'}
                          onChange={(e) => updateDuty(sp.id, e.target.value, sp.name)}
                          className={`text-xs font-bold py-1 px-2.5 rounded-lg border cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                            isOnDuty
                              ? `${theme?.badgeBg || 'bg-blue-500/20 text-blue-300 border-blue-500/40'}`
                              : 'bg-gray-750 text-gray-400 border-gray-650 hover:bg-gray-700'
                          }`}
                        >
                          {availableKtxOptions.map(ktx => (
                            <option key={ktx} value={ktx} className="bg-gray-800 text-white font-semibold">
                              Trực {ktx}
                            </option>
                          ))}
                          <option value="Nghỉ" className="bg-gray-800 text-gray-400">
                            Nghỉ ca
                          </option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                          isOnDuty
                            ? `${theme?.badgeBg}`
                            : 'bg-gray-750 text-gray-400 border-gray-650'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnDuty ? theme?.dotColor : 'bg-gray-500'}`} />
                          <span>{isOnDuty ? `Trực ${sp.dutyKtx}` : 'Nghỉ ca'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Card Action Footer */}
        <div className="mt-3.5 pt-3 border-t border-gray-700/60 flex items-center justify-between gap-2">
          <button
            onClick={() => setShowModal(true)}
            className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1.5 transition-colors group/btn cursor-pointer"
          >
            <span>Phân công trực ban chi tiết ({mergedSpecialists.length})</span>
            <ArrowRight size={13} className="group-hover/btn:translate-x-1 transition-transform shrink-0" />
          </button>

          <button
            onClick={() => router.push('/user-management')}
            className="text-[11px] font-semibold text-gray-400 hover:text-gray-200 flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
          >
            <span>Quản lý tài khoản</span>
          </button>
        </div>
      </div>

      {/* ── MODAL CHI TIẾT: PHÂN CÔNG TRỰC BAN CHUYÊN VIÊN THEO NGÀY ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 p-2 sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm flex items-center justify-center overflow-y-auto">
          <div className="bg-[#1F2937] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col my-auto text-gray-100 overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-gray-700/80 bg-gray-800/95 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <Calendar size={20} className="sm:w-[22px] sm:h-[22px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-lg font-bold text-white tracking-tight whitespace-normal break-words">
                      Phân Công Trực Ban Chuyên Viên Theo Ngày
                    </h2>
                    <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full shrink-0">
                      {onDutyList.length}/{mergedSpecialists.length} Đang trực ban
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">
                    Ngày trực: <span className="text-blue-300 font-semibold">{todayDate}</span> · Tự động đồng bộ Supabase Realtime
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => loadDutyAssignments(true)}
                  disabled={syncing}
                  title="Tải lại từ CSDL"
                  className="w-8 h-8 rounded-lg bg-gray-750 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <RefreshCw size={14} className={syncing ? 'animate-spin text-blue-400' : ''} />
                </button>

                <button
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Warning Banner if Table is missing */}
            {isTableMissing && isAdmin && (
              <div className="px-4 py-2.5 bg-amber-950/50 border-b border-amber-500/40 flex items-center justify-between gap-3 text-xs text-amber-200">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Database size={15} className="text-amber-400 shrink-0" />
                  <span className="whitespace-normal break-words">
                    Bảng <code>duty_assignments</code> chưa được tạo trong Supabase. Vui lòng chạy lệnh SQL để lưu ca trực vĩnh viễn.
                  </span>
                </div>
                <button
                  onClick={() => setShowSqlModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/30 hover:bg-amber-500/50 text-amber-100 font-bold text-xs border border-amber-500/50 shrink-0 cursor-pointer transition-colors"
                >
                  Lấy mã SQL
                </button>
              </div>
            )}

            {/* ── GRID STATISTICS PER KTX AREA (KTX 1, KTX 2, KTX 3...) ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 p-2.5 sm:p-3 bg-gray-850/60 border-b border-gray-700/60 shrink-0 overflow-x-auto">
              <div className="bg-blue-950/30 border border-blue-500/30 rounded-xl p-2 sm:p-2.5">
                <p className="text-[10px] sm:text-[11px] font-semibold text-blue-300 uppercase">Tổng nhân sự</p>
                <p className="text-base sm:text-lg font-bold text-blue-400 font-tabular mt-0.5">{mergedSpecialists.length} người</p>
              </div>

              {availableKtxOptions.map(ktx => {
                const theme = getKtxTheme(ktx);
                const cnt = countsPerKtx[ktx] || 0;
                return (
                  <button
                    key={ktx}
                    onClick={() => setActiveFilter(ktx)}
                    className={`${theme.headerBg} border rounded-xl p-2 sm:p-2.5 text-left transition-all hover:opacity-90 cursor-pointer`}
                  >
                    <p className={`text-[10px] sm:text-[11px] font-bold ${theme.accentColor} uppercase flex items-center gap-1`}>
                      <Building2 size={11} />
                      <span>Trực {ktx}</span>
                    </p>
                    <p className={`text-base sm:text-lg font-extrabold ${theme.accentColor} font-tabular mt-0.5`}>
                      {cnt} người
                    </p>
                  </button>
                );
              })}

              <button
                onClick={() => setActiveFilter('off_duty')}
                className="bg-gray-800/80 border border-gray-700/60 rounded-xl p-2 sm:p-2.5 text-left hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <p className="text-[10px] sm:text-[11px] font-semibold text-gray-400 uppercase flex items-center gap-1">
                  <Coffee size={11} />
                  <span>Nghỉ ca</span>
                </p>
                <p className="text-base sm:text-lg font-bold text-gray-300 font-tabular mt-0.5">{offDutyList.length} người</p>
              </button>
            </div>

            {/* ── FILTER TOOLBAR & KTX SECTION TABS ── */}
            <div className="p-2.5 sm:p-3 border-b border-gray-700/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 bg-gray-800/50">
              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tìm tên, email, KTX..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 text-xs bg-gray-800 text-gray-100 placeholder-gray-400 border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Status & KTX Area Filter Tabs */}
              <div className="flex items-center gap-1.5 flex-wrap justify-between sm:justify-end flex-1">
                <div className="flex rounded-xl bg-gray-800/90 p-1 border border-gray-700/80 flex-wrap gap-1">
                  <button
                    onClick={() => setActiveFilter('all')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      activeFilter === 'all'
                        ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                        : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    Tất cả ({mergedSpecialists.length})
                  </button>

                  {/* Individual KTX Area Filter Buttons (KTX 1, KTX 2, KTX 3...) */}
                  {availableKtxOptions.map(ktx => {
                    const theme = getKtxTheme(ktx);
                    const count = countsPerKtx[ktx] || 0;
                    const isSelected = activeFilter === ktx;
                    return (
                      <button
                        key={ktx}
                        onClick={() => setActiveFilter(ktx)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border ${
                          isSelected
                            ? theme.activeTab
                            : 'bg-transparent text-gray-300 hover:text-white border-transparent hover:border-gray-700'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${count > 0 ? theme.dotColor : 'bg-gray-500'}`} />
                        <span>Trực {ktx} ({count})</span>
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setActiveFilter('off_duty')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeFilter === 'off_duty'
                        ? 'bg-gray-700 text-white shadow-sm font-extrabold'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Coffee size={12} />
                    <span>Nghỉ ({offDutyList.length})</span>
                  </button>
                </div>

                {/* Batch Actions for Admins */}
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0 flex-wrap">
                    {availableKtxOptions.map(ktx => (
                      <button
                        key={ktx}
                        onClick={() => handleBatchDuty(ktx)}
                        className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 transition-colors cursor-pointer"
                        title={`Gán tất cả chuyên viên trực ${ktx}`}
                      >
                        Tất cả trực {ktx}
                      </button>
                    ))}
                    <button
                      onClick={() => handleBatchDuty('Nghỉ')}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-gray-750 text-gray-300 border border-gray-650 hover:bg-gray-700 transition-colors cursor-pointer"
                      title="Gán tất cả chuyên viên nghỉ ca"
                    >
                      Nghỉ hết
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Active Filter Notification Bar */}
            {activeFilter !== 'all' && (
              <div className="px-4 py-2 bg-gray-850 border-b border-gray-700/60 flex items-center justify-between text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-blue-400" />
                  <span>
                    Đang hiển thị danh sách: <strong className="text-white">{activeFilter === 'off_duty' ? 'Chuyên viên nghỉ ca' : `Chuyên viên trực ${activeFilter}`}</strong> ({modalFilteredList.length} người)
                  </span>
                </div>
                <button
                  onClick={() => setActiveFilter('all')}
                  className="text-blue-400 hover:underline font-semibold cursor-pointer"
                >
                  Hiển thị tất cả
                </button>
              </div>
            )}

            {/* Scrollable Specialist Content Area */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 scrollbar-thin">
              {modalFilteredList.length === 0 ? (
                <div className="py-12 text-center text-gray-400 bg-gray-800/30 rounded-2xl border border-gray-750">
                  <Users size={32} className="mx-auto mb-2 text-gray-500" />
                  <p className="text-sm sm:text-base font-bold text-gray-200">Không tìm thấy chuyên viên phù hợp</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {activeFilter !== 'all' && activeFilter !== 'off_duty'
                      ? `Hiện tại chưa có chuyên viên nào được phân công trực tại ${activeFilter} hôm nay.`
                      : 'Thử thay đổi từ khóa tìm kiếm hoặc bấm tab "Tất cả".'}
                  </p>
                  {isAdmin && activeFilter !== 'all' && activeFilter !== 'off_duty' && (
                    <button
                      onClick={() => handleBatchDuty(activeFilter)}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors cursor-pointer shadow-md shadow-blue-500/20"
                    >
                      <UserPlus size={14} />
                      <span>Phân công tất cả trực {activeFilter}</span>
                    </button>
                  )}
                </div>
              ) : activeFilter === 'all' && modalViewMode === 'grouped' && !searchQuery.trim() ? (
                /* ── GROUPED VIEW BY KTX SECTIONS (PHÂN NHÓM RÕ RÀNG KTX 1, KTX 2,...) ── */
                <div className="space-y-6">
                  {groupedSections.map((sec) => {
                    const theme = !sec.isOffDuty ? getKtxTheme(sec.ktx) : null;
                    if (sec.specialists.length === 0) return null;

                    return (
                      <div
                        key={sec.key}
                        className={`rounded-2xl border overflow-hidden transition-all shadow-md ${
                          !sec.isOffDuty
                            ? `${theme?.sectionBg} border-opacity-70`
                            : 'bg-gray-850/60 border-gray-750'
                        }`}
                      >
                        {/* Section Banner Header */}
                        <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${
                          !sec.isOffDuty
                            ? `${theme?.headerBg} border-inherit`
                            : 'bg-gray-800/90 border-gray-700/60 text-gray-300'
                        }`}>
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                              !sec.isOffDuty
                                ? `${theme?.badgeBg}`
                                : 'bg-gray-700 text-gray-300'
                            }`}>
                              {!sec.isOffDuty ? <Building2 size={16} /> : <Coffee size={16} />}
                            </div>
                            <div>
                              <h3 className="font-extrabold text-white text-sm sm:text-base tracking-tight flex items-center gap-2">
                                <span>{sec.title}</span>
                                {!sec.isOffDuty && (
                                  <span className={`text-[11px] px-2 py-0.2 rounded-full font-bold border ${theme?.badgeBg}`}>
                                    {sec.specialists.length} đang trực
                                  </span>
                                )}
                              </h3>
                              <p className="text-xs text-gray-400">
                                {sec.subtitle}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {isAdmin && !sec.isOffDuty && (
                              <button
                                onClick={() => handleBatchDuty(sec.ktx)}
                                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 text-[11px] font-bold hover:bg-blue-600/30 transition-colors cursor-pointer"
                              >
                                <span>Gán tất cả vào {sec.ktx}</span>
                              </button>
                            )}
                            <button
                              onClick={() => setActiveFilter(sec.isOffDuty ? 'off_duty' : sec.ktx)}
                              className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <span>Xem riêng</span>
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Section Specialists List */}
                        <div className="p-3 sm:p-4 space-y-2.5 bg-[#1F2937]/90">
                          {sec.specialists.map(sp => renderSpecialistItem(sp, true))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ── FILTERED SINGLE KTX OR FLAT SEARCH RESULTS VIEW ── */
                <div className="space-y-2.5">
                  {modalFilteredList.map(sp => renderSpecialistItem(sp, true))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 sm:px-5 py-3 border-t border-gray-700/80 bg-gray-800/95 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-2 text-xs text-gray-400 w-full sm:w-auto">
                <Shield size={14} className="text-blue-400 shrink-0" />
                <span>
                  {isAdmin
                    ? 'Phân công KTX trực ban được lưu trực tiếp lên Supabase & Realtime'
                    : 'Chế độ xem trực ban chuyên viên hôm nay'}
                </span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {isAdmin && (
                  <button
                    onClick={() => {
                      setShowModal(false);
                      router.push('/user-management');
                    }}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-700 hover:bg-gray-650 text-gray-200 text-xs font-bold border border-gray-600 transition-colors cursor-pointer"
                  >
                    <UserPlus size={13} />
                    <span>Quản lý tài khoản</span>
                  </button>
                )}

                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── SQL Setup Helper Modal (Admin) ── */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 p-3 sm:p-6 bg-black/85 backdrop-blur-md flex items-center justify-center overflow-y-auto">
          <div className="bg-[#111827] border border-amber-500/40 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col my-auto text-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 bg-gray-900/90 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Database size={20} className="text-amber-400 shrink-0" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">Khởi Tạo Bảng Supabase: duty_assignments</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Chạy lệnh SQL này trong Supabase Dashboard → SQL Editor</p>
                </div>
              </div>
              <button
                onClick={() => setShowSqlModal(false)}
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
              <div className="relative">
                <pre className="p-3 bg-gray-950 border border-gray-800 rounded-xl text-[11px] sm:text-xs text-emerald-300 font-mono overflow-x-auto whitespace-pre leading-relaxed max-h-[50vh]">
                  {SQL_SNIPPET}
                </pre>
                <button
                  onClick={handleCopySql}
                  className="absolute top-2 right-2 px-2.5 py-1.5 rounded-lg bg-gray-800/90 hover:bg-gray-700 border border-gray-700 text-xs font-bold text-white flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                >
                  {copiedSql ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{copiedSql ? 'Đã sao chép' : 'Sao chép SQL'}</span>
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-1">
                <p className="font-semibold text-gray-300">Hướng dẫn thực hiện:</p>
                <p>1. Bấm nút <strong>Sao chép SQL</strong> ở góc trên.</p>
                <p>2. Mở tab Supabase Dashboard của dự án → Chọn <strong>SQL Editor</strong>.</p>
                <p>3. Dán vào và bấm <strong>Run</strong>. Sau đó quay lại ứng dụng và bấm nút làm mới.</p>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-800 bg-gray-900/90 flex justify-end gap-2">
              <button
                onClick={handleCopySql}
                className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {copiedSql ? 'Đã sao chép!' : 'Sao chép mã SQL'}
              </button>
              <button
                onClick={() => setShowSqlModal(false)}
                className="px-4 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
