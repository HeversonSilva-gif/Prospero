import type Database from "better-sqlite3";
import { createRoleTemplatesRepository } from "./role-templates-repository.js";

// Resolves the human-readable role title for a role template id.
//
// Goal-plan execution (both the atomic executor and the narrated MCP path) set a
// freshly-hired agent's `role` to the raw template id (a "role_xxxx" string)
// instead of the template's title, unlike applyOrgPlan which correctly uses
// `role.name`. The result was confusing roster rows that looked like duplicates
// of the real members (observed live 2026-06-05: a second "Bruno Tavares" whose
// role read "role_bc53bb62-..."). This resolves the proper title; it falls back
// to the id if the template is somehow missing, so it never throws.
export const resolveRoleTitle = (db: Database.Database, roleTemplateId: string): string =>
  createRoleTemplatesRepository(db).getById(roleTemplateId)?.name ?? roleTemplateId;
