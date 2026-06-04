-- 0069_agents_pending_seed.sql — persist the parked compaction seed (v0.2.10).
-- After a compaction the router parks a "[CONTEXT COMPACTED] where you left off"
-- seed to ride along with the agent's NEXT turn. That lived only in the router's
-- in-RAM `states` map, so a process restart before that next turn (an Electron
-- auto-update does ~2 restarts) lost it and the respawn started blind (audit I8).
-- This column is the durable copy: written when the seed is parked, cleared when
-- consumed, and re-armed into the router at spawn.
ALTER TABLE agents ADD COLUMN pending_seed TEXT;
