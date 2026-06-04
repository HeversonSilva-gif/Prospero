import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, findActiveCeo, type BusinessPlan } from "@prospero/shared";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createSettingsRepository } from "../settings/repository.js";
import { applyBusinessPlan } from "../agents/apply-business-plan.js";
import { businessPlanToTelosAnswers } from "../agents/genesis/business-plan-to-telos.js";
import { synthesizeTelos, buildFallbackTelos } from "../companies/telos-synthesis.js";
import { writeTelos as writeTelosFile } from "../companies/telos-store.js";
import { companyTelosPath } from "../companies/telos-dir.js";
import type { RunDerivationResult } from "../derivation/runner.js";
import { runDerivation, defaultRunProcess } from "../derivation/runner.js";
import { buildAuthEnv } from "../derivation/index.js";

// C3/I4 (audit 2026-06-04) — MAIN-side bridge for re-engaging the author CEO
// after a business plan is approved. registerBusinessPlanHandlers runs inside
// handlers.ts WITHOUT access to the orchestrator's deliverSystemMessage closure,
// so the orchestrator publishes it here at boot (mirrors setApprovalEngineBridge
// / setRecoveryBroadcastFn). Null until the orchestrator is registered (which
// always happens before this handler can fire an IPC).
let deliverSystemMessageBridge: ((agentId: string, text: string) => void) | null = null;
export const setBusinessPlanDeliverBridge = (fn: (agentId: string, text: string) => void): void => {
  deliverSystemMessageBridge = fn;
};

// C3 — the system message that re-engages the CEO to propose the team. The
// genesis system prompt already promises "you will be asked to propose the team
// (submit_org_plan)"; this is the code that finally fulfills it.
export const formatProposeTeamRequest = (brandName: string): string =>
  [
    "[PROPOSE_TEAM]",
    `O dono aprovou o negócio "${brandName}". Agora proponha o time.`,
    "",
    "Desenhe a organização que este negócio precisa — papéis (cada um com um",
    "charter completo), agentes e a hierarquia — e envie com a ferramenta",
    "submit_org_plan. Mantenha enxuto: só os papéis que o negócio realmente",
    "precisa. Nada é criado até o dono revisar e aprovar a proposta.",
  ].join("\n");

// I4 — informational FYI that TELOS synthesis failed. A deterministic fallback is
// already written, so the company is not purpose-less. The CEO has NO tool to rewrite
// the TELOS (only the owner can, via the purpose screen), so this is a no-action notice
// — it must NOT ask the CEO to "generate a better TELOS" (it would burn a turn trying
// to use a tool that doesn't exist). (review 2026-06-04)
export const formatTelosRetryRequest = (brandName: string): string =>
  [
    "[TELOS_AVISO]",
    `A síntese do propósito (TELOS) de "${brandName}" falhou e foi preenchida com um`,
    "rascunho mínimo a partir do plano. Você não precisa fazer nada — o dono pode",
    "revisar e salvar o propósito final pela tela de Propósito. Siga com o trabalho.",
  ].join("\n");

export type ApproveBusinessPlanDeps = {
  // Must return RunDerivationResult so it is assignable to synthesizeTelos's deps.
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  env: Record<string, string>;
  writeTelos: (userDataDir: string, companyId: string, body: string) => void;
  setTelosPath: (companyId: string, telosPath: string) => void;
  // C3/I4 — re-engage the author CEO (propose-the-team + TELOS-retry signals).
  // Optional so legacy/unit callers that only test apply+TELOS can omit it.
  deliverSystemMessage?: (agentId: string, text: string) => void;
};

