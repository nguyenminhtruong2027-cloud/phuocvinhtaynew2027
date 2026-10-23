-- Migration: support typed checkout requests from Bed Management
-- Timestamp: 20261025000000

ALTER TABLE public.worker_registrations
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS worker_id TEXT DEFAULT '';
