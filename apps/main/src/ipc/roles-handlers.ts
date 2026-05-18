import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, resolveCapabilityTools, type RoleDetail, type RoleTemplate } from "@prospero/shared";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import {
  readCharter,
  writeCharter,
  deleteCharterDir,
  copyCharter,
} from "../agents/role-charter-store.js";

type RoleSummary = RoleTemplate & { agentCount: number };

export const registerRolesHandlers = (db: Database.Database): void => {
  const repo = createRoleTemplatesRepository(db);
  const userDataDir = app.getPath("userData");

  ipcMain.handle(IPC.ROLES_LIST, (): RoleSummary[] => {
    return repo.listAll().map((r) => ({ ...r, agentCount: repo.agentsUsing(r.id).length }));
  });

  ipcMain.handle(IPC.ROLES_GET, (_e, payload: { id: string }): RoleDetail | null => {
    const role = repo.getById(payload.id);
    if (role === null) return null;
    return {
      ...role,
      resolvedTools: resolveCapabilityTools(role.defaultCapabilities),
      agentsUsing: repo.agentsUsing(role.id),
    };
  });

  ipcMain.handle(
    IPC.ROLES_CREATE,
    (
      _e,
      payload: {
        name: string;
        description: string;
        icon: string | null;
        defaultModel: string;
        defaultCapabilities: string[];
      },
    ): RoleTemplate => {
      const role = repo.create(payload);
      // Materialize the new role's charter.md (skeleton) to disk immediately.
      readCharter(userDataDir, role.id);
      return role;
    },
  );

  ipcMain.handle(
    IPC.ROLES_UPDATE,
    (
      _e,
      payload: {
        id: string;
        name?: string;
        description?: string;
        icon?: string | null;
        defaultModel?: string;
        defaultCapabilities?: string[];
      },
    ): RoleTemplate => {
      const { id, ...patch } = payload;
      return repo.update(id, patch);
    },
  );

  ipcMain.handle(IPC.ROLES_DELETE, (_e, payload: { id: string }): { ok: true } => {
    repo.delete(payload.id); // throws if agents still use the role
    deleteCharterDir(userDataDir, payload.id);
    return { ok: true };
  });

  ipcMain.handle(IPC.ROLES_CLONE, (_e, payload: { id: string }): RoleTemplate => {
    const clone = repo.clone(payload.id);
    copyCharter(userDataDir, payload.id, clone.id);
    return clone;
  });

  ipcMain.handle(IPC.ROLES_GET_CHARTER, (_e, payload: { id: string }): { body: string } => {
    return { body: readCharter(userDataDir, payload.id) };
  });

  ipcMain.handle(
    IPC.ROLES_SAVE_CHARTER,
    (_e, payload: { id: string; body: string }): { ok: true } => {
      if (repo.getById(payload.id) === null) {
        throw new Error(`role not found: ${payload.id}`);
      }
      writeCharter(userDataDir, payload.id, payload.body);
      repo.touch(payload.id);
      return { ok: true };
    },
  );
};
