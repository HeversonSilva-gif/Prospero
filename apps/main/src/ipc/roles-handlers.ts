import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, resolveSkillTools, type RoleDetail, type RoleTemplate } from "@prospero/shared";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";

type RoleSummary = RoleTemplate & { agentCount: number };

export const registerRolesHandlers = (db: Database.Database): void => {
  const repo = createRoleTemplatesRepository(db);

  ipcMain.handle(IPC.ROLES_LIST, (): RoleSummary[] => {
    const roles = repo.listAll();
    return roles.map((r) => ({
      ...r,
      agentCount: repo.agentsUsing(r.id).length,
    }));
  });

  ipcMain.handle(IPC.ROLES_GET, (_event, payload: { id: string }): RoleDetail | null => {
    const role = repo.getById(payload.id);
    if (role === null) return null;
    return {
      ...role,
      resolvedTools: resolveSkillTools(role.defaultSkills),
      agentsUsing: repo.agentsUsing(role.id),
    };
  });
};
