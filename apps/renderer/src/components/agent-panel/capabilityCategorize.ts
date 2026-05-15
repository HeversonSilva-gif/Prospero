export interface CapabilityRow {
  id: string;
  enabled: boolean;
}

export interface CategorizedCapabilities {
  required: CapabilityRow[];
  optional: CapabilityRow[];
  available: string[];
}

export interface CategorizeInput {
  agentCapabilities: string[];
  roleDefaultCapabilities: string[];
  allCapabilities: string[];
}

export const categorizeCapabilities = (input: CategorizeInput): CategorizedCapabilities => {
  const agentSet = new Set(input.agentCapabilities);
  const defaultsSet = new Set(input.roleDefaultCapabilities);

  const required: CapabilityRow[] = input.roleDefaultCapabilities.map((id) => ({
    id,
    enabled: agentSet.has(id),
  }));
  const optional: CapabilityRow[] = input.agentCapabilities
    .filter((id) => !defaultsSet.has(id))
    .map((id) => ({ id, enabled: true }));
  const available = input.allCapabilities.filter((id) => !agentSet.has(id) && !defaultsSet.has(id));

  return { required, optional, available };
};
