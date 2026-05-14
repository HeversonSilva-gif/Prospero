import { describe, expect, it } from "vitest";
import ptBR from "./pt-BR.json";
import enUS from "./en-US.json";

type AnyObject = Record<string, unknown>;

const flatten = (obj: AnyObject, prefix = ""): string[] => {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flatten(v as AnyObject, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
};

describe("i18n parity", () => {
  it("pt-BR and en-US expose the same key set", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    const ptOnly = ptKeys.filter((k) => !enKeys.includes(k));
    const enOnly = enKeys.filter((k) => !ptKeys.includes(k));
    expect(ptOnly).toEqual([]);
    expect(enOnly).toEqual([]);
  });

  it("includes the M8.5 PR-B goals namespace in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    expect(ptKeys).toContain("goals.list.title");
    expect(ptKeys).toContain("goals.plan.actions.approve");
    expect(ptKeys).toContain("goals.plan.history.empty");
    expect(enKeys).toContain("goals.list.title");
    expect(enKeys).toContain("goals.plan.actions.approve");
    expect(enKeys).toContain("goals.plan.history.empty");
  });

  it("includes the 3 new inbox kinds filters in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of ["goal_proposed", "goal_executing", "goal_error"]) {
      expect(ptKeys).toContain(`inbox.filter.${k}`);
      expect(enKeys).toContain(`inbox.filter.${k}`);
    }
  });

  it("includes the M9 PR-A multi-empresa keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "company.switcher.placeholder",
      "company.switcher.create",
      "company.switcher.createFirst",
      "company.switcher.deleteAria",
      "company.create.title",
      "company.create.namePlaceholder",
      "company.create.submit",
      "company.create.submitting",
      "company.create.errorEmpty",
      "company.delete.title",
      "company.delete.body",
      "company.delete.cascadeCounts",
      "company.delete.cascadeWarning",
      "company.delete.lastWarning",
      "company.delete.confirm",
      "company.delete.deleting",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M8.6 PR-B narrated keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.executor.title",
      "settings.executor.atomic",
      "settings.executor.narrated",
      "goals.plan.actions.narratedToggle",
      "goals.plan.actions.narratedTokenHint",
      "issues.detail.commentBadge.ceo",
      "issues.detail.commentBadge.agent",
      "issues.detail.commentBadge.user",
      "inbox.goalError.recovery.resumeNarrated",
      "inbox.goalError.recovery.rollback",
      "activity.action.issue.commented",
      "activity.action.issue.unlocked_by_deps",
      "activity.action.goal.narrated_step",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
});
