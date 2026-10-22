-- Migration: auto-seed beds whenever a facilities row is created/updated
-- Timestamp: 20261023000000

CREATE OR REPLACE FUNCTION public.seed_beds_for_facility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  b integer;
  room_key text;
BEGIN
  room_key := trim(regexp_replace(coalesce(NEW.phong_khu_vuc, ''), '^Phòng\s*', '', 'i'));
  IF room_key = '' THEN
    room_key := coalesce(NEW.phong_khu_vuc, '');
  END IF;

  FOR b IN 1..coalesce(NEW.giuong, 0) LOOP
    INSERT INTO public.beds (ktx, day, phong_so, giuong, status)
    VALUES (NEW.ktx, NEW.day, room_key, b::text, 'empty')
    ON CONFLICT (ktx, day, phong_so, giuong) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_seed_beds_trigger ON public.facilities;
CREATE TRIGGER facilities_seed_beds_trigger
  AFTER INSERT OR UPDATE OF ktx, day, phong_khu_vuc, giuong
  ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_beds_for_facility();
