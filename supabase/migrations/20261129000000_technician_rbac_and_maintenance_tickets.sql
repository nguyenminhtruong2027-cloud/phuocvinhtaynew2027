-- Migration: 4-Tier RBAC (+ technician) & QR Room Maintenance Tickets
-- 1. Adds 'technician' role to public.profiles while preserving strict hierarchy:
--    super_admin > admin > (staff, technician)
-- 2. Creates public.maintenance_tickets with strict RLS:
--    - Public QR submission exclusively via SECURITY DEFINER RPC submit_public_maintenance_ticket(...)
--    - Staff can view & create tickets (within scope), cannot change repair status or delete
--    - Technicians can view, create, accept (in_progress), resolve (resolved), and DELETE resolved tickets within scope
--    - Admins & Super Admins have full control over all tickets
-- 3. Grants technicians scoped UPDATE on public.facilities and public.beds for resolving maintenance issues
--    while keeping public.workers PII strictly off-limits.

-- ─── 1. Expand profiles.role CHECK constraint ─────────────────────────────────
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  FOR v_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'staff', 'technician'));

-- ─── 2. Role & Block Scope Helper Functions ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_technician_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'technician'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_maintenance_block(p_ktx text, p_day text)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_blocks text[];
  v_b text;
  v_ktx text := lower(trim(coalesce(p_ktx, '')));
  v_day text := lower(trim(coalesce(p_day, '')));
  v_combined text;
BEGIN
  SELECT role, coalesce(assigned_blocks, '{}'::text[])
    INTO v_role, v_blocks
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role IN ('super_admin', 'admin') THEN
    RETURN true;
  END IF;

  -- Technician with empty assigned_blocks has full-campus maintenance scope
  IF v_role = 'technician' THEN
    IF array_length(v_blocks, 1) IS NULL OR array_length(v_blocks, 1) = 0 THEN
      RETURN true;
    END IF;
  ELSIF v_role = 'staff' THEN
    IF array_length(v_blocks, 1) IS NULL OR array_length(v_blocks, 1) = 0 THEN
      RETURN false;
    END IF;
  ELSE
    RETURN false;
  END IF;

  v_combined := v_ktx || ' - ' || v_day;
  FOREACH v_b IN ARRAY v_blocks LOOP
    IF lower(trim(v_b)) = v_combined
       OR lower(trim(v_b)) = v_day
       OR (position(' - ' in v_b) > 0 AND lower(trim(split_part(v_b, ' - ', 2))) = v_day)
    THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

-- Update get_all_profiles() ordering to include technician neatly
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
  IF NOT public.is_admin_user() THEN
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
    ORDER BY
      CASE p.role
        WHEN 'super_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'technician' THEN 3
        ELSE 4
      END,
      p.created_at DESC;
END;
$$;

-- Update handle_new_user() to permit service_role creating technician profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_requested_role TEXT;
  v_safe_role TEXT;
BEGIN
  v_requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'staff');
  IF v_requested_role IN ('super_admin', 'admin', 'staff', 'technician')
     AND current_setting('role', true) IN ('postgres', 'service_role', 'supabase_admin') THEN
    v_safe_role := v_requested_role;
  ELSE
    v_safe_role := 'staff';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, assigned_blocks)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    v_safe_role,
    '{}'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Update guard_profiles_hierarchy() so admin can manage both 'staff' and 'technician'
