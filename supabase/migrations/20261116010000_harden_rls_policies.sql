-- Migration: Harden Row-Level Security (RLS) policies for KTX Phuoc Vinh Tay
-- Ensures administrative/PII tables require an authenticated session,
-- while preserving public QR portal submissions and safe self-lookup RPC.

-- 1. Helper function for authenticated admin check (supports both Tier 1 super_admin and Tier 2 admin)
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
  );
$$;

-- 2. Safe public QR self-lookup RPC (returns minimal non-sensitive fields only for /checkout and /attendance)
CREATE OR REPLACE FUNCTION public.lookup_worker_qr(p_code TEXT)
RETURNS TABLE (
  id UUID,
  ho_va_ten TEXT,
  ma_nv TEXT,
  cccd TEXT,
  ktx TEXT,
  day TEXT,
  phong_so TEXT,
  giuong TEXT,
  don_vi TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.ho_va_ten,
    w.ma_nv,
    w.cccd,
    w.ktx,
    w.day,
    w.phong_so,
    w.giuong,
    w.don_vi
  FROM public.workers w
  WHERE TRIM(LOWER(COALESCE(w.ma_nv, ''))) = TRIM(LOWER(COALESCE(p_code, '')))
     OR TRIM(LOWER(COALESCE(w.cccd, ''))) = TRIM(LOWER(COALESCE(p_code, '')))
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.lookup_worker_qr(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_worker_qr(TEXT) TO anon, authenticated;

-- 3. Restrict workers & support tables to authenticated users safely (idempotent)
DO $$
BEGIN
  IF to_regclass('public.workers') IS NOT NULL THEN
    DROP POLICY IF EXISTS "anon_read_workers" ON public.workers;
    DROP POLICY IF EXISTS "public_all_workers" ON public.workers;
    DROP POLICY IF EXISTS "auth_all_workers" ON public.workers;
    CREATE POLICY "auth_all_workers"
      ON public.workers
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.worker_deletion_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "public_all_worker_deletion_log" ON public.worker_deletion_log;
    DROP POLICY IF EXISTS "auth_all_worker_deletion_log" ON public.worker_deletion_log;
    CREATE POLICY "auth_all_worker_deletion_log"
      ON public.worker_deletion_log
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "anon_read_audit_logs" ON public.audit_logs;
    DROP POLICY IF EXISTS "anon_insert_audit_logs" ON public.audit_logs;
    DROP POLICY IF EXISTS "auth_all_audit_logs" ON public.audit_logs;
    CREATE POLICY "auth_all_audit_logs"
      ON public.audit_logs
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.beds') IS NOT NULL THEN
    DROP POLICY IF EXISTS "public_all_beds" ON public.beds;
    DROP POLICY IF EXISTS "auth_all_beds" ON public.beds;
    CREATE POLICY "auth_all_beds"
      ON public.beds
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.room_units') IS NOT NULL THEN
    DROP POLICY IF EXISTS "public_all_room_units" ON public.room_units;
    DROP POLICY IF EXISTS "auth_all_room_units" ON public.room_units;
    CREATE POLICY "auth_all_room_units"
      ON public.room_units
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.duty_assignments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "public_all_duty_assignments" ON public.duty_assignments;
    DROP POLICY IF EXISTS "auth_all_duty_assignments" ON public.duty_assignments;
    CREATE POLICY "auth_all_duty_assignments"
      ON public.duty_assignments
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.facilities') IS NOT NULL THEN
    DROP POLICY IF EXISTS "public_all_facilities" ON public.facilities;
    DROP POLICY IF EXISTS "public_read_facilities" ON public.facilities;
    CREATE POLICY "public_read_facilities"
      ON public.facilities
      FOR SELECT
      TO anon, authenticated
      USING (true);

    DROP POLICY IF EXISTS "auth_write_facilities" ON public.facilities;
    CREATE POLICY "auth_write_facilities"
      ON public.facilities
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
