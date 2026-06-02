// Generic, pure clamp. JSON path: structural trim that preserves VALID JSON
// (long strings get a suffix marker, long arrays keep a head + a sentinel
// describing what was omitted). Non-JSON path: head/tail text truncation.
// Last resort when even aggressive trimming overflows: a valid summary object.

export interface ClampOpts {
  budgetChars: number;
  maxFieldChars: number;
  maxArrayItems: number;
  toolName: string;
}

export interface ClampResult {
  text: string;
  mode: "json" | "text";
}

interface TrimOpts {
  maxFieldChars: number;
  maxArrayItems: number;
  toolName: string;
}

const truncString = (s: string, maxFieldChars: number): string => {
  if (s.length <= maxFieldChars) return s;
  const omitted = s.length - maxFieldChars;
  return `${s.slice(0, maxFieldChars)} …[+${omitted} chars]`;
};

const trimValue = (value: unknown, opts: TrimOpts): unknown => {
  if (typeof value === "string") return truncString(value, opts.maxFieldChars);
  if (Array.isArray(value)) {
    const kept: unknown[] = value.slice(0, opts.maxArrayItems).map((v) => trimValue(v, opts));
    const omitted = value.length - opts.maxArrayItems;
    if (omitted > 0) {
      kept.push(
        `+${omitted} itens omitidos — chame ${opts.toolName} com {full:true} ou um filtro para ver o resto`,
      );
    }
    return kept;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = trimValue(v, opts);
    }
    return out;
  }
  return value; // number | boolean | null
};

const clampText = (s: string, budgetChars: number): string => {
  if (s.length <= budgetChars) return s;
  const head = Math.max(1, Math.floor(budgetChars * 0.7));
  const tail = Math.max(0, budgetChars - head);
  const omitted = s.length - head - tail;
  return `${s.slice(0, head)}\n…[${omitted} chars omitidos]…\n${s.slice(s.length - tail)}`;
};

export const clamp = (result: string, opts: ClampOpts): ClampResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return { text: clampText(result, opts.budgetChars), mode: "text" };
  }

  // maxArrayItems is fixed: array cap stays constant across all passes.
  // Only maxFieldChars escalates (halves each pass) to progressively trim string fields.
  let maxFieldChars = opts.maxFieldChars;
  const maxArrayItems = opts.maxArrayItems;
  let firstPassText: string | null = null;
  for (let pass = 0; pass < 4; pass += 1) {
    const trimmed = trimValue(parsed, { maxFieldChars, maxArrayItems, toolName: opts.toolName });
    const text = JSON.stringify(trimmed);
    // Keep the first-pass result: it has the most informative structure
    if (pass === 0) firstPassText = text;
    if (text.length <= opts.budgetChars) return { text, mode: "json" };
    maxFieldChars = Math.max(80, Math.floor(maxFieldChars / 2));
  }

  // If structural trimming (array cap + string truncation) actually reduced the payload,
  // return the first-pass result even if still over budget — valid JSON with markers.
  // Only fall back to summary when trimming had no effect (payload is irreducible).
  if (firstPassText !== null && firstPassText.length < result.length) {
    return { text: firstPassText, mode: "json" };
  }

  const keys =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.keys(parsed)
      : [];
  const summary = {
    _truncated: true,
    tool: opts.toolName,
    note: `payload de ${result.length} chars excedeu o orçamento; reduza o escopo da chamada`,
    topLevelKeys: keys,
  };
  return { text: JSON.stringify(summary), mode: "json" };
};
