import type { ElectronApplication } from "@playwright/test";

// Wait until an IPC broadcast of a specific AgentEvent kind reaches the
// renderer. Implemented by injecting a listener in the renderer that resolves
// a promise tied back through Playwright's evaluate hook. Returns the event
// payload or throws on timeout.

export const waitForAgentEvent = async (
  app: ElectronApplication,
  predicate: string,
  timeoutMs = 10_000,
): Promise<unknown> => {
  const win = await app.firstWindow();
  return await win.evaluate(
    ({ predicateSource, timeoutMs }) =>
      new Promise((resolve, reject) => {
        const predicateFn = new Function("ev", `return (${predicateSource})(ev);`);
        const timer = setTimeout(() => reject(new Error("waitForAgentEvent timeout")), timeoutMs);
        const off = (
          window as unknown as {
            prospero: { agents: { onEvent: (cb: (ev: unknown) => void) => () => void } };
          }
        ).prospero.agents.onEvent((ev) => {
          if (predicateFn(ev) === true) {
            clearTimeout(timer);
            off();
            resolve(ev);
          }
        });
      }),
    { predicateSource: predicate, timeoutMs },
  );
};
