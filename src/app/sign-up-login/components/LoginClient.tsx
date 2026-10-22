'use client';
import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Building2, ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginClient() {
  const [isMounted, setIsMounted] = useState(false);
  const [form, setForm] = useState<LoginForm>({ email: 'adminpvt@ktx.com', password: 'admin123' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleQuickLoginAdmin = async () => {
    setForm({ email: 'adminpvt@ktx.com', password: 'admin123' });
    setLoading(true);
    setError('');
    try {
      await signIn('adminpvt@ktx.com', 'admin123');
      router.replace('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLoginStaff = async () => {
    setForm({ email: 'staffpvt@ktx.com', password: 'staff123' });
    setLoading(true);
    setError('');
    try {
      await signIn('staffpvt@ktx.com', 'staff123');
      router.replace('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password.trim()) {
      setError('Vui lòng nhập đầy đủ Email và Mật khẩu.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signIn(form.email.trim(), form.password);
      router.replace('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        setError('Email hoặc mật khẩu không đúng. Vui lòng thử lại với adminpvt@ktx.com / admin123.');
      } else if (msg.includes('Email not confirmed')) {
        setError('Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background" suppressHydrationWarning>
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] xl:w-[480px] bg-primary p-10 flex-shrink-0" suppressHydrationWarning>
        <div className="flex items-center gap-3" suppressHydrationWarning>
          <AppLogo size={40} />
          <div>
            <p className="font-bold text-white text-base leading-tight">KÝ TÚC XÁ PHƯỚC VĨNH TÂY</p>
            <p className="text-white/60 text-xs">HỆ Thống Quản Lý</p>
          </div>
        </div>

        <div suppressHydrationWarning>
          <h1 className="text-3xl font-bold text-white leading-tight mb-4">
            Quản lý ký túc xá<br />công nhân xây dựng
          </h1>
          <p className="text-white/70 text-sm leading-relaxed mb-8">
            Hệ thống quản lý nội bộ — theo dõi công nhân, sơ đồ phòng, tạm trú và nhật ký hoạt động theo thời gian thực.
          </p>

          <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
            {[
              { label: 'Phân quyền vai trò', value: 'Admin / Staff' },
              { label: 'Đồng bộ thời gian thực', value: 'Supabase' },
              { label: 'Quản lý phòng', value: 'Sơ đồ trực quan' },
              { label: 'Bảo mật', value: 'Auth Guard' },
            ].map(stat => (
              <div key={`stat-${stat.label}`} className="bg-white/10 rounded-lg p-3">
                <p className="text-white font-bold text-sm">{stat.value}</p>
                <p className="text-white/60 text-xs mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2" suppressHydrationWarning>
          <Building2 size={14} className="text-white/40" />
          <p className="text-white/40 text-xs">KÝ TÚC XÁ PHƯỚC VĨNH TÂY · Hệ Thống Quản Lý Nội Bộ</p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12" suppressHydrationWarning>
        <div className="w-full max-w-md" suppressHydrationWarning>
          {/* Mobile logo */}
          <div className="flex flex-col items-center gap-2 mb-8 lg:hidden" suppressHydrationWarning>
            <AppLogo size={48} />
            <div className="text-center">
              <p className="font-bold text-lg text-foreground">KÝ TÚC XÁ PHƯỚC VĨNH TÂY</p>
              <p className="text-sm text-muted-foreground">HỆ THỐNG QUẢN LÝ</p>
            </div>
          </div>

          {/* Title */}
          <div className="mb-8" suppressHydrationWarning>
            <div className="hidden lg:flex items-center gap-2 mb-2">
              <ShieldCheck size={20} className="text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-widest">Đăng nhập bảo mật</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground">KÝ TÚC XÁ PHƯỚC VĨNH TÂY</h2>
            <p className="text-sm text-muted-foreground mt-1 font-medium">HỆ THỐNG QUẢN LÝ</p>
            <p className="text-xs text-muted-foreground mt-2">Vui lòng đăng nhập để tiếp tục</p>
          </div>

          {/* Quick Login Information & Buttons */}
          <div className="mb-6 p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/40 space-y-3 shadow-sm" suppressHydrationWarning>
            <div className="flex items-center justify-between" suppressHydrationWarning>
              <span className="text-xs font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-blue-600 dark:text-blue-400" />
                Tài khoản dùng thử / Mặc định hệ thống:
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-[10px] font-bold">
                Có sẵn
              </span>
            </div>

            <div className="text-xs text-blue-950 dark:text-blue-200 font-mono space-y-1.5 bg-white/80 dark:bg-black/30 p-2.5 rounded-lg border border-blue-200/80 dark:border-blue-900/50" suppressHydrationWarning>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans text-[11px]">Admin (Toàn quyền):</span>
                <span className="font-bold text-rose-600 dark:text-rose-400 font-mono text-[11px]">adminpvt@ktx.com / admin123</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans text-[11px]">Staff (Chuyên viên):</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 font-mono text-[11px]">staffpvt@ktx.com / staff123</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" suppressHydrationWarning>
              <button
                type="button"
                onClick={handleQuickLoginAdmin}
                disabled={loading}
                className="w-full py-2.5 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                suppressHydrationWarning
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={14} />}
                <span>Vào với Admin</span>
              </button>
              <button
                type="button"
                onClick={handleQuickLoginStaff}
                disabled={loading}
                className="w-full py-2.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                suppressHydrationWarning
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={14} />}
                <span>Vào với Staff</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" suppressHydrationWarning>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3" suppressHydrationWarning>
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div suppressHydrationWarning>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="input-field w-full"
                placeholder="adminpvt@ktx.com"
                autoComplete="email"
                disabled={loading}
                suppressHydrationWarning
              />
            </div>

            <div suppressHydrationWarning>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Mật khẩu <span className="text-red-500">*</span>
              </label>
              <div className="relative" suppressHydrationWarning>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input-field w-full pr-10"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={loading}
                  suppressHydrationWarning
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  tabIndex={-1}
                  suppressHydrationWarning
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5 text-sm min-h-[44px] mt-2 cursor-pointer shadow-sm"
              suppressHydrationWarning
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" />Đang đăng nhập...</>
              ) : (
                <><LogIn size={16} />Đăng nhập</>
              )}
            </button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-6" suppressHydrationWarning>
            Liên hệ quản trị viên để được cấp tài khoản truy cập hệ thống.
          </p>
        </div>
      </div>
    </div>
  );
}