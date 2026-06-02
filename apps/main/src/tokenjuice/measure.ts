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
  const seg = getSegmenter();
  if (seg === null) return [...s].length;
  return Array.from(seg.segment(s)).length;
};

export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);
