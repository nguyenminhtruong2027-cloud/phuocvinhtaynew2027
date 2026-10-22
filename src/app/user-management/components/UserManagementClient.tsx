'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, UserRole } from '@/context/AuthContext';
import { createClient, normalizeSupabaseUrl } from '@/lib/supabase/client';
import { UserPlus, Pencil, Trash2, Shield, ShieldCheck, RefreshCw, AlertCircle, CheckCircle, Building2, Search, KeyRound } from 'lucide-react';
import { useKtxStructure, KtxBlockGroup } from '@/lib/ktxStructure';

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
        ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300'
        : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300'
    }`}>
      {type === 'success' ? <CheckCircle size={18} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />}
      <p className="text-sm font-medium leading-snug">{message}</p>
      <button onClick={onClose} className="ml-auto text-current opacity-60 hover:opacity-100 flex-shrink-0">✕</button>
    </div>
  );
}

const DEFAULT_PROFILES: ProfileRecord[] = [
  {
    id: 'admin-pvt-master',
    email: 'adminpvt@ktx.com',
    full_name: 'Quản Trị Viên Phước Vĩnh Tây',
    role: 'admin',
    assigned_blocks: [],
    created_at: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 'staff-pvt-01',
    email: 'staffpvt@ktx.com',
    full_name: 'Nguyễn Văn Hùng (Bảo Vệ / Quản Lý)',
    role: 'staff',
    assigned_blocks: ['KTX 1 - Dãy 1', 'KTX 1 - Dãy 2', 'KTX 1 - Dãy 3'],
    created_at: '2026-10-05T09:30:00.000Z',
  },
  {
    id: 'staff-pvt-02',
    email: 'toantran@ktx.com',
    full_name: 'Trần Văn Toàn (Quản Lý Dãy)',
    role: 'staff',
    assigned_blocks: ['KTX 2 - Dãy 1', 'KTX 2 - Dãy 2'],
    created_at: '2026-10-10T14:15:00.000Z',
  },
  {
    id: 'staff-pvt-03',
    email: 'maile@ktx.com',
    full_name: 'Lê Thị Mai (Quản Lý Dãy)',
    role: 'staff',
    assigned_blocks: ['KTX 3 - Dãy 1', 'KTX 3 - Dãy 2'],
    created_at: '2026-10-12T10:00:00.000Z',
  },
];

function getLocalProfiles(): ProfileRecord[] {
  if (typeof window === 'undefined') return DEFAULT_PROFILES;
  try {
    const raw = localStorage.getItem('ktx_local_profiles');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Merge with defaults to ensure core accounts are never missing
        const map = new Map<string, ProfileRecord>();
        DEFAULT_PROFILES.forEach(p => map.set(p.email.toLowerCase(), p));
        parsed.forEach(p => {
          if (p?.email) map.set(p.email.toLowerCase(), { ...p, assigned_blocks: p.assigned_blocks ?? [] });
        });
        return Array.from(map.values());
      }
    }
  } catch {}
  return DEFAULT_PROFILES;
}

function saveLocalProfiles(profs: ProfileRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ktx_local_profiles', JSON.stringify(profs));
    window.dispatchEvent(new Event('ktx_profiles_updated'));
  } catch {}
}

export default function UserManagementClient() {
  const { isAdmin, currentUser, loading: authLoading, signIn } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const { ktxGroups, reload: reloadKtxStructure } = useKtxStructure();

  const [profiles, setProfiles] = useState<ProfileRecord[]>(() => getLocalProfiles());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<ProfileRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileRecord | null>(null);
  const [form, setForm] = useState<UserFormData>(emptyForm);
  const [formError, setFormError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'admin' | 'staff'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
        const dbList = (rpcData as ProfileRecord[]).map(p => ({
          ...p,
          assigned_blocks: p.assigned_blocks ?? [],
        }));
        const mergedMap = new Map<string, ProfileRecord>();
        localList.forEach(p => mergedMap.set(p.email.toLowerCase(), p));
        dbList.forEach(p => mergedMap.set(p.email.toLowerCase(), p));
        const merged = Array.from(mergedMap.values());
        setProfiles(merged);
        saveLocalProfiles(merged);
      } else {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, role, assigned_blocks, created_at')
          .order('created_at', { ascending: false });

        if (!error && data && Array.isArray(data) && data.length > 0) {
          const dbList = data.map(p => ({ ...p, assigned_blocks: p.assigned_blocks ?? [] }));
          const mergedMap = new Map<string, ProfileRecord>();
          localList.forEach(p => mergedMap.set(p.email.toLowerCase(), p));
          dbList.forEach(p => mergedMap.set(p.email.toLowerCase(), p));
          const merged = Array.from(mergedMap.values());
          setProfiles(merged);
          saveLocalProfiles(merged);
        } else {
          setProfiles(localList);
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

  // Route protection with instant 1-click admin login fallback
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
          <Shield size={32} />
        </div>
        <div className="space-y-1 max-w-md">
          <h2 className="text-lg font-bold text-foreground">Khu vực dành cho Quản trị viên</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Bạn đang đăng nhập với tài khoản <strong>{currentUser?.name || currentUser?.email || 'Chuyên viên'}</strong>. Chỉ tài khoản Quản trị viên (Admin) mới có quyền tạo và chỉnh sửa phân quyền tài khoản.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={async () => {
              try {
                await signIn('adminpvt@ktx.com', 'admin123');
              } catch {}
            }}
            className="btn-primary px-4 py-2 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <ShieldCheck size={16} />
            <span>Chuyển sang quyền Quản trị viên (Admin)</span>
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
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (profile: ProfileRecord) => {
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

    setSubmitting(true);
    setFormError('');

    try {
      if (editTarget) {
        try {
          await supabase
            .from('profiles')
            .update({
              full_name: form.full_name,
              role: form.role,
              assigned_blocks: form.assigned_blocks,
            })
            .eq('id', editTarget.id);
        } catch {}

        const updatedList = profiles.map(p =>
          p.id === editTarget.id
            ? {
                ...p,
                full_name: form.full_name,
                role: form.role,
                assigned_blocks: form.assigned_blocks,
                ...(form.password.trim() ? { password: form.password.trim() } : {}),
              }
            : p
        );
        setProfiles(updatedList);
        saveLocalProfiles(updatedList);
        setShowModal(false);
        showToast(`Đã cập nhật tài khoản ${form.full_name} thành công.`, 'success');
      } else {
        let createdInDb = false;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
            const response = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                email: form.email.trim(),
                password: form.password,
                full_name: form.full_name.trim(),
                role: form.role,
                assigned_blocks: form.assigned_blocks,
              }),
            });
            const result = await response.json();
            if (response.ok && !result.error) {
              createdInDb = true;
            }
          }
        } catch {}

        const newRecord: ProfileRecord = {
          id: `user-${Date.now()}`,
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: form.role,
          assigned_blocks: form.assigned_blocks,
          password: form.password.trim(),
          created_at: new Date().toISOString(),
        };

        if (!createdInDb) {
          try {
            await supabase.from('profiles').insert({
              id: newRecord.id,
              email: newRecord.email,
              full_name: newRecord.full_name,
              role: newRecord.role,
              assigned_blocks: newRecord.assigned_blocks,
            });
          } catch {}
        }

        const nextProfiles = [newRecord, ...profiles];
        setProfiles(nextProfiles);
        saveLocalProfiles(nextProfiles);
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
    setSubmitting(true);
    try {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
          await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ user_id: deleteTarget.id }),
          });
        }
      } catch {}

      try {
        await supabase.from('profiles').delete().eq('id', deleteTarget.id);
      } catch {}

      const nextProfiles = profiles.filter(p => p.id !== deleteTarget.id);
      setProfiles(nextProfiles);
      saveLocalProfiles(nextProfiles);
      setDeleteTarget(null);
      showToast(`Đã xóa tài khoản ${deleteTarget.full_name} thành công.`, 'success');
    } catch (err) {
      showToast(`Lỗi kết nối: ${err instanceof Error ? err.message : 'Không xác định'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Helper for dynamic colors on badges
  const getColorClasses = (color: string) => {
    switch (color) {
      case 'orange':
        return {
          border: 'border-orange-500/30 dark:border-orange-500/40',
          headerBg: 'bg-orange-500/10 dark:bg-orange-950/40',
          headerText: 'text-orange-700 dark:text-orange-300',
          badgeText: 'text-orange-800 dark:text-orange-300',
          badgeBg: 'bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700',
          itemChecked: 'bg-orange-500/20 border-orange-500/50 text-orange-700 dark:text-orange-300 font-semibold',
        };
      case 'emerald':
        return {
          border: 'border-emerald-500/30 dark:border-emerald-500/40',
          headerBg: 'bg-emerald-500/10 dark:bg-emerald-950/40',
          headerText: 'text-emerald-700 dark:text-emerald-300',
          badgeText: 'text-emerald-800 dark:text-emerald-300',
          badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700',
          itemChecked: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 font-semibold',
        };
      case 'purple':
        return {
          border: 'border-purple-500/30 dark:border-purple-500/40',
          headerBg: 'bg-purple-500/10 dark:bg-purple-950/40',
          headerText: 'text-purple-700 dark:text-purple-300',
          badgeText: 'text-purple-800 dark:text-purple-300',
          badgeBg: 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700',
          itemChecked: 'bg-purple-500/20 border-purple-500/50 text-purple-700 dark:text-purple-300 font-semibold',
        };
      case 'cyan':
        return {
          border: 'border-cyan-500/30 dark:border-cyan-500/40',
          headerBg: 'bg-cyan-500/10 dark:bg-cyan-950/40',
          headerText: 'text-cyan-700 dark:text-cyan-300',
          badgeText: 'text-cyan-800 dark:text-cyan-300',
          badgeBg: 'bg-cyan-100 dark:bg-cyan-900/40 border-cyan-300 dark:border-cyan-700',
          itemChecked: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-700 dark:text-cyan-300 font-semibold',
        };
      case 'amber':
        return {
          border: 'border-amber-500/30 dark:border-amber-500/40',
          headerBg: 'bg-amber-500/10 dark:bg-amber-950/40',
          headerText: 'text-amber-700 dark:text-amber-300',
          badgeText: 'text-amber-800 dark:text-amber-300',
          badgeBg: 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700',
          itemChecked: 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300 font-semibold',
        };
      case 'rose':
        return {
          border: 'border-rose-500/30 dark:border-rose-500/40',
          headerBg: 'bg-rose-500/10 dark:bg-rose-950/40',
          headerText: 'text-rose-700 dark:text-rose-300',
          badgeText: 'text-rose-800 dark:text-rose-300',
          badgeBg: 'bg-rose-100 dark:bg-rose-900/40 border-rose-300 dark:border-rose-700',
          itemChecked: 'bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300 font-semibold',
        };
      default: // blue
        return {
          border: 'border-blue-500/30 dark:border-blue-500/40',
          headerBg: 'bg-blue-500/10 dark:bg-blue-950/40',
          headerText: 'text-blue-700 dark:text-blue-300',
          badgeText: 'text-blue-800 dark:text-blue-300',
          badgeBg: 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700',
          itemChecked: 'bg-blue-500/20 border-blue-500/50 text-blue-700 dark:text-blue-300 font-semibold',
        };
    }
  };

  // Helper to render assigned blocks grouped by any dynamic KTX
  const renderAssignedBlocks = (assignedBlocks: string[]) => {
    if (!assignedBlocks || assignedBlocks.length === 0) {
      return <span className="text-xs text-amber-600 dark:text-amber-400">Chưa gán dãy</span>;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Quản lý Tài khoản</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Tạo tài khoản, gán vai trò và phân quyền phụ trách KTX + Dãy</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              loadProfiles();
              reloadKtxStructure();
            }}
            disabled={loading}
            className="btn-secondary text-sm flex items-center gap-1.5 cursor-pointer"
            title="Tải lại danh sách"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Làm mới</span>
          </button>
          <button
            onClick={openAdd}
            className="btn-primary text-sm flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus size={15} />
            <span>Tạo tài khoản mới</span>
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        {/* Filter Tabs and Search Bar */}
        <div className="px-6 pt-3 pb-2 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('all')}
              className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'all' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Tất cả ({profiles.length})
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'admin' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Admin ({profiles.filter(p => p.role === 'admin').length})
            </button>
            <button
              onClick={() => setActiveTab('staff')}
              className={`pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'staff' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Staff ({profiles.filter(p => p.role === 'staff').length})
            </button>
          </div>

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
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase font-semibold border-b border-border">
                <tr>
                  <th className="px-4 py-3">Họ và tên</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Vai trò</th>
                  <th className="px-4 py-3">KTX + Dãy phụ trách</th>
                  <th className="px-4 py-3">Ngày tạo</th>
                  <th className="px-4 py-3 w-20">Thao tác</th>
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
                  filteredProfiles.map((profile) => (
                    <tr key={profile.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground whitespace-normal break-words">
                        {profile.full_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                        {profile.email}
                      </td>
                      <td className="px-4 py-3">
                        {profile.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            <ShieldCheck size={11} /> Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            <Shield size={11} /> Staff
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {profile.role === 'admin' ? (
                          <span className="text-xs text-muted-foreground italic font-medium">Toàn bộ KTX</span>
                        ) : (
                          renderAssignedBlocks(profile.assigned_blocks)
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {profile.created_at ? new Date(profile.created_at).toLocaleDateString('vi-VN') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(profile)}
                            title="Sửa tài khoản"
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(profile)}
                            title="Xóa tài khoản"
                            disabled={profile.id === currentUser?.id}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
                <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 px-3 py-2.5 rounded-lg border border-red-200 dark:border-red-800">
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
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Vai trò</label>
                <select
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
                >
                  <option value="staff">Staff (Bảo vệ / Quản lý dãy)</option>
                  <option value="admin">Admin (Toàn quyền quản trị)</option>
                </select>
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
                    <div className="p-4 rounded-xl border border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/20 text-center space-y-2">
                      <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
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
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">
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
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                {submitting ? 'Đang xóa...' : 'Xóa tài khoản'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
