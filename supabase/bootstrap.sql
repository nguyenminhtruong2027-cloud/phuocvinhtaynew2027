-- Consolidated Supabase bootstrap (auto-generated from supabase/migrations)
-- Run this whole file once in Supabase Dashboard > SQL Editor.

-- ============================================================
-- Migration: 20260912150000_create_workers_table.sql
-- ============================================================
-- Migration: Create workers table for KTX Manager
-- Timestamp: 20260912150000
-- IMPORTANT: Run this SQL in your Supabase Dashboard > SQL Editor to create the workers table.

-- Create workers table
CREATE TABLE IF NOT EXISTS public.workers (
  id TEXT PRIMARY KEY,
  stt INTEGER DEFAULT 0,
  ho_va_ten TEXT NOT NULL DEFAULT '',
  ma_nv TEXT DEFAULT '',
  tieu_doan TEXT DEFAULT '',
  ktx TEXT DEFAULT '',
  don_vi TEXT DEFAULT '',
  gioi_tinh TEXT DEFAULT '',
  ngay_sinh TEXT DEFAULT '',
  so_dien_thoai TEXT DEFAULT '',
  day TEXT DEFAULT '',
  phong_so TEXT DEFAULT '',
  giuong TEXT DEFAULT '',
  cccd TEXT DEFAULT '',
  ho_khau_tinh TEXT DEFAULT '',
  to_truong TEXT DEFAULT '',
  sdt_to_truong TEXT DEFAULT '',
  ngay_vao_ktx TEXT DEFAULT '',
  ngay_ra_ktx TEXT DEFAULT '',
  ghi_chu TEXT DEFAULT '',
  khoa_tra_cuu TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  tam_tru_status TEXT DEFAULT 'unregistered',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_workers_day ON public.workers(day);
CREATE INDEX IF NOT EXISTS idx_workers_phong_so ON public.workers(phong_so);
CREATE INDEX IF NOT EXISTS idx_workers_ma_nv ON public.workers(ma_nv);
CREATE INDEX IF NOT EXISTS idx_workers_ho_va_ten ON public.workers(ho_va_ten);
CREATE INDEX IF NOT EXISTS idx_workers_stt ON public.workers(stt);

-- Enable RLS
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

-- Open access policy (app uses custom auth, not Supabase auth)
DROP POLICY IF EXISTS "open_access_workers" ON public.workers;
CREATE POLICY "open_access_workers"
  ON public.workers
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_workers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS workers_updated_at_trigger ON public.workers;
CREATE TRIGGER workers_updated_at_trigger
  BEFORE UPDATE ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_workers_updated_at();


-- ============================================================
-- Migration: 20260912163848_create_profiles_table.sql
-- ============================================================
-- Create profiles table to store user roles (admin/staff)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Allow users to update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow insert for authenticated users (own row only)
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.profiles;
CREATE POLICY "Allow insert for authenticated users"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Updated_at trigger
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_profiles_updated_at();


-- ============================================================
-- Migration: 20260912170000_admin_profiles_policies.sql
-- ============================================================
-- Add admin-level RLS policies for profiles table
-- Admins need full access to manage all user profiles

-- Drop existing policies to recreate with admin support
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Admin full access profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users read own or admin reads all" ON public.profiles;
DROP POLICY IF EXISTS "Users update own or admin updates all" ON public.profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;

-- Function to check admin role from auth metadata (avoids recursion on profiles table)
CREATE OR REPLACE FUNCTION public.is_admin_from_metadata()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (
      raw_user_meta_data->>'role' = 'admin'
      OR raw_app_meta_data->>'role' = 'admin'
    )
  )
$$;

-- SELECT: Users can read their own profile; Admins can read all profiles
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin_from_metadata());

-- INSERT: Users can insert their own profile row; Admins can insert any profile
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id OR public.is_admin_from_metadata());

-- UPDATE: Users can update their own profile; Admins can update any profile
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_admin_from_metadata())
  WITH CHECK (auth.uid() = id OR public.is_admin_from_metadata());

