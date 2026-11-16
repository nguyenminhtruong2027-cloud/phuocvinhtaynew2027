-- Migration: Create worker_entry_log table & automatic AFTER INSERT trigger on workers
-- Ensures multi-device permanent historical tracking of daily worker check-ins ("Vào")
-- even if a worker is later hard-deleted from `workers`.

CREATE TABLE IF NOT EXISTS public.worker_entry_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  ho_va_ten TEXT,
  ma_nv TEXT,
  ktx TEXT,
  day TEXT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_entry_log_entered_at
  ON public.worker_entry_log(entered_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_entry_log_worker_id
  ON public.worker_entry_log(worker_id);

ALTER TABLE public.worker_entry_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_all_worker_entry_log" ON public.worker_entry_log;
CREATE POLICY "public_all_worker_entry_log"
  ON public.worker_entry_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger function: log every new worker row automatically on INSERT
CREATE OR REPLACE FUNCTION public.log_worker_entry_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.worker_entry_log (
    worker_id,
    ho_va_ten,
    ma_nv,
    ktx,
    day,
    entered_at
  ) VALUES (
    NEW.id::text,
    NEW.ho_va_ten,
    NEW.ma_nv,
    NEW.ktx,
    NEW.day,
    COALESCE(NEW.created_at, now())
  )
  ON CONFLICT (worker_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workers_log_entry ON public.workers;
CREATE TRIGGER trg_workers_log_entry
  AFTER INSERT ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.log_worker_entry_trigger();

-- Backfill existing active workers into worker_entry_log
INSERT INTO public.worker_entry_log (worker_id, ho_va_ten, ma_nv, ktx, day, entered_at)
SELECT
  w.id::text,
  w.ho_va_ten,
  w.ma_nv,
  w.ktx,
  w.day,
  COALESCE(w.created_at, now())
FROM public.workers w
ON CONFLICT (worker_id) DO NOTHING;
