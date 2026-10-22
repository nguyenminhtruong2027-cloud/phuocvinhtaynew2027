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