-- DELETE: Only admins can delete profiles
DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin_from_metadata());


-- ============================================================
-- Migration: 20260912180000_add_assigned_blocks.sql
-- ============================================================
-- Migration: Add assigned_blocks column to profiles table
-- assigned_blocks stores an array of building names (e.g. ["Dãy 1", "Dãy 2"]) that a staff member is responsible for

-- Add assigned_blocks column if it doesn't exist
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_blocks TEXT[] DEFAULT '{}';

-- Update the handle_new_user trigger function to include assigned_blocks
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, assigned_blocks)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    '{}'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Re-apply RLS policies (idempotent)
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin_from_metadata());

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id OR public.is_admin_from_metadata());

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_admin_from_metadata())
  WITH CHECK (auth.uid() = id OR public.is_admin_from_metadata());

DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin_from_metadata());


-- ============================================================
-- Migration: 20260912190000_fix_profiles_rls_and_trigger.sql
-- ============================================================
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


-- ============================================================
-- Migration: 20260912200000_fix_workers_rls_authenticated.sql
-- ============================================================
-- Migration: Fix workers RLS - allow authenticated users full SELECT access
-- Timestamp: 20260912200000
-- Purpose: Ensure COUNT(*) on workers table always returns accurate total for all authenticated users

-- Drop existing open access policy
DROP POLICY IF EXISTS "open_access_workers" ON public.workers;

-- Allow authenticated users to SELECT all workers (needed for accurate COUNT)
DROP POLICY IF EXISTS "authenticated_select_workers" ON public.workers;
CREATE POLICY "authenticated_select_workers"
  ON public.workers
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to INSERT workers
DROP POLICY IF EXISTS "authenticated_insert_workers" ON public.workers;
CREATE POLICY "authenticated_insert_workers"
  ON public.workers
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to UPDATE workers
DROP POLICY IF EXISTS "authenticated_update_workers" ON public.workers;
CREATE POLICY "authenticated_update_workers"
  ON public.workers
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to DELETE workers
DROP POLICY IF EXISTS "authenticated_delete_workers" ON public.workers;
CREATE POLICY "authenticated_delete_workers"
  ON public.workers
  FOR DELETE
  TO authenticated
  USING (true);

-- Also keep anon access for backward compatibility (service role bypass)
DROP POLICY IF EXISTS "anon_select_workers" ON public.workers;
CREATE POLICY "anon_select_workers"
  ON public.workers
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon_insert_workers" ON public.workers;
CREATE POLICY "anon_insert_workers"
  ON public.workers
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_workers" ON public.workers;
CREATE POLICY "anon_update_workers"
  ON public.workers
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_workers" ON public.workers;
CREATE POLICY "anon_delete_workers"
  ON public.workers
  FOR DELETE
  TO anon
  USING (true);


-- ============================================================
-- Migration: 20260913000000_update_assigned_blocks_format.sql
-- ============================================================
-- Migration: Update assigned_blocks format to KTX+Block combination
-- New format: ["KTX 1 - Dãy 1", "KTX 1 - Dãy 2", "KTX 2 - Dãy 3", ...]
-- Old format was: ["Dãy 1", "Dãy 2", ...]

-- Add comment to document the new format
COMMENT ON COLUMN public.profiles.assigned_blocks IS 
  'Array of KTX+Block combinations assigned to staff. Format: ["KTX 1 - Dãy 1", "KTX 2 - Dãy 3"]. Admin has access to all blocks (this field is ignored for admin role).';

-- Migrate existing data: convert old "Dãy X" format to "KTX 1 - Dãy X" format
-- assigned_blocks is text[] type, so we use array operations
UPDATE public.profiles
SET assigned_blocks = (
  SELECT ARRAY(
    SELECT
      CASE
        WHEN val NOT LIKE '% - %' AND val LIKE 'Dãy %'
          THEN 'KTX 1 - ' || val
        ELSE val
      END
    FROM unnest(assigned_blocks) AS val
  )
)
WHERE role = 'staff'
  AND assigned_blocks IS NOT NULL
  AND array_length(assigned_blocks, 1) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(assigned_blocks) AS val
    WHERE val NOT LIKE '% - %' AND val LIKE 'Dãy %'
  );


