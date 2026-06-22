-- D1 (SQLite) state for leetcode-notion-sync.
-- Apply with: npm run db:init   (wrangler d1 execute leetcode-notion-sync --file schema.sql)
-- Add --remote to apply to the deployed DB, or --local for the dev DB.

CREATE TABLE IF NOT EXISTS problems (
  slug               TEXT PRIMARY KEY,
  title              TEXT,
  difficulty         TEXT,          -- 'Easy' | 'Medium' | 'Hard' | NULL
  status             TEXT NOT NULL, -- 'attempted' | 'solved' (forward-only)
  first_attempted_at INTEGER,       -- unix seconds
  solved_at          INTEGER,       -- unix seconds
  notion_page_id     TEXT           -- cached Notion page id for direct updates
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,           -- 'seeded' | 'last_ok' | 'last_error' | 'last_warning' | 'stats_page_id' | 'lock_until'
  value TEXT
);
