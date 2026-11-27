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
import { CraftIconBadge } from '@/components/ui/CraftIcon';
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
  role: 'super_admin' | 'admin' | 'staff';
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
CREATE POLICY "Allow admin to insert duty_assignments" ON public.duty_assignments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin')));
DROP POLICY IF EXISTS "Allow admin to update duty_assignments" ON public.duty_assignments;
CREATE POLICY "Allow admin to update duty_assignments" ON public.duty_assignments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin'))) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin')));
DROP POLICY IF EXISTS "Allow admin to delete duty_assignments" ON public.duty_assignments;
CREATE POLICY "Allow admin to delete duty_assignments" ON public.duty_assignments FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin')));
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
      badgeBg: 'bg-bdg text-lnk border-bdr2 shadow-sm font-bold',
      activeTab: 'bg-pri text-white shadow-md border-bdr3 font-extrabold',
      headerBg: 'bg-act border-bdr2 text-lnk',
      sectionBg: 'bg-act border-bdr',
      accentColor: 'text-pri2',
      lightAccent: 'text-lnk',
      dotColor: 'bg-pri2',
      borderGlow: 'hover:border-pri2',
      ringColor: 'ring-pri2',
      chipBg: 'bg-bdg text-lnk border-bdr2',
      solidBadge: 'bg-pri text-white shadow-sm font-bold',
    };
  }
  if (norm.includes('2') || norm === 'KTX 2') {
    return {
      name: ktxName,
      badgeBg: 'bg-bdg text-wn border-bdr2 shadow-sm font-bold',
      activeTab: 'bg-wn text-wn-fg shadow-md border-bdr3 font-extrabold',
      headerBg: 'bg-act border-bdr2 text-wn',
      sectionBg: 'bg-act border-bdr',
      accentColor: 'text-wn',
      lightAccent: 'text-wn',
      dotColor: 'bg-wn',
      borderGlow: 'hover:border-wn',
      ringColor: 'ring-wn',
      chipBg: 'tint-wn text-wn border-bdr2',
      solidBadge: 'bg-wn text-wn-fg shadow-sm font-bold',
    };
  }
  if (norm.includes('3') || norm === 'KTX 3') {
    return {
      name: ktxName,
      badgeBg: 'bg-okbg text-ok border-bdr2 shadow-sm font-bold',
      activeTab: 'bg-ok2 text-ok2-fg shadow-md border-bdr3 font-extrabold',
      headerBg: 'bg-okbg border-bdr2 text-ok',
      sectionBg: 'bg-okbg border-bdr',
      accentColor: 'text-ok',
      lightAccent: 'text-ok',
      dotColor: 'bg-ok2',
      borderGlow: 'hover:border-ok2',
      ringColor: 'ring-ok2',
      chipBg: 'bg-okbg text-ok border-bdr2',
      solidBadge: 'bg-ok2 text-ok2-fg shadow-sm font-bold',
    };
  }
  return {
    name: ktxName,
    badgeBg: 'bg-bdg text-lnk border-bdr2 shadow-sm font-bold',
    activeTab: 'bg-pri text-white shadow-md border-bdr3 font-extrabold',
    headerBg: 'bg-act border-bdr2 text-lnk',
    sectionBg: 'bg-act border-bdr',
    accentColor: 'text-pri2',
    lightAccent: 'text-lnk',
    dotColor: 'bg-pri2',
    borderGlow: 'hover:border-pri2',
    ringColor: 'ring-pri2',
    chipBg: 'bg-bdg text-lnk border-bdr2',
    solidBadge: 'bg-pri text-white shadow-sm font-bold',
  };
}

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
            role: (p.role === 'super_admin' ? 'super_admin' : p.role === 'admin' ? 'admin' : 'staff') as 'super_admin' | 'admin' | 'staff',
            assignedBlocks: p.assigned_blocks || [],
          }));
        }
      }
    } catch {}
    return [];
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
    let localFormatted: SpecialistItem[] = [];
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_profiles') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localFormatted = parsed.map((p, idx) => ({
            id: p.id || `sp-${idx}`,
            name: p.full_name || p.name || p.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
            email: p.email,
            role: (p.role === 'super_admin' ? 'super_admin' : p.role === 'admin' ? 'admin' : 'staff') as 'super_admin' | 'admin' | 'staff',
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
        const dbList: SpecialistItem[] = data.map((p, idx) => ({
          id: p.id,
          name: p.full_name || p.email?.split('@')[0] || `Chuyên viên ${idx + 1}`,
          email: p.email || undefined,
          role: (p.role === 'super_admin' ? 'super_admin' : p.role === 'admin' ? 'admin' : 'staff') as 'super_admin' | 'admin' | 'staff',
          assignedBlocks: Array.isArray(p.assigned_blocks) ? p.assigned_blocks : [],
        }));
        setInternalProfiles(dbList);
        try {
          localStorage.setItem('ktx_local_profiles', JSON.stringify(data));
        } catch {}
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
        setDutyMap(missing ? prev => ({ ...prev, ...data }) : data);
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('ktx_duty_updated', handleDutyEvent);
    window.addEventListener('ktx_profiles_updated', handleProfilesEvent);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('ktx_duty_updated', handleDutyEvent);
      window.removeEventListener('ktx_profiles_updated', handleProfilesEvent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadDutyAssignments, loadProfiles]);

  const baseSpecialistsList = useMemo<SpecialistItem[]>(() => {
    if (propsSpecialists && propsSpecialists.length > 0) {
      return propsSpecialists;
    }
    if (internalProfiles && internalProfiles.length > 0) {
      return internalProfiles;
    }
    return [];
  }, [propsSpecialists, internalProfiles]);

  // Merge specialist list with duty assignment from database/localStorage
  // Rule: If no row exists in duty_assignments for today, status is 'off_duty' ('Nghỉ')
  const mergedSpecialists = useMemo<SpecialistWithDuty[]>(() => {
    const base = Array.isArray(baseSpecialistsList) ? baseSpecialistsList.filter(Boolean) : [];
    const byId = new Map<string, SpecialistItem>();
    base.forEach((sp, idx) => {
      const id = String(sp?.id || `sp-${idx}`);
      if (!byId.has(id)) byId.set(id, { ...sp, id });
    });
    return Array.from(byId.values()).map(sp => {
      const assignedKtx = dutyMap?.[sp.id];
      const isAssignedOnDuty = Boolean(assignedKtx && assignedKtx !== 'Nghỉ');
      const effectiveDutyKtx = isAssignedOnDuty ? assignedKtx : 'Nghỉ';

      return {
        id: sp.id ?? '',
        name: sp.name ?? sp.email ?? 'Chuyên viên',
        email: sp.email,
        phone: sp.phone,
        role: sp.role,
        assignedBlocks: (sp.role === 'super_admin' || sp.role === 'admin') ? [] : (sp.assignedBlocks ?? []),
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
    const isSuperAdminUser = sp.role === 'super_admin';
    const isAdminUser = sp.role === 'super_admin' || sp.role === 'admin';
    const isOnDuty = sp.status === 'on_duty' && sp.dutyKtx !== 'Nghỉ';
    const theme = isOnDuty ? getKtxTheme(sp.dutyKtx) : null;

    return (
      <div
        key={sp.id}
        className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 rounded-xl border transition-all duration-150 gap-3 w-full ${
          isOnDuty
            ? `bg-surf border-bdr ${theme?.borderGlow || 'hover:border-pri2'} shadow-sm`
            : 'bg-act border-bdr hover:border-bdr2 opacity-90'
        }`}
      >
        {/* Left: Avatar, Name, Prominent KTX Duty Tag, Role, Contact, Assigned Blocks */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="relative flex-shrink-0 mt-0.5">
            <div className={`w-10 h-10 rounded-xl border font-bold text-sm flex items-center justify-center shadow-inner ${
              isSuperAdminUser
                ? 'tint-wn border-wn text-wn'
                : isAdminUser
                ? 'bg-pri/30 border-bdr2 text-lnk'
                : isOnDuty
                ? `${theme?.badgeBg}`
                : 'bg-pri/25 border-bdr2 text-lnk'
            }`}>
              {sp.name.charAt(0).toUpperCase()}
            </div>
            <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-bdr shadow-sm ${
              isOnDuty ? `${theme?.dotColor || 'bg-ok2'} animate-pulse` : 'bg-ic'
            }`} />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm sm:text-base font-bold text-tx whitespace-normal break-words leading-snug">
                {sp.name}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                isSuperAdminUser
                  ? 'tint-wn text-wn border-wn'
                  : 'bg-bdg text-lnk border-bdr2'
              }`}>
                {isSuperAdminUser ? 'Quản trị tối cao' : isAdminUser ? 'Quản trị viên' : 'Chuyên viên'}
              </span>

              {/* ── HIGH VISIBILITY PROMINENT KTX DUTY BADGE ── */}
              {isOnDuty ? (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border shadow-sm ${theme?.badgeBg}`}>
                  <Building2 size={12} className={theme?.accentColor} />
                  <span>ĐANG TRỰC {sp.dutyKtx.toUpperCase()}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-act text-mu border border-bdr2/40 shrink-0">
                  <Coffee size={11} className="text-mu" />
                  <span>Nghỉ ca hôm nay</span>
                </span>
              )}
            </div>

            {/* Contact Information */}
            {showFullContact && (
              <div className="flex items-center gap-x-3 gap-y-1 text-xs text-mu flex-wrap pt-0.5">
                {sp.email && (
                  <span className="flex items-center gap-1 whitespace-normal break-all text-mu">
                    <Mail size={12} className="text-mu shrink-0" />
                    <span>{sp.email}</span>
                  </span>
                )}
                {sp.phone && (
                  <span className="flex items-center gap-1 font-tabular text-mu">
                    <Phone size={12} className="text-mu shrink-0" />
                    <span>{sp.phone}</span>
                  </span>
                )}
              </div>
            )}

            {/* Staff Assigned Regular Blocks */}
            {!isAdminUser && sp.assignedBlocks && sp.assignedBlocks.length > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-mu flex-wrap pt-0.5">
                <span className="font-semibold text-mu">Phụ trách dãy:</span>
                {sp.assignedBlocks.map(b => (
                  <span key={b} className="px-1.5 py-0.5 rounded bg-act text-mu border border-bdr2 text-[10px] font-semibold">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Dynamic KTX Duty Selector & Quick Action (Admin Only) */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-bdr/70 w-full sm:w-auto shrink-0">
          <div className="space-y-1 flex-1 sm:flex-initial sm:min-w-[180px]">
            <label className="text-[10px] font-bold text-mu uppercase tracking-wider block">
              PHÂN CÔNG TRỰC BAN
            </label>
            {isAdmin ? (
              <select
                value={isOnDuty ? sp.dutyKtx : 'Nghỉ'}
                onChange={(e) => updateDuty(sp.id, e.target.value, sp.name)}
                className={`w-full bg-act border rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer ${
                  isOnDuty
                    ? `${theme?.badgeBg || 'text-lnk border-bdr2'}`
                    : 'text-mu border-bdr2'
                }`}
              >
                {availableKtxOptions.map(ktx => (
                  <option key={ktx} value={ktx} className="bg-surf text-tx font-semibold">
                    Trực {ktx}
                  </option>
                ))}
                {sp.dutyKtx && !availableKtxOptions.includes(sp.dutyKtx) && sp.dutyKtx !== 'Nghỉ' && (
                  <option value={sp.dutyKtx} className="bg-surf text-ok font-semibold">
                    Trực {sp.dutyKtx}
                  </option>
                )}
                <option value="Nghỉ" className="bg-surf text-mu">
                  Nghỉ ca
                </option>
              </select>
            ) : (
              <span className={`inline-block px-3 py-1 rounded-lg text-xs font-bold border ${
                isOnDuty ? `${theme?.badgeBg}` : 'bg-act text-mu border-bdr2'
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
                    ? 'tint-dgr text-dgr border-dgr/40 hover:tint-dgr'
                    : 'bg-okbg text-ok border-bdr2 hover:opacity-90'
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
        <div className={`fixed bottom-5 right-5 z-[100] flex items-center gap-2.5 px-4 py-3 border rounded-xl shadow-2xl animate-fade-in max-w-[90vw] ${
          toastMessage.type === 'error'
            ? 'tint-dgr border-dgr text-dgr'
            : toastMessage.type === 'warning'
            ? 'tint-wn border-wn text-wn'
            : 'bg-act border-bdr2 text-ok'
        }`}>
          {toastMessage.type === 'error' ? (
            <AlertCircle size={17} className="text-dgr flex-shrink-0" />
          ) : toastMessage.type === 'warning' ? (
            <AlertCircle size={17} className="text-wn flex-shrink-0" />
          ) : (
            <CheckCircle2 size={17} className="text-ok flex-shrink-0" />
          )}
          <span className="text-xs font-semibold whitespace-normal break-words">{toastMessage.text}</span>
          {isTableMissing && (
            <button
              onClick={() => setShowSqlModal(true)}
              className="ml-2 px-2 py-0.5 rounded tint-wn text-wn hover:opacity-90 text-[11px] font-bold underline cursor-pointer shrink-0"
            >
              Xem SQL
            </button>
          )}
        </div>
      )}

      {/* ── Main Executive Card on Dashboard (Full-Width Horizontal Grid) ── */}
      <div className="rounded-2xl surface-elevated p-4 sm:p-5 w-full space-y-4">
        {/* Top Header Row: Title + Inline Summary + Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-8 h-8 rounded-lg bg-bdg border border-bdr2 text-lnk flex items-center justify-center shrink-0">
                <UserCheck size={16} />
              </div>
              <h2 className="text-sm sm:text-base font-bold text-tx tracking-tight">
                Phân Công Trực Ban &amp; Chuyên Viên
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ok">
                <Radio size={11} className="shrink-0" />
                Realtime
              </span>
              {isTableMissing && isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowSqlModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md tint-wn text-wn border border-wn font-semibold hover:opacity-90 cursor-pointer"
                  title="Bảng duty_assignments chưa khởi tạo trên Supabase. Bấm để lấy câu lệnh SQL."
                >
                  <Database size={11} />
                  <span>Cần chạy SQL</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-mu font-tabular flex-wrap">
              <span className="font-semibold text-tx">{mergedSpecialists.length} nhân sự</span>
              <span aria-hidden="true">·</span>
              <span className={onDutyList.length > 0 ? 'font-semibold text-ok' : 'text-mu'}>
                {onDutyList.length} trực ban hôm nay
              </span>
              <span aria-hidden="true">·</span>
              <span>{offDutyList.length} nghỉ ca</span>
              <span aria-hidden="true">·</span>
              <span>Ngày {todayDate}</span>
            </div>
          </div>

          {/* Right Controls: Wrapped Filter Segmented Control + Quick Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap p-1 rounded-xl bg-act border border-bdr">
              <button
                type="button"
                onClick={() => setCardKtxFilter('all')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  cardKtxFilter === 'all'
                    ? 'bg-pri text-white shadow-sm'
                    : 'text-mu hover:text-tx'
                }`}
              >
                Tất cả ({mergedSpecialists.length})
              </button>

              {availableKtxOptions.map(ktx => {
                const count = countsPerKtx[ktx] || 0;
                const isSelected = cardKtxFilter === ktx;
                return (
                  <button
                    key={ktx}
                    type="button"
                    onClick={() => setCardKtxFilter(ktx)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-pri text-white shadow-sm'
                        : 'text-mu hover:text-tx'
                    }`}
                  >
                    Trực {ktx} ({count})
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setCardKtxFilter('off_duty')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1 ${
                  cardKtxFilter === 'off_duty'
                    ? 'bg-surf text-tx shadow-sm border border-bdr2'
                    : 'text-mu hover:text-tx'
                }`}
              >
                <Coffee size={12} />
                <span>Nghỉ ca ({offDutyList.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => loadDutyAssignments(true)}
              disabled={syncing}
              title="Đồng bộ dữ liệu trực ban mới nhất"
              className="h-9 w-9 rounded-xl flex items-center justify-center border bg-surf text-mu border-bdr2 hover:bg-act hover:text-tx transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin text-lnk' : ''} />
            </button>

            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="h-9 px-3.5 rounded-xl text-xs font-bold bg-surf hover:bg-act text-lnk border border-bdr2 transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Phân công chi tiết</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Specialists Responsive Horizontal Grid (2 cols tablet/laptop, 3 cols desktop) */}
        <div className="pt-3 border-t border-bdr/70">
          {cardFilteredList.length === 0 ? (
            <div className="py-6 px-4 text-center text-xs text-mu bg-act/40 rounded-xl border border-bdr">
              <p className="font-semibold text-mu">
                {cardKtxFilter === 'all'
                  ? 'Chưa có tài khoản chuyên viên trong hệ thống.'
                  : cardKtxFilter === 'off_duty'
                  ? 'Tất cả chuyên viên đều đang có ca trực hôm nay.'
                  : `Chưa có chuyên viên nào được phân công trực tại ${cardKtxFilter} hôm nay.`}
              </p>
              {isAdmin && cardKtxFilter !== 'all' && cardKtxFilter !== 'off_duty' && (
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(true);
                    setActiveFilter(cardKtxFilter);
                  }}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pri text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <span>Phân công trực {cardKtxFilter} ngay</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {cardFilteredList.slice(0, 9).map((sp) => {
                const isSuperAdminUser = sp.role === 'super_admin';
                const isAdminUser = sp.role === 'super_admin' || sp.role === 'admin';
                const isOnDuty = sp.status === 'on_duty' && sp.dutyKtx !== 'Nghỉ';
                const theme = isOnDuty ? getKtxTheme(sp.dutyKtx) : null;
                const roleLabel = isSuperAdminUser ? 'Chủ HT' : isAdminUser ? 'Admin' : 'Chuyên viên';

                return (
                  <div
                    key={sp.id}
                    className={`rounded-xl p-3.5 border transition-colors flex flex-col justify-between gap-3 ${
                      isOnDuty
                        ? `bg-surf border-bdr2 ${theme?.borderGlow || 'hover:border-pri2'}`
                        : 'bg-act/35 border-bdr hover:border-bdr2'
                    }`}
                  >
                    {/* Top: Avatar + Identity */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg border text-xs font-bold flex items-center justify-center shrink-0 ${
                          isSuperAdminUser
                            ? 'tint-wn border-wn text-wn'
                            : isOnDuty
                            ? `${theme?.badgeBg}`
                            : 'bg-bdg border-bdr2 text-lnk'
                        }`}
                      >
                        {sp.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-tx leading-snug line-clamp-2" title={sp.name}>
                          {sp.name}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-mu min-w-0">
                          <span className={`font-semibold shrink-0 ${isSuperAdminUser ? 'text-wn' : 'text-lnk'}`}>
                            {roleLabel}
                          </span>
                          <span aria-hidden="true" className="shrink-0">·</span>
                          <span className="truncate font-tabular" title={sp.email || sp.phone || ''}>
                            {sp.email || sp.phone || 'Nhân sự KTX'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom: Duty Status + Inline Selector */}
                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-bdr/60">
                      <span
                        className={`text-xs font-semibold truncate ${
                          isOnDuty ? (theme?.accentColor || 'text-ok') : 'text-mu'
                        }`}
                      >
                        {isOnDuty ? `Đang trực ${sp.dutyKtx}` : 'Nghỉ ca hôm nay'}
                      </span>

                      {isAdmin ? (
                        <select
                          aria-label={`Phân công trực cho ${sp.name}`}
                          value={isOnDuty ? sp.dutyKtx : 'Nghỉ'}
                          onChange={(e) => updateDuty(sp.id, e.target.value, sp.name)}
                          className={`text-xs font-semibold py-1.5 px-2.5 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-pri2/50 shrink-0 max-w-[175px] ${
                            isOnDuty
                              ? `${theme?.badgeBg || 'bg-bdg text-lnk border-bdr2'}`
                              : 'bg-surf text-tx border-bdr2 hover:border-pri2/50'
                          }`}
                        >
                          {availableKtxOptions.map(ktx => (
                            <option key={ktx} value={ktx} className="bg-surf text-tx font-semibold">
                              Trực {ktx}
                            </option>
                          ))}
                          <option value="Nghỉ" className="bg-surf text-mu">
                            Nghỉ ca
                          </option>
                        </select>
                      ) : (
                        <span className="text-xs font-semibold text-mu shrink-0">
                          {isOnDuty ? `Trực ${sp.dutyKtx}` : 'Nghỉ ca'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Row */}
        <div className="pt-2.5 border-t border-bdr/60 flex items-center justify-between gap-2 text-xs">
          <span className="text-mu">
            {cardFilteredList.length > 9
              ? `Đang hiển thị 9/${cardFilteredList.length} chuyên viên — bấm Phân công chi tiết để xem đầy đủ`
              : 'Thay đổi ca trực được đồng bộ tự động tới toàn bộ thiết bị'}
          </span>
          <button
            type="button"
            onClick={() => router.push('/user-management')}
            className="font-semibold text-lnk hover:underline shrink-0 cursor-pointer"
          >
            Quản lý tài khoản
          </button>
        </div>
      </div>

      {/* ── MODAL CHI TIẾT: PHÂN CÔNG TRỰC BAN CHUYÊN VIÊN THEO NGÀY ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 p-2 sm:p-4 md:p-6 bg-black/75 flex items-center justify-center overflow-y-auto">
          <div className="bg-surf border border-bdr2 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col my-auto text-tx overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-bdr2/80 bg-surf/95 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk shrink-0">
                  <Calendar size={20} className="sm:w-[22px] sm:h-[22px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-lg font-bold text-tx tracking-tight whitespace-normal break-words">
                      Phân Công Trực Ban Chuyên Viên Theo Ngày
                    </h2>
                    <span className="px-2.5 py-0.5 text-xs font-bold bg-okbg text-ok border border-bdr2 rounded-full shrink-0">
                      {onDutyList.length}/{mergedSpecialists.length} Đang trực ban
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-mu mt-0.5">
                    Ngày trực: <span className="text-lnk font-semibold">{todayDate}</span> · Tự động đồng bộ Supabase Realtime
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => loadDutyAssignments(true)}
                  disabled={syncing}
                  title="Tải lại từ CSDL"
                  className="w-8 h-8 rounded-lg bg-act hover:bg-act text-mu hover:text-tx flex items-center justify-center transition-colors cursor-pointer"
                >
                  <RefreshCw size={14} className={syncing ? 'animate-spin text-lnk' : ''} />
                </button>

                <button
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-lg bg-act hover:bg-act text-mu hover:text-tx flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Warning Banner if Table is missing */}
            {isTableMissing && isAdmin && (
              <div className="px-4 py-2.5 tint-wn border-b border-wn flex items-center justify-between gap-3 text-xs text-wn">
                <div className="flex items-center gap-3">
                  <Database size={15} className="text-wn shrink-0" />
                  <span className="whitespace-normal break-words">
                    Bảng <code>duty_assignments</code> chưa được tạo trong Supabase. Vui lòng chạy lệnh SQL để lưu ca trực vĩnh viễn.
                  </span>
                </div>
                <button
                  onClick={() => setShowSqlModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-wn text-wn-fg hover:opacity-90 font-bold text-xs border border-wn shrink-0 cursor-pointer transition-colors"
                >
                  Lấy mã SQL
                </button>
              </div>
            )}

            {/* ── GRID STATISTICS PER KTX AREA (KTX 1, KTX 2, KTX 3...) ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 p-2.5 sm:p-3 bg-act border-b border-bdr2/60 shrink-0 overflow-x-auto">
              <div className="bg-act/30 border border-bdr2 rounded-xl p-2 sm:p-2.5">
                <p className="text-[10px] sm:text-[11px] font-semibold text-lnk uppercase">Tổng nhân sự</p>
                <p className="text-base sm:text-lg font-bold text-lnk font-tabular mt-0.5">{mergedSpecialists.length} người</p>
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
                className="bg-act border border-bdr2/60 rounded-xl p-2 sm:p-2.5 text-left hover:bg-surf transition-colors cursor-pointer"
              >
                <p className="text-[10px] sm:text-[11px] font-semibold text-mu uppercase flex items-center gap-1">
                  <Coffee size={11} />
                  <span>Nghỉ ca</span>
                </p>
                <p className="text-base sm:text-lg font-bold text-mu font-tabular mt-0.5">{offDutyList.length} người</p>
              </button>
            </div>

            {/* ── FILTER TOOLBAR & KTX SECTION TABS ── */}
            <div className="p-2.5 sm:p-3 border-b border-bdr2/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 bg-surf/50">
              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tìm tên, email, KTX..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 text-xs bg-surf text-tx placeholder-gray-400 border border-bdr2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mu hover:text-tx"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Status & KTX Area Filter Tabs */}
              <div className="flex items-center gap-1.5 flex-wrap justify-between sm:justify-end flex-1">
                <div className="flex rounded-xl bg-surf p-1 border border-bdr2/80 flex-wrap gap-1">
                  <button
                    onClick={() => setActiveFilter('all')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      activeFilter === 'all'
                        ? 'bg-pri text-white shadow-sm font-extrabold'
                        : 'text-mu hover:text-tx'
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
                            : 'bg-transparent text-mu hover:text-tx border-transparent hover:border-bdr2'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${count > 0 ? theme.dotColor : 'bg-ic'}`} />
                        <span>Trực {ktx} ({count})</span>
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setActiveFilter('off_duty')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeFilter === 'off_duty'
                        ? 'bg-act text-tx shadow-sm font-extrabold'
                        : 'text-mu hover:text-tx'
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
                        className="px-2.5 py-1 text-xs font-bold rounded-lg bg-pri/20 text-lnk border border-bdr2 hover:bg-pri/30 transition-colors cursor-pointer"
                        title={`Gán tất cả chuyên viên trực ${ktx}`}
                      >
                        Tất cả trực {ktx}
                      </button>
                    ))}
                    <button
                      onClick={() => handleBatchDuty('Nghỉ')}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-act text-mu border border-bdr2 hover:bg-act transition-colors cursor-pointer"
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
              <div className="px-4 py-2 bg-act border-b border-bdr2/60 flex items-center justify-between text-xs text-mu">
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-lnk" />
                  <span>
                    Đang hiển thị danh sách: <strong className="text-tx">{activeFilter === 'off_duty' ? 'Chuyên viên nghỉ ca' : `Chuyên viên trực ${activeFilter}`}</strong> ({modalFilteredList.length} người)
                  </span>
                </div>
                <button
                  onClick={() => setActiveFilter('all')}
                  className="text-lnk hover:underline font-semibold cursor-pointer"
                >
                  Hiển thị tất cả
                </button>
              </div>
            )}

            {/* Scrollable Specialist Content Area */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 scrollbar-thin">
              {modalFilteredList.length === 0 ? (
                <div className="py-12 text-center text-mu bg-surf/30 rounded-2xl border border-bdr">
                  <Users size={32} className="mx-auto mb-2 text-ic" />
                  <p className="text-sm sm:text-base font-bold text-tx">Không tìm thấy chuyên viên phù hợp</p>
                  <p className="text-xs text-mu mt-1">
                    {activeFilter !== 'all' && activeFilter !== 'off_duty'
                      ? `Hiện tại chưa có chuyên viên nào được phân công trực tại ${activeFilter} hôm nay.`
                      : 'Thử thay đổi từ khóa tìm kiếm hoặc bấm tab "Tất cả".'}
                  </p>
                  {isAdmin && activeFilter !== 'all' && activeFilter !== 'off_duty' && (
                    <button
                      onClick={() => handleBatchDuty(activeFilter)}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold transition-colors cursor-pointer shadow-md shadow-sh"
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
                            : 'bg-act border-bdr'
                        }`}
                      >
                        {/* Section Banner Header */}
                        <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${
                          !sec.isOffDuty
                            ? `${theme?.headerBg} border-inherit`
                            : 'bg-surf border-bdr2/60 text-mu'
                        }`}>
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                              !sec.isOffDuty
                                ? `${theme?.badgeBg}`
                                : 'bg-act text-mu'
                            }`}>
                              {!sec.isOffDuty ? <Building2 size={16} /> : <Coffee size={16} />}
                            </div>
                            <div>
                              <h3 className="font-extrabold text-tx text-sm sm:text-base tracking-tight flex items-center gap-2">
                                <span>{sec.title}</span>
                                {!sec.isOffDuty && (
                                  <span className={`text-[11px] px-2 py-0.2 rounded-full font-bold border ${theme?.badgeBg}`}>
                                    {sec.specialists.length} đang trực
                                  </span>
                                )}
                              </h3>
                              <p className="text-xs text-mu">
                                {sec.subtitle}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {isAdmin && !sec.isOffDuty && (
                              <button
                                onClick={() => handleBatchDuty(sec.ktx)}
                                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pri/20 text-lnk border border-bdr2 text-[11px] font-bold hover:bg-pri/30 transition-colors cursor-pointer"
                              >
                                <span>Gán tất cả vào {sec.ktx}</span>
                              </button>
                            )}
                            <button
                              onClick={() => setActiveFilter(sec.isOffDuty ? 'off_duty' : sec.ktx)}
                              className="text-xs text-lnk hover:text-lnk font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <span>Xem riêng</span>
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Section Specialists List */}
                        <div className="p-3 sm:p-4 space-y-2.5 bg-surf/90">
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
            <div className="px-4 sm:px-5 py-3 border-t border-bdr2/80 bg-surf/95 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-2 text-xs text-mu w-full sm:w-auto">
                <Shield size={14} className="text-lnk shrink-0" />
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
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-act hover:bg-act text-tx text-xs font-bold border border-bdr2 transition-colors cursor-pointer"
                  >
                    <UserPlus size={13} />
                    <span>Quản lý tài khoản</span>
                  </button>
                )}

                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center px-4 py-1.5 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold shadow-md shadow-sh transition-colors cursor-pointer"
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
        <div className="fixed inset-0 z-50 p-3 sm:p-6 bg-black/80 flex items-center justify-center overflow-y-auto">
          <div className="bg-surf border border-wn rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col my-auto text-tx overflow-hidden">
            <div className="px-5 py-4 border-b border-bdr bg-act/90 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Database size={20} className="text-wn shrink-0" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-tx">Khởi Tạo Bảng Supabase: duty_assignments</h3>
                  <p className="text-xs text-mu mt-0.5">Chạy lệnh SQL này trong Supabase Dashboard → SQL Editor</p>
                </div>
              </div>
              <button
                onClick={() => setShowSqlModal(false)}
                className="w-8 h-8 rounded-lg bg-surf hover:bg-act text-mu flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
              <div className="relative">
                <pre className="p-3 bg-page border border-bdr rounded-xl text-[11px] sm:text-xs text-ok font-mono overflow-x-auto whitespace-pre leading-relaxed max-h-[50vh]">
                  {SQL_SNIPPET}
                </pre>
                <button
                  onClick={handleCopySql}
                  className="absolute top-2 right-2 px-2.5 py-1.5 rounded-lg bg-surf hover:bg-act border border-bdr2 text-xs font-bold text-tx flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                >
                  {copiedSql ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                  <span>{copiedSql ? 'Đã sao chép' : 'Sao chép SQL'}</span>
                </button>
              </div>

              <div className="text-xs text-mu space-y-1">
                <p className="font-semibold text-mu">Hướng dẫn thực hiện:</p>
                <p>1. Bấm nút <strong>Sao chép SQL</strong> ở góc trên.</p>
                <p>2. Mở tab Supabase Dashboard của dự án → Chọn <strong>SQL Editor</strong>.</p>
                <p>3. Dán vào và bấm <strong>Run</strong>. Sau đó quay lại ứng dụng và bấm nút làm mới.</p>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-bdr bg-act/90 flex justify-end gap-2">
              <button
                onClick={handleCopySql}
                className="px-4 py-1.5 rounded-xl bg-wn hover:opacity-90 text-wn-fg text-xs font-bold transition-colors cursor-pointer"
              >
                {copiedSql ? 'Đã sao chép!' : 'Sao chép mã SQL'}
              </button>
              <button
                onClick={() => setShowSqlModal(false)}
                className="px-4 py-1.5 rounded-xl bg-surf hover:bg-act text-mu text-xs font-bold transition-colors cursor-pointer"
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
