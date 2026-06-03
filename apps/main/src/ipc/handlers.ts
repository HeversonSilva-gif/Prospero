import { ipcMain, app } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { registerSettingsHandlers } from "./settings-handlers.js";
import { registerAuthHandlers } from "./auth-handlers.js";
import { registerConnectionsHandlers } from "./connections-handlers.js";
import { registerAttachmentHandlers } from "./attachment-handlers.js";
import { registerCompaniesHandlers } from "./companies-handlers.js";
import { registerMessagesHandlers } from "./messages-handlers.js";
import { registerOrchestratorHandlers } from "./orchestrator-handlers.js";
import { registerPermissionHandlers } from "./permission-handlers.js";
import { registerInboxHandlers } from "./inbox-handlers.js";
import { registerProjectsHandlers } from "./projects-handlers.js";
import { registerIssuesHandlers } from "./issues-handlers.js";
import { registerRolesHandlers } from "./roles-handlers.js";
import { registerActivityHandlers } from "./activity-handlers.js";
import { registerCostsHandlers } from "./costs-handlers.js";
import { registerFinanceHandlers } from "./finance-handlers.js";
import { registerRunsHandlers } from "./runs-handlers.js";
import { registerAgentsMdHandlers } from "./agents-md-handlers.js";
import { registerLearningHandlers } from "./learning-handlers.js";
import { registerInstructionsHandlers } from "./instructions-handlers.js";
import { registerOrgPlanHandlers } from "./org-plan-handlers.js";
import { registerBusinessPlanHandlers } from "./business-plan-handlers.js";
import { registerIsaHandlers } from "./isa-handlers.js";
import { registerTelosHandlers } from "./telos-handlers.js";
import { registerSecurityHandlers } from "./security-handlers.js";
import { registerTrustHandlers } from "./trust-handlers.js";
import { registerBriefingHandlers } from "./briefing-handlers.js";
import { registerApprovalHandlers } from "./approval-handlers.js";
import { registerGovernanceHandlers } from "./governance-handlers.js";
import type { ActivityEventRow } from "@prospero/shared";
import { initRecorder } from "../activity/index.js";
import { initInbox, createInboxRepository } from "../inbox/index.js";
import { initDerivation } from "../derivation/index.js";
import { initRoutinesEngine, tryGetRoutinesEngine } from "../routines/index.js";
import { recoverStuckVerifications } from "../verification/index.js";
import { buildVerificationDeps } from "../verification/deps.js";
import { initRecall } from "../recall/index.js";

export const registerIpcHandlers = (db: Database.Database): { stopScheduler: () => void } => {
  ipcMain.handle(IPC.PING, () => "pong");
  const derivation = initDerivation(db);
  // recall.onActivity is set after the orchestrator (and thus the router) is
  // ready. We capture a late-bound reference so initRecorder can be called
  // first (keeping the recorder available to createAgentsRepository at boot).
  let recallOnActivity: ((row: ActivityEventRow) => void) | null = null;
  initRecorder(db, (row) => {
    derivation.onActivity(row);
    tryGetRoutinesEngine()?.onActivity(row);
    recallOnActivity?.(row);
  });
  initRoutinesEngine(db);
  initInbox(createInboxRepository(db));
  // Fire-and-forget: at most a handful of goals can be stuck `verifying` at
  // restart (single-user scale) — no throttle needed.
  recoverStuckVerifications(db, buildVerificationDeps());
  registerSettingsHandlers(db);
  registerAuthHandlers(db);
  registerConnectionsHandlers(db);
  registerCompaniesHandlers(db);
  registerMessagesHandlers(db);
  const { stopScheduler, router } = registerOrchestratorHandlers(db);
  recallOnActivity = initRecall(db, router).onActivity;
  registerPermissionHandlers(db);
  registerInboxHandlers(db);
  registerProjectsHandlers(db);
  registerIssuesHandlers(db);
  registerRolesHandlers(db);
  registerActivityHandlers(db);
  registerCostsHandlers(db);
  registerFinanceHandlers(db);
  registerRunsHandlers(db);
  registerAgentsMdHandlers(db);
  registerLearningHandlers(db);
  registerInstructionsHandlers(db);
  registerOrgPlanHandlers(db);
  registerBusinessPlanHandlers(db);
  registerIsaHandlers(db);
  registerTelosHandlers(db);
  registerSecurityHandlers(db);
  registerTrustHandlers(db);
  registerBriefingHandlers(db);
  registerApprovalHandlers(db);
  registerGovernanceHandlers(db);
  registerAttachmentHandlers(db, () => app.getPath("userData"));
  return { stopScheduler };
};
