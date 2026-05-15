import { app } from "electron";
import { join } from "node:path";

export const databasePath = (): string => join(app.getPath("userData"), "prospero.db");
