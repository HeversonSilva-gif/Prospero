// Per-tool output shapers. Fase 1: EMPTY — populated in Fase 2, guided by the
// offenders surfaced in tool_output_metrics. A shaper receives the parsed JSON
// and returns a leaner object that is re-stringified before clamping.
export type Shaper = (parsed: unknown, toolName: string) => unknown;
export const shapers: Map<string, Shaper> = new Map();
