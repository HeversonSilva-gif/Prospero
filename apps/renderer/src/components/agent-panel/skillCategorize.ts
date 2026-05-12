export interface SkillRow {
  id: string;
  enabled: boolean;
}

export interface CategorizedSkills {
  required: SkillRow[];
  optional: SkillRow[];
  available: string[];
}

export interface CategorizeInput {
  agentSkills: string[];
  roleDefaultSkills: string[];
  allSkills: string[];
}

export const categorizeSkills = (input: CategorizeInput): CategorizedSkills => {
  const agentSet = new Set(input.agentSkills);
  const defaultsSet = new Set(input.roleDefaultSkills);

  const required: SkillRow[] = input.roleDefaultSkills.map((id) => ({
    id,
    enabled: agentSet.has(id),
  }));
  const optional: SkillRow[] = input.agentSkills
    .filter((id) => !defaultsSet.has(id))
    .map((id) => ({ id, enabled: true }));
  const available = input.allSkills.filter((id) => !agentSet.has(id) && !defaultsSet.has(id));

  return { required, optional, available };
};