// Testable core: apply the plan synchronously, then synthesize the TELOS
// (fail-soft — approval already succeeded; a TELOS failure must not block genesis).
export const approveBusinessPlan = async (
  db: Database.Database,
  userDataDir: string,
  businessPlanId: string,
  deps: ApproveBusinessPlanDeps,
  chosenIndex: number | null = null,
): Promise<{ ok: boolean; error?: string }> => {
  const repo = createBusinessPlansRepository(db);
  const applied = applyBusinessPlan(db, businessPlanId, chosenIndex);
  if (!applied.ok) return { ok: false, error: applied.error };
  // Re-read the plan after apply so TELOS synthesis uses the chosen option's fields.
  const plan = repo.getById(businessPlanId);
  // Route re-engagement to the ACTIVE CEO, not the stored author — the author may have
  // been terminated mid-genesis, in which case its thread is dead and the message would
  // be lost. Fall back to the stored author id if no active CEO is found. (review 2026-06-04)
  let teamCeoId = applied.ceoAgentId;
  if (plan !== null) {
    const activeCeo = findActiveCeo(createAgentsRepository(db).listByCompany(plan.companyId));
    if (activeCeo !== null) teamCeoId = activeCeo.id;
    const answers = businessPlanToTelosAnswers(plan);
    try {
      const result = await synthesizeTelos(
        { db, runDerivation: deps.runDerivation },
        { answers, env: deps.env, companyId: plan.companyId },
      );
      // I4 — surface (log) the partial-TELOS validation warnings that were
      // previously discarded; the body is still usable so we persist it.
      if (result.error !== undefined && result.error.length > 0) {
        console.warn(
          `[telos] synthesized TELOS for ${plan.companyId} has issues: ${result.error.join("; ")}`,
        );
      }
      if (result.telos !== null) {
        deps.writeTelos(userDataDir, plan.companyId, result.telos);
        deps.setTelosPath(plan.companyId, companyTelosPath(userDataDir, plan.companyId));
      }
    } catch (e) {
      // I4 — synthesis failed (401 / rate-limit / empty / sanitizer-reject). Do
      // NOT leave the company purpose-less: write a deterministic fallback TELOS
      // built from the plan and set the path, then signal the CEO to retry. All
      // of this is itself fail-soft — a fallback-write error must not block the
      // approval (rename + identity already committed).
      try {
        const fallback = buildFallbackTelos(answers);
        deps.writeTelos(userDataDir, plan.companyId, fallback);
        deps.setTelosPath(plan.companyId, companyTelosPath(userDataDir, plan.companyId));
        console.warn(
          `[telos] synthesis failed for ${plan.companyId}; wrote fallback TELOS: ${String(e)}`,
        );
        deliver(deps, teamCeoId, formatTelosRetryRequest(plan.identity.name));
      } catch (fe) {
        console.warn(
          `[telos] fallback TELOS write also failed for ${plan.companyId}: ${String(fe)}`,
        );
      }
    }
  }
  // C3 — fulfill the genesis promise: re-engage the (active) CEO to propose the
  // team now that the business is approved. Done regardless of TELOS outcome.
  deliver(deps, teamCeoId, formatProposeTeamRequest(applied.brandName));
  return { ok: true };
};

// Routes a re-engagement message through the injected dep (tests) or the
// MAIN bridge (production). No-op if neither is wired (fail-soft).
const deliver = (deps: ApproveBusinessPlanDeps, agentId: string, text: string): void => {
  const fn = deps.deliverSystemMessage ?? deliverSystemMessageBridge;
  if (fn !== null && fn !== undefined) fn(agentId, text);
};

export const registerBusinessPlanHandlers = (db: Database.Database): void => {
  const repo = createBusinessPlansRepository(db);

  ipcMain.handle(IPC.BUSINESS_PLAN_GET_CURRENT, (): BusinessPlan | null => {
    const companyId = createSettingsRepository(db).read().activeCompanyId;
    if (companyId === null) return null;
    return repo.getCurrentForCompany(companyId);
  });

  ipcMain.handle(
    IPC.BUSINESS_PLAN_APPROVE,
    async (
      _e,
      payload: { businessPlanId: string; chosenIndex: number | null },
    ): Promise<{ ok: boolean; error?: string }> => {
      const userDataDir = app.getPath("userData");
      const companies = createCompaniesRepository(db);
      return approveBusinessPlan(
        db,
        userDataDir,
        payload.businessPlanId,
        {
          runDerivation: (i) => runDerivation({ runProcess: defaultRunProcess }, i),
          env: buildAuthEnv(db),
          writeTelos: writeTelosFile,
          setTelosPath: (companyId, telosPath) => companies.setTelosPath(companyId, telosPath),
        },
        payload.chosenIndex,
      );
    },
  );

  ipcMain.handle(
    IPC.BUSINESS_PLAN_REJECT,
    (_e, payload: { businessPlanId: string; reason?: string }): { ok: true } => {
      repo.markRejected(payload.businessPlanId, payload.reason ?? null);
      return { ok: true };
    },
  );
};
