'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import QRPortalClient from './QRPortalClient';
import AttendancePortalClient from './AttendancePortalClient';
import CheckoutPortalClient from './CheckoutPortalClient';
import CheckoutApprovalPanel from './CheckoutApprovalPanel';
import BedInspectClient from './BedInspectClient';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { QrCode, ClipboardList, LogOut, UserCheck, ScanLine } from 'lucide-react';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';

type PortalTab = 'attendance' | 'registration' | 'checkout_approval' | 'checkout' | 'bed_inspect';

const VALID_TABS: readonly PortalTab[] = [
  'attendance',
  'registration',
  'bed_inspect',
  'checkout_approval',
  'checkout',
];

export default function QRPortalTabsWrapper() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalTab>('attendance');
  const [visitedTabs, setVisitedTabs] = useState<Set<PortalTab>>(() => new Set(['attendance']));
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState<number>(0);
  const { isAdmin, canWriteBlock } = useAuth();

  const supabase = useMemo(() => createClient(), []);

  // QR scan links land with ?tab=bed_inspect&bed_qr=... or ?tab=checkout_approval — open the right tab directly.
  useEffect(() => {
    setIsMounted(true);
    try {
      const tab = new URLSearchParams(window.location.search).get('tab') as PortalTab | null;
      if (tab && VALID_TABS.includes(tab)) {
        setActiveTab(tab);
        setVisitedTabs(prev => {
          const next = new Set(prev);
          next.add(tab);
          return next;
        });
      }
    } catch {}
  }, []);

  const handleTabChange = useCallback((nextTab: PortalTab) => {
    setActiveTab(nextTab);
    setVisitedTabs(prev => {
      if (prev.has(nextTab)) return prev;
      const next = new Set(prev);
      next.add(nextTab);
      return next;
    });
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', nextTab);
        window.history.replaceState(null, '', url.toString());
      } catch {}
    }
  }, []);

  const fetchPendingCount = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('worker_registrations')
        .select('id, status, ghi_chu, day, ktx')
        .eq('status', 'pending');

      if (data) {
        const count = data.filter(r =>
          r.ghi_chu?.startsWith('[CHECKOUT]') &&
          (isAdmin || canWriteBlock(r.day, r.ktx))
        ).length;
        setPendingCheckoutCount(count);
      }
    } catch {
      // non-blocking
    }
  }, [supabase, isAdmin, canWriteBlock]);

  useEffect(() => {
    fetchPendingCount();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { fetchPendingCount(); }, 450);
    };
    const channel = supabase
      .channel('qr_portal_pending_checkout_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_registrations' }, (payload: any) => {
        const note = String(payload?.new?.ghi_chu ?? payload?.old?.ghi_chu ?? '');
        const regType = String(payload?.new?.type ?? payload?.old?.type ?? '');
        if (!note.startsWith('[CHECKOUT]') && regType !== 'CHECKOUT') return;
        scheduleFetch();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchPendingCount, supabase]);

  // Prevent React Hydration Mismatch by rendering matching skeleton until client mount
  if (!isMounted) {
    return (
      <div className="min-h-screen bg-page" suppressHydrationWarning>
        <div className="bg-side border-b border-bdr px-4 md:px-6 py-2.5">
          <div className="flex gap-2 animate-pulse">
            <div className="w-32 h-8 bg-surf/10 rounded" />
            <div className="w-32 h-8 bg-surf/10 rounded" />
            <div className="w-36 h-8 bg-surf/10 rounded" />
            <div className="w-36 h-8 bg-surf/10 rounded" />
          </div>
        </div>
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          <div className="h-64 bg-surf border border-bdr rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page text-tx font-sans" suppressHydrationWarning>
      {/* Main Nav Header */}
      <header className="bg-side border-b border-bdr sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 flex items-center justify-between gap-4 overflow-x-auto">
          <SlidingTabs<PortalTab>
            layoutId="qr-portal-tabs"
            compact
            value={activeTab}
            onChange={handleTabChange}
            tabs={[
              { id: 'attendance', label: 'QR Điểm Danh', icon: ClipboardList },
              { id: 'registration', label: 'Đăng ký cư trú', icon: QrCode },
              { id: 'bed_inspect', label: 'Kiểm Tra Giường', icon: ScanLine },
              {
                id: 'checkout_approval',
                label: 'Duyệt Check-out',
                icon: UserCheck,
                count: pendingCheckoutCount > 0 ? pendingCheckoutCount : undefined,
                tone: pendingCheckoutCount > 0 ? 'danger' : 'default',
              },
              { id: 'checkout', label: 'Mã QR Check-out', icon: LogOut },
            ]}
          />

          <div className="hidden lg:flex items-center gap-2 text-xs text-mu font-mono shrink-0 pl-4 border-l border-bdr">
            <span className="w-2 h-2 rounded-full bg-ok2" />
            <span>QR PORTAL KTX</span>
          </div>
        </div>
      </header>

      {/* Main Tab Content — lazy-mounted on first visit and kept alive for instant switching */}
      <main className="max-w-7xl mx-auto">
        {visitedTabs.has('attendance') && (
          <div className={activeTab === 'attendance' ? 'block' : 'hidden'}>
            <AttendancePortalClient />
          </div>
        )}
        {visitedTabs.has('registration') && (
          <div className={activeTab === 'registration' ? 'block' : 'hidden'}>
            <QRPortalClient />
          </div>
        )}
        {visitedTabs.has('bed_inspect') && (
          <div className={activeTab === 'bed_inspect' ? 'block' : 'hidden'}>
            <BedInspectClient />
          </div>
        )}
        {visitedTabs.has('checkout_approval') && (
          <div className={activeTab === 'checkout_approval' ? 'block' : 'hidden'}>
            <CheckoutApprovalPanel onCountChange={setPendingCheckoutCount} />
          </div>
        )}
        {visitedTabs.has('checkout') && (
          <div className={activeTab === 'checkout' ? 'block' : 'hidden'}>
            <CheckoutPortalClient />
          </div>
        )}
      </main>
    </div>
  );
}
