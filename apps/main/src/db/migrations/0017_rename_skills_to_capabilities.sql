-- M11 PR-A: free the name "skill" for M11 procedural-knowledge docs.
-- The M7 tool-bundle concept is renamed "capability".
ALTER TABLE agents RENAME COLUMN skills_json TO capabilities_json;
ALTER TABLE role_templates RENAME COLUMN default_skills_json TO default_capabilities_json;
