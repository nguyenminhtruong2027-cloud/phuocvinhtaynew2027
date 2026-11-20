-- Migration: Hard-delete integrity & normalized block matching for worker_registrations and checkout
-- 1. Normalizes can_access_block() & lookup_room_residents() across KTX/Dãy/Phòng prefix variations
-- 2. Adds AFTER DELETE trigger on public.worker_registrations to record REGISTRATION_HARD_DELETE
--    tombstones in public.audit_logs
-- 3. Adds RPC helpers hard_delete_worker_registration(...) & get_deleted_registration_tombstones(...)

CREATE OR REPLACE FUNCTION public._norm_ktx_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public._norm_day_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT REGEXP_REPLACE(
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '^(?:dãy|day)\s*', '', 'i'), '\s+', ' ', 'g'))),
    '^0+(\d+)$',
    '\1'
  );
$$;

CREATE OR REPLACE FUNCTION public._norm_room_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LTRIM(LOWER(TRIM(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'))), '0');
$$;

-- Normalized block access helper (prevents silent RLS 0-row delete when "KTX1"/"1" differs from "KTX 1 - Dãy 1")
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
          (
            POSITION(' - ' IN blk) > 0
            AND public._norm_ktx_text(SPLIT_PART(blk, ' - ', 1)) = public._norm_ktx_text(p_ktx)
            AND public._norm_day_text(SUBSTRING(blk FROM POSITION(' - ' IN blk) + 3)) = public._norm_day_text(p_day)
          )
          OR (
            POSITION(' - ' IN blk) = 0
            AND public._norm_day_text(blk) = public._norm_day_text(p_day)
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_block(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_block(TEXT, TEXT) TO authenticated;

-- Normalized public QR RPC for /checkout room residents lookup
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
  WHERE public._norm_ktx_text(w.ktx) = public._norm_ktx_text(p_ktx)
    AND public._norm_day_text(w.day) = public._norm_day_text(p_day)
    AND public._norm_room_text(w.phong_so) = public._norm_room_text(p_phong)
    AND COALESCE(TRIM(w.ngay_ra_ktx), '') = ''
  ORDER BY w.giuong ASC NULLS LAST, w.ho_va_ten ASC;
$$;

REVOKE ALL ON FUNCTION public.lookup_room_residents(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_room_residents(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Allow authenticated sessions to read REGISTRATION_HARD_DELETE tombstones during sync
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "audit_logs_select_admin_or_checkout" ON public.audit_logs;
    CREATE POLICY "audit_logs_select_admin_or_checkout"
      ON public.audit_logs FOR SELECT TO authenticated
      USING (
        public.is_admin_user()
        OR action IN ('CHECKOUT_REQUEST', 'CHECKOUT_APPROVED', 'CHECKOUT_REJECTED', 'WORKER_HARD_DELETE', 'REGISTRATION_HARD_DELETE')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.audit_worker_registration_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_actor TEXT;
  v_detail_json JSONB;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), NULLIF(TRIM(p.email), ''), auth.uid()::TEXT)
    INTO v_actor
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1;
  END IF;
  v_actor := COALESCE(NULLIF(TRIM(v_actor), ''), NULLIF(current_user, ''), 'system@postgres');

  v_detail_json := jsonb_build_object(
    'event', 'REGISTRATION_HARD_DELETE',
    'registration_id', OLD.id::TEXT,
    'worker_id', COALESCE(OLD.worker_id::TEXT, ''),
    'ho_va_ten', COALESCE(OLD.ho_va_ten, ''),
    'ma_nv', COALESCE(OLD.ma_nv, ''),
    'so_cccd', COALESCE(OLD.so_cccd, ''),
    'ktx', COALESCE(OLD.ktx, ''),
    'day', COALESCE(OLD.day, ''),
    'phong_so', COALESCE(OLD.phong_so, ''),
    'giuong', COALESCE(OLD.giuong, ''),
    'status', COALESCE(OLD.status, ''),
    'is_checkout', (COALESCE(OLD.ghi_chu, '') LIKE '[CHECKOUT]%'),
    'deleted_by_uid', COALESCE(auth.uid()::TEXT, ''),
    'deleted_at', v_now,
    'integrity_verified', true
  );

  INSERT INTO public.audit_logs (timestamp, account, action, detail)
  VALUES (v_now, v_actor, 'REGISTRATION_HARD_DELETE', v_detail_json::TEXT);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS worker_registrations_zz_delete_audit_trigger ON public.worker_registrations;
CREATE TRIGGER worker_registrations_zz_delete_audit_trigger
  AFTER DELETE ON public.worker_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_worker_registration_hard_delete();

CREATE OR REPLACE FUNCTION public.hard_delete_worker_registration(
  p_registration_id UUID
)
RETURNS TABLE (
  deleted_id TEXT,
  is_clean BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg RECORD;
  v_deleted_id TEXT;
  v_remaining INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;

  SELECT *
  INTO v_reg
  FROM public.worker_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_registration_id::TEXT, TRUE;
    RETURN;
  END IF;

  IF NOT public.can_access_block(v_reg.ktx, v_reg.day) THEN
    RAISE EXCEPTION 'Bạn không có quyền xóa bản ghi thuộc % - %.', COALESCE(v_reg.ktx, ''), COALESCE(v_reg.day, '');
  END IF;

  DELETE FROM public.worker_registrations
  WHERE id = p_registration_id
  RETURNING id::TEXT INTO v_deleted_id;

  SELECT COUNT(*)
  INTO v_remaining
  FROM public.worker_registrations
  WHERE id = p_registration_id;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Không thể xóa triệt để bản ghi % khỏi bảng worker_registrations.', p_registration_id;
  END IF;

  RETURN QUERY SELECT COALESCE(v_deleted_id, p_registration_id::TEXT), TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_worker_registration(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hard_delete_worker_registration(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_deleted_registration_tombstones(
  p_since TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '48 hours')
)
RETURNS TABLE (
  registration_id TEXT,
  deleted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;

  RETURN QUERY
  SELECT
    (a.detail::JSONB->>'registration_id')::TEXT AS registration_id,
    MAX(a.timestamp) AS deleted_at
  FROM public.audit_logs a
  WHERE a.action = 'REGISTRATION_HARD_DELETE'
    AND a.timestamp >= p_since
    AND LEFT(TRIM(a.detail), 1) = '{'
    AND COALESCE(a.detail::JSONB->>'registration_id', '') <> ''
  GROUP BY (a.detail::JSONB->>'registration_id')::TEXT
  ORDER BY MAX(a.timestamp) DESC
  LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.get_deleted_registration_tombstones(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_deleted_registration_tombstones(TIMESTAMPTZ) TO authenticated;
