-- Migration: Update assigned_blocks format to KTX+Block combination
-- New format: ["KTX 1 - Dãy 1", "KTX 1 - Dãy 2", "KTX 2 - Dãy 3", ...]
-- Old format was: ["Dãy 1", "Dãy 2", ...]

-- Add comment to document the new format
COMMENT ON COLUMN public.profiles.assigned_blocks IS 
  'Array of KTX+Block combinations assigned to staff. Format: ["KTX 1 - Dãy 1", "KTX 2 - Dãy 3"]. Admin has access to all blocks (this field is ignored for admin role).';

-- Migrate existing data: convert old "Dãy X" format to "KTX 1 - Dãy X" format
-- assigned_blocks is text[] type, so we use array operations
UPDATE public.profiles
SET assigned_blocks = (
  SELECT ARRAY(
    SELECT
      CASE
        WHEN val NOT LIKE '% - %' AND val LIKE 'Dãy %'
          THEN 'KTX 1 - ' || val
        ELSE val
      END
    FROM unnest(assigned_blocks) AS val
  )
)
WHERE role = 'staff'
  AND assigned_blocks IS NOT NULL
  AND array_length(assigned_blocks, 1) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(assigned_blocks) AS val
    WHERE val NOT LIKE '% - %' AND val LIKE 'Dãy %'
  );
