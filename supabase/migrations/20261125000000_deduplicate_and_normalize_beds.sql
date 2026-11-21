-- Migration: Deduplicate public.beds, canonicalize bed/room labels, and enforce canonical uniqueness
-- Timestamp: 20261125000000
--
-- Root cause addressed:
--   1. public.beds had UNIQUE (ktx, day, phong_so, giuong) on raw unnormalized strings.
--   2. Seeded beds used phong_so='1', giuong='1'..'20', while worker registrations/imports
--      could store giuong='G1', 'Giường 1', 'GGiường 1', '01', or phong_so='P.1'/'Phòng 1'.
--   3. sync_bed_occupancy() inserted a separate 21st row on non-matching raw text, causing
--      duplicate G1 slots (21 beds in a 20-bed room).

-- ─── 1. Canonical IMMUTABLE normalization helpers ───────────────────────────
CREATE OR REPLACE FUNCTION public._norm_ktx_compact(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(coalesce(raw, ''), '[\s\-_.]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public._norm_day_key(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := lower(trim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g')));
  prev text := '';
BEGIN
  WHILE v <> prev LOOP
    prev := v;
    v := trim(regexp_replace(v, '^(?:dãy|day|khu|block|d[.\s]*)\s*', '', 'i'));
  END LOOP;
  IF v ~ '^\d+$' THEN
    v := ltrim(v, '0');
    IF v = '' THEN v := '0'; END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public._canonical_room(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := trim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g'));
  prev text := '';
BEGIN
  WHILE v <> prev LOOP
    prev := v;
    v := trim(regexp_replace(v, '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'));
  END LOOP;
  IF v ~ '^\d+$' THEN
    v := ltrim(v, '0');
    IF v = '' THEN v := '0'; END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public._canonical_bed(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := trim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g'));
  prev text := '';
BEGIN
  WHILE v <> prev LOOP
    prev := v;
    v := trim(regexp_replace(v, '^(?:giường|giuong|g[.\s]*)\s*', '', 'i'));
  END LOOP;
  IF v ~ '^\d+$' THEN
    v := ltrim(v, '0');
    IF v = '' THEN v := '0'; END IF;
  END IF;
  RETURN v;
END;
$$;

-- ─── 2. Deduplicate existing rows in public.beds by canonical slot ──────────
-- Keeps the authoritative row per (ktx, day, phong_so, giuong) slot:
--   Priority: occupied > maintenance > has worker_id > canonical text > oldest row.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        public._norm_ktx_compact(ktx),
        public._norm_day_key(day),
        lower(public._canonical_room(phong_so)),
        lower(public._canonical_bed(giuong))
      ORDER BY
        CASE status
          WHEN 'occupied' THEN 0
          WHEN 'maintenance' THEN 1
          ELSE 2
        END ASC,
        CASE WHEN worker_id IS NOT NULL AND trim(worker_id) <> '' THEN 0 ELSE 1 END ASC,
        CASE
          WHEN giuong = public._canonical_bed(giuong)
           AND phong_so = public._canonical_room(phong_so)
          THEN 0
          ELSE 1
        END ASC,
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM public.beds
)
DELETE FROM public.beds b
USING ranked r
WHERE b.id = r.id
  AND r.rn > 1;

-- ─── 3. Canonicalize existing remaining rows in public.beds ─────────────────
UPDATE public.beds
SET
  ktx = trim(regexp_replace(coalesce(ktx, ''), '\s+', ' ', 'g')),
  day = trim(regexp_replace(coalesce(day, ''), '\s+', ' ', 'g')),
  phong_so = public._canonical_room(phong_so),
  giuong = public._canonical_bed(giuong),
  updated_at = CURRENT_TIMESTAMP
WHERE
  ktx IS DISTINCT FROM trim(regexp_replace(coalesce(ktx, ''), '\s+', ' ', 'g'))
  OR day IS DISTINCT FROM trim(regexp_replace(coalesce(day, ''), '\s+', ' ', 'g'))
  OR phong_so IS DISTINCT FROM public._canonical_room(phong_so)
  OR giuong IS DISTINCT FROM public._canonical_bed(giuong);

-- ─── 4. Remove stray empty beds exceeding facility room capacity ────────────
-- Only deletes empty, unlinked beds (never touches occupied or maintenance beds).
WITH facility_caps AS (
  SELECT
    public._norm_ktx_compact(f.ktx) AS ktx_key,
    public._norm_day_key(f.day) AS day_key,
    lower(public._canonical_room(f.phong_khu_vuc)) AS room_key,
    MAX(
      CASE
        WHEN coalesce(to_jsonb(f)->>'room_type', 'accommodation') = 'functional'
          OR coalesce((to_jsonb(f)->>'is_visible')::boolean, true) = false
        THEN 0
        ELSE GREATEST(0, coalesce(f.giuong, 0))
      END
    ) AS cap
  FROM public.facilities f
  GROUP BY 1, 2, 3
)
DELETE FROM public.beds b
USING facility_caps fc
WHERE b.status = 'empty'
  AND (b.worker_id IS NULL OR trim(b.worker_id) = '')
  AND public._norm_ktx_compact(b.ktx) = fc.ktx_key
  AND public._norm_day_key(b.day) = fc.day_key
  AND lower(public._canonical_room(b.phong_so)) = fc.room_key
  AND (
    fc.cap = 0
    OR (b.giuong ~ '^\d+$' AND b.giuong::integer > fc.cap)
  );

-- ─── 5. Enforce canonical normalization on every INSERT/UPDATE to beds ──────
CREATE OR REPLACE FUNCTION public.beds_normalize_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.ktx := trim(regexp_replace(coalesce(NEW.ktx, ''), '\s+', ' ', 'g'));
  NEW.day := trim(regexp_replace(coalesce(NEW.day, ''), '\s+', ' ', 'g'));
  NEW.phong_so := public._canonical_room(NEW.phong_so);
  NEW.giuong := public._canonical_bed(NEW.giuong);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS beds_normalize_before_write_trigger ON public.beds;
CREATE TRIGGER beds_normalize_before_write_trigger
  BEFORE INSERT OR UPDATE OF ktx, day, phong_so, giuong
  ON public.beds
  FOR EACH ROW
  EXECUTE FUNCTION public.beds_normalize_before_write();

-- Functional UNIQUE INDEX physically prevents duplicate slots regardless of formatting/case
CREATE UNIQUE INDEX IF NOT EXISTS idx_beds_canonical_slot_unique
  ON public.beds (
    public._norm_ktx_compact(ktx),
    public._norm_day_key(day),
    lower(public._canonical_room(phong_so)),
    lower(public._canonical_bed(giuong))
  );

-- ─── 6. Upgrade sync_bed_occupancy() to match & update canonical slots ──────
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
  slot_exists boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_ktx := trim(regexp_replace(coalesce(OLD.ktx, ''), '\s+', ' ', 'g'));
    old_day := trim(regexp_replace(coalesce(OLD.day, ''), '\s+', ' ', 'g'));
    old_phong := public._canonical_room(OLD.phong_so);
    old_giuong := public._canonical_bed(OLD.giuong);

    UPDATE public.beds
    SET status = 'empty',
        ma_nv = NULL,
        ho_va_ten = NULL,
        worker_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE status <> 'maintenance'
      AND (
        worker_id = OLD.id::text
        OR (
          old_ktx <> '' AND old_phong <> '' AND old_giuong <> ''
          AND public._norm_ktx_compact(ktx) = public._norm_ktx_compact(old_ktx)
          AND public._norm_day_key(day) = public._norm_day_key(old_day)
          AND lower(public._canonical_room(phong_so)) = lower(old_phong)
          AND lower(public._canonical_bed(giuong)) = lower(old_giuong)
        )
      );

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_ktx := trim(regexp_replace(coalesce(OLD.ktx, ''), '\s+', ' ', 'g'));
    old_day := trim(regexp_replace(coalesce(OLD.day, ''), '\s+', ' ', 'g'));
    old_phong := public._canonical_room(OLD.phong_so);
    old_giuong := public._canonical_bed(OLD.giuong);

    new_ktx := trim(regexp_replace(coalesce(NEW.ktx, ''), '\s+', ' ', 'g'));
    new_day := trim(regexp_replace(coalesce(NEW.day, ''), '\s+', ' ', 'g'));
    new_phong := public._canonical_room(NEW.phong_so);
    new_giuong := public._canonical_bed(NEW.giuong);

    IF (
      public._norm_ktx_compact(old_ktx),
      public._norm_day_key(old_day),
      lower(old_phong),
      lower(old_giuong)
    ) IS DISTINCT FROM (
      public._norm_ktx_compact(new_ktx),
      public._norm_day_key(new_day),
      lower(new_phong),
      lower(new_giuong)
    ) THEN
      UPDATE public.beds
      SET status = 'empty',
          ma_nv = NULL,
          ho_va_ten = NULL,
          worker_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status <> 'maintenance'
        AND (
          worker_id = OLD.id::text
          OR (
            old_ktx <> '' AND old_phong <> '' AND old_giuong <> ''
            AND public._norm_ktx_compact(ktx) = public._norm_ktx_compact(old_ktx)
            AND public._norm_day_key(day) = public._norm_day_key(old_day)
            AND lower(public._canonical_room(phong_so)) = lower(old_phong)
            AND lower(public._canonical_bed(giuong)) = lower(old_giuong)
          )
        );
    END IF;
  ELSE
    -- TG_OP = 'INSERT'
    new_ktx := trim(regexp_replace(coalesce(NEW.ktx, ''), '\s+', ' ', 'g'));
    new_day := trim(regexp_replace(coalesce(NEW.day, ''), '\s+', ' ', 'g'));
    new_phong := public._canonical_room(NEW.phong_so);
    new_giuong := public._canonical_bed(NEW.giuong);
  END IF;

  IF new_ktx <> '' AND new_phong <> '' AND new_giuong <> '' THEN
    -- Update existing canonical bed slot first (never creates a duplicate row)
    UPDATE public.beds
    SET status = 'occupied',
        ma_nv = NEW.ma_nv,
        ho_va_ten = NEW.ho_va_ten,
        worker_id = NEW.id::text,
        updated_at = CURRENT_TIMESTAMP
    WHERE status <> 'maintenance'
      AND public._norm_ktx_compact(ktx) = public._norm_ktx_compact(new_ktx)
      AND public._norm_day_key(day) = public._norm_day_key(new_day)
      AND lower(public._canonical_room(phong_so)) = lower(new_phong)
      AND lower(public._canonical_bed(giuong)) = lower(new_giuong);

    IF NOT FOUND THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.beds
        WHERE public._norm_ktx_compact(ktx) = public._norm_ktx_compact(new_ktx)
          AND public._norm_day_key(day) = public._norm_day_key(new_day)
          AND lower(public._canonical_room(phong_so)) = lower(new_phong)
          AND lower(public._canonical_bed(giuong)) = lower(new_giuong)
      ) INTO slot_exists;

      IF NOT slot_exists THEN
        BEGIN
          INSERT INTO public.beds (ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten, worker_id)
          VALUES (new_ktx, new_day, new_phong, new_giuong, 'occupied', NEW.ma_nv, NEW.ho_va_ten, NEW.id::text)
          ON CONFLICT (ktx, day, phong_so, giuong)
          DO UPDATE SET status = 'occupied',
                        ma_nv = EXCLUDED.ma_nv,
                        ho_va_ten = EXCLUDED.ho_va_ten,
                        worker_id = EXCLUDED.worker_id,
                        updated_at = CURRENT_TIMESTAMP;
        EXCEPTION WHEN unique_violation THEN
          UPDATE public.beds
          SET status = 'occupied',
              ma_nv = NEW.ma_nv,
              ho_va_ten = NEW.ho_va_ten,
              worker_id = NEW.id::text,
              updated_at = CURRENT_TIMESTAMP
          WHERE status <> 'maintenance'
            AND public._norm_ktx_compact(ktx) = public._norm_ktx_compact(new_ktx)
            AND public._norm_day_key(day) = public._norm_day_key(new_day)
            AND lower(public._canonical_room(phong_so)) = lower(new_phong)
            AND lower(public._canonical_bed(giuong)) = lower(new_giuong);
        END;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 7. Upgrade facility bed seeding functions to canonical labels ──────────
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
  ktx_val text;
  day_val text;
