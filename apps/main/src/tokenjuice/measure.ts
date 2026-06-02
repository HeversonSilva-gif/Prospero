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
  // Fast path: pure ASCII strings have charCode < 128 everywhere, so
  // String#length already equals the grapheme count. Avoids a full segmenter
  // walk on large ASCII payloads (e.g. JSON tool results in the hot path).
  // We sample every 64th char to keep the check O(1) for large strings;
  // a full scan would defeat the purpose.
  if (s.length > 0) {
    let allAscii = true;
    const step = Math.max(1, Math.floor(s.length / 64));
    for (let i = 0; i < s.length; i += step) {
      if (s.charCodeAt(i) > 127) {
        allAscii = false;
        break;
      }
    }
    if (allAscii) return s.length;
  }

  const seg = getSegmenter();
  if (seg === null) {
    // Use an iterator loop to avoid allocating a potentially huge temporary
    // array that would be created by spreading into [...s].
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of s) n++;
    return n;
  }
  // seg.segment() returns a lazy iterator — count without materialising.
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of seg.segment(s)) n++;
  return n;
};

export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);
