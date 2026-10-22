-- Migration: Create workers table for KTX Manager
-- Timestamp: 20260912150000
-- IMPORTANT: Run this SQL in your Supabase Dashboard > SQL Editor to create the workers table.

-- Create workers table
CREATE TABLE IF NOT EXISTS public.workers (
  id TEXT PRIMARY KEY,
  stt INTEGER DEFAULT 0,
  ho_va_ten TEXT NOT NULL DEFAULT '',
  ma_nv TEXT DEFAULT '',
  tieu_doan TEXT DEFAULT '',
  ktx TEXT DEFAULT '',
  don_vi TEXT DEFAULT '',
  gioi_tinh TEXT DEFAULT '',
  ngay_sinh TEXT DEFAULT '',
  so_dien_thoai TEXT DEFAULT '',
  day TEXT DEFAULT '',
  phong_so TEXT DEFAULT '',
  giuong TEXT DEFAULT '',
  cccd TEXT DEFAULT '',
  ho_khau_tinh TEXT DEFAULT '',
  to_truong TEXT DEFAULT '',
  sdt_to_truong TEXT DEFAULT '',
  ngay_vao_ktx TEXT DEFAULT '',
  ngay_ra_ktx TEXT DEFAULT '',
  ghi_chu TEXT DEFAULT '',
  khoa_tra_cuu TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  tam_tru_status TEXT DEFAULT 'unregistered',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_workers_day ON public.workers(day);
CREATE INDEX IF NOT EXISTS idx_workers_phong_so ON public.workers(phong_so);
CREATE INDEX IF NOT EXISTS idx_workers_ma_nv ON public.workers(ma_nv);
CREATE INDEX IF NOT EXISTS idx_workers_ho_va_ten ON public.workers(ho_va_ten);
CREATE INDEX IF NOT EXISTS idx_workers_stt ON public.workers(stt);

-- Enable RLS
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

-- Open access policy (app uses custom auth, not Supabase auth)
DROP POLICY IF EXISTS "open_access_workers" ON public.workers;
CREATE POLICY "open_access_workers"
  ON public.workers
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_workers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS workers_updated_at_trigger ON public.workers;
CREATE TRIGGER workers_updated_at_trigger
  BEFORE UPDATE ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_workers_updated_at();
