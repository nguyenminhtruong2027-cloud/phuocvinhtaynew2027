-- Migration: Normalize sync_bed_occupancy trigger and bed release matching
-- Timestamp: 20261119000000

CREATE OR REPLACE FUNCTION public.sync_bed_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_ktx text;
  old_day text;
  old_phong_norm text;
  old_giuong_norm text;
  new_ktx text;
  new_day text;
  new_phong text;
  new_phong_norm text;
  new_giuong text;
  new_giuong_norm text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_ktx := trim(coalesce(OLD.ktx, ''));
    old_day := trim(coalesce(OLD.day, ''));
    old_phong_norm := lower(trim(regexp_replace(coalesce(OLD.phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i')));
    old_giuong_norm := lower(trim(regexp_replace(coalesce(OLD.giuong, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i')));

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
          old_ktx <> '' AND old_phong_norm <> '' AND old_giuong_norm <> ''
          AND trim(ktx) = old_ktx
          AND trim(day) = old_day
          AND lower(trim(regexp_replace(coalesce(phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'))) = old_phong_norm
          AND lower(trim(regexp_replace(coalesce(giuong, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i'))) = old_giuong_norm
        )
      );

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_ktx := trim(coalesce(NEW.ktx, ''));
    new_day := trim(coalesce(NEW.day, ''));
    new_phong := trim(regexp_replace(coalesce(NEW.phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'));
    new_giuong := trim(regexp_replace(coalesce(NEW.giuong, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i'));

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
    old_ktx := trim(coalesce(OLD.ktx, ''));
    old_day := trim(coalesce(OLD.day, ''));
    old_phong_norm := lower(trim(regexp_replace(coalesce(OLD.phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i')));
    old_giuong_norm := lower(trim(regexp_replace(coalesce(OLD.giuong, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i')));

    new_ktx := trim(coalesce(NEW.ktx, ''));
    new_day := trim(coalesce(NEW.day, ''));
    new_phong := trim(regexp_replace(coalesce(NEW.phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'));
    new_phong_norm := lower(new_phong);
    new_giuong := trim(regexp_replace(coalesce(NEW.giuong, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i'));
    new_giuong_norm := lower(new_giuong);

    IF (old_ktx, old_day, old_phong_norm, old_giuong_norm) IS DISTINCT FROM (new_ktx, new_day, new_phong_norm, new_giuong_norm) THEN
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
            old_ktx <> '' AND old_phong_norm <> '' AND old_giuong_norm <> ''
            AND trim(ktx) = old_ktx
            AND trim(day) = old_day
            AND lower(trim(regexp_replace(coalesce(phong_so, ''), '^(?:phòng|phong|p[.\s]*)\s*', '', 'i'))) = old_phong_norm
            AND lower(trim(regexp_replace(coalesce(giuong, ''), '^(?:giường|giuong|g[.\s]*)\s*', '', 'i'))) = old_giuong_norm
          )
        );
    END IF;

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
