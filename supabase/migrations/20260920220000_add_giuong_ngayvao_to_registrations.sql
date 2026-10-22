-- Add giuong and ngay_vao_ktx fields to worker_registrations to fully match workers table
ALTER TABLE public.worker_registrations
  ADD COLUMN IF NOT EXISTS giuong TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ngay_vao_ktx TEXT DEFAULT '';
