import { ipcMain, shell } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Project, type ProjectPathStatus } from "@prospero/shared";
import { createProjectsRepository } from "../projects/repository.js";
import { tryGetRecorder } from "../activity/index.js";

export const registerProjectsHandlers = (db: Database.Database): void => {
  const repo = createProjectsRepository(db, tryGetRecorder());

  ipcMain.handle(IPC.PROJECTS_LIST, (_e, payload: { companyId: string }): Project[] =>
    repo.listByCompany(payload.companyId),
  );

  ipcMain.handle(
    IPC.PROJECTS_CREATE,
    (_e, payload: { companyId: string; name: string; path: string; color: string }): Project =>
      repo.create(payload),
  );

  ipcMain.handle(
    IPC.PROJECTS_UPDATE,
    (_e, payload: { id: string; name?: string; path?: string; color?: string }): Project | null => {
      const { id, ...patch } = payload;
      return repo.update(id, patch);
    },
  );

  ipcMain.handle(IPC.PROJECTS_DELETE, (_e, payload: { id: string }): { ok: true } => {
    repo.delete(payload.id);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.PROJECTS_OPEN_FOLDER,
    async (_e, payload: { id: string }): Promise<{ opened: boolean }> => {
      const p = repo.getById(payload.id);
      if (p === null) return { opened: false };
      const err = await shell.openPath(p.path);
      return { opened: err === "" };
    },
  );

  ipcMain.handle(
    IPC.PROJECTS_CHECK_PATHS,
    (_e, payload: { companyId: string }): Record<string, ProjectPathStatus> =>
      repo.checkPaths(payload.companyId),
  );

  ipcMain.handle(
    IPC.PROJECTS_SET_SLUG,
    (_e, payload: { projectId: string; slug: string }): void => {
      const cleaned = payload.slug.trim().toUpperCase();
      if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)?$/.test(cleaned)) {
        throw new Error("slug must be uppercase alphanumeric (optional -N suffix)");
      }
      repo.setSlug(payload.projectId, cleaned);
    },
  );

  ipcMain.handle(
    IPC.PROJECTS_SET_ICON,
    (_e, payload: { id: string; icon: string | null }): { ok: true } => {
      if (typeof payload.id !== "string" || payload.id === "") {
        throw new Error("[projects:set-icon] id is required");
      }
      repo.setIcon(payload.id, payload.icon);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.PROJECTS_ARCHIVE, (_e, payload: { id: string }): { ok: true } => {
    if (typeof payload.id !== "string" || payload.id === "") {
      throw new Error("[projects:archive] id is required");
    }
    repo.archive(payload.id);
    return { ok: true };
  });

  ipcMain.handle(IPC.PROJECTS_UNARCHIVE, (_e, payload: { id: string }): { ok: true } => {
    if (typeof payload.id !== "string" || payload.id === "") {
      throw new Error("[projects:unarchive] id is required");
    }
    repo.unarchive(payload.id);
    return { ok: true };
  });
};
