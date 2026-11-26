'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  createClient,
  getRememberMePreference,
  setRememberMePreference,
} from '@/lib/supabase/client';
import { invalidateCachedData } from '@/lib/clientCache';

export type UserRole = 'super_admin' | 'admin' | 'staff' | 'technician';

const PROFILE_CACHE_KEY = 'ktx_profile_cache_v1';

function readCachedProfile(userId: string): AppUser | null {
  if (typeof window === 'undefined') return null;
  const stores: Storage[] = [];
  try { stores.push(window.localStorage); } catch {}
  try { stores.push(window.sessionStorage); } catch {}
  for (const store of stores) {
    try {
      const raw = store.getItem(PROFILE_CACHE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<AppUser>;
      if (parsed && parsed.id === userId && typeof parsed.email === 'string') {
        return {
          id: parsed.id,
          email: parsed.email,
          name: typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.email.split('@')[0],
          role: normalizeUserRole(parsed.role),
          status: 'active',
          assignedBlocks: Array.isArray(parsed.assignedBlocks) ? parsed.assignedBlocks : [],
        };
      }
    } catch {}
  }
  return null;
}

function writeCachedProfile(profile: AppUser): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify({
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    assignedBlocks: profile.assignedBlocks,
  });
  try {
    if (getRememberMePreference()) {
      window.localStorage.setItem(PROFILE_CACHE_KEY, serialized);
      window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
    } else {
      window.sessionStorage.setItem(PROFILE_CACHE_KEY, serialized);
      window.localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {}
}

function clearCachedProfile(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
  try { window.sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

export function isSuperAdminRole(role?: string | null): boolean {
  return role === 'super_admin';
}

export function isAdminRole(role?: string | null): boolean {
  return role === 'super_admin' || role === 'admin';
}

export function isTechnicianRole(role?: string | null): boolean {
  return role === 'technician';
}

export function normalizeUserRole(role?: string | null): UserRole {
  if (role === 'super_admin') return 'super_admin';
  if (role === 'admin') return 'admin';
  if (role === 'technician') return 'technician';
  return 'staff';
}

export function getRoleDisplayLabel(role?: string | null): string {
  if (role === 'super_admin') return 'Quản trị tối cao';
  if (role === 'admin') return 'Quản trị viên';
  if (role === 'technician') return 'Kỹ thuật viên';
  return 'Chuyên viên';
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  assignedBlocks: string[];
}

export interface AccountPermissionResult {
  canEdit: boolean;
  canDelete: boolean;
  canChangeRole: boolean;
}

interface AuthContextValue {
  currentUser: AppUser | null;
  /** Convenient alias for currentUser */
  user: AppUser | null;
  /** Tier 1: Owner / Supreme Admin */
  isSuperAdmin: boolean;
  /** Tier 2: Full-KTX Operational Admin (under Super Admin) */
  isSubAdmin: boolean;
  /** Tier 1 or Tier 2: Operational access across all KTX */
  isAdmin: boolean;
  /** Tier 3: Block-scoped specialist */
  isStaff: boolean;
  /** Tier 4: Facility & Maintenance Technician */
  isTechnician: boolean;
  /** Can accept, resolve, reopen maintenance tickets and resolve facility/bed maintenance */
  canOperateMaintenance: boolean;
  /** Can create internal maintenance tickets */
  canCreateMaintenanceTicket: boolean;
  /** Can delete resolved maintenance tickets (admin can delete any; technician only resolved) */
  canDeleteResolvedTicket: boolean;
  /** Can delete a single worker (admin + staff within scope) */
  canDeleteSingle: boolean;
  /** Can bulk delete filtered/selected records (super_admin + admin) */
  canBulkDelete: boolean;
  /** Can execute global "Delete All" wipes (super_admin only) */
  canDeleteAll: boolean;
  /** Legacy alias for canDeleteSingle */
  canDelete: boolean;
  canManageAccounts: boolean;
  canManageAdmins: boolean;
  canRunMigrations: boolean;
  canConfigKTX: boolean;
  /** Supabase session loading state */
  loading: boolean;
  /** Check if staff can write to a specific block */
  canWriteBlock: (blockName: string, ktxName?: string) => boolean;
  /** Check if user can operate maintenance on a block (technician with empty assignedBlocks = full campus) */
  canAccessMaintenanceBlock: (blockName: string, ktxName?: string) => boolean;
  /** Evaluate hierarchical permissions against a target account */
  getAccountPermissions: (targetRole: UserRole, targetId?: string) => AccountPermissionResult;
  /** Supabase sign in (rememberMe = true keeps session across browser restarts) */
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
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
  const loadingUserIdRef = useRef<string | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);
  const lastRefreshAttemptRef = useRef<number>(0);

  const loadUserProfile = useCallback(async (userId: string, email: string, force = false) => {
    if (!force && (loadedUserIdRef.current === userId || loadingUserIdRef.current === userId)) {
      setLoading(false);
      return;
    }

    // Hydrate immediately from verified-session profile cache while refreshing from server
    const cached = readCachedProfile(userId);
    if (cached && !loadedUserIdRef.current) {
      setCurrentUserState(cached);
    }

    loadingUserIdRef.current = userId;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, assigned_blocks')
        .eq('id', userId)
        .single();

      if (!error && data) {
        const resolvedUser: AppUser = {
          id: data.id,
          email: data.email ?? email,
          name: data.full_name ?? email.split('@')[0],
          role: normalizeUserRole(data.role),
          status: 'active',
          assignedBlocks: data.assigned_blocks ?? [],
        };
        loadedUserIdRef.current = userId;
        writeCachedProfile(resolvedUser);
        setCurrentUserState(resolvedUser);
        return;
      }

      // Only attempt first-time profile creation if online and server explicitly reported 0 rows (PGRST116)
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (!isOffline && error?.code === 'PGRST116') {
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert({ id: userId, email, full_name: email.split('@')[0], role: 'staff', assigned_blocks: [] })
          .select()
          .single();

        if (newProfile) {
          const createdUser: AppUser = {
            id: newProfile.id,
            email: newProfile.email ?? email,
            name: newProfile.full_name ?? email.split('@')[0],
            role: normalizeUserRole(newProfile.role),
            status: 'active',
            assignedBlocks: newProfile.assigned_blocks ?? [],
          };
          loadedUserIdRef.current = userId;
          writeCachedProfile(createdUser);
          setCurrentUserState(createdUser);
          return;
        }
      }

      // Transient network hiccup: keep existing/cached user so role & session are never disrupted
      if (cached) {
        loadedUserIdRef.current = userId;
        setCurrentUserState(cached);
      } else {
        setCurrentUserState(prev =>
          prev && prev.id === userId
            ? prev
            : {
                id: userId,
                email,
                name: email.split('@')[0],
                role: 'staff',
                status: 'active',
                assignedBlocks: [],
              }
        );
      }
    } catch {
      if (cached) {
        loadedUserIdRef.current = userId;
        setCurrentUserState(cached);
      } else {
        setCurrentUserState(prev =>
          prev && prev.id === userId
            ? prev
            : {
                id: userId,
                email,
                name: email.split('@')[0],
                role: 'staff',
                status: 'active',
                assignedBlocks: [],
              }
        );
      }
    } finally {
      if (loadingUserIdRef.current === userId) {
        loadingUserIdRef.current = null;
      }
      setLoading(false);
    }
  }, [supabase]);

  // Proactively keep the Supabase session fresh when returning from background/sleep/offline
  const ensureFreshSession = useCallback(async (minRemainingSeconds = 600) => {
    const now = Date.now();
    if (now - lastRefreshAttemptRef.current < 15000) return;
    try {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (!session) return;

      const expiresAtMs = (session.expires_at ?? 0) * 1000;
      const shouldRefresh = expiresAtMs > 0 && expiresAtMs - now < minRemainingSeconds * 1000;
      if (shouldRefresh) {
        lastRefreshAttemptRef.current = now;
        await supabase.auth.refreshSession();
      }
    } catch {
      // Transient network issue — keep existing session and retry next visibility/online cycle
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;

    const resolveUser = async () => {
      try {
        // Use getSession() first so persisted sessions survive offline startups & tab resumes
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        let session = data?.session ?? null;

        if (session?.user) {
          const expiresAtMs = (session.expires_at ?? 0) * 1000;
          if (expiresAtMs > 0 && expiresAtMs - Date.now() < 300_000) {
            try {
              const refreshed = await supabase.auth.refreshSession();
              if (refreshed?.data?.session) {
                session = refreshed.data.session;
              }
            } catch {
              // Keep local session if momentarily offline
            }
          }
          if (!mounted) return;
          await loadUserProfile(session.user.id, session.user.email ?? '');
        } else {
          loadedUserIdRef.current = null;
          setCurrentUserState(null);
          setLoading(false);
        }
      } catch (err) {
        console.warn('[AuthContext] resolveUser notice:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void resolveUser();

    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const authSubRes = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          loadedUserIdRef.current = null;
          loadingUserIdRef.current = null;
          clearCachedProfile();
          invalidateCachedData();
          setCurrentUserState(null);
          setLoading(false);
          return;
        }

        if (event === 'TOKEN_REFRESHED') {
          if (session?.user && !loadedUserIdRef.current) {
            await loadUserProfile(session.user.id, session.user.email ?? '');
          }
          return;
        }

        if (session?.user) {
          await loadUserProfile(
            session.user.id,
            session.user.email ?? '',
            event === 'USER_UPDATED' || event === 'SIGNED_IN'
          );
        } else if (event !== 'INITIAL_SESSION') {
          // Double-check storage before clearing state to avoid race conditions
          const check = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (!check?.data?.session && mounted) {
            loadedUserIdRef.current = null;
            loadingUserIdRef.current = null;
            setCurrentUserState(null);
            setLoading(false);
          }
        }
      });
      subscription = authSubRes?.data?.subscription;
    } catch (subErr) {
      console.warn('[AuthContext] onAuthStateChange notice:', subErr);
    }

    // Visibility-aware auto-refresh: prevents background tabs from racing on refresh token rotation
    // and immediately refreshes expired tokens when waking from sleep or reconnecting.
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        void supabase.auth.stopAutoRefresh();
        return;
      }
      void supabase.auth.startAutoRefresh();
      void ensureFreshSession(600);
    };

    const handleOnline = () => {
      void supabase.auth.startAutoRefresh();
      void ensureFreshSession(600);
      if (loadedUserIdRef.current) {
        void supabase.auth.getSession().then(({ data }) => {
          if (data?.session?.user) {
            void loadUserProfile(data.session.user.id, data.session.user.email ?? '', true);
          }
        });
      }
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void supabase.auth.startAutoRefresh();
    }

    const keepAliveTimer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void ensureFreshSession(600);
      }
    }, 4 * 60 * 1000);

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
      window.addEventListener('focus', handleVisibilityOrFocus);
      window.addEventListener('online', handleOnline);
    }

    return () => {
      mounted = false;
      clearInterval(keepAliveTimer);
      subscription?.unsubscribe();
      if (typeof window !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [supabase, loadUserProfile, ensureFreshSession]);

  // Keep the current user's displayed name/role in sync with `profiles` in real time.
  useEffect(() => {
    if (!currentUser?.id) return;
    const channel = supabase
      .channel(`profile_realtime_${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${currentUser.id}` },
        () => {
          loadUserProfile(currentUser.id, currentUser.email ?? '', true);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, currentUser?.email, supabase, loadUserProfile]);

  const signIn = useCallback(async (email: string, password: string, rememberMe = true) => {
    const trimmedEmail = (email || '').trim();
    const trimmedPassword = (password || '').trim();

    if (!trimmedEmail) {
      throw new Error('Vui lòng nhập địa chỉ Email.');
    }
    if (!trimmedPassword) {
      throw new Error('Vui lòng nhập Mật khẩu.');
    }

    // Apply storage persistence mode BEFORE signing in so tokens land in localStorage or sessionStorage
    setRememberMePreference(rememberMe);

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
      void supabase.auth.startAutoRefresh();
      await loadUserProfile(data.session.user.id, data.session.user.email ?? trimmedEmail, true);
    }
  }, [supabase, loadUserProfile]);

  const signOut = useCallback(async () => {
    loadedUserIdRef.current = null;
    loadingUserIdRef.current = null;
    clearCachedProfile();
    invalidateCachedData();
    try {
      localStorage.removeItem('ktx_local_user');
    } catch {}
    try {
      await supabase.auth.signOut();
    } catch {}
    setCurrentUserState(null);
  }, [supabase]);

  const isSuperAdmin = currentUser?.role === 'super_admin';
  const isSubAdmin = currentUser?.role === 'admin';
  const isAdmin = isSuperAdmin || isSubAdmin;
  const isStaff = currentUser?.role === 'staff';
  const isTechnician = currentUser?.role === 'technician';
  const isManager = false;

  const canOperateMaintenance = isAdmin || isTechnician;
  const canCreateMaintenanceTicket = isAdmin || isTechnician || isStaff;
  const canDeleteResolvedTicket = isAdmin || isTechnician;
  const canDeleteSingle = isAdmin || isStaff;
  const canBulkDelete = isAdmin;
  const canDeleteAll = isSuperAdmin;
  const canManageAccounts = isAdmin;
  const canManageAdmins = isSuperAdmin;
  const canRunMigrations = isSuperAdmin;
  const canConfigKTX = isAdmin;

  const getAccountPermissions = useCallback(
    (targetRole: UserRole, targetId?: string): AccountPermissionResult => {
      if (!currentUser) {
        return { canEdit: false, canDelete: false, canChangeRole: false };
      }
      const isSelf = Boolean(targetId && currentUser.id === targetId);

      if (isSuperAdmin) {
        if (targetRole === 'super_admin') {
          return {
            canEdit: isSelf,
            canDelete: false,
            canChangeRole: false,
          };
        }
        return {
          canEdit: true,
          canDelete: !isSelf,
          canChangeRole: true,
        };
      }

      if (isSubAdmin) {
        if (targetRole === 'staff' || targetRole === 'technician') {
          return {
            canEdit: true,
            canDelete: !isSelf,
            canChangeRole: true,
          };
        }
        return {
          canEdit: false,
          canDelete: false,
          canChangeRole: false,
        };
      }

      return { canEdit: false, canDelete: false, canChangeRole: false };
    },
    [currentUser, isSuperAdmin, isSubAdmin]
  );

  /**
   * Returns true if the current user can write (add/edit/delete) workers in the given KTX + block combination.
   * Super Admin & Admin can write to all blocks. Staff can only write to their assigned KTX+Block combinations.
   * Technicians NEVER write to workers.
   */
  const canWriteBlock = useCallback((blockName: string, ktxName?: string): boolean => {
    if (isAdmin) return true;
    if (!currentUser || isTechnician) return false;
    const assigned = currentUser.assignedBlocks ?? [];
    if (assigned.length === 0) return false;

    if (ktxName) {
      const combined = `${ktxName.trim()} - ${blockName.trim()}`;
      return assigned.some(b => b.trim().toLowerCase() === combined.toLowerCase());
    }

    return assigned.some(b => {
      const bLower = b.trim().toLowerCase();
      const nameLower = blockName.trim().toLowerCase();
      if (bLower === nameLower) return true;
      const parts = b.split(' - ');
      if (parts.length === 2 && parts[1].trim().toLowerCase() === nameLower) return true;
      return false;
    });
  }, [isAdmin, isTechnician, currentUser]);

  /**
   * Maintenance scope check:
   * - Admin/Super Admin: full campus
   * - Technician: empty assignedBlocks = full campus; non-empty = restricted to assigned blocks
   * - Staff: restricted to assigned blocks
   */
  const canAccessMaintenanceBlock = useCallback((blockName: string, ktxName?: string): boolean => {
    if (isAdmin) return true;
    if (!currentUser) return false;
    const assigned = currentUser.assignedBlocks ?? [];
    if (isTechnician && assigned.length === 0) return true;
    if (assigned.length === 0) return false;

    const nameLower = (blockName || '').trim().toLowerCase();
    const ktxLower = (ktxName || '').trim().toLowerCase();

    return assigned.some(b => {
      const bLower = b.trim().toLowerCase();
      if (ktxLower && bLower === `${ktxLower} - ${nameLower}`) return true;
      if (bLower === nameLower) return true;
      const parts = b.split(' - ');
      if (parts.length === 2 && parts[1].trim().toLowerCase() === nameLower) {
        if (!ktxLower || parts[0].trim().toLowerCase() === ktxLower) return true;
      }
      return false;
    });
  }, [isAdmin, isTechnician, currentUser]);

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

  const contextValue = useMemo<AuthContextValue>(() => ({
    currentUser,
    user: currentUser,
    isSuperAdmin,
    isSubAdmin,
    isAdmin,
    isStaff,
    isTechnician,
    isManager,
    canOperateMaintenance,
    canCreateMaintenanceTicket,
    canDeleteResolvedTicket,
    canDeleteSingle,
    canBulkDelete,
    canDeleteAll,
    canDelete: canDeleteSingle,
    canManageAccounts,
    canManageAdmins,
    canRunMigrations,
    canConfigKTX,
    loading,
    canWriteBlock,
    canAccessMaintenanceBlock,
    getAccountPermissions,
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
  }), [
    currentUser,
    isSuperAdmin,
    isSubAdmin,
    isAdmin,
    isStaff,
    isTechnician,
    isManager,
    canOperateMaintenance,
    canCreateMaintenanceTicket,
    canDeleteResolvedTicket,
    canDeleteSingle,
    canBulkDelete,
    canDeleteAll,
    canManageAccounts,
    canManageAdmins,
    canRunMigrations,
    canConfigKTX,
    loading,
    canWriteBlock,
    canAccessMaintenanceBlock,
    getAccountPermissions,
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
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
