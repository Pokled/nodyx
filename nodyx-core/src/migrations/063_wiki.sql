-- 063_wiki.sql
-- Wiki module: internal knowledge base editable by admins and moderators.
-- Pages are scoped to the instance, can be public or members-only.

CREATE TABLE IF NOT EXISTS wiki_pages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL UNIQUE,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  excerpt     TEXT,
  author_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  editor_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  category    TEXT,
  is_public   BOOLEAN     NOT NULL DEFAULT false,
  views       INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug     ON wiki_pages(slug);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_category ON wiki_pages(category);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_author   ON wiki_pages(author_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated  ON wiki_pages(updated_at DESC);
