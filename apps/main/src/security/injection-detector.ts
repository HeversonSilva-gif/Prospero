// Pure, deterministic prompt-injection heuristic for UNTRUSTED external content
// (email bodies today; future: X mentions). Two-tier verdict. No LLM. Never throws
// on string input. Conservative thresholds: a legit email with a casual "ignore"
// stays allow/flag -- only multiple strong signals reach "block".

export interface InjectionVerdict {
  verdict: "allow" | "flag" | "block";
  score: number;
  reasons: string[];
}

// Zero-width / invisible Unicode characters used in obfuscation attacks.
// Built via RegExp constructor with explicit unicode escapes to avoid embedding
// literal invisible code points (ESLint no-irregular-whitespace /
// no-misleading-character-class). Covers: ZWSP (200B), ZWNJ (200C), ZWJ (200D),
// BOM/ZWNBSP (FEFF), soft-hyphen (00AD), CGJ (034F), word-joiner (2060),
// LTR/RTL marks (200E/200F), bidi formatting (202A-202E), bidi isolates (2066-2069).
// Use match() instead of test() to avoid /g stateful lastIndex flakiness.
// The eslint-disable covers ZWJ (200D) and CGJ (034F) which trigger
// no-misleading-character-class even inside a RegExp constructor string.
// These are intentional: we want to detect these exact obfuscation chars.
/* eslint-disable no-misleading-character-class */
const ZERO_WIDTH = new RegExp("[​‌‍﻿­͏⁠‎‏‪-‮⁦-⁩]", "g");
/* eslint-enable no-misleading-character-class */

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "@": "a" };
const HOMOGLYPH: Record<string, string> = {
  а: "a", // Cyrillic a
  е: "e", // Cyrillic e
  о: "o", // Cyrillic o
  р: "p", // Cyrillic r
  с: "c", // Cyrillic c
  у: "y", // Cyrillic u
  х: "x", // Cyrillic x
  і: "i", // Cyrillic i
  ѕ: "s", // Cyrillic dze
  һ: "h", // Cyrillic shha
  ԁ: "d", // Cyrillic komi de
};

const mapChars = (s: string, table: Record<string, string>): string =>
  s.replace(/./gu, (ch) => table[ch] ?? ch);

interface Rule {
  code: string;
  weight: number;
  re: RegExp;
}

const RULES: Rule[] = [
  {
    code: "override.ignore_previous",
    weight: 0.5,
    re: /(ignore|disregard|forget|bypass)\s+(all\s+)?(your\s+)?(previous|prior|above|the\s+system)\s+(instructions|prompt|rules)/,
  },
  {
    code: "exfiltrate.system_prompt",
    weight: 0.5,
    re: /(reveal|show|print|dump|repeat|leak)\s+(the\s+|your\s+)?(system|developer|hidden)\s+(prompt|instructions)/,
  },
  {
    code: "exfiltrate.secrets",
    weight: 0.5,
    re: /(reveal|print|dump|send|leak|exfiltrate)\s+.{0,30}(api[\s_-]?key|secret|token|password|credential|private\s+key)/,
  },
  {
    code: "role.hijack",
    weight: 0.35,
    re: /(you\s+are\s+now|act\s+as|developer\s+mode|jailbreak|\bdan\b)/,
  },
  {
    code: "tool.abuse",
    weight: 0.35,
    re: /(call|use|run|execute)\s+.{0,20}(tool|function|command)\s+.{0,30}(without\s+approval|no\s+matter|even\s+if)/,
  },
];

const FLAG_THRESHOLD = 0.4;
const BLOCK_THRESHOLD = 0.8;

export const detectInjection = (text: string): InjectionVerdict => {
  const lowered = text.toLowerCase();
  // Use match() (not test()) so /g regex statefulness does not cause flakiness.
  const hadZeroWidth = (lowered.match(ZERO_WIDTH) ?? []).length > 0;
  const collapsed = mapChars(mapChars(lowered.replace(ZERO_WIDTH, ""), LEET), HOMOGLYPH);
  const compact = collapsed.replace(/\s+/g, "");
  const variants = [lowered, collapsed, compact];

  const reasons: string[] = [];
  let score = 0;
  for (const rule of RULES) {
    if (variants.some((v) => rule.re.test(v))) {
      reasons.push(rule.code);
      score += rule.weight;
    }
  }
  if (hadZeroWidth) {
    reasons.push("obfuscation.zerowidth");
    score += 0.2;
  }

  const verdict: InjectionVerdict["verdict"] =
    score >= BLOCK_THRESHOLD ? "block" : score >= FLAG_THRESHOLD ? "flag" : "allow";
  return { verdict, score, reasons };
};
