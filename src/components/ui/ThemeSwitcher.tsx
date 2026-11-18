'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type ThemeMode = 'midnight' | 'light';

interface ThemeSwitcherProps {
  compact?: boolean;
  showLabel?: boolean;
}

/**
 * ThemeSwitcher — Nút chuyển nhanh Tối (Midnight) / Sáng (Light), lưu localStorage 'ktx-theme'.
 */
export default function ThemeSwitcher({ compact = false, showLabel = true }: ThemeSwitcherProps) {
  const [theme, setTheme] = useState<ThemeMode>('midnight');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'midnight');
  }, []);

  const toggle = () => {
    const next: ThemeMode = theme === 'light' ? 'midnight' : 'light';
    try {
      localStorage.setItem('ktx-theme', next);
    } catch {}
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  };

  const isLight = theme === 'light';
  const label = isLight ? 'Chế độ Tối' : 'Chế độ Sáng';

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className="p-2 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100"
      >
        {isLight ? <Moon size={17} /> : <Sun size={17} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-nav hover:text-tx hover:bg-act transition-colors duration-100"
    >
      {isLight ? (
        <Moon size={16} className="text-ic flex-shrink-0" />
      ) : (
        <Sun size={16} className="text-ic flex-shrink-0" />
      )}
      {showLabel && <span className="truncate">{label}</span>}
    </button>
  );
}
