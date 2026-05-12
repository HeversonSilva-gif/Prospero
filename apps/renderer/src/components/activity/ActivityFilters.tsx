import { type FC, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ACTIVITY_ACTIONS,
  type ActivityAction,
  type ActivityQueryFilters,
  type ActorKind,
  type EntityKind,
  type Agent,
} from "@dashboard-agent/shared";

export type WhenKey = "today" | "7d" | "30d" | "all";

export const whenKeyToSinceMs = (key: WhenKey, now: number): number | undefined => {
  if (key === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (key === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  if (key === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  return undefined;
};

const ACTOR_KINDS: ActorKind[] = ["user", "agent", "system"];
const ENTITY_KINDS: EntityKind[] = [
  "agent",
  "issue",
  "project",
  "approval",
  "session",
  "company",
  "goal",
];
const WHEN_KEYS: WhenKey[] = ["today", "7d", "30d", "all"];

interface Props {
  filters: ActivityQueryFilters;
  whenKey: WhenKey;
  search: string;
  agents: Agent[];
  onChange: (next: ActivityQueryFilters) => void;
  onWhenChange: (next: WhenKey) => void;
  onSearchChange: (next: string) => void;
  onClear: () => void;
}

const SELECT_CLASS =
  "text-xs px-2 py-1 rounded border border-surface-border bg-surface text-ink-muted";

export const ActivityFilters: FC<Props> = ({
  filters,
  whenKey,
  search,
  agents,
  onChange,
  onWhenChange,
  onSearchChange,
  onClear,
}) => {
  const { t } = useTranslation();

  const update = <K extends keyof ActivityQueryFilters>(
    key: K,
    value: ActivityQueryFilters[K] | undefined,
  ): void => {
    const next: ActivityQueryFilters = { ...filters };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };

  const handleActor = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    update("actorKind", v === "" ? undefined : (v as ActorKind));
  };
  const handleAction = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    update("action", v === "" ? undefined : (v as ActivityAction));
  };
  const handleEntity = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    update("entityKind", v === "" ? undefined : (v as EntityKind));
  };
  const handleAgent = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    update("agentId", v === "" ? undefined : v);
  };

  return (
    <div className="flex flex-wrap gap-2 items-center mb-3">
      <label className="text-xs text-ink-soft">
        {t("activity.filter.actor")}
        <select
          className={`ml-1 ${SELECT_CLASS}`}
          value={filters.actorKind ?? ""}
          onChange={handleActor}
        >
          <option value="">{t("activity.filter.all")}</option>
          {ACTOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`activity.filter.actorKind.${k}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-ink-soft">
        {t("activity.filter.action")}
        <select
          className={`ml-1 ${SELECT_CLASS}`}
          value={filters.action ?? ""}
          onChange={handleAction}
        >
          <option value="">{t("activity.filter.all")}</option>
          {ACTIVITY_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-ink-soft">
        {t("activity.filter.entity")}
        <select
          className={`ml-1 ${SELECT_CLASS}`}
          value={filters.entityKind ?? ""}
          onChange={handleEntity}
        >
          <option value="">{t("activity.filter.all")}</option>
          {ENTITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`activity.filter.entityKind.${k}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-ink-soft">
        {t("activity.filter.agent")}
        <select
          className={`ml-1 ${SELECT_CLASS}`}
          value={filters.agentId ?? ""}
          onChange={handleAgent}
        >
          <option value="">{t("activity.filter.all")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-ink-soft">
        {t("activity.filter.when")}
        <select
          className={`ml-1 ${SELECT_CLASS}`}
          value={whenKey}
          onChange={(e) => onWhenChange(e.target.value as WhenKey)}
        >
          {WHEN_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`activity.filter.whenKey.${k}`)}
            </option>
          ))}
        </select>
      </label>

      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t("activity.search")}
        className={`${SELECT_CLASS} flex-1 min-w-[160px] max-w-[260px]`}
      />

      <button
        type="button"
        onClick={onClear}
        className="text-xs text-ink-muted hover:text-brand underline"
      >
        {t("activity.filter.clear")}
      </button>
    </div>
  );
};
