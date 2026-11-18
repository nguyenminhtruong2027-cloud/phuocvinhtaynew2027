'use client';

import React, { useState, useEffect } from 'react';
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

export default function QRPortalTabsWrapper() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalTab>('attendance');
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState<number>(0);
  const { isAdmin, canWriteBlock } = useAuth();

  const supabase = createClient();

  // QR scan links land with ?tab=bed_inspect&bed_qr=... — open the right tab directly.
  useEffect(() => {
    setIsMounted(true);
    try {
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab === 'bed_inspect') setActiveTab('bed_inspect');
    } catch {}
  }, []);

  useEffect(() => {
    const fetchPendingCount = async () => {
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
      } catch (e) {
        // non-blocking
      }
    };
    fetchPendingCount();
  }, [supabase, isAdmin, canWriteBlock]);

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
      <header className="bg-side/90 border-b border-bdr sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 flex items-center justify-between gap-4 overflow-x-auto">
          <SlidingTabs<PortalTab>
            layoutId="qr-portal-tabs"
            compact
            value={activeTab}
            onChange={setActiveTab}
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

      {/* Main Tab Content */}
      <main className="max-w-7xl mx-auto">
        {activeTab === 'attendance' && <AttendancePortalClient />}
        {activeTab === 'registration' && <QRPortalClient />}
        {activeTab === 'bed_inspect' && <BedInspectClient />}
        {activeTab === 'checkout_approval' && (
          <CheckoutApprovalPanel onCountChange={setPendingCheckoutCount} />
        )}
        {activeTab === 'checkout' && <CheckoutPortalClient />}
      </main>
    </div>
  );
}
