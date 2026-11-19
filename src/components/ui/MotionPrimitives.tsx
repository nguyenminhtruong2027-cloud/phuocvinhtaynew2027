'use client';
import React, { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * AnimatedNumber — Hiệu ứng đếm số nhanh gọn bằng requestAnimationFrame (tabular-nums, an toàn SSR).
 */
export function AnimatedNumber({
  value,
  format = (n: number) => Math.round(n).toLocaleString('vi-VN'),
  duration = 200,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState<number>(value);
  const prevRef = useRef<number>(value);

  useEffect(() => {
    const start = prevRef.current;
    const end = Number.isFinite(value) ? value : 0;
    if (start === end || duration <= 0) {
      prevRef.current = end;
      setDisplay(end);
      return;
    }

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      prevRef.current = end;
      setDisplay(end);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = start + (end - start) * eased;
      setDisplay(current);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        prevRef.current = end;
        setDisplay(end);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      prevRef.current = end;
    };
  }, [value, duration]);

  return <span className="font-tabular">{format(display)}</span>;
}

/**
 * PageReveal — Hiển thị tức thì với chuyển động nhẹ GPU-composited khi chuyển trang.
 */
export function PageReveal({ children, routeKey }: { children: React.ReactNode; routeKey?: string }) {
  return (
    <div key={routeKey} className="min-h-full page-reveal-in">
      {children}
    </div>
  );
}

/**
 * StaggerGrid & StaggerItem — Lưới hiển thị tức thì (zero stagger lag).
 */
export function StaggerGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function StaggerItem({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export interface SlidingTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: LucideIcon | React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  tone?: 'default' | 'danger' | 'success' | 'muted';
}

/**
 * SlidingTabs — Bộ chuyển tab tức thì bằng CSS (specular rim + zero layout thrash).
 */
export function SlidingTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  className = '',
  compact = false,
}: {
  tabs: SlidingTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  layoutId?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1 bg-act/90 p-1 rounded-xl border border-bdr2 shadow-inner overflow-x-auto max-w-full scrollbar-thin ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === value;
        const Icon = tab.icon;
        const activeBg =
          tab.tone === 'danger'
            ? 'bg-dgr shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_12px_-2px_rgba(220,38,38,0.4)]'
            : tab.tone === 'success'
            ? 'bg-ok2 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_12px_-2px_rgba(45,212,191,0.35)]'
            : tab.tone === 'muted'
            ? 'bg-mu shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]'
            : 'bg-pri shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_14px_-2px_rgba(59,102,240,0.45)]';

        const activeText =
          tab.tone === 'success' ? 'text-ok2-fg' : 'text-white';

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-1.5 rounded-lg font-bold transition-all duration-150 active:scale-[0.97] whitespace-nowrap select-none cursor-pointer ${
              compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-xs sm:text-[13px]'
            } ${
              isActive
                ? `${activeBg} ${activeText}`
                : tab.tone === 'danger' && (tab.count ?? 0) > 0
                ? 'text-dgr hover:bg-dgrbg/60'
                : 'text-mu hover:text-tx hover:bg-surf/65'
            }`}
          >
            {Icon && <Icon size={14} className="shrink-0" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-tabular font-bold leading-tight ${
                  isActive
                    ? 'bg-white/20 text-current'
                    : tab.tone === 'danger' && tab.count > 0
                    ? 'tint-dgr text-dgr border border-dgr/40'
                    : 'bg-surf text-mu border border-bdr'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

