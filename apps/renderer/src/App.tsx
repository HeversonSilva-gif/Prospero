import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AgentStatus } from "@dashboard-agent/shared";
import { useSettingsStore } from "./stores/settings.js";
import { useAuthStore } from "./stores/auth.js";
import { useAgentsStore } from "./stores/agents.js";
import { useMessagesStore } from "./stores/messages.js";
import { useInboxStore } from "./stores/inbox.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Settings } from "./routes/Settings.js";
import { SetupWizard } from "./routes/SetupWizard.js";
import { Agent as AgentRoute } from "./routes/Agent.js";
import { Inbox } from "./routes/Inbox.js";
import { Projects } from "./routes/Projects.js";
import { useProjectsStore } from "./stores/projects.js";
import { Issues } from "./routes/Issues.js";
import { useIssuesStore } from "./stores/issues.js";
import { Skills } from "./routes/Skills.js";
import { Org } from "./routes/Org.js";
import { Activity } from "./routes/Activity.js";
import { AgentNew } from "./routes/AgentNew.js";
import { SidebarFooter } from "./components/SidebarFooter.js";
import { TitleBar } from "./components/TitleBar.js";

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "bg-ink-soft",
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
  error: "bg-semantic-danger",
  paused: "bg-semantic-warning",
  terminated: "bg-ink-soft",
};

const Sidebar = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const inboxUnread = useInboxStore((s) => s.unread);
  return (
    <aside className="w-56 bg-surface border-r border-surface-border flex flex-col p-3">
      <h1 className="px-2 mb-4 text-sm font-bold text-brand-dark">{t("app.title")}</h1>
      <nav className="flex flex-col gap-1 text-sm text-ink-muted">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.dashboard")}
        </NavLink>
        <NavLink
          to="/inbox"
          className={({ isActive }) =>
            `px-2 py-1 rounded flex items-center justify-between ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          <span>{t("nav.inbox")}</span>
          {inboxUnread > 0 && (
            <span className="text-[10px] font-bold bg-semantic-danger text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {inboxUnread}
            </span>
          )}
        </NavLink>
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.projects")}
        </NavLink>
        <NavLink
          to="/issues"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.issues")}
        </NavLink>
        <NavLink
          to="/org"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.orgChart")}
        </NavLink>
        <NavLink
          to="/skills"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.skills")}
        </NavLink>
        <NavLink
          to="/activity"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.activity")}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.settings")}
        </NavLink>
      </nav>
      <div className="flex justify-between items-center mt-4 mb-2 px-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
          {t("nav.agents")}
        </div>
        <NavLink
          to="/agents/new"
          className="text-[10px] text-brand hover:underline font-normal normal-case"
        >
          + {t("agent.new.shortLabel")}
        </NavLink>
      </div>
      {agents.length > 0 && (
        <nav className="flex flex-col gap-1 text-sm text-ink-muted">
          {agents.map((a) => {
            const showAction =
              (a.status === "working" || a.status === "thinking") &&
              a.currentAction !== null &&
              a.currentAction !== "";
            return (
              <NavLink
                key={a.id}
                to={`/agents/${a.id}`}
                className={({ isActive }) =>
                  `px-2 py-1 rounded flex flex-col gap-0.5 ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
                }
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[a.status]}`}
                    title={a.status}
                  />
                  <span className="truncate">{a.name}</span>
                </span>
                {showAction && (
                  <span className="pl-3.5 text-[10px] italic text-ink-soft truncate">
                    {a.currentAction}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      )}
      <SidebarFooter />
    </aside>
  );
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col h-screen overflow-hidden bg-surface">
    <TitleBar />
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
  const appendMessage = useMessagesStore((s) => s.append);
  const patchToolCall = useMessagesStore((s) => s.patchToolCallResult);
  const loadInbox = useInboxStore((s) => s.load);

  useEffect(() => {
    void loadSettings();
    void loadAuth();
  }, [loadSettings, loadAuth]);

  // After token is configured, ensure first company's agents and inbox are loaded.
  // Initial load only — subscription is registered separately below so it survives
  // late-arriving companies (e.g. user created demo company after first mount).
  useEffect(() => {
    if (!hasToken) return;
    void (async () => {
      const companies = await window.dashboardAgent.companies.list();
      if (companies.length > 0) {
        const cid = companies[0]!.id;
        await loadAgents(cid);
        await loadInbox(cid);
        await useProjectsStore.getState().load(cid);
        await useIssuesStore.getState().load(cid);
      }
    })();
  }, [hasToken, loadAgents, loadInbox]);

  // Permanent inbox-update subscription. On every broadcast, re-resolve the current
  // company (via fresh companies.list()) and reload its inbox. This works whether or
  // not a company existed at App mount time.
  useEffect(() => {
    if (!hasToken) return;
    const off = window.dashboardAgent.inbox.onUpdate(() => {
      void (async () => {
        const companies = await window.dashboardAgent.companies.list();
        if (companies.length > 0) {
          await loadInbox(companies[0]!.id);
        }
      })();
    });
    return off;
  }, [hasToken, loadInbox]);

  // Subscribe to agent:event broadcasts
  useEffect(() => {
    const off = window.dashboardAgent.agents.onEvent((ev) => {
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
        case "roster-changed":
          void loadAgents(ev.companyId);
          break;
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
            element={hasToken ? <Navigate to="/dashboard" replace /> : <SetupWizard />}
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
            path="/skills"
            element={
              hasToken ? (
                <Layout>
                  <Skills />
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
                  <Activity />
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
          <Route path="*" element={<Navigate to={hasToken ? "/dashboard" : "/setup"} replace />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
};
