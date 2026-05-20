import { useEffect, lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSettingsStore } from "./stores/settings.js";
import { useAuthStore } from "./stores/auth.js";
import { useAgentsStore } from "./stores/agents.js";
import { useMessagesStore } from "./stores/messages.js";
import { useInboxStore } from "./stores/inbox.js";
import { useCompaniesStore } from "./stores/companies.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Settings } from "./routes/Settings.js";
import { SetupWizard } from "./routes/SetupWizard.js";
import { Agent as AgentRoute } from "./routes/Agent.js";
import { OrgPlan } from "./routes/OrgPlan.js";
import { Inbox } from "./routes/Inbox.js";
import { Projects } from "./routes/Projects.js";
import { useProjectsStore } from "./stores/projects.js";
import { Issues } from "./routes/Issues.js";
import { useIssuesStore } from "./stores/issues.js";
import { Roles } from "./routes/Roles.js";
import { Telos } from "./routes/Telos.js";
import { Briefing } from "./routes/Briefing.js";
import { Sidebar } from "./components/layout/Sidebar.js";
import { Routines } from "./routes/Routines.js";
import { RoutineForm } from "./routes/RoutineForm.js";
import { Org } from "./routes/Org.js";
import { AgentNew } from "./routes/AgentNew.js";
import { TitleBar } from "./components/TitleBar.js";
import { AuthErrorBanner } from "./components/banners/AuthErrorBanner.js";
import { OAuthExpiryBanner } from "./components/banners/OAuthExpiryBanner.js";
import { RateLimitBanner } from "./components/banners/RateLimitBanner.js";

const Activity = lazy(() => import("./routes/Activity.js").then((m) => ({ default: m.Activity })));
const Costs = lazy(() => import("./routes/Costs.js"));
const Goals = lazy(() => import("./routes/Goals.js"));
const GoalNew = lazy(() => import("./routes/GoalNew.js"));
const GoalDetail = lazy(() => import("./routes/GoalDetail.js"));
const Agents = lazy(() => import("./routes/Agents.js").then((m) => ({ default: m.Agents })));

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col h-screen overflow-hidden bg-surface">
    <TitleBar />
    <AuthErrorBanner />
    <OAuthExpiryBanner />
    <RateLimitBanner />
    <div className="flex-1 min-h-0 flex">{children}</div>
  </div>
);

const Layout = ({ children }: { children: React.ReactNode }) => (
  <>
    <Sidebar />
    <main className="flex-1 overflow-auto">{children}</main>
  </>
);

export const App = () => {
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.load);
  const authLoaded = useAuthStore((s) => s.loaded);
  const loadAuth = useAuthStore((s) => s.load);
  const hasToken = useAuthStore((s) => s.status.hasToken);
  const loadAgents = useAgentsStore((s) => s.load);
  const applyAgentStatus = useAgentsStore((s) => s.applyAgentStatus);
  const applyCurrentAction = useAgentsStore((s) => s.applyCurrentAction);
  const applySessionId = useAgentsStore((s) => s.applySessionId);
  const applyTrustTier = useAgentsStore((s) => s.applyTrustTier);
  const appendMessage = useMessagesStore((s) => s.append);
  const patchToolCall = useMessagesStore((s) => s.patchToolCallResult);
  const loadInbox = useInboxStore((s) => s.load);

  useEffect(() => {
    void loadSettings();
    void loadAuth();
  }, [loadSettings, loadAuth]);

  const loadCompanies = useCompaniesStore((s) => s.load);
  const activeCompanyId = useCompaniesStore((s) => s.activeId);

  // Initial companies load once auth is ready.
  useEffect(() => {
    if (!hasToken) return;
    void loadCompanies();
  }, [hasToken, loadCompanies]);

  // React to active company changes — reload per-company stores.
  useEffect(() => {
    if (!hasToken || activeCompanyId === null) return;
    void (async () => {
      await loadAgents(activeCompanyId);
      await loadInbox(activeCompanyId);
      await useProjectsStore.getState().load(activeCompanyId);
      await useIssuesStore.getState().load(activeCompanyId);
    })();
  }, [hasToken, activeCompanyId, loadAgents, loadInbox]);

  // Permanent inbox-update subscription. Reloads only when active company matches.
  useEffect(() => {
    if (!hasToken) return;
    const off = window.prospero.inbox.onUpdate(() => {
      const cid = useCompaniesStore.getState().activeId;
      if (cid !== null) void loadInbox(cid);
    });
    return off;
  }, [hasToken, loadInbox]);

  // Subscribe to agent:event broadcasts
  useEffect(() => {
    const off = window.prospero.agents.onEvent((ev) => {
      switch (ev.kind) {
        case "message-append":
          appendMessage(ev.message);
          break;
        case "tool-result":
          patchToolCall(ev.threadId, ev.toolCallId, ev.result);
          break;
        case "status-changed":
          applyAgentStatus(ev.agentId, ev.status);
          break;
        case "current-action-changed":
          applyCurrentAction(ev.agentId, ev.action);
          break;
        case "session-id-changed":
          applySessionId(ev.agentId, ev.sessionId);
          break;
        case "roster-changed": {
          const activeId = useCompaniesStore.getState().activeId;
          if (activeId === ev.companyId) void loadAgents(ev.companyId);
          break;
        }
        case "tool-call":
        case "error":
          break;
      }
    });
    return off;
  }, [
    appendMessage,
    patchToolCall,
    applyAgentStatus,
    applyCurrentAction,
    applySessionId,
    applyTrustTier,
    loadAgents,
  ]);

  if (!settingsLoaded || !authLoaded) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center bg-surface-soft">
          <p className="text-ink-muted">Loading…</p>
        </div>
      </Shell>
    );
  }

  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route
            path="/setup"
            element={hasToken ? <Navigate to="/briefing" replace /> : <SetupWizard />}
          />
          <Route
            path="/briefing"
            element={
              hasToken ? (
                <Layout>
                  <Briefing />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/routines"
            element={
              hasToken ? (
                <Layout>
                  <Routines />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/routines/new"
            element={
              hasToken ? (
                <Layout>
                  <RoutineForm />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/routines/:id"
            element={
              hasToken ? (
                <Layout>
                  <RoutineForm />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/dashboard"
            element={
              hasToken ? (
                <Layout>
                  <Dashboard />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/settings"
            element={
              <Layout>
                <Settings />
              </Layout>
            }
          />
          <Route
            path="/inbox"
            element={
              hasToken ? (
                <Layout>
                  <Inbox />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/org-plan"
            element={
              hasToken ? (
                <Layout>
                  <OrgPlan />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/projects"
            element={
              hasToken ? (
                <Layout>
                  <Projects />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/issues"
            element={
              hasToken ? (
                <Layout>
                  <Issues />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/roles"
            element={
              hasToken ? (
                <Layout>
                  <Roles />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/telos"
            element={
              hasToken ? (
                <Layout>
                  <Telos />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/org"
            element={
              hasToken ? (
                <Layout>
                  <Org />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/activity"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <Activity />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/costs"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <Costs />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/goals"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <Goals />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/goals/new"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <GoalNew />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/goals/:id"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <GoalDetail />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/agents"
            element={
              hasToken ? (
                <Layout>
                  <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                    <Agents />
                  </Suspense>
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/agents/new"
            element={
              hasToken ? (
                <Layout>
                  <AgentNew />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
          <Route
            path="/agents/:id"
            element={
              <Layout>
                <AgentRoute />
              </Layout>
            }
          />
          <Route path="*" element={<Navigate to={hasToken ? "/briefing" : "/setup"} replace />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
};
