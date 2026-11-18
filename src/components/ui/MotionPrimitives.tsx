'use client';
import React, { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </MotionConfig>
  );
}

/**
 * AnimatedNumber — Hiệu ứng đếm số mượt mà bằng requestAnimationFrame (tabular-nums, an toàn SSR).
 */
export function AnimatedNumber({
  value,
  format = (n: number) => Math.round(n).toLocaleString('vi-VN'),
  duration = 550,
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
    if (start === end) {
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
      // Ease out cubic
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
 * PageReveal — Hiệu ứng chuyển cảnh nhẹ nhàng cho vùng nội dung chính khi đổi trang.
 */
export function PageReveal({ children, routeKey }: { children: React.ReactNode; routeKey?: string }) {
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-full"
    >
      {children}
    </motion.div>
  );
}

/**
 * StaggerGrid & StaggerItem — Lưới xuất hiện tuần tự nhanh gọn (<= 220ms).
 */
export function StaggerGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.04 },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export interface SlidingTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: LucideIcon | React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  tone?: 'default' | 'danger' | 'success' | 'muted';
}

/**
 * SlidingTabs — Bộ chuyển tab có thanh nền trượt mượt bằng motion layoutId.
 */
export function SlidingTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  layoutId,
  className = '',
  compact = false,
}: {
  tabs: SlidingTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  layoutId: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1 bg-act/85 p-1 rounded-xl border border-bdr2 shadow-inner overflow-x-auto max-w-full scrollbar-thin ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === value;
        const Icon = tab.icon;
        const activeBg =
          tab.tone === 'danger'
            ? 'bg-dgr shadow-sm shadow-rose-500/25'
            : tab.tone === 'success'
            ? 'bg-ok2 shadow-sm'
            : tab.tone === 'muted'
            ? 'bg-mu shadow-sm'
            : 'bg-pri shadow-sm shadow-blue-500/25';

        const activeText =
          tab.tone === 'success' ? 'text-ok2-fg' : 'text-white';

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-1.5 rounded-lg font-bold transition-colors whitespace-nowrap select-none cursor-pointer ${
              compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-xs sm:text-[13px]'
            } ${
              isActive
                ? activeText
                : tab.tone === 'danger' && (tab.count ?? 0) > 0
                ? 'text-dgr hover:bg-dgrbg/60'
                : 'text-mu hover:text-tx'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                className={`absolute inset-0 rounded-lg ${activeBg}`}
              />
            )}
            {Icon && <Icon size={14} className="relative z-10 shrink-0" />}
            <span className="relative z-10">{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`relative z-10 px-1.5 py-0.2 rounded-full text-[10px] font-tabular font-bold leading-tight ${
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
