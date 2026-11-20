-- Migration: Guarantee zero surviving duplicate/residual worker rows on checkout approval
-- 1. Adds compact KTX normalization so 'KTX 1' and 'KTX1' always match.
-- 2. Enhances `approve_checkout_remove_worker` to sweep duplicate rows (even when
--    ma_nv, cccd, and so_dien_thoai are empty) and re-verify zero survivors remain.
-- 3. Enhances `verify_worker_deletion_integrity` with optional `p_ktx` / `p_phong_so`
--    checks so post-delete integrity verification catches same-name/location survivors.

CREATE OR REPLACE FUNCTION public._norm_ktx_compact(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '[\s\-_.]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public._norm_room_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(LTRIM(LOWER(TRIM(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'))), '0'), ''),
    LOWER(TRIM(REGEXP_REPLACE(TRANSLATE(NORMALIZE(COALESCE(raw, ''), NFC), CHR(160) || CHR(8203) || CHR(8204) || CHR(8205) || CHR(65279), '     '), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i')))
  );
$$;

CREATE OR REPLACE FUNCTION public.approve_checkout_remove_worker(
  p_registration_id UUID,
  p_reviewed_by UUID DEFAULT NULL
)
RETURNS TABLE (
  deleted_worker_ids TEXT[],
  released_bed_ids TEXT[],
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_reg_worker_id TEXT;
  v_ktx_compact TEXT;
  v_day_norm TEXT;
  v_room_norm TEXT;
  v_bed_norm TEXT;
  v_name_norm TEXT;
  v_ma_nv TEXT;
  v_cccd TEXT;
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_phone_digits TEXT;
  v_has_strong_id BOOLEAN := FALSE;
  v_candidate_ids TEXT[] := ARRAY[]::TEXT[];
  v_deleted_ids TEXT[] := ARRAY[]::TEXT[];
  v_released_beds TEXT[] := ARRAY[]::TEXT[];
  v_worker RECORD;
  v_remaining_count INTEGER := 0;
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
    RAISE EXCEPTION 'Không tìm thấy yêu cầu check-out (%).', p_registration_id;
  END IF;

  IF NOT public.can_access_block(v_reg.ktx, v_reg.day) THEN
    RAISE EXCEPTION 'Bạn không có quyền duyệt check-out tại % - %.', v_reg.ktx, v_reg.day;
  END IF;

  v_reg_worker_id := TRIM(COALESCE(v_reg.worker_id::TEXT, ''));
  v_ktx_compact := public._norm_ktx_compact(v_reg.ktx);
  v_day_norm := public._norm_day_text(v_reg.day);
  v_room_norm := public._norm_room_text(v_reg.phong_so);
  v_bed_norm := public._norm_bed_text(v_reg.giuong);
  v_name_norm := public._norm_name_text(v_reg.ho_va_ten);
  v_phone_digits := REGEXP_REPLACE(COALESCE(v_reg.so_dien_thoai, ''), '\D', '', 'g');

  v_ma_nv := public._norm_code_text(v_reg.ma_nv);
  v_cccd := public._norm_code_text(v_reg.so_cccd);

  IF v_ma_nv <> '' THEN
    v_codes := ARRAY_APPEND(v_codes, v_ma_nv);
  END IF;
  IF v_cccd <> '' AND NOT (v_cccd = ANY(v_codes)) THEN
    v_codes := ARRAY_APPEND(v_codes, v_cccd);
  END IF;
  v_has_strong_id := (COALESCE(ARRAY_LENGTH(v_codes, 1), 0) > 0 OR LENGTH(v_phone_digits) >= 8);

  -- Collect ALL matching worker rows (primary + any duplicates across rooms/KTXes):
  SELECT ARRAY_AGG(DISTINCT w.id::TEXT)
  INTO v_candidate_ids
  FROM public.workers w
  WHERE
    (v_reg_worker_id <> '' AND w.id::TEXT = v_reg_worker_id)
    OR w.id::TEXT IN (
      SELECT TRIM(b.worker_id::TEXT)
      FROM public.beds b
      WHERE b.worker_id IS NOT NULL
        AND TRIM(b.worker_id::TEXT) <> ''
        AND v_ktx_compact <> '' AND v_room_norm <> '' AND v_bed_norm <> ''
        AND public._norm_ktx_compact(b.ktx) = v_ktx_compact
        AND (v_day_norm = '' OR TRIM(COALESCE(b.day, '')) = '' OR public._norm_day_text(b.day) = v_day_norm)
        AND public._norm_room_text(b.phong_so) = v_room_norm
        AND public._norm_bed_text(b.giuong) = v_bed_norm
        AND (
          v_name_norm = ''
          OR public._norm_name_text(b.ho_va_ten) = v_name_norm
        )
    )
    OR (
      ARRAY_LENGTH(v_codes, 1) > 0
      AND (
        (
          public._norm_code_text(w.cccd) <> ''
          AND public._norm_code_text(w.cccd) = ANY(v_codes)
          AND (
            v_name_norm = ''
            OR public._norm_name_text(w.ho_va_ten) = v_name_norm
            OR LENGTH(REGEXP_REPLACE(COALESCE(w.cccd, ''), '\D', '', 'g')) >= 9
          )
        )
        OR (
          public._norm_code_text(w.ma_nv) <> ''
          AND public._norm_code_text(w.ma_nv) = ANY(v_codes)
          AND (
            v_name_norm = ''
            OR public._norm_name_text(w.ho_va_ten) = v_name_norm
            OR public._norm_ktx_compact(w.ktx) = v_ktx_compact
            OR LENGTH(public._norm_code_text(w.ma_nv)) >= 9
          )
        )
      )
    )
    OR (
      v_name_norm <> '' AND v_ktx_compact <> '' AND v_room_norm <> ''
      AND public._norm_ktx_compact(w.ktx) = v_ktx_compact
      AND (v_day_norm = '' OR TRIM(COALESCE(w.day, '')) = '' OR public._norm_day_text(w.day) = v_day_norm)
      AND public._norm_room_text(w.phong_so) = v_room_norm
      AND public._norm_name_text(w.ho_va_ten) = v_name_norm
    )
    OR (
      -- When worker has no ma_nv, no CCCD, and no phone, match un-assigned/same-KTX rows with empty code
      NOT v_has_strong_id
      AND v_name_norm <> '' AND v_ktx_compact <> ''
      AND public._norm_name_text(w.ho_va_ten) = v_name_norm
      AND public._norm_ktx_compact(w.ktx) = v_ktx_compact
      AND public._norm_code_text(w.ma_nv) = ''
      AND public._norm_code_text(w.cccd) = ''
      AND (
        v_room_norm = ''
        OR public._norm_room_text(w.phong_so) = ''
        OR public._norm_room_text(w.phong_so) = v_room_norm
      )
    )
    OR (
      v_name_norm <> '' AND LENGTH(v_phone_digits) >= 8
      AND public._norm_name_text(w.ho_va_ten) = v_name_norm
      AND REGEXP_REPLACE(COALESCE(w.so_dien_thoai, ''), '\D', '', 'g') = v_phone_digits
    );

  IF v_candidate_ids IS NOT NULL AND ARRAY_LENGTH(v_candidate_ids, 1) > 0 THEN
    FOR v_worker IN
      SELECT id::TEXT AS wid, ho_va_ten, ma_nv, ktx, day
      FROM public.workers
      WHERE id::TEXT = ANY(v_candidate_ids)
    LOOP
      IF NOT (
        public.can_access_block(v_worker.ktx, v_worker.day)
        OR (TRIM(COALESCE(v_worker.day, '')) = '' AND public.can_access_block(v_reg.ktx, v_reg.day))
      ) THEN
        RAISE EXCEPTION 'Không đủ quyền xóa công nhân "%" thuộc % - %.', v_worker.ho_va_ten, v_worker.ktx, v_worker.day;
      END IF;

      INSERT INTO public.worker_deletion_log (worker_id, ho_va_ten, ma_nv, ktx, day, deleted_at)
      VALUES (
        v_worker.wid,
        COALESCE(NULLIF(TRIM(v_worker.ho_va_ten), ''), v_reg.ho_va_ten),
        COALESCE(NULLIF(TRIM(v_worker.ma_nv), ''), v_reg.ma_nv),
        COALESCE(NULLIF(TRIM(v_worker.ktx), ''), v_reg.ktx),
        COALESCE(NULLIF(TRIM(v_worker.day), ''), v_reg.day),
        v_now
      );
    END LOOP;

    WITH del AS (
      DELETE FROM public.workers
      WHERE id::TEXT = ANY(v_candidate_ids)
      RETURNING id::TEXT AS wid
    )
    SELECT ARRAY_AGG(wid) INTO v_deleted_ids FROM del;

    SELECT COUNT(*)
    INTO v_remaining_count
    FROM public.workers w
    WHERE w.id::TEXT = ANY(v_candidate_ids)
       OR (v_reg_worker_id <> '' AND w.id::TEXT = v_reg_worker_id)
       OR (
         ARRAY_LENGTH(v_codes, 1) > 0
         AND public._norm_code_text(w.cccd) <> ''
         AND public._norm_code_text(w.cccd) = ANY(v_codes)
         AND LENGTH(REGEXP_REPLACE(COALESCE(w.cccd, ''), '\D', '', 'g')) >= 9
       )
       OR (
         v_name_norm <> '' AND v_ktx_compact <> '' AND v_room_norm <> ''
         AND public._norm_name_text(w.ho_va_ten) = v_name_norm
         AND public._norm_ktx_compact(w.ktx) = v_ktx_compact
         AND public._norm_room_text(w.phong_so) = v_room_norm
       );

    IF v_remaining_count > 0 THEN
      RAISE EXCEPTION 'Không thể xóa hoàn toàn % bản ghi công nhân "%".', v_remaining_count, v_reg.ho_va_ten;
    END IF;
  END IF;

  IF (v_deleted_ids IS NULL OR ARRAY_LENGTH(v_deleted_ids, 1) = 0)
     AND v_ktx_compact <> '' AND v_room_norm <> '' AND v_bed_norm <> '' THEN
    PERFORM 1
    FROM public.beds b
    WHERE b.status = 'occupied'
      AND public._norm_ktx_compact(b.ktx) = v_ktx_compact
      AND (v_day_norm = '' OR TRIM(COALESCE(b.day, '')) = '' OR public._norm_day_text(b.day) = v_day_norm)
      AND public._norm_room_text(b.phong_so) = v_room_norm
      AND public._norm_bed_text(b.giuong) = v_bed_norm
      AND COALESCE(TRIM(b.ho_va_ten), '') <> ''
      AND v_name_norm <> ''
      AND public._norm_name_text(b.ho_va_ten) <> v_name_norm;

    IF FOUND THEN
      RAISE EXCEPTION 'Giường % (Phòng %) hiện đang có công nhân khác lưu trú.', v_reg.giuong, v_reg.phong_so;
    END IF;
  END IF;

  WITH upd AS (
    UPDATE public.beds b
    SET status = 'empty',
        worker_id = NULL,
        ma_nv = NULL,
        ho_va_ten = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE b.status <> 'maintenance'
      AND (
        (v_deleted_ids IS NOT NULL AND b.worker_id::TEXT = ANY(v_deleted_ids))
        OR (v_reg_worker_id <> '' AND b.worker_id::TEXT = v_reg_worker_id)
        OR (
          v_ktx_compact <> '' AND v_room_norm <> '' AND v_bed_norm <> ''
          AND public._norm_ktx_compact(b.ktx) = v_ktx_compact
          AND (v_day_norm = '' OR TRIM(COALESCE(b.day, '')) = '' OR public._norm_day_text(b.day) = v_day_norm)
          AND public._norm_room_text(b.phong_so) = v_room_norm
          AND public._norm_bed_text(b.giuong) = v_bed_norm
        )
      )
    RETURNING b.id::TEXT AS bid
  )
  SELECT ARRAY_AGG(bid) INTO v_released_beds FROM upd;

  UPDATE public.worker_registrations
  SET status = 'approved',
      reviewed_by = COALESCE(p_reviewed_by, auth.uid()),
      reviewed_at = v_now
  WHERE id = p_registration_id;

  RETURN QUERY
  SELECT
    COALESCE(v_deleted_ids, ARRAY[]::TEXT[]),
    COALESCE(v_released_beds, ARRAY[]::TEXT[]),
    'approved'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_checkout_remove_worker(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_checkout_remove_worker(UUID, UUID) TO authenticated;

-- Extend verify_worker_deletion_integrity with optional KTX + room check (keeps backward compatibility)
DROP FUNCTION IF EXISTS public.verify_worker_deletion_integrity(TEXT[], TEXT[], TEXT, TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.verify_worker_deletion_integrity(
  p_worker_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_codes TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_ho_va_ten TEXT DEFAULT NULL,
  p_so_dien_thoai TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '7 days'),
  p_ktx TEXT DEFAULT NULL,
  p_phong_so TEXT DEFAULT NULL
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
  v_ktx_compact TEXT := public._norm_ktx_compact(p_ktx);
  v_room_norm TEXT := public._norm_room_text(p_phong_so);
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
    )
    OR (
      v_name_norm <> '' AND v_ktx_compact <> '' AND v_room_norm <> ''
      AND public._norm_name_text(w.ho_va_ten) = v_name_norm
      AND public._norm_ktx_compact(w.ktx) = v_ktx_compact
      AND public._norm_room_text(w.phong_so) = v_room_norm
    );

  IF ARRAY_LENGTH(p_worker_ids, 1) > 0 THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT b.id::TEXT), ARRAY[]::TEXT[])
    INTO v_orphan_beds
    FROM public.beds b
    WHERE b.worker_id::TEXT = ANY(p_worker_ids);

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

REVOKE ALL ON FUNCTION public.verify_worker_deletion_integrity(TEXT[], TEXT[], TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_worker_deletion_integrity(TEXT[], TEXT[], TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
