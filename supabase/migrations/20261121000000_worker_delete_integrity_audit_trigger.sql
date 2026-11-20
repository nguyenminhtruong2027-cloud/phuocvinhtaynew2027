-- Migration: Worker Hard-Delete Integrity Trigger, Audit Trail & Sync Tombstone Helpers
-- 1. Fires AFTER DELETE on public.workers (alphabetically after workers_bed_sync_trigger)
--    to guarantee orphan beds are released, integrity is verified, worker_deletion_log has
--    a tombstone, and detailed JSON audit records are written to public.audit_logs
--    (action = 'WORKER_HARD_DELETE') so stale sessions/tabs never restore deleted records.
-- 2. Adds RPC helpers:
--      - verify_worker_deletion_integrity(...)
--      - get_deleted_worker_tombstones(...)

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_timestamp
  ON public.audit_logs(action, timestamp DESC);

-- Allow authenticated sessions to read WORKER_HARD_DELETE tombstones in audit_logs during sync
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "audit_logs_select_admin_or_checkout" ON public.audit_logs;
    CREATE POLICY "audit_logs_select_admin_or_checkout"
      ON public.audit_logs FOR SELECT TO authenticated
      USING (
        public.is_admin_user()
        OR action IN ('CHECKOUT_REQUEST', 'CHECKOUT_APPROVED', 'CHECKOUT_REJECTED', 'WORKER_HARD_DELETE')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._norm_name_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public._norm_code_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '\s+', '', 'g'), '^(?:chờmã|chưacó|n/a|null|-|—)$', '', 'i'));
$$;

CREATE OR REPLACE FUNCTION public.audit_and_verify_worker_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_actor TEXT;
  v_orphan_beds_cleaned INTEGER := 0;
  v_remaining_workers INTEGER := 0;
  v_remaining_beds INTEGER := 0;
  v_integrity_ok BOOLEAN := FALSE;
  v_detail_json JSONB;