BEGIN
  FOR f IN
    SELECT ktx, day, phong_khu_vuc, giuong
    FROM public.facilities
    WHERE coalesce(giuong, 0) > 0
      AND coalesce(to_jsonb(facilities)->>'room_type', 'accommodation') <> 'functional'
      AND coalesce((to_jsonb(facilities)->>'is_visible')::boolean, true) = true
  LOOP
    ktx_val := trim(regexp_replace(coalesce(f.ktx, ''), '\s+', ' ', 'g'));
    day_val := trim(regexp_replace(coalesce(f.day, ''), '\s+', ' ', 'g'));
    room_key := public._canonical_room(f.phong_khu_vuc);
    IF room_key = '' THEN
      room_key := trim(coalesce(f.phong_khu_vuc, ''));
    END IF;

    FOR b IN 1..f.giuong LOOP
      BEGIN
        INSERT INTO public.beds (ktx, day, phong_so, giuong, status)
        VALUES (ktx_val, day_val, room_key, b::text, 'empty')
        ON CONFLICT DO NOTHING;
        created := created + 1;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_beds_for_facility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  b integer;
  room_key text;
  ktx_val text;
  day_val text;
BEGIN
  IF coalesce(NEW.giuong, 0) <= 0
     OR coalesce(to_jsonb(NEW)->>'room_type', 'accommodation') = 'functional'
     OR coalesce((to_jsonb(NEW)->>'is_visible')::boolean, true) = false THEN
    RETURN NEW;
  END IF;

  ktx_val := trim(regexp_replace(coalesce(NEW.ktx, ''), '\s+', ' ', 'g'));
  day_val := trim(regexp_replace(coalesce(NEW.day, ''), '\s+', ' ', 'g'));
  room_key := public._canonical_room(NEW.phong_khu_vuc);
  IF room_key = '' THEN
    room_key := trim(coalesce(NEW.phong_khu_vuc, ''));
  END IF;

  FOR b IN 1..NEW.giuong LOOP
    BEGIN
      INSERT INTO public.beds (ktx, day, phong_so, giuong, status)
      VALUES (ktx_val, day_val, room_key, b::text, 'empty')
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ─── 8. Verification query (expected: 0 duplicate bed slots) ─────────────────
SELECT
  COUNT(*) AS duplicate_bed_slots_remaining
FROM (
  SELECT
    public._norm_ktx_compact(ktx),
    public._norm_day_key(day),
    lower(public._canonical_room(phong_so)),
    lower(public._canonical_bed(giuong))
  FROM public.beds
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
) dup;
