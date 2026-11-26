-- Migration: Bed Reservations (Giữ chỗ giường trước cho đoàn sắp vào)
-- Timestamp: 20261201000000
-- Safe standalone table: does not alter `beds.status` CHECK constraint or existing bed triggers.

CREATE TABLE IF NOT EXISTS public.bed_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL,
  day TEXT NOT NULL,
  phong_so TEXT NOT NULL,
  giuong TEXT NOT NULL,
  group_name TEXT NOT NULL,
  expected_date DATE NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled')),
  created_by TEXT DEFAULT '',
  fulfilled_worker_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bed_reservations_status_date
  ON public.bed_reservations (status, expected_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bed_reservations_active_slot
  ON public.bed_reservations (ktx, day, phong_so, giuong)
  WHERE status = 'active';

ALTER TABLE public.bed_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bed_reservations_select_auth" ON public.bed_reservations;
CREATE POLICY "bed_reservations_select_auth"
  ON public.bed_reservations
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "bed_reservations_write_staff" ON public.bed_reservations;
CREATE POLICY "bed_reservations_write_staff"
  ON public.bed_reservations
  FOR ALL
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
