import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Issue,
  IssueDetail,
  IssueStatus,
  IssuePriority,
  IssueComment,
  IssueEvent,
  IssueEventKind,
  Actor,
} from "@prospero/shared";
import { getToolHistory } from "./tool-history.js";
import type { Recorder } from "../activity/recorder.js";

type IssueRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  status: string;
  priority: string;
  identifier: string | null;
  issue_number: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

const rowToIssue = (r: IssueRow): Issue => ({
  id: r.id,
  companyId: r.company_id,
  projectId: r.project_id,
  parentId: r.parent_id,
  title: r.title,
  description: r.description,
  assigneeId: r.assignee_id,
  status: r.status as IssueStatus,
  priority: r.priority as IssuePriority,
  identifier: r.identifier,
  issueNumber: r.issue_number,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type CreateIssueInput = {
  companyId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  priority: IssuePriority;
  parentId: string | null;
  createdBy: string | null;
};

export type UpdateIssueInput = {
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  assigneeId?: string | null;
  priority?: IssuePriority;
  parentId?: string | null;
};

export type ActorContext = {
  actorKind: "user" | "agent" | "system";
  actorId: string | null;
};

export type ListIssuesFilter = {
  companyId: string;
  projectId?: string;
  status?: IssueStatus;
  assigneeId?: string;
};

export type IssuesRepository = {
  create(input: CreateIssueInput, actor?: ActorContext): Issue;
  getById(id: string): Issue | null;
  getByIdentifier(identifier: string): Issue | null;
  getDetail(id: string): IssueDetail | null;
  list(filter: ListIssuesFilter): Issue[];
  listByGoal(goalId: string): Issue[];
  getGoalId(issueId: string): string | null;
  update(id: string, patch: UpdateIssueInput, actor: ActorContext): Issue | null;
  delete(id: string): void;
  resolveProjectByNameOrId(companyId: string, query: string): { id: string; matches: number };
  // M8.6 — topological unlock support
  findDependentsOf(issueId: string, companyId: string): Issue[];
};

const writeEvent = (
  db: Database.Database,
  issueId: string,
  kind: IssueEventKind,
  actor: ActorContext,
  payload: unknown,
): void => {
  db.prepare(
    "INSERT INTO issue_events (id, issue_id, kind, actor_kind, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    `evt_${randomUUID()}`,
    issueId,
    kind,
    actor.actorKind,
    actor.actorId,
    JSON.stringify(payload),
    Date.now(),
  );
};

const toActor = (ctx: ActorContext): Actor => {
  if (ctx.actorKind === "agent" && ctx.actorId !== null) return { kind: "agent", id: ctx.actorId };
  if (ctx.actorKind === "system") return { kind: "system" };
  return { kind: "user" };
};

// `recorder` is optional so existing test setups keep working. When supplied,
// every issue mutation also emits an activity_events row alongside the
// pre-existing issue_events row (dual-write).
export const createIssuesRepository = (
  db: Database.Database,
  recorder?: Recorder,
): IssuesRepository => {
  const insert = db.prepare(`
    INSERT INTO issues (id, company_id, project_id, parent_id, title, description, assignee_id, status, priority, identifier, issue_number, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare("SELECT * FROM issues WHERE id = ?");
  const byIdentifierStmt = db.prepare("SELECT * FROM issues WHERE identifier = ?");
  const maxNumberForProject = db.prepare(
    "SELECT COALESCE(MAX(issue_number), 0) AS max_n FROM issues WHERE project_id = ?",
  );
  const slugForProject = db.prepare("SELECT slug FROM projects WHERE id = ?");
  const childrenStmt = db.prepare(
    "SELECT * FROM issues WHERE parent_id = ? ORDER BY created_at ASC",
  );
  const eventsStmt = db.prepare(
    "SELECT * FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC",
  );
  const commentsStmt = db.prepare(
    "SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC",
  );
  const listByGoalStmt = db.prepare(
    // rowid (SQLite's implicit monotonic insertion counter) breaks created_at
    // ties deterministically — id is a random uuid, so id ASC is not stable.
    "SELECT * FROM issues WHERE goal_id = ? ORDER BY created_at ASC, rowid ASC",
  );
  const getGoalIdStmt = db.prepare("SELECT goal_id FROM issues WHERE id = ?");

  // FKs only guarantee the referenced id exists — not that it belongs to the
  // same company. Combined with the (now-fixed) frontend that could pass another
  // company's ids, that allowed cross-company issues (relatorioCodex P1). Guard
  // the relations here: a referenced project/assignee/parent that exists but
  // lives in a different company is rejected. Missing ids are left to the FK.
  const projectCompanyStmt = db.prepare("SELECT company_id FROM projects WHERE id = ?");
  const agentCompanyStmt = db.prepare("SELECT company_id FROM agents WHERE id = ?");
  const assertSameCompany = (
    companyId: string,
    refs: {
      projectId?: string | null | undefined;
      assigneeId?: string | null | undefined;
      parentId?: string | null | undefined;
    },
  ): void => {
    if (refs.projectId != null) {
      const r = projectCompanyStmt.get(refs.projectId) as { company_id: string } | undefined;
      if (r !== undefined && r.company_id !== companyId) {
        throw new Error(`project ${refs.projectId} belongs to a different company`);
      }
    }
    if (refs.assigneeId != null) {
      const r = agentCompanyStmt.get(refs.assigneeId) as { company_id: string } | undefined;
      if (r !== undefined && r.company_id !== companyId) {
        throw new Error(`assignee ${refs.assigneeId} belongs to a different company`);
      }
    }
    if (refs.parentId != null) {
      const r = byId.get(refs.parentId) as IssueRow | undefined;
      if (r !== undefined && r.company_id !== companyId) {
        throw new Error(`parent issue ${refs.parentId} belongs to a different company`);
      }
    }
  };

  const createTx = db.transaction((input: CreateIssueInput, actor: ActorContext): Issue => {
    assertSameCompany(input.companyId, {
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      parentId: input.parentId,
    });
    const id = `iss_${randomUUID()}`;
    const now = Date.now();
    let issueNumber: number | null = null;
    let identifier: string | null = null;
    if (input.projectId !== null) {
      const row = maxNumberForProject.get(input.projectId) as { max_n: number };
      issueNumber = row.max_n + 1;
      const slugRow = slugForProject.get(input.projectId) as { slug: string | null } | undefined;
      const slug = slugRow?.slug ?? null;
      identifier = slug === null ? null : `${slug}-${issueNumber}`;
    }
    insert.run(
      id,
      input.companyId,
      input.projectId,
      input.parentId,
      input.title,
      input.description,
      input.assigneeId,
      input.priority,
      identifier,
      issueNumber,
      input.createdBy,
      now,
      now,
    );
    writeEvent(db, id, "created", actor, {
      title: input.title,
      project_id: input.projectId,
      assignee_id: input.assigneeId,
      priority: input.priority,
      identifier,
    });
    recorder?.recordActivity({
      companyId: input.companyId,
      actor: toActor(actor),
      action: "issue.created",
      entityKind: "issue",
      entityId: id,
      agentId: input.assigneeId,
      payload: {
        identifier: identifier ?? "",
        title: input.title,
        assigneeAgentId: input.assigneeId,
      },
    });
    return rowToIssue(byId.get(id) as IssueRow);
  });

  const repo: IssuesRepository = {
    create(input, actor = { actorKind: "system", actorId: null }) {
      return createTx(input, actor);
    },
    getById(id) {
      const row = byId.get(id) as IssueRow | undefined;
      return row ? rowToIssue(row) : null;
    },
    getByIdentifier(identifier) {
      const row = byIdentifierStmt.get(identifier) as IssueRow | undefined;
      return row ? rowToIssue(row) : null;
    },
    getDetail(id) {
      const issue = repo.getById(id);
      if (issue === null) return null;
      const subtasks = (childrenStmt.all(id) as IssueRow[]).map(rowToIssue);
      const events: IssueEvent[] = (
        eventsStmt.all(id) as Array<{
          id: string;
          issue_id: string;
          kind: string;
          actor_kind: string;
          actor_id: string | null;
          payload_json: string;
          created_at: number;
        }>
      ).map((r) => ({
        id: r.id,
        issueId: r.issue_id,
        kind: r.kind as IssueEventKind,
        actorKind: r.actor_kind as "user" | "agent" | "system",
        actorId: r.actor_id,
        payloadJson: r.payload_json,
        createdAt: r.created_at,
      }));
      const comments: IssueComment[] = (
        commentsStmt.all(id) as Array<{
          id: string;
          issue_id: string;
          sender_kind: string;
          sender_id: string | null;
          content: string;
          created_at: number;
        }>
      ).map((r) => ({
        id: r.id,
        issueId: r.issue_id,
        senderKind: r.sender_kind as "user" | "agent",
        senderId: r.sender_id,
        content: r.content,
        createdAt: r.created_at,
      }));

      let assignee: IssueDetail["assignee"] = null;
      if (issue.assigneeId !== null) {
        const a = db
          .prepare("SELECT id, name, role FROM agents WHERE id = ?")
          .get(issue.assigneeId) as { id: string; name: string; role: string } | undefined;
        if (a !== undefined) assignee = a;
      }
      let project: IssueDetail["project"] = null;
      if (issue.projectId !== null) {
        const p = db
          .prepare("SELECT id, name, color FROM projects WHERE id = ?")
          .get(issue.projectId) as { id: string; name: string; color: string } | undefined;
        if (p !== undefined) project = p;
      }
      const toolHistory = getToolHistory(db, id);
      return { issue, comments, events, subtasks, toolHistory, assignee, project };
    },
    list(filter) {
      const clauses = ["company_id = ?", "parent_id IS NULL"];
      const params: unknown[] = [filter.companyId];
      if (filter.projectId !== undefined) {
        clauses.push("project_id = ?");
        params.push(filter.projectId);
      }
      if (filter.status !== undefined) {
        clauses.push("status = ?");
        params.push(filter.status);
      }
      if (filter.assigneeId !== undefined) {
        clauses.push("assignee_id = ?");
        params.push(filter.assigneeId);
      }
      const sql = `SELECT * FROM issues WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 100`;
      return (db.prepare(sql).all(...params) as IssueRow[]).map(rowToIssue);
    },
    listByGoal: (goalId) => (listByGoalStmt.all(goalId) as IssueRow[]).map(rowToIssue),
    getGoalId: (issueId) => {
      const row = getGoalIdStmt.get(issueId) as { goal_id: string | null } | undefined;
      return row?.goal_id ?? null;
    },
    update(id, patch, actor) {
      const current = byId.get(id) as IssueRow | undefined;
      if (current === undefined) return null;
      assertSameCompany(current.company_id, {
        assigneeId: patch.assigneeId,
        parentId: patch.parentId,
      });
      const sets: string[] = ["updated_at = ?"];
      const params: unknown[] = [Date.now()];
      const events: Array<{ kind: IssueEventKind; payload: unknown }> = [];

      if (patch.title !== undefined && patch.title !== current.title) {
        sets.push("title = ?");
        params.push(patch.title);
      }
      if (patch.description !== undefined && patch.description !== current.description) {
        sets.push("description = ?");
        params.push(patch.description);
      }
      if (patch.status !== undefined && patch.status !== current.status) {
        sets.push("status = ?");
        params.push(patch.status);
        events.push({
          kind: "status_changed",
          payload: { from: current.status, to: patch.status },
        });
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== current.assignee_id) {
        sets.push("assignee_id = ?");
        params.push(patch.assigneeId);
        events.push({
          kind: "assignee_changed",
          payload: { from: current.assignee_id, to: patch.assigneeId },
        });
      }
      if (patch.priority !== undefined && patch.priority !== current.priority) {
        sets.push("priority = ?");
        params.push(patch.priority);
        events.push({
          kind: "priority_changed",
          payload: { from: current.priority, to: patch.priority },
        });
      }
      if (patch.parentId !== undefined && patch.parentId !== current.parent_id) {
        sets.push("parent_id = ?");
        params.push(patch.parentId);
        events.push({
          kind: "reparented",
          payload: { from: current.parent_id, to: patch.parentId },
        });
      }
      if (sets.length === 1) return rowToIssue(current);
      params.push(id);
      db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      for (const e of events) writeEvent(db, id, e.kind, actor, e.payload);
      // Dual-write to activity_events (one row per changed field that maps to
      // an activity action). `reparented` has no activity counterpart in v1.
      const activityActor = toActor(actor);
      for (const e of events) {
        if (e.kind === "status_changed") {
          recorder?.recordActivity({
            companyId: current.company_id,
            actor: activityActor,
            action: "issue.status_changed",
            entityKind: "issue",
            entityId: id,
            agentId: current.assignee_id,
            payload: e.payload as { from: string; to: string },
          });
        } else if (e.kind === "assignee_changed") {
          const p = e.payload as { from: string | null; to: string | null };
          recorder?.recordActivity({
            companyId: current.company_id,
            actor: activityActor,
            action: "issue.assignee_changed",
            entityKind: "issue",
            entityId: id,
            agentId: p.to ?? p.from,
            payload: p,
          });
        } else if (e.kind === "priority_changed") {
          recorder?.recordActivity({
            companyId: current.company_id,
            actor: activityActor,
            action: "issue.priority_changed",
            entityKind: "issue",
            entityId: id,
            agentId: current.assignee_id,
            payload: e.payload as { from: string; to: string },
          });
        }
      }
      return rowToIssue(byId.get(id) as IssueRow);
    },
    delete(id) {
      // Collect all descendant issue ids (subtasks + their subtasks, etc.)
      const collectDescendants = (rootId: string): string[] => {
        const children = (
          db.prepare("SELECT id FROM issues WHERE parent_id = ?").all(rootId) as { id: string }[]
        ).map((r) => r.id);
        return children.flatMap((childId) => [childId, ...collectDescendants(childId)]);
      };
      const descendants = collectDescendants(id);
      const allIds = [id, ...descendants];
      // Delete events and comments for all affected issues
      for (const issueId of allIds) {
        db.prepare("DELETE FROM issue_events WHERE issue_id = ?").run(issueId);
        db.prepare("DELETE FROM issue_comments WHERE issue_id = ?").run(issueId);
      }
      // Delete subtasks first (children before parents to avoid FK violations)
      for (const childId of descendants.reverse()) {
        db.prepare("DELETE FROM issues WHERE id = ?").run(childId);
      }
      db.prepare("DELETE FROM issues WHERE id = ?").run(id);
    },
    resolveProjectByNameOrId(companyId, query) {
      const byIdRow = db
        .prepare("SELECT id FROM projects WHERE id = ? AND company_id = ?")
        .get(query, companyId) as { id: string } | undefined;
      if (byIdRow !== undefined) return { id: byIdRow.id, matches: 1 };
      const byName = db
        .prepare("SELECT id FROM projects WHERE company_id = ? AND lower(name) = lower(?)")
        .all(companyId, query) as { id: string }[];
      if (byName.length === 1) return { id: byName[0]!.id, matches: 1 };
      return { id: "", matches: byName.length };
    },
    findDependentsOf(issueId, companyId) {
      const rows = db
        .prepare(
          `SELECT * FROM issues
           WHERE company_id = ?
             AND depends_on_json IS NOT NULL
             AND depends_on_json LIKE '%' || ? || '%'`,
        )
        .all(companyId, issueId) as (IssueRow & { depends_on_json: string | null })[];
      // LIKE may catch substring false-positives (e.g., similar-prefix ids);
      // parse JSON and filter.
      return rows
        .filter((r) => {
          if (r.depends_on_json === null) return false;
          try {
            const arr = JSON.parse(r.depends_on_json) as unknown;
            return Array.isArray(arr) && arr.includes(issueId);
          } catch {
            return false;
          }
        })
        .map(rowToIssue);
    },
  };
  return repo;
};
