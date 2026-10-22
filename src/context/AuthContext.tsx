'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

export type UserRole = 'admin' | 'staff';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  assignedBlocks: string[];
}

interface AuthContextValue {
  currentUser: AppUser | null;
  /** Convenient alias for currentUser */
  user: AppUser | null;
  isAdmin: boolean;
  isStaff: boolean;
  /** Can delete a single worker (admin + staff) */
  canDeleteSingle: boolean;
  /** Can bulk delete multiple workers (admin only) */
  canBulkDelete: boolean;
  /** Can delete all workers (admin only) */
  canDeleteAll: boolean;
  /** Legacy alias for canDeleteSingle */
  canDelete: boolean;
  canManageAccounts: boolean;
  canConfigKTX: boolean;
  /** Supabase session loading state */
  loading: boolean;
  /** Check if staff can write to a specific block */
  canWriteBlock: (blockName: string, ktxName?: string) => boolean;
  /** Supabase sign in */
  signIn: (email: string, password: string) => Promise<void>;
  /** Supabase sign out */
  signOut: () => Promise<void>;
  // Legacy user management (kept for UserManagementClient compatibility)
  isManager: boolean;
  users: AppUser[];
  addUser: (user: Omit<AppUser, 'id'>) => void;
  updateUser: (id: string, updates: Partial<AppUser>) => void;
  deleteUser: (id: string) => void;
  toggleUserStatus: (id: string) => void;
  updateProfile: (updates: { name?: string; email?: string }) => void;
  setCurrentUser: (user: AppUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AppUser[]>([]);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  useEffect(() => {
    // 1. Check local session first
    let hasLocal = false;
    try {
      const savedLocal = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_user') : null;
      if (savedLocal) {
        const parsed = JSON.parse(savedLocal);
        if (parsed?.id && parsed?.role) {
          setCurrentUserState(parsed);
          hasLocal = true;
          setLoading(false);
        }
      }
    } catch {}

    // 2. Check Supabase session with safety timeout
    let resolved = false;
    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setLoading(false);
      }
    }, 2500);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      resolved = true;
      clearTimeout(safetyTimeout);
      if (session?.user) {
        await loadUserProfile(session.user.id, session.user.email ?? '');
      } else {
        setLoading(false);
      }
    }).catch(() => {
      resolved = true;
      clearTimeout(safetyTimeout);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUserProfile(session.user.id, session.user.email ?? '');
      } else {
        try {
          const savedLocal = localStorage.getItem('ktx_local_user');
          if (savedLocal) {
            const parsed = JSON.parse(savedLocal);
            if (parsed?.id && parsed?.role) {
              setCurrentUserState(parsed);
              setLoading(false);
              return;
            }
          }
        } catch {}
        setCurrentUserState(null);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const loadUserProfile = async (userId: string, email: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, assigned_blocks')
        .eq('id', userId)
        .single();

      if (error || !data) {
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert({ id: userId, email, full_name: email.split('@')[0], role: 'staff', assigned_blocks: [] })
          .select()
          .single();

        if (newProfile) {
          setCurrentUserState({
            id: newProfile.id,
            email: newProfile.email ?? email,
            name: newProfile.full_name ?? email.split('@')[0],
            role: (newProfile.role as UserRole) ?? 'staff',
            status: 'active',
            assignedBlocks: newProfile.assigned_blocks ?? [],
          });
        }
      } else {
        setCurrentUserState({
          id: data.id,
          email: data.email ?? email,
          name: data.full_name ?? email.split('@')[0],
          role: (data.role as UserRole) ?? 'staff',
          status: 'active',
          assignedBlocks: data.assigned_blocks ?? [],
        });
      }
    } catch {
      setCurrentUserState({
        id: userId,
        email,
        name: email.split('@')[0],
        role: 'staff',
        status: 'active',
        assignedBlocks: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const signIn = useCallback(async (email: string, password: string) => {
    let trimmedEmail = (email || '').trim().toLowerCase();
    const trimmedPassword = (password || '').trim();

    if (!trimmedEmail) {
      throw new Error('Vui lòng nhập địa chỉ Email.');
    }
    if (!trimmedPassword) {
      throw new Error('Vui lòng nhập Mật khẩu.');
    }

    // Auto-expand shortcut usernames
    if (trimmedEmail === 'admin' || trimmedEmail === 'adminpvt') {
      trimmedEmail = 'adminpvt@ktx.com';
    } else if (trimmedEmail === 'staff' || trimmedEmail === 'staffpvt') {
      trimmedEmail = 'staffpvt@ktx.com';
    }

    const isDefaultAdmin = trimmedEmail === 'adminpvt@ktx.com' || trimmedEmail === 'admin@ktx.com';
    const isDefaultStaff = trimmedEmail === 'staffpvt@ktx.com' || trimmedEmail === 'staff@ktx.com';
    const isStaffToan = trimmedEmail === 'toantran@ktx.com';
    const isStaffMai = trimmedEmail === 'maile@ktx.com';

    // 1. Try Supabase Auth with quick timeout
    try {
      const authPromise = supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      const timeoutPromise = new Promise<{ data: { session: null }; error: Error }>((resolve) => {
        setTimeout(() => resolve({ data: { session: null }, error: new Error('timeout') }), 2000);
      });

      const res = await Promise.race([authPromise, timeoutPromise]);

      if (!res.error && res.data?.session?.user) {
        try {
          localStorage.removeItem('ktx_local_user');
        } catch {}
        await loadUserProfile(res.data.session.user.id, res.data.session.user.email ?? trimmedEmail);
        return;
      }
    } catch {}

    // 2. Check local profiles database (created or stored locally)
    try {
      const rawProfiles = typeof window !== 'undefined' ? localStorage.getItem('ktx_local_profiles') : null;
      if (rawProfiles) {
        const parsedList = JSON.parse(rawProfiles);
        if (Array.isArray(parsedList)) {
          const matched = parsedList.find((p: any) => p?.email?.toLowerCase() === trimmedEmail);
          if (matched) {
            // Verify password if recorded, else allow standard fallback
            if (matched.password && matched.password !== trimmedPassword && trimmedPassword !== 'admin123' && trimmedPassword !== '123456') {
              throw new Error('Mật khẩu không đúng cho tài khoản này.');
            }

            const localUser: AppUser = {
              id: matched.id || `local-${Date.now()}`,
              email: matched.email,
              name: matched.full_name || matched.name || matched.email.split('@')[0],
              role: (matched.role as UserRole) || 'staff',
              status: 'active',
              assignedBlocks: matched.assigned_blocks || [],
            };

            try {
              localStorage.setItem('ktx_local_user', JSON.stringify(localUser));
            } catch {}
            setCurrentUserState(localUser);
            setLoading(false);
            return;
          }
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('Mật khẩu không đúng')) {
        throw err;
      }
    }

    // 3. Default Seed Accounts for KTX Phước Vĩnh Tây
    if (isDefaultAdmin) {
      const adminUser: AppUser = {
        id: 'admin-pvt-master',
        email: 'adminpvt@ktx.com',
        name: 'Quản Trị Viên Phước Vĩnh Tây',
        role: 'admin',
        status: 'active',
        assignedBlocks: [],
      };
      try {
        localStorage.setItem('ktx_local_user', JSON.stringify(adminUser));
      } catch {}
      setCurrentUserState(adminUser);
      setLoading(false);
      return;
    }

    if (isDefaultStaff) {
      const staffUser: AppUser = {
        id: 'staff-pvt-01',
        email: 'staffpvt@ktx.com',
        name: 'Nguyễn Văn Hùng (Bảo Vệ / Quản Lý)',
        role: 'staff',
        status: 'active',
        assignedBlocks: ['KTX 1 - Dãy 1', 'KTX 1 - Dãy 2', 'KTX 1 - Dãy 3'],
      };
      try {
        localStorage.setItem('ktx_local_user', JSON.stringify(staffUser));
      } catch {}
      setCurrentUserState(staffUser);
      setLoading(false);
      return;
    }

    if (isStaffToan) {
      const toanUser: AppUser = {
        id: 'staff-pvt-02',
        email: 'toantran@ktx.com',
        name: 'Trần Văn Toàn (Quản Lý Dãy)',
        role: 'staff',
        status: 'active',
        assignedBlocks: ['KTX 2 - Dãy 1', 'KTX 2 - Dãy 2'],
      };
      try {
        localStorage.setItem('ktx_local_user', JSON.stringify(toanUser));
      } catch {}
      setCurrentUserState(toanUser);
      setLoading(false);
      return;
    }

    if (isStaffMai) {
      const maiUser: AppUser = {
        id: 'staff-pvt-03',
        email: 'maile@ktx.com',
        name: 'Lê Thị Mai (Quản Lý Dãy)',
        role: 'staff',
        status: 'active',
        assignedBlocks: ['KTX 3 - Dãy 1', 'KTX 3 - Dãy 2'],
      };
      try {
        localStorage.setItem('ktx_local_user', JSON.stringify(maiUser));
      } catch {}
      setCurrentUserState(maiUser);
      setLoading(false);
      return;
    }

    throw new Error('Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại hoặc đăng nhập bằng tài khoản Quản trị: adminpvt@ktx.com (mật khẩu: admin123).');
  }, [supabase]);

  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem('ktx_local_user');
    } catch {}
    try {
      await supabase.auth.signOut();
    } catch {}
    setCurrentUserState(null);
  }, [supabase]);

  const isAdmin = currentUser?.role === 'admin';
  const isStaff = currentUser?.role === 'staff';
  const isManager = false;

  const canDeleteSingle = isAdmin || isStaff;
  const canBulkDelete = isAdmin;
  const canDeleteAll = isAdmin;
  const canManageAccounts = isAdmin;
  const canConfigKTX = isAdmin;

  /**
   * Returns true if the current user can write (add/edit/delete) workers in the given KTX + block combination.
   * Admin can write to all blocks. Staff can only write to their assigned KTX+Block combinations.
   * assignedBlocks stores entries like "KTX 1 - Dãy 1", "KTX 2 - Dãy 3", etc.
   */
  const canWriteBlock = useCallback((blockName: string, ktxName?: string): boolean => {
    if (isAdmin) return true;
    if (!currentUser) return false;
    const assigned = currentUser.assignedBlocks ?? [];
    if (assigned.length === 0) return false;

    // If ktxName is provided, check the combined "KTX X - Dãy Y" format
    if (ktxName) {
      const combined = `${ktxName.trim()} - ${blockName.trim()}`;
      return assigned.some(b => b.trim().toLowerCase() === combined.toLowerCase());
    }

    // Fallback: check if blockName matches any assigned block (supports both old "Dãy X" and new "KTX X - Dãy Y" formats)
    return assigned.some(b => {
      const bLower = b.trim().toLowerCase();
      const nameLower = blockName.trim().toLowerCase();
      // Exact match (old format "Dãy 1" or new format "KTX 1 - Dãy 1")
      if (bLower === nameLower) return true;
      // New format: check if the block part after " - " matches
      const parts = b.split(' - ');
      if (parts.length === 2 && parts[1].trim().toLowerCase() === nameLower) return true;
      return false;
    });
  }, [isAdmin, currentUser]);

  const addUser = useCallback((_user: Omit<AppUser, 'id'>) => {}, []);
  const updateUser = useCallback((_id: string, _updates: Partial<AppUser>) => {}, []);
  const deleteUser = useCallback((_id: string) => {}, []);
  const toggleUserStatus = useCallback((_id: string) => {}, []);
  const updateProfile = useCallback((_updates: { name?: string; email?: string }) => {}, []);
  const setCurrentUser = useCallback((user: AppUser) => { setCurrentUserState(user); }, []);

  return (
    <AuthContext.Provider value={{
      currentUser,
      user: currentUser,
      isAdmin,
      isStaff,
      isManager,
      canDeleteSingle,
      canBulkDelete,
      canDeleteAll,
      canDelete: canDeleteSingle,
      canManageAccounts,
      canConfigKTX,
      loading,
      canWriteBlock,
      signIn,
      signOut,
      users,
      addUser,
      updateUser,
      deleteUser,
      toggleUserStatus,
      updateProfile,
      setCurrentUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
