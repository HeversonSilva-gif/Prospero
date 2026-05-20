import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { join } from "node:path";
import { IPC } from "@prospero/shared";

// M13 PR-E containment zones — read-only transparency view for the Settings
// panel (spec §13 row "Settings → Segurança"). Derives one entry per live
// company plus one per live agent. The zone authority is
// apps/main/src/security/zones.ts; this surface is purely informational and
// safe to expose to the renderer.

export type ZoneSummary =
  | {
      kind: "company";
      companyId: string;
      companyName: string;
      samplePath: string;
    }
  | {
      kind: "agent";
      companyId: string;
      companyName: string;
      agentId: string;
      agentName: string;
      samplePath: string;
    };

export type SecurityHandlersDeps = {
  db: Database.Database;
  userDataDir: string;
};

export type SecurityHandlers = {
  listZones(): ZoneSummary[];
};

export const securityHandlers = (deps: SecurityHandlersDeps): SecurityHandlers => {
  return {
    listZones() {
      const out: ZoneSummary[] = [];
      const companies = deps.db
        .prepare("SELECT id, name FROM companies ORDER BY created_at ASC")
        .all() as Array<{ id: string; name: string }>;
      for (const c of companies) {
        out.push({
          kind: "company",
          companyId: c.id,
          companyName: c.name,
          samplePath: join(deps.userDataDir, "companies", c.id),
        });
        const agents = deps.db
          .prepare(
            "SELECT id, name FROM agents WHERE company_id = ? AND terminated_at IS NULL ORDER BY created_at ASC",
          )
          .all(c.id) as Array<{ id: string; name: string }>;
        for (const a of agents) {
          out.push({
            kind: "agent",
            companyId: c.id,
            companyName: c.name,
            agentId: a.id,
            agentName: a.name,
            samplePath: join(deps.userDataDir, "companies", c.id, "agents", a.id),
          });
        }
      }
      return out;
    },
  };
};

export const registerSecurityHandlers = (db: Database.Database): void => {
  const h = securityHandlers({ db, userDataDir: app.getPath("userData") });
  ipcMain.handle(IPC.SECURITY_LIST_ZONES, () => h.listZones());
};
