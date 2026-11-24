'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import QRPortalClient from './QRPortalClient';
import AttendancePortalClient from './AttendancePortalClient';
import CheckoutPortalClient from './CheckoutPortalClient';
import CheckoutApprovalPanel from './CheckoutApprovalPanel';
import BedInspectClient from './BedInspectClient';
import RoomIssueQrPortalTab from './RoomIssueQrPortalTab';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { QrCode, ClipboardList, LogOut, UserCheck, ScanLine, Wrench } from 'lucide-react';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';

type PortalTab = 'attendance' | 'registration' | 'checkout_approval' | 'checkout' | 'bed_inspect' | 'issue_qr';

const VALID_TABS: readonly PortalTab[] = [
  'attendance',
  'registration',
  'bed_inspect',
  'issue_qr',
  'checkout_approval',
  'checkout',
];

export default function QRPortalTabsWrapper() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalTab>('attendance');
  const [visitedTabs, setVisitedTabs] = useState<Set<PortalTab>>(() => new Set(['attendance']));
  const [pendingRegistrationCount, setPendingRegistrationCount] = useState<number>(0);
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

  const fetchPendingCounts = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('worker_registrations')
        .select('id, status, ghi_chu, day, ktx')
        .eq('status', 'pending');

      if (data) {
        let regCount = 0;
        let checkoutCount = 0;
        for (const r of data) {
          if (!(isAdmin || canWriteBlock(r.day, r.ktx))) continue;
          if (r.ghi_chu?.startsWith('[CHECKOUT]')) {
            checkoutCount++;
          } else {
            regCount++;
          }
        }
        setPendingRegistrationCount(regCount);
        setPendingCheckoutCount(checkoutCount);
      }
    } catch {
      // non-blocking
    }
  }, [supabase, isAdmin, canWriteBlock]);

  useEffect(() => {
    fetchPendingCounts();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { fetchPendingCounts(); }, 450);
    };
    const channel = supabase
      .channel('qr_portal_pending_counts_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_registrations' }, () => {
        scheduleFetch();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchPendingCounts, supabase]);

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
              {
                id: 'registration',
                label: 'Đăng ký cư trú',
                icon: QrCode,
                count: pendingRegistrationCount > 0 ? pendingRegistrationCount : undefined,
                tone: pendingRegistrationCount > 0 ? 'warning' : 'default',
              },
              { id: 'bed_inspect', label: 'Kiểm Tra Giường', icon: ScanLine },
              { id: 'issue_qr', label: 'QR Báo Hỏng', icon: Wrench },
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
            <QRPortalClient onPendingCountChange={setPendingRegistrationCount} />
          </div>
        )}
        {visitedTabs.has('bed_inspect') && (
          <div className={activeTab === 'bed_inspect' ? 'block' : 'hidden'}>
            <BedInspectClient />
          </div>
        )}
        {visitedTabs.has('issue_qr') && (
          <div className={activeTab === 'issue_qr' ? 'block' : 'hidden'}>
            <RoomIssueQrPortalTab />
          </div>
        )}
        {visitedTabs.has('checkout_approval') && (
          <div className={activeTab === 'checkout_approval' ? 'block' : 'hidden'}>
            <CheckoutApprovalPanel onCountChange={setPendingCheckoutCount} />
          </div>
        )}
        {visitedTabs.has('checkout') && (
          <div className={activeTab === 'checkout' ? 'block' : 'hidden'}>
            <CheckoutPortalClient onOpenApprovalTab={() => handleTabChange('checkout_approval')} />
          </div>
        )}
      </main>
    </div>
  );
}
