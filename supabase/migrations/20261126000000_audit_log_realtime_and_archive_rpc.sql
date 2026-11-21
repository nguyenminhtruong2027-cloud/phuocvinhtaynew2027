-- Migration: Enable Supabase Realtime for audit_logs + secure Super Admin archive/purge RPC
-- Timestamp: 20261126000000

-- ─── 1. Add audit_logs to supabase_realtime publication (idempotent) ───────
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

-- ─── 2. Super Admin secure purge RPC for archived old audit logs ───────────
-- Preserves all WORKER_HARD_DELETE tombstones (needed for deletion integrity)
-- and enforces minimum 30-day retention + super_admin role check.
CREATE OR REPLACE FUNCTION public.purge_old_audit_logs(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  caller_name text;
  caller_email text;
  safe_days integer;
  cutoff_ts timestamptz;
  deleted_count integer := 0;
BEGIN
  SELECT role, full_name, email
    INTO caller_role, caller_name, caller_email
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Chỉ Quản trị tối cao (Super Admin) mới có quyền dọn nhật ký cũ.';
  END IF;

  safe_days := GREATEST(30, COALESCE(p_days, 90));
  cutoff_ts := now() - make_interval(days => safe_days);

  DELETE FROM public.audit_logs
  WHERE "timestamp" < cutoff_ts
    AND action <> 'WORKER_HARD_DELETE'
    AND action <> 'AUDIT_ARCHIVE_PURGE';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  INSERT INTO public.audit_logs ("timestamp", account, action, detail)
  VALUES (
    now(),
    COALESCE(NULLIF(trim(caller_name), ''), NULLIF(trim(caller_email), ''), 'Super Admin'),
    'AUDIT_ARCHIVE_PURGE',
    format(
      'Đã sao lưu và dọn %s bản ghi nhật ký cũ hơn %s ngày (trước %s). Các bản ghi xác minh xóa triệt để (WORKER_HARD_DELETE) được giữ nguyên.',
      deleted_count,
      safe_days,
      to_char(cutoff_ts AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
    )
  );

  RETURN jsonb_build_object(
    'deleted_count', deleted_count,
    'days', safe_days,
    'cutoff', cutoff_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_old_audit_logs(integer) TO authenticated;