-- ============================================================
-- Migration: 20260920000001_create_worker_avatars_bucket.sql
-- ============================================================
-- Migration: Create worker-avatars storage bucket for CCCD photos
-- Timestamp: 20260920000001_create_worker_avatars_bucket

-- Create the worker-avatars storage bucket (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'worker-avatars',
  'worker-avatars',
  true,
  524288, -- 512KB max (we compress to 300KB before upload)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to worker avatars
DROP POLICY IF EXISTS "worker_avatars_public_read" ON storage.objects;
CREATE POLICY "worker_avatars_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'worker-avatars');

-- Allow any user to upload worker avatars
DROP POLICY IF EXISTS "worker_avatars_insert" ON storage.objects;
CREATE POLICY "worker_avatars_insert"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'worker-avatars');

-- Allow any user to update worker avatars
DROP POLICY IF EXISTS "worker_avatars_update" ON storage.objects;
CREATE POLICY "worker_avatars_update"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'worker-avatars');

-- Allow any user to delete worker avatars
DROP POLICY IF EXISTS "worker_avatars_delete" ON storage.objects;
CREATE POLICY "worker_avatars_delete"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'worker-avatars');


-- ============================================================
-- Migration: 20260920100000_create_facilities_table.sql
-- ============================================================
-- Create facilities table for tracking room/area equipment per KTX
CREATE TABLE IF NOT EXISTS public.facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_khu_vuc TEXT NOT NULL DEFAULT '',
  giuong INTEGER NOT NULL DEFAULT 0,
  dieu_hoa INTEGER NOT NULL DEFAULT 0,
  tu INTEGER NOT NULL DEFAULT 0,
  quat INTEGER NOT NULL DEFAULT 0,
  o_cam_dien INTEGER NOT NULL DEFAULT 0,
  remote INTEGER NOT NULL DEFAULT 0,
  bong_tuyp INTEGER NOT NULL DEFAULT 0,
  ban_an INTEGER NOT NULL DEFAULT 0,
  ghe_an INTEGER NOT NULL DEFAULT 0,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_facilities_ktx ON public.facilities(ktx);
CREATE INDEX IF NOT EXISTS idx_facilities_day ON public.facilities(day);
CREATE INDEX IF NOT EXISTS idx_facilities_phong ON public.facilities(phong_khu_vuc);

-- Enable RLS
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

