'use client';
import React from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export type CraftTone = 'blue' | 'teal' | 'amber' | 'rose' | 'pink' | 'slate';
export type CraftSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

type IconLike = LucideIcon | React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface CraftIconBadgeProps {
  icon: IconLike;
  badgeIcon?: IconLike;
  tone?: CraftTone;
  size?: CraftSize;
  interactive?: boolean;
  className?: string;
}

const SIZE_MAP: Record<CraftSize, { box: string; icon: number; badgeBox: string; badgeIcon: number; radius: string }> = {
  xs: { box: 'w-7 h-7', icon: 14, badgeBox: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5', badgeIcon: 8, radius: 'rounded-lg' },
  sm: { box: 'w-9 h-9', icon: 17, badgeBox: 'w-4 h-4 -bottom-1 -right-1', badgeIcon: 9, radius: 'rounded-xl' },
  md: { box: 'w-10 h-10', icon: 19, badgeBox: 'w-4 h-4 -bottom-1 -right-1', badgeIcon: 9, radius: 'rounded-xl' },
  lg: { box: 'w-12 h-12', icon: 23, badgeBox: 'w-5 h-5 -bottom-1 -right-1', badgeIcon: 11, radius: 'rounded-2xl' },
  xl: { box: 'w-14 h-14', icon: 27, badgeBox: 'w-5 h-5 -bottom-1 -right-1', badgeIcon: 11, radius: 'rounded-2xl' },
};

const TONE_CLASS: Record<CraftTone, string> = {
  blue: 'craft-icon-blue',
  teal: 'craft-icon-teal',
  amber: 'craft-icon-amber',
  rose: 'craft-icon-rose',
  pink: 'craft-icon-pink',
  slate: 'craft-icon-slate',
};

/**
 * CraftIconBadge — Biểu tượng điêu khắc đa lớp (recessed bezel + specular rim + halo + Lucide icon).
 * Hỗ trợ badgeIcon phụ ở góc và hiệu ứng nghiêng nhẹ khi hover.
 */
export function CraftIconBadge({
  icon: Icon,
  badgeIcon: BadgeIcon,
  tone = 'blue',
  size = 'md',
  interactive = true,
  className = '',
}: CraftIconBadgeProps) {
  const s = SIZE_MAP[size];

  return (
    <motion.div
      whileHover={interactive ? { scale: 1.07, rotate: -3 } : undefined}
      whileTap={interactive ? { scale: 0.96 } : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      className={`relative inline-flex items-center justify-center flex-shrink-0 select-none ${s.box} ${s.radius} ${TONE_CLASS[tone]} ${className}`}
    >
      {/* Top specular inner highlight */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-1 top-[1px] h-[40%] ${s.radius} bg-gradient-to-b from-white/25 to-transparent opacity-80`}
      />
      <Icon size={s.icon} strokeWidth={2.15} className="relative z-10 drop-shadow-sm" />
      {BadgeIcon && (
        <span
          aria-hidden="true"
          className={`absolute z-20 ${s.badgeBox} rounded-full bg-surf border border-bdr2 flex items-center justify-center shadow-sm`}
        >
          <BadgeIcon size={s.badgeIcon} strokeWidth={2.4} />
        </span>
      )}
    </motion.div>
  );
}
