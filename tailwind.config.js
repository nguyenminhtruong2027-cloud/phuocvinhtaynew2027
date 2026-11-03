/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        // ─── Semantic design tokens (6 themes qua data-theme) ───
        page: 'var(--bg)',
        side: 'var(--side)',
        surf: 'var(--surf)',
        act: 'var(--act)',
        tx: 'var(--tx)',
        mu: 'var(--mu)',
        nav: 'var(--nav)',
        ic: 'var(--ic)',
        pri: 'var(--pri)',
        pri2: 'var(--pri2)',
        lnk: 'var(--lnk)',
        bdg: 'var(--bdg)',
        ok: 'var(--ok)',
        okbg: 'var(--okbg)',
        ok2: 'var(--ok2)',
        wn: 'var(--wn)',
        dgr: 'var(--dgr)',
        dgrbg: 'var(--dgrbg)',
        bdr: 'var(--bdr)',
        bdr2: 'var(--bdr2)',
        bdr3: 'var(--bdr3)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px var(--sh), 0 0 0 1px var(--bdr)',
        modal: '0 8px 32px var(--sh), 0 0 0 1px var(--bdr)',
        dropdown: '0 4px 16px var(--sh), 0 0 0 1px var(--bdr)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
