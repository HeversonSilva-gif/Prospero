import { Tray, Menu, app } from "electron";
import type { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const createTray = (getWindow: () => BrowserWindow | null): Tray => {
  // tsup copies the asset to dist/resources/ (next to the bundled entry), which
  // is what gets packaged into app.asar. Resolve relative to __dirname (= dist/).
  const iconPath = resolve(__dirname, "resources/tray-icon.png");
  const tray = new Tray(iconPath);
  tray.setToolTip("Prospero");

  const menu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        const win = getWindow();
        if (win === null || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  tray.on("click", () => {
    const win = getWindow();
    if (win === null || win.isDestroyed()) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  return tray;
};
