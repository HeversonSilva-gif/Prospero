import type Database from "better-sqlite3";
import { readTelos } from "../companies/telos-store.js";

// Assembles the real business context fed into charter authoring so charters are
// concrete to THIS company instead of generic archetypes. Pure builder (parts
// injected); gatherBusinessContext below wires the real readers.

export const BUSINESS_CONTEXT_CAP = 4000;

export type BusinessContextParts = {
  companyName: string | null;
  xHandle: string | null;
  telos: string | null;
};

export const buildBusinessContext = (parts: BusinessContextParts): string => {
  const lines: string[] = [];
  const name = parts.companyName?.trim() ?? "";
  if (name !== "") lines.push(`Company: ${name}`);
  const handle = parts.xHandle?.trim() ?? "";
  if (handle !== "") lines.push(`Publishes on X (Twitter) as ${handle}`);

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
export const gatherBusinessContext = (
  db: Database.Database,
  userDataDir: string,
  companyId: string | null,
): string => {
  if (companyId === null) return "";
  const company = db.prepare("SELECT name FROM companies WHERE id = ?").get(companyId) as
    | { name: string }
    | undefined;
  const conn = db
    .prepare("SELECT metadata_json FROM connections WHERE company_id = ? AND kind = 'x'")
    .get(companyId) as { metadata_json: string } | undefined;
  let xHandle: string | null = null;
  if (conn !== undefined) {
    const meta = JSON.parse(conn.metadata_json) as { handle?: unknown };
    xHandle = typeof meta.handle === "string" ? meta.handle : null;
  }
  return buildBusinessContext({
    companyName: company?.name ?? null,
    xHandle,
    telos: readTelos(userDataDir, companyId),
  });
};
