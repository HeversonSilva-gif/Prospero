import { BrowserWindow, shell, session } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mirrors the renderer <meta http-equiv="Content-Security-Policy"> in
// apps/renderer/index.html EXACTLY. Enforced as a real response header here so
// the policy applies even to content the renderer cannot constrain via a meta
// tag (and cannot be relaxed by author-controlled markup).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; img-src 'self' data:; " +
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none';";

let cspInstalled = false;

// Install the CSP as a real HTTP response header on the default session. Guarded
// so repeated createMainWindow calls (window-all-closed → reopen) don't stack
// listeners. defaultSession is available once the app is ready, which is the
// only time createMainWindow runs.
const ensureCspHeader = (): void => {
  if (cspInstalled) return;
  cspInstalled = true;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });
};

export const createMainWindow = (): BrowserWindow => {
  ensureCspHeader();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false, // custom titlebar in renderer (TitleBar.tsx)
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: resolve(__dirname, "ipc/preload.cjs"),
    },
  });

  const devUrl = process.env["RENDERER_URL"];

  // Navigation hardening: agent-authored content (chat/issue markdown) renders
  // in this privileged renderer. A javascript:/http(s): link or window.open
  // could otherwise navigate the window off the app bundle or spawn a popup
  // that reaches the broad window.prospero preload API.
  //
  // External links → real browser, never an in-app popup.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Allow only the app's own origin to navigate the document. In dev that's the
  // Vite dev URL; in production it's the packaged file:// bundle. HashRouter
  // route changes are hash-only and do NOT fire will-navigate, so this does not
  // break in-app routing. The initial loadURL/loadFile below also does not fire
  // will-navigate, so it is never blocked.
  win.webContents.on("will-navigate", (e, url) => {
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith("file://");
    if (allowed) return;
    e.preventDefault();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
  });

  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(resolve(__dirname, "../../renderer/dist/index.html"));
  }

  win.once("ready-to-show", () => win.show());
  return win;
};
