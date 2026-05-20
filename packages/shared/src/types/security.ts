// M13 PR-E containment zones — read-only summary surface for the Settings
// panel. The on-disk classifier lives in apps/main/src/security/zones.ts;
// this is the shape exposed via the security:list-zones IPC channel so the
// renderer can render the zone map.

export type ZoneSummary =
  | {
      kind: "company";
      companyId: string;
      companyName: string;
      samplePath: string;
    }
  | {
      kind: "agent";
      companyId: string;
      companyName: string;
      agentId: string;
      agentName: string;
      samplePath: string;
    };