BEGIN
  -- 1. Resolve actor name/email from profiles when auth.uid() is present
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), NULLIF(TRIM(p.email), ''), auth.uid()::TEXT)
    INTO v_actor
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1;
  END IF;
  v_actor := COALESCE(NULLIF(TRIM(v_actor), ''), NULLIF(current_user, ''), 'system@postgres');

  -- 2. Safety cleanup: release any non-maintenance bed still linked by OLD.id
  WITH cleaned_beds AS (
    UPDATE public.beds b
    SET status = 'empty',
        worker_id = NULL,
        ma_nv = NULL,
        ho_va_ten = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE b.worker_id::TEXT = OLD.id::TEXT
      AND b.status <> 'maintenance'
    RETURNING b.id
  )
  SELECT COUNT(*) INTO v_orphan_beds_cleaned FROM cleaned_beds;

  -- Also clear worker references even on maintenance beds
  UPDATE public.beds b
  SET worker_id = NULL,
      ma_nv = NULL,
      ho_va_ten = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE b.worker_id::TEXT = OLD.id::TEXT
    AND b.status = 'maintenance';

  -- 3. Post-delete integrity check in the same transaction
  SELECT COUNT(*) INTO v_remaining_workers
  FROM public.workers w
  WHERE w.id::TEXT = OLD.id::TEXT;

  SELECT COUNT(*) INTO v_remaining_beds
  FROM public.beds b
  WHERE b.worker_id::TEXT = OLD.id::TEXT;

  v_integrity_ok := (v_remaining_workers = 0 AND v_remaining_beds = 0);

  IF NOT v_integrity_ok THEN
    RAISE EXCEPTION 'Kiểm tra toàn vẹn sau xóa thất bại cho công nhân "%" (%): còn % workers, % beds.',
      COALESCE(OLD.ho_va_ten, ''), OLD.id::TEXT, v_remaining_workers, v_remaining_beds;
  END IF;

  -- 4. Guarantee idempotent tombstone in worker_deletion_log (skip duplicate within 30s)
  IF to_regclass('public.worker_deletion_log') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.worker_deletion_log d
      WHERE d.worker_id::TEXT = OLD.id::TEXT
        AND d.deleted_at >= (v_now - INTERVAL '30 seconds')
    ) THEN
      INSERT INTO public.worker_deletion_log (worker_id, ho_va_ten, ma_nv, ktx, day, deleted_at)
      VALUES (
        OLD.id::TEXT,
        NULLIF(TRIM(COALESCE(OLD.ho_va_ten, '')), ''),
        NULLIF(TRIM(COALESCE(OLD.ma_nv, '')), ''),
        NULLIF(TRIM(COALESCE(OLD.ktx, '')), ''),
        NULLIF(TRIM(COALESCE(OLD.day, '')), ''),
        v_now
      );
    END IF;
  END IF;

  -- 5. Append detailed deletion tombstone & integrity verification to public.audit_logs
  v_detail_json := jsonb_build_object(
    'event', 'WORKER_HARD_DELETE',
    'worker_id', OLD.id::TEXT,
    'ho_va_ten', COALESCE(OLD.ho_va_ten, ''),
    'ma_nv', COALESCE(OLD.ma_nv, ''),
    'cccd', COALESCE(OLD.cccd, ''),
    'so_dien_thoai', COALESCE(OLD.so_dien_thoai, ''),
    'ktx', COALESCE(OLD.ktx, ''),
    'day', COALESCE(OLD.day, ''),
    'phong_so', COALESCE(OLD.phong_so, ''),
    'giuong', COALESCE(OLD.giuong, ''),
    'deleted_by_uid', COALESCE(auth.uid()::TEXT, ''),
    'deleted_at', v_now,
    'orphan_beds_cleaned', v_orphan_beds_cleaned,
    'integrity_verified', v_integrity_ok
  );

  INSERT INTO public.audit_logs (timestamp, account, action, detail)
  VALUES (v_now, v_actor, 'WORKER_HARD_DELETE', v_detail_json::TEXT);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS workers_zz_delete_audit_integrity_trigger ON public.workers;
CREATE TRIGGER workers_zz_delete_audit_integrity_trigger
  AFTER DELETE ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_and_verify_worker_delete();

