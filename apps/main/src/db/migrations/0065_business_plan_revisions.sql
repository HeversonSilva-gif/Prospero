-- 0065_business_plan_revisions.sql — Persist the genesis business-plan revision
-- counter. It lived in an in-memory Map keyed by company, so it reset on every
-- restart while the plan's `critiquing`/`proposed` status is durable — making
-- the revision cap bypassable across restarts (the CEO could keep getting
-- "revise" instead of a card). Keyed per company: one active genesis
-- conversation per company. Audit 2026-06-03 Facet 6 C2.
CREATE TABLE business_plan_revisions (
  company_id TEXT    NOT NULL PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