CREATE OR REPLACE FUNCTION public.guard_profiles_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller_role TEXT;
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF v_uid IS NULL OR v_jwt_role = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT p.role INTO v_caller_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF TG_OP = 'INSERT' THEN
    IF v_uid = NEW.id AND NEW.role <> 'staff' THEN
      RAISE EXCEPTION 'Không được phép tự nâng quyền khi khởi tạo hồ sơ.';
    END IF;
    IF v_caller_role = 'admin' AND NEW.role NOT IN ('staff', 'technician') THEN
      RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền tạo tài khoản Admin.';
    END IF;
    IF COALESCE(v_caller_role, 'staff') IN ('staff', 'technician') AND NEW.id <> v_uid THEN
      RAISE EXCEPTION 'Bạn không có quyền tạo hồ sơ cho người khác.';
    END IF;
    IF NEW.role = 'super_admin' THEN
      RAISE EXCEPTION 'Không thể tạo thêm tài khoản Super Admin từ giao diện.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_uid = OLD.id THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Không thể tự thay đổi vai trò của chính mình.';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'Tài khoản Quản trị tối cao (Super Admin) được bảo vệ tuyệt đối.';
    END IF;

    IF v_caller_role = 'admin' THEN
      IF OLD.role NOT IN ('staff', 'technician') OR NEW.role NOT IN ('staff', 'technician') THEN
        RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền quản lý tài khoản Admin.';
      END IF;
    ELSIF v_caller_role = 'super_admin' THEN
      IF NEW.role = 'super_admin' THEN
        RAISE EXCEPTION 'Không thể gán vai trò Super Admin qua giao diện chỉnh sửa.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Bạn không có quyền chỉnh sửa tài khoản này.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'Không thể xóa tài khoản Quản trị tối cao (Super Admin).';
    END IF;
    IF OLD.id = v_uid THEN
      RAISE EXCEPTION 'Không thể tự xóa tài khoản đang đăng nhập.';
    END IF;
    IF v_caller_role = 'admin' AND OLD.role NOT IN ('staff', 'technician') THEN
      RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền xóa tài khoản Admin.';
    END IF;
    IF COALESCE(v_caller_role, 'staff') IN ('staff', 'technician') THEN
      RAISE EXCEPTION 'Bạn không có quyền xóa tài khoản.';
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Refresh profiles RLS policies to allow admin managing both staff & technician
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin_user()
    OR (public.is_admin_user() AND role IN ('staff', 'technician'))
    OR (auth.uid() = id AND role = 'staff')
  );

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_super_admin_user()
    OR (public.is_admin_user() AND role IN ('staff', 'technician'))
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_super_admin_user()
    OR (public.is_admin_user() AND role IN ('staff', 'technician'))
  );

DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    id <> auth.uid()
    AND role <> 'super_admin'
    AND (
      public.is_super_admin_user()
      OR (public.is_admin_user() AND role IN ('staff', 'technician'))
    )
  );

-- Allow technicians to update facilities & beds within their maintenance scope
DO $$
BEGIN
  IF to_regclass('public.facilities') IS NOT NULL THEN
    DROP POLICY IF EXISTS "facilities_technician_update_policy" ON public.facilities;
    CREATE POLICY "facilities_technician_update_policy"
      ON public.facilities
      FOR UPDATE
      TO authenticated
      USING (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day))
      WITH CHECK (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day));
  END IF;

  IF to_regclass('public.beds') IS NOT NULL THEN
    DROP POLICY IF EXISTS "beds_technician_update_policy" ON public.beds;
    CREATE POLICY "beds_technician_update_policy"
      ON public.beds
      FOR UPDATE
      TO authenticated
      USING (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day))
      WITH CHECK (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day));
  END IF;
END $$;

-- ─── 3. Create public.maintenance_tickets ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code text NOT NULL,
  ktx text NOT NULL CHECK (char_length(trim(ktx)) BETWEEN 1 AND 120),
  day text NOT NULL CHECK (char_length(trim(day)) BETWEEN 1 AND 80),
  phong_so text NOT NULL CHECK (char_length(trim(phong_so)) BETWEEN 1 AND 60),
  category text NOT NULL CHECK (
    category IN ('ac', 'fan', 'electric', 'plumbing', 'bed_locker', 'door_lock', 'other')
  ),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 3 AND 600),
  reporter_name text DEFAULT '' CHECK (char_length(coalesce(reporter_name, '')) <= 120),
  reporter_phone text DEFAULT '' CHECK (char_length(coalesce(reporter_phone, '')) <= 30),
  source text NOT NULL DEFAULT 'qr' CHECK (source IN ('qr', 'internal')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  assigned_to_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_name text NULL CHECK (char_length(coalesce(assigned_to_name, '')) <= 120),
  started_at timestamptz NULL,
  resolved_by_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by_name text NULL CHECK (char_length(coalesce(resolved_by_name, '')) <= 120),
  resolved_at timestamptz NULL,
  resolution_note text NULL CHECK (char_length(coalesce(resolution_note, '')) <= 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status_created
  ON public.maintenance_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_room
  ON public.maintenance_tickets (ktx, day, phong_so);

ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maintenance_tickets_select_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_select_policy"
  ON public.maintenance_tickets
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_user()
    OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day))
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'staff'
    )
  );

