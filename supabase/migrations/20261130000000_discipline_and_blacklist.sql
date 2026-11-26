-- ============================================================================
-- Migration: 20261130000000_discipline_and_blacklist.sql
-- Purpose:
--   1. Create `worker_disciplines` (Sổ Vi phạm Nội quy & Kỷ luật KTX)
--   2. Create `worker_blacklist` (Danh sách Đen — Cấm tái nhập KTX)
--   3. Harden RLS policies (only super_admin / admin / staff can manage;
--      only super_admin / admin can delete or revoke bans)
--   4. Provide public-safe `check_blacklist_cccd` RPC for QR registration gate
--      without exposing any PII or listing the blacklist table publicly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.worker_disciplines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text,
  ho_va_ten text NOT NULL,
  ma_nv text DEFAULT '',
  cccd text DEFAULT '',
  so_dien_thoai text DEFAULT '',
  don_vi text DEFAULT '',
  ktx text DEFAULT '',
  day text DEFAULT '',
  phong_so text DEFAULT '',
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('alcohol', 'fighting', 'fire_safety', 'property_damage', 'curfew', 'hygiene', 'other')),
  severity text NOT NULL DEFAULT 'reminder'
    CHECK (severity IN ('reminder', 'warning', 'record', 'expulsion')),
  title text NOT NULL,
  description text DEFAULT '',
  action_taken text DEFAULT '',
  incident_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  recorded_by text NOT NULL DEFAULT '',
  recorded_by_email text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_disciplines_cccd
  ON public.worker_disciplines (cccd);
CREATE INDEX IF NOT EXISTS idx_worker_disciplines_created
  ON public.worker_disciplines (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_disciplines_don_vi
  ON public.worker_disciplines (don_vi);

CREATE TABLE IF NOT EXISTS public.worker_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cccd text NOT NULL,
  ma_nv text DEFAULT '',
  ho_va_ten text NOT NULL,
  don_vi text DEFAULT '',
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'permanent'
    CHECK (severity IN ('permanent', 'temporary')),
  banned_until date,
  is_active boolean NOT NULL DEFAULT true,
  banned_by text NOT NULL DEFAULT '',
  banned_by_email text DEFAULT '',
  revoked_by text,
  revoked_at timestamptz,
  revoke_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_blacklist_active_cccd
  ON public.worker_blacklist (cccd)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_worker_blacklist_created
  ON public.worker_blacklist (created_at DESC);

ALTER TABLE public.worker_disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_blacklist ENABLE ROW LEVEL SECURITY;

-- Policies for worker_disciplines
DROP POLICY IF EXISTS "disciplines_select_internal" ON public.worker_disciplines;
CREATE POLICY "disciplines_select_internal"
  ON public.worker_disciplines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "disciplines_insert_internal" ON public.worker_disciplines;
CREATE POLICY "disciplines_insert_internal"
  ON public.worker_disciplines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "disciplines_update_internal" ON public.worker_disciplines;
CREATE POLICY "disciplines_update_internal"
  ON public.worker_disciplines
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "disciplines_delete_admin" ON public.worker_disciplines;
CREATE POLICY "disciplines_delete_admin"
  ON public.worker_disciplines
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin')
    )
  );

-- Policies for worker_blacklist
DROP POLICY IF EXISTS "blacklist_select_internal" ON public.worker_blacklist;
CREATE POLICY "blacklist_select_internal"
  ON public.worker_blacklist
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "blacklist_insert_internal" ON public.worker_blacklist;
CREATE POLICY "blacklist_insert_internal"
  ON public.worker_blacklist
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "blacklist_update_admin" ON public.worker_blacklist;
CREATE POLICY "blacklist_update_admin"
  ON public.worker_blacklist
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "blacklist_delete_admin" ON public.worker_blacklist;
CREATE POLICY "blacklist_delete_admin"
  ON public.worker_blacklist
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin')
    )
  );

-- Public-safe RPC for QR registration & pre-check (returns ZERO PII of other users)
CREATE OR REPLACE FUNCTION public.check_blacklist_cccd(
  p_cccd text,
  p_ma_nv text DEFAULT ''
)
RETURNS TABLE (
  is_banned boolean,
  reason text,
  severity text,
  banned_until date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cccd text := regexp_replace(coalesce(p_cccd, ''), '\s+', '', 'g');
  v_ma_nv text := lower(trim(coalesce(p_ma_nv, '')));
BEGIN
  IF v_cccd = '' AND v_ma_nv = '' THEN
    RETURN QUERY SELECT false, ''::text, ''::text, NULL::date;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true AS is_banned,
    b.reason,
    b.severity,
    b.banned_until
  FROM public.worker_blacklist b
  WHERE b.is_active = true
    AND (b.banned_until IS NULL OR b.banned_until >= CURRENT_DATE)
    AND (
      (v_cccd <> '' AND regexp_replace(coalesce(b.cccd, ''), '\s+', '', 'g') = v_cccd)
      OR (v_ma_nv <> '' AND lower(trim(coalesce(b.ma_nv, ''))) = v_ma_nv)
    )
  ORDER BY b.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ''::text, ''::text, NULL::date;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_blacklist_cccd(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_blacklist_cccd(text, text) TO anon, authenticated;
