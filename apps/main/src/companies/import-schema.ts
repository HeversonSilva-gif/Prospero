import { z } from "zod";

// PR-F.2.1: validates the JSON payload produced by exportCompany (PR-F.1).
// Schema is intentionally permissive: rows are kept as unknown records so
// schema drift between export and import versions does not block restore.
// import.ts intersects row keys with current table columns via PRAGMA.

const RowSchema = z.record(z.unknown());

export const CompanyImportSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.number(),
  company: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    createdAt: z.number(),
  }),
  agents: z.array(RowSchema),
  projects: z.array(RowSchema),
  issues: z.array(RowSchema),
  threads: z.array(RowSchema),
  messages: z.array(RowSchema),
  inbox: z.array(RowSchema),
  costEvents: z.array(RowSchema),
  activityEvents: z.array(RowSchema),
  goals: z.array(RowSchema),
  approvals: z.array(RowSchema),
});

export type CompanyImportV1 = z.infer<typeof CompanyImportSchemaV1>;

export type ImportSummary = {
  newCompanyId: string;
  newCompanyName: string;
  counts: {
    agents: number;
    projects: number;
    issues: number;
    threads: number;
    messages: number;
    inbox: number;
    approvals: number;
    costEvents: number;
    activityEvents: number;
    goals: number;
  };
  warnings: string[];
};