-- RLS Policies: authenticated users can read and write
DROP POLICY IF EXISTS "authenticated_read_facilities" ON public.facilities;
CREATE POLICY "authenticated_read_facilities"
ON public.facilities FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "authenticated_insert_facilities" ON public.facilities;
CREATE POLICY "authenticated_insert_facilities"
ON public.facilities FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_update_facilities" ON public.facilities;
CREATE POLICY "authenticated_update_facilities"
ON public.facilities FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_delete_facilities" ON public.facilities;
CREATE POLICY "authenticated_delete_facilities"
ON public.facilities FOR DELETE
TO authenticated
USING (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_facilities_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_updated_at ON public.facilities;
CREATE TRIGGER facilities_updated_at
  BEFORE UPDATE ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_facilities_updated_at();

-- Sample data for KTX 1
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.facilities LIMIT 1) THEN
    INSERT INTO public.facilities (ktx, day, phong_khu_vuc, giuong, dieu_hoa, tu, quat, o_cam_dien, remote, bong_tuyp, ban_an, ghe_an) VALUES
      ('KTX 1', 'Dãy A', 'Phòng A101', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy A', 'Phòng A102', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy A', 'Phòng A103', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy B', 'Phòng B101', 10, 2, 10, 5, 10, 2, 5, 2, 10),
      ('KTX 1', 'Dãy B', 'Phòng B102', 10, 2, 10, 5, 10, 2, 5, 2, 10),
      ('KTX 1', 'Dãy B', 'Phòng B103', 10, 2, 10, 5, 10, 2, 5, 2, 10),
      ('KTX 1', 'Dãy C', 'Phòng C101', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy C', 'Phòng C102', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 2', 'Dãy D', 'Phòng D101', 12, 2, 12, 6, 12, 2, 6, 2, 12),
      ('KTX 2', 'Dãy D', 'Phòng D102', 12, 2, 12, 6, 12, 2, 6, 2, 12),
      ('KTX 2', 'Dãy D', 'Phòng D103', 12, 2, 12, 6, 12, 2, 6, 2, 12),
      ('KTX 2', 'Dãy E', 'Phòng E101', 10, 1, 10, 5, 10, 1, 5, 1, 10),
      ('KTX 2', 'Dãy E', 'Phòng E102', 10, 1, 10, 5, 10, 1, 5, 1, 10),
      ('KTX 2', 'Dãy F', 'Phòng F101', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 2', 'Dãy F', 'Phòng F102', 8, 1, 8, 4, 8, 1, 4, 1, 8)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;


-- ============================================================
-- Migration: 20260920200000_create_worker_registrations_table.sql
-- ============================================================
-- Worker Registrations table for public QR portal
CREATE TABLE IF NOT EXISTS public.worker_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ho_va_ten TEXT NOT NULL DEFAULT '',
  so_cccd TEXT NOT NULL DEFAULT '',
  so_dien_thoai TEXT NOT NULL DEFAULT '',
  ngay_sinh TEXT NOT NULL DEFAULT '',
  que_quan TEXT NOT NULL DEFAULT '',
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  cccd_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_registrations_status ON public.worker_registrations(status);
CREATE INDEX IF NOT EXISTS idx_worker_registrations_created_at ON public.worker_registrations(created_at DESC);

ALTER TABLE public.worker_registrations ENABLE ROW LEVEL SECURITY;

-- Allow anyone (public) to INSERT (submit registration)
DROP POLICY IF EXISTS "public_can_submit_registration" ON public.worker_registrations;
CREATE POLICY "public_can_submit_registration"
  ON public.worker_registrations
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Authenticated users (admin/staff) can read all registrations
DROP POLICY IF EXISTS "authenticated_can_read_registrations" ON public.worker_registrations;
CREATE POLICY "authenticated_can_read_registrations"
  ON public.worker_registrations
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can update (approve/reject)
DROP POLICY IF EXISTS "authenticated_can_update_registrations" ON public.worker_registrations;
CREATE POLICY "authenticated_can_update_registrations"
  ON public.worker_registrations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can delete
DROP POLICY IF EXISTS "authenticated_can_delete_registrations" ON public.worker_registrations;
CREATE POLICY "authenticated_can_delete_registrations"
  ON public.worker_registrations
  FOR DELETE
  TO authenticated
  USING (true);


-- ============================================================
-- Migration: 20260920210000_add_fields_to_worker_registrations.sql
-- ============================================================
-- Add new fields to worker_registrations to match workers table columns
ALTER TABLE public.worker_registrations
  ADD COLUMN IF NOT EXISTS ma_nv TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS gioi_tinh TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS don_vi TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS tieu_doan TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS to_truong TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS sdt_to_truong TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ho_khau_tinh TEXT DEFAULT '';


-- ============================================================
-- Migration: 20260920220000_add_giuong_ngayvao_to_registrations.sql
-- ============================================================
-- Add giuong and ngay_vao_ktx fields to worker_registrations to fully match workers table
ALTER TABLE public.worker_registrations
  ADD COLUMN IF NOT EXISTS giuong TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ngay_vao_ktx TEXT DEFAULT '';


-- ============================================================
-- Migration: 20260921000000_create_audit_logs_table.sql
-- ============================================================
-- Create audit_logs table for system-wide audit trail
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  account TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_account ON public.audit_logs(account);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users (admins) to read all logs
DROP POLICY IF EXISTS "admins_read_audit_logs" ON public.audit_logs;
CREATE POLICY "admins_read_audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert their own logs
DROP POLICY IF EXISTS "admins_insert_audit_logs" ON public.audit_logs;
CREATE POLICY "admins_insert_audit_logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);


-- ============================================================
-- Migration: 20260921100000_fix_audit_logs_rls_admin_access.sql
-- ============================================================
-- Migration: Fix audit_logs RLS to allow all admin accounts to read ALL records
-- Timestamp: 20260921100000
-- Purpose: Ensure every admin account sees the full shared audit log regardless of who created the entry.
--          Also adds anon-role SELECT so the Supabase JS client can read logs before the auth
--          session token is fully propagated (matches the pattern used by the workers table).

-- ── Re-apply authenticated SELECT policy (USING true = no per-user filter) ──
DROP POLICY IF EXISTS "admins_read_audit_logs" ON public.audit_logs;
CREATE POLICY "admins_read_audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (true);

-- ── Re-apply authenticated INSERT policy ──
DROP POLICY IF EXISTS "admins_insert_audit_logs" ON public.audit_logs;
CREATE POLICY "admins_insert_audit_logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- ── Add anon SELECT so the JS client can read logs while the session is initialising ──
DROP POLICY IF EXISTS "anon_read_audit_logs" ON public.audit_logs;
CREATE POLICY "anon_read_audit_logs"
ON public.audit_logs
FOR SELECT
TO anon
USING (true);

-- ── Add anon INSERT so optimistic log writes don't fail before session is ready ──
DROP POLICY IF EXISTS "anon_insert_audit_logs" ON public.audit_logs;
CREATE POLICY "anon_insert_audit_logs"
ON public.audit_logs
FOR INSERT
TO anon
WITH CHECK (true);


-- ============================================================
-- Migration: 20261021000000_create_missing_support_tables.sql
-- ============================================================
-- Migration: Create support tables referenced by the app but missing from the schema
-- Timestamp: 20261021000000
-- Run this SQL in Supabase Dashboard > SQL Editor (or via `supabase db push`).

-- ─── 1. worker_deletion_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT,
  ho_va_ten TEXT,
  ma_nv TEXT,
  ktx TEXT,
  day TEXT,
  deleted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_deletion_log_deleted_at
  ON public.worker_deletion_log(deleted_at DESC);

ALTER TABLE public.worker_deletion_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_worker_deletion_log" ON public.worker_deletion_log;
CREATE POLICY "public_all_worker_deletion_log"
  ON public.worker_deletion_log
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 2. attendance_sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date TEXT NOT NULL DEFAULT '',
  opened_by TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  zone_ktx TEXT NOT NULL DEFAULT '',
  zone_day TEXT NOT NULL DEFAULT '',
  zone_phong TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_date, zone_ktx, zone_day, zone_phong)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date
  ON public.attendance_sessions(session_date);

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_attendance_sessions" ON public.attendance_sessions;
CREATE POLICY "public_all_attendance_sessions"
  ON public.attendance_sessions
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 3. attendance_records ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL DEFAULT '',
  ma_nv TEXT NOT NULL DEFAULT '',
  ho_va_ten TEXT NOT NULL DEFAULT '',
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'present',
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  ghi_chu TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, ma_nv)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session
  ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_ma_nv
  ON public.attendance_records(ma_nv);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status
  ON public.attendance_records(status);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_attendance_records" ON public.attendance_records;
