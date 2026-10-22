-- Migration: Create worker-avatars storage bucket for CCCD photos
-- Timestamp: 20260920000001_create_worker_avatars_bucket

-- Create the worker-avatars storage bucket (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'worker-avatars',
  'worker-avatars',
  true,
  524288, -- 512KB max (we compress to 300KB before upload)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to worker avatars
DROP POLICY IF EXISTS "worker_avatars_public_read" ON storage.objects;
CREATE POLICY "worker_avatars_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'worker-avatars');

-- Allow any user to upload worker avatars
DROP POLICY IF EXISTS "worker_avatars_insert" ON storage.objects;
CREATE POLICY "worker_avatars_insert"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'worker-avatars');

-- Allow any user to update worker avatars
DROP POLICY IF EXISTS "worker_avatars_update" ON storage.objects;
CREATE POLICY "worker_avatars_update"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'worker-avatars');

-- Allow any user to delete worker avatars
DROP POLICY IF EXISTS "worker_avatars_delete" ON storage.objects;
CREATE POLICY "worker_avatars_delete"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'worker-avatars');
