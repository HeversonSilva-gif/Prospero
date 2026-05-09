import { useEffect, useState } from "react";

export const App = (): JSX.Element => {
  const [pong, setPong] = useState<string>("(waiting)");

  useEffect(() => {
    void window.dashboardAgent.ping().then(setPong);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-brand-dark">Dashboard Agent</h1>
        <p className="text-ink-muted">IPC ping → {pong}</p>
      </div>
    </div>
  );
};
