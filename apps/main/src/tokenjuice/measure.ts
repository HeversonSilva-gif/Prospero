// Char/token measurement for TokenJuice. Grapheme-aware so CJK/emoji/accents
// count as one unit. Falls back to code-point counting if Intl.Segmenter is
// unavailable. Token estimate is a documented chars/4 heuristic (no tokenizer dep).

type SegmenterLike = { segment(input: string): Iterable<unknown> };

let segmenter: SegmenterLike | null = null;
let tried = false;

const getSegmenter = (): SegmenterLike | null => {
  if (tried) return segmenter;
  tried = true;
  try {
    const Seg = (
      Intl as unknown as {
        Segmenter?: new (locale?: string, opts?: { granularity: string }) => SegmenterLike;
      }
    ).Segmenter;
    segmenter = Seg ? new Seg(undefined, { granularity: "grapheme" }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
};

export const countChars = (s: string): number => {
  // Fast path: a pure-ASCII string has exactly one grapheme per UTF-16 code unit.
  // Full scan (NOT sampled) so the count stays correct; short-circuits on the
  // first non-ASCII char, so ASCII payloads (the common case) cost one cheap pass.
  let ascii = true;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  }
  if (ascii) return s.length;

  const seg = getSegmenter();
  if (seg === null) return [...s].length;
  // Lazy iteration (no Array.from) so large strings don't materialise every
  // grapheme segment at once (that OOMs on hundreds-of-KB inputs).
  let n = 0;
  const iter = (seg.segment(s))[Symbol.iterator]();
  let res = iter.next();
  while (res.done !== true) {
    n += 1;
    res = iter.next();
  }
  return n;
};

export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);
