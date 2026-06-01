import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";

const deployTool = toolDefinitions.find((t) => t.name === "deploy_app")!;
const statusTool = toolDefinitions.find((t) => t.name === "deployment_status")!;
const d1Tool = toolDefinitions.find((t) => t.name === "provision_database")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  db.prepare(
    `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
     VALUES ('bot1','c1','Bot','engineer','','["deploy"]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  const dir = mkdtempSync(join(tmpdir(), "perm-deploy-"));
  return { db, dir };
}

const waitForReq = async (dir: string): Promise<{ tool_use_id: string; tool_name: string }> => {
  for (let i = 0; i < 100; i++) {
    const f = readdirSync(dir).find((n) => n.endsWith(".req.json"));
    if (f !== undefined)
      return JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        tool_use_id: string;
        tool_name: string;
      };
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no .req.json appeared");
};

const ctxFor = (
  db: Database.Database,
  dir: string,
  emit: (ev: { kind: string; payload: unknown }) => void,
): ToolContext => ({
  agentId: "bot1",
  companyId: "c1",
  db,
  permissionsDir: dir,
  userDataDir: dir,
  emit,
});

// An emit that plays MAIN's role: write the deploy result for the requestId.
const emitWithResult = (dir: string, url: string) =>
  vi.fn((ev: { kind: string; payload: unknown }) => {
    if (ev.kind === "cloudflare.deploy") {
      const { requestId } = ev.payload as { requestId: string };
      writeFileSync(join(dir, `${requestId}.deploy.json`), JSON.stringify({ ok: true, url }));
    }
  });

describe("deploy_app", () => {
  it("preview deploys without a gate, emits cloudflare.deploy, returns MAIN's url", async () => {
    const { db, dir } = setup();
    const emit = emitWithResult(dir, "https://prev.my-app.pages.dev");
    const out = JSON.parse(
      await deployTool.run(
        { project_path: "/work/app", project_name: "my-app", mode: "preview" },
        ctxFor(db, dir, emit),
      ),
    ) as { ok: boolean; url: string };
    expect(out).toEqual({ ok: true, url: "https://prev.my-app.pages.dev" });
    expect(emit).toHaveBeenCalledWith({
      kind: "cloudflare.deploy",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({ mode: "preview", projectName: "my-app" }),
    });
  });

  it("production deploy self-gates, then emits once approved", async () => {
    const { db, dir } = setup();
    const emit = emitWithResult(dir, "https://my-app.pages.dev");
    const runPromise = deployTool.run(
      { project_path: "/work/app", project_name: "my-app", mode: "production" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    expect(req.tool_name).toBe("deploy_app");
    writeFileSync(join(dir, `${req.tool_use_id}.res.json`), JSON.stringify({ behavior: "allow" }));
    const out = JSON.parse(await runPromise) as { ok: boolean; url: string };
    expect(out).toEqual({ ok: true, url: "https://my-app.pages.dev" });
  });

  it("does NOT deploy a production build when the gate rejects", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const runPromise = deployTool.run(
      { project_path: "/work/app", project_name: "my-app", mode: "production" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    writeFileSync(
      join(dir, `${req.tool_use_id}.deny.json`),
      JSON.stringify({ behavior: "deny", message: "nope" }),
    );
    const out = JSON.parse(await runPromise) as { ok: boolean; status: string };
    expect(out.ok).toBe(false);
    expect(out.status).toBe("deny");
    expect(emit).not.toHaveBeenCalled();
  });

  it("refuses to deploy a system-zone path (the agent sandbox), no gate, no emit", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const out = JSON.parse(
      await deployTool.run(
        { project_path: join(dir, "sbx", "secret"), project_name: "my-app", mode: "production" },
        ctxFor(db, dir, emit),
      ),
    ) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("área permitida");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("deployment_status", () => {
  it("reports the last production url from the connection metadata (no gate)", async () => {
    const { db, dir } = setup();
    db.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, metadata_json, created_at, updated_at)
       VALUES ('cf1','c1','cloudflare','enc','{"lastDeployUrl":"https://my-app.pages.dev"}',0,0)`,
    ).run();
    const emit = vi.fn();
    const out = JSON.parse(await statusTool.run({}, ctxFor(db, dir, emit))) as {
      connected: boolean;
      productionUrl: string | null;
    };
    expect(out).toEqual({ connected: true, productionUrl: "https://my-app.pages.dev" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("reports not connected when there is no cloudflare connection", async () => {
    const { db, dir } = setup();
    const out = JSON.parse(
      await statusTool.run(
        {},
        ctxFor(db, dir, () => {}),
      ),
    ) as {
      connected: boolean;
    };
    expect(out.connected).toBe(false);
  });
});

describe("provision_database", () => {
  it("self-gates, then emits cloudflare.d1 with the command once approved", async () => {
    const { db, dir } = setup();
    const emit = vi.fn((ev: { kind: string; payload: unknown }) => {
      if (ev.kind === "cloudflare.d1") {
        const { requestId } = ev.payload as { requestId: string };
        writeFileSync(
          join(dir, `${requestId}.d1.json`),
          JSON.stringify({ ok: true, output: "database_id = abc" }),
        );
      }
    });
    const runPromise = d1Tool.run(
      { project_path: "/work/app", database_name: "my-db", command: "create" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    expect(req.tool_name).toBe("provision_database");
    writeFileSync(join(dir, `${req.tool_use_id}.res.json`), JSON.stringify({ behavior: "allow" }));
    const out = JSON.parse(await runPromise) as { ok: boolean; output: string };
    expect(out.ok).toBe(true);
    expect(emit).toHaveBeenCalledWith({
      kind: "cloudflare.d1",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      payload: expect.objectContaining({ command: "create", databaseName: "my-db" }),
    });
  });

  it("does NOT provision when the gate rejects", async () => {
    const { db, dir } = setup();
    const emit = vi.fn();
    const runPromise = d1Tool.run(
      { project_path: "/work/app", database_name: "my-db", command: "create" },
      ctxFor(db, dir, emit),
    );
    const req = await waitForReq(dir);
    writeFileSync(
      join(dir, `${req.tool_use_id}.deny.json`),
      JSON.stringify({ behavior: "deny", message: "no" }),
    );
    const out = JSON.parse(await runPromise) as { ok: boolean; status: string };
    expect(out.ok).toBe(false);
    expect(out.status).toBe("deny");
    expect(emit).not.toHaveBeenCalled();
  });
});
