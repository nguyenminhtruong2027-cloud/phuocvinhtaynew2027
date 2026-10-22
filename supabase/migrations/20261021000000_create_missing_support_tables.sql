-- Migration: Create support tables referenced by the app but missing from the schema
-- Timestamp: 20261021000000
-- Run this SQL in Supabase Dashboard > SQL Editor (or via `supabase db push`).

-- ─── 1. worker_deletion_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT,
  ho_va_ten TEXT,
  ma_nv TEXT,
  ktx TEXT,
  day TEXT,
  deleted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_deletion_log_deleted_at
  ON public.worker_deletion_log(deleted_at DESC);

ALTER TABLE public.worker_deletion_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_worker_deletion_log" ON public.worker_deletion_log;
CREATE POLICY "public_all_worker_deletion_log"
  ON public.worker_deletion_log
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 2. attendance_sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date TEXT NOT NULL DEFAULT '',
  opened_by TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  zone_ktx TEXT NOT NULL DEFAULT '',
  zone_day TEXT NOT NULL DEFAULT '',
  zone_phong TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_date, zone_ktx, zone_day, zone_phong)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date
  ON public.attendance_sessions(session_date);

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_attendance_sessions" ON public.attendance_sessions;
CREATE POLICY "public_all_attendance_sessions"
  ON public.attendance_sessions
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 3. attendance_records ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL DEFAULT '',
  ma_nv TEXT NOT NULL DEFAULT '',
  ho_va_ten TEXT NOT NULL DEFAULT '',
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'present',
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  ghi_chu TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, ma_nv)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session
  ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_ma_nv
  ON public.attendance_records(ma_nv);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status
  ON public.attendance_records(status);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_attendance_records" ON public.attendance_records;
CREATE POLICY "public_all_attendance_records"
  ON public.attendance_records
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 4. checkout_requests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkout_requests (
  id TEXT PRIMARY KEY,
  worker_id TEXT,
  ho_va_ten TEXT NOT NULL DEFAULT '',
  ma_nv TEXT NOT NULL DEFAULT '',
  so_cccd TEXT NOT NULL DEFAULT '',
  so_dien_thoai TEXT NOT NULL DEFAULT '',
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  giuong TEXT,
  ly_do TEXT NOT NULL DEFAULT '',
  ngay_don_ra TEXT NOT NULL DEFAULT '',
  ghi_chu TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checkout_requests_status
  ON public.checkout_requests(status);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_created_at
  ON public.checkout_requests(created_at DESC);

ALTER TABLE public.checkout_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_checkout_requests" ON public.checkout_requests;
CREATE POLICY "public_all_checkout_requests"
  ON public.checkout_requests
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 5. room_units ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.room_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL DEFAULT '',
  day_nha TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  unit TEXT,
  room_note TEXT,
  room_label TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ktx, day_nha, phong_so)
);

CREATE INDEX IF NOT EXISTS idx_room_units_ktx_day_nha_phong
  ON public.room_units(ktx, day_nha, phong_so);

ALTER TABLE public.room_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_room_units" ON public.room_units;
CREATE POLICY "public_all_room_units"
  ON public.room_units
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 6. duty_assignments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_date TEXT NOT NULL DEFAULT '',
  profile_id TEXT NOT NULL DEFAULT '',
  duty_ktx TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (duty_date, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_duty_assignments_date
  ON public.duty_assignments(duty_date);

ALTER TABLE public.duty_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_duty_assignments" ON public.duty_assignments;
CREATE POLICY "public_all_duty_assignments"
  ON public.duty_assignments
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
