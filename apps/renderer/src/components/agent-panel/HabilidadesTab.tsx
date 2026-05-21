import type { FC } from "react";
import type { Skill, Memory } from "@prospero/shared";
import { LearningPanel } from "./LearningPanel.js";

// M16 PR-C3 — Habilidades tab. Wraps LearningPanel (existing M11 component
// that shows skills + memories). PR-G consolidation may polish split if needed.

type Props = {
  agentId: string;
  skills: Skill[];
  memories: Memory[];
};

export const HabilidadesTab: FC<Props> = ({ agentId, skills, memories }) => (
  <LearningPanel agentId={agentId} skills={skills} memories={memories} />
);
