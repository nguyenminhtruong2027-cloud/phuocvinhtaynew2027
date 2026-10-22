-- Migration: Fix RLS policies for profiles table + ensure trigger exists
-- Fixes: Admin cannot see staff profiles (STAFF 0 bug)
-- Strategy: Use SECURITY DEFINER function to check admin role from profiles table
--           Add a get_all_profiles() function for admin to bypass RLS
--           Ensure trigger on auth.users is properly created

-- ============================================================
-- STEP 1: Create/replace the admin check function
-- Uses profiles table directly (not metadata) to check admin role
-- SECURITY DEFINER runs as function owner, bypasses RLS on auth.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  )
$$;

-- ============================================================
-- STEP 2: Create a SECURITY DEFINER function to fetch all profiles
-- This bypasses RLS entirely, only callable by authenticated users
-- The function itself checks if caller is admin before returning data
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_all_profiles()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  assigned_blocks text[],
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins can call this function
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.email,
      p.full_name,
      p.role,
      COALESCE(p.assigned_blocks, '{}'::text[]) AS assigned_blocks,
      p.created_at
    FROM public.profiles p
    ORDER BY p.created_at DESC;
END;
$$;

-- ============================================================
-- STEP 3: Drop all existing RLS policies and recreate cleanly
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Admin full access profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users read own or admin reads all" ON public.profiles;
DROP POLICY IF EXISTS "Users update own or admin updates all" ON public.profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;

-- SELECT: Users can read their own profile; Admins can read all
CREATE POLICY "profiles_select_policy"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin_user()
  );

-- INSERT: Users can insert their own profile; Admins can insert any
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin_user()
  );

-- UPDATE: Users can update their own profile; Admins can update any
CREATE POLICY "profiles_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin_user()
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin_user()
  );

-- DELETE: Only admins can delete profiles
CREATE POLICY "profiles_delete_policy"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin_user());

-- ============================================================
-- STEP 4: Ensure trigger function exists and trigger is created
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, assigned_blocks)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    '{}'::text[]
  )
  ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      role = COALESCE(EXCLUDED.role, public.profiles.role),
      updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger to ensure it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STEP 5: Backfill any auth.users that don't have a profile yet
-- ============================================================
DO $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, assigned_blocks)
  SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
    COALESCE(au.raw_user_meta_data->>'role', 'staff'),
    '{}'::text[]
  FROM auth.users au
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = au.id
  )
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Backfill skipped: %', SQLERRM;
END $$;
