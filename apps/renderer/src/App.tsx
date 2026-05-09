import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSettingsStore } from "./stores/settings.js";
import { useAuthStore } from "./stores/auth.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Settings } from "./routes/Settings.js";
import { SetupWizard } from "./routes/SetupWizard.js";
import { SidebarFooter } from "./components/SidebarFooter.js";

const Sidebar = () => (
  <aside className="w-56 bg-surface border-r border-surface-border flex flex-col p-3">
    <h1 className="px-2 mb-4 text-sm font-bold text-brand-dark">Dashboard Agent</h1>
    <nav className="flex flex-col gap-1 text-sm text-ink-muted">
      <a href="#/dashboard" className="px-2 py-1 hover:bg-surface-soft rounded">
        Dashboard
      </a>
      <a href="#/settings" className="px-2 py-1 hover:bg-surface-soft rounded">
        Settings
      </a>
    </nav>
    <SidebarFooter />
  </aside>
);

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

  useEffect(() => {
    void loadSettings();
    void loadAuth();
  }, [loadSettings, loadAuth]);

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
        <Route path="*" element={<Navigate to={hasToken ? "/dashboard" : "/setup"} replace />} />
      </Routes>
    </HashRouter>
  );
};
