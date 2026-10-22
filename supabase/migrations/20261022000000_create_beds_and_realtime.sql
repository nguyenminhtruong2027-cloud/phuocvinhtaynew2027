-- Migration: create beds table + relational integrity trigger + realtime publication
-- Timestamp: 20261022000000

-- ─── 1. beds table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  phong_so TEXT NOT NULL DEFAULT '',
  giuong TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'occupied')),
  ma_nv TEXT,
  ho_va_ten TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ktx, day, phong_so, giuong)
);

CREATE INDEX IF NOT EXISTS idx_beds_ktx_day_phong ON public.beds(ktx, day, phong_so);
CREATE INDEX IF NOT EXISTS idx_beds_status ON public.beds(status);

ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_beds" ON public.beds;
CREATE POLICY "public_all_beds"
  ON public.beds
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 2. Seed beds from facilities ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_beds_from_facilities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  f record;
  b integer;
  created integer := 0;
  room_key text;
BEGIN
  FOR f IN
    SELECT ktx, day, phong_khu_vuc, giuong
    FROM public.facilities
    WHERE coalesce(giuong, 0) > 0
  LOOP
    room_key := trim(regexp_replace(coalesce(f.phong_khu_vuc, ''), '^Phòng\s*', '', 'i'));
    IF room_key = '' THEN
      room_key := coalesce(f.phong_khu_vuc, '');
    END IF;

    FOR b IN 1..f.giuong LOOP
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status)
      VALUES (f.ktx, f.day, room_key, b::text, 'empty')
      ON CONFLICT (ktx, day, phong_so, giuong) DO NOTHING;
      created := created + 1;
    END LOOP;
  END LOOP;

  RETURN created;
END;
$$;

-- ─── 3. Trigger to maintain beds from workers ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_bed_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_ktx text;
  old_day text;
  old_phong text;
  old_giuong text;
  new_ktx text;
  new_day text;
  new_phong text;
  new_giuong text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_ktx := coalesce(OLD.ktx, '');
    old_day := coalesce(OLD.day, '');
    old_phong := coalesce(OLD.phong_so, '');
    old_giuong := coalesce(OLD.giuong, '');

    IF old_ktx <> '' AND old_phong <> '' AND old_giuong <> '' THEN
      UPDATE public.beds
      SET status = 'empty',
          ma_nv = NULL,
          ho_va_ten = NULL,
          worker_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE ktx = old_ktx
        AND day = old_day
        AND phong_so = old_phong
        AND giuong = old_giuong;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_ktx := coalesce(NEW.ktx, '');
    new_day := coalesce(NEW.day, '');
    new_phong := coalesce(NEW.phong_so, '');
    new_giuong := coalesce(NEW.giuong, '');

    IF new_ktx <> '' AND new_phong <> '' AND new_giuong <> '' THEN
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten, worker_id)
      VALUES (new_ktx, new_day, new_phong, new_giuong, 'occupied', NEW.ma_nv, NEW.ho_va_ten, NEW.id)
      ON CONFLICT (ktx, day, phong_so, giuong)
      DO UPDATE SET status = 'occupied',
                    ma_nv = EXCLUDED.ma_nv,
                    ho_va_ten = EXCLUDED.ho_va_ten,
                    worker_id = EXCLUDED.worker_id,
                    updated_at = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_ktx := coalesce(OLD.ktx, '');
    old_day := coalesce(OLD.day, '');
    old_phong := coalesce(OLD.phong_so, '');
    old_giuong := coalesce(OLD.giuong, '');
    new_ktx := coalesce(NEW.ktx, '');
    new_day := coalesce(NEW.day, '');
    new_phong := coalesce(NEW.phong_so, '');
    new_giuong := coalesce(NEW.giuong, '');

    -- Clear old bed only when the location actually changed.
    IF (old_ktx, old_day, old_phong, old_giuong) IS DISTINCT FROM (new_ktx, new_day, new_phong, new_giuong) THEN
      IF old_ktx <> '' AND old_phong <> '' AND old_giuong <> '' THEN
        UPDATE public.beds
        SET status = 'empty',
            ma_nv = NULL,
            ho_va_ten = NULL,
            worker_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE ktx = old_ktx
          AND day = old_day
          AND phong_so = old_phong
          AND giuong = old_giuong;
      END IF;
    END IF;

    -- Upsert the new bed.
    IF new_ktx <> '' AND new_phong <> '' AND new_giuong <> '' THEN
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten, worker_id)
      VALUES (new_ktx, new_day, new_phong, new_giuong, 'occupied', NEW.ma_nv, NEW.ho_va_ten, NEW.id)
      ON CONFLICT (ktx, day, phong_so, giuong)
      DO UPDATE SET status = 'occupied',
                    ma_nv = EXCLUDED.ma_nv,
                    ho_va_ten = EXCLUDED.ho_va_ten,
                    worker_id = EXCLUDED.worker_id,
                    updated_at = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS workers_bed_sync_trigger ON public.workers;
CREATE TRIGGER workers_bed_sync_trigger
  AFTER INSERT OR UPDATE OF ktx, day, phong_so, giuong, ma_nv, ho_va_ten OR DELETE
  ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_bed_occupancy();

-- ─── 4. Add missing tables to the supabase_realtime publication ────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'beds') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.beds;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'facilities') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.facilities;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_units') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_units;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'worker_registrations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_registrations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'checkout_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checkout_requests;
  END IF;
END
$$;
