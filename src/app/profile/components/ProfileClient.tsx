'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Lock,
  Save,
  CheckCircle,
  Shield,
  ShieldCheck,
  Crown,
  Wrench,
  Building2,
  Laptop,
  LogOut,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { getRememberMePreference, setRememberMePreference } from '@/lib/supabase/client';
import { CraftIconBadge } from '@/components/ui/CraftIcon';

export default function ProfileClient() {
  const { currentUser, isAdmin, isTechnician, updateProfile, changePassword, signOut } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(currentUser?.name ?? '');
  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameSuccess, setNameSuccess] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);

  useEffect(() => {
    setName(currentUser?.name ?? '');
    setEmail(currentUser?.email ?? '');
  }, [currentUser?.name, currentUser?.email]);

  useEffect(() => {
    setRememberMe(getRememberMePreference());
  }, []);

  const handleSaveName = () => {
    if (!name?.trim()) return;
    updateProfile({ name: name.trim(), email: email.trim() || currentUser?.email });
    setNameSuccess(true);
    toast.success('Đã cập nhật thông tin tài khoản');
    setTimeout(() => setNameSuccess(false), 2500);
  };

  const handleSavePassword = async () => {
    setPwError('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwError('Vui lòng điền đầy đủ các trường mật khẩu.');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Mật khẩu xác nhận không khớp.');
      return;
    }
    try {
      await changePassword(newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess(true);
      toast.success('Đã đổi mật khẩu thành công');
      setTimeout(() => setPwSuccess(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPwError(msg || 'Không thể đổi mật khẩu.');
    }
  };

  const handleToggleRememberMe = () => {
    const next = !rememberMe;
    setRememberMe(next);
    setRememberMePreference(next);
    toast.success(
      next
        ? 'Đã bật duy trì đăng nhập trên thiết bị này'
        : 'Đã tắt duy trì đăng nhập — phiên sẽ kết thúc khi đóng trình duyệt ở lần đăng nhập tới'
    );
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {}
    router.replace('/sign-up-login');
  };

  const roleMeta = (() => {
    switch (currentUser?.role) {
      case 'super_admin':
        return {
          label: 'Quản trị tối cao (Super Admin)',
          desc: 'Toàn quyền điều hành hệ thống, quản lý Admin và sao lưu dữ liệu',
          avatarCls: 'bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-600',
          badgeCls: 'tint-wn text-wn border-wn/45',
          icon: Crown,
        };
      case 'admin':
        return {
          label: 'Quản trị viên (Admin)',
          desc: 'Toàn quyền quản lý công nhân, cơ sở vật chất, giường và điều phối bảo trì',
          avatarCls: 'bg-gradient-to-tr from-rose-600 to-red-500',
          badgeCls: 'tint-dgr text-dgr border-dgr/40',
          icon: ShieldCheck,
        };
      case 'technician':
        return {
          label: 'Kỹ thuật viên (Technician)',
          desc: 'Tiếp nhận, xử lý phiếu báo hỏng QR, cập nhật trạng thái bảo trì và theo dõi Bản đồ 3D',
          avatarCls: 'bg-gradient-to-tr from-amber-500 to-orange-600',
          badgeCls: 'tint-wn text-wn border-wn/45',
          icon: Wrench,
        };
      default:
        return {
          label: 'Chuyên viên (Staff)',
          desc: 'Quản lý công nhân, xếp giường và duyệt hồ sơ QR tại các dãy nhà được phân công',
          avatarCls: 'bg-gradient-to-tr from-blue-600 to-indigo-600',
          badgeCls: 'bg-bdg text-lnk border-bdr2',
          icon: Shield,
        };
    }
  })();

  const RoleIcon = roleMeta.icon;
  const assignedBlocks = currentUser?.assignedBlocks || [];
  const hasFullScope = isAdmin || (isTechnician && assignedBlocks.length === 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-7 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-bdr">
        <div className="flex items-center gap-3">
          <CraftIconBadge icon={User} badgeIcon={RoleIcon} tone="blue" size="md" />
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">
              Hồ Sơ Cá Nhân
            </h1>
            <p className="text-xs sm:text-sm text-mu mt-0.5">
              Quản lý thông tin tài khoản, phạm vi phụ trách và phiên đăng nhập
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-dgr/35 bg-dgrbg text-dgr text-xs sm:text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer self-start sm:self-auto"
        >
          <LogOut size={15} />
          <span>Đăng xuất</span>
        </button>
      </div>

      {/* Hero Identity & Scope Summary */}
      <div className="surface-elevated rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-extrabold flex-shrink-0 shadow-md ${roleMeta.avatarCls}`}
          >
            {(currentUser?.name || currentUser?.email || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg sm:text-xl font-extrabold text-tx truncate">
                {currentUser?.name || 'Người dùng'}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border ${roleMeta.badgeCls}`}
              >
                <RoleIcon size={12} />
                {roleMeta.label}
              </span>
            </div>
            <p className="text-sm text-mu truncate font-mono">{currentUser?.email}</p>
            <p className="text-xs text-mu leading-relaxed">{roleMeta.desc}</p>
          </div>
        </div>

        {/* Assigned Scope Row */}
        <div className="mt-5 pt-4 border-t border-bdr flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-mu shrink-0">
            <Building2 size={14} className="text-lnk" />
            <span>Phạm vi phụ trách:</span>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            {hasFullScope ? (
              <span className="text-xs font-semibold text-ok">
                Toàn bộ Ký Túc Xá Phước Vĩnh Tây
              </span>
            ) : assignedBlocks.length > 0 ? (
              assignedBlocks.map(block => (
                <span
                  key={block}
                  className="px-2.5 py-1 rounded-lg bg-act border border-bdr2 text-xs font-semibold text-tx"
                >
                  {block}
                </span>
              ))
            ) : (
              <span className="text-xs text-wn font-medium">
                Chưa được gán dãy nhà cụ thể — liên hệ Quản trị viên để cấp phạm vi
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Session & Device Persistence Card */}
      <div className="surface-elevated rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CraftIconBadge icon={Laptop} tone="teal" size="sm" interactive={false} />
            <div className="space-y-1">
              <h2 className="text-sm sm:text-base font-bold text-tx">
                Phiên làm việc & Thiết bị này
              </h2>
              <p className="text-xs text-mu leading-relaxed">
                {rememberMe
                  ? 'Đang bật duy trì đăng nhập — hệ thống tự động gia hạn phiên khi máy ngủ hoặc chuyển tab lâu.'
                  : 'Chế độ phiên tạm thời — tài khoản sẽ tự đăng xuất khi đóng hoàn toàn trình duyệt.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleRememberMe}
            role="switch"
            aria-checked={rememberMe}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors cursor-pointer shrink-0 self-start sm:self-center ${
              rememberMe
                ? 'bg-okbg border-ok2/40 text-ok'
                : 'bg-act border-bdr2 text-mu hover:text-tx'
            }`}
          >
            <span
              className={`w-4 h-4 rounded flex items-center justify-center border ${
                rememberMe ? 'bg-ok2 border-ok2 text-ok2-fg' : 'border-bdr3 bg-surf'
              }`}
            >
              {rememberMe && <Check size={11} strokeWidth={3} />}
            </span>
            <span>{rememberMe ? 'Đang duy trì đăng nhập' : 'Chỉ lưu phiên tạm'}</span>
          </button>
        </div>
      </div>

      {/* Two-Column Forms: Personal Info + Change Password */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Update Name & Email */}
        <div className="surface-elevated rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <CraftIconBadge icon={User} tone="blue" size="xs" interactive={false} />
              <h2 className="text-base font-bold text-tx">Thông tin cá nhân</h2>
            </div>
            <div className="flex flex-col gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-mu mb-1.5">Họ và tên</label>
                <input
                  className="input-field"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Họ và tên"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-mu mb-1.5">Email đăng nhập</label>
                <input
                  className="input-field"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-5 pt-4 border-t border-bdr">
            <button
              type="button"
              onClick={handleSaveName}
              className="btn-glow-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {nameSuccess ? <CheckCircle size={15} /> : <Save size={15} />}
              <span>{nameSuccess ? 'Đã lưu!' : 'Lưu thông tin'}</span>
            </button>
          </div>
        </div>

        {/* Update Password */}
        <div className="surface-elevated rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <CraftIconBadge icon={Lock} tone="amber" size="xs" interactive={false} />
              <h2 className="text-base font-bold text-tx">Đổi mật khẩu</h2>
            </div>
            <div className="flex flex-col gap-3">
              {pwError && (
                <p className="text-xs text-dgr bg-dgrbg border border-dgr/35 px-3 py-2 rounded-xl font-medium">
                  {pwError}
                </p>
              )}
              {pwSuccess && (
                <p className="text-xs text-ok bg-okbg border border-ok2/35 px-3 py-2 rounded-xl flex items-center gap-1.5 font-medium">
                  <CheckCircle size={13} /> Đổi mật khẩu thành công!
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-mu mb-1.5">Mật khẩu hiện tại</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  className="input-field"
                  placeholder="••••••"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-mu mb-1.5">Mật khẩu mới</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input-field"
                  placeholder="Tối thiểu 6 ký tự"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-mu mb-1.5">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input-field"
                  placeholder="Nhập lại mật khẩu mới"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-5 pt-4 border-t border-bdr">
            <button
              type="button"
              onClick={handleSavePassword}
              className="btn-glow-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Lock size={15} />
              <span>Cập nhật mật khẩu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
