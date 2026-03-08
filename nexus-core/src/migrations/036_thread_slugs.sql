-- Migration 036 — Thread slugs + global index flags
-- Adds SEO-friendly slugs to threads and prepares for Global Search (SPEC 010)

ALTER TABLE threads ADD COLUMN IF NOT EXISTS slug VARCHAR(300);
ALTER TABLE threads ADD COLUMN IF NOT EXISTS is_indexed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ;

-- Generate slugs for all existing threads
-- Format: sanitized-title-XXXXXXXX (first 8 chars of UUID for uniqueness)
UPDATE threads
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(title, '[^a-zA-Z0-9\s\-]', '', 'g'),
      '\s+', '-', 'g'
    ),
    '-{2,}', '-', 'g'
  )
) || '-' || SUBSTRING(id::text, 1, 8)
WHERE slug IS NULL;

-- Ensure uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS threads_slug_unique ON threads (slug);
CREATE INDEX IF NOT EXISTS threads_slug_idx ON threads (slug);