-- Helper RPC: Verify zero remaining worker rows / orphan beds and confirm audit tombstones exist
CREATE OR REPLACE FUNCTION public.verify_worker_deletion_integrity(
  p_worker_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_codes TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_ho_va_ten TEXT DEFAULT NULL,
  p_so_dien_thoai TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '7 days')
)
RETURNS TABLE (
  is_clean BOOLEAN,
  remaining_worker_ids TEXT[],
  orphan_bed_ids TEXT[],
  audited_deleted_ids TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_codes TEXT[] := ARRAY[]::TEXT[];
  v_name_norm TEXT := public._norm_name_text(p_ho_va_ten);
  v_phone_digits TEXT := REGEXP_REPLACE(COALESCE(p_so_dien_thoai, ''), '\D', '', 'g');
  v_remaining_workers TEXT[] := ARRAY[]::TEXT[];
  v_orphan_beds TEXT[] := ARRAY[]::TEXT[];
  v_audited_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT code_val), ARRAY[]::TEXT[])
  INTO v_norm_codes
  FROM (
    SELECT public._norm_code_text(x) AS code_val
    FROM UNNEST(COALESCE(p_codes, ARRAY[]::TEXT[])) AS x
  ) s
  WHERE code_val <> '';

  -- Check remaining rows by worker_id, cross-matched codes, or name+phone
  SELECT COALESCE(ARRAY_AGG(DISTINCT w.id::TEXT), ARRAY[]::TEXT[])
  INTO v_remaining_workers
  FROM public.workers w
  WHERE
    (ARRAY_LENGTH(p_worker_ids, 1) > 0 AND w.id::TEXT = ANY(p_worker_ids))
    OR (
      ARRAY_LENGTH(v_norm_codes, 1) > 0
      AND (
        (
          public._norm_code_text(w.cccd) <> ''
          AND public._norm_code_text(w.cccd) = ANY(v_norm_codes)
          AND (
            v_name_norm = ''
            OR public._norm_name_text(w.ho_va_ten) = v_name_norm
            OR LENGTH(REGEXP_REPLACE(COALESCE(w.cccd, ''), '\D', '', 'g')) >= 9
          )
        )
        OR (
          public._norm_code_text(w.ma_nv) <> ''
          AND public._norm_code_text(w.ma_nv) = ANY(v_norm_codes)
          AND (
            v_name_norm = ''
            OR public._norm_name_text(w.ho_va_ten) = v_name_norm
            OR LENGTH(public._norm_code_text(w.ma_nv)) >= 9
          )
        )
      )
    )
    OR (
      v_name_norm <> '' AND LENGTH(v_phone_digits) >= 8
      AND public._norm_name_text(w.ho_va_ten) = v_name_norm
      AND REGEXP_REPLACE(COALESCE(w.so_dien_thoai, ''), '\D', '', 'g') = v_phone_digits
    );

  -- Check orphan beds still referencing any deleted worker_id
  IF ARRAY_LENGTH(p_worker_ids, 1) > 0 THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT b.id::TEXT), ARRAY[]::TEXT[])
    INTO v_orphan_beds
    FROM public.beds b
    WHERE b.worker_id::TEXT = ANY(p_worker_ids);
  END IF;

  -- Confirm WORKER_HARD_DELETE entries exist in audit_logs
  IF ARRAY_LENGTH(p_worker_ids, 1) > 0 THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT a.detail::JSONB->>'worker_id'), ARRAY[]::TEXT[])
    INTO v_audited_ids
    FROM public.audit_logs a
    WHERE a.action = 'WORKER_HARD_DELETE'
      AND a.timestamp >= p_since
      AND LEFT(TRIM(a.detail), 1) = '{'
      AND (a.detail::JSONB->>'worker_id') = ANY(p_worker_ids);
  END IF;

  RETURN QUERY
  SELECT
    (COALESCE(ARRAY_LENGTH(v_remaining_workers, 1), 0) = 0 AND COALESCE(ARRAY_LENGTH(v_orphan_beds, 1), 0) = 0),
    v_remaining_workers,
    v_orphan_beds,
    v_audited_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_worker_deletion_integrity(TEXT[], TEXT[], TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_worker_deletion_integrity(TEXT[], TEXT[], TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- Helper RPC: Fast authoritative tombstone lookup for stale-session sync protection
CREATE OR REPLACE FUNCTION public.get_deleted_worker_tombstones(
  p_since TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '48 hours')
)
RETURNS TABLE (
  worker_id TEXT,
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
    sub.wid AS worker_id,
    MAX(sub.ts) AS deleted_at
  FROM (
    SELECT
      (a.detail::JSONB->>'worker_id')::TEXT AS wid,
      a.timestamp AS ts
    FROM public.audit_logs a
    WHERE a.action = 'WORKER_HARD_DELETE'
      AND a.timestamp >= p_since
      AND LEFT(TRIM(a.detail), 1) = '{'
      AND COALESCE(a.detail::JSONB->>'worker_id', '') <> ''
    UNION ALL
    SELECT
      d.worker_id::TEXT AS wid,
      d.deleted_at AS ts
    FROM public.worker_deletion_log d
    WHERE d.deleted_at >= p_since
      AND COALESCE(d.worker_id::TEXT, '') <> ''
  ) sub
  GROUP BY sub.wid
  ORDER BY MAX(sub.ts) DESC
  LIMIT 2000;
END;
$$;

REVOKE ALL ON FUNCTION public.get_deleted_worker_tombstones(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_deleted_worker_tombstones(TIMESTAMPTZ) TO authenticated;
