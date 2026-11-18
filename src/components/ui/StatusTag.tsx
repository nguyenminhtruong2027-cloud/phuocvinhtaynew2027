'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

export type IconLike =
  | LucideIcon
  | React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

export type StatusTagTone = 'blue' | 'teal' | 'amber' | 'rose' | 'pink' | 'slate';

const TONE_MAP: Record<StatusTagTone, string> = {
  blue: 'bg-bdg text-lnk border-pri2/30',
  teal: 'bg-okbg text-ok border-ok2/30',
  amber: 'tint-wn text-wn border-wn/35',
  rose: 'tint-dgr text-dgr border-dgr/35',
  pink: 'tint-pink text-pink-tone border-pink-tint',
  slate: 'bg-act text-nav border-bdr2',
};

const DOT_MAP: Record<StatusTagTone, string> = {
  blue: 'bg-pri2',
  teal: 'bg-ok2',
  amber: 'bg-wn',
  rose: 'bg-dgr',
  pink: 'bg-pink-fg',
  slate: 'bg-ic',
};

export interface StatusTagProps {
  tone?: StatusTagTone;
  icon?: IconLike;
  dot?: boolean;
  mono?: boolean;
  size?: 'xs' | 'sm';
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Architectural Micro-Tag — replaces bright pastel rounded-full pills with
 * crisp 6px-radius hairline-bordered semantic badges that work cleanly in both
 * Midnight Dark and Architectural Light themes.
 */
export function StatusTag({
  tone = 'slate',
  icon: Icon,
  dot = false,
  mono = false,
  size = 'xs',
  title,
  className = '',
  children,
}: StatusTagProps) {
  const sizeCls =
    size === 'sm'
      ? 'px-2.5 py-1 text-xs gap-1.5 rounded-md'
      : 'px-2 py-0.5 text-[11px] gap-1 rounded-md';

  return (
    <span
      title={title}
      className={`inline-flex items-center font-semibold border whitespace-nowrap leading-tight ${sizeCls} ${
        TONE_MAP[tone]
      } ${mono ? 'font-mono font-tabular' : ''} ${className}`}
      style={{ boxShadow: 'inset 0 1px 0 var(--specular)' }}
    >
      {Icon ? (
        <Icon size={size === 'sm' ? 13 : 11} strokeWidth={2.2} className="shrink-0" />
      ) : dot ? (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_MAP[tone]}`} />
      ) : null}
      <span>{children}</span>
    </span>
  );
}

/**
 * Monospace coordinate / ID chip (e.g. #maNV or KTX · Dãy · Phòng · Giường).
 */
export function MonoChip({
  children,
  tone = 'slate',
  title,
  className = '',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'blue';
  title?: string;
  className?: string;
}) {
  const cls =
    tone === 'blue'
      ? 'bg-bdg/80 text-lnk border-pri2/30'
      : 'bg-act/80 text-tx border-bdr2';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border font-mono text-[11px] font-semibold font-tabular whitespace-nowrap ${cls} ${className}`}
    >
      {children}
    </span>
  );
}
