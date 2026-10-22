-- Add new fields to worker_registrations to match workers table columns
ALTER TABLE public.worker_registrations
  ADD COLUMN IF NOT EXISTS ma_nv TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS gioi_tinh TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS don_vi TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS tieu_doan TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS to_truong TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS sdt_to_truong TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ho_khau_tinh TEXT DEFAULT '';
