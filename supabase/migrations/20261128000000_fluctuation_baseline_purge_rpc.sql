-- Migration: Super Admin RPC to purge pre-Go-Live test fluctuation logs before a chosen Vietnam date
-- Timestamp: 20261128000000
--
-- Security model:
--   - `worker_deletion_log` and `worker_entry_log` keep strict append-only RLS for direct client calls.
--   - Purging historical test rows before Go-Live is ONLY permitted via this SECURITY DEFINER RPC,
--     which strictly verifies `public.profiles.role = 'super_admin'` for `auth.uid()`.
--   - Does NOT touch `workers`, `beds`, `facilities`, or `room_units`.

CREATE OR REPLACE FUNCTION public.purge_fluctuation_logs_before_date(
  p_before_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  caller_name text;
  caller_email text;
  cutoff_ts timestamptz;
  deleted_exits integer := 0;
  deleted_entries integer := 0;
BEGIN
  SELECT role, full_name, email
    INTO caller_role, caller_name, caller_email
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền xóa lịch sử biến động thử nghiệm.';
  END IF;

  IF p_before_date IS NULL THEN
    RAISE EXCEPTION 'Ngày cột mốc không hợp lệ.';
  END IF;

  -- Interpret p_before_date at 00:00:00 Asia/Ho_Chi_Minh (UTC+7)
  cutoff_ts := (p_before_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

  IF to_regclass('public.worker_deletion_log') IS NOT NULL THEN
    DELETE FROM public.worker_deletion_log
    WHERE deleted_at < cutoff_ts;
    GET DIAGNOSTICS deleted_exits = ROW_COUNT;
  END IF;

  IF to_regclass('public.worker_entry_log') IS NOT NULL THEN
    DELETE FROM public.worker_entry_log
    WHERE entered_at < cutoff_ts;
    GET DIAGNOSTICS deleted_entries = ROW_COUNT;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs ("timestamp", account, action, detail)
    VALUES (
      now(),
      COALESCE(NULLIF(trim(caller_name), ''), NULLIF(trim(caller_email), ''), 'Super Admin'),
      'AUDIT_ARCHIVE_PURGE',
      format(
        'Đã dọn dữ liệu biến động thử nghiệm trước cột mốc %s: %s lượt rời khỏi và %s lượt vào ở.',
        to_char(p_before_date, 'DD/MM/YYYY'),
        deleted_exits,
        deleted_entries
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'before_date', p_before_date,
    'cutoff_ts', cutoff_ts,
    'deleted_exits', deleted_exits,
    'deleted_entries', deleted_entries
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_fluctuation_logs_before_date(date) TO authenticated;
