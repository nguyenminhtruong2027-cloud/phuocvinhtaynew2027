-- Migration: allow beds.status = 'maintenance'
-- Timestamp: 20261024000000

ALTER TABLE public.beds
  DROP CONSTRAINT IF EXISTS beds_status_check;

ALTER TABLE public.beds
  ADD CONSTRAINT beds_status_check
  CHECK (status IN ('empty', 'occupied', 'maintenance'));
