import type { TFunction } from "i18next";
import type { ActivityEventRow, EntityKind } from "@prospero/shared";

export interface Lookups {
  agentsById: Map<string, string>;
  currentUserName: string;
  systemName: string;
}

const UNKNOWN_AGENT = "(unknown)";

const resolveActor = (row: ActivityEventRow, lookups: Lookups): string => {
  if (row.actorKind === "user") return lookups.currentUserName;
  if (row.actorKind === "system") return lookups.systemName;
  if (row.actorId === null) return UNKNOWN_AGENT;
  return lookups.agentsById.get(row.actorId) ?? UNKNOWN_AGENT;
};

const resolveTarget = (row: ActivityEventRow, lookups: Lookups): string => {
  if (row.entityKind === "agent") {
    return lookups.agentsById.get(row.entityId) ?? UNKNOWN_AGENT;
  }
  return row.entityId;
};

export const ENTITY_IS_NAVIGABLE: Record<EntityKind, boolean> = {
  agent: true,
  issue: true,
  project: true,
  approval: true,
  session: false,
  company: false,
  goal: false,
  routine: false,
};

export const renderDescription = (
  row: ActivityEventRow,
  t: TFunction,
  lookups: Lookups,
): string => {
  const actor = resolveActor(row, lookups);
  const target = resolveTarget(row, lookups);
  const key = `activity.action.${row.action}`;
  const vars: Record<string, unknown> = { actor, target, ...row.payload };
  return t(key, vars);
};
