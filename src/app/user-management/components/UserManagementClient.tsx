'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, UserRole } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { createClient, getSupabaseConfig } from '@/lib/supabase/client';
import { UserPlus, Pencil, Trash2, Shield, ShieldCheck, Crown, Lock, RefreshCw, AlertCircle, CheckCircle, Building2, Search, Database, Check, Copy, KeyRound, UserCog } from 'lucide-react';
import { useKtxStructure, KtxBlockGroup } from '@/lib/ktxStructure';
import { CraftIconBadge } from '@/components/ui/CraftIcon';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { StatusTag } from '@/components/ui/StatusTag';

interface ProfileRecord {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  assigned_blocks: string[];
  created_at: string;
  password?: string;
}

interface UserFormData {
  full_name: string;
  email: string;
  password: string;
  role: UserRole;
  assigned_blocks: string[];
}

const emptyForm: UserFormData = { full_name: '', email: '', password: '', role: 'staff', assigned_blocks: [] };

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-4 right-4 z-[100] flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border max-w-sm ${
      type === 'success'
        ? 'bg-okbg border-bdr2 text-ok'
        : 'bg-dgrbg border-dgr text-dgr'
    }`}>
      {type === 'success' ? <CheckCircle size={18} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />}
      <p className="text-sm font-medium leading-snug">{message}</p>
      <button onClick={onClose} className="ml-auto text-current opacity-60 hover:opacity-100 flex-shrink-0">✕</button>
    </div>
  );
}

function getLocalProfiles(): ProfileRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('ktx_local_profiles');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p: any) => ({ ...p, assigned_blocks: p.assigned_blocks ?? [] }));
      }
    }
  } catch {}
  return [];
}

function saveLocalProfiles(profs: ProfileRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ktx_local_profiles', JSON.stringify(profs));
    window.dispatchEvent(new Event('ktx_profiles_updated'));
  } catch {}
}

export default function UserManagementClient() {
  const {
    isAdmin,
    isSuperAdmin,
    canManageAdmins,
    canRunMigrations,
    getAccountPermissions,
    currentUser,
    loading: authLoading,
    signOut,
  } = useAuth();
  const { addLog } = useAudit();
  const router = useRouter();
  const supabase = createClient();
  const { ktxGroups, reload: reloadKtxStructure } = useKtxStructure();

  const [profiles, setProfiles] = useState<ProfileRecord[]>(() => getLocalProfiles());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<ProfileRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileRecord | null>(null);
  const [resetTarget, setResetTarget] = useState<ProfileRecord | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [form, setForm] = useState<UserFormData>(emptyForm);
  const [formError, setFormError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'super_admin' | 'admin' | 'staff'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [checkingMigrations, setCheckingMigrations] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<{
    entryLog: 'unknown' | 'applied' | 'missing';
    rlsLookup: 'unknown' | 'applied' | 'missing';
    superAdminRbac: 'unknown' | 'applied' | 'missing';
    packageASecurity: 'unknown' | 'applied' | 'missing';
    checkedAt?: string;
  }>({ entryLog: 'unknown', rlsLookup: 'unknown', superAdminRbac: 'unknown', packageASecurity: 'unknown' });
  const [copiedMigrationPath, setCopiedMigrationPath] = useState<string | null>(null);

  const checkDatabaseMigrations = useCallback(async () => {
    setCheckingMigrations(true);
    let entryLog: 'applied' | 'missing' = 'missing';
    let rlsLookup: 'applied' | 'missing' = 'missing';
    let superAdminRbac: 'applied' | 'missing' = 'missing';
    let packageASecurity: 'applied' | 'missing' = 'missing';

    try {
      const { error: entryErr } = await supabase.from('worker_entry_log').select('id').limit(1);
      if (!entryErr) {
        entryLog = 'applied';
      } else {
        const msg = entryErr.message.toLowerCase();
        entryLog = msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not find') ? 'missing' : 'applied';
      }
    } catch {
      entryLog = 'missing';
    }

    try {
      const { error: rpcErr } = await supabase.rpc('lookup_worker_qr', { p_code: '__ping__' });
      if (!rpcErr) {
        rlsLookup = 'applied';
      } else {
        const msg = rpcErr.message.toLowerCase();
        rlsLookup = msg.includes('could not find the function') || msg.includes('does not exist') ? 'missing' : 'applied';
      }
    } catch {
      rlsLookup = 'missing';
    }

    try {
      const { data: rbacReady, error: rbacErr } = await supabase.rpc('check_super_admin_rbac_ready');
      if (!rbacErr && rbacReady === true) {
        superAdminRbac = 'applied';
      } else {
        superAdminRbac = 'missing';
      }
    } catch {
      superAdminRbac = 'missing';
    }

    try {
      const { data: pkgAReady, error: pkgAErr } = await supabase.rpc('check_package_a_security_ready');
      if (!pkgAErr && pkgAReady === true) {
        packageASecurity = 'applied';
      } else {
        packageASecurity = 'missing';
      }
    } catch {
      packageASecurity = 'missing';
    }

    setMigrationStatus({
      entryLog,
      rlsLookup,
      superAdminRbac,
      packageASecurity,
      checkedAt: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    });
    setCheckingMigrations(false);
  }, [supabase]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  const loadProfiles = useCallback(async () => {
    const localList = getLocalProfiles();
    setProfiles(localList);

    try {
      // Fast timeout for Supabase call
      const rpcPromise = supabase.rpc('get_all_profiles');
      const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 2000)
      );
      const { data: rpcData, error: rpcError } = await Promise.race([rpcPromise, timeoutPromise]);

      if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
        const dbList = Array.from(
          new Map(
            (rpcData as ProfileRecord[]).map(p => [
              p.id,
              { ...p, assigned_blocks: p.assigned_blocks ?? [] },
            ])
          ).values()
        );
        setProfiles(dbList);
        saveLocalProfiles(dbList);
      } else {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, role, assigned_blocks, created_at')
          .order('created_at', { ascending: false });

        if (!error && data && Array.isArray(data) && data.length > 0) {
          const dbList = Array.from(
            new Map(
              data.map(p => [p.id, { ...p, assigned_blocks: p.assigned_blocks ?? [] }])
            ).values()
          );
          setProfiles(dbList);
          saveLocalProfiles(dbList);
        } else {
          setProfiles(Array.from(new Map(localList.map(p => [p.id, p])).values()));
        }
      }
    } catch {
      setProfiles(localList);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadProfiles();
    reloadKtxStructure();
  }, [loadProfiles, reloadKtxStructure]);

  // Loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <RefreshCw size={24} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Đang xác thực quyền truy cập...</p>
      </div>
    );
  }

  // Route protection (strictly requires admin or super_admin role — no hardcoded escalation shortcut)
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-wn flex items-center justify-center text-wn">
          <Lock size={28} />
        </div>
        <div className="space-y-1 max-w-md">
          <h2 className="text-lg font-bold text-foreground">Khu vực dành cho Quản trị viên</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Bạn đang đăng nhập với tài khoản <strong>{currentUser?.name || currentUser?.email || 'Chuyên viên'}</strong>. Chỉ Quản trị tối cao (Super Admin) hoặc Quản trị viên (Admin) mới có quyền truy cập trang phân quyền tài khoản.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2 flex-wrap justify-center">
          <button
            onClick={async () => {
              try {
                await signOut();
              } catch {}
              router.replace('/sign-up-login');
            }}
            className="btn-primary px-4 py-2 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <ShieldCheck size={16} />
            <span>Đăng nhập tài khoản Quản trị khác</span>
          </button>
          <button
            onClick={() => router.push('/')}
            className="btn-secondary px-4 py-2 text-xs font-semibold cursor-pointer"
          >
            Về Trang Chủ
          </button>
        </div>
      </div>
    );
  }

  const filteredProfiles = profiles.filter(p => {
    if (activeTab !== 'all' && p.role !== activeTab) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = p.full_name?.toLowerCase().includes(q);
      const matchEmail = p.email?.toLowerCase().includes(q);
      const matchBlock = (p.assigned_blocks || []).some(b => b.toLowerCase().includes(q));
      if (!matchName && !matchEmail && !matchBlock) return false;
    }
    return true;
  });

  const openAdd = () => {
    setEditTarget(null);
    setForm({ ...emptyForm, role: 'staff' });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (profile: ProfileRecord) => {
    const perms = getAccountPermissions(profile.role, profile.id);
    if (!perms.canEdit) {
      showToast('Tài khoản này thuộc cấp quản trị cao hơn hoặc ngang cấp được bảo vệ, bạn không có quyền chỉnh sửa.', 'error');
      return;
    }
    setEditTarget(profile);
    setForm({
      full_name: profile.full_name,
      email: profile.email,
      password: '',
      role: profile.role,
      assigned_blocks: profile.assigned_blocks ?? [],
    });
    setFormError('');
    setShowModal(true);
  };

  const toggleBlock = (block: string) => {
    setForm(f => {
      const current = f.assigned_blocks ?? [];
      if (current.includes(block)) {
        return { ...f, assigned_blocks: current.filter(b => b !== block) };
      } else {
        return { ...f, assigned_blocks: [...current, block] };
      }
    });
  };

  const toggleKtxGroup = (group: KtxBlockGroup) => {
    const allChecked = group.blocks.every(b => (form.assigned_blocks ?? []).includes(b));
    if (allChecked) {
      setForm(f => ({ ...f, assigned_blocks: (f.assigned_blocks ?? []).filter(b => !group.blocks.includes(b)) }));
    } else {
      setForm(f => {
        const current = f.assigned_blocks ?? [];
        const merged = [...new Set([...current, ...group.blocks])];
        return { ...f, assigned_blocks: merged };
      });
    }
  };

  const handleSubmit = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setFormError('Vui lòng điền đầy đủ Họ tên và Email.');
      return;
    }
    if (!editTarget && !form.password.trim()) {
      setFormError('Vui lòng nhập mật khẩu cho tài khoản mới.');
      return;
    }
    if (!editTarget && form.password.length < 6) {
      setFormError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }

    // Client-side RBAC guard before hitting database
    const requestedRole: UserRole = editTarget
      ? (getAccountPermissions(editTarget.role, editTarget.id).canChangeRole ? form.role : editTarget.role)
      : (canManageAdmins ? form.role : 'staff');

    if (!canManageAdmins && requestedRole !== 'staff') {
      setFormError('Chỉ Quản trị tối cao (Super Admin) mới có quyền tạo hoặc gán tài khoản Admin.');
      return;
    }
    if (editTarget) {
      const perms = getAccountPermissions(editTarget.role, editTarget.id);
      if (!perms.canEdit) {
        setFormError('Bạn không có quyền chỉnh sửa tài khoản quản trị được bảo vệ.');
        return;
      }
    }
    if (requestedRole === 'super_admin' && editTarget?.role !== 'super_admin') {
      setFormError('Không thể cấp vai trò Quản trị tối cao (Super Admin) từ giao diện.');
      return;
    }

    const effectiveBlocks = requestedRole === 'staff' ? form.assigned_blocks : [];

    setSubmitting(true);
    setFormError('');

    try {
      if (editTarget) {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({
            full_name: form.full_name.trim(),
            role: requestedRole,
            assigned_blocks: effectiveBlocks,
          })
          .eq('id', editTarget.id);

        if (updateErr) {
          setFormError(`Không thể cập nhật trên Supabase: ${updateErr.message}`);
          return;
        }

        const updatedList = profiles.map(p =>
          p.id === editTarget.id
            ? {
                ...p,
                full_name: form.full_name.trim(),
                role: requestedRole,
                assigned_blocks: effectiveBlocks,
                ...(form.password.trim() ? { password: form.password.trim() } : {}),
              }
            : p
        );
        setProfiles(updatedList);
        saveLocalProfiles(updatedList);
        addLog(
          currentUser?.email || 'system',
          'UPDATE',
          `Cập nhật tài khoản ${form.email} (${form.full_name.trim()}) → vai trò ${requestedRole}`
        );
        setShowModal(false);
        showToast(`Đã cập nhật tài khoản ${form.full_name} thành công.`, 'success');
      } else {
        let createdUserId: string | null = null;
        let edgeError: string | null = null;

        try {
          let { data: { session } } = await supabase.auth.getSession();
          if (session && session.access_token !== 'mock-access-token-ktx') {
            try {
              const { data: refreshed } = await supabase.auth.refreshSession();
              if (refreshed?.session?.access_token) {
                session = refreshed.session;
              }
            } catch {}

            const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
            const response = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                email: form.email.trim(),
                password: form.password,
                full_name: form.full_name.trim(),
                role: requestedRole,
                assigned_blocks: effectiveBlocks,
              }),
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && !result.error) {
              createdUserId = result.user?.id || null;
            } else if (result?.error) {
              edgeError = result.error;
            } else if (!response.ok) {
              edgeError = `Lỗi Edge Function (${response.status}).`;
            }
          }
        } catch {
          // Offline or Edge Function unreachable — fall back to profile record below
        }

        if (edgeError) {
          setFormError(edgeError);
          return;
        }

        const newRecord: ProfileRecord = {
          id: createdUserId || `user-${Date.now()}`,
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: requestedRole,
          assigned_blocks: effectiveBlocks,
          password: form.password.trim(),
          created_at: new Date().toISOString(),
        };

        if (!createdUserId) {
          const { error: insertErr } = await supabase.from('profiles').insert({
            id: newRecord.id,
            email: newRecord.email,
            full_name: newRecord.full_name,
            role: newRecord.role,
            assigned_blocks: newRecord.assigned_blocks,
          });
          if (insertErr) {
            setFormError(`Không thể lưu tài khoản: ${insertErr.message}`);
            return;
          }
        }

        const nextProfiles = [newRecord, ...profiles];
        setProfiles(nextProfiles);
        saveLocalProfiles(nextProfiles);
        addLog(
          currentUser?.email || 'system',
          'CREATE',
          `Tạo tài khoản mới ${newRecord.email} (${newRecord.full_name}) với vai trò ${requestedRole}`
        );
        setShowModal(false);
        showToast(`Đã tạo tài khoản ${form.full_name} (${form.email}) thành công!`, 'success');
      }
    } catch (err) {
      setFormError(`Lỗi kết nối: ${err instanceof Error ? err.message : 'Không xác định'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const perms = getAccountPermissions(deleteTarget.role, deleteTarget.id);
    if (!perms.canDelete) {
      showToast('Bạn không có quyền xóa tài khoản này.', 'error');
      setDeleteTarget(null);
      return;
    }

    setSubmitting(true);
    try {
      let edgeError: string | null = null;
      let deletedInEdge = false;
      try {
        let { data: { session } } = await supabase.auth.getSession();
        if (session && session.access_token !== 'mock-access-token-ktx') {
          try {
            const { data: refreshed } = await supabase.auth.refreshSession();
            if (refreshed?.session?.access_token) {
              session = refreshed.session;
            }
          } catch {}

          const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
          const response = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ user_id: deleteTarget.id }),
          });
          const resJson = await response.json().catch(() => ({}));
          if (response.ok) {
            deletedInEdge = true;
          } else if (response.status !== 404 && resJson?.error) {
            edgeError = resJson.error;
          }
        }
      } catch {}

      if (edgeError) {
        showToast(edgeError, 'error');
        return;
      }

      if (!deletedInEdge) {
        const { error: delErr } = await supabase.from('profiles').delete().eq('id', deleteTarget.id);
        if (delErr) {
          showToast(`Không thể xóa tài khoản: ${delErr.message}`, 'error');
          return;
        }
      }

      const nextProfiles = profiles.filter(p => p.id !== deleteTarget.id);
      setProfiles(nextProfiles);
      saveLocalProfiles(nextProfiles);
      addLog(
        currentUser?.email || 'system',
        'DELETE',
        `Xóa tài khoản ${deleteTarget.email} (${deleteTarget.full_name}, vai trò ${deleteTarget.role})`
      );
      showToast(`Đã xóa tài khoản ${deleteTarget.full_name} thành công.`, 'success');
      setDeleteTarget(null);
    } catch (err) {
      showToast(`Lỗi kết nối: ${err instanceof Error ? err.message : 'Không xác định'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    const perms = getAccountPermissions(resetTarget.role, resetTarget.id);
    const isSelf = resetTarget.id === currentUser?.id;
    if (!perms.canEdit || isSelf) {
      setResetError('Bạn không có quyền đặt lại mật khẩu cho tài khoản này.');
      return;
    }
    if (!resetPassword || resetPassword.length < 6) {
      setResetError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }

    setSubmitting(true);
    setResetError('');
    try {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session || session.access_token === 'mock-access-token-ktx') {
        const nextProfiles = profiles.map(p =>
          p.id === resetTarget.id ? { ...p, password: resetPassword } : p
        );
        setProfiles(nextProfiles);
        saveLocalProfiles(nextProfiles);
        addLog(
          currentUser?.email || 'system',
          'USER_PASSWORD_RESET',
          `Đặt lại mật khẩu cục bộ cho tài khoản ${resetTarget.email} (${resetTarget.full_name})`
        );
        showToast(`Đã đặt lại mật khẩu cho ${resetTarget.full_name}.`, 'success');
        setResetTarget(null);
        setResetPassword('');
        return;
      }

      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session?.access_token) {
          session = refreshed.session;
        }
      } catch {}

      const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
      const response = await fetch(`${supabaseUrl}/functions/v1/reset-user-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          user_id: resetTarget.id,
          new_password: resetPassword,
        }),
      });
      const resJson = await response.json().catch(() => ({}));
      if (!response.ok || resJson?.error) {
        if (response.status === 404) {
          setResetError('Chưa deploy Edge Function "reset-user-password" trên Supabase Dashboard.');
        } else {
          setResetError(resJson?.error || `Lỗi đặt lại mật khẩu (${response.status}).`);
        }
        return;
      }

      addLog(
        currentUser?.email || 'system',
        'USER_PASSWORD_RESET',
        `Đặt lại mật khẩu cho tài khoản ${resetTarget.email} (${resetTarget.full_name}, vai trò ${resetTarget.role})`
      );
      showToast(`Đã đặt lại mật khẩu mới cho ${resetTarget.full_name} thành công.`, 'success');
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setResetError(`Lỗi kết nối: ${err instanceof Error ? err.message : 'Không xác định'}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper for theme-aware dynamic colors on architectural chips
  const getColorClasses = (color: string) => {
    switch (color) {
      case 'orange':
      case 'amber':
        return {
          border: 'border-wn/40',
          headerBg: 'tint-wn',
          headerText: 'text-wn',
          badgeText: 'text-wn',
          badgeBg: 'tint-wn border-wn/35',
          itemChecked: 'tint-wn border-wn text-wn font-semibold',
        };
      case 'emerald':
      case 'cyan':
        return {
          border: 'border-ok2/35',
          headerBg: 'bg-okbg',
          headerText: 'text-ok',
          badgeText: 'text-ok',
          badgeBg: 'bg-okbg border-ok2/35',
          itemChecked: 'bg-okbg border-ok2 text-ok font-semibold',
        };
      case 'purple':
        return {
          border: 'border-pink-tint',
          headerBg: 'tint-pink',
          headerText: 'text-pink-tone',
          badgeText: 'text-pink-tone',
          badgeBg: 'tint-pink border-pink-tint',
          itemChecked: 'tint-pink border-pink-tint text-pink-tone font-semibold',
        };
      case 'rose':
        return {
          border: 'border-dgr/40',
          headerBg: 'bg-dgrbg',
          headerText: 'text-dgr',
          badgeText: 'text-dgr',
          badgeBg: 'bg-dgrbg border-dgr/40',
          itemChecked: 'bg-dgrbg border-dgr text-dgr font-semibold',
        };
      default: // blue
        return {
          border: 'border-pri2/35',
          headerBg: 'bg-bdg',
          headerText: 'text-lnk',
          badgeText: 'text-lnk',
          badgeBg: 'bg-bdg border-bdr2',
          itemChecked: 'bg-bdg border-bdr2 text-lnk font-semibold',
        };
    }
  };

  // Helper to render assigned blocks grouped by any dynamic KTX
  const renderAssignedBlocks = (assignedBlocks: string[]) => {
    if (!assignedBlocks || assignedBlocks.length === 0) {
      return <span className="text-xs text-wn">Chưa gán dãy</span>;
    }

    // Group assigned blocks by their prefix (e.g. "KTX 1", "KTX 2", "KTX 3", etc.)
    const groupedMap = new Map<string, string[]>();
    assignedBlocks.forEach(b => {
      if (b.includes(' - ')) {
        const [ktx, day] = b.split(' - ');
        if (!groupedMap.has(ktx.trim())) groupedMap.set(ktx.trim(), []);
        groupedMap.get(ktx.trim())!.push(day.trim());
      } else {
        if (!groupedMap.has('Khác')) groupedMap.set('Khác', []);
        groupedMap.get('Khác')!.push(b);
      }
    });

    const entries = Array.from(groupedMap.entries());

    return (
      <div className="flex flex-col gap-1.5">
        {entries.map(([ktx, days], idx) => {
          const colorKey = ktxGroups.find(g => g.ktx === ktx)?.color || (idx % 2 === 0 ? 'blue' : 'orange');
          const styling = getColorClasses(colorKey);

          return (
            <div key={ktx} className="flex flex-wrap items-center gap-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${styling.headerBg} ${styling.headerText} border ${styling.border}`}>
                {ktx}:
              </span>
              {days.map(d => (
                <span
                  key={d}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${styling.badgeBg} ${styling.badgeText}`}
                >
                  {d}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-bdr">
        <div className="flex items-center gap-3">
          <CraftIconBadge icon={UserCog} badgeIcon={ShieldCheck} tone="blue" size="md" />
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-tx tracking-tight">Quản lý Tài khoản</h1>
            <p className="text-xs sm:text-sm text-mu mt-0.5">Tạo tài khoản, gán vai trò và phân quyền phụ trách KTX + Dãy</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              loadProfiles();
              reloadKtxStructure();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surf border border-bdr2 text-tx text-xs sm:text-sm font-semibold hover:bg-act shadow-sm cursor-pointer transition-colors"
            title="Tải lại danh sách"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-pri2' : 'text-mu'} />
            <span>Làm mới</span>
          </button>
          <button
            onClick={openAdd}
            className="btn-glow-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <UserPlus size={15} />
            <span>Tạo tài khoản mới</span>
          </button>
        </div>
      </div>

      {/* Tier Authority Summary Banner */}
      <div className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
        isSuperAdmin ? 'tint-wn border-wn/40' : 'surface-elevated'
      }`}>
        <div className="flex items-start gap-3">
          <CraftIconBadge icon={isSuperAdmin ? Crown : ShieldCheck} tone={isSuperAdmin ? 'amber' : 'blue'} size="md" interactive={false} />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-tx">
              {isSuperAdmin
                ? 'Cấp 1 — Quản trị tối cao (Super Admin)'
                : 'Cấp 2 — Quản trị viên vận hành (Admin)'}
            </p>
            <p className="text-xs text-mu mt-0.5 leading-relaxed">
              {isSuperAdmin
                ? 'Toàn quyền hệ thống: tạo/sửa/xóa tài khoản Admin và Staff, thực hiện thao tác xóa toàn bộ dữ liệu lớn, và được bảo vệ tuyệt đối trước các cấp thấp hơn.'
                : 'Toàn quyền vận hành KTX và quản lý tài khoản Staff. Tài khoản Super Admin và các Admin khác được bảo vệ, không thể chỉnh sửa hoặc xóa từ cấp này.'}
            </p>
          </div>
        </div>
        <StatusTag tone={isSuperAdmin ? 'amber' : 'blue'} size="sm" icon={isSuperAdmin ? Crown : ShieldCheck} className="shrink-0 self-start sm:self-center">
          {isSuperAdmin ? 'Quản lý Admin + Staff' : 'Chỉ quản lý Staff'}
        </StatusTag>
      </div>

      {/* Main Card */}
      <div className="surface-elevated rounded-2xl overflow-hidden">
        {/* Filter Tabs and Search Bar */}
        <div className="px-4 sm:px-6 pt-3.5 pb-3 border-b border-bdr flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SlidingTabs<'all' | 'super_admin' | 'admin' | 'staff'>
            layoutId="user-mgmt-role-tabs"
            compact
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'all', label: 'Tất cả', count: profiles.length },
              { id: 'super_admin', label: 'Chủ HT', count: profiles.filter(p => p.role === 'super_admin').length },
              { id: 'admin', label: 'Admin', count: profiles.filter(p => p.role === 'admin').length },
              { id: 'staff', label: 'Staff', count: profiles.filter(p => p.role === 'staff').length },
            ]}
          />

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm theo tên, email, dãy..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-16 text-center text-muted-foreground flex flex-col items-center gap-2">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <p className="text-xs">Đang tải danh sách tài khoản...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-act/95 backdrop-blur-md text-mu text-[11px] uppercase tracking-wider font-bold border-b border-bdr2 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3">Họ và tên</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Cấp phân quyền</th>
                  <th className="px-4 py-3">KTX + Dãy phụ trách</th>
                  <th className="px-4 py-3">Ngày tạo</th>
                  <th className="px-4 py-3 w-28">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-xs">
                      Không có tài khoản nào.
                    </td>
                  </tr>
                ) : (
                  filteredProfiles.map((profile) => {
                    const perms = getAccountPermissions(profile.role, profile.id);
                    const isSelf = profile.id === currentUser?.id;

                    return (
                      <tr key={profile.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-semibold text-foreground whitespace-normal break-words">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{profile.full_name || '—'}</span>
                            {isSelf && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                                Bạn
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                          {profile.email}
                        </td>
                        <td className="px-4 py-3">
                          {profile.role === 'super_admin' ? (
                            <StatusTag tone="amber" icon={Crown}>
                              Chủ HT (Super Admin)
                            </StatusTag>
                          ) : profile.role === 'admin' ? (
                            <StatusTag tone="rose" icon={ShieldCheck}>
                              Admin
                            </StatusTag>
                          ) : (
                            <StatusTag tone="blue" icon={Shield}>
                              Staff
                            </StatusTag>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {profile.role === 'super_admin' ? (
                            <span className="text-xs text-wn font-medium">Toàn quyền hệ thống • Toàn bộ KTX</span>
                          ) : profile.role === 'admin' ? (
                            <span className="text-xs text-muted-foreground italic font-medium">Toàn bộ KTX (Vận hành)</span>
                          ) : (
                            renderAssignedBlocks(profile.assigned_blocks)
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {profile.created_at ? new Date(profile.created_at).toLocaleDateString('vi-VN') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {!perms.canEdit && !perms.canDelete ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/60 text-muted-foreground text-[11px] font-medium"
                              title="Tài khoản được bảo vệ bởi phân cấp quản trị"
                            >
                              <Lock size={11} /> Được bảo vệ
                            </span>
                          ) : (
                            <div className="flex items-center gap-1">
                              {perms.canEdit && (
                                <button
                                  onClick={() => openEdit(profile)}
                                  title="Sửa tài khoản"
                                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                  <Pencil size={14} />
                                </button>
                              )}
                              {perms.canEdit && !isSelf && (
                                <button
                                  onClick={() => {
                                    setResetTarget(profile);
                                    setResetPassword('');
                                    setResetError('');
                                  }}
                                  title="Đặt lại mật khẩu"
                                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-wn cursor-pointer"
                                >
                                  <KeyRound size={14} />
                                </button>
                              )}
                              {perms.canDelete && (
                                <button
                                  onClick={() => setDeleteTarget(profile)}
                                  title="Xóa tài khoản"
                                  className="p-1.5 rounded-lg hover:bg-dgrbg transition-colors text-muted-foreground hover:text-dgr cursor-pointer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Database Migration Readiness Panel */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-bdg border border-bdr2 flex items-center justify-center text-lnk shrink-0">
              <Database size={17} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Trạng thái nâng cấp Database (SQL Migrations)</h2>
              <p className="text-xs text-muted-foreground">
                Kiểm tra 4 bản vá SQL trong thư mục <code className="px-1 py-0.5 rounded bg-muted">supabase/migrations/</code> đã được chạy trên Supabase hay chưa
              </p>
            </div>
          </div>
          {canRunMigrations ? (
            <button
              type="button"
              onClick={checkDatabaseMigrations}
              disabled={checkingMigrations}
              className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <RefreshCw size={13} className={checkingMigrations ? 'animate-spin' : ''} />
              <span>{checkingMigrations ? 'Đang kiểm tra...' : 'Kiểm tra kết nối Migration'}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-[11px] font-medium self-start sm:self-auto">
              <Lock size={12} /> Dành riêng cho Super Admin kiểm tra
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            {
              file: 'supabase/migrations/20261116000000_create_worker_entry_log.sql',
              title: 'Sổ nhật ký biến động vào/ra (worker_entry_log)',
              status: migrationStatus.entryLog,
            },
            {
              file: 'supabase/migrations/20261116010000_harden_rls_policies.sql',
              title: 'Siết RLS & hàm tra cứu QR (lookup_worker_qr)',
              status: migrationStatus.rlsLookup,
            },
            {
              file: 'supabase/migrations/20261117000000_add_super_admin_rbac.sql',
              title: 'Phân quyền 3 cấp (Super Admin > Admin > Staff)',
              status: migrationStatus.superAdminRbac,
            },
            {
              file: 'supabase/migrations/20261118000000_package_a_security_hardening.sql',
              title: 'Bảo mật Gói A (RLS theo dãy, Audit Append-only & RPC)',
              status: migrationStatus.packageASecurity,
            },
          ].map(item => (
            <div key={item.file} className="p-3.5 rounded-xl border border-border bg-muted/20 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-foreground">{item.title}</span>
                {item.status === 'applied' ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-okbg text-ok border border-bdr2 shrink-0">
                    Đã áp dụng
                  </span>
                ) : item.status === 'missing' ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold tint-wn text-wn border border-wn shrink-0">
                    Chưa chạy SQL
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-muted text-muted-foreground shrink-0">
                    Chưa kiểm tra
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <code className="truncate font-mono">{item.file}</code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(item.file);
                    setCopiedMigrationPath(item.file);
                    setTimeout(() => setCopiedMigrationPath(null), 2000);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-muted text-foreground shrink-0"
                  title="Sao chép đường dẫn file SQL"
                >
                  {copiedMigrationPath === item.file ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                  <span>{copiedMigrationPath === item.file ? 'Đã chép' : 'Chép path'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {migrationStatus.checkedAt && (
          <p className="text-[11px] text-muted-foreground">
            Lần kiểm tra gần nhất: <span className="font-tabular">{migrationStatus.checkedAt}</span>
            {(migrationStatus.entryLog === 'missing' ||
              migrationStatus.rlsLookup === 'missing' ||
              migrationStatus.superAdminRbac === 'missing' ||
              migrationStatus.packageASecurity === 'missing') &&
              ' — Mở Supabase Dashboard → SQL Editor và chạy các file được đánh dấu "Chưa chạy SQL" để bật đầy đủ tính năng.'}
          </p>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col my-auto text-foreground overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-border bg-muted/30 shrink-0">
              <h2 className="text-lg font-bold text-foreground">
                {editTarget ? 'Sửa tài khoản' : 'Tạo tài khoản mới'}
              </h2>
              {!editTarget && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tài khoản sẽ được tạo trong Supabase Auth và lưu vào bảng profiles.
                </p>
              )}
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="px-6 py-4 flex-1 overflow-y-auto space-y-4">
              {formError && (
                <div className="flex items-start gap-2 text-xs text-dgr tint-dgr px-3 py-2.5 rounded-lg border border-dgr/35">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span className="whitespace-normal break-words">{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Họ và tên *</label>
                <input
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="Nguyễn Văn A"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Email *</label>
                <input
                  type="email"
                  disabled={!!editTarget}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 disabled:cursor-not-allowed font-mono text-xs sm:text-sm"
                  placeholder="email@ktx.vn"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
                {editTarget && <p className="text-xs text-muted-foreground mt-1">Email không thể thay đổi sau khi tạo.</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  {editTarget ? 'Đổi mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu * (tối thiểu 6 ký tự)'}
                </label>
                <input
                  type="password"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder={editTarget ? 'Nhập mật khẩu mới nếu muốn đổi' : '••••••'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Vai trò phân quyền</label>
                {editTarget?.role === 'super_admin' ? (
                  <div className="w-full border border-wn/60 tint-wn rounded-lg px-3 py-2 text-sm font-bold text-wn flex items-center gap-2">
                    <Crown size={14} />
                    <span>Quản trị tối cao (Super Admin — Bất khả xâm phạm)</span>
                  </div>
                ) : !canManageAdmins ? (
                  <div className="space-y-1">
                    <div className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-muted/40 text-foreground font-medium">
                      Staff (Bảo vệ / Chuyên viên phụ trách dãy)
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Chỉ Quản trị tối cao (Super Admin) mới có quyền tạo hoặc thay đổi vai trò Admin.
                    </p>
                  </div>
                ) : (
                  <select
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                    value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
                  >
                    <option value="staff">Staff (Chuyên viên / Quản lý dãy)</option>
                    <option value="admin">Admin (Quản lý vận hành toàn KTX — dưới quyền Super Admin)</option>
                  </select>
                )}
              </div>

              {/* Dynamic Assigned Blocks Section — grouped by all dynamic KTXs */}
              {form.role === 'staff' && (
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Building2 size={14} className="text-primary" />
                      <span>Phân quyền phụ trách KTX + Dãy</span>
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                      (Staff chỉ Thêm/Sửa/Xóa công nhân ở tổ hợp được chọn)
                    </span>
                  </div>

                  {/* Container for All KTX Groups */}
                  {ktxGroups.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed tint-wn border-wn text-center space-y-2">
                      <p className="text-xs text-wn font-medium">
                        Chưa có dữ liệu KTX/Dãy, hãy nhập phòng trước
                      </p>
                      <button
                        type="button"
                        onClick={() => reloadKtxStructure(true)}
                        className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={13} />
                        <span>Tải lại dữ liệu</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                      {ktxGroups.map((group) => {
                        const styling = getColorClasses(group.color);
                        const checkedCount = group.blocks.filter(b => (form.assigned_blocks ?? []).includes(b)).length;
                        const allChecked = group.blocks.length > 0 && checkedCount === group.blocks.length;
                        const someChecked = checkedCount > 0 && !allChecked;

                        return (
                          <div
                            key={group.ktx}
                            className={`shrink-0 border rounded-xl overflow-hidden transition-all ${styling.border} bg-card`}
                          >
                            {/* KTX Header with "Select All" Checkbox */}
                            <div className={`flex items-center gap-2.5 px-3 py-2 ${styling.headerBg} border-b ${styling.border}`}>
                              <input
                                type="checkbox"
                                disabled={group.blocks.length === 0}
                                checked={allChecked}
                                ref={el => {
                                  if (el) el.indeterminate = someChecked;
                                }}
                                onChange={() => toggleKtxGroup(group)}
                                className="accent-primary w-4 h-4 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                              <span className={`text-sm font-bold ${styling.headerText}`}>
                                {group.ktx}
                              </span>
                              <span className="text-xs text-muted-foreground ml-auto font-medium">
                                {group.blocks.length === 0 ? 'Chưa có dãy' : `${checkedCount}/${group.blocks.length} dãy được chọn`}
                              </span>
                            </div>

                            {/* Individual Day Checkboxes Grid or Empty Notice */}
                            {group.blocks.length === 0 ? (
                              <div className="p-3 bg-muted/10 text-xs text-muted-foreground italic font-medium">
                                KTX này chưa có dãy, hãy cập nhật dữ liệu
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 bg-muted/10">
                                {group.blocks.map(block => {
                                  const checked = (form.assigned_blocks ?? []).includes(block);
                                  const dayLabel = block.replace(`${group.ktx} - `, '');

                                  return (
                                    <label
                                      key={block}
                                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all text-xs select-none ${
                                        checked
                                          ? styling.itemChecked
                                          : 'bg-background border-border text-muted-foreground hover:border-primary/40'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleBlock(block)}
                                        className="accent-primary w-3.5 h-3.5 cursor-pointer"
                                      />
                                      <span className="font-medium">{dayLabel}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(form.assigned_blocks ?? []).length === 0 && (
                    <p className="text-xs text-wn mt-2 font-medium">
                      ⚠ Chưa gán dãy — Staff này sẽ không thể Thêm/Sửa/Xóa công nhân nào.
                    </p>
                  )}
                  {(form.assigned_blocks ?? []).length > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
                      ✓ Đã gán {(form.assigned_blocks ?? []).length} tổ hợp KTX + Dãy
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-border bg-muted/20 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={submitting}
                className="btn-secondary text-sm cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary text-sm flex items-center gap-1.5 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <span>{editTarget ? 'Lưu thay đổi' : 'Tạo tài khoản'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground">Xác nhận xóa tài khoản</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Bạn có chắc chắn muốn xóa tài khoản <strong>{deleteTarget.full_name}</strong> ({deleteTarget.email})? Thao tác này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={submitting}
                className="btn-secondary text-sm cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-dgr hover:opacity-90 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                {submitting ? 'Đang xóa...' : 'Xóa tài khoản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl tint-wn border border-wn flex items-center justify-center text-wn shrink-0">
                <KeyRound size={17} />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Đặt lại mật khẩu</h3>
                <p className="text-xs text-muted-foreground">
                  {resetTarget.full_name} ({resetTarget.email})
                </p>
              </div>
            </div>

            {resetError && (
              <div className="flex items-start gap-2 text-xs text-dgr bg-dgrbg px-3 py-2.5 rounded-lg border border-dgr/40">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{resetError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Mật khẩu mới (tối thiểu 6 ký tự)
              </label>
              <input
                type="password"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder="Nhập mật khẩu mới..."
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword('');
                  setResetError('');
                }}
                disabled={submitting}
                className="btn-secondary text-sm cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleResetPassword}
                disabled={submitting}
                className="btn-primary text-sm flex items-center gap-1.5 cursor-pointer"
              >
                <KeyRound size={14} />
                <span>{submitting ? 'Đang cập nhật...' : 'Xác nhận đổi mật khẩu'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
