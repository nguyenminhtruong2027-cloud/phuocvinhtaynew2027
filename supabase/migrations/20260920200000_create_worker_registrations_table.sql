-- Worker Registrations table for public QR portal
CREATE TABLE IF NOT EXISTS public.worker_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ho_va_ten TEXT NOT NULL DEFAULT '',
  so_cccd TEXT NOT NULL DEFAULT '',
  so_dien_thoai TEXT NOT NULL DEFAULT '',
  ngay_sinh TEXT NOT NULL DEFAULT '',
  que_quan TEXT NOT NULL DEFAULT '',
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  cccd_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_registrations_status ON public.worker_registrations(status);
CREATE INDEX IF NOT EXISTS idx_worker_registrations_created_at ON public.worker_registrations(created_at DESC);

ALTER TABLE public.worker_registrations ENABLE ROW LEVEL SECURITY;

-- Allow anyone (public) to INSERT (submit registration)
DROP POLICY IF EXISTS "public_can_submit_registration" ON public.worker_registrations;
CREATE POLICY "public_can_submit_registration"
  ON public.worker_registrations
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Authenticated users (admin/staff) can read all registrations
DROP POLICY IF EXISTS "authenticated_can_read_registrations" ON public.worker_registrations;
CREATE POLICY "authenticated_can_read_registrations"
  ON public.worker_registrations
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can update (approve/reject)
DROP POLICY IF EXISTS "authenticated_can_update_registrations" ON public.worker_registrations;
CREATE POLICY "authenticated_can_update_registrations"
  ON public.worker_registrations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can delete
DROP POLICY IF EXISTS "authenticated_can_delete_registrations" ON public.worker_registrations;
CREATE POLICY "authenticated_can_delete_registrations"
  ON public.worker_registrations
  FOR DELETE
  TO authenticated
  USING (true);
