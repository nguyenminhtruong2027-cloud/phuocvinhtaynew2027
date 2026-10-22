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
  changePassword: (password: string) => Promise<void>;
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
    let mounted = true;

    const resolveUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!mounted) return;
        if (user) {
          await loadUserProfile(user.id, user.email ?? '');
        } else {
          setCurrentUserState(null);
          setLoading(false);
        }
      } catch {
        if (mounted) {
          setCurrentUserState(null);
          setLoading(false);
        }
      }
    };

    resolveUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUserProfile(session.user.id, session.user.email ?? '');
      } else {
        setCurrentUserState(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Keep the current user's displayed name/role in sync with `profiles` in real time.
  useEffect(() => {
    if (!currentUser?.id) return;
    const channel = supabase
      .channel(`profile_realtime_${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${currentUser.id}` },
        () => {
          loadUserProfile(currentUser.id, currentUser.email ?? '');
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, currentUser?.email, supabase]);

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
    const trimmedEmail = (email || '').trim();
    const trimmedPassword = (password || '').trim();

    if (!trimmedEmail) {
      throw new Error('Vui lòng nhập địa chỉ Email.');
    }
    if (!trimmedPassword) {
      throw new Error('Vui lòng nhập Mật khẩu.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: trimmedPassword,
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
        throw new Error('Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.');
      }
      throw new Error(error.message);
    }

    if (data?.session?.user) {
      await loadUserProfile(data.session.user.id, data.session.user.email ?? trimmedEmail);
    }
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
  const updateProfile = useCallback(async (updates: { name?: string; email?: string }) => {
    if (!currentUser) return;
    const payload: { full_name?: string; email?: string } = {};
    if (typeof updates.name === 'string') payload.full_name = updates.name;
    if (typeof updates.email === 'string') payload.email = updates.email;

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', currentUser.id)
      .select('id, email, full_name, role, assigned_blocks')
      .single();

    if (!error && data) {
      setCurrentUserState(prev => prev ? {
        ...prev,
        name: data.full_name ?? prev.name,
        email: data.email ?? prev.email,
      } : prev);
    }
  }, [currentUser, supabase]);

  const changePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }, [supabase]);

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
      changePassword,
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
