-- Create facilities table for tracking room/area equipment per KTX
CREATE TABLE IF NOT EXISTS public.facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_khu_vuc TEXT NOT NULL DEFAULT '',
  giuong INTEGER NOT NULL DEFAULT 0,
  dieu_hoa INTEGER NOT NULL DEFAULT 0,
  tu INTEGER NOT NULL DEFAULT 0,
  quat INTEGER NOT NULL DEFAULT 0,
  o_cam_dien INTEGER NOT NULL DEFAULT 0,
  remote INTEGER NOT NULL DEFAULT 0,
  bong_tuyp INTEGER NOT NULL DEFAULT 0,
  ban_an INTEGER NOT NULL DEFAULT 0,
  ghe_an INTEGER NOT NULL DEFAULT 0,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_facilities_ktx ON public.facilities(ktx);
CREATE INDEX IF NOT EXISTS idx_facilities_day ON public.facilities(day);
CREATE INDEX IF NOT EXISTS idx_facilities_phong ON public.facilities(phong_khu_vuc);

-- Enable RLS
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

-- RLS Policies: authenticated users can read and write
DROP POLICY IF EXISTS "authenticated_read_facilities" ON public.facilities;
CREATE POLICY "authenticated_read_facilities"
ON public.facilities FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "authenticated_insert_facilities" ON public.facilities;
CREATE POLICY "authenticated_insert_facilities"
ON public.facilities FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_update_facilities" ON public.facilities;
CREATE POLICY "authenticated_update_facilities"
ON public.facilities FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_delete_facilities" ON public.facilities;
CREATE POLICY "authenticated_delete_facilities"
ON public.facilities FOR DELETE
TO authenticated
USING (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_facilities_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_updated_at ON public.facilities;
CREATE TRIGGER facilities_updated_at
  BEFORE UPDATE ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_facilities_updated_at();

-- Sample data for KTX 1
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.facilities LIMIT 1) THEN
    INSERT INTO public.facilities (ktx, day, phong_khu_vuc, giuong, dieu_hoa, tu, quat, o_cam_dien, remote, bong_tuyp, ban_an, ghe_an) VALUES
      ('KTX 1', 'Dãy A', 'Phòng A101', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy A', 'Phòng A102', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy A', 'Phòng A103', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy B', 'Phòng B101', 10, 2, 10, 5, 10, 2, 5, 2, 10),
      ('KTX 1', 'Dãy B', 'Phòng B102', 10, 2, 10, 5, 10, 2, 5, 2, 10),
      ('KTX 1', 'Dãy B', 'Phòng B103', 10, 2, 10, 5, 10, 2, 5, 2, 10),
      ('KTX 1', 'Dãy C', 'Phòng C101', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 1', 'Dãy C', 'Phòng C102', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 2', 'Dãy D', 'Phòng D101', 12, 2, 12, 6, 12, 2, 6, 2, 12),
      ('KTX 2', 'Dãy D', 'Phòng D102', 12, 2, 12, 6, 12, 2, 6, 2, 12),
      ('KTX 2', 'Dãy D', 'Phòng D103', 12, 2, 12, 6, 12, 2, 6, 2, 12),
      ('KTX 2', 'Dãy E', 'Phòng E101', 10, 1, 10, 5, 10, 1, 5, 1, 10),
      ('KTX 2', 'Dãy E', 'Phòng E102', 10, 1, 10, 5, 10, 1, 5, 1, 10),
      ('KTX 2', 'Dãy F', 'Phòng F101', 8, 1, 8, 4, 8, 1, 4, 1, 8),
      ('KTX 2', 'Dãy F', 'Phòng F102', 8, 1, 8, 4, 8, 1, 4, 1, 8)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