CREATE POLICY "public_all_attendance_records"
  ON public.attendance_records
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 4. checkout_requests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkout_requests (
  id TEXT PRIMARY KEY,
  worker_id TEXT,
  ho_va_ten TEXT NOT NULL DEFAULT '',
  ma_nv TEXT NOT NULL DEFAULT '',
  so_cccd TEXT NOT NULL DEFAULT '',
  so_dien_thoai TEXT NOT NULL DEFAULT '',
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  giuong TEXT,
  ly_do TEXT NOT NULL DEFAULT '',
  ngay_don_ra TEXT NOT NULL DEFAULT '',
  ghi_chu TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checkout_requests_status
  ON public.checkout_requests(status);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_created_at
  ON public.checkout_requests(created_at DESC);

ALTER TABLE public.checkout_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_checkout_requests" ON public.checkout_requests;
CREATE POLICY "public_all_checkout_requests"
  ON public.checkout_requests
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 5. room_units ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.room_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL DEFAULT '',
  day_nha TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  unit TEXT,
  room_note TEXT,
  room_label TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ktx, day_nha, phong_so)
);

CREATE INDEX IF NOT EXISTS idx_room_units_ktx_day_nha_phong
  ON public.room_units(ktx, day_nha, phong_so);

ALTER TABLE public.room_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_room_units" ON public.room_units;
CREATE POLICY "public_all_room_units"
  ON public.room_units
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 6. duty_assignments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_date TEXT NOT NULL DEFAULT '',
  profile_id TEXT NOT NULL DEFAULT '',
  duty_ktx TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (duty_date, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_duty_assignments_date
  ON public.duty_assignments(duty_date);

ALTER TABLE public.duty_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_duty_assignments" ON public.duty_assignments;
CREATE POLICY "public_all_duty_assignments"
  ON public.duty_assignments
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- Migration: 20261022000000_create_beds_and_realtime.sql
-- ============================================================
-- Migration: create beds table + relational integrity trigger + realtime publication
-- Timestamp: 20261022000000

-- ─── 1. beds table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  giuong TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'occupied')),
  ma_nv TEXT,
  ho_va_ten TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ktx, day, phong_so, giuong)
);

