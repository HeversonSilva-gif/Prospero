import type Database from "better-sqlite3";
import { readTelos } from "../companies/telos-store.js";

// Assembles the real business context fed into charter authoring so charters are
// concrete to THIS company instead of generic archetypes. Pure builder (parts
// injected); gatherBusinessContext below wires the real readers.

/** Max chars of the TELOS body included in the context block. */
export const BUSINESS_CONTEXT_CAP = 4000;

export type BusinessContextParts = {
  companyName: string | null;
  xHandle: string | null;
  voice: string | null;
  telos: string | null;
};

export const buildBusinessContext = (parts: BusinessContextParts): string => {
  const lines: string[] = [];
  const name = parts.companyName?.trim() ?? "";
  if (name !== "") lines.push(`Company: ${name}`);
  const handle = parts.xHandle?.trim() ?? "";
  if (handle !== "") lines.push(`Publishes on X (Twitter) as ${handle}`);
  const voice = parts.voice?.trim() ?? "";
  if (voice !== "") lines.push(`Brand voice: ${voice}`);

  let block = lines.join("\n");
  const telos = parts.telos?.trim() ?? "";
  if (telos !== "") {
    block +=
      (block !== "" ? "\n\n" : "") +
      `## TELOS — what this company exists for\n\n${telos.slice(0, BUSINESS_CONTEXT_CAP)}`;
  }
  if (block === "") return "";
  return `# This business\n\n${block}\n`;
};

// Wires the real readers: company name + X @handle from the db (metadata_json is
// NOT encrypted, so no cipher is needed — read it directly), TELOS from disk.
// When an X connection exists, its handle takes precedence over the proposed handle
// stored at genesis; falls back to proposed_x_handle when X is not yet connected.
export const gatherBusinessContext = (
  db: Database.Database,
  userDataDir: string,
  companyId: string | null,
): string => {
  if (companyId === null) return "";
  const company = db
    .prepare("SELECT name, brand_voice, proposed_x_handle FROM companies WHERE id = ?")
    .get(companyId) as
    | { name: string; brand_voice: string | null; proposed_x_handle: string | null }
    | undefined;
  const conn = db
    .prepare("SELECT metadata_json FROM connections WHERE company_id = ? AND kind = 'x'")
    .get(companyId) as { metadata_json: string | null } | undefined;
  let connHandle: string | null = null;
  if (conn?.metadata_json != null) {
    const meta = JSON.parse(conn.metadata_json) as { handle?: unknown };
    connHandle = typeof meta.handle === "string" ? meta.handle : null;
  }
  return buildBusinessContext({
    companyName: company?.name ?? null,
    xHandle: connHandle ?? company?.proposed_x_handle ?? null,
    voice: company?.brand_voice ?? null,
    telos: readTelos(userDataDir, companyId),
  });
};
