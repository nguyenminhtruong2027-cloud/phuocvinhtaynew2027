'use client';

import React, { useState, useEffect } from 'react';
import QRPortalClient from './QRPortalClient';
import AttendancePortalClient from './AttendancePortalClient';
import CheckoutPortalClient from './CheckoutPortalClient';
import CheckoutApprovalPanel from './CheckoutApprovalPanel';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { QrCode, ClipboardList, LogOut, UserCheck } from 'lucide-react';

export default function QRPortalTabsWrapper() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'attendance' | 'registration' | 'checkout_approval' | 'checkout'>('attendance');
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState<number>(0);
  const { isAdmin, canWriteBlock } = useAuth();

  const supabase = createClient();

  useEffect(() => {
    setIsMounted(true);
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
      <div className="min-h-screen bg-[#f3f4f6] dark:bg-[#11151a]" suppressHydrationWarning>
        <div className="bg-[#1b2430] border-b border-[#2a333e] px-4 md:px-6 py-2.5">
          <div className="flex gap-2 animate-pulse">
            <div className="w-32 h-8 bg-white/10 rounded" />
            <div className="w-32 h-8 bg-white/10 rounded" />
            <div className="w-36 h-8 bg-white/10 rounded" />
            <div className="w-36 h-8 bg-white/10 rounded" />
          </div>
        </div>
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          <div className="h-64 bg-white dark:bg-[#181d24] border border-[#dde1e6] dark:border-[#2a333e] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] dark:bg-[#11151a] text-[#1b2430] dark:text-[#dde1e6] font-sans" suppressHydrationWarning>
      {/* Top-level Operations Console Nav Bar (Navy #1b2430) */}
      <header className="bg-[#1b2430] border-b border-[#2a333e] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-1 py-1.5 overflow-x-auto max-w-full">
            {[
              { key: 'attendance', label: 'QR Điểm Danh', icon: <ClipboardList size={15} /> },
              { key: 'registration', label: 'Đăng ký cư trú', icon: <QrCode size={15} /> },
              {
                key: 'checkout_approval',
                label: 'Duyệt Check-out',
                icon: <UserCheck size={15} />,
                badge: pendingCheckoutCount,
              },
              { key: 'checkout', label: 'Mã QR Check-out', icon: <LogOut size={15} /> },
            ].map(t => {
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key as any)}
                  className={`flex items-center gap-2 px-3.5 py-2 text-xs md:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer rounded-t border-b-2 ${
                    isActive
                      ? 'bg-[#2a3749] text-white font-semibold border-[#c9690f]'
                      : 'border-transparent text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                  {t.badge !== undefined && t.badge > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-[#c9690f] text-white">
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="hidden lg:flex items-center gap-2 text-xs text-gray-400 font-mono shrink-0 pl-4 border-l border-[#2a333e]">
            <span className="w-2 h-2 rounded-full bg-[#1f7a45]" />
            <span>CONSOLE VẬN HÀNH KTX</span>
          </div>
        </div>
      </header>

      {/* Main Tab Content */}
      <main className="max-w-7xl mx-auto">
        {activeTab === 'attendance' && <AttendancePortalClient />}
        {activeTab === 'registration' && <QRPortalClient />}
        {activeTab === 'checkout_approval' && (
          <CheckoutApprovalPanel onCountChange={setPendingCheckoutCount} />
        )}
        {activeTab === 'checkout' && <CheckoutPortalClient />}
      </main>
    </div>
  );
}
