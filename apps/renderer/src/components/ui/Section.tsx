import type { FC, ReactNode } from "react";

type Props = { title: string; hint?: string; children: ReactNode };

// Titled block used by every Estúdio tab. Replaces the hand-rolled
// `<section>` + `<h3 className="text-[10px] uppercase…">` pattern.
export const Section: FC<Props> = ({ title, hint, children }) => (
  <section className="space-y-2">
    <h3 className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">{title}</h3>
    {children}
    {hint !== undefined && <p className="text-[10px] text-ink-soft">{hint}</p>}
  </section>
);
