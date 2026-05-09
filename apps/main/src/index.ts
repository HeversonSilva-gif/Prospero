import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window/main-window.js";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});
