'use client';

import React, { useEffect, useState } from 'react';

const THEMES: { id: string; name: string; swatch: string }[] = [
  { id: 'midnight', name: 'Midnight', swatch: '#3B66F0' },
  { id: 'emerald', name: 'Emerald', swatch: '#34D399' },
  { id: 'violet', name: 'Violet', swatch: '#A78BFA' },
  { id: 'ocean', name: 'Ocean', swatch: '#38BDF8' },
  { id: 'light', name: 'Light Corporate', swatch: '#F4F6FB' },
  { id: 'sunrise', name: 'Sunrise Light', swatch: '#EA580C' },
];

/**
 * ThemeSwitcher — 6 swatch chọn theme (lưu localStorage 'ktx-theme').
 * Chỉ trình bày: đọc/ghi data-theme trên <html>, không đụng logic nghiệp vụ.
 */
export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>('midnight');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current) setTheme(current);
  }, []);

  const apply = (t: string) => {
    try {
      localStorage.setItem('ktx-theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
    setTheme(t);
  };

  return (
    <div
      className="flex items-center gap-1.5 rounded-xl border border-bdr bg-surf px-2 py-1.5 shadow-card"
      role="group"
      aria-label="Chọn theme giao diện"
    >
      {THEMES.map(t => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            title={t.name}
            aria-label={`Theme ${t.name}`}
            aria-pressed={active}
            onClick={() => apply(t.id)}
            className="h-5 w-5 rounded-full border transition-transform duration-200 hover:scale-110"
            style={{
              backgroundColor: t.swatch,
              borderColor: 'var(--bdr3)',
              boxShadow: active ? '0 0 0 2px var(--pri2)' : 'none',
              opacity: active ? 1 : 0.75,
            }}
          />
        );
      })}
    </div>
  );
}