DROP POLICY IF EXISTS "maintenance_tickets_insert_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_insert_policy"
  ON public.maintenance_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_user()
    OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day))
    OR public.can_access_maintenance_block(ktx, day)
  );

DROP POLICY IF EXISTS "maintenance_tickets_update_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_update_policy"
  ON public.maintenance_tickets
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_user()
    OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day))
  )
  WITH CHECK (
    public.is_admin_user()
    OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day))
  );

-- Delete policy:
--  - Admin & Super Admin: can delete any ticket
--  - Technician: can delete ONLY RESOLVED tickets within their scope
DROP POLICY IF EXISTS "maintenance_tickets_delete_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_delete_policy"
  ON public.maintenance_tickets
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin_user()
    OR (
      public.is_technician_user()
      AND status = 'resolved'
      AND public.can_access_maintenance_block(ktx, day)
    )
  );

-- ─── 4. Public Unauthenticated QR Issue Submission RPC (Zero direct anon table read) ──
CREATE OR REPLACE FUNCTION public.submit_public_maintenance_ticket(
  p_ktx text,
  p_day text,
  p_phong_so text,
  p_category text,
  p_priority text DEFAULT 'normal',
  p_description text DEFAULT '',
  p_reporter_name text DEFAULT '',
  p_reporter_phone text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ktx text := trim(coalesce(p_ktx, ''));
  v_day text := trim(coalesce(p_day, ''));
  v_phong text := trim(coalesce(p_phong_so, ''));
  v_cat text := lower(trim(coalesce(p_category, 'other')));
  v_prio text := lower(trim(coalesce(p_priority, 'normal')));
  v_desc text := trim(coalesce(p_description, ''));
  v_rname text := left(trim(coalesce(p_reporter_name, '')), 120);
  v_rphone text := left(trim(coalesce(p_reporter_phone, '')), 30);
  v_dup_code text;
  v_code text;
  v_id uuid;
  v_vn_now timestamp := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh');
BEGIN
  IF char_length(v_ktx) < 1 OR char_length(v_ktx) > 120 THEN
    RAISE EXCEPTION 'Thiếu hoặc sai tên khu KTX.';
  END IF;
  IF char_length(v_day) < 1 OR char_length(v_day) > 80 THEN
    RAISE EXCEPTION 'Thiếu hoặc sai tên dãy nhà.';
  END IF;
  IF char_length(v_phong) < 1 OR char_length(v_phong) > 60 THEN
    RAISE EXCEPTION 'Thiếu hoặc sai số phòng.';
  END IF;
  IF v_cat NOT IN ('ac', 'fan', 'electric', 'plumbing', 'bed_locker', 'door_lock', 'other') THEN
    RAISE EXCEPTION 'Hạng mục sự cố không hợp lệ.';
  END IF;
  IF v_prio NOT IN ('normal', 'urgent') THEN
    v_prio := 'normal';
  END IF;
  IF char_length(v_desc) < 3 OR char_length(v_desc) > 600 THEN
    RAISE EXCEPTION 'Vui lòng mô tả sự cố từ 3 đến 600 ký tự.';
  END IF;

  -- Duplicate protection: prevent accidental rapid double-submits for same room + category within 2 minutes
  SELECT ticket_code INTO v_dup_code
  FROM public.maintenance_tickets
  WHERE lower(ktx) = lower(v_ktx)
    AND lower(day) = lower(v_day)
    AND lower(phong_so) = lower(v_phong)
    AND category = v_cat
    AND status IN ('open', 'in_progress')
    AND created_at > now() - interval '2 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_dup_code IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ticket_code', v_dup_code,
      'duplicate', true
    );
  END IF;

  v_code := 'BT-' || to_char(v_vn_now, 'DDMM') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4));

  INSERT INTO public.maintenance_tickets (
    ticket_code, ktx, day, phong_so, category, priority, description,
    reporter_name, reporter_phone, source, status
  ) VALUES (
    v_code, v_ktx, v_day, v_phong, v_cat, v_prio, v_desc,
    v_rname, v_rphone, 'qr', 'open'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'ticket_code', v_code,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_public_maintenance_ticket(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_maintenance_ticket(text, text, text, text, text, text, text, text) TO anon, authenticated;

-- Enable Supabase Realtime for maintenance_tickets
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_tickets;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;
