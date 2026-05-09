import { app, BrowserWindow, Tray } from "electron";
import type Database from "better-sqlite3";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/index.js";
import { openDatabase } from "./db/client.js";
import { databasePath } from "./db/path.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

app.whenReady().then(() => {
  db = openDatabase(databasePath());
  registerIpcHandlers();
  mainWindow = createMainWindow();
  tray = createTray(getWindow);
});

// On Windows, closing the window should hide it (tray keeps app alive).
app.on("window-all-closed", (event: Event) => {
  // Do not quit; tray keeps process alive.
  event.preventDefault();
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});

app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
  db?.close();
  db = null;
});
