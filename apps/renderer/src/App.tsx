import { useEffect, lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSettingsStore } from "./stores/settings.js";
import { useAuthStore } from "./stores/auth.js";
import { useAgentsStore } from "./stores/agents.js";
import { useMessagesStore } from "./stores/messages.js";
import { useInboxStore } from "./stores/inbox.js";
import { useCompaniesStore } from "./stores/companies.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Ajustes } from "./routes/Ajustes.js";
import { AjustesConta } from "./routes/AjustesConta.js";
import { AjustesPreferencias } from "./routes/AjustesPreferencias.js";
import { AjustesAvancado } from "./routes/AjustesAvancado.js";
import { AjustesGovernanca } from "./routes/AjustesGovernanca.js";
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
import { AgentNew } from "./routes/AgentNew.js";
import { AgentAjustar } from "./routes/AgentAjustar.js";
import { TitleBar } from "./components/TitleBar.js";
import { AuthErrorBanner } from "./components/banners/AuthErrorBanner.js";
import { OAuthExpiryBanner } from "./components/banners/OAuthExpiryBanner.js";
import { RateLimitBanner } from "./components/banners/RateLimitBanner.js";
import { UpdateBanner } from "./components/UpdateBanner.js";

const Activity = lazy(() => import("./routes/Activity.js").then((m) => ({ default: m.Activity })));
const Costs = lazy(() => import("./routes/Costs.js"));
const Goals = lazy(() => import("./routes/Goals.js"));
const PedirAlgo = lazy(() => import("./routes/PedirAlgo.js"));
const NovaEmpresaWizard = lazy(() => import("./routes/NovaEmpresaWizard.js"));
const PlanoRevisao = lazy(() => import("./routes/PlanoRevisao.js"));
const GoalDetail = lazy(() => import("./routes/GoalDetail.js"));
const Agents = lazy(() => import("./routes/Agents.js").then((m) => ({ default: m.Agents })));

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col h-screen overflow-hidden bg-surface">
    <TitleBar />
    <AuthErrorBanner />
    <OAuthExpiryBanner />
    <RateLimitBanner />
    <div className="flex-1 min-h-0 flex">{children}</div>
    <UpdateBanner />
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
  const companiesLoaded = useCompaniesStore((s) => s.loaded);
  const companyCount = useCompaniesStore((s) => s.companies.length);

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
        case "trust-tier-changed":
          applyTrustTier(ev.agentId, ev.tier);
          break;
        case "tool-call":
        case "error":
        case "costs-new":
        case "rate-limited":
          // Handled by dedicated hooks/banners (useCostsStream, useCostsToday,
          // RateLimitBanner), not this global reducer.
          break;
        default: {
          // Exhaustiveness guard: a new AgentEvent kind becomes a compile error
          // here instead of being silently dropped.
          const _never: never = ev;
          void _never;
        }
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

  const loading = !settingsLoaded || !authLoaded || (hasToken && !companiesLoaded);

  // First-run is over only once the user is authenticated AND has a company
  // (created via the onboarding wizard, which also seeds the CEO). Until then,
  // every app route funnels back to /setup.
  const appReady = hasToken && companyCount > 0;

  // HashRouter must wrap Shell: the banners inside Shell call router hooks, so
  // they would crash if rendered (e.g. during loading) outside the router.
  return (
    <HashRouter>
      <Shell>
        {loading ? (
          <div className="flex-1 flex items-center justify-center bg-surface-soft">
            <p className="text-ink-muted">Loading…</p>
          </div>
        ) : (
          <Routes>
            <Route
              path="/setup"
              element={appReady ? <Navigate to="/briefing" replace /> : <SetupWizard />}
            />
            <Route
              path="/briefing"
              element={
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                  <Ajustes />
                </Layout>
              }
            />
            <Route
              path="/settings/conta"
              element={
                appReady ? (
                  <Layout>
                    <AjustesConta />
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/settings/preferencias"
              element={
                <Layout>
                  <AjustesPreferencias />
                </Layout>
              }
            />
            <Route
              path="/settings/avancado"
              element={
                appReady ? (
                  <Layout>
                    <AjustesAvancado />
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/settings/governanca-assincrona"
              element={
                appReady ? (
                  <Layout>
                    <AjustesGovernanca />
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/inbox"
              element={
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
                  <Layout>
                    <Telos />
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/activity"
              element={
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
                  <Layout>
                    <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                      <PedirAlgo />
                    </Suspense>
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/empresa/nova/:companyId"
              element={
                appReady ? (
                  <Layout>
                    <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                      <NovaEmpresaWizard />
                    </Suspense>
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/pedir/:goalId"
              element={
                appReady ? (
                  <Layout>
                    <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                      <PedirAlgo />
                    </Suspense>
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route
              path="/pedir/:goalId/plano"
              element={
                appReady ? (
                  <Layout>
                    <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
                      <PlanoRevisao />
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
                appReady ? (
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
                appReady ? (
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
                appReady ? (
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
            <Route
              path="/agents/:id/ajustar"
              element={
                appReady ? (
                  <Layout>
                    <AgentAjustar />
                  </Layout>
                ) : (
                  <Navigate to="/setup" replace />
                )
              }
            />
            <Route path="*" element={<Navigate to={appReady ? "/briefing" : "/setup"} replace />} />
          </Routes>
        )}
      </Shell>
    </HashRouter>
  );
};
