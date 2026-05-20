// M13 PR-C — TELOS shared types. Pure types, no zod.

// The user's answers to the guided TELOS interview — one per question.
export interface TelosInterviewAnswers {
  purpose: string; // what the business does, and for whom
  growth: string; // where the business should be in 1-2 years
  principles: string; // the non-negotiable rules / beliefs
  idealState: string; // the business running perfectly
  nonGoals: string; // what the business explicitly should NOT become
}

// The draft returned by AI-assisted TELOS synthesis — the telos.md markdown.
// `error` is an advisory list of validation issues (e.g. missing sections);
// the body still saves, the user is just warned.
export interface TelosDraft {
  telos: string;
  error?: string[];
}
