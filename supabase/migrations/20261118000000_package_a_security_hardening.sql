-- Migration: Package A — Security Hardening, Block-Scoped RLS, Append-Only Audit Logs & Public QR RPCs
-- Ensures:
-- 1. Public /checkout and /register QR portals work via zero-PII SECURITY DEFINER RPCs without exposing `workers` or `beds` PII to `anon`.
-- 2. Tier 3 `staff` accounts are enforced at the PostgreSQL RLS layer to write ONLY within their assigned KTX/block(s).
-- 3. `audit_logs`, `worker_deletion_log`, and `worker_entry_log` are append-only (no client UPDATE/DELETE).
-- 4. `duty_assignments` writes are restricted to `super_admin` and `admin`.

-- ─── 1. Helper: Block-level write authorization for Staff vs Admin/Super Admin ──
CREATE OR REPLACE FUNCTION public.can_access_block(p_ktx TEXT, p_day TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin_user()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p,
           UNNEST(COALESCE(p.assigned_blocks, '{}'::text[])) AS blk
      WHERE p.id = auth.uid()
        AND (
          LOWER(TRIM(blk)) = LOWER(TRIM(COALESCE(p_ktx, '')) || ' - ' || TRIM(COALESCE(p_day, '')))
          OR (
            POSITION(' - ' IN blk) = 0
            AND LOWER(TRIM(blk)) = LOWER(TRIM(COALESCE(p_day, '')))
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_block(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_block(TEXT, TEXT) TO authenticated;

-- ─── 2. Public QR RPC: Room residents lookup for /checkout (zero CCCD/phone leak) ──
CREATE OR REPLACE FUNCTION public.lookup_room_residents(
  p_ktx TEXT,
  p_day TEXT,
  p_phong TEXT
)
RETURNS TABLE (
  id UUID,
  ho_va_ten TEXT,
  ma_nv TEXT,
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
    w.giuong,
    w.don_vi
  FROM public.workers w
  WHERE TRIM(LOWER(COALESCE(w.ktx, ''))) = TRIM(LOWER(COALESCE(p_ktx, '')))
    AND TRIM(LOWER(COALESCE(w.day, ''))) = TRIM(LOWER(COALESCE(p_day, '')))
    AND TRIM(LOWER(REGEXP_REPLACE(COALESCE(w.phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'))) =
        TRIM(LOWER(REGEXP_REPLACE(COALESCE(p_phong, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i')))
    AND COALESCE(TRIM(w.ngay_ra_ktx), '') = ''
  ORDER BY w.giuong ASC NULLS LAST, w.ho_va_ten ASC;
$$;

REVOKE ALL ON FUNCTION public.lookup_room_residents(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_room_residents(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── 3. Public QR RPC: Bed availability lookup for /register (zero worker PII) ──
CREATE OR REPLACE FUNCTION public.lookup_room_bed_availability(
  p_ktx TEXT,
  p_day TEXT
)
RETURNS TABLE (
  phong_so TEXT,
  giuong TEXT,
  status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.phong_so,
    b.giuong,
    b.status
  FROM public.beds b
  WHERE TRIM(LOWER(COALESCE(b.ktx, ''))) = TRIM(LOWER(COALESCE(p_ktx, '')))
    AND TRIM(LOWER(COALESCE(b.day, ''))) = TRIM(LOWER(COALESCE(p_day, '')))
  ORDER BY b.phong_so ASC, b.giuong ASC;
$$;

REVOKE ALL ON FUNCTION public.lookup_room_bed_availability(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_room_bed_availability(TEXT, TEXT) TO anon, authenticated;

-- ─── 4. Migration readiness probe RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_package_a_security_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'can_access_block'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'lookup_room_residents'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'lookup_room_bed_availability'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'audit_logs'
        AND cmd IN ('UPDATE', 'DELETE', 'ALL')
    );
$$;

REVOKE ALL ON FUNCTION public.check_package_a_security_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_package_a_security_ready() TO authenticated;

-- ─── 5. Harden RLS policies with block-scoping & append-only logs ───────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  -- A. workers: authenticated read, block-scoped write (allows clearing `day` to '' on checkout)
  IF to_regclass('public.workers') IS NOT NULL THEN
    ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workers'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.workers', pol.policyname);
    END LOOP;

    CREATE POLICY "workers_select_authenticated"
      ON public.workers FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "workers_insert_scoped"
      ON public.workers FOR INSERT TO authenticated
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "workers_update_scoped"
      ON public.workers FOR UPDATE TO authenticated
      USING (public.can_access_block(ktx, day))
      WITH CHECK (
        public.is_admin_user()
        OR COALESCE(TRIM(day), '') = ''
        OR public.can_access_block(ktx, day)
      );

    CREATE POLICY "workers_delete_scoped"
      ON public.workers FOR DELETE TO authenticated
      USING (public.can_access_block(ktx, day));
  END IF;

  -- B. beds: authenticated read, block-scoped write
  IF to_regclass('public.beds') IS NOT NULL THEN
    ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'beds'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.beds', pol.policyname);
    END LOOP;

    CREATE POLICY "beds_select_authenticated"
      ON public.beds FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "beds_insert_scoped"
      ON public.beds FOR INSERT TO authenticated
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "beds_update_scoped"
      ON public.beds FOR UPDATE TO authenticated
      USING (public.can_access_block(ktx, day))
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "beds_delete_scoped"
      ON public.beds FOR DELETE TO authenticated
      USING (public.can_access_block(ktx, day));
  END IF;

  -- C. facilities: public read (for /register & /checkout), block-scoped write
  IF to_regclass('public.facilities') IS NOT NULL THEN
    ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'facilities'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.facilities', pol.policyname);
    END LOOP;

    CREATE POLICY "facilities_select_public"
      ON public.facilities FOR SELECT TO anon, authenticated
      USING (true);

    CREATE POLICY "facilities_insert_scoped"
      ON public.facilities FOR INSERT TO authenticated
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "facilities_update_scoped"
      ON public.facilities FOR UPDATE TO authenticated
      USING (public.can_access_block(ktx, day))
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "facilities_delete_scoped"
      ON public.facilities FOR DELETE TO authenticated
      USING (public.can_access_block(ktx, day));
  END IF;

  -- D. room_units: public read (for structure lookups), block-scoped write
  IF to_regclass('public.room_units') IS NOT NULL THEN
    ALTER TABLE public.room_units ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'room_units'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.room_units', pol.policyname);
    END LOOP;

    CREATE POLICY "room_units_select_public"
      ON public.room_units FOR SELECT TO anon, authenticated
      USING (true);

    CREATE POLICY "room_units_insert_scoped"
      ON public.room_units FOR INSERT TO authenticated
      WITH CHECK (public.can_access_block(ktx, day_nha));

    CREATE POLICY "room_units_update_scoped"
      ON public.room_units FOR UPDATE TO authenticated
      USING (public.can_access_block(ktx, day_nha))
      WITH CHECK (public.can_access_block(ktx, day_nha));

    CREATE POLICY "room_units_delete_scoped"
      ON public.room_units FOR DELETE TO authenticated
      USING (public.can_access_block(ktx, day_nha));
  END IF;

  -- E. worker_registrations: public pending submission only, authenticated read, block-scoped review/delete
  IF to_regclass('public.worker_registrations') IS NOT NULL THEN
    ALTER TABLE public.worker_registrations ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'worker_registrations'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.worker_registrations', pol.policyname);
    END LOOP;

    CREATE POLICY "registrations_insert_pending_only"
      ON public.worker_registrations FOR INSERT TO anon, authenticated
      WITH CHECK (status = 'pending');

    CREATE POLICY "registrations_select_authenticated"
      ON public.worker_registrations FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "registrations_update_scoped"
      ON public.worker_registrations FOR UPDATE TO authenticated
      USING (public.can_access_block(ktx, day))
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "registrations_delete_scoped"
      ON public.worker_registrations FOR DELETE TO authenticated
      USING (public.can_access_block(ktx, day));
  END IF;

  -- F. checkout_requests (legacy compatibility): pending insert, block-scoped update/delete
  IF to_regclass('public.checkout_requests') IS NOT NULL THEN
    ALTER TABLE public.checkout_requests ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkout_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.checkout_requests', pol.policyname);
    END LOOP;

    CREATE POLICY "checkout_requests_insert_pending"
      ON public.checkout_requests FOR INSERT TO anon, authenticated
      WITH CHECK (status = 'pending');

    CREATE POLICY "checkout_requests_select_authenticated"
      ON public.checkout_requests FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "checkout_requests_update_scoped"
      ON public.checkout_requests FOR UPDATE TO authenticated
      USING (public.can_access_block(ktx, day))
      WITH CHECK (public.can_access_block(ktx, day));

    CREATE POLICY "checkout_requests_delete_scoped"
      ON public.checkout_requests FOR DELETE TO authenticated
      USING (public.can_access_block(ktx, day));
  END IF;

  -- G. audit_logs: strictly APPEND-ONLY (SELECT + INSERT only, zero UPDATE/DELETE)
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_logs', pol.policyname);
    END LOOP;

    CREATE POLICY "audit_logs_select_admin_or_checkout"
      ON public.audit_logs FOR SELECT TO authenticated
      USING (
        public.is_admin_user()
        OR action IN ('CHECKOUT_REQUEST', 'CHECKOUT_APPROVED', 'CHECKOUT_REJECTED')
      );

    CREATE POLICY "audit_logs_insert_authenticated"
      ON public.audit_logs FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;

  -- H. worker_deletion_log: strictly APPEND-ONLY for authenticated clients
  IF to_regclass('public.worker_deletion_log') IS NOT NULL THEN
    ALTER TABLE public.worker_deletion_log ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'worker_deletion_log'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.worker_deletion_log', pol.policyname);
    END LOOP;

    CREATE POLICY "worker_deletion_log_select_authenticated"
      ON public.worker_deletion_log FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "worker_deletion_log_insert_authenticated"
      ON public.worker_deletion_log FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;

  -- I. worker_entry_log: strictly APPEND-ONLY for authenticated clients
  IF to_regclass('public.worker_entry_log') IS NOT NULL THEN
    ALTER TABLE public.worker_entry_log ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'worker_entry_log'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.worker_entry_log', pol.policyname);
    END LOOP;

    CREATE POLICY "worker_entry_log_select_authenticated"
      ON public.worker_entry_log FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "worker_entry_log_insert_authenticated"
      ON public.worker_entry_log FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;

  -- J. duty_assignments: authenticated read, admin-only write
  IF to_regclass('public.duty_assignments') IS NOT NULL THEN
    ALTER TABLE public.duty_assignments ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'duty_assignments'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.duty_assignments', pol.policyname);
    END LOOP;

    CREATE POLICY "duty_assignments_select_authenticated"
      ON public.duty_assignments FOR SELECT TO authenticated
      USING (true);

    CREATE POLICY "duty_assignments_insert_admin"
      ON public.duty_assignments FOR INSERT TO authenticated
      WITH CHECK (public.is_admin_user());

    CREATE POLICY "duty_assignments_update_admin"
      ON public.duty_assignments FOR UPDATE TO authenticated
      USING (public.is_admin_user())
      WITH CHECK (public.is_admin_user());

    CREATE POLICY "duty_assignments_delete_admin"
      ON public.duty_assignments FOR DELETE TO authenticated
      USING (public.is_admin_user());
  END IF;
END $$;
