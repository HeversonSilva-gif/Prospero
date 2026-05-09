import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: () => "pong",
});
