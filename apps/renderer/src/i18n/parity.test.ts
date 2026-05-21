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

  it("includes the M9 PR-E banner keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "banners.authError.message",
      "banners.authError.action",
      "banners.oauthExpiry.message_one",
      "banners.oauthExpiry.message_other",
      "banners.oauthExpiry.action",
      "banners.rateLimit.message",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
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

  it("includes the M9 PR-C agents-list + settings defaults keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "agents.list.title",
      "agents.list.new",
      "agents.list.empty",
      "agents.gallery.title",
      "agents.gallery.subtitle",
      "agents.gallery.empty",
      "agents.gallery.agentsCount",
      "settings.agentDefaults.title",
      "settings.agentDefaults.modeLabel",
      "settings.agentDefaults.alwaysOnLabel",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M9 PR-B dashboard widget keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "dashboard.title",
      "dashboard.emptyCompany",
      "dashboard.activeAgents.title",
      "dashboard.activeAgents.empty",
      "dashboard.activeIssues.title",
      "dashboard.activeIssues.viewAll",
      "dashboard.inboxUnread.title",
      "dashboard.inboxUnread.empty",
      "dashboard.activePanel.title",
      "dashboard.activePanel.empty",
      "dashboard.goals.title",
      "dashboard.goals.viewAll",
      "dashboard.recentActivity.title",
      "dashboard.recentActivity.empty",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M9 PR-D api-key keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "wizard.authSource.title",
      "wizard.authSource.oauthTitle",
      "wizard.authSource.apiKeyTitle",
      "wizard.apiKey.title",
      "wizard.apiKey.placeholder",
      "wizard.apiKey.save",
      "settings.authMode.title",
      "settings.authMode.oauth",
      "settings.authMode.apiKey",
      "settings.apiKey.placeholder",
      "settings.apiKey.save",
      "settings.apiKey.clear",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
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

  it("includes the M9 PR-F.2.1 company import keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.companyImport.title",
      "settings.companyImport.subtitle",
      "settings.companyImport.action",
      "settings.companyImport.importing",
      "settings.companyImport.success",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M9 PR-F.2.2 agents.md import/export keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.agentsMd.title",
      "settings.agentsMd.subtitle",
      "settings.agentsMd.actionImport",
      "settings.agentsMd.actionExport",
      "settings.agentsMd.hire",
      "settings.agentsMd.previewTitle",
      "settings.agentsMd.conflictHeader",
      "settings.agentsMd.conflictSkip",
      "settings.agentsMd.conflictReplace",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M9 PR-F.1 projects polish + company export keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "projects.form.icon",
      "projects.form.iconNone",
      "projects.list.showArchived",
      "projects.detail.archive",
      "projects.detail.unarchive",
      "settings.companyExport.title",
      "settings.companyExport.subtitle",
      "settings.companyExport.action",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M10 PR-D remote execution keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.remoteExecution.title",
      "settings.remoteExecution.enable",
      "settings.remoteExecution.modeLocal",
      "settings.remoteExecution.modeRemote",
      "settings.remoteExecution.vpsHost",
      "settings.remoteExecution.test",
      "agent.location.label",
      "agent.location.local",
      "agent.location.remote",
      "agent.location.hint",
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

  it("includes the M11 PR-C learning keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "agent.tabs.learning",
      "agent.learning.badgeTitle",
      "agent.learning.subtabs.skills",
      "agent.learning.subtabs.memory",
      "agent.learning.subtabs.history",
      "agent.learning.skills.empty",
      "agent.learning.memory.empty",
      "agent.learning.memory.kind.retrospective",
      "agent.learning.history.prompt",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M11 PR-D2 candidates keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "agent.learning.subtabs.candidates",
      "agent.learning.candidates.empty",
      "agent.learning.candidates.accept",
      "agent.learning.candidates.edit",
      "agent.learning.candidates.reject",
      "agent.learning.candidates.save",
      "agent.learning.candidates.cancel",
      "agent.learning.candidates.error",
      "agent.learning.candidates.trigger.issue_done",
      "agent.learning.candidates.trigger.recovery",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M11 PR-E skill-promotion keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "inbox.skillPromotion.review",
      "inbox.skillPromotion.title",
      "inbox.skillPromotion.roleLabel",
      "inbox.skillPromotion.allRoles",
      "inbox.skillPromotion.approve",
      "inbox.skillPromotion.cancel",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M11 PR-E org-learnings widget keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "dashboard.orgLearnings.title",
      "dashboard.orgLearnings.skills",
      "dashboard.orgLearnings.retrospectives",
      "dashboard.orgLearnings.empty",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M11 PR-F trust-feedback keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of ["agent.learning.skills.rateUp", "agent.learning.skills.rateDown"]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M11 PR-F2 memory-settings keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.memory.title",
      "settings.memory.subtitle",
      "settings.memory.userMemoryLabel",
      "settings.memory.import",
      "settings.memory.save",
      "settings.memory.saved",
      "settings.memory.overCap",
      "settings.memory.derivationBudgetLabel",
      "settings.memory.derivationBudgetHint",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });

  it("includes the M11 PR-F2 terminate-promote keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of ["agent.terminate.promoteTitle", "agent.terminate.promoteHint"]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
});
