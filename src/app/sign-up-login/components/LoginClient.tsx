'use client';
import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Building2, ShieldCheck, KeyRound, CheckCircle2, Sparkles, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { createClient, getRememberMePreference } from '@/lib/supabase/client';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';

const SAVED_EMAIL_KEY = 'ktx_saved_login_email';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginClient() {
  const [form, setForm] = useState<LoginForm>({ email: '', password: '' });
  const [rememberMe, setRememberMe] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signIn, currentUser, isTechnician, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const savedPref = getRememberMePreference();
    setRememberMe(savedPref);
    if (savedPref) {
      try {
        const savedEmail = window.localStorage.getItem(SAVED_EMAIL_KEY);
        if (savedEmail) {
          setForm(prev => (prev.email ? prev : { ...prev, email: savedEmail }));
        }
      } catch {}
    }
  }, []);

  // If user already has an active persisted session, go straight into the app
  useEffect(() => {
    if (!authLoading && currentUser) {
      router.replace(isTechnician ? '/maintenance' : '/');
    }
  }, [authLoading, currentUser, isTechnician, router]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailTrimmed = form.email.trim();
    if (!emailTrimmed) {
      setError('Vui lòng nhập Email tài khoản để nhận liên kết đặt lại mật khẩu.');
      return;
    }
    setLoading(true);
    setError('');
    setResetSent(false);
    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/profile` : undefined;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(emailTrimmed, { redirectTo });
      if (resetErr) {
        setError(resetErr.message);
      } else {
        setResetSent(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể gửi email đặt lại mật khẩu.');
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
      const cleanEmail = form.email.trim();
      try {
        if (rememberMe) {
          window.localStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
        } else {
          window.localStorage.removeItem(SAVED_EMAIL_KEY);
        }
      } catch {}
      await signIn(cleanEmail, form.password, rememberMe);
      router.replace('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        setError('Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.');
      } else if (msg.includes('Email not confirmed')) {
        setError('Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.');
      } else if (msg.includes('Failed to fetch') || msg.includes('network_error') || msg.includes('Lỗi kết nối') || msg.includes('kết nối')) {
        setError('Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra kết nối mạng và thử lại.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-architectural relative" suppressHydrationWarning>
      {/* Top-right theme switcher */}
      <div className="fixed top-4 right-4 z-30">
        <ThemeSwitcher compact />
      </div>

      {/* Left architectural brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-[430px] xl:w-[490px] p-10 flex-shrink-0 relative overflow-hidden border-r border-bdr"
        style={{
          background: 'linear-gradient(155deg, color-mix(in srgb, var(--pri) 88%, #04091a 12%) 0%, color-mix(in srgb, var(--pri2) 65%, #07112b 35%) 100%)',
        }}
        suppressHydrationWarning
      >
        {/* Subtle technical grid overlay on brand panel */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />
        <div className="relative z-10 flex items-center gap-3.5" suppressHydrationWarning>
          <CraftIconBadge icon={Building2} badgeIcon={ShieldCheck} tone="blue" size="lg" />
          <div>
            <p className="font-extrabold text-white text-base leading-tight tracking-tight">KÝ TÚC XÁ PHƯỚC VĨNH TÂY</p>
            <p className="text-white/75 text-xs font-medium mt-0.5">Hệ thống Quản lý Vận hành</p>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="relative z-10"
          suppressHydrationWarning
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/80 mb-3">
            <Sparkles size={13} />
            <span>Nền tảng Quản trị Nội bộ</span>
          </span>
          <h1 className="text-3xl font-extrabold text-white leading-tight mb-4 tracking-tight">
            Quản lý ký túc xá<br />công nhân xây dựng
          </h1>
          <p className="text-white/80 text-sm leading-relaxed mb-8">
            Theo dõi công nhân, sơ đồ phòng trực quan, tạm trú và nhật ký hoạt động theo thời gian thực.
          </p>

          <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
            {[
              { label: 'Phân quyền vai trò', value: '4 Cấp RBAC' },
              { label: 'Đồng bộ trực tiếp', value: 'Thời gian thực' },
              { label: 'Quản lý phòng', value: 'Sơ đồ Heatmap' },
              { label: 'Bảo mật truy cập', value: 'Auth Guard' },
            ].map(stat => (
              <div
                key={`stat-${stat.label}`}
                className="bg-white/15 border border-white/15 rounded-xl p-3.5"
              >
                <p className="text-white font-bold text-sm">{stat.value}</p>
                <p className="text-white/70 text-xs mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="relative z-10 flex items-center gap-2" suppressHydrationWarning>
          <Building2 size={14} className="text-white/60" />
          <p className="text-white/60 text-xs">Ký Túc Xá Phước Vĩnh Tây · Quản Lý Nội Bộ</p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12" suppressHydrationWarning>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="w-full max-w-md surface-elevated rounded-2xl p-6 sm:p-8"
          suppressHydrationWarning
        >
          {/* Mobile logo */}
          <div className="flex flex-col items-center gap-2.5 mb-7 lg:hidden" suppressHydrationWarning>
            <CraftIconBadge icon={Building2} badgeIcon={ShieldCheck} tone="blue" size="lg" />
            <div className="text-center">
              <p className="font-extrabold text-lg text-tx">KÝ TÚC XÁ PHƯỚC VĨNH TÂY</p>
              <p className="text-xs text-mu font-semibold tracking-wider uppercase mt-0.5">Hệ thống quản lý</p>
            </div>
          </div>

          {/* Title */}
          <div className="mb-7" suppressHydrationWarning>
            <div className="hidden lg:flex items-center gap-2 mb-2.5">
              <CraftIconBadge icon={Lock} tone="blue" size="xs" interactive={false} />
              <span className="text-xs font-bold text-lnk uppercase tracking-widest">Đăng nhập bảo mật</span>
            </div>
            <h2 className="text-2xl font-extrabold text-tx tracking-tight">Chào mừng trở lại</h2>
            <p className="text-xs text-mu mt-1.5">Vui lòng đăng nhập tài khoản nội bộ để tiếp tục</p>
          </div>

          {forgotMode ? (
            <form onSubmit={handleForgotPassword} className="space-y-4" suppressHydrationWarning>
              {error && (
                <div className="bg-dgrbg border border-dgr rounded-xl px-4 py-3">
                  <p className="text-sm text-dgr">{error}</p>
                </div>
              )}
              {resetSent && (
                <div className="bg-okbg border border-bdr2 rounded-xl px-4 py-3 flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-ok shrink-0 mt-0.5" />
                  <p className="text-xs text-ok leading-relaxed">
                    Đã gửi email khôi phục mật khẩu tới <strong>{form.email.trim()}</strong> (nếu tài khoản tồn tại). Với tài khoản nội bộ không dùng email thật, hãy liên hệ Quản trị viên để đặt lại mật khẩu trực tiếp.
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-tx mb-1.5">
                  Email tài khoản <span className="text-dgr">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="input-field w-full"
                  placeholder="you@ktx.com"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading}
                className="btn-glow-primary w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold min-h-[44px] cursor-pointer"
              >
                {loading ? (
                  <><Loader2 size={16} className="animate-spin" />Đang gửi yêu cầu...</>
                ) : (
                  <><KeyRound size={16} />Gửi email khôi phục mật khẩu</>
                )}
              </motion.button>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setError(''); setResetSent(false); }}
                className="w-full text-center text-xs font-semibold text-lnk hover:underline py-1 cursor-pointer"
              >
                ← Quay lại đăng nhập
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" suppressHydrationWarning>
              {error && (
                <div className="bg-dgrbg border border-dgr rounded-xl px-4 py-3" suppressHydrationWarning>
                  <p className="text-sm text-dgr">{error}</p>
                </div>
              )}

              <div suppressHydrationWarning>
                <label htmlFor="login-email" className="block text-sm font-semibold text-tx mb-1.5">
                  Email <span className="text-dgr">*</span>
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="input-field w-full"
                  placeholder="you@ktx.com"
                  autoComplete="username"
                  disabled={loading}
                  suppressHydrationWarning
                />
              </div>

              <div suppressHydrationWarning>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-sm font-semibold text-tx">
                    Mật khẩu <span className="text-dgr">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError(''); setResetSent(false); }}
                    className="text-xs font-medium text-lnk hover:underline cursor-pointer"
                  >
                    Quên mật khẩu?
                  </button>
                </div>
                <div className="relative" suppressHydrationWarning>
                  <input
                    id="login-password"
                    name="password"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mu hover:text-tx transition-colors cursor-pointer"
                    tabIndex={-1}
                    suppressHydrationWarning
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Keep me signed in */}
              <label
                htmlFor="remember-me"
                className="flex items-start gap-2.5 pt-0.5 cursor-pointer select-none group"
              >
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  disabled={loading}
                  className="mt-0.5 h-4 w-4 rounded border-bdr2 text-pri focus:ring-pri2 cursor-pointer accent-blue-600"
                />
                <span className="text-xs leading-snug">
                  <span className="font-semibold text-tx group-hover:text-lnk transition-colors block">
                    Duy trì đăng nhập trên thiết bị này
                  </span>
                  <span className="text-[11px] text-mu block mt-0.5">
                    {rememberMe
                      ? 'Tự động gia hạn phiên làm việc, không bị thoát khi tắt trình duyệt hay chuyển tab.'
                      : 'Phiên sẽ tự động đăng xuất khi đóng trình duyệt (phù hợp máy dùng chung).'}
                  </span>
                </span>
              </label>

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading}
                className="btn-glow-primary w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold min-h-[44px] mt-2 cursor-pointer"
                suppressHydrationWarning
              >
                {loading ? (
                  <><Loader2 size={16} className="animate-spin" />Đang đăng nhập...</>
                ) : (
                  <><LogIn size={16} />Đăng nhập</>
                )}
              </motion.button>
            </form>
          )}

          <p className="text-xs text-mu text-center mt-6" suppressHydrationWarning>
            Liên hệ Quản trị viên hoặc Quản trị tối cao để được cấp/đặt lại tài khoản nội bộ.
          </p>
        </motion.div>
      </div>
    </div>
  );
}