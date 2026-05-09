import { useEffect, useState } from "react";

export const App = () => {
  const [pong, setPong] = useState<string>("(waiting)");
  const isElectron = typeof window.dashboardAgent !== "undefined";

  useEffect(() => {
    if (!isElectron) {
      setPong("(open this app via Electron, not the browser)");
      return;
    }
    window.dashboardAgent
      .ping()
      .then(setPong)
      .catch((err: unknown) => {
        setPong(`error: ${String(err)}`);
      });
  }, [isElectron]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-soft">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-brand-dark">Dashboard Agent</h1>
        <p className="text-ink-muted">IPC ping → {pong}</p>
      </div>
    </div>
  );
};
