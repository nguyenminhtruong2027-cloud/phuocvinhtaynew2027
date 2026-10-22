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
