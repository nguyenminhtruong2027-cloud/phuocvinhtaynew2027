-- Migration: 3-Tier Hierarchical RBAC (super_admin > admin > staff)
-- Tier 1 (super_admin): Full system authority, untouchable by lower tiers, exclusive admin CRUD & global wipe control
-- Tier 2 (admin): Full KTX operations + manage staff accounts only
-- Tier 3 (staff): Assigned block operations only

-- 1. Expand role CHECK constraint on public.profiles to allow 'super_admin', 'admin', 'staff'
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
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'staff'));

-- 2. Promote primary owner account(s) to super_admin (idempotent)
UPDATE public.profiles
SET role = 'super_admin'
WHERE LOWER(TRIM(COALESCE(email, ''))) = 'nguyenminhtruong2027@gmail.com'
  AND role <> 'super_admin';

-- Ensure at least one super_admin exists in legacy deployments (fallback to root adminpvt@ktx.com or earliest admin)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'super_admin') THEN
    UPDATE public.profiles
    SET role = 'super_admin'
    WHERE id = (
      SELECT id FROM public.profiles
      WHERE LOWER(TRIM(COALESCE(email, ''))) = 'adminpvt@ktx.com'
      LIMIT 1
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'super_admin') THEN
    UPDATE public.profiles
    SET role = 'super_admin'
    WHERE id = (
      SELECT id FROM public.profiles
      WHERE role = 'admin'
      ORDER BY created_at ASC NULLS LAST
      LIMIT 1
    );
  END IF;
END $$;

-- Sync auth.users metadata for promoted super_admin accounts (best-effort)
DO $$
BEGIN
  UPDATE auth.users u
  SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'super_admin')
  FROM public.profiles p
  WHERE p.id = u.id
    AND p.role = 'super_admin'
    AND COALESCE(u.raw_user_meta_data->>'role', '') <> 'super_admin';
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 3. Role helper functions (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_super_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

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

CREATE OR REPLACE FUNCTION public.is_admin_from_metadata()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (
      raw_user_meta_data->>'role' IN ('super_admin', 'admin')
      OR raw_app_meta_data->>'role' IN ('super_admin', 'admin')
    )
  );
$$;

-- 4. Update get_all_profiles() to support super_admin & admin callers, ordered by tier
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
        ELSE 3
      END,
      p.created_at DESC;
END;
$$;

-- 5. Migration check RPC for UserManagementClient Migration Readiness panel
CREATE OR REPLACE FUNCTION public.check_super_admin_rbac_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%super_admin%'
  );
$$;

REVOKE ALL ON FUNCTION public.check_super_admin_rbac_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_super_admin_rbac_ready() TO authenticated;

-- 6. Harden handle_new_user() so client signups default strictly to 'staff'
--    (Elevated roles must be assigned via Edge Function / super_admin only)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_requested_role TEXT;
  v_safe_role TEXT;
BEGIN
  v_requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'staff');
  IF v_requested_role IN ('super_admin', 'admin', 'staff') AND current_setting('role', true) IN ('postgres', 'service_role', 'supabase_admin') THEN
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

-- 7. Database-level Trigger guarding Super Admin & Admin hierarchy against privilege escalation
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
  -- Allow trusted backend / SQL Editor / service_role operations
  IF v_uid IS NULL OR v_jwt_role = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT p.role INTO v_caller_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF TG_OP = 'INSERT' THEN
    -- Self-registration fallback inserts only 'staff'
    IF v_uid = NEW.id AND NEW.role <> 'staff' THEN
      RAISE EXCEPTION 'Không được phép tự nâng quyền khi khởi tạo hồ sơ.';
    END IF;
    IF v_caller_role = 'admin' AND NEW.role <> 'staff' THEN
      RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền tạo tài khoản Admin.';
    END IF;
    IF COALESCE(v_caller_role, 'staff') = 'staff' AND NEW.id <> v_uid THEN
      RAISE EXCEPTION 'Bạn không có quyền tạo hồ sơ cho người khác.';
    END IF;
    IF NEW.role = 'super_admin' THEN
      RAISE EXCEPTION 'Không thể tạo thêm tài khoản Super Admin từ giao diện.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Self-profile edits (name/email only): block any role self-escalation
    IF v_uid = OLD.id THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Không thể tự thay đổi vai trò của chính mình.';
      END IF;
      RETURN NEW;
    END IF;

    -- Nobody other than super_admin can touch a super_admin row
    IF OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'Tài khoản Quản trị tối cao (Super Admin) được bảo vệ tuyệt đối.';
    END IF;

    -- Regular admin cannot edit other admin rows or promote anyone to admin/super_admin
    IF v_caller_role = 'admin' THEN
      IF OLD.role <> 'staff' OR NEW.role <> 'staff' THEN
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
    IF v_caller_role = 'admin' AND OLD.role <> 'staff' THEN
      RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền xóa tài khoản Admin.';
    END IF;
    IF COALESCE(v_caller_role, 'staff') = 'staff' THEN
      RAISE EXCEPTION 'Bạn không có quyền xóa tài khoản.';
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_hierarchy ON public.profiles;
CREATE TRIGGER trg_guard_profiles_hierarchy
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_hierarchy();

-- 8. Refresh RLS Policies on public.profiles for 3-tier RBAC
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin_user());

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin_user()
    OR (public.is_admin_user() AND role = 'staff')
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
    OR (public.is_admin_user() AND role = 'staff')
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_super_admin_user()
    OR (public.is_admin_user() AND role = 'staff')
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
      OR (public.is_admin_user() AND role = 'staff')
    )
  );
