-- Migration: Super Admin flexible audit log cleanup & selective deletion RPCs
-- Timestamp: 20261127000000
--
-- Security model:
--   - public.audit_logs keeps strict append-only RLS (no direct client DELETE policy).
--   - Deletion is ONLY permitted through these SECURITY DEFINER RPCs, which strictly
--     verify public.profiles.role = 'super_admin' for auth.uid().
--   - WORKER_HARD_DELETE deletion tombstones are preserved by default unless the
--     Super Admin explicitly passes p_include_hard_delete := true (e.g. full Go-Live reset).

-- ─── 1. Ensure audit_logs is in supabase_realtime publication ──────────────
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'audit_logs'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
  END IF;
END
$$;

-- ─── 2. Delete selected or filtered audit log rows by ID array ─────────────
CREATE OR REPLACE FUNCTION public.delete_audit_logs_by_ids(
  p_ids text[],
  p_include_hard_delete boolean DEFAULT false,
  p_record_audit boolean DEFAULT false
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
  deleted_count integer := 0;
  skipped_hard_delete integer := 0;
BEGIN
  SELECT role, full_name, email
    INTO caller_role, caller_name, caller_email
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền xóa nhật ký hệ thống.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('deleted_count', 0, 'skipped_hard_delete', 0);
  END IF;

  IF NOT p_include_hard_delete THEN
    SELECT COUNT(*)
      INTO skipped_hard_delete
    FROM public.audit_logs
    WHERE id::text = ANY(p_ids)
      AND action = 'WORKER_HARD_DELETE';
  END IF;

  DELETE FROM public.audit_logs
  WHERE id::text = ANY(p_ids)
    AND (p_include_hard_delete OR action <> 'WORKER_HARD_DELETE');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF p_record_audit AND deleted_count > 0 THEN
    INSERT INTO public.audit_logs ("timestamp", account, action, detail)
    VALUES (
      now(),
      COALESCE(NULLIF(trim(caller_name), ''), NULLIF(trim(caller_email), ''), 'Super Admin'),
      'AUDIT_ARCHIVE_PURGE',
      format(
        'Đã xóa chọn lọc %s bản ghi nhật ký hệ thống%s.',
        deleted_count,
        CASE
          WHEN p_include_hard_delete THEN ' (bao gồm bản ghi xác minh xóa triệt để)'
          WHEN skipped_hard_delete > 0 THEN format(' (giữ nguyên %s bản ghi WORKER_HARD_DELETE)', skipped_hard_delete)
          ELSE ''
        END
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'deleted_count', deleted_count,
    'skipped_hard_delete', skipped_hard_delete
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_audit_logs_by_ids(text[], boolean, boolean) TO authenticated;

-- ─── 3. Flexible purge / full clean reset RPC ──────────────────────────────
-- p_days = 0  -> Delete ALL audit logs (Full Clean Reset for Go-Live)
-- p_days > 0  -> Delete audit logs older than p_days days (7 / 30 / 90 / 180 / 365)
CREATE OR REPLACE FUNCTION public.purge_audit_logs_flexible(
  p_days integer DEFAULT 90,
  p_include_hard_delete boolean DEFAULT false,
  p_leave_empty boolean DEFAULT false
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
  safe_days integer := GREATEST(0, COALESCE(p_days, 90));
  cutoff_ts timestamptz;
  deleted_count integer := 0;
BEGIN
  SELECT role, full_name, email
    INTO caller_role, caller_name, caller_email
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền dọn hoặc làm mới nhật ký hệ thống.';
  END IF;

  IF safe_days = 0 THEN
    DELETE FROM public.audit_logs
    WHERE p_include_hard_delete OR action <> 'WORKER_HARD_DELETE';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    cutoff_ts := now();
  ELSE
    cutoff_ts := now() - make_interval(days => safe_days);
    DELETE FROM public.audit_logs
    WHERE "timestamp" < cutoff_ts
      AND (p_include_hard_delete OR action <> 'WORKER_HARD_DELETE')
      AND action <> 'AUDIT_ARCHIVE_PURGE';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  END IF;

  IF NOT p_leave_empty THEN
    INSERT INTO public.audit_logs ("timestamp", account, action, detail)
    VALUES (
      now(),
      COALESCE(NULLIF(trim(caller_name), ''), NULLIF(trim(caller_email), ''), 'Super Admin'),
      'AUDIT_ARCHIVE_PURGE',
      CASE
        WHEN safe_days = 0 THEN
          format(
            'Đã làm mới sạch toàn bộ %s bản ghi nhật ký hệ thống%s.',
            deleted_count,
            CASE WHEN p_include_hard_delete THEN ' (xóa trắng 100%)' ELSE ' (giữ nguyên WORKER_HARD_DELETE)' END
          )
        ELSE
          format(
            'Đã lưu trữ và dọn %s bản ghi nhật ký cũ hơn %s ngày (trước %s)%s.',
            deleted_count,
            safe_days,
            to_char(cutoff_ts AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'),
            CASE WHEN p_include_hard_delete THEN ' (bao gồm WORKER_HARD_DELETE)' ELSE ' (giữ nguyên WORKER_HARD_DELETE)' END
          )
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'deleted_count', deleted_count,
    'days', safe_days,
    'include_hard_delete', p_include_hard_delete,
    'leave_empty', p_leave_empty,
    'cutoff', cutoff_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_audit_logs_flexible(integer, boolean, boolean) TO authenticated;
