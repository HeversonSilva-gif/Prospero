import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "./stores/settings.js";
import { useAuthStore } from "./stores/auth.js";
import { useAgentsStore } from "./stores/agents.js";
import { useMessagesStore } from "./stores/messages.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Settings } from "./routes/Settings.js";
import { SetupWizard } from "./routes/SetupWizard.js";
import { Agent as AgentRoute } from "./routes/Agent.js";
import { SidebarFooter } from "./components/SidebarFooter.js";

const Sidebar = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
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
          to="/settings"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.settings")}
        </NavLink>
      </nav>
      {agents.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-ink-soft mt-4 mb-2 px-2 font-semibold">
            {t("nav.agents")}
          </div>
          <nav className="flex flex-col gap-1 text-sm text-ink-muted">
            {agents.map((a) => (
              <NavLink
                key={a.id}
                to={`/agents/${a.id}`}
                className={({ isActive }) =>
                  `px-2 py-1 rounded flex items-center gap-2 ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    a.status === "idle" ? "bg-ink-soft" : "bg-semantic-success"
                  }`}
                />
                <span className="truncate">{a.name}</span>
              </NavLink>
            ))}
          </nav>
        </>
      )}
      <SidebarFooter />
    </aside>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen flex">
    <Sidebar />
    <main className="flex-1 overflow-auto">{children}</main>
  </div>
);

export const App = () => {
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.load);
  const authLoaded = useAuthStore((s) => s.loaded);
  const loadAuth = useAuthStore((s) => s.load);
  const hasToken = useAuthStore((s) => s.status.hasToken);
  const loadAgents = useAgentsStore((s) => s.load);
  const applyStatus = useAgentsStore((s) => s.applyStatus);
  const appendMessage = useMessagesStore((s) => s.append);
  const patchToolCall = useMessagesStore((s) => s.patchToolCallResult);

  useEffect(() => {
    void loadSettings();
    void loadAuth();
  }, [loadSettings, loadAuth]);

  // After token is configured, ensure first company's agents are loaded so sidebar shows them
  useEffect(() => {
    const init = async () => {
      if (!hasToken) return;
      const companies = await window.dashboardAgent.companies.list();
      if (companies.length > 0) {
        await loadAgents(companies[0]!.id);
      }
    };
    void init();
  }, [hasToken, loadAgents]);

  // Subscribe to agent:event broadcasts
  useEffect(() => {
    const off = window.dashboardAgent.agents.onEvent((ev) => {
      if (ev.kind === "message-append") appendMessage(ev.message);
      else if (ev.kind === "tool-result") patchToolCall(ev.threadId, ev.toolCallId, ev.result);
      else if (ev.kind === "status") applyStatus(ev.agentId, ev.status, ev.currentAction);
    });
    return off;
  }, [appendMessage, patchToolCall, applyStatus]);

  if (!settingsLoaded || !authLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-soft">
        <p className="text-ink-muted">Loading…</p>
      </div>
    );
  }

  return (
    <HashRouter>
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
          path="/agents/:id"
          element={
            <Layout>
              <AgentRoute />
            </Layout>
          }
        />
        <Route path="*" element={<Navigate to={hasToken ? "/dashboard" : "/setup"} replace />} />
      </Routes>
    </HashRouter>
  );
};