CREATE INDEX IF NOT EXISTS idx_beds_ktx_day_phong ON public.beds(ktx, day, phong_so);
CREATE INDEX IF NOT EXISTS idx_beds_status ON public.beds(status);

ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_beds" ON public.beds;
CREATE POLICY "public_all_beds"
  ON public.beds
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 2. Seed beds from facilities ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_beds_from_facilities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  f record;
  b integer;
  created integer := 0;
  room_key text;
BEGIN
  FOR f IN
    SELECT ktx, day, phong_khu_vuc, giuong
    FROM public.facilities
    WHERE coalesce(giuong, 0) > 0
  LOOP
    room_key := trim(regexp_replace(coalesce(f.phong_khu_vuc, ''), '^Phòng\s*', '', 'i'));
    IF room_key = '' THEN
      room_key := coalesce(f.phong_khu_vuc, '');
    END IF;

    FOR b IN 1..f.giuong LOOP
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status)
      VALUES (f.ktx, f.day, room_key, b::text, 'empty')
      ON CONFLICT (ktx, day, phong_so, giuong) DO NOTHING;
      created := created + 1;
    END LOOP;
  END LOOP;

  RETURN created;
END;
$$;

-- ─── 3. Trigger to maintain beds from workers ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_bed_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_ktx text;
  old_day text;
  old_phong text;
  old_giuong text;
  new_ktx text;
  new_day text;
  new_phong text;
  new_giuong text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_ktx := coalesce(OLD.ktx, '');
    old_day := coalesce(OLD.day, '');
    old_phong := coalesce(OLD.phong_so, '');
    old_giuong := coalesce(OLD.giuong, '');

    IF old_ktx <> '' AND old_phong <> '' AND old_giuong <> '' THEN
      UPDATE public.beds
      SET status = 'empty',
          ma_nv = NULL,
          ho_va_ten = NULL,
          worker_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE ktx = old_ktx
        AND day = old_day
        AND phong_so = old_phong
        AND giuong = old_giuong;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_ktx := coalesce(NEW.ktx, '');
    new_day := coalesce(NEW.day, '');
    new_phong := coalesce(NEW.phong_so, '');
    new_giuong := coalesce(NEW.giuong, '');

    IF new_ktx <> '' AND new_phong <> '' AND new_giuong <> '' THEN
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten, worker_id)
      VALUES (new_ktx, new_day, new_phong, new_giuong, 'occupied', NEW.ma_nv, NEW.ho_va_ten, NEW.id)
      ON CONFLICT (ktx, day, phong_so, giuong)
      DO UPDATE SET status = 'occupied',
                    ma_nv = EXCLUDED.ma_nv,
                    ho_va_ten = EXCLUDED.ho_va_ten,
                    worker_id = EXCLUDED.worker_id,
                    updated_at = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_ktx := coalesce(OLD.ktx, '');
    old_day := coalesce(OLD.day, '');
    old_phong := coalesce(OLD.phong_so, '');
    old_giuong := coalesce(OLD.giuong, '');
    new_ktx := coalesce(NEW.ktx, '');
    new_day := coalesce(NEW.day, '');
    new_phong := coalesce(NEW.phong_so, '');
    new_giuong := coalesce(NEW.giuong, '');

    -- Clear old bed only when the location actually changed.
    IF (old_ktx, old_day, old_phong, old_giuong) IS DISTINCT FROM (new_ktx, new_day, new_phong, new_giuong) THEN
      IF old_ktx <> '' AND old_phong <> '' AND old_giuong <> '' THEN
        UPDATE public.beds
        SET status = 'empty',
            ma_nv = NULL,
            ho_va_ten = NULL,
            worker_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE ktx = old_ktx
          AND day = old_day
          AND phong_so = old_phong
          AND giuong = old_giuong;
      END IF;
    END IF;

    -- Upsert the new bed.
    IF new_ktx <> '' AND new_phong <> '' AND new_giuong <> '' THEN
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten, worker_id)
      VALUES (new_ktx, new_day, new_phong, new_giuong, 'occupied', NEW.ma_nv, NEW.ho_va_ten, NEW.id)
      ON CONFLICT (ktx, day, phong_so, giuong)
      DO UPDATE SET status = 'occupied',
                    ma_nv = EXCLUDED.ma_nv,
                    ho_va_ten = EXCLUDED.ho_va_ten,
                    worker_id = EXCLUDED.worker_id,
                    updated_at = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS workers_bed_sync_trigger ON public.workers;
