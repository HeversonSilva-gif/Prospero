import { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const createMainWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#F5F5FA",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: resolve(__dirname, "ipc/preload.js"),
    },
  });

  const devUrl = process.env["RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(resolve(__dirname, "../../renderer/dist/index.html"));
  }

  win.once("ready-to-show", () => win.show());
  return win;
};
