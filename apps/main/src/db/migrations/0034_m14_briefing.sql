-- M14 PR-C Task 1: Morning Briefing — cursor + headline cache columns on
-- `companies`. Both are NULL on existing rows; the renderer treats NULL as
-- "show everything from the default window" (24h) for the cursor and "no
-- cache yet" for the headline. Additive ALTERs — no recreate needed.

ALTER TABLE companies ADD COLUMN briefing_reviewed_at INTEGER;
ALTER TABLE companies ADD COLUMN briefing_headline_json TEXT;
