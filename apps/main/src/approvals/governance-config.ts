import type Database from "better-sqlite3";
import { z } from "zod";
import { DEFAULT_GOVERNANCE_CONFIG, type GovernanceConfig } from "@prospero/shared";

const QuietWindowSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
});

const QuietHoursScheduleSchema = z.object({
  windows: z.array(QuietWindowSchema),
});

const PolicyConfigSchema = z.object({
  autoApproveReadOnlyAcrossProjects: z.boolean(),
  autoApproveSpendUnderUsdPerDay: z.number().nonnegative().nullable(),
  ceoCanDecideFires: z.boolean(),
  ceoCanDecideBudgetOverruns: z.boolean(),
  bouncedToCeoTtlHours: z.number().positive().max(72),
});

const GovernanceConfigSchema = z.object({
  quietHours: QuietHoursScheduleSchema,
  policies: PolicyConfigSchema,
});

type Row = {
  company_id: string;
  quiet_hours_json: string;
  policies_json: string;
  updated_at: number;
};

export const loadGovernanceConfig = (
  db: Database.Database,
  companyId: string,
): GovernanceConfig => {
  const row = db.prepare("SELECT * FROM governance_config WHERE company_id = ?").get(companyId) as
    | Row
    | undefined;
  if (row === undefined) return DEFAULT_GOVERNANCE_CONFIG;
  try {
    return GovernanceConfigSchema.parse({
      quietHours: JSON.parse(row.quiet_hours_json) as unknown,
      policies: JSON.parse(row.policies_json) as unknown,
    });
  } catch (err) {
    console.warn(`[governance] malformed config for company ${companyId}, using default:`, err);
    return DEFAULT_GOVERNANCE_CONFIG;
  }
};

export const saveGovernanceConfig = (
  db: Database.Database,
  companyId: string,
  config: GovernanceConfig,
): void => {
  const validated = GovernanceConfigSchema.parse(config);
  db.prepare(
    `INSERT INTO governance_config (company_id, quiet_hours_json, policies_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       quiet_hours_json = excluded.quiet_hours_json,
       policies_json = excluded.policies_json,
       updated_at = excluded.updated_at`,
  ).run(
    companyId,
    JSON.stringify(validated.quietHours),
    JSON.stringify(validated.policies),
    Date.now(),
  );
};
