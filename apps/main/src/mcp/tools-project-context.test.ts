import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations.js";
import { writeDigest, readDigest } from "../context/digest-store.js";
import { projectContextToolDefinitions } from "./tools-project-context.js";

const read = projectContextToolDefinitions.find((t) => t.name === "project_context_read")!;
const note = projectContextToolDefinitions.find((t) => t.name === "project_context_note")!;

let db: Database.Database;
let dir: string;
let ctx: {
  db: Database.Database;
  companyId: string;
  agentId: string;
  userDataDir: string;
  permissionsDir: string;
  emit: () => void;
};

beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  dir = mkdtempSync(join(tmpdir(), "pctx-"));
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('co_1','C',1)").run();
  db.prepare(
    "INSERT INTO projects (id, company_id, name, path, created_at) VALUES ('pr_1','co_1','P','/repo',1)",
  ).run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('ag_1','co_1','A','eng','','[]','["pr_1"]','supervised',0,'idle',1,1)`,
  ).run();
  ctx = {
    db,
    companyId: "co_1",
    agentId: "ag_1",
    userDataDir: dir,
    permissionsDir: "/tmp/perms",
    emit: () => {},
  };
});

describe("project_context tools", () => {
  it("note upserts a deep-dive; read returns it and bumps access", async () => {
    await note.run({ area: "gate", body: "The gate lives in security/gate.ts" }, ctx);
    const out = JSON.parse(await read.run({ area: "gate" }, ctx)) as {
      deepDive?: { body: string };
    };
    expect(out.deepDive?.body).toContain("gate.ts");
    const d = readDigest(dir, "co_1", "pr_1");
    expect(d.deepDives[0]?.accessCount).toBe(1);
  });

  it("read with no area returns the map summary", async () => {
    writeDigest(dir, "co_1", "pr_1", {
      version: 1,
      entries: [
        {
          id: "e",
          section: "architecture",
          body: "monorepo",
          sourceFiles: [],
          contentHash: "h",
          derivedAt: 1,
          trust: 0.5,
          accessCount: 0,
          lastAccessed: null,
        },
      ],
      deepDives: [],
    });
    const out = JSON.parse(await read.run({}, ctx)) as { map: { body: string }[] };
    expect(out.map[0]?.body).toBe("monorepo");
  });

  it("note with supersedes lowers the target entry's trust", async () => {
    writeDigest(dir, "co_1", "pr_1", {
      version: 1,
      entries: [
        {
          id: "ent1",
          section: "gotchas",
          body: "wrong",
          sourceFiles: [],
          contentHash: "h",
          derivedAt: 1,
          trust: 0.8,
          accessCount: 0,
          lastAccessed: null,
        },
      ],
      deepDives: [],
    });
    await note.run({ area: "gotchas", body: "actually X", supersedes: "ent1" }, ctx);
    const d = readDigest(dir, "co_1", "pr_1");
    expect(d.entries.find((e) => e.id === "ent1")!.trust).toBeLessThan(0.8);
  });
});
