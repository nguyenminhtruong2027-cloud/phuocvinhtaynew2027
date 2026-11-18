'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

type ThemeMode = 'midnight' | 'light';

interface ThemeSwitcherProps {
  compact?: boolean;
  showLabel?: boolean;
}

/**
 * ThemeSwitcher — Nút chuyển nhanh Tối (Midnight) / Sáng (Light) với hiệu ứng morph Sun ↔ Moon.
 */
export default function ThemeSwitcher({ compact = false, showLabel = true }: ThemeSwitcherProps) {
  const [theme, setTheme] = useState<ThemeMode>('midnight');

  useEffect(() => {
    const sync = () => {
      const current = document.documentElement.getAttribute('data-theme');
      setTheme(current === 'light' ? 'light' : 'midnight');
    };
    sync();
    window.addEventListener('ktx:theme-changed', sync);
    return () => window.removeEventListener('ktx:theme-changed', sync);
  }, []);

  const toggle = () => {
    const next: ThemeMode = theme === 'light' ? 'midnight' : 'light';
    try {
      localStorage.setItem('ktx-theme', next);
    } catch {}
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
    window.dispatchEvent(new CustomEvent('ktx:theme-changed'));
  };

  const isLight = theme === 'light';
  const label = isLight ? 'Giao diện Tối' : 'Giao diện Sáng';

  const IconMorph = ({ size }: { size: number }) => (
    <span className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isLight ? 'moon' : 'sun'}
          initial={{ rotate: -45, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 45, scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center justify-center"
        >
          {isLight ? (
            <Moon size={size} className="text-pri2" strokeWidth={2.1} />
          ) : (
            <Sun size={size} className="text-wn" strokeWidth={2.1} />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );

  if (compact) {
    return (
      <motion.button
        whileTap={{ scale: 0.92 }}
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className="p-2 rounded-xl text-nav hover:text-tx hover:bg-act border border-transparent hover:border-bdr2 transition-colors duration-150"
      >
        <IconMorph size={17} />
      </motion.button>
    );
  }

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-nav hover:text-tx hover:bg-act/80 border border-transparent hover:border-bdr2 transition-colors duration-150 group"
    >
      <span className="flex items-center gap-3 min-w-0">
        <IconMorph size={16} />
        {showLabel && <span className="truncate">{label}</span>}
      </span>
      {showLabel && (
        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-surf border border-bdr2 text-mu group-hover:text-tx transition-colors">
          {isLight ? 'Dark' : 'Light'}
        </span>
      )}
    </motion.button>
  );
}
