'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { User, Lock, Save, CheckCircle, Shield, ShieldCheck } from 'lucide-react';

export default function ProfileClient() {
  const { currentUser, updateProfile } = useAuth();

  const [name, setName] = useState(currentUser?.name ?? '');
  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameSuccess, setNameSuccess] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState('');

  // Sync local state when currentUser changes (e.g. after save)
  useEffect(() => {
    setName(currentUser?.name ?? '');
    setEmail(currentUser?.email ?? '');
  }, [currentUser?.name, currentUser?.email]);

  const handleSaveName = () => {
    if (!name?.trim()) return;
    updateProfile({ name: name?.trim(), email: email?.trim() || currentUser?.email });
    setNameSuccess(true);
    setTimeout(() => setNameSuccess(false), 2500);
  };

  const handleSavePassword = () => {
    setPwError('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwError('Vui lòng điền đầy đủ các trường mật khẩu.');
      return;
    }
    if (currentPassword !== currentUser?.password) {
      setPwError('Mật khẩu hiện tại không đúng.');
      return;
    }
    if (newPassword?.length < 6) {
      setPwError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Mật khẩu xác nhận không khớp.');
      return;
    }
    updateProfile({ password: newPassword });
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwSuccess(true);
    setTimeout(() => setPwSuccess(false), 2500);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Hồ Sơ Cá Nhân</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Xem và cập nhật thông tin tài khoản của bạn</p>
      </div>

      {/* Avatar + Info Card */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-6 flex items-center gap-5">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0 ${currentUser?.role === 'admin' ? 'bg-red-500' : 'bg-blue-500'}`}>
          {currentUser?.name?.charAt(0)?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-foreground truncate">{currentUser?.name}</p>
          <p className="text-sm text-muted-foreground truncate">{currentUser?.email}</p>
          <div className="mt-1.5">
            {currentUser?.role === 'admin' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                <ShieldCheck size={11} /> Quản trị viên
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                <Shield size={11} /> Quản lý
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Update Name & Email */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">Thông tin cá nhân</h2>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Họ và tên</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={name}
              onChange={e => setName(e?.target?.value)}
              placeholder="Họ và tên"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Email</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={email}
              onChange={e => setEmail(e?.target?.value)}
              placeholder="Email"
              type="email"
            />
          </div>
          <div className="flex justify-end mt-1">
            <button
              onClick={handleSaveName}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              {nameSuccess ? <CheckCircle size={14} /> : <Save size={14} />}
              {nameSuccess ? 'Đã lưu!' : 'Lưu thông tin'}
            </button>
          </div>
        </div>
      </div>

      {/* Update Password */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={16} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">Đổi mật khẩu</h2>
        </div>
        <div className="flex flex-col gap-3">
          {pwError && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{pwError}</p>}
          {pwSuccess && <p className="text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg flex items-center gap-1.5"><CheckCircle size={13} /> Đổi mật khẩu thành công!</p>}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Mật khẩu hiện tại</label>
            <input
              type="password"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="••••••"
              value={currentPassword}
              onChange={e => setCurrentPassword(e?.target?.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Mật khẩu mới</label>
            <input
              type="password"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="••••••"
              value={newPassword}
              onChange={e => setNewPassword(e?.target?.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Xác nhận mật khẩu mới</label>
            <input
              type="password"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="••••••"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e?.target?.value)}
            />
          </div>
          <div className="flex justify-end mt-1">
            <button
              onClick={handleSavePassword}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Lock size={14} />
              Đổi mật khẩu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
