import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { parseAgentsMd } from "../agents-md/parser.js";
import { serializeAgentsMd } from "../agents-md/serialize.js";
import { hireFromAgentsMd } from "../agents-md/hire.js";
import { buildExportPayload } from "../agents-md/build-export.js";
import type { ConflictMode, HireSummary } from "../agents-md/schema.js";

// PR-F.2.2: three IPCs for AGENTS.md flow:
//   parse — string in, tagged ParseResult out (renderer drives the preview).
//   hire  — payload + companyId + conflictModes in, HireSummary out. Re-parses
//           via schema instead of trusting the renderer-shipped shape.
//   export — companyId in, { text } out so renderer can drive a save dialog.

export const registerAgentsMdHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.AGENTS_MD_PARSE, (_e, payload: { raw: string }) => {
    if (typeof payload.raw !== "string") {
      throw new Error("[agents-md:parse] raw string required");
    }
    return parseAgentsMd(payload.raw);
  });

  ipcMain.handle(
    IPC.AGENTS_MD_HIRE,
    (
      _e,
      payload: {
        companyId: string;
        payload: unknown;
        conflictModes: Record<string, ConflictMode>;
      },
    ): HireSummary => {
      if (typeof payload.companyId !== "string" || payload.companyId.length === 0) {
        throw new Error("[agents-md:hire] companyId required");
      }
      // Round-trip via serializer + parser to revalidate the shape.
      const text = serializeAgentsMd(payload.payload as never);
      const reparsed = parseAgentsMd(text);
      if (!reparsed.ok) {
        throw new Error(`[agents-md:hire] payload failed re-validation: ${reparsed.error}`);
      }
      return hireFromAgentsMd(db, reparsed.data, {
        companyId: payload.companyId,
        conflictModes: payload.conflictModes ?? {},
        userDataDir: app.getPath("userData"),
      });
    },
  );

  ipcMain.handle(IPC.AGENTS_MD_EXPORT, (_e, payload: { companyId: string }): { text: string } => {
    if (typeof payload.companyId !== "string" || payload.companyId.length === 0) {
      throw new Error("[agents-md:export] companyId required");
    }
    const data = buildExportPayload(db, payload.companyId, app.getPath("userData"));
    return { text: serializeAgentsMd(data) };
  });
};
