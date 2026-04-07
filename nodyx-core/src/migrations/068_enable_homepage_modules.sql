-- Migration 068: enable website modules that already have content on the homepage
-- hero, news, stats are already rendered — make them officially "on" so admins can toggle them.
-- events-public is new — enable it so upcoming events appear on the homepage out of the box.
-- ON CONFLICT guard: if an admin already explicitly disabled one, we do NOT re-enable it.
-- We use a conditional UPDATE: only flip to true if the row was seeded at false (never touched).

UPDATE modules SET enabled = true, updated_at = now()
WHERE  id IN ('hero', 'news', 'stats', 'events-public')
AND    enabled = false
AND    updated_at = installed_at;  -- only rows that were never manually changed
