-- Migration: Atomic server-side checkout approval & normalized worker removal
-- Guarantees that approving a checkout deletes all matching duplicate/primary worker rows
-- for that resident/slot, logs to worker_deletion_log, releases beds atomically,
-- and marks worker_registrations.status = 'approved' in a single ACID transaction.

CREATE OR REPLACE FUNCTION public._norm_ktx_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(COALESCE(raw, ''), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public._norm_day_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(raw, ''), '^(?:dãy|day)\s*', '', 'i'), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public._norm_room_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LTRIM(LOWER(TRIM(REGEXP_REPLACE(COALESCE(raw, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'))), '0');
$$;

CREATE OR REPLACE FUNCTION public._norm_bed_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LTRIM(LOWER(TRIM(REGEXP_REPLACE(COALESCE(raw, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i'))), '0');
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
  v_ktx_norm TEXT;
  v_day_norm TEXT;
  v_room_norm TEXT;
  v_bed_norm TEXT;
  v_name_norm TEXT;
  v_ma_nv TEXT;
  v_cccd TEXT;
  v_candidate_ids UUID[] := ARRAY[]::UUID[];
  v_deleted_ids TEXT[] := ARRAY[]::TEXT[];
  v_released_beds TEXT[] := ARRAY[]::TEXT[];
  v_worker RECORD;
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

  v_ktx_norm := public._norm_ktx_text(v_reg.ktx);
  v_day_norm := public._norm_day_text(v_reg.day);
  v_room_norm := public._norm_room_text(v_reg.phong_so);
  v_bed_norm := public._norm_bed_text(v_reg.giuong);
  v_name_norm := LOWER(TRIM(REGEXP_REPLACE(NORMALIZE(COALESCE(v_reg.ho_va_ten, ''), NFC), '\s+', ' ', 'g')));

  v_ma_nv := TRIM(COALESCE(v_reg.ma_nv, ''));
  IF LOWER(v_ma_nv) IN ('', '-', '—', 'chờ mã', 'chưa có', 'n/a', 'null') THEN
    v_ma_nv := '';
  END IF;

  v_cccd := TRIM(COALESCE(v_reg.so_cccd, ''));
  IF LOWER(v_cccd) IN ('', '-', '—', 'chờ mã', 'chưa có', 'n/a', 'null') THEN
    v_cccd := '';
  END IF;

  -- Collect all matching worker rows:
  -- 1. Explicit worker_id on registration
  -- 2. Linked worker_id from beds at normalized slot (if name matches or name empty)
  -- 3. Non-placeholder ma_nv / cccd
  -- 4. Normalized (ktx + day/empty + room + ho_va_ten) (captures duplicates)
  SELECT ARRAY_AGG(DISTINCT w.id)
  INTO v_candidate_ids
  FROM public.workers w
  WHERE
    (v_reg.worker_id IS NOT NULL AND w.id = v_reg.worker_id)
    OR w.id IN (
      SELECT b.worker_id::UUID
      FROM public.beds b
      WHERE b.worker_id IS NOT NULL
        AND b.worker_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND v_ktx_norm <> '' AND v_room_norm <> '' AND v_bed_norm <> ''
        AND public._norm_ktx_text(b.ktx) = v_ktx_norm
        AND (v_day_norm = '' OR public._norm_day_text(b.day) = v_day_norm)
        AND public._norm_room_text(b.phong_so) = v_room_norm
        AND public._norm_bed_text(b.giuong) = v_bed_norm
        AND (
          v_name_norm = ''
          OR LOWER(TRIM(REGEXP_REPLACE(NORMALIZE(COALESCE(b.ho_va_ten, ''), NFC), '\s+', ' ', 'g'))) = v_name_norm
        )
    )
    OR (v_ma_nv <> '' AND LOWER(TRIM(COALESCE(w.ma_nv, ''))) = LOWER(v_ma_nv))
    OR (v_cccd <> '' AND LOWER(TRIM(COALESCE(w.cccd, ''))) = LOWER(v_cccd))
    OR (
      v_name_norm <> '' AND v_ktx_norm <> '' AND v_room_norm <> ''
      AND public._norm_ktx_text(w.ktx) = v_ktx_norm
      AND (v_day_norm = '' OR TRIM(COALESCE(w.day, '')) = '' OR public._norm_day_text(w.day) = v_day_norm)
      AND public._norm_room_text(w.phong_so) = v_room_norm
      AND LOWER(TRIM(REGEXP_REPLACE(NORMALIZE(COALESCE(w.ho_va_ten, ''), NFC), '\s+', ' ', 'g'))) = v_name_norm
    );

  -- Enforce block write permission & write deletion logs + delete all candidates
  IF v_candidate_ids IS NOT NULL AND ARRAY_LENGTH(v_candidate_ids, 1) > 0 THEN
    FOR v_worker IN
      SELECT id, ho_va_ten, ma_nv, ktx, day
      FROM public.workers
      WHERE id = ANY(v_candidate_ids)
    LOOP
      IF NOT public.can_access_block(v_worker.ktx, v_worker.day) THEN
        RAISE EXCEPTION 'Không đủ quyền xóa công nhân "%" thuộc % - %.', v_worker.ho_va_ten, v_worker.ktx, v_worker.day;
      END IF;

      INSERT INTO public.worker_deletion_log (worker_id, ho_va_ten, ma_nv, ktx, day, deleted_at)
      VALUES (
        v_worker.id::TEXT,
        COALESCE(NULLIF(TRIM(v_worker.ho_va_ten), ''), v_reg.ho_va_ten),
        COALESCE(NULLIF(TRIM(v_worker.ma_nv), ''), v_reg.ma_nv),
        COALESCE(NULLIF(TRIM(v_worker.ktx), ''), v_reg.ktx),
        COALESCE(NULLIF(TRIM(v_worker.day), ''), v_reg.day),
        v_now
      );
    END LOOP;

    WITH del AS (
      DELETE FROM public.workers
      WHERE id = ANY(v_candidate_ids)
      RETURNING id::TEXT AS wid
    )
    SELECT ARRAY_AGG(wid) INTO v_deleted_ids FROM del;
  END IF;

  -- Refuse silent approval if the slot is currently occupied by someone else
  IF (v_deleted_ids IS NULL OR ARRAY_LENGTH(v_deleted_ids, 1) = 0)
     AND v_ktx_norm <> '' AND v_room_norm <> '' AND v_bed_norm <> '' THEN
    PERFORM 1
    FROM public.beds b
    WHERE b.status = 'occupied'
      AND public._norm_ktx_text(b.ktx) = v_ktx_norm
      AND (v_day_norm = '' OR public._norm_day_text(b.day) = v_day_norm)
      AND public._norm_room_text(b.phong_so) = v_room_norm
      AND public._norm_bed_text(b.giuong) = v_bed_norm
      AND COALESCE(TRIM(b.ho_va_ten), '') <> ''
      AND v_name_norm <> ''
      AND LOWER(TRIM(REGEXP_REPLACE(NORMALIZE(b.ho_va_ten, NFC), '\s+', ' ', 'g'))) <> v_name_norm;

    IF FOUND THEN
      RAISE EXCEPTION 'Giường % (Phòng %) hiện đang có công nhân khác lưu trú.', v_reg.giuong, v_reg.phong_so;
    END IF;
  END IF;

  -- Release all beds linked by deleted worker_id OR normalized slot
  WITH upd AS (
    UPDATE public.beds b
    SET status = 'empty',
        worker_id = NULL,
        ma_nv = NULL,
        ho_va_ten = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE b.status <> 'maintenance'
      AND (
        (v_deleted_ids IS NOT NULL AND b.worker_id = ANY(v_deleted_ids))
        OR (v_reg.worker_id IS NOT NULL AND b.worker_id = v_reg.worker_id::TEXT)
        OR (
          v_ktx_norm <> '' AND v_room_norm <> '' AND v_bed_norm <> ''
          AND public._norm_ktx_text(b.ktx) = v_ktx_norm
          AND (v_day_norm = '' OR public._norm_day_text(b.day) = v_day_norm)
          AND public._norm_room_text(b.phong_so) = v_room_norm
          AND public._norm_bed_text(b.giuong) = v_bed_norm
        )
      )
    RETURNING b.id::TEXT AS bid
  )
  SELECT ARRAY_AGG(bid) INTO v_released_beds FROM upd;

  -- Mark registration as approved
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
