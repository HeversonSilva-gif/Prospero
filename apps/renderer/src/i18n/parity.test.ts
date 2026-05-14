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
});
