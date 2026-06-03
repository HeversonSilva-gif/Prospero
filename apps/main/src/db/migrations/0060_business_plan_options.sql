-- 0060_business_plan_options.sql — Gênese 3-options persistence. The CEO now
-- proposes 2-3 business options (one recommended) instead of a single plan.
-- `options_json` stores the full array of BusinessPlanOption objects so the UI
-- can render all three cards for the owner to compare. `chosen_index` is NULL
-- until the owner approves, then records which option (0-based) was selected.
-- The existing single-plan columns remain the canonical "chosen" plan and are
-- populated from the selected option on insert, preserving backward compat.
ALTER TABLE business_plans ADD COLUMN options_json TEXT;
ALTER TABLE business_plans ADD COLUMN chosen_index INTEGER;
