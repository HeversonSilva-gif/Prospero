import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import type { Project, ProjectPathStatus } from "@prospero/shared";
import type { Recorder } from "../activity/recorder.js";

// Resolves whether a path is reachable without blocking the main thread, and
// without hanging on a slow/disconnected path: a path that doesn't answer within
// the timeout is treated as "missing" rather than freezing the process
// (relatorioClaudinho P2-B — checkPaths is polled every 30s by the UI).
const pathAvailable = (p: string, timeoutMs = 2000): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    access(p).then(
      () => done(true),
      () => done(false),
    );
  });

type Row = {
  id: string;
  company_id: string;
  name: string;
  path: string;
  color: string;
  slug: string | null;
  icon: string | null;
  archived_at: number | null;
  digest_path: string | null;
  created_at: number;
};

const rowToProject = (r: Row): Project => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  path: r.path,
  color: r.color,
  slug: r.slug,
  icon: r.icon,
  archivedAt: r.archived_at,
  digestPath: r.digest_path,
  createdAt: r.created_at,
});

export type CreateProjectInput = {
  companyId: string;
  name: string;
  path: string;
  color: string;
  slug?: string | null;
};

export type UpdateProjectInput = {
  name?: string;
  path?: string;
  color?: string;
};

export type ProjectsRepository = {
  create(input: CreateProjectInput): Project;
  getById(id: string): Project | null;
  listByCompany(companyId: string): Project[];
  update(id: string, patch: UpdateProjectInput): Project | null;
  setSlug(id: string, slug: string): void;
  setIcon(id: string, icon: string | null): void;
  setDigestPath(id: string, digestPath: string): void;
  archive(id: string): void;
  unarchive(id: string): void;
  delete(id: string): void;
  checkPaths(companyId: string): Promise<Record<string, ProjectPathStatus>>;
};

// Optional recorder enables dual-write to activity_events alongside the
// project mutations. Tests omit it; production wires via tryGetRecorder().
export const createProjectsRepository = (
  db: Database.Database,
  recorder?: Recorder,
): ProjectsRepository => {
  const insert = db.prepare(
    "INSERT INTO projects (id, company_id, name, path, color, slug, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const byId = db.prepare("SELECT * FROM projects WHERE id = ?");
  const byCompany = db.prepare(
    "SELECT * FROM projects WHERE company_id = ? ORDER BY created_at ASC",
  );
  const del = db.prepare("DELETE FROM projects WHERE id = ?");
  const updateSlug = db.prepare("UPDATE projects SET slug = ? WHERE id = ?");
  const updateIcon = db.prepare("UPDATE projects SET icon = ? WHERE id = ?");
  const updateDigestPath = db.prepare("UPDATE projects SET digest_path = ? WHERE id = ?");
  const updateArchived = db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?");

  return {
    create(input) {
      const id = `proj_${randomUUID()}`;
      insert.run(
        id,
        input.companyId,
        input.name,
        input.path,
        input.color,
        input.slug ?? null,
        Date.now(),
      );
      recorder?.recordActivity({
        companyId: input.companyId,
        actor: { kind: "user" },
        action: "project.created",
        entityKind: "project",
        entityId: id,
        payload: { name: input.name },
      });
      return rowToProject(byId.get(id) as Row);
    },
    getById(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? rowToProject(row) : null;
    },
    listByCompany(companyId) {
      return (byCompany.all(companyId) as Row[]).map(rowToProject);
    },
    update(id, patch) {
      const current = byId.get(id) as Row | undefined;
      if (current === undefined) return null;
      const next = {
        name: patch.name ?? current.name,
        path: patch.path ?? current.path,
        color: patch.color ?? current.color,
      };
      db.prepare("UPDATE projects SET name = ?, path = ?, color = ? WHERE id = ?").run(
        next.name,
        next.path,
        next.color,
        id,
      );
      recorder?.recordActivity({
        companyId: current.company_id,
        actor: { kind: "user" },
        action: "project.updated",
        entityKind: "project",
        entityId: id,
        payload: { patch: patch },
      });
      return rowToProject(byId.get(id) as Row);
    },
    setSlug(id, slug) {
      if (slug.trim() === "") throw new Error("slug must be non-empty");
      updateSlug.run(slug, id);
    },
    setIcon(id, icon) {
      updateIcon.run(icon, id);
    },
    setDigestPath(id, digestPath) {
      updateDigestPath.run(digestPath, id);
    },
    archive(id) {
      updateArchived.run(Date.now(), id);
    },
    unarchive(id) {
      updateArchived.run(null, id);
    },
    delete(id) {
      const current = byId.get(id) as Row | undefined;
      del.run(id);
      if (current !== undefined) {
        recorder?.recordActivity({
          companyId: current.company_id,
          actor: { kind: "user" },
          action: "project.deleted",
          entityKind: "project",
          entityId: id,
          payload: { name: current.name },
        });
      }
    },
    async checkPaths(companyId) {
      const rows = byCompany.all(companyId) as Row[];
      const entries = await Promise.all(
        rows.map(async (r): Promise<[string, ProjectPathStatus]> => {
          const ok = await pathAvailable(r.path);
          return [r.id, ok ? "available" : "missing"];
        }),
      );
      return Object.fromEntries(entries);
    },
  };
};