CREATE TRIGGER workers_bed_sync_trigger
  AFTER INSERT OR UPDATE OF ktx, day, phong_so, giuong, ma_nv, ho_va_ten OR DELETE
  ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_bed_occupancy();

-- ─── 4. Add missing tables to the supabase_realtime publication ────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'beds') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.beds;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'facilities') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.facilities;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_units') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_units;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'worker_registrations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_registrations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'checkout_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checkout_requests;
  END IF;
END
$$;


-- ============================================================
-- Migration: 20261023000000_facilities_seed_beds_trigger.sql
-- ============================================================
-- Migration: auto-seed beds whenever a facilities row is created/updated
-- Timestamp: 20261023000000

CREATE OR REPLACE FUNCTION public.seed_beds_for_facility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  b integer;
  room_key text;
BEGIN
  room_key := trim(regexp_replace(coalesce(NEW.phong_khu_vuc, ''), '^Phòng\s*', '', 'i'));
  IF room_key = '' THEN
    room_key := coalesce(NEW.phong_khu_vuc, '');
  END IF;

  FOR b IN 1..coalesce(NEW.giuong, 0) LOOP
    INSERT INTO public.beds (ktx, day, phong_so, giuong, status)
    VALUES (NEW.ktx, NEW.day, room_key, b::text, 'empty')
    ON CONFLICT (ktx, day, phong_so, giuong) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_seed_beds_trigger ON public.facilities;
CREATE TRIGGER facilities_seed_beds_trigger
  AFTER INSERT OR UPDATE OF ktx, day, phong_khu_vuc, giuong
  ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_beds_for_facility();

